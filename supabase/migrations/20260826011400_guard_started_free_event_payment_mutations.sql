alter function public.save_ticket_tiers(uuid, jsonb)
rename to save_ticket_tiers_without_active_free_guard;

create function public.save_ticket_tiers(
  p_event_id uuid,
  p_tiers jsonb
)
returns setof public.ticket_tiers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  perform tiers.id
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id
  order by tiers.id
  for update;

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.status = 'published'
    and v_event.admission_type = 'free'
    and (
      v_event.starts_at is null
      or v_event.starts_at <= pg_catalog.clock_timestamp()
    ) then
    raise exception using errcode = 'P0001', message = 'EVENT_TIME_INVALID';
  end if;

  return query
  select tiers.*
  from public.save_ticket_tiers_without_active_free_guard(
    p_event_id,
    p_tiers
  ) as tiers;
end;
$$;

create or replace function public.save_owned_event_revision(
  p_event_id uuid,
  p_event jsonb
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
begin
  if auth.uid() is null
    or not exists (
      select 1
      from public.events as events
      where events.id = p_event_id
        and events.organizer_id = auth.uid()
    ) then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if pg_catalog.jsonb_typeof(p_event) is distinct from 'object'
    or not (p_event ?& array[
      'title', 'description', 'category', 'starts_at', 'ends_at', 'timezone',
      'venue_name', 'address_line1', 'address_line2', 'city', 'region',
      'postal_code', 'country_code', 'mapbox_feature_id', 'latitude',
      'longitude', 'admission_type', 'capacity'
    ]::text[])
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_event) as supplied(key)
      where supplied.key <> all (array[
        'title', 'description', 'category', 'starts_at', 'ends_at', 'timezone',
        'venue_name', 'address_line1', 'address_line2', 'city', 'region',
        'postal_code', 'country_code', 'mapbox_feature_id', 'latitude',
        'longitude', 'admission_type', 'capacity'
      ]::text[])
    )
    or pg_catalog.jsonb_typeof(p_event -> 'title') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'description') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'category') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'starts_at') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'ends_at') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'timezone') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_event -> 'venue_name') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'address_line1') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'address_line2') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'city') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'region') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'postal_code') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'country_code') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_event -> 'mapbox_feature_id') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'latitude') not in ('number', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'longitude') not in ('number', 'null')
    or pg_catalog.jsonb_typeof(p_event -> 'admission_type') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_event -> 'capacity') not in ('number', 'null') then
    raise exception using errcode = 'P0001', message = 'EVENT_REVISION_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  perform tiers.id
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id
  order by tiers.id
  for update;

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.status = 'published'
    and v_event.admission_type = 'free'
    and p_event ->> 'admission_type' = 'paid'
    and (
      v_event.starts_at is null
      or v_event.starts_at <= pg_catalog.clock_timestamp()
    ) then
    raise exception using errcode = 'P0001', message = 'EVENT_TIME_INVALID';
  end if;

  return public.save_owned_event_revision_without_value_validation(
    p_event_id,
    p_event
  );
end;
$$;

revoke all on function public.save_ticket_tiers_without_active_free_guard(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.save_ticket_tiers(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.save_owned_event_revision(uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.save_ticket_tiers(uuid, jsonb)
to authenticated;
grant execute on function public.save_owned_event_revision(uuid, jsonb)
to authenticated;
