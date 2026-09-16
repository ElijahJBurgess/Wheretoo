begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  to_regprocedure(
    'public.list_organizer_event_orders_filtered(uuid,text,text,integer,timestamp with time zone,uuid)'
  ) is not null,
  'the additive status-filtered organizer order list exists without overloading the old RPC'
);
select ok(
  to_regprocedure('public.get_organizer_order_v2(uuid,uuid)') is not null,
  'the additive money-snapshot organizer detail exists under a distinct name'
);
select is(
  (
    select count(*)
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'list_organizer_event_orders'
  ),
  1::bigint,
  'the original list RPC retains one unambiguous signature'
);
select is(
  (
    select count(*)
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'get_organizer_order'
  ),
  1::bigint,
  'the original detail RPC retains one unambiguous signature'
);

\ir helpers/core_ticket_truth_lite_setup.inc

-- A dedicated paid event keeps the approved $85 lifecycle fixture independent
-- from the mixed-state pagination fixtures supplied by the shared helper.
reset role;
grant select on fulfillment_orders to authenticated;
insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  'a6210000-0000-4000-8000-000000000001',
  'a6100000-0000-4000-8000-000000000001',
  'draft', 'clear', 'Spec04 $85 Event',
  'Rollback-only organizer read proof using real immutable unit snapshots.',
  'community', now() + interval '4 days', now() + interval '4 days 2 hours',
  'Snapshot Hall', '85 Snapshot Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.spec04-organizer-reads', 37.7938, -122.3957, 'paid', null
), (
  'a6210000-0000-4000-8000-000000000002',
  'a6100000-0000-4000-8000-000000000001',
  'draft', 'clear', 'Spec04 Free Guard',
  'Rollback-only free event proving the paid-only organizer operations guard.',
  'community', now() + interval '5 days', now() + interval '5 days 2 hours',
  'Free Hall', '1 Free Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.spec04-free-guard', 37.7939, -122.3956, 'free', null
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  (
    'a6310000-0000-4000-8000-000000000001',
    'a6210000-0000-4000-8000-000000000001',
    'General Admission', 2000, 'usd', 2, 'active', 1
  ),
  (
    'a6310000-0000-4000-8000-000000000002',
    'a6210000-0000-4000-8000-000000000001',
    'VIP', 4500, 'usd', 1, 'active', 2
  );

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  'a6210000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);

select set_config('request.jwt.claim.sub', 'a6100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.accept_current_event_policies('a6210000-0000-4000-8000-000000000001');
select public.publish_event('a6210000-0000-4000-8000-000000000001');
reset role;

create temporary table spec04_order_ids (
  kind text primary key,
  id uuid not null,
  session_id text not null
) on commit drop;
grant select on spec04_order_ids to authenticated;
grant all on spec04_order_ids to service_role;

create function pg_temp.create_spec04_order()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  select reservation.order_id into v_order_id
  from public.server_reserve_checkout(
    'a6210000-0000-4000-8000-000000000001',
    '[{"tier_id":"a6310000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"a6310000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    'Literal % underscore_ slash\ Buyer',
    'literal-specials@example.invalid',
    'a6410000-0000-4000-8000-000000000001',
    repeat('8', 64)
  ) as reservation;

  perform public.server_attach_checkout_session(
    v_order_id,
    'cs_test_spec04reads85',
    (select orders.checkout_expires_at from public.orders where orders.id = v_order_id)
  );
  return v_order_id;
end;
$$;

set local role service_role;
insert into spec04_order_ids (kind, id, session_id)
values ('lifecycle85', pg_temp.create_spec04_order(), 'cs_test_spec04reads85');
reset role;

create function pg_temp.spec04_metrics()
returns jsonb language sql as $$
  select public.get_organizer_event_metrics('a6210000-0000-4000-8000-000000000001');
$$;
create function pg_temp.spec04_list(
  p_search text default '',
  p_status text default 'all',
  p_limit integer default 25,
  p_time timestamptz default null,
  p_id uuid default null
) returns jsonb language sql as $$
  select public.list_organizer_event_orders_filtered(
    'a6210000-0000-4000-8000-000000000001',
    p_search, p_status, p_limit, p_time, p_id
  );
$$;
create function pg_temp.spec04_old_detail(p_id uuid)
returns jsonb language sql as $$
  select public.get_organizer_order(
    'a6210000-0000-4000-8000-000000000001', p_id
  );
$$;
create function pg_temp.spec04_detail(p_id uuid)
returns jsonb language sql as $$
  select public.get_organizer_order_v2(
    'a6210000-0000-4000-8000-000000000001', p_id
  );
$$;

set local role authenticated;
select is(pg_temp.spec04_metrics()->>'grossSalesMinor', '0', 'an open $85 checkout is not historical gross');
select is(pg_temp.spec04_metrics()->>'sold', '0', 'an open $85 checkout is not a sold admission');
select is(pg_temp.spec04_metrics()->>'orderCount', '0', 'an open $85 checkout is not a successful order');
select is(pg_temp.spec04_metrics()->>'issued', '0', 'an open $85 checkout has no issued admissions');
select is(pg_temp.spec04_metrics()->'tiers'->0->>'remaining', '0', 'the open two-GA hold commits both GA units');
select is(pg_temp.spec04_metrics()->'tiers'->1->>'remaining', '0', 'the open one-VIP hold commits the VIP unit');
reset role;

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_spec04reads85', 'checkout.session.completed', false,
  'cs_test_spec04reads85', '2026-07-29.dahlia',
  '2026-09-11 01:00:00+00', repeat('a', 64)
);
select * from public.server_fulfill_paid_order(
  'evt_spec04reads85',
  (select id from spec04_order_ids where kind = 'lifecycle85'),
  'cs_test_spec04reads85', 'pi_spec04reads85', 'ch_spec04reads85',
  'tr_spec04reads85', 'fee_spec04reads85', 'txn_spec04reads85',
  'cus_spec04reads85', 'payment', 'paid', 'usd',
  8500, 8500, 575, 'acct_integrityfulfillment',
  pg_temp.ticket_manifest((select id from spec04_order_ids where kind = 'lifecycle85'))
);
reset role;

set local role authenticated;
select is(pg_temp.spec04_metrics()->>'grossSalesMinor', '8500', 'fulfillment records exactly $85 historical gross');
select is(pg_temp.spec04_metrics()->>'sold', '3', 'fulfillment records two GA plus one VIP sold');
select is(pg_temp.spec04_metrics()->>'orderCount', '1', 'the three admissions remain one successful order');
select is(pg_temp.spec04_metrics()->>'issued', '3', 'fulfillment issues three real ticket rows');
select is(pg_temp.spec04_metrics()->>'checkedIn', '0', 'no admission is counted before use');
select is(pg_temp.spec04_detail((select id from spec04_order_ids where kind = 'lifecycle85'))->>'subtotalMinor', '8500', 'v2 detail exposes the immutable order subtotal');
select is(pg_temp.spec04_detail((select id from spec04_order_ids where kind = 'lifecycle85'))->>'taxMinor', '0', 'v2 detail exposes the immutable order tax');
select is(
  (select item->>'unitAmountMinor' from jsonb_array_elements(
    pg_temp.spec04_detail((select id from spec04_order_ids where kind = 'lifecycle85'))->'items'
  ) item where item->>'tierName' = 'General Admission'),
  '2000',
  'v2 detail exposes the real $20 GA unit snapshot'
);
select is(
  (select item->>'subtotalMinor' from jsonb_array_elements(
    pg_temp.spec04_detail((select id from spec04_order_ids where kind = 'lifecycle85'))->'items'
  ) item where item->>'tierName' = 'VIP'),
  '4500',
  'v2 detail preserves the real $45 VIP subtotal snapshot'
);
with documents as (
  select
    pg_temp.spec04_old_detail((select id from spec04_order_ids where kind = 'lifecycle85')) as old_detail,
    pg_temp.spec04_detail((select id from spec04_order_ids where kind = 'lifecycle85')) as v2_detail
), compatible_v2 as (
  select
    (v2_detail - 'subtotalMinor' - 'taxMinor') || jsonb_build_object(
      'items',
      (
        select jsonb_agg(item.value - 'unitAmountMinor' order by item.ordinality)
        from jsonb_array_elements(v2_detail->'items') with ordinality as item(value, ordinality)
      )
    ) as detail,
    old_detail
  from documents
)
select is(detail, old_detail, 'removing only the additive money fields reproduces the exact old detail')
from compatible_v2;
select is(jsonb_array_length(pg_temp.spec04_list('%')->'orders'), 1, 'percent is a literal search character');
select is(jsonb_array_length(pg_temp.spec04_list('_')->'orders'), 1, 'underscore is a literal search character');
select is(jsonb_array_length(pg_temp.spec04_list('\')->'orders'), 1, 'backslash is a literal search character');
select is(jsonb_array_length(pg_temp.spec04_list('', 'paid')->'orders'), 1, 'paid filter returns the fulfilled $85 order');
select is(jsonb_array_length(pg_temp.spec04_list('', 'refunded')->'orders'), 0, 'refunded filter excludes a currently paid order');
select throws_ok(
  $$select pg_temp.spec04_list('', 'PAID')$$,
  '22023', 'Invalid order query',
  'status validation is exact and case-sensitive'
);
select throws_ok(
  $$select pg_temp.spec04_list('', null)$$,
  '22023', 'Invalid order query',
  'null status is rejected rather than broadening the query'
);

reset role;
create temporary table spec04_used_ticket as
select id, used_at from public.tickets
where order_id = (select id from spec04_order_ids where kind = 'lifecycle85')
order by order_item_id, unit_sequence
limit 1;
grant select on spec04_used_ticket to authenticated;

set local role authenticated;
select is(
  public.redeem_owned_ticket(
    'a6210000-0000-4000-8000-000000000001',
    (select id from spec04_used_ticket)
  )->>'outcome',
  'admitted',
  'one real admission is atomically used'
);
reset role;
update spec04_used_ticket
set used_at = (select tickets.used_at from public.tickets where tickets.id = spec04_used_ticket.id);
set local role authenticated;
select is(pg_temp.spec04_metrics()->>'checkedIn', '1', 'one of three issued admissions is checked in');
reset role;

set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_spec04readsrefund', 'refund.updated', false,
  're_spec04reads85', '2026-07-29.dahlia',
  '2026-09-11 01:05:00+00', repeat('b', 64)
);
select refund.*
from public.orders as orders
cross join lateral public.server_apply_verified_refund(
  'evt_spec04readsrefund', orders.id, 're_spec04reads85',
  orders.stripe_payment_intent_id, orders.stripe_charge_id,
  'trr_spec04reads85', 'fr_spec04reads85', 8500, 'usd', 'succeeded',
  'requested_by_customer', true, true, 8500, 575, true, null
) as refund
where orders.id = (select id from spec04_order_ids where kind = 'lifecycle85');
reset role;

set local role authenticated;
select is(pg_temp.spec04_metrics()->>'grossSalesMinor', '8500', 'refund preserves the original $85 historical gross');
select is(pg_temp.spec04_metrics()->>'sold', '3', 'refund preserves all three historically sold units');
select is(pg_temp.spec04_metrics()->>'orderCount', '1', 'refund preserves the successful order count');
select is(pg_temp.spec04_metrics()->>'issued', '3', 'refund preserves the three-ticket denominator');
select is(pg_temp.spec04_metrics()->>'checkedIn', '1', 'refund preserves one checked-in admission');
select is(pg_temp.spec04_metrics()->'tiers'->0->>'remaining', '2', 'refund separately releases both GA commitments');
select is(pg_temp.spec04_metrics()->'tiers'->1->>'remaining', '1', 'refund separately releases the VIP commitment');
reset role;
select is(
  (select tickets.used_at from public.tickets join spec04_used_ticket using (id)),
  (select used_at from spec04_used_ticket),
  'refund leaves the admitted ticket timestamp unchanged'
);
set local role authenticated;
select is(pg_temp.spec04_detail((select id from spec04_order_ids where kind = 'lifecycle85'))->>'refundState', 'refunded', 'v2 detail uses canonical refunded state');
select is(
  pg_temp.spec04_detail((select id from spec04_order_ids where kind = 'lifecycle85'))->'tickets',
  pg_temp.spec04_old_detail((select id from spec04_order_ids where kind = 'lifecycle85'))->'tickets',
  'v2 preserves the exact old ticket ordering and ticket projection'
);
select is(
  (select string_agg(ticket->>'status', ',' order by ticket->>'status')
   from jsonb_array_elements(pg_temp.spec04_detail(
     (select id from spec04_order_ids where kind = 'lifecycle85')
   )->'tickets') ticket),
  'refunded,refunded,used',
  'whole-order refund leaves one used and two refunded ticket truths'
);
select ok(
  not (pg_temp.spec04_detail((select id from spec04_order_ids where kind = 'lifecycle85'))::text
    ~ 'credential|confirmation|stripe_|reservation|organizer_id|paymentIntent|chargeId'),
  'v2 detail exposes no credential, bearer, owner, or provider secret material'
);
reset role;

-- Build every canonical order status on the shared paid event. Two paid rows
-- deliberately share a timestamp with all mixed states for filtered keyset proof.
set local session_replication_role = replica;
update public.ticket_tiers set quantity_total = 50
where event_id = 'a6200000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
set local role service_role;
insert into fulfillment_orders (kind, id, session_id) values
  ('status_partial', pg_temp.create_multi_item_order('a6400000-0000-4000-8000-000000000101', repeat('a', 64), 'cs_test_statuspartial'), 'cs_test_statuspartial'),
  ('status_refunded', pg_temp.create_multi_item_order('a6400000-0000-4000-8000-000000000102', repeat('b', 64), 'cs_test_statusrefunded'), 'cs_test_statusrefunded'),
  ('status_review', pg_temp.create_multi_item_order('a6400000-0000-4000-8000-000000000103', repeat('c', 64), 'cs_test_statusreview'), 'cs_test_statusreview'),
  ('paid_page', pg_temp.create_multi_item_order('a6400000-0000-4000-8000-000000000104', repeat('d', 64), 'cs_test_paidpage'), 'cs_test_paidpage');
select pg_temp.record_and_fulfill('spec04clean', 'spec04clean', id, session_id)
from fulfillment_orders where kind = 'clean';
select pg_temp.record_and_fulfill('spec04paidpage', 'spec04paidpage', id, session_id)
from fulfillment_orders where kind = 'paid_page';
reset role;

set local session_replication_role = replica;
update public.orders set
  status = case client_request_id
    when 'a6400000-0000-4000-8000-000000000002' then 'creating_checkout'
    when 'a6400000-0000-4000-8000-000000000003' then 'checkout_open'
    when 'a6400000-0000-4000-8000-000000000004' then 'payment_processing'
    when 'a6400000-0000-4000-8000-000000000005' then 'expired'
    when 'a6400000-0000-4000-8000-000000000006' then 'payment_failed'
    when 'a6400000-0000-4000-8000-000000000007' then 'cancelled'
    when 'a6400000-0000-4000-8000-000000000101' then 'partially_refunded'
    when 'a6400000-0000-4000-8000-000000000102' then 'refunded'
    when 'a6400000-0000-4000-8000-000000000103' then 'requires_review'
    else status
  end,
  expired_at = case when client_request_id = 'a6400000-0000-4000-8000-000000000005' then now() else expired_at end,
  failed_at = case when client_request_id in (
    'a6400000-0000-4000-8000-000000000006',
    'a6400000-0000-4000-8000-000000000007'
  ) then now() else failed_at end,
  refunded_at = case when client_request_id = 'a6400000-0000-4000-8000-000000000102' then now() else refunded_at end,
  created_at = '2026-09-11 02:00:00+00'
where event_id = 'a6200000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

create function pg_temp.mixed_list(
  p_status text default 'all',
  p_limit integer default 50,
  p_time timestamptz default null,
  p_id uuid default null
) returns jsonb language sql as $$
  select public.list_organizer_event_orders_filtered(
    'a6200000-0000-4000-8000-000000000001', '', p_status, p_limit, p_time, p_id
  );
$$;
create function pg_temp.old_mixed_list()
returns jsonb language sql as $$
  select public.list_organizer_event_orders(
    'a6200000-0000-4000-8000-000000000001', '', 50, null, null
  );
$$;

set local role authenticated;
select is(
  (select string_agg(distinct order_row->>'status', ',' order by order_row->>'status')
   from jsonb_array_elements(pg_temp.mixed_list()->'orders') order_row),
  'cancelled,checkout_open,creating_checkout,expired,paid,partially_refunded,payment_failed,payment_processing,refunded,requires_review',
  'all includes every canonical historical order status'
);
select is(pg_temp.mixed_list(), pg_temp.old_mixed_list(), 'all returns the exact existing list response and order');
select is(jsonb_array_length(pg_temp.mixed_list('paid')->'orders'), 2, 'paid filter excludes every mixed non-paid row');
select is(jsonb_array_length(pg_temp.mixed_list('refunded')->'orders'), 1, 'refunded filter returns only the canonical refunded row');

create temporary table spec04_paid_pages as
with first_page as (
  select pg_temp.mixed_list('paid', 1) as page
), second_page as (
  select pg_temp.mixed_list(
    'paid', 1,
    (page->'nextCursor'->>'createdAt')::timestamptz,
    (page->'nextCursor'->>'id')::uuid
  ) as page from first_page
)
select jsonb_array_elements(first_page.page->'orders')->>'id' as id from first_page
union all
select jsonb_array_elements(second_page.page->'orders')->>'id' from second_page;
select is((select count(*) from spec04_paid_pages), 2::bigint, 'filtered pagination loses no paid row among mixed same-time rows');
select is((select count(distinct id) from spec04_paid_pages), 2::bigint, 'filtered pagination duplicates no paid row sharing a timestamp');
reset role;

-- The final integrated refund helper upgrades organizer_refund_state to expose
-- its one approved recovery state. V2 must preserve that exact shared result.
set local role service_role;
select * from public.server_record_webhook_receipt(
  'evt_spec04recovery', 'refund.updated', false,
  're_spec04recovery', '2026-07-29.dahlia', now(), repeat('c', 64)
);
select refund.*
from public.orders as orders
cross join lateral public.server_apply_verified_refund(
  'evt_spec04recovery', orders.id, 're_spec04recovery',
  orders.stripe_payment_intent_id, orders.stripe_charge_id,
  'trr_spec04recovery', 'fr_spec04recovery', 3001, 'usd', 'succeeded',
  'requested_by_customer', true, true, 3001, 300, false,
  'REFUND_POLICY_MISMATCH'
) as refund
where orders.id = (select id from fulfillment_orders where kind = 'clean');
reset role;

set local role authenticated;
select is(
  public.get_organizer_order_v2(
    'a6200000-0000-4000-8000-000000000001',
    (select id from fulfillment_orders where kind = 'clean')
  )->>'refundState',
  'recoverable',
  'v2 preserves the canonical recovery state'
);
select is(
  public.get_organizer_order_v2(
    'a6200000-0000-4000-8000-000000000001',
    (select id from fulfillment_orders where kind = 'clean')
  )->>'refundState',
  public.get_organizer_order(
    'a6200000-0000-4000-8000-000000000001',
    (select id from fulfillment_orders where kind = 'clean')
  )->>'refundState',
  'v2 refund state remains identical to the old detail contract'
);
select throws_ok(
  $$select public.list_organizer_event_orders_filtered(
    'a6210000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'Event unavailable',
  'the filtered list rejects owned free events'
);
select throws_ok(
  $$select public.get_organizer_order_v2(
    'a6210000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000000'
  )$$,
  '42501', 'Event unavailable',
  'v2 detail rejects owned free events before order lookup'
);
reset role;

alter table public.orders drop constraint orders_test_mode_check;
create function pg_temp.probe_livemode_guard()
returns jsonb language plpgsql as $$
begin
  set local session_replication_role = replica;
  update public.orders set livemode = true
  where id = (select id from spec04_order_ids where kind = 'lifecycle85');
  set local session_replication_role = origin;
  return public.get_organizer_order_v2(
    'a6210000-0000-4000-8000-000000000001',
    (select id from spec04_order_ids where kind = 'lifecycle85')
  );
exception when others then
  set local session_replication_role = origin;
  raise;
end;
$$;
select throws_ok(
  $$select pg_temp.probe_livemode_guard()$$,
  'P0001', 'Operations data unavailable',
  'v2 detail fails closed if a non-test order reaches the test-only database'
);

alter table public.orders drop constraint orders_currency_check;
create function pg_temp.probe_currency_guard()
returns jsonb language plpgsql as $$
begin
  set local session_replication_role = replica;
  update public.orders set currency = 'eur'
  where id = (select id from spec04_order_ids where kind = 'lifecycle85');
  set local session_replication_role = origin;
  return public.list_organizer_event_orders_filtered(
    'a6210000-0000-4000-8000-000000000001'
  );
exception when others then
  set local session_replication_role = origin;
  raise;
end;
$$;
select throws_ok(
  $$select pg_temp.probe_currency_guard()$$,
  'P0001', 'Operations data unavailable',
  'filtered list fails closed on a non-USD order'
);

select set_config('request.jwt.claim.sub', 'a6100000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.list_organizer_event_orders_filtered(
    'a6210000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'Event unavailable',
  'another organizer cannot list buyer PII'
);
select throws_ok(
  $$select public.get_organizer_order_v2(
    'a6210000-0000-4000-8000-000000000001',
    (select id from spec04_order_ids where kind = 'lifecycle85')
  )$$,
  '42501', 'Event unavailable',
  'another organizer cannot read v2 detail'
);
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok(
  $$select public.list_organizer_event_orders_filtered(
    'a6210000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'Event unavailable',
  'missing authenticated identity is denied'
);
reset role;

select ok(
  not has_function_privilege(
    'anon',
    'public.list_organizer_event_orders_filtered(uuid,text,text,integer,timestamptz,uuid)',
    'execute'
  ),
  'anonymous callers cannot execute the filtered list'
);
select ok(
  not has_function_privilege('anon', 'public.get_organizer_order_v2(uuid,uuid)', 'execute'),
  'anonymous callers cannot execute v2 detail'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.list_organizer_event_orders_filtered(uuid,text,text,integer,timestamptz,uuid)',
    'execute'
  ),
  'service-role callers cannot bypass the authenticated owner list boundary'
);
select ok(
  not has_function_privilege('service_role', 'public.get_organizer_order_v2(uuid,uuid)', 'execute'),
  'service-role callers cannot bypass the authenticated owner detail boundary'
);
select ok(not has_table_privilege('authenticated', 'public.orders', 'select'), 'orders remain unreadable directly');
select ok(not has_table_privilege('authenticated', 'public.order_items', 'select'), 'order items remain unreadable directly');
select ok(not has_table_privilege('authenticated', 'public.tickets', 'select'), 'tickets remain unreadable directly');

select * from finish();
rollback;
