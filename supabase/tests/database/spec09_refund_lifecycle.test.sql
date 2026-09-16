-- Offline canonical-writer proof. Receipt rows stand in for already verified
-- webhook input; cryptographic Stripe verification belongs to Edge tests.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('spec09life','spec09life',id,session_id) from fulfillment_orders;
reset role;
create function pg_temp.order_id() returns uuid language sql as $$select id from fulfillment_orders where kind='clean'$$;
create function pg_temp.summary() returns jsonb language sql as $$select public.get_organizer_refund_status('a6200000-0000-4000-8000-000000000001',pg_temp.order_id())$$;
create function pg_temp.metrics() returns jsonb language sql as $$select public.get_organizer_event_metrics('a6200000-0000-4000-8000-000000000001')$$;
create function pg_temp.claim() returns jsonb language sql as $$select public.server_claim_owned_refund('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id())$$;
create function pg_temp.admissions() returns jsonb language sql as $$select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where order_id=pg_temp.order_id()$$;

select is((select total_minor from public.orders where id=pg_temp.order_id()),7000::bigint,'fixture pays exactly two $20 GA and one $30 VIP');
select results_eq($$select tier_name,quantity,subtotal_minor from public.order_items where order_id=pg_temp.order_id() order by tier_name$$,
 $$values ('General Admission'::text,2,4000::bigint),('VIP'::text,1,3000::bigint)$$,'immutable two-tier item ledger');
select is((select outcome from public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',
 (select credential_hash from public.tickets where order_id=pg_temp.order_id() and admission_label='General Admission' order by unit_sequence limit 1))),'admitted','real server redemption uses one GA');
create temporary table original_tickets as select * from public.tickets where order_id=pg_temp.order_id();
create temporary table original_items as select * from public.order_items where order_id=pg_temp.order_id();
select is((select count(*) from original_tickets where status='used' and used_at is not null),1::bigint,'one Used admission has an original timestamp');
select is((select count(*) from original_tickets where status='valid'),2::bigint,'two unused valid admissions remain');
select is(pg_temp.metrics()->'tiers'->0->>'remaining','12','both GA units remain committed including Used');
select is(pg_temp.metrics()->'tiers'->1->>'remaining','7','VIP unit remains committed');
select is(pg_temp.claim()->>'dispatch','true','first durable operation grants one dispatch');
create temporary table original_operation as select * from private.order_refund_operations where order_id=pg_temp.order_id();
select ok((select first_possible_dispatch_at is not null and requested_at is not null and snapshot->>'totalMinor'='7000' and idempotency_key='whereto-refund-integrity-v1:'||order_id::text from original_operation),'possible dispatch and immutable financial snapshot are stored before provider work');
select is(pg_temp.summary()->>'state','submitting','claim is visibly submitting');
select is(pg_temp.claim()->>'dispatch','false','repeat submit cannot dispatch');
select is(pg_temp.admissions(),(select jsonb_agg(to_jsonb(t) order by id) from original_tickets t),'claim does not modify any admission field');

-- Enable only the local request gate in this rollback transaction. The worker
-- stays disabled; ineligible must be a financial refusal, not not_enabled.
update private.ticket_email_settings set enabled_at=clock_timestamp(),limits='{}'::jsonb,worker_enabled=false where singleton;
select is(public.request_ticket_email_resend('a6200000-0000-4000-8000-000000000001','paid_order',pg_temp.order_id(),'a6900000-0000-4000-8000-000000000001')->>'kind','ineligible','ordinary resend is blocked while submitting');
select public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'unknown',null);
select is(pg_temp.summary()->>'state','unknown','lost provider response remains unknown');
select is(pg_temp.summary()->>'action','reconcile','unknown exposes reconcile only');
select is(pg_temp.claim()->>'dispatch','false','unknown cannot create another logical refund');
select is(pg_temp.admissions(),(select jsonb_agg(to_jsonb(t) order by id) from original_tickets t),'unknown preserves complete admission records');
-- A stale transport acknowledgement cannot erase a definite provider failure.
create function pg_temp.failed_observation_probe() returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'failed','re_spec09life');
 perform public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'unknown',null);
 r:=pg_temp.summary();
 raise exception using errcode='PT009';
exception when sqlstate 'PT009' then return r;
end;
$$;
select is(pg_temp.failed_observation_probe()->>'state','failed','late transport uncertainty cannot erase a definite failed observation');
select is(pg_temp.failed_observation_probe()->>'action','none','definite failure never reopens automatic recovery/create actions');
select public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'processing','re_spec09life');

create function pg_temp.apply_refund(p_event text,p_status text,p_amount bigint,p_fee bigint,p_verified boolean)
returns jsonb language plpgsql as $$
declare o public.orders; r jsonb;
begin
 select * into strict o from public.orders where id=pg_temp.order_id();
 perform * from public.server_record_webhook_receipt(p_event,'refund.updated',false,'re_spec09life','2026-07-29.dahlia','2026-09-11 00:00:00+00',repeat('b',64));
 select to_jsonb(v) into r from public.server_apply_verified_refund(p_event,o.id,'re_spec09life',o.stripe_payment_intent_id,o.stripe_charge_id,
 'trr_spec09life','fr_spec09life',p_amount,'usd',p_status,'requested_by_customer',true,true,p_amount,p_fee,p_verified,
 case when p_verified then null else 'REFUND_POLICY_MISMATCH' end) v;
 return r;
end;
$$;
-- Return evidence from an independently rolled-back scenario, so failed,
-- requires-action and anomalous success cannot contaminate the normal path.
create function pg_temp.probe(p_status text,p_amount bigint,p_fee bigint,p_verified boolean,p_recover boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform pg_temp.apply_refund('evt_spec09branch',p_status,p_amount,p_fee,p_verified);
 r:=jsonb_build_object('state',pg_temp.summary()->>'state','action',pg_temp.summary()->>'action','admissions',pg_temp.admissions(),
 'orderStatus',(select status from public.orders where id=pg_temp.order_id()),'metrics',pg_temp.metrics(),
 'dispatch',pg_temp.claim()->'dispatch',
 'resend',public.request_ticket_email_resend('a6200000-0000-4000-8000-000000000001','paid_order',pg_temp.order_id(),'a6900000-0000-4000-8000-000000000002')->>'kind');
 if p_recover then
  perform pg_temp.apply_refund('evt_spec09recovery','succeeded',7000,(select application_fee_amount_minor from public.orders where id=pg_temp.order_id()),true);
  r:=r||jsonb_build_object('recoveredState',pg_temp.summary()->>'state','recoveredAdmissions',pg_temp.admissions());
 end if;
 raise exception using errcode='PT009';
exception when sqlstate 'PT009' then return r;
end;
$$;
create temporary table branch_results as
 select 'failed' kind,pg_temp.probe('failed',7000,0,false) result union all
 select 'requires_action',pg_temp.probe('requires_action',7000,0,false) union all
 select 'partial',pg_temp.probe('succeeded',2000,0,false) union all
 select 'policy',pg_temp.probe('succeeded',7000,0,false,true);
select is(result->>'state',case when kind='failed' then 'failed' else 'review' end,kind||' canonical evidence projects the correct organizer state') from branch_results;
select is(result->>'resend','ineligible',kind||' cannot request ordinary admission resend') from branch_results;
select is(result->>'dispatch','false',kind||' cannot create a replacement refund') from branch_results;
select is(result->'metrics'->'tiers'->0->>'remaining','12',kind||' retains both GA inventory commitments') from branch_results;
select is(result->'metrics'->'tiers'->1->>'remaining','7',kind||' retains VIP inventory commitment') from branch_results;
select is(result->'admissions',(select jsonb_agg(to_jsonb(t) order by id) from original_tickets t),kind||' does not alter admission while money has not succeeded') from branch_results where kind in ('failed','requires_action');
select is((select count(*) from jsonb_array_elements(result->'admissions') t where t->>'status'='cancelled'),2::bigint,kind||' success anomaly review-holds only unused admissions') from branch_results where kind in ('partial','policy');
select is((select (t->>'used_at')::timestamptz from jsonb_array_elements(result->'admissions') t where t->>'status'='used'),(select used_at from original_tickets where status='used'),kind||' retains original Used timestamp') from branch_results;
select is(result->>'recoveredState','completed','same-refund exact evidence recovers policy review to completion') from branch_results where kind='policy';
select is((select count(*) from jsonb_array_elements(result->'recoveredAdmissions') t where t->>'status'='refunded'),2::bigint,'policy recovery converts only the two unused admissions to Refunded') from branch_results where kind='policy';

select pg_temp.apply_refund('evt_spec09pending','pending',7000,0,false);
select is(pg_temp.summary()->>'state','processing','canonical pending evidence projects processing');
select is(pg_temp.summary()->>'action','reconcile','processing exposes safe reconciliation only');
select is((select status from public.orders where id=pg_temp.order_id()),'paid','pending never reports customer money refunded');
select is((select refunded_at from public.orders where id=pg_temp.order_id()),null::timestamptz,'pending has no refund completion timestamp');
select is(pg_temp.admissions(),(select jsonb_agg(to_jsonb(t) order by id) from original_tickets t),'pending preserves every ticket field');
select is(pg_temp.claim()->>'dispatch','false','canonical pending cannot dispatch again');
select throws_ok($$select public.server_prepare_whole_order_refund(pg_temp.order_id(),'requested_by_customer')$$,'P0001','REFUND_NOT_AVAILABLE','existing writer blocks a second pending refund');
select is(public.request_ticket_email_resend('a6200000-0000-4000-8000-000000000001','paid_order',pg_temp.order_id(),'a6900000-0000-4000-8000-000000000003')->>'kind','ineligible','canonical pending blocks ordinary resend');

-- Contradictory provider identities require visible review even when an older
-- canonical pending row exists. Canonical full completion still wins later.
create function pg_temp.pending_review_probe() returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'review','re_conflicting');
 perform public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'processing','re_spec09life');
 r:=pg_temp.summary();
 raise exception using errcode='PT009';
exception when sqlstate 'PT009' then return r;
end;
$$;
select is(pg_temp.pending_review_probe()->>'state','review','durable contradictory-evidence review overrides older canonical pending');
select is(pg_temp.pending_review_probe()->>'action','reconcile','contradictory evidence offers reconcile without new refund dispatch');

create function pg_temp.pending_failure_probe() returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'failed','re_spec09life');
 perform public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'unknown',null);
 r:=pg_temp.summary();
 raise exception using errcode='PT009';
exception when sqlstate 'PT009' then return r;
end;
$$;
select is(pg_temp.pending_failure_probe()->>'state','failed','definite provider failure overrides older canonical pending despite late timeout');
select is(pg_temp.pending_failure_probe()->>'action','none','stale pending evidence cannot reopen a definite failed operation');

select is(pg_temp.apply_refund('evt_spec09complete','succeeded',7000,(select application_fee_amount_minor from public.orders where id=pg_temp.order_id()),true)->>'ticket_status','mixed','exact canonical completion reports mixed Used/Refunded');
select is(pg_temp.summary()->>'state','completed','only canonical full economics marks completion');
select is(pg_temp.summary()->>'action','none','completed order offers no money action');
select is((select state from private.order_refund_operations where order_id=pg_temp.order_id()),'completed','canonical completion closes durable operation');
select is((select completed_at from private.order_refund_operations where order_id=pg_temp.order_id()),(select refunded_at from public.orders where id=pg_temp.order_id()),'operation completion shares canonical financial timestamp');
select results_eq($$select t.id,t.used_at,t.cancelled_at,t.refunded_at from public.tickets t where order_id=pg_temp.order_id() and status='used'$$,
 $$select id,used_at,cancelled_at,refunded_at from original_tickets where status='used'$$,'Used is terminal with original timestamp and no fabricated cancellation/refund stamp');
select is((select count(*) from public.tickets where order_id=pg_temp.order_id() and status='refunded' and refunded_at is not null and used_at is null),2::bigint,'only the two unused admissions are Refunded');
select results_eq($$select id,order_item_id,unit_sequence,credential_hash from public.tickets where order_id=pg_temp.order_id() order by id$$,
 $$select id,order_item_id,unit_sequence,credential_hash from original_tickets order by id$$,'refund preserves every issued identity and original QR hash');
select results_eq($$select to_jsonb(i) from public.order_items i where order_id=pg_temp.order_id() order by id$$,
 $$select to_jsonb(i) from original_items i order by id$$,'all original item prices quantities and labels survive');
select is((select r.outcome from public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',t.credential_hash) r),
 case when t.status='used' then 'already_used' else 'refunded' end,'original QR refuses re-entry: '||t.admission_label||' unit '||t.unit_sequence)
 from original_tickets t;
select is(pg_temp.metrics()->>'grossSalesMinor','7000','historical gross stays $70');
select is(pg_temp.metrics()->>'sold','3','historical sold stays three units');
select is(pg_temp.metrics()->>'orderCount','1','historical order count stays one');
select is(pg_temp.metrics()->>'issued','3','historical entry denominator stays three');
select is(pg_temp.metrics()->>'checkedIn','1','historical checked-in numerator stays one');
select is(pg_temp.metrics()->'tiers'->0->>'remaining','14','both GA commitments released, independently of Used history');
select is(pg_temp.metrics()->'tiers'->1->>'remaining','8','VIP commitment released');
select is(public.request_ticket_email_resend('a6200000-0000-4000-8000-000000000001','paid_order',pg_temp.order_id(),'a6900000-0000-4000-8000-000000000004')->>'kind','ineligible','completed refund blocks ordinary admission resend');
select is((select count(*) from private.ticket_email_outbox where order_id=pg_temp.order_id() and purpose='resend'),0::bigint,'blocked resends never create admission email intents');
select results_eq($$select amount_minor,transfer_reversal_amount_minor,application_fee_refund_amount_minor,policy_verified from public.refunds where order_id=pg_temp.order_id()$$,
 $$select 7000::bigint,7000::bigint,application_fee_amount_minor,true from public.orders where id=pg_temp.order_id()$$,'canonical ledger retains exact approved customer reversal and application fee economics');
create temporary table completed_tickets as select * from public.tickets where order_id=pg_temp.order_id();
create temporary table completed_metrics as select pg_temp.metrics() result;
select pg_temp.apply_refund('evt_spec09complete','succeeded',7000,(select application_fee_amount_minor from public.orders where id=pg_temp.order_id()),true);
select pg_temp.apply_refund('evt_spec09duplicate','succeeded',7000,(select application_fee_amount_minor from public.orders where id=pg_temp.order_id()),true);
select public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',pg_temp.order_id(),'unknown','re_spec09life');
select is(pg_temp.claim()->>'dispatch','false','reload after completion never dispatches');
select is(pg_temp.summary()->>'state','completed','late timeout cannot regress canonical completion');
select is(pg_temp.admissions(),(select jsonb_agg(to_jsonb(t) order by id) from completed_tickets t),'duplicate receipts preserve every completed ticket field');
select is(pg_temp.metrics(),(select result from completed_metrics),'same and new receipt retries release no additional inventory or historical metrics');
select is((select count(*) from public.refunds where order_id=pg_temp.order_id()),1::bigint,'all receipts reconcile one refund identity');
select results_eq($$select id,idempotency_key,snapshot,requested_at,first_possible_dispatch_at from private.order_refund_operations where order_id=pg_temp.order_id()$$,
 $$select id,idempotency_key,snapshot,requested_at,first_possible_dispatch_at from original_operation$$,'all lifecycle stages preserve durable operation identity and original dispatch anchor');
select * from finish();
rollback;
