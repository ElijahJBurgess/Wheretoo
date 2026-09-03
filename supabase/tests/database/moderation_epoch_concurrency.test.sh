#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
reservation_pid=""
removal_pid=""
run_id="$(openssl rand -hex 10)"

new_uuid() {
  node -e "console.log(require('node:crypto').randomUUID())"
}

owner_id="$(new_uuid)"
staff_id="$(new_uuid)"
event_id="$(new_uuid)"
tier_id="$(new_uuid)"
request_id="$(new_uuid)"
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
  rg -o 'ERROR: +[0-9A-Z]+|ASSERT_[A-Z0-9_]+|EVENT_NOT_SELLABLE|MODERATION_[A-Z_]+' "$1" | head -n 8 >&2 || true
}

run_query() {
  local phase="$1"
  local sql="$2"
  local log_file="$temporary_directory/${phase}.log"
  if ! "$supabase_cli" db query --linked "$sql" >"$log_file" 2>&1; then
    echo "Task 15 epoch phase failed: $phase" >&2
    sanitize_log "$log_file"
    return 1
  fi
}

cleanup_sql="begin;
set local session_replication_role = replica;
delete from public.order_items where order_id in (select id from public.orders where event_id = '$event_id'::uuid);
delete from public.orders where event_id = '$event_id'::uuid;
delete from public.ticket_tiers where event_id = '$event_id'::uuid;
delete from public.organizer_stripe_accounts where organizer_id = '$owner_id'::uuid;
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
  [[ -n "$reservation_pid" ]] && wait "$reservation_pid"
  [[ -n "$removal_pid" ]] && wait "$removal_pid"
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  local cleanup_status=$?
  if [[ $cleanup_status -eq 0 ]]; then
    "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if exists (select 1 from auth.users where id in ('$owner_id', '$staff_id'))
           or exists (select 1 from public.events where id = '$event_id')
           or exists (select 1 from public.orders where event_id = '$event_id') then
          raise exception using errcode = 'P0001', message = 'ASSERT_EPOCH_CLEANUP_RESIDUE';
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
    if [[ -n "$reservation_pid" ]] && ! kill -0 "$reservation_pid" 2>/dev/null; then
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
          raise exception using errcode = 'P0001', message = 'ASSERT_EPOCH_MARKER_NOT_READY';
        end if;
      end
      \$assert\$;
    " >"$log_file" 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  sanitize_log "$log_file"
  return 1
}

run_query pre-cleanup "$cleanup_sql"
run_query setup "
  begin;
  insert into auth.users (id, email) values
    ('$owner_id', 'whereto-task15-epoch-owner-${run_id}@example.invalid'),
    ('$staff_id', 'whereto-task15-epoch-staff-${run_id}@example.invalid');
  insert into private.staff_roles (user_id, role, active, granted_by)
  values ('$staff_id', 'moderator', true, '$staff_id');
  insert into public.organizers (
    id, display_name, organizer_type, base_city, country_code, onboarding_completed_at
  ) values (
    '$owner_id', 'WHERETO_TASK15_EPOCH_${run_id}', 'Community group',
    'San Francisco', 'US', statement_timestamp()
  );
  insert into public.organizer_stripe_accounts (
    organizer_id, stripe_account_id, transfers_status, payouts_status,
    requirements_status, requirements_currently_due_count,
    requirements_past_due_count, last_synced_at
  ) values (
    '$owner_id', 'acct_task15${run_id}', 'active', 'active', 'clear', 0, 0,
    statement_timestamp()
  );
  insert into public.events (
    id, organizer_id, title, description, category, starts_at, ends_at,
    timezone, venue_name, address_line1, city, region, postal_code,
    country_code, mapbox_feature_id, latitude, longitude, admission_type, capacity
  ) values (
    '$event_id', '$owner_id', 'WHERETO_TASK15_EPOCH_${run_id}',
    'A complete paid DB-only fixture for eligibility epoch serialization.',
    'community', statement_timestamp() + interval '2 days',
    statement_timestamp() + interval '2 days 2 hours', 'America/Los_Angeles',
    'Epoch Hall', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.task15.epoch.${run_id}', 37.7936, -122.3958, 'paid', 20
  );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present,
    explicit_adult_content, gambling_present, weapons_present, high_risk_activity
  ) values ('$event_id', 'all_ages', false, false, false, false, false, false);
  insert into public.ticket_tiers (
    id, event_id, name, description, unit_amount_minor, currency,
    quantity_total, status, sort_order
  ) values (
    '$tier_id', '$event_id', 'General admission', 'Task 15 DB-only tier',
    2000, 'usd', 20, 'draft', 1
  );
  select set_config('request.jwt.claim.sub', '$owner_id', true);
  set local role authenticated;
  select public.accept_current_event_policies('$event_id');
  select public.publish_event('$event_id');
  reset role;
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
  select * from public.server_reserve_checkout(
    '$event_id', '$tier_id'::uuid, 'Task 15 Buyer',
    'whereto-task15-buyer-${run_id}@example.invalid', '$request_id', repeat('a', 64)
  );
  select pg_catalog.pg_advisory_xact_lock($marker);
  select pg_catalog.pg_sleep(6);
  commit;
" >"$temporary_directory/reservation.log" 2>&1 &
reservation_pid=$!

wait_for_marker

"$supabase_cli" db query --linked "
  begin;
  set local statement_timeout = '30s';
  select set_config('request.jwt.claim.sub', '$staff_id', true);
  set local role authenticated;
  select public.moderate_event(
    '$event_id', '$expected_revision', '$expected_digest', '$expected_version',
    'remove', 'other', 'Task 15 reservation/remove overlap'
  );
  commit;
" >"$temporary_directory/removal.log" 2>&1 &
removal_pid=$!

set +e
wait "$reservation_pid"
reservation_status=$?
reservation_pid=""
wait "$removal_pid"
removal_status=$?
removal_pid=""
set -e
if [[ $reservation_status -ne 0 || $removal_status -ne 0 ]]; then
  sanitize_log "$temporary_directory/reservation.log"
  sanitize_log "$temporary_directory/removal.log"
  exit 1
fi

run_query option-a "
  begin;
  do \$assert\$
  begin
    if not exists (
      select 1 from public.orders
      where event_id = '$event_id' and client_request_id = '$request_id'
        and status = 'creating_checkout' and reservation_expires_at > statement_timestamp()
        and expired_at is null and failed_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_OPEN_RESERVATION_NOT_PRESERVED';
    end if;
    if private.event_has_current_public_eligibility('$event_id')
       or exists (select 1 from public.get_public_event('$event_id')) then
      raise exception using errcode = 'P0001', message = 'ASSERT_REMOVAL_NOT_IMMEDIATE';
    end if;
  end
  \$assert\$;

  set local role service_role;
  do \$assert\$
  begin
    begin
      perform * from public.server_reserve_checkout(
        '$event_id', '$tier_id'::uuid, 'Blocked Buyer',
        'whereto-task15-blocked-${run_id}@example.invalid',
        '$(new_uuid)', repeat('b', 64)
      );
      raise exception using errcode = 'P0001', message = 'ASSERT_NEW_RESERVATION_WAS_ALLOWED';
    exception
      when sqlstate 'P0001' then
        if sqlerrm <> 'EVENT_NOT_SELLABLE' then raise; end if;
    end;
  end
  \$assert\$;
  reset role;

  commit;
"

race_staff_action() {
  local action="$1"
  local reason="$2"
  local label="$3"
  local current_json
  local revision
  local digest
  local version
  local winner_status
  local contender_status

  current_json="$("$supabase_cli" db query --linked --output-format json "
    begin;
    select set_config('request.jwt.claim.sub', '$staff_id', true);
    set local role authenticated;
    select content_revision, input_sha256, moderation_version
    from public.get_moderation_case('$event_id');
    commit;
  ")"
  read -r revision digest version < <(
    CASE_JSON="$current_json" node --input-type=module <<'NODE'
const row = JSON.parse(process.env.CASE_JSON).rows?.[0]
if (!row) process.exit(1)
process.stdout.write(`${row.content_revision} ${row.input_sha256} ${row.moderation_version}\n`)
NODE
  )

  "$supabase_cli" db query --linked "
    begin;
    set local statement_timeout = '30s';
    select set_config('request.jwt.claim.sub', '$staff_id', true);
    set local role authenticated;
    select public.moderate_event(
      '$event_id', '$revision', '$digest', '$version',
      '$action', '$reason', 'Task 15 $label winner'
    );
    select pg_catalog.pg_advisory_xact_lock($marker);
    select pg_catalog.pg_sleep(5);
    commit;
  " >"$temporary_directory/${label}-winner.log" 2>&1 &
  reservation_pid=$!
  wait_for_marker

  set +e
  "$supabase_cli" db query --linked "
    begin;
    set local statement_timeout = '30s';
    select set_config('request.jwt.claim.sub', '$staff_id', true);
    set local role authenticated;
    select public.moderate_event(
      '$event_id', '$revision', '$digest', '$version',
      '$action', '$reason', 'Task 15 $label stale contender'
    );
    commit;
  " >"$temporary_directory/${label}-contender.log" 2>&1
  contender_status=$?
  wait "$reservation_pid"
  winner_status=$?
  reservation_pid=""
  set -e

  if [[ $winner_status -ne 0 || $contender_status -eq 0 ]] ||
     ! rg -q 'MODERATION_CONFLICT' "$temporary_directory/${label}-contender.log"; then
    sanitize_log "$temporary_directory/${label}-winner.log"
    sanitize_log "$temporary_directory/${label}-contender.log"
    return 1
  fi
}

race_staff_action restore no_violation restore-race
race_staff_action remove other remove-race

run_query final-restore-and-invariants "
  begin;
  select set_config('request.jwt.claim.sub', '$staff_id', true);
  set local role authenticated;
  do \$assert\$
  declare current_case record;
  begin
    select * into current_case from public.get_moderation_case('$event_id');
    perform public.moderate_event('$event_id', current_case.content_revision,
      current_case.input_sha256, current_case.moderation_version,
      'restore', 'no_violation', 'Task 15 repeated-cycle final restore');
  end
  \$assert\$;
  reset role;

  do \$assert\$
  begin
    if exists (
      select 1
      from (values
        ('public.moderate_event(uuid,bigint,text,bigint,text,text,text)'::regprocedure),
        ('private.transition_event_public_eligibility(uuid,boolean,uuid)'::regprocedure),
        ('public.lock_event_ticketing_operation(uuid)'::regprocedure)
      ) as routines(routine_oid)
      cross join unnest(array[
        'public.orders', 'public.order_items', 'public.tickets',
        'public.refunds', 'public.disputes', 'public.stripe_webhook_events'
      ]::text[]) as forbidden(table_name)
      where strpos(lower(pg_catalog.pg_get_functiondef(routines.routine_oid)), forbidden.table_name) > 0
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_MODERATION_PAYMENT_TABLE_TOUCH';
    end if;
    if (select count(*) from private.event_public_eligibility_intervals
        where event_id = '$event_id' and ended_at is null) <> 1
       or not private.event_has_current_public_eligibility('$event_id')
       or (select moderation_version from public.events where id = '$event_id') <> '$expected_version'::bigint + 4
       or (select count(*) from private.event_moderation_actions
           where event_id = '$event_id' and action in ('remove', 'restore')) <> 4
       or (select count(*) from public.orders
           where event_id = '$event_id' and client_request_id = '$request_id'
             and status = 'creating_checkout') <> 1 then
      raise exception using errcode = 'P0001', message = 'ASSERT_EPOCH_CYCLE_INVARIANT';
    end if;
  end
  \$assert\$;
  commit;
"

echo "Moderation epoch reservation/remove, remove/restore conflicts, and Option A preservation passed."
