begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_function('public', 'save_owned_organizer_settings', array['text','text','timestamp with time zone'], 'Settings has an authenticated bounded save contract');
insert into auth.users(id,email,raw_user_meta_data) values
 ('11000000-0000-4000-8000-000000000001','owner-a@example.invalid','{"full_name":"Account A"}'),
 ('11000000-0000-4000-8000-000000000002','owner-b@example.invalid','{"full_name":"Account B"}');
insert into public.organizers(id,display_name,bio,organizer_type,website_url,base_city,country_code,onboarding_completed_at,updated_at) values
 ('11000000-0000-4000-8000-000000000001','Public A','Original bio','Venue','https://example.invalid','Oakland','US','2026-08-01','2026-08-01'),
 ('11000000-0000-4000-8000-000000000002','Public B','Other bio',null,null,null,'US','2026-08-02','2026-08-02');
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select results_eq($$select display_name from public.organizers order by id$$,$$values('Public A'::text)$$,'Owner A reads only own Settings profile');
select lives_ok($$select public.save_owned_organizer_settings('Public A','Updated bio','2026-08-01')$$,'Owner saves supported fields');
select results_eq($$select bio, organizer_type,website_url,base_city,country_code,onboarding_completed_at from public.organizers$$,
 $$values('Updated bio'::text,'Venue'::text,'https://example.invalid'::text,'Oakland'::text,'US'::text,'2026-08-01'::timestamptz)$$,'Hidden fields and onboarding timestamp preserved');
select throws_ok($$select public.save_owned_organizer_settings('Stale name','Stale bio','2026-08-01')$$,'P0001','ORGANIZER_SETTINGS_CONFLICT','Stale version is explicit conflict');
select throws_ok($$select public.save_owned_organizer_settings('X','bio',now())$$,'P0001','ORGANIZER_SETTINGS_INVALID','Name bounds enforced on server');
select throws_ok($$select public.save_owned_organizer_settings(repeat('x',101),'bio',now())$$,'P0001','ORGANIZER_SETTINGS_INVALID','Long name rejected');
select throws_ok($$select public.save_owned_organizer_settings('Public A',repeat('x',501),now())$$,'P0001','ORGANIZER_SETTINGS_INVALID','Long bio rejected');
select throws_ok($$select public.save_owned_organizer_settings('Public A','bio',null)$$,'P0001','ORGANIZER_SETTINGS_INVALID','Missing version rejected');
reset role;
select is((select raw_user_meta_data->>'full_name' from auth.users where id='11000000-0000-4000-8000-000000000001'),'Account A','Profile edits never change Auth account name');
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select results_eq($$select display_name from public.organizers$$,$$values('Public B'::text)$$,'Owner B reads only own profile');
select lives_ok($$select public.save_owned_organizer_settings('Public B','Own B bio','2026-08-02')$$,'Owner B save derives own identity');
reset role;
select is((select bio from public.organizers where id='11000000-0000-4000-8000-000000000001'),'Updated bio','Owner B cannot affect A');
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select throws_ok($$select display_name,bio from public.organizers$$,'42501',null,'Anonymous profile reads denied');
select throws_ok($$select public.save_owned_organizer_settings('Intruder',null,now())$$,'42501',null,'Anonymous save denied');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select public.save_owned_organizer_settings('Intruder',null,now())$$,'P0001','ORGANIZER_NOT_FOUND','An authenticated role without session identity cannot save');
reset role;
select ok(not has_column_privilege('authenticated','public.organizers','id','UPDATE'),'No ownership grant added');
select ok(not has_function_privilege('anon','public.save_owned_organizer_settings(text,text,timestamptz)','EXECUTE'),'No anonymous execute grant');
select ok(not has_function_privilege('service_role','public.save_owned_organizer_settings(text,text,timestamptz)','EXECUTE'),'No service bypass granted');
select is((select proargnames[4:6] from pg_proc where oid='public.save_owned_organizer_settings(text,text,timestamptz)'::regprocedure),
 array['display_name','bio','updated_at']::text[],'Save response allowlists only Settings profile fields');
select * from finish();
rollback;
