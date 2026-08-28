begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_extension(
  'pg_cron',
  'the linked database owns the daily moderation-retention scheduler'
);

create function pg_temp.retention_job_contract()
returns setof jsonb
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.to_regclass('cron.job') is null then
    return;
  end if;

  return query execute $query$
    select pg_catalog.jsonb_build_object(
      'jobname', jobs.jobname,
      'schedule', jobs.schedule,
      'command', jobs.command,
      'database', jobs.database,
      'username', jobs.username,
      'active', jobs.active,
      'anon_schema_usage', pg_catalog.has_schema_privilege('anon', 'cron', 'USAGE'),
      'authenticated_schema_usage', pg_catalog.has_schema_privilege('authenticated', 'cron', 'USAGE'),
      'service_schema_usage', pg_catalog.has_schema_privilege('service_role', 'cron', 'USAGE'),
      'anon_job_select', pg_catalog.has_table_privilege('anon', 'cron.job', 'SELECT'),
      'authenticated_job_select', pg_catalog.has_table_privilege('authenticated', 'cron.job', 'SELECT'),
      'service_job_select', pg_catalog.has_table_privilege('service_role', 'cron.job', 'SELECT'),
      'anon_schedule_execute', pg_catalog.has_function_privilege('anon', 'cron.schedule(text,text,text)', 'EXECUTE'),
      'authenticated_schedule_execute', pg_catalog.has_function_privilege('authenticated', 'cron.schedule(text,text,text)', 'EXECUTE'),
      'service_schedule_execute', pg_catalog.has_function_privilege('service_role', 'cron.schedule(text,text,text)', 'EXECUTE')
    )
    from cron.job as jobs
    where jobs.jobname = 'whereto-expire-event-report-fingerprints-daily'
  $query$;
end;
$$;

select results_eq(
  $$ select * from pg_temp.retention_job_contract() $$,
  $$
    values (
      pg_catalog.jsonb_build_object(
        'jobname', 'whereto-expire-event-report-fingerprints-daily',
        'schedule', '17 3 * * *',
        'command', 'select public.server_expire_event_report_fingerprints();',
        'database', current_database(),
        'username', current_user,
        'active', true,
        'anon_schema_usage', false,
        'authenticated_schema_usage', false,
        'service_schema_usage', false,
        'anon_job_select', true,
        'authenticated_job_select', true,
        'service_job_select', true,
        'anon_schedule_execute', true,
        'authenticated_schedule_execute', true,
        'service_schedule_execute', true
      )
    )
  $$,
  'the exact database-owned job and extension ACL are gated from application roles by zero cron schema usage'
);

select function_privs_are(
  'public', 'server_expire_event_report_fingerprints', array[]::text[],
  'anon', array[]::text[],
  'anonymous callers cannot execute retention'
);
select function_privs_are(
  'public', 'server_expire_event_report_fingerprints', array[]::text[],
  'authenticated', array[]::text[],
  'authenticated callers cannot execute retention'
);
select function_privs_are(
  'public', 'server_expire_event_report_fingerprints', array[]::text[],
  'service_role', array['EXECUTE'],
  'the existing monitored service boundary retains manual recovery execution'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = 'server_expire_event_report_fingerprints'
      and procedures.prosecdef
      and procedures.proconfig = array['search_path=""']::text[]
  $$,
  $$ values (1::bigint) $$,
  'scheduled retention retains the security-definer empty-search-path boundary'
);

select * from finish();
rollback;
