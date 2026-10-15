-- Shared rollback-only fixture for the icon integration tests.
insert into auth.users(id,email) values
 ('29000000-0000-4000-8000-000000000001','icon-owner@example.invalid'),
 ('29000000-0000-4000-8000-000000000002','icon-other@example.invalid');
insert into public.organizers(id,display_name) values
 ('29000000-0000-4000-8000-000000000001','Icon Owner'),
 ('29000000-0000-4000-8000-000000000002','Other Owner');
create temporary table save_input(p jsonb);
insert into save_input values ('{"title":"Draft title","description":null,"category":null,"starts_at":null,"ends_at":null,"timezone":"America/Los_Angeles","venue_name":null,"address_line1":null,"address_line2":null,"city":null,"region":null,"postal_code":null,"country_code":"US","mapbox_feature_id":null,"latitude":null,"longitude":null,"admission_type":"free","capacity":null,"map_icon_version_id":null}');
grant select on save_input to authenticated,anon;
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

insert into public.events(id,organizer_id,status,moderation_status,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity,published_at,moderated_revision)
values('29000000-0000-4000-8000-000000000050','29000000-0000-4000-8000-000000000001','published','clear','Draft title','A friendly public community event.','community','2035-01-01 20:00+00','2035-01-01 22:00+00','America/Los_Angeles','Oakland Venue','1 Broadway','Oakland','CA','94612','US','mapbox.icon-test',37.804,-122.263,'free',100,'2034-12-01',1);
update save_input set p=(select jsonb_build_object('title',title,'description',description,'category',category,'starts_at',starts_at,'ends_at',ends_at,'timezone',timezone,'venue_name',venue_name,'address_line1',address_line1,'address_line2',address_line2,'city',city,'region',region,'postal_code',postal_code,'country_code',country_code,'mapbox_feature_id',mapbox_feature_id,'latitude',latitude,'longitude',longitude,'admission_type',admission_type,'capacity',capacity) from public.events where id='29000000-0000-4000-8000-000000000050');
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
values('29000000-0000-4000-8000-000000000050','all_ages',false,false,false,false,false,false);
