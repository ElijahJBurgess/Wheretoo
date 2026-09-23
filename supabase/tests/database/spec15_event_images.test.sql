begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_table('private','event_images','existing canonical attachment table retained');
select is((select public from storage.buckets where id='event-images'),false,'canonical bucket remains private');
insert into auth.users(id,email) values ('15150000-0000-4000-8000-000000000001','image-owner@example.invalid'),('15150000-0000-4000-8000-000000000002','image-foreign@example.invalid');
insert into public.organizers(id,display_name) values ('15150000-0000-4000-8000-000000000001','Image owner'),('15150000-0000-4000-8000-000000000002','Foreign owner');
insert into public.events(id,organizer_id) values ('15150000-0000-4000-8000-000000000010','15150000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','15150000-0000-4000-8000-000000000001',true);
insert into storage.objects(id,bucket_id,name,metadata,user_metadata)
select ('15150000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'event-images','15150000-0000-4000-8000-000000000010/'||('15150000-0000-4000-8000-'||lpad(n::text,12,'0'))||'.png',
'{"size":100,"mimetype":"image/png"}','{"organizer_id":"15150000-0000-4000-8000-000000000001","cover_staged":true,"cover_revision":0}' from generate_series(101,104) n;
select is(jsonb_array_length(public.list_event_images(array['15150000-0000-4000-8000-000000000010'::uuid])),0,'new uploads stage without automatic attachment');
-- Recreate a legacy full gallery; only the privileged test can insert attachments directly.
insert into private.event_images(id,event_id,object_path,position)
select id,'15150000-0000-4000-8000-000000000010',name,row_number() over(order by name)
from storage.objects where bucket_id='event-images' and name like '15150000-0000-4000-8000-000000000010/%' and id<>'15150000-0000-4000-8000-000000000104';
select is(jsonb_array_length(public.list_event_images(array['15150000-0000-4000-8000-000000000010'::uuid])),3,'legacy three-image gallery stays readable');
set local role authenticated;
select throws_ok($$select public.reorder_event_images('15150000-0000-4000-8000-000000000010',array['15150000-0000-4000-8000-000000000103']::uuid[])$$,'42501',null,'legacy reorder cannot bypass cover revisions');
select set_config('request.jwt.claim.sub','15150000-0000-4000-8000-000000000002',true);
select is(public.list_event_images(array['15150000-0000-4000-8000-000000000010'::uuid]),'[]'::jsonb,'foreign owner cannot read draft images');
select is((select count(*) from storage.objects where bucket_id='event-images' and name like '15150000-0000-4000-8000-000000000010/%'),0::bigint,'foreign storage reads denied');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('event-images','15150000-0000-4000-8000-000000000010/15150000-0000-4000-8000-000000000105.png','{"size":100,"mimetype":"image/png"}')$$,'42501',null,'direct foreign upload denied');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is(public.list_event_images(array['15150000-0000-4000-8000-000000000010'::uuid]),'[]'::jsonb,'anonymous cannot read draft images');
reset role;
select set_config('request.jwt.claim.sub','15150000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.server_commit_event_cover('15150000-0000-4000-8000-000000000010','15150000-0000-4000-8000-000000000001',1,'15150000-0000-4000-8000-000000000010/15150000-0000-4000-8000-000000000104.png')$$,'P0001','COVER_STALE','stale replacement leaves gallery intact');
select is(jsonb_array_length(public.list_event_images(array['15150000-0000-4000-8000-000000000010'::uuid])),3,'failure preserves all old attachments');
select public.server_commit_event_cover('15150000-0000-4000-8000-000000000010','15150000-0000-4000-8000-000000000001',0,'15150000-0000-4000-8000-000000000010/15150000-0000-4000-8000-000000000104.png');
select is(jsonb_array_length(public.list_event_images(array['15150000-0000-4000-8000-000000000010'::uuid])),1,'atomic replacement works even with full legacy gallery');
select is(public.list_event_images(array['15150000-0000-4000-8000-000000000010'::uuid])->0->>'id','15150000-0000-4000-8000-000000000104','selected image uses canonical position one');
select public.server_remove_event_cover('15150000-0000-4000-8000-000000000010','15150000-0000-4000-8000-000000000001',1);
select is(jsonb_array_length(public.list_event_images(array['15150000-0000-4000-8000-000000000010'::uuid])),0,'guarded remove clears canonical attachment');
select ok(not has_function_privilege('anon','public.server_get_public_event_image(uuid)','execute'),'public cannot call privileged delivery lookup');
select ok(not has_function_privilege('authenticated','public.server_commit_event_cover(uuid,uuid,bigint,text,uuid,smallint)','execute'),'browser cannot bypass validating Edge with service commit');
select ok(has_function_privilege('service_role','public.server_get_public_event_image(uuid)','execute'),'delivery worker keeps its narrow lookup');
select * from finish();
rollback;
