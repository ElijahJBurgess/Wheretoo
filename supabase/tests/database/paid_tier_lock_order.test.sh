#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"

if [[ ! -x "$supabase_cli" ]]; then
  echo "Supabase CLI is not installed at the project-local path." >&2
  exit 1
fi

cleanup_sql="begin;
delete from public.organizer_stripe_accounts where organizer_id = '14000000-0000-0000-0000-000000000001'::uuid;
delete from public.ticket_tiers where id in (
  '34000000-0000-4000-8000-000000000001'::uuid,
  '34000000-0000-4000-8000-000000000002'::uuid
);
delete from public.events where id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid
);
delete from public.organizers where id = '14000000-0000-0000-0000-000000000001'::uuid;
delete from auth.users where id = '14000000-0000-0000-0000-000000000001'::uuid;
commit;"

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  cleanup_status=$?
  if [[ $cleanup_status -ne 0 ]]; then
    echo "Exact lock-order fixture cleanup failed." >&2
    sed -n '1,120p' "$temporary_directory/cleanup.log" >&2
  fi
  rm -rf -- "$temporary_directory"
  if [[ $original_status -ne 0 ]]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}

trap cleanup EXIT

"$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/pre-cleanup.log" 2>&1

"$supabase_cli" db query --linked "begin;
insert into auth.users (id, email) values (
  '14000000-0000-0000-0000-000000000001',
  'paid-tier-lock-order@example.invalid'
);
insert into public.organizers (id, display_name) values (
  '14000000-0000-0000-0000-000000000001',
  'Paid Tier Lock Order'
);
insert into public.events (id, organizer_id, title) values (
  '24000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  'Concurrent Save Event'
);
insert into public.events (
  id, organizer_id, title, description, category, starts_at, ends_at, venue_name,
  address_line1, city, region, postal_code, country_code, mapbox_feature_id,
  latitude, longitude, admission_type
) values (
  '24000000-0000-0000-0000-000000000002',
  '14000000-0000-0000-0000-000000000001',
  'Concurrent Activation Event',
  'A complete event used to verify paid tier lock ordering.',
  'community',
  now() + interval '2 days',
  now() + interval '2 days 2 hours',
  'Concurrency Venue',
  '1 Market Street',
  'San Francisco',
  'CA',
  '94105',
  'US',
  'mapbox.concurrent-paid-tier-lock-order',
  37.7936,
  -122.3958,
  'free'
);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, quantity_total, status, sort_order
) values
  (
    '34000000-0000-4000-8000-000000000001',
    '24000000-0000-0000-0000-000000000001',
    'Save Tier', 2000, 10, 'draft', 1
  ),
  (
    '34000000-0000-4000-8000-000000000002',
    '24000000-0000-0000-0000-000000000002',
    'Activation Tier', 2500, 10, 'draft', 1
  );
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  '14000000-0000-0000-0000-000000000001',
  'acct_paidtierlockorder',
  'active', 'active', 'clear', 0, 0, now()
);
commit;" >"$temporary_directory/setup.log" 2>&1

run_lock_order_case() {
  case_name="$1"
  tier_id="$2"
  event_id="$3"
  operation_sql="$4"

  "$supabase_cli" db query --linked "begin;
  set local statement_timeout = '20s';
  select id from public.ticket_tiers where id = '$tier_id'::uuid for update;
  select pg_sleep(8);
  select id from public.events where id = '$event_id'::uuid for update;
  commit;" >"$temporary_directory/${case_name}-checkout-order.log" 2>&1 &
  checkout_order_pid=$!

  sleep 0.4

  set +e
  "$supabase_cli" db query --linked "$operation_sql" >"$temporary_directory/${case_name}-operation.log" 2>&1
  operation_status=$?
  wait "$checkout_order_pid"
  checkout_order_status=$?
  set -e

  if [[ $operation_status -ne 0 || $checkout_order_status -ne 0 ]]; then
    echo "$case_name encountered a deadlock or timeout under tier-then-event contention." >&2
    sed -n '1,160p' "$temporary_directory/${case_name}-checkout-order.log" >&2
    sed -n '1,160p' "$temporary_directory/${case_name}-operation.log" >&2
    return 1
  fi

  echo "$case_name completed without deadlock"
}

failure_count=0

run_lock_order_case \
  "save-ticket-tiers" \
  "34000000-0000-4000-8000-000000000001" \
  "24000000-0000-0000-0000-000000000001" \
  "begin;
   set local statement_timeout = '20s';
   select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);
   set local role authenticated;
   select count(*) from public.save_ticket_tiers(
     '24000000-0000-0000-0000-000000000001',
     '[{\"id\":\"34000000-0000-4000-8000-000000000001\",\"name\":\"Save Tier\",\"unit_amount_minor\":2000,\"currency\":\"usd\",\"quantity_total\":10,\"sort_order\":1}]'::jsonb
   );
   commit;" || failure_count=$((failure_count + 1))

run_lock_order_case \
  "activate-paid-sales" \
  "34000000-0000-4000-8000-000000000002" \
  "24000000-0000-0000-0000-000000000002" \
  "begin;
   set local statement_timeout = '20s';
   select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);
   set local role authenticated;
   select (public.activate_paid_sales('24000000-0000-0000-0000-000000000002')).id;
   commit;" || failure_count=$((failure_count + 1))

if [[ $failure_count -ne 0 ]]; then
  exit 1
fi
