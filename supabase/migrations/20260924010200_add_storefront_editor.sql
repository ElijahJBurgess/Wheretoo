alter table public.organizers
 add column storefront_cover_asset_id uuid references private.organizer_media(id) on delete restrict,
 add column storefront_accent text check(storefront_accent in ('violet','blue','rose','amber')),
 add column storefront_links jsonb not null default '{}';
create function private.storefront_url_valid(v text) returns boolean language sql immutable set search_path='' as $$
 select v is null or (char_length(v) between 8 and 2048 and v !~ '[[:space:]\\]' and v ~ '^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:cntrl:]]*)?$');
$$;
create function private.storefront_links_valid(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; u text;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>9000 then return false;end if;
 for k,u in select key,value #>> '{}' from jsonb_each(v) loop
  if k not in ('instagram','tiktok','x','youtube') or jsonb_typeof(v->k)<>'string' or not private.storefront_url_valid(u) then return false;end if;
  if not (case k when 'instagram' then u ~ '^https?://(www\.)?instagram\.com([/?#]|$)' when 'tiktok' then u ~ '^https?://(www\.)?tiktok\.com([/?#]|$)' when 'x' then u ~ '^https?://(www\.)?(x|twitter)\.com([/?#]|$)' when 'youtube' then u ~ '^https?://((www\.)?youtube\.com|youtu\.be)([/?#]|$)' end) then return false;end if;
 end loop;
 return true;
end; $$;
alter table public.organizers add constraint storefront_links_valid check(private.storefront_links_valid(storefront_links));
create function public.get_owned_storefront_editor() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',display_name,'bio',bio,'city',base_city,'websiteUrl',website_url,'logoId',storefront_logo_asset_id,'coverId',storefront_cover_asset_id,'accent',storefront_accent,'links',storefront_links,'featuredEventId',storefront_featured_event_id,'handle',handle,'status',storefront_status,'updatedAt',updated_at) from public.organizers where id=auth.uid();
$$;
create function public.save_owned_storefront(p_input jsonb,p_expected_updated_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.organizers; logo uuid; cover uuid; featured uuid;
begin
 if auth.uid() is null then raise exception using errcode='P0001',message='ORGANIZER_NOT_FOUND';end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>14000 or
 (select array_agg(k order by k) from jsonb_object_keys(p_input) k) is distinct from array['accent','bio','city','coverId','featuredEventId','links','logoId','name','websiteUrl']::text[]
 or jsonb_typeof(p_input->'name') is distinct from 'string' or char_length(btrim(p_input->>'name')) not between 2 and 100
 or (p_input->>'bio' is not null and (jsonb_typeof(p_input->'bio')<>'string' or char_length(p_input->>'bio')>500))
 or (p_input->>'city' is not null and (jsonb_typeof(p_input->'city')<>'string' or char_length(btrim(p_input->>'city')) not between 1 and 120))
 or not private.storefront_url_valid(p_input->>'websiteUrl') or not private.storefront_links_valid(p_input->'links')
 or (p_input->>'accent' is not null and p_input->>'accent' not in ('violet','blue','rose','amber')) then raise exception using errcode='P0001',message='STOREFRONT_INVALID';end if;
 begin logo:=(p_input->>'logoId')::uuid;cover:=(p_input->>'coverId')::uuid;featured:=(p_input->>'featuredEventId')::uuid;
 exception when others then raise exception using errcode='P0001',message='STOREFRONT_INVALID';end;
 -- This existing writer acquires event-operation/tier/event/organizer locks and
 -- performs profile revision invalidation. Never lock the organizer before it.
 begin
  perform public.save_owned_organizer_settings(p_input->>'name',p_input->>'bio',p_expected_updated_at);
 exception when raise_exception then
  if sqlerrm='ORGANIZER_SETTINGS_CONFLICT' then raise exception using errcode='P0001',message='STOREFRONT_CONFLICT';else raise;end if;
 end;
 select * into o from public.organizers where id=auth.uid();
 if (logo is not null and not exists(select 1 from private.organizer_media where id=logo and owner_id=o.id)) or
 (cover is not null and not exists(select 1 from private.organizer_media where id=cover and owner_id=o.id)) then raise exception using errcode='P0001',message='IMAGE_NOT_OWNED';end if;
 if o.storefront_status='published' and logo is null then raise exception using errcode='P0001',message='LOGO_REQUIRED';end if;
 update public.organizers set base_city=p_input->>'city',website_url=p_input->>'websiteUrl',storefront_logo_asset_id=logo,storefront_cover_asset_id=cover,storefront_accent=p_input->>'accent',storefront_links=p_input->'links',storefront_featured_event_id=featured where id=o.id;
 return public.get_owned_storefront_editor();
end; $$;
create function public.set_owned_storefront_published(p_published boolean,p_expected_updated_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.organizers;
begin
 select * into o from public.organizers where id=auth.uid() for update;
 if not found then raise exception using errcode='P0001',message='ORGANIZER_NOT_FOUND';end if;
 if p_published is null then raise exception using errcode='P0001',message='STOREFRONT_INVALID';end if;
 if p_expected_updated_at is null or o.updated_at is distinct from p_expected_updated_at then raise exception using errcode='P0001',message='STOREFRONT_CONFLICT';end if;
 if p_published and (o.handle_confirmed_at is null or o.storefront_logo_asset_id is null or not exists(select 1 from public.events where organizer_id=o.id and private.event_is_publicly_eligible(id,statement_timestamp()))) then raise exception using errcode='P0001',message='STOREFRONT_PUBLISH_REQUIREMENTS';end if;
 update public.organizers set storefront_status=case when p_published then 'published' else 'draft' end where id=o.id;
 return public.get_owned_storefront_editor();
end; $$;
create function public.get_owned_storefront_preview(p_cursor jsonb default null,p_limit integer default 5) returns jsonb language sql stable security definer set search_path='' as $$
 select private.storefront_document(id,p_cursor,p_limit) from public.organizers where id=auth.uid();
$$;
create or replace function public.server_get_organizer_media(p_id uuid,p_owner uuid default null) returns text language sql stable security definer set search_path='' as $$
 select m.object_path from private.organizer_media m where m.id=p_id and
 (m.owner_id=p_owner or exists(select 1 from public.organizers o where o.id=m.owner_id and o.storefront_status='published' and m.id in (o.storefront_logo_asset_id,o.storefront_cover_asset_id)));
$$;
revoke all on function private.storefront_url_valid(text),private.storefront_links_valid(jsonb),public.get_owned_storefront_editor(),public.save_owned_storefront(jsonb,timestamptz),public.set_owned_storefront_published(boolean,timestamptz),public.get_owned_storefront_preview(jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_owned_storefront_editor(),public.save_owned_storefront(jsonb,timestamptz),public.set_owned_storefront_published(boolean,timestamptz),public.get_owned_storefront_preview(jsonb,integer) to authenticated;
create or replace function private.storefront_document(p_owner uuid,p_cursor jsonb,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.organizers; featured uuid; last_start timestamptz; last_id uuid; e record; items jsonb:='[]'; cursor_value jsonb:=null; last_cursor jsonb; n integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 20 then raise exception using errcode='22023',message='STOREFRONT_QUERY_INVALID';end if;
 select * into o from public.organizers where id=p_owner;
 if not found then return null; end if;
 select id into featured from public.events where id=o.storefront_featured_event_id and organizer_id=o.id and private.event_is_publicly_eligible(id,statement_timestamp());
 if featured is null then select id into featured from public.events where organizer_id=o.id and status='published' and ends_at>statement_timestamp() and private.event_is_publicly_eligible(id,statement_timestamp()) order by starts_at,id limit 1;end if;
 if p_cursor is not null then
  begin
   if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>512 or (select array_agg(k order by k) from jsonb_object_keys(p_cursor) k) is distinct from array['featured','handle','id','start']::text[]
    or p_cursor->>'handle' is distinct from o.handle or p_cursor->>'featured' is distinct from featured::text then raise exception 'invalid';end if;
   last_start:=(p_cursor->>'start')::timestamptz; last_id:=(p_cursor->>'id')::uuid;
   if last_id is null or last_start is null or not isfinite(last_start) then raise exception 'invalid';end if;
  exception when others then raise exception using errcode='22023',message='STOREFRONT_CURSOR_CHANGED';end;
 end if;
 for e in select id,starts_at from public.events where organizer_id=o.id and status='published' and ends_at>statement_timestamp()
 and id is distinct from featured and (last_id is null or (starts_at,id)>(last_start,last_id)) and private.event_is_publicly_eligible(id,statement_timestamp()) order by starts_at,id limit p_limit+1 loop
  n:=n+1;if n>p_limit then cursor_value:=last_cursor;exit;end if;
  items:=items||jsonb_build_array(private.storefront_event_card(e.id));
  last_cursor:=jsonb_build_object('handle',o.handle,'featured',featured,'start',e.starts_at,'id',e.id);
 end loop;
 return jsonb_build_object('identity',jsonb_build_object('handle',o.handle,'name',o.display_name,'bio',o.bio,'city',o.base_city,'logoId',o.storefront_logo_asset_id,'coverId',o.storefront_cover_asset_id,'accent',o.storefront_accent,'links',o.storefront_links,'websiteUrl',case when private.storefront_url_valid(o.website_url) then o.website_url else null end),
 'featured',private.storefront_event_card(featured),'events',items,'nextCursor',cursor_value,'serverNow',statement_timestamp(),'merch','[]'::jsonb,'storeUrl',null);
end; $$;

-- Pure CHECK validators must be callable during the existing authenticated INSERT.
grant execute on function private.storefront_url_valid(text),private.storefront_links_valid(jsonb) to authenticated;
