#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"

if [[ ! -x "$supabase_cli" ]]; then
  echo "Supabase CLI is not installed at the project-local path." >&2
  exit 1
fi

fixture_organizer='97000000-0000-4000-8000-000000000001'
fixture_event='97100000-0000-4000-8000-000000000001'
fixture_lost_event='97100000-0000-4000-8000-000000000002'

cleanup_sql="begin;
set local session_replication_role = replica;
delete from public.tickets where organizer_id = '$fixture_organizer'::uuid;
delete from public.order_items where order_id in (select id from public.orders where organizer_id = '$fixture_organizer'::uuid);
delete from public.orders where organizer_id = '$fixture_organizer'::uuid;
delete from public.ticket_tiers where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
update public.events
set publicly_authorized_revision = null,
    publicly_authorized_action_id = null
where id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from private.event_public_eligibility_intervals where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
update private.event_moderation_actions
set review_request_id = null
where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from private.moderation_review_requests where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from private.event_reports where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from private.event_moderation_actions where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from private.event_moderation_evaluations where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from private.event_policy_acceptances where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from private.event_policy_legacy_exemptions where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from private.event_risk_disclosures where event_id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from public.organizer_stripe_accounts where organizer_id = '$fixture_organizer'::uuid;
delete from public.events where id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
delete from public.organizers where id = '$fixture_organizer'::uuid;
delete from auth.users where id = '$fixture_organizer'::uuid;
update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;
commit;"

cleanup_verification_sql="with fixture_events(event_id) as (values
  ('$fixture_event'::uuid), ('$fixture_lost_event'::uuid)
)
select (
  (select count(*) from private.event_moderation_actions where event_id in (select event_id from fixture_events))
  + (select count(*) from private.event_moderation_evaluations where event_id in (select event_id from fixture_events))
  + (select count(*) from private.event_reports where event_id in (select event_id from fixture_events))
  + (select count(*) from private.moderation_review_requests where event_id in (select event_id from fixture_events))
  + (select count(*) from private.event_policy_legacy_exemptions where event_id in (select event_id from fixture_events))
  + (select count(*) from private.event_public_eligibility_intervals where event_id in (select event_id from fixture_events))
  + (select count(*) from private.event_policy_acceptances where event_id in (select event_id from fixture_events))
  + (select count(*) from private.event_risk_disclosures where event_id in (select event_id from fixture_events))
) as residue_count;"

cleanup() {
  original_exit=$?
  trap - EXIT
  set +e
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  cleanup_exit=$?
  if [[ $cleanup_exit -ne 0 ]]; then
    echo "Checkout integrity concurrency fixture cleanup failed." >&2
    sed -n '1,120p' "$temporary_directory/cleanup.log" >&2
  else
    "$supabase_cli" db query --linked "$cleanup_verification_sql" \
      >"$temporary_directory/cleanup-verification.log" 2>&1
    cleanup_exit=$?
    if [[ $cleanup_exit -ne 0 ]] || ! grep -q '"residue_count": 0' \
      "$temporary_directory/cleanup-verification.log"; then
      cleanup_exit=1
      echo "Checkout integrity concurrency moderation residue remains." >&2
      sed -n '1,120p' "$temporary_directory/cleanup-verification.log" >&2
    fi
  fi
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  if [[ $original_exit -ne 0 ]]; then exit "$original_exit"; fi
  exit "$cleanup_exit"
}
trap cleanup EXIT

run_query() {
  local name="$1"
  local sql="$2"
  "$supabase_cli" db query --linked "$sql" >"$temporary_directory/$name.log" 2>&1
}

wait_for_advisory_marker() {
  local marker_id="$1"
  local case_name="$2"

  for _attempt in 1 2 3 4 5 6 7 8; do
    run_query "${case_name}_marker" "select exists (
      select 1 from pg_catalog.pg_locks
      where locktype = 'advisory'
        and classid = 0
        and objid = '$marker_id'::oid
        and granted
    ) as marker_ready;"
    if grep -q '"marker_ready": true' "$temporary_directory/${case_name}_marker.log"; then
      return 0
    fi
  done

  echo "$case_name did not reach its deterministic concurrency marker." >&2
  sed -n '1,120p' "$temporary_directory/${case_name}_marker.log" >&2
  return 1
}

wait_for_session_lock() {
  local application_name="$1"
  local case_name="$2"
  local deadline=$((SECONDS + 8))

  while (( SECONDS < deadline )); do
    run_query "${case_name}_lock" "select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = '$application_name'
        and wait_event_type = 'Lock'
    ) as lock_waiting;"
    if grep -q '"lock_waiting": true' "$temporary_directory/${case_name}_lock.log"; then
      return 0
    fi
    sleep 0.2
  done

  echo "$case_name did not wait on the checkout runtime gate lock." >&2
  sed -n '1,120p' "$temporary_directory/${case_name}_lock.log" >&2
  return 1
}

"$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/pre-cleanup.log" 2>&1
run_query setup "begin;
insert into auth.users (id, email) values ('$fixture_organizer', 'checkout-integrity-concurrency@example.invalid');
insert into public.organizers (id, display_name) values ('$fixture_organizer', 'Checkout Integrity Concurrency');
insert into public.events (id, organizer_id, status, moderation_status, title, description, category, starts_at, ends_at, venue_name, address_line1, city, region, postal_code, country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at) values
('$fixture_event', '$fixture_organizer', 'published', 'clear', 'Cart Lock Event', 'A paid event used only for separate-session cart locking proofs.', 'community', now() + interval '2 days', now() + interval '2 days 2 hours', 'Lock Hall', '1 Lock Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.checkout-integrity-lock', 37.7936, -122.3958, 'paid', now()),
('$fixture_lost_event', '$fixture_organizer', 'published', 'clear', 'Eligibility Loss Event', 'A paid event used only for eligibility-loss serialization.', 'community', now() + interval '3 days', now() + interval '3 days 2 hours', 'Loss Hall', '2 Lock Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.checkout-integrity-loss', 37.7937, -122.3959, 'paid', now());
insert into public.ticket_tiers (id, event_id, name, unit_amount_minor, quantity_total, status, sort_order) values
('97200000-0000-4000-8000-000000000001', '$fixture_event', 'Final', 1000, 1, 'active', 1),
('97200000-0000-4000-8000-000000000002', '$fixture_event', 'General', 1000, 5, 'active', 2),
('97200000-0000-4000-8000-000000000003', '$fixture_event', 'VIP', 2000, 5, 'active', 3),
('97200000-0000-4000-8000-000000000004', '$fixture_lost_event', 'Loss Tier', 1000, 5, 'active', 1);
insert into public.organizer_stripe_accounts (organizer_id, stripe_account_id, transfers_status, payouts_status, requirements_status, requirements_currently_due_count, requirements_past_due_count, last_synced_at) values ('$fixture_organizer', 'acct_checkoutintegrity', 'active', 'active', 'clear', 0, 0, now());
insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
select id, 'all_ages', false, false, false, false, false, false
from public.events
where id in ('$fixture_event'::uuid, '$fixture_lost_event'::uuid);
select set_config('request.jwt.claim.sub', '$fixture_organizer', true);
set local role authenticated;
select public.accept_current_event_policies('$fixture_event'::uuid);
select public.publish_event('$fixture_event'::uuid);
select public.accept_current_event_policies('$fixture_lost_event'::uuid);
select public.publish_event('$fixture_lost_event'::uuid);
reset role;
update private.checkout_runtime_control set checkout_creation_enabled = true where singleton;
commit;"

reserve_sql() {
  local event_id="$1"; local items="$2"; local request_id="$3"; local token="$4"
  items="$(printf '%s' "$items" | tr -d '\\')"
  printf "begin; set local statement_timeout = '20s'; set local role service_role; select * from public.server_reserve_checkout('%s', '%s'::jsonb, 'Concurrent Buyer', 'concurrent-buyer@example.invalid', '%s', repeat('%s', 64)); commit;" "$event_id" "$items" "$request_id" "$token"
}

reserve_hold_sql() {
  local event_id="$1"; local items="$2"; local request_id="$3"; local token="$4"
  items="$(printf '%s' "$items" | tr -d '\\')"
  printf "begin; set local statement_timeout = '20s'; set local role service_role; select * from public.server_reserve_checkout('%s', '%s'::jsonb, 'Concurrent Buyer', 'concurrent-buyer@example.invalid', '%s', repeat('%s', 64)); select pg_sleep(4); commit;" "$event_id" "$items" "$request_id" "$token"
}

# A JSON cart admitted while the switch is on holds the control-row share lock
# through commit, so an owner disable cannot overtake the admitted transaction.
gate_disable_application="whereto_task2_json_gate_disable"
run_query gate_admission "begin;
  set local statement_timeout = '20s';
  set local role service_role;
  select * from public.server_reserve_checkout(
    '$fixture_event',
    '[{\"tier_id\":\"97200000-0000-4000-8000-000000000002\",\"quantity\":1}]'::jsonb,
    'Gate Buyer', 'gate-buyer@example.invalid',
    '97300000-0000-4000-8000-000000000010', repeat('0', 64)
  );
  select pg_advisory_xact_lock(919203);
  select pg_sleep(12);
  commit;" &
gate_admission_pid=$!
wait_for_advisory_marker 919203 json_gate_admission
run_query gate_disable "begin;
  set local application_name = '$gate_disable_application';
  set local statement_timeout = '20s';
  update private.checkout_runtime_control
  set checkout_creation_enabled = false
  where singleton;
  commit;" &
gate_disable_pid=$!
wait_for_session_lock "$gate_disable_application" json_gate_disable
wait "$gate_admission_pid"
wait "$gate_disable_pid"
run_query verify_gate_serialization "do \$assert\$
begin
  if (select checkout_creation_enabled from private.checkout_runtime_control where singleton) then
    raise exception using errcode = 'P0001', message = 'ASSERT_SWITCH_NOT_DISABLED';
  end if;
  if (select count(*) from public.orders
      where event_id = '$fixture_event'::uuid
        and client_request_id = '97300000-0000-4000-8000-000000000010'::uuid) <> 1 then
    raise exception using errcode = 'P0001', message = 'ASSERT_JSON_ADMISSION_NOT_PERSISTED';
  end if;
end
\$assert\$;"
run_query release_gate_reservation "begin;
  set local role service_role;
  select public.server_cancel_checkout_reservation(
    (
      select id from public.orders
      where event_id = '$fixture_event'::uuid
        and client_request_id = '97300000-0000-4000-8000-000000000010'::uuid
    ),
    'TEST_GATE_RESERVATION_RELEASE'
  );
  commit;"
run_query reopen_gate "update private.checkout_runtime_control
  set checkout_creation_enabled = true
  where singleton;"

# Same-tier final inventory: session two must wait, then fail sold-out rather than oversell.
run_query final_first "$(reserve_hold_sql "$fixture_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000001\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000001' a)" &
first_pid=$!
sleep 1
set +e
run_query final_second "$(reserve_sql "$fixture_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000001\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000002' b)"
second_exit=$?
wait "$first_pid"; first_exit=$?
set -e
if ! {
  [[ $first_exit -eq 0 && $second_exit -ne 0 ]] \
    && grep -q 'TIER_SOLD_OUT' "$temporary_directory/final_second.log"
} && ! {
  [[ $first_exit -ne 0 && $second_exit -eq 0 ]] \
    && grep -q 'TIER_SOLD_OUT' "$temporary_directory/final_first.log"
}; then
  echo "Same-tier final-inventory proof did not produce exactly one winner and one sold-out result." >&2
  sed -n '1,120p' "$temporary_directory/final_first.log" >&2
  sed -n '1,120p' "$temporary_directory/final_second.log" >&2
  exit 1
fi

# Overlapping/reversed input, and different tiers, all use separate sessions and must finish without a deadlock.
run_query overlap_left "$(reserve_sql "$fixture_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000002\",\"quantity\":1},{\"tier_id\":\"97200000-0000-4000-8000-000000000003\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000003' c)" &
left_pid=$!
run_query overlap_right "$(reserve_sql "$fixture_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000003\",\"quantity\":1},{\"tier_id\":\"97200000-0000-4000-8000-000000000002\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000004' d)" &
right_pid=$!
wait "$left_pid"; left_exit=$?
wait "$right_pid"; right_exit=$?
if [[ $left_exit -ne 0 || $right_exit -ne 0 ]]; then
  echo "Reverse-order overlapping carts deadlocked or failed." >&2; exit 1
fi
run_query different_general "$(reserve_sql "$fixture_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000002\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000005' e)" &
general_pid=$!
run_query different_vip "$(reserve_sql "$fixture_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000003\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000006' f)" &
vip_pid=$!
wait "$general_pid"; general_exit=$?
wait "$vip_pid"; vip_exit=$?
if [[ $general_exit -ne 0 || $vip_exit -ne 0 ]]; then
  echo "Different-tier carts failed bounded completion." >&2; exit 1
fi

# Direct locked SQL isolates the production tier-row serialization boundary.
# The public save path also changes publication/moderation state, which would
# turn this into an eligibility test instead of a purchase-time snapshot test.
run_query tier_edit "begin; set local statement_timeout = '20s'; select public.lock_event_ticketing_operation('$fixture_event'); select id from public.ticket_tiers where id = '97200000-0000-4000-8000-000000000002' for update; update public.ticket_tiers set name = 'General Edited', unit_amount_minor = 1200, version = version + 1 where id = '97200000-0000-4000-8000-000000000002'; select pg_advisory_xact_lock(919202); select pg_sleep(3); commit;" &
edit_pid=$!
wait_for_advisory_marker 919202 tier_edit
set +e
run_query edit_reserve "$(reserve_sql "$fixture_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000002\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000007' 7)"
edit_reserve_exit=$?
wait "$edit_pid"; edit_exit=$?
set -e
if [[ $edit_exit -ne 0 || $edit_reserve_exit -ne 0 ]]; then
  echo "Concurrent tier edit and reservation failed bounded serialization." >&2
  sed -n '1,120p' "$temporary_directory/tier_edit.log" >&2
  sed -n '1,120p' "$temporary_directory/edit_reserve.log" >&2
  exit 1
fi
run_query verify_edit_snapshot "do \$assert\$
begin
  if not exists (
    select 1
    from public.orders as orders
    join public.order_items as items on items.order_id = orders.id
    where orders.client_request_id = '97300000-0000-4000-8000-000000000007'::uuid
      and items.ticket_tier_id = '97200000-0000-4000-8000-000000000002'::uuid
      and items.tier_name = 'General Edited'
      and items.unit_amount_minor = 1200
      and items.tier_version = 2
  ) then
    raise exception using errcode = 'P0001', message = 'ASSERT_STALE_TIER_SNAPSHOT';
  end if;
end
\$assert\$;"
# Eligibility loss is a separate serialized mutation and must prevent a later cart.
run_query lose_eligibility "begin; set local statement_timeout = '20s'; select public.lock_event_ticketing_operation('$fixture_lost_event'); select id from public.ticket_tiers where event_id = '$fixture_lost_event' order by id for update; select id from public.events where id = '$fixture_lost_event' for update; update public.events set status = 'cancelled' where id = '$fixture_lost_event'; select pg_advisory_xact_lock(919201); select pg_sleep(3); commit;" &
loss_pid=$!
wait_for_advisory_marker 919201 eligibility_loss
set +e
run_query ineligible "$(reserve_sql "$fixture_lost_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000004\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000008' 8)"
ineligible_exit=$?
wait "$loss_pid"; loss_exit=$?
set -e
if [[ $loss_exit -ne 0 || $ineligible_exit -eq 0 ]] \
  || ! grep -q 'EVENT_NOT_SELLABLE' "$temporary_directory/ineligible.log"; then
  echo "Eligibility-loss reservation was admitted." >&2; exit 1
fi

# A sold-out line must roll the entire cart back, including an otherwise available line.
run_query atomic_precondition "with tier_availability as (
  select tiers.id,
    tiers.quantity_total - coalesce(sum(items.quantity) filter (
      where orders.status in ('paid', 'payment_processing', 'requires_review', 'partially_refunded')
        or (orders.status in ('creating_checkout', 'checkout_open')
          and orders.reservation_expires_at > statement_timestamp())
    ), 0)::integer as available_quantity
  from public.ticket_tiers as tiers
  left join public.order_items as items on items.ticket_tier_id = tiers.id
  left join public.orders as orders on orders.id = items.order_id
  where tiers.id in (
    '97200000-0000-4000-8000-000000000001'::uuid,
    '97200000-0000-4000-8000-000000000002'::uuid
  )
  group by tiers.id, tiers.quantity_total
)
select
  (select available_quantity from tier_availability
    where id = '97200000-0000-4000-8000-000000000002'::uuid) as general_available,
  (select available_quantity from tier_availability
    where id = '97200000-0000-4000-8000-000000000001'::uuid) as final_available,
  (select available_quantity >= 1 from tier_availability
    where id = '97200000-0000-4000-8000-000000000002'::uuid) as general_has_requested,
  (select available_quantity = 0 from tier_availability
    where id = '97200000-0000-4000-8000-000000000001'::uuid) as final_sold_out;"
if ! grep -q '"general_has_requested": true' "$temporary_directory/atomic_precondition.log" \
  || ! grep -q '"final_sold_out": true' "$temporary_directory/atomic_precondition.log"; then
  echo "Atomic-failure precondition did not have one available and one sold-out line." >&2
  sed -n '1,120p' "$temporary_directory/atomic_precondition.log" >&2
  exit 1
fi
set +e
run_query atomic_fail "$(reserve_sql "$fixture_event" '[{\"tier_id\":\"97200000-0000-4000-8000-000000000002\",\"quantity\":1},{\"tier_id\":\"97200000-0000-4000-8000-000000000001\",\"quantity\":1}]' '97300000-0000-4000-8000-000000000009' 9)"
atomic_exit=$?
set -e
run_query atomic_check "select
  (select count(*)::integer from public.orders
    where client_request_id = '97300000-0000-4000-8000-000000000009'::uuid) as inserted_orders,
  (select count(*)::integer from public.order_items
    where order_id in (
      select id from public.orders
      where client_request_id = '97300000-0000-4000-8000-000000000009'::uuid
    )) as inserted_items;"
if [[ $atomic_exit -eq 0 ]] \
  || ! grep -q '"inserted_orders": 0' "$temporary_directory/atomic_check.log" \
  || ! grep -q '"inserted_items": 0' "$temporary_directory/atomic_check.log"; then
  echo "Insufficient cart line left partial rows." >&2; exit 1
fi

echo "cart reservation concurrency preserved bounded completion, sorted locking, and atomic inventory"
