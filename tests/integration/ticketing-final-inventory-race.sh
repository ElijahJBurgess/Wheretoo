#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
cleanup_targets_file="$temporary_directory/cleanup-targets.json"
fixture_user="16000000-0000-4000-8000-000000000001"
fixture_event="26000000-0000-4000-8000-000000000001"
fixture_tier="36000000-0000-4000-8000-000000000001"
fixture_support_tier="36000000-0000-4000-8000-000000000003"
other_event="26000000-0000-4000-8000-000000000002"
other_tier="36000000-0000-4000-8000-000000000002"

assert_linked_development() {
  local project_ref
  project_ref="$(tr -d '\r\n' <"$repository_root/supabase/.temp/project-ref")"
  if [[ ! "$project_ref" =~ ^[a-z]{20}$ ]]; then
    echo "The linked project reference is missing or malformed." >&2
    return 1
  fi
  "$supabase_cli" projects list --output json >"$temporary_directory/projects.json"
  PROJECT_REF="$project_ref" PROJECTS_FILE="$temporary_directory/projects.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const projects = JSON.parse(fs.readFileSync(process.env.PROJECTS_FILE, 'utf8'))
const linked = projects.filter((project) => project.linked === true)
if (linked.length !== 1 || linked[0].id !== process.env.PROJECT_REF || linked[0].status !== 'ACTIVE_HEALTHY') process.exit(1)
NODE
  "$supabase_cli" db query --linked --output-format json \
    "select environment as policy_environment from private.organizer_policy_release_settings where singleton_id;" \
    >"$temporary_directory/environment.json"
  ENVIRONMENT_FILE="$temporary_directory/environment.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.ENVIRONMENT_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
if (row?.policy_environment !== 'development') process.exit(1)
NODE
}

capture_cleanup_targets() {
  "$supabase_cli" db query --linked --output-format json "select jsonb_build_object(
      'order_ids', coalesce((select jsonb_agg(id order by id) from public.orders where organizer_id = '$fixture_user'::uuid), '[]'::jsonb)
    ) as targets;" >"$temporary_directory/cleanup-targets-read.json"
  CLEANUP_TARGETS_READ_FILE="$temporary_directory/cleanup-targets-read.json" \
  CLEANUP_TARGETS_FILE="$cleanup_targets_file" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.CLEANUP_TARGETS_READ_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
const targets = row?.targets
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
if (!targets || !Array.isArray(targets.order_ids) || targets.order_ids.some((id) => typeof id !== 'string' || !uuid.test(id))) process.exit(1)
fs.writeFileSync(process.env.CLEANUP_TARGETS_FILE, JSON.stringify(targets), { mode: 0o600 })
NODE
  chmod 600 "$cleanup_targets_file"
}

load_order_ids_sql() {
  CLEANUP_TARGETS_FILE="$cleanup_targets_file" node --input-type=module <<'NODE'
import fs from 'node:fs'
const { order_ids: ids } = JSON.parse(fs.readFileSync(process.env.CLEANUP_TARGETS_FILE, 'utf8'))
process.stdout.write(ids.length === 0 ? 'array[]::uuid[]' : `array[${ids.map((id) => `'${id}'::uuid`).join(',')}]`)
NODE
}

build_cleanup_sql() {
  printf '%s\n' "begin;
set local session_replication_role = replica;
delete from public.refunds where order_id = any($order_ids_sql);
delete from public.disputes where order_id = any($order_ids_sql);
delete from public.tickets where organizer_id = '$fixture_user';
delete from public.order_items where order_id = any($order_ids_sql) or ticket_tier_id in ('$fixture_tier', '$fixture_support_tier', '$other_tier');
delete from public.orders where id = any($order_ids_sql);
delete from public.ticket_tiers where event_id in ('$fixture_event', '$other_event');
delete from public.organizer_stripe_accounts where organizer_id = '$fixture_user';
delete from private.event_public_eligibility_intervals where event_id in ('$fixture_event', '$other_event');
delete from private.event_reports where event_id in ('$fixture_event', '$other_event');
delete from private.moderation_review_requests where event_id in ('$fixture_event', '$other_event');
delete from private.event_moderation_evaluations where event_id in ('$fixture_event', '$other_event');
delete from private.event_moderation_actions where event_id in ('$fixture_event', '$other_event');
delete from private.event_policy_acceptances where event_id in ('$fixture_event', '$other_event');
delete from private.event_policy_legacy_exemptions where event_id in ('$fixture_event', '$other_event');
delete from private.event_legacy_history_resolutions where event_id in ('$fixture_event', '$other_event');
delete from private.event_risk_disclosures where event_id in ('$fixture_event', '$other_event');
delete from public.events where id in ('$fixture_event', '$other_event');
delete from public.organizers where id = '$fixture_user';
delete from auth.users where id = '$fixture_user';
commit;"
}

prepare_cleanup_targets() {
  capture_cleanup_targets
  capture_targets_exit=$?
  order_ids_sql="array[]::uuid[]"
  if [[ $capture_targets_exit -eq 0 ]]; then
    order_ids_sql="$(load_order_ids_sql)"
  fi
  return "$capture_targets_exit"
}

cleanup() {
  original_exit=$?
  trap - EXIT
  set +e
  prepare_cleanup_targets
  capture_targets_exit=$?
  "$supabase_cli" db query --linked "$(build_cleanup_sql)" >"$temporary_directory/cleanup.log" 2>&1
  cleanup_exit=$?
  "$supabase_cli" db query --linked "select
    (select count(*) from auth.users where id = '$fixture_user')
    + (select count(*) from public.organizers where id = '$fixture_user')
    + (select count(*) from public.events where id = '$fixture_event')
    + (select count(*) from public.events where id = '$other_event')
    + (select count(*) from public.ticket_tiers where id in ('$fixture_tier', '$fixture_support_tier', '$other_tier'))
    + (select count(*) from public.orders where id = any($order_ids_sql))
    + (select count(*) from public.order_items where order_id = any($order_ids_sql) or ticket_tier_id in ('$fixture_tier', '$fixture_support_tier', '$other_tier'))
    + (select count(*) from public.tickets where organizer_id = '$fixture_user')
    + (select count(*) from public.refunds where order_id = any($order_ids_sql))
    + (select count(*) from public.disputes where order_id = any($order_ids_sql))
    + (select count(*) from public.organizer_stripe_accounts where organizer_id = '$fixture_user')
    + (select count(*) from private.event_public_eligibility_intervals where event_id in ('$fixture_event', '$other_event'))
    + (select count(*) from private.event_reports where event_id in ('$fixture_event', '$other_event'))
    + (select count(*) from private.moderation_review_requests where event_id in ('$fixture_event', '$other_event'))
    + (select count(*) from private.event_moderation_evaluations where event_id in ('$fixture_event', '$other_event'))
    + (select count(*) from private.event_moderation_actions where event_id in ('$fixture_event', '$other_event'))
    + (select count(*) from private.event_policy_acceptances where event_id in ('$fixture_event', '$other_event'))
    + (select count(*) from private.event_policy_legacy_exemptions where event_id in ('$fixture_event', '$other_event'))
    + (select count(*) from private.event_legacy_history_resolutions where event_id in ('$fixture_event', '$other_event'))
    + (select count(*) from private.event_risk_disclosures where event_id in ('$fixture_event', '$other_event'))
    as residue_count;" >"$temporary_directory/residue.log" 2>&1
  residue_exit=$?
  grep -q '"residue_count": 0' "$temporary_directory/residue.log"
  residue_zero_exit=$?
  if [[ $capture_targets_exit -ne 0 || $cleanup_exit -ne 0 || $residue_exit -ne 0 || $residue_zero_exit -ne 0 ]]; then
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

if [[ ! -x "$supabase_cli" ]]; then
  echo "Supabase CLI is not installed at the project-local path." >&2
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  exit 1
fi
chmod 700 "$temporary_directory"
if ! assert_linked_development; then
  echo "Direct linked fixture runner requires one ACTIVE_HEALTHY development project." >&2
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  exit 1
fi
if [[ "${WHERETO_TEST_GATE_ONLY:-}" == "1" ]]; then
  echo "Linked development gate passed without mutation."
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  exit 0
fi

trap cleanup EXIT
prepare_cleanup_targets
"$supabase_cli" db query --linked "$(build_cleanup_sql)" >"$temporary_directory/pre-cleanup.log" 2>&1

"$supabase_cli" db query --linked "begin;
insert into auth.users (id, email) values ('$fixture_user', 'task16-final-ticket@example.invalid');
insert into public.organizers (id, display_name) values ('$fixture_user', 'Task 16 Final Ticket');
insert into public.events (
  id, organizer_id, title, description, category, starts_at, ends_at, venue_name,
  timezone, address_line1, city, region, postal_code, country_code, mapbox_feature_id,
  latitude, longitude, admission_type, status
) values (
  '$fixture_event', '$fixture_user', 'Task 16 Final Ticket Race',
  'A disposable event proving exactly one final ticket can be reserved.', 'community',
  now() + interval '10 days', now() + interval '10 days 2 hours', 'Race Venue', 'America/Los_Angeles',
  '1 Market Street', 'San Francisco', 'CA', '94105', 'US', 'task16.final-ticket-race',
  37.7936, -122.3958, 'paid', 'draft'
), (
  '$other_event', '$fixture_user', 'Task 16 Mismatched Tier Event',
  'A disposable event proving mismatched event and tier identifiers stay safe.', 'community',
  now() + interval '11 days', now() + interval '11 days 2 hours', 'Mismatch Venue', 'America/Los_Angeles',
  '2 Market Street', 'San Francisco', 'CA', '94105', 'US', 'task16.mismatched-tier',
  37.7936, -122.3958, 'paid', 'draft'
);
insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values
  ('$fixture_event', 'all_ages', false, false, false, false, false, false),
  ('$other_event', 'all_ages', false, false, false, false, false, false);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, quantity_total, status, sort_order
) values
  ('$fixture_tier', '$fixture_event', 'Last ticket', 3001, 1, 'active', 1),
  ('$fixture_support_tier', '$fixture_event', 'Supporting ticket', 2000, 2, 'active', 2),
  ('$other_tier', '$other_event', 'Other event ticket', 4500, 3, 'active', 1);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status, requirements_status,
  requirements_currently_due_count, requirements_past_due_count, last_synced_at
) values ('$fixture_user', 'acct_task16finalrace', 'active', 'active', 'clear', 0, 0, now());
select set_config('request.jwt.claim.sub', '$fixture_user', true);
set local role authenticated;
select public.accept_current_event_policies('$fixture_event');
select public.publish_event('$fixture_event');
reset role;
commit;" >"$temporary_directory/setup.log" 2>&1

set +e
"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '$fixture_event', jsonb_build_array(jsonb_build_object('tier_id', '$other_tier', 'quantity', 1)), 'Mismatch Buyer', 'mismatch@example.invalid',
  '46000000-0000-4000-8000-000000000010', repeat('c', 64)
);
commit;" >"$temporary_directory/mismatched-tier.log" 2>&1
mismatched_tier_exit=$?
"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '26000000-0000-4000-8000-000000000099', jsonb_build_array(jsonb_build_object('tier_id', '$fixture_tier', 'quantity', 1)),
  'Missing Event Buyer', 'missing-event@example.invalid',
  '46000000-0000-4000-8000-000000000011', repeat('d', 64)
);
commit;" >"$temporary_directory/missing-event.log" 2>&1
missing_event_exit=$?
"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '$fixture_event', jsonb_build_array(jsonb_build_object('tier_id', '$fixture_tier', 'quantity', 11)),
  'Overflow Buyer', 'overflow@example.invalid',
  '46000000-0000-4000-8000-000000000012', repeat('f', 64)
);
commit;" >"$temporary_directory/admission-overflow.log" 2>&1
admission_overflow_exit=$?
set -e

if [[ $mismatched_tier_exit -eq 0 || $missing_event_exit -eq 0 || $admission_overflow_exit -eq 0 ]] \
  || ! grep -q 'TIER_NOT_ACTIVE' "$temporary_directory/mismatched-tier.log" \
  || ! grep -q 'EVENT_NOT_SELLABLE' "$temporary_directory/missing-event.log" \
  || ! grep -q 'CHECKOUT_INPUT_INVALID' "$temporary_directory/admission-overflow.log"; then
  echo "Mismatched, missing, or over-ten-admission cart inputs did not return safe codes." >&2
  sed -n '1,100p' "$temporary_directory/mismatched-tier.log" >&2
  sed -n '1,100p' "$temporary_directory/missing-event.log" >&2
  sed -n '1,100p' "$temporary_directory/admission-overflow.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '$fixture_event', jsonb_build_array(
    jsonb_build_object('tier_id', '$fixture_tier', 'quantity', 1),
    jsonb_build_object('tier_id', '$fixture_support_tier', 'quantity', 2)
  ), 'First Buyer', 'first@example.invalid',
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
  '$fixture_event', jsonb_build_array(
    jsonb_build_object('tier_id', '$fixture_tier', 'quantity', 1),
    jsonb_build_object('tier_id', '$fixture_support_tier', 'quantity', 2)
  ), 'Second Buyer', 'second@example.invalid',
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
    '$fixture_event', jsonb_build_array(
      jsonb_build_object('tier_id', '$fixture_tier', 'quantity', 1),
      jsonb_build_object('tier_id', '$fixture_support_tier', 'quantity', 2)
    ), 'First Buyer', 'first@example.invalid',
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
    and retry.order_items = (
      select jsonb_agg(jsonb_build_object(
        'order_item_id', items.id, 'ticket_tier_id', items.ticket_tier_id,
        'tier_name', items.tier_name, 'unit_amount_minor', items.unit_amount_minor,
        'quantity', items.quantity, 'subtotal_minor', items.subtotal_minor,
        'currency', items.currency
      ) order by items.ticket_tier_id)
      from public.order_items as items where items.order_id = orders.id
    )
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
  count(distinct orders.id) as order_count,
  coalesce(sum(items.quantity), 0) as reserved_quantity,
  min(orders.platform_product_fee_minor) as fee_minor
from public.orders as orders
join public.order_items as items on items.order_id = orders.id
where orders.organizer_id = '$fixture_user';" >"$temporary_directory/result.log" 2>&1

if ! grep -q '"order_count": 1' "$temporary_directory/result.log" \
  || ! grep -q '"reserved_quantity": 3' "$temporary_directory/result.log" \
  || ! grep -q '"fee_minor": 500' "$temporary_directory/result.log"; then
  echo "Final-ticket race did not preserve one reservation with exact 5%-plus-50 fee arithmetic." >&2
  sed -n '1,100p' "$temporary_directory/result.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "begin;
update public.ticket_tiers
set name = 'Mutated after reservation', unit_amount_minor = 1
where id = '$fixture_support_tier';
update public.orders
set status = 'requires_review'
where organizer_id = '$fixture_user' and client_request_id = '46000000-0000-4000-8000-000000000001';
select
  count(*) as item_count,
  sum(quantity) as admission_count,
  bool_and(
    (ticket_tier_id = '$fixture_tier' and tier_name = 'Last ticket' and unit_amount_minor = 3001 and quantity = 1 and subtotal_minor = 3001)
    or (ticket_tier_id = '$fixture_support_tier' and tier_name = 'Supporting ticket' and unit_amount_minor = 2000 and quantity = 2 and subtotal_minor = 4000)
  ) as immutable_item_snapshots
from public.order_items
where order_id = (select id from public.orders where organizer_id = '$fixture_user' and client_request_id = '46000000-0000-4000-8000-000000000001');
commit;" >"$temporary_directory/snapshot.log" 2>&1

if ! grep -q '"item_count": 2' "$temporary_directory/snapshot.log" \
  || ! grep -q '"admission_count": 3' "$temporary_directory/snapshot.log" \
  || ! grep -q '"immutable_item_snapshots": true' "$temporary_directory/snapshot.log"; then
  echo "Two-item three-admission order did not retain immutable purchase snapshots." >&2
  sed -n '1,120p' "$temporary_directory/snapshot.log" >&2
  exit 1
fi

set +e
"$supabase_cli" db query --linked "begin;
set local role service_role;
select * from public.server_reserve_checkout(
  '$fixture_event', jsonb_build_array(jsonb_build_object('tier_id', '$fixture_support_tier', 'quantity', 1)),
  'Review Inventory Buyer', 'review-inventory@example.invalid',
  '46000000-0000-4000-8000-000000000003', repeat('e', 64)
);
commit;" >"$temporary_directory/review-inventory.log" 2>&1
review_inventory_exit=$?
set -e
if [[ $review_inventory_exit -eq 0 ]] || ! grep -q 'TIER_SOLD_OUT' "$temporary_directory/review-inventory.log"; then
  echo "Requires-review admissions did not continue to count against tier inventory." >&2
  sed -n '1,100p' "$temporary_directory/review-inventory.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "begin;
update public.orders
set status = 'checkout_open', reservation_expires_at = clock_timestamp() - interval '1 second'
where organizer_id = '$fixture_user' and client_request_id = '46000000-0000-4000-8000-000000000001';
do \$assert\$
begin
  if public.server_expire_checkout_reservations(clock_timestamp()) <> 1 then
    raise exception using errcode = 'P0001', message = 'ASSERT_TIMESTAMP_EXPIRY_COUNT';
  end if;
end
\$assert\$;
select status = 'expired' and expired_at is not null as timestamp_expiry_authoritative
from public.orders
where organizer_id = '$fixture_user' and client_request_id = '46000000-0000-4000-8000-000000000001';
commit;" >"$temporary_directory/expiry.log" 2>&1
if ! grep -q '"timestamp_expiry_authoritative": true' "$temporary_directory/expiry.log"; then
  echo "Checkout expiry was not driven by the persisted reservation timestamp." >&2
  sed -n '1,120p' "$temporary_directory/expiry.log" >&2
  exit 1
fi

echo "Two-item three-admission snapshots, review inventory, timestamp expiry, final-ticket race, and exact fee passed; cleanup runs on EXIT."
