#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
report_pid=""
admin_pid=""
run_id="$(openssl rand -hex 10)"

new_uuid() {
  node -e "console.log(require('node:crypto').randomUUID())"
}

owner_id="$(new_uuid)"
staff_id="$(new_uuid)"
event_id="$(new_uuid)"
marker="$(RUN_ID="$run_id" node -e "console.log((BigInt('0x' + process.env.RUN_ID.slice(0, 16)) & ((1n << 63n) - 1n)).toString())")"
marker_class=$((marker >> 32))
marker_object=$((marker & 4294967295))

monotonic_seconds() {
  node -e "console.log(Number(process.hrtime.bigint() / 1000000000n))"
}
actor_one="$(printf 'task15-%s-actor-1' "$run_id" | shasum -a 256 | cut -d ' ' -f 1)"
actor_two="$(printf 'task15-%s-actor-2' "$run_id" | shasum -a 256 | cut -d ' ' -f 1)"
actor_three="$(printf 'task15-%s-actor-3' "$run_id" | shasum -a 256 | cut -d ' ' -f 1)"
network="$(printf 'task15-%s-network' "$run_id" | shasum -a 256 | cut -d ' ' -f 1)"

if [[ ! -x "$supabase_cli" ]]; then
  echo "Supabase CLI is not installed at the project-local path." >&2
  exit 1
fi
chmod 700 "$temporary_directory"

sanitize_log() {
  rg -o 'ERROR: +[0-9A-Z]+|ASSERT_[A-Z0-9_]+|MODERATION_[A-Z_]+' "$1" | head -n 8 >&2 || true
}

run_query() {
  local phase="$1"
  local sql="$2"
  local log_file="$temporary_directory/${phase}.log"
  if ! "$supabase_cli" db query --linked "$sql" >"$log_file" 2>&1; then
    echo "Task 15 report phase failed: $phase" >&2
    sanitize_log "$log_file"
    return 1
  fi
}

cleanup_sql="begin;
set local session_replication_role = replica;
delete from private.event_public_eligibility_intervals where event_id = '$event_id'::uuid;
delete from private.event_reports where event_id = '$event_id'::uuid;
delete from private.moderation_review_requests where event_id = '$event_id'::uuid;
delete from private.event_moderation_evaluations where event_id = '$event_id'::uuid;
delete from private.event_moderation_actions where event_id = '$event_id'::uuid;
delete from private.event_policy_acceptances where event_id = '$event_id'::uuid;
delete from private.event_policy_legacy_exemptions where event_id = '$event_id'::uuid;
delete from private.event_risk_disclosures where event_id = '$event_id'::uuid;
delete from private.event_report_rate_buckets
where bucket_digest in ('$actor_one', '$actor_two', '$actor_three', '$network');
delete from private.staff_roles where user_id = '$staff_id'::uuid;
delete from public.events where id = '$event_id'::uuid;
delete from public.organizers where id = '$owner_id'::uuid;
delete from auth.users where id in ('$owner_id'::uuid, '$staff_id'::uuid);
commit;"

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e
  [[ -n "$report_pid" ]] && wait "$report_pid"
  [[ -n "$admin_pid" ]] && wait "$admin_pid"
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  local cleanup_status=$?
  if [[ $cleanup_status -eq 0 ]]; then
    "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if exists (select 1 from auth.users where id in ('$owner_id', '$staff_id'))
           or exists (select 1 from public.events where id = '$event_id')
           or exists (
             select 1 from private.event_report_rate_buckets
             where bucket_digest in ('$actor_one', '$actor_two', '$actor_three', '$network')
           ) then
          raise exception using errcode = 'P0001', message = 'ASSERT_REPORT_CLEANUP_RESIDUE';
        end if;
      end
      \$assert\$;
    " >"$temporary_directory/residue.log" 2>&1
    cleanup_status=$?
  fi
  [[ $cleanup_status -eq 0 ]] || sanitize_log "$temporary_directory/cleanup.log"
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  [[ $original_status -eq 0 ]] || exit "$original_status"
  exit "$cleanup_status"
}
trap cleanup EXIT

wait_for_marker() {
  local log_file="$temporary_directory/marker.log"
  local deadline=$(( $(monotonic_seconds) + 45 ))
  while (( $(monotonic_seconds) < deadline )); do
    if [[ -n "$report_pid" ]] && ! kill -0 "$report_pid" 2>/dev/null; then
      break
    fi
    if "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if not exists (
          select 1 from pg_catalog.pg_locks
          where locktype = 'advisory'
            and classid = '$marker_class'::oid
            and objid = '$marker_object'::oid
            and objsubid = 1 and granted
        ) then
          raise exception using errcode = 'P0001', message = 'ASSERT_REPORT_MARKER_NOT_READY';
        end if;
      end
      \$assert\$;
    " >"$log_file" 2>&1; then return 0; fi
    sleep 0.2
  done
  sanitize_log "$log_file"
  return 1
}

run_query pre-cleanup "$cleanup_sql"
run_query setup "
  begin;
  insert into auth.users (id, email) values
    ('$owner_id', 'whereto-task15-report-owner-${run_id}@example.invalid'),
    ('$staff_id', 'whereto-task15-report-staff-${run_id}@example.invalid');
  insert into private.staff_roles (user_id, role, active, granted_by)
  values ('$staff_id', 'admin', true, '$staff_id');
  insert into public.organizers (
    id, display_name, organizer_type, base_city, country_code, onboarding_completed_at
  ) values (
    '$owner_id', 'WHERETO_TASK15_REPORT_${run_id}', 'Community group',
    'San Francisco', 'US', statement_timestamp()
  );
  insert into public.events (
    id, organizer_id, title, description, category, starts_at, ends_at,
    timezone, venue_name, address_line1, city, region, postal_code,
    country_code, mapbox_feature_id, latitude, longitude, admission_type, capacity
  ) values (
    '$event_id', '$owner_id', 'WHERETO_TASK15_REPORT_${run_id}',
    'A complete low-risk fixture for report/admin serialization.', 'community',
    statement_timestamp() + interval '4 days',
    statement_timestamp() + interval '4 days 2 hours', 'America/Los_Angeles',
    'Report Hall', '3 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.task15.report.${run_id}', 37.7936, -122.3958, 'free', 25
  );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present,
    explicit_adult_content, gambling_present, weapons_present, high_risk_activity
  ) values ('$event_id', 'all_ages', false, false, false, false, false, false);
  select set_config('request.jwt.claim.sub', '$owner_id', true);
  set local role authenticated;
  select public.accept_current_event_policies('$event_id');
  select public.publish_event('$event_id');
  reset role;
  set local role service_role;
  do \$assert\$
  declare result_one text; result_two text;
  begin
    select public.server_submit_event_report('$event_id', '$actor_one', '$network', 'unsafe') into result_one;
    select public.server_submit_event_report('$event_id', '$actor_two', '$network', 'unsafe') into result_two;
    if result_one <> 'submitted' or result_two <> 'submitted' then
      raise exception using errcode = 'P0001', message = 'ASSERT_REPORT_SETUP_SUBMISSION';
    end if;
  end
  \$assert\$;
  reset role;
  do \$assert\$
  begin
    if not private.event_has_current_public_eligibility('$event_id')
       or exists (select 1 from private.event_moderation_evaluations where event_id = '$event_id') then
      raise exception using errcode = 'P0001', message = 'ASSERT_REPORT_PRETHRESHOLD_AUTO_HIDE';
    end if;
  end
  \$assert\$;
  commit;
"

case_json="$("$supabase_cli" db query --linked --output-format json "
  begin;
  select set_config('request.jwt.claim.sub', '$staff_id', true);
  set local role authenticated;
  select content_revision, input_sha256, moderation_version
  from public.get_moderation_case('$event_id');
  commit;
")"
read -r expected_revision expected_digest expected_version < <(
  CASE_JSON="$case_json" node --input-type=module <<'NODE'
const row = JSON.parse(process.env.CASE_JSON).rows?.[0]
if (!row) process.exit(1)
process.stdout.write(`${row.content_revision} ${row.input_sha256} ${row.moderation_version}\n`)
NODE
)

"$supabase_cli" db query --linked "
  begin;
  set local statement_timeout = '30s';
  set local role service_role;
  select public.server_submit_event_report(
    '$event_id', '$actor_three', '$network', 'unsafe'
  );
  reset role;
  do \$assert\$
  begin
    if not private.event_has_current_public_eligibility('$event_id')
       or (select count(*) from private.event_moderation_evaluations
           where event_id = '$event_id' and source = 'report' and status = 'queued') <> 1 then
      raise exception using errcode = 'P0001', message = 'ASSERT_REPORT_THRESHOLD_NO_AUTO_HIDE';
    end if;
  end
  \$assert\$;
  select pg_catalog.pg_advisory_xact_lock($marker);
  select pg_catalog.pg_sleep(6);
  commit;
" >"$temporary_directory/threshold-report.log" 2>&1 &
report_pid=$!

wait_for_marker

"$supabase_cli" db query --linked "
  begin;
  set local statement_timeout = '30s';
  select set_config('request.jwt.claim.sub', '$staff_id', true);
  set local role authenticated;
  select public.moderate_event(
    '$event_id', '$expected_revision', '$expected_digest', '$expected_version',
    'remove', 'other', 'Task 15 report/admin overlap'
  );
  commit;
" >"$temporary_directory/admin-remove.log" 2>&1 &
admin_pid=$!

set +e
wait "$report_pid"; report_status=$?; report_pid=""
wait "$admin_pid"; admin_status=$?; admin_pid=""
set -e
if [[ $report_status -ne 0 || $admin_status -ne 0 ]]; then
  sanitize_log "$temporary_directory/threshold-report.log"
  sanitize_log "$temporary_directory/admin-remove.log"
  exit 1
fi

run_query assert-final "
  do \$assert\$
  begin
    if (select count(*) from private.event_reports
        where event_id = '$event_id' and status = 'open') <> 3
       or not exists (
         select 1 from private.event_moderation_evaluations
         where event_id = '$event_id' and source = 'report'
           and status = 'superseded'
           and failure_code = 'HUMAN_OR_RESULT_SUPERSEDED'
       )
       or not exists (
         select 1 from private.event_moderation_actions
         where event_id = '$event_id' and action = 'remove'
           and actor_type = 'admin'
       )
       or private.event_has_current_public_eligibility('$event_id')
       or exists (select 1 from public.get_public_event('$event_id')) then
      raise exception using errcode = 'P0001', message = 'ASSERT_REPORT_ADMIN_FINAL_INVARIANT';
    end if;
  end
  \$assert\$;
"

echo "Moderation report threshold/admin serialization and no-auto-hide proof passed."
