begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(51);

select has_table('public', 'disputes', 'durable Stripe dispute state table exists');
select col_is_unique(
  'public', 'disputes', 'stripe_dispute_id',
  'Stripe dispute ID is a durable uniqueness boundary'
);
select has_index('public', 'disputes', 'disputes_order_id_idx', 'order dispute index exists');

select results_eq(
  $$
    select relations.relrowsecurity, relations.relforcerowsecurity
    from pg_catalog.pg_class as relations
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public' and relations.relname = 'disputes'
  $$,
  $$ values (true, true) $$,
  'durable dispute state enforces row-level security'
);

select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'disputes'
      and grantee in ('anon', 'authenticated', 'service_role')
  ),
  0::bigint,
  'browser and service roles have no direct durable dispute table privileges'
);

select results_eq(
  $$
    select (array_agg(pg_catalog.to_regprocedure(signature)::text order by signature)::text[])
      collate "C"
    from unnest(array[
      'private.apply_dispute(text,uuid,text,text,text,bigint,text,text)',
      'private.apply_refund(text,uuid,text,text,text,bigint,text,text,text,boolean,boolean)'
    ]) as signatures(signature)
  $$,
  $$
    values ((array[
      'private.apply_dispute(text,uuid,text,text,text,bigint,text,text)',
      'private.apply_refund(text,uuid,text,text,text,bigint,text,text,text,boolean,boolean)'
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
      'public.server_apply_refund(text,uuid,text,text,text,bigint,text,text,text,boolean,boolean)'
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

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present,
  high_risk_activity
) values (
  '27000000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);
select set_config(
  'request.jwt.claim.sub',
  '17000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies(
  '27000000-0000-4000-8000-000000000001'
);
select public.publish_event('27000000-0000-4000-8000-000000000001');
reset role;
update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;

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
    jsonb_build_array(jsonb_build_object('tier_id', '37000000-0000-4000-8000-000000000001'::uuid, 'quantity', 1)),
    'Refund Buyer', 'refund-buyer@example.invalid', p_request_id, p_hash
  ) as reservation;
  perform public.server_attach_checkout_session(
    v_order_id, p_session_id,
    (select orders.checkout_expires_at from public.orders as orders where orders.id = v_order_id)
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
      're_partialrefund', 'pi_refundedorder', 'ch_refundedorder',
      500, 'usd', 'succeeded', 'requested_by_customer',
      true, false
    )
  $$,
  $$ values ('requires_review'::text, 'cancelled'::text) $$,
  'a legacy partial refund fails closed and invalidates the single-admission ticket conservatively'
);

select results_eq(
  $$
    select stripe_payment_intent_id, stripe_charge_id,
      amount_minor, currency, status, reason, reverse_transfer,
      refund_application_fee, stripe_event_id, processed_at is not null
    from public.refunds where stripe_refund_id = 're_partialrefund'
  $$,
  $$ values (
    'pi_refundedorder'::text, 'ch_refundedorder'::text,
    500::bigint, 'usd'::text, 'succeeded'::text,
    'requested_by_customer'::text, true, false,
    'evt_partialrefund'::text, true
  ) $$,
  'partial refund stores authoritative payment linkage and explicit recovery policy'
);

select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_refund(
      'evt_partialrefund', (select id from refunded_order),
      're_partialrefund', 'pi_refundedorder', 'ch_refundedorder',
      500, 'usd', 'succeeded', 'requested_by_customer',
      true, false
    )
  $$,
  $$ values ('requires_review'::text, 'cancelled'::text) $$,
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
      're_partialrefund', 'pi_refundedorder', 'ch_refundedorder',
      501, 'usd', 'succeeded', 'requested_by_customer',
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
      're_finalrefund', 'pi_refundedorder', 'ch_refundedorder',
      1500, 'usd', 'succeeded', null,
      true, true
    )
  $$,
  $$ values ('requires_review'::text, 'cancelled'::text) $$,
  'legacy cumulative refund amounts cannot claim complete economic reconciliation'
);

select results_eq(
  $$
    select status, refunded_at is not null, reconciliation_status, last_stripe_event_id
    from public.orders where id = (select id from refunded_order)
  $$,
  $$ values (
    'requires_review'::text, false, 'requires_review'::text, 'evt_finalrefund'::text
  ) $$,
  'a legacy full customer refund remains review-held without exact unwind evidence'
);

select results_eq(
  $$
    select status, refunded_at is not null, cancelled_at is not null
    from public.tickets where order_id = (select id from refunded_order)
  $$,
  $$ values ('cancelled'::text, false, true) $$,
  'unverified refund economics make the ticket non-valid without claiming refunded truth'
);

select * from public.server_record_webhook_receipt(
  'evt_refundoverflow', 'refund.updated', false, 're_refundoverflow',
  '2025-08-27.basil', '2026-08-25 13:03:00+00', repeat('d', 64)
);

select throws_ok(
  $$
    select * from public.server_apply_refund(
      'evt_refundoverflow', (select id from refunded_order),
      're_refundoverflow', 'pi_refundedorder', 'ch_refundedorder',
      1, 'usd', 'succeeded', null, true, false
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
      're_failedrefund', 'pi_refundedorder', 'ch_refundedorder',
      100, 'usd', 'failed', 'expired_or_canceled_card',
      true, false
    )
  $$,
  $$ values ('requires_review'::text, 'cancelled'::text) $$,
  'a failed refund attempt cannot move a review-held order backward'
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
      're_pendingrefund', 'pi_pendingrefundorder', 'ch_pendingrefundorder',
      500, 'usd', 'pending', null, true, false
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

select throws_ok(
  $$
    select * from public.server_apply_refund(
      'evt_pendingrefundsucceeded', (select id from pending_refund_order),
      're_pendingrefund', 'pi_pendingrefundorder', 'ch_pendingrefundorder',
      500, 'usd', 'succeeded', null, true, false
    )
  $$,
  'P0001', 'REFUND_SNAPSHOT_MISMATCH',
  'a legacy pending refund cannot claim success without exact unwind evidence'
);

select results_eq(
  $$
    select status, stripe_event_id, processed_at is not null
    from public.refunds where stripe_refund_id = 're_pendingrefund'
  $$,
  $$ values (
    'pending'::text, 'evt_pendingrefund'::text, false
  ) $$,
  'rejected legacy progression preserves the pending evidence'
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
      're_pendingrefund', 'pi_pendingrefundorder', 'ch_pendingrefundorder',
      500, 'usd', 'pending', null, true, false
    )
  $$,
  $$ values ('paid'::text, 'valid'::text) $$,
  'a duplicate pending legacy event preserves paid admission'
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
    'pending'::text, 'evt_pendingrefund'::text, false,
    'evt_pendingrefundorderpaid'::text
  ) $$,
  'duplicate pending delivery preserves the accepted evidence and order truth'
);

create temporary table disputed_order (id uuid primary key) on commit drop;
insert into disputed_order
values (pg_temp.create_paid_order(
  '47000000-0000-4000-8000-000000000002', repeat('f', 64),
  'cs_test_disputedorder', 'pi_disputedorder', 'ch_disputedorder',
  'evt_disputedorderpaid'
));

select * from public.server_record_webhook_receipt(
  'evt_crossorderrefund', 'refund.updated', false, 're_1Nispe2eZvKYlo2Cd31jOCgZ',
  '2025-08-27.basil', '2026-08-25 13:04:59+00', repeat('8', 64)
);

select throws_ok(
  $$
    select * from public.server_apply_refund(
      'evt_crossorderrefund', (select id from pending_refund_order),
      're_1Nispe2eZvKYlo2Cd31jOCgZ',
      'pi_disputedorder', 'ch_disputedorder',
      500, 'usd', 'succeeded', null, true, false
    )
  $$,
  'P0001', 'REFUND_SNAPSHOT_MISMATCH',
  'an equal-value refund cannot cross-apply using another order payment linkage'
);

select results_eq(
  $$
    select
      (select count(*) from public.refunds
        where stripe_refund_id = 're_1Nispe2eZvKYlo2Cd31jOCgZ'),
      (select status from public.orders where id = (select id from pending_refund_order))
  $$,
  $$ values (0::bigint, 'paid'::text) $$,
  'rejected cross-order refund leaves refund and accepted order truth unchanged'
);

select * from public.server_record_webhook_receipt(
  'evt_1DisputeOpenAbC', 'charge.dispute.created', false,
  'du_1MtJUT2eZvKYlo2CNaw2HvEv',
  '2025-08-27.basil', '2026-08-25 13:05:00+00', repeat('1', 64)
);

select is(
  public.server_apply_dispute(
    'evt_1DisputeOpenAbC', (select id from disputed_order),
    'du_1MtJUT2eZvKYlo2CNaw2HvEv', 'ch_disputedorder', 'needs_response',
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
    'evt_1DisputeOpenAbC'::text
  ) $$,
  'dispute truth and destination-transfer recovery result are auditable on the order'
);

reset role;

select results_eq(
  $$
    select stripe_dispute_id, order_id, stripe_charge_id, amount_minor, currency,
      status, recovery_status, first_stripe_event_id, last_stripe_event_id,
      first_stripe_event_created_at, last_stripe_event_created_at
    from public.disputes
    where stripe_dispute_id = 'du_1MtJUT2eZvKYlo2CNaw2HvEv'
  $$,
  $$
    values (
      'du_1MtJUT2eZvKYlo2CNaw2HvEv'::text,
      (select id from disputed_order),
      'ch_disputedorder'::text, 2000::bigint, 'usd'::text,
      'needs_response'::text, 'succeeded'::text,
      'evt_1DisputeOpenAbC'::text, 'evt_1DisputeOpenAbC'::text,
      '2026-08-25 13:05:00+00'::timestamptz,
      '2026-08-25 13:05:00+00'::timestamptz
    )
  $$,
  'the first dispute event persists authoritative object and event truth once'
);

select results_eq(
  $$
    select status, cancelled_at is not null, refunded_at
    from public.tickets where order_id = (select id from disputed_order)
  $$,
  $$ values ('cancelled'::text, true, null::timestamptz) $$,
  'a disputed admission becomes non-valid without deleting ticket history'
);

set local role service_role;

select is(
  public.server_apply_dispute(
    'evt_1DisputeOpenAbC', (select id from disputed_order),
    'du_1MtJUT2eZvKYlo2CNaw2HvEv', 'ch_disputedorder', 'needs_response',
    2000, 'usd', 'succeeded'
  ),
  (select id from disputed_order),
  'duplicate dispute delivery is idempotent'
);

select is(
  (select delivery_attempt_count from public.stripe_webhook_events where stripe_event_id = 'evt_1DisputeOpenAbC'),
  1,
  'domain retry does not fabricate a second webhook delivery attempt'
);

reset role;

select is(
  (select count(*) from public.disputes
    where stripe_dispute_id = 'du_1MtJUT2eZvKYlo2CNaw2HvEv'),
  1::bigint,
  'duplicate dispute delivery preserves one durable dispute row'
);

set local role service_role;

select * from public.server_record_webhook_receipt(
  'evt_disputeunderreview', 'charge.dispute.updated', false,
  'du_1MtJUT2eZvKYlo2CNaw2HvEv',
  '2025-08-27.basil', '2026-08-25 13:05:00+00', repeat('a', 64)
);

select lives_ok(
  $$
    select public.server_apply_dispute(
      'evt_disputeunderreview', (select id from disputed_order),
      'du_1MtJUT2eZvKYlo2CNaw2HvEv', 'ch_disputedorder', 'under_review',
      2000, 'usd', 'succeeded'
    )
  $$,
  'a distinct same-second event can advance dispute state monotonically'
);

reset role;

select results_eq(
  $$
    select disputes.status, disputes.last_stripe_event_id,
      disputes.last_stripe_event_created_at, orders.failure_code,
      orders.last_stripe_event_id
    from public.disputes as disputes
    join public.orders as orders on orders.id = disputes.order_id
    where disputes.stripe_dispute_id = 'du_1MtJUT2eZvKYlo2CNaw2HvEv'
  $$,
  $$ values (
    'under_review'::text, 'evt_disputeunderreview'::text,
    '2026-08-25 13:05:00+00'::timestamptz,
    'DISPUTE_UNDER_REVIEW_RECOVERY_SUCCEEDED'::text,
    'evt_disputeunderreview'::text
  ) $$,
  'same-second monotonic advancement persists deterministic dispute and order truth'
);

set local role service_role;

select * from public.server_record_webhook_receipt(
  'evt_disputewon', 'charge.dispute.closed', false,
  'du_1MtJUT2eZvKYlo2CNaw2HvEv',
  '2025-08-27.basil', '2026-08-25 13:06:00+00', repeat('2', 64)
);

select is(
  public.server_apply_dispute(
    'evt_disputewon', (select id from disputed_order),
    'du_1MtJUT2eZvKYlo2CNaw2HvEv', 'ch_disputedorder', 'won',
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

reset role;

select results_eq(
  $$
    select count(*)::bigint, min(status), min(last_stripe_event_id),
      min(last_stripe_event_created_at)
    from public.disputes
    where stripe_dispute_id = 'du_1MtJUT2eZvKYlo2CNaw2HvEv'
  $$,
  $$ values (
    1::bigint, 'won'::text, 'evt_disputewon'::text,
    '2026-08-25 13:06:00+00'::timestamptz
  ) $$,
  'a later dispute event advances one durable row using authoritative event time'
);

set local role service_role;

select is(
  (select status from public.tickets where order_id = (select id from disputed_order)),
  'cancelled'::text,
  'out-of-order dispute recovery cannot make a cancelled ticket valid again'
);

select * from public.server_record_webhook_receipt(
  'evt_staledispute', 'charge.dispute.updated', false,
  'du_1MtJUT2eZvKYlo2CNaw2HvEv',
  '2025-08-27.basil', '2026-08-25 13:05:30+00', repeat('0', 64)
);

select lives_ok(
  $$
    select public.server_apply_dispute(
      'evt_staledispute', (select id from disputed_order),
      'du_1MtJUT2eZvKYlo2CNaw2HvEv', 'ch_disputedorder', 'needs_response',
      2000, 'usd', 'failed'
    )
  $$,
  'an older dispute event is acknowledged as an idempotent no-op'
);

reset role;

select results_eq(
  $$
    select disputes.status, disputes.recovery_status, disputes.last_stripe_event_id,
      disputes.last_stripe_event_created_at, receipts.processing_status,
      receipts.processed_at is not null, receipts.error_code
    from public.disputes as disputes
    join public.stripe_webhook_events as receipts
      on receipts.stripe_event_id = 'evt_staledispute'
    where disputes.stripe_dispute_id = 'du_1MtJUT2eZvKYlo2CNaw2HvEv'
  $$,
  $$ values (
    'won'::text, 'succeeded'::text, 'evt_disputewon'::text,
    '2026-08-25 13:06:00+00'::timestamptz,
    'processed'::text, true, 'DISPUTE_STATE_IGNORED'::text
  ) $$,
  'ignored stale delivery preserves truth and reaches a terminal receipt state'
);

set local role service_role;

select * from public.server_record_webhook_receipt(
  'evt_regressivedispute', 'charge.dispute.updated', false,
  'du_1MtJUT2eZvKYlo2CNaw2HvEv',
  '2025-08-27.basil', '2026-08-25 13:06:30+00', repeat('b', 64)
);

select lives_ok(
  $$
    select public.server_apply_dispute(
      'evt_regressivedispute', (select id from disputed_order),
      'du_1MtJUT2eZvKYlo2CNaw2HvEv', 'ch_disputedorder', 'under_review',
      2000, 'usd', 'succeeded'
    )
  $$,
  'a newer but lower dispute state is acknowledged as an idempotent no-op'
);

reset role;

select results_eq(
  $$
    select disputes.status, disputes.last_stripe_event_id,
      orders.failure_code, orders.last_stripe_event_id,
      receipts.processing_status, receipts.processed_at is not null,
      receipts.error_code
    from public.disputes as disputes
    join public.orders as orders on orders.id = disputes.order_id
    join public.stripe_webhook_events as receipts
      on receipts.stripe_event_id = 'evt_regressivedispute'
    where disputes.stripe_dispute_id = 'du_1MtJUT2eZvKYlo2CNaw2HvEv'
  $$,
  $$ values (
    'won'::text, 'evt_disputewon'::text,
    'DISPUTE_WON_RECOVERY_SUCCEEDED'::text, 'evt_disputewon'::text,
    'processed'::text, true, 'DISPUTE_STATE_IGNORED'::text
  ) $$,
  'ignored lower state preserves dispute, order, ticket, and receipt truth'
);

set local role service_role;

create temporary table null_dispute_order (id uuid primary key) on commit drop;
insert into null_dispute_order
values (pg_temp.create_paid_order(
  '47000000-0000-4000-8000-000000000004', repeat('3', 64),
  'cs_test_nulldisputeorder', 'pi_nulldisputeorder', 'ch_nulldisputeorder',
  'evt_nulldisputeorderpaid'
));

select * from public.server_record_webhook_receipt(
  'evt_nulldisputestatus', 'charge.dispute.created', false,
  'du_1NullStatusAbCdEfGhIjKlMn',
  '2025-08-27.basil', '2026-08-25 13:08:00+00', repeat('4', 64)
);

select throws_ok(
  $$
    select public.server_apply_dispute(
      'evt_nulldisputestatus', (select id from null_dispute_order),
      'du_1NullStatusAbCdEfGhIjKlMn', 'ch_nulldisputeorder', null,
      2000, 'usd', 'not_attempted'
    )
  $$,
  'P0001', 'DISPUTE_SNAPSHOT_MISMATCH',
  'null dispute status is rejected before any admission mutation'
);

select * from public.server_record_webhook_receipt(
  'evt_nulldisputerecovery', 'charge.dispute.created', false,
  'du_1NullRecoveryAbCdEfGhIjKl',
  '2025-08-27.basil', '2026-08-25 13:08:01+00', repeat('5', 64)
);

select throws_ok(
  $$
    select public.server_apply_dispute(
      'evt_nulldisputerecovery', (select id from null_dispute_order),
      'du_1NullRecoveryAbCdEfGhIjKl', 'ch_nulldisputeorder', 'needs_response',
      2000, 'usd', null
    )
  $$,
  'P0001', 'DISPUTE_SNAPSHOT_MISMATCH',
  'null recovery status is rejected before any admission mutation'
);

reset role;

select results_eq(
  $$
    select orders.status, tickets.status,
      (select count(*) from public.disputes
        where order_id = (select id from null_dispute_order))
    from public.orders as orders
    join public.tickets as tickets on tickets.order_id = orders.id
    where orders.id = (select id from null_dispute_order)
  $$,
  $$ values ('paid'::text, 'valid'::text, 0::bigint) $$,
  'rejected null dispute inputs leave order, ticket, and dispute history untouched'
);

set local role service_role;

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
      'evt_1DisputeOpenAbC', 'evt_disputewon'
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
