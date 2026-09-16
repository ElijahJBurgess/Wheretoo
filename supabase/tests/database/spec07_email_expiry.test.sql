begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
\ir spec07_email_fixture.inc
update private.ticket_email_settings set enabled_at=null;
select pg_temp.register(1,2);
insert into private.ticket_email_grants(id,purpose,prepared_at,expires_at,scheduled_end_at)
select 'b6900000-0000-4000-8000-000000000001','initial',now()-interval '24 hours',ends_at+interval '24 hours',ends_at from public.events where id='b6200000-0000-4000-8000-000000000001';
insert into private.ticket_email_members(grant_id,position,registration_id) select 'b6900000-0000-4000-8000-000000000001',1,id from public.free_registrations;
update private.ticket_email_grants set token_hash=repeat('a',64) where id='b6900000-0000-4000-8000-000000000001';
insert into private.ticket_email_outbox(id,purpose,registration_id,grant_id,payload,state,dispatch_count,first_possible_dispatch_at,next_attempt_at)
select 'b6910000-0000-4000-8000-000000000001','initial',id,'b6900000-0000-4000-8000-000000000001',pg_temp.envelope(),'unknown',1,clock_timestamp()-interval '23 hours',now()-interval '1 minute' from public.free_registrations;
select extensions.is(public.server_claim_ticket_email(),null::jsonb,'exact 23-hour boundary stops automatic replay');
select extensions.is((select state from private.ticket_email_outbox),'unknown','23-hour cutoff never manufactures Failed');
select extensions.is((select dispatch_stopped_reason from private.ticket_email_outbox),'retry_window_exhausted','23-hour stop is recorded independently');
select extensions.is(public.server_read_ticket_email_access(repeat('a',64),repeat('1',64),0,1)->>'kind','member','dispatch cutoff does not expire valid access');
select public.server_revoke_ticket_email_grant('b6900000-0000-4000-8000-000000000001');
select extensions.is(public.server_read_ticket_email_access(repeat('a',64),repeat('1',64)),null::jsonb,'revoked grant cannot enumerate collections');
select extensions.is(public.server_read_ticket_email_access(repeat('a',64),repeat('1',64),0,1),null::jsonb,'revoked grant cannot read a member');
insert into private.ticket_email_grants(id,purpose,prepared_at,expires_at) values('b6900000-0000-4000-8000-000000000002','recovery',now()-interval '25 hours',now()-interval '1 hour');
insert into private.ticket_email_members(grant_id,position,registration_id) select 'b6900000-0000-4000-8000-000000000002',1,id from public.free_registrations;
update private.ticket_email_grants set token_hash=repeat('b',64) where id='b6900000-0000-4000-8000-000000000002';
select extensions.is(public.server_read_ticket_email_access(repeat('b',64),repeat('1',64),0,1),null::jsonb,'expired recovery cannot read a member');
select extensions.is((select count(*) from public.tickets),2::bigint,'expiry and revocation preserve original admissions');
select * from extensions.finish();
rollback;
