begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('csvequivalence','csvequivalence',id,session_id) from fulfillment_orders where kind='clean';
reset role;
\ir helpers/csv_export_old_coherence.inc
create temporary table probe_ids as select
 (select id from fulfillment_orders where kind='clean') a,
 (select id from fulfillment_orders where kind='partial') b,
 (select id from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') and admission_label='General Admission' and unit_sequence=1) ticket,
 (select id from public.order_items where order_id=(select id from fulfillment_orders where kind='partial') and tier_name='General Admission') other_item;
-- Every mutation rolls back independently. These intentionally corrupt fixtures
-- bypass writer/FK triggers locally; neither authority bypasses any integrity test.
create function pg_temp.probe(mutation text) returns jsonb language plpgsql as $$
declare result jsonb;begin
 perform set_config('session_replication_role','replica',true);
 if mutation<>'' then execute mutation; end if;
 perform set_config('session_replication_role','origin',true);
 select jsonb_build_object('equivalent',bool_and(private.organizer_order_coherent(id) is not distinct from pg_temp.old_order_coherent(id)),
 'a',private.organizer_order_coherent((select a from probe_ids)),
 'b',private.organizer_order_coherent((select b from probe_ids))) into result from public.orders;
 raise exception using errcode='PT023';
exception when sqlstate 'PT023' then return result;end;$$;
create temporary table scenarios(name text,mutation text,expected_a boolean,expected_b boolean);
insert into scenarios values
 ('valid','',true,true),
 ('cross-order both directions','update public.tickets set order_item_id=(select other_item from probe_ids) where id=(select ticket from probe_ids)',false,false),
 ('missing item','update public.tickets set order_item_id=''ffffffff-ffff-4fff-8fff-ffffffffffff'' where id=(select ticket from probe_ids)',false,true),
 ('missing ticket','delete from public.tickets where id=(select ticket from probe_ids)',false,true),
 ('wrong event','update public.tickets set event_id=''a6200000-0000-4000-8000-000000000002'' where id=(select ticket from probe_ids)',false,true),
 ('wrong organizer','update public.tickets set organizer_id=''a6100000-0000-4000-8000-000000000002'' where id=(select ticket from probe_ids)',false,true),
 ('wrong tier','update public.tickets set ticket_tier_id=''a6300000-0000-4000-8000-000000000002'' where id=(select ticket from probe_ids)',false,true),
 ('wrong label','update public.tickets set admission_label=''Corrupt'' where id=(select ticket from probe_ids)',false,true),
 ('wrong position','update public.tickets set unit_sequence=10 where id=(select ticket from probe_ids)',false,true),
 ('missing parent','update public.tickets set order_id=''ffffffff-ffff-4fff-8fff-ffffffffffff'' where id=(select ticket from probe_ids)',false,true),
 ('missing item tier','update public.order_items set ticket_tier_id=''ffffffff-ffff-4fff-8fff-ffffffffffff'' where order_id=(select a from probe_ids) and tier_name=''General Admission''',false,true),
 ('missing event','delete from public.events where id=''a6200000-0000-4000-8000-000000000001''',false,false),
 ('null legacy comparison','update public.orders set paid_at=now(),status=''requires_review'',reconciliation_status=''requires_review'',failure_code=''PAYMENT_AFTER_INVALIDATION'' where id=(select b from probe_ids)',true,true);
create temporary table results as select *,pg_temp.probe(mutation) result from scenarios;
select is(result->>'equivalent','true','old/new full helper equivalence: '||name) from results;
select is((result->>'a')::boolean,expected_a,'outgoing/order-owned integrity: '||name) from results;
select is((result->>'b')::boolean,expected_b,'incoming/item-owned integrity: '||name) from results;
select is(private.organizer_order_coherent(null),pg_temp.old_order_coherent(null),'null order equivalent');
select is(private.organizer_order_coherent('ffffffff-ffff-4fff-8fff-ffffffffffff'),false,'missing order rejected');
-- Exhaust PostgreSQL three-valued truth: WHERE admits TRUE only. Splitting OR
-- preserves the union of witnesses, including nullable LEFT JOIN comparisons.
select ok(bool_and(
 (not exists(select 1 where (a or b) and c)) =
 ((not exists(select 1 where a and c)) and (not exists(select 1 where b and c)))
 ),'all 27 TRUE/FALSE/NULL combinations preserve anti-join equivalence')
from unnest(array[true,false,null::boolean]) a cross join unnest(array[true,false,null::boolean]) b cross join unnest(array[true,false,null::boolean]) c;
select ok((select prosecdef and provolatile='s' and proconfig=array['search_path=""'] from pg_proc where oid='private.organizer_order_coherent(uuid)'::regprocedure),'security-definer stable empty search path preserved');
select ok(not has_function_privilege('authenticated','private.organizer_order_coherent(uuid)','execute') and not has_function_privilege('anon','private.organizer_order_coherent(uuid)','execute') and not has_function_privilege('service_role','private.organizer_order_coherent(uuid)','execute'),'private helper grants preserved');
select * from finish();rollback;
