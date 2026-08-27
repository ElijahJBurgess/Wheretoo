-- Forward-only correction for applied 010800: preserve the exact report
-- behavior while removing its unused local-variable lint warning.
create or replace function public.server_submit_event_report(
  p_event_id uuid,
  p_reporter_fingerprint text,
  p_network_fingerprint text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_digest text;
  v_distinct_actors integer;
  v_actor_limit constant integer := 10;
  v_network_limit constant integer := 30;
begin
  if p_event_id is null
    or p_reporter_fingerprint is null or p_reporter_fingerprint !~ '^[a-f0-9]{64}$'
    or p_network_fingerprint is null or p_network_fingerprint !~ '^[a-f0-9]{64}$'
    or p_reason not in (
      'scam_misleading', 'unsafe', 'prohibited_content', 'wrong_location',
      'event_missing', 'adult_misrepresented', 'hate_extremism', 'other'
    ) then
    raise exception using errcode = '22023', message = 'REPORT_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);
  select events.* into v_event from public.events as events
  where events.id = p_event_id for update;
  if not found or not private.event_is_publicly_eligible(p_event_id, v_now) then
    return 'not_found';
  end if;
  v_digest := private.compute_event_input_sha256(v_event.id);

  update private.event_reports as reports
  set status = 'superseded', resolved_at = v_now
  where reports.event_id = v_event.id
    and reports.status = 'open'
    and reports.content_revision <> v_event.content_revision;

  if exists (
    select 1 from private.event_reports as reports
    where reports.event_id = v_event.id
      and reports.content_revision = v_event.content_revision
      and reports.reporter_fingerprint = p_reporter_fingerprint
      and reports.status = 'open'
  ) then
    return 'duplicate';
  end if;

  insert into private.event_report_rate_buckets (
    bucket_type, bucket_digest, window_started_at, request_count, expires_at
  ) values ('actor', p_reporter_fingerprint, v_now, 1, v_now + interval '24 hours')
  on conflict (bucket_type, bucket_digest) do update
  set window_started_at = case when event_report_rate_buckets.expires_at <= v_now then v_now else event_report_rate_buckets.window_started_at end,
      request_count = case when event_report_rate_buckets.expires_at <= v_now then 1 else event_report_rate_buckets.request_count + 1 end,
      expires_at = case when event_report_rate_buckets.expires_at <= v_now then v_now + interval '24 hours' else event_report_rate_buckets.expires_at end
  where event_report_rate_buckets.expires_at <= v_now
     or event_report_rate_buckets.request_count < v_actor_limit;
  if not found then return 'rate_limited'; end if;

  insert into private.event_report_rate_buckets (
    bucket_type, bucket_digest, window_started_at, request_count, expires_at
  ) values ('network', p_network_fingerprint, v_now, 1, v_now + interval '24 hours')
  on conflict (bucket_type, bucket_digest) do update
  set window_started_at = case when event_report_rate_buckets.expires_at <= v_now then v_now else event_report_rate_buckets.window_started_at end,
      request_count = case when event_report_rate_buckets.expires_at <= v_now then 1 else event_report_rate_buckets.request_count + 1 end,
      expires_at = case when event_report_rate_buckets.expires_at <= v_now then v_now + interval '24 hours' else event_report_rate_buckets.expires_at end
  where event_report_rate_buckets.expires_at <= v_now
     or event_report_rate_buckets.request_count < v_network_limit;
  if not found then return 'rate_limited'; end if;

  insert into private.event_reports (
    event_id, content_revision, input_sha256, reporter_fingerprint, reason, created_at
  ) values (
    v_event.id, v_event.content_revision, v_digest, p_reporter_fingerprint, p_reason, v_now
  );

  select count(distinct reports.reporter_fingerprint)::integer into v_distinct_actors
  from private.event_reports as reports
  where reports.event_id = v_event.id
    and reports.content_revision = v_event.content_revision
    and reports.input_sha256 = v_digest
    and reports.status = 'open'
    and reports.created_at >= v_now - interval '24 hours';
  if v_distinct_actors >= 3 then
    insert into private.event_moderation_evaluations (
      event_id, content_revision, input_sha256, queued_moderation_version,
      status, source, reason_codes, created_at
    ) values (
      v_event.id, v_event.content_revision, v_digest, v_event.moderation_version,
      'queued', 'report', array['user_report']::text[], v_now
    ) on conflict (event_id, content_revision, input_sha256, source, queued_moderation_version)
      do nothing;
  end if;
  return 'submitted';
end;
$$;

revoke all on function public.server_submit_event_report(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.server_submit_event_report(uuid, text, text, text)
to service_role;
