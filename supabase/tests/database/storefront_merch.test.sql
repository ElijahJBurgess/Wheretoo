begin;
create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
insert into auth.users(id,email) values('24000000-0000-4000-8000-000000000051','merch@example.invalid');
insert into public.organizers(id,display_name) values('24000000-0000-4000-8000-000000000051','Merch owner');
insert into storage.objects(id,bucket_id,name,metadata,user_metadata) values('24000000-0000-4000-8000-000000000052','organizer-media','24000000-0000-4000-8000-000000000051/24000000-0000-4000-8000-000000000052.png','{"size":100,"mimetype":"image/png"}','{"organizer_id":"24000000-0000-4000-8000-000000000051"}');
select set_config('request.jwt.claim.sub','24000000-0000-4000-8000-000000000051',true);
set local role authenticated;
select lives_ok($$select public.save_owned_storefront_merch('[{"id":"24000000-0000-4000-8000-000000000053","imageId":"24000000-0000-4000-8000-000000000052","title":"Tour shirt","price":"$25","url":"https://example.org/shirt"}]','https://example.org',(select updated_at from public.organizers))$$,'Valid external merch');
select is(public.get_owned_storefront_editor()#>>'{merch,0,title}','Tour shirt','Merch saved in order');
select throws_ok($$select public.save_owned_storefront_merch('[{"id":"24000000-0000-4000-8000-000000000053","imageId":"24000000-0000-4000-8000-000000000052","title":"Tour shirt","price":null,"url":"javascript:alert(1)"}]',null,(select updated_at from public.organizers))$$,'P0001','MERCH_INVALID','Unsafe merch link rejected');
select throws_ok($$select public.save_owned_storefront_merch('[{},{},{},{}]',null,(select updated_at from public.organizers))$$,'P0001','MERCH_INVALID','Maximum three');
select throws_ok($$select public.save_owned_storefront_merch('[{"id":"24000000-0000-4000-8000-000000000053","imageId":"24000000-0000-4000-8000-000000000059","title":"Shirt","price":null,"url":"https://example.org"}]',null,(select updated_at from public.organizers))$$,'P0001','IMAGE_NOT_OWNED','Unknown image rejected');
reset role;
select is((select count(*) from public.orders),0::bigint,'No commerce mutation');
-- Match the Storage API's deletion transaction setting; all changes roll back.
set local storage.allow_delete_query='true';
select throws_ok($$delete from storage.objects where id='24000000-0000-4000-8000-000000000052'$$,'P0001','IMAGE_IN_USE','Referenced merch image protected');
select * from finish();rollback;
