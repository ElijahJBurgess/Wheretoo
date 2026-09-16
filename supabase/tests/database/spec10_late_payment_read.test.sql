begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/spec09_refund_setup.inc
reset role;
create function pg_temp.oid() returns uuid language sql as $$select id from fulfillment_orders$$;
create function pg_temp.detail() returns jsonb language sql as $$select public.get_organizer_order_v2('a6200000-0000-4000-8000-000000000001',pg_temp.oid())$$;
set local role authenticated;
select public.cancel_owned_event('a6200000-0000-4000-8000-000000000001');
set local role service_role;
select pg_temp.record_and_fulfill('spec10late','spec10late',id,session_id) from fulfillment_orders;
reset role;
select is((select failure_code from public.orders where id=pg_temp.oid()),'PAYMENT_AFTER_INVALIDATION','real fulfillment records canonical review reason');
select is((select count(*) from public.tickets where order_id=pg_temp.oid()),0::bigint,'real late payment issues no tickets');
select ok(private.organizer_order_coherent(pg_temp.oid()),'recognized late payment remains readable');
select is(pg_temp.detail()->>'status','requires_review','owner sees preserved review status');
select is(pg_temp.detail()->>'paymentAfterInvalidation','true','explicit DTO marker is server derived');
select is(jsonb_array_length(pg_temp.detail()->'tickets'),0,'owner sees truthful empty ticket set');
select is(pg_temp.detail()->>'admissionEligible','false','no admission from late payment');
select is(public.get_organizer_refund_status('a6200000-0000-4000-8000-000000000001',pg_temp.oid())->>'state','review','Spec09 retains financial authority');
select is(public.server_claim_owned_refund('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.oid())->>'dispatch','false','read correction cannot authorize refund');
select is((select count(*) from private.order_refund_operations),0::bigint,'read and refused refund create no operation');
create function pg_temp.bad_review(p_reason text,p_reconciliation text) returns boolean language plpgsql as $$
declare result boolean;
begin
 update public.orders set failure_code=p_reason,reconciliation_status=p_reconciliation where id=pg_temp.oid();
 result:=private.organizer_order_coherent(pg_temp.oid());
 raise exception using errcode='PT010';
exception when sqlstate 'PT010' then return result;
end;$$;
select ok(not pg_temp.bad_review('OTHER_REVIEW','requires_review'),'other review cannot bypass full ticket cardinality');
select ok(not pg_temp.bad_review('PAYMENT_AFTER_INVALIDATION','reconciled'),'reason alone cannot bypass reconciliation checks');
select ok(not (pg_temp.detail()::text ~ 'stripe_|credential|confirmation|access_hash'),'owner DTO excludes credential/payment IDs');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000002',true);
select throws_ok($$select pg_temp.detail()$$,'42501','Event unavailable','other organizer cannot read late payment');
select * from finish();rollback;
