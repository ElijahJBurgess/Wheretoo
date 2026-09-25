begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_table_privilege('authenticated','private.event_import_'||t,'SELECT,INSERT,UPDATE,DELETE'),'No browser access to '||t) from unnest(array['settings','batches','rows']) t;
select ok(not has_table_privilege('anon','private.event_import_'||t,'SELECT,INSERT,UPDATE,DELETE'),'No anonymous access to '||t) from unnest(array['settings','batches','rows']) t;
select ok(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute'),'Service-only RPC: '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'server_%event_import%' or p.proname='server_import_event_row');
set local role authenticated;
select throws_ok($$select public.server_import_event_row(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())$$,'42501','permission denied for function server_import_event_row','Browser cannot forge a service actor');
reset role;
select * from finish();
rollback;
