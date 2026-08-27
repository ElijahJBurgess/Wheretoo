#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
driver_source="$repository_root/tests/integration/edge/task17-transaction-driver/index.ts"
driver_directory="$repository_root/supabase/functions/task17-transaction-driver"
driver_file="$driver_directory/index.ts"
env_file="$repository_root/.env.local"
temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/whereto-task18-run.XXXXXX")"
chmod 700 "$temporary_directory"

organizer_a_id=""
organizer_b_id=""
driver_deployed=0
driver_secret_configured=0
cleanup_failed=0
project_ref=""
run_id="$(openssl rand -hex 6)"
driver_prefix="task17_${run_id}"
browser_prefix="task18_${run_id}"
proof_token="$(openssl rand -hex 32)"
organizer_a_email="whereto-task18-a-${run_id}@example.invalid"
organizer_b_email="whereto-task18-b-${run_id}@example.invalid"
organizer_a_password="Task18-A-$(openssl rand -hex 18)"
organizer_b_password="Task18-B-$(openssl rand -hex 18)"

read_public_env() {
  local variable_name="$1"
  local fallback_name="$2"
  local current_value="${!variable_name-}"
  if [[ -n "$current_value" ]]; then
    printf '%s' "$current_value"
    return
  fi
  [[ -f "$env_file" ]] || return
  awk -F= -v name="$fallback_name" '$1 == name { sub(/^[^=]*=/, ""); print; exit }' "$env_file"
}

driver_request() {
  local body="$1"
  local output="$2"
  BODY="$body" OUTPUT="$output" URL="$function_url" TOKEN="$proof_token" PUBLISHABLE="$publishable_key" \
    node --input-type=module <<'NODE'
import fs from 'node:fs'
const response = await fetch(process.env.URL, {
  method: 'POST',
  headers: {
    apikey: process.env.PUBLISHABLE,
    authorization: `Bearer ${process.env.PUBLISHABLE}`,
    'content-type': 'application/json',
    'x-task17-proof-token': process.env.TOKEN,
  },
  body: process.env.BODY,
})
const text = await response.text()
fs.writeFileSync(process.env.OUTPUT, text, { mode: 0o600 })
if (!response.ok) process.exit(1)
NODE
}

validate_driver_output() {
  local kind="$1"
  local output="$2"
  KIND="$kind" OUTPUT="$output" node --input-type=module <<'NODE'
import fs from 'node:fs'
const value = JSON.parse(fs.readFileSync(process.env.OUTPUT, 'utf8'))
if (process.env.KIND === 'delivery') {
  if (value.status !== 200 || value.receipt?.processing_status !== 'processed') process.exit(1)
} else if (process.env.KIND === 'expiry') {
  if (value.ok !== true || value.livemode !== false || value.status !== 'expired') process.exit(1)
} else if (process.env.KIND === 'refund') {
  if (value.ok !== true || value.livemode !== false || value.amount !== value.reversal_amount || value.application_fee_refund_amount <= 0) process.exit(1)
} else if (process.env.KIND === 'cleanup') {
  const counts = ['event_count','organizer_count','connect_count','order_count','tier_count','receipt_count','ticket_count','dispute_count','refund_count','item_count']
  if (value.ok !== true || value.connected_account_closed !== true || counts.some((name) => value[name] !== 0)) process.exit(1)
} else process.exit(1)
NODE
}

delete_auth_user() {
  local user_id="$1"
  [[ -n "$user_id" ]] || return 0
  curl --silent --show-error --fail-with-body \
    --config "$temporary_directory/admin-curl.conf" \
    --request DELETE "$supabase_url/auth/v1/admin/users/$user_id" \
    --output "$temporary_directory/delete-${user_id}.json"
}

cleanup() {
  local original_status=$?
  trap - EXIT HUP INT TERM
  set +e

  if [[ -n "$organizer_a_id" ]]; then
    "$supabase_cli" db query --linked "select coalesce(json_agg(json_build_object('id', id, 'session_id', stripe_checkout_session_id)), '[]'::json) as orders, count(*)::integer as order_count
      from public.orders where organizer_id = '$organizer_a_id'::uuid and stripe_checkout_session_id is not null;" \
      >"$temporary_directory/checkout-orders.json" 2>/dev/null
    checkout_query_exit=$?
    if [[ $checkout_query_exit -ne 0 ]]; then
      cleanup_failed=1
    elif [[ $driver_deployed -eq 1 ]]; then
      ORDERS_FILE="$temporary_directory/checkout-orders.json" node --input-type=module >"$temporary_directory/checkout-orders.txt" <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.ORDERS_FILE, 'utf8'))
const rows = payload.rows ?? payload
if (!Array.isArray(rows) || rows.length !== 1) process.exit(1)
const row = rows[0]
if (!Array.isArray(row.orders) || !Number.isSafeInteger(row.order_count) || row.order_count !== row.orders.length) process.exit(1)
for (const order of row.orders) {
  if (typeof order !== 'object' || order === null || Object.keys(order).sort().join(',') !== 'id,session_id') process.exit(1)
  if (!/^[0-9a-f-]{36}$/.test(order.id ?? '') || !/^cs_test_[A-Za-z0-9]+$/.test(order.session_id ?? '')) process.exit(1)
  console.log(`${order.id}\t${order.session_id}`)
}
NODE
      checkout_parser_exit=$?
      if [[ $checkout_parser_exit -ne 0 ]]; then
        cleanup_failed=1
      else
        while IFS=$'\t' read -r order_id session_id; do
        [[ -n "$order_id" && -n "$session_id" ]] || continue
        status_file="$temporary_directory/status-${order_id}.json"
        driver_request "{\"action\":\"checkout_status\",\"session_id\":\"$session_id\"}" "$status_file" || {
          cleanup_failed=1
          continue
        }
        checkout_state="$(STATUS_FILE="$status_file" node --input-type=module <<'NODE'
import fs from 'node:fs'
const value = JSON.parse(fs.readFileSync(process.env.STATUS_FILE, 'utf8'))
if (value.ok !== true || value.livemode !== false) process.exit(1)
if (value.status === 'complete' && value.payment_status === 'paid' && value.charge_paid === true) console.log('paid')
else if (value.status === 'open' && value.payment_status !== 'paid') console.log('open')
else if (value.status === 'expired' && value.payment_status !== 'paid') console.log('expired')
else if (value.status === 'complete' && value.payment_status !== 'paid') console.log('terminal-unpaid')
else process.exit(1)
NODE
)" || {
          cleanup_failed=1
          continue
        }
        event_id="evt_task17cleanup$(openssl rand -hex 12)"
        event_created="$(date +%s)"
        if [[ "$checkout_state" == paid ]]; then
          driver_request "{\"action\":\"deliver\",\"event\":{\"event_id\":\"$event_id\",\"type\":\"checkout.session.completed\",\"object\":\"checkout.session\",\"object_id\":\"$session_id\",\"created\":$event_created}}" \
            "$temporary_directory/deliver-${order_id}.json" && \
            validate_driver_output delivery "$temporary_directory/deliver-${order_id}.json" || cleanup_failed=1
          driver_request "{\"action\":\"create_refund\",\"order_id\":\"$order_id\"}" \
            "$temporary_directory/refund-${order_id}.json" && \
            validate_driver_output refund "$temporary_directory/refund-${order_id}.json" || cleanup_failed=1
        elif [[ "$checkout_state" == open ]]; then
          driver_request "{\"action\":\"expire_checkout\",\"session_id\":\"$session_id\"}" \
            "$temporary_directory/expire-${order_id}.json" && \
            validate_driver_output expiry "$temporary_directory/expire-${order_id}.json" || cleanup_failed=1
          driver_request "{\"action\":\"deliver\",\"event\":{\"event_id\":\"$event_id\",\"type\":\"checkout.session.expired\",\"object\":\"checkout.session\",\"object_id\":\"$session_id\",\"created\":$event_created}}" \
            "$temporary_directory/deliver-${order_id}.json" && \
            validate_driver_output delivery "$temporary_directory/deliver-${order_id}.json" || cleanup_failed=1
        elif [[ "$checkout_state" == expired ]]; then
          driver_request "{\"action\":\"deliver\",\"event\":{\"event_id\":\"$event_id\",\"type\":\"checkout.session.expired\",\"object\":\"checkout.session\",\"object_id\":\"$session_id\",\"created\":$event_created}}" \
            "$temporary_directory/deliver-${order_id}.json" && \
            validate_driver_output delivery "$temporary_directory/deliver-${order_id}.json" || cleanup_failed=1
        fi
        done <"$temporary_directory/checkout-orders.txt"
      fi
    fi
  fi

  if [[ $driver_deployed -eq 1 && $cleanup_failed -eq 0 ]]; then
    driver_request '{"action":"cleanup"}' "$temporary_directory/driver-cleanup.json" && \
      validate_driver_output cleanup "$temporary_directory/driver-cleanup.json" || cleanup_failed=1
  fi

  if [[ $cleanup_failed -eq 0 && ( -n "$organizer_a_id" || -n "$organizer_b_id" ) ]]; then
    local ids_sql=""
    [[ -n "$organizer_a_id" ]] && ids_sql="'$organizer_a_id'::uuid"
    [[ -n "$organizer_b_id" ]] && ids_sql="${ids_sql:+$ids_sql,}'$organizer_b_id'::uuid"
    "$supabase_cli" db query --linked "begin;
      create temporary table task18_events on commit drop as select id from public.events where organizer_id in ($ids_sql);
      create temporary table task18_orders on commit drop as select id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, last_stripe_event_id from public.orders where organizer_id in ($ids_sql);
      create temporary table task18_receipts on commit drop as
        select stripe_event_id from public.stripe_webhook_events where stripe_object_id in (
          select stripe_checkout_session_id from task18_orders union
          select stripe_payment_intent_id from task18_orders union
          select stripe_charge_id from task18_orders union
          select stripe_refund_id from public.refunds where order_id in (select id from task18_orders)
        ) or stripe_event_id in (
          select last_stripe_event_id from task18_orders union
          select stripe_event_id from public.refunds where order_id in (select id from task18_orders)
        );
      delete from public.disputes where order_id in (select id from task18_orders);
      delete from public.tickets where order_id in (select id from task18_orders);
      delete from public.refunds where order_id in (select id from task18_orders);
      delete from public.order_items where order_id in (select id from task18_orders);
      delete from public.orders where id in (select id from task18_orders);
      delete from public.stripe_webhook_events where stripe_event_id in (select stripe_event_id from task18_receipts);
      delete from public.ticket_tiers where event_id in (select id from task18_events);
      delete from public.events where id in (select id from task18_events);
      delete from public.organizer_stripe_accounts where organizer_id in ($ids_sql);
      delete from public.organizers where id in ($ids_sql);
      do \$\$ begin
        if exists (select 1 from public.stripe_webhook_events where stripe_event_id in (select stripe_event_id from task18_receipts))
          or exists (select 1 from public.orders where id in (select id from task18_orders))
          or exists (select 1 from public.events where id in (select id from task18_events))
          or exists (select 1 from public.organizers where id in ($ids_sql)) then
          raise exception 'TASK18_RESIDUE';
        end if;
      end \$\$;
      commit;" >"$temporary_directory/database-cleanup.log" 2>&1 || cleanup_failed=1
    delete_auth_user "$organizer_a_id" || cleanup_failed=1
    delete_auth_user "$organizer_b_id" || cleanup_failed=1
    "$supabase_cli" db query --linked "select
      (select count(*) from auth.users where id in ($ids_sql)) +
      (select count(*) from public.organizers where id in ($ids_sql)) +
      (select count(*) from public.events where organizer_id in ($ids_sql)) +
      (select count(*) from public.orders where organizer_id in ($ids_sql)) +
      (select count(*) from public.tickets where organizer_id in ($ids_sql)) +
      (select count(*) from public.organizer_stripe_accounts where organizer_id in ($ids_sql)) as residue_count;" \
      >"$temporary_directory/residue.json" 2>/dev/null || cleanup_failed=1
    grep -q '"residue_count": 0' "$temporary_directory/residue.json" || cleanup_failed=1
  fi

  if [[ $driver_deployed -eq 1 ]]; then
    "$supabase_cli" functions delete task17-transaction-driver --project-ref "$project_ref" --yes >/dev/null || cleanup_failed=1
  fi
  if [[ $driver_secret_configured -eq 1 ]]; then
    "$supabase_cli" secrets unset TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX \
      TASK17_CONNECTED_ACCOUNT_ID TASK17_CLOSE_CONNECTED_ACCOUNT \
      --project-ref "$project_ref" >/dev/null || cleanup_failed=1
  fi
  rm -f "$driver_file"
  rmdir "$driver_directory" 2>/dev/null || true

  if [[ -n "$project_ref" ]]; then
    "$supabase_cli" functions list --project-ref "$project_ref" --output json >"$temporary_directory/functions-after.json" 2>/dev/null || cleanup_failed=1
    "$supabase_cli" secrets list --project-ref "$project_ref" --output json >"$temporary_directory/secrets-after.json" 2>/dev/null || cleanup_failed=1
    FINAL_DIR="$temporary_directory" node --input-type=module <<'NODE' || cleanup_failed=1
import fs from 'node:fs'
const functions = JSON.parse(fs.readFileSync(`${process.env.FINAL_DIR}/functions-after.json`, 'utf8'))
const secrets = JSON.parse(fs.readFileSync(`${process.env.FINAL_DIR}/secrets-after.json`, 'utf8'))
const functionRows = Array.isArray(functions) ? functions : functions.functions ?? []
const secretRows = Array.isArray(secrets) ? secrets : secrets.secrets ?? []
const temporaryNames = new Set(['TASK17_PROOF_TOKEN','TASK17_FIXTURE_PREFIX','TASK17_CONNECTED_ACCOUNT_ID','TASK17_CLOSE_CONNECTED_ACCOUNT'])
if (functionRows.some((row) => row.slug === 'task17-transaction-driver')) process.exit(1)
if (secretRows.some((row) => temporaryNames.has(row.name))) process.exit(1)
NODE
  fi

  rm -rf -- "$temporary_directory"
  if [[ $cleanup_failed -ne 0 ]]; then
    printf '%s\n' 'Task 18 exact cleanup verification: fail' >&2
    exit 1
  fi
  printf '%s\n' 'Task 18 exact cleanup verification: pass'
  exit "$original_status"
}

trap cleanup EXIT HUP INT TERM
cd "$repository_root"

[[ -x "$supabase_cli" ]] || { printf '%s\n' 'Missing project-local Supabase CLI.' >&2; exit 1; }
[[ -f "$driver_source" ]] || { printf '%s\n' 'Missing committed transaction driver.' >&2; exit 1; }
[[ ! -e "$driver_file" ]] || { printf '%s\n' 'Refusing to overwrite a materialized driver.' >&2; exit 1; }

project_ref="$(tr -d '\r\n' < supabase/.temp/project-ref)"
[[ "$project_ref" =~ ^[a-z0-9]{20}$ ]] || { printf '%s\n' 'Invalid linked project reference.' >&2; exit 1; }
supabase_url="https://${project_ref}.supabase.co"
stripe_publishable="$(read_public_env VITE_STRIPE_PUBLISHABLE_KEY VITE_STRIPE_PUBLISHABLE_KEY)"
mapbox_token="$(read_public_env VITE_MAPBOX_ACCESS_TOKEN VITE_MAPBOX_ACCESS_TOKEN)"
connected_account_id="${TEST_CONNECTED_ACCOUNT_ID-}"
[[ "$stripe_publishable" == pk_test_* ]] || { printf '%s\n' 'Missing Stripe TEST publishable key.' >&2; exit 1; }
[[ "$mapbox_token" == pk.* ]] || { printf '%s\n' 'Missing public Mapbox token.' >&2; exit 1; }
[[ "$connected_account_id" == acct_* ]] || { printf '%s\n' 'Missing disposable TEST connected account.' >&2; exit 1; }
[[ "${TEST_CONNECTED_ACCOUNT_DISPOSABLE-}" == 1 ]] || { printf '%s\n' 'TEST_CONNECTED_ACCOUNT_DISPOSABLE must equal 1.' >&2; exit 1; }

"$supabase_cli" projects list --output json >"$temporary_directory/projects.json"
PROJECT_REF="$project_ref" PROJECTS_FILE="$temporary_directory/projects.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const projects = JSON.parse(fs.readFileSync(process.env.PROJECTS_FILE, 'utf8'))
const linked = projects.filter((project) => project.linked === true)
if (linked.length !== 1 || linked[0].id !== process.env.PROJECT_REF || linked[0].status !== 'ACTIVE_HEALTHY') process.exit(1)
NODE
"$supabase_cli" migration list --linked >"$temporary_directory/migrations.json"
MIGRATIONS_FILE="$temporary_directory/migrations.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const value = JSON.parse(fs.readFileSync(process.env.MIGRATIONS_FILE, 'utf8'))
if (!Array.isArray(value.migrations) || value.migrations.some((row) => !row.local || row.local !== row.remote)) process.exit(1)
NODE
"$supabase_cli" functions list --project-ref "$project_ref" --output json >"$temporary_directory/functions-before.json"
"$supabase_cli" secrets list --project-ref "$project_ref" --output json >"$temporary_directory/secrets-before.json"
PRECHECK_DIR="$temporary_directory" node --input-type=module <<'NODE'
import fs from 'node:fs'
const functions = JSON.parse(fs.readFileSync(`${process.env.PRECHECK_DIR}/functions-before.json`, 'utf8'))
const secrets = JSON.parse(fs.readFileSync(`${process.env.PRECHECK_DIR}/secrets-before.json`, 'utf8'))
const functionRows = Array.isArray(functions) ? functions : functions.functions ?? []
const secretRows = Array.isArray(secrets) ? secrets : secrets.secrets ?? []
const temporaryNames = new Set(['TASK17_PROOF_TOKEN','TASK17_FIXTURE_PREFIX','TASK17_CONNECTED_ACCOUNT_ID','TASK17_CLOSE_CONNECTED_ACCOUNT'])
if (functionRows.some((row) => row.slug === 'task17-transaction-driver')) process.exit(1)
if (secretRows.some((row) => temporaryNames.has(row.name))) process.exit(1)
NODE

"$supabase_cli" projects api-keys --project-ref "$project_ref" --reveal --output json >"$temporary_directory/api-keys.json"
KEYS_FILE="$temporary_directory/api-keys.json" OUTPUT_DIR="$temporary_directory" node --input-type=module <<'NODE'
import fs from 'node:fs'
const keys = JSON.parse(fs.readFileSync(process.env.KEYS_FILE, 'utf8'))
const publishable = keys.find((key) => key.type === 'publishable')?.api_key
const secret = keys.find((key) => key.type === 'secret')?.api_key
if (!publishable?.startsWith('sb_publishable_') || !secret?.startsWith('sb_secret_')) process.exit(1)
fs.writeFileSync(`${process.env.OUTPUT_DIR}/publishable`, publishable, { mode: 0o600 })
fs.writeFileSync(`${process.env.OUTPUT_DIR}/admin`, secret, { mode: 0o600 })
NODE
publishable_key="$(<"$temporary_directory/publishable")"
admin_key="$(<"$temporary_directory/admin")"
printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' \
  "$admin_key" "$admin_key" >"$temporary_directory/admin-curl.conf"
chmod 600 "$temporary_directory/admin-curl.conf"

create_user() {
  local email="$1" password="$2" label="$3"
  EMAIL="$email" PASSWORD="$password" OUTPUT="$temporary_directory/create-${label}.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
fs.writeFileSync(process.env.OUTPUT, JSON.stringify({email: process.env.EMAIL, password: process.env.PASSWORD, email_confirm: true}), {mode: 0o600})
NODE
  curl --silent --show-error --fail-with-body --config "$temporary_directory/admin-curl.conf" \
    --request POST "$supabase_url/auth/v1/admin/users" --data-binary "@$temporary_directory/create-${label}.json" \
    --output "$temporary_directory/user-${label}.json"
  USER_FILE="$temporary_directory/user-${label}.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const id = JSON.parse(fs.readFileSync(process.env.USER_FILE, 'utf8')).id
if (!/^[0-9a-f-]{36}$/.test(id ?? '')) process.exit(1)
process.stdout.write(id)
NODE
}

organizer_a_id="$(create_user "$organizer_a_email" "$organizer_a_password" a)"
organizer_b_id="$(create_user "$organizer_b_email" "$organizer_b_password" b)"
"$supabase_cli" db query --linked "begin;
  insert into public.organizers (id, display_name, organizer_type, country_code, onboarding_completed_at) values
    ('$organizer_a_id', 'Whereto Task 18 Organizer', 'Integration test organizer', 'US', now()),
    ('$organizer_b_id', 'Whereto Task 18 Cross Organizer', 'Integration test organizer', 'US', now());
  insert into public.organizer_stripe_accounts (organizer_id, stripe_account_id, transfers_status, payouts_status, requirements_status, requirements_currently_due_count, requirements_past_due_count, last_synced_at)
    values ('$organizer_a_id', '$connected_account_id', 'active', 'active', 'clear', 0, 0, now());
  commit;" >"$temporary_directory/setup.log" 2>&1

mkdir -p "$driver_directory"
install -m 600 "$driver_source" "$driver_file"
cat >"$temporary_directory/driver-secrets.env" <<EOF
TASK17_PROOF_TOKEN=$proof_token
TASK17_FIXTURE_PREFIX=$driver_prefix
TASK17_CONNECTED_ACCOUNT_ID=$connected_account_id
TASK17_CLOSE_CONNECTED_ACCOUNT=true
EOF
chmod 600 "$temporary_directory/driver-secrets.env"
"$supabase_cli" secrets set --env-file "$temporary_directory/driver-secrets.env" --project-ref "$project_ref" >/dev/null
driver_secret_configured=1
"$supabase_cli" functions deploy task17-transaction-driver --project-ref "$project_ref" \
  --no-verify-jwt --import-map deno.json >/dev/null
driver_deployed=1
function_url="$supabase_url/functions/v1/task17-transaction-driver"
driver_request '{"action":"server_proof"}' "$temporary_directory/server-proof.json"
PROOF_FILE="$temporary_directory/server-proof.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const proof = JSON.parse(fs.readFileSync(process.env.PROOF_FILE, 'utf8'))
if (proof.ok !== true || proof.livemode !== false || proof.connected_account_matches !== true || proof.transfers_status !== 'active' || proof.payouts_status !== 'active' || proof.requirements_status !== 'clear') process.exit(1)
NODE

TEST_SUPABASE_URL="$supabase_url" \
TEST_SUPABASE_PUBLISHABLE_KEY="$publishable_key" \
TEST_ORGANIZER_A_EMAIL="$organizer_a_email" \
TEST_ORGANIZER_A_PASSWORD="$organizer_a_password" \
TEST_ORGANIZER_B_EMAIL="$organizer_b_email" \
TEST_ORGANIZER_B_PASSWORD="$organizer_b_password" \
VITE_MAPBOX_ACCESS_TOKEN="$mapbox_token" \
VITE_STRIPE_PUBLISHABLE_KEY="$stripe_publishable" \
TEST_TASK18_FUNCTION_URL="$function_url" \
TEST_TASK18_DRIVER_TOKEN="$proof_token" \
TEST_TASK18_FIXTURE_PREFIX="$browser_prefix" \
  pnpm test:e2e

printf '%s\n' 'Task 18 browser proof passed; reconciliation and exact cleanup run on EXIT.'
