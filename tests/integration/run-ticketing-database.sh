#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
chmod 700 "$temporary_directory"

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

cleanup() {
  original_exit=$?
  trap - EXIT
  set +e

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

    "$supabase_cli" db query --linked "begin;
      delete from public.refunds where order_id in (select id from public.orders where organizer_id in ($ids_sql));
      delete from public.disputes where order_id in (select id from public.orders where organizer_id in ($ids_sql));
      delete from public.tickets where organizer_id in ($ids_sql);
      delete from public.order_items where order_id in (select id from public.orders where organizer_id in ($ids_sql));
      delete from public.orders where organizer_id in ($ids_sql);
      delete from public.ticket_tiers where event_id in (select id from public.events where organizer_id in ($ids_sql));
      delete from public.organizer_stripe_accounts where organizer_id in ($ids_sql);
      delete from public.events where organizer_id in ($ids_sql);
      delete from public.organizers where id in ($ids_sql);
      commit;" >"$temporary_directory/cleanup-database.log" 2>&1
    database_cleanup_exit=$?

    delete_auth_user "$organizer_a_id"
    auth_a_cleanup_exit=$?
    delete_auth_user "$organizer_b_id"
    auth_b_cleanup_exit=$?

    "$supabase_cli" db query --linked "select
      (select count(*) from auth.users where id in ($ids_sql))
      + (select count(*) from public.organizers where id in ($ids_sql))
      + (select count(*) from public.events where organizer_id in ($ids_sql))
      + (select count(*) from public.ticket_tiers where event_id in (select id from public.events where organizer_id in ($ids_sql)))
      + (select count(*) from public.organizer_stripe_accounts where organizer_id in ($ids_sql))
      + (select count(*) from public.orders where organizer_id in ($ids_sql))
      + (select count(*) from public.tickets where organizer_id in ($ids_sql))
      as residue_count;" >"$temporary_directory/residue.log" 2>&1
    residue_exit=$?
    grep -q '"residue_count": 0' "$temporary_directory/residue.log"
    residue_zero_exit=$?

    if [[ $database_cleanup_exit -ne 0 || $auth_a_cleanup_exit -ne 0 || $auth_b_cleanup_exit -ne 0 || $residue_exit -ne 0 || $residue_zero_exit -ne 0 ]]; then
      echo "Exact Task 16 fixture cleanup or zero-residue proof failed." >&2
      sed -n '1,120p' "$temporary_directory/cleanup-database.log" >&2
      sed -n '1,80p' "$temporary_directory/residue.log" >&2
      cleanup_exit=1
    else
      cleanup_exit=0
    fi
  else
    cleanup_exit=0
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
