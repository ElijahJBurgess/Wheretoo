#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
source "$repository_root/tests/integration/task17CleanupSql.sh"
TASK17_CLEANUP_SQL_TEMPLATE="$repository_root/tests/integration/sql/task17-cleanup-runtime.sql"

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/task13-cleanup-lock.XXXXXX")"
run_id="$(openssl rand -hex 6)"
fixture_prefix="task17_${run_id}"
drift_run_id="$(openssl rand -hex 6)"
drift_prefix="task17_${drift_run_id}"
account_id="acct_task13${run_id}"
session_id="cs_test_task13${run_id}"
owner_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
drift_owner_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
event_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
evaluation_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
acceptance_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
action_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
ga_tier_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
vip_tier_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
order_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
client_request_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
ga_item_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
vip_item_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
ticket_id_1="$(node -e "console.log(require('node:crypto').randomUUID())")"
ticket_id_2="$(node -e "console.log(require('node:crypto').randomUUID())")"
ticket_id_3="$(node -e "console.log(require('node:crypto').randomUUID())")"
ticket_id_4="$(node -e "console.log(require('node:crypto').randomUUID())")"
base_receipt_id="evt_task13base${run_id}"
race_receipt_id="evt_task13race${run_id}"
dispute_receipt_id="evt_task13dispute${run_id}"
dispute_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
marker_hex="$(openssl rand -hex 8)"
marker="$(MARKER_HEX="$marker_hex" node -e "console.log((BigInt('0x' + process.env.MARKER_HEX) & ((1n << 63n) - 1n)).toString())")"
marker_class=$((marker >> 32))
marker_object=$((marker & 4294967295))
mutation_pid=""
cleanup_pid=""

sanitize_log() {
  rg -o 'TASK17_CLEANUP_[A-Z_]+|ASSERT_TASK13_[A-Z_]+|ERROR: +[0-9A-Z]+|constraint "[a-z0-9_]+"|null value in column "[a-z0-9_]+"' "$1" |
    head -n 8 >&2 || true
  SAFE_LOG_FILE="$1" node -e '
    const text = require("node:fs").readFileSync(process.env.SAFE_LOG_FILE, "utf8");
    const match = text.match(/null value in column (?:\\?"|&quot;)([a-z0-9_]+)/i);
    if (match) process.stderr.write(`missing-column: ${match[1]}\n`);
  ' || true
}

run_query() {
  local phase="$1"
  local sql="$2"
  if ! "$supabase_cli" db query --linked "$sql" >"$temporary_directory/$phase.log" 2>&1; then
    printf 'Task 13 cleanup SQL phase failed: %s\n' "$phase" >&2
    sanitize_log "$temporary_directory/$phase.log"
    return 1
  fi
}

render_cleanup() {
  local mode="$1"
  local destination="$2"
  TASK17_CLEANUP_FIXTURE_PREFIX="$fixture_prefix" \
    TASK17_CLEANUP_CONNECTED_ACCOUNT_ID="$account_id" \
    TASK17_CLEANUP_ONLY="$mode" \
    render_task17_cleanup_sql >"$destination"
  chmod 600 "$destination"
}

cleanup_test_fixture() {
  local original_status=$?
  trap - EXIT
  set +e
  [[ -n "$mutation_pid" ]] && wait "$mutation_pid" 2>/dev/null
  [[ -n "$cleanup_pid" ]] && wait "$cleanup_pid" 2>/dev/null
  "$supabase_cli" db query --linked "begin;
    set local session_replication_role = replica;
    delete from public.disputes where id = '$dispute_id'::uuid;
    delete from public.tickets where id in (
      '$ticket_id_1'::uuid, '$ticket_id_2'::uuid,
      '$ticket_id_3'::uuid, '$ticket_id_4'::uuid
    );
    delete from public.order_items where id in ('$ga_item_id'::uuid, '$vip_item_id'::uuid);
    delete from public.orders where id = '$order_id'::uuid;
    delete from public.stripe_webhook_events where stripe_event_id in (
      '$base_receipt_id', '$race_receipt_id', '$dispute_receipt_id'
    );
    delete from public.ticket_tiers where id in ('$ga_tier_id'::uuid, '$vip_tier_id'::uuid);
    delete from public.organizer_stripe_accounts where organizer_id = '$owner_id'::uuid;
    delete from private.staff_roles where user_id = '$owner_id'::uuid;
    delete from private.event_public_eligibility_intervals where event_id = '$event_id'::uuid;
    delete from private.event_moderation_actions where id = '$action_id'::uuid;
    delete from private.event_moderation_evaluations where id = '$evaluation_id'::uuid;
    delete from private.event_policy_acceptances where id = '$acceptance_id'::uuid;
    delete from private.event_risk_disclosures where event_id = '$event_id'::uuid;
    delete from public.events where id = '$event_id'::uuid;
    delete from public.organizers where id = '$owner_id'::uuid;
    delete from auth.users where id = '$owner_id'::uuid;
    delete from auth.users where id = '$drift_owner_id'::uuid;
    commit;" >"$temporary_directory/cleanup.log" 2>&1
  local teardown_status=$?
  if [[ $teardown_status -eq 0 ]]; then
    "$supabase_cli" db query --linked "do \$assert\$ begin
      if exists (select 1 from auth.users where id in ('$owner_id'::uuid, '$drift_owner_id'::uuid))
        or exists (select 1 from public.organizers where id = '$owner_id'::uuid)
        or exists (select 1 from public.events where id = '$event_id'::uuid)
        or exists (select 1 from public.stripe_webhook_events where stripe_event_id in ('$base_receipt_id', '$race_receipt_id', '$dispute_receipt_id')) then
        raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_TEST_RESIDUE';
      end if;
    end \$assert\$;" >"$temporary_directory/cleanup-verify.log" 2>&1
    teardown_status=$?
  fi
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  [[ $original_status -ne 0 ]] && exit "$original_status"
  exit "$teardown_status"
}

trap cleanup_test_fixture EXIT
chmod 700 "$temporary_directory"

[[ -x "$supabase_cli" ]] || {
  printf '%s\n' 'Supabase CLI is not installed at the project-local path.' >&2
  exit 1
}

run_query environment "do \$assert\$ begin
  if not exists (
    select 1 from private.organizer_policy_release_settings
    where singleton_id and environment = 'development'
  ) or not exists (
    select 1 from private.checkout_runtime_control
    where singleton and checkout_creation_enabled = false
  ) then
    raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_DEVELOPMENT_GATE';
  end if;
end \$assert\$;"

run_query setup "begin;
  set local session_replication_role = replica;
  insert into auth.users (id, email, banned_until) values (
    '$owner_id', '$fixture_prefix@example.invalid', statement_timestamp() + interval '100 years'
  );
  insert into public.organizers (id, display_name) values ('$owner_id', '$fixture_prefix');
  insert into public.events (
    id, organizer_id, status, moderation_status, title, description, category,
    starts_at, ends_at, timezone, venue_name, address_line1, city, region,
    postal_code, country_code, mapbox_feature_id, latitude, longitude,
    admission_type, capacity, published_at, content_revision,
    moderation_version, public_history_status, public_eligibility_version
  ) values (
    '$event_id', '$owner_id', 'published', 'under_review',
    '$fixture_prefix transaction', 'DB-only Task 13 cleanup lock fixture.',
    'community', statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '7 days 2 hours', 'America/Los_Angeles',
    'Cleanup Lock Hall', '1 Test Way', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.task13.cleanup.$run_id', 37.7936, -122.3958, 'paid', 20,
    statement_timestamp(), 1, 1, 'never_public', 0
  );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present,
    explicit_adult_content, gambling_present, weapons_present, high_risk_activity
  ) values ('$event_id', 'all_ages', false, false, false, false, false, false);
  insert into private.event_policy_acceptances (
    id, event_id, organizer_id, accepted_by_user_id, content_revision,
    input_sha256, organizer_terms_version_id, event_policy_version_id
  ) values (
    '$acceptance_id', '$event_id', '$owner_id', '$owner_id', 1,
    private.compute_event_input_sha256('$event_id'),
    'dev-organizer-terms-v1', 'dev-event-policy-v1'
  );
  insert into private.event_moderation_actions (
    id, event_id, content_revision, input_sha256, actor_type, actor_user_id,
    source, action, previous_status, new_status,
    previous_public_history_status, new_public_history_status,
    reason_code, policy_acceptance_id, moderation_version
  ) values (
    '$action_id', '$event_id', 1, private.compute_event_input_sha256('$event_id'),
    'organizer', '$owner_id', 'publish', 'authorize_publication', 'clear', 'clear',
    'never_public', 'never_public', 'no_violation', '$acceptance_id', 1
  );
  insert into private.event_moderation_evaluations (
    id, event_id, content_revision, input_sha256, queued_moderation_version,
    status, source, attempt_count
  ) values (
    '$evaluation_id', '$event_id', 1,
    private.compute_event_input_sha256('$event_id'), 1, 'queued', 'contextual', 0
  );
  insert into private.event_public_eligibility_intervals (
    event_id, public_eligibility_version, eligibility_state, transition_reason
  ) values ('$event_id', 0, 'ineligible', 'initialization');
  insert into public.ticket_tiers (
    id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
  ) values
    ('$ga_tier_id', '$event_id', 'Task 17 General Admission', 1500, 'usd', 10, 'active', 1),
    ('$vip_tier_id', '$event_id', 'Task 17 VIP', 2500, 'usd', 10, 'active', 2);
  insert into public.organizer_stripe_accounts (
    organizer_id, stripe_account_id, transfers_status, payouts_status,
    requirements_status, requirements_currently_due_count,
    requirements_past_due_count, last_synced_at
  ) values ('$owner_id', '$account_id', 'active', 'active', 'clear', 0, 0, statement_timestamp());
  insert into public.stripe_webhook_events (
    stripe_event_id, event_type, stripe_object_id, stripe_created_at,
    payload_sha256, processing_status, processed_at, error_code
  ) values (
    '$base_receipt_id', 'checkout.session.completed', '$session_id',
    statement_timestamp(), repeat('a', 64), 'processed', statement_timestamp(),
    'STRIPE_OBJECT_INVALID'
  );
  insert into public.orders (
    id, order_number, event_id, organizer_id, status,
    checkout_expires_at, reservation_expires_at, expired_at, created_at,
    buyer_name, buyer_email,
    client_request_id, confirmation_token_hash, quantity, currency,
    subtotal_minor, tax_amount_minor, total_minor, platform_product_fee_minor,
    stripe_fee_estimate_minor, application_fee_amount_minor,
    expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
    platform_fixed_minor, processing_fee_treatment, stripe_checkout_session_id,
    stripe_destination_account_id, stripe_checkout_integration_identifier,
    stripe_checkout_request_digest, reconciliation_status
  ) values (
    '$order_id', 'WT-TASK13-$run_id', '$event_id', '$owner_id', 'expired',
    statement_timestamp() - interval '90 minutes',
    statement_timestamp() - interval '85 minutes',
    statement_timestamp() - interval '80 minutes',
    statement_timestamp() - interval '2 hours',
    'Cleanup Buyer', 'cleanup-$run_id@example.invalid',
    '$client_request_id', repeat('b', 64),
    3, 'usd', 5500, 0, 5500, 425, 0, 425, 5075,
    '00000000-0000-0000-0000-000000000500', 500, 50,
    'platform_fee_only', '$session_id', '$account_id',
    'whereto_checkout_abcdefgh', repeat('e', 64), 'pending'
  );
  insert into public.order_items (
    id, order_id, ticket_tier_id, tier_version, tier_name,
    unit_amount_minor, quantity, subtotal_minor, currency
  ) values
    ('$ga_item_id', '$order_id', '$ga_tier_id', 1, 'Task 17 General Admission', 1500, 2, 3000, 'usd'),
    ('$vip_item_id', '$order_id', '$vip_tier_id', 1, 'Task 17 VIP', 2500, 1, 2500, 'usd');
  commit;"

run_query exact_baseline "do \$assert\$ begin
  if (select count(*) from public.orders where id = '$order_id'::uuid) <> 1
    or (select count(*) from public.orders where id = '$order_id'::uuid
      and status = 'expired' and expired_at is not null
      and reservation_expires_at <= statement_timestamp()) <> 1
    or (select count(*) from public.stripe_webhook_events where stripe_object_id = '$session_id') <> 1 then
    raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_BASELINE_INVALID';
  end if;
end \$assert\$;"

# This row models a second Task 17 namespace appearing after the runner's
# initial single-namespace gate and before deletion-time admission.
run_query namespace_drift_setup "insert into auth.users (id, email, banned_until)
  values ('$drift_owner_id', '$drift_prefix@example.invalid',
    statement_timestamp() + interval '100 years');"
namespace_cleanup_sql="$temporary_directory/namespace-cleanup.sql"
render_cleanup 1 "$namespace_cleanup_sql"
if "$supabase_cli" db query --linked --file "$namespace_cleanup_sql" \
  >"$temporary_directory/namespace-cleanup.log" 2>&1; then
  exit 1
fi
run_query namespace_drift_preserved "do \$assert\$ begin
  if not exists (select 1 from auth.users where id = '$drift_owner_id'::uuid)
    or not exists (select 1 from public.orders where id = '$order_id'::uuid)
    or not exists (select 1 from public.stripe_webhook_events where stripe_event_id = '$base_receipt_id') then
    raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_NAMESPACE_DRIFT_DELETED';
  end if;
end \$assert\$;
delete from auth.users where id = '$drift_owner_id'::uuid;"

"$supabase_cli" db query --linked "begin;
  insert into public.stripe_webhook_events (
    stripe_event_id, event_type, stripe_object_id, stripe_created_at,
    payload_sha256, processing_status, processed_at, error_code
  ) values (
    '$race_receipt_id', 'checkout.session.completed', '$session_id',
    statement_timestamp(), repeat('c', 64), 'processed', statement_timestamp(),
    'PAYMENT_SNAPSHOT_MISMATCH'
  );
  update public.orders set status = 'requires_review',
    reconciliation_status = 'requires_review',
    failure_code = 'PAYMENT_SNAPSHOT_MISMATCH',
    last_stripe_event_id = '$race_receipt_id'
  where id = '$order_id'::uuid;
  insert into public.tickets (
    id, order_id, order_item_id, event_id, organizer_id, ticket_tier_id,
    unit_sequence, status
  ) values
    ('$ticket_id_1', '$order_id', '$ga_item_id', '$event_id', '$owner_id', '$ga_tier_id', 1, 'valid'),
    ('$ticket_id_2', '$order_id', '$ga_item_id', '$event_id', '$owner_id', '$ga_tier_id', 2, 'valid'),
    ('$ticket_id_3', '$order_id', '$ga_item_id', '$event_id', '$owner_id', '$ga_tier_id', 3, 'valid'),
    ('$ticket_id_4', '$order_id', '$ga_item_id', '$event_id', '$owner_id', '$ga_tier_id', 4, 'valid');
  select pg_catalog.pg_advisory_xact_lock($marker);
  select pg_catalog.pg_sleep(4);
  commit;" >"$temporary_directory/mutation.log" 2>&1 &
mutation_pid=$!

marker_deadline=$((SECONDS + 30))
while (( SECONDS < marker_deadline )); do
  if "$supabase_cli" db query --linked "do \$assert\$ begin
    if not exists (
      select 1 from pg_catalog.pg_locks
      where locktype = 'advisory' and classid = '$marker_class'::oid
        and objid = '$marker_object'::oid and objsubid = 1 and granted
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_MARKER_NOT_READY';
    end if;
  end \$assert\$;" >"$temporary_directory/marker.log" 2>&1; then
    break
  fi
  sleep 0.2
done
(( SECONDS < marker_deadline )) || exit 1

race_cleanup_sql="$temporary_directory/race-cleanup.sql"
render_cleanup 0 "$race_cleanup_sql"
set +e
"$supabase_cli" db query --linked --file "$race_cleanup_sql" \
  >"$temporary_directory/race-cleanup.log" 2>&1 &
cleanup_pid=$!
sleep 1
kill -0 "$cleanup_pid" 2>/dev/null
cleanup_was_waiting=$?
wait "$mutation_pid"
mutation_status=$?
mutation_pid=""
wait "$cleanup_pid"
race_cleanup_status=$?
cleanup_pid=""
set -e
[[ $cleanup_was_waiting -eq 0 && $mutation_status -eq 0 && $race_cleanup_status -ne 0 ]] || {
  sanitize_log "$temporary_directory/race-cleanup.log"
  exit 1
}

run_query concurrent_preserved "do \$assert\$ begin
  if (select count(*) from public.orders where id = '$order_id'::uuid and status = 'requires_review' and last_stripe_event_id = '$race_receipt_id') <> 1
    or (select count(*) from public.tickets where id in (
      '$ticket_id_1'::uuid, '$ticket_id_2'::uuid,
      '$ticket_id_3'::uuid, '$ticket_id_4'::uuid
    )) <> 4
    or (select count(*) from public.stripe_webhook_events where stripe_object_id = '$session_id') <> 2 then
    raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_CONCURRENT_MUTATION_LOST';
  end if;
end \$assert\$;"

run_query reset_exact "begin;
  delete from public.tickets where id in (
    '$ticket_id_1'::uuid, '$ticket_id_2'::uuid,
    '$ticket_id_3'::uuid, '$ticket_id_4'::uuid
  );
  update public.orders set status = 'checkout_open', reconciliation_status = 'pending',
    failure_code = null, last_stripe_event_id = null where id = '$order_id'::uuid;
  delete from public.stripe_webhook_events where stripe_event_id = '$race_receipt_id';
  commit;"

run_query staff_guard_setup "insert into private.staff_roles (user_id, role, active, granted_by)
  values ('$owner_id', 'moderator', true, '$owner_id');"
staff_cleanup_sql="$temporary_directory/staff-cleanup.sql"
render_cleanup 0 "$staff_cleanup_sql"
if "$supabase_cli" db query --linked --file "$staff_cleanup_sql" >"$temporary_directory/staff-cleanup.log" 2>&1; then
  exit 1
fi
run_query staff_guard_preserved "do \$assert\$ begin
  if not exists (select 1 from private.staff_roles where user_id = '$owner_id'::uuid)
    or not exists (select 1 from public.orders where id = '$order_id'::uuid) then
    raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_STAFF_GUARD_FAILED';
  end if;
end \$assert\$; delete from private.staff_roles where user_id = '$owner_id'::uuid;"

run_query contextual_guard_setup "update private.event_moderation_evaluations
  set status = 'processing' where id = '$evaluation_id'::uuid;"
context_cleanup_sql="$temporary_directory/context-cleanup.sql"
render_cleanup 0 "$context_cleanup_sql"
if "$supabase_cli" db query --linked --file "$context_cleanup_sql" >"$temporary_directory/context-cleanup.log" 2>&1; then
  exit 1
fi
run_query contextual_guard_preserved "do \$assert\$ begin
  if not exists (select 1 from public.orders where id = '$order_id'::uuid) then
    raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_CONTEXT_GUARD_FAILED';
  end if;
end \$assert\$; update private.event_moderation_evaluations
  set status = 'queued' where id = '$evaluation_id'::uuid;"

run_query dispute_setup "begin;
  insert into public.stripe_webhook_events (
    stripe_event_id, event_type, stripe_object_id, stripe_created_at,
    payload_sha256, processing_status, processed_at
  ) values (
    '$dispute_receipt_id', 'charge.dispute.created', 'du_task13$run_id',
    statement_timestamp(), repeat('d', 64), 'processed', statement_timestamp()
  );
  insert into public.disputes (
    id, stripe_dispute_id, order_id, stripe_charge_id, amount_minor, currency,
    status, recovery_status, first_stripe_event_id, last_stripe_event_id,
    first_stripe_event_created_at, last_stripe_event_created_at
  ) values (
    '$dispute_id', 'du_task13$run_id', '$order_id', 'ch_task13$run_id', 5500,
    'usd', 'needs_response', 'not_attempted', '$dispute_receipt_id',
    '$dispute_receipt_id', statement_timestamp(), statement_timestamp()
  );
  commit;"
normal_cleanup_sql="$temporary_directory/normal-cleanup.sql"
render_cleanup 0 "$normal_cleanup_sql"
if "$supabase_cli" db query --linked --file "$normal_cleanup_sql" >"$temporary_directory/dispute-cleanup.log" 2>&1; then
  exit 1
fi
run_query dispute_preserved "do \$assert\$ begin
  if not exists (select 1 from public.disputes where id = '$dispute_id'::uuid)
    or not exists (select 1 from public.orders where id = '$order_id'::uuid)
    or not exists (select 1 from public.stripe_webhook_events where stripe_event_id = '$dispute_receipt_id') then
    raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_DISPUTE_DELETED';
  end if;
end \$assert\$; delete from public.disputes where id = '$dispute_id'::uuid;
delete from public.stripe_webhook_events where stripe_event_id = '$dispute_receipt_id';"

success_cleanup_sql="$temporary_directory/success-cleanup.sql"
render_cleanup 0 "$success_cleanup_sql"
if ! "$supabase_cli" db query --linked --file "$success_cleanup_sql" \
  >"$temporary_directory/final-cleanup.log" 2>&1; then
  sanitize_log "$temporary_directory/final-cleanup.log"
  exit 1
fi
run_query final_state "do \$assert\$ begin
  if exists (select 1 from public.orders where id = '$order_id'::uuid)
    or exists (select 1 from public.order_items where order_id = '$order_id'::uuid)
    or exists (select 1 from public.stripe_webhook_events where stripe_object_id = '$session_id')
    or exists (select 1 from public.ticket_tiers where event_id = '$event_id'::uuid)
    or exists (select 1 from public.organizer_stripe_accounts where organizer_id = '$owner_id'::uuid)
    or not exists (select 1 from public.events where id = '$event_id'::uuid) then
    raise exception using errcode = 'P0001', message = 'ASSERT_TASK13_FINAL_STATE_INVALID';
  end if;
end \$assert\$;"

printf '%s\n' 'Task 13 cleanup SQL concurrency: PASS'
