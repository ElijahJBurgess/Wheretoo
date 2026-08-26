begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

select results_eq(
  $$
    select (array_agg(pg_catalog.to_regprocedure(signature)::text order by signature)::text[])
      collate "C"
    from unnest(array[
      'private.apply_dispute(text,uuid,text,text,text,bigint,text,text)',
      'private.apply_refund(text,uuid,text,bigint,text,text,text,boolean,boolean)'
    ]) as signatures(signature)
  $$,
  $$
    values ((array[
      'private.apply_dispute(text,uuid,text,text,text,bigint,text,text)',
      'private.apply_refund(text,uuid,text,bigint,text,text,text,boolean,boolean)'
    ]::text[]) collate "C")
  $$,
  'the private refund and dispute functions have exact signatures'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege('anon', function_name, 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', function_name, 'EXECUTE'),
      pg_catalog.has_function_privilege('service_role', function_name, 'EXECUTE')
    ]
    from unnest(array[
      'public.server_apply_dispute(text,uuid,text,text,text,bigint,text,text)',
      'public.server_apply_refund(text,uuid,text,bigint,text,text,text,boolean,boolean)'
    ]) as functions(function_name)
    order by function_name
  $$,
  $$ values
    (array[false, false, true]),
    (array[false, false, true])
  $$,
  'only service_role can execute refund and dispute wrappers'
);

insert into auth.users (id, email)
values ('17000000-0000-4000-8000-000000000001', 'refund-owner@example.invalid');

insert into public.organizers (id, display_name)
values ('17000000-0000-4000-8000-000000000001', 'Refund Owner');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
)
values (
  '27000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001',
  'published', 'clear', 'Refund Event',
  'A paid event used to verify refund and dispute reconciliation.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'Refund Venue', '2 Mission Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.refund-event', 37.7936, -122.3958, 'paid', now()
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order, version
)
values (
  '37000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  'General Admission', 2000, 'usd', 20, 'active', 1, 1
);

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
)
values (
  '17000000-0000-4000-8000-000000000001', 'acct_refundowner',
  'active', 'active', 'clear', 0, 0, now()
);

create or replace function pg_temp.create_paid_order(
  p_request_id uuid,
  p_hash text,
  p_session_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_event_id text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  select reservation.order_id into v_order_id
  from public.server_reserve_checkout(
    '27000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000001',
    'Refund Buyer', 'refund-buyer@example.invalid', p_request_id, p_hash
  ) as reservation;
  perform public.server_attach_checkout_session(
    v_order_id, p_session_id, statement_timestamp() + interval '30 minutes'
  );
  perform * from public.server_record_webhook_receipt(
    p_event_id, 'checkout.session.completed', false, p_session_id,
    '2025-08-27.basil', '2026-08-25 13:00:00+00', repeat('9', 64)
  );
  perform * from public.server_fulfill_paid_order(
    p_event_id, v_order_id, p_session_id, p_payment_intent_id, p_charge_id,
    'tr_' || right(p_charge_id, -3), 'fee_' || right(p_charge_id, -3),
    'txn_' || right(p_charge_id, -3), 'cus_' || right(p_charge_id, -3),
    'payment', 'paid', 'usd', 2000, 2000, 150, 'acct_refundowner'
  );
  return v_order_id;
end;
$$;

set local role service_role;

create temporary table refunded_order (id uuid primary key) on commit drop;
insert into refunded_order
values (pg_temp.create_paid_order(
  '47000000-0000-4000-8000-000000000001', repeat('a', 64),
  'cs_test_refundedorder', 'pi_refundedorder', 'ch_refundedorder',
  'evt_refundedorderpaid'
));

select * from public.server_record_webhook_receipt(
  'evt_partialrefund', 'refund.updated', false, 're_partialrefund',
  '2025-08-27.basil', '2026-08-25 13:01:00+00', repeat('b', 64)
);

select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_refund(
      'evt_partialrefund', (select id from refunded_order),
      're_partialrefund', 500, 'usd', 'succeeded', 'requested_by_customer',
      true, false
    )
  $$,
  $$ values ('partially_refunded'::text, 'refunded'::text) $$,
  'a successful partial refund invalidates the single-admission ticket conservatively'
);

select results_eq(
  $$
    select amount_minor, currency, status, reason, reverse_transfer,
      refund_application_fee, stripe_event_id, processed_at is not null
    from public.refunds where stripe_refund_id = 're_partialrefund'
  $$,
  $$ values (
    500::bigint, 'usd'::text, 'succeeded'::text,
    'requested_by_customer'::text, true, false,
    'evt_partialrefund'::text, true
  ) $$,
  'partial refund stores exact Stripe truth and explicit recovery policy'
);

select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_refund(
      'evt_partialrefund', (select id from refunded_order),
      're_partialrefund', 500, 'usd', 'succeeded', 'requested_by_customer',
      true, false
    )
  $$,
  $$ values ('partially_refunded'::text, 'refunded'::text) $$,
  'duplicate delivery of the same refund event is idempotent'
);

select is(
  (select count(*) from public.refunds where stripe_refund_id = 're_partialrefund'),
  1::bigint,
  'duplicate refund delivery persists one refund row'
);

select throws_ok(
  $$
    select * from public.server_apply_refund(
      'evt_partialrefund', (select id from refunded_order),
      're_partialrefund', 501, 'usd', 'succeeded', 'requested_by_customer',
      true, false
    )
  $$,
  'P0001', 'REFUND_SNAPSHOT_MISMATCH',
  'a duplicate refund ID cannot rewrite its amount'
);

select * from public.server_record_webhook_receipt(
  'evt_finalrefund', 'refund.updated', false, 're_finalrefund',
  '2025-08-27.basil', '2026-08-25 13:02:00+00', repeat('c', 64)
);

select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_refund(
      'evt_finalrefund', (select id from refunded_order),
      're_finalrefund', 1500, 'usd', 'succeeded', null,
      true, true
    )
  $$,
  $$ values ('refunded'::text, 'refunded'::text) $$,
  'cumulative successful refunds reaching the order total invalidate the ticket'
);

select results_eq(
  $$
    select status, refunded_at is not null, reconciliation_status, last_stripe_event_id
    from public.orders where id = (select id from refunded_order)
  $$,
  $$ values (
    'refunded'::text, true, 'reconciled'::text, 'evt_finalrefund'::text
  ) $$,
  'a fully refunded order stores terminal webhook-derived truth'
);

select results_eq(
  $$
    select status, refunded_at is not null, cancelled_at
    from public.tickets where order_id = (select id from refunded_order)
  $$,
  $$ values ('refunded'::text, true, null::timestamptz) $$,
  'full refund makes the ticket non-valid without deleting admission history'
);

select * from public.server_record_webhook_receipt(
  'evt_refundoverflow', 'refund.updated', false, 're_refundoverflow',
  '2025-08-27.basil', '2026-08-25 13:03:00+00', repeat('d', 64)
);

select throws_ok(
  $$
    select * from public.server_apply_refund(
      'evt_refundoverflow', (select id from refunded_order),
      're_refundoverflow', 1, 'usd', 'succeeded', null, true, false
    )
  $$,
  'P0001', 'REFUND_TOTAL_INVALID',
  'successful refund totals cannot exceed the paid order total'
);

select is(
  (select count(*) from public.refunds where stripe_refund_id = 're_refundoverflow'),
  0::bigint,
  'an invalid overflow refund is rolled back completely'
);

select * from public.server_record_webhook_receipt(
  'evt_failedrefund', 'refund.updated', false, 're_failedrefund',
  '2025-08-27.basil', '2026-08-25 13:04:00+00', repeat('e', 64)
);

select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_refund(
      'evt_failedrefund', (select id from refunded_order),
      're_failedrefund', 100, 'usd', 'failed', 'expired_or_canceled_card',
      true, false
    )
  $$,
  $$ values ('refunded'::text, 'refunded'::text) $$,
  'a failed refund attempt cannot move a fully refunded order backward'
);

create temporary table pending_refund_order (id uuid primary key) on commit drop;
insert into pending_refund_order
values (pg_temp.create_paid_order(
  '47000000-0000-4000-8000-000000000003', repeat('4', 64),
  'cs_test_pendingrefundorder', 'pi_pendingrefundorder', 'ch_pendingrefundorder',
  'evt_pendingrefundorderpaid'
));

select * from public.server_record_webhook_receipt(
  'evt_pendingrefund', 'refund.created', false, 're_pendingrefund',
  '2025-08-27.basil', '2026-08-25 13:04:30+00', repeat('5', 64)
);

select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_refund(
      'evt_pendingrefund', (select id from pending_refund_order),
      're_pendingrefund', 500, 'usd', 'pending', null, true, false
    )
  $$,
  $$ values ('paid'::text, 'valid'::text) $$,
  'a pending refund records Stripe truth without changing paid admission state'
);

select results_eq(
  $$
    select status, processed_at
    from public.refunds where stripe_refund_id = 're_pendingrefund'
  $$,
  $$ values ('pending'::text, null::timestamptz) $$,
  'a pending refund remains explicitly incomplete'
);

select * from public.server_record_webhook_receipt(
  'evt_pendingrefundsucceeded', 'refund.updated', false, 're_pendingrefund',
  '2025-08-27.basil', '2026-08-25 13:04:31+00', repeat('6', 64)
);

select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_refund(
      'evt_pendingrefundsucceeded', (select id from pending_refund_order),
      're_pendingrefund', 500, 'usd', 'succeeded', null, true, false
    )
  $$,
  $$ values ('partially_refunded'::text, 'refunded'::text) $$,
  'a later authoritative event advances a pending refund to succeeded once'
);

select results_eq(
  $$
    select status, stripe_event_id, processed_at is not null
    from public.refunds where stripe_refund_id = 're_pendingrefund'
  $$,
  $$ values (
    'succeeded'::text, 'evt_pendingrefundsucceeded'::text, true
  ) $$,
  'pending-to-succeeded refund transition stores the terminal event and completion time'
);

select is(
  (select count(*) from public.refunds where stripe_refund_id = 're_pendingrefund'),
  1::bigint,
  'refund status progression preserves one domain row'
);

select * from public.server_record_webhook_receipt(
  'evt_stalependingrefund', 'refund.updated', false, 're_pendingrefund',
  '2025-08-27.basil', '2026-08-25 13:04:29+00', repeat('7', 64)
);

select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_refund(
      'evt_stalependingrefund', (select id from pending_refund_order),
      're_pendingrefund', 500, 'usd', 'pending', null, true, false
    )
  $$,
  $$ values ('partially_refunded'::text, 'refunded'::text) $$,
  'an out-of-order pending event cannot move a succeeded refund backward'
);

select results_eq(
  $$
    select refunds.status, refunds.stripe_event_id, refunds.processed_at is not null,
      orders.last_stripe_event_id
    from public.refunds as refunds
    join public.orders as orders on orders.id = refunds.order_id
    where refunds.stripe_refund_id = 're_pendingrefund'
  $$,
  $$ values (
    'succeeded'::text, 'evt_pendingrefundsucceeded'::text, true,
    'evt_pendingrefundsucceeded'::text
  ) $$,
  'stale refund delivery preserves the accepted terminal event and order reconciliation truth'
);

create temporary table disputed_order (id uuid primary key) on commit drop;
insert into disputed_order
values (pg_temp.create_paid_order(
  '47000000-0000-4000-8000-000000000002', repeat('f', 64),
  'cs_test_disputedorder', 'pi_disputedorder', 'ch_disputedorder',
  'evt_disputedorderpaid'
));

select * from public.server_record_webhook_receipt(
  'evt_disputeopened', 'charge.dispute.created', false, 'dp_disputeopened',
  '2025-08-27.basil', '2026-08-25 13:05:00+00', repeat('1', 64)
);

select is(
  public.server_apply_dispute(
    'evt_disputeopened', (select id from disputed_order),
    'dp_disputeopened', 'ch_disputedorder', 'needs_response',
    2000, 'usd', 'succeeded'
  ),
  (select id from disputed_order),
  'a verified dispute applies one recovery state to its paid order'
);

select results_eq(
  $$
    select status, reconciliation_status, failure_code, last_stripe_event_id
    from public.orders where id = (select id from disputed_order)
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'DISPUTE_NEEDS_RESPONSE_RECOVERY_SUCCEEDED'::text,
    'evt_disputeopened'::text
  ) $$,
  'dispute truth and destination-transfer recovery result are auditable on the order'
);

select results_eq(
  $$
    select status, cancelled_at is not null, refunded_at
    from public.tickets where order_id = (select id from disputed_order)
  $$,
  $$ values ('cancelled'::text, true, null::timestamptz) $$,
  'a disputed admission becomes non-valid without deleting ticket history'
);

select is(
  public.server_apply_dispute(
    'evt_disputeopened', (select id from disputed_order),
    'dp_disputeopened', 'ch_disputedorder', 'needs_response',
    2000, 'usd', 'succeeded'
  ),
  (select id from disputed_order),
  'duplicate dispute delivery is idempotent'
);

select is(
  (select delivery_attempt_count from public.stripe_webhook_events where stripe_event_id = 'evt_disputeopened'),
  1,
  'domain retry does not fabricate a second webhook delivery attempt'
);

select * from public.server_record_webhook_receipt(
  'evt_disputewon', 'charge.dispute.closed', false, 'dp_disputeopened',
  '2025-08-27.basil', '2026-08-25 13:06:00+00', repeat('2', 64)
);

select is(
  public.server_apply_dispute(
    'evt_disputewon', (select id from disputed_order),
    'dp_disputeopened', 'ch_disputedorder', 'won',
    2000, 'usd', 'succeeded'
  ),
  (select id from disputed_order),
  'a later recovered dispute event is recorded once'
);

select results_eq(
  $$
    select status, reconciliation_status, failure_code, last_stripe_event_id
    from public.orders where id = (select id from disputed_order)
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'DISPUTE_WON_RECOVERY_SUCCEEDED'::text,
    'evt_disputewon'::text
  ) $$,
  'dispute recovery updates audit truth without silently restoring admission'
);

select is(
  (select status from public.tickets where order_id = (select id from disputed_order)),
  'cancelled'::text,
  'out-of-order dispute recovery cannot make a cancelled ticket valid again'
);

select * from public.server_record_webhook_receipt(
  'evt_wrongdispute', 'charge.dispute.created', false, 'dp_wrongdispute',
  '2025-08-27.basil', '2026-08-25 13:07:00+00', repeat('3', 64)
);

select throws_ok(
  $$
    select public.server_apply_dispute(
      'evt_wrongdispute', (select id from disputed_order),
      'dp_wrongdispute', 'ch_wrongcharge', 'needs_response',
      2000, 'usd', 'failed'
    )
  $$,
  'P0001', 'DISPUTE_SNAPSHOT_MISMATCH',
  'a dispute cannot attach to a different Stripe Charge'
);

select throws_ok(
  $$
    select public.server_apply_dispute(
      'evt_wrongdispute', (select id from disputed_order),
      'dp_wrongdispute', 'ch_disputedorder', 'needs_response',
      1999, 'eur', 'failed'
    )
  $$,
  'P0001', 'DISPUTE_SNAPSHOT_MISMATCH',
  'a dispute must match the paid currency and remain within the charge total'
);

select results_eq(
  $$
    select processing_status, processed_at is not null
    from public.stripe_webhook_events
    where stripe_event_id in (
      'evt_partialrefund', 'evt_finalrefund', 'evt_failedrefund',
      'evt_disputeopened', 'evt_disputewon'
    )
    order by stripe_event_id
  $$,
  $$ values
    ('processed'::text, true),
    ('processed'::text, true),
    ('processed'::text, true),
    ('processed'::text, true),
    ('processed'::text, true)
  $$,
  'all accepted refund and dispute transitions complete their receipts'
);

select is(
  (select count(*) from public.tickets where order_id in (
    (select id from refunded_order), (select id from disputed_order)
  )),
  2::bigint,
  'refund and dispute transitions preserve exactly-once ticket issuance history'
);

reset role;
select * from finish();
rollback;
