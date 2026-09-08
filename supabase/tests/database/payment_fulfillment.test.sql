begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(45);

select results_eq(
  $$
    select (array_agg(pg_catalog.to_regprocedure(signature)::text order by signature)::text[])
      collate "C"
    from unnest(array[
      'private.fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)',
      'private.mark_payment_failed(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text,text)',
      'private.mark_payment_processing(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text)',
      'private.record_webhook_receipt(text,text,boolean,text,text,timestamp with time zone,text)'
    ]) as signatures(signature)
  $$,
  $$
    values ((array[
      'private.fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)',
      'private.mark_payment_failed(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text,text)',
      'private.mark_payment_processing(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text)',
      'private.record_webhook_receipt(text,text,boolean,text,text,timestamp with time zone,text)'
    ]::text[]) collate "C")
  $$,
  'the four private fulfillment functions have their exact signatures'
);

select results_eq(
  $$
    select (array_agg(pg_catalog.to_regprocedure(signature)::text order by signature)::text[])
      collate "C"
    from unnest(array[
      'public.server_fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)',
      'public.server_mark_payment_failed(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text,text)',
      'public.server_mark_payment_processing(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text)',
      'public.server_record_webhook_receipt(text,text,boolean,text,text,timestamp with time zone,text)'
    ]) as signatures(signature)
  $$,
  $$
    values ((array[
      'server_fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)',
      'server_mark_payment_failed(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text,text)',
      'server_mark_payment_processing(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text)',
      'server_record_webhook_receipt(text,text,boolean,text,text,timestamp with time zone,text)'
    ]::text[]) collate "C")
  $$,
  'the four public fulfillment wrappers have exact PostgREST signatures'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege('anon', function_name, 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', function_name, 'EXECUTE'),
      pg_catalog.has_function_privilege('service_role', function_name, 'EXECUTE')
    ]
    from unnest(array[
      'public.server_fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)',
      'public.server_mark_payment_failed(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text,text)',
      'public.server_mark_payment_processing(text,uuid,text,text,text,text,text,bigint,bigint,bigint,text)',
      'public.server_record_webhook_receipt(text,text,boolean,text,text,timestamp with time zone,text)'
    ]) as functions(function_name)
    order by function_name
  $$,
  $$ values
    (array[false, false, true]),
    (array[false, false, true]),
    (array[false, false, true]),
    (array[false, false, true])
  $$,
  'only service_role can execute the public fulfillment wrappers'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'fulfill_paid_order', 'mark_payment_failed', 'mark_payment_processing',
        'record_webhook_receipt'
      )
      and privileges.grantee <> procedures.proowner
  $$,
  $$ values (0::bigint) $$,
  'private fulfillment functions have no non-owner execution privilege'
);

insert into auth.users (id, email)
values ('16000000-0000-4000-8000-000000000001', 'fulfillment-owner@example.invalid');

insert into public.organizers (id, display_name)
values ('16000000-0000-4000-8000-000000000001', 'Fulfillment Owner');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
)
values (
  '26000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  'published', 'clear', 'Fulfillment Event',
  'A paid event used to verify exactly-once webhook fulfillment.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'Fulfillment Venue', '1 Mission Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.fulfillment-event', 37.7936, -122.3958, 'paid', now()
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order, version
)
values
  (
    '36000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    'General Admission', 2000, 'usd', 20, 'active', 1, 1
  ),
  (
    '36000000-0000-4000-8000-000000000002',
    '26000000-0000-4000-8000-000000000001',
    'Invalidated Admission', 3000, 'usd', 2, 'active', 2, 1
  );

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
)
values (
  '16000000-0000-4000-8000-000000000001', 'acct_fulfillmentowner',
  'active', 'active', 'clear', 0, 0, now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
values (
  '26000000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);

select set_config(
  'request.jwt.claim.sub', '16000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies('26000000-0000-4000-8000-000000000001');
select public.publish_event('26000000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;

create or replace function pg_temp.create_checkout_order(
  p_tier_id uuid,
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
    '26000000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('tier_id', p_tier_id, 'quantity', 1)),
    'Test Buyer', 'buyer@example.invalid', p_request_id, p_hash
  ) as reservation;

  perform public.server_attach_checkout_session(
    v_order_id, p_session_id,
    (select orders.checkout_expires_at from public.orders as orders where orders.id = v_order_id)
  );
  return v_order_id;
end;
$$;

set local role service_role;

select results_eq(
  $$
    select should_process, processing_status, delivery_attempt_count
    from public.server_record_webhook_receipt(
      'evt_fulfillmentreceipt', 'checkout.session.completed', false,
      'cs_test_fulfillmentreceipt', '2025-08-27.basil',
      '2026-08-25 12:00:00+00', repeat('a', 64)
    )
  $$,
  $$ values (true, 'processing'::text, 1) $$,
  'a new test-mode Stripe event is durably accepted for processing'
);

select results_eq(
  $$
    select should_process, processing_status, delivery_attempt_count
    from public.server_record_webhook_receipt(
      'evt_fulfillmentreceipt', 'checkout.session.completed', false,
      'cs_test_fulfillmentreceipt', '2025-08-27.basil',
      '2026-08-25 12:00:00+00', repeat('a', 64)
    )
  $$,
  $$ values (true, 'processing'::text, 2) $$,
  'a duplicate in-flight delivery increments its attempt count without a second receipt'
);

select is(
  (select count(*) from public.stripe_webhook_events where stripe_event_id = 'evt_fulfillmentreceipt'),
  1::bigint,
  'duplicate delivery preserves one webhook receipt row'
);

select throws_ok(
  $$
    select * from public.server_record_webhook_receipt(
      'evt_fulfillmentreceipt', 'checkout.session.completed', false,
      'cs_test_fulfillmentreceipt', '2025-08-27.basil',
      '2026-08-25 12:00:00+00', repeat('b', 64)
    )
  $$,
  'P0001', 'WEBHOOK_EVENT_MISMATCH',
  'the same Stripe event ID cannot be replayed with a different payload digest'
);

select throws_ok(
  $$
    select * from public.server_record_webhook_receipt(
      'evt_livefulfillment', 'checkout.session.completed', true,
      'cs_live_forbidden', '2025-08-27.basil',
      '2026-08-25 12:00:00+00', repeat('c', 64)
    )
  $$,
  'P0001', 'LIVE_MODE_FORBIDDEN',
  'webhook receipt rejects live-mode Stripe events'
);

select is(
  (select count(*) from public.stripe_webhook_events where stripe_event_id = 'evt_livefulfillment'),
  0::bigint,
  'a rejected live event leaves no webhook receipt'
);

create temporary table primary_order (id uuid primary key) on commit drop;
insert into primary_order
values (pg_temp.create_checkout_order(
  '36000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000001', repeat('1', 64),
  'cs_test_primaryfulfillment'
));

select * from public.server_record_webhook_receipt(
  'evt_primaryfulfillment', 'checkout.session.completed', false,
  'cs_test_primaryfulfillment', '2025-08-27.basil',
  '2026-08-25 12:01:00+00', repeat('d', 64)
);

update public.organizer_stripe_accounts
set stripe_account_id = 'acct_fulfillmentrotated', last_synced_at = now()
where organizer_id = '16000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_primaryfulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'subscription', 'paid', 'usd',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  'P0001', 'PAYMENT_SNAPSHOT_MISMATCH',
  'fulfillment rejects a non-payment Checkout mode'
);

select throws_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_primaryfulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'unpaid', 'usd',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  'P0001', 'PAYMENT_NOT_PAID',
  'fulfillment rejects an unpaid Checkout Session'
);

select * from public.server_record_webhook_receipt(
  'evt_wrongsession', 'checkout.session.completed', false,
  'cs_test_wrongsession', '2025-08-27.basil',
  '2026-08-25 12:01:30+00', repeat('7', 64)
);

select throws_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_wrongsession', (select id from primary_order),
      'cs_test_wrongsession', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'usd',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  'P0001', 'PAYMENT_SNAPSHOT_MISMATCH',
  'fulfillment rejects a Checkout Session that does not match the persisted order'
);

select throws_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_primaryfulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'eur',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  'P0001', 'PAYMENT_SNAPSHOT_MISMATCH',
  'fulfillment rejects a mismatched currency'
);

select throws_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_primaryfulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'usd',
      1999, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  'P0001', 'PAYMENT_SNAPSHOT_MISMATCH',
  'fulfillment rejects a mismatched subtotal'
);

select throws_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_primaryfulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'usd',
      2000, 1999, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  'P0001', 'PAYMENT_SNAPSHOT_MISMATCH',
  'fulfillment rejects a mismatched total'
);

select throws_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_primaryfulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'usd',
      2000, 2000, 149, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  'P0001', 'PAYMENT_SNAPSHOT_MISMATCH',
  'fulfillment rejects a mismatched application fee'
);

select throws_ok(
  $$
    select * from public.server_fulfill_paid_order(
      'evt_primaryfulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'usd',
      2000, 2000, 150, 'acct_wrongdestination',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  'P0001', 'PAYMENT_SNAPSHOT_MISMATCH',
  'fulfillment rejects a mismatched destination account'
);

select results_eq(
  $$
    select order_status, ticket_count
    from public.server_fulfill_paid_order(
      'evt_primaryfulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'usd',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  $$ values ('paid'::text, 1::bigint) $$,
  'an exact paid Stripe snapshot fulfills the persisted order'
);

update public.organizer_stripe_accounts
set stripe_account_id = 'acct_fulfillmentowner', last_synced_at = now()
where organizer_id = '16000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select status, paid_at is not null, failed_at, expired_at,
      stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
      stripe_transfer_id, stripe_application_fee_id, stripe_balance_transaction_id,
      stripe_customer_id, last_stripe_event_id, reconciliation_status, failure_code
    from public.orders where id = (select id from primary_order)
  $$,
  $$ values (
    'paid'::text, true, null::timestamptz, null::timestamptz,
    'cs_test_primaryfulfillment'::text, 'pi_primaryfulfillment'::text,
    'ch_primaryfulfillment'::text, 'tr_primaryfulfillment'::text,
    'fee_primaryfulfillment'::text, 'txn_primaryfulfillment'::text,
    'cus_primaryfulfillment'::text, 'evt_primaryfulfillment'::text,
    'reconciled'::text, null::text
  ) $$,
  'fulfillment stores reconciliable Stripe identifiers and monotonic paid truth'
);

select results_eq(
  $$
    select tickets.order_id, tickets.event_id, tickets.organizer_id,
      tickets.ticket_tier_id, tickets.unit_sequence, tickets.status
    from public.tickets as tickets where tickets.order_id = (select id from primary_order)
  $$,
  $$ values (
    (select id from primary_order),
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '36000000-0000-4000-8000-000000000001'::uuid,
    1, 'valid'::text
  ) $$,
  'fulfillment issues exactly one valid unit-one ticket with persisted ownership'
);

select results_eq(
  $$
    select processing_status, processed_at is not null, error_code
    from public.stripe_webhook_events where stripe_event_id = 'evt_primaryfulfillment'
  $$,
  $$ values ('processed'::text, true, null::text) $$,
  'successful fulfillment marks its webhook receipt processed'
);

select results_eq(
  $$
    select should_process, processing_status, delivery_attempt_count
    from public.server_record_webhook_receipt(
      'evt_primaryfulfillment', 'checkout.session.completed', false,
      'cs_test_primaryfulfillment', '2025-08-27.basil',
      '2026-08-25 12:01:00+00', repeat('d', 64)
    )
  $$,
  $$ values (false, 'processed'::text, 2) $$,
  'a duplicate processed Stripe event is acknowledged without domain work'
);

select * from public.server_record_webhook_receipt(
  'evt_duplicatefulfillment', 'checkout.session.async_payment_succeeded', false,
  'cs_test_primaryfulfillment', '2025-08-27.basil',
  '2026-08-25 12:02:00+00', repeat('e', 64)
);

select results_eq(
  $$
    select order_id, order_status, ticket_count
    from public.server_fulfill_paid_order(
      'evt_duplicatefulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'usd',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  $$
    select orders.id, 'paid'::text, 1::bigint
    from public.orders as orders
    where orders.id = (select id from primary_order)
  $$,
  'a distinct retried Stripe event returns the already persisted fulfillment result'
);

select is(
  (select count(*) from public.tickets where order_id = (select id from primary_order)),
  1::bigint,
  'duplicate events and Session or PaymentIntent reuse cannot issue a second ticket'
);

update public.ticket_tiers
set status = 'archived'
where id = '36000000-0000-4000-8000-000000000001';

select * from public.server_record_webhook_receipt(
  'evt_paidafterarchive', 'checkout.session.async_payment_succeeded', false,
  'cs_test_primaryfulfillment', '2025-08-27.basil',
  '2026-08-25 12:02:30+00', repeat('9', 64)
);

select results_eq(
  $$
    select order_id, order_status, ticket_count
    from public.server_fulfill_paid_order(
      'evt_paidafterarchive', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment', 'ch_primaryfulfillment',
      'tr_primaryfulfillment', 'fee_primaryfulfillment', 'txn_primaryfulfillment',
      'cus_primaryfulfillment', 'payment', 'paid', 'usd',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from primary_order)))
  )
  $$,
  $$
    select orders.id, 'paid'::text, 1::bigint
    from public.orders as orders
    where orders.id = (select id from primary_order)
  $$,
  'a later tier change cannot reinterpret an already fulfilled payment'
);

select results_eq(
  $$
    select orders.status, tickets.status, orders.failure_code
    from public.orders as orders
    join public.tickets as tickets on tickets.order_id = orders.id
    where orders.id = (select id from primary_order)
  $$,
  $$ values ('paid'::text, 'valid'::text, null::text) $$,
  'terminal paid and valid ticket truth remains monotonic after invalidation'
);

update public.ticket_tiers
set status = 'active'
where id = '36000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select public.server_mark_payment_processing(
      'evt_duplicatefulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment',
      'payment', 'unpaid', 'usd', 2000, 2000, 150, 'acct_fulfillmentowner'
    ), status
    from public.orders where id = (select id from primary_order)
  $$,
  $$ select id, 'paid'::text from primary_order $$,
  'an out-of-order unpaid event cannot downgrade a paid order'
);

select results_eq(
  $$
    select public.server_mark_payment_failed(
      'evt_duplicatefulfillment', (select id from primary_order),
      'cs_test_primaryfulfillment', 'pi_primaryfulfillment',
      'payment', 'unpaid', 'usd', 2000, 2000, 150,
      'acct_fulfillmentowner', 'PAYMENT_FAILED'
    ), status
    from public.orders where id = (select id from primary_order)
  $$,
  $$ select id, 'paid'::text from primary_order $$,
  'an out-of-order failure cannot downgrade a paid order'
);

create temporary table processing_order (id uuid primary key) on commit drop;
insert into processing_order
values (pg_temp.create_checkout_order(
  '36000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000002', repeat('2', 64),
  'cs_test_processingfulfillment'
));

select * from public.server_record_webhook_receipt(
  'evt_processingfulfillment', 'checkout.session.completed', false,
  'cs_test_processingfulfillment', '2025-08-27.basil',
  '2026-08-25 12:03:00+00', repeat('f', 64)
);

select is(
  public.server_mark_payment_processing(
    'evt_processingfulfillment', (select id from processing_order),
    'cs_test_processingfulfillment', 'pi_processingfulfillment',
    'payment', 'unpaid', 'usd', 2000, 2000, 150, 'acct_fulfillmentowner'
  ),
  (select id from processing_order),
  'an exact unpaid completed Session advances to payment processing'
);

select results_eq(
  $$
    select status, stripe_payment_intent_id, last_stripe_event_id,
      reconciliation_status, failure_code
    from public.orders where id = (select id from processing_order)
  $$,
  $$ values (
    'payment_processing'::text, 'pi_processingfulfillment'::text,
    'evt_processingfulfillment'::text, 'pending'::text, null::text
  ) $$,
  'payment processing persists authoritative Session state without issuing a ticket'
);

select is(
  (select count(*) from public.tickets where order_id = (select id from processing_order)),
  0::bigint,
  'payment processing does not issue a ticket'
);

select * from public.server_record_webhook_receipt(
  'evt_processingpaid', 'checkout.session.async_payment_succeeded', false,
  'cs_test_processingfulfillment', '2025-08-27.basil',
  '2026-08-25 12:04:00+00', repeat('0', 64)
);

select results_eq(
  $$
    select order_status, ticket_count
    from public.server_fulfill_paid_order(
      'evt_processingpaid', (select id from processing_order),
      'cs_test_processingfulfillment', 'pi_processingfulfillment',
      'ch_processingfulfillment', 'tr_processingfulfillment',
      'fee_processingfulfillment', 'txn_processingfulfillment',
      'cus_processingfulfillment', 'payment', 'paid', 'usd',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from processing_order)))
  )
  $$,
  $$ values ('paid'::text, 1::bigint) $$,
  'an authoritative async success advances processing to paid exactly once'
);

create temporary table failed_order (id uuid primary key) on commit drop;
insert into failed_order
values (pg_temp.create_checkout_order(
  '36000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000003', repeat('3', 64),
  'cs_test_failedfulfillment'
));

select * from public.server_record_webhook_receipt(
  'evt_failedfulfillment', 'checkout.session.async_payment_failed', false,
  'cs_test_failedfulfillment', '2025-08-27.basil',
  '2026-08-25 12:05:00+00', repeat('4', 64)
);

select is(
  public.server_mark_payment_failed(
    'evt_failedfulfillment', (select id from failed_order),
    'cs_test_failedfulfillment', 'pi_failedfulfillment',
    'payment', 'unpaid', 'usd', 2000, 2000, 150,
    'acct_fulfillmentowner', 'PAYMENT_FAILED'
  ),
  (select id from failed_order),
  'an exact asynchronous failure advances an unfinished order'
);

select results_eq(
  $$
    select status, failed_at is not null, failure_code, last_stripe_event_id
    from public.orders where id = (select id from failed_order)
  $$,
  $$ values (
    'payment_failed'::text, true, 'PAYMENT_FAILED'::text,
    'evt_failedfulfillment'::text
  ) $$,
  'payment failure persists a safe terminal reason and releases inventory'
);

select is(
  public.server_mark_payment_failed(
    'evt_failedfulfillment', (select id from failed_order),
    'cs_test_failedfulfillment', 'pi_failedfulfillment',
    'payment', 'unpaid', 'usd', 2000, 2000, 150,
    'acct_fulfillmentowner', 'DIFFERENT_REASON'
  ),
  (select id from failed_order),
  'a duplicate failure event is idempotent'
);

select is(
  (select failure_code from public.orders where id = (select id from failed_order)),
  'PAYMENT_FAILED'::text,
  'a duplicate failure cannot rewrite terminal failure history'
);

create temporary table invalidated_order (id uuid primary key) on commit drop;
insert into invalidated_order
values (pg_temp.create_checkout_order(
  '36000000-0000-4000-8000-000000000002',
  '46000000-0000-4000-8000-000000000004', repeat('5', 64),
  'cs_test_invalidatedfulfillment'
));

update public.ticket_tiers
set status = 'archived'
where id = '36000000-0000-4000-8000-000000000002';

select * from public.server_record_webhook_receipt(
  'evt_invalidatedfulfillment', 'checkout.session.completed', false,
  'cs_test_invalidatedfulfillment', '2025-08-27.basil',
  '2026-08-25 12:06:00+00', repeat('6', 64)
);

select results_eq(
  $$
    select order_status, ticket_count
    from public.server_fulfill_paid_order(
      'evt_invalidatedfulfillment', (select id from invalidated_order),
      'cs_test_invalidatedfulfillment', 'pi_invalidatedfulfillment',
      'ch_invalidatedfulfillment', 'tr_invalidatedfulfillment',
      'fee_invalidatedfulfillment', 'txn_invalidatedfulfillment',
      'cus_invalidatedfulfillment', 'payment', 'paid', 'usd',
      3000, 3000, 200, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from invalidated_order)))
  )
  $$,
  $$ values ('requires_review'::text, 0::bigint) $$,
  'paid-after-tier-invalidation enters review without issuing a ticket'
);

select results_eq(
  $$
    select status, reconciliation_status, failure_code, stripe_payment_intent_id
    from public.orders where id = (select id from invalidated_order)
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'PAYMENT_AFTER_INVALIDATION'::text, 'pi_invalidatedfulfillment'::text
  ) $$,
  'review state retains payment identity for recovery and reconciliation'
);

select is(
  (select count(*) from public.tickets where order_id = (select id from invalidated_order)),
  0::bigint,
  'invalidated inventory never creates a valid ticket'
);

update public.ticket_tiers
set status = 'active'
where id = '36000000-0000-4000-8000-000000000002';

create temporary table late_order (id uuid primary key) on commit drop;
insert into late_order
values (pg_temp.create_checkout_order(
  '36000000-0000-4000-8000-000000000002',
  '46000000-0000-4000-8000-000000000005', repeat('7', 64),
  'cs_test_latefulfillment'
));

update public.orders
set created_at = now() - interval '2 hours',
  reservation_expires_at = now() - interval '30 minutes'
where id = (select id from late_order);

select * from public.server_record_webhook_receipt(
  'evt_latefulfillment', 'checkout.session.async_payment_succeeded', false,
  'cs_test_latefulfillment', '2025-08-27.basil',
  '2026-08-25 12:07:00+00', repeat('8', 64)
);

select results_eq(
  $$
    select order_status, ticket_count
    from public.server_fulfill_paid_order(
      'evt_latefulfillment', (select id from late_order),
      'cs_test_latefulfillment', 'pi_latefulfillment',
      'ch_latefulfillment', 'tr_latefulfillment', 'fee_latefulfillment',
      'txn_latefulfillment', 'cus_latefulfillment', 'payment', 'paid', 'usd',
      3000, 3000, 200, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from late_order)))
  )
  $$,
  $$ values ('requires_review'::text, 0::bigint) $$,
  'a paid Session after reservation expiry enters review even when capacity appears free'
);

select is(
  (select count(*) from public.tickets where order_id = (select id from late_order)),
  0::bigint,
  'late payment does not consume reallocated inventory'
);

select results_eq(
  $$
    select count(*)::bigint, count(distinct stripe_payment_intent_id)::bigint
    from public.orders
    where stripe_payment_intent_id in (
      'pi_primaryfulfillment', 'pi_processingfulfillment',
      'pi_failedfulfillment', 'pi_invalidatedfulfillment', 'pi_latefulfillment'
    )
  $$,
  $$ values (5::bigint, 5::bigint) $$,
  'each persisted PaymentIntent belongs to exactly one order'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.stripe_webhook_events
    where processing_status = 'processed'
      and stripe_event_id in (
        'evt_primaryfulfillment', 'evt_duplicatefulfillment',
        'evt_processingfulfillment', 'evt_processingpaid',
        'evt_failedfulfillment', 'evt_invalidatedfulfillment', 'evt_latefulfillment'
      )
  $$,
  $$ values (7::bigint) $$,
  'every durable payment transition completes exactly one webhook receipt'
);

create temporary table after_end_order (id uuid primary key) on commit drop;
insert into after_end_order
values (pg_temp.create_checkout_order(
  '36000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000006', repeat('9', 64),
  'cs_test_afterendfulfillment'
));

update public.events
set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
where id = '26000000-0000-4000-8000-000000000001';

select * from public.server_record_webhook_receipt(
  'evt_afterendfulfillment', 'checkout.session.completed', false,
  'cs_test_afterendfulfillment', '2025-08-27.basil',
  '2026-08-25 12:08:00+00', repeat('9', 64)
);

select results_eq(
  $$
    select order_status, ticket_count
    from public.server_fulfill_paid_order(
      'evt_afterendfulfillment', (select id from after_end_order),
      'cs_test_afterendfulfillment', 'pi_afterendfulfillment',
      'ch_afterendfulfillment', 'tr_afterendfulfillment',
      'fee_afterendfulfillment', 'txn_afterendfulfillment',
      'cus_afterendfulfillment', 'payment', 'paid', 'usd',
      2000, 2000, 150, 'acct_fulfillmentowner',
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', manifest_item.id, 'unit_sequence', manifest_unit.n,
      'admission_label', manifest_item.tier_name,
      'credential_hash', encode(extensions.digest(manifest_item.id::text || ':' || manifest_unit.n::text, 'sha256'), 'hex'))
      order by manifest_item.id, manifest_unit.n)
    from public.order_items as manifest_item
    cross join lateral generate_series(1, manifest_item.quantity) as manifest_unit(n)
    where manifest_item.order_id = ((select id from after_end_order)))
  )
  $$,
  $$ values ('paid'::text, 1::bigint) $$,
  'an accepted in-flight Session can fulfill after event end without schedule reclassification'
);

update public.events
set starts_at = now() + interval '2 days', ends_at = now() + interval '2 days 2 hours'
where id = '26000000-0000-4000-8000-000000000001';

reset role;
update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;
select * from finish();
rollback;
