-- Review regressions: run on the named dedicated DB only; all mutations roll back.
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
select pg_temp.register(9801,1,2,'Coherent Guest','coherent@example.invalid');
select pg_temp.register(9802,1,2,'Incoherent Guest','incoherent@example.invalid');
-- Capture thrown errors distinctly: tests require a committed structured result, not an exception.
create function pg_temp.preview_result(p_event uuid,p_selector jsonb) returns jsonb language plpgsql as $$
begin return public.preview_owned_organizer_message(p_event,p_selector,'Review','Body');
exception when others then return jsonb_build_object('thrown',sqlerrm);end;$$;
-- Corruption cannot be produced by feature RPCs; temporarily bypass immutable source triggers in this rollback fixture.
set constraints all immediate;
alter table public.tickets disable trigger user;
update public.tickets set admission_label='Corrupt fixture' where registration_id=(select id from public.free_registrations where email='incoherent@example.invalid');
alter table public.tickets enable trigger user;
select is(pg_temp.preview_result('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}')->'error'->>'code','AUDIENCE_UNAVAILABLE','mixed coherent/incoherent free Everyone fails visibly');
select is((select pg_temp.preview_result('b6200000-0000-4000-8000-000000000002',jsonb_build_object('kind','registration','id',id))->'error'->>'code' from public.free_registrations where email='incoherent@example.invalid'),'AUDIENCE_UNAVAILABLE','selected incoherent registration unavailable');
select is((select pg_temp.preview_result('b6200000-0000-4000-8000-000000000002',jsonb_build_object('kind','registration','id',id))->>'recipientCount' from public.free_registrations where email='coherent@example.invalid'),'1','unrelated corrupt registration does not block selected coherent scope');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Review','Body',repeat('a',64),gen_random_uuid())$$,'P0001','AUDIENCE_UNAVAILABLE','submit cannot silently queue partial corrupt audience');
select is((select count(*) from private.organizer_messages),0::bigint,'incoherence writes no campaign');
select is((select count(*) from private.organizer_message_rate_events where lane='send'),0::bigint,'incoherence writes no send debit');
set constraints all immediate;
alter table public.tickets disable trigger user;
update public.tickets set admission_label='General Admission' where registration_id=(select id from public.free_registrations where email='incoherent@example.invalid');
alter table public.tickets enable trigger user;
-- Exercise direct authenticated RPC, including over-cap requests that previously rolled back their debit.
select public.server_configure_organizer_messages('{"maxRecipients":1,"previewMinute":2}');
delete from private.organizer_message_rate_events where lane='preview';
set local role authenticated;
select is(pg_temp.preview_result('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}')->'error'->>'code','LIMIT_REACHED','first rejected over-cap preview returns domain error');
select is(pg_temp.preview_result('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}')->'error'->>'code','LIMIT_REACHED','second rejected over-cap preview returns domain error');
select is(pg_temp.preview_result('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}')->'error'->>'code','PREVIEW_LIMIT_REACHED','third rejected request is rate-limited before scan');
reset role;
select is((select count(*) from private.organizer_message_rate_events where lane='preview'),2::bigint,'rejected requests commit two preview admissions');
select is((select count(*) from private.organizer_message_rate_events where lane='send'),0::bigint,'preview rejections never consume send budget');
select public.server_configure_organizer_messages('{"maxRecipients":1000,"previewMinute":30}');
-- Existing fixture-only source SELECT grants are revoked immediately after canonical fulfillment.
grant select on public.orders,public.order_items,public.tickets to service_role;
\ir ../../supabase/tests/database/helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('reviewclean','reviewclean',id,session_id) from fulfillment_orders;
insert into fulfillment_orders(kind,id,session_id) values('corrupt',pg_temp.create_multi_item_order('a6400000-0000-4000-8000-000000000009',repeat('9',64),'cs_test_reviewcorrupt'),'cs_test_reviewcorrupt');
select pg_temp.record_and_fulfill('reviewcorrupt','reviewcorrupt',id,session_id) from fulfillment_orders where kind='corrupt';
reset role;
revoke select on public.orders,public.order_items,public.tickets from service_role;
set constraints all immediate;
alter table public.tickets disable trigger user;
update public.tickets set admission_label='Corrupt fixture' where order_id=(select id from fulfillment_orders where kind='corrupt');
alter table public.tickets enable trigger user;
select is(pg_temp.preview_result('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}')->'error'->>'code','AUDIENCE_UNAVAILABLE','mixed coherent/incoherent paid Everyone fails visibly');
select is(pg_temp.preview_result('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000001"}')->'error'->>'code','AUDIENCE_UNAVAILABLE','selected purchased tier detects corrupt relevant order');
select is(pg_temp.preview_result('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000004"}')->>'recipientCount','0','unrelated unpurchased tier remains valid empty scope');
select is((select pg_temp.preview_result('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',id))->'error'->>'code' from fulfillment_orders where kind='corrupt'),'AUDIENCE_UNAVAILABLE','selected corrupt order fails unavailable');
select is((select pg_temp.preview_result('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',id))->>'recipientCount' from fulfillment_orders where kind='clean'),'1','selected coherent order not blocked by unrelated corruption');
select is((select count(*) from private.organizer_messages),0::bigint,'mixed-source failures create no campaign');
select is((select count(*) from private.organizer_message_rate_events where lane='send'),0::bigint,'mixed-source failures create no send debit');
select * from finish();
rollback;
