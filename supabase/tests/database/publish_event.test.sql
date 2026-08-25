begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(26);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'organizer-a-publish-test@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'organizer-b-publish-test@example.invalid');

insert into public.organizers (id, display_name)
values
  ('10000000-0000-0000-0000-000000000001', 'Organizer A'),
  ('10000000-0000-0000-0000-000000000002', 'Organizer B');

insert into public.events (
  id,
  organizer_id,
  moderation_status,
  title,
  description,
  category,
  starts_at,
  ends_at,
  address_line1,
  city,
  region,
  postal_code,
  country_code,
  mapbox_feature_id,
  latitude,
  longitude,
  admission_type
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Incomplete Event',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    'US',
    null,
    null,
    null,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Valid Free Event',
    'A sufficiently detailed description for publishing.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.valid-free-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    'clear',
    'Organizer B Event',
    'A sufficiently detailed description for another organizer.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.organizer-b-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Invalid Time Event',
    'A sufficiently detailed description for invalid time.',
    'community',
    now() - interval '1 day',
    now() + interval '1 hour',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.invalid-time-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Invalid Location Event',
    'A sufficiently detailed description for invalid location.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'NV',
    '94105',
    'US',
    'mapbox.invalid-location-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Outside Service Area Event',
    'A sufficiently detailed description for unsupported geography.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.outside-service-area-event',
    40.0000,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Paid Event',
    'A sufficiently detailed description for a paid event.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.paid-event',
    37.7936,
    -122.3958,
    'paid'
  ),
  (
    '20000000-0000-0000-0000-000000000008',
    '10000000-0000-0000-0000-000000000001',
    'blocked',
    'Blocked Event',
    'A sufficiently detailed description for a blocked event.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.blocked-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000009',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Blank Address Event',
    'A sufficiently detailed description for blank address validation.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '   ',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.blank-address-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000010',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Blank City Event',
    'A sufficiently detailed description for blank city validation.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    E'\t',
    'CA',
    '94105',
    'US',
    'mapbox.blank-city-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Blank Postal Code Event',
    'A sufficiently detailed description for blank postal validation.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    E'\n',
    'US',
    'mapbox.blank-postal-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000012',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Blank Mapbox Feature Event',
    'A sufficiently detailed description for blank Mapbox ID validation.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    E' \t ',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000013',
    '10000000-0000-0000-0000-000000000001',
    'flagged',
    'Flagged Event',
    'A sufficiently detailed description for a flagged event.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.flagged-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000014',
    '10000000-0000-0000-0000-000000000001',
    'removed',
    'Removed Event',
    'A sufficiently detailed description for a removed event.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.removed-event',
    37.7936,
    -122.3958,
    'free'
  ),
  (
    '20000000-0000-0000-0000-000000000015',
    '10000000-0000-0000-0000-000000000001',
    'clear',
    'Paid Event Without Connect',
    'A sufficiently detailed paid event without current Connect readiness.',
    'community',
    now() + interval '2 days',
    now() + interval '2 days 2 hours',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.paid-event-without-connect',
    37.7936,
    -122.3958,
    'paid'
  );

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, quantity_total, status, sort_order
)
values
  (
    '30000000-0000-0000-0000-000000000007',
    '20000000-0000-0000-0000-000000000007',
    'General Admission',
    2000,
    10,
    'draft',
    1
  ),
  (
    '30000000-0000-0000-0000-000000000015',
    '20000000-0000-0000-0000-000000000015',
    'General Admission',
    2000,
    10,
    'draft',
    1
  );

insert into public.organizer_stripe_accounts (
  organizer_id,
  stripe_account_id,
  transfers_status,
  payouts_status,
  requirements_status,
  last_synced_at
)
values (
  '10000000-0000-0000-0000-000000000001',
  'acct_publishreadya',
  'active',
  'active',
  'clear',
  now()
);

select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000002') $$,
  '42501', 'permission denied for function publish_event',
  'anonymous RPC execution is denied'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.publish_event('29999999-0000-0000-0000-000000000009') $$,
  'P0001', 'EVENT_NOT_FOUND', 'missing event is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000003') $$,
  'P0001', 'EVENT_NOT_OWNED', 'another organizer event is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000001') $$,
  'P0001', 'EVENT_INCOMPLETE', 'incomplete event is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000004') $$,
  'P0001', 'EVENT_TIME_INVALID', 'invalid event time is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000005') $$,
  'P0001', 'EVENT_LOCATION_INVALID', 'invalid event location is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000006') $$,
  'P0001', 'EVENT_OUTSIDE_SERVICE_AREA', 'event outside service area is rejected'
);

select lives_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000007') $$,
  'a paid event with current ticketing and Connect readiness publishes'
);

select results_eq(
  $$
    select status, admission_type
    from public.events
    where id = '20000000-0000-0000-0000-000000000007'
  $$,
  $$ values ('published'::text, 'paid'::text) $$,
  'paid publishing persists the paid event lifecycle'
);

reset role;

select results_eq(
  $$
    select status
    from public.ticket_tiers
    where event_id = '20000000-0000-0000-0000-000000000007'
  $$,
  $$ values ('active'::text) $$,
  'paid publishing activates the configured ticket tiers'
);

delete from public.organizer_stripe_accounts
where organizer_id = '10000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000015') $$,
  'P0001', 'CONNECT_NOT_READY', 'paid publishing enforces current paid-sales readiness'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000008') $$,
  'P0001', 'EVENT_MODERATION_BLOCKED', 'blocked event is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000014') $$,
  'P0001', 'EVENT_MODERATION_BLOCKED', 'removed event is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000009') $$,
  'P0001', 'EVENT_INCOMPLETE', 'whitespace-only address is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000010') $$,
  'P0001', 'EVENT_INCOMPLETE', 'whitespace-only city is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000011') $$,
  'P0001', 'EVENT_INCOMPLETE', 'whitespace-only postal code is rejected'
);

select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000012') $$,
  'P0001', 'EVENT_INCOMPLETE', 'whitespace-only Mapbox feature id is rejected'
);

select lives_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000002') $$,
  'valid free event publishes'
);

select results_eq(
  $$ select status from public.events where id = '20000000-0000-0000-0000-000000000002' $$,
  $$ values ('published'::text) $$,
  'publish persists status'
);

select results_eq(
  $$
    select published_at is not null
    from public.events
    where id = '20000000-0000-0000-0000-000000000002'
  $$,
  $$ values (true) $$,
  'publish persists first publication timestamp'
);

select lives_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000013') $$,
  'flagged event publishes without changing moderation'
);

select results_eq(
  $$
    select moderation_status
    from public.events
    where id = '20000000-0000-0000-0000-000000000013'
  $$,
  $$ values ('flagged'::text) $$,
  'flagged moderation status persists through publish RPC'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select results_eq(
  $$
    select id
    from public.events
    where id = '20000000-0000-0000-0000-000000000002'
  $$,
  $$ values ('20000000-0000-0000-0000-000000000002'::uuid) $$,
  'successful publication is immediately visible anonymously'
);

select results_eq(
  $$
    select moderation_status
    from public.events
    where id = '20000000-0000-0000-0000-000000000013'
  $$,
  $$ values ('flagged'::text) $$,
  'published flagged event remains anonymously visible'
);

reset role;
create temporary table publish_retry_snapshot on commit drop as
select id, published_at
from public.events
where id = '20000000-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000002') $$,
  'published event retry succeeds'
);

reset role;
select results_eq(
  $$
    select id, published_at
    from public.events
    where id = '20000000-0000-0000-0000-000000000002'
  $$,
  $$ select id, published_at from publish_retry_snapshot $$,
  'publish retry preserves event id and first publication timestamp'
);

select * from finish();
rollback;
