begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
\ir spec07_email_fixture.inc
create temp table proof(k text primary key,v jsonb);
grant select on proof to authenticated;
-- Seed independently issued registrations while automatic delivery is disabled.
update private.ticket_email_settings set enabled_at=null;
select pg_temp.register(1,1,2);
select pg_temp.register(2,1,2);
update private.ticket_email_settings set enabled_at=now()-interval '1 hour';
select public.server_request_ticket_recovery('b6710000-0000-4000-8000-000000000001',repeat('b',64),repeat('1',64),pg_temp.envelope());
select extensions.is((select count(*) from private.ticket_email_outbox),1::bigint,'anonymous request stores one encrypted durable intent');
select extensions.is((select count(*) from private.ticket_email_grants),0::bigint,'anonymous HTTP path does not match or create access grants');
insert into proof values('claim',public.server_claim_ticket_email());
insert into proof select 'context',public.server_prepare_ticket_email_context((v->>'id')::uuid,(v->>'lease_id')::uuid,'pat@example.invalid') from proof where k='claim';
select extensions.is((select jsonb_array_length(v->'sources') from proof where k='context'),2,'multiple matching registrations remain separate sources');
select extensions.is((select (v->>'expiresAt')::timestamptz-(v->>'preparedAt')::timestamptz from proof where k='context'),interval '24 hours','recovery lifetime is exactly 24 hours');
select public.server_save_ticket_email_payload((v->>'id')::uuid,(v->>'lease_id')::uuid,repeat('c',64),pg_temp.envelope()) from proof where k='claim';
select pg_temp.register(3,1,2);
select extensions.is(jsonb_array_length((select public.server_prepare_ticket_email_context((v->>'id')::uuid,(v->>'lease_id')::uuid,'pat@example.invalid')->'sources' from proof where k='claim')),2,'later registration never enters an existing snapshot');
select extensions.is((public.server_read_ticket_email_access(repeat('c',64),repeat('1',64))->>'total')::integer,2,'grant index retains frozen membership');
select extensions.is(public.server_read_ticket_email_access(repeat('c',64),repeat('1',64),0,3),null::jsonb,'later source cannot be selected through old grant');
-- Recovery quota exhaustion cannot consume organizer capacity or initial capacity.
select public.server_request_ticket_recovery('b6710000-0000-4000-8000-000000000002',repeat('b',64),repeat('1',64),pg_temp.envelope());
select extensions.is((select count(*) from private.ticket_email_outbox where purpose='recovery'),1::bigint,'recipient cooldown coalesces anonymous pressure');
select extensions.is((select count(*) from private.ticket_email_outbox where purpose='initial'),1::bigint,'initial delivery bypasses anonymous allowance');
insert into proof select 'owner-source',to_jsonb(id) from public.free_registrations where request_id='b6300000-0000-4000-8000-000000000001';
set local role authenticated;
select extensions.is(public.request_ticket_email_resend('b6200000-0000-4000-8000-000000000002','free_registration',(select (v#>>'{}')::uuid from proof where k='owner-source'),'b6720000-0000-4000-8000-000000000001')->>'kind','queued','organizer resend has a disjoint allowance');
reset role;
-- 100 distinct guests sharing one venue IP retain independent verified-grant capacity.
update private.ticket_email_settings set enabled_at=null;
select pg_temp.register(n,1,2,'Guest '||n,'guest'||n||'@example.invalid') from generate_series(10,109) n;
insert into private.ticket_email_grants(id,token_hash,purpose,expires_at)
select ('b6730000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,null,'recovery',now()+interval '24 hours' from generate_series(10,109) n;
insert into private.ticket_email_members(grant_id,position,registration_id)
select ('b6730000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,r.id from generate_series(10,109) n join public.free_registrations r on r.request_id=('b6300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
update private.ticket_email_grants g set token_hash=encode(extensions.digest('grant:'||n,'sha256'),'hex') from generate_series(10,109) n where g.id=('b6730000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
select extensions.ok((select bool_and(coalesce(public.server_read_ticket_email_access(encode(extensions.digest('grant:'||n,'sha256'),'hex'),repeat('2',64))->>'kind'='index',false)) from generate_series(10,109) n),'100 legitimate guests on one IP can read their own granted collections');
select extensions.ok((select bool_and(coalesce(public.server_read_ticket_email_access(encode(extensions.digest('grant:'||n,'sha256'),'hex'),repeat('2',64),0,1)->>'kind'='member',false)) from generate_series(10,109) n),'100 same-IP guests can open the existing tickets independently');
-- Snapshot supports exactly 20 sources per page and refuses silent truncation above 200.
select pg_temp.register(n,1,2,'Bulk Guest','bulk@example.invalid') from generate_series(201,400) n;
update private.ticket_email_settings set enabled_at=now()-interval '1 hour';
select public.server_request_ticket_recovery('b6740000-0000-4000-8000-000000000001',repeat('d',64),repeat('3',64),pg_temp.envelope());
update private.ticket_email_outbox set lease_id='b6750000-0000-4000-8000-000000000001',lease_until=now()+interval '2 minutes' where request_id='b6740000-0000-4000-8000-000000000001';
insert into proof select 'bounded',public.server_prepare_ticket_email_context(id,lease_id,'bulk@example.invalid') from private.ticket_email_outbox where request_id='b6740000-0000-4000-8000-000000000001';
select extensions.is((select jsonb_array_length(v->'sources') from proof where k='bounded'),200,'200 sources fit the approved fixed snapshot');
select public.server_save_ticket_email_payload(id,lease_id,repeat('e',64),pg_temp.envelope()) from private.ticket_email_outbox where request_id='b6740000-0000-4000-8000-000000000001';
select extensions.ok((select bool_and(jsonb_array_length(public.server_read_ticket_email_access(repeat('e',64),repeat('3',64),n)->'collections')=20) from generate_series(0,9) n),'all ten pages contain exactly 20 sources');
select extensions.is((public.server_read_ticket_email_access(repeat('e',64),repeat('3',64),9)->>'nextPage'),null::text,'last page has no next page');
select extensions.is(public.server_read_ticket_email_access(repeat('e',64),repeat('3',64),10),null::jsonb,'page beyond the approved bound is refused');
select pg_temp.register(401,1,2,'Bulk Guest','bulk@example.invalid');
select extensions.is((public.server_read_ticket_email_access(repeat('e',64),repeat('3',64))->>'total')::integer,200,'later 201st match cannot mutate the existing snapshot');
select public.server_request_ticket_recovery('b6740000-0000-4000-8000-000000000002',repeat('f',64),repeat('4',64),pg_temp.envelope());
update private.ticket_email_outbox set lease_id='b6750000-0000-4000-8000-000000000002',lease_until=now()+interval '2 minutes' where request_id='b6740000-0000-4000-8000-000000000002';
insert into proof select 'overflow',public.server_prepare_ticket_email_context(id,lease_id,'bulk@example.invalid') from private.ticket_email_outbox where request_id='b6740000-0000-4000-8000-000000000002';
select extensions.is((select (v->>'overflow')::boolean from proof where k='overflow'),true,'201 matches use explicit support handoff');
select extensions.is((select jsonb_array_length(v->'sources') from proof where k='overflow'),0,'overflow never silently truncates membership to 200');
select extensions.is((select count(*) from private.ticket_email_members where grant_id=(select (v->>'grantId')::uuid from proof where k='overflow')),0::bigint,'overflow grants confer no partial access');
select * from extensions.finish();
rollback;
