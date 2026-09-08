#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
chmod 700 "$temporary_directory"
cleanup_targets_file="$temporary_directory/cleanup-targets.json"
checkout_switch_state_file="$temporary_directory/checkout-switch-prior"
checkout_switch_captured=0

organizer_a_id=""
organizer_b_id=""
run_id="$(openssl rand -hex 12)"
organizer_a_email="whereto-task16-a-${run_id}@example.invalid"
organizer_b_email="whereto-task16-b-${run_id}@example.invalid"
organizer_a_password="Task16-A-$(openssl rand -hex 18)"
organizer_b_password="Task16-B-$(openssl rand -hex 18)"

if [[ ! -x "$supabase_cli" ]]; then
  echo "Supabase CLI is not installed at the project-local path." >&2
  exit 1
fi

project_ref="$(tr -d '\r\n' < "$repository_root/supabase/.temp/project-ref")"
supabase_url="https://${project_ref}.supabase.co"

delete_auth_user() {
  local user_id="$1"
  [[ -z "$user_id" ]] && return 0
  curl --silent --show-error --fail-with-body \
    --config "$temporary_directory/admin-curl.conf" \
    --request DELETE "$supabase_url/auth/v1/admin/users/$user_id" \
    --output "$temporary_directory/delete-${user_id}.json"
}

capture_checkout_switch() {
  "$supabase_cli" db query --linked --output-format json \
    "select checkout_creation_enabled as enabled from private.checkout_runtime_control where singleton;" \
    >"$temporary_directory/checkout-switch-read.json"
  CHECKOUT_SWITCH_READ_FILE="$temporary_directory/checkout-switch-read.json" \
  CHECKOUT_SWITCH_STATE_FILE="$checkout_switch_state_file" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.CHECKOUT_SWITCH_READ_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
if (typeof row?.enabled !== 'boolean') process.exit(1)
fs.writeFileSync(process.env.CHECKOUT_SWITCH_STATE_FILE, `${row.enabled}\n`, { mode: 0o600 })
NODE
  chmod 600 "$checkout_switch_state_file"
  checkout_switch_captured=1
}

enable_checkout_for_fixture() {
  "$supabase_cli" db query --linked "update private.checkout_runtime_control
    set checkout_creation_enabled = true, updated_at = statement_timestamp()
    where singleton;" >"$temporary_directory/checkout-switch-enable.log" 2>&1
}

restore_checkout_switch() {
  [[ $checkout_switch_captured -eq 1 && -f "$checkout_switch_state_file" ]] || return 0
  local prior_state
  prior_state="$(tr -d '\r\n' <"$checkout_switch_state_file")"
  [[ "$prior_state" == true || "$prior_state" == false ]] || return 1
  "$supabase_cli" db query --linked --output-format json "with restored as (
      update private.checkout_runtime_control
      set checkout_creation_enabled = $prior_state, updated_at = statement_timestamp()
      where singleton
      returning checkout_creation_enabled
    ) select checkout_creation_enabled = $prior_state as restored from restored;" \
    >"$temporary_directory/checkout-switch-restore.json"
  grep -q '"restored": true' "$temporary_directory/checkout-switch-restore.json"
}

capture_cleanup_targets() {
  local read_file="$temporary_directory/cleanup-targets-read.json"
  local next_file="$temporary_directory/cleanup-targets-next.json"
  "$supabase_cli" db query --linked --output-format json "select jsonb_build_object(
      'event_ids', coalesce((select jsonb_agg(id order by id) from public.events where organizer_id in ($ids_sql)), '[]'::jsonb),
      'tier_ids', coalesce((select jsonb_agg(ticket_tiers.id order by ticket_tiers.id)
        from public.ticket_tiers join public.events on events.id = ticket_tiers.event_id
        where events.organizer_id in ($ids_sql)), '[]'::jsonb),
      'order_ids', coalesce((select jsonb_agg(id order by id) from public.orders where organizer_id in ($ids_sql)), '[]'::jsonb)
    ) as targets;" >"$read_file" || { rm -f -- "$read_file" "$next_file"; return 1; }
  CLEANUP_TARGETS_READ_FILE="$read_file" \
  CLEANUP_TARGETS_FILE="$next_file" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.CLEANUP_TARGETS_READ_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
const targets = row?.targets
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
if (!targets || !['event_ids', 'tier_ids', 'order_ids'].every((key) => Array.isArray(targets[key]) && targets[key].every((id) => typeof id === 'string' && uuid.test(id)))) process.exit(1)
fs.writeFileSync(process.env.CLEANUP_TARGETS_FILE, JSON.stringify(targets), { mode: 0o600 })
NODE
  [[ $? -eq 0 ]] || { rm -f -- "$read_file" "$next_file"; return 1; }
  chmod 600 "$next_file" || { rm -f -- "$read_file" "$next_file"; return 1; }
  mv -f -- "$next_file" "$cleanup_targets_file" || { rm -f -- "$read_file" "$next_file"; return 1; }
  rm -f -- "$read_file" || return 1
}

load_cleanup_ids_sql() {
  local field="$1"
  CLEANUP_TARGETS_FILE="$cleanup_targets_file" CLEANUP_FIELD="$field" node --input-type=module <<'NODE'
import fs from 'node:fs'
const ids = JSON.parse(fs.readFileSync(process.env.CLEANUP_TARGETS_FILE, 'utf8'))[process.env.CLEANUP_FIELD]
if (!Array.isArray(ids)) process.exit(1)
process.stdout.write(ids.length === 0 ? 'array[]::uuid[]' : `array[${ids.map((id) => `'${id}'::uuid`).join(',')}]`)
NODE
}

build_cleanup_sql() {
  printf '%s\n' "begin;
      set local session_replication_role = replica;
      delete from public.refunds where order_id = any($order_ids_sql);
      delete from public.disputes where order_id = any($order_ids_sql);
      delete from public.tickets where organizer_id in ($ids_sql);
      delete from public.order_items where order_id = any($order_ids_sql) or ticket_tier_id = any($tier_ids_sql);
      delete from public.orders where id = any($order_ids_sql);
      delete from public.ticket_tiers where id = any($tier_ids_sql);
      delete from public.organizer_stripe_accounts where organizer_id in ($ids_sql);
      delete from private.event_public_eligibility_intervals where event_id = any($event_ids_sql);
      delete from private.event_reports where event_id = any($event_ids_sql);
      delete from private.moderation_review_requests where event_id = any($event_ids_sql);
      delete from private.event_moderation_evaluations where event_id = any($event_ids_sql);
      delete from private.event_moderation_actions where event_id = any($event_ids_sql);
      delete from private.event_policy_acceptances where event_id = any($event_ids_sql);
      delete from private.event_policy_legacy_exemptions where event_id = any($event_ids_sql);
      delete from private.event_legacy_history_resolutions where event_id = any($event_ids_sql);
      delete from private.event_risk_disclosures where event_id = any($event_ids_sql);
      delete from public.events where id = any($event_ids_sql);
      delete from public.organizers where id in ($ids_sql);
      commit;"
}

cleanup() {
  original_exit=$?
  trap - EXIT
  set +e

  restore_checkout_switch
  checkout_switch_cleanup_exit=$?

  if [[ -z "$organizer_a_id" && -f "$temporary_directory/user-a.json" ]]; then
    organizer_a_id="$(USER_FILE="$temporary_directory/user-a.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
try {
  const id = JSON.parse(fs.readFileSync(process.env.USER_FILE, 'utf8')).id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id ?? '')) process.stdout.write(id)
} catch {}
NODE
)"
  fi
  if [[ -z "$organizer_b_id" && -f "$temporary_directory/user-b.json" ]]; then
    organizer_b_id="$(USER_FILE="$temporary_directory/user-b.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
try {
  const id = JSON.parse(fs.readFileSync(process.env.USER_FILE, 'utf8')).id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id ?? '')) process.stdout.write(id)
} catch {}
NODE
)"
  fi

  if [[ -n "$organizer_a_id" || -n "$organizer_b_id" ]]; then
    ids_sql=""
    [[ -n "$organizer_a_id" ]] && ids_sql="'$organizer_a_id'::uuid"
    if [[ -n "$organizer_b_id" ]]; then
      [[ -n "$ids_sql" ]] && ids_sql="$ids_sql,"
      ids_sql="$ids_sql'$organizer_b_id'::uuid"
    fi

    event_ids_sql=""
    tier_ids_sql=""
    order_ids_sql=""
    capture_targets_exit=0
    if capture_cleanup_targets; then
      event_ids_sql="$(load_cleanup_ids_sql event_ids)" || capture_targets_exit=1
      tier_ids_sql="$(load_cleanup_ids_sql tier_ids)" || capture_targets_exit=1
      order_ids_sql="$(load_cleanup_ids_sql order_ids)" || capture_targets_exit=1
      if [[ -n "$event_ids_sql" && -n "$tier_ids_sql" && -n "$order_ids_sql" ]]; then
        capture_targets_exit=${capture_targets_exit:-0}
      else
        capture_targets_exit=1
      fi
    else
      capture_targets_exit=$?
    fi

    if [[ $capture_targets_exit -ne 0 ]]; then
      echo "Fresh ticketing cleanup targets could not be captured; refusing destructive cleanup." >&2
      cleanup_exit=1
    else
      "$supabase_cli" db query --linked "$(build_cleanup_sql)" >"$temporary_directory/cleanup-database.log" 2>&1
      database_cleanup_exit=$?

      delete_auth_user "$organizer_a_id"
      auth_a_cleanup_exit=$?
      delete_auth_user "$organizer_b_id"
      auth_b_cleanup_exit=$?

      "$supabase_cli" db query --linked "select
      (select count(*) from auth.users where id in ($ids_sql))
      + (select count(*) from public.organizers where id in ($ids_sql))
      + (select count(*) from public.events where id = any($event_ids_sql))
      + (select count(*) from public.ticket_tiers where id = any($tier_ids_sql))
      + (select count(*) from public.organizer_stripe_accounts where organizer_id in ($ids_sql))
      + (select count(*) from public.orders where id = any($order_ids_sql))
      + (select count(*) from public.order_items where order_id = any($order_ids_sql) or ticket_tier_id = any($tier_ids_sql))
      + (select count(*) from public.tickets where organizer_id in ($ids_sql))
      + (select count(*) from public.refunds where order_id = any($order_ids_sql))
      + (select count(*) from public.disputes where order_id = any($order_ids_sql))
      + (select count(*) from private.event_public_eligibility_intervals where event_id = any($event_ids_sql))
      + (select count(*) from private.event_reports where event_id = any($event_ids_sql))
      + (select count(*) from private.moderation_review_requests where event_id = any($event_ids_sql))
      + (select count(*) from private.event_moderation_evaluations where event_id = any($event_ids_sql))
      + (select count(*) from private.event_moderation_actions where event_id = any($event_ids_sql))
      + (select count(*) from private.event_policy_acceptances where event_id = any($event_ids_sql))
      + (select count(*) from private.event_policy_legacy_exemptions where event_id = any($event_ids_sql))
      + (select count(*) from private.event_legacy_history_resolutions where event_id = any($event_ids_sql))
      + (select count(*) from private.event_risk_disclosures where event_id = any($event_ids_sql))
      as residue_count;" >"$temporary_directory/residue.log" 2>&1
      residue_exit=$?
      grep -q '"residue_count": 0' "$temporary_directory/residue.log"
      residue_zero_exit=$?

      if [[ $checkout_switch_cleanup_exit -ne 0 || $database_cleanup_exit -ne 0 || $auth_a_cleanup_exit -ne 0 || $auth_b_cleanup_exit -ne 0 || $residue_exit -ne 0 || $residue_zero_exit -ne 0 ]]; then
        echo "Exact Task 11 fixture cleanup, switch restoration, or zero-residue proof failed." >&2
        sed -n '1,120p' "$temporary_directory/cleanup-database.log" >&2
        sed -n '1,80p' "$temporary_directory/residue.log" >&2
        cleanup_exit=1
      else
        cleanup_exit=0
      fi
    fi
  else
    cleanup_exit=$checkout_switch_cleanup_exit
  fi

  rm -rf -- "$temporary_directory"
  if [[ $original_exit -ne 0 ]]; then
    exit "$original_exit"
  fi
  exit "$cleanup_exit"
}

trap cleanup EXIT

"$supabase_cli" projects list --output json >"$temporary_directory/projects.json"
PROJECT_REF="$project_ref" PROJECTS_FILE="$temporary_directory/projects.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const projects = JSON.parse(fs.readFileSync(process.env.PROJECTS_FILE, 'utf8'))
const linked = projects.filter((project) => project.linked === true)
if (linked.length !== 1 || linked[0].id !== process.env.PROJECT_REF || linked[0].status !== 'ACTIVE_HEALTHY') process.exit(1)
NODE

"$supabase_cli" migration list --linked >"$temporary_directory/migrations.log"
MIGRATIONS_FILE="$temporary_directory/migrations.log" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.MIGRATIONS_FILE, 'utf8'))
if (!Array.isArray(payload.migrations) || payload.migrations.length === 0 ||
    payload.migrations.some((migration) => !migration.local || migration.local !== migration.remote)) {
  console.error('Local and linked migration histories are not aligned.')
  process.exit(1)
}
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

"$supabase_cli" projects api-keys --project-ref "$project_ref" --reveal --output json >"$temporary_directory/api-keys.json"
KEYS_FILE="$temporary_directory/api-keys.json" OUTPUT_DIR="$temporary_directory" node --input-type=module <<'NODE'
import fs from 'node:fs'
const keys = JSON.parse(fs.readFileSync(process.env.KEYS_FILE, 'utf8'))
const publishable = keys.find((key) => key.type === 'publishable')?.api_key
const secret = keys.find((key) => key.type === 'secret')?.api_key
if (typeof publishable !== 'string' || !publishable.startsWith('sb_publishable_')) process.exit(1)
if (typeof secret !== 'string' || !secret.startsWith('sb_secret_')) process.exit(1)
fs.writeFileSync(`${process.env.OUTPUT_DIR}/publishable-key`, publishable, { mode: 0o600 })
fs.writeFileSync(`${process.env.OUTPUT_DIR}/admin-key`, secret, { mode: 0o600 })
NODE

publishable_key="$(<"$temporary_directory/publishable-key")"
admin_key="$(<"$temporary_directory/admin-key")"
printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' \
  "$admin_key" "$admin_key" >"$temporary_directory/admin-curl.conf"
chmod 600 "$temporary_directory/admin-curl.conf"

create_user() {
  local email="$1"
  local password="$2"
  local label="$3"
  EMAIL="$email" PASSWORD="$password" RUN_ID="$run_id" LABEL="$label" OUTPUT_FILE="$temporary_directory/create-${label}.json" \
    node --input-type=module <<'NODE'
import fs from 'node:fs'
fs.writeFileSync(process.env.OUTPUT_FILE, JSON.stringify({
  email: process.env.EMAIL,
  password: process.env.PASSWORD,
  email_confirm: true,
  user_metadata: { whereto_test_run: process.env.RUN_ID, whereto_test_role: process.env.LABEL },
}), { mode: 0o600 })
NODE
  curl --silent --show-error --fail-with-body \
    --config "$temporary_directory/admin-curl.conf" \
    --request POST "$supabase_url/auth/v1/admin/users" \
    --data-binary "@$temporary_directory/create-${label}.json" \
    --output "$temporary_directory/user-${label}.json"
  USER_FILE="$temporary_directory/user-${label}.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const user = JSON.parse(fs.readFileSync(process.env.USER_FILE, 'utf8'))
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(user.id ?? '')) process.exit(1)
process.stdout.write(user.id)
NODE
}

organizer_a_id="$(create_user "$organizer_a_email" "$organizer_a_password" a)"
organizer_b_id="$(create_user "$organizer_b_email" "$organizer_b_password" b)"

"$supabase_cli" db query --linked "begin;
  insert into public.organizers (id, display_name, organizer_type, onboarding_completed_at)
  values
    ('$organizer_a_id', 'Task 16 Organizer A', 'Integration test organizer', now()),
    ('$organizer_b_id', 'Task 16 Organizer B', 'Integration test organizer', now());
  insert into public.organizer_stripe_accounts (
    organizer_id, stripe_account_id, transfers_status, payouts_status,
    requirements_status, requirements_currently_due_count,
    requirements_past_due_count, last_synced_at
  ) values (
    '$organizer_a_id', 'acct_task16${run_id}', 'active', 'active', 'clear', 0, 0, now()
  );
  commit;" >"$temporary_directory/setup.log" 2>&1

capture_checkout_switch
enable_checkout_for_fixture

if [[ "${WHERETO_TEST_ABORT_AFTER_CHECKOUT_SWITCH:-}" == "1" ]]; then
  exit 86
fi

TEST_SUPABASE_URL="$supabase_url" \
TEST_SUPABASE_PUBLISHABLE_KEY="$publishable_key" \
TEST_ORGANIZER_A_EMAIL="$organizer_a_email" \
TEST_ORGANIZER_A_PASSWORD="$organizer_a_password" \
TEST_ORGANIZER_B_EMAIL="$organizer_b_email" \
TEST_ORGANIZER_B_PASSWORD="$organizer_b_password" \
  pnpm exec vitest run --config vitest.integration.config.ts \
    tests/integration/ticketing-database.test.ts \
    tests/integration/ticketing-concurrency.test.ts

"$repository_root/tests/integration/ticketing-final-inventory-race.sh"

echo "Hosted ticketing database gate passed; exact cleanup runs on EXIT."
