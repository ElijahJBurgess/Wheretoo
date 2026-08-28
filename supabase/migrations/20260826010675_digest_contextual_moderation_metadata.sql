alter table private.event_moderation_evaluations
  drop constraint event_moderation_evaluations_provider_reference_check,
  drop constraint event_moderation_evaluations_model_version_check;

update private.event_moderation_evaluations
set provider_reference = 'sha256:' || pg_catalog.encode(
  extensions.digest(provider_reference, 'sha256'),
  'hex'
)
where provider_reference is not null
  and provider_reference !~ '^sha256:[a-f0-9]{64}$';

update private.event_moderation_evaluations
set model_version = 'sha256:' || pg_catalog.encode(
  extensions.digest(model_version, 'sha256'),
  'hex'
)
where model_version is not null
  and model_version !~ '^sha256:[a-f0-9]{64}$';

alter table private.event_moderation_evaluations
  add constraint event_moderation_evaluations_provider_reference_check check (
    provider_reference is null
    or provider_reference ~ '^sha256:[a-f0-9]{64}$'
  ),
  add constraint event_moderation_evaluations_model_version_check check (
    model_version is null
    or model_version ~ '^sha256:[a-f0-9]{64}$'
  );

create or replace function public.server_apply_moderation_evaluation(
  p_evaluation_id uuid,
  p_content_revision bigint,
  p_input_sha256 text,
  p_queued_moderation_version bigint,
  p_outcome text,
  p_risk_level text,
  p_reason_codes text[],
  p_provider_reference text,
  p_model_version text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation private.event_moderation_evaluations%rowtype;
  v_event public.events%rowtype;
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_new_status text;
  v_new_version bigint;
  v_reason_code text;
  v_action_id uuid;
  v_is_eligible boolean;
begin
  if p_evaluation_id is null
    or p_content_revision is null or p_content_revision < 1
    or p_input_sha256 is null or p_input_sha256 !~ '^[a-f0-9]{64}$'
    or p_queued_moderation_version is null or p_queued_moderation_version < 0
    or p_outcome is null
    or p_outcome not in ('clear_candidate', 'review_required', 'prohibited_candidate')
    or p_risk_level is null
    or p_risk_level not in ('low', 'high')
    or p_reason_codes is null
    or pg_catalog.cardinality(p_reason_codes) < 1
    or pg_catalog.cardinality(p_reason_codes) > 12
    or pg_catalog.array_position(p_reason_codes, null) is not null
    or not p_reason_codes <@ array[
      'adult_explicit', 'weapons', 'gambling', 'hate_extremism',
      'scam_misleading', 'unsafe_activity', 'location_invalid',
      'age_mismatch', 'disclosure_mismatch', 'user_report',
      'no_violation', 'other'
    ]::text[]
    or (
      select pg_catalog.count(*) <> pg_catalog.count(distinct reason_code)
      from pg_catalog.unnest(p_reason_codes) as reason_code
    )
    or (p_outcome = 'clear_candidate' and p_risk_level <> 'low')
    or (p_outcome = 'clear_candidate' and p_reason_codes <> array['no_violation']::text[])
    or (p_outcome <> 'clear_candidate' and p_risk_level <> 'high')
    or (p_outcome <> 'clear_candidate' and 'no_violation' = any(p_reason_codes))
    or (
      p_provider_reference is not null
      and p_provider_reference !~ '^sha256:[a-f0-9]{64}$'
    )
    or (
      p_model_version is not null
      and p_model_version !~ '^sha256:[a-f0-9]{64}$'
    ) then
    raise exception using
      errcode = '22023',
      message = 'MODERATION_RESULT_INVALID';
  end if;

  select evaluations.*
  into v_evaluation
  from private.event_moderation_evaluations as evaluations
  where evaluations.id = p_evaluation_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'MODERATION_EVALUATION_NOT_FOUND';
  end if;

  perform public.lock_event_ticketing_operation(v_evaluation.event_id);

  select events.* into v_event
  from public.events as events
  where events.id = v_evaluation.event_id
  for update;

  select evaluations.* into v_evaluation
  from private.event_moderation_evaluations as evaluations
  where evaluations.id = p_evaluation_id
  for update;

  if v_evaluation.source not in ('contextual', 'report')
    or v_evaluation.content_revision is distinct from p_content_revision
    or v_evaluation.input_sha256 is distinct from p_input_sha256
    or v_evaluation.queued_moderation_version is distinct from p_queued_moderation_version then
    raise exception using errcode = 'P0001', message = 'MODERATION_EVALUATION_CONFLICT';
  end if;

  if v_evaluation.status = 'succeeded' then
    return 'already_applied';
  elsif v_evaluation.status = 'superseded' then
    return 'superseded';
  elsif v_evaluation.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'MODERATION_EVALUATION_CONFLICT';
  end if;

  if v_event.content_revision <> p_content_revision
    or private.compute_event_input_sha256(v_event.id) <> p_input_sha256
    or v_event.moderation_version <> p_queued_moderation_version
    or v_event.moderation_status in ('blocked', 'removed')
    or v_event.public_history_status = 'unknown' then
    update private.event_moderation_evaluations as evaluations
    set status = 'superseded', finished_at = v_now, failure_code = 'STALE_EVALUATION'
    where evaluations.id = p_evaluation_id;
    return 'superseded';
  end if;

  v_new_status := case when p_outcome = 'clear_candidate' then 'clear' else 'under_review' end;
  v_reason_code := case when p_outcome = 'clear_candidate' then 'no_violation' else p_reason_codes[1] end;

  update private.event_moderation_evaluations as evaluations
  set status = 'succeeded', outcome = p_outcome, risk_level = p_risk_level,
      reason_codes = p_reason_codes, provider_reference = p_provider_reference,
      model_version = p_model_version, failure_code = null, finished_at = v_now
  where evaluations.id = p_evaluation_id;

  if v_event.moderation_status = v_new_status and v_new_status = 'clear'
    and v_event.moderated_revision = v_event.content_revision then
    return 'applied';
  end if;

  v_new_version := v_event.moderation_version + 1;
  update public.events as events
  set moderation_status = v_new_status,
      moderated_revision = case when v_new_status = 'clear' then events.content_revision else null end,
      moderation_version = v_new_version, moderation_updated_at = v_now
  where events.id = v_event.id and events.content_revision = p_content_revision
    and events.moderation_version = p_queued_moderation_version;
  if not found then
    raise exception using errcode = 'P0001', message = 'MODERATION_EVALUATION_CONFLICT';
  end if;

  update private.event_moderation_evaluations as evaluations
  set status = 'superseded', started_at = coalesce(evaluations.started_at, v_now),
      finished_at = v_now,
      failure_code = coalesce(evaluations.failure_code, 'HUMAN_OR_RESULT_SUPERSEDED')
  where evaluations.event_id = v_event.id and evaluations.id <> p_evaluation_id
    and evaluations.status in ('queued', 'processing');

  insert into private.event_moderation_actions (
    event_id, content_revision, input_sha256, actor_type, source, action,
    previous_status, new_status, previous_public_history_status,
    new_public_history_status, reason_code, evaluation_id,
    moderation_version, created_at
  ) values (
    v_event.id, v_event.content_revision, p_input_sha256, 'system', 'evaluation',
    case when v_new_status = 'clear' then 'clear' else 'hold' end,
    v_event.moderation_status, v_new_status, v_event.public_history_status,
    v_event.public_history_status, v_reason_code, p_evaluation_id, v_new_version, v_now
  ) returning id into v_action_id;

  v_is_eligible := private.event_meets_public_candidate(v_event.id, v_now);
  perform private.transition_event_public_eligibility(v_event.id, v_is_eligible, v_action_id);
  return 'applied';
end;
$$;
