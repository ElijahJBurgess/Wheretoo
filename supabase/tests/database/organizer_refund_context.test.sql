begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('opsrefundscope','opsrefundscope',id,session_id) from fulfillment_orders where kind='clean';
select is(public.server_get_organizer_refund_context('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders where kind='clean'))->>'refundState','available','owned coherent paid order is eligible');
select throws_ok($$select public.server_get_organizer_refund_context('a6100000-0000-4000-8000-000000000002','a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders where kind='clean'))$$,'42501','Order unavailable','wrong owner cannot request refund');
select throws_ok($$select public.server_get_organizer_refund_context('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000002',(select id from fulfillment_orders where kind='clean'))$$,'42501','Order unavailable','wrong event cannot request refund');
reset role;
select ok(not has_function_privilege('authenticated','public.server_get_organizer_refund_context(uuid,uuid,uuid)','execute'),'browser cannot assert a service owner identity');
select ok(not has_function_privilege('anon','public.server_get_organizer_refund_context(uuid,uuid,uuid)','execute'),'anonymous denied');
select * from finish(); rollback;
