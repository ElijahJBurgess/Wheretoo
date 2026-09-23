alter table public.organizers add column storefront_merch jsonb not null default '[]' check(jsonb_typeof(storefront_merch)='array' and jsonb_array_length(storefront_merch)<=3), add column storefront_store_url text check(private.storefront_url_valid(storefront_store_url));
create function public.save_owned_storefront_merch(p_items jsonb,p_store_url text default null,p_expected_updated_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.organizers; item jsonb; image uuid; seen uuid[]:='{}'; item_id uuid;
begin
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>3 or octet_length(p_items::text)>9000 or not private.storefront_url_valid(p_store_url) then raise exception using errcode='P0001',message='MERCH_INVALID';end if;
 select * into o from public.organizers where id=auth.uid() for update;
 if not found then raise exception using errcode='P0001',message='ORGANIZER_NOT_FOUND';end if;
 if p_expected_updated_at is null or o.updated_at is distinct from p_expected_updated_at then raise exception using errcode='P0001',message='STOREFRONT_CONFLICT';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from array['id','imageId','price','title','url']::text[]
   or jsonb_typeof(item->'title') is distinct from 'string' or char_length(btrim(item->>'title')) not between 1 and 120
   or (item->>'price' is not null and (jsonb_typeof(item->'price')<>'string' or char_length(item->>'price')>60))
   or jsonb_typeof(item->'url') is distinct from 'string' or not private.storefront_url_valid(item->>'url') then raise exception using errcode='P0001',message='MERCH_INVALID';end if;
  begin image:=(item->>'imageId')::uuid;item_id:=(item->>'id')::uuid;exception when others then raise exception using errcode='P0001',message='MERCH_INVALID';end;
  if item_id is null or item_id=any(seen) then raise exception using errcode='P0001',message='MERCH_INVALID';end if;seen:=array_append(seen,item_id);
  if not exists(select 1 from private.organizer_media where id=image and owner_id=o.id) then raise exception using errcode='P0001',message='IMAGE_NOT_OWNED';end if;
 end loop;
 update public.organizers set storefront_merch=p_items,storefront_store_url=p_store_url where id=o.id;
 return public.get_owned_storefront_editor();
end; $$;
create or replace function public.get_owned_storefront_editor() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',display_name,'bio',bio,'city',base_city,'websiteUrl',case when private.storefront_url_valid(website_url) then website_url else null end,'logoId',storefront_logo_asset_id,'coverId',storefront_cover_asset_id,'accent',storefront_accent,'links',storefront_links,'featuredEventId',storefront_featured_event_id,'handle',handle,'status',storefront_status,'updatedAt',updated_at,'merch',storefront_merch,'storeUrl',storefront_store_url) from public.organizers where id=auth.uid();
$$;
create or replace function public.server_get_organizer_media(p_id uuid,p_owner uuid default null) returns text language sql stable security definer set search_path='' as $$
 select m.object_path from private.organizer_media m where m.id=p_id and (m.owner_id=p_owner or exists(select 1 from public.organizers o where o.id=m.owner_id and o.storefront_status='published' and
 (m.id in (o.storefront_logo_asset_id,o.storefront_cover_asset_id) or exists(select 1 from jsonb_array_elements(o.storefront_merch) item where item->>'imageId'=m.id::text))));
$$;
create function private.guard_organizer_media_removal() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.organizers;
begin
 if old.bucket_id<>'organizer-media' then return old;end if;
 select * into o from public.organizers where id::text=split_part(old.name,'/',1) for update;
 if old.id in (o.storefront_logo_asset_id,o.storefront_cover_asset_id) or exists(select 1 from jsonb_array_elements(o.storefront_merch) item where item->>'imageId'=old.id::text) then raise exception using errcode='P0001',message='IMAGE_IN_USE';end if;
 return old;
end; $$;
create trigger guard_organizer_media_removal before delete on storage.objects for each row execute function private.guard_organizer_media_removal();
create function public.server_unused_organizer_media(p_owner uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(m.object_path),'[]') from private.organizer_media m left join public.organizers o on o.id=m.owner_id where m.owner_id=p_owner
 and m.id is distinct from o.storefront_logo_asset_id and m.id is distinct from o.storefront_cover_asset_id
 and not exists(select 1 from jsonb_array_elements(coalesce(o.storefront_merch,'[]')) item where item->>'imageId'=m.id::text);
$$;
revoke all on function public.save_owned_storefront_merch(jsonb,text,timestamptz),private.guard_organizer_media_removal(),public.server_unused_organizer_media(uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_owned_storefront_merch(jsonb,text,timestamptz) to authenticated;
grant execute on function public.server_unused_organizer_media(uuid) to service_role;
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
 'featured',private.storefront_event_card(featured),'events',items,'nextCursor',cursor_value,'serverNow',statement_timestamp(),'merch',o.storefront_merch,'storeUrl',o.storefront_store_url);
end; $$;
