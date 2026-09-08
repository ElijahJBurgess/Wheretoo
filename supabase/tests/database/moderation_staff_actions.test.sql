begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

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
  ('28000000-0000-4000-8000-000000000006', '18000000-0000-4000-8000-000000000005', 'published', 'under_review', 'Unknown Fixture', 'A complete staff moderation fixture with unresolved legacy public evidence.', 'community', now() + interval '7 days', now() + interval '7 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '6 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-unknown', 37.7936, -122.3958, 'free', 100, now(), 1, null, 60, 'unknown', null),
  ('28000000-0000-4000-8000-000000000007', '18000000-0000-4000-8000-000000000005', 'published', 'clear', 'Hold Clear Fixture', 'A clear source fixture for a valid hold transition.', 'community', now() + interval '8 days', now() + interval '8 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '7 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-hold-clear', 37.7936, -122.3958, 'free', 100, now(), 1, 1, 70, 'never_public', null),
  ('28000000-0000-4000-8000-000000000008', '18000000-0000-4000-8000-000000000005', 'published', 'not_evaluated', 'Block New Fixture', 'A not-evaluated source fixture for blocking.', 'community', now() + interval '9 days', now() + interval '9 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '8 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-block-new', 37.7936, -122.3958, 'free', 100, now(), 1, null, 80, 'never_public', null),
  ('28000000-0000-4000-8000-000000000009', '18000000-0000-4000-8000-000000000005', 'published', 'under_review', 'Block Review Fixture', 'An under-review source fixture for blocking.', 'community', now() + interval '10 days', now() + interval '10 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '9 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-block-review', 37.7936, -122.3958, 'free', 100, now(), 1, null, 90, 'never_public', null),
  ('28000000-0000-4000-8000-000000000010', '18000000-0000-4000-8000-000000000005', 'published', 'clear', 'Remove Clear Fixture', 'A clear source fixture formerly available to the public.', 'community', now() + interval '11 days', now() + interval '11 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '10 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-remove-clear', 37.7936, -122.3958, 'free', 100, now(), 1, 1, 100, 'previously_public', now() - interval '1 day'),
  ('28000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000005', 'published', 'not_evaluated', 'Clear New Never Fixture', 'A not-evaluated never-public clear fixture.', 'community', now() + interval '12 days', now() + interval '12 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '11 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-clear-new-never', 37.7936, -122.3958, 'free', 100, now(), 1, null, 110, 'never_public', null),
  ('28000000-0000-4000-8000-000000000012', '18000000-0000-4000-8000-000000000005', 'published', 'not_evaluated', 'Clear New Public Fixture', 'A not-evaluated previously-public clear fixture.', 'community', now() + interval '13 days', now() + interval '13 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '12 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-clear-new-public', 37.7936, -122.3958, 'free', 100, now(), 1, null, 120, 'previously_public', now() - interval '1 day'),
  ('28000000-0000-4000-8000-000000000013', '18000000-0000-4000-8000-000000000005', 'published', 'under_review', 'Clear Review Public Fixture', 'An under-review previously-public clear fixture.', 'community', now() + interval '14 days', now() + interval '14 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '13 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-clear-review-public', 37.7936, -122.3958, 'free', 100, now(), 1, null, 130, 'previously_public', now() - interval '1 day'),
  ('28000000-0000-4000-8000-000000000014', '18000000-0000-4000-8000-000000000005', 'published', 'removed', 'Restore Authorized Fixture', 'A removed previously-public fixture with exact current authorization.', 'community', now() + interval '15 days', now() + interval '15 days 2 hours', 'America/Los_Angeles', 'Staff Hall', '14 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.staff-restore-authorized', 37.7936, -122.3958, 'free', 100, now(), 1, null, 140, 'previously_public', now() - interval '1 day');

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
select id, 'all_ages', false, false, false, false, false, false
from public.events
where id between '28000000-0000-4000-8000-000000000001'::uuid
  and '28000000-0000-4000-8000-000000000014'::uuid;

insert into private.event_policy_legacy_exemptions (
  id, event_id, grandfathered_content_revision, input_sha256, migration_identifier
) values (
  '58000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000001', 1,
  private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'),
  'staff-action-fixture'
);
insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, source, action,
  previous_status, new_status, previous_public_history_status,
  new_public_history_status, reason_code, policy_legacy_exemption_id,
  moderation_version
) values (
  '48000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000001', 1,
  private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'),
  'system', 'migration', 'authorize_publication',
  'not_evaluated', 'not_evaluated', 'never_public', 'never_public',
  'other', '58000000-0000-4000-8000-000000000001', 9
);
update public.events
set publicly_authorized_revision = 1,
    publicly_authorized_action_id = '48000000-0000-4000-8000-000000000001'
where id = '28000000-0000-4000-8000-000000000001';

insert into private.event_policy_legacy_exemptions (
  id, event_id, grandfathered_content_revision, input_sha256, migration_identifier
) values (
  '58000000-0000-4000-8000-000000000014',
  '28000000-0000-4000-8000-000000000014', 1,
  private.compute_event_input_sha256('28000000-0000-4000-8000-000000000014'),
  'staff-restore-fixture'
);
insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, source, action,
  previous_status, new_status, previous_public_history_status,
  new_public_history_status, reason_code, policy_legacy_exemption_id,
  moderation_version
) values (
  '48000000-0000-4000-8000-000000000014',
  '28000000-0000-4000-8000-000000000014', 1,
  private.compute_event_input_sha256('28000000-0000-4000-8000-000000000014'),
  'system', 'migration', 'authorize_publication',
  'removed', 'removed', 'previously_public', 'previously_public',
  'other', '58000000-0000-4000-8000-000000000014', 139
);
update public.events
set publicly_authorized_revision = 1,
    publicly_authorized_action_id = '48000000-0000-4000-8000-000000000014'
where id = '28000000-0000-4000-8000-000000000014';

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
set ended_at = statement_timestamp(), ended_action_id = '48000000-0000-4000-8000-000000000003'
where event_id = '28000000-0000-4000-8000-000000000003'
  and public_eligibility_version = 0;
update public.events
set public_eligibility_version = 1
where id = '28000000-0000-4000-8000-000000000003';
insert into private.event_public_eligibility_intervals (
  event_id, public_eligibility_version, eligibility_state, started_at,
  started_action_id, transition_reason
) values (
  '28000000-0000-4000-8000-000000000003', 1, 'eligible',
  (select ended_at from private.event_public_eligibility_intervals where event_id = '28000000-0000-4000-8000-000000000003' and public_eligibility_version = 0),
  '48000000-0000-4000-8000-000000000003', 'moderation_restore'
);

insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version, status, source
) values
  ('38000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 10, 'queued', 'contextual'),
  ('38000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000006', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'), 60, 'processing', 'report');

insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, source, action,
  previous_status, new_status, previous_public_history_status,
  new_public_history_status, reason_code, moderation_version, created_at
)
select
  ('4a000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '28000000-0000-4000-8000-000000000006'::uuid, 1,
  private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'),
  'system', 'migration', 'hold', 'under_review', 'under_review',
  'unknown', 'unknown', 'other', series,
  timestamptz '2000-01-01 00:00:00+00' + series * interval '1 second'
from generate_series(1, 51) as series;

insert into private.event_reports (
  id, event_id, content_revision, input_sha256, reporter_fingerprint,
  reason, created_at
) values
  ('68000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000006', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'), repeat('1', 64), 'other', now() - interval '5 minutes'),
  ('68000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000006', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'), repeat('2', 64), 'unsafe', now() - interval '4 minutes'),
  ('68000000-0000-4000-8000-000000000003', '28000000-0000-4000-8000-000000000003', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000003'), repeat('3', 64), 'other', now() - interval '3 minutes'),
  ('68000000-0000-4000-8000-000000000004', '28000000-0000-4000-8000-000000000003', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000003'), repeat('4', 64), 'unsafe', now() - interval '2 minutes'),
  ('68000000-0000-4000-8000-000000000005', '28000000-0000-4000-8000-000000000003', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000003'), repeat('5', 64), 'wrong_location', now() - interval '1 minute');

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select public.request_event_review(
  '28000000-0000-4000-8000-000000000006',
  null
);
reset role;

insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version,
  status, source, outcome, risk_level, reason_codes, provider_reference,
  model_version, attempt_count, started_at, finished_at, created_at
)
select
  ('3a000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '28000000-0000-4000-8000-000000000006'::uuid, 1,
  private.compute_event_input_sha256('28000000-0000-4000-8000-000000000006'),
  1000 + series, 'succeeded', 'contextual', 'review_required', 'high',
  array['other']::text[], 'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64), 1,
  timestamptz '2000-01-01 00:00:00+00' + series * interval '1 second',
  timestamptz '2000-01-01 00:00:00+00' + (series + 1) * interval '1 second',
  timestamptz '2000-01-01 00:00:00+00' + series * interval '1 second'
from generate_series(1, 51) as series;

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
select results_eq(
  $$
    select event_id, organizer_id, current_open_review_request,
      current_report_count
    from public.list_moderation_queue(25)
    limit 2
  $$,
  $$ values
    ('28000000-0000-4000-8000-000000000006'::uuid, '18000000-0000-4000-8000-000000000005'::uuid, true, 2::bigint),
    ('28000000-0000-4000-8000-000000000003'::uuid, '18000000-0000-4000-8000-000000000005'::uuid, false, 3::bigint)
  $$,
  'staff queue exposes only bounded owner/review/report facts and prioritizes current review requests before report count'
);
select throws_ok(
  $$ insert into private.staff_roles (user_id, role, active, granted_by) values ('18000000-0000-4000-8000-000000000004', 'moderator', true, '18000000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'a moderator cannot insert staff roles directly'
);
select throws_ok(
  $$ update private.staff_roles set active = false where user_id = '18000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a moderator cannot mutate staff roles directly'
);
select throws_ok(
  $$ delete from private.staff_roles where user_id = '18000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a moderator cannot delete staff roles directly'
);
select throws_ok(
  $$ select * from private.event_legacy_history_resolutions $$,
  '42501', null,
  'a moderator cannot read legacy-resolution evidence directly'
);
select throws_ok(
  $$ insert into private.event_legacy_history_resolutions (event_id, action_id, resolved_by_user_id, resolved_public_history_status, evidence_code) values ('28000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'never_public', 'legacy_archive_verified_never_public') $$,
  '42501', null,
  'a moderator cannot insert legacy-resolution evidence directly'
);
select throws_ok(
  $$ update private.event_legacy_history_resolutions set evidence_code = 'legacy_archive_verified_never_public' where false $$,
  '42501', null,
  'a moderator cannot update legacy-resolution evidence directly'
);
select throws_ok(
  $$ delete from private.event_legacy_history_resolutions where false $$,
  '42501', null,
  'a moderator cannot delete legacy-resolution evidence directly'
);
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
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000004', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000004'), 40, 'restore', 'no_violation', null) $$,
  'P0001', 'MODERATION_TRANSITION_INVALID',
  'restore-from-blocked is rejected from an actually blocked source'
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
  $$
    select events.moderation_status, events.moderation_version,
      actions.previous_status, actions.new_status, intervals.eligibility_state
    from public.events as events
    join private.event_moderation_actions as actions
      on actions.event_id = events.id and actions.moderation_version = 11
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id and intervals.ended_at is null
    where events.id = '28000000-0000-4000-8000-000000000001'
  $$,
  $$ values ('under_review'::text, 11::bigint, 'not_evaluated'::text, 'under_review'::text, 'ineligible'::text) $$,
  'hold atomically records state/action/version while preserving its ineligible epoch'
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
reset role;
select results_eq(
  $$
    select events.moderation_status, events.moderation_version,
      actions.previous_status, actions.new_status,
      intervals.public_eligibility_version, intervals.eligibility_state
    from public.events as events
    join private.event_moderation_actions as actions
      on actions.event_id = events.id and actions.moderation_version = 12
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id and intervals.ended_at is null
    where events.id = '28000000-0000-4000-8000-000000000001'
  $$,
  $$ values ('under_review'::text, 12::bigint, 'under_review'::text, 'under_review'::text, 0::bigint, 'ineligible'::text) $$,
  'same-state hold appends its own action/version without changing the current epoch'
);
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000001', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000001'), 12, 'clear', 'no_violation', null) $$,
  'a moderator may clear a known-history under-review revision'
);
reset role;
select results_eq(
  $$
    select events.public_history_status, actions.previous_public_history_status,
      actions.new_public_history_status, intervals.eligibility_state,
      events.public_eligibility_version
    from public.events as events
    join private.event_moderation_actions as actions
      on actions.event_id = events.id and actions.moderation_version = 13
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id
      and intervals.public_eligibility_version = events.public_eligibility_version
      and intervals.ended_at is null
    where events.id = '28000000-0000-4000-8000-000000000001'
  $$,
  $$ values ('previously_public'::text, 'never_public'::text, 'previously_public'::text, 'eligible'::text, 1::bigint) $$,
  'first-public clear records the same history transition as the event and open eligible epoch'
);
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000002', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000002'), 20, 'remove', 'other', null) $$,
  'P0001', 'MODERATION_TRANSITION_INVALID',
  'otherwise-valid removal is rejected for never-public history'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000002', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000002'), 20, 'block', 'other', null) $$,
  'a moderator may block a never-public clear event'
);
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000003', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000003'), 30, 'block', 'other', null) $$,
  'P0001', 'MODERATION_TRANSITION_INVALID',
  'otherwise-valid block is rejected for previously-public history'
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
select throws_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000005', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000005'), 50, 'clear', 'no_violation', null) $$,
  'P0001', 'MODERATION_TRANSITION_INVALID',
  'clear-from-removed is rejected even for previously-public history'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000005', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000005'), 50, 'restore', 'no_violation', null) $$,
  'a moderator may restore a previously-public removed event'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000007', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000007'), 70, 'hold', 'other', null) $$,
  'a moderator may hold from a clear source'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000008', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000008'), 80, 'block', 'other', null) $$,
  'a moderator may block from a never-public not-evaluated source'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000009', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000009'), 90, 'block', 'other', null) $$,
  'a moderator may block from a never-public under-review source'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000010', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000010'), 100, 'remove', 'other', null) $$,
  'a moderator may remove from a previously-public clear source'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000011', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000011'), 110, 'clear', 'no_violation', null) $$,
  'a moderator may clear from a never-public not-evaluated source'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000012', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000012'), 120, 'clear', 'no_violation', null) $$,
  'a moderator may clear from a previously-public not-evaluated source'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000013', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000013'), 130, 'clear', 'no_violation', null) $$,
  'a moderator may clear from a previously-public under-review source'
);
select lives_ok(
  $$ select public.moderate_event('28000000-0000-4000-8000-000000000014', 1, private.compute_event_input_sha256('28000000-0000-4000-8000-000000000014'), 140, 'restore', 'no_violation', null) $$,
  'a moderator may restore a previously-public removed event with exact current authorization'
);
reset role;
select results_eq(
  $$
    select id, moderation_status, moderation_version
    from public.events
    where id between '28000000-0000-4000-8000-000000000007'::uuid
      and '28000000-0000-4000-8000-000000000013'::uuid
    order by id
  $$,
  $$ values
    ('28000000-0000-4000-8000-000000000007'::uuid, 'under_review'::text, 71::bigint),
    ('28000000-0000-4000-8000-000000000008'::uuid, 'blocked'::text, 81::bigint),
    ('28000000-0000-4000-8000-000000000009'::uuid, 'blocked'::text, 91::bigint),
    ('28000000-0000-4000-8000-000000000010'::uuid, 'removed'::text, 101::bigint),
    ('28000000-0000-4000-8000-000000000011'::uuid, 'clear'::text, 111::bigint),
    ('28000000-0000-4000-8000-000000000012'::uuid, 'clear'::text, 121::bigint),
    ('28000000-0000-4000-8000-000000000013'::uuid, 'clear'::text, 131::bigint) $$,
  'independent fresh fixtures prove every approved source/history matrix entry'
);
select results_eq(
  $$
    select events.moderation_status, events.moderation_version,
      actions.action, actions.previous_status, actions.new_status,
      actions.previous_public_history_status, actions.new_public_history_status,
      events.publicly_authorized_revision, events.publicly_authorized_action_id,
      events.public_eligibility_version, intervals.eligibility_state
    from public.events as events
    join private.event_moderation_actions as actions
      on actions.event_id = events.id and actions.moderation_version = 141
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id and intervals.ended_at is null
    where events.id = '28000000-0000-4000-8000-000000000014'
  $$,
  $$ values ('clear'::text, 141::bigint, 'restore'::text, 'removed'::text, 'clear'::text,
    'previously_public'::text, 'previously_public'::text, 1::bigint,
    '48000000-0000-4000-8000-000000000014'::uuid, 1::bigint, 'eligible'::text) $$,
  'authorized restore atomically records status/action/history/version and opens an eligible epoch'
);

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
select results_eq(
  $$
    select
      array(select key from jsonb_object_keys(to_jsonb(cases)) as key order by key)
        = array[
          'actions', 'address_line1', 'address_line2', 'category', 'city',
          'content_revision', 'country_code', 'current_open_review_request',
          'current_report_count', 'description', 'disclosures', 'ends_at',
          'evaluations', 'event_id', 'first_publicly_eligible_at',
          'input_sha256', 'latitude', 'legacy_resolution', 'longitude',
          'mapbox_feature_id', 'moderation_status', 'moderation_version', 'organizer_id',
          'postal_code', 'public_history_status', 'region', 'starts_at',
          'timezone', 'title', 'venue_name'
        ]::text[]
      and array(select key from jsonb_object_keys(cases.disclosures) as key order by key)
        = array[
          'alcohol_present', 'cannabis_present', 'explicit_adult_content',
          'gambling_present', 'high_risk_activity', 'minimum_age',
          'weapons_present'
        ]::text[]
      and array(select key from jsonb_object_keys(cases.legacy_resolution) as key order by key)
        = array[
          'created_at', 'evidence_code', 'observed_public_at',
          'resolved_public_history_status'
        ]::text[]
      and cases.organizer_id = '18000000-0000-4000-8000-000000000005'::uuid
      and cases.current_open_review_request
      and cases.current_report_count = 2
      and not to_jsonb(cases) ?| array[
        'owner_id', 'actor_user_id', 'reviewer_user_id', 'reporter_fingerprint',
        'report_reason', 'review_request_id', 'organizer_note', 'email',
        'provider_reference', 'model_version', 'raw_output',
        'provider_reasoning', 'internal_reasoning'
      ]
      and jsonb_array_length(cases.actions) = 50
      and jsonb_array_length(cases.evaluations) = 50
      and cases.actions @> jsonb_build_array(jsonb_build_object(
        'id', '4a000000-0000-4000-8000-000000000051'::uuid
      ))
      and not cases.actions @> jsonb_build_array(jsonb_build_object(
        'id', '4a000000-0000-4000-8000-000000000001'::uuid
      ))
      and not cases.actions @> jsonb_build_array(jsonb_build_object(
        'id', '4a000000-0000-4000-8000-000000000002'::uuid
      ))
      and cases.evaluations @> jsonb_build_array(jsonb_build_object(
        'id', '3a000000-0000-4000-8000-000000000051'::uuid
      ))
      and not cases.evaluations @> jsonb_build_array(jsonb_build_object(
        'id', '3a000000-0000-4000-8000-000000000001'::uuid
      ))
      and not cases.evaluations @> jsonb_build_array(jsonb_build_object(
        'id', '3a000000-0000-4000-8000-000000000002'::uuid
      ))
      and not exists (
        select 1
        from jsonb_array_elements(cases.actions) as action_row(value)
        where array(select key from jsonb_object_keys(action_row.value) as key order by key)
          is distinct from array[
            'action', 'created_at', 'id',
            'moderation_version', 'new_status', 'previous_status', 'reason_code'
          ]::text[]
          or action_row.value ?| array[
            'actor_user_id', 'reviewer_user_id', 'provider_reference',
            'model_version', 'input_sha256', 'evaluation_id', 'raw_output',
            'provider_reasoning', 'internal_reasoning', 'internal_note'
          ]
      )
      and not exists (
        select 1
        from jsonb_array_elements(cases.evaluations) as evaluation_row(value)
        where array(select key from jsonb_object_keys(evaluation_row.value) as key order by key)
          is distinct from array[
            'content_revision', 'created_at', 'failure_code', 'finished_at',
            'id', 'outcome', 'reason_codes', 'risk_level', 'source', 'status'
          ]::text[]
          or evaluation_row.value ?| array[
            'actor_user_id', 'reviewer_user_id', 'provider_reference',
            'model_version', 'input_sha256', 'raw_output', 'provider_reasoning',
            'internal_reasoning'
          ]
      )
    from public.get_moderation_case('28000000-0000-4000-8000-000000000006') as cases
  $$,
  $$ values (true) $$,
  'staff case has exact bounded allowlists, excludes unsafe nested fields, and returns precisely the newest fifty records'
);
reset role;

select * from finish();
rollback;
