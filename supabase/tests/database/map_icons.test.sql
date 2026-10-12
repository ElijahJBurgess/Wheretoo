begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_table('private', 'map_icons','private catalog exists');
select has_table('private', 'map_icon_versions','versions exist');
select has_table('private', 'map_icon_audit','audit exists');
select has_table('private', 'map_icon_settings','settings exist');
select has_column('public', 'events', 'map_icon_version_id','nullable event reference exists');
select has_function('public', 'get_public_map_icon_versions', array['uuid[]']);
select has_function('public', 'list_selectable_map_icons', array['uuid','integer']);
create temporary table icon_test_package as select
  '{"schemaVersion":1,"widthPx":600,"heightPx":922,"pixelRatio":3,"contactPx":[87,922],"anchor":"bottom","selectedScale":1,"desktop":{"minZoom":14.5,"maxZoom":24,"stops":[[14.6,0.18],[14.8,0.19],[16.25,0.22]]},"mobile":{"minZoom":14.5,"maxZoom":24,"stops":[[14.6,0.18],[14.8,0.19],[16.25,0.22]]},"hit":{"kind":"legacy-css-circle","radius":38,"translation":[17,-34],"minTargetDiameter":44},"alignment":{"pitch":"viewport","rotation":"viewport"},"collisionMode":"always-visible","sdf":false}'::jsonb m,
  jsonb_build_object('originalSha256',repeat('a',64),'pngSha256',repeat('b',64),'rgbaSha256',repeat('c',64),
    'originalBytes',1000,'runtimeBytes',500,'originalWidth',1254,'originalHeight',1254,
    'crop',jsonb_build_object('x',394,'y',152,'width',600,'height',922)) p;
grant select on icon_test_package to authenticated,anon;
select ok(private.valid_map_icon_metadata(m),'approved geometry valid') from icon_test_package;
select ok(not private.valid_map_icon_metadata(m||'{"url":"https://bad.invalid"}'),'URLs rejected') from icon_test_package;
select ok(not private.valid_map_icon_metadata(m||'{"anchor":null}'),'null anchor rejected') from icon_test_package;
select ok(not private.valid_map_icon_metadata(jsonb_set(m,'{mobile,stops}','[[16,0.2],[15,0.2]]')),'unordered stops rejected') from icon_test_package;
select ok(not private.valid_map_icon_metadata(jsonb_set(m,'{desktop,stops}','[[15,2],[16,2]]')),'oversized display rejected') from icon_test_package;
select ok(not private.valid_map_icon_metadata(jsonb_set(m,'{hit,radius}','65')),'oversized hit rejected') from icon_test_package;
select ok(not private.valid_map_icon_metadata(jsonb_set(m,'{contactPx}','[601,922]')),'outside contact rejected') from icon_test_package;
select ok(not has_column_privilege('authenticated','public.events','map_icon_version_id','UPDATE'),'no organizer direct update');
select ok(not has_column_privilege('authenticated','public.events','map_icon_version_id','INSERT'),'no organizer direct insert');
select ok(not has_table_privilege('authenticated','private.map_icons','SELECT'),'no private catalog read');
select ok(not has_table_privilege('anon','private.map_icon_versions','SELECT'),'no anonymous provenance');
select is((select count(*) from public.events where map_icon_version_id is not null),0::bigint,'no assignments');
select ok((select not rendering_enabled and not selection_enabled from private.map_icon_settings),'foundation disabled');
insert into auth.users(id,email) values
 ('24000000-0000-4000-8000-000000000001','icon-admin@example.invalid'),
 ('24000000-0000-4000-8000-000000000002','icon-organizer@example.invalid'),
 ('24000000-0000-4000-8000-000000000003','icon-moderator@example.invalid');
insert into private.staff_roles(user_id,role,active,granted_by) values
 ('24000000-0000-4000-8000-000000000001','admin',true,'24000000-0000-4000-8000-000000000001'),
 ('24000000-0000-4000-8000-000000000003','moderator',true,'24000000-0000-4000-8000-000000000001');
set local role anon;
select throws_ok($$select public.prepare_map_icon_version(gen_random_uuid(),'flag','Flag',m,p) from icon_test_package$$,'42501',null,'anon cannot curate');
select throws_ok($$select public.list_selectable_map_icons()$$,'42501',null,'anon cannot browse catalog');
select is(public.get_public_map_icon_versions('{}')->'versions','[]'::jsonb,'public resolver empty');
set local role authenticated;
select set_config('request.jwt.claim.sub','24000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.prepare_map_icon_version(gen_random_uuid(),'flag','Flag',m,p) from icon_test_package$$,'P0001','STAFF_ROLE_REQUIRED','organizer cannot curate');
select throws_ok($$insert into storage.objects(bucket_id,name) values('map-icon-originals','bad.png')$$,'P0001','ICON_ASSET_NOT_APPROVED','organizer cannot upload unregistered path');
select throws_ok($$update public.events set map_icon_version_id=gen_random_uuid()$$,'42501',null,'assignment writes actually denied');
select set_config('request.jwt.claim.sub','24000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.prepare_map_icon_version(gen_random_uuid(),'flag','Flag',m,p) from icon_test_package$$,'P0001','STAFF_ADMIN_REQUIRED','moderator cannot curate');
select set_config('request.jwt.claim.sub','24000000-0000-4000-8000-000000000001',true);
select set_config('test.catalog_count',jsonb_array_length(public.list_selectable_map_icons()->'icons')::text,true);
select throws_ok($$select public.prepare_map_icon_version(gen_random_uuid(),'invalid-number-hash','Invalid',m,jsonb_set(p,'{originalSha256}',to_jsonb(repeat('1',64)::numeric))) from icon_test_package$$,'P0001','ICON_PACKAGE_INVALID','hash provenance must be strings, never coerced numbers');
select lives_ok($$select public.prepare_map_icon_version('24000000-0000-4000-8000-000000000010','test-flag','Test Flag',m,p) from icon_test_package$$,'admin prepares immutable package');
select lives_ok($$select public.prepare_map_icon_version('24000000-0000-4000-8000-000000000010','test-flag','Test Flag',m,p) from icon_test_package$$,'same request idempotent');
select throws_ok($$select public.prepare_map_icon_version('24000000-0000-4000-8000-000000000010','test-flag','Different',m,p) from icon_test_package$$,'P0001','ICON_REQUEST_CONFLICT','retry cannot change package');
reset role;
select set_config('test.icon_id',(select id::text from private.map_icon_versions where request_id='24000000-0000-4000-8000-000000000010'),true);
select set_config('test.package_hash',(select package_hash from private.map_icon_versions where id=current_setting('test.icon_id')::uuid),true);
select is((select count(*) from private.map_icon_versions where request_id='24000000-0000-4000-8000-000000000010'),1::bigint,'retry one version');
set local role authenticated;
select is(jsonb_array_length(public.list_selectable_map_icons()->'icons'),current_setting('test.catalog_count')::integer,'unpublished unavailable in catalog');
select is(public.get_public_map_icon_versions(array[current_setting('test.icon_id')::uuid])->'versions','[]'::jsonb,'unpublished unavailable publicly');
select throws_ok($$select public.transition_map_icon_version(current_setting('test.icon_id')::uuid,current_setting('test.package_hash'),'approved','Test')$$,'P0001','ICON_PRIVATE_ASSETS_MISSING','approval requires private objects');
reset role;
insert into storage.objects(bucket_id,name,metadata)
 select 'map-icon-originals',original_path,'{"mimetype":"image/png","size":1000}'::jsonb from private.map_icon_versions where id=current_setting('test.icon_id')::uuid;
insert into storage.objects(bucket_id,name,metadata)
 select 'map-icon-originals',crop_path,'{"mimetype":"image/png","size":500}'::jsonb from private.map_icon_versions where id=current_setting('test.icon_id')::uuid;
set local role authenticated;
select is(public.transition_map_icon_version(current_setting('test.icon_id')::uuid,current_setting('test.package_hash'),'approved','Reviewed exact package'),'approved','admin approves');
select throws_ok($$select public.transition_map_icon_version(current_setting('test.icon_id')::uuid,current_setting('test.package_hash'),'published','Test')$$,'P0001','ICON_RUNTIME_ASSET_MISSING','publish requires object');
reset role;
insert into storage.objects(bucket_id,name,metadata)
 select 'map-icon-published',runtime_path,'{"mimetype":"image/png","size":500}'::jsonb from private.map_icon_versions where id=current_setting('test.icon_id')::uuid;
set local role authenticated;
select is(public.transition_map_icon_version(current_setting('test.icon_id')::uuid,current_setting('test.package_hash'),'published','Verified retrieval'),'published','admin publishes');
select is(jsonb_array_length(public.list_selectable_map_icons()->'icons'),current_setting('test.catalog_count')::integer+1,'published catalog entry');
select is(jsonb_array_length(public.get_public_map_icon_versions(array[current_setting('test.icon_id')::uuid])->'versions'),1,'public approved resolution');
select ok(not ((public.get_public_map_icon_versions(array[current_setting('test.icon_id')::uuid])#>'{versions,0}') ?| array['provenance','created_by','originalPath','cropPath','approved_by']),'no private fields exposed');
reset role;
select throws_ok($$update private.map_icon_versions set metadata=jsonb_set(metadata,'{selectedScale}','1.1') where id=current_setting('test.icon_id')::uuid$$,'P0001','ICON_VERSION_IMMUTABLE','published metadata immutable even to owner');
select throws_ok($$delete from private.map_icon_versions where id=current_setting('test.icon_id')::uuid$$,'P0001','ICON_VERSION_IMMUTABLE','versions not deleted');
select throws_ok($$update storage.objects set metadata='{}' where bucket_id='map-icon-published' and name=(select runtime_path from private.map_icon_versions where id=current_setting('test.icon_id')::uuid)$$,'P0001','ICON_ASSET_IMMUTABLE','published object cannot overwrite');
set local role authenticated;
select is(public.transition_map_icon_version(current_setting('test.icon_id')::uuid,current_setting('test.package_hash'),'retired','No new choices'),'retired','retire');
select is(jsonb_array_length(public.list_selectable_map_icons()->'icons'),current_setting('test.catalog_count')::integer,'retired not selectable');
select is(jsonb_array_length(public.get_public_map_icon_versions(array[current_setting('test.icon_id')::uuid])->'versions'),1,'retired remains renderable');
select is(public.transition_map_icon_version(current_setting('test.icon_id')::uuid,current_setting('test.package_hash'),'revoked','Remove reference'),'revoked','revoke');
select is(public.get_public_map_icon_versions(array[current_setting('test.icon_id')::uuid])->'versions','[]'::jsonb,'revoked not public');
select throws_ok($$select public.transition_map_icon_version(current_setting('test.icon_id')::uuid,current_setting('test.package_hash'),'published','Undo')$$,'P0001','ICON_STATE_INVALID','cannot resurrect revoked version');
reset role;
update private.staff_roles set active=false where user_id='24000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.prepare_map_icon_version(gen_random_uuid(),'flag','Flag',m,p) from icon_test_package$$,'P0001','STAFF_ROLE_REQUIRED','revoked admin denied');
reset role;
select * from finish();
rollback;
