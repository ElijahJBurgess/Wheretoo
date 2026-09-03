begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_function(
  'public', 'server_get_checkout_integrity_order_snapshot', array['uuid', 'text'],
  'multi-item order snapshots have a narrow service wrapper'
);
select has_function(
  'public', 'server_get_checkout_integrity_payment_snapshot', array['uuid'],
  'multi-item payment snapshots have a narrow service wrapper'
);
select has_function(
  'public', 'server_mark_checkout_reconciliation_review',
  array['uuid', 'text', 'text', 'text'],
  'known checkout mismatches have a narrow service review wrapper'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege(
        'anon',
        'public.server_get_checkout_integrity_order_snapshot(uuid,text)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.server_get_checkout_integrity_order_snapshot(uuid,text)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role',
        'public.server_get_checkout_integrity_order_snapshot(uuid,text)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'anon',
        'public.server_get_checkout_integrity_payment_snapshot(uuid)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.server_get_checkout_integrity_payment_snapshot(uuid)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role',
        'public.server_get_checkout_integrity_payment_snapshot(uuid)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'anon',
        'public.server_mark_checkout_reconciliation_review(uuid,text,text,text)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.server_mark_checkout_reconciliation_review(uuid,text,text,text)',
        'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role',
        'public.server_mark_checkout_reconciliation_review(uuid,text,text,text)',
        'EXECUTE'
      )
    ]
  $$,
  $$ values (array[false, false, true, false, false, true, false, false, true]) $$,
  'multi-item snapshots and review mutation are service-only'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'get_checkout_integrity_order_snapshot',
        'get_checkout_integrity_payment_snapshot',
        'mark_checkout_reconciliation_review'
      )
      and privileges.grantee <> procedures.proowner
  $$,
  $$ values (0::bigint) $$,
  'private checkout reconciliation functions have no non-owner execution privilege'
);

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

create or replace function pg_temp.order_snapshot(p_order_id uuid, p_session_id text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  execute '
    select pg_catalog.to_jsonb(snapshot)
    from public.server_get_checkout_integrity_order_snapshot($1, $2) as snapshot
  ' into v_snapshot using p_order_id, p_session_id;
  return v_snapshot;
exception when undefined_function then
  return null;
end;
$$;

create or replace function pg_temp.payment_snapshot(p_order_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  execute '
    select pg_catalog.to_jsonb(snapshot)
    from public.server_get_checkout_integrity_payment_snapshot($1) as snapshot
  ' into v_snapshot using p_order_id;
  return v_snapshot;
exception when undefined_function then
  return null;
end;
$$;

create temporary table clean_snapshot on commit drop as
select pg_temp.order_snapshot(id, session_id) as value
from fulfillment_orders
where kind = 'clean';

select results_eq(
  $$
    select
      value ->> 'order_id',
      value ->> 'checkout_session_id',
      value ->> 'event_id',
      value ->> 'currency',
      (value ->> 'subtotal_minor')::bigint,
      (value ->> 'total_minor')::bigint,
      (value ->> 'application_fee_amount_minor')::bigint,
      value ->> 'destination_account_id',
      jsonb_array_length(value -> 'order_items')
    from clean_snapshot
  $$,
  $$
    select
      id::text,
      'cs_test_integrityclean'::text,
      'a6200000-0000-4000-8000-000000000001'::text,
      'usd'::text,
      3001::bigint,
      3001::bigint,
      300::bigint,
      'acct_integrityfulfillment'::text,
      2::integer
    from fulfillment_orders
    where kind = 'clean'
  $$,
  'the order snapshot returns one exact aggregate row and both item snapshots'
);

select results_eq(
  $$
    select array_agg(keys.key order by keys.key)
    from clean_snapshot
    cross join lateral jsonb_object_keys(value) as keys(key)
  $$,
  $$ values (array[
    'application_fee_amount_minor', 'checkout_session_id',
    'currency', 'destination_account_id', 'event_id', 'order_id',
    'order_items', 'subtotal_minor', 'total_minor'
  ]::text[]) $$,
  'the snapshot exposes no singular tier field, buyer PII, or unrelated provider data'
);

select results_eq(
  $$
    select
      value -> 'order_items' -> 0 ->> 'ticket_tier_id',
      (value -> 'order_items' -> 0 ->> 'unit_amount_minor')::bigint,
      (value -> 'order_items' -> 0 ->> 'quantity')::integer,
      (value -> 'order_items' -> 0 ->> 'subtotal_minor')::bigint,
      value -> 'order_items' -> 1 ->> 'ticket_tier_id',
      (value -> 'order_items' -> 1 ->> 'unit_amount_minor')::bigint,
      (value -> 'order_items' -> 1 ->> 'quantity')::integer,
      (value -> 'order_items' -> 1 ->> 'subtotal_minor')::bigint
    from clean_snapshot
  $$,
  $$ values (
    'a6300000-0000-4000-8000-000000000001'::text,
    1001::bigint, 2::integer, 2002::bigint,
    'a6300000-0000-4000-8000-000000000002'::text,
    999::bigint, 1::integer, 999::bigint
  ) $$,
  'item snapshots are deterministically tier-sorted with literal safe integer values'
);

select results_eq(
  $$
    select array_agg(keys.key order by keys.key)
    from clean_snapshot
    cross join lateral jsonb_array_elements(value -> 'order_items') as item(value)
    cross join lateral jsonb_object_keys(item.value) as keys(key)
    where item.value ->> 'ticket_tier_id' = 'a6300000-0000-4000-8000-000000000001'
  $$,
  $$ values (array[
    'currency', 'order_item_id', 'quantity', 'subtotal_minor',
    'ticket_tier_id', 'unit_amount_minor'
  ]::text[]) $$,
  'each reconciliation item contains only the exact safe webhook fields'
);

select results_eq(
  $$
    select
      jsonb_typeof(value -> 'subtotal_minor'),
      jsonb_typeof(value -> 'total_minor'),
      jsonb_typeof(value -> 'application_fee_amount_minor'),
      jsonb_typeof(value -> 'order_items' -> 0 -> 'unit_amount_minor'),
      jsonb_typeof(value -> 'order_items' -> 0 -> 'quantity'),
      jsonb_typeof(value -> 'order_items' -> 0 -> 'subtotal_minor')
    from clean_snapshot
  $$,
  $$ values (
    'number'::text, 'number'::text, 'number'::text,
    'number'::text, 'number'::text, 'number'::text
  ) $$,
  'all reconciliation integer fields remain JSON numbers'
);

select is(
  pg_temp.order_snapshot(
    (select id from fulfillment_orders where kind = 'clean'),
    'cs_test_integritywrong'
  ),
  null::jsonb,
  'an incorrect Checkout Session exposes no order snapshot'
);

select is(
  pg_temp.order_snapshot(
    (select id from fulfillment_orders where kind = 'clean'),
    'cs_test_integrityclean'
  ),
  (select value from clean_snapshot),
  'repeated snapshot reads preserve deterministic item ordering'
);

select is(
  pg_temp.payment_snapshot((select id from fulfillment_orders where kind = 'clean')),
  (select value from clean_snapshot),
  'the payment-bound snapshot returns the same exact multi-item purchase snapshot'
);

create or replace function pg_temp.record_and_fulfill(
  p_event_suffix text,
  p_payment_suffix text,
  p_order_id uuid,
  p_session_id text
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
    3001, 3001, 300, 'acct_integrityfulfillment'
  ) as result;
  return v_result;
end;
$$;

create temporary table clean_fulfillment on commit drop as
select pg_temp.record_and_fulfill(
  'integrityclean', 'integrityclean', id, session_id
) as value
from fulfillment_orders
where kind = 'clean';

select results_eq(
  $$
    select value ->> 'order_status',
      (value ->> 'ticket_count')::bigint,
      value ? 'ticket_id'
    from clean_fulfillment
  $$,
  $$ values ('paid'::text, 3::bigint, false) $$,
  'exact payment creates three tickets and returns only the aggregate ticket count'
);

select results_eq(
  $$
    select
      tickets.ticket_tier_id,
      tickets.unit_sequence,
      tickets.order_id = items.order_id,
      tickets.order_item_id = items.id,
      tickets.event_id = orders.event_id,
      tickets.organizer_id = orders.organizer_id,
      tickets.ticket_tier_id = items.ticket_tier_id,
      tickets.status,
      tickets.issued_at is not null
    from public.tickets as tickets
    join public.order_items as items on items.id = tickets.order_item_id
    join public.orders as orders on orders.id = tickets.order_id
    where tickets.order_id = (select id from fulfillment_orders where kind = 'clean')
    order by tickets.ticket_tier_id, tickets.unit_sequence
  $$,
  $$ values
    (
      'a6300000-0000-4000-8000-000000000001'::uuid,
      1, true, true, true, true, true, 'valid'::text, true
    ),
    (
      'a6300000-0000-4000-8000-000000000001'::uuid,
      2, true, true, true, true, true, 'valid'::text, true
    ),
    (
      'a6300000-0000-4000-8000-000000000002'::uuid,
      1, true, true, true, true, true, 'valid'::text, true
    )
  $$,
  'tickets have exact item-local sequences, coherent duplicated references, and server timestamps'
);

select results_eq(
  $$
    select count(*)::bigint, count(distinct id)::bigint,
      count(distinct issued_at)::bigint
    from public.tickets
    where order_id = (select id from fulfillment_orders where kind = 'clean')
  $$,
  $$ values (3::bigint, 3::bigint, 1::bigint) $$,
  'one server-generated identity exists for each purchased unit in the atomic statement'
);

create temporary table clean_ticket_identity on commit drop as
select id, issued_at
from public.tickets
where order_id = (select id from fulfillment_orders where kind = 'clean');

select results_eq(
  $$
    select value ->> 'order_status', (value ->> 'ticket_count')::bigint
    from (
      select pg_temp.record_and_fulfill(
        'integritycleanretry', 'integrityclean', id, session_id
      ) as value
      from fulfillment_orders
      where kind = 'clean'
    ) as retry
  $$,
  $$ values ('paid'::text, 3::bigint) $$,
  'a distinct duplicate payment event returns the complete existing ticket count'
);

select results_eq(
  $$
    select tickets.id, tickets.issued_at
    from public.tickets as tickets
    where tickets.order_id = (select id from fulfillment_orders where kind = 'clean')
    order by tickets.id
  $$,
  $$
    select identity.id, identity.issued_at
    from clean_ticket_identity as identity
    order by identity.id
  $$,
  'a complete-set retry preserves every ticket identity and issuance timestamp'
);

reset role;

update public.order_items
set ticket_tier_id = 'a6300000-0000-4000-8000-000000000004',
    tier_name = 'Alternate General Admission',
    tier_description = null,
    tier_version = 1
where order_id = (select id from fulfillment_orders where kind = 'snapshot')
  and ticket_tier_id = 'a6300000-0000-4000-8000-000000000001';

update public.ticket_tiers
set quantity_total = 12
where id = 'a6300000-0000-4000-8000-000000000001';

set local role service_role;

select results_eq(
  $$
    select value ->> 'order_status', (value ->> 'ticket_count')::bigint
    from (
      select pg_temp.record_and_fulfill(
        'integritysnapshot', 'integritysnapshot', id, session_id
      ) as value
      from fulfillment_orders where kind = 'snapshot'
    ) as mismatch
  $$,
  $$ values ('requires_review'::text, 0::bigint) $$,
  'a stable same-event same-priced tier substitution cannot fulfill the frozen cart'
);

select results_eq(
  $$
    select orders.status, orders.reconciliation_status, orders.failure_code,
      count(tickets.*)::bigint,
      receipts.processing_status, receipts.error_code
    from fulfillment_orders as fixture
    join public.orders as orders on orders.id = fixture.id
    join public.stripe_webhook_events as receipts
      on receipts.stripe_event_id = 'evt_integritysnapshot'
    left join public.tickets as tickets on tickets.order_id = orders.id
    where fixture.kind = 'snapshot'
    group by orders.id, receipts.stripe_event_id
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'TICKET_SET_MISMATCH'::text, 0::bigint,
    'processed'::text, 'TICKET_SET_MISMATCH'::text
  ) $$,
  'digest-bound item corruption records safe review state without admissions'
);

reset role;

create or replace function pg_temp.exercise_valid_ticket_lifecycle(
  p_input_status text,
  p_event_suffix text
)
returns table (
  input_status text,
  final_status text,
  reconciliation_status text,
  failure_code text,
  valid_ticket_count bigint,
  cancelled_ticket_count bigint,
  refunded_ticket_count bigint,
  receipt_error_code text,
  returned_status text,
  returned_ticket_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_session_id text;
  v_result jsonb;
begin
  select fixture.id, fixture.session_id
  into v_order_id, v_session_id
  from pg_temp.fulfillment_orders as fixture
  where fixture.kind = 'clean';

  update public.orders as orders
  set status = p_input_status,
      reconciliation_status = case
        when p_input_status = 'paid' then 'reconciled'
        when p_input_status = 'requires_review' then 'requires_review'
        else 'pending'
      end,
      failure_code = case
        when p_input_status = 'requires_review' then 'SYNTHETIC_REVIEW_STATE'
        else null
      end
  where orders.id = v_order_id;

  update public.tickets as tickets
  set status = 'valid',
      refunded_at = null,
      cancelled_at = null
  where tickets.order_id = v_order_id;

  v_result := pg_temp.record_and_fulfill(
    p_event_suffix,
    'integrityclean',
    v_order_id,
    v_session_id
  );

  return query
  select
    p_input_status,
    orders.status,
    orders.reconciliation_status,
    orders.failure_code,
    count(tickets.*) filter (where tickets.status = 'valid')::bigint,
    count(tickets.*) filter (where tickets.status = 'cancelled')::bigint,
    count(tickets.*) filter (where tickets.status = 'refunded')::bigint,
    receipts.error_code,
    v_result ->> 'order_status',
    (v_result ->> 'ticket_count')::bigint
  from public.orders as orders
  join public.stripe_webhook_events as receipts
    on receipts.stripe_event_id = 'evt_' || p_event_suffix
  left join public.tickets as tickets on tickets.order_id = orders.id
  where orders.id = v_order_id
  group by orders.id, receipts.stripe_event_id;
end;
$$;

create temporary table lifecycle_results (
  input_status text,
  final_status text,
  reconciliation_status text,
  failure_code text,
  valid_ticket_count bigint,
  cancelled_ticket_count bigint,
  refunded_ticket_count bigint,
  receipt_error_code text,
  returned_status text,
  returned_ticket_count bigint
) on commit drop;

insert into lifecycle_results
select * from pg_temp.exercise_valid_ticket_lifecycle(
  'requires_review', 'lifecyclereview'
);
insert into lifecycle_results
select * from pg_temp.exercise_valid_ticket_lifecycle(
  'partially_refunded', 'lifecyclepartial'
);
insert into lifecycle_results
select * from pg_temp.exercise_valid_ticket_lifecycle(
  'refunded', 'lifecyclerefunded'
);
insert into lifecycle_results
select * from pg_temp.exercise_valid_ticket_lifecycle(
  'expired', 'lifecycleexpired'
);
insert into lifecycle_results
select * from pg_temp.exercise_valid_ticket_lifecycle(
  'cancelled', 'lifecyclecancelled'
);
insert into lifecycle_results
select * from pg_temp.exercise_valid_ticket_lifecycle(
  'payment_failed', 'lifecyclefailed'
);

select results_eq(
  $$
    select input_status, final_status, reconciliation_status, failure_code,
      valid_ticket_count, cancelled_ticket_count, refunded_ticket_count,
      receipt_error_code,
      returned_status, returned_ticket_count
    from lifecycle_results
    order by input_status
  $$,
  $$ values
    (
      'cancelled'::text, 'requires_review'::text, 'requires_review'::text,
      'TICKET_SET_MISMATCH'::text, 0::bigint, 3::bigint, 0::bigint,
      'TICKET_SET_MISMATCH'::text, 'requires_review'::text, 3::bigint
    ),
    (
      'expired'::text, 'requires_review'::text, 'requires_review'::text,
      'TICKET_SET_MISMATCH'::text, 0::bigint, 3::bigint, 0::bigint,
      'TICKET_SET_MISMATCH'::text, 'requires_review'::text, 3::bigint
    ),
    (
      'partially_refunded'::text, 'requires_review'::text, 'requires_review'::text,
      'TICKET_SET_MISMATCH'::text, 0::bigint, 3::bigint, 0::bigint,
      'TICKET_SET_MISMATCH'::text, 'requires_review'::text, 3::bigint
    ),
    (
      'payment_failed'::text, 'requires_review'::text, 'requires_review'::text,
      'TICKET_SET_MISMATCH'::text, 0::bigint, 3::bigint, 0::bigint,
      'TICKET_SET_MISMATCH'::text, 'requires_review'::text, 3::bigint
    ),
    (
      'refunded'::text, 'refunded'::text, 'requires_review'::text,
      'TICKET_SET_MISMATCH'::text, 0::bigint, 0::bigint, 3::bigint,
      'TICKET_SET_MISMATCH'::text, 'refunded'::text, 3::bigint
    ),
    (
      'requires_review'::text, 'requires_review'::text, 'requires_review'::text,
      'TICKET_SET_MISMATCH'::text, 0::bigint, 3::bigint, 0::bigint,
      'TICKET_SET_MISMATCH'::text, 'requires_review'::text, 3::bigint
    )
  $$,
  'valid admissions are invalidated for every non-admitting order lifecycle state'
);

create temporary table lifecycle_cancelled_identity on commit drop as
select id, issued_at, cancelled_at
from public.tickets
where order_id = (select id from fulfillment_orders where kind = 'clean');
grant select on lifecycle_cancelled_identity to service_role;

set local role service_role;

select results_eq(
  $$
    select value ->> 'order_status', (value ->> 'ticket_count')::bigint
    from (
      select pg_temp.record_and_fulfill(
        'lifecycleidempotent', 'integrityclean', id, session_id
      ) as value
      from fulfillment_orders where kind = 'clean'
    ) as retry
  $$,
  $$ values ('requires_review'::text, 3::bigint) $$,
  'a lifecycle mismatch retry is a no-op over the invalidated exact ticket set'
);

select results_eq(
  $$
    select tickets.id, tickets.issued_at, tickets.cancelled_at,
      tickets.status, orders.failure_code
    from public.tickets as tickets
    join public.orders as orders on orders.id = tickets.order_id
    where tickets.order_id = (select id from fulfillment_orders where kind = 'clean')
    order by tickets.id
  $$,
  $$
    select identity.id, identity.issued_at, identity.cancelled_at,
      'cancelled'::text, 'TICKET_SET_MISMATCH'::text
    from lifecycle_cancelled_identity as identity
    order by identity.id
  $$,
  'lifecycle mismatch retry preserves ticket identity, issuance, and cancellation time'
);

insert into public.tickets (
  order_id, order_item_id, event_id, organizer_id, ticket_tier_id, unit_sequence
)
select
  orders.id, items.id, orders.event_id, orders.organizer_id,
  items.ticket_tier_id, 1
from fulfillment_orders as fixture
join public.orders as orders on orders.id = fixture.id
join public.order_items as items on items.order_id = orders.id
where fixture.kind = 'partial'
  and items.ticket_tier_id = 'a6300000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select value ->> 'order_status', (value ->> 'ticket_count')::bigint
    from (
      select pg_temp.record_and_fulfill(
        'integritypartial', 'integritypartial', id, session_id
      ) as value
      from fulfillment_orders where kind = 'partial'
    ) as mismatch
  $$,
  $$ values ('requires_review'::text, 1::bigint) $$,
  'a partial pre-existing ticket set routes to review without filling its gap'
);

select results_eq(
  $$
    select orders.status, orders.reconciliation_status, orders.failure_code,
      count(tickets.*)::bigint,
      count(tickets.*) filter (where tickets.status = 'cancelled')::bigint,
      receipts.processing_status, receipts.error_code
    from fulfillment_orders as fixture
    join public.orders as orders on orders.id = fixture.id
    join public.stripe_webhook_events as receipts
      on receipts.stripe_event_id = 'evt_integritypartial'
    left join public.tickets as tickets on tickets.order_id = orders.id
    where fixture.kind = 'partial'
    group by orders.id, receipts.stripe_event_id
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'TICKET_SET_MISMATCH'::text, 1::bigint, 1::bigint,
    'processed'::text, 'TICKET_SET_MISMATCH'::text
  ) $$,
  'partial ticket corruption is durable, non-admissible, and receipt-complete'
);

insert into public.tickets (
  order_id, order_item_id, event_id, organizer_id, ticket_tier_id, unit_sequence
)
select
  orders.id, items.id, orders.event_id, orders.organizer_id,
  items.ticket_tier_id, sequences.unit_sequence
from fulfillment_orders as fixture
join public.orders as orders on orders.id = fixture.id
join public.order_items as items on items.order_id = orders.id
cross join lateral generate_series(
  1,
  case
    when items.ticket_tier_id = 'a6300000-0000-4000-8000-000000000001' then 3
    else 1
  end
) as sequences(unit_sequence)
where fixture.kind = 'extra';

select results_eq(
  $$
    select value ->> 'order_status', (value ->> 'ticket_count')::bigint
    from (
      select pg_temp.record_and_fulfill(
        'integrityextra', 'integrityextra', id, session_id
      ) as value
      from fulfillment_orders where kind = 'extra'
    ) as mismatch
  $$,
  $$ values ('requires_review'::text, 4::bigint) $$,
  'an extra item-local sequence routes to review and creates zero tickets'
);

select results_eq(
  $$
    select status, reconciliation_status, failure_code,
      (select count(*) from public.tickets where order_id = orders.id)
    from public.orders as orders
    where orders.id = (select id from fulfillment_orders where kind = 'extra')
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'TICKET_SET_MISMATCH'::text, 4::bigint
  ) $$,
  'extra-sequence review preserves the observed corrupt set without opportunistic repair'
);

insert into public.tickets (
  order_id, order_item_id, event_id, organizer_id, ticket_tier_id, unit_sequence
)
select
  orders.id,
  ga.id,
  orders.event_id,
  orders.organizer_id,
  'a6300000-0000-4000-8000-000000000002'::uuid,
  1
from fulfillment_orders as fixture
join public.orders as orders on orders.id = fixture.id
join public.order_items as ga
  on ga.order_id = orders.id
  and ga.ticket_tier_id = 'a6300000-0000-4000-8000-000000000001'
where fixture.kind = 'refs'
union all
select
  orders.id,
  ga.id,
  'a6200000-0000-4000-8000-000000000002'::uuid,
  orders.organizer_id,
  ga.ticket_tier_id,
  2
from fulfillment_orders as fixture
join public.orders as orders on orders.id = fixture.id
join public.order_items as ga
  on ga.order_id = orders.id
  and ga.ticket_tier_id = 'a6300000-0000-4000-8000-000000000001'
where fixture.kind = 'refs'
union all
select
  orders.id,
  vip.id,
  orders.event_id,
  'a6100000-0000-4000-8000-000000000002'::uuid,
  vip.ticket_tier_id,
  1
from fulfillment_orders as fixture
join public.orders as orders on orders.id = fixture.id
join public.order_items as vip
  on vip.order_id = orders.id
  and vip.ticket_tier_id = 'a6300000-0000-4000-8000-000000000002'
where fixture.kind = 'refs';

select results_eq(
  $$
    select value ->> 'order_status', (value ->> 'ticket_count')::bigint
    from (
      select pg_temp.record_and_fulfill(
        'integrityrefs', 'integrityrefs', id, session_id
      ) as value
      from fulfillment_orders where kind = 'refs'
    ) as mismatch
  $$,
  $$ values ('requires_review'::text, 3::bigint) $$,
  'wrong parent tier, event, and organizer references route the complete-size set to review'
);

select results_eq(
  $$
    select status, reconciliation_status, failure_code,
      (select count(*) from public.tickets where order_id = orders.id),
      (select count(*) from public.tickets
        where order_id = orders.id and status = 'cancelled')
    from public.orders as orders
    where orders.id = (select id from fulfillment_orders where kind = 'refs')
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'TICKET_SET_MISMATCH'::text, 3::bigint, 3::bigint
  ) $$,
  'incoherent tickets remain the same cardinality and cannot remain valid admissions'
);

update public.order_items
set quantity = 2,
    subtotal_minor = 1998
where order_id = (select id from fulfillment_orders where kind = 'aggregate')
  and ticket_tier_id = 'a6300000-0000-4000-8000-000000000002';

select results_eq(
  $$
    select value ->> 'order_status', (value ->> 'ticket_count')::bigint
    from (
      select pg_temp.record_and_fulfill(
        'integrityaggregate', 'integrityaggregate', id, session_id
      ) as value
      from fulfillment_orders where kind = 'aggregate'
    ) as mismatch
  $$,
  $$ values ('requires_review'::text, 0::bigint) $$,
  'an order/item aggregate mismatch routes to review before any ticket generation'
);

select results_eq(
  $$
    select status, reconciliation_status, failure_code,
      (select count(*) from public.tickets where order_id = orders.id)
    from public.orders as orders
    where orders.id = (select id from fulfillment_orders where kind = 'aggregate')
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'TICKET_SET_MISMATCH'::text, 0::bigint
  ) $$,
  'aggregate corruption persists only safe review evidence and zero tickets'
);

reset role;

create or replace function pg_temp.reject_second_atomic_ticket()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id = (
      select fixture.id from pg_temp.fulfillment_orders as fixture
      where fixture.kind = 'atomic'
    )
    and new.ticket_tier_id = 'a6300000-0000-4000-8000-000000000001'::uuid
    and new.unit_sequence = 2 then
    raise exception using errcode = 'P0001', message = 'TEST_FORCED_TICKET_INSERT_FAILURE';
  end if;
  return new;
end;
$$;

create trigger checkout_integrity_reject_second_atomic_ticket
before insert on public.tickets
for each row execute function pg_temp.reject_second_atomic_ticket();

set local role service_role;

select * from public.server_record_webhook_receipt(
  'evt_integrityatomic', 'checkout.session.completed', false,
  'cs_test_integrityatomic', '2026-07-29.dahlia',
  '2026-09-02 12:00:00+00', repeat('a', 64)
);

select throws_ok(
  $$
    select pg_temp.record_and_fulfill(
      'integrityatomic', 'integrityatomic', id, session_id
    )
    from fulfillment_orders where kind = 'atomic'
  $$,
  'P0001', 'TEST_FORCED_TICKET_INSERT_FAILURE',
  'an exception during the multi-ticket insert aborts the whole fulfillment statement'
);

reset role;
drop trigger checkout_integrity_reject_second_atomic_ticket on public.tickets;
set local role service_role;

select results_eq(
  $$
    select orders.status, orders.paid_at, orders.stripe_payment_intent_id,
      orders.stripe_charge_id,
      (select count(*) from public.tickets where order_id = orders.id),
      receipts.processing_status, receipts.processed_at
    from fulfillment_orders as fixture
    join public.orders as orders on orders.id = fixture.id
    join public.stripe_webhook_events as receipts
      on receipts.stripe_event_id = 'evt_integrityatomic'
    where fixture.kind = 'atomic'
  $$,
  $$ values (
    'checkout_open'::text, null::timestamptz, null::text, null::text,
    0::bigint, 'processing'::text, null::timestamptz
  ) $$,
  'forced insert failure commits no ticket, paid transition, payment identity, or receipt completion'
);

create or replace function pg_temp.mark_checkout_review(
  p_order_id uuid,
  p_session_id text,
  p_event_id text,
  p_failure_code text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  execute '
    select public.server_mark_checkout_reconciliation_review($1, $2, $3, $4)
  ' into v_order_id using p_order_id, p_session_id, p_event_id, p_failure_code;
  return v_order_id;
exception when undefined_function then
  return null;
end;
$$;

select is(
  pg_temp.mark_checkout_review(
    (select id from fulfillment_orders where kind = 'atomic'),
    'cs_test_integrityatomic',
    'evt_integrityatomic',
    'CHECKOUT_LINE_COUNT_MISMATCH'
  ),
  (select id from fulfillment_orders where kind = 'atomic'),
  'a trusted order/session/event mismatch routes through the narrow review boundary'
);

select results_eq(
  $$
    select orders.status, orders.reconciliation_status, orders.failure_code,
      (select count(*) from public.tickets where order_id = orders.id),
      receipts.processing_status, receipts.error_code
    from fulfillment_orders as fixture
    join public.orders as orders on orders.id = fixture.id
    join public.stripe_webhook_events as receipts
      on receipts.stripe_event_id = 'evt_integrityatomic'
    where fixture.kind = 'atomic'
  $$,
  $$ values (
    'requires_review'::text, 'requires_review'::text,
    'CHECKOUT_LINE_COUNT_MISMATCH'::text, 0::bigint,
    'processed'::text, 'CHECKOUT_LINE_COUNT_MISMATCH'::text
  ) $$,
  'review routing stores only the safe code and issues no ticket'
);

reset role;
set local role anon;
select results_eq(
  $$
    select tier_item.value ->> 'id', tier_item.value ->> 'availability_status'
    from public.get_public_event_ticketing(
      'a6200000-0000-4000-8000-000000000001'
    ) as projection
    cross join lateral jsonb_array_elements(projection -> 'tiers') as tier_item(value)
    where tier_item.value ->> 'id' in (
      'a6300000-0000-4000-8000-000000000001',
      'a6300000-0000-4000-8000-000000000002',
      'a6300000-0000-4000-8000-000000000004'
    )
    order by tier_item.value ->> 'id'
  $$,
  $$ values
    ('a6300000-0000-4000-8000-000000000001'::text, 'sold_out'::text),
    ('a6300000-0000-4000-8000-000000000002'::text, 'sold_out'::text),
    ('a6300000-0000-4000-8000-000000000004'::text, 'sold_out'::text)
  $$,
  'paid, reviewed, and unresolved atomic orders keep every purchased unit committed'
);
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;

select is(
  (select checkout_creation_enabled from private.checkout_runtime_control where singleton),
  false,
  'the rollback-only suite restores the checkout creation gate to disabled'
);

select * from finish();
rollback;
