-- A saved draft may legitimately have no risk-disclosure row yet. This is
-- canonical-input completeness only; publication readiness remains independent.
create or replace function private.event_has_moderation_disclosures(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events as events
    join public.organizers as organizers on organizers.id = events.organizer_id
    join private.event_risk_disclosures as disclosures on disclosures.event_id = events.id
    where events.id = p_event_id
  );
$$;

revoke all on function private.event_has_moderation_disclosures(uuid)
from public, anon, authenticated, service_role;

create or replace function private.invalidate_event_public_revision(
  p_event_id uuid,
  p_change_kind text,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_previous_revision bigint;
  v_previous_status text;
  v_next_revision bigint;
  v_next_moderation_version bigint;
  v_next_status text;
  v_next_moderated_revision bigint;
  v_action_name text;
  v_reason_code text;
  v_input_sha256 text;
  v_evaluation_id uuid;
  v_action_id uuid;
  v_deterministic_valid boolean := false;
  v_deterministic_reason_code text := 'other';
  v_needs_contextual_evaluation boolean := false;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_change_kind not in ('full_review', 'deterministic_only')
    or p_actor_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'EVENT_REVISION_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.organizer_id <> p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if p_change_kind = 'deterministic_only' then
    select
      coalesce(
        events.title is not null
        and pg_catalog.char_length(pg_catalog.btrim(events.title)) between 3 and 120
        and events.description is not null
        and pg_catalog.char_length(pg_catalog.btrim(events.description)) between 20 and 5000
        and events.category is not null
        and events.starts_at is not null
        and events.ends_at is not null
        and events.starts_at > v_now
        and events.ends_at > events.starts_at
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
        ),
        false
      ),
      case
        when events.address_line1 is null
          or events.address_line1 !~ '[^[:space:]]'
          or events.city is null
          or events.city !~ '[^[:space:]]'
          or events.region is distinct from 'CA'
          or events.postal_code is null
          or events.postal_code !~ '[^[:space:]]'
          or events.country_code is distinct from 'US'
          or events.mapbox_feature_id is null
          or events.mapbox_feature_id !~ '[^[:space:]]'
          or events.latitude is null
          or events.longitude is null
          or events.latitude not between 36.8 and 38.9
          or events.longitude not between -123.6 and -121.0
          or events.location is null
          then 'location_invalid'
        when exists (
          select 1
          from private.event_risk_disclosures as disclosures
          where disclosures.event_id = events.id
            and (
              disclosures.cannabis_present
                and disclosures.minimum_age <> '21_plus'
              or disclosures.explicit_adult_content
                and disclosures.minimum_age = 'all_ages'
            )
          ) then 'age_mismatch'
        else 'other'
      end
    into v_deterministic_valid, v_deterministic_reason_code
    from public.events as events
    join public.organizers as organizers on organizers.id = events.organizer_id
    where events.id = p_event_id;
  end if;

  v_previous_revision := v_event.content_revision;
  v_previous_status := v_event.moderation_status;
  v_next_revision := v_previous_revision + 1;
  v_next_moderation_version := v_event.moderation_version + 1;

  if p_change_kind = 'deterministic_only'
    and v_previous_status = 'clear'
    and v_deterministic_valid then
    v_next_status := 'clear';
    v_next_moderated_revision := v_next_revision;
    v_action_name := 'clear';
    v_reason_code := 'no_violation';
  elsif p_change_kind = 'deterministic_only'
    and v_previous_status = 'clear' then
    v_next_status := 'under_review';
    v_next_moderated_revision := null;
    v_action_name := 'hold';
    v_reason_code := v_deterministic_reason_code;
  elsif v_previous_status in ('not_evaluated', 'clear') then
    v_next_status := 'under_review';
    v_next_moderated_revision := null;
    v_action_name := 'hold';
    v_reason_code := 'other';
  else
    v_next_status := v_previous_status;
    v_next_moderated_revision := v_event.moderated_revision;
    v_action_name := 'record_revision';
    v_reason_code := 'other';
  end if;

  v_needs_contextual_evaluation :=
    p_change_kind = 'full_review'
    or (
      p_change_kind = 'deterministic_only'
      and v_previous_status in ('not_evaluated', 'under_review')
    );

  update private.event_moderation_evaluations as evaluations
  set status = 'superseded',
      started_at = coalesce(evaluations.started_at, v_now),
      finished_at = v_now,
      failure_code = coalesce(evaluations.failure_code, 'CONTENT_REVISION_CHANGED')
  where evaluations.event_id = p_event_id
    and evaluations.status in ('queued', 'processing');

  update private.event_reports as reports
  set status = 'superseded',
      resolved_at = v_now
  where reports.event_id = p_event_id
    and reports.status = 'open';

  update private.moderation_review_requests as requests
  set status = 'superseded',
      resolved_at = v_now
  where requests.event_id = p_event_id
    and requests.status = 'open';

  update public.events as events
  set content_revision = v_next_revision,
      moderation_version = v_next_moderation_version,
      moderation_status = v_next_status,
      moderated_revision = v_next_moderated_revision,
      moderation_updated_at = v_now,
      publicly_authorized_revision = null,
      publicly_authorized_action_id = null
  where events.id = p_event_id
    and events.content_revision = v_previous_revision
    and events.moderation_version = v_event.moderation_version;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_REVISION_CONFLICT';
  end if;

  v_input_sha256 := private.compute_event_input_sha256(p_event_id);

  if p_change_kind = 'deterministic_only'
    and v_previous_status = 'clear' then
    insert into private.event_moderation_evaluations (
      event_id,
      content_revision,
      input_sha256,
      queued_moderation_version,
      status,
      source,
      outcome,
      risk_level,
      reason_codes,
      attempt_count,
      created_at,
      started_at,
      finished_at
    )
    values (
      p_event_id,
      v_next_revision,
      v_input_sha256,
      v_next_moderation_version,
      'succeeded',
      'deterministic',
      case when v_deterministic_valid
        then 'clear_candidate' else 'review_required' end,
      case when v_deterministic_valid then 'low' else 'high' end,
      case when v_deterministic_valid
        then array['no_violation']::text[]
        else array[v_deterministic_reason_code]::text[] end,
      1,
      v_now,
      v_now,
      v_now
    )
    returning id into v_evaluation_id;
  elsif v_needs_contextual_evaluation
    and private.event_has_moderation_disclosures(p_event_id) then
    insert into private.event_moderation_evaluations (
      event_id,
      content_revision,
      input_sha256,
      queued_moderation_version,
      status,
      source,
      reason_codes,
      attempt_count,
      created_at
    )
    values (
      p_event_id,
      v_next_revision,
      v_input_sha256,
      v_next_moderation_version,
      'queued',
      'contextual',
      array[]::text[],
      0,
      v_now
    )
    returning id into v_evaluation_id;
  end if;

  insert into private.event_moderation_actions (
    event_id,
    previous_content_revision,
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
    evaluation_id,
    moderation_version,
    created_at
  )
  values (
    p_event_id,
    v_previous_revision,
    v_next_revision,
    v_input_sha256,
    'organizer',
    p_actor_user_id,
    'edit',
    v_action_name,
    v_previous_status,
    v_next_status,
    v_event.public_history_status,
    v_event.public_history_status,
    v_reason_code,
    v_evaluation_id,
    v_next_moderation_version,
    v_now
  )
  returning id into v_action_id;

  perform private.transition_event_public_eligibility(
    p_event_id,
    false,
    v_action_id
  );

  return true;
end;
$$;

revoke all on function private.invalidate_event_public_revision(uuid, text, uuid)
from public, anon, authenticated, service_role;

-- Lock each event before its evaluations and recheck after every relevant lock.
-- Retirement must not clear an event hold or resolve its reports/review requests.
do $$
declare
  v_event_id uuid;
  v_evaluation private.event_moderation_evaluations%rowtype;
  v_now timestamptz;
begin
  for v_event_id in
    select distinct evaluations.event_id
    from private.event_moderation_evaluations as evaluations
    where evaluations.source in ('contextual', 'report')
      and evaluations.status in ('queued', 'processing')
      and not private.event_has_moderation_disclosures(evaluations.event_id)
    order by evaluations.event_id
  loop
    perform public.lock_event_ticketing_operation(v_event_id);
    perform 1 from public.events as events where events.id = v_event_id for update;
    if not found or private.event_has_moderation_disclosures(v_event_id) then
      continue;
    end if;

    for v_evaluation in
      select evaluations.*
      from private.event_moderation_evaluations as evaluations
      where evaluations.event_id = v_event_id
        and evaluations.source in ('contextual', 'report')
        and evaluations.status in ('queued', 'processing')
      order by evaluations.id
      for update
    loop
      if v_evaluation.source not in ('contextual', 'report')
        or v_evaluation.status not in ('queued', 'processing')
        or private.event_has_moderation_disclosures(v_event_id) then
        continue;
      end if;
      -- A claim may have refreshed started_at while this transaction waited.
      v_now := greatest(pg_catalog.clock_timestamp(), v_evaluation.created_at, v_evaluation.started_at);
      update private.event_moderation_evaluations as evaluations
      set status = 'superseded', failure_code = 'INCOMPLETE_MODERATION_INPUT',
          started_at = coalesce(evaluations.started_at, v_now), finished_at = v_now
      where evaluations.id = v_evaluation.id
        and evaluations.source in ('contextual', 'report')
        and evaluations.status in ('queued', 'processing');
    end loop;
  end loop;
end;
$$;

create or replace function public.server_reject_moderation_evaluation_input(
  p_evaluation_id uuid,
  p_event_id uuid,
  p_content_revision bigint,
  p_input_sha256 text,
  p_queued_moderation_version bigint,
  p_attempt_count integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_event public.events%rowtype;
  v_evaluation private.event_moderation_evaluations%rowtype;
  v_now timestamptz;
  v_failure_code text;
begin
  if p_evaluation_id is null or p_event_id is null
    or p_content_revision is null or p_content_revision < 1
    or p_input_sha256 is null or p_input_sha256 !~ '^[a-f0-9]{64}$'
    or p_queued_moderation_version is null or p_queued_moderation_version < 0
    or p_attempt_count is null or p_attempt_count not between 1 and 3 then
    raise exception using errcode = '22023', message = 'MODERATION_REJECTION_INVALID';
  end if;

  -- This unlocked read only chooses the lock target; it confers no authority.
  select evaluations.event_id into v_event_id
  from private.event_moderation_evaluations as evaluations
  where evaluations.id = p_evaluation_id;
  if not found then
    return 'not_found';
  end if;

  perform public.lock_event_ticketing_operation(v_event_id);
  select events.* into v_event from public.events as events
  where events.id = v_event_id for update;
  if not found then
    return 'not_found';
  end if;
  select evaluations.* into v_evaluation
  from private.event_moderation_evaluations as evaluations
  where evaluations.id = p_evaluation_id for update;
  if not found then
    return 'not_found';
  end if;

  if v_evaluation.event_id is distinct from v_event_id
    or v_evaluation.event_id is distinct from p_event_id
    or v_evaluation.source not in ('contextual', 'report')
    or v_evaluation.content_revision is distinct from p_content_revision
    or v_evaluation.input_sha256 is distinct from p_input_sha256
    or v_evaluation.queued_moderation_version is distinct from p_queued_moderation_version
    or v_evaluation.attempt_count is distinct from p_attempt_count then
    return 'conflict';
  end if;
  if v_evaluation.status = 'superseded' then
    return 'superseded';
  elsif v_evaluation.status <> 'processing' then
    return 'conflict';
  end if;

  if v_event.content_revision is distinct from p_content_revision
    or private.compute_event_input_sha256(v_event_id) is distinct from p_input_sha256
    or v_event.moderation_version is distinct from p_queued_moderation_version then
    v_failure_code := 'STALE_EVALUATION';
  elsif private.event_has_moderation_disclosures(v_event_id) then
    -- A disagreement with the worker parser must stay visible and non-destructive.
    return 'schema_disagreement';
  else
    v_failure_code := 'INCOMPLETE_MODERATION_INPUT';
  end if;

  v_now := greatest(pg_catalog.clock_timestamp(), v_evaluation.created_at, v_evaluation.started_at);
  update private.event_moderation_evaluations as evaluations
  set status = 'superseded', failure_code = v_failure_code,
      started_at = coalesce(evaluations.started_at, v_now), finished_at = v_now
  where evaluations.id = p_evaluation_id;
  return 'superseded';
end;
$$;

revoke all on function public.server_reject_moderation_evaluation_input(uuid, uuid, bigint, text, bigint, integer)
from public, anon, authenticated, service_role;
grant execute on function public.server_reject_moderation_evaluation_input(uuid, uuid, bigint, text, bigint, integer)
to service_role;
