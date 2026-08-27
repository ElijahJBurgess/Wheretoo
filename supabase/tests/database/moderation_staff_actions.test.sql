begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

select has_function('public', 'get_my_staff_role', array[]::text[],
  'staff can read only their own active database role');
select has_function('public', 'list_moderation_queue', array['integer'],
  'staff queue has one bounded server-side interface');
select has_function('public', 'get_moderation_case', array['uuid'],
  'staff case detail has one server-side interface');
select has_function(
  'public', 'moderate_event',
  array['uuid', 'bigint', 'text', 'bigint', 'text', 'text', 'text'],
  'staff state transitions require exact expected facts and a structured action'
);
select has_function(
  'public', 'resolve_legacy_public_history',
  array['uuid', 'bigint', 'text', 'bigint', 'text', 'text', 'timestamp with time zone', 'text'],
  'legacy public history has an evidence-bound admin-only resolution interface'
);

select results_eq(
  $$
    select
      has_function_privilege('anon', 'public.get_my_staff_role()', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.get_my_staff_role()', 'EXECUTE'),
      has_function_privilege('anon', 'public.list_moderation_queue(integer)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.list_moderation_queue(integer)', 'EXECUTE'),
      has_function_privilege('anon', 'public.get_moderation_case(uuid)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.get_moderation_case(uuid)', 'EXECUTE'),
      has_function_privilege('anon', 'public.moderate_event(uuid,bigint,text,bigint,text,text,text)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.moderate_event(uuid,bigint,text,bigint,text,text,text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.resolve_legacy_public_history(uuid,bigint,text,bigint,text,text,timestamp with time zone,text)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.resolve_legacy_public_history(uuid,bigint,text,bigint,text,text,timestamp with time zone,text)', 'EXECUTE')
  $$,
  $$ values (false, true, false, true, false, true, false, true, false, true) $$,
  'only authenticated callers reach the narrow staff RPC boundary'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc
    where oid in (
      'public.get_my_staff_role()'::regprocedure,
      'public.list_moderation_queue(integer)'::regprocedure,
      'public.get_moderation_case(uuid)'::regprocedure,
      'public.moderate_event(uuid,bigint,text,bigint,text,text,text)'::regprocedure,
      'public.resolve_legacy_public_history(uuid,bigint,text,bigint,text,text,timestamp with time zone,text)'::regprocedure
    ) and proconfig @> array['search_path=""']::text[]
  $$,
  $$ values (5::bigint) $$,
  'every browser-reachable staff RPC uses an empty search path'
);

insert into auth.users (id, email) values
  ('18000000-0000-4000-8000-000000000001', 'staff-moderator@example.invalid'),
  ('18000000-0000-4000-8000-000000000002', 'staff-admin@example.invalid'),
  ('18000000-0000-4000-8000-000000000003', 'staff-inactive@example.invalid'),
  ('18000000-0000-4000-8000-000000000004', 'staff-fake-metadata@example.invalid'),
  ('18000000-0000-4000-8000-000000000005', 'staff-owner@example.invalid');

insert into private.staff_roles (user_id, role, active, granted_by) values
  ('18000000-0000-4000-8000-000000000001', 'moderator', true, '18000000-0000-4000-8000-000000000002'),
  ('18000000-0000-4000-8000-000000000002', 'admin', true, '18000000-0000-4000-8000-000000000002'),
  ('18000000-0000-4000-8000-000000000003', 'moderator', false, '18000000-0000-4000-8000-000000000002');

insert into public.organizers (id, display_name, organizer_type, base_city, country_code, onboarding_completed_at)
values ('18000000-0000-4000-8000-000000000005', 'Staff Fixture Organizer', 'Community group', 'San Francisco', 'US', now());

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, timezone, venue_name, address_line1, city, region,
  postal_code, country_code, mapbox_feature_id, latitude, longitude,
  admission_type, capacity, published_at, content_revision, moderated_revision,
  moderation_version, public_history_status, first_publicly_eligible_at
) values
  ('28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005', 'published', 'not_evaluated', 'Hold Fixture', 'A complete staff moderation fixture for a first human hold decision.', 'community', now() + interval '2 days', now() + interval '2 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '1 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-hold', 37.7936, -122.3958, 'free', 100, now(), 1, null, 10, 'never_public', null),
  ('28000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000005', 'published', 'clear', 'Block Fixture', 'A complete staff moderation fixture that has never been publicly eligible.', 'community', now() + interval '3 days', now() + interval '3 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '2 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-block', 37.7936, -122.3958, 'free', 100, now(), 1, 1, 20, 'never_public', null),
  ('28000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000005', 'published', 'under_review', 'Remove Fixture', 'A complete staff moderation fixture formerly available to the public.', 'community', now() + interval '4 days', now() + interval '4 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '3 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-remove', 37.7936, -122.3958, 'free', 100, now(), 1, null, 30, 'previously_public', now() - interval '1 day'),
  ('28000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-000000000005', 'published', 'blocked', 'Clear Fixture', 'A complete staff moderation fixture blocked before public availability.', 'community', now() + interval '5 days', now() + interval '5 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '4 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-clear', 37.7936, -122.3958, 'free', 100, now(), 1, null, 40, 'never_public', null),
  ('28000000-0000-4000-8000-000000000005', '18000000-0000-4000-8000-000000000005', 'published', 'removed', 'Restore Fixture', 'A complete staff moderation fixture removed after public availability.', 'community', now() + interval '6 days', now() + interval '6 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '5 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-restore', 37.7936, -122.3958, 'free', 100, now(), 1, null, 50, 'previously_public', now() - interval '1 day'),
  ('28000000-0000-4000-8000-000000000006', '18000000-0000-4000-8000-000000000005', 'published', 'under_review', 'Unknown Fixture', 'A complete staff moderation fixture with unresolved legacy public evidence.', 'community', now() + interval '7 days', now() + interval '7 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '6 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-unknown', 37.7936, -122.3958, 'free', 100, now(), 1, null, 60, 'unknown', null);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
select id, 'all_ages', false, false, false, false, false, false
from public.events
where id between '28000000-0000-4000-8000-000000000001'::uuid
  and '28000000-0000-4000-8000-000000000006'::uuid;

insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, actor_user_id,
  source, action, previous_status, new_status, previous_public_history_status,
  new_public_history_status, reason_code, moderation_version
) values (
  '48000000-0000-4000-8000-000000000003',
  '28000000-0000-4000-8000-000000000003', 1,
  private.compute_event_input_sha256('28000000-0000-4000-8000-000000000003'),
  'admin', '18000000-0000-4000-8000-000000000002',
  'manual', 'clear', 'under_review', 'clear', 'previously_public',
  'previously_public', 'no_violation', 29
);
update private.event_public_eligibility_intervals
set ended_at = now(), ended_action_id = '48000000-0000-4000-8000-000000000003'
where event_id = '28000000-0000-4000-8000-000000000003'
  and public_eligibility_version = 0;
update public.events
set public_eligibility_version = 1
where id = '28000000-0000-4000-8000-000000000003';
insert into private.event_public_eligibility_intervals (
  event_id, public_eligibility_version, eligibility_state, started_at,
  started_action_id, transition_reason
) values (
  '28000000-0000-4000-8000-000000000003', 1, 'eligible', now(),
  '48000000-0000-4000-8000-000000000003', 'moderation_restore'
);

insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version, status, source
) values
  ('38000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 10, 'queued', 'contextual'),
  ('38000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000006', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'), 60, 'processing', 'report');

grant usage on schema private to authenticated;
grant execute on function private.compute_event_input_sha256(uuid) to authenticated;

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000001', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 10, 'hold', 'other', null) $$,
  'P0001', 'STAFF_ROLE_REQUIRED',
  'fake request metadata cannot grant a staff capability'
);
select throws_ok($$ select * from private.staff_roles $$, '42501', null,
  'authenticated callers cannot read the private staff-role table');
reset role;

-- The production ACL denial is asserted above. These rollback-only fixture
-- grants let later assertions inspect private effects without weakening it.
grant select on private.event_moderation_evaluations,
  private.event_moderation_actions,
  private.event_public_eligibility_intervals to authenticated;

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$ select public.get_my_staff_role() $$,
  'P0001', 'STAFF_ROLE_REQUIRED',
  'an inactive database role has no staff capability'
);
reset role;

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq($$ select public.get_my_staff_role() $$, $$ values ('moderator'::text) $$,
  'an active moderator reads the server-controlled role only');
select throws_ok($$ select * from public.list_moderation_queue(101) $$,
  '22023', 'MODERATION_QUEUE_LIMIT_INVALID',
  'queue limit above the bounded maximum is rejected');
select throws_ok(
  $$ select public.resolve_legacy_public_history('28000000-0000-4000-8000-000000000006', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'), 60, 'never_public', 'legacy_archive_verified_never_public', null, null) $$,
  'P0001', 'STAFF_ADMIN_REQUIRED',
  'a moderator cannot resolve legacy public history'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000001', 2, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 10, 'hold', 'other', null) $$,
  'P0001', 'MODERATION_CONFLICT',
  'a stale content revision conflicts before action insertion'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000001', 1, repeat('f', 64), 10, 'hold', 'other', null) $$,
  'P0001', 'MODERATION_CONFLICT',
  'a stale canonical digest conflicts before action insertion'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000001', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 11, 'hold', 'other', null) $$,
  'P0001', 'MODERATION_CONFLICT',
  'a stale moderation version conflicts before action insertion'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000004', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000004'), 40, 'hold', 'other', null) $$,
  'P0001', 'MODERATION_TRANSITION_INVALID',
  'hold cannot weaken blocked enforcement'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000005', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000005'), 50, 'hold', 'other', null) $$,
  'P0001', 'MODERATION_TRANSITION_INVALID',
  'hold cannot weaken removed enforcement'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000006', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'), 60, 'hold', 'other', null) $$,
  'P0001', 'EVENT_PUBLIC_HISTORY_UNKNOWN',
  'unknown legacy history blocks every staff state action'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000001', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 10, 'hold', 'other', 'bounded staff note') $$,
  'a moderator may hold a never-public not-evaluated event'
);
reset role;
select results_eq(
  $$ select moderation_status, moderation_version from public.events where id = '28000000-0000-4000-8000-000000000001' $$,
  $$ values ('under_review'::text, 11::bigint) $$,
  'hold atomically advances the event state and moderation version'
);
select results_eq(
  $$ select status, failure_code from private.event_moderation_evaluations where id = '38000000-0000-4000-8000-000000000001' $$,
  $$ values ('superseded'::text, 'HUMAN_OR_RESULT_SUPERSEDED'::text) $$,
  'a human action supersedes queued evaluations under the event lock'
);
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000001', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 11, 'hold', 'other', repeat('x', 1001)) $$,
  '22023', 'MODERATION_NOTE_INVALID',
  'internal moderation notes have a strict bounded length'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000001', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 11, 'hold', 'other', null) $$,
  'under-review hold is an approved same-state audited signal'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000002', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000002'), 20, 'block', 'other', null) $$,
  'a moderator may block a never-public clear event'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000003', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000003'), 30, 'remove', 'other', null) $$,
  'a moderator may remove a previously-public under-review event'
);
reset role;
select results_eq(
  $$
    select events.moderation_status, events.moderation_version,
      events.public_eligibility_version,
      intervals.eligibility_state, intervals.started_action_id is not null
    from public.events as events
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id
      and intervals.public_eligibility_version = events.public_eligibility_version
      and intervals.ended_at is null
    where events.id = '28000000-0000-4000-8000-000000000003'
  $$,
  $$ values ('removed'::text, 31::bigint, 2::bigint, 'ineligible'::text, true) $$,
  'remove atomically records the enforcement action, state version, and next ineligible epoch'
);
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000004', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000004'), 40, 'clear', 'no_violation', null) $$,
  'a moderator may clear a never-public blocked event'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000005', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000005'), 50, 'restore', 'no_violation', null) $$,
  'a moderator may restore a previously-public removed event'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000002', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000002'), 21, 'remove', 'other', null) $$,
  'P0001', 'MODERATION_TRANSITION_INVALID',
  'remove-before-public is rejected'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000003', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000003'), 31, 'block', 'other', null) $$,
  'P0001', 'MODERATION_TRANSITION_INVALID',
  'block-after-public is rejected'
);
reset role;

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select results_eq($$ select public.get_my_staff_role() $$, $$ values ('admin'::text) $$,
  'an active admin reads the server-controlled role only');
select lives_ok(
  $$ select public.resolve_legacy_public_history('28000000-0000-4000-8000-000000000006', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'), 60, 'never_public', 'legacy_archive_verified_never_public', null, 'archived audit evidence') $$,
  'an admin may resolve unknown history with bounded evidence'
);
reset role;
select results_eq(
  $$ select public_history_status, moderation_status, moderation_version from public.events where id = '28000000-0000-4000-8000-000000000006' $$,
  $$ values ('never_public'::text, 'under_review'::text, 61::bigint) $$,
  'legacy resolution is one-way, retains the hold, and advances the version'
);
select results_eq(
  $$ select status, failure_code from private.event_moderation_evaluations where id = '38000000-0000-4000-8000-000000000002' $$,
  $$ values ('superseded'::text, 'HUMAN_OR_RESULT_SUPERSEDED'::text) $$,
  'legacy resolution supersedes processing work before later staff clearance'
);
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$ select public.resolve_legacy_public_history('28000000-0000-4000-8000-000000000006', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'), 61, 'previously_public', 'legacy_archive_verified_public', now() - interval '1 day', null) $$,
  'P0001', 'EVENT_PUBLIC_HISTORY_KNOWN',
  'known legacy history cannot be rewritten or switched'
);
select results_eq(
  $$ select count(*)::bigint from public.get_moderation_case('28000000-0000-4000-8000-000000000006') $$,
  $$ values (1::bigint) $$,
  'staff case lookup returns one bounded internal case projection'
);
reset role;

select * from finish();
rollback;
