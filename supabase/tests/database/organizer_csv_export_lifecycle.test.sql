begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('csvlife','csvlife',id,session_id) from fulfillment_orders;
reset role;
create function pg_temp.orders() returns jsonb language sql as $$select public.get_organizer_event_export('a6200000-0000-4000-8000-000000000001','orders')$$;
create function pg_temp.admissions() returns jsonb language sql as $$select public.get_organizer_event_export('a6200000-0000-4000-8000-000000000001','admissions')$$;
create function pg_temp.snapshot() returns text language sql as $$select md5(jsonb_build_object(
 'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o),
 'items',(select jsonb_agg(to_jsonb(i) order by id) from public.order_items i),
 'tickets',(select jsonb_agg(to_jsonb(t) order by id) from public.tickets t),
 'refunds',(select jsonb_agg(to_jsonb(r) order by id) from public.refunds r),
 'operations',(select jsonb_agg(to_jsonb(r) order by order_id) from private.order_refund_operations r))::text)$$;
create temporary table before_export as select pg_temp.snapshot() digest;
select is(pg_temp.orders()->'rows'->0->>'refundWorkflowState','eligible','paid canonical refund eligibility');
select is(pg_temp.admissions()->>'rowCount','3','three issued tickets');
select is(pg_temp.snapshot(),(select digest from before_export),'every order/item/ticket/refund field unchanged by export');
-- Secret values are taken from real synthetic source records, not merely key names.
create temporary table sentinels as
 select confirmation_token_hash value from public.orders union all
 select stripe_checkout_session_id from public.orders union all
 select stripe_payment_intent_id from public.orders union all
 select stripe_charge_id from public.orders union all
 select encode(credential_hash,'hex') from public.tickets;
select ok(not exists(select 1 from sentinels where value is not null and length(value)>5 and
 position(value in (pg_temp.orders()::text||pg_temp.admissions()::text))>0),'actual synthetic bearer hashes/provider selectors never occur in export');
insert into private.staff_roles(user_id,role,active,granted_by) values('a6100000-0000-4000-8000-000000000002','admin',true,'a6100000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000002',true);
select throws_ok($$select pg_temp.orders()$$,'42501','Event unavailable','platform admin gets no cross-owner bulk PII access');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
reset role;
select public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select credential_hash from public.tickets order by id limit 1));
create temporary table used_history as select used_at from public.tickets where status='used';
select public.cancel_owned_event('a6200000-0000-4000-8000-000000000001');
select is((select count(*) from jsonb_array_elements(pg_temp.admissions()->'rows') r where r->>'ticketStatus'='cancelled'),2::bigint,'cancelled unused paid admissions exported');
select public.server_claim_owned_refund('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders));
select is(pg_temp.orders()->'rows'->0->>'refundWorkflowState','submitting','durable dispatch reflected');
create function pg_temp.observe(s text) returns text language plpgsql as $$declare result text;begin
 perform public.server_note_refund_observation('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders),s);
 result:=pg_temp.orders()->'rows'->0->>'refundWorkflowState';raise exception using errcode='PT011';
exception when sqlstate 'PT011' then return result;end;$$;
select is(pg_temp.observe(s),s,'canonical refund workflow '||s) from unnest(array['processing','unknown','failed','review']) s;
select public.server_record_webhook_receipt('evt_csvrefund','refund.updated',false,'re_csvrefund','2026-07-29.dahlia',now(),repeat('b',64));
select public.server_apply_verified_refund('evt_csvrefund',o.id,'re_csvrefund',o.stripe_payment_intent_id,o.stripe_charge_id,'trr_csvrefund','fr_csvrefund',o.total_minor,'usd','succeeded','requested_by_customer',true,true,o.total_minor,o.application_fee_amount_minor,true,null) from public.orders o;
select is(pg_temp.orders()->'rows'->0->>'status','refunded','canonical refunded order retained');
select is(pg_temp.orders()->'rows'->0->>'refundWorkflowState','completed','completed means verified full refund');
select is(pg_temp.orders()->'rows'->0->>'totalMinor','7000','original order total retained after refund');
select is((select count(*) from jsonb_array_elements(pg_temp.admissions()->'rows') r where r->>'ticketStatus'='refunded'),2::bigint,'unused refunded tickets retained');
select is((select (r->>'usedAt')::timestamptz from jsonb_array_elements(pg_temp.admissions()->'rows') r where r->>'ticketStatus'='used'),(select used_at from used_history),'original used timestamp survives cancellation and refund');
select * from finish();rollback;
