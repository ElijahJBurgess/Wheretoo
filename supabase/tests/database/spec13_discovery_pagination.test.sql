begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir spec13_fixture.inc
create temp table pages(n integer,payload jsonb);
insert into pages values(1,pg_temp.discovery());
insert into pages values(2,pg_temp.discovery(jsonb_build_object('cursor',(select payload->>'nextCursor' from pages where n=1))));
insert into pages values(3,pg_temp.discovery(jsonb_build_object('cursor',(select payload->>'nextCursor' from pages where n=2))));
insert into pages values(4,pg_temp.discovery(jsonb_build_object('cursor',(select payload->>'nextCursor' from pages where n=3))));
select is((select count(*) from pages,jsonb_array_elements(payload->'items')),64::bigint,'all rows returned across bounded pages');
select is((select count(distinct item->>'id') from pages,jsonb_array_elements(payload->'items') item),64::bigint,'equal-start UUID seek has no duplicates or omissions');
select is((select payload->'items'->0->>'id' from pages where n=2),'d1310000-0000-4000-8000-000000000021','second page starts after stable UUID tie break');
select is((select payload->'nextCursor' from pages where n=4),'null'::jsonb,'last page stops explicitly');
select ok((select bool_and(payload->'window'=(select payload->'window' from pages where n=1)) from pages),'all pages retain first resolved calendar window');
select throws_ok($$select pg_temp.discovery('{"cursor":null}')$$,'22023','DISCOVERY_CURSOR_INVALID','null cursor rejected');
select throws_ok($$select pg_temp.discovery('{"cursor":"bad"}')$$,'22023','DISCOVERY_CURSOR_INVALID','malformed cursor rejected');
select throws_ok($$select pg_temp.discovery(jsonb_build_object('cursor',repeat('a',1025)))$$,'22023','DISCOVERY_CURSOR_INVALID','oversized cursor rejected');
select throws_ok($$select pg_temp.discovery(jsonb_build_object('category','music','cursor',(select payload->>'nextCursor' from pages where n=1)))$$,'22023','DISCOVERY_CURSOR_INVALID','filter mismatch rejected');
create function pg_temp.cursor_change(delta jsonb) returns text language sql as $$
 select private.discovery_encode_cursor(convert_from(decode(translate(payload->>'nextCursor','-_','+/')||repeat('=',(4-length(payload->>'nextCursor')%4)%4),'base64'),'UTF8')::jsonb||delta) from pages where n=1;
$$;
select throws_ok($$select pg_temp.discovery(jsonb_build_object('cursor',pg_temp.cursor_change('{"lastId":"D1310000-0000-4000-8000-000000000020"}')))$$,'22023','DISCOVERY_CURSOR_INVALID','noncanonical UUID rejected');
select throws_ok($$select pg_temp.discovery(jsonb_build_object('cursor',pg_temp.cursor_change('{"end":"2099-01-01T00:00:00+00:00"}')))$$,'22023','DISCOVERY_CURSOR_INVALID','arbitrary window end rejected');
select throws_ok($$select pg_temp.discovery(jsonb_build_object('cursor',pg_temp.cursor_change(jsonb_build_object('issuedAt',statement_timestamp()+interval '1 minute'))))$$,'22023','DISCOVERY_CURSOR_INVALID','future cursor rejected');
select throws_ok($$select pg_temp.discovery(jsonb_build_object('cursor',pg_temp.cursor_change(jsonb_build_object('issuedAt',statement_timestamp()-interval '16 minutes')||(private.discovery_window('upcoming',statement_timestamp()-interval '16 minutes')-'timezone'))))$$,'22023','DISCOVERY_CURSOR_EXPIRED','age checked after reconstructing bounded window');
select throws_ok($$select pg_temp.discovery(jsonb_build_object('cursor',pg_temp.cursor_change('{"v":2}')))$$,'22023','DISCOVERY_CURSOR_INVALID','unsupported version rejected');
-- A later page rechecks public eligibility instead of trusting a cursor snapshot.
select set_config('request.jwt.claim.sub','d1300000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.cancel_owned_event('d1310000-0000-4000-8000-000000000021');
reset role;
select isnt(pg_temp.discovery(jsonb_build_object('cursor',(select payload->>'nextCursor' from pages where n=1)))->'items'->0->>'id','d1310000-0000-4000-8000-000000000021','removed result cannot reappear from a valid old cursor');
select * from finish();
rollback;
