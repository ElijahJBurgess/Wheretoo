-- Include-only rollback fixtures shared by the two Core Ticket Truth Lite suites.
-- Call inside the caller transaction as the elevated fixture role; ends as service_role.
insert into auth.users (id, email) values
  ('a6100000-0000-4000-8000-000000000001', 'integrity-owner@example.invalid'),
  ('a6100000-0000-4000-8000-000000000002', 'integrity-other@example.invalid');

insert into public.organizers (id, display_name) values
  ('a6100000-0000-4000-8000-000000000001', 'Checkout Integrity Fulfillment'),
  ('a6100000-0000-4000-8000-000000000002', 'Checkout Integrity Other');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  'a6200000-0000-4000-8000-000000000001',
  'a6100000-0000-4000-8000-000000000001',
  'published', 'clear', 'Checkout Integrity Fulfillment Event',
  'A synthetic event for rollback-only multi-item fulfillment verification.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'Integrity Hall', '1 Integrity Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.checkout-integrity-fulfillment', 37.7936, -122.3958, 'paid', now()
), (
  'a6200000-0000-4000-8000-000000000002',
  'a6100000-0000-4000-8000-000000000002',
  'draft', 'clear', 'Checkout Integrity Other Event',
  'A reference-only event for incoherent ticket fixtures.',
  'community', now() + interval '3 days', now() + interval '3 days 2 hours',
  'Other Hall', '2 Integrity Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.checkout-integrity-other', 37.7937, -122.3959, 'paid', null
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  (
    'a6300000-0000-4000-8000-000000000001',
    'a6200000-0000-4000-8000-000000000001',
    'General Admission', 1001, 'usd', 14, 'active', 1
  ),
  (
    'a6300000-0000-4000-8000-000000000002',
    'a6200000-0000-4000-8000-000000000001',
    'VIP', 999, 'usd', 8, 'active', 2
  ),
  (
    'a6300000-0000-4000-8000-000000000004',
    'a6200000-0000-4000-8000-000000000001',
    'Alternate General Admission', 1001, 'usd', 2, 'active', 3
  ),
  (
    'a6300000-0000-4000-8000-000000000003',
    'a6200000-0000-4000-8000-000000000002',
    'Other Admission', 1500, 'usd', 10, 'active', 1
  );

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  'a6100000-0000-4000-8000-000000000001', 'acct_integrityfulfillment',
  'active', 'active', 'clear', 0, 0, now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  'a6200000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);

select set_config('request.jwt.claim.sub', 'a6100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.accept_current_event_policies('a6200000-0000-4000-8000-000000000001');
select public.publish_event('a6200000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;

create temporary table fulfillment_orders (
  kind text primary key,
  id uuid not null,
  session_id text not null
) on commit drop;
grant all on fulfillment_orders to service_role;

create or replace function pg_temp.create_multi_item_order(
  p_request_id uuid,
  p_hash text,
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
    'a6200000-0000-4000-8000-000000000001',
    '[{"tier_id":"a6300000-0000-4000-8000-000000000002","quantity":1},{"tier_id":"a6300000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    'Synthetic Buyer', 'synthetic-buyer@example.invalid',
    p_request_id, p_hash
  ) as reservation;

  perform public.server_attach_checkout_session(
    v_order_id,
    p_session_id,
    (
      select orders.checkout_expires_at
      from public.orders as orders
      where orders.id = v_order_id
    )
  );
  return v_order_id;
end;
$$;

set local role service_role;

insert into fulfillment_orders (kind, id, session_id) values
  (
    'clean',
    pg_temp.create_multi_item_order(
      'a6400000-0000-4000-8000-000000000001', repeat('1', 64),
      'cs_test_integrityclean'
    ),
    'cs_test_integrityclean'
  ),
  (
    'partial',
    pg_temp.create_multi_item_order(
      'a6400000-0000-4000-8000-000000000002', repeat('2', 64),
      'cs_test_integritypartial'
    ),
    'cs_test_integritypartial'
  ),
  (
    'extra',
    pg_temp.create_multi_item_order(
      'a6400000-0000-4000-8000-000000000003', repeat('3', 64),
      'cs_test_integrityextra'
    ),
    'cs_test_integrityextra'
  ),
  (
    'refs',
    pg_temp.create_multi_item_order(
      'a6400000-0000-4000-8000-000000000004', repeat('4', 64),
      'cs_test_integrityrefs'
    ),
    'cs_test_integrityrefs'
  ),
  (
    'aggregate',
    pg_temp.create_multi_item_order(
      'a6400000-0000-4000-8000-000000000005', repeat('5', 64),
      'cs_test_integrityaggregate'
    ),
    'cs_test_integrityaggregate'
  ),
  (
    'atomic',
    pg_temp.create_multi_item_order(
      'a6400000-0000-4000-8000-000000000006', repeat('6', 64),
      'cs_test_integrityatomic'
    ),
    'cs_test_integrityatomic'
  ),
  (
    'snapshot',
    pg_temp.create_multi_item_order(
      'a6400000-0000-4000-8000-000000000007', repeat('7', 64),
      'cs_test_integritysnapshot'
    ),
    'cs_test_integritysnapshot'
  );

\ir ticket_manifest.inc
create or replace function pg_temp.record_and_fulfill(
  p_event_suffix text,
  p_payment_suffix text,
  p_order_id uuid,
  p_session_id text,
  p_manifest jsonb default '"auto"'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform * from public.server_record_webhook_receipt(
    'evt_' || p_event_suffix,
    'checkout.session.completed', false,
    p_session_id, '2026-07-29.dahlia',
    '2026-09-02 12:00:00+00', repeat('a', 64)
  );

  select pg_catalog.to_jsonb(result) into v_result
  from public.server_fulfill_paid_order(
    'evt_' || p_event_suffix,
    p_order_id,
    p_session_id,
    'pi_' || p_payment_suffix,
    'ch_' || p_payment_suffix,
    'tr_' || p_payment_suffix,
    'fee_' || p_payment_suffix,
    'txn_' || p_payment_suffix,
    'cus_' || p_payment_suffix,
    'payment', 'paid', 'usd',
    3001, 3001, 300, 'acct_integrityfulfillment',
    case when p_manifest = '"auto"'::jsonb then pg_temp.ticket_manifest(p_order_id) else p_manifest end
  ) as result;
  return v_result;
end;
$$;
