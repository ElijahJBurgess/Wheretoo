begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

create or replace function pg_temp.checkout_runtime_state()
returns table (
  singleton boolean,
  checkout_creation_enabled boolean,
  has_updated_at boolean
)
language plpgsql
set search_path = ''
as $$
begin
  return query execute
    'select singleton, checkout_creation_enabled, updated_at is not null '
    'from private.checkout_runtime_control';
exception
  when undefined_table then
    return;
end;
$$;

create or replace function pg_temp.set_checkout_creation_enabled(p_enabled boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute
    'update private.checkout_runtime_control '
    'set checkout_creation_enabled = $1, updated_at = pg_catalog.statement_timestamp() '
    'where singleton'
  using p_enabled;
exception
  when undefined_table then
    null;
end;
$$;

select results_eq(
  $$
    select pg_catalog.pg_get_constraintdef(constraints.oid, true)
    from pg_catalog.pg_constraint as constraints
    where constraints.conrelid = 'public.orders'::regclass
      and constraints.conname = 'orders_quantity_check'
  $$,
  $$ values ('CHECK (quantity >= 1 AND quantity <= 10)'::text) $$,
  'orders enforce an aggregate quantity from one through ten'
);

select results_eq(
  $$
    select pg_catalog.pg_get_constraintdef(constraints.oid, true)
    from pg_catalog.pg_constraint as constraints
    where constraints.conrelid = 'public.order_items'::regclass
      and constraints.conname = 'order_items_quantity_check'
  $$,
  $$ values ('CHECK (quantity >= 1 AND quantity <= 10)'::text) $$,
  'order items enforce a quantity from one through ten'
);

select results_eq(
  $$
    select array_agg(attributes.attname order by key_columns.ordinality)
    from pg_catalog.pg_constraint as constraints
    cross join lateral unnest(constraints.conkey)
      with ordinality as key_columns(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.conrelid
      and attributes.attnum = key_columns.attnum
    where constraints.conrelid = 'public.order_items'::regclass
      and constraints.contype = 'u'
  $$,
  $$ values ((array['order_id', 'ticket_tier_id']::name[]) collate "C") $$,
  'one order item is allowed for each distinct tier in an order'
);

insert into auth.users (id, email)
values ('10000000-0000-4000-8000-000000000101', 'checkout-integrity-schema@example.invalid');

insert into public.organizers (id, display_name)
values ('10000000-0000-4000-8000-000000000101', 'Checkout Integrity Schema');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
)
values (
  '20000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  'published', 'clear', 'Checkout Integrity Schema Event',
  'A paid event used to verify bounded multi-tier order cardinality.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'Integrity Venue', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.checkout-integrity-schema', 37.7936, -122.3958, 'paid', now()
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency,
  quantity_total, status, sort_order, version
)
values
  (
    '30000000-0000-4000-8000-000000000101',
    '20000000-0000-4000-8000-000000000101',
    'General Admission', 2000, 'usd', 20, 'active', 1, 1
  ),
  (
    '30000000-0000-4000-8000-000000000102',
    '20000000-0000-4000-8000-000000000101',
    'VIP', 3000, 'usd', 20, 'active', 2, 1
  ),
  (
    '30000000-0000-4000-8000-000000000103',
    '20000000-0000-4000-8000-000000000101',
    'Balcony', 1000, 'usd', 20, 'active', 3, 1
  );

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
)
values (
  '10000000-0000-4000-8000-000000000101', 'acct_checkoutintegrityschema',
  'active', 'active', 'clear', 0, 0, now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
values (
  '20000000-0000-4000-8000-000000000101',
  'all_ages', false, false, false, false, false, false
);

select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true
);
set local role authenticated;
select public.accept_current_event_policies('20000000-0000-4000-8000-000000000101');
select public.publish_event('20000000-0000-4000-8000-000000000101');
reset role;

insert into public.orders (
  id, order_number, event_id, organizer_id, buyer_name, buyer_email, client_request_id,
  confirmation_token_hash, quantity, currency, subtotal_minor, total_minor,
  platform_product_fee_minor, application_fee_amount_minor,
  expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
  platform_fixed_minor, processing_fee_treatment
)
values (
  '40000000-0000-4000-8000-000000000101',
  'WT-INTEGRITY-SCHEMA-101',
  '20000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  'Schema Buyer',
  'schema-buyer@example.invalid',
  '50000000-0000-4000-8000-000000000101',
  repeat('a', 64),
  2,
  'usd',
  5000,
  5000,
  350,
  350,
  4650,
  '00000000-0000-0000-0000-000000000500',
  500,
  50,
  'platform_fee_only'
);

insert into public.orders (
  id, order_number, event_id, organizer_id, buyer_name, buyer_email, client_request_id,
  confirmation_token_hash, quantity, currency, subtotal_minor, total_minor,
  platform_product_fee_minor, application_fee_amount_minor,
  expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
  platform_fixed_minor, processing_fee_treatment
)
values (
  '40000000-0000-4000-8000-000000000102',
  'WT-INTEGRITY-ITEM-QUANTITY',
  '20000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  'Item Quantity Buyer',
  'item-quantity-buyer@example.invalid',
  '50000000-0000-4000-8000-000000000106',
  repeat('f', 64),
  10,
  'usd',
  10000,
  10000,
  1000,
  1000,
  9000,
  '00000000-0000-0000-0000-000000000500',
  500,
  50,
  'platform_fee_only'
);

insert into public.order_items (
  id, order_id, ticket_tier_id, tier_version, tier_name,
  unit_amount_minor, quantity, subtotal_minor, currency
)
values (
  '60000000-0000-4000-8000-000000000101',
  '40000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000101',
  1, 'General Admission', 2000, 1, 2000, 'usd'
);

select lives_ok(
  $$
    insert into public.order_items (
      id, order_id, ticket_tier_id, tier_version, tier_name,
      unit_amount_minor, quantity, subtotal_minor, currency
    ) values (
      '60000000-0000-4000-8000-000000000102',
      '40000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000102',
      1, 'VIP', 3000, 1, 3000, 'usd'
    )
  $$,
  'one order accepts two distinct tier items'
);

select throws_ok(
  $$
    insert into public.order_items (
      id, order_id, ticket_tier_id, tier_version, tier_name,
      unit_amount_minor, quantity, subtotal_minor, currency
    ) values (
      '60000000-0000-4000-8000-000000000103',
      '40000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000101',
      1, 'General Admission', 2000, 1, 2000, 'usd'
    )
  $$,
  '23505',
  null,
  'one order rejects a duplicate tier item'
);

select throws_ok(
  $$
    insert into public.orders (
      order_number, event_id, organizer_id, buyer_name, buyer_email, client_request_id,
      confirmation_token_hash, quantity, currency, subtotal_minor, total_minor,
      platform_product_fee_minor, application_fee_amount_minor,
      expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
      platform_fixed_minor, processing_fee_treatment
    ) values (
      'WT-INTEGRITY-QUANTITY-11',
      '20000000-0000-4000-8000-000000000101',
      '10000000-0000-4000-8000-000000000101',
      'Quantity Buyer', 'quantity-buyer@example.invalid',
      '50000000-0000-4000-8000-000000000102', repeat('b', 64),
      11, 'usd', 11000, 11000, 1100, 1100, 9900,
      '00000000-0000-0000-0000-000000000500', 500, 50, 'platform_fee_only'
    )
  $$,
  '23514',
  null,
  'an order rejects aggregate quantity above ten'
);

select throws_ok(
  $$
    insert into public.order_items (
      id, order_id, ticket_tier_id, tier_version, tier_name,
      unit_amount_minor, quantity, subtotal_minor, currency
    ) values (
      '60000000-0000-4000-8000-000000000104',
      '40000000-0000-4000-8000-000000000102',
      '30000000-0000-4000-8000-000000000103',
      1, 'Balcony', 1000, 11, 11000, 'usd'
    )
  $$,
  '23514',
  null,
  'an order item rejects quantity above ten'
);

select has_table(
  'private',
  'checkout_runtime_control',
  'private checkout runtime control exists'
);

select columns_are(
  'private',
  'checkout_runtime_control',
  array['singleton', 'checkout_creation_enabled', 'updated_at'],
  'checkout runtime control columns are exact'
);

select col_is_pk(
  'private',
  'checkout_runtime_control',
  'singleton',
  'checkout runtime control uses a singleton primary key'
);

select results_eq(
  $$
    select pg_catalog.pg_get_constraintdef(constraints.oid, true)
    from pg_catalog.pg_constraint as constraints
    where constraints.conrelid = pg_catalog.to_regclass('private.checkout_runtime_control')
      and constraints.conname = 'checkout_runtime_control_singleton_check'
  $$,
  $$ values ('CHECK (singleton)'::text) $$,
  'the runtime control permits only the true singleton key'
);

select results_eq(
  $$
    select singleton, checkout_creation_enabled, has_updated_at
    from pg_temp.checkout_runtime_state()
  $$,
  $$ values (true, false, true) $$,
  'checkout creation starts disabled in the one control row'
);

select results_eq(
  $$
    select
      pg_catalog.to_regclass('private.checkout_runtime_control') is not null
      and not exists (
        select 1
        from pg_catalog.pg_class as relations
        cross join lateral pg_catalog.aclexplode(
          coalesce(relations.relacl, pg_catalog.acldefault('r', relations.relowner))
        ) as privileges
        where relations.oid = pg_catalog.to_regclass('private.checkout_runtime_control')
          and privileges.grantee <> relations.relowner
      )
  $$,
  $$ values (true) $$,
  'the private control table has no non-owner privileges'
);

select results_eq(
  $$
    select array[
      coalesce(pg_catalog.has_table_privilege(
        'anon', pg_catalog.to_regclass('private.checkout_runtime_control'), 'SELECT'
      ), false),
      coalesce(pg_catalog.has_table_privilege(
        'anon', pg_catalog.to_regclass('private.checkout_runtime_control'), 'UPDATE'
      ), false),
      coalesce(pg_catalog.has_table_privilege(
        'authenticated', pg_catalog.to_regclass('private.checkout_runtime_control'), 'SELECT'
      ), false),
      coalesce(pg_catalog.has_table_privilege(
        'authenticated', pg_catalog.to_regclass('private.checkout_runtime_control'), 'UPDATE'
      ), false),
      coalesce(pg_catalog.has_table_privilege(
        'service_role', pg_catalog.to_regclass('private.checkout_runtime_control'), 'SELECT'
      ), false),
      coalesce(pg_catalog.has_table_privilege(
        'service_role', pg_catalog.to_regclass('private.checkout_runtime_control'), 'UPDATE'
      ), false)
    ]
  $$,
  $$ values (array[false, false, false, false, false, false]) $$,
  'browser and service roles cannot read or change the checkout switch directly'
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
        'service_role', 'public.server_reserve_checkout(uuid,jsonb,text,text,uuid,text)', 'EXECUTE'
      )
    ]
  $$,
  $$ values (array[false, false, false, true]) $$,
  'reservation access remains limited to the service wrapper'
);

set local role service_role;
select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '20000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object('tier_id', '30000000-0000-4000-8000-000000000101'::uuid, 'quantity', 1)),
      'Disabled Buyer', 'disabled-buyer@example.invalid',
      '50000000-0000-4000-8000-000000000103', repeat('c', 64)
    )
  $$,
  'P0001',
  'CHECKOUT_DISABLED',
  'the default-off switch blocks a new reservation'
);
reset role;

select pg_temp.set_checkout_creation_enabled(true);

set local role service_role;
create temporary table enabled_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '20000000-0000-4000-8000-000000000101',
  jsonb_build_array(jsonb_build_object('tier_id', '30000000-0000-4000-8000-000000000101'::uuid, 'quantity', 1)),
  'Retry Buyer', 'retry-buyer@example.invalid',
  '50000000-0000-4000-8000-000000000104', repeat('d', 64)
);
reset role;

select is(
  (select count(*) from enabled_reservation),
  1::bigint,
  'enabling checkout creation allows one new reservation'
);

select pg_temp.set_checkout_creation_enabled(false);

set local role service_role;
select results_eq(
  $$
    select order_id
    from public.server_reserve_checkout(
      '20000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object('tier_id', '30000000-0000-4000-8000-000000000101'::uuid, 'quantity', 1)),
      'Retry Buyer', 'retry-buyer@example.invalid',
      '50000000-0000-4000-8000-000000000104', repeat('d', 64)
    )
  $$,
  $$ select order_id from enabled_reservation $$,
  'the off switch preserves an exact already-persisted request retry'
);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '20000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object('tier_id', '30000000-0000-4000-8000-000000000102'::uuid, 'quantity', 1)),
      'Retry Buyer', 'retry-buyer@example.invalid',
      '50000000-0000-4000-8000-000000000104', repeat('d', 64)
    )
  $$,
  'P0001',
  'IDEMPOTENCY_CONFLICT',
  'a persisted request id with a different tier is an idempotency conflict'
);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '20000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object('tier_id', '30000000-0000-4000-8000-000000000101'::uuid, 'quantity', 1)),
      'Changed Buyer', 'retry-buyer@example.invalid',
      '50000000-0000-4000-8000-000000000104', repeat('d', 64)
    )
  $$,
  'P0001',
  'IDEMPOTENCY_CONFLICT',
  'a persisted request id with a different buyer name is an idempotency conflict'
);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '20000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object('tier_id', '30000000-0000-4000-8000-000000000101'::uuid, 'quantity', 1)),
      'Retry Buyer', 'changed-buyer@example.invalid',
      '50000000-0000-4000-8000-000000000104', repeat('d', 64)
    )
  $$,
  'P0001',
  'IDEMPOTENCY_CONFLICT',
  'a persisted request id with a different buyer email is an idempotency conflict'
);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '20000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object('tier_id', '30000000-0000-4000-8000-000000000101'::uuid, 'quantity', 1)),
      'Retry Buyer', 'retry-buyer@example.invalid',
      '50000000-0000-4000-8000-000000000104', repeat('9', 64)
    )
  $$,
  'P0001',
  'IDEMPOTENCY_CONFLICT',
  'a persisted request id with a different confirmation bearer hash is an idempotency conflict'
);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '20000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object('tier_id', '30000000-0000-4000-8000-000000000101'::uuid, 'quantity', 1)),
      'Another Buyer', 'another-buyer@example.invalid',
      '50000000-0000-4000-8000-000000000105', repeat('e', 64)
    )
  $$,
  'P0001',
  'CHECKOUT_DISABLED',
  'the off switch continues to block a different request'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from public.orders
    where client_request_id in (
      '50000000-0000-4000-8000-000000000103',
      '50000000-0000-4000-8000-000000000104',
      '50000000-0000-4000-8000-000000000105'
    )
  $$,
  $$ values (1::bigint) $$,
  'disabled creation has no order side effect while the exact retry remains singular'
);

select * from finish();
rollback;
