#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
fixture_user="16000000-0000-4000-8000-000000000001"
fixture_event="26000000-0000-4000-8000-000000000001"
fixture_tier="36000000-0000-4000-8000-000000000001"
other_event="26000000-0000-4000-8000-000000000002"
other_tier="36000000-0000-4000-8000-000000000002"

cleanup_sql="begin;
delete from public.refunds where order_id in (select id from public.orders where organizer_id = '$fixture_user');
delete from public.disputes where order_id in (select id from public.orders where organizer_id = '$fixture_user');
delete from public.tickets where organizer_id = '$fixture_user';
delete from public.order_items where order_id in (select id from public.orders where organizer_id = '$fixture_user');
delete from public.orders where organizer_id = '$fixture_user';
delete from public.ticket_tiers where event_id in ('$fixture_event', '$other_event');
delete from public.organizer_stripe_accounts where organizer_id = '$fixture_user';
delete from public.events where id in ('$fixture_event', '$other_event');
delete from public.organizers where id = '$fixture_user';
delete from auth.users where id = '$fixture_user';
commit;"

cleanup() {
  original_exit=$?
  trap - EXIT
  set +e
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  cleanup_exit=$?
  "$supabase_cli" db query --linked "select
    (select count(*) from auth.users where id = '$fixture_user')
    + (select count(*) from public.organizers where id = '$fixture_user')
    + (select count(*) from public.events where id = '$fixture_event')
    + (select count(*) from public.events where id = '$other_event')
    + (select count(*) from public.ticket_tiers where id in ('$fixture_tier', '$other_tier'))
    + (select count(*) from public.orders where organizer_id = '$fixture_user')
    + (select count(*) from public.order_items where ticket_tier_id = '$fixture_tier')
    as residue_count;" >"$temporary_directory/residue.log" 2>&1
  residue_exit=$?
  grep -q '"residue_count": 0' "$temporary_directory/residue.log"
  residue_zero_exit=$?
  if [[ $cleanup_exit -ne 0 || $residue_exit -ne 0 || $residue_zero_exit -ne 0 ]]; then
    echo "Exact final-ticket race cleanup or zero-residue proof failed." >&2
    sed -n '1,120p' "$temporary_directory/cleanup.log" >&2
    sed -n '1,80p' "$temporary_directory/residue.log" >&2
    final_cleanup_exit=1
  else
    final_cleanup_exit=0
  fi
  rm -rf -- "$temporary_directory"
  if [[ $original_exit -ne 0 ]]; then exit "$original_exit"; fi
  exit "$final_cleanup_exit"
}

trap cleanup EXIT
"$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/pre-cleanup.log" 2>&1

"$supabase_cli" db query --linked "begin;
insert into auth.users (id, email) values ('$fixture_user', 'task16-final-ticket@example.invalid');
insert into public.organizers (id, display_name) values ('$fixture_user', 'Task 16 Final Ticket');
insert into public.events (
  id, organizer_id, title, description, category, starts_at, ends_at, venue_name,
  address_line1, city, region, postal_code, country_code, mapbox_feature_id,
  latitude, longitude, admission_type, status, published_at
) values (
  '$fixture_event', '$fixture_user', 'Task 16 Final Ticket Race',
  'A disposable event proving exactly one final ticket can be reserved.', 'community',
  now() + interval '10 days', now() + interval '10 days 2 hours', 'Race Venue',
  '1 Market Street', 'San Francisco', 'CA', '94105', 'US', 'task16.final-ticket-race',
  37.7936, -122.3958, 'paid', 'published', now()
), (
  '$other_event', '$fixture_user', 'Task 16 Mismatched Tier Event',
  'A disposable event proving mismatched event and tier identifiers stay safe.', 'community',
  now() + interval '11 days', now() + interval '11 days 2 hours', 'Mismatch Venue',
  '2 Market Street', 'San Francisco', 'CA', '94105', 'US', 'task16.mismatched-tier',
  37.7936, -122.3958, 'paid', 'published', now()
);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, quantity_total, status, sort_order
) values
  ('$fixture_tier', '$fixture_event', 'Last ticket', 3001, 1, 'active', 1),
  ('$other_tier', '$other_event', 'Other event ticket', 4500, 3, 'active', 1);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status, requirements_status,
  requirements_currently_due_count, requirements_past_due_count, last_synced_at
) values ('$fixture_user', 'acct_task16finalrace', 'active', 'active', 'clear', 0, 0, now());
commit;" >"$temporary_directory/setup.log" 2>&1

set +e
"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '$fixture_event', '$other_tier', 'Mismatch Buyer', 'mismatch@example.invalid',
  '46000000-0000-4000-8000-000000000010', repeat('c', 64)
);
commit;" >"$temporary_directory/mismatched-tier.log" 2>&1
mismatched_tier_exit=$?
"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '26000000-0000-4000-8000-000000000099', '$fixture_tier',
  'Missing Event Buyer', 'missing-event@example.invalid',
  '46000000-0000-4000-8000-000000000011', repeat('d', 64)
);
commit;" >"$temporary_directory/missing-event.log" 2>&1
missing_event_exit=$?
set -e

if [[ $mismatched_tier_exit -eq 0 || $missing_event_exit -eq 0 ]] \
  || ! grep -q 'TIER_NOT_FOUND' "$temporary_directory/mismatched-tier.log" \
  || ! grep -q 'EVENT_NOT_FOUND' "$temporary_directory/missing-event.log"; then
  echo "Mismatched event/tier reservation inputs did not return authorization-safe codes." >&2
  sed -n '1,100p' "$temporary_directory/mismatched-tier.log" >&2
  sed -n '1,100p' "$temporary_directory/missing-event.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '$fixture_event', '$fixture_tier', 'First Buyer', 'first@example.invalid',
  '46000000-0000-4000-8000-000000000001', repeat('a', 64)
);
select pg_advisory_xact_lock(916016);
select pg_sleep(8);
commit;" >"$temporary_directory/first.log" 2>&1 &
first_pid=$!

marker_ready=0
marker_deadline=$((SECONDS + 30))
while [[ $SECONDS -lt $marker_deadline ]]; do
  "$supabase_cli" db query --linked "select exists (
    select 1 from pg_catalog.pg_locks
    where locktype = 'advisory' and classid = 0 and objid = '916016'::oid and granted
  ) as marker_ready;" >"$temporary_directory/marker.log" 2>&1
  if grep -q '"marker_ready": true' "$temporary_directory/marker.log"; then marker_ready=1; break; fi
  sleep 0.25
done
if [[ $marker_ready -ne 1 ]]; then
  echo "The first final-ticket reservation did not reach its deterministic marker." >&2
  wait "$first_pid" || true
  sed -n '1,100p' "$temporary_directory/first.log" >&2
  sed -n '1,80p' "$temporary_directory/marker.log" >&2
  exit 1
fi

set +e
"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '$fixture_event', '$fixture_tier', 'Second Buyer', 'second@example.invalid',
  '46000000-0000-4000-8000-000000000002', repeat('b', 64)
);
commit;" >"$temporary_directory/second.log" 2>&1
second_exit=$?
wait "$first_pid"
first_exit=$?
set -e

if [[ $first_exit -ne 0 || $second_exit -eq 0 ]] || ! grep -q 'TIER_SOLD_OUT' "$temporary_directory/second.log"; then
  echo "Final-ticket race did not produce exactly one success and one TIER_SOLD_OUT." >&2
  sed -n '1,100p' "$temporary_directory/first.log" >&2
  sed -n '1,100p' "$temporary_directory/second.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "begin;
set local role service_role;
with retry as (
  select * from public.server_reserve_checkout(
    '$fixture_event', '$fixture_tier', 'First Buyer', 'first@example.invalid',
    '46000000-0000-4000-8000-000000000001', repeat('a', 64)
  )
)
select
  count(*) as retry_row_count,
  bool_and(
    retry.order_id = orders.id
    and retry.organizer_id = orders.organizer_id
    and retry.subtotal_minor = orders.subtotal_minor
    and retry.currency = orders.currency
    and retry.application_fee_amount_minor = orders.application_fee_amount_minor
    and retry.stripe_account_id = orders.stripe_destination_account_id
    and retry.checkout_expires_at = orders.checkout_expires_at
    and retry.existing_checkout_session_id is not distinct from orders.stripe_checkout_session_id
    and retry.integration_identifier = orders.stripe_checkout_integration_identifier
    and retry.create_request_digest = orders.stripe_checkout_request_digest
  ) as retry_snapshot_matches
from retry
join public.orders as orders on orders.id = retry.order_id;
commit;" >"$temporary_directory/retry.log" 2>&1

if ! grep -q '"retry_row_count": 1' "$temporary_directory/retry.log" \
  || ! grep -q '"retry_snapshot_matches": true' "$temporary_directory/retry.log"; then
  echo "Same-request retry did not return the one immutable reservation snapshot." >&2
  sed -n '1,120p' "$temporary_directory/retry.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "select
  count(*) as order_count,
  coalesce(sum(items.quantity), 0) as reserved_quantity,
  min(orders.platform_product_fee_minor) as fee_minor
from public.orders as orders
join public.order_items as items on items.order_id = orders.id
where orders.organizer_id = '$fixture_user';" >"$temporary_directory/result.log" 2>&1

if ! grep -q '"order_count": 1' "$temporary_directory/result.log" \
  || ! grep -q '"reserved_quantity": 1' "$temporary_directory/result.log" \
  || ! grep -q '"fee_minor": 200' "$temporary_directory/result.log"; then
  echo "Final-ticket race did not preserve one reservation with exact 5%-plus-50 fee arithmetic." >&2
  sed -n '1,100p' "$temporary_directory/result.log" >&2
  exit 1
fi

echo "Reservation retry, safe mismatch codes, final-ticket race, and exact fee passed; cleanup runs on EXIT."
