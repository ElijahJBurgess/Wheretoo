alter table private.organizer_policy_versions
  add column stage text not null,
  add constraint organizer_policy_versions_stage_check check (
    stage in ('development_placeholder', 'production_approved')
  ),
  add constraint organizer_policy_versions_stage_identifier_check check (
    (
      stage = 'development_placeholder'
      and id ~ '^dev-[a-z0-9][a-z0-9-]*$'
    )
    or (
      stage = 'production_approved'
      and id = btrim(id)
      and id !~ '^dev-'
    )
  ),
  add constraint organizer_policy_versions_stage_url_check check (
    (
      stage = 'development_placeholder'
      and public_url ~ '^/[a-z0-9][a-z0-9/_-]*$'
    )
    or (
      stage = 'production_approved'
      and public_url = btrim(public_url)
      and public_url ~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~:/-]*)?$'
    )
  );

create table private.organizer_policy_release_settings (
  singleton_id boolean primary key default true,
  environment text not null default 'unconfigured',
  updated_at timestamptz not null default now(),
  constraint organizer_policy_release_settings_singleton_check check (singleton_id),
  constraint organizer_policy_release_settings_environment_check check (
    environment in ('unconfigured', 'development', 'production')
  )
);

insert into private.organizer_policy_release_settings (
  singleton_id,
  environment
)
values (true, 'unconfigured');

insert into private.organizer_policy_versions (
  id,
  policy_kind,
  stage,
  public_url,
  content_sha256,
  effective_at
)
values
  (
    'dev-organizer-terms-v1',
    'organizer_terms',
    'development_placeholder',
    '/organizer-terms',
    '5adc8a233232f30a58152a663394ce01d0af29ddbff8401bdad7f836ee49d475',
    '2026-08-26 00:00:00+00'
  ),
  (
    'dev-event-policy-v1',
    'event_policy',
    'development_placeholder',
    '/event-policy',
    '797aa818b4e7ee9b1d9eb8e7b5b4dba013616080cdf09ccf33875c9a81429de3',
    '2026-08-26 00:00:00+00'
  );

insert into private.organizer_policy_requirements (
  policy_kind,
  policy_version_id
)
values
  ('organizer_terms', 'dev-organizer-terms-v1'),
  ('event_policy', 'dev-event-policy-v1');

create function private.policy_environment_matches_current_requirements()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with current_pair as (
    select
      count(*) as requirement_count,
      count(distinct versions.id) as distinct_version_count,
      count(*) filter (
        where requirements.policy_kind = 'organizer_terms'
      ) as organizer_terms_count,
      count(*) filter (
        where requirements.policy_kind = 'event_policy'
      ) as event_policy_count,
      bool_and(
        versions.stage = 'development_placeholder'
        and (
          (
            requirements.policy_kind = 'organizer_terms'
            and versions.id = 'dev-organizer-terms-v1'
            and versions.public_url = '/organizer-terms'
            and versions.effective_at = '2026-08-26 00:00:00+00'::timestamptz
            and versions.content_sha256 =
              '5adc8a233232f30a58152a663394ce01d0af29ddbff8401bdad7f836ee49d475'
          )
          or (
            requirements.policy_kind = 'event_policy'
            and versions.id = 'dev-event-policy-v1'
            and versions.public_url = '/event-policy'
            and versions.effective_at = '2026-08-26 00:00:00+00'::timestamptz
            and versions.content_sha256 =
              '797aa818b4e7ee9b1d9eb8e7b5b4dba013616080cdf09ccf33875c9a81429de3'
          )
        )
      ) as all_development,
      bool_and(
        versions.stage = 'production_approved'
        and versions.id = btrim(versions.id)
        and versions.id !~ '^dev-'
        and char_length(versions.id) between 1 and 120
        and versions.public_url = btrim(versions.public_url)
        and versions.public_url ~
          '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~:/-]*)?$'
        and versions.effective_at is not null
        and versions.content_sha256 ~ '^[a-f0-9]{64}$'
      ) as all_production_ready
    from private.organizer_policy_requirements as requirements
    join private.organizer_policy_versions as versions
      on versions.policy_kind = requirements.policy_kind
      and versions.id = requirements.policy_version_id
  )
  select coalesce(
    case settings.environment
      when 'development' then
        current_pair.requirement_count = 2
        and current_pair.distinct_version_count = 2
        and current_pair.organizer_terms_count = 1
        and current_pair.event_policy_count = 1
        and current_pair.all_development
      when 'production' then
        current_pair.requirement_count = 2
        and current_pair.distinct_version_count = 2
        and current_pair.organizer_terms_count = 1
        and current_pair.event_policy_count = 1
        and current_pair.all_production_ready
      else false
    end,
    false
  )
  from private.organizer_policy_release_settings as settings
  cross join current_pair
  where settings.singleton_id;
$$;

create function private.production_policy_configuration_is_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select settings.environment = 'production'
        and private.policy_environment_matches_current_requirements()
      from private.organizer_policy_release_settings as settings
      where settings.singleton_id
    ),
    false
  );
$$;

create function private.configure_policy_environment(p_environment text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_environment text;
  v_requirement_count bigint;
  v_distinct_version_count bigint;
  v_organizer_terms_count bigint;
  v_event_policy_count bigint;
  v_all_development boolean;
  v_all_production_ready boolean;
begin
  if p_environment not in ('development', 'production') then
    raise exception using
      errcode = '22023',
      message = 'POLICY_ENVIRONMENT_INVALID';
  end if;

  select settings.environment
  into v_current_environment
  from private.organizer_policy_release_settings as settings
  where settings.singleton_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'POLICY_ENVIRONMENT_SETTINGS_MISSING';
  end if;

  perform requirements.policy_kind
  from private.organizer_policy_requirements as requirements
  join private.organizer_policy_versions as versions
    on versions.policy_kind = requirements.policy_kind
    and versions.id = requirements.policy_version_id
  order by requirements.policy_kind
  for share of requirements, versions;

  select
    count(*),
    count(distinct versions.id),
    count(*) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    count(*) filter (
      where requirements.policy_kind = 'event_policy'
    ),
    bool_and(
      versions.stage = 'development_placeholder'
      and (
        (
          requirements.policy_kind = 'organizer_terms'
          and versions.id = 'dev-organizer-terms-v1'
          and versions.public_url = '/organizer-terms'
          and versions.effective_at = '2026-08-26 00:00:00+00'::timestamptz
          and versions.content_sha256 =
            '5adc8a233232f30a58152a663394ce01d0af29ddbff8401bdad7f836ee49d475'
        )
        or (
          requirements.policy_kind = 'event_policy'
          and versions.id = 'dev-event-policy-v1'
          and versions.public_url = '/event-policy'
          and versions.effective_at = '2026-08-26 00:00:00+00'::timestamptz
          and versions.content_sha256 =
            '797aa818b4e7ee9b1d9eb8e7b5b4dba013616080cdf09ccf33875c9a81429de3'
        )
      )
    ),
    bool_and(
      versions.stage = 'production_approved'
      and versions.id = btrim(versions.id)
      and versions.id !~ '^dev-'
      and char_length(versions.id) between 1 and 120
      and versions.public_url = btrim(versions.public_url)
      and versions.public_url ~
        '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~:/-]*)?$'
      and versions.effective_at is not null
      and versions.content_sha256 ~ '^[a-f0-9]{64}$'
    )
  into
    v_requirement_count,
    v_distinct_version_count,
    v_organizer_terms_count,
    v_event_policy_count,
    v_all_development,
    v_all_production_ready
  from private.organizer_policy_requirements as requirements
  join private.organizer_policy_versions as versions
    on versions.policy_kind = requirements.policy_kind
    and versions.id = requirements.policy_version_id;

  if p_environment = 'development' then
    if v_requirement_count <> 2
      or v_distinct_version_count <> 2
      or v_organizer_terms_count <> 1
      or v_event_policy_count <> 1
      or v_all_development is not true then
      raise exception using
        errcode = 'P0001',
        message = 'DEVELOPMENT_POLICY_CONFIGURATION_INVALID';
    end if;
  elsif v_requirement_count <> 2
    or v_distinct_version_count <> 2
    or v_organizer_terms_count <> 1
    or v_event_policy_count <> 1
    or v_all_production_ready is not true then
    raise exception using
      errcode = 'P0001',
      message = 'PRODUCTION_POLICY_CONFIGURATION_NOT_READY';
  end if;

  update private.organizer_policy_release_settings as settings
  set
    environment = p_environment,
    updated_at = statement_timestamp()
  where settings.singleton_id;

  return p_environment;
end;
$$;

create function public.get_required_event_policies()
returns table (
  policy_kind text,
  label text,
  version_id text,
  stage text,
  public_url text,
  effective_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    versions.policy_kind,
    case versions.policy_kind
      when 'organizer_terms' then 'Organizer Terms'
      else 'Event Policy'
    end as label,
    versions.id as version_id,
    versions.stage,
    versions.public_url,
    versions.effective_at
  from private.organizer_policy_requirements as requirements
  join private.organizer_policy_versions as versions
    on versions.policy_kind = requirements.policy_kind
    and versions.id = requirements.policy_version_id
  where private.policy_environment_matches_current_requirements()
  order by versions.policy_kind;
$$;

create function public.get_owned_event_requirements(p_event_id uuid)
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

  select encode(
    extensions.digest(
      jsonb_build_object(
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
      )::text,
      'sha256'
    ),
    'hex'
  )
  into strict v_input_sha256
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

create function public.accept_current_event_policies(p_event_id uuid)
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

  select encode(
    extensions.digest(
      jsonb_build_object(
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
      )::text,
      'sha256'
    ),
    'hex'
  )
  into strict v_input_sha256
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

revoke all on table private.organizer_policy_release_settings
from public, anon, authenticated, service_role;

revoke all on function private.policy_environment_matches_current_requirements()
from public, anon, authenticated, service_role;
revoke all on function private.production_policy_configuration_is_ready()
from public, anon, authenticated, service_role;
revoke all on function private.configure_policy_environment(text)
from public, anon, authenticated, service_role;
revoke all on function public.get_required_event_policies()
from public, anon, authenticated, service_role;
revoke all on function public.get_owned_event_requirements(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.accept_current_event_policies(uuid)
from public, anon, authenticated, service_role;

grant usage on schema private to service_role;
grant execute on function private.production_policy_configuration_is_ready()
to service_role;
grant execute on function private.configure_policy_environment(text)
to service_role;
grant execute on function public.get_required_event_policies()
to anon, authenticated;
grant execute on function public.get_owned_event_requirements(uuid)
to authenticated;
grant execute on function public.accept_current_event_policies(uuid)
to authenticated;
