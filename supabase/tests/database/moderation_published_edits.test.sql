begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

select has_function(
  'public',
  'save_owned_event_revision',
  array['uuid', 'jsonb'],
  'published event saves use one owner-authenticated revision RPC'
);
select has_function(
  'public',
  'save_owned_event_requirements',
  array['uuid', 'jsonb'],
  'risk disclosures use one owner-authenticated revision RPC'
);
select has_function(
  'public',
  'save_owned_organizer_profile',
  array['jsonb'],
  'organizer public-name edits use one owner-authenticated revision RPC'
);

select results_eq(
  $$
    select
      pg_catalog.has_function_privilege('anon', 'public.save_owned_event_revision(uuid,jsonb)', 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', 'public.save_owned_event_revision(uuid,jsonb)', 'EXECUTE'),
      pg_catalog.has_function_privilege('anon', 'public.save_owned_event_requirements(uuid,jsonb)', 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', 'public.save_owned_event_requirements(uuid,jsonb)', 'EXECUTE'),
      pg_catalog.has_function_privilege('anon', 'public.save_owned_organizer_profile(jsonb)', 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', 'public.save_owned_organizer_profile(jsonb)', 'EXECUTE')
  $$,
  $$ values (false, true, false, true, false, true) $$,
  'only authenticated organizers can execute the three mutation boundaries'
);
select results_eq(
  $$
    select
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.save_owned_event_revision_without_value_validation(uuid,jsonb)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role',
        'public.save_owned_event_revision_without_value_validation(uuid,jsonb)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.save_owned_organizer_profile_without_value_validation(jsonb)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role',
        'public.save_owned_organizer_profile_without_value_validation(jsonb)',
        'EXECUTE'
      )
  $$,
  $$ values (false, false, false, false) $$,
  'renamed coercing implementations have no browser or service execution path'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc
    where oid in (
      'public.save_owned_event_revision(uuid,jsonb)'::regprocedure,
      'public.save_owned_event_requirements(uuid,jsonb)'::regprocedure,
      'public.save_owned_organizer_profile(jsonb)'::regprocedure
    )
      and proconfig @> array['search_path=""']::text[]
  $$,
  $$ values (3::bigint) $$,
  'all organizer mutation boundaries have empty search paths'
);

insert into auth.users (id, email)
values
  ('16000000-0000-0000-0000-000000000001', 'published-edits-owner@example.invalid'),
  ('16000000-0000-0000-0000-000000000002', 'published-edits-other@example.invalid');

insert into public.organizers (
  id, display_name, organizer_type, bio, website_url, base_city,
  country_code, onboarding_completed_at
)
values
  (
    '16000000-0000-0000-0000-000000000001', 'Revision Owner', 'Community group',
    'Private organizer bio', 'https://revision-owner.example', 'San Francisco',
    'US', now()
  ),
  (
    '16000000-0000-0000-0000-000000000002', 'Other Owner', 'Venue',
    null, null, 'Oakland', 'US', now()
  );

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, timezone, venue_name, address_line1, address_line2, city,
  region, postal_code, country_code, mapbox_feature_id, latitude, longitude,
  admission_type, capacity, published_at, moderated_revision,
  public_history_status, first_publicly_eligible_at
)
values
  (
    '26000000-0000-0000-0000-000000000001',
    '16000000-0000-0000-0000-000000000001',
    'draft', 'not_evaluated', 'Revision Event One',
    'A complete low-risk event used to prove safe published edits.', 'community',
    now() + interval '2 days', now() + interval '2 days 2 hours',
    'America/Los_Angeles', 'Revision Venue', '1 Market Street', null,
    'San Francisco', 'CA', '94105', 'US', 'mapbox.revision-event-one',
    37.7936, -122.3958, 'free', 100, null, null, 'never_public', null
  ),
  (
    '26000000-0000-0000-0000-000000000002',
    '16000000-0000-0000-0000-000000000001',
    'published', 'blocked', 'Blocked Revision Event',
    'A blocked event whose enforcement survives organizer edits.', 'community',
    now() + interval '3 days', now() + interval '3 days 2 hours',
    'America/Los_Angeles', 'Blocked Venue', '2 Market Street', null,
    'San Francisco', 'CA', '94105', 'US', 'mapbox.blocked-revision-event',
    37.7936, -122.3958, 'free', 80, now(), 1, 'never_public', null
  ),
  (
    '26000000-0000-0000-0000-000000000003',
    '16000000-0000-0000-0000-000000000001',
    'published', 'removed', 'Removed Revision Event',
    'A removed event whose enforcement survives organizer edits.', 'community',
    now() + interval '4 days', now() + interval '4 days 2 hours',
    'America/Los_Angeles', 'Removed Venue', '3 Market Street', null,
    'San Francisco', 'CA', '94105', 'US', 'mapbox.removed-revision-event',
    37.7936, -122.3958, 'free', 70, now(), 1,
    'previously_public', now() - interval '1 day'
  ),
  (
    '26000000-0000-0000-0000-000000000004',
    '16000000-0000-0000-0000-000000000001',
    'published', 'clear', 'Tier Revision Event',
    'A paid event fixture used to distinguish public tier text from inventory.', 'music',
    now() + interval '5 days', now() + interval '5 days 2 hours',
    'America/Los_Angeles', 'Tier Venue', '4 Market Street', null,
    'San Francisco', 'CA', '94105', 'US', 'mapbox.tier-revision-event',
    37.7936, -122.3958, 'paid', null, now(), 1, 'never_public', null
  ),
  (
    '26000000-0000-0000-0000-000000000005',
    '16000000-0000-0000-0000-000000000001',
    'cancelled', 'under_review', 'Cancelled Revision Event',
    'A cancelled event excluded from organizer identity invalidation.', 'community',
    now() + interval '6 days', now() + interval '6 days 2 hours',
    'America/Los_Angeles', 'Cancelled Venue', '5 Market Street', null,
    'San Francisco', 'CA', '94105', 'US', 'mapbox.cancelled-revision-event',
    37.7936, -122.3958, 'free', 50, now(), null, 'never_public', null
  ),
  (
    '26000000-0000-0000-0000-000000000006',
    '16000000-0000-0000-0000-000000000002',
    'published', 'clear', 'Other Owner Revision Event',
    'An unrelated organizer event that must never be invalidated.', 'community',
    now() + interval '2 days', now() + interval '2 days 2 hours',
    'America/Los_Angeles', 'Other Venue', '6 Market Street', null,
    'Oakland', 'CA', '94607', 'US', 'mapbox.other-revision-event',
    37.8044, -122.2712, 'free', 40, now(), 1, 'never_public', null
  ),
  (
    '26000000-0000-0000-0000-000000000007',
    '16000000-0000-0000-0000-000000000001',
    'published', 'clear', 'Deterministic Revision Event',
    'A cleared event used to prove deterministic-only edit handling.', 'community',
    now() + interval '3 days', now() + interval '3 days 2 hours',
    'America/Los_Angeles', 'Deterministic Venue', '7 Market Street', null,
    'San Francisco', 'CA', '94105', 'US', 'mapbox.deterministic-revision-event',
    37.7936, -122.3958, 'free', 35, now(), 1, 'never_public', null
  ),
  (
    '26000000-0000-0000-0000-000000000008',
    '16000000-0000-0000-0000-000000000002',
    'draft', 'not_evaluated', 'Not Evaluated Revision Event',
    'A draft event used to prove deterministic edits retain current work.', 'community',
    now() + interval '4 days', now() + interval '4 days 2 hours',
    'America/Los_Angeles', 'Pending Venue', '8 Market Street', null,
    'Oakland', 'CA', '94607', 'US', 'mapbox.pending-revision-event',
    37.8044, -122.2712, 'free', 25, null, null, 'never_public', null
  ),
  (
    '26000000-0000-0000-0000-000000000009',
    '16000000-0000-0000-0000-000000000002',
    'published', 'clear', 'Active Deterministic Revision Event',
    'An active cleared event used to prove canonical schedule validation.', 'community',
    now() - interval '1 hour', now() + interval '2 hours',
    'America/Los_Angeles', 'Active Venue', '9 Market Street', null,
    'Oakland', 'CA', '94607', 'US', 'mapbox.active-revision-event',
    37.8044, -122.2712, 'free', 30, now() - interval '2 hours', 1,
    'never_public', null
  );

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
select id, 'all_ages', false, false, false, false, false, false
from public.events
where id between
  '26000000-0000-0000-0000-000000000001'::uuid
  and '26000000-0000-0000-0000-000000000009'::uuid;

insert into public.ticket_tiers (
  id, event_id, name, description, unit_amount_minor, quantity_total, status, sort_order
)
values (
  '36000000-0000-4000-8000-000000000001',
  '26000000-0000-0000-0000-000000000004',
  'General Admission', 'Original public tier copy', 2000, 100, 'active', 1
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$ select public.accept_current_event_policies('26000000-0000-0000-0000-000000000001') $$,
  'the initial low-risk revision can be accepted'
);
select lives_ok(
  $$ select public.publish_event('26000000-0000-0000-0000-000000000001') $$,
  'the accepted low-risk fixture publishes and becomes eligible'
);

select throws_ok(
  $$ select public.save_owned_event_revision('26000000-0000-0000-0000-000000000006', '{}'::jsonb) $$,
  'P0001', 'EVENT_NOT_FOUND',
  'another organizer event is authorization-safe not found before payload detail leaks'
);
select throws_ok(
  $$ select public.save_owned_event_revision('26000000-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  'P0001', 'EVENT_REVISION_INVALID',
  'missing event snapshot keys are rejected'
);
select throws_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'title', 'Revision Event One', 'description', 'A complete low-risk event used to prove safe published edits.',
        'category', 'community', 'starts_at', now() + interval '2 days',
        'ends_at', now() + interval '2 days 2 hours', 'timezone', 'America/Los_Angeles',
        'venue_name', 'Revision Venue', 'address_line1', '1 Market Street',
        'address_line2', null, 'city', 'San Francisco', 'region', 'CA',
        'postal_code', '94105', 'country_code', 'US',
        'mapbox_feature_id', 'mapbox.revision-event-one', 'latitude', 37.7936,
        'longitude', -122.3958, 'admission_type', 'free', 'capacity', 100,
        'moderation_status', 'clear'
      )
    )
  $$,
  'P0001', 'EVENT_REVISION_INVALID',
  'unknown or server-controlled event keys are rejected'
);

create temporary table valid_event_payload on commit drop as
select jsonb_build_object(
  'title', events.title, 'description', events.description,
  'category', events.category, 'starts_at', events.starts_at,
  'ends_at', events.ends_at, 'timezone', events.timezone,
  'venue_name', events.venue_name, 'address_line1', events.address_line1,
  'address_line2', events.address_line2, 'city', events.city,
  'region', events.region, 'postal_code', events.postal_code,
  'country_code', events.country_code, 'mapbox_feature_id', events.mapbox_feature_id,
  'latitude', events.latitude, 'longitude', events.longitude,
  'admission_type', events.admission_type, 'capacity', events.capacity
) as payload
from public.events as events
where events.id = '26000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.save_owned_event_revision('26000000-0000-0000-0000-000000000001', '[]'::jsonb) $$,
  'P0001', 'EVENT_REVISION_INVALID',
  'an event snapshot array is rejected before record coercion'
);
select throws_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000001',
      jsonb_set(payload, '{title}', '{}'::jsonb)
    )
    from valid_event_payload
  $$,
  'P0001', 'EVENT_REVISION_INVALID',
  'an object-valued event text field is rejected instead of coerced'
);
select throws_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000001',
      jsonb_set(payload, '{latitude}', '"37.7936"'::jsonb)
    )
    from valid_event_payload
  $$,
  'P0001', 'EVENT_REVISION_INVALID',
  'a string-valued event number is rejected instead of coerced'
);
select throws_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000001',
      jsonb_set(payload, '{timezone}', 'null'::jsonb)
    )
    from valid_event_payload
  $$,
  'P0001', 'EVENT_REVISION_INVALID',
  'JSON null is rejected for a non-null event snapshot field'
);

create temporary table event_one_before on commit drop as
select content_revision, moderation_version, public_eligibility_version,
       publicly_authorized_action_id, starts_at, ends_at
from public.events where id = '26000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'title', 'Revision Event One Updated',
        'description', 'A complete low-risk event used to prove safe published edits.',
        'category', 'community',
        'starts_at', (select starts_at from event_one_before),
        'ends_at', (select ends_at from event_one_before),
        'timezone', 'America/Los_Angeles', 'venue_name', 'Revision Venue',
        'address_line1', '1 Market Street', 'address_line2', null,
        'city', 'San Francisco', 'region', 'CA', 'postal_code', '94105',
        'country_code', 'US', 'mapbox_feature_id', 'mapbox.revision-event-one',
        'latitude', 37.7936, 'longitude', -122.3958,
        'admission_type', 'free', 'capacity', 100
      )
    )
  $$,
  'a full-review field can be edited through the owned RPC'
);

reset role;

select results_eq(
  $$
    select content_revision, moderation_version, moderation_status,
           moderated_revision, publicly_authorized_revision,
           publicly_authorized_action_id is null,
           public_eligibility_version
    from public.events
    where id = '26000000-0000-0000-0000-000000000001'
  $$,
  $$
    select content_revision + 1, moderation_version + 1, 'under_review'::text,
           null::bigint, null::bigint, true, public_eligibility_version + 1
    from event_one_before
  $$,
  'a full-review edit increments once, holds atomically, invalidates authorization, and closes eligibility'
);
select results_eq(
  $$
    select action, previous_status, new_status, source, actor_type,
           previous_content_revision, content_revision
    from private.event_moderation_actions
    where event_id = '26000000-0000-0000-0000-000000000001'
      and source = 'edit'
    order by created_at desc, id desc limit 1
  $$,
  $$ values ('hold'::text, 'clear'::text, 'under_review'::text, 'edit'::text,
             'organizer'::text, 1::bigint, 2::bigint) $$,
  'the full-review edit writes an exact immutable hold action'
);
select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_evaluations
    where event_id = '26000000-0000-0000-0000-000000000001'
      and content_revision = 2 and status = 'queued' and source = 'contextual'
  $$,
  $$ values (1::bigint) $$,
  'the new full-review revision has one current contextual job'
);
select results_eq(
  $$
    select count(*)::bigint
    from private.event_policy_acceptances
    where event_id = '26000000-0000-0000-0000-000000000001'
      and content_revision = 2
  $$,
  $$ values (0::bigint) $$,
  'the previous revision acceptance is immutable and cannot authorize the edit'
);

insert into private.event_reports (
  event_id, content_revision, input_sha256, reporter_fingerprint, reason
)
select
  events.id,
  events.content_revision,
  private.compute_event_input_sha256(events.id),
  repeat('a', 64),
  'unsafe'
from public.events as events
where events.id = '26000000-0000-0000-0000-000000000001';

insert into private.moderation_review_requests (
  event_id, organizer_id, content_revision, input_sha256, requested_action_id
)
select
  events.id,
  events.organizer_id,
  events.content_revision,
  private.compute_event_input_sha256(events.id),
  actions.id
from public.events as events
join lateral (
  select actions.id
  from private.event_moderation_actions as actions
  where actions.event_id = events.id and actions.source = 'edit'
  order by actions.created_at desc, actions.id desc
  limit 1
) as actions on true
where events.id = '26000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_event_requirements(
      '26000000-0000-0000-0000-000000000001',
      '{"minimum_age":"21_plus","alcohol_present":true,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false}'::jsonb
    )
  $$,
  'a changed requirements snapshot invalidates the current revision once'
);
reset role;

select results_eq(
  $$ select content_revision, moderation_status from public.events where id = '26000000-0000-0000-0000-000000000001' $$,
  $$ values (3::bigint, 'under_review'::text) $$,
  'requirements changes advance the revision and preserve an existing hold'
);
select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_evaluations
    where event_id = '26000000-0000-0000-0000-000000000001'
      and content_revision = 2 and status = 'superseded'
  $$,
  $$ values (1::bigint) $$,
  'a rapid later edit supersedes the older queued evaluation'
);
select results_eq(
  $$
    select
      (select status from private.event_reports
       where event_id = '26000000-0000-0000-0000-000000000001'),
      (select status from private.moderation_review_requests
       where event_id = '26000000-0000-0000-0000-000000000001')
  $$,
  $$ values ('superseded'::text, 'superseded'::text) $$,
  'a new material revision supersedes old open reports and review requests'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000001',
      (
        select jsonb_build_object(
          'title', events.title, 'description', events.description,
          'category', events.category, 'starts_at', events.starts_at + interval '5 minutes',
          'ends_at', events.ends_at + interval '5 minutes', 'timezone', events.timezone,
          'venue_name', events.venue_name, 'address_line1', events.address_line1,
          'address_line2', events.address_line2, 'city', events.city,
          'region', events.region, 'postal_code', events.postal_code,
          'country_code', events.country_code, 'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude, 'longitude', events.longitude,
          'admission_type', events.admission_type, 'capacity', events.capacity
        )
        from public.events as events
        where events.id = '26000000-0000-0000-0000-000000000001'
      )
    )
  $$,
  'a deterministic edit can replace work for an event already under review'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_evaluations
    where event_id = '26000000-0000-0000-0000-000000000001'
      and content_revision = 3
      and status = 'superseded'
  $$,
  $$ values (1::bigint) $$,
  'the deterministic rapid edit supersedes the stale prior-revision job'
);
select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_evaluations
    where event_id = '26000000-0000-0000-0000-000000000001'
      and content_revision = 4
      and status = 'queued'
      and source = 'contextual'
  $$,
  $$ values (1::bigint) $$,
  'an under-review deterministic edit enqueues exactly one current contextual job'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000008',
      (
        select jsonb_build_object(
          'title', events.title, 'description', events.description,
          'category', events.category, 'starts_at', events.starts_at + interval '5 minutes',
          'ends_at', events.ends_at + interval '5 minutes', 'timezone', events.timezone,
          'venue_name', events.venue_name, 'address_line1', events.address_line1,
          'address_line2', events.address_line2, 'city', events.city,
          'region', events.region, 'postal_code', events.postal_code,
          'country_code', events.country_code, 'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude, 'longitude', events.longitude,
          'admission_type', events.admission_type, 'capacity', events.capacity
        )
        from public.events as events
        where events.id = '26000000-0000-0000-0000-000000000008'
      )
    )
  $$,
  'a deterministic edit of not-evaluated content enters the current review queue'
);
reset role;

select results_eq(
  $$
    select events.content_revision, events.moderation_status,
           count(evaluations.id)::bigint
    from public.events as events
    left join private.event_moderation_evaluations as evaluations
      on evaluations.event_id = events.id
      and evaluations.content_revision = events.content_revision
      and evaluations.status = 'queued'
      and evaluations.source = 'contextual'
    where events.id = '26000000-0000-0000-0000-000000000008'
    group by events.id
  $$,
  $$ values (2::bigint, 'under_review'::text, 1::bigint) $$,
  'not-evaluated deterministic edits hold and enqueue exactly one current contextual job'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$
    select public.save_owned_event_requirements(
      '26000000-0000-0000-0000-000000000001',
      '{"minimum_age":"21_plus"}'::jsonb
    )
  $$,
  'P0001', 'EVENT_REQUIREMENTS_INVALID',
  'missing requirements keys are rejected'
);
select throws_ok(
  $$
    select public.save_owned_event_requirements(
      '26000000-0000-0000-0000-000000000001',
      '{"minimum_age":"21_plus","alcohol_present":true,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false,"moderation_status":"clear"}'::jsonb
    )
  $$,
  'P0001', 'EVENT_REQUIREMENTS_INVALID',
  'unknown or server-controlled requirements keys are rejected'
);

select lives_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000002',
      jsonb_build_object(
        'title', 'Blocked Revision Event Updated',
        'description', 'A blocked event whose enforcement survives organizer edits.',
        'category', 'community', 'starts_at', now() + interval '3 days',
        'ends_at', now() + interval '3 days 2 hours', 'timezone', 'America/Los_Angeles',
        'venue_name', 'Blocked Venue', 'address_line1', '2 Market Street',
        'address_line2', null, 'city', 'San Francisco', 'region', 'CA',
        'postal_code', '94105', 'country_code', 'US',
        'mapbox_feature_id', 'mapbox.blocked-revision-event', 'latitude', 37.7936,
        'longitude', -122.3958, 'admission_type', 'free', 'capacity', 80
      )
    )
  $$,
  'blocked content can be edited without weakening enforcement'
);
select lives_ok(
  $$ select public.accept_current_event_policies('26000000-0000-0000-0000-000000000002') $$,
  'the exact new blocked revision can be accepted'
);
select lives_ok(
  $$ select public.publish_event('26000000-0000-0000-0000-000000000002') $$,
  'blocked re-publish may refresh authorization evidence'
);
reset role;

select results_eq(
  $$
    select content_revision, moderation_status, publicly_authorized_revision,
           private.event_has_current_public_eligibility(id)
    from public.events where id = '26000000-0000-0000-0000-000000000002'
  $$,
  $$ values (2::bigint, 'blocked'::text, 2::bigint, false) $$,
  'blocked edit, acceptance, and re-publish preserve blocked enforcement and ineligibility'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000003',
      jsonb_build_object(
        'title', 'Removed Revision Event Updated',
        'description', 'A removed event whose enforcement survives organizer edits.',
        'category', 'community', 'starts_at', now() + interval '4 days',
        'ends_at', now() + interval '4 days 2 hours', 'timezone', 'America/Los_Angeles',
        'venue_name', 'Removed Venue', 'address_line1', '3 Market Street',
        'address_line2', null, 'city', 'San Francisco', 'region', 'CA',
        'postal_code', '94105', 'country_code', 'US',
        'mapbox_feature_id', 'mapbox.removed-revision-event', 'latitude', 37.7936,
        'longitude', -122.3958, 'admission_type', 'free', 'capacity', 70
      )
    )
  $$,
  'removed content can be edited without weakening enforcement'
);
select lives_ok(
  $$ select public.accept_current_event_policies('26000000-0000-0000-0000-000000000003') $$,
  'the exact new removed revision can be accepted'
);
select lives_ok(
  $$ select public.publish_event('26000000-0000-0000-0000-000000000003') $$,
  'removed re-publish may refresh authorization evidence'
);
reset role;

select results_eq(
  $$
    select content_revision, moderation_status, publicly_authorized_revision,
           private.event_has_current_public_eligibility(id)
    from public.events where id = '26000000-0000-0000-0000-000000000003'
  $$,
  $$ values (2::bigint, 'removed'::text, 2::bigint, false) $$,
  'removed edit, acceptance, and re-publish preserve removed enforcement and ineligibility'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000007',
      jsonb_build_object(
        'title', 'Deterministic Revision Event',
        'description', 'A cleared event used to prove deterministic-only edit handling.',
        'category', 'community',
        'starts_at', (select starts_at from public.events where id = '26000000-0000-0000-0000-000000000007'),
        'ends_at', (select ends_at + interval '15 minutes' from public.events where id = '26000000-0000-0000-0000-000000000007'),
        'timezone', 'America/Los_Angeles', 'venue_name', 'Deterministic Venue',
        'address_line1', '7 Market Street', 'address_line2', null,
        'city', 'San Francisco', 'region', 'CA', 'postal_code', '94105',
        'country_code', 'US', 'mapbox_feature_id', 'mapbox.deterministic-revision-event',
        'latitude', 37.7936, 'longitude', -122.3958,
        'admission_type', 'free', 'capacity', 35
      )
    )
  $$,
  'a deterministic-only schedule edit runs through the owned revision boundary'
);
reset role;

select results_eq(
  $$
    select content_revision, moderation_version, moderation_status,
           moderated_revision, publicly_authorized_action_id is null
    from public.events
    where id = '26000000-0000-0000-0000-000000000007'
  $$,
  $$ values (2::bigint, 1::bigint, 'clear'::text, 2::bigint, true) $$,
  'a deterministic-only edit records a fresh clear revision but still invalidates agreement authorization'
);
select results_eq(
  $$
    select evaluations.status, evaluations.source, evaluations.outcome,
           actions.action, actions.previous_status, actions.new_status
    from private.event_moderation_evaluations as evaluations
    join private.event_moderation_actions as actions
      on actions.evaluation_id = evaluations.id
    where evaluations.event_id = '26000000-0000-0000-0000-000000000007'
      and evaluations.content_revision = 2
  $$,
  $$ values ('succeeded'::text, 'deterministic'::text, 'clear_candidate'::text,
             'clear'::text, 'clear'::text, 'clear'::text) $$,
  'deterministic-only clearance has a distinct evaluation and same-revision clear action'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000007',
      (
        select jsonb_build_object(
          'title', events.title, 'description', events.description,
          'category', events.category, 'starts_at', events.starts_at,
          'ends_at', events.ends_at, 'timezone', events.timezone,
          'venue_name', events.venue_name, 'address_line1', events.address_line1,
          'address_line2', events.address_line2, 'city', events.city,
          'region', events.region, 'postal_code', events.postal_code,
          'country_code', events.country_code, 'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude, 'longitude', -130,
          'admission_type', events.admission_type, 'capacity', events.capacity
        )
        from public.events as events
        where events.id = '26000000-0000-0000-0000-000000000007'
      )
    )
  $$,
  'an invalid deterministic location edit is saved without false clearance'
);
reset role;

select results_eq(
  $$
    select events.content_revision, events.moderation_status,
           evaluations.status, evaluations.source, evaluations.outcome,
           evaluations.reason_codes, actions.action, actions.reason_code
    from public.events as events
    join private.event_moderation_actions as actions
      on actions.event_id = events.id
      and actions.content_revision = events.content_revision
      and actions.source = 'edit'
    join private.event_moderation_evaluations as evaluations
      on evaluations.id = actions.evaluation_id
    where events.id = '26000000-0000-0000-0000-000000000007'
  $$,
  $$
    values (
      3::bigint, 'under_review'::text, 'succeeded'::text,
      'deterministic'::text, 'review_required'::text,
      array['location_invalid']::text[], 'hold'::text, 'location_invalid'::text
    )
  $$,
  'failed deterministic candidate facts hold with an accurate immutable audit result'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_event_revision(
      '26000000-0000-0000-0000-000000000009',
      (
        select jsonb_build_object(
          'title', events.title, 'description', events.description,
          'category', events.category, 'starts_at', events.starts_at,
          'ends_at', events.ends_at + interval '15 minutes', 'timezone', events.timezone,
          'venue_name', events.venue_name, 'address_line1', events.address_line1,
          'address_line2', events.address_line2, 'city', events.city,
          'region', events.region, 'postal_code', events.postal_code,
          'country_code', events.country_code, 'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude, 'longitude', events.longitude,
          'admission_type', events.admission_type, 'capacity', events.capacity
        )
        from public.events as events
        where events.id = '26000000-0000-0000-0000-000000000009'
      )
    )
  $$,
  'an active prior-clear event accepts a valid deterministic end-time edit'
);
reset role;

select results_eq(
  $$
    select events.content_revision, events.moderation_status,
           evaluations.outcome, actions.action
    from public.events as events
    join private.event_moderation_actions as actions
      on actions.event_id = events.id
      and actions.content_revision = events.content_revision
      and actions.source = 'edit'
    join private.event_moderation_evaluations as evaluations
      on evaluations.id = actions.evaluation_id
    where events.id = '26000000-0000-0000-0000-000000000009'
  $$,
  $$ values (2::bigint, 'clear'::text, 'clear_candidate'::text, 'clear'::text) $$,
  'canonical schedule validation keeps an active event clear while its end is future'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select * from public.save_ticket_tiers(
      '26000000-0000-0000-0000-000000000004',
      '[{"id":"36000000-0000-4000-8000-000000000001","name":"General Admission","description":"Original public tier copy","unit_amount_minor":2500,"currency":"usd","quantity_total":120,"sort_order":1}]'::jsonb
    )
  $$,
  'price and capacity-only tier edits remain allowed'
);
reset role;

select results_eq(
  $$ select content_revision from public.events where id = '26000000-0000-0000-0000-000000000004' $$,
  $$ values (1::bigint) $$,
  'price and capacity-only tier edits create no moderation churn'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select * from public.save_ticket_tiers(
      '26000000-0000-0000-0000-000000000004',
      '[{"id":"36000000-0000-4000-8000-000000000001","name":"Early Admission","description":"Changed public tier copy","unit_amount_minor":2500,"currency":"usd","quantity_total":120,"sort_order":1}]'::jsonb
    )
  $$,
  'tier public text edits remain allowed through the existing tier boundary'
);
reset role;

select results_eq(
  $$ select content_revision, moderation_status from public.events where id = '26000000-0000-0000-0000-000000000004' $$,
  $$ values (2::bigint, 'under_review'::text) $$,
  'tier name or description invalidates the parent event exactly once'
);

create temporary table organizer_event_revisions_before on commit drop as
select id, content_revision from public.events
where organizer_id = '16000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ select public.save_owned_organizer_profile('null'::jsonb) $$,
  'P0001', 'ORGANIZER_PROFILE_INVALID',
  'a null organizer snapshot is rejected'
);
select throws_ok(
  $$
    select public.save_owned_organizer_profile(
      '{"display_name":[],"organizer_type":"Community group","bio":null,"website_url":null,"base_city":"San Francisco","country_code":"US","onboarding_completed_at":null}'::jsonb
    )
  $$,
  'P0001', 'ORGANIZER_PROFILE_INVALID',
  'an array-valued organizer text field is rejected instead of coerced'
);
select throws_ok(
  $$
    select public.save_owned_organizer_profile(
      '{"display_name":"Revision Owner","organizer_type":"Community group","bio":null,"website_url":null,"base_city":"San Francisco","country_code":"US","onboarding_completed_at":123}'::jsonb
    )
  $$,
  'P0001', 'ORGANIZER_PROFILE_INVALID',
  'a numeric organizer timestamp is rejected instead of coerced'
);
reset role;

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_organizer_profile(
      '{"display_name":"Revision Owner Updated","organizer_type":"Community group","bio":"Private organizer bio changed","website_url":"https://revision-owner.example","base_city":"Oakland","country_code":"US","onboarding_completed_at":"2026-08-27T00:00:00Z"}'::jsonb
    )
  $$,
  'the owner profile boundary updates public and private organizer fields atomically'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from public.events as events
    join organizer_event_revisions_before as before on before.id = events.id
    where events.status <> 'cancelled'
      and events.content_revision = before.content_revision + 1
  $$,
  $$ values (5::bigint) $$,
  'a display-name change invalidates every non-cancelled owned event exactly once'
);
select results_eq(
  $$
    select events.content_revision = before.content_revision
    from public.events as events
    join organizer_event_revisions_before as before on before.id = events.id
    where events.id = '26000000-0000-0000-0000-000000000005'
  $$,
  $$ values (true) $$,
  'a display-name change leaves cancelled owned events untouched'
);
select results_eq(
  $$ select content_revision from public.events where id = '26000000-0000-0000-0000-000000000006' $$,
  $$ values (1::bigint) $$,
  'a display-name change leaves another organizer events untouched'
);

create temporary table organizer_private_revisions_before on commit drop as
select id, content_revision from public.events
where organizer_id = '16000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$
    update public.organizers
    set bio = 'A private biography update only', base_city = 'San Francisco'
    where id = '16000000-0000-0000-0000-000000000001'
  $$,
  'private organizer profile fields retain the narrow direct update path'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from public.events as events
    join organizer_private_revisions_before as before on before.id = events.id
    where events.content_revision <> before.content_revision
  $$,
  $$ values (0::bigint) $$,
  'private organizer fields create no moderation churn'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ update public.organizers set display_name = 'Bypass Attempt' where id = '16000000-0000-0000-0000-000000000001' $$,
  'P0001', 'ORGANIZER_PROFILE_RPC_REQUIRED',
  'direct display-name changes cannot bypass event revision invalidation'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from private.event_public_eligibility_intervals as intervals
    join public.events as events on events.id = intervals.event_id
    where intervals.ended_at is null
      and intervals.public_eligibility_version = events.public_eligibility_version
      and events.id between
        '26000000-0000-0000-0000-000000000001'::uuid
        and '26000000-0000-0000-0000-000000000009'::uuid
  $$,
  $$ values (9::bigint) $$,
  'every fixture retains exactly one current eligibility interval after invalidations'
);

select * from finish();
rollback;
