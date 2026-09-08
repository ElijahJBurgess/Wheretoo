begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','server_lookup_lite_ticket_collection',array['text'],'service collection projection exists');
select ok(not has_function_privilege('anon','public.server_lookup_lite_ticket_collection(text)','EXECUTE'),'anon cannot read collections');
select ok(not has_function_privilege('authenticated','public.server_lookup_lite_ticket_collection(text)','EXECUTE'),'authenticated cannot read collections');
select ok(has_function_privilege('service_role','public.server_lookup_lite_ticket_collection(text)','EXECUTE'),'service role can read collections');
set local role anon;
select throws_ok($$select * from public.server_lookup_lite_ticket_collection(repeat('1',64))$$,'42501',null,'anonymous RPC execution denied');
reset role;
set local role authenticated;
select throws_ok($$select * from public.server_lookup_lite_ticket_collection(repeat('1',64))$$,'42501',null,'authenticated RPC execution denied');
reset role;
\ir helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('collectionclean','collectionclean',id,session_id) from fulfillment_orders where kind='clean';
select is((select quantity from public.server_lookup_lite_ticket_collection(repeat('1',64))),3,'paid collection has exact total');
select is((select jsonb_array_length(tickets) from public.server_lookup_lite_ticket_collection(repeat('1',64))),3,'every purchased ticket returned');
select is((select count(*) from public.server_lookup_lite_ticket_collection(repeat('2',64))),0::bigint,'unpaid collection unavailable');
select is((select count(*) from public.server_lookup_lite_ticket_collection(repeat('f',64))),0::bigint,'unknown bearer unavailable');
select is((select count(*) from public.server_lookup_lite_ticket_collection('malformed')),0::bigint,'malformed hash unavailable');
select is((select count(*) from public.server_lookup_lite_ticket_collection(null)),0::bigint,'null hash unavailable');
reset role;
select is((select proconfig::text from pg_proc where oid='public.server_lookup_lite_ticket_collection(text)'::regprocedure),'{"search_path=\"\""}','projection fixes empty search path');
select ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.server_lookup_lite_ticket_collection(text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC has no execute grant');
select results_eq($$ select jsonb_object_keys(to_jsonb(p)) from public.server_lookup_lite_ticket_collection(repeat('1',64)) p order by 1 $$,
$$ values ('event_ends_at'),('event_id'),('event_starts_at'),('event_status'),('event_title'),('event_venue_name'),('items'),('order_status'),('quantity'),('tickets') $$,'projection exposes only event, status and minimal coherence data');
select results_eq($$ select jsonb_object_keys(tickets->0) from public.server_lookup_lite_ticket_collection(repeat('1',64)) order by 1 $$,
$$ values ('admission_label'),('credential_hash'),('id'),('order_item_id'),('status'),('unit_sequence') $$,'ticket projection excludes PII, Stripe, reconciliation and raw credential');
select results_eq($$ select jsonb_object_keys(items->0) from public.server_lookup_lite_ticket_collection(repeat('1',64)) order by 1 $$,
$$ values ('admission_label'),('order_item_id'),('quantity') $$,'source projection contains only snapshot label and unit cardinality');
select results_eq($$ select ticket->>'id' from public.server_lookup_lite_ticket_collection(repeat('1',64)), jsonb_array_elements(tickets) with ordinality a(ticket,n) order by n $$,
$$ select id::text from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') order by order_item_id,unit_sequence $$,'stable source-unit order');

-- Elevated historical-corruption fixtures roll back each entire probe; no production bypass.
create function pg_temp.collection_probe(p_sql text) returns bigint language plpgsql as $$
declare v_count bigint;
begin
  set local session_replication_role=replica;
  execute p_sql;
  set local session_replication_role=origin;
  select count(*) into v_count from public.server_lookup_lite_ticket_collection(repeat('1',64));
  raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return v_count;
end;
$$;
select is(pg_temp.collection_probe($$delete from public.tickets where order_id=(select id from fulfillment_orders where kind='clean')$$),0::bigint,'zero tickets rejects whole collection');
select is(pg_temp.collection_probe($$delete from public.tickets where id=(select id from public.tickets limit 1)$$),0::bigint,'missing ticket rejects whole collection');
select is(pg_temp.collection_probe($$insert into public.tickets(order_id,order_item_id,event_id,organizer_id,ticket_tier_id,unit_sequence,status,admission_label,credential_hash)
select order_id,order_item_id,event_id,organizer_id,ticket_tier_id,4,'valid',admission_label,decode(repeat('e',64),'hex') from public.tickets limit 1$$),0::bigint,'extra ticket rejects whole collection');
select is(pg_temp.collection_probe($$insert into public.tickets(order_id,order_item_id,event_id,organizer_id,ticket_tier_id,unit_sequence,status,admission_label,credential_hash)
select (select id from fulfillment_orders where kind='partial'),order_item_id,event_id,organizer_id,ticket_tier_id,4,'valid',admission_label,decode(repeat('e',64),'hex') from public.tickets limit 1$$),0::bigint,'foreign-order extra ticket referencing purchased source rejects collection');
select is(pg_temp.collection_probe($$update public.tickets set unit_sequence=4 where id=(select id from public.tickets limit 1)$$),0::bigint,'extra source unit rejects collection');
select is(pg_temp.collection_probe($$update public.tickets set event_id='a6200000-0000-4000-8000-000000000002' where id=(select id from public.tickets limit 1)$$),0::bigint,'cross-event ticket rejects collection');
select is(pg_temp.collection_probe($$update public.tickets set organizer_id='a6100000-0000-4000-8000-000000000002' where id=(select id from public.tickets limit 1)$$),0::bigint,'cross-organizer ticket rejects collection');
select is(pg_temp.collection_probe($$update public.tickets set ticket_tier_id='a6300000-0000-4000-8000-000000000003' where id=(select id from public.tickets limit 1)$$),0::bigint,'cross-tier ticket rejects collection');
select is(pg_temp.collection_probe($$update public.tickets set order_id=(select id from fulfillment_orders where kind='partial') where id=(select id from public.tickets limit 1)$$),0::bigint,'cross-order ticket rejects collection');
select is(pg_temp.collection_probe($$update public.tickets set admission_label='Wrong label' where id=(select id from public.tickets limit 1)$$),0::bigint,'snapshot label mismatch rejects collection');
select is(pg_temp.collection_probe($$update public.orders set quantity=4,platform_product_fee_minor=350,application_fee_amount_minor=350,expected_organizer_proceeds_minor=2651 where id=(select id from fulfillment_orders where kind='clean')$$),0::bigint,'order quantity mismatch rejects collection');
select is(pg_temp.collection_probe($$update public.orders set paid_at=null where id=(select id from fulfillment_orders where kind='clean')$$),0::bigint,'missing paid truth rejects collection');
select is(pg_temp.collection_probe($$update public.orders set status='requires_review' where id=(select id from fulfillment_orders where kind='clean')$$),0::bigint,'review order unavailable');
select is(pg_temp.collection_probe($$update public.orders set reconciliation_status='requires_review' where id=(select id from fulfillment_orders where kind='clean')$$),0::bigint,'contradictory reconciliation unavailable without exposing details');
select is(pg_temp.collection_probe($$update public.tickets set status='cancelled',cancelled_at=now() where id=(select id from public.tickets limit 1)$$),0::bigint,'unexplained cancellation unavailable');
select is(pg_temp.collection_probe($$update public.tickets set status='refunded',refunded_at=now() where id=(select id from public.tickets limit 1)$$),0::bigint,'unexplained refund unavailable');
select is(pg_temp.collection_probe($$update public.events set status='cancelled' where id='a6200000-0000-4000-8000-000000000001'$$),0::bigint,'cancelled event with valid tickets unavailable');
select is(pg_temp.collection_probe($$update public.orders set status='refunded',refunded_at=now() where id=(select id from fulfillment_orders where kind='clean')$$),0::bigint,'refunded order with valid tickets unavailable');
set local role service_role;
update public.tickets set status='used',used_at=now() where id=(select id from public.tickets limit 1);
select is((select count(*) from public.server_lookup_lite_ticket_collection(repeat('1',64))),1::bigint,'used history alongside valid tickets remains available');
reset role;
update public.events set status='cancelled' where id='a6200000-0000-4000-8000-000000000001';
update public.tickets set status='cancelled',cancelled_at=now() where status='valid';
set local role service_role;
select is((select count(*) from public.server_lookup_lite_ticket_collection(repeat('1',64))),1::bigint,'paid order on cancelled event retains coherent used and cancelled collection');
reset role;
update public.orders set status='refunded',refunded_at=now() where id=(select id from fulfillment_orders where kind='clean');
update public.tickets set status='refunded',refunded_at=now(),cancelled_at=null where status='cancelled';
set local role service_role;
select is((select count(*) from public.server_lookup_lite_ticket_collection(repeat('1',64))),1::bigint,'fully refunded collection retains used history');
select * from finish();
rollback;
