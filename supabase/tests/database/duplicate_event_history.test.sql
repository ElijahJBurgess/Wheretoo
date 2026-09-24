-- All fixture grants/data are rollback-only; production ACLs are not modified.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- The older fulfillment fixture reads orders directly as service_role.
grant select on public.orders to service_role;
\ir helpers/core_ticket_truth_lite_setup.inc
reset role;
create temp table reusable_before_sale as select private.event_duplicate_configuration('a6200000-0000-4000-8000-000000000001') config;
select pg_temp.record_and_fulfill('duplicatepaid','duplicatepaid',id,session_id) from fulfillment_orders where kind='clean';
select pg_temp.record_and_fulfill('duplicaterefund','duplicaterefund',id,session_id) from fulfillment_orders where kind='partial';
select * from public.server_redeem_organizer_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select credential_hash from tickets where order_id=(select id from fulfillment_orders where kind='clean') limit 1));
select * from public.server_record_webhook_receipt('evt_duplicaterefundreceipt','refund.updated',false,'re_duplicate','2026-07-29.dahlia',now(),repeat('a',64));
select * from public.server_apply_verified_refund('evt_duplicaterefundreceipt',(select id from fulfillment_orders where kind='partial'),'re_duplicate','pi_duplicaterefund','ch_duplicaterefund','trr_duplicate','fr_duplicate',3001,'usd','succeeded','requested_by_customer',true,true,3001,300,true,null);
select is(private.event_duplicate_configuration('a6200000-0000-4000-8000-000000000001'),(select config from reusable_before_sale),'sales/refunds/check-ins do not invalidate reusable fingerprint');
create temp table source_event_before as select to_jsonb(e) data from events e where id='a6200000-0000-4000-8000-000000000001';
create temp table history_before as select
 (select jsonb_agg(to_jsonb(x) order by id) from orders x where event_id='a6200000-0000-4000-8000-000000000001') orders,
 (select jsonb_agg(to_jsonb(x) order by id) from tickets x where event_id='a6200000-0000-4000-8000-000000000001') tickets;
select ok((select count(*)>0 from tickets where event_id='a6200000-0000-4000-8000-000000000001' and status='used'),'source has real check-in');
select ok((select count(*)>0 from tickets where event_id='a6200000-0000-4000-8000-000000000001' and status='refunded'),'source has refunded admissions');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.duplicate_owned_event('a6200000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000001',public.get_owned_event_duplicate_context('a6200000-0000-4000-8000-000000000001')->>'fingerprint');
reset role;
select is((select to_jsonb(e) from events e where id='a6200000-0000-4000-8000-000000000001'),(select data from source_event_before),'complete source event row unchanged');
select is((select count(*) from orders where event_id='dd200000-0000-4000-8000-000000000001'),0::bigint,'no paid orders inherited');
select is((select count(*) from tickets where event_id='dd200000-0000-4000-8000-000000000001'),0::bigint,'no issued/refunded/used tickets or QR credentials inherited');
select is((select jsonb_agg(to_jsonb(x) order by id) from orders x where event_id='a6200000-0000-4000-8000-000000000001'),(select orders from history_before),'source reservations/payments/refunds unchanged');
select is((select jsonb_agg(to_jsonb(x) order by id) from tickets x where event_id='a6200000-0000-4000-8000-000000000001'),(select tickets from history_before),'source ticket identities/credentials/check-ins unchanged');
select is((select count(*) from order_items where ticket_tier_id in (select id from ticket_tiers where event_id='dd200000-0000-4000-8000-000000000001')),0::bigint,'new tiers have zero reservations/sales');
select results_eq($$select name,description,unit_amount_minor,currency,quantity_total,sort_order from ticket_tiers where event_id='dd200000-0000-4000-8000-000000000001' order by sort_order$$,$$select name,description,unit_amount_minor,currency,quantity_total,sort_order from ticket_tiers where event_id='a6200000-0000-4000-8000-000000000001' order by sort_order$$,'full configured tier quantities/prices survive populated sales');
\ir free_registration_fixture.inc
select pg_temp.register(1);
select * from public.server_redeem_organizer_ticket('b6100000-0000-4000-8000-000000000001','b6200000-0000-4000-8000-000000000001',digest('1:1','sha256'));
create temp table free_before as select jsonb_agg(to_jsonb(x) order by id) data from free_registrations x where event_id='b6200000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.duplicate_owned_event('b6200000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000002',public.get_owned_event_duplicate_context('b6200000-0000-4000-8000-000000000001')->>'fingerprint');
reset role;
select is((select count(*) from free_registrations where event_id='dd200000-0000-4000-8000-000000000002'),0::bigint,'no free registrations inherited');
select is((select count(*) from tickets where event_id='dd200000-0000-4000-8000-000000000002'),0::bigint,'no free admissions inherited');
select is((select jsonb_agg(to_jsonb(x) order by id) from free_registrations x where event_id='b6200000-0000-4000-8000-000000000001'),(select data from free_before),'source free registration unchanged');
select is(private.free_reserved_admissions('dd200000-0000-4000-8000-000000000002'),0::bigint,'free reserved/used capacity starts empty');
select * from finish();
rollback;
