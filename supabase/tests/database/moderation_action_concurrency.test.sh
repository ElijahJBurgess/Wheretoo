#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
first_pid=""
second_pid=""
run_id="$(openssl rand -hex 10)"

new_uuid() {
  node -e "console.log(require('node:crypto').randomUUID())"
}

owner_id="$(new_uuid)"
staff_id="$(new_uuid)"
event_id="$(new_uuid)"
evaluation_id="$(new_uuid)"
publish_evaluation_id="$(new_uuid)"
marker="$(RUN_ID="$run_id" node -e "console.log((BigInt('0x' + process.env.RUN_ID.slice(0, 16)) & ((1n << 63n) - 1n)).toString())")"
marker_class=$((marker >> 32))
marker_object=$((marker & 4294967295))

monotonic_seconds() {
  node -e "console.log(Number(process.hrtime.bigint() / 1000000000n))"
}

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
    echo "Task 15 action phase failed: $phase" >&2
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
delete from private.staff_roles where user_id = '$staff_id'::uuid;
delete from public.events where id = '$event_id'::uuid;
delete from public.organizers where id = '$owner_id'::uuid;
delete from auth.users where id in ('$owner_id'::uuid, '$staff_id'::uuid);
commit;"

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e
  [[ -n "$first_pid" ]] && wait "$first_pid"
  [[ -n "$second_pid" ]] && wait "$second_pid"
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  local cleanup_status=$?
  if [[ $cleanup_status -eq 0 ]]; then
    "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if exists (select 1 from auth.users where id in ('$owner_id', '$staff_id'))
           or exists (select 1 from public.events where id = '$event_id') then
          raise exception using errcode = 'P0001', message = 'ASSERT_ACTION_CLEANUP_RESIDUE';
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
  local label="$1"
  local log_file="$temporary_directory/marker-${label}.log"
  local deadline=$(( $(monotonic_seconds) + 45 ))
  while (( $(monotonic_seconds) < deadline )); do
    if [[ -n "$first_pid" ]] && ! kill -0 "$first_pid" 2>/dev/null; then
      break
    fi
    if "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if not exists (
          select 1 from pg_catalog.pg_locks
          where locktype = 'advisory'
            and classid = '$marker_class'::oid
            and objid = '$marker_object'::oid and granted
        ) then
          raise exception using errcode = 'P0001', message = 'ASSERT_ACTION_MARKER_NOT_READY';
        end if;
      end
      \$assert\$;
    " >"$log_file" 2>&1; then return 0; fi
    sleep 0.2
  done
  sanitize_log "$log_file"
  return 1
}

event_payload() {
  local offset="$1"
  cat <<SQL
    (select jsonb_build_object(
      'title', events.title, 'description', events.description,
      'category', events.category, 'starts_at', events.starts_at,
      'ends_at', events.ends_at + interval '$offset minutes',
      'timezone', events.timezone, 'venue_name', events.venue_name,
      'address_line1', events.address_line1, 'address_line2', events.address_line2,
      'city', events.city, 'region', events.region, 'postal_code', events.postal_code,
      'country_code', events.country_code, 'mapbox_feature_id', events.mapbox_feature_id,
      'latitude', events.latitude, 'longitude', events.longitude,
      'admission_type', events.admission_type, 'capacity', events.capacity
    ) from public.events as events where events.id = '$event_id'::uuid)
SQL
}

run_query pre-cleanup "$cleanup_sql"
run_query setup "
  begin;
  insert into auth.users (id, email) values
    ('$owner_id', 'whereto-task15-action-owner-${run_id}@example.invalid'),
    ('$staff_id', 'whereto-task15-action-staff-${run_id}@example.invalid');
  insert into private.staff_roles (user_id, role, active, granted_by)
  values ('$staff_id', 'moderator', true, '$staff_id');
  insert into public.organizers (
    id, display_name, organizer_type, base_city, country_code, onboarding_completed_at
  ) values (
    '$owner_id', 'WHERETO_TASK15_ACTION_${run_id}', 'Community group',
    'San Francisco', 'US', statement_timestamp()
  );
  insert into public.events (
    id, organizer_id, title, description, category, starts_at, ends_at,
    timezone, venue_name, address_line1, city, region, postal_code,
    country_code, mapbox_feature_id, latitude, longitude, admission_type, capacity
  ) values (
    '$event_id', '$owner_id', 'WHERETO_TASK15_ACTION_${run_id}',
    'A complete low-risk fixture for action serialization races.', 'community',
    statement_timestamp() + interval '3 days',
    statement_timestamp() + interval '3 days 2 hours', 'America/Los_Angeles',
    'Action Hall', '2 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.task15.action.${run_id}', 37.7936, -122.3958, 'free', 30
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
  insert into private.event_moderation_evaluations (
    id, event_id, content_revision, input_sha256, queued_moderation_version,
    status, source, created_at
  ) select '$evaluation_id', id, content_revision,
      private.compute_event_input_sha256(id), moderation_version,
      'queued', 'contextual', '1800-01-01 00:00:00+00'
    from public.events where id = '$event_id';
  set local role service_role;
  do \$assert\$
  declare claimed uuid;
  begin
    select evaluation_id into claimed from public.server_claim_moderation_evaluation('task15-action-edit');
    if claimed is distinct from '$evaluation_id'::uuid then
      raise exception using errcode = 'P0001', message = 'ASSERT_ACTION_CLAIM_MISMATCH';
    end if;
  end
  \$assert\$;
  reset role;
  commit;
"

evaluation_json="$("$supabase_cli" db query --linked --output-format json "
  select content_revision, input_sha256, queued_moderation_version
  from private.event_moderation_evaluations where id = '$evaluation_id';
")"
read -r eval_revision eval_digest eval_version < <(
  EVALUATION_JSON="$evaluation_json" node --input-type=module <<'NODE'
const row = JSON.parse(process.env.EVALUATION_JSON).rows?.[0]
if (!row) process.exit(1)
process.stdout.write(`${row.content_revision} ${row.input_sha256} ${row.queued_moderation_version}\n`)
NODE
)

"$supabase_cli" db query --linked "
  begin;
  select set_config('request.jwt.claim.sub', '$owner_id', true);
  set local role authenticated;
  select public.save_owned_event_revision('$event_id', $(event_payload 5));
  select pg_catalog.pg_advisory_xact_lock($marker);
  select pg_catalog.pg_sleep(6);
  commit;
" >"$temporary_directory/edit-evaluation-edit.log" 2>&1 &
first_pid=$!
wait_for_marker edit-evaluation

"$supabase_cli" db query --linked "
  begin;
  set local statement_timeout = '30s';
  set local role service_role;
  do \$assert\$
  declare outcome text;
  begin
    select public.server_apply_moderation_evaluation(
      '$evaluation_id', '$eval_revision', '$eval_digest', '$eval_version',
      'clear_candidate', 'low', array['no_violation'],
      'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64)
    ) into outcome;
    if outcome <> 'superseded' then
      raise exception using errcode = 'P0001', message = 'ASSERT_EDIT_EVALUATION_OUTCOME';
    end if;
  end
  \$assert\$;
  commit;
" >"$temporary_directory/edit-evaluation-apply.log" 2>&1 &
second_pid=$!

set +e
wait "$first_pid"; first_status=$?; first_pid=""
wait "$second_pid"; second_status=$?; second_pid=""
set -e
if [[ $first_status -ne 0 || $second_status -ne 0 ]]; then
  sanitize_log "$temporary_directory/edit-evaluation-edit.log"
  sanitize_log "$temporary_directory/edit-evaluation-apply.log"
  exit 1
fi

case_json="$("$supabase_cli" db query --linked --output-format json "
  begin;
  select set_config('request.jwt.claim.sub', '$staff_id', true);
  set local role authenticated;
  select content_revision, input_sha256, moderation_version
  from public.get_moderation_case('$event_id');
  commit;
")"
read -r stale_revision stale_digest stale_version < <(
  CASE_JSON="$case_json" node --input-type=module <<'NODE'
const row = JSON.parse(process.env.CASE_JSON).rows?.[0]
if (!row) process.exit(1)
process.stdout.write(`${row.content_revision} ${row.input_sha256} ${row.moderation_version}\n`)
NODE
)

"$supabase_cli" db query --linked "
  begin;
  select set_config('request.jwt.claim.sub', '$owner_id', true);
  set local role authenticated;
  select public.save_owned_event_revision('$event_id', $(event_payload 7));
  select pg_catalog.pg_advisory_xact_lock($marker);
  select pg_catalog.pg_sleep(6);
  commit;
" >"$temporary_directory/edit-staff-edit.log" 2>&1 &
first_pid=$!
wait_for_marker edit-staff

set +e
"$supabase_cli" db query --linked "
  begin;
  set local statement_timeout = '30s';
  select set_config('request.jwt.claim.sub', '$staff_id', true);
  set local role authenticated;
  select public.moderate_event(
    '$event_id', '$stale_revision', '$stale_digest', '$stale_version',
    'hold', 'other', 'Task 15 stale staff overlap'
  );
  commit;
" >"$temporary_directory/edit-staff-action.log" 2>&1
staff_status=$?
wait "$first_pid"; first_status=$?; first_pid=""
set -e
if [[ $first_status -ne 0 || $staff_status -eq 0 ]] ||
   ! rg -q 'MODERATION_CONFLICT' "$temporary_directory/edit-staff-action.log"; then
  sanitize_log "$temporary_directory/edit-staff-edit.log"
  sanitize_log "$temporary_directory/edit-staff-action.log"
  exit 1
fi

run_query prepare-publish-evaluation "
  begin;
  insert into private.event_moderation_evaluations (
    id, event_id, content_revision, input_sha256, queued_moderation_version,
    status, source, created_at
  ) select '$publish_evaluation_id', id, content_revision,
      private.compute_event_input_sha256(id), moderation_version,
      'queued', 'contextual', '1800-01-01 00:00:01+00'
    from public.events where id = '$event_id';
  set local role service_role;
  do \$assert\$
  declare claimed uuid;
  begin
    select evaluation_id into claimed from public.server_claim_moderation_evaluation('task15-action-publish');
    if claimed is distinct from '$publish_evaluation_id'::uuid then
      raise exception using errcode = 'P0001', message = 'ASSERT_PUBLISH_CLAIM_MISMATCH';
    end if;
  end
  \$assert\$;
  reset role;
  commit;
"

publish_json="$("$supabase_cli" db query --linked --output-format json "
  select content_revision, input_sha256, queued_moderation_version
  from private.event_moderation_evaluations where id = '$publish_evaluation_id';
")"
read -r publish_revision publish_digest publish_version < <(
  EVALUATION_JSON="$publish_json" node --input-type=module <<'NODE'
const row = JSON.parse(process.env.EVALUATION_JSON).rows?.[0]
if (!row) process.exit(1)
process.stdout.write(`${row.content_revision} ${row.input_sha256} ${row.queued_moderation_version}\n`)
NODE
)

"$supabase_cli" db query --linked "
  begin;
  select set_config('request.jwt.claim.sub', '$owner_id', true);
  set local role authenticated;
  select public.accept_current_event_policies('$event_id');
  select public.publish_event('$event_id');
  select pg_catalog.pg_advisory_xact_lock($marker);
  select pg_catalog.pg_sleep(6);
  commit;
" >"$temporary_directory/publish-evaluation-publish.log" 2>&1 &
first_pid=$!
wait_for_marker publish-evaluation

"$supabase_cli" db query --linked "
  begin;
  set local statement_timeout = '30s';
  set local role service_role;
  select public.server_apply_moderation_evaluation(
    '$publish_evaluation_id', '$publish_revision', '$publish_digest', '$publish_version',
    'clear_candidate', 'low', array['no_violation'],
    'sha256:' || repeat('c', 64), 'sha256:' || repeat('d', 64)
  );
  commit;
" >"$temporary_directory/publish-evaluation-apply.log" 2>&1 &
second_pid=$!

set +e
wait "$first_pid"; first_status=$?; first_pid=""
wait "$second_pid"; second_status=$?; second_pid=""
set -e
if [[ $first_status -ne 0 || $second_status -ne 0 ]]; then
  sanitize_log "$temporary_directory/publish-evaluation-publish.log"
  sanitize_log "$temporary_directory/publish-evaluation-apply.log"
  exit 1
fi

run_query assert-final "
  do \$assert\$
  begin
    if not exists (
      select 1 from private.event_moderation_evaluations
      where id = '$evaluation_id' and status = 'superseded'
        and failure_code in (
          'CONTENT_REVISION_CHANGED', 'STALE_EVALUATION',
          'HUMAN_OR_RESULT_SUPERSEDED'
        )
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_EDIT_EVALUATION_NOT_SUPERSEDED';
    end if;
    if not exists (
      select 1 from private.event_moderation_evaluations
      where id = '$publish_evaluation_id' and status = 'succeeded'
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_PUBLISH_EVALUATION_NOT_SUCCEEDED';
    end if;
    if not private.event_has_current_public_eligibility('$event_id') then
      raise exception using errcode = 'P0001', message = 'ASSERT_PUBLISH_NOT_ELIGIBLE';
    end if;
    if (select count(*) from private.event_public_eligibility_intervals
        where event_id = '$event_id' and ended_at is null) <> 1 then
      raise exception using errcode = 'P0001', message = 'ASSERT_ACTION_OPEN_INTERVAL_COUNT';
    end if;
  end
  \$assert\$;
"

echo "Moderation publish/evaluate, edit/evaluate, and edit/staff serialization passed."
