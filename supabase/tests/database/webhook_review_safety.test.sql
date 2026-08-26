begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

select has_function(
  'public', 'server_apply_verified_refund',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'text',
    'text', 'text', 'boolean', 'boolean'],
  'verified refund reconciliation has a narrow service wrapper'
);
select has_function(
  'public', 'server_apply_verified_dispute',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'text', 'text'],
  'verified dispute reconciliation has a narrow service wrapper'
);
select has_function(
  'public', 'server_mark_payment_requires_review',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
    'text', 'text', 'text', 'bigint', 'bigint', 'bigint', 'text', 'text'],
  'late unsafe payment reconciliation has a narrow service wrapper'
);
select has_function(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'timestamptz', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'Connect webhook synchronization has a CAS service wrapper'
);

select function_privs_are(
  'public', 'server_mark_payment_requires_review',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
    'text', 'text', 'text', 'bigint', 'bigint', 'bigint', 'text', 'text'],
  'anon', array[]::text[],
  'anonymous callers cannot mutate payment review truth'
);
select function_privs_are(
  'public', 'server_mark_payment_requires_review',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
    'text', 'text', 'text', 'bigint', 'bigint', 'bigint', 'text', 'text'],
  'authenticated', array[]::text[],
  'authenticated callers cannot mutate payment review truth'
);
select function_privs_are(
  'public', 'server_mark_payment_requires_review',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
    'text', 'text', 'text', 'bigint', 'bigint', 'bigint', 'text', 'text'],
  'service_role', array['EXECUTE'],
  'service role can mark a verified payment for review'
);
select function_privs_are(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'timestamptz', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'authenticated', array[]::text[],
  'authenticated callers cannot race Connect truth'
);
select function_privs_are(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'timestamptz', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'anon', array[]::text[],
  'anonymous callers cannot race Connect truth'
);
select function_privs_are(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'timestamptz', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'service_role', array['EXECUTE'],
  'service role can persist current Connect truth'
);
select function_privs_are(
  'public', 'server_get_webhook_payment_order_snapshot', array['uuid'],
  'anon', array[]::text[],
  'anonymous callers cannot inspect payment snapshots'
);
select function_privs_are(
  'public', 'server_get_webhook_payment_order_snapshot', array['uuid'],
  'authenticated', array[]::text[],
  'authenticated callers cannot inspect payment snapshots'
);
select function_privs_are(
  'public', 'server_get_webhook_payment_order_snapshot', array['uuid'],
  'service_role', array['EXECUTE'],
  'service role can inspect the narrow payment snapshot'
);
select function_privs_are(
  'public', 'server_apply_verified_refund',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'text',
    'text', 'text', 'boolean', 'boolean'],
  'anon', array[]::text[],
  'anonymous callers cannot apply verified refunds'
);
select function_privs_are(
  'public', 'server_apply_verified_refund',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'text',
    'text', 'text', 'boolean', 'boolean'],
  'authenticated', array[]::text[],
  'authenticated callers cannot apply verified refunds'
);
select function_privs_are(
  'public', 'server_apply_verified_refund',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'text',
    'text', 'text', 'boolean', 'boolean'],
  'service_role', array['EXECUTE'],
  'service role can apply a verified refund'
);
select function_privs_are(
  'public', 'server_apply_verified_dispute',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'text', 'text'],
  'anon', array[]::text[],
  'anonymous callers cannot apply verified disputes'
);
select function_privs_are(
  'public', 'server_apply_verified_dispute',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'text', 'text'],
  'authenticated', array[]::text[],
  'authenticated callers cannot apply verified disputes'
);
select function_privs_are(
  'public', 'server_apply_verified_dispute',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'text', 'text'],
  'service_role', array['EXECUTE'],
  'service role can apply a verified dispute'
);

insert into auth.users (id, email)
values ('19000000-0000-4000-8000-000000000001', 'webhook-review@example.invalid');
insert into public.organizers (id, display_name)
values ('19000000-0000-4000-8000-000000000001', 'Webhook Review Safety');
insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  '29000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  'published', 'clear', 'Webhook Review Event',
  'A paid event used only for webhook ordering safety tests.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'Review Venue', '4 Mission Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.webhook-review-safety', 37.7936, -122.3958, 'paid', now()
);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values (
  '39000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  'Review Admission', 2000, 'usd', 20, 'active', 1
);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  '19000000-0000-4000-8000-000000000001', 'acct_WebhookReviewSafety',
  'active', 'active', 'clear', 0, 0, now()
);

create or replace function pg_temp.create_open_order(
  p_request_id uuid,
  p_token_hash text,
  p_session_id text
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
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    'Webhook Buyer', 'webhook-buyer@example.invalid', p_request_id, p_token_hash
  ) as reservation;
  perform public.server_attach_checkout_session(
    v_order_id, p_session_id,
    (select checkout_expires_at from public.orders where id = v_order_id)
  );
  return v_order_id;
end;
$$;

create temporary table review_orders (kind text primary key, id uuid not null) on commit drop;
insert into review_orders values
  ('refund', pg_temp.create_open_order(
    '49000000-0000-4000-8000-000000000001', repeat('a', 64),
    'cs_test_ReviewRefundBeforePaid'
  )),
  ('dispute', pg_temp.create_open_order(
    '49000000-0000-4000-8000-000000000002', repeat('b', 64),
    'cs_test_ReviewDisputeBeforePaid'
  )),
  ('policy', pg_temp.create_open_order(
    '49000000-0000-4000-8000-000000000003', repeat('c', 64),
    'cs_test_ReviewPolicyMismatch'
  ));
grant select on review_orders to service_role;

set local role service_role;

select * from public.server_record_webhook_receipt(
  'evt_ReviewRefundBeforePaid', 'refund.updated', false,
  're_ReviewRefundBeforePaid', '2026-07-29.dahlia',
  '2026-08-26 04:00:00+00', repeat('1', 64)
);
select results_eq(
  $$
    select order_status, ticket_status
    from public.server_apply_verified_refund(
      'evt_ReviewRefundBeforePaid',
      (select id from review_orders where kind = 'refund'),
      're_ReviewRefundBeforePaid', 'pi_ReviewRefundBeforePaid',
      'ch_ReviewRefundBeforePaid', 'trr_ReviewRefundBeforePaid',
      'fr_ReviewRefundBeforePaid', 2000, 'usd', 'succeeded',
      'requested_by_customer', true, true
    )
  $$,
  $$ values ('refunded'::text, null::text) $$,
  'a refund arriving before paid truth is persisted and cannot issue admission'
);
select results_eq(
  $$
    select status, paid_at, stripe_payment_intent_id, stripe_charge_id,
      (select count(*) from tickets where order_id = orders.id)
    from orders where id = (select id from review_orders where kind = 'refund')
  $$,
  $$ values (
    'refunded'::text, null::timestamptz,
    'pi_ReviewRefundBeforePaid'::text, 'ch_ReviewRefundBeforePaid'::text,
    0::bigint
  ) $$,
  'refund-before-paid binds payment identifiers and leaves zero tickets'
);

select * from public.server_record_webhook_receipt(
  'evt_ReviewRefundLateCheckout', 'checkout.session.completed', false,
  'cs_test_ReviewRefundBeforePaid', '2026-07-29.dahlia',
  '2026-08-26 04:00:01+00', repeat('2', 64)
);
select * from public.server_mark_payment_requires_review(
  'evt_ReviewRefundLateCheckout',
  (select id from review_orders where kind = 'refund'),
  'cs_test_ReviewRefundBeforePaid', 'pi_ReviewRefundBeforePaid',
  'ch_ReviewRefundBeforePaid', 'tr_ReviewRefundBeforePaid',
  'fee_ReviewRefundBeforePaid', 'txn_ReviewRefundBeforePaid',
  'cus_ReviewRefundBeforePaid', 'payment', 'paid', 'usd',
  2000, 2000, 150, 'acct_WebhookReviewSafety', 'PAYMENT_CHARGE_REFUNDED'
);
select results_eq(
  $$
    select status, paid_at is not null, reconciliation_status,
      (select count(*) from tickets where order_id = orders.id and status = 'valid')
    from orders where id = (select id from review_orders where kind = 'refund')
  $$,
  $$ values ('refunded'::text, true, 'requires_review'::text, 0::bigint) $$,
  'late paid Checkout after refund remains non-admissible and auditable'
);

select * from public.server_record_webhook_receipt(
  'evt_ReviewDisputeBeforePaid', 'charge.dispute.created', false,
  'du_ReviewDisputeBeforePaid', '2026-07-29.dahlia',
  '2026-08-26 04:01:00+00', repeat('3', 64)
);
select is(
  public.server_apply_verified_dispute(
    'evt_ReviewDisputeBeforePaid',
    (select id from review_orders where kind = 'dispute'),
    'du_ReviewDisputeBeforePaid', 'pi_ReviewDisputeBeforePaid',
    'ch_ReviewDisputeBeforePaid', 'trr_ReviewDisputeBeforePaid',
    'needs_response', 2000, 'usd', 'recovered'
  ),
  (select id from review_orders where kind = 'dispute'),
  'a dispute arriving before paid truth persists recovered review state'
);
select results_eq(
  $$
    select status, paid_at, stripe_payment_intent_id, stripe_charge_id,
      (select count(*) from tickets where order_id = orders.id)
    from orders where id = (select id from review_orders where kind = 'dispute')
  $$,
  $$ values (
    'requires_review'::text, null::timestamptz,
    'pi_ReviewDisputeBeforePaid'::text, 'ch_ReviewDisputeBeforePaid'::text,
    0::bigint
  ) $$,
  'dispute-before-paid binds payment identifiers and leaves zero tickets'
);

select * from public.server_record_webhook_receipt(
  'evt_ReviewDisputeLateCheckout', 'checkout.session.completed', false,
  'cs_test_ReviewDisputeBeforePaid', '2026-07-29.dahlia',
  '2026-08-26 04:01:01+00', repeat('4', 64)
);
select * from public.server_mark_payment_requires_review(
  'evt_ReviewDisputeLateCheckout',
  (select id from review_orders where kind = 'dispute'),
  'cs_test_ReviewDisputeBeforePaid', 'pi_ReviewDisputeBeforePaid',
  'ch_ReviewDisputeBeforePaid', 'tr_ReviewDisputeBeforePaid',
  'fee_ReviewDisputeBeforePaid', 'txn_ReviewDisputeBeforePaid',
  'cus_ReviewDisputeBeforePaid', 'payment', 'paid', 'usd',
  2000, 2000, 150, 'acct_WebhookReviewSafety', 'PAYMENT_CHARGE_DISPUTED'
);
select results_eq(
  $$
    select status, paid_at is not null,
      (select count(*) from tickets where order_id = orders.id and status = 'valid')
    from orders where id = (select id from review_orders where kind = 'dispute')
  $$,
  $$ values ('requires_review'::text, true, 0::bigint) $$,
  'late paid Checkout after dispute cannot create a valid ticket'
);

select * from public.server_record_webhook_receipt(
  'evt_ReviewPolicyPaid', 'checkout.session.completed', false,
  'cs_test_ReviewPolicyMismatch', '2026-07-29.dahlia',
  '2026-08-26 04:02:00+00', repeat('5', 64)
);
select * from public.server_fulfill_paid_order(
  'evt_ReviewPolicyPaid', (select id from review_orders where kind = 'policy'),
  'cs_test_ReviewPolicyMismatch', 'pi_ReviewPolicyMismatch',
  'ch_ReviewPolicyMismatch', 'tr_ReviewPolicyMismatch',
  'fee_ReviewPolicyMismatch', 'txn_ReviewPolicyMismatch',
  'cus_ReviewPolicyMismatch', 'payment', 'paid', 'usd',
  2000, 2000, 150, 'acct_WebhookReviewSafety'
);
select * from public.server_record_webhook_receipt(
  'evt_ReviewPolicyMismatch', 'refund.updated', false,
  're_ReviewPolicyMismatch', '2026-07-29.dahlia',
  '2026-08-26 04:02:01+00', repeat('6', 64)
);
select * from public.server_mark_payment_requires_review(
  'evt_ReviewPolicyMismatch', (select id from review_orders where kind = 'policy'),
  'cs_test_ReviewPolicyMismatch', 'pi_ReviewPolicyMismatch',
  'ch_ReviewPolicyMismatch', 'tr_ReviewPolicyMismatch',
  'fee_ReviewPolicyMismatch', 'txn_ReviewPolicyMismatch',
  'cus_ReviewPolicyMismatch', 'payment', 'paid', 'usd',
  2000, 2000, 150, 'acct_WebhookReviewSafety', 'REFUND_POLICY_MISMATCH'
);
select results_eq(
  $$
    select orders.status, orders.reconciliation_status, orders.failure_code,
      tickets.status
    from orders join tickets on tickets.order_id = orders.id
    where orders.id = (select id from review_orders where kind = 'policy')
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'REFUND_POLICY_MISMATCH'::text, 'cancelled'::text
  ) $$,
  'an unverified refund policy invalidates an existing ticket and marks review'
);

select is(
  public.server_persist_connect_status_if_current(
    'acct_WebhookReviewSafety', '2099-08-26 05:01:00+00', 'evt_NewRestricted',
    'restricted', 'restricted', 'restricted', 2, 1, 'STRIPE_REQUIREMENTS_PAST_DUE'
  ),
  'updated'::text,
  'newer restricted Connect truth is persisted'
);
select is(
  public.server_persist_connect_status_if_current(
    'acct_WebhookReviewSafety', '2099-08-26 05:00:00+00', 'evt_OldReady',
    'active', 'active', 'clear', 0, 0, null
  ),
  'stale'::text,
  'an older ready response is deterministically rejected by CAS'
);
reset role;
select results_eq(
  $$
    select transfers_status, payouts_status, requirements_status,
      requirements_currently_due_count, requirements_past_due_count,
      last_status_code, last_synced_at, last_sync_revision
    from organizer_stripe_accounts
    where stripe_account_id = 'acct_WebhookReviewSafety'
  $$,
  $$ values (
    'restricted'::text, 'restricted'::text, 'restricted'::text,
    2, 1, 'STRIPE_REQUIREMENTS_PAST_DUE'::text,
    '2099-08-26 05:01:00+00'::timestamptz, 'evt_NewRestricted'::text
  ) $$,
  'stale-ready versus newer-restricted ordering preserves newer truth'
);

select is(
  (select count(*) from refunds where order_id in (select id from review_orders)),
  1::bigint,
  'only the verified early refund persists a refund domain row'
);
select is(
  (select count(*) from disputes where order_id in (select id from review_orders)),
  1::bigint,
  'only the verified early dispute persists a dispute domain row'
);

select * from finish(true);
rollback;
