-- Storefront identity stays on the organizer. Media can be uploaded during setup.
create table private.organizer_media (
 id uuid primary key references storage.objects(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete restrict,
 object_path text not null unique,
 created_at timestamptz not null default now()
);
revoke all on private.organizer_media from public,anon,authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('organizer-media','organizer-media',false,5242880,array['image/jpeg','image/png','image/webp']);
alter table public.organizers
 add column handle text,
 add column handle_confirmed_at timestamptz,
 add column storefront_status text not null default 'draft' check(storefront_status in ('draft','published')),
 add column storefront_logo_asset_id uuid references private.organizer_media(id) on delete restrict;
create unique index organizers_handle_unique on public.organizers(handle);
create function private.storefront_handle_valid(p_handle text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(char_length(p_handle) between 3 and 30 and p_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 and p_handle <> all(array['auth','discover','discovery','event-policy','event-status','events','moderation','orders','organizer','organizer-terms','refund-details','rsvp','ticket-access','tickets','assets','api','terms','privacy','support','help','admin','login','signup','__dev']),false);
$$;
alter table public.organizers add constraint organizers_handle_valid check(
 (handle is null and handle_confirmed_at is null) or
 (handle is not null and handle_confirmed_at is not null and private.storefront_handle_valid(handle)));
create function private.guard_storefront_handle() returns trigger language plpgsql set search_path='' as $$
begin
 if old.handle_confirmed_at is not null and (new.handle is distinct from old.handle or new.handle_confirmed_at is distinct from old.handle_confirmed_at) then
  raise exception using errcode='P0001',message='HANDLE_IMMUTABLE';
 end if;
 return new;
end; $$;
create trigger organizers_guard_storefront_handle before update on public.organizers for each row execute function private.guard_storefront_handle();
create function private.attach_organizer_media() returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
 if new.bucket_id <> 'organizer-media' then return new; end if;
 if new.name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then raise exception 'INVALID_IMAGE_PATH'; end if;
 owner:=split_part(new.name,'/',1)::uuid;
 if new.user_metadata->>'organizer_id' is distinct from owner::text then raise exception 'IMAGE_NOT_OWNED'; end if;
 perform 1 from auth.users where id=owner for update;
 if not found then raise exception 'IMAGE_NOT_OWNED'; end if;
 if (select count(*) from private.organizer_media where owner_id=owner)>=12 then raise exception 'IMAGE_LIMIT'; end if;
 if new.version='1' then return new; end if;
 if new.metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp') or new.metadata->>'mimetype' is null
 or coalesce((new.metadata->>'size')::bigint,0) not between 1 and 5242880 then raise exception 'INVALID_IMAGE_FILE'; end if;
 insert into private.organizer_media(id,owner_id,object_path) values(new.id,owner,new.name);
 return new;
end; $$;
create trigger attach_organizer_media after insert on storage.objects for each row execute function private.attach_organizer_media();
create function public.storefront_handle_available(p_handle text) returns boolean language sql stable security definer set search_path='' as $$
 select private.storefront_handle_valid(lower(btrim(p_handle))) and not exists(select 1 from public.organizers where handle=lower(btrim(p_handle)));
$$;
create function public.confirm_owned_storefront_handle(p_handle text,p_logo_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); h text:=lower(btrim(p_handle)); o public.organizers;
begin
 if not private.storefront_handle_valid(h) then raise exception using errcode='P0001',message='HANDLE_INVALID'; end if;
 select * into o from public.organizers where id=owner for update;
 if not found then raise exception using errcode='P0001',message='ORGANIZER_NOT_FOUND'; end if;
 if o.handle_confirmed_at is not null and o.handle<>h then raise exception using errcode='P0001',message='HANDLE_IMMUTABLE'; end if;
 if o.handle_confirmed_at is not null then return jsonb_build_object('handle',o.handle,'confirmedAt',o.handle_confirmed_at);end if;
 if not exists(select 1 from private.organizer_media where id=p_logo_id and owner_id=owner) then raise exception using errcode='P0001',message='LOGO_NOT_OWNED'; end if;
 begin
  update public.organizers set handle=h,handle_confirmed_at=coalesce(handle_confirmed_at,clock_timestamp()),storefront_logo_asset_id=p_logo_id,onboarding_completed_at=coalesce(onboarding_completed_at,clock_timestamp()) where id=owner returning * into o;
 exception when unique_violation then raise exception using errcode='P0001',message='HANDLE_TAKEN'; end;
 return jsonb_build_object('handle',o.handle,'confirmedAt',o.handle_confirmed_at);
end; $$;
create function public.get_owned_storefront_identity() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('handle',handle,'logoId',storefront_logo_asset_id,'name',display_name) from public.organizers where id=auth.uid();
$$;
create function public.get_public_organizer_storefront(p_handle text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('handle',handle,'name',display_name,'bio',bio,'city',base_city,'logoId',storefront_logo_asset_id)
 from public.organizers where handle=lower(btrim(p_handle)) and storefront_status='published' and handle_confirmed_at is not null and storefront_logo_asset_id is not null;
$$;
create function public.server_get_organizer_media(p_id uuid,p_owner uuid default null) returns text language sql stable security definer set search_path='' as $$
 select m.object_path from private.organizer_media m where m.id=p_id and
 (m.owner_id=p_owner or exists(select 1 from public.organizers o where o.id=m.owner_id and o.storefront_status='published' and o.storefront_logo_asset_id=m.id));
$$;
revoke all on function private.storefront_handle_valid(text),private.guard_storefront_handle(),private.attach_organizer_media(),public.storefront_handle_available(text),public.confirm_owned_storefront_handle(text,uuid),public.get_owned_storefront_identity(),public.get_public_organizer_storefront(text),public.server_get_organizer_media(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.storefront_handle_available(text),public.get_public_organizer_storefront(text) to anon,authenticated;
grant execute on function public.confirm_owned_storefront_handle(text,uuid),public.get_owned_storefront_identity() to authenticated;
grant execute on function public.server_get_organizer_media(uuid,uuid) to service_role;
create function public.server_find_organizer_media(p_owner uuid,p_path text) returns uuid language sql stable security definer set search_path='' as $$
 select id from private.organizer_media where owner_id=p_owner and object_path=p_path;
$$;
revoke all on function public.server_find_organizer_media(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.server_find_organizer_media(uuid,text) to service_role;

-- Organizer INSERT evaluates CHECK validators as the authenticated caller.
-- This pure validator exposes no rows and the private schema is not an API.
grant execute on function private.storefront_handle_valid(text) to authenticated;
