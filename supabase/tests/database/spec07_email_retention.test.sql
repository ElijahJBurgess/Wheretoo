begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
\ir spec07_email_fixture.inc
update private.ticket_email_settings set enabled_at=null;
select pg_temp.register(1,2);
insert into private.ticket_email_grants(id,token_hash,purpose,prepared_at,expires_at,scheduled_end_at)
select 'b6800000-0000-4000-8000-000000000001',null,'initial',now()-interval '120 days',ends_at+interval '24 hours',ends_at from public.events where id='b6200000-0000-4000-8000-000000000001';
insert into private.ticket_email_members(grant_id,position,registration_id) select 'b6800000-0000-4000-8000-000000000001',1,id from public.free_registrations where request_id='b6300000-0000-4000-8000-000000000001';
update private.ticket_email_grants set token_hash=repeat('a',64) where id='b6800000-0000-4000-8000-000000000001';
insert into private.ticket_email_outbox(id,purpose,registration_id,grant_id,payload,state,provider_id,dispatch_count,first_possible_dispatch_at,created_at,updated_at)
select 'b6810000-0000-4000-8000-000000000001','initial',id,'b6800000-0000-4000-8000-000000000001',pg_temp.envelope(),'accepted','retention-provider',1,now()-interval '120 days',now()-interval '120 days',now()-interval '120 days'
from public.free_registrations where request_id='b6300000-0000-4000-8000-000000000001';
select public.server_prune_ticket_email_history();
select extensions.is((select payload from private.ticket_email_outbox where id='b6810000-0000-4000-8000-000000000001'),null::jsonb,'accepted encrypted payload is purged after safe replay window');
select extensions.is((select count(*) from private.ticket_email_grants where id='b6800000-0000-4000-8000-000000000001'),1::bigint,'unexpired long-lived grant survives 90-day metadata retention');
select extensions.is((select count(*) from private.ticket_email_members where grant_id='b6800000-0000-4000-8000-000000000001'),1::bigint,'long-lived grant membership survives retention');
select extensions.is(public.server_read_ticket_email_access(repeat('a',64),repeat('1',64),0,1)->>'kind','member','purging ciphertext does not break existing ticket access');
select extensions.ok(public.server_observe_ticket_email('retention-bounce','b6810000-0000-4000-8000-000000000001','retention-provider','bounced',now()),'late signed bounce still correlates after payload purge');
select extensions.is((select private.ticket_email_source('free_registration',id)->>'reason' from public.free_registrations where request_id='b6300000-0000-4000-8000-000000000001'),'recipient_blocked','verified bounce blocks repeated new sends');
select extensions.is(public.server_read_ticket_email_access(repeat('a',64),repeat('1',64),0,1)->>'kind','member','recipient suppression does not revoke existing access');
select extensions.is((select state from private.ticket_email_outbox where id='b6810000-0000-4000-8000-000000000001'),'accepted','bounce remains separate from provider acceptance');
select * from extensions.finish();
rollback;
