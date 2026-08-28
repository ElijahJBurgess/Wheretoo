-- Forward-only hardening for Task 9 report retention. Rate buckets contain
-- only HMAC digests, but must not outlive their anti-abuse window.
create or replace function public.server_expire_event_report_fingerprints()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_count bigint;
  v_bucket_count bigint;
begin
  update private.event_reports
  set reporter_fingerprint = null
  where reporter_fingerprint is not null
    and created_at < pg_catalog.clock_timestamp() - interval '30 days';
  get diagnostics v_report_count = row_count;

  delete from private.event_report_rate_buckets
  where expires_at <= pg_catalog.clock_timestamp();
  get diagnostics v_bucket_count = row_count;
  return v_report_count + v_bucket_count;
end;
$$;

revoke all on function public.server_expire_event_report_fingerprints()
from public, anon, authenticated;
grant execute on function public.server_expire_event_report_fingerprints()
to service_role;

comment on function public.server_expire_event_report_fingerprints() is
  'Run at least daily. It removes report fingerprints after 30 days and deletes expired actor/network HMAC rate buckets; rotate REPORT_FINGERPRINT_SECRET through managed deployment after the same window.';
