begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_column('public', 'refunds', 'transfer_reversal_amount_minor',
  'refunds persist exact transfer reversal evidence');
select has_column('public', 'refunds', 'application_fee_refund_amount_minor',
  'refunds persist exact application-fee refund evidence');
select has_column('public', 'refunds', 'policy_verified',
  'refunds persist the canonical policy verdict');
select has_column('public', 'refunds', 'policy_failure_code',
  'refunds persist an allowlisted policy failure code');
select has_function(
  'public', 'server_prepare_whole_order_refund', array['uuid', 'text'],
  'whole-order refund preparation is an order-only service boundary'
);
select function_privs_are(
  'public', 'server_prepare_whole_order_refund', array['uuid', 'text'],
  'anon', array[]::text[],
  'anonymous callers cannot read the financial refund snapshot'
);
select function_privs_are(
  'public', 'server_prepare_whole_order_refund', array['uuid', 'text'],
  'authenticated', array[]::text[],
  'authenticated callers cannot read the financial refund snapshot'
);
select function_privs_are(
  'public', 'server_prepare_whole_order_refund', array['uuid', 'text'],
  'service_role', array['EXECUTE'],
  'only the service role can prepare a whole-order refund'
);

insert into auth.users (id, email)
values ('b8100000-0000-4000-8000-000000000001', 'task8-owner@example.invalid');
insert into public.organizers (id, display_name)
values ('b8100000-0000-4000-8000-000000000001', 'Task 8 Refund Safety');
insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  'b8200000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000001',
  'published', 'clear', 'Task 8 Refund Event',
  'Rollback-only whole-order refund verification.', 'community',
  now() + interval '2 days', now() + interval '2 days 2 hours',
  'Safety Hall', '8 Safety Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.task8-refund', 37.7936, -122.3958, 'paid', now()
);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  ('b8300000-0000-4000-8000-000000000001', 'b8200000-0000-4000-8000-000000000001',
   'GA', 1001, 'usd', 20, 'active', 1),
  ('b8300000-0000-4000-8000-000000000002', 'b8200000-0000-4000-8000-000000000001',
   'VIP', 999, 'usd', 20, 'active', 2);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  'b8100000-0000-4000-8000-000000000001', 'acct_task8refund',
  'active', 'active', 'clear', 0, 0, now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present,
  high_risk_activity
) values (
  'b8200000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);
select set_config(
  'request.jwt.claim.sub',
  'b8100000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies(
  'b8200000-0000-4000-8000-000000000001'
);
select public.publish_event('b8200000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;

create temporary table refund_orders (
  kind text primary key,
  id uuid not null,
  session_id text not null,
  payment_intent_id text not null,
  charge_id text not null
) on commit drop;
grant all on refund_orders to service_role;

create or replace function pg_temp.create_paid_order(
  p_kind text,
  p_request_id uuid,
  p_hash text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_session_id text := 'cs_test_task8' || p_kind;
  v_payment_intent_id text := 'pi_task8' || p_kind;
  v_charge_id text := 'ch_task8' || p_kind;
  v_event_id text := 'evt_task8paid' || p_kind;
begin
  select reservation.order_id into v_order_id
  from public.server_reserve_checkout(
    'b8200000-0000-4000-8000-000000000001',
    '[{"tier_id":"b8300000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"b8300000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    'Synthetic Buyer', 'task8-buyer@example.invalid', p_request_id, p_hash
  ) as reservation;
  perform public.server_attach_checkout_session(
    v_order_id, v_session_id,
    (select orders.checkout_expires_at from public.orders where id = v_order_id)
  );
  perform * from public.server_record_webhook_receipt(
    v_event_id, 'checkout.session.completed', false, v_session_id,
    '2026-07-29.dahlia', '2026-09-02 01:00:00+00', repeat('8', 64)
  );
  perform * from public.server_fulfill_paid_order(
    v_event_id, v_order_id, v_session_id, v_payment_intent_id, v_charge_id,
    'tr_task8' || p_kind, 'fee_task8' || p_kind,
    'txn_task8' || p_kind, 'cus_task8' || p_kind,
    'payment', 'paid', 'usd', 3001, 3001, 300, 'acct_task8refund'
  );
  insert into pg_temp.refund_orders values (
    p_kind, v_order_id, v_session_id, v_payment_intent_id, v_charge_id
  );
  return v_order_id;
end;
$$;

set local role service_role;
select pg_temp.create_paid_order('partial', 'b8400000-0000-4000-8000-000000000001', repeat('1',64));
select pg_temp.create_paid_order('incomplete', 'b8400000-0000-4000-8000-000000000002', repeat('2',64));
select pg_temp.create_paid_order('exact', 'b8400000-0000-4000-8000-000000000003', repeat('3',64));
select pg_temp.create_paid_order('pending', 'b8400000-0000-4000-8000-000000000004', repeat('4',64));
select pg_temp.create_paid_order('failed', 'b8400000-0000-4000-8000-000000000005', repeat('5',64));
select pg_temp.create_paid_order('requiresaction', 'b8400000-0000-4000-8000-000000000007', repeat('7',64));
select pg_temp.create_paid_order('race', 'b8400000-0000-4000-8000-000000000008', repeat('8',64));

create temporary table cancel_order (id uuid primary key) on commit drop;
grant all on cancel_order to service_role;
insert into cancel_order
select reservation.order_id
from public.server_reserve_checkout(
  'b8200000-0000-4000-8000-000000000001',
  '[{"tier_id":"b8300000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"b8300000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
  'Synthetic Buyer', 'task8-buyer@example.invalid',
  'b8400000-0000-4000-8000-000000000006', repeat('6',64)
) as reservation;
select public.server_attach_checkout_session(
  (select id from cancel_order), 'cs_test_task8cancel',
  (select checkout_expires_at from orders where id = (select id from cancel_order))
);

select results_eq(
  $$
    select order_id, payment_intent_id, charge_id, transfer_id,
      application_fee_id, currency, total_minor,
      application_fee_amount_minor, reason
    from public.server_prepare_whole_order_refund(
      (select id from refund_orders where kind = 'exact'),
      'requested_by_customer'
    )
  $$,
  $$
    select id, payment_intent_id, charge_id,
      'tr_task8exact'::text, 'fee_task8exact'::text,
      'usd'::text, 3001::bigint, 300::bigint,
      'requested_by_customer'::text
    from refund_orders where kind = 'exact'
  $$,
  'refund preparation returns only the persisted whole-order financial snapshot'
);

select * from public.server_record_webhook_receipt(
  'evt_task8partial', 'refund.updated', false, 're_task8partial',
  '2026-07-29.dahlia', '2026-09-02 01:01:00+00', repeat('a',64)
);
select * from public.server_apply_verified_refund(
  'evt_task8partial', (select id from refund_orders where kind = 'partial'),
  're_task8partial', 'pi_task8partial', 'ch_task8partial',
  'trr_task8partial', 'fr_task8partial', 1000, 'usd', 'succeeded',
  'requested_by_customer', true, true,
  1000, 100, true, null
);

reset role;
select results_eq(
  $$
    select orders.status, orders.reconciliation_status, orders.failure_code,
      count(*) filter (where tickets.status = 'cancelled')::bigint,
      count(*) filter (where tickets.status = 'refunded')::bigint
    from orders join tickets on tickets.order_id = orders.id
    where orders.id = (select id from refund_orders where kind = 'partial')
    group by orders.id
  $$,
  $$ values ('requires_review'::text, 'requires_review'::text,
    'PARTIAL_REFUND_REQUIRES_REVIEW'::text, 3::bigint, 0::bigint) $$,
  'a successful partial refund review-holds the order and invalidates every ticket without allocation'
);
select results_eq(
  $$
    select tiers.id, coalesce(sum(items.quantity), 0)::bigint
    from ticket_tiers tiers
    join order_items items on items.ticket_tier_id = tiers.id
    join orders on orders.id = items.order_id
    where orders.id = (select id from refund_orders where kind = 'partial')
      and orders.status in ('paid','payment_processing','requires_review','partially_refunded')
    group by tiers.id order by tiers.id
  $$,
  $$ values
    ('b8300000-0000-4000-8000-000000000001'::uuid, 2::bigint),
    ('b8300000-0000-4000-8000-000000000002'::uuid, 1::bigint) $$,
  'partial refund review holds every tier quantity committed'
);
select throws_ok(
  $$ select * from public.server_prepare_whole_order_refund(
    (select id from refund_orders where kind = 'partial'),
    'requested_by_customer'
  ) $$,
  'P0001', 'REFUND_NOT_AVAILABLE',
  'partial refund review cannot prepare another automatic whole-order refund'
);

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_task8incomplete', 'refund.updated', false, 're_task8incomplete',
  '2026-07-29.dahlia', '2026-09-02 01:02:00+00', repeat('b',64)
);
select * from public.server_apply_verified_refund(
  'evt_task8incomplete', (select id from refund_orders where kind = 'incomplete'),
  're_task8incomplete', 'pi_task8incomplete', 'ch_task8incomplete',
  'trr_task8incomplete', 'fr_task8incomplete', 3001, 'usd', 'succeeded',
  'requested_by_customer', true, true,
  2701, 299, false, 'REFUND_POLICY_MISMATCH'
);
reset role;
select results_eq(
  $$ select status, reconciliation_status, failure_code
     from orders where id = (select id from refund_orders where kind = 'incomplete') $$,
  $$ values ('requires_review'::text, 'requires_review'::text,
    'REFUND_POLICY_MISMATCH'::text) $$,
  'an exact customer refund with incomplete economic unwind fails closed to review'
);

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_task8exactone', 'refund.updated', false, 're_task8exactone',
  '2026-07-29.dahlia', '2026-09-02 01:03:00+00', repeat('c',64)
);
select * from public.server_apply_verified_refund(
  'evt_task8exactone', (select id from refund_orders where kind = 'exact'),
  're_task8exactone', 'pi_task8exact', 'ch_task8exact',
  'trr_task8exactone', 'fr_task8exactone', 1000, 'usd', 'succeeded',
  'requested_by_customer', true, true,
  1000, 100, true, null
);
select * from public.server_record_webhook_receipt(
  'evt_task8exacttwo', 'refund.updated', false, 're_task8exacttwo',
  '2026-07-29.dahlia', '2026-09-02 01:04:00+00', repeat('d',64)
);
select * from public.server_apply_verified_refund(
  'evt_task8exacttwo', (select id from refund_orders where kind = 'exact'),
  're_task8exacttwo', 'pi_task8exact', 'ch_task8exact',
  'trr_task8exacttwo', 'fr_task8exacttwo', 2001, 'usd', 'succeeded',
  null, true, true, 2001, 200, true, null
);
reset role;
select results_eq(
  $$
    select orders.status, orders.reconciliation_status, orders.failure_code,
      count(*) filter (where tickets.status = 'refunded')::bigint
    from orders join tickets on tickets.order_id = orders.id
    where orders.id = (select id from refund_orders where kind = 'exact')
    group by orders.id
  $$,
  $$ values ('refunded'::text, 'reconciled'::text, null::text, 3::bigint) $$,
  'cumulative exact customer, reversal, and application-fee economics refund the whole ticket set'
);

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_task8pending', 'refund.created', false, 're_task8pending',
  '2026-07-29.dahlia', '2026-09-02 01:05:00+00', repeat('e',64)
);
select * from public.server_apply_verified_refund(
  'evt_task8pending', (select id from refund_orders where kind = 'pending'),
  're_task8pending', 'pi_task8pending', 'ch_task8pending',
  'trr_task8pending', 'fr_task8pending', 3001, 'usd', 'pending', null,
  true, true, 100, 10, false, 'REFUND_POLICY_MISMATCH'
);
reset role;
select results_eq(
  $$
    select orders.status, tickets.status, refunds.processed_at
    from orders join tickets on tickets.order_id = orders.id
    join refunds on refunds.order_id = orders.id
    where orders.id = (select id from refund_orders where kind = 'pending')
    order by tickets.unit_sequence limit 1
  $$,
  $$ values ('paid'::text, 'valid'::text, null::timestamptz) $$,
  'pending refund evidence holds without claiming success or invalidating paid admission'
);
select throws_ok(
  $$ select * from public.server_prepare_whole_order_refund(
    (select id from refund_orders where kind = 'pending'),
    'requested_by_customer'
  ) $$,
  'P0001', 'REFUND_NOT_AVAILABLE',
  'an unresolved pending refund blocks another automatic whole-order refund'
);

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_task8requiresaction', 'refund.updated', false,
  're_task8requiresaction', '2026-07-29.dahlia',
  '2026-09-02 01:05:15+00', repeat('7',64)
);
select * from public.server_apply_verified_refund(
  'evt_task8requiresaction',
  (select id from refund_orders where kind = 'requiresaction'),
  're_task8requiresaction', 'pi_task8requiresaction',
  'ch_task8requiresaction', null, null, 3001, 'usd', 'requires_action',
  null, true, true, 0, 0, false, 'REFUND_PENDING'
);
select throws_ok(
  $$ select * from public.server_prepare_whole_order_refund(
    (select id from refund_orders where kind = 'requiresaction'),
    'requested_by_customer'
  ) $$,
  'P0001', 'REFUND_NOT_AVAILABLE',
  'an unresolved requires-action refund blocks another automatic whole-order refund'
);

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_task8pendingsucceeded', 'refund.updated', false, 're_task8pending',
  '2026-07-29.dahlia', '2026-09-02 01:05:30+00', repeat('9',64)
);
select throws_ok(
  $$ select * from public.server_apply_verified_refund(
    'evt_task8pendingsucceeded',
    (select id from refund_orders where kind = 'pending'),
    're_task8pending', 'pi_task8pending', 'ch_task8pending',
    'trr_task8replacement', 'fr_task8replacement', 3001, 'usd',
    'succeeded', null, true, true, 3001, 300, true, null
  ) $$,
  'P0001', 'REFUND_SNAPSHOT_MISMATCH',
  'pending refund evidence cannot replace provider evidence IDs'
);
select throws_ok(
  $$ select * from public.server_apply_verified_refund(
    'evt_task8pendingsucceeded',
    (select id from refund_orders where kind = 'pending'),
    're_task8pending', 'pi_task8pending', 'ch_task8pending',
    'trr_task8pending', 'fr_task8pending', 3001, 'usd', 'succeeded', null,
    true, true, 50, 5, false, 'REFUND_POLICY_MISMATCH'
  ) $$,
  'P0001', 'REFUND_SNAPSHOT_MISMATCH',
  'pending refund evidence cannot decrease'
);
select throws_ok(
  $$ select * from public.server_apply_verified_refund(
    'evt_task8pendingsucceeded',
    (select id from refund_orders where kind = 'pending'),
    're_task8pending', 'pi_task8pending', 'ch_task8pending',
    'trr_task8pending', 'fr_task8pending', 3001, 'usd', 'succeeded', null,
    true, true, 3001, 300, false, 'REFUND_POLICY_MISMATCH'
  ) $$,
  'P0001', 'REFUND_SNAPSHOT_MISMATCH',
  'pending refund cannot regress policy while claiming success'
);
select lives_ok(
  $$ select * from public.server_apply_verified_refund(
    'evt_task8pendingsucceeded',
    (select id from refund_orders where kind = 'pending'),
    're_task8pending', 'pi_task8pending', 'ch_task8pending',
    'trr_task8pending', 'fr_task8pending', 3001, 'usd', 'succeeded', null,
    true, true, 3001, 300, true, null
  ) $$,
  'pending refund accepts monotonic exact provider evidence'
);
reset role;
select results_eq(
  $$
    select orders.status, orders.reconciliation_status,
      refunds.status, refunds.transfer_reversal_amount_minor,
      refunds.application_fee_refund_amount_minor, refunds.policy_verified,
      count(*) filter (where tickets.status = 'refunded')::bigint
    from orders
    join refunds on refunds.order_id = orders.id
    join tickets on tickets.order_id = orders.id
    where orders.id = (select id from refund_orders where kind = 'pending')
    group by orders.id, refunds.id
  $$,
  $$ values (
    'refunded'::text, 'reconciled'::text, 'succeeded'::text,
    3001::bigint, 300::bigint, true, 3::bigint
  ) $$,
  'pending refund advances only after exact whole-order economics are verified'
);

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_task8racemismatch', 'refund.updated', false, 're_task8race',
  '2026-07-29.dahlia', '2026-09-02 01:05:40+00', repeat('1',64)
);
select * from public.server_apply_verified_refund(
  'evt_task8racemismatch', (select id from refund_orders where kind = 'race'),
  're_task8race', 'pi_task8race', 'ch_task8race',
  'trr_task8race', null, 3001, 'usd', 'succeeded', null,
  true, true, 3001, 0, false, 'REFUND_POLICY_MISMATCH'
);
select results_eq(
  $$ select status, reconciliation_status, failure_code
     from orders where id = (select id from refund_orders where kind = 'race') $$,
  $$ values ('requires_review'::text, 'requires_review'::text,
    'REFUND_POLICY_MISMATCH'::text) $$,
  'succeeded money with incomplete metadata immediately invalidates admission for review'
);

select * from public.server_record_webhook_receipt(
  'evt_task8racerecovered', 'refund.updated', false, 're_task8race',
  '2026-07-29.dahlia', '2026-09-02 01:05:50+00', repeat('2',64)
);
select throws_ok(
  $$ select * from public.server_apply_verified_refund(
    'evt_task8racerecovered', (select id from refund_orders where kind = 'race'),
    're_task8race', 'pi_task8race', 'ch_task8race',
    'trr_task8racereplacement', 'fr_task8race', 3001, 'usd', 'succeeded',
    null, true, true, 3001, 300, true, null
  ) $$,
  'P0001', 'REFUND_SNAPSHOT_MISMATCH',
  'succeeded mismatch recovery cannot replace a known provider evidence ID'
);
select lives_ok(
  $$ select * from public.server_apply_verified_refund(
    'evt_task8racerecovered', (select id from refund_orders where kind = 'race'),
    're_task8race', 'pi_task8race', 'ch_task8race',
    'trr_task8race', 'fr_task8race', 3001, 'usd', 'succeeded', null,
    true, true, 3001, 300, true, null
  ) $$,
  'succeeded mismatch accepts only monotonic exact evidence recovery'
);
reset role;
select results_eq(
  $$
    select orders.status, orders.reconciliation_status,
      refunds.policy_verified,
      refunds.application_fee_refund_amount_minor,
      count(*) filter (where tickets.status = 'refunded')::bigint
    from orders
    join refunds on refunds.order_id = orders.id
    join tickets on tickets.order_id = orders.id
    where orders.id = (select id from refund_orders where kind = 'race')
    group by orders.id, refunds.id
  $$,
  $$ values ('refunded'::text, 'reconciled'::text, true, 300::bigint, 3::bigint) $$,
  'recovered exact succeeded evidence reconciles the whole order and ticket set'
);

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_task8failed', 'refund.failed', false, 're_task8failed',
  '2026-07-29.dahlia', '2026-09-02 01:06:00+00', repeat('f',64)
);
select * from public.server_apply_verified_refund(
  'evt_task8failed', (select id from refund_orders where kind = 'failed'),
  're_task8failed', 'pi_task8failed', 'ch_task8failed',
  null, null, 3001, 'usd', 'failed', null, true, true,
  0, 0, false, 'REFUND_FAILED'
);
reset role;
select results_eq(
  $$
    select orders.status, count(*) filter (where tickets.status = 'valid')::bigint
    from orders join tickets on tickets.order_id = orders.id
    where orders.id = (select id from refund_orders where kind = 'failed')
    group by orders.id
  $$,
  $$ values ('paid'::text, 3::bigint) $$,
  'failed refund evidence preserves the paid order and every valid ticket'
);

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_task8overflow', 'refund.updated', false, 're_task8overflow',
  '2026-07-29.dahlia', '2026-09-02 01:07:00+00', repeat('0',64)
);
select throws_ok(
  $$ select * from public.server_apply_verified_refund(
    'evt_task8overflow', (select id from refund_orders where kind = 'exact'),
    're_task8overflow', 'pi_task8exact', 'ch_task8exact',
    'trr_task8overflow', 'fr_task8overflow', 1, 'usd', 'succeeded', null, true, true,
    1, 0, true, null
  ) $$,
  'P0001', 'REFUND_TOTAL_INVALID',
  'cumulative successful customer refunds cannot exceed the order total'
);

select results_eq(
  $$
    select amount_minor, transfer_reversal_amount_minor,
      application_fee_refund_amount_minor, policy_verified, policy_failure_code
    from refunds where stripe_refund_id = 're_task8incomplete'
  $$,
  $$ values (3001::bigint, 2701::bigint, 299::bigint, false,
    'REFUND_POLICY_MISMATCH'::text) $$,
  'refund rows retain exact authoritative economics and the safe policy verdict'
);

-- Lifecycle work remains available while only new creation is disabled.
reset role;
update private.checkout_runtime_control set checkout_creation_enabled = false where singleton;
set local role service_role;
select lives_ok(
  $$ select public.server_cancel_checkout_reservation(
    (select id from cancel_order), 'CHECKOUT_CANCELLED'
  ) $$,
  'the creation kill switch does not disable cancellation lifecycle APIs'
);
select results_eq(
  $$
    select orders.status, count(distinct items.ticket_tier_id)::bigint,
      count(*) filter (where orders.status in (
        'paid','payment_processing','requires_review','partially_refunded'
      ))::bigint
    from orders join order_items items on items.order_id = orders.id
    where orders.id = (select id from cancel_order)
    group by orders.id
  $$,
  $$ values ('cancelled'::text, 2::bigint, 0::bigint) $$,
  'whole-order cancellation releases every tier while preserving the item ledger'
);
select lives_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_task8paidfailed', (select id from refund_orders where kind = 'failed'),
      'cs_test_task8failed', 'pi_task8failed', 'ch_task8failed',
      'tr_task8failed', 'fee_task8failed', 'txn_task8failed',
      'cus_task8failed', 'payment', 'paid', 'usd',
      3001, 3001, 300, 'acct_task8refund'
    )
  $$,
  'the creation kill switch does not disable payment fulfillment lifecycle APIs'
);

reset role;
select * from finish(true);
rollback;
