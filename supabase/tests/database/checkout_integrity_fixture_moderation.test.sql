begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_function(
  'public',
  'server_claim_checkout_integrity_fixture_evaluation',
  array['uuid', 'text'],
  'Task 13 has one service-only exact-fixture moderation claim boundary'
);

select results_eq(
  $$
    select
      has_function_privilege(
        'anon',
        'public.server_claim_checkout_integrity_fixture_evaluation(uuid,text)',
        'EXECUTE'
      ),
      has_function_privilege(
        'authenticated',
        'public.server_claim_checkout_integrity_fixture_evaluation(uuid,text)',
        'EXECUTE'
      ),
      has_function_privilege(
        'service_role',
        'public.server_claim_checkout_integrity_fixture_evaluation(uuid,text)',
        'EXECUTE'
      )
  $$,
  $$ values (false, false, true) $$,
  'only service_role can claim the exact development fixture evaluation'
);

update private.organizer_policy_release_settings
set environment = 'development'
where singleton_id;

update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;

insert into auth.users (id, email)
values (
  'aa135000-0000-4000-8000-000000000001',
  'task17_scopedtest01@example.invalid'
);

insert into public.organizers (id, display_name)
values (
  'aa135000-0000-4000-8000-000000000001',
  'task17_scopedtest01'
);

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, timezone, venue_name, address_line1, city, region,
  postal_code, country_code, mapbox_feature_id, latitude, longitude,
  admission_type, capacity, published_at, content_revision, moderated_revision,
  moderation_version, public_history_status, first_publicly_eligible_at
)
values
  (
    'aa135000-0000-4000-8000-000000000002',
    'aa135000-0000-4000-8000-000000000001',
    'published', 'under_review', 'task17_scopedtest01 transaction',
    'Exact Task 13 fixture held for scoped moderation recovery.', 'music',
    statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days 4 hours',
    'America/Los_Angeles', 'Fixture Hall', '1 Fixture Way', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.task13-scoped-fixture',
    37.7936, -122.3958, 'paid', 10, statement_timestamp(),
    2, null, 4, 'never_public', null
  ),
  (
    'aa135000-0000-4000-8000-000000000003',
    'aa135000-0000-4000-8000-000000000001',
    'published', 'under_review', 'Unrelated event',
    'A second event that the fixture boundary must never claim.', 'music',
    statement_timestamp() + interval '8 days',
    statement_timestamp() + interval '8 days 4 hours',
    'America/Los_Angeles', 'Other Hall', '2 Fixture Way', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.task13-other-event',
    37.7937, -122.3959, 'paid', 10, statement_timestamp(),
    2, null, 4, 'never_public', null
  );

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present,
  high_risk_activity
)
select id, 'all_ages', false, false, false, false, false, false
from public.events
where id in (
  'aa135000-0000-4000-8000-000000000002',
  'aa135000-0000-4000-8000-000000000003'
);

insert into private.event_moderation_evaluations (
  id, event_id, content_revision, input_sha256, queued_moderation_version,
  status, source, attempt_count
)
values
  (
    'aa135000-0000-4000-8000-000000000004',
    'aa135000-0000-4000-8000-000000000002', 2,
    private.compute_event_input_sha256(
      'aa135000-0000-4000-8000-000000000002'
    ),
    4, 'queued', 'contextual', 0
  ),
  (
    'aa135000-0000-4000-8000-000000000005',
    'aa135000-0000-4000-8000-000000000003', 2,
    private.compute_event_input_sha256(
      'aa135000-0000-4000-8000-000000000003'
    ),
    4, 'queued', 'contextual', 0
  );

select set_config(
  'request.jwt.claim.sub',
  'aa135000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.list_moderation_queue(10) $$,
  'P0001',
  'STAFF_ROLE_REQUIRED',
  'the fixture organizer has no global moderation queue access'
);

select throws_ok(
  $$
    select *
    from public.server_claim_checkout_integrity_fixture_evaluation(
      'aa135000-0000-4000-8000-000000000002',
      'task17_scopedtest01'
    )
  $$,
  '42501',
  null,
  'the authenticated fixture organizer cannot execute the service boundary'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    select *
    from public.server_claim_checkout_integrity_fixture_evaluation(
      'aa135000-0000-4000-8000-000000000003',
      'task17_scopedtest01'
    )
  $$,
  'P0001',
  'FIXTURE_MODERATION_TARGET_INVALID',
  'the exact fixture boundary rejects another event owned by the organizer'
);

select throws_ok(
  $$
    select *
    from public.server_claim_checkout_integrity_fixture_evaluation(
      'aa135000-0000-4000-8000-000000000002',
      'task17_wrongtarget1'
    )
  $$,
  'P0001',
  'FIXTURE_MODERATION_TARGET_INVALID',
  'the exact fixture boundary rejects a mismatched namespace'
);

create temporary table task13_claimed_evaluation (
  evaluation_id uuid,
  event_id uuid,
  content_revision bigint,
  input_sha256 text,
  queued_moderation_version bigint
) on commit drop;

insert into task13_claimed_evaluation
select *
from public.server_claim_checkout_integrity_fixture_evaluation(
  'aa135000-0000-4000-8000-000000000002',
  'task17_scopedtest01'
);

select results_eq(
  $$
    select evaluation_id, content_revision, queued_moderation_version
    from task13_claimed_evaluation
  $$,
  $$
    values (
      'aa135000-0000-4000-8000-000000000004'::uuid,
      2::bigint,
      4::bigint
    )
  $$,
  'the service boundary claims only the exact current fixture evaluation'
);

reset role;

select results_eq(
  $$
    select status, attempt_count
    from private.event_moderation_evaluations
    where id in (
      'aa135000-0000-4000-8000-000000000004',
      'aa135000-0000-4000-8000-000000000005'
    )
    order by id
  $$,
  $$ values ('processing'::text, 1), ('queued'::text, 0) $$,
  'claiming the fixture does not mutate another event evaluation'
);

set local role service_role;

select results_eq(
  $$
    select public.server_apply_moderation_evaluation(
      claimed.evaluation_id,
      claimed.content_revision,
      claimed.input_sha256,
      claimed.queued_moderation_version,
      'clear_candidate',
      'low',
      array['no_violation'],
      null,
      null
    )
    from task13_claimed_evaluation as claimed
  $$,
  $$ values ('applied'::text) $$,
  'the existing exact moderation apply boundary records fixture clearance'
);

reset role;

select results_eq(
  $$
    select
      (select count(*) from private.staff_roles where user_id =
        'aa135000-0000-4000-8000-000000000001'),
      (select count(*) from private.event_moderation_actions where event_id =
        'aa135000-0000-4000-8000-000000000002' and source = 'evaluation'
        and action = 'clear'),
      (select count(*) from private.event_moderation_actions where event_id =
        'aa135000-0000-4000-8000-000000000003')
  $$,
  $$ values (0::bigint, 1::bigint, 0::bigint) $$,
  'the scoped path creates immutable audit evidence without any staff role or cross-event action'
);

select set_config(
  'request.jwt.claim.sub',
  'aa135000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.save_owned_event_revision(
      'aa135000-0000-4000-8000-000000000002',
      (
        select jsonb_build_object(
          'title', events.title,
          'description', events.description,
          'category', events.category,
          'starts_at', statement_timestamp() + interval '30 days',
          'ends_at', statement_timestamp() + interval '30 days 4 hours',
          'timezone', events.timezone,
          'venue_name', events.venue_name,
          'address_line1', events.address_line1,
          'address_line2', events.address_line2,
          'city', events.city,
          'region', events.region,
          'postal_code', events.postal_code,
          'country_code', events.country_code,
          'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude,
          'longitude', events.longitude,
          'admission_type', events.admission_type,
          'capacity', events.capacity
        )
        from public.events as events
        where events.id = 'aa135000-0000-4000-8000-000000000002'
      )
    )
  $$,
  'the owner can revise the schedule only after the queued fixture evaluation is resolved'
);

reset role;

select results_eq(
  $$
    select
      events.moderation_status,
      events.content_revision,
      events.moderated_revision,
      (select status from private.event_moderation_evaluations where id =
        'aa135000-0000-4000-8000-000000000004'),
      (select status from private.event_moderation_evaluations where id =
        'aa135000-0000-4000-8000-000000000005'),
      (select count(*) from private.staff_roles where user_id =
        'aa135000-0000-4000-8000-000000000001')
    from public.events as events
    where events.id = 'aa135000-0000-4000-8000-000000000002'
  $$,
  $$ values ('clear'::text, 3::bigint, 3::bigint, 'succeeded'::text, 'queued'::text, 0::bigint) $$,
  'post-moderation schedule revision preserves the cleared fixture and unrelated queue state'
);

select * from finish();
rollback;
