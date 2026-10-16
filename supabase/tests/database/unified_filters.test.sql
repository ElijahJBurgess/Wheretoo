\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
SELECT is(extract(epoch from ((private.discovery_window('next7','2026-11-01 07:30Z')->>'end')::timestamptz-(private.discovery_window('next7','2026-11-01 07:30Z')->>'start')::timestamptz))::bigint,604800::bigint,'next7 is exactly 168 hours across DST');
SELECT is((private.discovery_window('today','2026-11-01 12:00-08')->>'end')::timestamptz-(private.discovery_window('today','2026-11-01 12:00-08')->>'start')::timestamptz,interval '25 hours','fall Today is 25 hours');
SELECT is((private.discovery_window('today','2026-03-08 12:00-07')->>'end')::timestamptz-(private.discovery_window('today','2026-03-08 12:00-07')->>'start')::timestamptz,interval '23 hours','spring Today is 23 hours');
SELECT ok(has_function_privilege('anon','public.get_public_filtered_map_events(float8,float8,float8,float8,text,text[],text)','execute'),'anonymous filtered map boundary is available');
SELECT ok(NOT has_function_privilege('anon','public.server_get_public_discovery_events(jsonb)','execute'),'list RPC remains service-only');
insert into auth.users(id,email) select ('3a000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'db-audit-'||i||'@example.invalid' from generate_series(1,4)i;
insert into public.organizers(id,display_name) select id,'Audit owner '||right(id::text,1) from auth.users where id::text like '3a000000-%';
insert into public.organizer_stripe_accounts(organizer_id,stripe_account_id,transfers_status,payouts_status,requirements_status,requirements_currently_due_count,requirements_past_due_count,last_synced_at)
select id,'acct_task25fixture'||right(id::text,1),'active','active','clear',0,0,now() from public.organizers where id::text like '3a000000-%';
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
select ('3a100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('3a000000-0000-4000-8000-'||lpad((1+(i-1)%3)::text,12,'0'))::uuid,'Audit Gathering '||i,'A friendly public community gathering for isolated local measurement.',(array['community','music','fitness','art_culture','food_drink','shopping','nightlife','other'])[1+(i-1)%8],now()+interval '1 day',now()+interval '1 day 2 hours','America/Los_Angeles','Audit Venue','1 Broadway','Oakland','CA','94612','US','audit-db-'||i,37.80+(i%5)*0.0001,-122.27+(i%5)*0.0001,case when i%2=0 then 'paid' else 'free' end,100 from generate_series(1,24)i;
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
select id,'all_ages',false,false,false,false,false,false from public.events where id::text like '3a100000-%';
insert into public.ticket_tiers(event_id,name,unit_amount_minor,currency,quantity_total,status,sort_order)
select id,'Audit admission',1200,'usd',10,'active',1 from public.events where id::text like '3a100000-%' and admission_type='paid';
set local role authenticated;
do $$ declare i int;eid uuid;begin for i in 1..24 loop
 eid:=('3a100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
 perform set_config('request.jwt.claim.sub',('3a000000-0000-4000-8000-'||lpad((1+(i-1)%3)::text,12,'0')),true);
 perform public.accept_current_event_policies(eid);perform public.publish_event(eid);
end loop;end $$;
reset role;

SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.events DISABLE TRIGGER USER;
UPDATE public.events SET starts_at=now()+interval '8 days',ends_at=now()+interval '8 days 2 hours' WHERE id='3a100000-0000-4000-8000-000000000002';
CREATE FUNCTION pg_temp.assert_agreement(p_when text,p_category text,p_admission text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE q jsonb:=jsonb_build_object('region','sf_bay_area','when',p_when,'limit',7,'bounds',jsonb_build_object('west',-122.4,'south',37.7,'east',-122.1,'north',37.9)); ids uuid[]:='{}'; page jsonb; map_ids uuid[];
BEGIN
 IF p_category IS NOT NULL THEN q:=q||jsonb_build_object('category',p_category); END IF;
 IF p_admission IS NOT NULL THEN q:=q||jsonb_build_object('admissionType',p_admission); END IF;
 LOOP
  page:=public.server_get_public_discovery_events(q);
  ids:=ids||ARRAY(SELECT (v->>'id')::uuid FROM jsonb_array_elements(page->'items') v);
  EXIT WHEN page->>'nextCursor' IS NULL;
  q:=q||jsonb_build_object('cursor',page->>'nextCursor');
 END LOOP;
 SELECT coalesce(array_agg(event_id ORDER BY starts_at,event_id),'{}'::uuid[]) INTO map_ids FROM public.get_public_filtered_map_events(-122.4,37.7,-122.1,37.9,p_when,CASE WHEN p_category IS NULL THEN NULL ELSE ARRAY[p_category] END,p_admission);
 IF ids IS DISTINCT FROM map_ids THEN RAISE EXCEPTION 'MAP_LIST_MISMATCH % % %: % vs %',p_when,p_category,p_admission,ids,map_ids; END IF;
 RETURN true;
END $$;
SELECT ok(pg_temp.assert_agreement(w,c,a),'map/list exact ordered IDs across presets/categories/admission and paginated results') FROM unnest(ARRAY['next7','today','weekend','upcoming']) w CROSS JOIN unnest(ARRAY[NULL,'music','food_drink','fitness','art_culture','shopping','community','nightlife','other']::text[]) c CROSS JOIN unnest(ARRAY[NULL,'free','paid']::text[]) a;
SELECT is((SELECT count(*) FROM public.get_public_filtered_map_events(-122.4,37.7,-122.1,37.9,'upcoming',NULL,NULL)),24::bigint,'legacy30 includes day8');
SELECT is((SELECT count(*) FROM public.get_public_filtered_map_events(-122.4,37.7,-122.1,37.9,'next7',NULL,NULL)),23::bigint,'next7 excludes day8');
UPDATE public.events SET moderation_status='blocked' WHERE id='3a100000-0000-4000-8000-000000000001';
UPDATE public.events SET status='cancelled' WHERE id='3a100000-0000-4000-8000-000000000003';
UPDATE public.events SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id='3a100000-0000-4000-8000-000000000004';
SELECT ok(pg_temp.assert_agreement('upcoming',NULL,NULL),'restricted and expired results remain equivalent');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.get_public_filtered_map_events(-122.4,37.7,-122.1,37.9,'upcoming',NULL,NULL) WHERE event_id IN ('3a100000-0000-4000-8000-000000000001','3a100000-0000-4000-8000-000000000003','3a100000-0000-4000-8000-000000000004')),'blocked cancelled expired remain excluded');
SELECT throws_ok($q$SELECT public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"next7","bounds":{"west":-180,"south":37,"east":-121,"north":38}}')$q$,'22023','DISCOVERY_QUERY_INVALID','outside-service bounds rejected');
SELECT throws_ok($q$SELECT * FROM public.get_public_filtered_map_events(-122.4,37.7,-122.1,37.9,'arbitrary',NULL,NULL)$q$,'22023','DISCOVERY_QUERY_INVALID','unknown map preset rejected');
SELECT count(*) FROM public.get_public_filtered_map_events(-122.4,37.7,-122.1,37.9,'today',NULL,NULL);
SELECT ok(current_setting('response.headers',true)::jsonb @> '[{"Access-Control-Expose-Headers":"Content-Range, X-Wheretoo-Discovery"}]'::jsonb,'empty responses expose authoritative date metadata');

SELECT is(extract(epoch FROM ((private.discovery_window('next7','2026-03-08 09:30Z')->>'end')::timestamptz-(private.discovery_window('next7','2026-03-08 09:30Z')->>'start')::timestamptz))::bigint,604800::bigint,'spring next7 remains exactly 168 hours');
SELECT is((private.discovery_window('weekend','2026-11-01 23:59-08')->>'end')::timestamptz,'2026-11-02 08:00Z'::timestamptz,'weekend includes DST Sunday and ends at Monday local midnight');
SELECT is((private.discovery_window('weekend','2026-11-02 00:00-08')->>'start')::timestamptz,'2026-11-06 08:00Z'::timestamptz,'Monday midnight resolves the following weekend');
SELECT is((private.discovery_window('today','2026-10-17 06:59:59Z')->>'start')::timestamptz,'2026-10-16 07:00Z'::timestamptz,'Today uses Bay Area local day before midnight');
SELECT is((private.discovery_window('today','2026-10-17 07:00:00Z')->>'start')::timestamptz,'2026-10-17 07:00Z'::timestamptz,'Today changes exactly at local midnight');
DO $$ DECLARE q jsonb:='{"region":"sf_bay_area","when":"upcoming","limit":1,"bounds":{"west":-122.4,"south":37.7,"east":-122.1,"north":37.9}}'; p jsonb; BEGIN
 p:=public.server_get_public_discovery_events(q);
 PERFORM set_config('task4.cursor',p->>'nextCursor',true);
END $$;
SELECT throws_ok(format('SELECT public.server_get_public_discovery_events(%L::jsonb)',jsonb_build_object('region','sf_bay_area','when','upcoming','limit',1,'bounds',jsonb_build_object('west',-122.3,'south',37.7,'east',-122.1,'north',37.9),'cursor',current_setting('task4.cursor'))),'22023','DISCOVERY_CURSOR_INVALID','cursor cannot replay in a different viewport');
SELECT throws_ok(format('SELECT public.server_get_public_discovery_events(%L::jsonb)',jsonb_build_object('region','sf_bay_area','when','next7','limit',1,'bounds',jsonb_build_object('west',-122.4,'south',37.7,'east',-122.1,'north',37.9),'cursor',current_setting('task4.cursor'))),'22023','DISCOVERY_CURSOR_INVALID','cursor cannot replay with another date preset');
SELECT throws_ok(format('SELECT public.server_get_public_discovery_events(%L::jsonb)',jsonb_build_object('region','sf_bay_area','when','upcoming','admissionType','paid','limit',1,'bounds',jsonb_build_object('west',-122.4,'south',37.7,'east',-122.1,'north',37.9),'cursor',current_setting('task4.cursor'))),'22023','DISCOVERY_CURSOR_INVALID','cursor cannot replay with another admission filter');
-- Rectangle edge membership agrees, including the southern Bay edge that was
-- excluded by the former geography polygon's geodesic curvature.
UPDATE public.events SET latitude=36.801,longitude=-122.3,location=extensions.st_setsrid(extensions.st_makepoint(-122.3,36.801),4326)::extensions.geography WHERE id='3a100000-0000-4000-8000-000000000005';
SELECT ok(EXISTS(SELECT 1 FROM public.get_public_filtered_map_events(-123.6,36.8,-121,38.9,'upcoming',NULL,NULL) WHERE event_id='3a100000-0000-4000-8000-000000000005'),'southern service edge uses rectangular membership');
UPDATE public.events SET latitude=37.7,longitude=-122.4,location=extensions.st_setsrid(extensions.st_makepoint(-122.4,37.7),4326)::extensions.geography WHERE id='3a100000-0000-4000-8000-000000000005';
SELECT ok(pg_temp.assert_agreement('upcoming',NULL,NULL),'exact viewport corner agrees between map and paginated list');
UPDATE public.events SET longitude=-122.400001,location=extensions.st_setsrid(extensions.st_makepoint(-122.400001,37.7),4326)::extensions.geography WHERE id='3a100000-0000-4000-8000-000000000005';
SELECT ok(pg_temp.assert_agreement('upcoming',NULL,NULL),'just outside viewport is excluded consistently');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.get_public_filtered_map_events(-122.4,37.7,-122.1,37.9,'upcoming',NULL,NULL) WHERE event_id='3a100000-0000-4000-8000-000000000005'),'one microdegree outside is excluded');
SELECT ok(NOT has_function_privilege('authenticated','private.discovery_bounds(jsonb)','execute'),'private scope resolver is not publicly executable');
SELECT * FROM finish();
ROLLBACK;
