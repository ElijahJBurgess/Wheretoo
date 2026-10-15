begin;

create table private.event_draft_requests (
  organizer_id uuid not null references public.organizers(id) on delete restrict,
  request_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  event_id uuid not null references public.events(id) on delete restrict,
  primary key (organizer_id, request_id)
);
alter table private.event_draft_requests enable row level security;
revoke all on private.event_draft_requests from public, anon, authenticated, service_role;

create function private.validate_event_map_icon_assignment(p_previous uuid, p_next uuid)
returns void language plpgsql set search_path = '' as $$
declare v private.map_icon_versions; i private.map_icons; enabled boolean;
begin
  if p_next is null or p_next is not distinct from p_previous then return; end if;
  -- Match curation's settings → version → catalog lock order. Event callers
  -- hold their established event locks first; curation never locks events.
  select selection_enabled into enabled from private.map_icon_settings where singleton for share;
  select * into v from private.map_icon_versions where id=p_next for share;
  if not found or not coalesce(enabled,false) or v.state <> 'published' then
    raise exception 'EVENT_ICON_UNAVAILABLE';
  end if;
  select * into i from private.map_icons where id=v.icon_id for share;
  if not found or not i.selectable or i.current_version_id is distinct from p_next then
    raise exception 'EVENT_ICON_UNAVAILABLE';
  end if;
end $$;

create function private.parse_event_draft_payload(p_event jsonb)
returns public.events language plpgsql set search_path = '' as $$
declare
  fields text[] := array['title','description','category','starts_at','ends_at','timezone',
    'venue_name','address_line1','address_line2','city','region','postal_code','country_code',
    'mapbox_feature_id','latitude','longitude','admission_type','capacity'];
  key text; v public.events;
begin
  if jsonb_typeof(p_event) is distinct from 'object' or not p_event ?& fields
    or p_event - (fields || array['map_icon_version_id']) <> '{}'::jsonb then
    raise exception 'EVENT_DRAFT_INVALID';
  end if;
  foreach key in array fields loop
    if key in ('latitude','longitude','capacity') then
      if jsonb_typeof(p_event->key) not in ('number','null') then raise exception 'EVENT_DRAFT_INVALID'; end if;
    elsif key in ('timezone','country_code','admission_type') then
      if jsonb_typeof(p_event->key) <> 'string' then raise exception 'EVENT_DRAFT_INVALID'; end if;
    elsif jsonb_typeof(p_event->key) not in ('string','null') then raise exception 'EVENT_DRAFT_INVALID';
    end if;
  end loop;
  if p_event ? 'map_icon_version_id' and jsonb_typeof(p_event->'map_icon_version_id') not in ('string','null') then
    raise exception 'EVENT_DRAFT_INVALID';
  end if;
  if jsonb_typeof(p_event->'capacity')='number' and
    ((p_event->>'capacity')::numeric <> trunc((p_event->>'capacity')::numeric)
      or (p_event->>'capacity')::numeric not between 1 and 2147483647) then raise exception 'EVENT_DRAFT_INVALID'; end if;
  select * into v from jsonb_populate_record(null::public.events,p_event);
  return v;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception 'EVENT_DRAFT_INVALID';
end $$;

create function public.save_owned_event_draft(
  p_event_id uuid, p_event jsonb, p_expected_updated_at timestamptz, p_request_id uuid
) returns public.events language plpgsql security definer set search_path = '' as $$
declare v public.events; next_event public.events; request private.event_draft_requests; payload_hash text;
begin
  if auth.uid() is null or not exists(select 1 from public.organizers where id=auth.uid()) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if p_request_id is null then raise exception 'EVENT_DRAFT_INVALID'; end if;
  next_event := private.parse_event_draft_payload(p_event);
  if p_event_id is null then
    payload_hash := encode(extensions.digest(p_event::text,'sha256'),'hex');
    perform pg_advisory_xact_lock(hashtextextended('event-draft:'||auth.uid()||':'||p_request_id,0));
    select * into request from private.event_draft_requests
      where organizer_id=auth.uid() and request_id=p_request_id;
    if found then
      if request.payload_sha256 <> payload_hash then raise exception 'EVENT_DRAFT_REQUEST_CONFLICT'; end if;
      select * into strict v from public.events where id=request.event_id and organizer_id=auth.uid();
      return v;
    end if;
    perform private.validate_event_map_icon_assignment(null,next_event.map_icon_version_id);
    insert into public.events(organizer_id,title,description,category,starts_at,ends_at,timezone,
      venue_name,address_line1,address_line2,city,region,postal_code,country_code,mapbox_feature_id,
      latitude,longitude,admission_type,capacity,map_icon_version_id)
    values(auth.uid(),next_event.title,next_event.description,next_event.category,next_event.starts_at,next_event.ends_at,
      next_event.timezone,next_event.venue_name,next_event.address_line1,next_event.address_line2,next_event.city,
      next_event.region,next_event.postal_code,next_event.country_code,next_event.mapbox_feature_id,
      next_event.latitude,next_event.longitude,next_event.admission_type,next_event.capacity,next_event.map_icon_version_id)
    returning * into v;
    insert into private.event_draft_requests values(auth.uid(),p_request_id,payload_hash,v.id);
  else
    if not exists(select 1 from public.events where id=p_event_id and organizer_id=auth.uid()) then raise exception 'EVENT_NOT_FOUND'; end if;
    perform public.lock_event_ticketing_operation(p_event_id);
    perform id from public.ticket_tiers where event_id=p_event_id order by id for update;
    select * into v from public.events where id=p_event_id and organizer_id=auth.uid() for update;
    if not found then raise exception 'EVENT_NOT_FOUND'; end if;
    if v.status <> 'draft' then raise exception 'EVENT_NOT_EDITABLE'; end if;
    if p_expected_updated_at is null or v.updated_at is distinct from p_expected_updated_at then raise exception 'EVENT_DRAFT_CONFLICT'; end if;
    if not p_event ? 'map_icon_version_id' then next_event.map_icon_version_id := v.map_icon_version_id; end if;
    perform private.validate_event_map_icon_assignment(v.map_icon_version_id,next_event.map_icon_version_id);
    update public.events set title=next_event.title,description=next_event.description,category=next_event.category,
      starts_at=next_event.starts_at,ends_at=next_event.ends_at,timezone=next_event.timezone,
      venue_name=next_event.venue_name,address_line1=next_event.address_line1,address_line2=next_event.address_line2,
      city=next_event.city,region=next_event.region,postal_code=next_event.postal_code,country_code=next_event.country_code,
      mapbox_feature_id=next_event.mapbox_feature_id,latitude=next_event.latitude,longitude=next_event.longitude,
      admission_type=next_event.admission_type,capacity=next_event.capacity,map_icon_version_id=next_event.map_icon_version_id
    where id=p_event_id returning * into v;
  end if;
  return v;
exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'EVENT_DRAFT_INVALID';
end $$;

create function public.get_owned_event_map_icon(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.events; v private.map_icon_versions; label text;
begin
  select * into e from public.events where id=p_event_id and organizer_id=auth.uid();
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if e.map_icon_version_id is null then
    return jsonb_build_object('versionId',null,'name','Default','state','default','descriptor',null);
  end if;
  select * into strict v from private.map_icon_versions where id=e.map_icon_version_id;
  select display_name into label from private.map_icons where id=v.icon_id;
  return jsonb_build_object('versionId',v.id,'name',label,'state',v.state,
    'descriptor',case when v.state in ('published','retired') then private.map_icon_descriptor(v) else null end);
end $$;

revoke all on function private.validate_event_map_icon_assignment(uuid,uuid),private.parse_event_draft_payload(jsonb),
  public.save_owned_event_draft(uuid,jsonb,timestamptz,uuid),public.get_owned_event_map_icon(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.save_owned_event_draft(uuid,jsonb,timestamptz,uuid),public.get_owned_event_map_icon(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
