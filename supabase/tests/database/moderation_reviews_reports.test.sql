begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function('public', 'request_event_review', array['uuid', 'text'],
  'owners can request review through one exact-revision boundary');
select has_function('public', 'withdraw_event_review', array['uuid'],
  'owners can withdraw only their current open review request');
select has_function('public', 'server_submit_event_report', array['uuid', 'text', 'text', 'text'],
  'only the server submits report digests and structured reasons');

select results_eq(
  $$ select
    has_function_privilege('anon', 'public.server_submit_event_report(uuid,text,text,text)', 'execute'),
    has_function_privilege('authenticated', 'public.server_submit_event_report(uuid,text,text,text)', 'execute'),
    has_function_privilege('service_role', 'public.server_submit_event_report(uuid,text,text,text)', 'execute'),
    has_function_privilege('anon', 'public.request_event_review(uuid,text)', 'execute'),
    has_function_privilege('authenticated', 'public.request_event_review(uuid,text)', 'execute') $$,
  $$ values (false, false, true, false, true) $$,
  'report submission is service-only while review requests remain owner-authenticated'
);

select results_eq(
  $$ select count(*)::bigint
     from pg_catalog.pg_proc
     where oid in (
       'public.request_event_review(uuid,text)'::regprocedure,
       'public.withdraw_event_review(uuid)'::regprocedure,
       'public.server_submit_event_report(uuid,text,text,text)'::regprocedure
     ) and proconfig @> array['search_path=""']::text[] $$,
  $$ values (3::bigint) $$,
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
set ended_at = now(), ended_action_id = '49000000-0000-4000-8000-000000000001'
where event_id = '29000000-0000-4000-8000-000000000001'
  and public_eligibility_version = 0;
insert into private.event_public_eligibility_intervals (
  event_id, public_eligibility_version, eligibility_state, started_at,
  started_action_id, transition_reason
) values (
  '29000000-0000-4000-8000-000000000001', 1, 'eligible', now(),
  '49000000-0000-4000-8000-000000000001', 'policy_authorization'
);

set local role service_role;
select is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('0', 64), 'unsafe'
  ), 'submitted', 'the first report is accepted only for a current public event'
);
select is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('0', 64), 'unsafe'
  ), 'duplicate', 'one actor counts once for one event revision'
);
select is(
  public.server_submit_event_report(
    '29000000-0000-4000-8000-000000000001', repeat('b', 64), repeat('1', 64), 'hate_extremism'
  ), 'submitted', 'a second distinct actor remains only a report signal'
);
select is(
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
select is(
  (select count(*)::integer from private.event_moderation_evaluations
   where event_id = '29000000-0000-4000-8000-000000000001'
     and source = 'report' and status = 'queued'),
  1, 'three distinct actors enqueue exactly one priority evaluation'
);
select is(
  (select count(*)::integer from private.event_reports
   where event_id = '29000000-0000-4000-8000-000000000001'),
  3, 'only distinct actor reports are retained'
);

select * from finish();
rollback;
