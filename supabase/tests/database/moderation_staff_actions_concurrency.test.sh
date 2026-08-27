#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
locker_pid=""
staff_pid=""

fixture_owner='18100000-0000-4000-8000-000000000001'
fixture_admin='18100000-0000-4000-8000-000000000002'
fixture_moderator='18100000-0000-4000-8000-000000000003'
fixture_event='28100000-0000-4000-8000-000000000001'
fixture_evaluation='38100000-0000-4000-8000-000000000001'
locker_marker='918508'
claim_marker='918509'

if [[ ! -x "$supabase_cli" ]]; then
  echo "Supabase CLI is not installed at the project-local path." >&2
  exit 1
fi

sanitize_log() {
  rg -o 'ERROR: +[0-9A-Z]+|ASSERT_[A-Z0-9_]+|constraint \\"[A-Za-z0-9_.-]+\\"' "$1" | head -n 6 >&2 || true
}

wait_for_marker() {
  local marker="$1"
  local marker_log="$temporary_directory/marker-${marker}.log"
  local status=1
  for _attempt in 1 2 3 4 5 6 7 8 9 10; do
    set +e
    "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if not exists (
          select 1 from pg_catalog.pg_locks
          where locktype = 'advisory' and classid = 0 and objid = '${marker}'::oid and granted
        ) then
          raise exception using errcode = 'P0001', message = 'ASSERT_MARKER_NOT_READY';
        end if;
      end
      \$assert\$;
    " >"$marker_log" 2>&1
    status=$?
    set -e
    if [[ $status -eq 0 ]]; then return 0; fi
  done
  sanitize_log "$marker_log"
  return "$status"
}

cleanup_sql="begin;
set local session_replication_role = replica;
delete from private.event_legacy_history_resolutions where event_id = '$fixture_event'::uuid;
delete from private.event_public_eligibility_intervals where event_id = '$fixture_event'::uuid;
delete from private.event_moderation_actions where event_id = '$fixture_event'::uuid;
delete from private.event_moderation_evaluations where event_id = '$fixture_event'::uuid;
delete from private.event_risk_disclosures where event_id = '$fixture_event'::uuid;
delete from private.staff_roles where user_id in ('$fixture_admin'::uuid, '$fixture_moderator'::uuid);
delete from public.events where id = '$fixture_event'::uuid;
delete from public.organizers where id = '$fixture_owner'::uuid;
delete from auth.users where id in ('$fixture_owner'::uuid, '$fixture_admin'::uuid, '$fixture_moderator'::uuid);
commit;"

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e
  [[ -n "$locker_pid" ]] && wait "$locker_pid"
  [[ -n "$staff_pid" ]] && wait "$staff_pid"
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  local cleanup_status=$?
  if [[ $cleanup_status -ne 0 ]]; then sanitize_log "$temporary_directory/cleanup.log"; fi
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  [[ $original_status -eq 0 ]] || exit "$original_status"
  exit "$cleanup_status"
}
trap cleanup EXIT

"$supabase_cli" db query --linked "
  begin;
  insert into auth.users (id, email) values
    ('$fixture_owner', 'staff-concurrency-owner@example.invalid'),
    ('$fixture_admin', 'staff-concurrency-admin@example.invalid'),
    ('$fixture_moderator', 'staff-concurrency-moderator@example.invalid');
  insert into private.staff_roles (user_id, role, active, granted_by) values
    ('$fixture_admin', 'admin', true, '$fixture_admin'),
    ('$fixture_moderator', 'moderator', true, '$fixture_admin');
  insert into public.organizers (id, display_name, organizer_type, base_city, country_code, onboarding_completed_at)
  values ('$fixture_owner', 'Staff Concurrency Fixture', 'Community group', 'San Francisco', 'US', clock_timestamp());
  insert into public.events (
    id, organizer_id, status, moderation_status, title, description, category,
    starts_at, ends_at, timezone, venue_name, address_line1, city, region,
    postal_code, country_code, mapbox_feature_id, latitude, longitude,
    admission_type, capacity, published_at, content_revision, moderation_version,
    public_history_status
  ) values (
    '$fixture_event', '$fixture_owner', 'published', 'under_review',
    'Staff Precedence Fixture', 'A complete fixture for a staff/worker overlap proof.',
    'community', clock_timestamp() + interval '2 days', clock_timestamp() + interval '2 days 2 hours',
    'America/Los_Angeles', 'Fixture Hall', '1 Market Street', 'San Francisco',
    'CA', '94105', 'US', 'mapbox.staff-precedence', 37.7936, -122.3958,
    'free', 10, clock_timestamp(), 1, 1, 'never_public'
  );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present, explicit_adult_content,
    gambling_present, weapons_present, high_risk_activity
  ) values ('$fixture_event', 'all_ages', false, false, false, false, false, false);
  insert into private.event_moderation_evaluations (
    id, event_id, content_revision, input_sha256, queued_moderation_version,
    status, source, created_at
  ) values (
    '$fixture_evaluation', '$fixture_event', 1,
    private.compute_event_input_sha256('$fixture_event'), 1, 'queued', 'contextual',
    '1900-01-01 00:00:00+00'
  );
  commit;
" >"$temporary_directory/setup.log" 2>&1

# A staff caller receives the revision digest through the bounded case RPC; it
# never reads the private digest helper directly.
fixture_digest="$("$supabase_cli" db query --linked --output-format json "
  begin;
  select set_config('request.jwt.claim.sub', '$fixture_moderator', true);
  set local role authenticated;
  select input_sha256 from public.get_moderation_case('$fixture_event'::uuid);
  commit;
" | jq -er '.rows[0].input_sha256')"

"$supabase_cli" db query --linked "
  begin;
  select id from public.events where id = '$fixture_event'::uuid for update;
  select pg_catalog.pg_advisory_xact_lock($locker_marker);
  select pg_catalog.pg_sleep(5);
  set local role service_role;
  do \$assert\$
  declare claimed_id uuid;
  begin
    select evaluation_id into claimed_id from public.server_claim_moderation_evaluation('staff-precedence-worker');
    if claimed_id is distinct from '$fixture_evaluation'::uuid then
      raise exception using errcode = 'P0001', message = 'ASSERT_STAFF_PRECEDENCE_CLAIM';
    end if;
  end
  \$assert\$;
  select pg_catalog.pg_advisory_xact_lock($claim_marker);
  commit;
" >"$temporary_directory/locker.log" 2>&1 &
locker_pid=$!

wait_for_marker "$locker_marker"

"$supabase_cli" db query --linked "
  begin;
  select set_config('request.jwt.claim.sub', '$fixture_moderator', true);
  set local role authenticated;
  select public.moderate_event(
    '$fixture_event', 1, '$fixture_digest',
    1, 'hold', 'other', 'overlap proof'
  );
  commit;
" >"$temporary_directory/staff.log" 2>&1 &
staff_pid=$!

set +e
wait "$locker_pid"
locker_status=$?
set -e
locker_pid=""
if [[ $locker_status -ne 0 ]]; then
  sanitize_log "$temporary_directory/locker.log"
  exit "$locker_status"
fi
set +e
wait "$staff_pid"
staff_status=$?
set -e
staff_pid=""
if [[ $staff_status -ne 0 ]]; then
  sanitize_log "$temporary_directory/staff.log"
  exit "$staff_status"
fi

"$supabase_cli" db query --linked "
  do \$assert\$
  begin
    if not exists (
      select 1 from public.events as events
      join private.event_public_eligibility_intervals as intervals
        on intervals.event_id = events.id and intervals.ended_at is null
      where events.id = '$fixture_event'::uuid
        and events.moderation_status = 'under_review'
        and events.moderation_version = 2
        and events.public_eligibility_version = 0
        and intervals.eligibility_state = 'ineligible'
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_STAFF_PRECEDENCE_EVENT';
    end if;
    if not exists (
      select 1 from private.event_moderation_evaluations
      where id = '$fixture_evaluation'::uuid and status = 'superseded'
        and failure_code = 'HUMAN_OR_RESULT_SUPERSEDED'
        and finished_at >= started_at
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_STAFF_PRECEDENCE_EVALUATION';
    end if;
    if not exists (
      select 1 from private.event_moderation_actions
      where event_id = '$fixture_event'::uuid and action = 'hold'
        and actor_type = 'moderator' and moderation_version = 2
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_STAFF_PRECEDENCE_ACTION';
    end if;
  end
  \$assert\$;
" >"$temporary_directory/assert.log" 2>&1

echo "Staff moderation claimed-job precedence passed."
