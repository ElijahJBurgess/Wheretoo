begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- This installed-contract section is safe to run for RED without enabling sales.
select is(pg_catalog.to_regprocedure(signature), null::regprocedure,
  'obsolete singular contract is absent: ' || signature)
from unnest(array[
  'public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)',
  'private.reserve_checkout(uuid,uuid,text,text,uuid,text)',
  'private.checkout_reservation_v1(uuid,uuid,text,text,uuid,text)',
  'public.server_get_checkout_preflight(uuid,uuid)',
  'private.get_checkout_preflight(uuid,uuid)',
  'private.checkout_request_digest(uuid,uuid,uuid,uuid,text,text,text,bigint,bigint,text,timestamptz,text)',
  'public.server_get_webhook_order_snapshot(uuid,text)',
  'private.get_webhook_order_snapshot(uuid,text)',
  'public.server_get_webhook_payment_order_snapshot(uuid)',
  'private.get_webhook_payment_order_snapshot(uuid)',
  'public.server_lookup_order_confirmation(text)',
  'private.lookup_order_confirmation(text)',
  'private.order_confirmation_status(text)'
]) as obsolete(signature);

select ok(pg_catalog.to_regprocedure(signature) is not null,
  'canonical service contract exists: ' || signature)
from unnest(array[
  'public.server_reserve_checkout(uuid,jsonb,text,text,uuid,text)',
  'public.server_get_checkout_preflight(uuid,uuid[])',
  'public.server_get_checkout_integrity_order_snapshot(uuid,text)',
  'public.server_get_checkout_integrity_payment_snapshot(uuid)',
  'public.server_lookup_checkout_integrity_confirmation(text)',
  'public.server_fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)'
]) as canonical(signature);

select is(array[
    pg_catalog.has_function_privilege('anon', signature, 'EXECUTE'),
    pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE'),
    pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  ], array[false, false, true],
  'only service_role executes the canonical public boundary: ' || signature)
from unnest(array[
  'public.server_reserve_checkout(uuid,jsonb,text,text,uuid,text)',
  'public.server_get_checkout_preflight(uuid,uuid[])',
  'public.server_get_checkout_integrity_order_snapshot(uuid,text)',
  'public.server_get_checkout_integrity_payment_snapshot(uuid)',
  'public.server_lookup_checkout_integrity_confirmation(text)',
  'public.server_fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)'
]) as canonical(signature);

select is(array[
    pg_catalog.has_function_privilege('anon', signature, 'EXECUTE'),
    pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE'),
    pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  ], array[false, false, false],
  'private implementation has no direct browser/service execution: ' || signature)
from unnest(array[
  'private.reserve_checkout(uuid,jsonb,text,text,uuid,text)',
  'private.get_checkout_preflight(uuid,uuid[])',
  'private.get_checkout_integrity_order_snapshot(uuid,text)',
  'private.get_checkout_integrity_payment_snapshot(uuid)',
  'private.lookup_checkout_integrity_confirmation(text)',
  'private.fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)'
]) as canonical(signature);

select ok(pg_catalog.strpos(pg_catalog.pg_get_functiondef(
  'private.fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)'::regprocedure),
  'private.checkout_request_digest(') = 0,
  'installed fulfillment has no singular digest acceptance branch');

select ok(pg_catalog.strpos(pg_catalog.pg_get_functiondef(
  'private.fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)'::regprocedure),
  'private.checkout_cart_request_digest(') > 0,
  'installed fulfillment continues binding the complete cart snapshot');

select is((select pg_catalog.pg_get_constraintdef(oid, true)
  from pg_catalog.pg_constraint
  where conrelid = 'public.order_items'::regclass
    and conname = 'order_items_order_id_ticket_tier_id_key'),
  'UNIQUE (order_id, ticket_tier_id)', 'order items retain per-tier uniqueness');
select ok(not exists(select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.order_items'::regclass
    and conname = 'order_items_order_id_key'),
  'no single-item-per-order constraint is restored');
select is((select pg_catalog.pg_get_constraintdef(oid, true)
  from pg_catalog.pg_constraint
  where conrelid = 'public.tickets'::regclass
    and conname = 'tickets_order_item_unit_sequence_key'),
  'UNIQUE (order_item_id, unit_sequence)', 'tickets retain per-admission uniqueness');

-- Rollback-only behavioral gate; execute only in the owner's authorized database GREEN.
insert into auth.users (id, email)
values ('d5100000-0000-4000-8000-000000000001', 'task15-owner@example.invalid');

insert into public.organizers (id, display_name)
values ('d5100000-0000-4000-8000-000000000001', 'Task 15 Confirmation');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  'd5200000-0000-4000-8000-000000000001',
  'd5100000-0000-4000-8000-000000000001',
  'published', 'clear', 'Task 15 Night Market',
  'Rollback-only multi-item confirmation verification.', 'community',
  now() + interval '2 days', now() + interval '2 days 3 hours',
  'Civic Center Plaza', '9 Market Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.task15-confirmation', 37.7936, -122.3958, 'paid', now()
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  (
    'd5300000-0000-4000-8000-000000000001',
    'd5200000-0000-4000-8000-000000000001',
    'General admission', 2500, 'usd', 20, 'active', 1
  ),
  (
    'd5300000-0000-4000-8000-000000000002',
    'd5200000-0000-4000-8000-000000000001',
    'VIP', 5000, 'usd', 10, 'active', 2
  );

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  'd5100000-0000-4000-8000-000000000001', 'acct_task15confirmation',
  'active', 'active', 'clear', 0, 0, now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  'd5200000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);

select set_config(
  'request.jwt.claim.sub', 'd5100000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies('d5200000-0000-4000-8000-000000000001');
select public.publish_event('d5200000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;


set local role service_role;
create temporary table cleanup_cart_order on commit drop as
select * from public.server_reserve_checkout(
  'd5200000-0000-4000-8000-000000000001',
  '[{"tier_id":"d5300000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
  'Synthetic Buyer', 'task15-buyer@example.invalid',
  'd5400000-0000-4000-8000-000000000001', repeat('5', 64)
);
select results_eq(
  $$ select quantity, subtotal_minor, total_minor, application_fee_amount_minor,
       jsonb_array_length(order_items) from cleanup_cart_order $$,
  $$ values (1::integer, 2500::bigint, 2500::bigint, 175::bigint, 1::integer) $$,
  'quantity-one purchases use the generalized cart money and item snapshot'
);
select public.server_attach_checkout_session(
  (select order_id from cleanup_cart_order), 'cs_test_Task15One',
  (select checkout_expires_at from cleanup_cart_order)
);
select * from public.server_record_webhook_receipt(
  'evt_Task15One', 'checkout.session.completed', false,
  'cs_test_Task15One', '2026-07-29.dahlia', now(), repeat('a', 64)
);
reset role;
update private.checkout_runtime_control set checkout_creation_enabled = false where singleton;
set local role service_role;
select results_eq(
  $$ select order_status, ticket_count from public.server_fulfill_paid_order(
    'evt_Task15One', (select order_id from cleanup_cart_order), 'cs_test_Task15One',
    'pi_Task15One', 'ch_Task15One', 'tr_Task15One', 'fee_Task15One', 'txn_Task15One',
    null, 'payment', 'paid', 'usd', 2500, 2500, 175, 'acct_task15confirmation',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select order_id from cleanup_cart_order)))
  ) $$,
  $$ values ('paid'::text, 1::bigint) $$,
  'the generalized quantity-one order fulfills while new checkout creation is disabled'
);
create temporary table first_cleanup_ticket on commit drop as
select id, issued_at from public.tickets where order_id = (select order_id from cleanup_cart_order);
select results_eq(
  $$ select order_status, ticket_count from public.server_fulfill_paid_order(
    'evt_Task15One', (select order_id from cleanup_cart_order), 'cs_test_Task15One',
    'pi_Task15One', 'ch_Task15One', 'tr_Task15One', 'fee_Task15One', 'txn_Task15One',
    null, 'payment', 'paid', 'usd', 2500, 2500, 175, 'acct_task15confirmation',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select order_id from cleanup_cart_order)))
  ) $$,
  $$ values ('paid'::text, 1::bigint) $$,
  'duplicate generalized fulfillment does not issue an additional quantity-one ticket'
);
select results_eq(
  $$ select id, issued_at from public.tickets where order_id = (select order_id from cleanup_cart_order) $$,
  $$ select id, issued_at from first_cleanup_ticket $$,
  'a duplicate preserves the original ticket identity and issuance time'
);
select results_eq(
  $$ select confirmation_status, quantity, subtotal_minor, total_minor, items
     from public.server_lookup_checkout_integrity_confirmation(repeat('5', 64)) $$,
  $$ values ('paid'::text, 1::integer, 2500::bigint, 2500::bigint,
    '[{"tier_name":"General admission","quantity":1,"unit_amount_minor":2500,"subtotal_minor":2500,"currency":"usd"}]'::jsonb) $$,
  'quantity-one confirmation remains an items array with authoritative total and paid status'
);
reset role;
select is((select checkout_creation_enabled from private.checkout_runtime_control where singleton),
  false, 'checkout remains disabled after lifecycle verification');

select * from finish();
rollback;
