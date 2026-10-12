begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- The test mutates only transaction-local fixtures; production catalog is untouched.
insert into auth.users(id,email) values
 ('29000000-0000-4000-8000-000000000001','icon-owner@example.invalid'),
 ('29000000-0000-4000-8000-000000000002','icon-other@example.invalid');
insert into public.organizers(id,display_name) values
 ('29000000-0000-4000-8000-000000000001','Icon Owner'),
 ('29000000-0000-4000-8000-000000000002','Other Owner');
create temporary table save_input(p jsonb);
insert into save_input values ('{"title":"Draft title","description":null,"category":null,"starts_at":null,"ends_at":null,"timezone":"America/Los_Angeles","venue_name":null,"address_line1":null,"address_line2":null,"city":null,"region":null,"postal_code":null,"country_code":"US","mapbox_feature_id":null,"latitude":null,"longitude":null,"admission_type":"free","capacity":null,"map_icon_version_id":null}');
grant select on save_input to authenticated,anon;
select has_function('public','save_owned_event_draft',array['uuid','jsonb','timestamp with time zone','uuid'],'atomic draft boundary exists');
select has_function('public','get_owned_event_map_icon',array['uuid'],'owned assignment read exists');
select ok(not has_column_privilege('authenticated','public.events','map_icon_version_id','UPDATE'),'direct update remains denied');
select ok(not has_column_privilege('authenticated','public.events','map_icon_version_id','INSERT'),'direct insert remains denied');
set local role anon;
select throws_ok($$select public.save_owned_event_draft(null,p,null,gen_random_uuid()) from save_input$$,'42501',null,'anonymous cannot save');
set local role authenticated;
select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.save_owned_event_draft(null,p,null,'29000000-0000-4000-8000-000000000010') from save_input$$,'default draft saves');
select set_config('test.saved_id',(select id::text from public.events where organizer_id=auth.uid()),true);
select set_config('test.saved_at',(select updated_at::text from public.events where id=current_setting('test.saved_id')::uuid),true);
select lives_ok($$select public.save_owned_event_draft(null,p,null,'29000000-0000-4000-8000-000000000010') from save_input$$,'identical create replay succeeds');
select is((select count(*) from public.events where organizer_id=auth.uid()),1::bigint,'replay creates exactly one draft');
select throws_ok($$select public.save_owned_event_draft(null,p||'{"title":"Different"}',null,'29000000-0000-4000-8000-000000000010') from save_input$$,'P0001','EVENT_DRAFT_REQUEST_CONFLICT','changed replay rejects');
select throws_ok($$select public.save_owned_event_draft(current_setting('test.saved_id')::uuid,p,'2000-01-01',gen_random_uuid()) from save_input$$,'P0001','EVENT_DRAFT_CONFLICT','stale edit rejects');
select throws_ok($$select public.save_owned_event_draft(current_setting('test.saved_id')::uuid,p,null,gen_random_uuid()) from save_input$$,'P0001','EVENT_DRAFT_CONFLICT','missing edit timestamp rejects');
select throws_ok($$select public.save_owned_event_draft(null,p||'{"map_icon_version_id":"29000000-0000-4000-8000-000000000099"}',null,gen_random_uuid()) from save_input$$,'P0001','EVENT_ICON_UNAVAILABLE','unknown version rejects');
select throws_ok($$select public.save_owned_event_draft(null,p||'{"map_icon_version_id":"https://bad.invalid/icon.png"}',null,gen_random_uuid()) from save_input$$,'P0001','EVENT_DRAFT_INVALID','URL is not a version');
select throws_ok($$select public.save_owned_event_draft(null,p||'{"storage_path":"icons/bad.png"}',null,gen_random_uuid()) from save_input$$,'P0001','EVENT_DRAFT_INVALID','extra path rejects');
select throws_ok($$select public.save_owned_event_draft(null,p||'{"title":42}',null,gen_random_uuid()) from save_input$$,'P0001','EVENT_DRAFT_INVALID','coerced text rejects');
select throws_ok($$select public.save_owned_event_draft(null,p||'{"capacity":1.5}',null,gen_random_uuid()) from save_input$$,'P0001','EVENT_DRAFT_INVALID','fractional capacity rejects');
select throws_ok($$select public.save_owned_event_draft(null,p||'{"map_icon_version_id":7}',null,gen_random_uuid()) from save_input$$,'P0001','EVENT_DRAFT_INVALID','numeric version rejects');
select is((select count(*) from public.events where organizer_id=auth.uid()),1::bigint,'invalid creates leave no partial rows');
select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.save_owned_event_draft(current_setting('test.saved_id')::uuid,p,current_setting('test.saved_at')::timestamptz,gen_random_uuid()) from save_input$$,'P0001','EVENT_NOT_FOUND','foreign event save rejects');
select throws_ok($$select public.get_owned_event_map_icon(current_setting('test.saved_id')::uuid)$$,'P0001','EVENT_NOT_FOUND','foreign assignment read rejects');
reset role;

-- Seed independent valid packages without relying on an imported local flag.
insert into private.map_icons(id,slug,display_name) values
 ('29000000-0000-4000-8000-000000000020','save-test-icon','Test Icon');
insert into private.map_icon_versions(id,icon_id,version,request_id,state,metadata,provenance,package_hash,png_sha256,byte_size,original_path,crop_path,runtime_path,created_by,approved_by,approved_at,published_at)
select ('29000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '29000000-0000-4000-8000-000000000020',n,gen_random_uuid(),state,
 '{"schemaVersion":1,"widthPx":600,"heightPx":922,"pixelRatio":3,"contactPx":[87,922],"anchor":"bottom","selectedScale":1,"desktop":{"minZoom":14.5,"maxZoom":24,"stops":[[14.6,0.18],[14.8,0.19],[16.25,0.22]]},"mobile":{"minZoom":14.5,"maxZoom":24,"stops":[[14.6,0.18],[14.8,0.19],[16.25,0.22]]},"hit":{"kind":"legacy-css-circle","radius":38,"translation":[17,-34],"minTargetDiameter":44},"alignment":{"pitch":"viewport","rotation":"viewport"},"collisionMode":"always-visible","sdf":false}'::jsonb,
 '{}',repeat('a',64),repeat('b',64),500,
 'icons/29000000-0000-4000-8000-000000000020/29000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/original.png',
 'icons/29000000-0000-4000-8000-000000000020/29000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/crop.png',
 'icons/29000000-0000-4000-8000-000000000020/29000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/'||repeat('b',64)||'.png',
 '29000000-0000-4000-8000-000000000001',
 case when state='validated' then null else '29000000-0000-4000-8000-000000000001'::uuid end,
 case when state='validated' then null else now() end,
 case when state in ('validated','approved') then null else now() end
from (values(31,'published'),(32,'validated'),(33,'approved'),(34,'retired'),(35,'revoked')) s(n,state);
update private.map_icons set current_version_id='29000000-0000-4000-8000-000000000031' where id='29000000-0000-4000-8000-000000000020';
update private.map_icon_settings set selection_enabled=true;
set local role authenticated;
select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000001',true);
select throws_ok(format('select public.save_owned_event_draft(null,p||%L::jsonb,null,gen_random_uuid()) from save_input',jsonb_build_object('map_icon_version_id','29000000-0000-4000-8000-'||lpad(n::text,12,'0'))),'P0001','EVENT_ICON_UNAVAILABLE','nonselectable version rejects: '||n) from generate_series(32,35) n;
select lives_ok($$select public.save_owned_event_draft(current_setting('test.saved_id')::uuid,p||'{"map_icon_version_id":"29000000-0000-4000-8000-000000000031"}',current_setting('test.saved_at')::timestamptz,gen_random_uuid()) from save_input$$,'owned selectable icon saves atomically');
select is((select map_icon_version_id::text from public.events where id=current_setting('test.saved_id')::uuid),'29000000-0000-4000-8000-000000000031','saved pinned UUID persists');
select is(public.get_owned_event_map_icon(current_setting('test.saved_id')::uuid)->>'name','Test Icon','owner receives friendly name');
select ok(not (public.get_owned_event_map_icon(current_setting('test.saved_id')::uuid) ? 'provenance'),'owner read does not expose provenance');
select set_config('test.saved_at',(select updated_at::text from public.events where id=current_setting('test.saved_id')::uuid),true);
select lives_ok($$select public.save_owned_event_draft(current_setting('test.saved_id')::uuid,p-'map_icon_version_id',current_setting('test.saved_at')::timestamptz,gen_random_uuid()) from save_input$$,'old payload retains icon');
select is((select map_icon_version_id::text from public.events where id=current_setting('test.saved_id')::uuid),'29000000-0000-4000-8000-000000000031','omission is not null');
select throws_ok($$select public.save_owned_event_draft(current_setting('test.saved_id')::uuid,p||jsonb_build_object('title',repeat('x',121)),current_setting('test.saved_at')::timestamptz,gen_random_uuid()) from save_input$$,'P0001','EVENT_DRAFT_INVALID','invalid content rolls back icon clearing');
select is((select map_icon_version_id::text from public.events where id=current_setting('test.saved_id')::uuid),'29000000-0000-4000-8000-000000000031','failed content save keeps pinned choice');
select throws_ok($$update public.events set map_icon_version_id=null where id=current_setting('test.saved_id')::uuid$$,'42501',null,'actual direct icon update denied');
select throws_ok($$insert into public.events(organizer_id,map_icon_version_id) values(auth.uid(),null)$$,'42501',null,'actual direct icon insert denied');
reset role;
update private.map_icon_settings set selection_enabled=false;
set local role authenticated;
select throws_ok($$select public.save_owned_event_draft(null,p||'{"map_icon_version_id":"29000000-0000-4000-8000-000000000031"}',null,gen_random_uuid()) from save_input$$,'P0001','EVENT_ICON_UNAVAILABLE','disabled library rejects even published new assignment');
reset role;
update private.map_icon_versions set state='revoked' where id='29000000-0000-4000-8000-000000000031';
update private.map_icon_settings set selection_enabled=false;
set local role authenticated;
select set_config('test.saved_at',(select updated_at::text from public.events where id=current_setting('test.saved_id')::uuid),true);
select lives_ok($$select public.save_owned_event_draft(current_setting('test.saved_id')::uuid,p||'{"title":"Other edit","map_icon_version_id":"29000000-0000-4000-8000-000000000031"}',current_setting('test.saved_at')::timestamptz,gen_random_uuid()) from save_input$$,'unchanged revoked assignment permits unrelated edit');
select is(public.get_owned_event_map_icon(current_setting('test.saved_id')::uuid)->'descriptor','null'::jsonb,'revoked owner read omits render descriptor');
select set_config('test.saved_at',(select updated_at::text from public.events where id=current_setting('test.saved_id')::uuid),true);
select lives_ok($$select public.save_owned_event_draft(current_setting('test.saved_id')::uuid,p,current_setting('test.saved_at')::timestamptz,gen_random_uuid()) from save_input$$,'explicit null restores Default while disabled');
select is((select map_icon_version_id from public.events where id=current_setting('test.saved_id')::uuid),null::uuid,'Default persisted');
select * from finish();
rollback;
