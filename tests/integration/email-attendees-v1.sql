-- Rollback-only proof, including canonical registration/payment fixture functions.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Isolate message fixtures transactionally; rollback restores prior dedicated-stack proof rows.
truncate private.organizer_messages cascade;
truncate private.ticket_email_outbox cascade;
\ir ../../supabase/tests/database/spec07_email_fixture.inc
update private.ticket_email_settings set enabled_at=null,worker_enabled=false;
select ok(to_regclass('private.organizer_messages') is not null,'separate ledger exists');
select ok((select count(*)=2 and bool_and(pg_get_expr(d.adbin,d.adrelid)='false') from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='private.organizer_message_settings'::regclass and a.attname in ('accepting_sends','worker_enabled')),'activation schema defaults closed');
select public.server_configure_organizer_messages('{"acceptingSends":true,"workerEnabled":true,"senderEmail":"notify@example.invalid","replyTo":"support@example.invalid","appOrigin":"https://example.invalid","mediaOrigin":"https://media.example.invalid","capacityPerMinute":10,"capacityPerDay":100,"capacityPerMonth":1000,"healthMaxAgeSeconds":300}');
select public.server_acknowledge_organizer_message_worker();
select pg_temp.register(9001,2,2);
select pg_temp.register(9002,3,2,'Same Guest','pat@example.invalid');
select pg_temp.register(9003,1,2,'Second Guest','pat+other@example.invalid');
create temp table proof(k text primary key,v jsonb);
insert into proof values('preview',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}',' Hello 🌎 ',E'first\r\n<script>plain</script>'));
select is((select v->>'recipientCount' from proof where k='preview'),'2','group and same canonical address deduplicate; plus alias distinct');
select is((select v->>'subject' from proof where k='preview'),'Hello 🌎','Unicode subject trimmed');
select is((select v->>'body' from proof where k='preview'),E'first\n<script>plain</script>','plain text CRLF normalized, HTML remains text');
select ok((select not(v ? 'addresses') and not(v::text like '%pat@%') from proof where k='preview'),'preview has no destination list');
select is(public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Hi','Body')->>'recipientCount','0','empty preview reports authoritative zero');
select is((public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone","email":"evil@example.invalid"}','Hi','Body'))->'error'->>'code','INVALID_SELECTOR','arbitrary address selector denied');
select is((public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000001"}','Hi','Body'))->'error'->>'code','INVALID_SELECTOR','free tier selector denied');
select throws_ok($$select private.organizer_message_text(E'Hi\r\nBcc:x','body')$$,'P0001','INVALID_SUBJECT','header injection denied');
select throws_ok($$select private.organizer_message_text('Hi',E'body\001')$$,'P0001','INVALID_BODY','unsafe body controls denied');
select lives_ok($$select private.organizer_message_text(repeat('🌎',120),repeat('🌎',5000))$$,'codepoint maximum accepted');
select throws_ok($$select private.organizer_message_text(repeat('🌎',121),'body')$$,'P0001','INVALID_SUBJECT','subject boundary enforced');
select throws_ok($$select private.organizer_message_text('Hi',repeat('🌎',5001))$$,'P0001','INVALID_BODY','body boundary enforced');
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.get_owned_organizer_message_options('b6200000-0000-4000-8000-000000000002')$$,'P0001','EVENT_UNAVAILABLE','foreign owner denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.get_owned_organizer_message_options('b6200000-0000-4000-8000-000000000002')$$,'P0001','UNAUTHORIZED','anonymous denied');
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
select ok(not has_function_privilege('authenticated','public.server_claim_organizer_message_recipient()','execute'),'browser cannot claim');
select ok(not has_function_privilege('anon','public.preview_owned_organizer_message(uuid,jsonb,text,text)','execute'),'anon cannot preview');
select ok(not has_table_privilege('service_role','private.organizer_message_recipients','select'),'service has no broad recipient table read');
select ok(not has_table_privilege('authenticated','private.organizer_messages','insert'),'browser cannot insert message');
insert into proof values('ticket_before',(select jsonb_agg(to_jsonb(t) order by id) from public.tickets t));
insert into proof values('queue_before',(select jsonb_build_object('outbox',count(*),'grants',(select count(*) from private.ticket_email_grants),'members',(select count(*) from private.ticket_email_members)) from private.ticket_email_outbox));
insert into proof select 'receipt',public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Hello 🌎',E'first\n<script>plain</script>',v->>'fingerprint','b6700000-0000-4000-8000-000000000001') from proof where k='preview';
select is((select v->>'queuedRecipients' from proof where k='receipt'),'2','atomic unique recipient snapshot');
select is((select count(*) from private.organizer_messages),1::bigint,'one durable message');
select is((select count(*) from private.organizer_message_recipients),2::bigint,'one row per unique destination');
select is((select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Hello 🌎',E'first\n<script>plain</script>',v->>'fingerprint','b6700000-0000-4000-8000-000000000001') from proof where k='preview'),(select v from proof where k='receipt'),'lost-response replay same receipt');
select is((select count(*) from private.organizer_message_rate_events where lane='send'),1::bigint,'replay charged once');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Changed',E'first\n<script>plain</script>',(select v->>'fingerprint' from proof where k='preview'),'b6700000-0000-4000-8000-000000000001')$$,'P0001','REQUEST_CONFLICT','same request changed intent conflicts');
select is(public.get_owned_organizer_message_receipt('b6200000-0000-4000-8000-000000000002','b6700000-0000-4000-8000-000000000001'),(select v from proof where k='receipt'),'receipt lookup exact');
select pg_temp.register(9004,1,2,'Third Guest','third@example.invalid');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Hello 🌎',E'first\n<script>plain</script>',(select v->>'fingerprint' from proof where k='preview'),'b6700000-0000-4000-8000-000000000002')$$,'P0001','PREVIEW_CHANGED','new audience rejects stale preview');
select is((select count(*) from private.organizer_messages),1::bigint,'drift creates no partial campaign');
select is(private.organizer_message_event_policy('b6200000-0000-4000-8000-000000000002',(select ends_at+interval '168 hours' from public.events where id='b6200000-0000-4000-8000-000000000002')),null::text,'exact deadline allowed');
select is(private.organizer_message_event_policy('b6200000-0000-4000-8000-000000000002',(select ends_at+interval '168 hours 0.000001 seconds' from public.events where id='b6200000-0000-4000-8000-000000000002')),'SEND_WINDOW_CLOSED','one microsecond after deadline denied');
select is(private.organizer_message_event_policy('b6200000-0000-4000-8000-000000000002',(select ends_at+interval '200 hours' from public.events where id='b6200000-0000-4000-8000-000000000002'),true),null::text,'committed dispatch ignores seven-day expiry');
select throws_ok($$update private.organizer_messages set body='rewrite'$$,'P0001','Immutable organizer message','message content immutable');
select throws_ok($$update private.organizer_message_recipients set normalized_email='evil@example.invalid'$$,'P0001','Immutable organizer recipient','snapshot address immutable');
insert into proof values('claim',public.server_claim_organizer_message_recipient());
select ok((select v is not null from proof where k='claim'),'separate recipient claim');
select is(public.server_claim_organizer_message_recipient(),null::jsonb,'one organizer lease bounds concurrency');
select ok((select public.server_prepare_organizer_message_recipient((v->>'attemptId')::uuid,(v->>'leaseId')::uuid)->>'recipient' is not null from proof where k='claim'),'worker prepares exactly one destination');
select ok((select public.server_save_organizer_message_payload((v->>'attemptId')::uuid,(v->>'leaseId')::uuid,pg_temp.envelope()) from proof where k='claim'),'payload saved');
select ok(not (select public.server_save_organizer_message_payload((v->>'attemptId')::uuid,(v->>'leaseId')::uuid,pg_temp.envelope()) from proof where k='claim'),'payload cannot replace');
insert into proof select 'dispatch',public.server_begin_organizer_message_dispatch((v->>'attemptId')::uuid,(v->>'leaseId')::uuid) from proof where k='claim';
select is((select v->>'idempotencyKey' from proof where k='dispatch'),'organizer-message/'||(select v->>'attemptId' from proof where k='claim'),'stable independent provider idempotency key');
select is((select state from private.organizer_message_recipients where id=(select (v->>'attemptId')::uuid from proof where k='claim')),'sending','durable pre-network dispatch intent');
select ok((select public.server_finish_organizer_message_dispatch((v->>'attemptId')::uuid,(v->>'leaseId')::uuid,'unknown') from proof where k='claim'),'timeout records unknown');
select ok((select public.server_observe_email('organizer-delivered',(v->>'attemptId')::uuid,'organizer-provider','delivered',now()) from proof where k='claim'),'verified dispatcher resolves organizer unknown');
select ok((select public.server_observe_email('organizer-delivered',(v->>'attemptId')::uuid,'organizer-provider','delivered',now()) from proof where k='claim'),'duplicate observation idempotent');
select ok(not (select public.server_observe_email('organizer-delivered',(v->>'attemptId')::uuid,'organizer-provider','sent',now()) from proof where k='claim'),'conflicting webhook replay denied');
select ok(not (select public.server_observe_email('wrong-provider',(v->>'attemptId')::uuid,'wrong-provider','sent',now()) from proof where k='claim'),'provider identity bound');
select ok((select public.server_observe_email('organizer-complaint',(v->>'attemptId')::uuid,'organizer-provider','complained',now()) from proof where k='claim'),'complaint stored');
select ok((select public.server_observe_email('organizer-late-sent',(v->>'attemptId')::uuid,'organizer-provider','sent',now()-interval '1 hour') from proof where k='claim'),'late sent evidence retained');
select is((select observation from private.organizer_message_recipients where id=(select (v->>'attemptId')::uuid from proof where k='claim')),'complained','complaint precedence preserved');
select ok((select attempt_id is null and organizer_recipient_id is not null from private.ticket_email_recipient_blocks),'shared suppression has organizer provenance');
select is((select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where registration_id is distinct from (select id from public.free_registrations where email='third@example.invalid')),(select v from proof where k='ticket_before'),'organizer messaging does not mutate existing tickets');
select is((select jsonb_build_object('outbox',count(*),'grants',(select count(*) from private.ticket_email_grants),'members',(select count(*) from private.ticket_email_members)) from private.ticket_email_outbox),(select v from proof where k='queue_before'),'no ticket grants, membership or queue entries created');
select is(public.server_prune_organizer_message_history(),0::bigint,'recent evidence retained');

-- Paid relationships reuse checkout fulfillment, including real item/ticket UUIDs.
-- Existing payment helper reads sources as service_role; fixture-only grants roll back.
grant select on public.orders,public.order_items,public.tickets to service_role;
\ir ../../supabase/tests/database/helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('emailmsg','emailmsg',id,session_id) from fulfillment_orders;
reset role;
revoke select on public.orders,public.order_items,public.tickets from service_role;
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Paid','Body')->>'recipientCount','1','three paid admissions produce one recipient');
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000001"}','Paid','Body')->>'recipientCount','1','purchased first tier included');
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000002"}','Paid','Body')->>'recipientCount','1','purchased second tier included');
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000004"}','Paid','Body')->>'recipientCount','0','unpurchased tier excluded');
select is((public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000003"}','Paid','Body'))->'error'->>'code','INVALID_TIER','foreign tier denied');
update public.ticket_tiers set status='archived' where id='a6300000-0000-4000-8000-000000000001';
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"tier","id":"a6300000-0000-4000-8000-000000000001"}','Paid','Body')->>'recipientCount','1','historically purchased archived tier remains targetable');
select public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',credential_hash) from public.tickets where event_id='a6200000-0000-4000-8000-000000000001';
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Paid','Body')->>'recipientCount','1','all-used paid order remains active relationship');
select is((select public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',id),'Paid','Body')->>'recipientCount' from fulfillment_orders),'1','individual selected qualifying order works');
select is((public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"order","id":"ffffffff-ffff-4fff-8fff-ffffffffffff"}','Paid','Body'))->'error'->>'code','INACTIVE_INDIVIDUAL','invalid selected order never falls back');
-- All unresolved or failed refund workflows exclude otherwise paid Used admissions.
insert into private.order_refund_operations(order_id,idempotency_key,snapshot,state)
select id,'whereto-refund-integrity-v1:'||id,'{}','submitting' from fulfillment_orders;
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Paid','Body')->>'recipientCount','0','submitting refund excludes');
update private.order_refund_operations set state='processing';
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Paid','Body')->>'recipientCount','0','processing refund excludes');
update private.order_refund_operations set state='unknown';
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Paid','Body')->>'recipientCount','0','unknown refund excludes');
update private.order_refund_operations set state='review';
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Paid','Body')->>'recipientCount','0','review refund excludes');
update private.order_refund_operations set state='failed';
select is(public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Paid','Body')->>'recipientCount','0','failed refund workflow excludes conservatively');
select is((public.preview_owned_organizer_message('a6200000-0000-4000-8000-000000000001',jsonb_build_object('kind','order','id',(select id from fulfillment_orders)),'Paid','Body'))->'error'->>'code','INACTIVE_INDIVIDUAL','inactive individual cannot be rescued');
-- Narrow capacity/limit configuration is independent of ticket settings.
select public.server_configure_organizer_messages('{"eventHour":1}');
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Limit','Body',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Limit','Body')->>'fingerprint','b6700000-0000-4000-8000-000000000003')$$,'P0001','LIMIT_REACHED','configured event hourly limit refuses atomically');
select is((select count(*) from private.organizer_messages),1::bigint,'limited submission adds no message');
select public.server_configure_organizer_messages('{"previewMinute":1}');
select is((public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Limit','Body'))->'error'->>'code','PREVIEW_LIMIT_REACHED','preview limiter separate from send budget');
select public.server_configure_organizer_messages('{"previewMinute":30}');
select throws_ok($$delete from private.organizer_messages$$,'P0001','Durable organizer message receipt','durable receipt cannot be deleted');

-- Shared suppression provenance switches in both directions without losing complaint severity.
insert into private.ticket_email_outbox(id,purpose,registration_id,state,first_possible_dispatch_at,dispatch_count,recipient_hash)
select 'b6800000-0000-4000-8000-000000000001','initial',r.id,'unknown',now(),1,q.recipient_hash
from private.organizer_message_recipients q join public.free_registrations r on r.email=q.normalized_email
where q.id=(select (v->>'attemptId')::uuid from proof where k='claim') limit 1;
select ok(public.server_observe_email('ticket-cross-provenance','b6800000-0000-4000-8000-000000000001','ticket-provider','bounced',now()),'ticket bounce replaces organizer provenance safely');
select ok((select attempt_id is not null and organizer_recipient_id is null and reason='complained' from private.ticket_email_recipient_blocks),'ticket upsert clears organizer FK preserving complaint');
select ok((select public.server_observe_email('organizer-reclaim',(v->>'attemptId')::uuid,'organizer-provider','bounced',now()) from proof where k='claim'),'organizer bounce replaces ticket provenance safely');
select ok((select attempt_id is null and organizer_recipient_id is not null and reason='complained' from private.ticket_email_recipient_blocks),'organizer upsert clears ticket FK preserving complaint');
select ok(not public.server_observe_email('organizer-delivered','b6800000-0000-4000-8000-000000000001','ticket-provider','sent',now()),'webhook ID cannot replay into other ledger');
select is((select private.ticket_email_source('free_registration',r.id)->>'reason' from public.free_registrations r join private.organizer_message_recipients q on r.email=q.normalized_email where q.id=(select (v->>'attemptId')::uuid from proof where k='claim') limit 1),'recipient_blocked','ticket reader respects organizer suppression');
select throws_ok($$insert into private.organizer_message_recipients(message_id,normalized_email,recipient_hash) select id,'extra@example.invalid',private.ticket_email_fingerprint('extra@example.invalid') from private.organizer_messages limit 1$$,'P0001','Immutable organizer membership','snapshot cannot gain a later member');
-- Second recipient is independently suppressed immediately before dispatch.
insert into proof values('claim2',public.server_claim_organizer_message_recipient());
select ok((select v is not null from proof where k='claim2'),'sibling remains independently claimable');
select public.server_save_organizer_message_payload((v->>'attemptId')::uuid,(v->>'leaseId')::uuid,pg_temp.envelope()) from proof where k='claim2';
insert into private.ticket_email_recipient_blocks(recipient_hash,reason,attempt_id)
select recipient_hash,'bounced','b6800000-0000-4000-8000-000000000001' from private.organizer_message_recipients where id=(select (v->>'attemptId')::uuid from proof where k='claim2');
select is((select public.server_begin_organizer_message_dispatch((v->>'attemptId')::uuid,(v->>'leaseId')::uuid) from proof where k='claim2'),null::jsonb,'ticket suppression arriving after preview stops organizer dispatch');
select is((select state from private.organizer_message_recipients where id=(select (v->>'attemptId')::uuid from proof where k='claim2')),'suppressed','never-dispatched sibling accurately suppressed');
select is((select recipient_count from private.organizer_messages),2,'later suppression leaves immutable confirmed count');
-- Cap proof uses canonical registration issuance, never fake member inserts.
select public.server_configure_organizer_messages('{"eventHour":3}');
update public.events set capacity=null where id='b6200000-0000-4000-8000-000000000001';
do $$ begin for i in 100..1099 loop perform pg_temp.register(i,1,1,'Cap Guest','cap'||i||'@example.invalid');end loop;end $$;
insert into proof values('cap',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Cap','Body'));
select is((select v->>'recipientCount' from proof where k='cap'),'1000','1000 unique recipients preview exactly');
insert into proof select 'capReceipt',public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Cap','Body',v->>'fingerprint','b6700000-0000-4000-8000-000000000004') from proof where k='cap';
select is((select v->>'queuedRecipients' from proof where k='capReceipt'),'1000','1000 recipients confirmed atomically');
select pg_temp.register(1100,1,1,'Cap Guest','cap1100@example.invalid');
select is((public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000001','{"kind":"everyone"}','Cap','Body'))->'error'->>'code','LIMIT_REACHED','1001 rejects instead of truncating');
select is((select count(*) from private.organizer_message_recipients where message_id=(select (v->>'messageId')::uuid from proof where k='capReceipt')),1000::bigint,'cap rejection preserves original complete snapshot');
-- Transactional backlog yields before organizer claims.
insert into private.ticket_email_outbox(id,purpose,registration_id)
select 'b6800000-0000-4000-8000-000000000002','initial',id from public.free_registrations where email='cap100@example.invalid';
select is(public.server_claim_organizer_message_recipient(),null::jsonb,'ready transactional work wins over bulk organizer queue');
update private.ticket_email_outbox set state='suppressed',dispatch_stopped_reason='fixture' where id='b6800000-0000-4000-8000-000000000002';
insert into proof values('capClaim',public.server_claim_organizer_message_recipient());
select public.server_save_organizer_message_payload((v->>'attemptId')::uuid,(v->>'leaseId')::uuid,pg_temp.envelope()) from proof where k='capClaim';
select public.server_configure_organizer_messages('{"capacityPerMinute":1}');
select is((select public.server_begin_organizer_message_dispatch((v->>'attemptId')::uuid,(v->>'leaseId')::uuid) from proof where k='capClaim'),null::jsonb,'dispatch-time global token gate blocks exhausted organizer share');
select is((select dispatch_count from private.organizer_message_recipients where id=(select (v->>'attemptId')::uuid from proof where k='capClaim')),0,'yield never claims network dispatch occurred');


-- Each independent rolling budget fails atomically and can be configured separately.
delete from private.ticket_email_recipient_blocks;
select public.server_configure_organizer_messages('{"eventHour":3,"eventDay":1}');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Daily','Body',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Daily','Body')->>'fingerprint',gen_random_uuid())$$,'P0001','LIMIT_REACHED','event daily budget enforced');
select public.server_configure_organizer_messages('{"eventDay":10,"organizerDay":2}');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Daily','Body',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Daily','Body')->>'fingerprint',gen_random_uuid())$$,'P0001','LIMIT_REACHED','organizer daily budget spans events');
select public.server_configure_organizer_messages('{"organizerDay":20,"deliveryDay":1002}');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Daily','Body',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Daily','Body')->>'fingerprint',gen_random_uuid())$$,'P0001','LIMIT_REACHED','organizer delivery-volume budget enforced');
select public.server_configure_organizer_messages('{"deliveryDay":5000,"recipientDay":1}');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Daily','Body',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Daily','Body')->>'fingerprint',gen_random_uuid())$$,'P0001','LIMIT_REACHED','same-organizer recipient frequency enforced');
select public.server_configure_organizer_messages('{"recipientDay":3}');
insert into proof values('sameCount',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Drift','Body'));
insert into private.ticket_email_recipient_blocks(recipient_hash,reason,attempt_id) values(private.ticket_email_fingerprint('third@example.invalid'),'bounced','b6800000-0000-4000-8000-000000000001');
select pg_temp.register(9005,1,2,'Replacement Guest','replacement@example.invalid');
select is(public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Drift','Body')->>'recipientCount',(select v->>'recipientCount' from proof where k='sameCount'),'membership substitution preserves count');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Drift','Body',(select v->>'fingerprint' from proof where k='sameCount'),gen_random_uuid())$$,'P0001','PREVIEW_CHANGED','same count different membership rejected');
insert into proof values('senderDrift',public.preview_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Sender','Body'));
select public.server_configure_organizer_messages('{"senderEmail":"changed@example.invalid"}');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Sender','Body',(select v->>'fingerprint' from proof where k='senderDrift'),gen_random_uuid())$$,'P0001','PREVIEW_CHANGED','sender snapshot drift rejected');
select public.server_configure_organizer_messages('{"senderEmail":"notify@example.invalid"}');
select throws_ok($$select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Changed subject','Body',(select v->>'fingerprint' from proof where k='senderDrift'),gen_random_uuid())$$,'P0001','PREVIEW_CHANGED','content drift rejected');
select is((select count(*) from private.organizer_messages),2::bigint,'failed budgets and drift never debit/create campaigns');
-- Lease expiry recovers uncertainty; retry rejection cannot erase earlier possible acceptance.
select public.server_configure_organizer_messages('{"capacityPerMinute":10}');
insert into private.organizer_messages(id,event_id,requested_by,request_id,request_digest,selector,preview_fingerprint,subject,body,facts,deadline_basis,recipient_count)
select 'b6900000-0000-4000-8000-000000000003',event_id,requested_by,'b6910000-0000-4000-8000-000000000003',repeat('3',64),selector,preview_fingerprint,'Retry','Sensitive',facts,deadline_basis,1 from private.organizer_messages where request_id='b6700000-0000-4000-8000-000000000001';
insert into private.organizer_message_recipients(id,message_id,normalized_email,recipient_hash,state,payload,first_possible_dispatch_at,dispatch_count,lease_id,lease_until,next_attempt_at)
values('b6920000-0000-4000-8000-000000000003','b6900000-0000-4000-8000-000000000003','retry@example.invalid',private.ticket_email_fingerprint('retry@example.invalid'),'sending',pg_temp.envelope(),now()-interval '1 hour',1,gen_random_uuid(),now()-interval '1 minute',now()-interval '1 day');
insert into proof values('retryClaim',public.server_claim_organizer_message_recipient());
select is((select v->>'attemptId' from proof where k='retryClaim'),'b6920000-0000-4000-8000-000000000003','oldest expired lease reclaimed');
select is((select state from private.organizer_message_recipients where id='b6920000-0000-4000-8000-000000000003'),'unknown','crash after dispatch stays uncertain');
select is(public.server_begin_organizer_message_dispatch('b6920000-0000-4000-8000-000000000003',gen_random_uuid()),null::jsonb,'stale/wrong lease cannot dispatch');
insert into proof select 'retryDispatch',public.server_begin_organizer_message_dispatch((v->>'attemptId')::uuid,(v->>'leaseId')::uuid) from proof where k='retryClaim';
select is((select v->'payload' from proof where k='retryDispatch'),pg_temp.envelope(),'retry preserves immutable encrypted request');
select is((select v->>'idempotencyKey' from proof where k='retryDispatch'),'organizer-message/b6920000-0000-4000-8000-000000000003','retry preserves provider key');
select ok((select public.server_finish_organizer_message_dispatch((v->>'attemptId')::uuid,(v->>'leaseId')::uuid,'failed') from proof where k='retryClaim'),'retry rejection recorded');
select is((select state from private.organizer_message_recipients where id='b6920000-0000-4000-8000-000000000003'),'unknown','later rejection cannot prove earlier dispatch failed');
select ok((select next_attempt_at>now()+interval '4 minutes' from private.organizer_message_recipients where id='b6920000-0000-4000-8000-000000000003'),'second-attempt backoff applied');
update private.organizer_message_recipients set dispatch_count=6,next_attempt_at=now()-interval '1 day' where id='b6920000-0000-4000-8000-000000000003';
select public.server_claim_organizer_message_recipient();
select is((select dispatch_stopped_reason from private.organizer_message_recipients where id='b6920000-0000-4000-8000-000000000003'),'retry_window_exhausted','six-attempt exhaustion permanently stops dispatch');
select is((select state from private.organizer_message_recipients where id='b6920000-0000-4000-8000-000000000003'),'unknown','exhaustion retains unknown truth');
-- Old synthetic ledger fixtures exercise terminal privacy retention without aging live sources.
insert into private.organizer_messages(id,event_id,requested_by,request_id,request_digest,selector,preview_fingerprint,subject,body,facts,confirmed_at,deadline_basis,recipient_count)
select 'b6900000-0000-4000-8000-000000000001',event_id,requested_by,'b6910000-0000-4000-8000-000000000001',repeat('1',64),selector,preview_fingerprint,'Old','Sensitive',facts,now()-interval '100 days',deadline_basis,2 from private.organizer_messages where request_id='b6700000-0000-4000-8000-000000000001';
insert into private.organizer_message_recipients(id,message_id,normalized_email,recipient_hash,state,payload,first_possible_dispatch_at,dispatch_count,dispatch_stopped_reason,updated_at,accepted_at)
values('b6920000-0000-4000-8000-000000000001','b6900000-0000-4000-8000-000000000001','old-unknown@example.invalid',private.ticket_email_fingerprint('old-unknown@example.invalid'),'unknown',pg_temp.envelope(),now()-interval '100 days',6,'retry_window_exhausted',now()-interval '100 days',null),
('b6920000-0000-4000-8000-000000000002','b6900000-0000-4000-8000-000000000001','old-accepted@example.invalid',private.ticket_email_fingerprint('old-accepted@example.invalid'),'accepted',pg_temp.envelope(),now()-interval '100 days',1,null,now()-interval '100 days',now()-interval '100 days');
select is(public.server_prune_organizer_message_history(),0::bigint,'unknown outcome retains shared message content');
select ok((select payload is not null and normalized_email is not null from private.organizer_message_recipients where id='b6920000-0000-4000-8000-000000000001'),'unknown encrypted payload/address retained beyond 90 days');
select ok((select payload is null and normalized_email is null and payload_purged_at is not null from private.organizer_message_recipients where id='b6920000-0000-4000-8000-000000000002'),'accepted terminal private payload purged after 90 days');
select ok(public.server_observe_email('old-evidence','b6920000-0000-4000-8000-000000000001','old-provider','delivered',now()),'late verified evidence resolves retained old uncertainty');
-- Evidence refresh restarts retention age; do not purge recently reconciled content.
select is(public.server_prune_organizer_message_history(),0::bigint,'fresh evidence keeps message operationally available');
insert into private.organizer_messages(id,event_id,requested_by,request_id,request_digest,selector,preview_fingerprint,subject,body,facts,confirmed_at,deadline_basis,recipient_count)
select 'b6900000-0000-4000-8000-000000000002',event_id,requested_by,'b6910000-0000-4000-8000-000000000002',repeat('2',64),selector,preview_fingerprint,'Old','Sensitive',facts,now()-interval '100 days',deadline_basis,1 from private.organizer_messages where request_id='b6700000-0000-4000-8000-000000000001';
insert into private.organizer_message_recipients(message_id,normalized_email,recipient_hash,state,updated_at)
values('b6900000-0000-4000-8000-000000000002','old-failed@example.invalid',private.ticket_email_fingerprint('old-failed@example.invalid'),'failed',now()-interval '100 days');
select is(public.server_prune_organizer_message_history(),1::bigint,'terminal content pruned after approved retention');
select ok((select subject is null and body is null and facts is null and content_purged_at is not null from private.organizer_messages where id='b6900000-0000-4000-8000-000000000002'),'sensitive message content removed');
select is(public.get_owned_organizer_message_receipt('b6200000-0000-4000-8000-000000000002','b6910000-0000-4000-8000-000000000002')->>'queuedRecipients','1','minimal durable receipt survives content purge');
select ok((select bool_and(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'server_%organizer_message%' or p.proname='server_observe_email')),'all service contracts denied to browser actors');
select ok((select bool_and(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like '%organizer_message%'),'private audience/policy helpers never exposed');
select public.server_configure_organizer_messages('{"acceptingSends":false,"workerEnabled":false}');
select is(public.get_owned_organizer_message_receipt('b6200000-0000-4000-8000-000000000002','b6700000-0000-4000-8000-000000000001'),(select v from proof where k='receipt'),'shutdown does not hide receipt');
select is((select public.submit_owned_organizer_message('b6200000-0000-4000-8000-000000000002','{"kind":"everyone"}','Hello 🌎',E'first\n<script>plain</script>',v->>'fingerprint','b6700000-0000-4000-8000-000000000001') from proof where k='preview'),(select v from proof where k='receipt'),'exact replay precedes disabled worker/new-send gates');
select * from finish();
rollback;
