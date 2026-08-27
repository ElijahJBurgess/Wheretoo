-- Review and reporting are intentionally signal-only: neither boundary can
-- change event visibility or moderation state without a separate evaluation
-- or staff action.

alter table private.event_reports
  alter column reporter_fingerprint drop not null,
  drop constraint event_reports_reporter_fingerprint_check,
  add constraint event_reports_reporter_fingerprint_check check (
    reporter_fingerprint is null or reporter_fingerprint ~ '^[a-f0-9]{64}$'
  );

alter table private.event_moderation_actions
  drop constraint event_moderation_actions_review_request_id_fkey,
  add constraint event_moderation_actions_review_request_id_fkey
    foreign key (review_request_id)
    references private.moderation_review_requests(id)
    on delete restrict
    deferrable initially deferred;

create or replace function public.request_event_review(
  p_event_id uuid,
  p_organizer_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_digest text;
  v_existing private.moderation_review_requests%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_action_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  if p_event_id is null
    or p_organizer_note is not null
      and (pg_catalog.char_length(p_organizer_note) > 1000 or p_organizer_note <> pg_catalog.btrim(p_organizer_note)) then
    raise exception using errcode = '22023', message = 'REVIEW_REQUEST_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);
  select events.* into v_event
  from public.events as events
  where events.id = p_event_id and events.organizer_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  if v_event.moderation_status not in ('under_review', 'blocked', 'removed') then
    raise exception using errcode = 'P0001', message = 'REVIEW_REQUEST_UNAVAILABLE';
  end if;

  v_digest := private.compute_event_input_sha256(v_event.id);
  select requests.* into v_existing
  from private.moderation_review_requests as requests
  where requests.event_id = v_event.id and requests.status = 'open'
  for update;
  if found then
    if v_existing.content_revision = v_event.content_revision
      and v_existing.input_sha256 = v_digest then
      return v_existing.id;
    end if;
    update private.moderation_review_requests
    set status = 'superseded', resolved_at = v_now
    where id = v_existing.id;
  end if;

  insert into private.event_moderation_actions (
    event_id, content_revision, input_sha256, actor_type, actor_user_id,
    source, action, previous_status, new_status,
    previous_public_history_status, new_public_history_status,
    reason_code, internal_note, review_request_id, moderation_version, created_at
  ) values (
    v_event.id, v_event.content_revision, v_digest, 'organizer', auth.uid(),
    'review_request', 'request_review', v_event.moderation_status, v_event.moderation_status,
    v_event.public_history_status, v_event.public_history_status,
    'other', p_organizer_note, v_request_id, v_event.moderation_version, v_now
  ) returning id into v_action_id;

  insert into private.moderation_review_requests (
    id, event_id, organizer_id, content_revision, input_sha256,
    requested_action_id, organizer_note, created_at
  ) values (
    v_request_id, v_event.id, v_event.organizer_id, v_event.content_revision,
    v_digest, v_action_id, p_organizer_note, v_now
  );
  return v_request_id;
end;
$$;

create or replace function public.withdraw_event_review(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_request private.moderation_review_requests%rowtype;
  v_action_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if auth.uid() is null or p_event_id is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  perform public.lock_event_ticketing_operation(p_event_id);
  select events.* into v_event from public.events as events
  where events.id = p_event_id and events.organizer_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  select requests.* into v_request from private.moderation_review_requests as requests
  where requests.event_id = v_event.id and requests.status = 'open'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'REVIEW_REQUEST_NOT_FOUND';
  end if;

  insert into private.event_moderation_actions (
    event_id, content_revision, input_sha256, actor_type, actor_user_id,
    source, action, previous_status, new_status,
    previous_public_history_status, new_public_history_status,
    reason_code, review_request_id, moderation_version, created_at
  ) values (
    v_event.id, v_request.content_revision, v_request.input_sha256,
    'organizer', auth.uid(), 'review_request', 'resolve_review',
    v_event.moderation_status, v_event.moderation_status,
    v_event.public_history_status, v_event.public_history_status,
    'other', v_request.id, v_event.moderation_version, v_now
  ) returning id into v_action_id;
  update private.moderation_review_requests
  set status = 'withdrawn', resolved_at = v_now, resolved_action_id = v_action_id
  where id = v_request.id;
  return v_request.id;
end;
$$;

create or replace function private.resolve_current_review_request_from_staff_action()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_request private.moderation_review_requests%rowtype;
  v_resolution_action_id uuid;
begin
  if new.source <> 'manual'
    or new.action not in ('hold', 'block', 'remove', 'clear', 'restore') then
    return new;
  end if;
  select requests.* into v_request
  from private.moderation_review_requests as requests
  where requests.event_id = new.event_id
    and requests.status = 'open'
    and requests.content_revision = new.content_revision
    and requests.input_sha256 = new.input_sha256
  for update;
  if not found then
    return new;
  end if;
  insert into private.event_moderation_actions (
    event_id, content_revision, input_sha256, actor_type, actor_user_id,
    source, action, previous_status, new_status,
    previous_public_history_status, new_public_history_status,
    reason_code, review_request_id, moderation_version, created_at
  ) values (
    new.event_id, new.content_revision, new.input_sha256,
    new.actor_type, new.actor_user_id, 'review_request', 'resolve_review',
    new.new_status, new.new_status,
    new.new_public_history_status, new.new_public_history_status,
    new.reason_code, v_request.id, new.moderation_version, new.created_at
  ) returning id into v_resolution_action_id;
  update private.moderation_review_requests
  set status = 'resolved', resolved_at = new.created_at,
      resolved_action_id = v_resolution_action_id
  where id = v_request.id;
  return new;
end;
$$;

create trigger resolve_current_review_request_after_staff_action
after insert on private.event_moderation_actions
for each row execute function private.resolve_current_review_request_from_staff_action();

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
  v_report_id uuid;
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

  select reports.id into v_report_id
  from private.event_reports as reports
  where reports.event_id = v_event.id
    and reports.content_revision = v_event.content_revision
    and reports.reporter_fingerprint = p_reporter_fingerprint
    and reports.status = 'open';
  if found then
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

create or replace function public.server_expire_event_report_fingerprints()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  update private.event_reports
  set reporter_fingerprint = null
  where reporter_fingerprint is not null
    and created_at < pg_catalog.clock_timestamp() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.request_event_review(uuid, text) from public, anon;
revoke all on function public.withdraw_event_review(uuid) from public, anon;
revoke all on function public.server_submit_event_report(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.server_expire_event_report_fingerprints() from public, anon, authenticated;
grant execute on function public.request_event_review(uuid, text) to authenticated;
grant execute on function public.withdraw_event_review(uuid) to authenticated;
grant execute on function public.server_submit_event_report(uuid, text, text, text) to service_role;
grant execute on function public.server_expire_event_report_fingerprints() to service_role;

comment on function public.server_expire_event_report_fingerprints() is
  'Run at least daily. It removes HMAC report fingerprints after the 30-day anti-abuse retention window; rotate REPORT_FINGERPRINT_SECRET through managed deployment after the same window.';

revoke all on function private.resolve_current_review_request_from_staff_action() from public, anon, authenticated;
