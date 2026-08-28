do $$
declare
  v_definition text;
  v_rewritten text;
  v_legacy text := 'and events.starts_at > v_now';
  v_canonical text := 'and events.ends_at > v_now';
begin
  select pg_catalog.pg_get_functiondef(
    'private.invalidate_event_public_revision(uuid,text,uuid)'::regprocedure
  )
  into v_definition;

  v_rewritten := pg_catalog.replace(v_definition, v_legacy, v_canonical);
  if v_rewritten = v_definition then
    raise exception using
      errcode = 'P0001',
      message = 'DETERMINISTIC_SCHEDULE_REWRITE_NOT_APPLIED';
  end if;

  execute v_rewritten;
end;
$$;

alter function public.save_owned_event_revision(uuid, jsonb)
rename to save_owned_event_revision_without_value_validation;

create function public.save_owned_event_revision(
  p_event_id uuid,
  p_event jsonb
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
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

  return public.save_owned_event_revision_without_value_validation(
    p_event_id,
    p_event
  );
end;
$$;

alter function public.save_owned_organizer_profile(jsonb)
rename to save_owned_organizer_profile_without_value_validation;

create function public.save_owned_organizer_profile(p_profile jsonb)
returns public.organizers
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not exists (
      select 1
      from public.organizers as organizers
      where organizers.id = auth.uid()
    ) then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_NOT_FOUND';
  end if;

  if pg_catalog.jsonb_typeof(p_profile) is distinct from 'object'
    or not (p_profile ?& array[
      'display_name', 'organizer_type', 'bio', 'website_url', 'base_city',
      'country_code', 'onboarding_completed_at'
    ]::text[])
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_profile) as supplied(key)
      where supplied.key <> all (array[
        'display_name', 'organizer_type', 'bio', 'website_url', 'base_city',
        'country_code', 'onboarding_completed_at'
      ]::text[])
    )
    or pg_catalog.jsonb_typeof(p_profile -> 'display_name') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_profile -> 'organizer_type') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_profile -> 'bio') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_profile -> 'website_url') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_profile -> 'base_city') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_profile -> 'country_code') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_profile -> 'onboarding_completed_at') not in ('string', 'null') then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_PROFILE_INVALID';
  end if;

  return public.save_owned_organizer_profile_without_value_validation(p_profile);
end;
$$;

revoke all on function private.invalidate_event_public_revision(uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.save_owned_event_revision_without_value_validation(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.save_owned_organizer_profile_without_value_validation(jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.save_owned_event_revision(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.save_owned_organizer_profile(jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.save_owned_event_revision(uuid, jsonb)
to authenticated;
grant execute on function public.save_owned_organizer_profile(jsonb)
to authenticated;
