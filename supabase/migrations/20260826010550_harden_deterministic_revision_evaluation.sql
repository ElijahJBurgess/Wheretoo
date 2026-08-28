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
  elsif v_needs_contextual_evaluation then
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
