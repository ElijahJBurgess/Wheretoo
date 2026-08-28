create table private.event_legacy_history_resolutions (
  event_id uuid primary key
    references public.events(id) on delete restrict,
  action_id uuid not null unique
    references private.event_moderation_actions(id) on delete restrict,
  resolved_by_user_id uuid not null
    references auth.users(id) on delete restrict,
  resolved_public_history_status text not null,
  evidence_code text not null,
  observed_public_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint event_legacy_history_resolutions_history_check check (
    resolved_public_history_status in ('never_public', 'previously_public')
  ),
  constraint event_legacy_history_resolutions_evidence_check check (
    evidence_code in (
      'legacy_archive_verified_never_public',
      'legacy_archive_verified_public',
      'legacy_server_prior_public'
    )
  ),
  constraint event_legacy_history_resolutions_observed_check check (
    (resolved_public_history_status = 'never_public'
      and evidence_code = 'legacy_archive_verified_never_public'
      and observed_public_at is null)
    or (
      resolved_public_history_status = 'previously_public'
      and evidence_code in ('legacy_archive_verified_public', 'legacy_server_prior_public')
      and observed_public_at is not null
    )
  )
);

create trigger event_legacy_history_resolutions_immutable
before update or delete on private.event_legacy_history_resolutions
for each row execute function private.reject_immutable_moderation_record_change();

revoke all on table private.event_legacy_history_resolutions
from public, anon, authenticated;

create function private.get_active_staff_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select staff_roles.role
  from private.staff_roles
  where staff_roles.user_id = p_user_id
    and staff_roles.active
$$;

create function private.require_active_staff_role(p_require_admin boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_role text;
begin
  if v_actor_id is null then
    raise exception using errcode = 'P0001', message = 'STAFF_ROLE_REQUIRED';
  end if;

  select private.get_active_staff_role(v_actor_id) into v_role;
  if v_role is null then
    raise exception using errcode = 'P0001', message = 'STAFF_ROLE_REQUIRED';
  end if;

  if p_require_admin and v_role <> 'admin' then
    raise exception using errcode = 'P0001', message = 'STAFF_ADMIN_REQUIRED';
  end if;

  return v_role;
end;
$$;

create function public.get_my_staff_role()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.require_active_staff_role(false);
end;
$$;

create function public.list_moderation_queue(p_limit integer)
returns table (
  event_id uuid,
  moderation_status text,
  content_revision bigint,
  input_sha256 text,
  moderation_version bigint,
  public_history_status text,
  queued_evaluation_count bigint,
  oldest_queued_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_staff_role(false);

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'MODERATION_QUEUE_LIMIT_INVALID';
  end if;

  return query
  select
    events.id,
    events.moderation_status,
    events.content_revision,
    private.compute_event_input_sha256(events.id),
    events.moderation_version,
    events.public_history_status,
    count(evaluations.id) filter (
      where evaluations.status in ('queued', 'processing')
    )::bigint,
    min(evaluations.created_at) filter (
      where evaluations.status in ('queued', 'processing')
    )
  from public.events as events
  left join private.event_moderation_evaluations as evaluations
    on evaluations.event_id = events.id
  where events.moderation_status in ('under_review', 'blocked', 'removed')
  group by events.id
  order by
    case events.moderation_status
      when 'under_review' then 0
      when 'blocked' then 1
      else 2
    end,
    min(evaluations.created_at) filter (
      where evaluations.status in ('queued', 'processing')
    ) nulls last,
    events.moderation_updated_at nulls last,
    events.id
  limit p_limit;
end;
$$;

create function public.get_moderation_case(p_event_id uuid)
returns table (
  event_id uuid,
  moderation_status text,
  content_revision bigint,
  input_sha256 text,
  moderation_version bigint,
  public_history_status text,
  first_publicly_eligible_at timestamptz,
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
  select
    events.id,
    events.moderation_status,
    events.content_revision,
    private.compute_event_input_sha256(events.id),
    events.moderation_version,
    events.public_history_status,
    events.first_publicly_eligible_at,
    coalesce(action_history.actions, '[]'::jsonb),
    coalesce(evaluation_history.evaluations, '[]'::jsonb)
  from public.events as events
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', action_rows.id,
        'action', action_rows.action,
        'previous_status', action_rows.previous_status,
        'new_status', action_rows.new_status,
        'reason_code', action_rows.reason_code,
        'internal_note', action_rows.internal_note,
        'created_at', action_rows.created_at,
        'moderation_version', action_rows.moderation_version
      ) order by action_rows.created_at desc, action_rows.id desc
    ) as actions
    from (
      select *
      from private.event_moderation_actions
      where event_moderation_actions.event_id = events.id
      order by event_moderation_actions.created_at desc, event_moderation_actions.id desc
      limit 50
    ) as action_rows
  ) as action_history on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', evaluation_rows.id,
        'content_revision', evaluation_rows.content_revision,
        'status', evaluation_rows.status,
        'source', evaluation_rows.source,
        'outcome', evaluation_rows.outcome,
        'risk_level', evaluation_rows.risk_level,
        'reason_codes', evaluation_rows.reason_codes,
        'failure_code', evaluation_rows.failure_code,
        'created_at', evaluation_rows.created_at,
        'finished_at', evaluation_rows.finished_at
      ) order by evaluation_rows.created_at desc, evaluation_rows.id desc
    ) as evaluations
    from (
      select *
      from private.event_moderation_evaluations
      where event_moderation_evaluations.event_id = events.id
      order by event_moderation_evaluations.created_at desc, event_moderation_evaluations.id desc
      limit 50
    ) as evaluation_rows
  ) as evaluation_history on true
  where events.id = p_event_id;
end;
$$;

create function public.moderate_event(
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
  v_next_version bigint;
  v_action_id uuid;
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_is_eligible boolean;
begin
  v_role := private.require_active_staff_role(false);

  if p_event_id is null
    or p_expected_content_revision is null or p_expected_content_revision < 1
    or p_expected_input_sha256 is null or p_expected_input_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_moderation_version is null or p_expected_moderation_version < 0
    or p_action not in ('hold', 'block', 'remove', 'clear', 'restore')
    or p_reason_code not in (
      'adult_explicit', 'weapons', 'gambling', 'hate_extremism',
      'scam_misleading', 'unsafe_activity', 'location_invalid',
      'age_mismatch', 'disclosure_mismatch', 'user_report',
      'no_violation', 'other'
    ) then
    raise exception using errcode = '22023', message = 'MODERATION_ACTION_INVALID';
  end if;

  if p_internal_note is not null and pg_catalog.char_length(p_internal_note) > 1000 then
    raise exception using errcode = '22023', message = 'MODERATION_NOTE_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

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
    when p_action = 'hold'
      and v_event.moderation_status in ('not_evaluated', 'clear', 'under_review')
      then 'under_review'
    when p_action = 'block'
      and v_event.moderation_status in ('not_evaluated', 'clear', 'under_review')
      and v_event.public_history_status = 'never_public'
      then 'blocked'
    when p_action = 'remove'
      and v_event.moderation_status in ('clear', 'under_review')
      and v_event.public_history_status = 'previously_public'
      then 'removed'
    when p_action = 'clear'
      and (
        v_event.moderation_status in ('not_evaluated', 'under_review')
        or (
          v_event.moderation_status = 'blocked'
          and v_event.public_history_status = 'never_public'
        )
      ) then 'clear'
    when p_action = 'restore'
      and v_event.moderation_status = 'removed'
      and v_event.public_history_status = 'previously_public'
      then 'clear'
    else null
  end;

  if v_next_status is null then
    raise exception using errcode = 'P0001', message = 'MODERATION_TRANSITION_INVALID';
  end if;

  v_next_version := v_event.moderation_version + 1;
  update public.events as events
  set moderation_status = v_next_status,
      moderated_revision = case
        when v_next_status = 'clear' then events.content_revision
        else null
      end,
      moderation_version = v_next_version,
      moderation_updated_at = v_now
  where events.id = v_event.id
    and events.content_revision = p_expected_content_revision
    and events.moderation_version = p_expected_moderation_version;

  if not found then
    raise exception using errcode = 'P0001', message = 'MODERATION_CONFLICT';
  end if;

  update private.event_moderation_evaluations as evaluations
  set status = 'superseded',
      started_at = coalesce(evaluations.started_at, v_now),
      finished_at = v_now,
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
    v_event.public_history_status, v_event.public_history_status,
    p_reason_code, p_internal_note, v_next_version, v_now
  ) returning id into v_action_id;

  v_is_eligible := private.event_meets_public_candidate(v_event.id, v_now);
  perform private.transition_event_public_eligibility(v_event.id, v_is_eligible, v_action_id);

  return v_action_id;
end;
$$;

create function public.resolve_legacy_public_history(
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
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  perform private.require_active_staff_role(true);

  if p_event_id is null
    or p_expected_content_revision is null or p_expected_content_revision < 1
    or p_expected_input_sha256 is null or p_expected_input_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_moderation_version is null or p_expected_moderation_version < 0
    or p_public_history_status not in ('never_public', 'previously_public')
    or p_evidence_code not in (
      'legacy_archive_verified_never_public',
      'legacy_archive_verified_public',
      'legacy_server_prior_public'
    ) then
    raise exception using errcode = '22023', message = 'LEGACY_HISTORY_RESOLUTION_INVALID';
  end if;

  if p_internal_note is not null and pg_catalog.char_length(p_internal_note) > 1000 then
    raise exception using errcode = '22023', message = 'MODERATION_NOTE_INVALID';
  end if;

  if (p_public_history_status = 'never_public'
      and (p_evidence_code <> 'legacy_archive_verified_never_public'
        or p_observed_public_at is not null))
    or (p_public_history_status = 'previously_public'
      and (p_evidence_code not in ('legacy_archive_verified_public', 'legacy_server_prior_public')
        or p_observed_public_at is null
        or p_observed_public_at > v_now)) then
    raise exception using errcode = '22023', message = 'LEGACY_HISTORY_EVIDENCE_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
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
      first_publicly_eligible_at = case
        when p_public_history_status = 'previously_public'
          then p_observed_public_at
        else null
      end,
      moderation_status = 'under_review',
      moderated_revision = null,
      moderation_version = v_next_version,
      moderation_updated_at = v_now
  where events.id = v_event.id
    and events.content_revision = p_expected_content_revision
    and events.moderation_version = p_expected_moderation_version;

  if not found then
    raise exception using errcode = 'P0001', message = 'MODERATION_CONFLICT';
  end if;

  update private.event_moderation_evaluations as evaluations
  set status = 'superseded',
      started_at = coalesce(evaluations.started_at, v_now),
      finished_at = v_now,
      failure_code = coalesce(evaluations.failure_code, 'HUMAN_OR_RESULT_SUPERSEDED')
  where evaluations.event_id = v_event.id
    and evaluations.status in ('queued', 'processing');

  insert into private.event_moderation_actions (
    event_id, content_revision, input_sha256, actor_type, actor_user_id,
    source, action, previous_status, new_status,
    previous_public_history_status, new_public_history_status,
    reason_code, internal_note, moderation_version, created_at
  ) values (
    v_event.id, v_event.content_revision, v_digest, 'admin', v_actor_id,
    'manual', 'resolve_legacy_history', v_event.moderation_status, 'under_review',
    'unknown', p_public_history_status,
    'other', p_internal_note, v_next_version, v_now
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

revoke all on function private.get_active_staff_role(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.require_active_staff_role(boolean)
from public, anon, authenticated, service_role;

revoke all on function public.get_my_staff_role()
from public, anon, authenticated, service_role;
revoke all on function public.list_moderation_queue(integer)
from public, anon, authenticated, service_role;
revoke all on function public.get_moderation_case(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.moderate_event(uuid,bigint,text,bigint,text,text,text)
from public, anon, authenticated, service_role;
revoke all on function public.resolve_legacy_public_history(uuid,bigint,text,bigint,text,text,timestamptz,text)
from public, anon, authenticated, service_role;

grant execute on function public.get_my_staff_role() to authenticated;
grant execute on function public.list_moderation_queue(integer) to authenticated;
grant execute on function public.get_moderation_case(uuid) to authenticated;
grant execute on function public.moderate_event(uuid,bigint,text,bigint,text,text,text) to authenticated;
grant execute on function public.resolve_legacy_public_history(uuid,bigint,text,bigint,text,text,timestamptz,text) to authenticated;
