-- Default OFF. This is a server-operated testing aid, not moderation approval.
-- Enabling/disabling changes no events or jobs. The next eligible draft edit
-- retires its old jobs normally. Disabling resumes normal review on future edits;
-- already published content is not retroactively re-reviewed by this switch.
create table private.moderation_testing_settings (
  singleton_id boolean primary key default true check (singleton_id),
  skip_contextual_moderation_for_testing boolean not null default false
);
insert into private.moderation_testing_settings (singleton_id) values (true);
create table private.moderation_testing_setting_changes (
  id uuid primary key default gen_random_uuid(),
  previous_enabled boolean not null,
  enabled boolean not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  database_session_user text not null,
  changed_at timestamptz not null default clock_timestamp()
);
alter table private.moderation_testing_settings enable row level security;
alter table private.moderation_testing_setting_changes enable row level security;
revoke all on private.moderation_testing_settings, private.moderation_testing_setting_changes
from public, anon, authenticated, service_role;
create trigger moderation_testing_setting_changes_immutable
before update or delete on private.moderation_testing_setting_changes
for each row execute function private.reject_immutable_moderation_record_change();

create function public.server_set_contextual_moderation_testing_override(p_enabled boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous boolean;
begin
  if p_enabled is null or p_reason is null
    or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'MODERATION_TESTING_REASON_REQUIRED';
  end if;
  -- Never enable a testing bypass against a configured production policy pair.
  if p_enabled and exists (
    select 1 from private.organizer_policy_release_settings where environment = 'production'
  ) then
    raise exception using errcode = 'P0001', message = 'MODERATION_TESTING_PRODUCTION_FORBIDDEN';
  end if;
  select skip_contextual_moderation_for_testing into strict v_previous
  from private.moderation_testing_settings where singleton_id for update;
  update private.moderation_testing_settings
  set skip_contextual_moderation_for_testing = p_enabled where singleton_id;
  insert into private.moderation_testing_setting_changes
    (previous_enabled, enabled, reason, database_session_user)
  values (v_previous, p_enabled, btrim(p_reason), session_user);
end;
$$;
revoke all on function public.server_set_contextual_moderation_testing_override(boolean, text)
from public, anon, authenticated, service_role;
grant execute on function public.server_set_contextual_moderation_testing_override(boolean, text) to service_role;

-- Preserve all validation, locks, invalidation, real revision hashes and audit
-- actions. Only eligible never-public drafts may defer automatic contextual work.
do $testing_override$
declare
  v_definition text;
  v_anchor text := '  update private.event_moderation_evaluations as evaluations';
  v_patch text := $patch$
  if v_event.status = 'draft'
    and v_event.public_history_status = 'never_public'
    and exists (
      select 1 from private.moderation_testing_settings as settings
      where settings.singleton_id and settings.skip_contextual_moderation_for_testing
    )
    and not exists (
      select 1 from private.organizer_policy_release_settings where environment = 'production'
    )
    and not exists (
      select 1 from private.event_reports where event_id = p_event_id and status = 'open'
    )
    and not exists (
      select 1 from private.moderation_review_requests where event_id = p_event_id and status = 'open'
    )
    and (
      v_previous_status = 'not_evaluated'
      or (v_previous_status = 'clear' and p_change_kind = 'full_review')
      or (v_previous_status = 'under_review' and exists (
        select 1 from private.event_moderation_actions as actions
        left join private.event_moderation_evaluations as evaluations on evaluations.id = actions.evaluation_id
        where actions.event_id = p_event_id
          and actions.content_revision = v_event.content_revision
          and actions.moderation_version = v_event.moderation_version
          and actions.actor_type = 'organizer'
          and actions.actor_user_id = p_actor_user_id
          and actions.source = 'edit' and actions.action = 'hold'
          and actions.previous_status in ('not_evaluated', 'clear')
          and actions.new_status = 'under_review'
          and (actions.evaluation_id is null or (
            evaluations.source = 'contextual' and evaluations.status in ('queued', 'processing', 'failed')
          ))
      ) and not exists (
        select 1 from private.event_moderation_actions as actions
        where actions.event_id = p_event_id
          and actions.moderation_version = v_event.moderation_version
          and actions.action in ('hold', 'block', 'remove')
          and (actions.actor_type <> 'organizer' or actions.source <> 'edit')
      ))
    ) then
    v_next_status := 'not_evaluated';
    v_next_moderated_revision := null;
    v_action_name := 'record_revision';
    v_reason_code := 'other';
    v_needs_contextual_evaluation := false;
  end if;

$patch$;
begin
  select pg_catalog.pg_get_functiondef('private.invalidate_event_public_revision(uuid,text,uuid)'::regprocedure) into v_definition;
  if pg_catalog.encode(extensions.digest(v_definition, 'sha256'), 'hex')
    <> 'e20ff4f33f4e1b008432ee6b855ce0e2380106f28e1559258d1ac1bc5481bc66' then
    raise exception using errcode = 'P0001', message = 'MODERATION_TESTING_SOURCE_MISMATCH';
  end if;
  if (char_length(v_definition) - char_length(replace(v_definition, v_anchor, ''))) / char_length(v_anchor) <> 1 then
    raise exception using errcode = 'P0001', message = 'MODERATION_TESTING_ANCHOR_MISMATCH';
  end if;
  execute replace(v_definition, v_anchor, v_patch || v_anchor);
end;
$testing_override$;
