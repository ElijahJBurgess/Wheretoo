begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select private.configure_policy_environment('development');
\ir map_icon_events.inc
select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.accept_current_event_policies('29000000-0000-4000-8000-000000000050');
select public.publish_event('29000000-0000-4000-8000-000000000050');
create function pg_temp.ctx() returns jsonb language sql as $$
  select public.get_owned_event_change_context('29000000-0000-4000-8000-000000000050')
$$;
create function pg_temp.save(p_patch jsonb,p_token text default null) returns jsonb language sql as $$
  select public.save_owned_event_revision_if_current('29000000-0000-4000-8000-000000000050',
    ((pg_temp.ctx()->'current_saved'->'facts')-'disclosures') ||
    jsonb_build_object('expected_content_revision',(pg_temp.ctx()->'event'->>'content_revision')::bigint) || p_patch,
    coalesce(p_token,pg_temp.ctx()->>'context_token'))
$$;
create temporary table observed(name text primary key,context jsonb);
insert into observed values('initial',pg_temp.ctx());
select lives_ok($$select pg_temp.save('{"map_icon_version_id":"29000000-0000-4000-8000-000000000031"}')$$,
  'icon assignment uses the current-main context wrapper');
select is(pg_temp.ctx()->'event'->>'map_icon_version_id','29000000-0000-4000-8000-000000000031','context exposes atomic icon assignment');
select is((pg_temp.ctx()->'event'->>'content_revision')::bigint,
  (select (context->'event'->>'content_revision')::bigint+1 from observed where name='initial'),'icon-only edit increments once');
select isnt(pg_temp.ctx()->>'context_token',(select context->>'context_token' from observed where name='initial'),'icon changes stale the entire editor context');
select is(pg_temp.ctx()->>'notice_required','false','icon-only does not invent attendee material-change notices');
select is(pg_temp.ctx()->'current_saved'->>'snapshot_id',(select context->'current_saved'->>'snapshot_id' from observed where name='initial'),'icon-only preserves main history fact contract');
select throws_ok($$select pg_temp.save('{"map_icon_version_id":null}',(select context->>'context_token' from observed where name='initial'))$$,
  'P0001','EVENT_CONTEXT_CONFLICT','stale whole-context edit cannot clear icon');
select lives_ok($$select public.accept_current_event_policies_if_current('29000000-0000-4000-8000-000000000050',pg_temp.ctx()->>'context_token')$$,
  'policy acceptance preserves wrapper and accepts immutable icon digest');
select is(pg_temp.ctx()->'requirements'->>'needs_acceptance','false','read and write agree on icon-inclusive acceptance digest');
select lives_ok($$select public.publish_event_if_current('29000000-0000-4000-8000-000000000050',pg_temp.ctx()->>'context_token')$$,
  'icon revision can republish through current main');
insert into observed values('icon',pg_temp.ctx());
select lives_ok($$select pg_temp.save(jsonb_build_object('map_icon_version_id',null,'starts_at','2035-01-01T21:00:00+00:00'))$$,
  'combined schedule and icon edit succeeds');
select is((pg_temp.ctx()->'event'->>'content_revision')::bigint,
  (select (context->'event'->>'content_revision')::bigint+1 from observed where name='icon'),'mixed deterministic edit increments once');
select is(pg_temp.ctx()->>'notice_required','true','mixed material edit records notice');
select is(pg_temp.ctx()->'required_fields','["starts_at"]'::jsonb,'icon does not pollute main material notice fields');
select is(pg_temp.ctx()->'previous_saved',(select context->'current_saved' from observed where name='icon'),'before history remains exact');
select is(pg_temp.ctx()->'current_saved'->'facts'->>'starts_at','2035-01-01T21:00:00+00:00','after history captures completed schedule change');
insert into observed values('schedule',pg_temp.ctx());
select lives_ok($$select pg_temp.save('{"title":"Changed community title","map_icon_version_id":"29000000-0000-4000-8000-000000000031"}')$$,
  'mixed text and icon edit succeeds');
select is((pg_temp.ctx()->'event'->>'content_revision')::bigint,
  (select (context->'event'->>'content_revision')::bigint+1 from observed where name='schedule'),'mixed full-review edit increments once');
select is(pg_temp.ctx()->'event'->>'moderation_status','under_review','full review wins mixed icon/text edit');
select is(pg_temp.ctx()->'current_saved'->'facts'->>'title','Changed community title','history captures new text before returning');
select is(pg_temp.ctx()->>'notice_required','true','later icon/text edit does not clear pending attendee notice');
select is(pg_temp.ctx()->>'required_snapshot_id',pg_temp.ctx()->'current_saved'->>'snapshot_id','notice follows final current snapshot');
select throws_ok($$select public.accept_current_event_policies_if_current('29000000-0000-4000-8000-000000000050',(select context->>'context_token' from observed where name='icon'))$$,
  'P0001','EVENT_CONTEXT_CONFLICT','stale policy acceptance remains forbidden');
select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000002',true);
select throws_ok($$select pg_temp.save('{"map_icon_version_id":null}')$$,'P0001','EVENT_NOT_FOUND','foreign owner cannot assign through history wrapper');
reset role;
select is(pg_get_function_identity_arguments('public.accept_current_event_policies(uuid)'::regprocedure),
  'p_event_id uuid','canonical acceptance boundary retains only event identity');
select ok(not has_function_privilege('authenticated','public.accept_current_event_policies_without_change_history(uuid)','execute'),
  'client cannot bypass acceptance context/history wrapper');
select ok(not has_function_privilege('authenticated','public.save_owned_event_revision_without_change_history(uuid,jsonb)','execute'),
  'client cannot bypass revision history wrapper');
set constraints all immediate;
select ok(true,'deferred history hooks complete without recursive capture');
select * from finish();
rollback;
