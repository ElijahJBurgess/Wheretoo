-- Rollback-only fixtures. Replays the approved forward migration to exercise retirement.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id,email) values
('18000000-0000-4000-8000-000000000142','moderation-contract-regression@example.invalid');
insert into public.organizers (id,display_name) values
('18000000-0000-4000-8000-000000000142','Moderation contract regression');
insert into public.events (id,organizer_id,moderation_status)
select ('28000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 '18000000-0000-4000-8000-000000000142',
 case when n=143 then 'blocked' else 'under_review' end
from generate_series(142,152) n;
insert into private.event_risk_disclosures
(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
select id,'all_ages',false,false,false,false,false,false from public.events
where id in ('28000000-0000-4000-8000-000000000144','28000000-0000-4000-8000-000000000150');

insert into private.event_moderation_evaluations
(id,event_id,content_revision,input_sha256,queued_moderation_version,status,source,attempt_count,
 created_at,started_at,finished_at,failure_code,outcome,risk_level,reason_codes,provider_reference,model_version)
select ('38000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 ('28000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,1,
 private.compute_event_input_sha256(('28000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid),0,
 case when n in (142,144,152) then 'queued' when n=145 then 'succeeded'
 when n=146 then 'failed' when n=147 then 'superseded' else 'processing' end,
 case when n=143 then 'report' when n=148 then 'deterministic' else 'contextual' end,
 case when n in (142,144,152) then 0 else 2 end,
 now()-interval '1 hour',
 case when n in (142,144,152) then null when n=143 then now()+interval '5 minutes' else now()-interval '10 minutes' end,
 case when n in (145,146,147) then now()-interval '5 minutes' else null end,
 case when n in (146,147) then 'RETAINED_FAILURE' else null end,
 case when n=145 then 'clear_candidate' else null end,
 case when n=145 then 'low' else null end,
 case when n=145 then array['no_violation'] when n=143 then array['user_report'] else array[]::text[] end,
 case when n=143 then 'sha256:' || repeat('b',64) else null end,
 case when n=143 then 'sha256:' || repeat('c',64) else null end
from generate_series(142,152) n;

insert into private.event_moderation_actions
(id,event_id,content_revision,input_sha256,actor_type,source,action,previous_status,new_status,
 previous_public_history_status,new_public_history_status,reason_code,evaluation_id,moderation_version)
values ('48000000-0000-4000-8000-000000000143','28000000-0000-4000-8000-000000000143',1,
 private.compute_event_input_sha256('28000000-0000-4000-8000-000000000143'),
 'system','report_escalation','block','under_review','blocked','never_public','never_public',
 'user_report','38000000-0000-4000-8000-000000000143',0);
insert into private.event_reports (event_id,content_revision,input_sha256,reporter_fingerprint,reason)
values ('28000000-0000-4000-8000-000000000143',1,
 private.compute_event_input_sha256('28000000-0000-4000-8000-000000000143'),repeat('a',64),'unsafe');
insert into private.moderation_review_requests
(event_id,organizer_id,content_revision,input_sha256,requested_action_id)
values ('28000000-0000-4000-8000-000000000143','18000000-0000-4000-8000-000000000142',1,
 private.compute_event_input_sha256('28000000-0000-4000-8000-000000000143'),
 '48000000-0000-4000-8000-000000000143');

create function pg_temp.fixture_state() returns jsonb language sql as $body$
 select jsonb_build_object(
 'events',(select jsonb_agg(to_jsonb(e) order by e.id) from public.events e where e.organizer_id='18000000-0000-4000-8000-000000000142'),
 'actions',(select jsonb_agg(to_jsonb(a) order by a.id) from private.event_moderation_actions a join public.events e on e.id=a.event_id where e.organizer_id='18000000-0000-4000-8000-000000000142'),
 'reports',(select jsonb_agg(to_jsonb(r) order by r.id) from private.event_reports r join public.events e on e.id=r.event_id where e.organizer_id='18000000-0000-4000-8000-000000000142'),
 'reviews',(select jsonb_agg(to_jsonb(r) order by r.id) from private.moderation_review_requests r join public.events e on e.id=r.event_id where e.organizer_id='18000000-0000-4000-8000-000000000142'),
 'intervals',(select jsonb_agg(to_jsonb(i) order by i.event_id,i.public_eligibility_version) from private.event_public_eligibility_intervals i join public.events e on e.id=i.event_id where e.organizer_id='18000000-0000-4000-8000-000000000142'));
$body$;
create temporary table before_state as select pg_temp.fixture_state() as facts;
create temporary table before_evaluations as select id,to_jsonb(e) as facts
from private.event_moderation_evaluations e where event_id between
'28000000-0000-4000-8000-000000000142' and '28000000-0000-4000-8000-000000000152';

-- Root applies the general retirement before this own-fixture replay. Abort if
-- unrelated missing-disclosure work would otherwise be touched by the replay.
do $$ begin
 if exists(select 1 from private.event_moderation_evaluations q
 join public.events e on e.id=q.event_id
 where e.organizer_id<>'18000000-0000-4000-8000-000000000142'
 and q.source in ('contextual','report') and q.status in ('queued','processing')
 and not private.event_has_moderation_disclosures(e.id)) then
  raise exception 'ASSERT_OUTSIDE_INCOMPLETE_QUEUE_NOT_QUIESCENT';
 end if;
end $$;
create temporary table outside_evaluations as select q.id,to_jsonb(q) as facts
from private.event_moderation_evaluations q join public.events e on e.id=q.event_id
where e.organizer_id<>'18000000-0000-4000-8000-000000000142';

-- The same production retirement runs here, never a test reimplementation.
\ir ../../migrations/20260918010100_guard_incomplete_moderation_jobs.sql
\ir ../../migrations/20260918010200_restore_active_event_moderation_schedule.sql

select results_eq($$select q.id,to_jsonb(q) from private.event_moderation_evaluations q
 join public.events e on e.id=q.event_id
 where e.organizer_id<>'18000000-0000-4000-8000-000000000142' order by q.id$$,
 $$select id,facts from outside_evaluations order by id$$,
 'own-fixture replay preserves every outside evaluation exactly');
select is(pg_temp.fixture_state(),(select facts from before_state),
 'retirement preserves event, authorization, action, report, review and public interval facts');
select results_eq($$ select id,status,failure_code,started_at is not null,
 finished_at >= started_at and started_at >= created_at
 from private.event_moderation_evaluations where id in
 ('38000000-0000-4000-8000-000000000142','38000000-0000-4000-8000-000000000143') order by id $$,
 $$ values ('38000000-0000-4000-8000-000000000142'::uuid,'superseded'::text,'INCOMPLETE_MODERATION_INPUT'::text,true,true),
 ('38000000-0000-4000-8000-000000000143'::uuid,'superseded'::text,'INCOMPLETE_MODERATION_INPUT'::text,true,true) $$,
 'queued and processing/report incomplete rows retire with safe timestamps');
select results_eq($$ select count(*)::bigint from private.event_moderation_evaluations e
 join before_evaluations b using(id)
 where (to_jsonb(e)-array['status','failure_code','started_at','finished_at'])
 is distinct from (b.facts-array['status','failure_code','started_at','finished_at']) $$,
 $$ values (0::bigint) $$,'retirement preserves exact identity, attempts, results and provider metadata');
select results_eq($$ select count(*)::bigint from private.event_moderation_evaluations e
 join before_evaluations b using(id) where e.id in
 ('38000000-0000-4000-8000-000000000144','38000000-0000-4000-8000-000000000145',
 '38000000-0000-4000-8000-000000000146','38000000-0000-4000-8000-000000000147',
 '38000000-0000-4000-8000-000000000148','38000000-0000-4000-8000-000000000150')
 and to_jsonb(e) is distinct from b.facts $$,$$ values (0::bigint) $$,
 'complete, terminal and non-contextual evaluations remain byte-for-byte unchanged');

select results_eq($$ select
 has_function_privilege('anon','public.server_reject_moderation_evaluation_input(uuid,uuid,bigint,text,bigint,integer)','EXECUTE'),
 has_function_privilege('authenticated','public.server_reject_moderation_evaluation_input(uuid,uuid,bigint,text,bigint,integer)','EXECUTE'),
 has_function_privilege('service_role','public.server_reject_moderation_evaluation_input(uuid,uuid,bigint,text,bigint,integer)','EXECUTE'),
 has_function_privilege('anon','private.event_has_moderation_disclosures(uuid)','EXECUTE'),
 has_function_privilege('authenticated','private.event_has_moderation_disclosures(uuid)','EXECUTE') $$,
 $$ values(false,false,true,false,false) $$,'only service role receives rejection authority; predicate is private');
select results_eq($$ select prosecdef,
 (proconfig collate "C") = (array['search_path=""']::text[] collate "C")
 from pg_proc where oid=
 'public.server_reject_moderation_evaluation_input(uuid,uuid,bigint,text,bigint,integer)'::regprocedure $$,
 $$ values(true,true) $$,'rejection runs as definer with empty search path');

-- Fresh post-migration incomplete rows model an already in-flight claim.
update private.event_moderation_evaluations set status='processing',attempt_count=2,
 started_at=now(),finished_at=null,failure_code=null
where id in ('38000000-0000-4000-8000-000000000149','38000000-0000-4000-8000-000000000151');
update private.event_moderation_evaluations set status='queued',attempt_count=0,
 started_at=null,finished_at=null,failure_code=null where id='38000000-0000-4000-8000-000000000152';
create temporary table rpc_before as select id,to_jsonb(e) as facts from private.event_moderation_evaluations e
where event_id between '28000000-0000-4000-8000-000000000142' and '28000000-0000-4000-8000-000000000152';
-- Store the exact envelope before using the service-only RPC.
create temporary table rpc_envelopes as select * from private.event_moderation_evaluations
where event_id between '28000000-0000-4000-8000-000000000142' and '28000000-0000-4000-8000-000000000152';
grant select on rpc_envelopes to service_role,anon,authenticated;
set local role anon;
select throws_ok($$select public.server_reject_moderation_evaluation_input(
 '38000000-0000-4000-8000-000000000149','28000000-0000-4000-8000-000000000149',1,repeat('a',64),0,2)$$,
 '42501','permission denied for function server_reject_moderation_evaluation_input','anon cannot reject');
reset role;
set local role authenticated;
select throws_ok($$select public.server_reject_moderation_evaluation_input(
 '38000000-0000-4000-8000-000000000149','28000000-0000-4000-8000-000000000149',1,repeat('a',64),0,2)$$,
 '42501','permission denied for function server_reject_moderation_evaluation_input','authenticated cannot reject');
reset role;
set local role service_role;
select is((select public.server_reject_moderation_evaluation_input(id,'28000000-0000-4000-8000-000000000150'::uuid,content_revision,input_sha256,queued_moderation_version,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000149'),'conflict','wrong event cannot retire a lease');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,2,input_sha256,queued_moderation_version,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000149'),'conflict','wrong revision cannot retire a lease');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,repeat('f',64),queued_moderation_version,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000149'),'conflict','wrong hash cannot retire a lease');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,1,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000149'),'conflict','wrong version cannot retire a lease');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,1) from rpc_envelopes where id='38000000-0000-4000-8000-000000000149'),'conflict','wrong attempt cannot retire a lease');
select is(public.server_reject_moderation_evaluation_input('38000000-0000-4000-8000-000000000199',
 '28000000-0000-4000-8000-000000000149',1,repeat('a',64),0,1),'not_found','missing row has bounded disposition');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000148'),'conflict','wrong source is bounded');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000145'),'conflict','succeeded terminal is bounded');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000146'),'conflict','failed terminal is bounded');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000150'),'schema_disagreement','current SQL-complete input is bounded');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,attempt_count) from rpc_envelopes where id='38000000-0000-4000-8000-000000000147'),'superseded','exact already superseded is bounded');
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,1)
 from rpc_envelopes where id='38000000-0000-4000-8000-000000000152'),'conflict','queued status/attempt is not a processing lease');
select throws_ok($$select public.server_reject_moderation_evaluation_input(
 '38000000-0000-4000-8000-000000000149','28000000-0000-4000-8000-000000000149',0,repeat('a',64),0,1)$$,
 '22023','MODERATION_REJECTION_INVALID','malformed revisions are rejected');
reset role;
select results_eq($$select count(*)::bigint from private.event_moderation_evaluations e join rpc_before b using(id)
 where to_jsonb(e) is distinct from b.facts$$,$$ values (0::bigint)$$,
 'all conflict, schema disagreement, missing and idempotent outcomes leave rows unchanged');
set local role service_role;
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,attempt_count)
 from rpc_envelopes where id='38000000-0000-4000-8000-000000000149'),'superseded','service role retires exact incomplete lease');
reset role;
select results_eq($$select status,failure_code,finished_at>=started_at,
 to_jsonb(e)-array['status','failure_code','started_at','finished_at'] =
 b.facts-array['status','failure_code','started_at','finished_at']
 from private.event_moderation_evaluations e join rpc_before b using(id)
 where e.id='38000000-0000-4000-8000-000000000149'$$,
 $$ values ('superseded'::text,'INCOMPLETE_MODERATION_INPUT'::text,true,true)$$,
 'rejection only changes the permitted terminal fields');
select is(pg_temp.fixture_state(),(select facts from before_state),
 'rejection never clears holds or changes reports/history/event facts');

-- A newer event tuple must only supersede the exact old lease as stale.
update public.events set moderation_version=1 where id='28000000-0000-4000-8000-000000000151';
set local role service_role;
select is((select public.server_reject_moderation_evaluation_input(id,event_id,content_revision,input_sha256,queued_moderation_version,attempt_count)
 from rpc_envelopes where id='38000000-0000-4000-8000-000000000151'),'superseded','stale currentness supersedes old lease');
reset role;
select is((select failure_code from private.event_moderation_evaluations where id='38000000-0000-4000-8000-000000000151'),
 'STALE_EVALUATION','stale lease keeps existing stale semantics');

-- First real requirements completion uses the existing optimistic/history wrapper.
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000142',true);
set local role authenticated;
select lives_ok($$select public.save_owned_event_requirements_if_current(
 '28000000-0000-4000-8000-000000000142',
 '{"minimum_age":"all_ages","alcohol_present":false,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false}'::jsonb,
 public.get_owned_event_change_context('28000000-0000-4000-8000-000000000142')->>'context_token')$$,
 'first real disclosure insertion uses the current-context wrapper');
reset role;
select results_eq($$select e.content_revision,e.moderation_version,count(q.id)::bigint,
 bool_and(q.input_sha256=private.compute_event_input_sha256(e.id))
 from public.events e join private.event_moderation_evaluations q on q.event_id=e.id and q.status='queued'
 where e.id='28000000-0000-4000-8000-000000000142' group by e.id$$,
 $$ values (2::bigint,1::bigint,1::bigint,true)$$,'first disclosures create exactly one current immutable job');
create temporary table completed_before as select to_jsonb(e) as facts from private.event_moderation_evaluations e
 where e.event_id='28000000-0000-4000-8000-000000000142';
set local role authenticated;
select lives_ok($$select public.save_owned_event_requirements_if_current(
 '28000000-0000-4000-8000-000000000142',
 '{"minimum_age":"all_ages","alcohol_present":false,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false}'::jsonb,
 public.get_owned_event_change_context('28000000-0000-4000-8000-000000000142')->>'context_token')$$,
 'unchanged disclosure save remains supported');
reset role;
select results_eq($$select to_jsonb(e) from private.event_moderation_evaluations e
 where e.event_id='28000000-0000-4000-8000-000000000142' order by e.id$$,
 $$select facts from completed_before order by facts->>'id'$$,'unchanged disclosures do not create or rewrite jobs');
select * from finish();
rollback;
