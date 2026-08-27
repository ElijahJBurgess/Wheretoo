begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

insert into auth.users (id, email)
values
  ('12000000-0000-0000-0000-000000000001', 'paid-sales-owner-a@example.invalid'),
  ('12000000-0000-0000-0000-000000000002', 'paid-sales-owner-b@example.invalid');

insert into public.organizers (id, display_name)
values
  ('12000000-0000-0000-0000-000000000001', 'Paid Sales Owner A'),
  ('12000000-0000-0000-0000-000000000002', 'Paid Sales Owner B');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
)
values
  (
    '22000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    'draft', 'clear', 'Ready Draft Event',
    'A complete draft event that can activate paid ticket sales.', 'community',
    now() + interval '2 days', now() + interval '2 days 2 hours', 'Ready Venue',
    '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.ready-paid-draft', 37.7936, -122.3958, 'free', null
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000001',
    'published', 'clear', 'Published Free Event',
    'A published free event that can safely convert to paid sales.', 'community',
    now() + interval '3 days', now() + interval '3 days 2 hours', 'Published Venue',
    '2 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.published-free-conversion', 37.7936, -122.3958, 'free',
    '2026-08-25 01:00:00+00'::timestamptz
  ),
  (
    '22000000-0000-0000-0000-000000000003',
    '12000000-0000-0000-0000-000000000001',
    'draft', 'clear', 'Incomplete Paid Event', null, null,
    null, null, null, null, null, null, null, 'US', null, null, null, 'free', null
  ),
  (
    '22000000-0000-0000-0000-000000000004',
    '12000000-0000-0000-0000-000000000001',
    'draft', 'blocked', 'Blocked Paid Event',
    'A complete but blocked event that must never activate sales.', 'community',
    now() + interval '2 days', now() + interval '2 days 2 hours', 'Blocked Venue',
    '4 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.blocked-paid-event', 37.7936, -122.3958, 'free', null
  ),
  (
    '22000000-0000-0000-0000-000000000005',
    '12000000-0000-0000-0000-000000000001',
    'draft', 'removed', 'Removed Paid Event',
    'A complete but removed event that must never activate sales.', 'community',
    now() + interval '2 days', now() + interval '2 days 2 hours', 'Removed Venue',
    '5 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.removed-paid-event', 37.7936, -122.3958, 'free', null
  ),
  (
    '22000000-0000-0000-0000-000000000006',
    '12000000-0000-0000-0000-000000000001',
    'draft', 'clear', 'No Tier Paid Event',
    'A complete event without any ticket tiers configured yet.', 'community',
    now() + interval '2 days', now() + interval '2 days 2 hours', 'No Tier Venue',
    '6 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.no-tier-paid-event', 37.7936, -122.3958, 'free', null
  ),
  (
    '22000000-0000-0000-0000-000000000007',
    '12000000-0000-0000-0000-000000000002',
    'draft', 'clear', 'Other Organizer Paid Event',
    'A complete event owned by a different organizer.', 'community',
    now() + interval '2 days', now() + interval '2 days 2 hours', 'Other Venue',
    '7 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.other-owner-paid-event', 37.7936, -122.3958, 'free', null
  ),
  (
    '22000000-0000-0000-0000-000000000008',
    '12000000-0000-0000-0000-000000000001',
    'published', 'clear', 'Flagged Public Paid Event',
    'A flagged paid event that remains publicly discoverable.', 'music',
    now() + interval '4 days', now() + interval '4 days 3 hours', 'Flagged Venue',
    '8 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.flagged-public-paid', 37.7936, -122.3958, 'paid', now()
  ),
  (
    '22000000-0000-0000-0000-000000000009',
    '12000000-0000-0000-0000-000000000001',
    'published', 'blocked', 'Blocked Public Paid Event',
    'A blocked paid event that must be hidden from public projection.', 'music',
    now() + interval '4 days', now() + interval '4 days 3 hours', 'Blocked Public Venue',
    '9 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.blocked-public-paid', 37.7936, -122.3958, 'paid', now()
  ),
  (
    '22000000-0000-0000-0000-000000000010',
    '12000000-0000-0000-0000-000000000001',
    'published', 'removed', 'Removed Public Paid Event',
    'A removed paid event that must be hidden from public projection.', 'music',
    now() + interval '4 days', now() + interval '4 days 3 hours', 'Removed Public Venue',
    '10 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.removed-public-paid', 37.7936, -122.3958, 'paid', now()
  ),
  (
    '22000000-0000-0000-0000-000000000011',
    '12000000-0000-0000-0000-000000000001',
    'draft', 'clear', 'Draft Public Paid Event',
    'A draft paid event that must be hidden from public projection.', 'music',
    now() + interval '4 days', now() + interval '4 days 3 hours', 'Draft Public Venue',
    '11 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.draft-public-paid', 37.7936, -122.3958, 'paid', null
  ),
  (
    '22000000-0000-0000-0000-000000000012',
    '12000000-0000-0000-0000-000000000001',
    'published', 'clear', 'Published Free Projection Event',
    'A published free event that does not expose paid ticketing.', 'music',
    now() + interval '4 days', now() + interval '4 days 3 hours', 'Free Public Venue',
    '12 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.free-public-event', 37.7936, -122.3958, 'free', now()
  );

insert into public.ticket_tiers (
  id, event_id, name, description, unit_amount_minor, quantity_total, status, sort_order
)
values
  ('32000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'General Admission', 'Ready draft tier', 2000, 10, 'draft', 1),
  ('32000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'Conversion Tier', 'Published conversion tier', 2500, 10, 'draft', 1),
  ('32000000-0000-0000-0000-000000000003', '22000000-0000-0000-0000-000000000003', 'Incomplete Tier', null, 2000, 10, 'draft', 1),
  ('32000000-0000-0000-0000-000000000004', '22000000-0000-0000-0000-000000000004', 'Blocked Tier', null, 2000, 10, 'draft', 1),
  ('32000000-0000-0000-0000-000000000005', '22000000-0000-0000-0000-000000000005', 'Removed Tier', null, 2000, 10, 'draft', 1),
  ('32000000-0000-0000-0000-000000000007', '22000000-0000-0000-0000-000000000007', 'Other Tier', null, 2000, 10, 'draft', 1),
  ('32000000-0000-0000-0000-000000000008', '22000000-0000-0000-0000-000000000008', 'Available', 'Safe public description', 2000, 10, 'active', 1),
  ('32000000-0000-0000-0000-000000000009', '22000000-0000-0000-0000-000000000008', 'Sold Out', null, 2000, 1, 'active', 2),
  ('32000000-0000-0000-0000-000000000010', '22000000-0000-0000-0000-000000000008', 'Archived', null, 5000, 99, 'archived', 3),
  ('32000000-0000-0000-0000-000000000011', '22000000-0000-0000-0000-000000000009', 'Blocked Public Tier', null, 2000, 10, 'active', 1),
  ('32000000-0000-0000-0000-000000000012', '22000000-0000-0000-0000-000000000010', 'Removed Public Tier', null, 2000, 10, 'active', 1),
  ('32000000-0000-0000-0000-000000000013', '22000000-0000-0000-0000-000000000011', 'Draft Public Tier', null, 2000, 10, 'active', 1);

insert into public.orders (
  id, order_number, event_id, organizer_id, status, buyer_name, buyer_email,
  client_request_id, confirmation_token_hash, quantity, currency, subtotal_minor,
  total_minor, platform_product_fee_minor, application_fee_amount_minor,
  expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
  platform_fixed_minor, processing_fee_treatment
)
values (
  '42000000-0000-0000-0000-000000000001', 'WT-PAID-SALES-001',
  '22000000-0000-0000-0000-000000000008',
  '12000000-0000-0000-0000-000000000001', 'paid', 'Paid Sales Buyer',
  'paid-sales-buyer@example.invalid', '62000000-0000-0000-0000-000000000001',
  repeat('a', 64), 1, 'usd', 2000, 2000, 150, 150, 1850,
  '00000000-0000-0000-0000-000000000500', 500, 50, 'platform_fee_only'
);

insert into public.order_items (
  id, order_id, ticket_tier_id, tier_version, tier_name,
  unit_amount_minor, quantity, subtotal_minor, currency
)
values (
  '52000000-0000-0000-0000-000000000001',
  '42000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000009',
  1, 'Sold Out', 2000, 1, 2000, 'usd'
);

select results_eq(
  $$ select pg_catalog.has_function_privilege('anon', 'public.activate_paid_sales(uuid)', 'EXECUTE') $$,
  $$ values (false) $$,
  'anonymous cannot activate paid sales'
);

select results_eq(
  $$ select pg_catalog.has_function_privilege('authenticated', 'public.activate_paid_sales(uuid)', 'EXECUTE') $$,
  $$ values (true) $$,
  'authenticated organizers can execute paid-sales activation'
);

select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  '42501',
  'permission denied for function activate_paid_sales',
  'anonymous activation execution is denied'
);

reset role;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'P0001',
  'EVENT_NOT_FOUND',
  'another organizer receives authorization-safe not found'
);

reset role;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000003') $$,
  'P0001', 'EVENT_INCOMPLETE', 'an incomplete draft cannot activate paid sales'
);

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000004') $$,
  'P0001', 'EVENT_MODERATION_BLOCKED', 'a blocked event cannot activate paid sales'
);

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000005') $$,
  'P0001', 'EVENT_MODERATION_BLOCKED', 'a removed event cannot activate paid sales'
);

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000006') $$,
  'P0001', 'TIER_NOT_ACTIVE', 'an event without one to three configured tiers cannot activate'
);

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CONNECT_NOT_READY', 'activation requires a persisted Connect projection'
);

reset role;
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
)
values (
  '12000000-0000-0000-0000-000000000001', 'acct_paidsalesownera',
  'active', 'active', 'clear', 0, 0, now() - interval '5 minutes 1 second'
);

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CONNECT_NOT_READY', 'Connect state older than five minutes is stale'
);

reset role;
update public.organizer_stripe_accounts
set last_synced_at = now(), transfers_status = 'pending'
where organizer_id = '12000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CONNECT_NOT_READY', 'active transfers are required'
);

reset role;
update public.organizer_stripe_accounts
set transfers_status = 'active', payouts_status = 'pending'
where organizer_id = '12000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CONNECT_NOT_READY', 'active payouts are required'
);

reset role;
update public.organizer_stripe_accounts
set payouts_status = 'active', requirements_status = 'action_required'
where organizer_id = '12000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CONNECT_ACTION_REQUIRED', 'Connect requirements must be clear'
);

reset role;
update public.organizer_stripe_accounts
set requirements_status = 'clear', requirements_currently_due_count = 1
where organizer_id = '12000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CONNECT_ACTION_REQUIRED', 'currently due Connect requirements block activation'
);

reset role;
update public.organizer_stripe_accounts
set requirements_currently_due_count = 0, requirements_past_due_count = 0
where organizer_id = '12000000-0000-0000-0000-000000000001';

update public.platform_fee_rules
set effective_until = now() - interval '1 second'
where id = '00000000-0000-0000-0000-000000000500';

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'P0001', 'FEE_RULE_NOT_CONFIGURED', 'an active non-live USD fee rule is required'
);

reset role;
update public.platform_fee_rules
set effective_until = null
where id = '00000000-0000-0000-0000-000000000500';

create temporary table published_conversion_snapshot on commit drop as
select id, published_at
from public.events
where id = '22000000-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000001') $$,
  'a ready draft event activates paid sales'
);

select results_eq(
  $$
    select status, admission_type, published_at is not null
    from public.events
    where id = '22000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('published'::text, 'paid'::text, true) $$,
  'draft activation publishes the same event as paid'
);

select results_eq(
  $$
    select status
    from public.list_owned_ticket_tiers('22000000-0000-0000-0000-000000000001')
  $$,
  $$ values ('active'::text) $$,
  'draft activation makes configured tiers active'
);

select lives_ok(
  $$ select public.activate_paid_sales('22000000-0000-0000-0000-000000000002') $$,
  'an already-published owned free event converts to paid sales'
);

reset role;

select results_eq(
  $$
    select events.id, events.published_at
    from public.events as events
    where events.id = '22000000-0000-0000-0000-000000000002'
  $$,
  $$ select id, published_at from published_conversion_snapshot $$,
  'published-event conversion preserves the event ID and first publication timestamp'
);

select results_eq(
  $$
    select admission_type, status
    from public.events
    where id = '22000000-0000-0000-0000-000000000002'
  $$,
  $$ values ('paid'::text, 'published'::text) $$,
  'published-event conversion changes only the paid-sales lifecycle state'
);

select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select results_eq(
  $$
    select count(*)::bigint
    from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000008')
  $$,
  $$ values (1::bigint) $$,
  'a published clear paid event remains visible through the public projection'
);

select results_eq(
  $$
    select array_agg(key collate "C" order by key collate "C")
    from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000008') as projection(value)
    cross join lateral jsonb_object_keys(projection.value) as object_keys(key)
  $$,
  $$ values ((array['event', 'tiers']::text[]) collate "C") $$,
  'the public projection has only event and tiers at its top level'
);

select results_eq(
  $$
    select array_agg(key collate "C" order by key collate "C")
    from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000008') as projection(value)
    cross join lateral jsonb_object_keys(projection.value -> 'event') as event_keys(key)
  $$,
  $$
    values ((array[
      'address_line1', 'address_line2', 'admission_type', 'animation_preset', 'artwork_path',
      'category', 'city', 'country_code', 'description', 'ends_at', 'id', 'latitude',
      'longitude', 'organizer', 'postal_code', 'region', 'starts_at', 'timezone', 'title',
      'venue_name'
    ]::text[]) collate "C")
  $$,
  'the public event JSON exposes only display fields'
);

select results_eq(
  $$
    select array_agg(key collate "C" order by key collate "C")
    from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000008') as projection(value)
    cross join lateral jsonb_object_keys(projection.value -> 'event' -> 'organizer') as organizer_keys(key)
  $$,
  $$ values ((array['display_name', 'id']::text[]) collate "C") $$,
  'the public organizer JSON exposes only identity and display name'
);

select results_eq(
  $$
    select array_agg(distinct key collate "C" order by key collate "C")
    from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000008') as projection(value)
    cross join lateral jsonb_array_elements(projection.value -> 'tiers') as tier(value)
    cross join lateral jsonb_object_keys(tier.value) as tier_keys(key)
  $$,
  $$
    values ((array[
      'availability_status', 'currency', 'description', 'id', 'name', 'unit_amount_minor'
    ]::text[]) collate "C")
  $$,
  'public tiers expose no exact inventory, Connect, fee, customer, or financial identifiers'
);

select results_eq(
  $$
    select tier.value ->> 'name', tier.value ->> 'availability_status'
    from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000008') as projection(value)
    cross join lateral jsonb_array_elements(projection.value -> 'tiers') as tier(value)
    order by tier.value ->> 'name'
  $$,
  $$ values ('Available'::text, 'available'::text), ('Sold Out'::text, 'sold_out'::text) $$,
  'the projection derives availability without revealing inventory counts and excludes archived tiers'
);

select is_empty(
  $$ select * from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000009') $$,
  'blocked paid events return no public projection row'
);

select is_empty(
  $$ select * from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000010') $$,
  'removed paid events return no public projection row'
);

select is_empty(
  $$ select * from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000011') $$,
  'draft paid events return no public projection row'
);

select is_empty(
  $$ select * from public.get_public_event_ticketing('22000000-0000-0000-0000-000000000012') $$,
  'published free events return no paid ticketing projection row'
);

reset role;
select * from finish();
rollback;
