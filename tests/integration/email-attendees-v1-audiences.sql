-- Canonical paid/free relationship variants; every mutation rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
truncate private.organizer_messages cascade;
truncate private.ticket_email_outbox cascade;
\ir ../../supabase/tests/database/free_registration_fixture.inc
update private.ticket_email_settings set enabled_at=null,worker_enabled=false;
select public.server_configure_organizer_messages('{"acceptingSends":true,"workerEnabled":true,"senderEmail":"notify@example.invalid","replyTo":"support@example.invalid","appOrigin":"https://example.invalid","capacityPerMinute":10,"capacityPerDay":100,"capacityPerMonth":1000,"healthMaxAgeSeconds":300}');
select public.server_acknowledge_organizer_message_worker();
select pg_temp.register(8201,3,2,'Group','group@example.invalid');
select pg_temp.register(8202,1,2,'Inactive','inactive@example.invalid');
select is(public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Audience','Body')->>'recipientCount','2','group of three plus single registration is two recipients');
select public.server_redeem_organizer_ticket('b6100000-0000-4000-8000-000000000001','b6200000-0000-4000-8000-000000000002',credential_hash) from public.tickets where registration_id=(select id from public.free_registrations where email='group@example.invalid');
select is(public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Audience','Body')->>'recipientCount','2','checked-in free group remains an active relationship');
-- Operational cancellation path is tested elsewhere; fixture state mirrors its canonical columns/admissions.
set constraints all immediate;
alter table public.free_registrations disable trigger user;
alter table public.tickets disable trigger user;
update public.free_registrations set status='cancelled',cancelled_at=clock_timestamp() where email='inactive@example.invalid';
update public.tickets set status='cancelled',cancelled_at=clock_timestamp() where registration_id=(select id from public.free_registrations where email='inactive@example.invalid');
alter table public.free_registrations enable trigger user;
alter table public.tickets enable trigger user;
select is(public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Audience','Body')->>'recipientCount','1','cancelled registration excluded');
select is(public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002',jsonb_build_object('kind','registration','id',(select id from public.free_registrations where email='inactive@example.invalid')),'Audience','Body')->'error'->>'code','INACTIVE_INDIVIDUAL','cancelled selected registration denied');
-- The existing canonical payment helper needs fixture-only read grants, revoked before authorization assertions.
grant select on public.orders,public.order_items,public.tickets to service_role;
\ir ../../supabase/tests/database/helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('audienceoriginal','audienceoriginal',id,session_id) from fulfillment_orders;
reset role;
create function pg_temp.audience_order(p_n integer,p_qty integer,p_email text) returns uuid language plpgsql as $$
declare o uuid;s text:='cs_test_audience'||p_n;t integer:=p_qty*2000;
begin
 select order_id into o from public.server_reserve_checkout('a6200000-0000-4000-8000-000000000001',jsonb_build_array(jsonb_build_object('tier_id','a6300000-0000-4000-8000-000000000001','quantity',p_qty)),'Audience Buyer',p_email,('a6500000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,encode(extensions.digest('audience:'||p_n,'sha256'),'hex'));
 perform public.server_attach_checkout_session(o,s,(select checkout_expires_at from public.orders where id=o));
 perform public.server_record_webhook_receipt('evt_audience'||p_n,'checkout.session.completed',false,s,'2026-07-29.dahlia',clock_timestamp(),repeat('a',64));
 perform public.server_fulfill_paid_order('evt_audience'||p_n,o,s,'pi_audience'||p_n,'ch_audience'||p_n,'tr_audience'||p_n,'fee_audience'||p_n,'txn_audience'||p_n,'cus_audience'||p_n,'payment','paid','usd',t,t,(select application_fee_amount_minor from public.orders where id=o),'acct_integrityfulfillment',pg_temp.ticket_manifest(o));
 return o;
end;$$;
create temp table audience_orders(k text,id uuid);
insert into audience_orders values('one',pg_temp.audience_order(1,1,'one@example.invalid'));
insert into audience_orders values('four',pg_temp.audience_order(2,4,'four@example.invalid'));
insert into audience_orders values('same',pg_temp.audience_order(3,1,'FOUR@example.invalid'));
revoke select on public.orders,public.order_items,public.tickets from service_role;
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',(select id from audience_orders where k='one')),'Audience','Body')->>'recipientCount','1','one purchased ticket is one email');
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',(select id from audience_orders where k='four')),'Audience','Body')->>'recipientCount','1','four purchased tickets is one email');
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Audience','Body')->>'recipientCount','3','same normalized buyer across two paid orders dedupes; different buyers stay distinct');
set constraints all immediate;
alter table public.ticket_tiers disable trigger user;
update public.ticket_tiers set name='General Admission' where id='a6300000-0000-4000-8000-000000000004';
alter table public.ticket_tiers enable trigger user;
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000004"}','Audience','Body')->>'recipientCount','0','same tier name with different unpurchased UUID never matches');
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000001"}','Audience','Body')->>'recipientCount','3','actual purchased tier UUID targets all three buyers');
insert into private.order_refund_operations(order_id,idempotency_key,snapshot,state) select id,'whereto-refund-integrity-v1:'||id,'{}','review' from audience_orders where k='four';
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Audience','Body')->>'recipientCount','3','one eligible same-email order suffices while another is refund-review');
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',(select id from audience_orders where k='four')),'Audience','Body')->'error'->>'code','INACTIVE_INDIVIDUAL','inactive selected order is never rescued by another same-email order');
set constraints all immediate;
alter table public.orders disable trigger user;
alter table public.tickets disable trigger user;
update public.orders set status='refunded',refunded_at=clock_timestamp() where id=(select id from audience_orders where k='one');
update public.tickets set status='refunded',refunded_at=clock_timestamp() where order_id=(select id from audience_orders where k='one');
alter table public.orders enable trigger user;
alter table public.tickets enable trigger user;
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Audience','Body')->>'recipientCount','2','refunded order and admissions excluded from Everyone');
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',(select id from audience_orders where k='one')),'Audience','Body')->'error'->>'code','INACTIVE_INDIVIDUAL','refunded selected individual denied');
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',(select id from audience_orders where k='one')),'Audience','Body')$$,'P0001','EVENT_UNAVAILABLE','foreign event/order cannot be targeted by another organizer');
select * from finish();
rollback;
