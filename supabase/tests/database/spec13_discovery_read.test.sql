begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir spec13_fixture.inc
select is(jsonb_array_length(pg_temp.discovery()->'items'),20,'default bounded page returns 20 eligible real rows');
select is(jsonb_array_length(pg_temp.discovery('{"limit":1}')->'items'),1,'minimum page bound works');
select is(jsonb_array_length(pg_temp.discovery('{"limit":50}')->'items'),50,'maximum page bound works');
select is(jsonb_array_length(pg_temp.discovery('{"category":"music","admissionType":"paid","limit":50}')->'items'),8,'category and admission compose with AND');
select is(jsonb_array_length(pg_temp.discovery('{"category":"music","admissionType":"free"}')->'items'),0,'conflicting filters return truthful empty');
select is((select count(distinct item->>'category') from jsonb_array_elements(pg_temp.discovery('{"limit":50}')->'items') item),8::bigint,'all eight canonical categories remain visible without filter');
select ok((select bool_and(item->'artworkReference'='null'::jsonb and item->'admission'='{"state":"unknown","minimumBuyerAmountMinor":null,"currency":null}'::jsonb) from jsonb_array_elements(pg_temp.discovery()->'items') item),'unknown summaries stay unknown for free and paid without media');
select ok((select bool_and((select array_agg(k order by k) from jsonb_object_keys(item) k)=array['admission','admissionType','artworkReference','category','city','endsAt','id','startsAt','timezone','title','venueName']) from jsonb_array_elements(pg_temp.discovery()->'items') item),'every row exposes exactly public display fields');
select throws_ok($$select pg_temp.discovery('{"limit":0}')$$,'22023','DISCOVERY_QUERY_INVALID','zero rejected');
select throws_ok($$select pg_temp.discovery('{"limit":51}')$$,'22023','DISCOVERY_QUERY_INVALID','large limit rejected');
select throws_ok($$select pg_temp.discovery('{"limit":1.5}')$$,'22023','DISCOVERY_QUERY_INVALID','fractional limit rejected');
select throws_ok($$select pg_temp.discovery('{"category":null}')$$,'22023','DISCOVERY_QUERY_INVALID','explicit null category rejected');
select throws_ok($$select pg_temp.discovery('{"customWindow":"2026-10-01"}')$$,'22023','DISCOVERY_QUERY_INVALID','custom windows rejected');
-- Publicly saved content changes must withdraw the current authorization.
select set_config('request.jwt.claim.sub','d1300000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.save_owned_event_revision_if_current('d1310000-0000-4000-8000-000000000001',
 ((public.get_owned_event_change_context('d1310000-0000-4000-8000-000000000001')->'current_saved'->'facts')-'disclosures')||'{"title":"An unapproved saved revision"}',
 public.get_owned_event_change_context('d1310000-0000-4000-8000-000000000001')->>'context_token');
reset role;
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.discovery('{"limit":50}')->'items') x where x->>'id'='d1310000-0000-4000-8000-000000000001'),'unapproved revised content is excluded');
select set_config('request.jwt.claim.sub','d1300000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.cancel_owned_event('d1310000-0000-4000-8000-000000000003');
reset role;
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.discovery('{"limit":50}')->'items') x where x->>'id'='d1310000-0000-4000-8000-000000000003'),'canonical cancellation excludes event');
-- Approved fixture-only corruption independently probes final eligibility defenses.
set constraints all immediate;
alter table public.events disable trigger user;
update public.events set status='draft' where id='d1310000-0000-4000-8000-000000000005';
update public.events set moderation_status='blocked' where id='d1310000-0000-4000-8000-000000000007';
update public.events set ends_at=statement_timestamp()-interval '1 hour', starts_at=statement_timestamp()-interval '2 hours' where id='d1310000-0000-4000-8000-000000000009';
update public.events set longitude=-120, location=extensions.st_setsrid(extensions.st_makepoint(-120,37.7),4326)::extensions.geography where id='d1310000-0000-4000-8000-000000000011';
alter table public.events enable trigger user;
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.discovery('{"limit":50}')->'items') x where x->>'id' in ('d1310000-0000-4000-8000-000000000005','d1310000-0000-4000-8000-000000000007','d1310000-0000-4000-8000-000000000009','d1310000-0000-4000-8000-000000000011')),'draft rejected ended and out-of-region rows excluded independently');
set constraints all immediate;
alter table public.events disable trigger user;
update public.events set moderation_status='removed' where id='d1310000-0000-4000-8000-000000000013';
update public.events set starts_at=statement_timestamp()-interval '2 hours',ends_at=statement_timestamp()+interval '1 hour' where id='d1310000-0000-4000-8000-000000000015';
update public.events set starts_at=((private.discovery_window('today',statement_timestamp())->>'end')::timestamptz),ends_at=((private.discovery_window('today',statement_timestamp())->>'end')::timestamptz)+interval '1 hour' where id='d1310000-0000-4000-8000-000000000017';
update public.events set longitude=-123.6,latitude=36.8,location=extensions.st_setsrid(extensions.st_makepoint(-123.6,36.8),4326)::extensions.geography where id='d1310000-0000-4000-8000-000000000019';
update public.events set longitude=-121,latitude=38.9,location=extensions.st_setsrid(extensions.st_makepoint(-121,38.9),4326)::extensions.geography where id='d1310000-0000-4000-8000-000000000021';
update public.events set longitude=-122.3,latitude=36.801,location=extensions.st_setsrid(extensions.st_makepoint(-122.3,36.801),4326)::extensions.geography where id='d1310000-0000-4000-8000-000000000023';
update public.events set longitude=-122.3,latitude=38.899,location=extensions.st_setsrid(extensions.st_makepoint(-122.3,38.899),4326)::extensions.geography where id='d1310000-0000-4000-8000-000000000025';
alter table public.events enable trigger user;
select is((select count(*) from jsonb_array_elements(pg_temp.discovery('{"limit":50}')->'items') x where x->>'id' in ('d1310000-0000-4000-8000-000000000023','d1310000-0000-4000-8000-000000000025')),2::bigint,'inside lower and upper rectangle mid-edges remain eligible');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.discovery('{"limit":50}')->'items') x where x->>'id'='d1310000-0000-4000-8000-000000000013'),'removed moderation state is excluded');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.discovery('{"when":"today","limit":50}')->'items') x where x->>'id'='d1310000-0000-4000-8000-000000000015'),'ongoing overnight/overlapping event remains discoverable');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.discovery('{"when":"today","limit":50}')->'items') x where x->>'id'='d1310000-0000-4000-8000-000000000017'),'event starting at exclusive end is not today');
select is((select count(*) from jsonb_array_elements(pg_temp.discovery('{"limit":50}')->'items') x where x->>'id' in ('d1310000-0000-4000-8000-000000000019','d1310000-0000-4000-8000-000000000021')),2::bigint,'service-region corner boundary points included');
select * from finish();
rollback;
