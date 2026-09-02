#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
run_id="$(openssl rand -hex 10)"
blocker_pid=""
reservation_pid=""
disable_pid=""

new_uuid() {
  node -e "console.log(require('node:crypto').randomUUID())"
}

owner_id="$(new_uuid)"
event_id="$(new_uuid)"
tier_id="$(new_uuid)"
request_id="$(new_uuid)"
blocker_application="whereto_task1_blocker_${run_id}"
reservation_application="whereto_task1_reservation_${run_id}"
disable_application="whereto_task1_disable_${run_id}"

if [[ ! -x "$supabase_cli" ]]; then
  printf '%s\n' 'Supabase CLI is not installed at the project-local path.' >&2
  exit 1
fi

chmod 700 "$temporary_directory"

sanitize_log() {
  rg -o 'ERROR: +[0-9A-Z]+|ASSERT_[A-Z0-9_]+|CHECKOUT_[A-Z_]+' "$1" \
    | head -n 8 >&2 || true
}

run_query() {
  local phase="$1"
  local sql="$2"
  local log_file="$temporary_directory/${phase}.log"

  if ! "$supabase_cli" db query --linked "$sql" >"$log_file" 2>&1; then
    printf 'Task 1 kill-switch concurrency phase failed: %s\n' "$phase" >&2
    sanitize_log "$log_file"
    return 1
  fi
}

query_succeeds_quietly() {
  local phase="$1"
  local sql="$2"

  "$supabase_cli" db query --linked "$sql" \
    >"$temporary_directory/${phase}.log" 2>&1
}

cleanup_sql="begin;
set local session_replication_role = replica;
update private.checkout_runtime_control
set checkout_creation_enabled = false,
    updated_at = pg_catalog.statement_timestamp()
where singleton;
delete from public.order_items where order_id in (
  select id from public.orders where event_id = '$event_id'::uuid
);
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
delete from public.events where id = '$event_id'::uuid;
delete from public.organizers where id = '$owner_id'::uuid;
delete from auth.users where id = '$owner_id'::uuid;
commit;"

cleanup() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT
  set +e

  [[ -n "$blocker_pid" ]] && wait "$blocker_pid"
  [[ -n "$reservation_pid" ]] && wait "$reservation_pid"
  [[ -n "$disable_pid" ]] && wait "$disable_pid"

  "$supabase_cli" db query --linked "$cleanup_sql" \
    >"$temporary_directory/cleanup.log" 2>&1
  cleanup_status=$?

  if [[ $cleanup_status -eq 0 ]]; then
    "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if (select checkout_creation_enabled
            from private.checkout_runtime_control where singleton)
           or exists (select 1 from auth.users where id = '$owner_id')
           or exists (select 1 from public.events where id = '$event_id')
           or exists (select 1 from public.orders where event_id = '$event_id') then
          raise exception using
            errcode = 'P0001', message = 'ASSERT_KILL_SWITCH_CLEANUP_RESIDUE';
        end if;
      end
      \$assert\$;
    " >"$temporary_directory/residue.log" 2>&1
    cleanup_status=$?
  fi

  if [[ $cleanup_status -ne 0 ]]; then
    sanitize_log "$temporary_directory/cleanup.log"
    [[ -f "$temporary_directory/residue.log" ]] \
      && sanitize_log "$temporary_directory/residue.log"
  fi

  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"

  if [[ $original_status -ne 0 ]]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT

wait_for_activity_lock() {
  local application_name="$1"
  local granted="$2"
  local phase="$3"
  local deadline=$((SECONDS + 45))

  while (( SECONDS < deadline )); do
    if query_succeeds_quietly "$phase" "
      do \$assert\$
      begin
        if not exists (
          select 1
          from pg_catalog.pg_stat_activity as activity
          join pg_catalog.pg_locks as locks on locks.pid = activity.pid
          where activity.application_name = '$application_name'
            and locks.locktype = 'advisory'
            and locks.granted is $granted
        ) then
          raise exception using
            errcode = 'P0001', message = 'ASSERT_EXPECTED_ADVISORY_LOCK_NOT_READY';
        end if;
      end
      \$assert\$;
    "; then
      return 0
    fi
    sleep 0.2
  done

  return 1
}

run_query preflight "
  do \$assert\$
  begin
    if not exists (
      select 1
      from private.organizer_policy_release_settings
      where singleton_id and environment = 'development'
    ) then
      raise exception using
        errcode = 'P0001', message = 'ASSERT_LINKED_PROJECT_NOT_DEVELOPMENT';
    end if;
    if (select checkout_creation_enabled
        from private.checkout_runtime_control where singleton) then
      raise exception using
        errcode = 'P0001', message = 'ASSERT_CHECKOUT_CREATION_NOT_DISABLED';
    end if;
    if exists (select 1 from public.orders where livemode) then
      raise exception using
        errcode = 'P0001', message = 'ASSERT_LIVE_ORDER_PRESENT';
    end if;
  end
  \$assert\$;
"

run_query setup "
  begin;
  insert into auth.users (id, email)
  values ('$owner_id', 'whereto-task1-owner-${run_id}@example.invalid');
  insert into public.organizers (
    id, display_name, organizer_type, base_city, country_code,
    onboarding_completed_at
  ) values (
    '$owner_id', 'WHERETO_TASK1_KILL_SWITCH_${run_id}', 'Community group',
    'San Francisco', 'US', pg_catalog.statement_timestamp()
  );
  insert into public.organizer_stripe_accounts (
    organizer_id, stripe_account_id, transfers_status, payouts_status,
    requirements_status, requirements_currently_due_count,
    requirements_past_due_count, last_synced_at
  ) values (
    '$owner_id', 'acct_task1${run_id}', 'active', 'active', 'clear', 0, 0,
    pg_catalog.statement_timestamp()
  );
  insert into public.events (
    id, organizer_id, title, description, category, starts_at, ends_at,
    timezone, venue_name, address_line1, city, region, postal_code,
    country_code, mapbox_feature_id, latitude, longitude, admission_type,
    capacity
  ) values (
    '$event_id', '$owner_id', 'WHERETO_TASK1_KILL_SWITCH_${run_id}',
    'A database-only fixture for checkout kill-switch serialization.',
    'community', pg_catalog.statement_timestamp() + interval '2 days',
    pg_catalog.statement_timestamp() + interval '2 days 2 hours',
    'America/Los_Angeles', 'Integrity Hall', '1 Market Street',
    'San Francisco', 'CA', '94105', 'US',
    'mapbox.task1.kill-switch.${run_id}', 37.7936, -122.3958, 'paid', 20
  );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present,
    explicit_adult_content, gambling_present, weapons_present,
    high_risk_activity
  ) values (
    '$event_id', 'all_ages', false, false, false, false, false, false
  );
  insert into public.ticket_tiers (
    id, event_id, name, description, unit_amount_minor, currency,
    quantity_total, status, sort_order
  ) values (
    '$tier_id', '$event_id', 'General admission',
    'Task 1 database-only tier', 2000, 'usd', 20, 'draft', 1
  );
  select set_config('request.jwt.claim.sub', '$owner_id', true);
  set local role authenticated;
  select public.accept_current_event_policies('$event_id');
  select public.publish_event('$event_id');
  reset role;
  update private.checkout_runtime_control
  set checkout_creation_enabled = true,
      updated_at = pg_catalog.statement_timestamp()
  where singleton;
  commit;
"

"$supabase_cli" db query --linked "
  begin;
  set local application_name = '$blocker_application';
  set local statement_timeout = '30s';
  select public.lock_event_ticketing_operation('$event_id');
  select pg_catalog.pg_sleep(20);
  commit;
" >"$temporary_directory/blocker.log" 2>&1 &
blocker_pid=$!

wait_for_activity_lock "$blocker_application" true blocker-ready

"$supabase_cli" db query --linked "
  begin;
  set local application_name = '$reservation_application';
  set local statement_timeout = '30s';
  set local role service_role;
  select * from public.server_reserve_checkout(
    '$event_id', '$tier_id', 'Task 1 Buyer',
    'whereto-task1-buyer-${run_id}@example.invalid', '$request_id',
    repeat('a', 64)
  );
  commit;
" >"$temporary_directory/reservation.log" 2>&1 &
reservation_pid=$!

wait_for_activity_lock "$reservation_application" false reservation-waiting

"$supabase_cli" db query --linked "
  begin;
  set local application_name = '$disable_application';
  set local statement_timeout = '30s';
  update private.checkout_runtime_control
  set checkout_creation_enabled = false,
      updated_at = pg_catalog.statement_timestamp()
  where singleton;
  commit;
" >"$temporary_directory/disable.log" 2>&1 &
disable_pid=$!

disable_waiting=false
deadline=$((SECONDS + 12))
while (( SECONDS < deadline )); do
  if ! kill -0 "$disable_pid" 2>/dev/null; then
    break
  fi
  if query_succeeds_quietly disable-waiting "
    do \$assert\$
    begin
      if not exists (
        select 1 from pg_catalog.pg_stat_activity
        where application_name = '$disable_application'
          and wait_event_type = 'Lock'
      ) then
        raise exception using
          errcode = 'P0001', message = 'ASSERT_DISABLE_NOT_WAITING';
      end if;
    end
    \$assert\$;
  "; then
    disable_waiting=true
    break
  fi
  sleep 0.2
done

if [[ "$disable_waiting" != true ]]; then
  printf '%s\n' 'ASSERT_SWITCH_UPDATE_NOT_SERIALIZED' >&2
  sanitize_log "$temporary_directory/disable.log"
  exit 1
fi

wait "$blocker_pid"
blocker_pid=""
wait "$reservation_pid"
reservation_pid=""
wait "$disable_pid"
disable_pid=""

run_query verify "
  do \$assert\$
  begin
    if (select checkout_creation_enabled
        from private.checkout_runtime_control where singleton) then
      raise exception using
        errcode = 'P0001', message = 'ASSERT_SWITCH_NOT_DISABLED';
    end if;
    if (select count(*) from public.orders
        where event_id = '$event_id' and client_request_id = '$request_id') <> 1 then
      raise exception using
        errcode = 'P0001', message = 'ASSERT_ADMITTED_ORDER_NOT_SINGULAR';
    end if;
  end
  \$assert\$;
"

printf '%s\n' 'Checkout kill-switch admission serialization passed.'
