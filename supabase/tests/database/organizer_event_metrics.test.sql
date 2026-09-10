begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','get_organizer_event_metrics',array['uuid'],'owned metrics boundary exists');
\ir helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('opsmetrics','opsmetrics',id,session_id) from fulfillment_orders where kind='clean';
reset role;
create function pg_temp.metrics() returns jsonb language sql as $$
 select public.get_organizer_event_metrics('a6200000-0000-4000-8000-000000000001');
$$;
set local role authenticated;
select is(pg_temp.metrics()->>'grossSalesMinor','3001','gross uses one immutable order snapshot');
select is(pg_temp.metrics()->>'sold','3','multi-tier paid order has three historical units');
select is(pg_temp.metrics()->>'orderCount','1','one order is not three admissions');
select is(pg_temp.metrics()->>'issued','3','three individually issued tickets');
select is(pg_temp.metrics()->>'checkedIn','0','no used admissions yet');
select is(pg_temp.metrics()->>'capacity','24','all configured inventory is counted');
select is((pg_temp.metrics()->'tiers'->0->>'grossSalesMinor'),'2002','GA historical item subtotal');
select is((pg_temp.metrics()->'tiers'->0->>'remaining'),'0','active reservations count alongside paid quantities');
select ok(not (pg_temp.metrics()::text ~ 'buyerEmail|credential|stripe_|confirmation'),'metrics excludes PII and secrets');
reset role;
create function pg_temp.probe(p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 execute p_sql;
 r := pg_temp.metrics();
 raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return r;
end;
$$;
select is(pg_temp.probe($$update public.orders set status='payment_failed' where id=(select id from fulfillment_orders where kind='partial')$$)->'tiers'->0->>'remaining','2','failed payment releases inventory without adding sales');
select is(pg_temp.probe($$update public.orders set created_at=now()-interval '1 day',reservation_expires_at=now()-interval '1 second' where id=(select id from fulfillment_orders where kind='partial')$$)->'tiers'->0->>'remaining','2','expired open hold is not committed');
select is(pg_temp.probe($$update public.orders set status='payment_processing' where id=(select id from fulfillment_orders where kind='partial')$$)->>'sold','3','processing quantity is not historical sales');
select is(pg_temp.probe($$update public.orders set status='requires_review' where id=(select id from fulfillment_orders where kind='clean')$$)->>'grossSalesMinor','3001','review after fulfillment preserves historical gross');
select is(pg_temp.probe($$update public.orders set status='requires_review' where id=(select id from fulfillment_orders where kind='partial')$$)->>'orderCount','1','review before fulfillment is not a successful order');
select is(pg_temp.probe($$update public.ticket_tiers set status='archived' where id='a6300000-0000-4000-8000-000000000004'$$)->>'capacity','24','archived configured tier remains in capacity');
select is(pg_temp.probe(format('update public.orders set status=%L where id=(select id from fulfillment_orders where kind=''partial'')',state))->>'grossSalesMinor','3001',state||' never adds unpaid sales')
from (values ('expired'),('cancelled'),('payment_processing'),('partially_refunded')) states(state);
create function pg_temp.corrupt_source() returns jsonb language plpgsql as $$
begin
 set local session_replication_role=replica;
 update public.orders set event_id='a6200000-0000-4000-8000-000000000002' where id=(select id from fulfillment_orders where kind='clean');
 set local session_replication_role=origin;
 return pg_temp.metrics();
end;
$$;
select throws_ok($$select pg_temp.corrupt_source()$$,'P0001','Operations data unavailable','foreign order claiming owned tier/tickets cannot pollute aggregates');
select * from public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select credential_hash from public.tickets limit 1));
create temporary table before_used as select id,used_at from public.tickets where status='used';
select * from public.server_record_webhook_receipt('evt_opsrefund','refund.updated',false,'re_opsrefund','2026-07-29.dahlia','2026-09-10 00:00:00+00',repeat('b',64));
select r.* from public.orders o cross join lateral public.server_apply_verified_refund('evt_opsrefund',o.id,'re_opsrefund',o.stripe_payment_intent_id,o.stripe_charge_id,'trr_opsrefund','fr_opsrefund',3001,'usd','succeeded','requested_by_customer',true,true,3001,300,true,null) r
where o.id=(select id from fulfillment_orders where kind='clean');
set local role authenticated;
select is(pg_temp.metrics()->>'grossSalesMinor','3001','full refund never reduces historical gross');
select is(pg_temp.metrics()->>'sold','3','full refund never reduces sold quantity');
select is(pg_temp.metrics()->>'orderCount','1','refunded successful order remains counted');
select is(pg_temp.metrics()->>'issued','3','refunded tickets remain in historical denominator');
select is(pg_temp.metrics()->>'checkedIn','1','used history remains in numerator');
select is(pg_temp.metrics()->'tiers'->0->>'remaining','2','refund releases all GA commitments including used unit');
reset role;
select is((select t.used_at from public.tickets t join before_used b using(id)),(select used_at from before_used),'used timestamp survives');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select pg_temp.metrics()$$,'42501','Event unavailable','wrong owner denied before data projection');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select pg_temp.metrics()$$,'42501','Event unavailable','missing identity denied');
reset role;
select ok(not has_function_privilege('anon','public.get_organizer_event_metrics(uuid)','execute'),'anonymous denied');
select ok(not has_table_privilege('authenticated','public.orders','select'),'orders table stays inaccessible');
select * from finish();
rollback;
