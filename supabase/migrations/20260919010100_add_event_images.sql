-- Private immutable objects; attachments are created atomically by successful Storage uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-images', 'event-images', false, 5242880, array['image/jpeg','image/png','image/webp']);

create table private.event_images (
  id uuid primary key references storage.objects(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  object_path text not null unique,
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  unique (event_id, position) deferrable initially immediate
);
revoke all on private.event_images from public, anon, authenticated, service_role;

create function private.owns_image_event(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.events e where e.id::text=split_part(p_path,'/',1)
    and e.organizer_id=auth.uid() and e.status in ('draft','published'));
$$;
revoke all on function private.owns_image_event(text) from public;
grant execute on function private.owns_image_event(text) to authenticated;

-- Public image bytes are delivered through event-images, never public signing.
create policy event_images_read on storage.objects for select to authenticated
using (bucket_id='event-images' and private.owns_image_event(name));
create policy event_images_delete on storage.objects for delete to authenticated
using (bucket_id='event-images' and private.owns_image_event(name));
-- Deliberately no UPDATE policy: storage upsert cannot overwrite a published URL.

create function private.attach_uploaded_event_image() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_position smallint;
begin
  if new.bucket_id <> 'event-images' then return new; end if;
  if new.name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' then raise exception 'INVALID_IMAGE_PATH'; end if;
  v_event := split_part(new.name,'/',1)::uuid;
  perform 1 from public.events where id=v_event and organizer_id::text=coalesce(new.owner_id,new.user_metadata->>'organizer_id',auth.uid()::text) and status in ('draft','published') for update;
  if not found then raise exception 'IMAGE_EVENT_NOT_OWNED'; end if;
  -- Storage performs a rollback-only permission probe before writing real bytes.
  if new.version='1' then return new; end if;
  if new.metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp')
    or new.metadata->>'mimetype' is null
    or coalesce((new.metadata->>'size')::bigint,0) not between 1 and 5242880
    or (new.metadata->>'mimetype'='image/jpeg' and new.name !~ '\.(jpg|jpeg)$')
    or (new.metadata->>'mimetype'='image/png' and new.name !~ '\.png$')
    or (new.metadata->>'mimetype'='image/webp' and new.name !~ '\.webp$') then raise exception 'INVALID_IMAGE_FILE'; end if;
  select n into v_position from generate_series(1,3) n
    where not exists(select 1 from private.event_images where event_id=v_event and position=n) order by n limit 1;
  if v_position is null then raise exception 'EVENT_IMAGE_LIMIT'; end if;
  insert into private.event_images(id,event_id,object_path,position) values(new.id,v_event,new.name,v_position);
  return new;
end;
$$;
revoke all on function private.attach_uploaded_event_image() from public,anon,authenticated,service_role;
create trigger attach_uploaded_event_image after insert on storage.objects
for each row execute function private.attach_uploaded_event_image();

create function public.list_event_images(p_event_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'eventId',i.event_id,'path',i.object_path,'position',i.position,'owned',e.organizer_id=auth.uid()) order by i.event_id,i.position),'[]'::jsonb)
  from private.event_images i join public.events e on e.id=i.event_id
  where cardinality(p_event_ids) between 1 and 100 and i.event_id=any(p_event_ids)
    and (e.organizer_id=auth.uid() or private.event_is_publicly_eligible(e.id,statement_timestamp()));
$$;
create function public.reorder_event_images(p_event_id uuid,p_image_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.events where id=p_event_id and organizer_id=auth.uid() and status in ('draft','published') for update;
  if not found then raise exception 'IMAGE_EVENT_NOT_OWNED'; end if;
  if cardinality(p_image_ids) not between 1 and 3 or p_image_ids is null
    or (select count(distinct x) from unnest(p_image_ids) x)<>cardinality(p_image_ids)
    or (select array_agg(id order by id) from private.event_images where event_id=p_event_id)
       is distinct from (select array_agg(x order by x) from unnest(p_image_ids) x) then raise exception 'IMAGE_ORDER_CONFLICT'; end if;
  set constraints private.event_images_event_id_position_key deferred;
  update private.event_images i set position=o.n from unnest(p_image_ids) with ordinality o(id,n)
    where i.id=o.id and i.event_id=p_event_id;
  set constraints private.event_images_event_id_position_key immediate;
end;
$$;
revoke all on function public.list_event_images(uuid[]),public.reorder_event_images(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.list_event_images(uuid[]) to anon,authenticated;
grant execute on function public.reorder_event_images(uuid,uuid[]) to authenticated;

-- Serialize removal with uploads/order changes and keep survivors ahead of later uploads.
create function private.lock_event_image_removal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.bucket_id='event-images' then
    perform 1 from public.events where id::text=split_part(old.name,'/',1) for update;
  end if;
  return old;
end;
$$;
create trigger lock_event_image_removal before delete on storage.objects
for each row execute function private.lock_event_image_removal();
create function private.compact_event_image_order() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  set constraints private.event_images_event_id_position_key deferred;
  update private.event_images i set position=o.n from
    (select id,row_number() over(order by position) n from private.event_images where event_id=old.event_id) o
    where i.id=o.id;
  set constraints private.event_images_event_id_position_key immediate;
  return old;
end;
$$;
create trigger compact_event_image_order after delete on private.event_images
for each row execute function private.compact_event_image_order();
revoke all on function private.lock_event_image_removal(),private.compact_event_image_order() from public,anon,authenticated,service_role;

-- Storage completes uploads with a privileged upsert. Reject overwrite races even there.
create function private.prevent_event_image_overwrite() returns trigger
language plpgsql set search_path='' as $$
begin
  if (old.bucket_id='event-images' or new.bucket_id='event-images') and
    (old.name,old.bucket_id,old.version,old.metadata,old.owner_id) is distinct from
    (new.name,new.bucket_id,new.version,new.metadata,new.owner_id) then
    raise exception 'EVENT_IMAGE_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_event_image_overwrite() from public,anon,authenticated,service_role;
create trigger prevent_event_image_overwrite before update on storage.objects
for each row execute function private.prevent_event_image_overwrite();

create function public.server_get_public_event_image(p_image_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select i.object_path from private.event_images i
  where i.id=p_image_id and private.event_is_publicly_eligible(i.event_id,statement_timestamp());
$$;
revoke all on function public.server_get_public_event_image(uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_get_public_event_image(uuid) to service_role;

-- Narrow ownership probe for the validating worker; no broad service table grants.
create function public.server_can_manage_event_images(p_event_id uuid,p_organizer_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.events where id=p_event_id and organizer_id=p_organizer_id and status in ('draft','published'));
$$;
revoke all on function public.server_can_manage_event_images(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_can_manage_event_images(uuid,uuid) to service_role;
