#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
fixture_owner='19100000-0000-4000-8000-000000000001'
fixture_event='29100000-0000-4000-8000-000000000001'
fixture_actor_limit_event='29100000-0000-4000-8000-000000000002'
fixture_threshold_event='29100000-0000-4000-8000-000000000003'
fixture_network="$(printf '%064x' 991)"
fixture_threshold_network="$(printf '%064x' 990)"
fixture_actor="$(printf '%064x' 932)"
fixture_actor_network="$(printf '%064x' 933)"
fixture_network_actor_one="$(printf '%064x' 941)"
fixture_network_actor_two="$(printf '%064x' 942)"
actor_barrier=919001
network_barrier=919002
actor_secondary_gate=919003
network_secondary_gate=919004
actor_marker_one=919011
actor_marker_two=919012
network_marker_one=919021
network_marker_two=919022

if [[ ! -x "$supabase_cli" ]]; then
  echo 'project-local Supabase CLI is required' >&2
  exit 1
fi

cleanup_sql="begin;
set local session_replication_role = replica;
delete from private.event_report_rate_buckets
where bucket_digest = '$fixture_network' or bucket_digest in (
  '$fixture_threshold_network', '$fixture_actor', '$fixture_actor_network',
  '$fixture_network_actor_one', '$fixture_network_actor_two',
  $(for number in $(seq 1 31); do printf "'%064x'," "$number"; done | sed 's/,$//')
);
delete from private.event_reports where event_id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid, '$fixture_threshold_event'::uuid);
delete from private.event_moderation_evaluations where event_id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid, '$fixture_threshold_event'::uuid);
delete from private.event_public_eligibility_intervals where event_id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid, '$fixture_threshold_event'::uuid);
delete from private.event_moderation_actions where event_id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid, '$fixture_threshold_event'::uuid);
delete from private.event_policy_legacy_exemptions where event_id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid, '$fixture_threshold_event'::uuid);
delete from private.event_risk_disclosures where event_id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid, '$fixture_threshold_event'::uuid);
delete from public.events where id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid, '$fixture_threshold_event'::uuid);
delete from public.organizers where id = '$fixture_owner'::uuid;
delete from auth.users where id = '$fixture_owner'::uuid;
commit;"

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  local cleanup_status=$?
  if [[ $status -ne 0 ]]; then
    echo 'report concurrency harness failed' >&2
    rg -o 'ERROR: +[0-9A-Z]+|ASSERT_[A-Z0-9_]+' "$temporary_directory"/*.log | head -n 8 >&2 || true
  fi
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  [[ $status -eq 0 ]] || exit "$status"
  exit "$cleanup_status"
}
trap cleanup EXIT

"$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/pre-cleanup.log" 2>&1
"$supabase_cli" db query --linked "
  begin;
  insert into auth.users (id, email) values ('$fixture_owner', 'report-concurrency@example.invalid');
  insert into public.organizers (id, display_name, organizer_type, base_city, country_code, onboarding_completed_at)
  values ('$fixture_owner', 'Report Concurrency Fixture', 'Community group', 'San Francisco', 'US', clock_timestamp());
  insert into public.events (
    id, organizer_id, status, moderation_status, title, description, category,
    starts_at, ends_at, timezone, venue_name, address_line1, city, region,
    postal_code, country_code, mapbox_feature_id, latitude, longitude,
    admission_type, capacity, published_at, content_revision, moderated_revision,
    moderation_version, public_history_status, first_publicly_eligible_at
  ) values (
    '$fixture_event', '$fixture_owner', 'published', 'clear', 'Report Concurrency',
    'A complete fixture for anonymous report concurrency proof.', 'community',
    clock_timestamp() + interval '2 days', clock_timestamp() + interval '2 days 2 hours',
    'America/Los_Angeles', 'Fixture Hall', '1 Market Street', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.report-concurrency', 37.7936, -122.3958,
    'free', 10, clock_timestamp(), 1, 1, 7, 'previously_public', clock_timestamp() - interval '1 hour'
  );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present, explicit_adult_content,
    gambling_present, weapons_present, high_risk_activity
  ) values ('$fixture_event', 'all_ages', false, false, false, false, false, false);
  insert into public.events (
    id, organizer_id, status, moderation_status, title, description, category,
    starts_at, ends_at, timezone, venue_name, address_line1, city, region,
    postal_code, country_code, mapbox_feature_id, latitude, longitude,
    admission_type, capacity, published_at, content_revision, moderated_revision,
    moderation_version, public_history_status, first_publicly_eligible_at
  ) values (
    '$fixture_actor_limit_event', '$fixture_owner', 'published', 'clear', 'Report Actor Limit',
    'A separate event isolates actor rate-limit concurrency proof.', 'community',
    clock_timestamp() + interval '3 days', clock_timestamp() + interval '3 days 2 hours',
    'America/Los_Angeles', 'Fixture Hall', '2 Market Street', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.report-actor-limit', 37.7937, -122.3959,
    'free', 10, clock_timestamp(), 1, 1, 7, 'previously_public', clock_timestamp() - interval '1 hour'
  );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present, explicit_adult_content,
    gambling_present, weapons_present, high_risk_activity
  ) values ('$fixture_actor_limit_event', 'all_ages', false, false, false, false, false, false);
  insert into public.events (
    id, organizer_id, status, moderation_status, title, description, category,
    starts_at, ends_at, timezone, venue_name, address_line1, city, region,
    postal_code, country_code, mapbox_feature_id, latitude, longitude,
    admission_type, capacity, published_at, content_revision, moderated_revision,
    moderation_version, public_history_status, first_publicly_eligible_at
  ) values (
    '$fixture_threshold_event', '$fixture_owner', 'published', 'clear', 'Report Threshold',
    'An isolated eligible event proves three distinct reports queue one evaluation.', 'community',
    clock_timestamp() + interval '4 days', clock_timestamp() + interval '4 days 2 hours',
    'America/Los_Angeles', 'Fixture Hall', '3 Market Street', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.report-threshold', 37.7938, -122.3960,
    'free', 10, clock_timestamp(), 1, 1, 7, 'previously_public', clock_timestamp() - interval '1 hour'
  );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present, explicit_adult_content,
    gambling_present, weapons_present, high_risk_activity
  ) values ('$fixture_threshold_event', 'all_ages', false, false, false, false, false, false);
  insert into private.event_policy_legacy_exemptions (
    id, event_id, grandfathered_content_revision, input_sha256, migration_identifier
  ) values (
    '59100000-0000-4000-8000-000000000001', '$fixture_event', 1,
    private.compute_event_input_sha256('$fixture_event'), 'report-concurrency-fixture'
  );
  insert into private.event_policy_legacy_exemptions (
    id, event_id, grandfathered_content_revision, input_sha256, migration_identifier
  ) values (
    '59100000-0000-4000-8000-000000000002', '$fixture_actor_limit_event', 1,
    private.compute_event_input_sha256('$fixture_actor_limit_event'), 'report-concurrency-fixture'
  );
  insert into private.event_policy_legacy_exemptions (
    id, event_id, grandfathered_content_revision, input_sha256, migration_identifier
  ) values (
    '59100000-0000-4000-8000-000000000003', '$fixture_threshold_event', 1,
    private.compute_event_input_sha256('$fixture_threshold_event'), 'report-concurrency-fixture'
  );
  insert into private.event_moderation_actions (
    id, event_id, content_revision, input_sha256, actor_type, source, action,
    previous_status, new_status, previous_public_history_status, new_public_history_status,
    reason_code, policy_legacy_exemption_id, moderation_version
  ) values (
    '49100000-0000-4000-8000-000000000001', '$fixture_event', 1,
    private.compute_event_input_sha256('$fixture_event'), 'system', 'migration', 'authorize_publication',
    'clear', 'clear', 'previously_public', 'previously_public', 'other',
    '59100000-0000-4000-8000-000000000001', 7
  );
  insert into private.event_moderation_actions (
    id, event_id, content_revision, input_sha256, actor_type, source, action,
    previous_status, new_status, previous_public_history_status, new_public_history_status,
    reason_code, policy_legacy_exemption_id, moderation_version
  ) values (
    '49100000-0000-4000-8000-000000000002', '$fixture_actor_limit_event', 1,
    private.compute_event_input_sha256('$fixture_actor_limit_event'), 'system', 'migration', 'authorize_publication',
    'clear', 'clear', 'previously_public', 'previously_public', 'other',
    '59100000-0000-4000-8000-000000000002', 7
  );
  insert into private.event_moderation_actions (
    id, event_id, content_revision, input_sha256, actor_type, source, action,
    previous_status, new_status, previous_public_history_status, new_public_history_status,
    reason_code, policy_legacy_exemption_id, moderation_version
  ) values (
    '49100000-0000-4000-8000-000000000003', '$fixture_threshold_event', 1,
    private.compute_event_input_sha256('$fixture_threshold_event'), 'system', 'migration', 'authorize_publication',
    'clear', 'clear', 'previously_public', 'previously_public', 'other',
    '59100000-0000-4000-8000-000000000003', 7
  );
  update public.events set publicly_authorized_revision = 1,
    publicly_authorized_action_id = '49100000-0000-4000-8000-000000000001',
    public_eligibility_version = 1 where id = '$fixture_event'::uuid;
  update private.event_public_eligibility_intervals set ended_at = clock_timestamp(),
    ended_action_id = '49100000-0000-4000-8000-000000000001'
  where event_id = '$fixture_event'::uuid and public_eligibility_version = 0;
  update public.events set publicly_authorized_revision = 1,
    publicly_authorized_action_id = '49100000-0000-4000-8000-000000000002',
    public_eligibility_version = 1 where id = '$fixture_actor_limit_event'::uuid;
  update private.event_public_eligibility_intervals set ended_at = clock_timestamp(),
    ended_action_id = '49100000-0000-4000-8000-000000000002'
  where event_id = '$fixture_actor_limit_event'::uuid and public_eligibility_version = 0;
  update public.events set publicly_authorized_revision = 1,
    publicly_authorized_action_id = '49100000-0000-4000-8000-000000000003',
    public_eligibility_version = 1 where id = '$fixture_threshold_event'::uuid;
  update private.event_public_eligibility_intervals set ended_at = clock_timestamp(),
    ended_action_id = '49100000-0000-4000-8000-000000000003'
  where event_id = '$fixture_threshold_event'::uuid and public_eligibility_version = 0;
  insert into private.event_public_eligibility_intervals (
    event_id, public_eligibility_version, eligibility_state, started_at, started_action_id, transition_reason
  ) values ('$fixture_event', 1, 'eligible', clock_timestamp(),
    '49100000-0000-4000-8000-000000000001', 'policy_authorization');
  insert into private.event_public_eligibility_intervals (
    event_id, public_eligibility_version, eligibility_state, started_at, started_action_id, transition_reason
  ) values ('$fixture_actor_limit_event', 1, 'eligible', clock_timestamp(),
    '49100000-0000-4000-8000-000000000002', 'policy_authorization');
  insert into private.event_public_eligibility_intervals (
    event_id, public_eligibility_version, eligibility_state, started_at, started_action_id, transition_reason
  ) values ('$fixture_threshold_event', 1, 'eligible', clock_timestamp(),
    '49100000-0000-4000-8000-000000000003', 'policy_authorization');
  insert into private.event_report_rate_buckets (
    bucket_type, bucket_digest, window_started_at, request_count, expires_at
  ) values
    ('actor', '$fixture_actor', clock_timestamp(), 9, clock_timestamp() + interval '1 hour'),
    ('network', '$fixture_network', clock_timestamp(), 29, clock_timestamp() + interval '1 hour');
  commit;
" >"$temporary_directory/setup.log" 2>&1

submit() {
  local event_id="$1"
  local actor="$2"
  local network="$3"
  "$supabase_cli" db query --linked "begin; set local role service_role; select public.server_submit_event_report('$event_id', '$actor', '$network', 'unsafe'); commit;" \
    >"$temporary_directory/$event_id-$actor.log" 2>&1
}

submit_after_event_lock() {
  local event_id="$1"
  local actor="$2"
  local network="$3"
  local marker="$4"
  local barrier="$5"
  local secondary_gate="$6"
  "$supabase_cli" db query --linked "
    begin;
    set local role service_role;
    select public.lock_event_ticketing_operation('$event_id');
    select pg_catalog.pg_advisory_xact_lock($marker);
    select pg_catalog.pg_advisory_xact_lock_shared($barrier);
    select pg_catalog.pg_advisory_xact_lock_shared($secondary_gate);
    select public.server_submit_event_report('$event_id', '$actor', '$network', 'unsafe');
    commit;
  " >"$temporary_directory/$event_id-$actor.log" 2>&1
}

hold_barrier() {
  local barrier="$1"
  local secondary_gate="$2"
  "$supabase_cli" db query --linked "
    select pg_catalog.pg_advisory_lock($barrier);
    select pg_catalog.pg_advisory_lock($secondary_gate);
    select pg_catalog.pg_sleep(4);
    select pg_catalog.pg_advisory_unlock($barrier);
    select pg_catalog.pg_sleep(4);
    select pg_catalog.pg_advisory_unlock($secondary_gate);
  " >"$temporary_directory/barrier-$barrier.log" 2>&1 &
  barrier_pid=$!
}

wait_for_barrier() {
  local barrier="$1"
  local secondary_gate="$2"
  for _attempt in $(seq 1 24); do
    if "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if not exists (
          select 1 from pg_catalog.pg_locks
          where locktype = 'advisory' and classid = 0 and objid = $barrier
            and mode = 'ExclusiveLock' and granted
        ) or not exists (
          select 1 from pg_catalog.pg_locks
          where locktype = 'advisory' and classid = 0 and objid = $secondary_gate
            and mode = 'ExclusiveLock' and granted
        ) then
          raise exception using errcode = 'P0001', message = 'ASSERT_BARRIER_CONTROLLER_NOT_READY';
        end if;
      end
      \$assert\$;
    " >"$temporary_directory/controller-$barrier.log" 2>&1; then
      return 0
    fi
  done
  return 1
}

wait_for_overlap() {
  local first_marker="$1"
  local second_marker="$2"
  local expected_bucket="$3"
  local barrier="$4"
  local secondary_gate="$5"
  for _attempt in $(seq 1 24); do
    if "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if (select count(*) from pg_catalog.pg_locks
            where locktype = 'advisory' and classid = 0
              and objid in ($first_marker, $second_marker) and granted) <> 2 then
          raise exception using errcode = 'P0001', message = 'ASSERT_BARRIER_NOT_READY';
        end if;
        if (select count(*) from pg_catalog.pg_locks
            where locktype = 'advisory' and classid = 0 and objid = $barrier
              and mode = 'ShareLock' and granted) <> 2
          or exists (
            select 1 from pg_catalog.pg_locks
            where locktype = 'advisory' and classid = 0 and objid = $barrier
              and mode = 'ExclusiveLock' and granted
          )
          or not exists (
            select 1 from pg_catalog.pg_locks
            where locktype = 'advisory' and classid = 0 and objid = $secondary_gate
              and mode = 'ExclusiveLock' and granted
          ) then
          raise exception using errcode = 'P0001', message = 'ASSERT_SHARED_OVERLAP_NOT_READY';
        end if;
        if not exists (
          select 1 from private.event_report_rate_buckets
          where bucket_type = 'network' and bucket_digest = '$expected_bucket'
            and request_count = 29
        ) and '$expected_bucket' = '$fixture_network' then
          raise exception using errcode = 'P0001', message = 'ASSERT_NETWORK_MUTATED_BEFORE_RELEASE';
        end if;
      end
      \$assert\$;
    " >"$temporary_directory/overlap-$first_marker.log" 2>&1; then
      return 0
    fi
  done
  return 1
}

assert_one_submitted_one_limited() {
  local first_log="$1"
  local second_log="$2"
  if [[ "$(rg -l -e 'submitted' "$first_log" "$second_log" | wc -l | tr -d ' ')" != 1 ]] \
    || [[ "$(rg -l -e 'rate_limited' "$first_log" "$second_log" | wc -l | tr -d ' ')" != 1 ]]; then
    return 1
  fi
}

# Each worker first holds its own event operation lock and marker, then blocks
# on the controller-held barrier. The marker proof and unchanged bucket prove
# both distinct-event requests overlap before either can mutate the bucket.
hold_barrier "$actor_barrier" "$actor_secondary_gate"
wait_for_barrier "$actor_barrier" "$actor_secondary_gate"
submit_after_event_lock "$fixture_event" "$fixture_actor" "$fixture_actor_network" "$actor_marker_one" "$actor_barrier" "$actor_secondary_gate" & actor_first_pid=$!
submit_after_event_lock "$fixture_actor_limit_event" "$fixture_actor" "$fixture_actor_network" "$actor_marker_two" "$actor_barrier" "$actor_secondary_gate" & actor_second_pid=$!
wait_for_overlap "$actor_marker_one" "$actor_marker_two" "" "$actor_barrier" "$actor_secondary_gate"
wait "$barrier_pid"
wait "$actor_first_pid"
wait "$actor_second_pid"
assert_one_submitted_one_limited \
  "$temporary_directory/$fixture_event-$fixture_actor.log" \
  "$temporary_directory/$fixture_actor_limit_event-$fixture_actor.log"

# The network cap starts at 29. These contenders use independently locked
# events, so exactly one may reach 30 and the other must be rate limited.
hold_barrier "$network_barrier" "$network_secondary_gate"
wait_for_barrier "$network_barrier" "$network_secondary_gate"
submit_after_event_lock "$fixture_event" "$fixture_network_actor_one" "$fixture_network" "$network_marker_one" "$network_barrier" "$network_secondary_gate" & network_first_pid=$!
submit_after_event_lock "$fixture_actor_limit_event" "$fixture_network_actor_two" "$fixture_network" "$network_marker_two" "$network_barrier" "$network_secondary_gate" & network_second_pid=$!
wait_for_overlap "$network_marker_one" "$network_marker_two" "$fixture_network" "$network_barrier" "$network_secondary_gate"
wait "$barrier_pid"
wait "$network_first_pid"
wait "$network_second_pid"
assert_one_submitted_one_limited \
  "$temporary_directory/$fixture_event-$fixture_network_actor_one.log" \
  "$temporary_directory/$fixture_actor_limit_event-$fixture_network_actor_two.log"

# A clean third event proves same-revision dedupe and exactly-one escalation at
# three distinct actors without relying on either concurrent-race winner.
same_actor="$(printf '%064x' 1)"
submit "$fixture_threshold_event" "$same_actor" "$fixture_threshold_network" & first_pid=$!
submit "$fixture_threshold_event" "$same_actor" "$fixture_threshold_network" & second_pid=$!
wait "$first_pid"
wait "$second_pid"
for number in 2 3; do
  submit "$fixture_threshold_event" "$(printf '%064x' "$number")" "$fixture_threshold_network"
done

"$supabase_cli" db query --linked "
  do \$assert\$
  begin
    if (select count(*) from private.event_reports
      where event_id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid)
        and reporter_fingerprint = '$fixture_actor' and status = 'open') <> 1 then
      raise exception using errcode = 'P0001', message = 'ASSERT_ACTOR_LIMIT_ATOMIC';
    end if;
    if not exists (select 1 from private.event_report_rate_buckets where bucket_type = 'actor'
      and bucket_digest = '$fixture_actor' and request_count = 10) then
      raise exception using errcode = 'P0001', message = 'ASSERT_ACTOR_BUCKET_ATOMIC';
    end if;
    if (select count(*) from private.event_reports
      where event_id in ('$fixture_event'::uuid, '$fixture_actor_limit_event'::uuid)
        and reporter_fingerprint in ('$fixture_network_actor_one', '$fixture_network_actor_two')
        and status = 'open') <> 1 then
      raise exception using errcode = 'P0001', message = 'ASSERT_NETWORK_LIMIT_ATOMIC';
    end if;
    if not exists (select 1 from private.event_report_rate_buckets where bucket_type = 'network'
      and bucket_digest = '$fixture_network' and request_count = 30) then
      raise exception using errcode = 'P0001', message = 'ASSERT_NETWORK_LIMIT_ATOMIC';
    end if;
    if (select count(*) from private.event_reports where event_id = '$fixture_threshold_event'::uuid
      and status = 'open') <> 3 then
      raise exception using errcode = 'P0001', message = 'ASSERT_REPORT_DEDUPE_OR_LIMIT';
    end if;
    if (select count(*) from private.event_moderation_evaluations where event_id = '$fixture_threshold_event'::uuid
      and source = 'report' and status = 'queued') <> 1 then
      raise exception using errcode = 'P0001', message = 'ASSERT_ONE_REPORT_EVALUATION';
    end if;
    if not exists (select 1 from public.events where id = '$fixture_threshold_event'::uuid
      and moderation_status = 'clear' and public_eligibility_version = 1) then
      raise exception using errcode = 'P0001', message = 'ASSERT_REPORTS_NEVER_HIDE';
    end if;
  end
  \$assert\$;
" >"$temporary_directory/assert.log" 2>&1

echo 'Report cross-event barriers, atomic caps, dedupe, and single escalation passed.'
