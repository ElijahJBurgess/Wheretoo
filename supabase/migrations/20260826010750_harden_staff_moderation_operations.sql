create or replace function private.transition_event_public_eligibility(
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
    raise exception using errcode = '22023', message = 'PUBLIC_ELIGIBILITY_TRANSITION_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  if v_event.public_history_status = 'unknown' then
    raise exception using errcode = 'P0001', message = 'EVENT_PUBLIC_HISTORY_UNKNOWN';
  end if;

  select actions.* into v_action
  from private.event_moderation_actions as actions
  where actions.id = p_transition_action_id
    and actions.event_id = p_event_id
    and actions.content_revision = v_event.content_revision
    and actions.input_sha256 = private.compute_event_input_sha256(p_event_id)
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLIC_ELIGIBILITY_ACTION_INVALID';
  end if;

  if p_is_eligible and not private.event_meets_public_candidate(
    p_event_id, pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = 'P0001', message = 'PUBLIC_ELIGIBILITY_CANDIDATE_INVALID';
  end if;

  select intervals.* into v_interval
  from private.event_public_eligibility_intervals as intervals
  where intervals.event_id = p_event_id and intervals.ended_at is null
  for update;
  if not found or v_interval.public_eligibility_version <> v_event.public_eligibility_version then
    raise exception using errcode = 'P0001', message = 'PUBLIC_ELIGIBILITY_INTERVAL_INVALID';
  end if;

  v_next_state := case when p_is_eligible then 'eligible' else 'ineligible' end;
  if v_interval.eligibility_state = v_next_state then
    if p_is_eligible and v_event.public_history_status <> 'previously_public' then
      raise exception using errcode = 'P0001', message = 'PUBLIC_ELIGIBILITY_HISTORY_INVALID';
    end if;
    return false;
  end if;

  v_transition_reason := case
    when v_action.action = 'authorize_publication' then 'policy_authorization'
    when v_action.action = 'clear' and v_action.source = 'publish' then 'publication'
    when v_action.action = 'clear' then 'moderation_restore'
    when v_action.action = 'hold' then 'moderation_hold'
    when v_action.action = 'block' then 'moderation_block'
    when v_action.action = 'remove' then 'moderation_remove'
    when v_action.action = 'restore' then 'moderation_restore'
    when v_action.action = 'record_revision' then 'published_edit'
    when v_action.action = 'resolve_legacy_history' then 'legacy_history_resolution'
    else 'policy_authorization'
  end;
  v_transitioned_at := pg_catalog.clock_timestamp();
  v_next_version := v_event.public_eligibility_version + 1;

  update private.event_public_eligibility_intervals as intervals
  set ended_at = v_transitioned_at, ended_action_id = p_transition_action_id
  where intervals.event_id = p_event_id and intervals.public_eligibility_version = v_event.public_eligibility_version;

  update public.events as events
  set public_eligibility_version = v_next_version,
      public_history_status = case
        when p_is_eligible and events.public_history_status = 'never_public' then 'previously_public'
        else events.public_history_status
      end,
      first_publicly_eligible_at = case
        when p_is_eligible then coalesce(events.first_publicly_eligible_at, v_transitioned_at)
        else events.first_publicly_eligible_at
      end
  where events.id = p_event_id and events.public_eligibility_version = v_event.public_eligibility_version;
  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLIC_ELIGIBILITY_INTERVAL_INVALID';
  end if;

  insert into private.event_public_eligibility_intervals (
    event_id, public_eligibility_version, eligibility_state, started_at,
    started_action_id, transition_reason
  ) values (
    p_event_id, v_next_version, v_next_state, v_transitioned_at,
    p_transition_action_id, v_transition_reason
  );
  return true;
end;
$$;

create or replace function public.moderate_event(
  p_event_id uuid,
  p_expected_content_revision bigint,
  p_expected_input_sha256 text,
  p_expected_moderation_version bigint,
  p_action text,
  p_reason_code text,
  p_internal_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_actor_id uuid := auth.uid();
  v_event public.events%rowtype;
  v_digest text;
  v_next_status text;
  v_next_history text;
  v_next_version bigint;
  v_action_id uuid;
  v_now timestamptz;
  v_is_eligible boolean;
begin
  v_role := private.require_active_staff_role(false);
  if p_event_id is null
    or p_expected_content_revision is null or p_expected_content_revision < 1
    or p_expected_input_sha256 is null or p_expected_input_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_moderation_version is null or p_expected_moderation_version < 0
    or p_action not in ('hold', 'block', 'remove', 'clear', 'restore')
    or p_reason_code not in ('adult_explicit', 'weapons', 'gambling', 'hate_extremism',
      'scam_misleading', 'unsafe_activity', 'location_invalid', 'age_mismatch',
      'disclosure_mismatch', 'user_report', 'no_violation', 'other') then
    raise exception using errcode = '22023', message = 'MODERATION_ACTION_INVALID';
  end if;
  if p_internal_note is not null and pg_catalog.char_length(p_internal_note) > 1000 then
    raise exception using errcode = '22023', message = 'MODERATION_NOTE_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);
  select events.* into v_event from public.events as events
  where events.id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  v_now := pg_catalog.clock_timestamp();
  v_digest := private.compute_event_input_sha256(v_event.id);
  if v_event.content_revision is distinct from p_expected_content_revision
    or v_digest is distinct from p_expected_input_sha256
    or v_event.moderation_version is distinct from p_expected_moderation_version then
    raise exception using errcode = 'P0001', message = 'MODERATION_CONFLICT';
  end if;
  if v_event.public_history_status = 'unknown' then
    raise exception using errcode = 'P0001', message = 'EVENT_PUBLIC_HISTORY_UNKNOWN';
  end if;

  v_next_status := case
    when p_action = 'hold' and v_event.moderation_status in ('not_evaluated', 'clear', 'under_review') then 'under_review'
    when p_action = 'block' and v_event.moderation_status in ('not_evaluated', 'clear', 'under_review') and v_event.public_history_status = 'never_public' then 'blocked'
    when p_action = 'remove' and v_event.moderation_status in ('clear', 'under_review') and v_event.public_history_status = 'previously_public' then 'removed'
    when p_action = 'clear' and (v_event.moderation_status in ('not_evaluated', 'under_review') or (v_event.moderation_status = 'blocked' and v_event.public_history_status = 'never_public')) then 'clear'
    when p_action = 'restore' and v_event.moderation_status = 'removed' and v_event.public_history_status = 'previously_public' then 'clear'
    else null
  end;
  if v_next_status is null then
    raise exception using errcode = 'P0001', message = 'MODERATION_TRANSITION_INVALID';
  end if;

  v_next_version := v_event.moderation_version + 1;
  update public.events as events
  set moderation_status = v_next_status,
      moderated_revision = case when v_next_status = 'clear' then events.content_revision else null end,
      moderation_version = v_next_version,
      moderation_updated_at = v_now
  where events.id = v_event.id and events.content_revision = p_expected_content_revision
    and events.moderation_version = p_expected_moderation_version;
  if not found then
    raise exception using errcode = 'P0001', message = 'MODERATION_CONFLICT';
  end if;

  v_is_eligible := private.event_meets_public_candidate(v_event.id, v_now);
  v_next_history := case
    when v_is_eligible and v_event.public_history_status = 'never_public' then 'previously_public'
    else v_event.public_history_status
  end;
  if v_next_history is distinct from v_event.public_history_status then
    update public.events as events
    set public_history_status = v_next_history,
        first_publicly_eligible_at = coalesce(events.first_publicly_eligible_at, v_now)
    where events.id = v_event.id;
  end if;

  update private.event_moderation_evaluations as evaluations
  set status = 'superseded',
      started_at = coalesce(evaluations.started_at, v_now),
      finished_at = greatest(v_now, coalesce(evaluations.started_at, v_now)),
      failure_code = coalesce(evaluations.failure_code, 'HUMAN_OR_RESULT_SUPERSEDED')
  where evaluations.event_id = v_event.id
    and evaluations.status in ('queued', 'processing');

  insert into private.event_moderation_actions (
    event_id, content_revision, input_sha256, actor_type, actor_user_id,
    source, action, previous_status, new_status,
    previous_public_history_status, new_public_history_status,
    reason_code, internal_note, moderation_version, created_at
  ) values (
    v_event.id, v_event.content_revision, v_digest, v_role, v_actor_id,
    'manual', p_action, v_event.moderation_status, v_next_status,
    v_event.public_history_status, v_next_history,
    p_reason_code, p_internal_note, v_next_version, v_now
  ) returning id into v_action_id;
  perform private.transition_event_public_eligibility(v_event.id, v_is_eligible, v_action_id);
  return v_action_id;
end;
$$;

create or replace function public.resolve_legacy_public_history(
  p_event_id uuid,
  p_expected_content_revision bigint,
  p_expected_input_sha256 text,
  p_expected_moderation_version bigint,
  p_public_history_status text,
  p_evidence_code text,
  p_observed_public_at timestamptz,
  p_internal_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_event public.events%rowtype;
  v_digest text;
  v_next_version bigint;
  v_action_id uuid;
  v_now timestamptz;
begin
  perform private.require_active_staff_role(true);
  if p_event_id is null
    or p_expected_content_revision is null or p_expected_content_revision < 1
    or p_expected_input_sha256 is null or p_expected_input_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_moderation_version is null or p_expected_moderation_version < 0
    or p_public_history_status not in ('never_public', 'previously_public')
    or p_evidence_code not in ('legacy_archive_verified_never_public', 'legacy_archive_verified_public', 'legacy_server_prior_public') then
    raise exception using errcode = '22023', message = 'LEGACY_HISTORY_RESOLUTION_INVALID';
  end if;
  if p_internal_note is not null and pg_catalog.char_length(p_internal_note) > 1000 then
    raise exception using errcode = '22023', message = 'MODERATION_NOTE_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);
  select events.* into v_event from public.events as events
  where events.id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  v_now := pg_catalog.clock_timestamp();
  if (p_public_history_status = 'never_public' and (p_evidence_code <> 'legacy_archive_verified_never_public' or p_observed_public_at is not null))
    or (p_public_history_status = 'previously_public' and (p_evidence_code not in ('legacy_archive_verified_public', 'legacy_server_prior_public') or p_observed_public_at is null or p_observed_public_at > v_now)) then
    raise exception using errcode = '22023', message = 'LEGACY_HISTORY_EVIDENCE_INVALID';
  end if;
  v_digest := private.compute_event_input_sha256(v_event.id);
  if v_event.content_revision is distinct from p_expected_content_revision
    or v_digest is distinct from p_expected_input_sha256
    or v_event.moderation_version is distinct from p_expected_moderation_version then
    raise exception using errcode = 'P0001', message = 'MODERATION_CONFLICT';
  end if;
  if v_event.public_history_status <> 'unknown' then
    raise exception using errcode = 'P0001', message = 'EVENT_PUBLIC_HISTORY_KNOWN';
  end if;
  if v_event.moderation_status <> 'under_review' then
    raise exception using errcode = 'P0001', message = 'LEGACY_HISTORY_STATE_INVALID';
  end if;

  v_next_version := v_event.moderation_version + 1;
  update public.events as events
  set public_history_status = p_public_history_status,
      first_publicly_eligible_at = case when p_public_history_status = 'previously_public' then p_observed_public_at else null end,
      moderation_status = 'under_review', moderated_revision = null,
      moderation_version = v_next_version, moderation_updated_at = v_now
  where events.id = v_event.id and events.content_revision = p_expected_content_revision
    and events.moderation_version = p_expected_moderation_version;
  if not found then
    raise exception using errcode = 'P0001', message = 'MODERATION_CONFLICT';
  end if;

  update private.event_moderation_evaluations as evaluations
  set status = 'superseded',
      started_at = coalesce(evaluations.started_at, v_now),
      finished_at = greatest(v_now, coalesce(evaluations.started_at, v_now)),
      failure_code = coalesce(evaluations.failure_code, 'HUMAN_OR_RESULT_SUPERSEDED')
  where evaluations.event_id = v_event.id and evaluations.status in ('queued', 'processing');

  insert into private.event_moderation_actions (
    event_id, content_revision, input_sha256, actor_type, actor_user_id,
    source, action, previous_status, new_status,
    previous_public_history_status, new_public_history_status,
    reason_code, internal_note, moderation_version, created_at
  ) values (
    v_event.id, v_event.content_revision, v_digest, 'admin', v_actor_id,
    'manual', 'resolve_legacy_history', v_event.moderation_status, 'under_review',
    'unknown', p_public_history_status, 'other', p_internal_note, v_next_version, v_now
  ) returning id into v_action_id;
  insert into private.event_legacy_history_resolutions (
    event_id, action_id, resolved_by_user_id, resolved_public_history_status,
    evidence_code, observed_public_at, created_at
  ) values (
    v_event.id, v_action_id, v_actor_id, p_public_history_status,
    p_evidence_code, p_observed_public_at, v_now
  );
  perform private.transition_event_public_eligibility(v_event.id, false, v_action_id);
  return v_action_id;
end;
$$;

drop function public.get_moderation_case(uuid);

create function public.get_moderation_case(p_event_id uuid)
returns table (
  event_id uuid,
  moderation_status text,
  content_revision bigint,
  input_sha256 text,
  moderation_version bigint,
  public_history_status text,
  first_publicly_eligible_at timestamptz,
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
  disclosures jsonb,
  legacy_resolution jsonb,
  actions jsonb,
  evaluations jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_staff_role(false);
  if p_event_id is null then
    raise exception using errcode = '22023', message = 'EVENT_ID_INVALID';
  end if;
  return query
  select events.id, events.moderation_status, events.content_revision,
    private.compute_event_input_sha256(events.id), events.moderation_version,
    events.public_history_status, events.first_publicly_eligible_at,
    events.title, events.description, events.category, events.starts_at,
    events.ends_at, events.timezone, events.venue_name, events.address_line1,
    events.address_line2, events.city, events.region, events.postal_code,
    events.country_code, events.mapbox_feature_id, events.latitude, events.longitude,
    jsonb_build_object(
      'minimum_age', disclosures.minimum_age,
      'alcohol_present', disclosures.alcohol_present,
      'cannabis_present', disclosures.cannabis_present,
      'explicit_adult_content', disclosures.explicit_adult_content,
      'gambling_present', disclosures.gambling_present,
      'weapons_present', disclosures.weapons_present,
      'high_risk_activity', disclosures.high_risk_activity
    ),
    coalesce(resolution.resolution, '{}'::jsonb),
    coalesce(action_history.actions, '[]'::jsonb),
    coalesce(evaluation_history.evaluations, '[]'::jsonb)
  from public.events as events
  left join private.event_risk_disclosures as disclosures on disclosures.event_id = events.id
  left join lateral (
    select jsonb_build_object(
      'resolved_public_history_status', resolutions.resolved_public_history_status,
      'evidence_code', resolutions.evidence_code,
      'observed_public_at', resolutions.observed_public_at,
      'created_at', resolutions.created_at
    ) as resolution
    from private.event_legacy_history_resolutions as resolutions
    where resolutions.event_id = events.id
  ) as resolution on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', action_rows.id, 'action', action_rows.action,
      'previous_status', action_rows.previous_status, 'new_status', action_rows.new_status,
      'reason_code', action_rows.reason_code, 'internal_note', action_rows.internal_note,
      'created_at', action_rows.created_at, 'moderation_version', action_rows.moderation_version
    ) order by action_rows.created_at desc, action_rows.id desc) as actions
    from (
      select * from private.event_moderation_actions
      where event_moderation_actions.event_id = events.id
      order by event_moderation_actions.created_at desc, event_moderation_actions.id desc
      limit 50
    ) as action_rows
  ) as action_history on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', evaluation_rows.id, 'content_revision', evaluation_rows.content_revision,
      'status', evaluation_rows.status, 'source', evaluation_rows.source,
      'outcome', evaluation_rows.outcome, 'risk_level', evaluation_rows.risk_level,
      'reason_codes', evaluation_rows.reason_codes, 'failure_code', evaluation_rows.failure_code,
      'created_at', evaluation_rows.created_at, 'finished_at', evaluation_rows.finished_at
    ) order by evaluation_rows.created_at desc, evaluation_rows.id desc) as evaluations
    from (
      select * from private.event_moderation_evaluations
      where event_moderation_evaluations.event_id = events.id
      order by event_moderation_evaluations.created_at desc, event_moderation_evaluations.id desc
      limit 50
    ) as evaluation_rows
  ) as evaluation_history on true
  where events.id = p_event_id;
end;
$$;

revoke all on function public.get_moderation_case(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_moderation_case(uuid) to authenticated;
