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
set local session_replication_role = replica;
delete from public.tickets where organizer_id = '14000000-0000-0000-0000-000000000001'::uuid;
delete from public.order_items where order_id in (
  select id from public.orders
  where organizer_id = '14000000-0000-0000-0000-000000000001'::uuid
);
delete from public.orders where organizer_id = '14000000-0000-0000-0000-000000000001'::uuid;
delete from public.organizer_stripe_accounts where organizer_id = '14000000-0000-0000-0000-000000000001'::uuid;
delete from public.ticket_tiers where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
update public.events
set publicly_authorized_revision = null,
    publicly_authorized_action_id = null
where id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from private.event_public_eligibility_intervals where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
update private.event_moderation_actions
set review_request_id = null
where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from private.moderation_review_requests where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from private.event_reports where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from private.event_moderation_actions where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from private.event_moderation_evaluations where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from private.event_policy_acceptances where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from private.event_policy_legacy_exemptions where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from private.event_risk_disclosures where event_id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from public.events where id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
delete from public.organizers where id = '14000000-0000-0000-0000-000000000001'::uuid;
delete from auth.users where id = '14000000-0000-0000-0000-000000000001'::uuid;
update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;
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
), (
  '24000000-0000-0000-0000-000000000003',
  '14000000-0000-0000-0000-000000000001',
  'Phantom Tier Event'
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
), (
  '24000000-0000-0000-0000-000000000004',
  '14000000-0000-0000-0000-000000000001',
  'Concurrent Paid Publish Event',
  'A complete event used to verify paid and free publish serialization.',
  'community',
  now() + interval '3 days',
  now() + interval '3 days 2 hours',
  'Publish Race Venue',
  '2 Market Street',
  'San Francisco',
  'CA',
  '94105',
  'US',
  'mapbox.concurrent-paid-free-publish',
  37.7936,
  -122.3958,
  'paid'
), (
  '24000000-0000-0000-0000-000000000005',
  '14000000-0000-0000-0000-000000000001',
  'Concurrent Cart Reservation Event',
  'A complete event used to verify cart tier-then-event lock ordering.',
  'community',
  now() + interval '4 days',
  now() + interval '4 days 2 hours',
  'Cart Lock Venue',
  '3 Market Street',
  'San Francisco',
  'CA',
  '94105',
  'US',
  'mapbox.concurrent-cart-lock-order',
  37.7937,
  -122.3959,
  'paid'
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
  ),
  (
    '34000000-0000-4000-8000-000000000004',
    '24000000-0000-0000-0000-000000000004',
    'Publish Race Tier', 3000, 10, 'draft', 1
  ),
  (
    '34000000-0000-4000-8000-000000000005',
    '24000000-0000-0000-0000-000000000005',
    'Cart Lock Tier', 2200, 10, 'draft', 1
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
insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
select id, 'all_ages', false, false, false, false, false, false
from public.events
where id in (
  '24000000-0000-0000-0000-000000000001'::uuid,
  '24000000-0000-0000-0000-000000000002'::uuid,
  '24000000-0000-0000-0000-000000000003'::uuid,
  '24000000-0000-0000-0000-000000000004'::uuid,
  '24000000-0000-0000-0000-000000000005'::uuid
);
insert into private.event_policy_acceptances (
  event_id, organizer_id, accepted_by_user_id, content_revision, input_sha256,
  organizer_terms_version_id, event_policy_version_id
)
select
  events.id,
  events.organizer_id,
  events.organizer_id,
  events.content_revision,
  private.compute_event_input_sha256(events.id),
  'dev-organizer-terms-v1',
  'dev-event-policy-v1'
from public.events as events
where events.id = '24000000-0000-0000-0000-000000000004'::uuid;
select set_config(
  'request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies(
  '24000000-0000-0000-0000-000000000005'::uuid
);
select public.publish_event('24000000-0000-0000-0000-000000000005'::uuid);
reset role;
update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;
commit;" >"$temporary_directory/setup.log" 2>&1

wait_for_advisory_marker() {
  marker_id="$1"
  case_name="$2"

  for _attempt in 1 2 3 4 5; do
    "$supabase_cli" db query --linked "
      select exists (
        select 1
        from pg_catalog.pg_locks
        where locktype = 'advisory'
          and classid = 0
          and objid = '$marker_id'::oid
          and granted
      ) as marker_ready;
    " >"$temporary_directory/${case_name}-marker.log" 2>&1

    if grep -q '\"marker_ready\": true' "$temporary_directory/${case_name}-marker.log"; then
      return 0
    fi
  done

  echo "$case_name did not reach its deterministic concurrency marker." >&2
  sed -n '1,160p' "$temporary_directory/${case_name}-marker.log" >&2
  return 1
}

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

run_phantom_tier_case() {
  case_name="phantom-tier-save"
  event_id="24000000-0000-0000-0000-000000000003"
  tier_id="34000000-0000-4000-8000-000000000003"

  "$supabase_cli" db query --linked "begin;
  set local statement_timeout = '20s';
  do \$lock\$
  begin
    if pg_catalog.to_regprocedure('public.lock_event_ticketing_operation(uuid)') is not null then
      execute pg_catalog.format(
        'select public.lock_event_ticketing_operation(%L::uuid)',
        '$event_id'
      );
    end if;
  end
  \$lock\$;
  select id from public.events where id = '$event_id'::uuid for update;
  select pg_advisory_xact_lock(917503);
  select pg_sleep(12);
  insert into public.ticket_tiers (
    id, event_id, name, unit_amount_minor, quantity_total, status, sort_order
  ) values (
    '$tier_id', '$event_id', 'Phantom Tier', 1800, 10, 'draft', 1
  );
  commit;
  begin;
  set local statement_timeout = '20s';
  do \$lock\$
  begin
    if pg_catalog.to_regprocedure('public.lock_event_ticketing_operation(uuid)') is not null then
      execute pg_catalog.format(
        'select public.lock_event_ticketing_operation(%L::uuid)',
        '$event_id'
      );
    end if;
  end
  \$lock\$;
  select id from public.ticket_tiers where id = '$tier_id'::uuid for update;
  select id from public.events where id = '$event_id'::uuid for update;
  commit;" >"$temporary_directory/${case_name}-inserter.log" 2>&1 &
  inserter_pid=$!

  if ! wait_for_advisory_marker 917503 "$case_name"; then
    wait "$inserter_pid"
    return 1
  fi

  set +e
  "$supabase_cli" db query --linked "begin;
  set local statement_timeout = '20s';
  select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  select count(*) from public.save_ticket_tiers(
    '$event_id',
    '[{\"id\":\"$tier_id\",\"name\":\"Phantom Tier\",\"unit_amount_minor\":1800,\"currency\":\"usd\",\"quantity_total\":10,\"sort_order\":1}]'::jsonb
  );
  commit;" >"$temporary_directory/${case_name}-save.log" 2>&1
  save_status=$?
  wait "$inserter_pid"
  inserter_status=$?
  set -e

  if [[ $save_status -ne 0 || $inserter_status -ne 0 ]]; then
    echo "$case_name encountered a deadlock or timeout around a newly inserted tier." >&2
    sed -n '1,160p' "$temporary_directory/${case_name}-inserter.log" >&2
    sed -n '1,160p' "$temporary_directory/${case_name}-save.log" >&2
    return 1
  fi

  echo "$case_name completed without a phantom-tier deadlock"
}

run_paid_free_publish_case() {
  case_name="paid-free-publish"
  event_id="24000000-0000-0000-0000-000000000004"
  tier_id="34000000-0000-4000-8000-000000000004"

  "$supabase_cli" db query --linked "begin;
  set local statement_timeout = '20s';
  do \$lock\$
  begin
    if pg_catalog.to_regprocedure('public.lock_event_ticketing_operation(uuid)') is not null then
      execute pg_catalog.format(
        'select public.lock_event_ticketing_operation(%L::uuid)',
        '$event_id'
      );
    end if;
  end
  \$lock\$;
  select id from public.ticket_tiers where id = '$tier_id'::uuid for update;
  select pg_advisory_xact_lock(917504);
  select pg_sleep(12);
  update public.events set admission_type = 'free' where id = '$event_id'::uuid;
  select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);
  select public.accept_current_event_policies('$event_id');
  select (public.publish_event('$event_id')).id;
  commit;" >"$temporary_directory/${case_name}-free.log" 2>&1 &
  free_publish_pid=$!

  if ! wait_for_advisory_marker 917504 "$case_name"; then
    wait "$free_publish_pid"
    return 1
  fi

  set +e
  "$supabase_cli" db query --linked "begin;
  set local statement_timeout = '20s';
  select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  select (public.publish_event('$event_id')).id;
  commit;" >"$temporary_directory/${case_name}-paid.log" 2>&1
  paid_publish_status=$?
  wait "$free_publish_pid"
  free_publish_status=$?
  set -e

  if [[ $paid_publish_status -ne 0 || $free_publish_status -ne 0 ]]; then
    echo "$case_name encountered a deadlock or timeout." >&2
    sed -n '1,160p' "$temporary_directory/${case_name}-free.log" >&2
    sed -n '1,160p' "$temporary_directory/${case_name}-paid.log" >&2
    return 1
  fi

  "$supabase_cli" db query --linked "
    select status, admission_type
    from public.events
    where id = '$event_id'::uuid;
  " >"$temporary_directory/${case_name}-result.log" 2>&1

  if ! grep -q '\"status\": \"published\"' "$temporary_directory/${case_name}-result.log" \
    || ! grep -q '\"admission_type\": \"free\"' "$temporary_directory/${case_name}-result.log"; then
    echo "$case_name did not preserve the free publication that won the serialized race." >&2
    sed -n '1,160p' "$temporary_directory/${case_name}-result.log" >&2
    return 1
  fi

  echo "$case_name preserved the serialized published-free outcome"
}

failure_count=0

run_lock_order_case \
  "reserve-checkout-cart" \
  "34000000-0000-4000-8000-000000000005" \
  "24000000-0000-0000-0000-000000000005" \
  "begin;
   set local statement_timeout = '20s';
   set local role service_role;
   select count(*) from public.server_reserve_checkout(
     '24000000-0000-0000-0000-000000000005',
     jsonb_build_array(jsonb_build_object(
       'tier_id', '34000000-0000-4000-8000-000000000005', 'quantity', 1
     )),
     'Cart Lock Buyer', 'cart-lock@example.invalid',
     '44000000-0000-4000-8000-000000000005', repeat('a', 64)
   );
   commit;" || failure_count=$((failure_count + 1))

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

run_phantom_tier_case || failure_count=$((failure_count + 1))

run_paid_free_publish_case || failure_count=$((failure_count + 1))

if [[ $failure_count -ne 0 ]]; then
  exit 1
fi
