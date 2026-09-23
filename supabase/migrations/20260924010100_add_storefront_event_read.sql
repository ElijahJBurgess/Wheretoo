alter table public.organizers add column storefront_featured_event_id uuid references public.events(id) on delete set null;
create index events_storefront_order_idx on public.events(organizer_id,starts_at,id) where status='published';
create function private.guard_storefront_featured() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.storefront_featured_event_id is not null and not exists(select 1 from public.events where id=new.storefront_featured_event_id and organizer_id=new.id) then raise exception using errcode='P0001',message='FEATURED_EVENT_NOT_OWNED'; end if;
 return new;
end; $$;
create trigger guard_storefront_featured before insert or update of storefront_featured_event_id on public.organizers for each row execute function private.guard_storefront_featured();
create function private.storefront_event_card(p_event uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.events; source jsonb; state text:='unavailable'; minimum bigint; currency text;
begin
 select * into e from public.events where id=p_event;
 if not found or not private.event_is_publicly_eligible(e.id,statement_timestamp()) then return null; end if;
 if e.admission_type='free' then
  source:=public.get_public_free_rsvp(e.id);
  state:=case source#>>'{availability,status}' when 'available' then 'available' when 'full' then 'sold_out' else 'unavailable' end;
 else
  select x into source from public.get_public_event_ticketing(e.id) x;
  if exists(select 1 from jsonb_array_elements(source->'tiers') t where t->>'availability_status'='available') then
   state:='available';
   select min((t->>'unit_amount_minor')::bigint),min(t->>'currency') into minimum,currency from jsonb_array_elements(source->'tiers') t where t->>'availability_status'='available';
  elsif jsonb_array_length(source->'tiers')>0 and not exists(select 1 from jsonb_array_elements(source->'tiers') t where t->>'availability_status'<>'sold_out') then state:='sold_out'; end if;
 end if;
 return jsonb_build_object('id',e.id,'title',e.title,'startsAt',e.starts_at,'endsAt',e.ends_at,'timezone',e.timezone,'venue',e.venue_name,'city',e.city,'admissionType',e.admission_type,
 'flyerId',(select id from private.event_images where event_id=e.id and position=1),
 'admission',jsonb_build_object('state',state,'minimumAmountMinor',minimum,'currency',currency));
end; $$;
create function private.storefront_document(p_owner uuid,p_cursor jsonb,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 return jsonb_build_object('identity',jsonb_build_object('handle',o.handle,'name',o.display_name,'bio',o.bio,'city',o.base_city,'logoId',o.storefront_logo_asset_id,'coverId',null,'accent',null,'links','{}'::jsonb,'websiteUrl',o.website_url),
 'featured',private.storefront_event_card(featured),'events',items,'nextCursor',cursor_value,'serverNow',statement_timestamp(),'merch','[]'::jsonb,'storeUrl',null);
end; $$;
drop function public.get_public_organizer_storefront(text);
create function public.get_public_organizer_storefront(p_handle text,p_cursor jsonb default null,p_limit integer default 5) returns jsonb language sql stable security definer set search_path='' as $$
 select private.storefront_document(id,p_cursor,p_limit) from public.organizers where handle=lower(btrim(p_handle)) and storefront_status='published' and handle_confirmed_at is not null and storefront_logo_asset_id is not null;
$$;
revoke all on function private.guard_storefront_featured(),private.storefront_event_card(uuid),private.storefront_document(uuid,jsonb,integer),public.get_public_organizer_storefront(text,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_public_organizer_storefront(text,jsonb,integer) to anon,authenticated;
