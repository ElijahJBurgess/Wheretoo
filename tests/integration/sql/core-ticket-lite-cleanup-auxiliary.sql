begin;
set local lock_timeout = '10s';
set local statement_timeout = '20s';
lock table public.events, public.organizers, private.event_public_eligibility_intervals in share row exclusive mode;

-- Capture exact disposable IDs before deleting; a partial Auth-only setup is handled by the driver.
create temporary table lite_aux_owner on commit drop as
select o.id from public.organizers o join auth.users u on u.id=o.id
where o.display_name='__TASK17_FIXTURE_PREFIX__' and u.email='__TASK17_FIXTURE_PREFIX__@example.invalid';
create temporary table lite_aux_event on commit drop as
select e.id from public.events e join lite_aux_owner o on o.id=e.organizer_id
where e.title='__TASK17_FIXTURE_PREFIX__ wrong-event';
create temporary table lite_aux_other on commit drop as
select o.id from public.organizers o join auth.users u on u.id=o.id
where o.display_name='__TASK17_FIXTURE_PREFIX__ admission' and u.email='__TASK17_FIXTURE_PREFIX__-admission@example.invalid';

select public.lock_event_ticketing_operation(id) from lite_aux_event order by id;
select id from public.events where id in(select id from lite_aux_event) for update;
select id from auth.users where id in(select id from lite_aux_owner union select id from lite_aux_other) for update;

do $$ begin
  if (select count(*) from lite_aux_owner)>1 or (select count(*) from lite_aux_event)>1 or (select count(*) from lite_aux_other)>1
    or (select count(*) from public.events where title='__TASK17_FIXTURE_PREFIX__ wrong-event')<>(select count(*) from lite_aux_event)
    or (select count(*) from public.organizers where display_name='__TASK17_FIXTURE_PREFIX__ admission')<>(select count(*) from lite_aux_other)
    or exists(select 1 from public.events e join lite_aux_event a on a.id=e.id
      where e.status<>'draft' or e.public_history_status<>'never_public' or e.moderation_status<>'not_evaluated' or e.publicly_authorized_action_id is not null)
    or exists(select 1 from public.orders where event_id in(select id from lite_aux_event) or organizer_id in(select id from lite_aux_other))
    or exists(select 1 from public.ticket_tiers where event_id in(select id from lite_aux_event))
    or exists(select 1 from public.events where organizer_id in(select id from lite_aux_other))
    or exists(select 1 from private.staff_roles where user_id in(select id from lite_aux_other))
    or exists(select 1 from public.organizer_stripe_accounts where organizer_id in(select id from lite_aux_other))
    or exists(select 1 from private.event_moderation_actions where event_id in(select id from lite_aux_event))
    or exists(select 1 from private.event_moderation_evaluations where event_id in(select id from lite_aux_event))
    or exists(select 1 from private.event_reports where event_id in(select id from lite_aux_event))
    or exists(select 1 from private.moderation_review_requests where event_id in(select id from lite_aux_event))
    or exists(select 1 from private.event_policy_acceptances where event_id in(select id from lite_aux_event))
    or exists(select 1 from private.event_policy_legacy_exemptions where event_id in(select id from lite_aux_event))
    or exists(select 1 from private.event_legacy_history_resolutions where event_id in(select id from lite_aux_event))
    or exists(select 1 from private.event_risk_disclosures where event_id in(select id from lite_aux_event))
    or (select count(*) from private.event_public_eligibility_intervals where event_id in(select id from lite_aux_event))<>(select count(*) from lite_aux_event)
    or exists(select 1 from private.event_public_eligibility_intervals where event_id in(select id from lite_aux_event)
      and (public_eligibility_version<>0 or eligibility_state<>'ineligible' or transition_reason<>'initialization' or started_action_id is not null or ended_at is not null))
  then raise exception 'LITE_AUX_CLEANUP_UNSAFE'; end if;
end $$;

-- Only the never-public initialization interval requires bypassing the audit delete guard.
set local session_replication_role=replica;
delete from private.event_public_eligibility_intervals where event_id in(select id from lite_aux_event);
set local session_replication_role=origin;
delete from public.events where id in(select id from lite_aux_event);
delete from public.organizers where id in(select id from lite_aux_other);
do $$ begin
  if exists(select 1 from public.events where id in(select id from lite_aux_event))
    or exists(select 1 from public.organizers where id in(select id from lite_aux_other))
    or exists(select 1 from private.event_public_eligibility_intervals where event_id in(select id from lite_aux_event))
  then raise exception 'LITE_AUX_RESIDUE'; end if;
end $$;
commit;
