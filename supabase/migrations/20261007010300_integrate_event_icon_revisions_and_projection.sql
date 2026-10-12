-- Forward integration copy of local-only map migration 20260929010100.
-- Preserve main public change-history/context wrappers; adapt their underlying writers.
begin;
-- Forward replacement with explicit bodies preserves the existing revision chain.
create or replace function private.parse_event_revision_payload(p_event jsonb)
returns public.events language plpgsql set search_path = '' as $$
declare v public.events; expected numeric;
begin
  if p_event ? 'map_icon_version_id' and not p_event ? 'expected_content_revision' then raise exception 'EVENT_REVISION_INVALID'; end if;
  if p_event ? 'expected_content_revision' then
    if jsonb_typeof(p_event->'expected_content_revision') is distinct from 'number' then raise exception 'EVENT_REVISION_INVALID'; end if;
    expected := (p_event->>'expected_content_revision')::numeric;
    if expected <> trunc(expected) or expected not between 1 and 9223372036854775807 then raise exception 'EVENT_REVISION_INVALID'; end if;
  end if;
  v := private.parse_event_draft_payload(p_event-'expected_content_revision');
  return v;
exception when others then
  raise exception 'EVENT_REVISION_INVALID';
end $$;

create or replace function public.save_owned_event_revision_without_value_validation(
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
  v_saved_event public.events%rowtype;
  v_title text;
  v_description text;
  v_category text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_timezone text;
  v_venue_name text;
  v_address_line1 text;
  v_address_line2 text;
  v_city text;
  v_region text;
  v_postal_code text;
  v_country_code text;
  v_mapbox_feature_id text;
  v_latitude double precision;
  v_longitude double precision;
  v_admission_type text;
  v_capacity integer;
  v_map_icon_version_id uuid;
  v_full_review_changed boolean;
  v_deterministic_changed boolean;
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

  perform private.parse_event_revision_payload(p_event);

  begin
    select parsed.*
    into
      v_title,
      v_description,
      v_category,
      v_starts_at,
      v_ends_at,
      v_timezone,
      v_venue_name,
      v_address_line1,
      v_address_line2,
      v_city,
      v_region,
      v_postal_code,
      v_country_code,
      v_mapbox_feature_id,
      v_latitude,
      v_longitude,
      v_admission_type,
      v_capacity
    from pg_catalog.jsonb_to_record(p_event) as parsed(
      title text,
      description text,
      category text,
      starts_at timestamptz,
      ends_at timestamptz,
      timezone text,
      venue_name text,
      address_line1 text,
      address_line2 text,
      city text,
      region text,
      postal_code text,
      country_code text,
      mapbox_feature_id text,
      latitude double precision,
      longitude double precision,
      admission_type text,
      capacity integer
    );
  exception when others then
    raise exception using errcode = 'P0001', message = 'EVENT_REVISION_INVALID';
  end;

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

  if not found or v_event.organizer_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.status not in ('draft', 'published') then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_EDITABLE';
  end if;

  if p_event ? 'expected_content_revision' and
    (p_event->>'expected_content_revision')::bigint <> v_event.content_revision then
    raise exception 'EVENT_REVISION_CONFLICT';
  end if;
  v_map_icon_version_id := case when p_event ? 'map_icon_version_id'
    then (p_event->>'map_icon_version_id')::uuid else v_event.map_icon_version_id end;
  perform private.validate_event_map_icon_assignment(v_event.map_icon_version_id,v_map_icon_version_id);

  v_full_review_changed :=
    v_event.title is distinct from v_title
    or v_event.description is distinct from v_description
    or v_event.category is distinct from v_category
    or v_event.venue_name is distinct from v_venue_name;

  v_deterministic_changed :=
    v_event.starts_at is distinct from v_starts_at
    or v_event.ends_at is distinct from v_ends_at
    or v_event.timezone is distinct from v_timezone
    or v_event.address_line1 is distinct from v_address_line1
    or v_event.address_line2 is distinct from v_address_line2
    or v_event.city is distinct from v_city
    or v_event.region is distinct from v_region
    or v_event.postal_code is distinct from v_postal_code
    or v_event.country_code is distinct from v_country_code
    or v_event.mapbox_feature_id is distinct from v_mapbox_feature_id
    or v_event.latitude is distinct from v_latitude
    or v_event.longitude is distinct from v_longitude
    or v_event.admission_type is distinct from v_admission_type
    or v_event.map_icon_version_id is distinct from v_map_icon_version_id;

  begin
    update public.events as events
    set title = v_title,
        description = v_description,
        category = v_category,
        starts_at = v_starts_at,
        ends_at = v_ends_at,
        timezone = v_timezone,
        venue_name = v_venue_name,
        address_line1 = v_address_line1,
        address_line2 = v_address_line2,
        city = v_city,
        region = v_region,
        postal_code = v_postal_code,
        country_code = v_country_code,
        mapbox_feature_id = v_mapbox_feature_id,
        latitude = v_latitude,
        longitude = v_longitude,
        admission_type = v_admission_type,
        capacity = v_capacity,
        map_icon_version_id = v_map_icon_version_id
    where events.id = p_event_id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'EVENT_REVISION_INVALID';
  end;

  if v_full_review_changed then
    perform private.invalidate_event_public_revision(
      p_event_id,
      'full_review',
      auth.uid()
    );
  elsif v_deterministic_changed then
    perform private.invalidate_event_public_revision(
      p_event_id,
      'deterministic_only',
      auth.uid()
    );
  end if;

  select events.*
  into strict v_saved_event
  from public.events as events
  where events.id = p_event_id;

  return v_saved_event;
end;
$$;

create or replace function public.save_owned_event_revision_without_change_history(
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

  perform private.parse_event_revision_payload(p_event);

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

create or replace function private.compute_event_moderation_input(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'title', events.title,
      'description', events.description,
      'category', events.category,
      'venue_name', events.venue_name,
      'starts_at', events.starts_at,
      'ends_at', events.ends_at,
      'timezone', events.timezone,
      'address_line1', events.address_line1,
      'address_line2', events.address_line2,
      'city', events.city,
      'region', events.region,
      'postal_code', events.postal_code,
      'country_code', events.country_code,
      'mapbox_feature_id', events.mapbox_feature_id,
      'latitude', events.latitude,
      'longitude', events.longitude,
      'admission_type', events.admission_type
    ),
    'disclosures', jsonb_build_object(
      'minimum_age', disclosures.minimum_age,
      'alcohol_present', disclosures.alcohol_present,
      'cannabis_present', disclosures.cannabis_present,
      'explicit_adult_content', disclosures.explicit_adult_content,
      'gambling_present', disclosures.gambling_present,
      'weapons_present', disclosures.weapons_present,
      'high_risk_activity', disclosures.high_risk_activity
    ),
    'artwork', jsonb_build_object(
      'path', events.artwork_path,
      'verification_state', case
        when events.artwork_path is null then 'not_present'
        else 'unverified'
      end
    ),
    'ticket_tiers', coalesce(tiers.public_tiers, '[]'::jsonb),
    'organizer_display_name', organizers.display_name
  ) || case when events.map_icon_version_id is null then '{}'::jsonb
    else jsonb_build_object('map_icon',jsonb_build_object(
      'version_id',events.map_icon_version_id,
      'package_hash',(select package_hash from private.map_icon_versions where id=events.map_icon_version_id)
    )) end
  from public.events as events
  join public.organizers as organizers on organizers.id = events.organizer_id
  left join private.event_risk_disclosures as disclosures
    on disclosures.event_id = events.id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'name', ticket_tiers.name,
        'description', ticket_tiers.description
      )
      order by ticket_tiers.id
    ) as public_tiers
    from public.ticket_tiers
    where ticket_tiers.event_id = events.id
  ) as tiers on true
  where events.id = p_event_id;
$$;

-- Output type changes require drop/recreate. No CASCADE: unexpected dependencies abort.
drop function public.get_public_map_events(double precision,double precision,double precision,double precision,timestamptz,timestamptz,text[]);
create function public.get_public_map_events(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_categories text[] default null
)
returns table (
  event_id uuid,
  title text,
  category text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  latitude double precision,
  longitude double precision,
  animation_preset text,
  venue_label text,
  admission_type text,
  minimum_price_minor bigint,
  minimum_age text,
  advisories text[],
  artwork_reference text,
  map_icon_version_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_west is null
    or p_south is null
    or p_east is null
    or p_north is null
    or p_starts_at is null
    or p_ends_at is null
    or p_west < -180
    or p_east > 180
    or p_south < -90
    or p_north > 90
    or p_west >= p_east
    or p_south >= p_north
    or p_starts_at >= p_ends_at
    or p_ends_at > p_starts_at + interval '7 days'
    or p_categories is not null and (
      pg_catalog.cardinality(p_categories) = 0
      or exists (
        select 1
        from pg_catalog.unnest(p_categories) as requested(category)
        where requested.category is null
          or requested.category not in (
            'food_drink', 'music', 'fitness', 'art_culture',
            'shopping', 'community', 'nightlife', 'other'
          )
      )
    ) then
    raise exception using errcode = '22023', message = 'PUBLIC_MAP_QUERY_INVALID';
  end if;

  return query
  select
    events.id,
    events.title,
    events.category,
    events.starts_at,
    events.ends_at,
    events.timezone,
    events.latitude,
    events.longitude,
    events.animation_preset,
    events.venue_name,
    events.admission_type,
    case
      when events.admission_type = 'paid' then prices.minimum_price_minor
      else null::bigint
    end,
    disclosures.minimum_age,
    array_remove(array[
      case when disclosures.alcohol_present then 'alcohol' end,
      case when disclosures.cannabis_present then 'cannabis' end,
      case when disclosures.explicit_adult_content then 'mature_content' end
    ]::text[], null),
    events.artwork_path,
    case when exists(select 1 from private.map_icon_versions v
      cross join private.map_icon_settings s where v.id=events.map_icon_version_id
      and v.state in ('published','retired') and s.singleton and s.rendering_enabled)
      then events.map_icon_version_id else null::uuid end
  from public.events as events
  join private.event_risk_disclosures as disclosures
    on disclosures.event_id = events.id
  left join lateral (
    select min(tiers.unit_amount_minor)::bigint as minimum_price_minor
    from public.ticket_tiers as tiers
    where tiers.event_id = events.id
      and tiers.status = 'active'
  ) as prices on true
  where private.event_is_publicly_eligible(
      events.id,
      pg_catalog.statement_timestamp()
    )
    and events.starts_at < p_ends_at
    and events.ends_at > p_starts_at
    and (p_categories is null or events.category = any(p_categories))
    and extensions.st_intersects(
      events.location,
      extensions.st_makeenvelope(
        p_west, p_south, p_east, p_north, 4326
      )::extensions.geography
    )
    and (
      events.admission_type = 'free'
      or prices.minimum_price_minor is not null
    )
  order by events.starts_at, events.id;
end;
$$;

create or replace function public.get_owned_event_requirements(p_event_id uuid)
returns table (
  minimum_age text,
  alcohol_present boolean,
  cannabis_present boolean,
  explicit_adult_content boolean,
  gambling_present boolean,
  weapons_present boolean,
  high_risk_activity boolean,
  needs_acceptance boolean,
  organizer_terms_label text,
  organizer_terms_version_id text,
  organizer_terms_stage text,
  organizer_terms_url text,
  event_policy_label text,
  event_policy_version_id text,
  event_policy_stage text,
  event_policy_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_event public.events%rowtype;
  v_disclosure private.event_risk_disclosures%rowtype;
  v_environment text;
  v_input_sha256 text;
  v_organizer_terms_version_id text;
  v_organizer_terms_stage text;
  v_organizer_terms_url text;
  v_event_policy_version_id text;
  v_event_policy_stage text;
  v_event_policy_url text;
  v_needs_acceptance boolean;
begin
  if auth.uid() is null
    or not exists (
      select 1
      from public.events as events
      where events.id = p_event_id
        and events.organizer_id = auth.uid()
    ) then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  perform ticket_tiers.id
  from public.ticket_tiers
  where ticket_tiers.event_id = p_event_id
  order by ticket_tiers.id
  for update;

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

  v_actor_user_id := auth.uid();
  if v_actor_user_id is null
    or v_event.organizer_id <> v_actor_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

  select disclosures.*
  into v_disclosure
  from private.event_risk_disclosures as disclosures
  where disclosures.event_id = p_event_id
  for update;

  perform organizers.id
  from public.organizers as organizers
  where organizers.id = v_event.organizer_id
  for share;

  select settings.environment
  into v_environment
  from private.organizer_policy_release_settings as settings
  where settings.singleton_id
  for share;

  if not found or v_environment = 'unconfigured' then
    raise exception using
      errcode = 'P0001',
      message = 'POLICY_ENVIRONMENT_UNCONFIGURED';
  end if;

  perform requirements.policy_kind
  from private.organizer_policy_requirements as requirements
  join private.organizer_policy_versions as versions
    on versions.policy_kind = requirements.policy_kind
    and versions.id = requirements.policy_version_id
  order by requirements.policy_kind
  for share of requirements, versions;

  select
    max(versions.id) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    max(versions.stage) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    max(versions.public_url) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    max(versions.id) filter (
      where requirements.policy_kind = 'event_policy'
    ),
    max(versions.stage) filter (
      where requirements.policy_kind = 'event_policy'
    ),
    max(versions.public_url) filter (
      where requirements.policy_kind = 'event_policy'
    )
  into
    v_organizer_terms_version_id,
    v_organizer_terms_stage,
    v_organizer_terms_url,
    v_event_policy_version_id,
    v_event_policy_stage,
    v_event_policy_url
  from private.organizer_policy_requirements as requirements
  join private.organizer_policy_versions as versions
    on versions.policy_kind = requirements.policy_kind
    and versions.id = requirements.policy_version_id;

  if v_organizer_terms_version_id is null
    or v_event_policy_version_id is null
    or not private.policy_environment_matches_current_requirements() then
    raise exception using
      errcode = 'P0001',
      message = 'POLICY_REQUIREMENTS_INVALID';
  end if;

  v_input_sha256 := private.compute_event_input_sha256(p_event_id);

  v_needs_acceptance := not exists (
    select 1
    from private.event_policy_acceptances as acceptances
    where acceptances.event_id = v_event.id
      and acceptances.organizer_id = v_event.organizer_id
      and acceptances.accepted_by_user_id = v_actor_user_id
      and acceptances.content_revision = v_event.content_revision
      and acceptances.input_sha256 = v_input_sha256
      and acceptances.organizer_terms_version_id =
        v_organizer_terms_version_id
      and acceptances.event_policy_version_id = v_event_policy_version_id
  );

  return query
  values (
    v_disclosure.minimum_age,
    v_disclosure.alcohol_present,
    v_disclosure.cannabis_present,
    v_disclosure.explicit_adult_content,
    v_disclosure.gambling_present,
    v_disclosure.weapons_present,
    v_disclosure.high_risk_activity,
    v_needs_acceptance,
    'Organizer Terms'::text,
    v_organizer_terms_version_id,
    v_organizer_terms_stage,
    v_organizer_terms_url,
    'Event Policy'::text,
    v_event_policy_version_id,
    v_event_policy_stage,
    v_event_policy_url
  );
end;
$$;

create or replace function public.accept_current_event_policies_without_change_history(p_event_id uuid)
returns table (
  minimum_age text,
  alcohol_present boolean,
  cannabis_present boolean,
  explicit_adult_content boolean,
  gambling_present boolean,
  weapons_present boolean,
  high_risk_activity boolean,
  needs_acceptance boolean,
  organizer_terms_label text,
  organizer_terms_version_id text,
  organizer_terms_stage text,
  organizer_terms_url text,
  event_policy_label text,
  event_policy_version_id text,
  event_policy_stage text,
  event_policy_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_event public.events%rowtype;
  v_disclosure private.event_risk_disclosures%rowtype;
  v_environment text;
  v_input_sha256 text;
  v_organizer_terms_version_id text;
  v_organizer_terms_stage text;
  v_organizer_terms_url text;
  v_event_policy_version_id text;
  v_event_policy_stage text;
  v_event_policy_url text;
begin
  if auth.uid() is null
    or not exists (
      select 1
      from public.events as events
      where events.id = p_event_id
        and events.organizer_id = auth.uid()
    ) then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  perform ticket_tiers.id
  from public.ticket_tiers
  where ticket_tiers.event_id = p_event_id
  order by ticket_tiers.id
  for update;

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

  v_actor_user_id := auth.uid();
  if v_actor_user_id is null
    or v_event.organizer_id <> v_actor_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

  select disclosures.*
  into v_disclosure
  from private.event_risk_disclosures as disclosures
  where disclosures.event_id = p_event_id
  for update;

  perform organizers.id
  from public.organizers as organizers
  where organizers.id = v_event.organizer_id
  for share;

  select settings.environment
  into v_environment
  from private.organizer_policy_release_settings as settings
  where settings.singleton_id
  for share;

  if not found or v_environment = 'unconfigured' then
    raise exception using
      errcode = 'P0001',
      message = 'POLICY_ENVIRONMENT_UNCONFIGURED';
  end if;

  perform requirements.policy_kind
  from private.organizer_policy_requirements as requirements
  join private.organizer_policy_versions as versions
    on versions.policy_kind = requirements.policy_kind
    and versions.id = requirements.policy_version_id
  order by requirements.policy_kind
  for share of requirements, versions;

  select
    max(versions.id) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    max(versions.stage) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    max(versions.public_url) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    max(versions.id) filter (
      where requirements.policy_kind = 'event_policy'
    ),
    max(versions.stage) filter (
      where requirements.policy_kind = 'event_policy'
    ),
    max(versions.public_url) filter (
      where requirements.policy_kind = 'event_policy'
    )
  into
    v_organizer_terms_version_id,
    v_organizer_terms_stage,
    v_organizer_terms_url,
    v_event_policy_version_id,
    v_event_policy_stage,
    v_event_policy_url
  from private.organizer_policy_requirements as requirements
  join private.organizer_policy_versions as versions
    on versions.policy_kind = requirements.policy_kind
    and versions.id = requirements.policy_version_id;

  if v_organizer_terms_version_id is null
    or v_event_policy_version_id is null
    or not private.policy_environment_matches_current_requirements() then
    raise exception using
      errcode = 'P0001',
      message = 'POLICY_REQUIREMENTS_INVALID';
  end if;

  v_input_sha256 := private.compute_event_input_sha256(p_event_id);

  insert into private.event_policy_acceptances (
    event_id,
    organizer_id,
    accepted_by_user_id,
    content_revision,
    input_sha256,
    organizer_terms_version_id,
    event_policy_version_id,
    accepted_at
  )
  values (
    v_event.id,
    v_event.organizer_id,
    v_actor_user_id,
    v_event.content_revision,
    v_input_sha256,
    v_organizer_terms_version_id,
    v_event_policy_version_id,
    statement_timestamp()
  )
  on conflict do nothing;

  return query
  values (
    v_disclosure.minimum_age,
    v_disclosure.alcohol_present,
    v_disclosure.cannabis_present,
    v_disclosure.explicit_adult_content,
    v_disclosure.gambling_present,
    v_disclosure.weapons_present,
    v_disclosure.high_risk_activity,
    false,
    'Organizer Terms'::text,
    v_organizer_terms_version_id,
    v_organizer_terms_stage,
    v_organizer_terms_url,
    'Event Policy'::text,
    v_event_policy_version_id,
    v_event_policy_stage,
    v_event_policy_url
  );
end;
$$;

revoke all on function private.parse_event_revision_payload(jsonb),
 public.save_owned_event_revision_without_value_validation(uuid,jsonb),
 public.save_owned_event_revision_without_change_history(uuid,jsonb),
 public.get_public_map_events(double precision,double precision,double precision,double precision,timestamptz,timestamptz,text[])
 from public,anon,authenticated,service_role;
-- Main public history/context wrappers retain their original grants.
revoke all on function public.accept_current_event_policies_without_change_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_map_events(double precision,double precision,double precision,double precision,timestamptz,timestamptz,text[]) to anon,authenticated;
notify pgrst,'reload schema';
commit;
