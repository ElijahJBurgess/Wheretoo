create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'whereto-expire-event-report-fingerprints-daily',
  '17 3 * * *',
  'select public.server_expire_event_report_fingerprints();'
);

revoke all on schema cron from public, anon, authenticated, service_role;
revoke all on all tables in schema cron from public, anon, authenticated, service_role;
revoke all on all sequences in schema cron from public, anon, authenticated, service_role;
revoke all on all functions in schema cron from public, anon, authenticated, service_role;

comment on function public.server_expire_event_report_fingerprints() is
  'Runs daily at 03:17 UTC through database-owned pg_cron. Removes report fingerprints after 30 days and expired actor/network HMAC rate buckets; see docs/runbooks/moderation-report-retention.md for monitored recovery and REPORT_FINGERPRINT_SECRET rotation.';
