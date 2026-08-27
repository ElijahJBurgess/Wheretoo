begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_function(
  'private', 'compute_event_moderation_input', array['uuid'],
  'canonical moderation input has one database-owned event boundary'
);
select has_function(
  'private', 'compute_event_input_sha256', array['uuid'],
  'canonical moderation digest has one database-owned event boundary'
);
select has_function(
  'private', 'event_meets_public_candidate', array['uuid', 'timestamp with time zone'],
  'public eligibility has one internal candidate predicate'
);
select has_function(
  'private', 'transition_event_public_eligibility', array['uuid', 'boolean', 'uuid'],
  'eligibility epochs have one atomic transition primitive'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'compute_event_moderation_input',
        'compute_event_input_sha256',
        'event_meets_public_candidate',
        'transition_event_public_eligibility'
      )
      and procedures.prosecdef
      and procedures.proconfig = array['search_path=""']::text[]
  $$,
  $$ values (4::bigint) $$,
  'all four private moderation helpers are security-definer functions with an empty search path'
);

select results_eq(
  $$
    select procedures.prosecdef,
      procedures.proconfig = array['search_path=""']::text[]
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = 'publish_event'
      and procedures.proargtypes = '2950'::oidvector
  $$,
  $$ values (true, true) $$,
  'authenticated publication remains security-definer with an empty search path'
);

select function_privs_are(
  'private', 'compute_event_moderation_input', array['uuid'],
  'authenticated', array[]::text[],
  'authenticated callers cannot execute the canonical-input helper'
);
select function_privs_are(
  'private', 'compute_event_input_sha256', array['uuid'],
  'service_role', array[]::text[],
  'the service role cannot bypass the canonical-digest boundary directly'
);
select function_privs_are(
  'private', 'event_meets_public_candidate', array['uuid', 'timestamp with time zone'],
  'authenticated', array[]::text[],
  'authenticated callers cannot execute the eligibility candidate helper'
);
select function_privs_are(
  'private', 'transition_event_public_eligibility', array['uuid', 'boolean', 'uuid'],
  'service_role', array[]::text[],
  'the service role cannot invoke eligibility transitions directly'
);
select function_privs_are(
  'public', 'publish_event', array['uuid'],
  'anon', array[]::text[],
  'anonymous callers cannot publish events'
);
select function_privs_are(
  'public', 'publish_event', array['uuid'],
  'authenticated', array['EXECUTE'],
  'authenticated organizers retain the exact publish RPC grant'
);

insert into auth.users (id, email)
values (
  '74000000-0000-4000-8000-000000000001',
  'moderation-publish-owner@example.invalid'
);

insert into public.organizers (id, display_name)
values (
  '74000000-0000-4000-8000-000000000001',
  'Digest Organizer'
);

insert into public.events (
  id,
  organizer_id,
  status,
  moderation_status,
  moderated_revision,
  title,
  description,
  category,
  venue_name,
  starts_at,
  ends_at,
  timezone,
  address_line1,
  city,
  region,
  postal_code,
  country_code,
  mapbox_feature_id,
  latitude,
  longitude,
  admission_type,
  artwork_path,
  public_history_status,
  first_publicly_eligible_at,
  published_at
)
values
  (
    '74100000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Digest Fixture',
    'A deterministic legacy moderation digest fixture.',
    'community', 'Civic Hall',
    '2030-01-02 18:00:00+00', '2030-01-02 20:00:00+00',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.digest-fixture', 37.7936, -122.3958, 'paid', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000010',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Neighborhood run club',
    'An ordinary all-ages neighborhood run with a safe community route.',
    'fitness', 'Community Track',
    now() + interval '20 days', now() + interval '20 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-low-risk', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000011',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'All ages food festival',
    'A family festival with food vendors and a controlled beer garden.',
    'food_drink', 'Festival Plaza',
    now() + interval '21 days', now() + interval '21 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-alcohol', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000012',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'California cannabis policy forum',
    'A legal educational forum for adults age twenty-one and older.',
    'community', 'Policy Forum Hall',
    now() + interval '22 days', now() + interval '22 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-cannabis', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000013',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Explicit adult performance',
    'An adults-only performance that includes explicit sexual content.',
    'nightlife', 'Night Theater',
    now() + interval '23 days', now() + interval '23 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-explicit', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000014',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Casino wagering night',
    'An adults-only event featuring gambling and wagering activities.',
    'nightlife', 'Casino Hall',
    now() + interval '24 days', now() + interval '24 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-gambling', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000015',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Historical weapons exhibition',
    'A museum exhibition with historical weapons present for education.',
    'art_culture', 'History Museum',
    now() + interval '25 days', now() + interval '25 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-weapons', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000016',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'High risk climbing challenge',
    'A supervised but high-risk physical climbing and jumping activity.',
    'fitness', 'Climbing Park',
    now() + interval '26 days', now() + interval '26 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-high-risk', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000017',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'All ages cannabis gathering',
    'A cannabis gathering whose all-ages requirement is incoherent.',
    'community', 'Gathering Hall',
    now() + interval '27 days', now() + interval '27 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-cannabis-age', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000018',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'All ages explicit performance',
    'An explicit adult performance with an incoherent all-ages requirement.',
    'nightlife', 'Performance Hall',
    now() + interval '28 days', now() + interval '28 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-explicit-age', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000019',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Pride drag community health museum day',
    'An LGBTQ+ Pride and drag community sexual-health museum history program.',
    'community', 'Community Museum',
    now() + interval '29 days', now() + interval '29 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-protected-neutral', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000020',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Event with unverified artwork',
    'An otherwise ordinary event whose artwork cannot yet be verified.',
    'community', 'Artwork Hall',
    now() + interval '30 days', now() + interval '30 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-artwork', 37.7936, -122.3958, 'free',
    'events/unverified-current-artwork.png',
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000021',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'White power recruitment rally',
    'A rally explicitly advertising white power recruitment activity.',
    'community', 'Rally Plaza',
    now() + interval '31 days', now() + interval '31 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-contextual', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000022',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Missing disclosure fixture',
    'A complete event that deliberately has no risk disclosure row.',
    'community', 'Requirements Hall',
    now() + interval '32 days', now() + interval '32 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-missing-disclosures', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000023',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Missing acceptance fixture',
    'A complete low-risk event without a current policy acceptance.',
    'community', 'Agreement Hall',
    now() + interval '33 days', now() + interval '33 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-missing-acceptance', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000024',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Unknown history fixture',
    'A complete low-risk event whose legacy history remains unresolved.',
    'community', 'History Hall',
    now() + interval '34 days', now() + interval '34 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-unknown-history', 37.7936, -122.3958, 'free', null,
    'unknown', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000025',
    '74000000-0000-4000-8000-000000000001',
    'published', 'blocked', 1,
    'Blocked re-publication fixture',
    'A blocked event may update authorization but cannot release enforcement.',
    'community', 'Blocked Hall',
    now() + interval '35 days', now() + interval '35 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-blocked', 37.7936, -122.3958, 'free', null,
    'never_public', null, now() - interval '1 day'
  ),
  (
    '74100000-0000-4000-8000-000000000026',
    '74000000-0000-4000-8000-000000000001',
    'published', 'removed', 1,
    'Removed re-publication fixture',
    'A removed event may update authorization but cannot release enforcement.',
    'community', 'Removed Hall',
    now() + interval '36 days', now() + interval '36 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-removed', 37.7936, -122.3958, 'free', null,
    'previously_public', now() - interval '2 days', now() - interval '2 days'
  ),
  (
    '74100000-0000-4000-8000-000000000027',
    '74000000-0000-4000-8000-000000000001',
    'published', 'under_review', null,
    'Legacy authorization fixture',
    'An unchanged pre-rollout event retains exact migration authorization.',
    'community', 'Legacy Hall',
    now() + interval '37 days', now() + interval '37 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-legacy-authorization', 37.7936, -122.3958, 'free', null,
    'previously_public', now() - interval '3 days', now() - interval '3 days'
  ),
  (
    '74100000-0000-4000-8000-000000000028',
    '74000000-0000-4000-8000-000000000001',
    'published', 'under_review', null,
    'Bare exemption fixture',
    'A bare immutable exemption cannot authorize a publication attempt.',
    'community', 'Legacy Hall',
    now() + interval '38 days', now() + interval '38 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-bare-exemption', 37.7936, -122.3958, 'free', null,
    'previously_public', now() - interval '4 days', now() - interval '4 days'
  ),
  (
    '74100000-0000-4000-8000-000000000030',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Production pair fixture',
    'A low-risk event accepted against a production-approved policy pair.',
    'community', 'Production Hall',
    now() + interval '40 days', now() + interval '40 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-production-pair', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  ),
  (
    '74100000-0000-4000-8000-000000000031',
    '74000000-0000-4000-8000-000000000001',
    'draft', 'not_evaluated', null,
    'Mismatched pair fixture',
    'A low-risk event used to prove fail-closed requirement mismatch behavior.',
    'community', 'Mismatch Hall',
    now() + interval '41 days', now() + interval '41 days 2 hours',
    'America/Los_Angeles', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.moderation-mismatched-pair', 37.7936, -122.3958, 'free', null,
    'never_public', null, null
  );

insert into public.ticket_tiers (
  id,
  event_id,
  name,
  description,
  unit_amount_minor,
  quantity_total,
  status,
  sort_order
)
values
  (
    '74200000-0000-4000-8000-000000000002',
    '74100000-0000-4000-8000-000000000001',
    'General', null, 2500, 100, 'draft', 1
  ),
  (
    '74200000-0000-4000-8000-000000000001',
    '74100000-0000-4000-8000-000000000001',
    'Gold', 'Front section', 5000, 25, 'draft', 2
  );

insert into private.event_risk_disclosures (
  event_id,
  minimum_age,
  alcohol_present,
  cannabis_present,
  explicit_adult_content,
  gambling_present,
  weapons_present,
  high_risk_activity
)
values
  ('74100000-0000-4000-8000-000000000010', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000011', 'all_ages', true, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000012', '21_plus', false, true, false, false, false, false),
  ('74100000-0000-4000-8000-000000000013', '18_plus', false, false, true, false, false, false),
  ('74100000-0000-4000-8000-000000000014', '21_plus', false, false, false, true, false, false),
  ('74100000-0000-4000-8000-000000000015', 'all_ages', false, false, false, false, true, false),
  ('74100000-0000-4000-8000-000000000016', '18_plus', false, false, false, false, false, true),
  ('74100000-0000-4000-8000-000000000017', 'all_ages', false, true, false, false, false, false),
  ('74100000-0000-4000-8000-000000000018', 'all_ages', false, false, true, false, false, false),
  ('74100000-0000-4000-8000-000000000019', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000020', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000021', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000023', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000024', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000025', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000026', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000028', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000030', 'all_ages', false, false, false, false, false, false),
  ('74100000-0000-4000-8000-000000000031', 'all_ages', false, false, false, false, false, false);

select results_eq(
  $$
    select private.compute_event_input_sha256(
      '74100000-0000-4000-8000-000000000001'
    )
  $$,
  $$
    values (
      'dcd1feed409e75c69e4664f1b70cb10f0c8da9e6533caf498904cc3b0d6955a9'::text
    )
  $$,
  'Task 4 preserves the exact Task 2 canonical digest bytes and UUID tier order'
);

select results_eq(
  $$
    select private.compute_event_moderation_input(
      '74100000-0000-4000-8000-000000000001'
    ) -> 'artwork'
  $$,
  $$
    values (
      jsonb_build_object('path', null, 'verification_state', 'not_present')
    )
  $$,
  'null artwork retains the exact historical canonical identity object'
);

update private.organizer_policy_release_settings
set environment = 'unconfigured', updated_at = statement_timestamp()
where singleton_id;

select set_config(
  'request.jwt.claim.sub',
  '74000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select throws_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000010') $$,
  'P0001', 'POLICY_ENVIRONMENT_UNCONFIGURED',
  'publication fails closed before authorization while the policy environment is unconfigured'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_actions
    where event_id = '74100000-0000-4000-8000-000000000010'
  $$,
  $$ values (0::bigint) $$,
  'unconfigured publication writes no authorization or moderation action'
);

update private.organizer_policy_release_settings
set environment = 'production', updated_at = statement_timestamp()
where singleton_id;

select set_config(
  'request.jwt.claim.sub',
  '74000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select throws_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000010') $$,
  'P0001', 'POLICY_REQUIREMENTS_INVALID',
  'production publication rejects either development placeholder before authorization'
);
reset role;

set local role service_role;
select lives_ok(
  $$ select private.configure_policy_environment('development') $$,
  'the rollback fixture configures only the exact founder development pair'
);
reset role;

create temporary table acceptance_non_activation_before on commit drop as
select
  events.status,
  events.moderation_status,
  events.moderated_revision,
  events.moderation_version,
  events.public_history_status,
  events.first_publicly_eligible_at,
  events.public_eligibility_version,
  events.publicly_authorized_revision,
  events.publicly_authorized_action_id,
  (
    select count(*)
    from private.event_moderation_actions as actions
    where actions.event_id = events.id
  ) as action_count,
  (
    select count(*)
    from private.event_public_eligibility_intervals as intervals
    where intervals.event_id = events.id
  ) as interval_count
from public.events as events
where events.id = '74100000-0000-4000-8000-000000000010';

select set_config(
  'request.jwt.claim.sub',
  '74000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select lives_ok(
  $$
    select *
    from public.accept_current_event_policies(
      '74100000-0000-4000-8000-000000000010'
    )
  $$,
  'the owner records an exact current-revision acceptance before publication'
);
reset role;

select results_eq(
  $$
    select
      events.status,
      events.moderation_status,
      events.moderated_revision,
      events.moderation_version,
      events.public_history_status,
      events.first_publicly_eligible_at,
      events.public_eligibility_version,
      events.publicly_authorized_revision,
      events.publicly_authorized_action_id,
      (
        select count(*)
        from private.event_moderation_actions as actions
        where actions.event_id = events.id
      ),
      (
        select count(*)
        from private.event_public_eligibility_intervals as intervals
        where intervals.event_id = events.id
      )
    from public.events as events
    where events.id = '74100000-0000-4000-8000-000000000010'
  $$,
  $$ select * from acceptance_non_activation_before $$,
  'acceptance alone changes no lifecycle, moderation, authorization, history, or epoch fact'
);

insert into private.event_policy_acceptances (
  event_id,
  organizer_id,
  accepted_by_user_id,
  content_revision,
  input_sha256,
  organizer_terms_version_id,
  event_policy_version_id
)
select
  events.id,
  events.organizer_id,
  events.organizer_id,
  events.content_revision,
  private.compute_event_input_sha256(events.id),
  'dev-organizer-terms-v1',
  'dev-event-policy-v1'
from public.events as events
where events.id in (
  '74100000-0000-4000-8000-000000000011',
  '74100000-0000-4000-8000-000000000012',
  '74100000-0000-4000-8000-000000000013',
  '74100000-0000-4000-8000-000000000014',
  '74100000-0000-4000-8000-000000000015',
  '74100000-0000-4000-8000-000000000016',
  '74100000-0000-4000-8000-000000000017',
  '74100000-0000-4000-8000-000000000018',
  '74100000-0000-4000-8000-000000000019',
  '74100000-0000-4000-8000-000000000020',
  '74100000-0000-4000-8000-000000000021',
  '74100000-0000-4000-8000-000000000022',
  '74100000-0000-4000-8000-000000000024',
  '74100000-0000-4000-8000-000000000025',
  '74100000-0000-4000-8000-000000000026'
);

insert into private.event_policy_legacy_exemptions (
  id,
  event_id,
  grandfathered_content_revision,
  input_sha256,
  migration_identifier
)
values
  (
    '74300000-0000-4000-8000-000000000027',
    '74100000-0000-4000-8000-000000000027',
    1,
    private.compute_event_input_sha256('74100000-0000-4000-8000-000000000027'),
    '20260826010100_migrate_legacy_moderation'
  ),
  (
    '74300000-0000-4000-8000-000000000028',
    '74100000-0000-4000-8000-000000000028',
    1,
    private.compute_event_input_sha256('74100000-0000-4000-8000-000000000028'),
    '20260826010100_migrate_legacy_moderation'
  );

insert into private.event_moderation_actions (
  id,
  event_id,
  content_revision,
  input_sha256,
  actor_type,
  source,
  action,
  previous_status,
  new_status,
  previous_public_history_status,
  new_public_history_status,
  reason_code,
  internal_note,
  policy_legacy_exemption_id,
  moderation_version
)
values (
  '74400000-0000-4000-8000-000000000027',
  '74100000-0000-4000-8000-000000000027',
  1,
  private.compute_event_input_sha256('74100000-0000-4000-8000-000000000027'),
  'system', 'migration', 'authorize_publication',
  'under_review', 'under_review',
  'previously_public', 'previously_public',
  'other',
  'exact unchanged pre-rollout revision authorized by migration-only legacy exemption',
  '74300000-0000-4000-8000-000000000027',
  0
);

update public.events
set
  publicly_authorized_revision = 1,
  publicly_authorized_action_id = '74400000-0000-4000-8000-000000000027'
where id = '74100000-0000-4000-8000-000000000027';

insert into private.organizer_policy_versions (
  id, policy_kind, stage, public_url, content_sha256, effective_at
)
values (
  'dev-event-policy-mismatch-v1',
  'event_policy',
  'development_placeholder',
  '/event-policy-mismatch',
  repeat('e', 64),
  '2026-08-27 00:00:00+00'
);

update private.organizer_policy_requirements
set
  policy_version_id = 'dev-event-policy-mismatch-v1',
  updated_at = statement_timestamp()
where policy_kind = 'event_policy';

select set_config(
  'request.jwt.claim.sub',
  '74000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select throws_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000031') $$,
  'P0001', 'POLICY_REQUIREMENTS_INVALID',
  'development publication rejects any pair other than the exact founder placeholders'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_actions
    where event_id = '74100000-0000-4000-8000-000000000031'
  $$,
  $$ values (0::bigint) $$,
  'a mismatched current pair writes no authorization evidence'
);

update private.organizer_policy_requirements
set
  policy_version_id = 'dev-event-policy-v1',
  updated_at = statement_timestamp()
where policy_kind = 'event_policy';

select set_config(
  'request.jwt.claim.sub',
  '74000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000022') $$,
  'P0001', 'EVENT_DISCLOSURES_REQUIRED',
  'a new event cannot publish without one complete disclosure row'
);
select throws_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000023') $$,
  'P0001', 'EVENT_POLICY_ACCEPTANCE_REQUIRED',
  'a new event cannot publish without exact current-pair acceptance'
);
select throws_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000024') $$,
  'P0001', 'EVENT_PUBLIC_HISTORY_UNKNOWN',
  'an unresolved legacy public-history fact cannot enter publication'
);

select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000010') $$,
  'a complete ordinary event clears and publishes immediately'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000011') $$,
  'alcohol alone remains eligible even for an all-ages event'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000012') $$,
  'coherent 21-plus California cannabis content clears immediately'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000019') $$,
  'Pride, drag, LGBTQ+, sexual-health, museum, and historical terms remain neutral'
);

select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000013') $$,
  'declared explicit adult content publishes only into a held lifecycle'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000014') $$,
  'declared gambling publishes only into a held lifecycle'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000015') $$,
  'declared weapons content publishes only into a held lifecycle'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000016') $$,
  'declared high-risk activity publishes only into a held lifecycle'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000017') $$,
  'cannabis with an incoherent age requirement is held for review'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000018') $$,
  'explicit content with an all-ages requirement is held for review'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000020') $$,
  'every current non-null artwork path is unverified and held in Build 2.5'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000021') $$,
  'a bounded contextual risk indicator holds rather than deterministically prohibiting'
);

select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000025') $$,
  'a blocked published event may refresh exact authorization evidence'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000026') $$,
  'a removed published event may refresh exact authorization evidence'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000027') $$,
  'an unchanged published legacy revision reuses its exact migration authorization pointer'
);
select throws_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000028') $$,
  'P0001', 'EVENT_POLICY_ACCEPTANCE_REQUIRED',
  'legacy exemption existence alone cannot authorize publication'
);

reset role;

select results_eq(
  $$
    select
      count(*)::bigint,
      bool_and(events.status = 'published'),
      bool_and(events.moderation_status = 'clear'),
      bool_and(events.moderated_revision = events.content_revision),
      bool_and(events.public_history_status = 'previously_public'),
      bool_and(events.first_publicly_eligible_at is not null),
      bool_and(events.public_eligibility_version = 1)
    from public.events as events
    where events.id in (
      '74100000-0000-4000-8000-000000000010',
      '74100000-0000-4000-8000-000000000011',
      '74100000-0000-4000-8000-000000000012',
      '74100000-0000-4000-8000-000000000019'
    )
  $$,
  $$ values (4::bigint, true, true, true, true, true, true) $$,
  'all four deterministic low-risk cases atomically clear and open eligibility version one'
);

select results_eq(
  $$
    select
      count(*)::bigint,
      bool_and(events.status = 'published'),
      bool_and(events.moderation_status = 'under_review'),
      bool_and(events.moderated_revision is null),
      bool_and(events.public_history_status = 'never_public'),
      bool_and(events.first_publicly_eligible_at is null),
      bool_and(events.public_eligibility_version = 0)
    from public.events as events
    where events.id between
      '74100000-0000-4000-8000-000000000013'
      and '74100000-0000-4000-8000-000000000021'
      and events.id <> '74100000-0000-4000-8000-000000000019'
  $$,
  $$ values (8::bigint, true, true, true, true, true, true) $$,
  'all deterministic/contextual risk cases publish held without any public-history flip'
);

select results_eq(
  $$
    select
      count(*) filter (where actions.action = 'authorize_publication')::bigint,
      count(*) filter (where actions.action = 'clear')::bigint,
      count(*) filter (where actions.action = 'hold')::bigint,
      count(distinct actions.id)::bigint
    from private.event_moderation_actions as actions
    where actions.event_id = '74100000-0000-4000-8000-000000000010'
  $$,
  $$ values (1::bigint, 1::bigint, 0::bigint, 2::bigint) $$,
  'initial low-risk publication records distinct authorization and clear actions'
);

select results_eq(
  $$
    select
      intervals.eligibility_state,
      actions.action,
      actions.policy_acceptance_id is null
    from private.event_public_eligibility_intervals as intervals
    join private.event_moderation_actions as actions
      on actions.id = intervals.started_action_id
    where intervals.event_id = '74100000-0000-4000-8000-000000000010'
      and intervals.public_eligibility_version = 1
  $$,
  $$ values ('eligible'::text, 'clear'::text, true) $$,
  'initial low-risk eligibility opens with the distinct clear action, not acceptance authority'
);

select results_eq(
  $$
    select
      count(*) filter (where actions.action = 'authorize_publication')::bigint,
      count(*) filter (where actions.action = 'hold')::bigint,
      count(distinct actions.id)::bigint,
      (
        select count(*)::bigint
        from private.event_moderation_evaluations as evaluations
        where evaluations.event_id = '74100000-0000-4000-8000-000000000013'
          and evaluations.status = 'queued'
          and evaluations.source = 'contextual'
      )
    from private.event_moderation_actions as actions
    where actions.event_id = '74100000-0000-4000-8000-000000000013'
  $$,
  $$ values (1::bigint, 1::bigint, 2::bigint, 1::bigint) $$,
  'initial high-risk publication records distinct authorization, hold, and one contextual job'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.event_public_eligibility_intervals as intervals
    where intervals.event_id between
      '74100000-0000-4000-8000-000000000013'
      and '74100000-0000-4000-8000-000000000021'
      and intervals.event_id <> '74100000-0000-4000-8000-000000000019'
      and intervals.eligibility_state = 'eligible'
  $$,
  $$ values (0::bigint) $$,
  'high-risk publication has no transient eligible interval'
);

select results_eq(
  $$
    select
      private.event_meets_public_candidate(
        '74100000-0000-4000-8000-000000000010', statement_timestamp()
      ),
      private.event_meets_public_candidate(
        '74100000-0000-4000-8000-000000000013', statement_timestamp()
      ),
      private.event_meets_public_candidate(
        '74100000-0000-4000-8000-000000000024', statement_timestamp()
      )
  $$,
  $$ values (true, false, false) $$,
  'the candidate predicate accepts current clear known history and rejects holds or unknown history'
);

select results_eq(
  $$
    select
      events.id,
      events.moderation_status,
      events.moderated_revision,
      events.public_eligibility_version,
      actions.action
    from public.events as events
    join private.event_moderation_actions as actions
      on actions.id = events.publicly_authorized_action_id
    where events.id in (
      '74100000-0000-4000-8000-000000000025',
      '74100000-0000-4000-8000-000000000026'
    )
    order by events.id
  $$,
  $$
    values
      (
        '74100000-0000-4000-8000-000000000025'::uuid,
        'blocked'::text, 1::bigint, 0::bigint, 'authorize_publication'::text
      ),
      (
        '74100000-0000-4000-8000-000000000026'::uuid,
        'removed'::text, 1::bigint, 0::bigint, 'authorize_publication'::text
      )
  $$,
  're-publication can update authorization but never releases blocked or removed enforcement'
);

select results_eq(
  $$
    select
      events.publicly_authorized_action_id,
      count(actions.id)::bigint,
      count(acceptances.id)::bigint
    from public.events as events
    left join private.event_moderation_actions as actions
      on actions.event_id = events.id
    left join private.event_policy_acceptances as acceptances
      on acceptances.event_id = events.id
    where events.id = '74100000-0000-4000-8000-000000000027'
    group by events.publicly_authorized_action_id
  $$,
  $$
    values (
      '74400000-0000-4000-8000-000000000027'::uuid,
      1::bigint,
      0::bigint
    )
  $$,
  'the unchanged legacy branch preserves the exact migration action and invents no consent'
);

create temporary table publish_retry_before on commit drop as
select
  events.id,
  events.published_at,
  events.status,
  events.moderation_status,
  events.moderated_revision,
  events.moderation_version,
  events.public_history_status,
  events.first_publicly_eligible_at,
  events.public_eligibility_version,
  events.publicly_authorized_revision,
  events.publicly_authorized_action_id,
  (
    select count(*)
    from private.event_policy_acceptances as acceptances
    where acceptances.event_id = events.id
  ) as acceptance_count,
  (
    select count(*)
    from private.event_moderation_evaluations as evaluations
    where evaluations.event_id = events.id
  ) as evaluation_count,
  (
    select count(*)
    from private.event_moderation_actions as actions
    where actions.event_id = events.id
  ) as action_count,
  (
    select count(*)
    from private.event_public_eligibility_intervals as intervals
    where intervals.event_id = events.id
  ) as interval_count
from public.events as events
where events.id in (
  '74100000-0000-4000-8000-000000000010',
  '74100000-0000-4000-8000-000000000013'
);

select set_config(
  'request.jwt.claim.sub',
  '74000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000010') $$,
  'an exact low-risk publication retry is idempotent'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000013') $$,
  'an exact held publication retry is idempotent and stays held'
);
reset role;

select results_eq(
  $$
    select
      events.id,
      events.published_at,
      events.status,
      events.moderation_status,
      events.moderated_revision,
      events.moderation_version,
      events.public_history_status,
      events.first_publicly_eligible_at,
      events.public_eligibility_version,
      events.publicly_authorized_revision,
      events.publicly_authorized_action_id,
      (
        select count(*)
        from private.event_policy_acceptances as acceptances
        where acceptances.event_id = events.id
      ),
      (
        select count(*)
        from private.event_moderation_evaluations as evaluations
        where evaluations.event_id = events.id
      ),
      (
        select count(*)
        from private.event_moderation_actions as actions
        where actions.event_id = events.id
      ),
      (
        select count(*)
        from private.event_public_eligibility_intervals as intervals
        where intervals.event_id = events.id
      )
    from public.events as events
    where events.id in (
      '74100000-0000-4000-8000-000000000010',
      '74100000-0000-4000-8000-000000000013'
    )
    order by events.id
  $$,
  $$ select * from publish_retry_before order by id $$,
  'exact retries preserve the row, published time, acceptance, evaluation, actions, and epoch count'
);

create temporary table first_public_time_before_cycles on commit drop as
select first_publicly_eligible_at
from public.events
where id = '74100000-0000-4000-8000-000000000010';

insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, source, action,
  previous_status, new_status, previous_public_history_status,
  new_public_history_status, reason_code, moderation_version
)
values (
  '74400000-0000-4000-8000-000000000101',
  '74100000-0000-4000-8000-000000000010',
  1,
  private.compute_event_input_sha256('74100000-0000-4000-8000-000000000010'),
  'system', 'evaluation', 'hold', 'clear', 'under_review',
  'previously_public', 'previously_public', 'other', 2
);
update public.events
set
  moderation_status = 'under_review',
  moderated_revision = null,
  moderation_version = 2,
  moderation_updated_at = statement_timestamp()
where id = '74100000-0000-4000-8000-000000000010';
select is(
  private.transition_event_public_eligibility(
    '74100000-0000-4000-8000-000000000010',
    false,
    '74400000-0000-4000-8000-000000000101'
  ),
  true,
  'a hold closes the eligible interval and opens one ineligible generation'
);

insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, actor_user_id,
  source, action, previous_status, new_status,
  previous_public_history_status, new_public_history_status,
  reason_code, moderation_version
)
values (
  '74400000-0000-4000-8000-000000000102',
  '74100000-0000-4000-8000-000000000010',
  1,
  private.compute_event_input_sha256('74100000-0000-4000-8000-000000000010'),
  'admin', '74000000-0000-4000-8000-000000000001',
  'manual', 'restore', 'under_review', 'clear',
  'previously_public', 'previously_public', 'no_violation', 3
);
update public.events
set
  moderation_status = 'clear',
  moderated_revision = content_revision,
  moderation_version = 3,
  moderation_updated_at = statement_timestamp()
where id = '74100000-0000-4000-8000-000000000010';
select is(
  private.transition_event_public_eligibility(
    '74100000-0000-4000-8000-000000000010',
    private.event_meets_public_candidate(
      '74100000-0000-4000-8000-000000000010', statement_timestamp()
    ),
    '74400000-0000-4000-8000-000000000102'
  ),
  true,
  'a current clear restoration opens the next eligible generation'
);
select is(
  private.transition_event_public_eligibility(
    '74100000-0000-4000-8000-000000000010',
    true,
    '74400000-0000-4000-8000-000000000102'
  ),
  false,
  'repeating an unchanged transition does not increment the eligibility version'
);

insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, source, action,
  previous_status, new_status, previous_public_history_status,
  new_public_history_status, reason_code, moderation_version
)
values (
  '74400000-0000-4000-8000-000000000103',
  '74100000-0000-4000-8000-000000000010',
  1,
  private.compute_event_input_sha256('74100000-0000-4000-8000-000000000010'),
  'system', 'evaluation', 'hold', 'clear', 'under_review',
  'previously_public', 'previously_public', 'other', 4
);
update public.events
set
  moderation_status = 'under_review',
  moderated_revision = null,
  moderation_version = 4,
  moderation_updated_at = statement_timestamp()
where id = '74100000-0000-4000-8000-000000000010';
select is(
  private.transition_event_public_eligibility(
    '74100000-0000-4000-8000-000000000010',
    false,
    '74400000-0000-4000-8000-000000000103'
  ),
  true,
  'a second hold creates a distinct ineligible generation'
);

insert into private.event_moderation_actions (
  id, event_id, content_revision, input_sha256, actor_type, actor_user_id,
  source, action, previous_status, new_status,
  previous_public_history_status, new_public_history_status,
  reason_code, moderation_version
)
values (
  '74400000-0000-4000-8000-000000000104',
  '74100000-0000-4000-8000-000000000010',
  1,
  private.compute_event_input_sha256('74100000-0000-4000-8000-000000000010'),
  'admin', '74000000-0000-4000-8000-000000000001',
  'manual', 'restore', 'under_review', 'clear',
  'previously_public', 'previously_public', 'no_violation', 5
);
update public.events
set
  moderation_status = 'clear',
  moderated_revision = content_revision,
  moderation_version = 5,
  moderation_updated_at = statement_timestamp()
where id = '74100000-0000-4000-8000-000000000010';
select is(
  private.transition_event_public_eligibility(
    '74100000-0000-4000-8000-000000000010',
    private.event_meets_public_candidate(
      '74100000-0000-4000-8000-000000000010', statement_timestamp()
    ),
    '74400000-0000-4000-8000-000000000104'
  ),
  true,
  'a second restoration creates a distinct eligible generation'
);

select results_eq(
  $$
    select public_eligibility_version, eligibility_state
    from private.event_public_eligibility_intervals
    where event_id = '74100000-0000-4000-8000-000000000010'
    order by public_eligibility_version
  $$,
  $$
    values
      (0::bigint, 'ineligible'::text),
      (1::bigint, 'eligible'::text),
      (2::bigint, 'ineligible'::text),
      (3::bigint, 'eligible'::text),
      (4::bigint, 'ineligible'::text),
      (5::bigint, 'eligible'::text)
  $$,
  'two hide/restore cycles retain immutable alternating epoch history'
);

select results_eq(
  $$
    select
      events.public_eligibility_version,
      events.public_history_status,
      events.first_publicly_eligible_at = before_cycles.first_publicly_eligible_at,
      count(*) filter (where intervals.ended_at is null)::bigint,
      count(*) filter (
        where intervals.public_eligibility_version > 0
          and prior.ended_action_id is distinct from intervals.started_action_id
      )::bigint
    from public.events as events
    cross join first_public_time_before_cycles as before_cycles
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id
    left join private.event_public_eligibility_intervals as prior
      on prior.event_id = intervals.event_id
      and prior.public_eligibility_version = intervals.public_eligibility_version - 1
    where events.id = '74100000-0000-4000-8000-000000000010'
    group by events.public_eligibility_version,
      events.public_history_status,
      events.first_publicly_eligible_at,
      before_cycles.first_publicly_eligible_at
  $$,
  $$ values (5::bigint, 'previously_public'::text, true, 1::bigint, 0::bigint) $$,
  'true transitions increment once, keep one open interval, reuse the boundary action, and never reset first-public time'
);

insert into private.organizer_policy_versions (
  id, policy_kind, stage, public_url, content_sha256, effective_at
)
values
  (
    'prod-organizer-terms-moderation-v1',
    'organizer_terms', 'production_approved',
    'https://whereto.example/legal/organizer-terms/moderation-v1',
    repeat('a', 64), '2026-08-27 00:00:00+00'
  ),
  (
    'prod-event-policy-moderation-v1',
    'event_policy', 'production_approved',
    'https://whereto.example/legal/event-policy/moderation-v1',
    repeat('b', 64), '2026-08-27 00:00:00+00'
  );

update private.organizer_policy_requirements
set
  policy_version_id = case policy_kind
    when 'organizer_terms' then 'prod-organizer-terms-moderation-v1'
    else 'prod-event-policy-moderation-v1'
  end,
  updated_at = statement_timestamp();

set local role service_role;
select lives_ok(
  $$ select private.configure_policy_environment('production') $$,
  'a complete production-approved pair configures the publication environment'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '74000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select lives_ok(
  $$
    select *
    from public.accept_current_event_policies(
      '74100000-0000-4000-8000-000000000030'
    )
  $$,
  'the production fixture accepts only the current production pair'
);
select lives_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000030') $$,
  'a current production-approved acceptance can authorize low-risk publication'
);
reset role;

select results_eq(
  $$
    select
      events.status,
      events.moderation_status,
      events.public_history_status,
      events.public_eligibility_version,
      organizer_terms.stage,
      event_policy.stage
    from public.events as events
    join private.event_moderation_actions as actions
      on actions.id = events.publicly_authorized_action_id
    join private.event_policy_acceptances as acceptances
      on acceptances.id = actions.policy_acceptance_id
    join private.organizer_policy_versions as organizer_terms
      on organizer_terms.id = acceptances.organizer_terms_version_id
    join private.organizer_policy_versions as event_policy
      on event_policy.id = acceptances.event_policy_version_id
    where events.id = '74100000-0000-4000-8000-000000000030'
  $$,
  $$
    values (
      'published'::text, 'clear'::text, 'previously_public'::text, 1::bigint,
      'production_approved'::text, 'production_approved'::text
    )
  $$,
  'production eligibility is bound to one exact production acceptance and authorization action'
);

update private.organizer_policy_requirements
set
  policy_version_id = 'dev-event-policy-v1',
  updated_at = statement_timestamp()
where policy_kind = 'event_policy';

select set_config(
  'request.jwt.claim.sub',
  '74000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select throws_ok(
  $$ select public.publish_event('74100000-0000-4000-8000-000000000031') $$,
  'P0001', 'POLICY_REQUIREMENTS_INVALID',
  'either placeholder in production fails before authorization or eligibility'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from private.event_moderation_actions
    where event_id in (
      '74100000-0000-4000-8000-000000000022',
      '74100000-0000-4000-8000-000000000023',
      '74100000-0000-4000-8000-000000000024',
      '74100000-0000-4000-8000-000000000028',
      '74100000-0000-4000-8000-000000000031'
    )
  $$,
  $$ values (0::bigint) $$,
  'every failed publication boundary leaves authorization, moderation, and epoch state untouched'
);

select * from finish();
rollback;
