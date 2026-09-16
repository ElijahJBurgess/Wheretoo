begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
\ir spec07_email_fixture.inc
\ir helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('noticepaid','noticepaid',id,session_id) from fulfillment_orders where kind='clean';
select * from public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select credential_hash from public.tickets order by id limit 1));
reset role;
create temp table history as select id,status,used_at from public.tickets;
select extensions.is(public.server_enqueue_refund_notices(),0,'paid order cannot enqueue refund notice');
select extensions.is((select private.refund_detail(id) from fulfillment_orders where kind='clean'),null::jsonb,'paid order has no financial refund projection');
select * from public.server_record_webhook_receipt('evt_refundnotice','refund.updated',false,'re_refundnotice','2026-07-29.dahlia','2026-09-08 00:00:00+00',repeat('b',64));
select public.server_apply_verified_refund('evt_refundnotice',o.id,'re_refundnotice',o.stripe_payment_intent_id,o.stripe_charge_id,'trr_refundnotice','fr_refundnotice',3001,'usd','succeeded','requested_by_customer',true,true,3001,300,true,null)
 from public.orders o where o.id=(select id from fulfillment_orders where kind='clean');
select extensions.is((select count(*) from private.ticket_email_outbox where purpose='refund_notice'),0::bigint,'canonical money commit does not enqueue notice');
-- An anomalous old terminal row must not monopolize a bounded catch-up page.
set local session_replication_role=replica;
update public.orders set status='refunded',paid_at=now()-interval '40 seconds',refunded_at=now()-interval '30 seconds',reconciliation_status='reconciled'
 where id=(select id from fulfillment_orders where kind='partial');
set local session_replication_role=origin;
select extensions.is(public.server_enqueue_refund_notices(1),1,'canonical catchup skips earlier incoherent rows before bounded limit');
select extensions.is(public.server_enqueue_refund_notices(),0,'duplicate catchup cannot duplicate logical notice');
select extensions.is(public.server_enqueue_refund_notices(101),0,'unbounded catchup refused');
-- Keep existing ticket preparation distinct; refunded initial sends must suppress.
create temp table claims(k text primary key,v jsonb);
insert into claims select 'notice',public.server_claim_ticket_email();
select public.server_prepare_ticket_email_context((v->>'id')::uuid,(v->>'lease_id')::uuid) from claims;
-- Old initial rows can be claimed first; consume only their safe suppression.
do $$ declare q jsonb; begin
 if (select v->>'purpose' from claims) <> 'refund_notice' then
  q:=public.server_claim_ticket_email(); update claims set v=q;
 end if;
end; $$;
create temp table context as select public.server_prepare_ticket_email_context((v->>'id')::uuid,(v->>'lease_id')::uuid) v from claims;
select extensions.is((select v->>'purpose' from context),'refund_notice','shared worker prepares refund purpose');
select extensions.is((select (v->>'expiresAt')::timestamptz-(v->>'preparedAt')::timestamptz from context),interval '30 days','financial lifetime is fixed from preparation');
select public.server_save_ticket_email_payload((v->>'id')::uuid,(v->>'lease_id')::uuid,repeat('a',64),pg_temp.envelope()) from claims;
create temp table financial as select public.server_read_refund_detail_access(repeat('a',64),repeat('e',64)) v;
select extensions.is((select v->>'kind' from financial),'ready','financial grant resolves canonical whole-order history');
select extensions.is((select v->'order'->>'refundAmountMinor' from financial),'3001','refund amount uses immutable whole-order total');
select extensions.is((select count(*) from financial,jsonb_array_elements(v->'order'->'tickets') t where t->>'status'='used'),1::bigint,'financial detail retains Used ticket');
select extensions.is((select count(*) from financial,jsonb_array_elements(v->'order'->'tickets') t where t->>'status'='refunded'),2::bigint,'financial detail includes Refunded unused tickets');
select extensions.ok((select not (v::text ~ 'buyerEmail|buyerName|stripe|credential|token|qr') from financial),'financial allowlist contains no provider/buyer/credential fields');
select extensions.is(public.server_read_ticket_email_access(repeat('a',64),repeat('e',64),0,null),null::jsonb,'refund grant cannot read admission index');
select extensions.is(public.server_read_ticket_email_access(repeat('a',64),repeat('e',64),0,1),null::jsonb,'refund grant cannot read admission member or mint QR');
insert into private.ticket_email_grants(token_hash,purpose,prepared_at,expires_at) values(repeat('b',64),'recovery',now(),now()+interval '24 hours');
select extensions.is(public.server_read_refund_detail_access(repeat('b',64),repeat('e',64)),null::jsonb,'ordinary recovery grant has no financial authority');
select extensions.is(public.server_read_refund_detail_access(repeat('c',64),repeat('e',64)),null::jsonb,'unknown grant indistinguishable');
insert into private.ticket_email_grants(token_hash,purpose,prepared_at,expires_at) values(repeat('c',64),'refund_notice',now()-interval '31 days',now()-interval '1 day');
select extensions.is(public.server_read_refund_detail_access(repeat('c',64),repeat('e',64)),null::jsonb,'expired financial grant fails closed');
select public.server_begin_ticket_email_dispatch((v->>'id')::uuid,(v->>'lease_id')::uuid) from claims;
select public.server_finish_ticket_email_dispatch((v->>'id')::uuid,(v->>'lease_id')::uuid,'unknown') from claims;
select extensions.ok((select bool_and(t.status=case when h.status='used' then 'used' else 'refunded' end and t.used_at is not distinct from h.used_at) from public.tickets t join history h using(id)),'unknown notice delivery never alters financial/admission truth or used timestamp');
select public.server_observe_ticket_email('refund-notice-delivered',(v->>'id')::uuid,'notice-provider','delivered',now()) from claims;
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
select extensions.is(public.get_organizer_refund_notice_status('a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders where kind='clean')),jsonb_build_object('state','accepted','observation','delivered'),'owner sees delivery separately from completed refund');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000002',true);
select extensions.throws_ok($q$select public.get_organizer_refund_notice_status('a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders where kind='clean'))$q$,'42501','Event unavailable','foreign organizer cannot read notice history');
-- Reschedules and event ending do not extend the prepared financial grant.
set local session_replication_role=replica;
update public.events set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where id='a6200000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select extensions.is(public.server_read_refund_detail_access(repeat('a',64),repeat('e',64))->>'kind','ready','refund detail remains available after event ends');
select public.server_revoke_ticket_email_grant((v->>'grantId')::uuid) from context;
select extensions.is(public.server_read_refund_detail_access(repeat('a',64),repeat('e',64)),null::jsonb,'revoked financial grant fails closed');
-- Receipt remains even after delivery retention: deletion is simulated in a rolled-back fixture only.
set local session_replication_role=replica;
delete from private.ticket_email_observations where attempt_id=(select (v->>'id')::uuid from claims);
delete from private.ticket_email_outbox where purpose='refund_notice';
set local session_replication_role=origin;
select extensions.is(public.server_enqueue_refund_notices(),0,'permanent receipt prevents requeue after outbox retention');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
select extensions.is(public.get_organizer_refund_notice_status('a6200000-0000-4000-8000-000000000001',(select id from fulfillment_orders where kind='clean'))->>'state','unknown','pruned delivery metadata does not falsely claim notice was never requested');
select * from extensions.finish();
rollback;
