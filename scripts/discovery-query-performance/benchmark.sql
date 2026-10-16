-- LOCAL DISPOSABLE DATABASE ONLY. Canonical rollback-only fixtures; no remote use.
\set ON_ERROR_STOP on
begin;
DO $$ BEGIN IF current_database() NOT LIKE 'wheretoo_task25_%' THEN RAISE EXCEPTION 'Use a disposable wheretoo_task25_ database, never staging or production'; END IF; END $$;
set local statement_timeout='300s';
insert into auth.users(id,email) values ('39000000-0000-4000-8000-000000000001','smart-loading-audit@example.invalid');
insert into public.organizers(id,display_name) values ('39000000-0000-4000-8000-000000000001','Isolated Loading Audit');
select set_config('request.jwt.claim.sub','39000000-0000-4000-8000-000000000001',true);

\ir ../../supabase/tests/database/discovery_query_baseline.inc
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
select ('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,'39000000-0000-4000-8000-000000000001','Audit Gathering '||i,'A friendly public community gathering for isolated local measurement.','community',now()+interval '1 day',now()+interval '1 day 2 hours','America/Los_Angeles','Audit Venue','1 Broadway','Oakland','CA','94612','US','audit-loading-'||i,37.80+(i%25)*0.0001,-122.27+(i%20)*0.0001,'free',100 from generate_series(1,9)i;
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
select ('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,'all_ages',false,false,false,false,false,false from generate_series(1,9)i;
set local role authenticated;
do $$ begin for i in 1..9 loop
 perform public.accept_current_event_policies(('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid);
 perform public.publish_event(('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid);
end loop; end $$;
reset role;
analyze public.events;
analyze private.event_policy_acceptances;
analyze private.event_moderation_actions;
analyze private.event_public_eligibility_intervals;
analyze private.event_risk_disclosures;
analyze private.event_policy_legacy_exemptions;
\echo BENCH 9 map 1 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 9 map 1 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 9 list 1 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 9 list 1 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 9 map 2 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 9 map 2 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 9 list 2 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 9 list 2 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 9 map 3 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 9 map 3 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 9 list 3 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 9 list 3 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo EXACT 9
DO $$ BEGIN IF (select jsonb_agg(to_jsonb(m)) from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m) IS DISTINCT FROM (select jsonb_agg(to_jsonb(m)) from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m) THEN RAISE EXCEPTION 'MAP_EQUIVALENCE_FAILED'; END IF; IF pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}') IS DISTINCT FROM public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}') THEN RAISE EXCEPTION 'LIST_EQUIVALENCE_FAILED'; END IF; END $$;
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
select ('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,'39000000-0000-4000-8000-000000000001','Audit Gathering '||i,'A friendly public community gathering for isolated local measurement.','community',now()+interval '1 day',now()+interval '1 day 2 hours','America/Los_Angeles','Audit Venue','1 Broadway','Oakland','CA','94612','US','audit-loading-'||i,37.80+(i%25)*0.0001,-122.27+(i%20)*0.0001,'free',100 from generate_series(10,500)i;
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
select ('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,'all_ages',false,false,false,false,false,false from generate_series(10,500)i;
set local role authenticated;
do $$ begin for i in 10..500 loop
 perform public.accept_current_event_policies(('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid);
 perform public.publish_event(('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid);
end loop; end $$;
reset role;
analyze public.events;
analyze private.event_policy_acceptances;
analyze private.event_moderation_actions;
analyze private.event_public_eligibility_intervals;
analyze private.event_risk_disclosures;
analyze private.event_policy_legacy_exemptions;
\echo BENCH 500 map 1 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 500 map 1 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 500 list 1 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 500 list 1 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 500 map 2 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 500 map 2 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 500 list 2 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 500 list 2 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 500 map 3 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 500 map 3 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 500 list 3 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 500 list 3 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo EXACT 500
DO $$ BEGIN IF (select jsonb_agg(to_jsonb(m)) from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m) IS DISTINCT FROM (select jsonb_agg(to_jsonb(m)) from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m) THEN RAISE EXCEPTION 'MAP_EQUIVALENCE_FAILED'; END IF; IF pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}') IS DISTINCT FROM public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}') THEN RAISE EXCEPTION 'LIST_EQUIVALENCE_FAILED'; END IF; END $$;
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
select ('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,'39000000-0000-4000-8000-000000000001','Audit Gathering '||i,'A friendly public community gathering for isolated local measurement.','community',now()+interval '1 day',now()+interval '1 day 2 hours','America/Los_Angeles','Audit Venue','1 Broadway','Oakland','CA','94612','US','audit-loading-'||i,37.80+(i%25)*0.0001,-122.27+(i%20)*0.0001,'free',100 from generate_series(501,2000)i;
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
select ('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,'all_ages',false,false,false,false,false,false from generate_series(501,2000)i;
set local role authenticated;
do $$ begin for i in 501..2000 loop
 perform public.accept_current_event_policies(('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid);
 perform public.publish_event(('39000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid);
end loop; end $$;
reset role;
analyze public.events;
analyze private.event_policy_acceptances;
analyze private.event_moderation_actions;
analyze private.event_public_eligibility_intervals;
analyze private.event_risk_disclosures;
analyze private.event_policy_legacy_exemptions;
\echo BENCH 2000 map 1 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 2000 map 1 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 2000 list 1 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 2000 list 1 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 2000 map 2 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 2000 map 2 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 2000 list 2 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 2000 list 2 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 2000 map 3 old
set local role anon;
explain(analyze,buffers,format json) select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 2000 map 3 optimized
set local role anon;
explain(analyze,buffers,format json) select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) limit 1000;
reset role;
\echo BENCH 2000 list 3 old
set local role service_role;
explain(analyze,buffers,format json) select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo BENCH 2000 list 3 optimized
set local role service_role;
explain(analyze,buffers,format json) select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb);
reset role;
\echo EXACT 2000
DO $$ BEGIN IF (select jsonb_agg(to_jsonb(m)) from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m) IS DISTINCT FROM (select jsonb_agg(to_jsonb(m)) from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m) THEN RAISE EXCEPTION 'MAP_EQUIVALENCE_FAILED'; END IF; IF pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}') IS DISTINCT FROM public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}') THEN RAISE EXCEPTION 'LIST_EQUIVALENCE_FAILED'; END IF; END $$;
rollback;
