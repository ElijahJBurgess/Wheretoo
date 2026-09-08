begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
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

create function pg_temp.ticket_manifest(p_order_id uuid) returns jsonb language sql as $$
select jsonb_agg(jsonb_build_object('order_item_id', i.id, 'unit_sequence', s.n,
'admission_label', i.tier_name, 'credential_hash', encode(extensions.digest(i.id::text || ':' || s.n::text, 'sha256'), 'hex')) order by i.id, s.n)
from public.order_items i cross join lateral generate_series(1,i.quantity) s(n) where i.order_id=p_order_id;
$$;
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


reset role;
create function pg_temp.snapshot_after_tier_rename() returns text language plpgsql as $$
declare v_label text;
begin
  update public.ticket_tiers set name='Renamed Current Tier' where id='a6300000-0000-4000-8000-000000000001';
  select snapshot.order_items->0->>'tier_name' into v_label
  from public.server_get_checkout_integrity_order_snapshot((select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean') snapshot;
  raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return v_label;
end;
$$;
select is(pg_temp.snapshot_after_tier_rename(),'General Admission','snapshot label comes from purchased order_items after mutable tier rename');
set local role service_role;
select results_eq($$ select value->>'order_status', (value->>'ticket_count')::bigint from (
select pg_temp.record_and_fulfill('liteclean','liteclean',id,session_id) value from fulfillment_orders where kind='clean') q $$,
$$ values ('paid'::text,3::bigint) $$,'two GA plus one VIP issue exactly three paid tickets');
select results_eq($$ select admission_label, count(*), count(distinct credential_hash), bool_and(octet_length(credential_hash)=32)
from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') group by admission_label order by admission_label $$,
$$ values ('General Admission'::text,2::bigint,2::bigint,true),('VIP'::text,1::bigint,1::bigint,true) $$,'ticket labels and unique hashes match each purchased unit');
create temp table original_tickets as select * from public.tickets where order_id=(select id from fulfillment_orders where kind='clean');
select is(pg_temp.record_and_fulfill('literetry','liteclean',(select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean')->>'order_status','paid','duplicate fulfillment stays paid');
select results_eq($$ select id, issued_at, credential_hash from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') order by id $$,
$$ select id, issued_at, credential_hash from original_tickets order by id $$,'retry preserves every identity and hash');
update public.tickets set status='used', used_at=statement_timestamp() where id=(select id from original_tickets order by id limit 1);
create temp table used_identity as select id,used_at from public.tickets where status='used';
select is(pg_temp.record_and_fulfill('liteused','liteclean',(select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean')->>'order_status','paid','paid retry after check-in remains paid');
select results_eq($$ select status,count(*) from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') group by status order by status $$,
$$ values ('used'::text,1::bigint),('valid'::text,2::bigint) $$,'used plus valid admission set survives duplicate paid webhook');
select results_eq($$ select id,used_at from public.tickets where status='used' $$,$$ select id,used_at from used_identity $$,'retry retains original use timestamp');

-- Every malformed entry fails before any paid/ticket/receipt mutation.
create function pg_temp.reject_manifest(p_manifest jsonb) returns text language plpgsql as $$
begin
  perform pg_temp.record_and_fulfill('liteinvalid','liteinvalid',(select id from fulfillment_orders where kind='atomic'),'cs_test_integrityatomic',p_manifest);
  return 'ACCEPTED';
exception when others then return sqlerrm;
end;
$$;
select is(pg_temp.reject_manifest(null),'TICKET_MANIFEST_INVALID','null manifest rejected');
select is(pg_temp.reject_manifest('{}'::jsonb),'TICKET_MANIFEST_INVALID','non-array manifest rejected');
select is(pg_temp.reject_manifest('[]'::jsonb),'TICKET_MANIFEST_INVALID','missing units rejected');
select is(pg_temp.reject_manifest(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')) || '[{}]'::jsonb),'TICKET_MANIFEST_INVALID','extra entry rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{1}',pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic'))->0)),'TICKET_MANIFEST_INVALID','duplicate source rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,admission_label}','"Wrong"')),'TICKET_MANIFEST_INVALID','snapshot label mismatch rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,unit_sequence}','"1"')),'TICKET_MANIFEST_INVALID','string sequence rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,credential_hash}','"AB"')),'TICKET_MANIFEST_INVALID','malformed hash rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,extra}','true')),'TICKET_MANIFEST_INVALID','unexpected key rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,credential_hash}',pg_temp.ticket_manifest((select id from fulfillment_orders where kind='clean'))->0->'credential_hash')),'TICKET_MANIFEST_INVALID','cross-order hash collision rejected');
select results_eq($$ select status,paid_at,(select count(*) from public.tickets where order_id=o.id) from public.orders o where id=(select id from fulfillment_orders where kind='atomic') $$,
$$ values ('checkout_open'::text,null::timestamptz,0::bigint) $$,'invalid manifests leave no partial paid state or tickets');


select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,order_item_id}','"ffffffff-ffff-4fff-8fff-ffffffffffff"')),'TICKET_MANIFEST_INVALID','unknown order item rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,unit_sequence}','3')),'TICKET_MANIFEST_INVALID','out-of-range source unit rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,unit_sequence}','1.0')),'TICKET_MANIFEST_INVALID','noncanonical decimal sequence rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,admission_label}','12')),'TICKET_MANIFEST_INVALID','non-string label rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,credential_hash}',to_jsonb(repeat('A',64)))),'TICKET_MANIFEST_INVALID','uppercase 64-hex rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{1,credential_hash}',pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic'))->0->'credential_hash')),'TICKET_MANIFEST_INVALID','duplicate manifest hashes rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0}','null')),'TICKET_MANIFEST_INVALID','null manifest entry rejected');
select is(pg_temp.reject_manifest((pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')) #- '{0,credential_hash}')),'TICKET_MANIFEST_INVALID','missing required key rejected');
select is((select count(*) from public.stripe_webhook_events where stripe_event_id='evt_liteinvalid'),0::bigint,'invalid manifest rolls back its receipt creation');

reset role;
-- Elevated corruption probes roll their complete mutations back after observing review.
create function pg_temp.probe_ticket_corruption(p_assignment text) returns text language plpgsql as $$
declare v_result text;
begin
  alter table public.tickets disable trigger tickets_identity_and_transition;
  execute format('update public.tickets set %s where id=(select id from public.tickets where status=''valid'' and order_id=(select id from fulfillment_orders where kind=''clean'') order by id limit 1)',p_assignment);
  alter table public.tickets enable trigger tickets_identity_and_transition;
  v_result := pg_temp.record_and_fulfill('litecorrupt','liteclean',(select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean')->>'order_status';
  if (select count(*) from public.tickets where order_id=(select id from fulfillment_orders where kind='clean')) <> 3
     or exists(select 1 from used_identity u left join public.tickets t on t.id=u.id where t.status is distinct from 'used' or t.used_at is distinct from u.used_at) then
    v_result := 'HISTORY_CHANGED';
  end if;
  raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return v_result;
end;
$$;
select is(pg_temp.probe_ticket_corruption($$admission_label='Wrong Label'$$),'requires_review','persisted label mismatch reviews without repair or loss of used history');
select is(pg_temp.probe_ticket_corruption($$credential_hash=extensions.digest('wrong-persisted-hash','sha256')$$),'requires_review','persisted hash mismatch reviews without repair or loss of used history');
select is(pg_temp.probe_ticket_corruption($$status='cancelled',cancelled_at=statement_timestamp()$$),'requires_review','unexplained cancelled ticket under published paid order reviews');
select is(pg_temp.probe_ticket_corruption($$status='refunded',refunded_at=statement_timestamp()$$),'requires_review','unexplained refunded ticket under published paid order reviews');

select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
update public.events set status='cancelled' where id='a6200000-0000-4000-8000-000000000001';
-- Task 5 owns the cancellation API. Arrange its stipulated coherent state here.
update public.tickets set status='cancelled',cancelled_at=statement_timestamp()
where order_id=(select id from fulfillment_orders where kind='clean') and status='valid';
reset role;
set local role service_role;
select is(pg_temp.record_and_fulfill('litecancelled','liteclean',(select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean')->>'order_status','paid','coherent owning-event cancellation preserves paid duplicate reconciliation');
select results_eq($$ select status,count(*) from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') group by status order by status $$,
$$ values ('cancelled'::text,2::bigint),('used'::text,1::bigint) $$,'event cancellation and paid retry preserve used history');
select results_eq($$ select id,used_at from public.tickets where status='used' $$,$$ select id,used_at from used_identity $$,'cancellation never erases original use time');
reset role;
select * from finish();
rollback;
