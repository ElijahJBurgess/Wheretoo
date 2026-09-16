begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
\ir spec07_email_fixture.inc
create temp table proof(k text primary key,v jsonb);
select pg_temp.register(1,2);
insert into proof values('claim',public.server_claim_ticket_email());
select public.server_prepare_ticket_email_context((v->>'id')::uuid,(v->>'lease_id')::uuid) from proof where k='claim';
select public.server_save_ticket_email_payload((v->>'id')::uuid,(v->>'lease_id')::uuid,repeat('e',64),pg_temp.envelope()) from proof where k='claim';
select extensions.is((select public.server_begin_ticket_email_dispatch((v->>'id')::uuid,'b6990000-0000-4000-8000-000000000001') from proof where k='claim'),null::jsonb,'stale lease cannot begin a network attempt');
select public.server_begin_ticket_email_dispatch((v->>'id')::uuid,(v->>'lease_id')::uuid) from proof where k='claim';
insert into proof select 'anchor',to_jsonb(first_possible_dispatch_at) from private.ticket_email_outbox;
select extensions.ok((select public.server_observe_ticket_email('before-response',(v->>'id')::uuid,'provider-race','sent',now()) from proof where k='claim'),'verified webhook may arrive before provider response persistence');
select extensions.ok((select public.server_finish_ticket_email_dispatch((v->>'id')::uuid,(v->>'lease_id')::uuid,'unknown') from proof where k='claim'),'lost response completion does not discard webhook evidence');
select extensions.is((select state from private.ticket_email_outbox),'accepted','webhook-before-response leaves accepted');
select extensions.ok(not (select public.server_finish_ticket_email_dispatch((v->>'id')::uuid,'b6990000-0000-4000-8000-000000000001','failed') from proof where k='claim'),'stale completion cannot change delivery');
select extensions.throws_ok($$update private.ticket_email_outbox set first_possible_dispatch_at=now()+interval '1 hour'$$,'P0001','Immutable ticket email record','first possible dispatch timestamp cannot be reset');
-- A separate attempt exercises six uncertain provider calls under one immutable key/payload.
select pg_temp.register(2,1);
insert into proof values('retry',public.server_claim_ticket_email());
select public.server_prepare_ticket_email_context((v->>'id')::uuid,(v->>'lease_id')::uuid) from proof where k='retry';
select public.server_save_ticket_email_payload((v->>'id')::uuid,(v->>'lease_id')::uuid,repeat('f',64),pg_temp.envelope()) from proof where k='retry';
create temp table dispatches(value jsonb);
do $$ declare claim jsonb; n integer; begun jsonb;
begin
 select v into claim from proof where k='retry';
 for n in 1..6 loop
  if n>1 then
   update private.ticket_email_outbox set next_attempt_at=now()-interval '1 second' where id=(claim->>'id')::uuid;
   claim:=public.server_claim_ticket_email();
  end if;
  begun:=public.server_begin_ticket_email_dispatch((claim->>'id')::uuid,(claim->>'lease_id')::uuid);
  insert into dispatches values(begun);
  perform public.server_finish_ticket_email_dispatch((claim->>'id')::uuid,(claim->>'lease_id')::uuid,case when n=2 then 'failed' else 'unknown' end);
 end loop;
end; $$;
select extensions.is((select count(*) from dispatches where value is not null),6::bigint,'six attempts may share one prepared payload');
select extensions.is((select count(distinct value->>'idempotencyKey') from dispatches),1::bigint,'provider key stays identical for every retry');
select extensions.is((select count(distinct value->>'payload') from dispatches),1::bigint,'encrypted retry payload never changes');
select extensions.is((select count(distinct value->>'firstPossibleDispatchAt') from dispatches),1::bigint,'all retries share the original dispatch anchor');
select extensions.is((select state from private.ticket_email_outbox where id=(select (v->>'id')::uuid from proof where k='retry')),'unknown','retry rejection and exhausted allowance remain unknown');
select extensions.is((select dispatch_stopped_reason from private.ticket_email_outbox where id=(select (v->>'id')::uuid from proof where k='retry')),'retry_window_exhausted','retry exhaustion records a separate stop reason');
select extensions.is(public.server_claim_ticket_email(),null::jsonb,'seventh automatic attempt cannot be claimed');
-- Cancelling an already possibly-dispatched attempt does not manufacture a failure.
select extensions.ok((select public.server_observe_ticket_email('after-window',(v->>'id')::uuid,'provider-late','delivered',now()) from proof where k='retry'),'late verified observations still reconcile after retries stop');
select extensions.is((select state from private.ticket_email_outbox where id=(select (v->>'id')::uuid from proof where k='retry')),'accepted','late evidence resolves stopped unknown');
select * from extensions.finish();
rollback;
