create function public.server_claim_checkout_integrity_fixture_evaluation(
  p_event_id uuid,
  p_fixture_prefix text
)
returns table (
  evaluation_id uuid,
  event_id uuid,
  content_revision bigint,
  input_sha256 text,
  queued_moderation_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_evaluation private.event_moderation_evaluations%rowtype;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_event_id is null
    or p_fixture_prefix is null
    or p_fixture_prefix !~ '^task17_[a-z0-9]{12}$' then
    raise exception using
      errcode = '22023',
      message = 'FIXTURE_MODERATION_INPUT_INVALID';
  end if;

  if not exists (
    select 1
    from private.organizer_policy_release_settings as settings
    where settings.singleton_id
      and settings.environment = 'development'
  ) or not exists (
    select 1
    from private.checkout_runtime_control as controls
    where controls.singleton
      and controls.checkout_creation_enabled = false
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_MODERATION_ENVIRONMENT_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  select events.*
  into v_event
  from public.events as events
  join public.organizers as organizers
    on organizers.id = events.organizer_id
  join auth.users as owner_user
    on owner_user.id = organizers.id
  where events.id = p_event_id
    and organizers.display_name = p_fixture_prefix
    and events.title = p_fixture_prefix || ' transaction'
    and owner_user.email = p_fixture_prefix || '@example.invalid'
    and events.status = 'published'
    and events.moderation_status = 'under_review'
    and events.publicly_authorized_action_id is null
    and not exists (
      select 1
      from private.staff_roles as roles
      where roles.user_id = organizers.id
    )
  for update of events;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_MODERATION_TARGET_INVALID';
  end if;

  begin
    select evaluations.*
    into strict v_evaluation
    from private.event_moderation_evaluations as evaluations
    where evaluations.event_id = v_event.id
      and evaluations.content_revision = v_event.content_revision
      and evaluations.input_sha256 =
        private.compute_event_input_sha256(v_event.id)
      and evaluations.queued_moderation_version = v_event.moderation_version
      and evaluations.status = 'queued'
      and evaluations.source = 'contextual'
      and evaluations.attempt_count < 3
    for update;
  exception
    when no_data_found or too_many_rows then
      raise exception using
        errcode = 'P0001',
        message = 'FIXTURE_MODERATION_TARGET_INVALID';
  end;

  update private.event_moderation_evaluations as evaluations
  set status = 'processing',
      attempt_count = evaluations.attempt_count + 1,
      started_at = v_now,
      finished_at = null,
      failure_code = null
  where evaluations.id = v_evaluation.id
    and evaluations.status = 'queued'
  returning evaluations.* into v_evaluation;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'FIXTURE_MODERATION_TARGET_INVALID';
  end if;

  return query
  values (
    v_evaluation.id,
    v_evaluation.event_id,
    v_evaluation.content_revision,
    v_evaluation.input_sha256,
    v_evaluation.queued_moderation_version
  );
end;
$$;

revoke all on function
  public.server_claim_checkout_integrity_fixture_evaluation(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.server_claim_checkout_integrity_fixture_evaluation(uuid, text)
to service_role;
