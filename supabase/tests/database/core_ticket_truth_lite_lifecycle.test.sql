begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('lifecycleclean','lifecycleclean',id,session_id)
from fulfillment_orders where kind='clean';
select * from public.server_redeem_paid_ticket(
  'a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',
  (select credential_hash from public.tickets order by id limit 1));
reset role;
create temporary table original_used as select id,used_at from public.tickets where status='used';

-- Each real lifecycle entry runs in a subtransaction, then rolls back to the same
-- paid source set. An overbroad status update or timestamp write breaks these checks.
create function pg_temp.lifecycle_probe(p_path text) returns jsonb language plpgsql as $$
declare
  v_order public.orders;
  v_apply jsonb;
  v_result jsonb;
begin
  select * into strict v_order from public.orders where id=(select id from fulfillment_orders where kind='clean');
  if p_path='refund_all_used' then
    perform public.server_redeem_paid_ticket(v_order.organizer_id,v_order.event_id,t.credential_hash)
    from public.tickets t where t.order_id=v_order.id and t.status='valid';
  elsif p_path='refund_cancelled' then
    update public.tickets set status='cancelled',cancelled_at=now()
    where order_id=v_order.id and status='valid';
  end if;
  if p_path like 'refund%' then
    perform * from public.server_record_webhook_receipt('evt_liferefund','refund.updated',false,
      're_liferefund','2026-07-29.dahlia','2026-09-08 00:00:00+00',repeat('b',64));
    select to_jsonb(r) into v_apply from public.server_apply_verified_refund(
      'evt_liferefund',v_order.id,'re_liferefund',v_order.stripe_payment_intent_id,v_order.stripe_charge_id,
      'trr_liferefund','fr_liferefund',3001,'usd','succeeded','requested_by_customer',true,true,
      3001,case when p_path='refund_review' then 299 else 300 end,
      p_path<>'refund_review',case when p_path='refund_review' then 'REFUND_POLICY_MISMATCH' else null end) r;
  elsif p_path='dispute' then
    perform * from public.server_record_webhook_receipt('evt_lifedispute','charge.dispute.created',false,
      'du_lifedispute','2026-07-29.dahlia','2026-09-08 00:00:00+00',repeat('b',64));
    perform public.server_apply_verified_dispute('evt_lifedispute',v_order.id,'du_lifedispute',
      v_order.stripe_payment_intent_id,v_order.stripe_charge_id,null,'needs_response',3001,'usd','not_attempted');
  elsif p_path='ticket_mismatch' then
    -- Simulate a stored historical mismatch, not a malformed incoming manifest.
    set local session_replication_role=replica;
    update public.tickets set admission_label='Wrong snapshot' where order_id=v_order.id and status='valid';
    set local session_replication_role=origin;
    v_apply:=pg_temp.record_and_fulfill('lifemismatch','lifecycleclean',v_order.id,v_order.stripe_checkout_session_id);
  else
    perform * from public.server_record_webhook_receipt('evt_lifereview','checkout.session.completed',false,
      v_order.stripe_checkout_session_id,'2026-07-29.dahlia','2026-09-08 00:00:00+00',repeat('b',64));
    if p_path='checkout_review' then
      perform public.server_mark_checkout_reconciliation_review(v_order.id,v_order.stripe_checkout_session_id,
        'evt_lifereview','CHECKOUT_LINE_ITEMS_MISMATCH');
    elsif p_path='payment_review' then
      perform * from public.server_mark_payment_requires_review('evt_lifereview',v_order.id,
        v_order.stripe_checkout_session_id,v_order.stripe_payment_intent_id,v_order.stripe_charge_id,
        v_order.stripe_transfer_id,v_order.stripe_application_fee_id,v_order.stripe_balance_transaction_id,
        v_order.stripe_customer_id,'payment','paid','usd',3001,3001,300,'acct_integrityfulfillment','PAYMENT_REQUIRES_REVIEW');
    else
      raise exception 'unknown probe';
    end if;
  end if;
  select jsonb_build_object('used',count(*) filter(where status='used'),
    'valid',count(*) filter(where status='valid'),'cancelled',count(*) filter(where status='cancelled'),
    'refunded',count(*) filter(where status='refunded'),
    'history_preserved',bool_and(case when t.id=u.id then t.status='used' and t.used_at=u.used_at
      and t.cancelled_at is null and t.refunded_at is null else true end),
    'order_status',(select status from public.orders where id=v_order.id),
    'apply_status',v_apply->>'ticket_status') into v_result
  from public.tickets t left join original_used u on u.id=t.id where order_id=v_order.id;
  raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return v_result;
end;
$$;
select is(pg_temp.lifecycle_probe('refund_valid'),
  '{"used":1,"valid":0,"cancelled":0,"refunded":2,"history_preserved":true,"order_status":"refunded","apply_status":"mixed"}'::jsonb,
  'verified whole refund refunds unused valid admissions and preserves used history');
select is(pg_temp.lifecycle_probe('refund_cancelled'),
  '{"used":1,"valid":0,"cancelled":0,"refunded":2,"history_preserved":true,"order_status":"refunded","apply_status":"mixed"}'::jsonb,
  'verified whole refund retains approved cancelled-to-refunded recovery');
select is(pg_temp.lifecycle_probe('refund_all_used'),
  '{"used":3,"valid":0,"cancelled":0,"refunded":0,"history_preserved":true,"order_status":"refunded","apply_status":"used"}'::jsonb,
  'all-used refund carries financial truth on the order and returns used');
select is(pg_temp.lifecycle_probe(path),
  '{"used":1,"valid":0,"cancelled":2,"refunded":0,"history_preserved":true,"order_status":"requires_review","apply_status":null}'::jsonb,
  path||' cancels only unused valid admissions through final entrypoint')
from (values ('checkout_review'),('payment_review'),('dispute'),('ticket_mismatch')) paths(path);
select is(pg_temp.lifecycle_probe('refund_review'),
  '{"used":1,"valid":0,"cancelled":2,"refunded":0,"history_preserved":true,"order_status":"requires_review","apply_status":"mixed"}'::jsonb,
  'refund policy review preserves admission history');

select has_function('public','cancel_owned_event',array['uuid'],'owner cancellation RPC exists');
select function_privs_are('public','cancel_owned_event',array['uuid'],'anon',array[]::text[],'anonymous cancellation denied');
select function_privs_are('public','cancel_owned_event',array['uuid'],'service_role',array[]::text[],'owner cancellation is authenticated only');
select function_privs_are('public','cancel_owned_event',array['uuid'],'authenticated',array['EXECUTE'],'authenticated owner boundary');
select is((select proconfig::text from pg_proc where oid='public.cancel_owned_event(uuid)'::regprocedure),'{"search_path=\"\""}','empty search path');
select ok((select prosecdef from pg_proc where oid='public.cancel_owned_event(uuid)'::regprocedure),'security definer');
set local role anon;
select throws_ok($$select public.cancel_owned_event('a6200000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous direct call denied');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select public.cancel_owned_event('a6200000-0000-4000-8000-000000000001')$$,'42501','Event cancellation forbidden','missing identity denied');
reset role;
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.cancel_owned_event('a6200000-0000-4000-8000-000000000001')$$,'42501','Event cancellation forbidden','another organizer denied');
select throws_ok($$select public.cancel_owned_event('a6200000-0000-4000-8000-000000000002')$$,'P0001','Only published events can be cancelled','draft cancellation denied');
select throws_ok($$select public.cancel_owned_event('a6200000-0000-4000-8000-000000000009')$$,'42501','Event cancellation forbidden','missing event denied without existence disclosure');
reset role;
-- A second paid order already refunded before the event cancellation stays intact.
set local role service_role;
select pg_temp.record_and_fulfill('liferefunded','liferefunded',id,session_id) from fulfillment_orders where kind='partial';
reset role;
update public.orders set status='refunded',refunded_at=now() where id=(select id from fulfillment_orders where kind='partial');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((public.cancel_owned_event('a6200000-0000-4000-8000-000000000001')).status,'cancelled','owner cancels published event');
reset role;
select is((select count(*) from public.tickets where status='valid'),0::bigint,'all event unused valid tickets cancelled atomically');
select is((select count(*) from public.tickets where status='cancelled' and cancelled_at is not null),2::bigint,'unused tickets have cancellation timestamps');
select is((select count(*) from public.tickets where status='refunded'),3::bigint,'already refunded tickets untouched');
select results_eq($$select id,used_at from public.tickets where status='used'$$,$$select * from original_used$$,'used status and original timestamp survive cancellation');
select is((select status from public.orders where id=(select id from fulfillment_orders where kind='clean')),'paid','event cancellation does not refund the order');
select is((select count(*) from public.refunds),0::bigint,'event cancellation initiates no refunds');
create temporary table cancelled_snapshot as select to_jsonb(t) row from public.tickets t;
set local role authenticated;
select is((public.cancel_owned_event('a6200000-0000-4000-8000-000000000001')).status,'cancelled','retry returns cancelled event');
reset role;
select results_eq($$select to_jsonb(t) from public.tickets t order by id$$,$$select row from cancelled_snapshot order by row->>'id'$$,'retry preserves every ticket field');
set local role service_role;
select is((pg_temp.record_and_fulfill('lifecancelreplay','lifecycleclean',id,session_id)->>'order_status'),'paid','coherent previously paid cancelled-event replay remains paid') from fulfillment_orders where kind='clean';
select is((pg_temp.record_and_fulfill('lifecancelnew','lifecancelnew',id,session_id)->>'order_status'),'requires_review','new paid fulfillment after cancellation cannot issue') from fulfillment_orders where kind='extra';
select is((select count(*) from public.tickets where order_id=(select id from fulfillment_orders where kind='extra')),0::bigint,'cancelled event issues no new admissions');
select is((select outcome from public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',
  (select credential_hash from public.tickets where status='cancelled' limit 1))),'cancelled','cancelled unused admission cannot be redeemed');
select is((select outcome from public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',
  (select credential_hash from public.tickets where status='used' limit 1))),'already_used','used admission retains precedence after event cancellation');
select * from finish();
rollback;
