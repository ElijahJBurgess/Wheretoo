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
delete from public.disputes where order_id in (
  select id from public.orders
  where organizer_id = '18000000-0000-4000-8000-000000000001'::uuid
);
delete from public.refunds where order_id in (
  select id from public.orders
  where organizer_id = '18000000-0000-4000-8000-000000000001'::uuid
);
delete from public.tickets where organizer_id = '18000000-0000-4000-8000-000000000001'::uuid;
delete from public.order_items where order_id in (
  select id from public.orders
  where organizer_id = '18000000-0000-4000-8000-000000000001'::uuid
);
delete from public.orders where organizer_id = '18000000-0000-4000-8000-000000000001'::uuid;
delete from public.stripe_webhook_events where stripe_event_id in (
  'evt_ConcurrencyOneAb', 'evt_ConcurrencyTwoCd', 'evt_RaceFulfillmentEf'
);
delete from public.ticket_tiers where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
update public.events
set publicly_authorized_revision = null,
    publicly_authorized_action_id = null
where id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from private.event_public_eligibility_intervals
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
update private.event_moderation_actions
set review_request_id = null
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from private.moderation_review_requests
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from private.event_reports
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from private.event_moderation_actions
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from private.event_moderation_evaluations
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from private.event_policy_acceptances
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from private.event_policy_legacy_exemptions
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from private.event_risk_disclosures
where event_id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from public.organizer_stripe_accounts
where organizer_id = '18000000-0000-4000-8000-000000000001'::uuid;
delete from public.events where id = '28000000-0000-4000-8000-000000000001'::uuid;
delete from public.organizers where id = '18000000-0000-4000-8000-000000000001'::uuid;
delete from auth.users where id = '18000000-0000-4000-8000-000000000001'::uuid;
update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;
commit;"

cleanup_verification_sql="select (
  (select count(*) from private.event_moderation_actions where event_id = '28000000-0000-4000-8000-000000000001'::uuid)
  + (select count(*) from private.event_moderation_evaluations where event_id = '28000000-0000-4000-8000-000000000001'::uuid)
  + (select count(*) from private.event_reports where event_id = '28000000-0000-4000-8000-000000000001'::uuid)
  + (select count(*) from private.moderation_review_requests where event_id = '28000000-0000-4000-8000-000000000001'::uuid)
  + (select count(*) from private.event_policy_legacy_exemptions where event_id = '28000000-0000-4000-8000-000000000001'::uuid)
  + (select count(*) from private.event_public_eligibility_intervals where event_id = '28000000-0000-4000-8000-000000000001'::uuid)
  + (select count(*) from private.event_policy_acceptances where event_id = '28000000-0000-4000-8000-000000000001'::uuid)
  + (select count(*) from private.event_risk_disclosures where event_id = '28000000-0000-4000-8000-000000000001'::uuid)
) as residue_count;"

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  "$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/cleanup.log" 2>&1
  cleanup_status=$?
  if [[ $cleanup_status -ne 0 ]]; then
    echo "Payment concurrency fixture cleanup failed." >&2
    sed -n '1,160p' "$temporary_directory/cleanup.log" >&2
  else
    "$supabase_cli" db query --linked "$cleanup_verification_sql" \
      >"$temporary_directory/cleanup-verification.log" 2>&1
    cleanup_status=$?
    if [[ $cleanup_status -ne 0 ]] || ! grep -q '"residue_count": 0' \
      "$temporary_directory/cleanup-verification.log"; then
      cleanup_status=1
      echo "Payment concurrency moderation residue remains." >&2
      sed -n '1,160p' "$temporary_directory/cleanup-verification.log" >&2
    fi
  fi
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  if [[ $original_status -ne 0 ]]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}

trap cleanup EXIT

wait_for_advisory_marker() {
  marker_id="$1"
  case_name="$2"

  for _attempt in 1 2 3 4 5 6 7 8; do
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

"$supabase_cli" db query --linked "$cleanup_sql" >"$temporary_directory/pre-cleanup.log" 2>&1

if ! "$supabase_cli" db query --linked "begin;
insert into auth.users (id, email) values (
  '18000000-0000-4000-8000-000000000001',
  'payment-fulfillment-concurrency@example.invalid'
);
insert into public.organizers (id, display_name) values (
  '18000000-0000-4000-8000-000000000001',
  'Payment Fulfillment Concurrency'
);
insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  '28000000-0000-4000-8000-000000000001',
  '18000000-0000-4000-8000-000000000001',
  'published', 'clear', 'Payment Concurrency Event',
  'A paid event used only for deterministic fulfillment concurrency verification.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'Concurrency Venue', '3 Mission Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.payment-fulfillment-concurrency', 37.7936, -122.3958, 'paid', now()
);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  (
    '38000000-0000-4000-8000-000000000001',
    '28000000-0000-4000-8000-000000000001',
    'Duplicate Fulfillment GA', 2000, 'usd', 10, 'active', 1
  ),
  (
    '38000000-0000-4000-8000-000000000002',
    '28000000-0000-4000-8000-000000000001',
    'Duplicate Fulfillment VIP', 2500, 'usd', 10, 'active', 2
  ),
  (
    '38000000-0000-4000-8000-000000000003',
    '28000000-0000-4000-8000-000000000001',
    'Mutation Race', 3000, 'usd', 10, 'active', 3
  );
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  '18000000-0000-4000-8000-000000000001',
  'acct_1ConcurrencyAbCdEf',
  'active', 'active', 'clear', 0, 0, now()
);
insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  '28000000-0000-4000-8000-000000000001',
  'all_ages', false, false, false, false, false, false
);
select set_config(
  'request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies('28000000-0000-4000-8000-000000000001'::uuid);
select public.publish_event('28000000-0000-4000-8000-000000000001'::uuid);
reset role;
update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;
set local role service_role;
select * from public.server_reserve_checkout(
  '28000000-0000-4000-8000-000000000001',
  '[{\"tier_id\":\"38000000-0000-4000-8000-000000000002\",\"quantity\":1},{\"tier_id\":\"38000000-0000-4000-8000-000000000001\",\"quantity\":2}]'::jsonb,
  'Concurrent Buyer One', 'concurrent-one@example.invalid',
  '48000000-0000-4000-8000-000000000001', repeat('1', 64)
);
select public.server_attach_checkout_session(
  (select id from public.orders
    where client_request_id = '48000000-0000-4000-8000-000000000001'),
  'cs_test_ConcurrencyAbCdEf01',
  (select checkout_expires_at from public.orders
    where client_request_id = '48000000-0000-4000-8000-000000000001')
);
select * from public.server_reserve_checkout(
  '28000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000003'::uuid,
  'Concurrent Buyer Two', 'concurrent-two@example.invalid',
  '48000000-0000-4000-8000-000000000002', repeat('2', 64)
);
select public.server_attach_checkout_session(
  (select id from public.orders
    where client_request_id = '48000000-0000-4000-8000-000000000002'),
  'cs_test_MutationRaceAbCd02',
  (select checkout_expires_at from public.orders
    where client_request_id = '48000000-0000-4000-8000-000000000002')
);
select * from public.server_record_webhook_receipt(
  'evt_ConcurrencyOneAb', 'checkout.session.completed', false,
  'cs_test_ConcurrencyAbCdEf01', '2025-08-27.basil',
  '2026-08-25 18:00:00+00', repeat('a', 64)
);
select * from public.server_record_webhook_receipt(
  'evt_ConcurrencyTwoCd', 'checkout.session.async_payment_succeeded', false,
  'cs_test_ConcurrencyAbCdEf01', '2025-08-27.basil',
  '2026-08-25 18:00:01+00', repeat('b', 64)
);
select * from public.server_record_webhook_receipt(
  'evt_RaceFulfillmentEf', 'checkout.session.completed', false,
  'cs_test_MutationRaceAbCd02', '2025-08-27.basil',
  '2026-08-25 18:00:02+00', repeat('c', 64)
);
commit;" >"$temporary_directory/setup.log" 2>&1; then
  echo "Payment fulfillment concurrency setup failed." >&2
  sed -n '1,160p' "$temporary_directory/setup.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "begin;
set local statement_timeout = '20s';
set local role service_role;
select * from public.server_fulfill_paid_order(
  'evt_ConcurrencyOneAb',
  (select id from public.orders
    where client_request_id = '48000000-0000-4000-8000-000000000001'),
  'cs_test_ConcurrencyAbCdEf01', 'pi_1ConcurrencyAbCdEf', 'ch_1ConcurrencyAbCdEf',
  'tr_1ConcurrencyAbCdEf', 'fee_1ConcurrencyAbCdEf', 'txn_1ConcurrencyAbCdEf',
  'cus_1ConcurrencyAbCdEf', 'payment', 'paid', 'usd',
  6500, 6500, 475, 'acct_1ConcurrencyAbCdEf'
);
select pg_advisory_xact_lock(918501);
select pg_sleep(6);
commit;" >"$temporary_directory/duplicate-first.log" 2>&1 &
duplicate_first_pid=$!

wait_for_advisory_marker 918501 "duplicate-fulfillment"

set +e
"$supabase_cli" db query --linked "begin;
set local statement_timeout = '20s';
set local role service_role;
select * from public.server_fulfill_paid_order(
  'evt_ConcurrencyTwoCd',
  (select id from public.orders
    where client_request_id = '48000000-0000-4000-8000-000000000001'),
  'cs_test_ConcurrencyAbCdEf01', 'pi_1ConcurrencyAbCdEf', 'ch_1ConcurrencyAbCdEf',
  'tr_1ConcurrencyAbCdEf', 'fee_1ConcurrencyAbCdEf', 'txn_1ConcurrencyAbCdEf',
  'cus_1ConcurrencyAbCdEf', 'payment', 'paid', 'usd',
  6500, 6500, 475, 'acct_1ConcurrencyAbCdEf'
);
commit;" >"$temporary_directory/duplicate-second.log" 2>&1
duplicate_second_status=$?
wait "$duplicate_first_pid"
duplicate_first_status=$?
set -e

if [[ $duplicate_first_status -ne 0 || $duplicate_second_status -ne 0 ]]; then
  echo "Concurrent duplicate fulfillment failed or timed out." >&2
  sed -n '1,160p' "$temporary_directory/duplicate-first.log" >&2
  sed -n '1,160p' "$temporary_directory/duplicate-second.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "
select orders.status,
  (select count(*) from public.tickets where order_id = orders.id) as ticket_count,
  (select count(distinct order_item_id) from public.tickets
    where order_id = orders.id) as ticket_item_count,
  (select array_to_string(
      array_agg(unit_sequence order by ticket_tier_id, unit_sequence), ','
    )
    from public.tickets where order_id = orders.id) as ticket_sequences,
  (select count(*) from public.stripe_webhook_events
    where stripe_event_id in ('evt_ConcurrencyOneAb', 'evt_ConcurrencyTwoCd')
      and processing_status = 'processed') as processed_receipt_count
from public.orders as orders
where orders.client_request_id = '48000000-0000-4000-8000-000000000001';
" >"$temporary_directory/duplicate-result.log" 2>&1

if ! grep -q '\"status\": \"paid\"' "$temporary_directory/duplicate-result.log" \
  || ! grep -q '\"ticket_count\": 3' "$temporary_directory/duplicate-result.log" \
  || ! grep -q '\"ticket_item_count\": 2' "$temporary_directory/duplicate-result.log" \
  || ! grep -q '\"ticket_sequences\": \"1,2,1\"' "$temporary_directory/duplicate-result.log" \
  || ! grep -q '\"processed_receipt_count\": 2' "$temporary_directory/duplicate-result.log"; then
  echo "Concurrent duplicate fulfillment violated exactly-once state." >&2
  sed -n '1,160p' "$temporary_directory/duplicate-result.log" >&2
  exit 1
fi

echo "concurrent duplicate fulfillment preserved three item-local tickets and two processed receipts"

"$supabase_cli" db query --linked "begin;
set local statement_timeout = '20s';
select public.lock_event_ticketing_operation(
  '28000000-0000-4000-8000-000000000001'
);
select id from public.ticket_tiers
where id = '38000000-0000-4000-8000-000000000003' for update;
select id from public.events
where id = '28000000-0000-4000-8000-000000000001' for update;
update public.ticket_tiers set status = 'archived'
where id = '38000000-0000-4000-8000-000000000003';
update public.events set status = 'cancelled'
where id = '28000000-0000-4000-8000-000000000001';
select pg_advisory_xact_lock(918502);
select pg_sleep(6);
commit;" >"$temporary_directory/mutation-first.log" 2>&1 &
mutation_first_pid=$!

wait_for_advisory_marker 918502 "fulfillment-mutation-race"

set +e
"$supabase_cli" db query --linked "begin;
set local statement_timeout = '20s';
set local role service_role;
select * from public.server_fulfill_paid_order(
  'evt_RaceFulfillmentEf',
  (select id from public.orders
    where client_request_id = '48000000-0000-4000-8000-000000000002'),
  'cs_test_MutationRaceAbCd02', 'pi_1MutationRaceAbCd', 'ch_1MutationRaceAbCd',
  'tr_1MutationRaceAbCd', 'fee_1MutationRaceAbCd', 'txn_1MutationRaceAbCd',
  'cus_1MutationRaceAbCd', 'payment', 'paid', 'usd',
  3000, 3000, 200, 'acct_1ConcurrencyAbCdEf'
);
commit;" >"$temporary_directory/mutation-fulfillment.log" 2>&1
mutation_fulfillment_status=$?
wait "$mutation_first_pid"
mutation_first_status=$?
set -e

if [[ $mutation_first_status -ne 0 || $mutation_fulfillment_status -ne 0 ]]; then
  echo "Fulfillment versus tier/event mutation failed or timed out." >&2
  sed -n '1,160p' "$temporary_directory/mutation-first.log" >&2
  sed -n '1,160p' "$temporary_directory/mutation-fulfillment.log" >&2
  exit 1
fi

"$supabase_cli" db query --linked "
select orders.status,
  (select count(*) from public.tickets where order_id = orders.id) as ticket_count,
  events.status as event_status,
  tiers.status as tier_status
from public.orders as orders
join public.events as events on events.id = orders.event_id
join public.order_items as items on items.order_id = orders.id
join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id
where orders.client_request_id = '48000000-0000-4000-8000-000000000002';
" >"$temporary_directory/mutation-result.log" 2>&1

if ! grep -q '\"status\": \"requires_review\"' "$temporary_directory/mutation-result.log" \
  || ! grep -q '\"ticket_count\": 0' "$temporary_directory/mutation-result.log" \
  || ! grep -q '\"event_status\": \"cancelled\"' "$temporary_directory/mutation-result.log" \
  || ! grep -q '\"tier_status\": \"archived\"' "$temporary_directory/mutation-result.log"; then
  echo "Fulfillment did not revalidate the committed tier/event mutation." >&2
  sed -n '1,160p' "$temporary_directory/mutation-result.log" >&2
  exit 1
fi

echo "fulfillment revalidated tier/event mutation after serialized lock acquisition"
