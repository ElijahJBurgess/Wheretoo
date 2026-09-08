begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_function(
  'private', 'calculate_checkout_money',
  array['bigint', 'integer', 'integer', 'bigint', 'text', 'integer', 'bigint'],
  'cart checkout owns one exact aggregate-money helper'
);
select has_function(
  'private', 'reserve_checkout',
  array['uuid', 'jsonb', 'text', 'text', 'uuid', 'text'],
  'cart checkout has the JSON reservation overload'
);
select has_function(
  'public', 'server_reserve_checkout',
  array['uuid', 'jsonb', 'text', 'text', 'uuid', 'text'],
  'the service wrapper exposes the JSON reservation overload'
);
select has_function(
  'private', 'get_checkout_preflight', array['uuid', 'uuid[]'],
  'cart checkout preflight accepts the complete tier set'
);
select has_function(
  'public', 'server_get_checkout_preflight', array['uuid', 'uuid[]'],
  'the service wrapper exposes complete-cart preflight'
);
select function_privs_are(
  'public', 'server_reserve_checkout',
  array['uuid', 'jsonb', 'text', 'text', 'uuid', 'text'],
  'service_role', array['EXECUTE'],
  'only the service role can execute cart reservation'
);
select function_privs_are(
  'public', 'server_get_checkout_preflight', array['uuid', 'uuid[]'],
  'service_role', array['EXECUTE'],
  'only the service role can execute complete-cart preflight'
);
select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege(
        'anon', 'public.server_reserve_checkout(uuid,jsonb,text,text,uuid,text)', 'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'authenticated', 'public.server_reserve_checkout(uuid,jsonb,text,text,uuid,text)', 'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role', 'private.reserve_checkout(uuid,jsonb,text,text,uuid,text)', 'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role', 'private.get_checkout_preflight(uuid,uuid[])', 'EXECUTE'
      )
    ]
  $$,
  $$ values (array[false, false, false, false]) $$,
  'browser roles cannot execute cart reservation and service cannot bypass private wrappers'
);

select results_eq(
  $$
    select platform_product_fee_minor, stripe_fee_estimate_minor,
      application_fee_amount_minor, expected_organizer_proceeds_minor,
      subtotal_minor, total_minor
    from private.calculate_checkout_money(3001, 3, 500, 50, 'platform_fee_only', null, null)
  $$,
  $$ values (300::bigint, 0::bigint, 300::bigint, 2701::bigint, 3001::bigint, 3001::bigint) $$,
  'percentage rounds once on the aggregate subtotal and the fixed fee is per admission'
);

select results_eq(
  $$
    select platform_product_fee_minor, stripe_fee_estimate_minor,
      application_fee_amount_minor, expected_organizer_proceeds_minor,
      subtotal_minor, total_minor
    from private.calculate_checkout_money(3001, 3, 500, 50, 'stripe_fee_estimate', 290, 30)
  $$,
  $$ values (300::bigint, 177::bigint, 477::bigint, 2524::bigint, 3001::bigint, 3001::bigint) $$,
  'processing fixed estimate is applied per admission and its percentage rounds once'
);

select throws_ok(
  $$ select * from private.calculate_checkout_money(
    1000, 10, 0, 9223372036854775807, 'platform_fee_only', null, null
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'aggregate money rejects a fixed-fee multiplication that cannot fit in bigint'
);

select throws_ok(
  $$ select * from private.calculate_checkout_money(
    null, 1, 500, 50, 'platform_fee_only', null, null
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'aggregate money rejects null required inputs instead of returning null totals'
);

insert into auth.users (id, email) values
  ('96000000-0000-4000-8000-000000000001', 'cart-reservation-owner@example.invalid'),
  ('96000000-0000-4000-8000-000000000002', 'other-cart-owner@example.invalid');
insert into public.organizers (id, display_name)
values
  ('96000000-0000-4000-8000-000000000001', 'Cart Reservation Owner'),
  ('96000000-0000-4000-8000-000000000002', 'Other Cart Owner');
insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  '96100000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  'published', 'clear', 'Cart Reservation Event',
  'A complete paid fixture for multi-tier checkout reservations.', 'community',
  now() + interval '2 days', now() + interval '2 days 2 hours',
  'Cart Hall', '1 Cart Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.cart-reservation', 37.7936, -122.3958, 'paid', now()
), (
  '96100000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000002',
  'draft', 'clear', 'Other Organizer Event',
  'A second organizer fixture for cross-event cart rejection.', 'community',
  now() + interval '3 days', now() + interval '3 days 2 hours',
  'Other Hall', '2 Cart Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.other-cart-reservation', 37.7937, -122.3959, 'paid', null
);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  ('96200000-0000-4000-8000-000000000001', '96100000-0000-4000-8000-000000000001', 'General Admission', 1001, 'usd', 30, 'active', 1),
  ('96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000001', 'VIP', 999, 'usd', 30, 'active', 2),
  ('96200000-0000-4000-8000-000000000003', '96100000-0000-4000-8000-000000000001', 'Final', 2000, 'usd', 1, 'active', 3),
  ('96200000-0000-4000-8000-000000000004', '96100000-0000-4000-8000-000000000002', 'Other Organizer Tier', 1500, 'usd', 10, 'active', 1);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  '96000000-0000-4000-8000-000000000001', 'acct_cartreservation',
  'active', 'active', 'clear', 0, 0, now()
);
insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  '96100000-0000-4000-8000-000000000001', 'all_ages', false, false, false, false, false, false
);
select set_config(
  'request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies('96100000-0000-4000-8000-000000000001');
select public.publish_event('96100000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;
set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    'Gate Buyer', 'gate-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000010', repeat('0', 64)
  ) $$,
  'P0001', 'CHECKOUT_DISABLED',
  'the JSON overload blocks a new cart while checkout creation is off'
);
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;

set local role service_role;
select results_eq(
  $$
    select organizer_id, stripe_account_id
    from public.server_get_checkout_preflight(
      '96100000-0000-4000-8000-000000000001',
      array[
        '96200000-0000-4000-8000-000000000002'::uuid,
        '96200000-0000-4000-8000-000000000001'::uuid
      ]
    )
  $$,
  $$ values (
    '96000000-0000-4000-8000-000000000001'::uuid,
    'acct_cartreservation'::text
  ) $$,
  'complete-cart preflight returns the authoritative organizer destination'
);
select throws_ok(
  $$ select * from public.server_get_checkout_preflight(
    '96100000-0000-4000-8000-000000000001',
    array[
      '96200000-0000-4000-8000-000000000001'::uuid,
      '96200000-0000-4000-8000-000000000001'::uuid
    ]
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'complete-cart preflight rejects duplicate tier identifiers'
);
select throws_ok(
  $$ select * from public.server_get_checkout_preflight(
    '96100000-0000-4000-8000-000000000001',
    array[
      '96200000-0000-4000-8000-000000000090'::uuid,
      '96200000-0000-4000-8000-000000000091'::uuid,
      '96200000-0000-4000-8000-000000000092'::uuid,
      '96200000-0000-4000-8000-000000000093'::uuid,
      '96200000-0000-4000-8000-000000000094'::uuid,
      '96200000-0000-4000-8000-000000000095'::uuid,
      '96200000-0000-4000-8000-000000000096'::uuid,
      '96200000-0000-4000-8000-000000000097'::uuid,
      '96200000-0000-4000-8000-000000000098'::uuid,
      '96200000-0000-4000-8000-000000000099'::uuid
    ]
  ) $$,
  'P0001', 'TIER_NOT_ACTIVE',
  'preflight accepts ten distinct tier identifiers before authoritative lookup'
);
select throws_ok(
  $$ select * from public.server_get_checkout_preflight(
    '96100000-0000-4000-8000-000000000001',
    array[
      '96200000-0000-4000-8000-000000000089'::uuid,
      '96200000-0000-4000-8000-000000000090'::uuid,
      '96200000-0000-4000-8000-000000000091'::uuid,
      '96200000-0000-4000-8000-000000000092'::uuid,
      '96200000-0000-4000-8000-000000000093'::uuid,
      '96200000-0000-4000-8000-000000000094'::uuid,
      '96200000-0000-4000-8000-000000000095'::uuid,
      '96200000-0000-4000-8000-000000000096'::uuid,
      '96200000-0000-4000-8000-000000000097'::uuid,
      '96200000-0000-4000-8000-000000000098'::uuid,
      '96200000-0000-4000-8000-000000000099'::uuid
    ]
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'preflight rejects eleven distinct tier identifiers at the input boundary'
);
create temporary table cart_reservation on commit drop as
select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
  '  Ada Lovelace  ', ' ADA@Example.INVALID ',
  '96300000-0000-4000-8000-000000000001', repeat('a', 64)
);
reset role;

select results_eq(
  $$
    select quantity, subtotal_minor, platform_product_fee_minor,
      application_fee_amount_minor, expected_organizer_proceeds_minor,
      jsonb_array_length(order_items)
    from cart_reservation
  $$,
  $$ values (3::integer, 3001::bigint, 300::bigint, 300::bigint, 2701::bigint, 2::integer) $$,
  '2 GA plus 1 VIP produces one aggregate order with exact aggregate fees'
);
select is(
  (select order_items -> 0 ->> 'ticket_tier_id' from cart_reservation),
  '96200000-0000-4000-8000-000000000001',
  'reservation items are sorted by tier UUID regardless of input order'
);
select results_eq(
  $$
    select count(*)::bigint, coalesce(sum(quantity), 0)::bigint
    from public.order_items where order_id = (select order_id from cart_reservation)
  $$,
  $$ values (2::bigint, 3::bigint) $$,
  'all requested tier snapshots are inserted atomically'
);

update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;
set local role service_role;
select results_eq(
  $$
    select order_id, order_items
    from public.server_reserve_checkout(
      '96100000-0000-4000-8000-000000000001',
      '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
      'Ada Lovelace', 'ada@example.invalid',
      '96300000-0000-4000-8000-000000000001', repeat('a', 64)
    )
  $$,
  $$ select order_id, order_items from cart_reservation $$,
  'an exact persisted JSON cart retry remains resumable while creation is off'
);
reset role;

set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    'Ada Lovelace', 'ada@example.invalid',
    '96300000-0000-4000-8000-000000000001', repeat('a', 64)
  ) $$,
  'P0001', 'IDEMPOTENCY_CONFLICT',
  'a material JSON cart retry conflicts while creation is off'
);
reset role;
update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;
set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001', '[]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000002', repeat('b', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'empty carts are rejected before mutation'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1,"price":1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000002', repeat('b', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'unrecognized cart item keys are rejected'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1.5}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000002', repeat('b', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'fractional quantities are rejected'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":5},{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":5}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000002', repeat('b', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'duplicate tier IDs are rejected'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1}'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000004', repeat('d', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'non-array carts are rejected'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":0}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000005', repeat('e', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'zero quantities are rejected'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":-1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000006', repeat('f', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'negative quantities are rejected'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":11}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000006', repeat('f', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'per-item quantity above ten is rejected'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000090","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000091","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000092","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000093","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000094","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000095","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000096","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000097","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000098","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000099","quantity":1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000016', repeat('9', 64)
  ) $$,
  'P0001', 'TIER_NOT_FOUND',
  'reservation accepts ten distinct one-admission lines before authoritative lookup'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000089","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000090","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000091","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000092","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000093","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000094","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000095","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000096","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000097","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000098","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000099","quantity":1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000017', repeat('0', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'reservation rejects eleven distinct one-admission lines at the input boundary'
);
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000099","quantity":1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000007', repeat('0', 64)
  ) $$,
  'P0001', 'TIER_NOT_FOUND', 'unknown tiers are rejected'
);

update public.ticket_tiers set status = 'archived'
where id = '96200000-0000-4000-8000-000000000003';
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000008', repeat('1', 64)
  ) $$,
  'P0001', 'TIER_NOT_ACTIVE', 'inactive tiers are rejected'
);
update public.ticket_tiers set status = 'active'
where id = '96200000-0000-4000-8000-000000000003';

select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000004","quantity":1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000009', repeat('2', 64)
  ) $$,
  'P0001', 'TIER_NOT_ACTIVE',
  'a cart cannot mix tiers from another organizer event'
);

reset role;
alter table public.ticket_tiers drop constraint ticket_tiers_currency_check;
update public.ticket_tiers set currency = 'eur'
where id = '96200000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000010', repeat('3', 64)
  ) $$,
  'P0001', 'TIER_NOT_ACTIVE', 'a cart cannot mix tier currencies'
);
reset role;
update public.ticket_tiers set currency = 'usd'
where id = '96200000-0000-4000-8000-000000000003';
alter table public.ticket_tiers
  add constraint ticket_tiers_currency_check check (currency = 'usd');

update public.platform_fee_rules
set processing_fee_treatment = 'stripe_fee_estimate',
    processing_estimate_percent_bps = 290,
    processing_estimate_fixed_minor = 30
where not livemode and currency = 'usd' and effective_until is null;

set local role service_role;
create temporary table processing_fee_cart on commit drop as
select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":2}]'::jsonb,
  'Processing Fee Buyer', 'processing-fee@example.invalid',
  '96300000-0000-4000-8000-000000000011', repeat('4', 64)
);
reset role;

select results_eq(
  $$
    select quantity, subtotal_minor, platform_product_fee_minor,
      stripe_fee_estimate_minor, application_fee_amount_minor,
      expected_organizer_proceeds_minor
    from processing_fee_cart
  $$,
  $$ values (
    3::integer, 2999::bigint, 299::bigint, 176::bigint, 475::bigint, 2524::bigint
  ) $$,
  'a persisted multi-tier order satisfies aggregate platform and processing fee arithmetic'
);

update public.platform_fee_rules
set platform_percent_bps = 900,
    platform_fixed_minor = 90,
    processing_fee_treatment = 'platform_fee_only',
    processing_estimate_percent_bps = null,
    processing_estimate_fixed_minor = null
where not livemode and currency = 'usd' and effective_until is null;

set local role service_role;
select results_eq(
  $$
    select order_id, platform_product_fee_minor, stripe_fee_estimate_minor,
      application_fee_amount_minor, create_request_digest, order_items
    from public.server_reserve_checkout(
      '96100000-0000-4000-8000-000000000001',
      '[{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":2},{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      'Processing Fee Buyer', 'processing-fee@example.invalid',
      '96300000-0000-4000-8000-000000000011', repeat('4', 64)
    )
  $$,
  $$
    select order_id, platform_product_fee_minor, stripe_fee_estimate_minor,
      application_fee_amount_minor, create_request_digest, order_items
    from processing_fee_cart
  $$,
  'fee-rule edits cannot rewrite a persisted cart or its canonical digest on retry'
);
select public.server_attach_checkout_session(
  (select order_id from cart_reservation),
  'cs_test_cartreservation',
  (select checkout_expires_at from cart_reservation)
);
select results_eq(
  $$
    select order_id, existing_checkout_session_id, create_request_digest, order_items
    from public.server_reserve_checkout(
      '96100000-0000-4000-8000-000000000001',
      '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
      'Ada Lovelace', 'ada@example.invalid',
      '96300000-0000-4000-8000-000000000001', repeat('a', 64)
    )
  $$,
  $$
    select order_id, 'cs_test_cartreservation'::text, create_request_digest, order_items
    from cart_reservation
  $$,
  'an attached Checkout Session and persisted snapshots are stable on retry'
);
reset role;

update public.platform_fee_rules
set platform_percent_bps = 500,
    platform_fixed_minor = 50
where not livemode and currency = 'usd' and effective_until is null;

update public.ticket_tiers set unit_amount_minor = 7777
where id = '96200000-0000-4000-8000-000000000001';
select results_eq(
  $$
    select unit_amount_minor, subtotal_minor
    from public.order_items
    where order_id = (select order_id from cart_reservation)
      and ticket_tier_id = '96200000-0000-4000-8000-000000000001'
  $$,
  $$ values (1001::bigint, 2002::bigint) $$,
  'tier edits cannot rewrite persisted order-item snapshots'
);

set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":10},{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    'Cart Buyer', 'cart-buyer@example.invalid',
    '96300000-0000-4000-8000-000000000003', repeat('c', 64)
  ) $$,
  'P0001', 'CHECKOUT_INPUT_INVALID', 'aggregate quantity above ten is rejected'
);
reset role;

select is(
  (select count(*)::bigint from public.orders
    where client_request_id = '96300000-0000-4000-8000-000000000003'),
  0::bigint,
  'invalid cart input leaves no partial order'
);

set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    'Ada Lovelace', 'ada@example.invalid',
    '96300000-0000-4000-8000-000000000001', repeat('b', 64)
  ) $$,
  'P0001', 'IDEMPOTENCY_CONFLICT',
  'a same-cart retry with a different bearer hash is rejected'
);

create temporary table ten_admission_cart on commit drop as
select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":10}]'::jsonb,
  'Ten Buyer', 'ten@example.invalid',
  '96300000-0000-4000-8000-000000000012', repeat('5', 64)
);
reset role;

select results_eq(
  $$ select quantity, jsonb_array_length(order_items) from ten_admission_cart $$,
  $$ values (10::integer, 1::integer) $$,
  'a one-tier cart accepts the exact ten-admission aggregate maximum'
);

update public.orders
set status = 'requires_review', reconciliation_status = 'requires_review'
where id = (select order_id from ten_admission_cart);
set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":10}]'::jsonb,
    'Ten Buyer', 'ten@example.invalid',
    '96300000-0000-4000-8000-000000000012', repeat('5', 64)
  ) $$,
  'P0001', 'ORDER_REQUIRES_REVIEW',
  'a review-state retry cannot resume external Checkout creation'
);
reset role;

update public.orders
set status = 'paid', paid_at = now(), reconciliation_status = 'reconciled'
where id = (select order_id from ten_admission_cart);
set local role service_role;
select results_eq(
  $$
    select order_id, create_request_digest, order_items
    from public.server_reserve_checkout(
      '96100000-0000-4000-8000-000000000001',
      '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":10}]'::jsonb,
      'Ten Buyer', 'ten@example.invalid',
      '96300000-0000-4000-8000-000000000012', repeat('5', 64)
    )
  $$,
  $$ select order_id, create_request_digest, order_items from ten_admission_cart $$,
  'a paid retry returns the same terminal order and snapshots'
);
reset role;

update public.platform_fee_rules
set platform_fixed_minor = 1000
where not livemode and currency = 'usd' and effective_until is null;
set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    'Bound Buyer', 'bound@example.invalid',
    '96300000-0000-4000-8000-000000000013', repeat('6', 64)
  ) $$,
  'P0001', 'CHECKOUT_CREATION_FAILED',
  'checkout rejects an application fee that is not below the subtotal'
);
reset role;
update public.platform_fee_rules
set platform_fixed_minor = 50
where not livemode and currency = 'usd' and effective_until is null;

set local role service_role;
create temporary table final_inventory_cart on commit drop as
select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
  'Final Buyer', 'final@example.invalid',
  '96300000-0000-4000-8000-000000000014', repeat('7', 64)
);
reset role;
update public.orders set status = 'payment_processing'
where id = (select order_id from final_inventory_cart);

set local role service_role;
select throws_ok(
  $$ select * from public.server_reserve_checkout(
    '96100000-0000-4000-8000-000000000001',
    '[{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":1},{"tier_id":"96200000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
    'Atomic Buyer', 'atomic@example.invalid',
    '96300000-0000-4000-8000-000000000015', repeat('8', 64)
  ) $$,
  'P0001', 'TIER_SOLD_OUT',
  'one insufficient line rejects the complete otherwise-available cart'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint,
      (select count(*)::bigint from public.order_items as items
       join public.orders as orders on orders.id = items.order_id
       where orders.client_request_id = '96300000-0000-4000-8000-000000000015')
    from public.orders
    where client_request_id = '96300000-0000-4000-8000-000000000015'
  $$,
  $$ values (0::bigint, 0::bigint) $$,
  'a sold-out cart leaves zero order and order-item rows'
);

select * from finish();
rollback;
