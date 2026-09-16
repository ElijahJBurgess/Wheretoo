begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir spec07_email_fixture.inc
update private.ticket_email_settings set enabled_at=null,worker_enabled=false;
\ir helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('spec10used','spec10used',id,session_id) from fulfillment_orders;
reset role;
select public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',t.credential_hash) from public.tickets t where t.event_id='a6200000-0000-4000-8000-000000000001';
select is(public.preview_owned_event_notice('a6200000-0000-4000-8000-000000000001','event_change')->>'eligibleMessages','1','fully Used paid order still receives change notice');
select is((select private.event_notice_detail('paid_order',id)->>'canViewTickets' from public.orders where event_id='a6200000-0000-4000-8000-000000000001'),'false','fully Used paid source gains no new admission access');
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
select pg_temp.register(10,2);
select public.server_redeem_organizer_ticket('b6100000-0000-4000-8000-000000000001','b6200000-0000-4000-8000-000000000001',t.credential_hash) from public.tickets t where t.event_id='b6200000-0000-4000-8000-000000000001' order by t.id limit 1;
select public.submit_owned_event_notice('b6200000-0000-4000-8000-000000000001','event_change',public.preview_owned_event_notice('b6200000-0000-4000-8000-000000000001','event_change')->>'previewToken','b6500000-0000-4000-8000-000000000088');
-- Last check-in after deliberate submit must not suppress the factual update.
select public.server_redeem_organizer_ticket('b6100000-0000-4000-8000-000000000001','b6200000-0000-4000-8000-000000000001',t.credential_hash) from public.tickets t where t.event_id='b6200000-0000-4000-8000-000000000001' and t.status='valid';
select ok((select private.event_notice_attempt_source(id) is not null from private.ticket_email_outbox where purpose='event_change'),'last-ticket check-in preserves queued factual notice');
select is((select private.event_notice_attempt_source(id)->'detail'->>'canViewTickets' from private.ticket_email_outbox where purpose='event_change'),'false','last-ticket check-in removes ticket action without removing notice');
select is(public.preview_owned_event_notice('b6200000-0000-4000-8000-000000000001','event_change')->>'alreadySubmitted','1','fully Used free source remains canonical submitted audience');
update private.ticket_email_settings set worker_enabled=true,enabled_at=now()-interval '1 minute';
create temp table claims as select public.server_claim_ticket_email() q;
create temp table prepared as select public.server_prepare_ticket_email_context((q->>'id')::uuid,(q->>'lease_id')::uuid) c from claims;
select is((select c->>'purpose' from prepared),'event_change','fully Used change notice prepares through shared worker');
select ok((select public.server_save_ticket_email_payload((q->>'id')::uuid,(q->>'lease_id')::uuid,repeat('c',64),pg_temp.envelope()) from claims),'status-only payload uses existing grant');
select is(public.server_read_event_status_access(repeat('c',64),repeat('d',64))->>'kind','ready','Used source can read private current status');
select is(public.server_read_ticket_email_access(repeat('c',64),repeat('d',64),0,1),null::jsonb,'Used status-only grant cannot gain QR access');
select ok((select public.server_begin_ticket_email_dispatch((q->>'id')::uuid,(q->>'lease_id')::uuid) is not null from claims),'last-ticket check-in does not suppress dispatch');
select * from finish();rollback;
