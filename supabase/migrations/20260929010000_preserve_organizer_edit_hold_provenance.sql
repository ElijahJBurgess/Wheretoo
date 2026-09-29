-- Repeated owner edits record_revision instead of emitting a new hold. Follow
-- that exact audit chain; never mistake an inherited human/system hold for an
-- organizer-only invalidation. Missing history fails closed.
create function private.event_has_only_organizer_edit_hold(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive current_event as (
    select e.id, e.organizer_id, e.content_revision, e.moderation_version
    from public.events e
    where e.id = p_event_id and e.moderation_status = 'under_review'
  ), edit_chain as (
    select a.content_revision, a.previous_content_revision, a.moderation_version,
      a.action, a.previous_status
    from current_event e
    join private.event_moderation_actions a on a.event_id = e.id
      and a.content_revision = e.content_revision
      and a.moderation_version = e.moderation_version
      and a.input_sha256 = private.compute_event_input_sha256(e.id)
    where a.actor_type = 'organizer' and a.actor_user_id = e.organizer_id
      and a.source = 'edit' and a.new_status = 'under_review'
      and a.action in ('hold', 'record_revision')
      and a.previous_content_revision = a.content_revision - 1
    union all
    select a.content_revision, a.previous_content_revision, a.moderation_version,
      a.action, a.previous_status
    from edit_chain c
    join current_event e on true
    join private.event_moderation_actions a on a.event_id = e.id
      and a.content_revision = c.previous_content_revision
      and a.moderation_version = c.moderation_version - 1
    where c.action = 'record_revision' and c.previous_status = 'under_review'
      and a.actor_type = 'organizer' and a.actor_user_id = e.organizer_id
      and a.source = 'edit' and a.new_status = 'under_review'
      and a.action in ('hold', 'record_revision')
      and a.previous_content_revision = a.content_revision - 1
  )
  select exists (
    select 1 from edit_chain origin cross join current_event e
    where origin.action = 'hold' and origin.previous_status in ('not_evaluated', 'clear')
      and not exists (
        select 1 from private.event_moderation_actions a
        where a.event_id = e.id
          and a.moderation_version between origin.moderation_version and e.moderation_version
          and a.action in ('hold', 'block', 'remove', 'restore', 'clear')
          and not (a.actor_type = 'organizer' and a.actor_user_id = e.organizer_id
            and a.source = 'edit' and a.action = 'hold')
      )
  );
$$;
revoke all on function private.event_has_only_organizer_edit_hold(uuid)
from public, anon, authenticated, service_role;

-- Preserve the canonical publisher byte-for-byte except this additional
-- provenance path. Existing policy, risk, ownership and public interval checks
-- still run under the same locks. Refuse an unexpected predecessor definition.
do $migration$
declare
  definition text := pg_get_functiondef('public.publish_event_without_change_history(uuid)'::regprocedure);
  marker text := '  into v_can_clear_organizer_edit_hold;';
begin
  if (length(definition) - length(replace(definition, marker, ''))) / length(marker) <> 1 then
    raise exception 'PUBLISH_HOLD_GUARD_DEFINITION_CHANGED';
  end if;
  execute replace(definition, marker, marker || E'\n\n  v_can_clear_organizer_edit_hold := v_can_clear_organizer_edit_hold\n    or private.event_has_only_organizer_edit_hold(p_event_id);');
end;
$migration$;
