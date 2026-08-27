begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

select has_function(
  'public', 'server_claim_moderation_evaluation', array['text'],
  'the worker claims one contextual evaluation through a service boundary'
);
select has_function(
  'public', 'server_apply_moderation_evaluation',
  array['uuid', 'bigint', 'text', 'bigint', 'text', 'text', 'text[]', 'text', 'text'],
  'the worker applies only an exact structured result'
);
select has_function(
  'public', 'server_fail_moderation_evaluation',
  array['uuid', 'bigint', 'text', 'bigint', 'text'],
  'the worker records one bounded safe failure code'
);

select results_eq(
  $$
    select
      has_function_privilege('anon', 'public.server_claim_moderation_evaluation(text)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.server_claim_moderation_evaluation(text)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.server_claim_moderation_evaluation(text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.server_apply_moderation_evaluation(uuid,bigint,text,bigint,text,text,text[],text,text)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.server_apply_moderation_evaluation(uuid,bigint,text,bigint,text,text,text[],text,text)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.server_apply_moderation_evaluation(uuid,bigint,text,bigint,text,text,text[],text,text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.server_fail_moderation_evaluation(uuid,bigint,text,bigint,text)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.server_fail_moderation_evaluation(uuid,bigint,text,bigint,text)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.server_fail_moderation_evaluation(uuid,bigint,text,bigint,text)', 'EXECUTE')
  $$,
  $$ values (false, false, true, false, false, true, false, false, true) $$,
  'only the service role can execute worker mutations'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc
    where oid in (
      'public.server_claim_moderation_evaluation(text)'::regprocedure,
      'public.server_apply_moderation_evaluation(uuid,bigint,text,bigint,text,text,text[],text,text)'::regprocedure,
      'public.server_fail_moderation_evaluation(uuid,bigint,text,bigint,text)'::regprocedure
    ) and proconfig @> array['search_path=""']::text[]
  $$,
  $$ values (3::bigint) $$,
  'all worker functions use an empty search path'
);

update private.event_moderation_evaluations as evaluations
set status = 'superseded',
    started_at = coalesce(evaluations.started_at, statement_timestamp()),
    finished_at = statement_timestamp(),
    failure_code = coalesce(evaluations.failure_code, 'STALE_EVALUATION')
where evaluations.status in ('queued', 'processing');

insert into auth.users (id, email)
values ('17000000-0000-0000-0000-000000000001', 'moderation-worker-owner@example.invalid');

insert into public.organizers (
  id, display_name, organizer_type, base_city, country_code, onboarding_completed_at
) values (
  '17000000-0000-0000-0000-000000000001', 'Worker Fixture Organizer',
  'Community group', 'San Francisco', 'US', now()
);

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, timezone, venue_name, address_line1, city, region,
  postal_code, country_code, mapbox_feature_id, latitude, longitude,
  admission_type, capacity, published_at, content_revision, moderated_revision,
  moderation_version, public_history_status, first_publicly_eligible_at
) values
  (
    '27000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0000-000000000001', 'published', 'under_review',
    'Contextual Review Fixture',
    'A complete contextual moderation fixture held pending a structured result.',
    'community', now() + interval '2 days', now() + interval '2 days 2 hours',
    'America/Los_Angeles', 'Fixture Hall', '1 Market Street', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.contextual-fixture', 37.7936, -122.3958,
    'free', 100, now(), 1, null, 4, 'never_public', null
  ),
  (
    '27000000-0000-0000-0000-000000000002',
    '17000000-0000-0000-0000-000000000001', 'published', 'blocked',
    'Blocked Contextual Fixture',
    'A blocked fixture that automated moderation must never release.',
    'community', now() + interval '3 days', now() + interval '3 days 2 hours',
    'America/Los_Angeles', 'Fixture Hall', '2 Market Street', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.blocked-contextual', 37.7936, -122.3958,
    'free', 100, now(), 1, 1, 7, 'never_public', null
  ),
  (
    '27000000-0000-0000-0000-000000000003',
    '17000000-0000-0000-0000-000000000001', 'published', 'removed',
    'Removed Contextual Fixture',
    'A removed fixture that automated moderation must never restore.',
    'community', now() + interval '4 days', now() + interval '4 days 2 hours',
    'America/Los_Angeles', 'Fixture Hall', '3 Market Street', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.removed-contextual', 37.7936, -122.3958,
    'free', 100, now(), 1, 1, 9, 'previously_public', now() - interval '1 day'
  );

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
select id, 'all_ages', false, false, false, false, false, false
from public.events
where id between
  '27000000-0000-0000-0000-000000000001'::uuid and
  '27000000-0000-0000-0000-000000000003'::uuid;

insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version,
  status, source, attempt_count, created_at
) values (
  '37000000-0000-4000-8000-000000000001',
  '27000000-0000-0000-0000-000000000001', 1,
  private.compute_event_input_sha256('27000000-0000-0000-0000-000000000001'),
  4, 'queued', 'contextual', 0, now() - interval '3 minutes'
);

select throws_ok(
  $$
    insert into private.event_moderation_evaluations (
      event_id, content_revision, input_sha256, queued_moderation_version,
      status, source
    ) values (
      '27000000-0000-0000-0000-000000000001', 1,
      private.compute_event_input_sha256('27000000-0000-0000-0000-000000000001'),
      4, 'queued', 'contextual'
    )
  $$,
  '23505', null,
  'the exact event/revision/digest/source/version tuple is unique'
);

grant select on private.event_moderation_evaluations,
  private.event_moderation_actions to service_role;
grant execute on function private.compute_event_input_sha256(uuid)
to service_role;
set local role service_role;

select results_eq(
  $$
    select evaluation_id, content_revision, queued_moderation_version, attempt_count
    from public.server_claim_moderation_evaluation('worker-a')
  $$,
  $$ values ('37000000-0000-4000-8000-000000000001'::uuid, 1::bigint, 4::bigint, 1) $$,
  'claim returns the oldest job and increments its attempt exactly once'
);
select results_eq(
  $$ select status, attempt_count, started_at is not null from private.event_moderation_evaluations where id = '37000000-0000-4000-8000-000000000001' $$,
  $$ values ('processing'::text, 1, true) $$,
  'claim persists processing state without exposing browser access'
);

select results_eq(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], 'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64)
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000001'
  $$,
  $$ values ('applied'::text) $$,
  'an exact current low-risk result applies'
);
select results_eq(
  $$ select moderation_status, moderated_revision, moderation_version from public.events where id = '27000000-0000-0000-0000-000000000001' $$,
  $$ values ('clear'::text, 1::bigint, 5::bigint) $$,
  'applying current clearance advances moderation state and version atomically'
);
select results_eq(
  $$ select status, outcome, risk_level, reason_codes, failure_code from private.event_moderation_evaluations where id = '37000000-0000-4000-8000-000000000001' $$,
  $$ values ('succeeded'::text, 'clear_candidate'::text, 'low'::text, array['no_violation']::text[], null::text) $$,
  'only the validated structured result is retained'
);
select results_eq(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], 'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64)
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000001'
  $$,
  $$ values ('already_applied'::text) $$,
  'duplicate apply is idempotent'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, repeat('f', 64),
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], null, null
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000001'
  $$,
  'P0001', 'MODERATION_EVALUATION_CONFLICT',
  'a terminal apply rejects a mismatched immutable input tuple'
);

reset role;
insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version,
  status, source, attempt_count, created_at
) values (
  '37000000-0000-4000-8000-000000000002',
  '27000000-0000-0000-0000-000000000001', 1,
  private.compute_event_input_sha256('27000000-0000-0000-0000-000000000001'),
  4, 'queued', 'report', 0, now()
);
set local role service_role;
select results_eq(
  $$ select evaluation_id from public.server_claim_moderation_evaluation('worker-a') $$,
  $$ values ('37000000-0000-4000-8000-000000000002'::uuid) $$,
  'a stale-version job may be claimed for durable supersession'
);
select results_eq(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], null, null
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000002'
  $$,
  $$ values ('superseded'::text) $$,
  'changed moderation version supersedes stale work'
);
select results_eq(
  $$ select status, failure_code from private.event_moderation_evaluations where id = '37000000-0000-4000-8000-000000000002' $$,
  $$ values ('superseded'::text, 'STALE_EVALUATION'::text) $$,
  'stale work retains only a bounded safe supersession code'
);

reset role;
insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version,
  status, source, attempt_count, created_at
) values (
  '37000000-0000-4000-8000-000000000003',
  '27000000-0000-0000-0000-000000000002', 1,
  private.compute_event_input_sha256('27000000-0000-0000-0000-000000000002'),
  7, 'queued', 'contextual', 0, now()
);
set local role service_role;
select results_eq(
  $$ select evaluation_id from public.server_claim_moderation_evaluation('worker-a') $$,
  $$ values ('37000000-0000-4000-8000-000000000003'::uuid) $$,
  'blocked event work can be claimed without granting release authority'
);
select results_eq(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], null, null
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000003'
  $$,
  $$ values ('superseded'::text) $$,
  'automation cannot release a blocked event'
);
select results_eq(
  $$ select moderation_status, moderation_version from public.events where id = '27000000-0000-0000-0000-000000000002' $$,
  $$ values ('blocked'::text, 7::bigint) $$,
  'blocked enforcement remains unchanged'
);

reset role;
insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version,
  status, source, attempt_count, created_at
) values (
  '37000000-0000-4000-8000-000000000004',
  '27000000-0000-0000-0000-000000000003', 1,
  private.compute_event_input_sha256('27000000-0000-0000-0000-000000000003'),
  9, 'queued', 'contextual', 0, now()
);
set local role service_role;
select results_eq(
  $$ select evaluation_id from public.server_claim_moderation_evaluation('worker-a') $$,
  $$ values ('37000000-0000-4000-8000-000000000004'::uuid) $$,
  'removed event work can be claimed without granting restore authority'
);
select results_eq(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], null, null
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  $$ values ('superseded'::text) $$,
  'automation cannot restore a removed event'
);
select results_eq(
  $$ select moderation_status, moderation_version from public.events where id = '27000000-0000-0000-0000-000000000003' $$,
  $$ values ('removed'::text, 9::bigint) $$,
  'removed enforcement remains unchanged'
);

select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'unknown', 'low',
      array['no_violation'], null, null
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'malformed outcomes are rejected before mutation'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'high',
      array['no_violation'], null, null
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'incoherent structured results are rejected'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, null, 'low',
      array['no_violation'], null, null
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'null moderation outcomes are rejected explicitly'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', null,
      array['no_violation'], null, null
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'null moderation risk levels are rejected explicitly'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'review_required', 'high',
      array['no_violation'], null, null
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'held outcomes cannot include the clear-only reason code'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], 'synthetic@example.invalid', null
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'provider metadata must use opaque identifiers'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], 'provider/has whitespace', null
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'provider metadata rejects prose and whitespace'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], 'provider/opaque' || chr(10) || 'ref', null
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'provider metadata rejects line breaks'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], 'provider/sk_live_abcdef0123456789', 'provider/model-v1'
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'provider metadata rejects token-like identifiers'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], 'provider/opaque-ref', 'provider/model-v1'
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'direct service calls reject raw metadata even when it looks opaque'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'clear_candidate', 'low',
      array['no_violation'], 'provider/opaque-ref', 'provider/input excerpt'
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'model metadata rejects input excerpts'
);
select throws_ok(
  $$
    select public.server_apply_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'review_required', 'high',
      array['not-approved'], null, null
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000004'
  $$,
  '22023', 'MODERATION_RESULT_INVALID',
  'unbounded reason codes are rejected before persistence'
);

reset role;
insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version,
  status, source, attempt_count, created_at
) values (
  '37000000-0000-4000-8000-000000000005',
  '27000000-0000-0000-0000-000000000002', 1,
  private.compute_event_input_sha256('27000000-0000-0000-0000-000000000002'),
  7, 'queued', 'report', 2, now()
);
set local role service_role;

select results_eq(
  $$ select evaluation_id, attempt_count from public.server_claim_moderation_evaluation('worker-a') $$,
  $$ values ('37000000-0000-4000-8000-000000000005'::uuid, 3) $$,
  'the third and final attempt can be claimed'
);
select results_eq(
  $$
    select public.server_fail_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'MODERATOR_TIMEOUT'
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000005'
  $$,
  $$ values ('failed'::text) $$,
  'the third failed attempt is terminal'
);
select results_eq(
  $$ select status, attempt_count, failure_code, finished_at is not null from private.event_moderation_evaluations where id = '37000000-0000-4000-8000-000000000005' $$,
  $$ values ('failed'::text, 3, 'MODERATOR_TIMEOUT'::text, true) $$,
  'retry exhaustion persists only bounded terminal facts'
);
select results_eq(
  $$
    select public.server_fail_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'MODERATOR_TIMEOUT'
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000005'
  $$,
  $$ values ('failed'::text) $$,
  'an exact terminal failure retry is idempotent'
);
select throws_ok(
  $$
    select public.server_fail_moderation_evaluation(
      evaluations.id, evaluations.content_revision, repeat('e', 64),
      evaluations.queued_moderation_version, 'MODERATOR_TIMEOUT'
    ) from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000005'
  $$,
  'P0001', 'MODERATION_EVALUATION_CONFLICT',
  'a terminal failure rejects a mismatched immutable input tuple'
);
select throws_ok(
  $$
    select public.server_fail_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version,
      'provider said the entire raw response here'
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000005'
  $$,
  '22023', 'MODERATION_FAILURE_INVALID',
  'raw provider prose cannot be used as a failure code'
);

reset role;
insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version,
  status, source, attempt_count, created_at
) values (
  '37000000-0000-4000-8000-000000000006',
  '27000000-0000-0000-0000-000000000003', 1,
  private.compute_event_input_sha256('27000000-0000-0000-0000-000000000003'),
  9, 'queued', 'report', 0, now()
);
set local role service_role;
select results_eq(
  $$ select evaluation_id from public.server_claim_moderation_evaluation('worker-b') $$,
  $$ values ('37000000-0000-4000-8000-000000000006'::uuid) $$,
  'a retryable job is claimed once'
);
select results_eq(
  $$
    select public.server_fail_moderation_evaluation(
      evaluations.id, evaluations.content_revision, evaluations.input_sha256,
      evaluations.queued_moderation_version, 'MODERATOR_UNAVAILABLE'
    )
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '37000000-0000-4000-8000-000000000006'
  $$,
  $$ values ('retry_scheduled'::text) $$,
  'a bounded pre-terminal failure is requeued'
);
select results_eq(
  $$ select status, attempt_count, started_at, finished_at, failure_code from private.event_moderation_evaluations where id = '37000000-0000-4000-8000-000000000006' $$,
  $$ values ('queued'::text, 1, null::timestamptz, null::timestamptz, 'MODERATOR_UNAVAILABLE'::text) $$,
  'retry scheduling clears lease timestamps while retaining a safe code'
);

reset role;
update private.event_moderation_evaluations
set status = 'processing',
    created_at = statement_timestamp() - interval '10 minutes',
    started_at = statement_timestamp() - interval '6 minutes'
where id = '37000000-0000-4000-8000-000000000006';
set local role service_role;
select results_eq(
  $$ select evaluation_id, attempt_count from public.server_claim_moderation_evaluation('worker-lease') $$,
  $$ values ('37000000-0000-4000-8000-000000000006'::uuid, 2) $$,
  'an expired lease is reclaimed exactly once with its next bounded attempt'
);
select results_eq(
  $$ select status, attempt_count, started_at > statement_timestamp() - interval '1 minute' from private.event_moderation_evaluations where id = '37000000-0000-4000-8000-000000000006' $$,
  $$ values ('processing'::text, 2, true) $$,
  'reclaim renews the lease without resetting its attempt count'
);
reset role;
update private.event_moderation_evaluations
set attempt_count = 3, started_at = statement_timestamp() - interval '6 minutes'
where id = '37000000-0000-4000-8000-000000000006';
set local role service_role;
select results_eq(
  $$ select count(*)::bigint from public.server_claim_moderation_evaluation('worker-cleanup') $$,
  $$ values (0::bigint) $$,
  'expired final leases are cleaned without producing more work'
);
select results_eq(
  $$ select status, attempt_count, failure_code from private.event_moderation_evaluations where id = '37000000-0000-4000-8000-000000000006' $$,
  $$ values ('failed'::text, 3, 'MODERATOR_LEASE_EXPIRED'::text) $$,
  'an expired final lease becomes a bounded terminal failure rather than stranding'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_actions
    where evaluation_id = '37000000-0000-4000-8000-000000000001'
      and action = 'clear'
  $$,
  $$ values (1::bigint) $$,
  'one successful result creates exactly one immutable action'
);
select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_actions
    where evaluation_id in (
      '37000000-0000-4000-8000-000000000003',
      '37000000-0000-4000-8000-000000000004'
    )
  $$,
  $$ values (0::bigint) $$,
  'superseded enforcement-state results create no action'
);

reset role;
select * from finish();
rollback;
