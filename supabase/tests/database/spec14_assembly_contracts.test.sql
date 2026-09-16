-- Task-only metadata proof for current inherited contracts. No domain changes.
begin;
set local search_path=public,extensions;
select plan(5);
select is((select proargnames[1:pronargs]::text from pg_proc where oid='public.accept_current_event_policies(uuid)'::regprocedure),'{p_event_id}','original acceptance accepts only the event identity');
select is((select proargnames[1:pronargs]::text from pg_proc where oid='public.accept_current_event_policies_if_current(uuid,text)'::regprocedure),'{p_event_id,p_expected_context}','new guarded acceptance adds only the expected context');
select is((select count(*)::integer from cron.job where jobname='whereto-expire-checkout-reservations' and username='postgres' and database=current_database() and schedule='* * * * *' and command='select public.server_expire_checkout_reservations(clock_timestamp());' and active=false),1,'exact expiry job belongs to the recorded migration role and is inactive');
select ok(not exists(select 1 from cron.job where active) and current_setting('cron.launch_active_jobs')='off','all automatic task jobs stay disabled');
select ok(not has_schema_privilege('anon','cron','usage') and not has_schema_privilege('authenticated','cron','usage') and not has_schema_privilege('service_role','cron','usage') and not has_function_privilege('service_role','public.accept_current_event_policies_without_change_history(uuid)','execute'),'browser/service roles cannot access cron or the older inner acceptance authority');
select * from finish();
rollback;
