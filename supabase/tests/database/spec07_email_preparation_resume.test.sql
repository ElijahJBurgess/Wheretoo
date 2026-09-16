begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
\ir spec07_email_fixture.inc
\ir helpers/core_ticket_truth_lite_setup.inc
reset role;
-- A separate two-item purchase uses one admission from each tier; original unit
-- sequences must remain [1,1] while collection display positions become [1,2].
update public.ticket_tiers set quantity_total=30 where event_id='a6200000-0000-4000-8000-000000000001';
create temporary table email_resume_proof(k text primary key,v jsonb);
insert into email_resume_proof
select 'reservation',to_jsonb(r) from public.server_reserve_checkout(
 'a6200000-0000-4000-8000-000000000001',
 '[{"tier_id":"a6300000-0000-4000-8000-000000000001","quantity":1},{"tier_id":"a6300000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
 'Canonical Guest','guest!vip@example.invalid','b6800000-0000-4000-8000-000000000001',repeat('8',64)) r;
select public.server_attach_checkout_session(o.id,'cs_test_emailresume',o.checkout_expires_at)
from public.orders o where o.id=(select (v->>'order_id')::uuid from email_resume_proof where k='reservation');
select public.server_record_webhook_receipt('evt_emailresume','checkout.session.completed',false,'cs_test_emailresume','2026-07-29.dahlia','2026-09-11 12:00:00+00',repeat('a',64));
select public.server_fulfill_paid_order('evt_emailresume',o.id,'cs_test_emailresume','pi_emailresume','ch_emailresume','tr_emailresume','fee_emailresume','txn_emailresume','cus_emailresume','payment','paid','usd',o.subtotal_minor,o.total_minor,o.application_fee_amount_minor,'acct_integrityfulfillment',pg_temp.ticket_manifest(o.id))
from public.orders o where o.id=(select (v->>'order_id')::uuid from email_resume_proof where k='reservation');
update public.tickets set status='used',used_at=now()-interval '1 minute' where id=(select id from public.tickets where order_id=(select (v->>'order_id')::uuid from email_resume_proof where k='reservation') order by order_item_id,unit_sequence limit 1);
insert into email_resume_proof select 'ticketsBefore',jsonb_agg(to_jsonb(t) order by t.order_item_id,t.unit_sequence) from public.tickets t where order_id=(select (v->>'order_id')::uuid from email_resume_proof where k='reservation');
select extensions.is((select jsonb_agg(t.unit_sequence order by t.order_item_id,t.unit_sequence) from public.tickets t where order_id=(select (v->>'order_id')::uuid from email_resume_proof where k='reservation')),'[1,1]'::jsonb,'two paid order items preserve original per-item sequences [1,1]');
insert into email_resume_proof values('claim',public.server_claim_ticket_email());
insert into email_resume_proof select 'prepared',public.server_prepare_ticket_email_context((v->>'id')::uuid,(v->>'lease_id')::uuid) from email_resume_proof where k='claim';
select extensions.is((select v->'sources'->0->>'email' from email_resume_proof where k='prepared'),'guest!vip@example.invalid','canonical exclamation recipient reaches actual prepared source');
select extensions.is((select jsonb_agg(a->'position' order by n) from email_resume_proof,jsonb_array_elements(v->'sources'->0->'admissions') with ordinality t(a,n) where k='prepared'),'[1,2]'::jsonb,'paid email projection uses collection display positions [1,2]');
select extensions.is((select jsonb_agg(a->'status' order by n) from email_resume_proof,jsonb_array_elements(v->'sources'->0->'admissions') with ordinality t(a,n) where k='prepared'),'["used","valid"]'::jsonb,'mixed Used/Valid history keeps stable paid collection ordering');
select extensions.is((select jsonb_agg(a->'admissionLabel' order by n) from email_resume_proof,jsonb_array_elements(v->'sources'->0->'admissions') with ordinality t(a,n) where k='prepared'),(select jsonb_agg(t.admission_label order by t.order_item_id,t.unit_sequence) from public.tickets t where order_id=(select (v->>'order_id')::uuid from email_resume_proof where k='reservation')),'email tier labels follow the existing paid resolver order');
select extensions.is((select (v->>'scheduledEndAt')::timestamptz from email_resume_proof where k='prepared'),(select ends_at from public.events where id='a6200000-0000-4000-8000-000000000001'),'grant persists canonical scheduled end at preparation');
-- Crash after prepare committed, before save: expire only its test lease, then
-- reschedule the still-eligible event and resume via the actual claim/prepare RPCs.
update private.ticket_email_outbox set lease_until=now()-interval '1 second' where id=(select (v->>'id')::uuid from email_resume_proof where k='claim');
update public.events set starts_at=starts_at+interval '10 days',ends_at=ends_at+interval '10 days' where id='a6200000-0000-4000-8000-000000000001';
insert into email_resume_proof values('reclaim',public.server_claim_ticket_email());
insert into email_resume_proof select 'resumed',public.server_prepare_ticket_email_context((v->>'id')::uuid,(v->>'lease_id')::uuid) from email_resume_proof where k='reclaim';
select extensions.is((select v->>'kind' from email_resume_proof where k='resumed'),'ready','prepared attempt resumes after worker crash and event reschedule');
select extensions.is((select v->'payload' from email_resume_proof where k='resumed'),'null'::jsonb,'resumption specifically occurs before a provider payload exists');
select extensions.is((select (v->>'scheduledEndAt')::timestamptz from email_resume_proof where k='resumed'),(select (v->'sources'->0->>'endsAt')::timestamptz from email_resume_proof where k='prepared'),'resumed grant keeps original scheduled end basis');
select extensions.is((select (v->'sources'->0->>'endsAt')::timestamptz from email_resume_proof where k='resumed'),(select ends_at from public.events where id='a6200000-0000-4000-8000-000000000001'),'live source separately reflects current schedule');
select extensions.is((select v->'expiresAt' from email_resume_proof where k='resumed'),(select v->'expiresAt' from email_resume_proof where k='prepared'),'resumption never extends the stored expiry');
select extensions.throws_ok($$update private.ticket_email_grants set scheduled_end_at=scheduled_end_at+interval '1 day'$$,'P0001','Immutable email grant','frozen scheduled end cannot be rewritten');
select extensions.ok((select public.server_save_ticket_email_payload((v->>'id')::uuid,(v->>'lease_id')::uuid,repeat('c',64),pg_temp.envelope()) from email_resume_proof where k='reclaim'),'resumed attempt can persist first immutable payload');
select extensions.is((select public.server_begin_ticket_email_dispatch((v->>'id')::uuid,(v->>'lease_id')::uuid)->>'dispatchCount' from email_resume_proof where k='reclaim'),'1','resumed attempt authorizes exactly its first provider dispatch');
select extensions.is((select jsonb_agg(to_jsonb(t) order by t.order_item_id,t.unit_sequence) from public.tickets t where order_id=(select (v->>'order_id')::uuid from email_resume_proof where k='reservation')),(select v from email_resume_proof where k='ticketsBefore'),'projection and grant resumption preserve all ticket identities, hashes, units and original Used timestamps');
-- Canonical percent recipient is also accepted by actual free issuance/source.
insert into email_resume_proof values('free',pg_temp.register(880,1,2,'Percent Guest','guest%vip@example.invalid'));
select extensions.is(private.ticket_email_source('free_registration',(select (v->>'registrationId')::uuid from email_resume_proof where k='free'))->>'email','guest%vip@example.invalid','canonical percent recipient reaches free email source unchanged');
insert into private.ticket_email_outbox(purpose,request_id,recovery_payload,lease_id,lease_until)
values('recovery','b6800000-0000-4000-8000-000000000002',pg_temp.envelope(),'b6800000-0000-4000-8000-000000000003',now()+interval '2 minutes');
insert into email_resume_proof select 'recovery',public.server_prepare_ticket_email_context(id,lease_id,'guest%vip@example.invalid') from private.ticket_email_outbox where request_id='b6800000-0000-4000-8000-000000000002';
select extensions.is((select v->'scheduledEndAt' from email_resume_proof where k='recovery'),'null'::jsonb,'recovery grant has no event-end basis');
select extensions.is((select (v->>'expiresAt')::timestamptz from email_resume_proof where k='recovery'),(select (v->>'preparedAt')::timestamptz+interval '24 hours' from email_resume_proof where k='recovery'),'recovery expiry remains preparation plus exactly 24 hours');
-- Export only a synthetic source projection, with no admission bearer/QR values,
-- so the Deno worker regression consumes the actual SQL boundary shape.
select 'SPEC07_PREPARED_CONTEXT:'||v::text from email_resume_proof where k='resumed';
select * from extensions.finish();
rollback;
