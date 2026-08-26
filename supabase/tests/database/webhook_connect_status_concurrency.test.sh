#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"

cleanup_sql="begin;
delete from public.organizer_stripe_accounts
where organizer_id = '19000000-0000-4000-8000-000000000002'::uuid;
delete from public.organizers where id = '19000000-0000-4000-8000-000000000002'::uuid;
delete from auth.users where id = '19000000-0000-4000-8000-000000000002'::uuid;
commit;"

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  cleanup_status=$?
  if [[ $cleanup_status -ne 0 ]]; then
    echo "Webhook Connect CAS fixture cleanup failed." >&2
    sed -n '1,120p' "$temporary_directory/cleanup.log" >&2
  fi
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  if [[ $original_status -ne 0 ]]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}

trap cleanup EXIT

"$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/pre-cleanup.log" 2>&1
"$supabase_cli" db query --linked "begin;
insert into auth.users (id, email) values (
  '19000000-0000-4000-8000-000000000002',
  'webhook-connect-concurrency@example.invalid'
);
insert into public.organizers (id, display_name) values (
  '19000000-0000-4000-8000-000000000002',
  'Webhook Connect Concurrency'
);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  '19000000-0000-4000-8000-000000000002',
  'acct_WebhookConnectConcurrency',
  'pending', 'pending', 'pending', 1, 0, statement_timestamp()
);
commit;" >"$temporary_directory/setup.log" 2>&1

"$supabase_cli" db query --linked "begin;
select pg_advisory_xact_lock(918503);
select pg_sleep(6);
set local role service_role;
select public.server_persist_connect_status_if_current(
  'acct_WebhookConnectConcurrency', '2099-08-26 05:00:00+00', 'evt_OldReadyRace',
  'active', 'active', 'clear', 0, 0, null
);
commit;" >"$temporary_directory/older-ready.log" 2>&1 &
older_pid=$!

for _attempt in 1 2 3 4 5 6 7 8; do
  "$supabase_cli" db query --linked "
    select exists (
      select 1 from pg_catalog.pg_locks
      where locktype = 'advisory' and classid = 0 and objid = '918503'::oid and granted
    ) as marker_ready;
  " >"$temporary_directory/marker.log" 2>&1
  if grep -q '\"marker_ready\": true' "$temporary_directory/marker.log"; then
    break
  fi
done

if ! grep -q '\"marker_ready\": true' "$temporary_directory/marker.log"; then
  echo "Connect CAS race did not reach its deterministic marker." >&2
  exit 1
fi

"$supabase_cli" db query --linked "begin;
set local role service_role;
select public.server_persist_connect_status_if_current(
  'acct_WebhookConnectConcurrency', '2099-08-26 05:01:00+00',
  'evt_NewerRestrictedRace', 'restricted', 'restricted', 'restricted',
  2, 1, 'STRIPE_REQUIREMENTS_PAST_DUE'
);
commit;" >"$temporary_directory/newer-restricted.log" 2>&1

wait "$older_pid"

if ! grep -q '\"server_persist_connect_status_if_current\": \"updated\"' \
  "$temporary_directory/newer-restricted.log" \
  || ! grep -q '\"server_persist_connect_status_if_current\": \"stale\"' \
    "$temporary_directory/older-ready.log"; then
  echo "Connect CAS did not classify the newer and stale responses correctly." >&2
  exit 1
fi

"$supabase_cli" db query --linked "
select transfers_status, payouts_status, requirements_status,
  requirements_currently_due_count, requirements_past_due_count,
  last_sync_revision
from public.organizer_stripe_accounts
where stripe_account_id = 'acct_WebhookConnectConcurrency';
" >"$temporary_directory/result.log" 2>&1

if ! grep -q '\"transfers_status\": \"restricted\"' "$temporary_directory/result.log" \
  || ! grep -q '\"payouts_status\": \"restricted\"' "$temporary_directory/result.log" \
  || ! grep -q '\"requirements_status\": \"restricted\"' "$temporary_directory/result.log" \
  || ! grep -q '\"last_sync_revision\": \"evt_NewerRestrictedRace\"' \
    "$temporary_directory/result.log"; then
  echo "Late stale-ready response overwrote newer restricted Connect truth." >&2
  exit 1
fi

echo "newer restricted Connect truth won over a later stale-ready response"
