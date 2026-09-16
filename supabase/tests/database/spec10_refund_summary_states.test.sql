begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('spec10matrix','spec10matrix',id,session_id) from fulfillment_orders;
reset role;
create function pg_temp.summary() returns jsonb language sql as $$select public.get_owned_event_cancellation_summary('a6200000-0000-4000-8000-000000000001')$$;
select public.cancel_owned_event('a6200000-0000-4000-8000-000000000001');
select public.server_claim_owned_refund('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders));
create function pg_temp.observe(s text) returns jsonb language plpgsql as $$declare result jsonb;begin
 perform public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders),s);
 result:=pg_temp.summary();raise exception using errcode='PT010';
exception when sqlstate 'PT010' then return result;end;$$;
select is(pg_temp.summary()->'paid'->>'processingOrders','1','durable submitting operation counted in processing');
select is(pg_temp.observe('processing')->'paid'->>'processingOrders','1','Spec09 processing observation authoritative');
select is(pg_temp.observe('unknown')->'paid'->>'unknownOrders','1','Spec09 uncertain dispatch remains unknown');
select is(pg_temp.observe('failed')->'paid'->>'failedOrders','1','Spec09 failed observation not newly refundable');
select is(pg_temp.observe('review')->'paid'->>'reviewOrders','1','Spec09 review operation not newly refundable');
select is(pg_temp.observe('failed')->'paid'->>'eligibleAmountMinor','0','failed refund does not imply new dispatch eligibility');
create function pg_temp.receipt(s text) returns jsonb language plpgsql as $$declare o public.orders;result jsonb;begin
 select * into o from public.orders where id=(select id from fulfillment_orders);
 perform public.server_record_webhook_receipt('evt_spec10matrixrefund','refund.updated',false,'re_spec10matrix','2026-07-29.dahlia',now(),repeat('b',64));
 perform public.server_apply_verified_refund('evt_spec10matrixrefund',o.id,'re_spec10matrix',o.stripe_payment_intent_id,o.stripe_charge_id,'trr_spec10matrix','fr_spec10matrix',o.total_minor,'usd',s,'requested_by_customer',true,true,o.total_minor,o.application_fee_amount_minor,true,null);
 result:=pg_temp.summary();raise exception using errcode='PT011';
exception when sqlstate 'PT011' then return result;end;$$;
select is(pg_temp.receipt('requires_action')->'paid'->>'actionRequiredOrders','1','action-required receipt is separate from processing');
select is(pg_temp.receipt('succeeded')->'paid'->>'completedOrders','1','completed aggregate requires verified whole refund');
select is(pg_temp.receipt('succeeded')->'paid'->>'notConfirmedRefundedOrders','0','only confirmed whole refund leaves remaining count');
select is(pg_temp.receipt('succeeded')->'tickets'->>'refunded','3','current refunded units separated from original cancellation impact');
create function pg_temp.corrupt_summary() returns jsonb language plpgsql as $$declare result jsonb;begin
 perform set_config('session_replication_role','replica',true);
 update public.tickets set organizer_id='a6100000-0000-4000-8000-000000000002' where order_id=(select id from fulfillment_orders);
 perform set_config('session_replication_role','origin',true);
 result:=pg_temp.summary();raise exception using errcode='PT012';
exception when sqlstate 'PT012' then return result;end;$$;
select is(pg_temp.corrupt_summary()->>'eventStatus','cancelled','unavailable summaries never erase canonical cancellation');
select is(pg_temp.corrupt_summary()->>'complete','false','contradictory source declared incomplete');
select is(pg_temp.corrupt_summary()->'paid','null'::jsonb,'incomplete paid counts are null not fake zero');
select is(pg_temp.corrupt_summary()->'tickets','null'::jsonb,'incomplete ticket counts are null not fake zero');
select * from finish();rollback;
