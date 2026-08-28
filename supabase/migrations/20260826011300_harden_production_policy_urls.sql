create or replace function private.is_canonical_production_policy_url(p_url text)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_host text;
  v_labels text[];
  v_label text;
begin
  if p_url <> pg_catalog.btrim(p_url)
    or p_url !~ '^https://[a-z0-9.-]+(/[A-Za-z0-9._~:/-]*)$' then
    return false;
  end if;

  v_host := pg_catalog.substring(p_url, '^https://([^/]+)');
  v_labels := pg_catalog.string_to_array(v_host, '.');

  if pg_catalog.char_length(v_host) > 253
    or pg_catalog.cardinality(v_labels) < 2
    or (v_labels[pg_catalog.cardinality(v_labels)] !~ '[a-z]') then
    return false;
  end if;

  foreach v_label in array v_labels loop
    if pg_catalog.char_length(v_label) not between 1 and 63
      or v_label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.is_canonical_production_policy_url(text)
from public, anon, authenticated, service_role;

alter table private.organizer_policy_versions
  drop constraint organizer_policy_versions_stage_url_check,
  add constraint organizer_policy_versions_stage_url_check check (
    (
      stage = 'development_placeholder'
      and public_url ~ '^/[a-z0-9][a-z0-9/_-]*$'
    )
    or (
      stage = 'production_approved'
      and private.is_canonical_production_policy_url(public_url)
    )
  );

create or replace function private.policy_environment_matches_current_requirements()
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
        and private.is_canonical_production_policy_url(versions.public_url)
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

create or replace function private.configure_policy_environment(p_environment text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
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

  perform settings.singleton_id
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
      and private.is_canonical_production_policy_url(versions.public_url)
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

revoke all on function private.configure_policy_environment(text)
from public, anon, authenticated, service_role;
grant execute on function private.configure_policy_environment(text)
to service_role;
