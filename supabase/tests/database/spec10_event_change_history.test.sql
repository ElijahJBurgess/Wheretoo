begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/spec10_event_history_setup.inc
select lives_ok($$select public.get_owned_event_change_context('aa200000-0000-4000-8000-000000000001')$$,'a genuinely published event returns an owner history context');
create function pg_temp.ctx() returns jsonb language sql as $$select public.get_owned_event_change_context('aa200000-0000-4000-8000-000000000001')$$;
create function pg_temp.save(p_patch jsonb,p_token text default null) returns public.events language plpgsql as $$
begin return jsonb_populate_record(null::public.events,public.save_owned_event_revision_if_current('aa200000-0000-4000-8000-000000000001',
 ((pg_temp.ctx()->'current_saved'->'facts')-'disclosures')||p_patch,coalesce(p_token,pg_temp.ctx()->>'context_token'))->'result'); end;$$;
create function pg_temp.publish() returns void language plpgsql as $$begin
 perform public.accept_current_event_policies_if_current('aa200000-0000-4000-8000-000000000001',pg_temp.ctx()->>'context_token');
 perform public.publish_event_if_current('aa200000-0000-4000-8000-000000000001',pg_temp.ctx()->>'context_token');
end;$$;
create temp table observations(name text primary key,context jsonb);
insert into observations values('initial',pg_temp.ctx());
select is(pg_temp.ctx()->>'currently_publicly_eligible','true','fixture genuinely eligible after acceptance and publish');
select is(pg_temp.ctx()->'previous_publicly_eligible','null'::jsonb,'first actual publication has no invented prior public facts');
select is(pg_temp.ctx()->'current_saved',pg_temp.ctx()->'current_publicly_eligible','first public facts equal whole saved snapshot');
select is(pg_temp.ctx()->>'notice_required','false','initial publication needs no change notice');
select lives_ok($$select pg_temp.save('{"capacity":40}')$$,'capacity-only save succeeds with current context');
insert into observations values('capacity',pg_temp.ctx());
select is(pg_temp.ctx()->'current_saved'->>'content_revision',(select context->'current_saved'->>'content_revision' from observations where name='initial'),'capacity-only does not bump moderation content revision');
select isnt(pg_temp.ctx()->>'context_token',(select context->>'context_token' from observations where name='initial'),'capacity-only invalidates expected context');
select isnt(pg_temp.ctx()->'current_saved'->>'snapshot_id',(select context->'current_saved'->>'snapshot_id' from observations where name='initial'),'capacity-only receives independent immutable identity');
select is(pg_temp.ctx()->'previous_saved',(select context->'current_saved' from observations where name='initial'),'Previous retains actual saved capacity 30');
select is(pg_temp.ctx()->'current_saved'->'facts'->>'capacity','40','New contains saved capacity 40');
select is(pg_temp.ctx()->>'notice_required','false','capacity-only does not require notice');
select throws_ok($$select pg_temp.save('{"title":"Stale title"}',(select context->>'context_token' from observations where name='initial'))$$,'P0001','EVENT_CONTEXT_CONFLICT','stale capacity context cannot edit');
select throws_ok($$select public.accept_current_event_policies_if_current('aa200000-0000-4000-8000-000000000001',(select context->>'context_token' from observations where name='initial'))$$,'P0001','EVENT_CONTEXT_CONFLICT','stale capacity context cannot accept');
select throws_ok($$select public.publish_event_if_current('aa200000-0000-4000-8000-000000000001',(select context->>'context_token' from observations where name='initial'))$$,'P0001','EVENT_CONTEXT_CONFLICT','stale capacity context cannot publish');
select throws_ok($$select public.publish_event_if_current('aa200000-0000-4000-8000-000000000001',null)$$,'P0001','EVENT_CONTEXT_CONFLICT','null expected context cannot bypass check');
select lives_ok($$select pg_temp.save('{}')$$,'no-op save accepted');
select is(pg_temp.ctx(),(select context from observations where name='capacity'),'no-op produces no phantom snapshot, revision, notice or token');
select lives_ok($$select pg_temp.save('{"title":"Updated community gathering"}')$$,'optional title save succeeds');
select is(pg_temp.ctx()->>'notice_required','false','title-only changes remain optional');
select is(pg_temp.ctx()->>'currently_publicly_eligible','false','unreviewed title edit is not publicly eligible');
select is(pg_temp.ctx()->'current_publicly_eligible',(select context->'current_saved' from observations where name='capacity'),'public comparison keeps real last eligible facts while saved revision is held');
select lives_ok($$select pg_temp.publish()$$,'current optional title can be accepted and published');
insert into observations values('optional',pg_temp.ctx());
select lives_ok($$select pg_temp.save(jsonb_build_object('starts_at',(pg_temp.ctx()->'current_saved'->'facts'->>'starts_at')::timestamptz+interval '1 hour'))$$,'material schedule save succeeds');
insert into observations values('schedule',pg_temp.ctx());
select is(pg_temp.ctx()->>'notice_required','true','material saved schedule persists Notice required before public eligibility');
select is(pg_temp.ctx()->'required_fields','["starts_at"]'::jsonb,'schedule material reason is stable and explicit');
select is(pg_temp.ctx()->>'required_snapshot_id',pg_temp.ctx()->'current_saved'->>'snapshot_id','required follow-up bound to exact complete current saved facts');
select is(pg_temp.ctx()->'current_publicly_eligible',(select context->'current_saved' from observations where name='optional'),'held schedule never overwrites last actually public snapshot');
select is(pg_temp.ctx()->'previous_saved',(select context->'current_saved' from observations where name='optional'),'previous saved is final complete prior facts');
reset role;
select is((select count(*) from private.event_change_snapshots where event_id='aa200000-0000-4000-8000-000000000001' and facts=pg_temp.ctx()->'current_saved'->'facts'),1::bigint,'writer creates only one final snapshot after internal revision updates');
select throws_ok($$select private.mark_event_change_notice_submitted('aa200000-0000-4000-8000-000000000001',(pg_temp.ctx()->'current_saved'->>'snapshot_id')::uuid)$$,'P0001','EVENT_CONTEXT_CONFLICT','private submission guard rejects held current facts');
set local role authenticated;
select lives_ok($$select pg_temp.save('{"capacity":45}')$$,'newer capacity edit while required remains allowed');
select is(pg_temp.ctx()->>'notice_required','true','capacity-only edit cannot clear outstanding material follow-up');
select is(pg_temp.ctx()->>'required_snapshot_id',pg_temp.ctx()->'current_saved'->>'snapshot_id','outstanding follow-up follows newest saved identity');
select lives_ok($$select pg_temp.publish()$$,'material facts can be deliberately accepted and published');
select is(pg_temp.ctx()->>'notice_required','true','publication never silently clears required notice');
select is(pg_temp.ctx()->'previous_publicly_eligible',(select context->'current_saved' from observations where name='optional'),'previous public is previous distinct actually eligible facts');
select is(pg_temp.ctx()->'current_publicly_eligible',pg_temp.ctx()->'current_saved','current public contains exact completed saved facts');
reset role;
select throws_ok($$select private.mark_event_change_notice_submitted('aa200000-0000-4000-8000-000000000001',(select (context->'current_saved'->>'snapshot_id')::uuid from observations where name='schedule'))$$,'P0001','EVENT_CONTEXT_CONFLICT','older snapshot cannot satisfy newer required notice');
select lives_ok($$select private.mark_event_change_notice_submitted('aa200000-0000-4000-8000-000000000001',(pg_temp.ctx()->'current_saved'->>'snapshot_id')::uuid)$$,'server submission boundary accepts only exact current eligible facts');
select is(pg_temp.ctx()->>'notice_required','false','deliberate exact eligible submission clears persisted requirement');
select is(pg_temp.ctx()->'required_fields','[]'::jsonb,'completed follow-up clears reason set');
select throws_ok($$update private.event_change_snapshots set facts='{}' where event_id='aa200000-0000-4000-8000-000000000001'$$,'P0001','EVENT_SNAPSHOT_IMMUTABLE','immutable snapshot cannot be rewritten');
select throws_ok($$delete from private.event_change_snapshots where event_id='aa200000-0000-4000-8000-000000000001'$$,'P0001','EVENT_SNAPSHOT_IMMUTABLE','immutable snapshot cannot be deleted');
select ok(not has_table_privilege('authenticated','private.event_change_snapshots','select'),'browser has no direct private snapshot read');
select ok(not has_function_privilege('authenticated','private.mark_event_change_notice_submitted(uuid,uuid)','execute'),'browser cannot mark a notice submitted');
select ok(not has_function_privilege('service_role','private.mark_event_change_notice_submitted(uuid,uuid)','execute'),'service API cannot directly clear notice without deliberate writer');
set local role authenticated;
insert into observations values('before-requirements',pg_temp.ctx());
select lives_ok($$select public.save_owned_event_requirements_if_current('aa200000-0000-4000-8000-000000000001',(pg_temp.ctx()->'current_saved'->'facts'->'disclosures')||'{"minimum_age":"18_plus"}',pg_temp.ctx()->>'context_token')$$,'entry-age change uses expected-context disclosure writer');
select is(pg_temp.ctx()->>'notice_required','true','entry-age changes require notice');
select is(pg_temp.ctx()->'current_saved'->'facts'->'disclosures'->>'minimum_age','18_plus','snapshot captures final new disclosure with updated revision');
select is(pg_temp.ctx()->'previous_saved'->'facts'->'disclosures'->>'minimum_age','all_ages','snapshot retains actual earlier disclosure');
select throws_ok($$select public.save_owned_event_requirements_if_current('aa200000-0000-4000-8000-000000000001',pg_temp.ctx()->'current_saved'->'facts'->'disclosures',(select context->>'context_token' from observations where name='before-requirements'))$$,'P0001','EVENT_CONTEXT_CONFLICT','stale disclosure context is rejected');
select set_config('request.jwt.claim.sub','aa100000-0000-4000-8000-000000000002',true);
select throws_ok($$select pg_temp.ctx()$$,'P0001','EVENT_NOT_FOUND','another organizer cannot read private history');
select throws_ok($$select public.publish_event_if_current('aa200000-0000-4000-8000-000000000001','stale')$$,'P0001','EVENT_NOT_FOUND','another organizer cannot use token conflict to bypass owner check');
select set_config('request.jwt.claim.sub','aa100000-0000-4000-8000-000000000001',true);
reset role;
-- The conditional replies carry the form and token from the same lock scope.
select is(pg_temp.ctx()->'event'->>'title',pg_temp.ctx()->'current_saved'->'facts'->>'title','atomic owner event agrees with snapshot facts');
select is(pg_temp.ctx()->'requirements'->>'minimum_age',pg_temp.ctx()->'current_saved'->'facts'->'disclosures'->>'minimum_age','atomic requirements agree with snapshot facts');
create temp table mutation_reply as select public.save_owned_event_revision_if_current('aa200000-0000-4000-8000-000000000001',
 (pg_temp.ctx()->'current_saved'->'facts')-'disclosures',pg_temp.ctx()->>'context_token') reply;
select is((select reply->'context' from mutation_reply),pg_temp.ctx(),'save returns exact post-write atomic context');
select is((select reply->'result'->>'title' from mutation_reply),pg_temp.ctx()->'event'->>'title','save result is existing event row shape');
-- A stale form must stay stale even when capacity returns to its previous value.
insert into observations values('aba-before',pg_temp.ctx());
select pg_temp.save('{"capacity":46}');
select pg_temp.save('{"capacity":45}');
select isnt(pg_temp.ctx()->>'context_token',(select context->>'context_token' from observations where name='aba-before'),'capacity ABA does not resurrect an old form token');
select throws_ok($$select public.publish_event_if_current('aa200000-0000-4000-8000-000000000001',(select context->>'context_token' from observations where name='aba-before'))$$,'P0001','EVENT_CONTEXT_CONFLICT','old token stays stale after a capacity round trip');

create temp table other_mutation_replies(name text,reply jsonb);
insert into other_mutation_replies values('requirements',public.save_owned_event_requirements_if_current('aa200000-0000-4000-8000-000000000001',pg_temp.ctx()->'current_saved'->'facts'->'disclosures',pg_temp.ctx()->>'context_token'));
select is((select jsonb_typeof(reply->'result') from other_mutation_replies where name='requirements'),'array','conditional requirements preserves existing result-array shape');
select is((select reply->'context' from other_mutation_replies where name='requirements'),pg_temp.ctx(),'requirements reply context is exact current atomic state');
insert into other_mutation_replies values('accept',public.accept_current_event_policies_if_current('aa200000-0000-4000-8000-000000000001',pg_temp.ctx()->>'context_token'));
select is((select jsonb_typeof(reply->'result') from other_mutation_replies where name='accept'),'array','conditional acceptance preserves existing result-array shape');
select is((select reply->'context' from other_mutation_replies where name='accept'),pg_temp.ctx(),'acceptance reply context is exact current atomic state');
insert into other_mutation_replies values('publish',public.publish_event_if_current('aa200000-0000-4000-8000-000000000001',pg_temp.ctx()->>'context_token'));
select is((select reply->'result'->>'status' from other_mutation_replies where name='publish'),'published','conditional publication returns existing event object');
select is((select reply->'context' from other_mutation_replies where name='publish'),pg_temp.ctx(),'publication reply context is exact current atomic state');
insert into observations values('policy-before',pg_temp.ctx());
update private.organizer_policy_release_settings set environment='unconfigured';
select throws_ok($$select public.accept_current_event_policies_if_current('aa200000-0000-4000-8000-000000000001',(select context->>'context_token' from observations where name='policy-before'))$$,'P0001','EVENT_CONTEXT_CONFLICT','global policy release change invalidates expected acceptance context');
update private.organizer_policy_release_settings set environment='development';
insert into observations values('moderation-before',pg_temp.ctx());
update public.events set moderation_status='under_review',moderation_version=moderation_version+1 where id='aa200000-0000-4000-8000-000000000001';
select throws_ok($$select public.publish_event_if_current('aa200000-0000-4000-8000-000000000001',(select context->>'context_token' from observations where name='moderation-before'))$$,'P0001','EVENT_CONTEXT_CONFLICT','moderation transition invalidates expected publish context');
select is(private.event_material_change_fields('{"venue_name":" Community  Hall ","city":"San Francisco"}','{"venue_name":"community hall","city":"SAN FRANCISCO"}'),'{}'::text[],'normalized whitespace and case do not create material venue/location change');
select is(private.event_material_change_fields('{"latitude":37.7}','{"latitude":37.8}'),array['latitude'],'geographic relocation is material');
-- Emulate a pre-history row by using preserved writers before any completed
-- history facade; its pending deferred hooks have not run yet.
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
select 'aa200000-0000-4000-8000-000000000003',organizer_id,'Legacy community gathering',description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity
from public.events where id='aa200000-0000-4000-8000-000000000001';
select public.save_owned_event_requirements_without_change_history('aa200000-0000-4000-8000-000000000003','{"minimum_age":"all_ages","alcohol_present":false,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false}');
select public.accept_current_event_policies_without_change_history('aa200000-0000-4000-8000-000000000003');
select public.publish_event_without_change_history('aa200000-0000-4000-8000-000000000003');
select ok(not exists(select 1 from private.event_change_state where event_id='aa200000-0000-4000-8000-000000000003'),'legacy fixture has no invented observations before first read');
insert into observations values('legacy',public.get_owned_event_change_context('aa200000-0000-4000-8000-000000000003'));
select is((select context->>'currently_publicly_eligible' from observations where name='legacy'),'true','legacy seed starts from provably eligible current row');
select is((select context->'previous_saved' from observations where name='legacy'),'null'::jsonb,'legacy previous saved is honestly unavailable');
select is((select context->'previous_publicly_eligible' from observations where name='legacy'),'null'::jsonb,'legacy previous public is honestly unavailable');
select is((select context->'current_publicly_eligible' from observations where name='legacy'),(select context->'current_saved' from observations where name='legacy'),'legacy current public seed contains exact current saved facts');
-- Cancellation must not depend on notice submission availability.
create or replace function private.mark_event_change_notice_submitted(p_event_id uuid,p_snapshot_id uuid) returns void
language plpgsql security definer set search_path='' as $$begin raise exception 'NOTICE_ENGINE_UNAVAILABLE'; end;$$;
insert into observations values('cancel-before',pg_temp.ctx());
select lives_ok($$select public.cancel_owned_event('aa200000-0000-4000-8000-000000000001')$$,'existing cancellation succeeds with notice submission unavailable');
select is(pg_temp.ctx()->'event'->>'status','cancelled','owner context observes canonical cancellation');
select is(pg_temp.ctx()->>'currently_publicly_eligible','false','cancelled facts cannot be currently eligible');
select isnt(pg_temp.ctx()->>'context_token',(select context->>'context_token' from observations where name='cancel-before'),'cancellation invalidates expected context');
select is(pg_temp.ctx()->'current_saved',(select context->'current_saved' from observations where name='cancel-before'),'cancellation does not fabricate a new saved content snapshot');
select is(pg_temp.ctx()->'current_publicly_eligible',(select context->'current_publicly_eligible' from observations where name='cancel-before'),'cancellation preserves historical public facts');

set constraints all immediate;
select ok(true,'deferred history hooks flush without intermediate-state or recursion failure');

select * from finish();
rollback;
