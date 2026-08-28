create function private.compute_event_moderation_input(p_event_id uuid)
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
  )
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

create function private.compute_event_input_sha256(p_event_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      private.compute_event_moderation_input(p_event_id)::text,
      'sha256'
    ),
    'hex'
  );
$$;

create function private.event_meets_public_candidate(
  p_event_id uuid,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select
        p_as_of is not null
        and events.status = 'published'
        and events.published_at is not null
        and events.moderation_status = 'clear'
        and events.moderated_revision = events.content_revision
        and events.publicly_authorized_revision = events.content_revision
        and events.publicly_authorized_action_id is not null
        and events.public_history_status in ('never_public', 'previously_public')
        and events.title is not null
        and pg_catalog.char_length(pg_catalog.btrim(events.title)) between 3 and 120
        and events.description is not null
        and pg_catalog.char_length(pg_catalog.btrim(events.description)) between 20 and 5000
        and events.category is not null
        and events.starts_at is not null
        and events.ends_at is not null
        and events.ends_at > events.starts_at
        and events.ends_at > p_as_of
        and events.address_line1 is not null
        and events.address_line1 ~ '[^[:space:]]'
        and events.city is not null
        and events.city ~ '[^[:space:]]'
        and events.region = 'CA'
        and events.postal_code is not null
        and events.postal_code ~ '[^[:space:]]'
        and events.country_code = 'US'
        and events.mapbox_feature_id is not null
        and events.mapbox_feature_id ~ '[^[:space:]]'
        and events.latitude between 36.8 and 38.9
        and events.longitude between -123.6 and -121.0
        and events.location is not null
        and events.artwork_path is null
        and organizers.display_name is not null
        and organizers.display_name ~ '[^[:space:]]'
        and exists (
          select 1
          from private.event_risk_disclosures as disclosures
          where disclosures.event_id = events.id
            and not (
              disclosures.cannabis_present
              and disclosures.minimum_age <> '21_plus'
            )
            and not (
              disclosures.explicit_adult_content
              and disclosures.minimum_age = 'all_ages'
            )
        )
        and exists (
          select 1
          from private.event_moderation_actions as actions
          where actions.id = events.publicly_authorized_action_id
            and actions.event_id = events.id
            and actions.content_revision = events.content_revision
            and actions.input_sha256 =
              private.compute_event_input_sha256(events.id)
            and actions.action = 'authorize_publication'
            and (
              (
                actions.policy_acceptance_id is not null
                and actions.policy_legacy_exemption_id is null
                and exists (
                  select 1
                  from private.event_policy_acceptances as acceptances
                  join private.organizer_policy_versions as organizer_terms
                    on organizer_terms.id =
                      acceptances.organizer_terms_version_id
                    and organizer_terms.policy_kind = 'organizer_terms'
                  join private.organizer_policy_versions as event_policy
                    on event_policy.id = acceptances.event_policy_version_id
                    and event_policy.policy_kind = 'event_policy'
                  where acceptances.id = actions.policy_acceptance_id
                    and acceptances.event_id = events.id
                    and acceptances.organizer_id = events.organizer_id
                    and acceptances.accepted_by_user_id = actions.actor_user_id
                    and acceptances.content_revision = events.content_revision
                    and acceptances.input_sha256 = actions.input_sha256
                )
              )
              or (
                actions.policy_acceptance_id is null
                and actions.policy_legacy_exemption_id is not null
                and exists (
                  select 1
                  from private.event_policy_legacy_exemptions as exemptions
                  where exemptions.id = actions.policy_legacy_exemption_id
                    and exemptions.event_id = events.id
                    and exemptions.grandfathered_content_revision =
                      events.content_revision
                    and exemptions.input_sha256 = actions.input_sha256
                    and exemptions.reason = 'pre_build_2_5_publication'
                )
              )
            )
        )
      from public.events as events
      join public.organizers as organizers
        on organizers.id = events.organizer_id
      where events.id = p_event_id
    ),
    false
  );
$$;

create function private.transition_event_public_eligibility(
  p_event_id uuid,
  p_is_eligible boolean,
  p_transition_action_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_interval private.event_public_eligibility_intervals%rowtype;
  v_action private.event_moderation_actions%rowtype;
  v_next_version bigint;
  v_next_state text;
  v_transition_reason text;
  v_transitioned_at timestamptz;
begin
  if p_is_eligible is null or p_transition_action_id is null then
    raise exception using
      errcode = '22023',
      message = 'PUBLIC_ELIGIBILITY_TRANSITION_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.public_history_status = 'unknown' then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_PUBLIC_HISTORY_UNKNOWN';
  end if;

  select actions.*
  into v_action
  from private.event_moderation_actions as actions
  where actions.id = p_transition_action_id
    and actions.event_id = p_event_id
    and actions.content_revision = v_event.content_revision
    and actions.input_sha256 = private.compute_event_input_sha256(p_event_id)
  for share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PUBLIC_ELIGIBILITY_ACTION_INVALID';
  end if;

  if p_is_eligible
    and not private.event_meets_public_candidate(
      p_event_id,
      pg_catalog.statement_timestamp()
    ) then
    raise exception using
      errcode = 'P0001',
      message = 'PUBLIC_ELIGIBILITY_CANDIDATE_INVALID';
  end if;

  select intervals.*
  into v_interval
  from private.event_public_eligibility_intervals as intervals
  where intervals.event_id = p_event_id
    and intervals.ended_at is null
  for update;

  if not found
    or v_interval.public_eligibility_version <>
      v_event.public_eligibility_version then
    raise exception using
      errcode = 'P0001',
      message = 'PUBLIC_ELIGIBILITY_INTERVAL_INVALID';
  end if;

  v_next_state := case when p_is_eligible then 'eligible' else 'ineligible' end;

  if v_interval.eligibility_state = v_next_state then
    if p_is_eligible
      and v_event.public_history_status <> 'previously_public' then
      raise exception using
        errcode = 'P0001',
        message = 'PUBLIC_ELIGIBILITY_HISTORY_INVALID';
    end if;
    return false;
  end if;

  v_transition_reason := case
    when v_action.action = 'authorize_publication'
      then 'policy_authorization'
    when v_action.action = 'clear' and v_action.source = 'publish'
      then 'publication'
    when v_action.action = 'clear'
      then 'moderation_restore'
    when v_action.action = 'hold'
      then 'moderation_hold'
    when v_action.action = 'block'
      then 'moderation_block'
    when v_action.action = 'remove'
      then 'moderation_remove'
    when v_action.action = 'restore'
      then 'moderation_restore'
    when v_action.action = 'record_revision'
      then 'published_edit'
    when v_action.action = 'resolve_legacy_history'
      then 'legacy_history_resolution'
    else 'policy_authorization'
  end;

  v_transitioned_at := pg_catalog.statement_timestamp();
  v_next_version := v_event.public_eligibility_version + 1;

  update private.event_public_eligibility_intervals as intervals
  set
    ended_at = v_transitioned_at,
    ended_action_id = p_transition_action_id
  where intervals.event_id = p_event_id
    and intervals.public_eligibility_version =
      v_event.public_eligibility_version
    and intervals.ended_at is null;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PUBLIC_ELIGIBILITY_INTERVAL_INVALID';
  end if;

  update public.events as events
  set
    public_eligibility_version = v_next_version,
    public_history_status = case
      when p_is_eligible then 'previously_public'
      else events.public_history_status
    end,
    first_publicly_eligible_at = case
      when p_is_eligible then coalesce(
        events.first_publicly_eligible_at,
        v_transitioned_at
      )
      else events.first_publicly_eligible_at
    end
  where events.id = p_event_id
    and events.public_eligibility_version =
      v_event.public_eligibility_version;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PUBLIC_ELIGIBILITY_VERSION_CONFLICT';
  end if;

  insert into private.event_public_eligibility_intervals (
    event_id,
    public_eligibility_version,
    eligibility_state,
    started_at,
    started_action_id,
    transition_reason
  )
  values (
    p_event_id,
    v_next_version,
    v_next_state,
    v_transitioned_at,
    p_transition_action_id,
    v_transition_reason
  );

  return true;
end;
$$;

create or replace function public.publish_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_event public.events%rowtype;
  v_disclosure private.event_risk_disclosures%rowtype;
  v_has_disclosure boolean;
  v_organizer_display_name text;
  v_environment text;
  v_requirement_count bigint;
  v_distinct_version_count bigint;
  v_organizer_terms_version_id text;
  v_organizer_terms_stage text;
  v_event_policy_version_id text;
  v_event_policy_stage text;
  v_input_sha256 text;
  v_exact_authorization boolean := false;
  v_policy_acceptance_id uuid;
  v_authorization_action_id uuid;
  v_moderation_action_id uuid;
  v_evaluation_id uuid;
  v_transition_action_id uuid;
  v_target_moderation_version bigint;
  v_text_input text;
  v_reason_codes text[] := array[]::text[];
  v_primary_reason text;
  v_should_hold boolean;
  v_candidate boolean;
begin
  v_actor_user_id := auth.uid();
  if v_actor_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_OWNED';
  end if;

  perform events.id
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = v_actor_user_id;

  if not found then
    if exists (
      select 1
      from public.events as events
      where events.id = p_event_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'EVENT_NOT_OWNED';
    end if;
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
      message = 'EVENT_NOT_OWNED';
  end if;

  select disclosures.*
  into v_disclosure
  from private.event_risk_disclosures as disclosures
  where disclosures.event_id = p_event_id
  for update;
  v_has_disclosure := found;

  select organizers.display_name
  into v_organizer_display_name
  from public.organizers as organizers
  where organizers.id = v_event.organizer_id
  for share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

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
    pg_catalog.count(*),
    pg_catalog.count(distinct versions.id),
    pg_catalog.max(versions.id) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    pg_catalog.max(versions.stage) filter (
      where requirements.policy_kind = 'organizer_terms'
    ),
    pg_catalog.max(versions.id) filter (
      where requirements.policy_kind = 'event_policy'
    ),
    pg_catalog.max(versions.stage) filter (
      where requirements.policy_kind = 'event_policy'
    )
  into
    v_requirement_count,
    v_distinct_version_count,
    v_organizer_terms_version_id,
    v_organizer_terms_stage,
    v_event_policy_version_id,
    v_event_policy_stage
  from private.organizer_policy_requirements as requirements
  join private.organizer_policy_versions as versions
    on versions.policy_kind = requirements.policy_kind
    and versions.id = requirements.policy_version_id;

  if v_requirement_count <> 2
    or v_distinct_version_count <> 2
    or not private.policy_environment_matches_current_requirements()
    or (
      v_environment = 'development'
      and (
        v_organizer_terms_version_id <> 'dev-organizer-terms-v1'
        or v_organizer_terms_stage <> 'development_placeholder'
        or v_event_policy_version_id <> 'dev-event-policy-v1'
        or v_event_policy_stage <> 'development_placeholder'
      )
    )
    or (
      v_environment = 'production'
      and (
        v_organizer_terms_stage <> 'production_approved'
        or v_event_policy_stage <> 'production_approved'
        or not private.production_policy_configuration_is_ready()
      )
    )
    or v_environment not in ('development', 'production') then
    raise exception using
      errcode = 'P0001',
      message = 'POLICY_REQUIREMENTS_INVALID';
  end if;

  if v_event.public_history_status = 'unknown' then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_PUBLIC_HISTORY_UNKNOWN';
  end if;

  v_input_sha256 := private.compute_event_input_sha256(p_event_id);
  if v_input_sha256 is null then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_NOT_FOUND';
  end if;

  select true
  into v_exact_authorization
  from private.event_moderation_actions as actions
  where actions.id = v_event.publicly_authorized_action_id
    and v_event.publicly_authorized_revision = v_event.content_revision
    and actions.event_id = v_event.id
    and actions.content_revision = v_event.content_revision
    and actions.input_sha256 = v_input_sha256
    and actions.action = 'authorize_publication'
    and (
      (
        actions.policy_acceptance_id is not null
        and actions.policy_legacy_exemption_id is null
        and exists (
          select 1
          from private.event_policy_acceptances as acceptances
          join private.organizer_policy_versions as organizer_terms
            on organizer_terms.id = acceptances.organizer_terms_version_id
            and organizer_terms.policy_kind = 'organizer_terms'
          join private.organizer_policy_versions as event_policy
            on event_policy.id = acceptances.event_policy_version_id
            and event_policy.policy_kind = 'event_policy'
          where acceptances.id = actions.policy_acceptance_id
            and acceptances.event_id = v_event.id
            and acceptances.organizer_id = v_event.organizer_id
            and acceptances.accepted_by_user_id = actions.actor_user_id
            and acceptances.content_revision = v_event.content_revision
            and acceptances.input_sha256 = v_input_sha256
        )
      )
      or (
        actions.policy_acceptance_id is null
        and actions.policy_legacy_exemption_id is not null
        and exists (
          select 1
          from private.event_policy_legacy_exemptions as exemptions
          where exemptions.id = actions.policy_legacy_exemption_id
            and exemptions.event_id = v_event.id
            and exemptions.grandfathered_content_revision =
              v_event.content_revision
            and exemptions.input_sha256 = v_input_sha256
            and exemptions.reason = 'pre_build_2_5_publication'
        )
      )
    )
  for share of actions;

  v_exact_authorization := coalesce(v_exact_authorization, false);

  if v_event.status = 'published' and v_exact_authorization then
    v_candidate := private.event_meets_public_candidate(
      p_event_id,
      pg_catalog.statement_timestamp()
    );
    perform private.transition_event_public_eligibility(
      p_event_id,
      v_candidate,
      v_event.publicly_authorized_action_id
    );

    select events.*
    into strict v_event
    from public.events as events
    where events.id = p_event_id;
    return v_event;
  end if;

  if v_event.status not in ('draft', 'published') then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_INCOMPLETE';
  end if;

  if v_event.status = 'draft'
    and v_event.moderation_status in ('blocked', 'removed') then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_MODERATION_BLOCKED';
  end if;

  if not v_has_disclosure then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_DISCLOSURES_REQUIRED';
  end if;

  if v_event.title is null
    or pg_catalog.char_length(pg_catalog.btrim(v_event.title)) not between 3 and 120
    or v_event.description is null
    or pg_catalog.char_length(pg_catalog.btrim(v_event.description)) not between 20 and 5000
    or v_event.category is null
    or v_event.address_line1 is null
    or v_event.address_line1 !~ '[^[:space:]]'
    or v_event.city is null
    or v_event.city !~ '[^[:space:]]'
    or v_event.region is null
    or v_event.postal_code is null
    or v_event.postal_code !~ '[^[:space:]]'
    or v_event.mapbox_feature_id is null
    or v_event.mapbox_feature_id !~ '[^[:space:]]' then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_INCOMPLETE';
  end if;

  if v_event.starts_at is null
    or v_event.ends_at is null
    or v_event.starts_at <= pg_catalog.now()
    or v_event.ends_at <= v_event.starts_at then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_TIME_INVALID';
  end if;

  if v_event.country_code <> 'US'
    or v_event.region <> 'CA'
    or v_event.latitude is null
    or v_event.longitude is null
    or v_event.location is null then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_LOCATION_INVALID';
  end if;

  if v_event.latitude not between 36.8 and 38.9
    or v_event.longitude not between -123.6 and -121.0 then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_OUTSIDE_SERVICE_AREA';
  end if;

  select pg_catalog.lower(
    pg_catalog.concat_ws(
      ' ',
      v_event.title,
      v_event.description,
      v_event.category,
      v_event.venue_name,
      v_organizer_display_name,
      coalesce(
        pg_catalog.string_agg(
          pg_catalog.concat_ws(' ', ticket_tiers.name, ticket_tiers.description),
          ' ' order by ticket_tiers.id
        ),
        ''
      )
    )
  )
  into v_text_input
  from public.ticket_tiers
  where ticket_tiers.event_id = p_event_id;

  if v_disclosure.explicit_adult_content
    or v_text_input ~
      '(^|[^a-z0-9])(nudity|nude|porn|pornography)([^a-z0-9]|$)|explicit[[:space:]-]+(adult|sex|sexual)' then
    v_reason_codes := pg_catalog.array_append(
      v_reason_codes,
      'adult_explicit'
    );
  end if;

  if v_disclosure.gambling_present
    or v_text_input ~
      '(^|[^a-z0-9])(gambling|wagering|sportsbook)([^a-z0-9]|$)|real[[:space:]-]+money[[:space:]-]+(poker|casino)' then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'gambling');
  end if;

  if v_disclosure.weapons_present
    or v_text_input ~
      '(^|[^a-z0-9])(weapon|weapons|firearm|firearms)([^a-z0-9]|$)|gun[[:space:]-]+show' then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'weapons');
  end if;

  if v_disclosure.high_risk_activity
    or v_text_input ~
      'base[[:space:]-]+jumping|skydiving|bungee[[:space:]-]+jumping|street[[:space:]-]+racing|bare[[:space:]-]+knuckle' then
    v_reason_codes := pg_catalog.array_append(
      v_reason_codes,
      'unsafe_activity'
    );
  end if;

  if v_text_input ~
    'white[[:space:]-]+power|neo[[:space:]-]*nazi|nazi[[:space:]-]+rally|extremist[[:space:]-]+recruit' then
    v_reason_codes := pg_catalog.array_append(
      v_reason_codes,
      'hate_extremism'
    );
  end if;

  if v_text_input ~
    'guaranteed[[:space:]-]+returns|get[[:space:]-]+rich[[:space:]-]+quick' then
    v_reason_codes := pg_catalog.array_append(
      v_reason_codes,
      'scam_misleading'
    );
  end if;

  if (
    v_disclosure.cannabis_present
    and v_disclosure.minimum_age <> '21_plus'
  ) or (
    v_disclosure.explicit_adult_content
    and v_disclosure.minimum_age = 'all_ages'
  ) then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'age_mismatch');
  end if;

  if v_event.artwork_path is not null
    and not ('other' = any(v_reason_codes)) then
    v_reason_codes := pg_catalog.array_append(v_reason_codes, 'other');
  end if;

  v_should_hold := pg_catalog.cardinality(v_reason_codes) > 0;
  v_primary_reason := coalesce(v_reason_codes[1], 'no_violation');

  select acceptances.id
  into v_policy_acceptance_id
  from private.event_policy_acceptances as acceptances
  where acceptances.event_id = v_event.id
    and acceptances.organizer_id = v_event.organizer_id
    and acceptances.accepted_by_user_id = v_actor_user_id
    and acceptances.content_revision = v_event.content_revision
    and acceptances.input_sha256 = v_input_sha256
    and acceptances.organizer_terms_version_id =
      v_organizer_terms_version_id
    and acceptances.event_policy_version_id = v_event_policy_version_id
  order by acceptances.accepted_at desc, acceptances.id
  limit 1
  for share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_POLICY_ACCEPTANCE_REQUIRED';
  end if;

  select actions.id
  into v_authorization_action_id
  from private.event_moderation_actions as actions
  where actions.event_id = v_event.id
    and actions.content_revision = v_event.content_revision
    and actions.input_sha256 = v_input_sha256
    and actions.actor_type = 'organizer'
    and actions.actor_user_id = v_actor_user_id
    and actions.source = 'publish'
    and actions.action = 'authorize_publication'
    and actions.policy_acceptance_id = v_policy_acceptance_id
    and actions.policy_legacy_exemption_id is null
  order by actions.created_at, actions.id
  limit 1
  for share;

  if not found then
    insert into private.event_moderation_actions (
      event_id,
      content_revision,
      input_sha256,
      actor_type,
      actor_user_id,
      source,
      action,
      previous_status,
      new_status,
      previous_public_history_status,
      new_public_history_status,
      reason_code,
      policy_acceptance_id,
      moderation_version
    )
    values (
      v_event.id,
      v_event.content_revision,
      v_input_sha256,
      'organizer',
      v_actor_user_id,
      'publish',
      'authorize_publication',
      v_event.moderation_status,
      v_event.moderation_status,
      v_event.public_history_status,
      v_event.public_history_status,
      'no_violation',
      v_policy_acceptance_id,
      v_event.moderation_version
    )
    returning id into v_authorization_action_id;
  end if;

  update public.events as events
  set
    publicly_authorized_revision = events.content_revision,
    publicly_authorized_action_id = v_authorization_action_id
  where events.id = p_event_id
  returning events.* into v_event;

  if v_event.status = 'draft' then
    if v_event.admission_type = 'paid' then
      select activated.*
      into v_event
      from public.activate_paid_sales_locked(p_event_id, true) as activated;
    else
      update public.events as events
      set
        status = 'published',
        published_at = coalesce(
          events.published_at,
          pg_catalog.now()
        )
      where events.id = p_event_id
      returning events.* into v_event;
    end if;
  elsif v_event.admission_type = 'paid'
    and v_event.moderation_status not in ('blocked', 'removed') then
    select activated.*
    into v_event
    from public.activate_paid_sales_locked(p_event_id, false) as activated;
  else
    update public.events as events
    set published_at = coalesce(
      events.published_at,
      pg_catalog.now()
    )
    where events.id = p_event_id
    returning events.* into v_event;
  end if;

  v_transition_action_id := v_authorization_action_id;

  if v_event.moderation_status in ('blocked', 'removed') then
    null;
  elsif v_event.moderation_status = 'under_review' then
    if v_should_hold then
      v_target_moderation_version := v_event.moderation_version;

      select evaluations.id
      into v_evaluation_id
      from private.event_moderation_evaluations as evaluations
      where evaluations.event_id = v_event.id
        and evaluations.content_revision = v_event.content_revision
        and evaluations.input_sha256 = v_input_sha256
        and evaluations.source = 'contextual'
        and evaluations.queued_moderation_version =
          v_target_moderation_version
      order by evaluations.created_at, evaluations.id
      limit 1
      for share;

      if not found then
        insert into private.event_moderation_evaluations (
          event_id,
          content_revision,
          input_sha256,
          queued_moderation_version,
          status,
          source,
          reason_codes
        )
        values (
          v_event.id,
          v_event.content_revision,
          v_input_sha256,
          v_target_moderation_version,
          'queued',
          'contextual',
          v_reason_codes
        )
        returning id into v_evaluation_id;
      end if;

      select actions.id
      into v_moderation_action_id
      from private.event_moderation_actions as actions
      where actions.event_id = v_event.id
        and actions.content_revision = v_event.content_revision
        and actions.input_sha256 = v_input_sha256
        and actions.action = 'hold'
        and actions.new_status = 'under_review'
        and actions.moderation_version = v_target_moderation_version
      order by actions.created_at, actions.id
      limit 1
      for share;

      if not found then
        insert into private.event_moderation_actions (
          event_id,
          content_revision,
          input_sha256,
          actor_type,
          source,
          action,
          previous_status,
          new_status,
          previous_public_history_status,
          new_public_history_status,
          reason_code,
          evaluation_id,
          moderation_version
        )
        values (
          v_event.id,
          v_event.content_revision,
          v_input_sha256,
          'system',
          'publish',
          'hold',
          'under_review',
          'under_review',
          v_event.public_history_status,
          v_event.public_history_status,
          v_primary_reason,
          v_evaluation_id,
          v_target_moderation_version
        )
        returning id into v_moderation_action_id;
      end if;

      v_transition_action_id := v_moderation_action_id;
    end if;
  elsif v_should_hold then
    v_target_moderation_version := v_event.moderation_version + 1;

    select evaluations.id
    into v_evaluation_id
    from private.event_moderation_evaluations as evaluations
    where evaluations.event_id = v_event.id
      and evaluations.content_revision = v_event.content_revision
      and evaluations.input_sha256 = v_input_sha256
      and evaluations.source = 'contextual'
      and evaluations.queued_moderation_version =
        v_target_moderation_version
    order by evaluations.created_at, evaluations.id
    limit 1
    for share;

    if not found then
      insert into private.event_moderation_evaluations (
        event_id,
        content_revision,
        input_sha256,
        queued_moderation_version,
        status,
        source,
        reason_codes
      )
      values (
        v_event.id,
        v_event.content_revision,
        v_input_sha256,
        v_target_moderation_version,
        'queued',
        'contextual',
        v_reason_codes
      )
      returning id into v_evaluation_id;
    end if;

    insert into private.event_moderation_actions (
      event_id,
      content_revision,
      input_sha256,
      actor_type,
      source,
      action,
      previous_status,
      new_status,
      previous_public_history_status,
      new_public_history_status,
      reason_code,
      evaluation_id,
      moderation_version
    )
    values (
      v_event.id,
      v_event.content_revision,
      v_input_sha256,
      'system',
      'publish',
      'hold',
      v_event.moderation_status,
      'under_review',
      v_event.public_history_status,
      v_event.public_history_status,
      v_primary_reason,
      v_evaluation_id,
      v_target_moderation_version
    )
    returning id into v_moderation_action_id;

    update public.events as events
    set
      moderation_status = 'under_review',
      moderated_revision = null,
      moderation_version = v_target_moderation_version,
      moderation_updated_at = pg_catalog.statement_timestamp()
    where events.id = p_event_id
    returning events.* into v_event;

    v_transition_action_id := v_moderation_action_id;
  elsif v_event.moderation_status <> 'clear'
    or v_event.moderated_revision is distinct from v_event.content_revision then
    v_target_moderation_version := v_event.moderation_version + 1;

    insert into private.event_moderation_actions (
      event_id,
      content_revision,
      input_sha256,
      actor_type,
      source,
      action,
      previous_status,
      new_status,
      previous_public_history_status,
      new_public_history_status,
      reason_code,
      moderation_version
    )
    values (
      v_event.id,
      v_event.content_revision,
      v_input_sha256,
      'system',
      'publish',
      'clear',
      v_event.moderation_status,
      'clear',
      v_event.public_history_status,
      case
        when v_event.public_history_status = 'never_public'
          then 'previously_public'
        else v_event.public_history_status
      end,
      'no_violation',
      v_target_moderation_version
    )
    returning id into v_moderation_action_id;

    update public.events as events
    set
      moderation_status = 'clear',
      moderated_revision = events.content_revision,
      moderation_version = v_target_moderation_version,
      moderation_updated_at = pg_catalog.statement_timestamp()
    where events.id = p_event_id
    returning events.* into v_event;

    v_transition_action_id := v_moderation_action_id;
  end if;

  v_candidate := private.event_meets_public_candidate(
    p_event_id,
    pg_catalog.statement_timestamp()
  );
  perform private.transition_event_public_eligibility(
    p_event_id,
    v_candidate,
    v_transition_action_id
  );

  select events.*
  into strict v_event
  from public.events as events
  where events.id = p_event_id;

  return v_event;
end;
$$;

revoke all on function private.compute_event_moderation_input(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.compute_event_input_sha256(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.event_meets_public_candidate(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.transition_event_public_eligibility(uuid, boolean, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.publish_event(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.publish_event(uuid) to authenticated;
