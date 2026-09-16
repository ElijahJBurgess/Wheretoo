begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir spec07_email_fixture.inc
update private.ticket_email_settings set enabled_at=null,worker_enabled=false;
select pg_temp.register(1,2);
select pg_temp.register(2,1,2);
select public.cancel_owned_event('b6200000-0000-4000-8000-000000000001');
insert into private.ticket_email_grants(id,purpose,prepared_at,expires_at,scheduled_end_at) values
 ('b6900000-0000-4000-8000-000000000010','event_cancellation',now()-interval '31 days',now()-interval '1 day',null),
 ('b6900000-0000-4000-8000-000000000011','event_cancellation',now(),now()+interval '30 days',null),
 ('b6900000-0000-4000-8000-000000000012','event_cancellation',now(),now()+interval '30 days',null),
 ('b6900000-0000-4000-8000-000000000013','initial',now(),now()+interval '2 days',now()+interval '1 day');
insert into private.ticket_email_members(grant_id,position,registration_id)
select g.id,1,r.id from private.ticket_email_grants g cross join public.free_registrations r
where g.id in ('b6900000-0000-4000-8000-000000000010','b6900000-0000-4000-8000-000000000012','b6900000-0000-4000-8000-000000000013') and r.event_id='b6200000-0000-4000-8000-000000000001';
insert into private.ticket_email_members(grant_id,position,registration_id)
select 'b6900000-0000-4000-8000-000000000012',2,id from public.free_registrations where event_id='b6200000-0000-4000-8000-000000000002';
update private.ticket_email_grants set token_hash=case id
 when 'b6900000-0000-4000-8000-000000000010' then repeat('a',64)
 when 'b6900000-0000-4000-8000-000000000011' then repeat('b',64)
 when 'b6900000-0000-4000-8000-000000000012' then repeat('c',64)
 when 'b6900000-0000-4000-8000-000000000013' then repeat('d',64) end;
select is(public.server_read_event_status_access(repeat('a',64),repeat('1',64)),null::jsonb,'expired cancellation status fails closed');
select is(public.server_read_event_status_access(repeat('b',64),repeat('2',64)),null::jsonb,'empty member grant fails closed');
select is(public.server_read_event_status_access(repeat('c',64),repeat('3',64)),null::jsonb,'multiple wrong members fail closed');
select is(public.server_read_event_status_access(repeat('d',64),repeat('4',64)),null::jsonb,'admission purpose cannot read event status');
select throws_ok($$update private.ticket_email_grants set expires_at=expires_at+interval '1 day' where id='b6900000-0000-4000-8000-000000000010'$$,'P0001',null,'existing cancellation grant lifetime cannot be extended');
select ok(not has_table_privilege('authenticated','private.event_notices','select'),'owner browser cannot read private notice ledger');
select ok(not has_table_privilege('anon','private.event_notice_sources','select'),'anonymous browser cannot enumerate source receipts');
select ok(not has_function_privilege('service_role','private.event_notice_source(text,uuid,text)','execute'),'private source PII is not an RPC');
select is((select count(*) from public.orders),0::bigint,'separate free status tests never create paid orders');
select * from finish();rollback;
