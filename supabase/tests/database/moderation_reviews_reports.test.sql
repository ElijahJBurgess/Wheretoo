begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function('public', 'request_event_review', array['uuid', 'text'],
  'owners can request review through one exact-revision boundary');
select has_function('public', 'withdraw_event_review', array['uuid'],
  'owners can withdraw only their current open review request');
select has_function('public', 'get_current_event_review_request', array['uuid'],
  'owners can reload the current revision review request through a narrow projection');
select has_function('public', 'server_submit_event_report', array['uuid', 'text', 'text', 'text'],
  'only the server submits report digests and structured reasons');

select results_eq(
  $$ select
    has_function_privilege('anon', 'public.server_submit_event_report(uuid,text,text,text)', 'execute'),
    has_function_privilege('authenticated', 'public.server_submit_event_report(uuid,text,text,text)', 'execute'),
    has_function_privilege('service_role', 'public.server_submit_event_report(uuid,text,text,text)', 'execute'),
    has_function_privilege('anon', 'public.request_event_review(uuid,text)', 'execute'),
    has_function_privilege('authenticated', 'public.request_event_review(uuid,text)', 'execute'),
    has_function_privilege('anon', 'public.get_current_event_review_request(uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.get_current_event_review_request(uuid)', 'execute') $$,
  $$ values (false, false, true, false, true, false, true) $$,
  'report submission is service-only while review request reads and writes remain owner-authenticated'
);

select results_eq(
  $$ select count(*)::bigint
     from pg_catalog.pg_proc
     where oid in (
       'public.request_event_review(uuid,text)'::regprocedure,
       'public.withdraw_event_review(uuid)'::regprocedure,
       'public.get_current_event_review_request(uuid)'::regprocedure,
       'public.server_submit_event_report(uuid,text,text,text)'::regprocedure
     ) and proconfig @> array['search_path=""']::text[] $$,
  $$ values (4::bigint) $$,
  'review and report boundaries use empty search paths'
);

select results_eq(
  $$ select count(*)::bigint
     from pg_catalog.pg_attribute as attributes
     join pg_catalog.pg_class as relations on relations.oid = attributes.attrelid
     join pg_catalog.pg_namespace as schemas on schemas.oid = relations.relnamespace
     where schemas.nspname = 'private' and relations.relname = 'event_reports'
       and attributes.attnum > 0 and not attributes.attisdropped
       and attributes.attname in ('ip_address', 'user_agent', 'email', 'free_text', 'network_address') $$,
  $$ values (0::bigint) $$,
  'report storage has no raw client identifier or free-text column'
);

-- The rollback-only fixture proves the service boundary from a currently
-- eligible revision without leaving reports, rate buckets, or test users.
insert into auth.users (id, email) values
  ('19000000-0000-4000-8000-000000000001', 'review-owner@example.invalid');
insert into public.organizers (
  id, display_name, organizer_type, base_city, country_code, onboarding_completed_at
) values (
  '19000000-0000-4000-8000-000000000001', 'Review Fixture Organizer',
  'Community group', 'San Francisco', 'US', now()
);
insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, timezone, venue_name, address_line1, city, region,
  postal_code, country_code, mapbox_feature_id, latitude, longitude,
  admission_type, capacity, published_at, content_revision, moderated_revision,
  moderation_version, public_history_status, first_publicly_eligible_at
) values (
  '29000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001', 'published', 'clear',
  'Pride and drag brunch',
  'A community Pride and drag brunch fixture with safe current public eligibility.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'America/Los_Angeles', 'Fixture Hall', '9 Market Street', 'San Francisco',
  'CA', '94105', 'US', 'mapbox.review-report', 37.7936, -122.3958, 'free', 100,
  now(), 1, 1, 7, 'previously_public', now() - interval '1 hour'
);
insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  '29000000-0000-4000-8000-000000000001', 'all_ages', false, false, false,
  false, false, false
);
update private.organizer_policy_release_settings set environment = 'development';
insert into private.event_policy_acceptances (
  id, event_id, organizer_id, accepted_by_user_id, content_revision, input_sha256,
  organizer_terms_version_id, event_policy_version_id
) values (
  '59000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001', 1,
  private.compute_event_input_sha256('29000000-0000-4000-8000-000000000001'),
  'dev-organizer-terms-v1', 'dev-event-policy-v1'
);
insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, actor_user_id,
  source, action, previous_status, new_status,
  previous_public_history_status, new_public_history_status,
  reason_code, policy_acceptance_id, moderation_version
) values (
  '49000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001', 1,
  private.compute_event_input_sha256('29000000-0000-4000-8000-000000000001'),
  'organizer', '19000000-0000-4000-8000-000000000001',
  'publish', 'authorize_publication', 'clear', 'clear',
  'previously_public', 'previously_public', 'other',
  '59000000-0000-4000-8000-000000000001', 7
);
update public.events
set publicly_authorized_revision = 1,
    publicly_authorized_action_id = '49000000-0000-4000-8000-000000000001',
    public_eligibility_version = 1
where id = '29000000-0000-4000-8000-000000000001';
update private.event_public_eligibility_intervals
set ended_at = statement_timestamp(), ended_action_id = '49000000-0000-4000-8000-000000000001'
where event_id = '29000000-0000-4000-8000-000000000001'
  and public_eligibility_version = 0;
insert into private.event_public_eligibility_intervals (
  event_id, public_eligibility_version, eligibility_state, started_at,
  started_action_id, transition_reason
) values (
  '29000000-0000-4000-8000-000000000001', 1, 'eligible',
  (select ended_at from private.event_public_eligibility_intervals where event_id = '29000000-0000-4000-8000-000000000001' and public_eligibility_version = 0),
  '49000000-0000-4000-8000-000000000001', 'policy_authorization'
);

set local role service_role;
select extensions.is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('0', 64), 'unsafe'
  ), 'submitted', 'the first report is accepted only for a current public event'
);
select extensions.is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('0', 64), 'unsafe'
  ), 'duplicate', 'one actor counts once for one event revision'
);
select extensions.is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('b', 64), repeat('1', 64), 'hate_extremism'
  ), 'submitted', 'a second distinct actor remains only a report signal'
);
select extensions.is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('c', 64), repeat('2', 64), 'prohibited_content'
  ), 'submitted', 'a third distinct actor reaches the report-priority threshold'
);
reset role;

select results_eq(
  $$ select moderation_status, public_eligibility_version
     from public.events where id = '29000000-0000-4000-8000-000000000001' $$,
  $$ values ('clear'::text, 1::bigint) $$,
  'three reports against Pride and drag content do not hide or otherwise change the event'
);
select extensions.is(
  (select count(*)::integer from private.event_moderation_evaluations
   where event_id = '29000000-0000-4000-8000-000000000001'
     and source = 'report' and status = 'queued'),
  1, 'three distinct actors enqueue exactly one priority evaluation'
);
select extensions.is(
  (select count(*)::integer from private.event_reports
   where event_id = '29000000-0000-4000-8000-000000000001'),
  3, 'only distinct actor reports are retained'
);

insert into auth.users (id, email) values
  ('19000000-0000-4000-8000-000000000002', 'review-cross-owner@example.invalid'),
  ('19000000-0000-4000-8000-000000000003', 'review-staff@example.invalid');
insert into private.staff_roles (user_id, role, active, granted_by) values
  ('19000000-0000-4000-8000-000000000003', 'moderator', true, '19000000-0000-4000-8000-000000000003');
update public.events
set moderation_status = 'under_review', moderated_revision = null, moderation_version = 8
where id = '29000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table review_request_snapshot on commit drop as
select public.request_event_review('29000000-0000-4000-8000-000000000001', 'reconsider') as id;
reset role;
alter table review_request_snapshot
  add column created_at timestamptz,
  add column content_revision integer,
  add column input_sha256 text,
  add column status text;
update review_request_snapshot as snapshot
set created_at = requests.created_at,
    content_revision = requests.content_revision,
    input_sha256 = requests.input_sha256,
    status = requests.status
from private.moderation_review_requests as requests
where requests.id = snapshot.id;
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select extensions.is(
  public.request_event_review('29000000-0000-4000-8000-000000000001', 'reconsider'),
  (select id from review_request_snapshot),
  'the exact same review RPC retry returns the original request id'
);
reset role;
select extensions.is(
  (select count(*)::integer from private.moderation_review_requests
   where event_id = '29000000-0000-4000-8000-000000000001' and status = 'open'),
  1, 'retry keeps exactly one open request'
);
select extensions.is(
  (select count(*)::integer from private.moderation_review_requests as requests
   join review_request_snapshot as snapshot on snapshot.id = requests.id
   where requests.status = snapshot.status
     and requests.created_at = snapshot.created_at
     and requests.content_revision = snapshot.content_revision
     and requests.input_sha256 = snapshot.input_sha256),
  1, 'idempotent retry leaves the exact open row and snapshot unchanged'
);
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$ select id, status, created_at is not null, resolved_at
     from public.get_current_event_review_request('29000000-0000-4000-8000-000000000001') $$,
  $$ select id, 'open'::text, true, null::timestamptz from review_request_snapshot $$,
  'the owner reloads only the current open request identifier, status, and safe timestamps'
);
reset role;
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is_empty(
  $$ select * from public.get_current_event_review_request('29000000-0000-4000-8000-000000000001') $$,
  'another organizer cannot read the current review request'
);
select throws_ok(
  $$ select public.request_event_review('29000000-0000-4000-8000-000000000001', null) $$,
  'P0001', 'EVENT_NOT_FOUND', 'a cross-owner request returns the safe not-found result'
);
reset role;
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select isnt(
  public.withdraw_event_review('29000000-0000-4000-8000-000000000001'),
  null::uuid, 'the owner withdraws the exact current open request through the RPC'
);
reset role;
select extensions."is"(
  (select status::text from private.moderation_review_requests
   where event_id = '29000000-0000-4000-8000-000000000001' order by created_at desc limit 1),
  'withdrawn'::text, 'withdrawal resolves only the request record and preserves moderation'
);
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$ select status, resolved_at is not null
     from public.get_current_event_review_request('29000000-0000-4000-8000-000000000001') $$,
  $$ values ('withdrawn'::text, true) $$,
  'the owner projection persists withdrawn status for retry UI after reload'
);
reset role;
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select isnt(
  public.request_event_review('29000000-0000-4000-8000-000000000001', null),
  null::uuid, 'the owner can submit a new request after withdrawal'
);
reset role;
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select isnt(
  public.moderate_event(
    '29000000-0000-4000-8000-000000000001', 1,
    (select input_sha256 from public.get_moderation_case('29000000-0000-4000-8000-000000000001')),
    8, 'hold', 'user_report', null
  ), null::uuid, 'the actual Task 8 staff boundary resolves the matching review request'
);
reset role;
select extensions.is(
  (select status::text from private.moderation_review_requests
   where event_id = '29000000-0000-4000-8000-000000000001' and status = 'resolved'),
  'resolved'::text, 'staff resolution is persisted through the actual moderation action'
);
select extensions.is(
  (select count(*)::integer from private.event_moderation_actions
   where event_id = '29000000-0000-4000-8000-000000000001' and action = 'resolve_review'),
  2, 'withdrawal and staff resolution each have their own review audit action'
);

select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.request_event_review('29000000-0000-4000-8000-000000000001', null);
select public.save_owned_event_revision(
  '29000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'title', 'Pride and drag brunch revised',
    'description', 'A community Pride and drag brunch fixture with safe current public eligibility.',
    'category', 'community', 'starts_at', (select starts_at::text from public.events where id = '29000000-0000-4000-8000-000000000001'),
    'ends_at', (select ends_at::text from public.events where id = '29000000-0000-4000-8000-000000000001'),
    'timezone', 'America/Los_Angeles', 'venue_name', 'Fixture Hall',
    'address_line1', '9 Market Street', 'address_line2', null, 'city', 'San Francisco',
    'region', 'CA', 'postal_code', '94105', 'country_code', 'US',
    'mapbox_feature_id', 'mapbox.review-report', 'latitude', 37.7936,
    'longitude', -122.3958, 'admission_type', 'free', 'capacity', 100
  )
);
reset role;
select extensions.is(
  (select status::text from private.moderation_review_requests
   where event_id = '29000000-0000-4000-8000-000000000001' order by created_at desc limit 1),
  'superseded'::text, 'the actual Task 6 revision boundary supersedes a stale open review request'
);
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is_empty(
  $$ select * from public.get_current_event_review_request('29000000-0000-4000-8000-000000000001') $$,
  'a material edit removes the superseded old-revision request from the current projection'
);
reset role;
set local role service_role;
select extensions.is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('0', 64), 'unsafe'
  ), 'not_found', 'the service report RPC returns safe not-found while the edited revision is nonpublic'
);
reset role;
insert into private.event_policy_legacy_exemptions (
  id, event_id, grandfathered_content_revision, input_sha256, migration_identifier
) values (
  '59000000-0000-4000-8000-000000000002',
  '29000000-0000-4000-8000-000000000001',
  (select content_revision from public.events where id = '29000000-0000-4000-8000-000000000001'),
  private.compute_event_input_sha256('29000000-0000-4000-8000-000000000001'),
  'report-revision-fixture'
);
insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, source, action,
  previous_status, new_status, previous_public_history_status, new_public_history_status,
  reason_code, policy_legacy_exemption_id, moderation_version
) values (
  '49000000-0000-4000-8000-000000000002',
  '29000000-0000-4000-8000-000000000001',
  (select content_revision from public.events where id = '29000000-0000-4000-8000-000000000001'),
  private.compute_event_input_sha256('29000000-0000-4000-8000-000000000001'),
  'system', 'migration', 'authorize_publication', 'under_review', 'clear',
  'previously_public', 'previously_public', 'other',
  '59000000-0000-4000-8000-000000000002',
  (select moderation_version from public.events where id = '29000000-0000-4000-8000-000000000001')
);
update private.event_public_eligibility_intervals
set ended_at = clock_timestamp(), ended_action_id = '49000000-0000-4000-8000-000000000002'
where event_id = '29000000-0000-4000-8000-000000000001' and ended_at is null;
update public.events
set moderation_status = 'clear',
    moderated_revision = content_revision,
    publicly_authorized_revision = content_revision,
    publicly_authorized_action_id = '49000000-0000-4000-8000-000000000002',
    public_eligibility_version = public_eligibility_version + 1
where id = '29000000-0000-4000-8000-000000000001';
insert into private.event_public_eligibility_intervals (
  event_id, public_eligibility_version, eligibility_state, started_at, started_action_id, transition_reason
) select id, public_eligibility_version, 'eligible', clock_timestamp(),
  '49000000-0000-4000-8000-000000000002', 'policy_authorization'
from public.events where id = '29000000-0000-4000-8000-000000000001';
set local role service_role;
select extensions.is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('0', 64), 'unsafe'
  ), 'submitted', 'the same actor can report the newly public later revision after actual edit supersession'
);
reset role;
select extensions.is(
  (select count(*)::integer from private.event_reports
   where event_id = '29000000-0000-4000-8000-000000000001'
     and content_revision = 1 and status = 'superseded'),
  3, 'the later revision supersedes all open reports from the former revision'
);

insert into private.event_reports (
  event_id, content_revision, input_sha256, reporter_fingerprint, reason,
  status, created_at, resolved_at
) values (
  '29000000-0000-4000-8000-000000000001', 1,
  private.compute_event_input_sha256('29000000-0000-4000-8000-000000000001'),
  repeat('d', 64), 'other', 'dismissed',
  clock_timestamp() - interval '31 days', clock_timestamp() - interval '31 days'
);
insert into private.event_report_rate_buckets (
  bucket_type, bucket_digest, window_started_at, request_count, expires_at
) values
  ('actor', repeat('e', 64), clock_timestamp() - interval '2 days', 1, clock_timestamp() - interval '1 day'),
  ('network', repeat('f', 64), clock_timestamp() - interval '2 days', 1, clock_timestamp() - interval '1 day'),
  ('actor', repeat('9', 64), clock_timestamp(), 1, clock_timestamp() + interval '1 day');
set local role service_role;
select extensions.is(
  public.server_expire_event_report_fingerprints(), 3::bigint,
  'retention removes the expired report fingerprint and both expired rate buckets'
);
reset role;
select extensions.is(
  (select count(*)::integer from private.event_report_rate_buckets
   where bucket_digest in (repeat('e', 64), repeat('f', 64))),
  0, 'expired actor and network buckets are deleted'
);
select extensions.is(
  (select count(*)::integer from private.event_report_rate_buckets
   where bucket_digest = repeat('9', 64)),
  1, 'current rate bucket remains inside the retention window'
);
select is(
  (select reporter_fingerprint is null from private.event_reports
   where reporter_fingerprint is null and created_at < clock_timestamp() - interval '30 days'
   limit 1), true, 'expired report preserves audit row but drops its fingerprint'
);

select * from finish();
rollback;
