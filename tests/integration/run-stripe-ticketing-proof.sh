#!/bin/sh
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
DRIVER_SOURCE="$SCRIPT_DIR/edge/task17-transaction-driver/index.ts"
DRIVER_CONTRACTS_SOURCE="$SCRIPT_DIR/edge/task17-transaction-driver/contracts.ts"
MATERIALIZED_DIR="$REPO_ROOT/supabase/functions/task17-transaction-driver"
MATERIALIZED_SOURCE="$MATERIALIZED_DIR/index.ts"
MATERIALIZED_CONTRACTS_SOURCE="$MATERIALIZED_DIR/contracts.ts"
MATERIALIZED_CREATED=0
MATERIALIZED_DIR_CREATED=0
PROJECT_REF_FILE="$REPO_ROOT/supabase/.temp/project-ref"
ENV_FILE="$REPO_ROOT/.env.local"
TEMP_DIR=""
TEMP_SECRET_FILE=""
CURL_CONFIG=""
CLEANUP_RESPONSE=""
CHECKOUT_SWITCH_STATE_FILE=""
DRIVER_DEPLOYED=0
DRIVER_DELETE_REQUIRED=0
TEMP_SECRETS_SET=0
CHECKOUT_SWITCH_CAPTURED=0
TEARDOWN_FAILURE=0

read_public_env() {
  variable_name=$1
  fallback_name=$2
  eval "current_value=\${$variable_name-}"
  if [ -n "$current_value" ]; then
    printf '%s' "$current_value"
    return
  fi
  if [ ! -f "$ENV_FILE" ]; then
    return
  fi
  awk -F= -v name="$fallback_name" '$1 == name { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

remote_function_count() {
  list_file=$1
  node -e '
    const fs = require("node:fs");
    const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const functions = Array.isArray(parsed) ? parsed : (parsed.functions ?? []);
    process.stdout.write(String(functions.filter((item) => item.slug === "task17-transaction-driver").length));
  ' "$list_file"
}

temporary_secret_count() {
  list_file=$1
  node -e '
    const fs = require("node:fs");
    const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const secrets = Array.isArray(parsed) ? parsed : (parsed.secrets ?? []);
    const names = new Set(["TASK17_PROOF_TOKEN", "TASK17_FIXTURE_PREFIX", "TASK17_CONNECTED_ACCOUNT_ID", "TASK17_CLOSE_CONNECTED_ACCOUNT"]);
    process.stdout.write(String(secrets.filter((item) => names.has(item.name)).length));
  ' "$list_file"
}

capture_checkout_switch() {
  switch_read="$TEMP_DIR/checkout-switch-read.json"
  CHECKOUT_SWITCH_STATE_FILE="$TEMP_DIR/checkout-switch-prior"
  pnpm exec supabase db query --linked --output-format json \
    "select checkout_creation_enabled as enabled from private.checkout_runtime_control where singleton;" \
    > "$switch_read"
  SWITCH_READ_FILE="$switch_read" SWITCH_STATE_FILE="$CHECKOUT_SWITCH_STATE_FILE" \
    node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.SWITCH_READ_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
if (typeof row?.enabled !== 'boolean') process.exit(1)
fs.writeFileSync(process.env.SWITCH_STATE_FILE, `${row.enabled}\n`, { mode: 0o600 })
NODE
  chmod 600 "$switch_read" "$CHECKOUT_SWITCH_STATE_FILE"
  CHECKOUT_SWITCH_CAPTURED=1
}

enable_checkout_for_fixture() {
  switch_enable="$TEMP_DIR/checkout-switch-enable.json"
  pnpm exec supabase db query --linked --output-format json "with enabled as (
      update private.checkout_runtime_control
      set checkout_creation_enabled = true, updated_at = statement_timestamp()
      where singleton
      returning checkout_creation_enabled
    ) select checkout_creation_enabled = true as enabled from enabled;" \
    > "$switch_enable"
  SWITCH_ENABLE_FILE="$switch_enable" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.SWITCH_ENABLE_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
if (row?.enabled !== true) process.exit(1)
NODE
  chmod 600 "$switch_enable"
}

restore_checkout_switch() {
  [ "$CHECKOUT_SWITCH_CAPTURED" -eq 1 ] || return 0
  [ -f "$CHECKOUT_SWITCH_STATE_FILE" ] || return 1
  prior_state=$(tr -d '\r\n' < "$CHECKOUT_SWITCH_STATE_FILE")
  case "$prior_state" in true|false) ;; *) return 1 ;; esac
  switch_restore="$TEMP_DIR/checkout-switch-restore.json"
  pnpm exec supabase db query --linked --output-format json "with restored as (
      update private.checkout_runtime_control
      set checkout_creation_enabled = $prior_state, updated_at = statement_timestamp()
      where singleton
      returning checkout_creation_enabled
    ) select checkout_creation_enabled = $prior_state as restored from restored;" \
    > "$switch_restore"
  SWITCH_RESTORE_FILE="$switch_restore" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.SWITCH_RESTORE_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
if (row?.restored !== true) process.exit(1)
NODE
  chmod 600 "$switch_restore"
}

cleanup() {
  original_status=$?
  trap - EXIT HUP INT TERM
  set +e

  restore_checkout_switch
  [ $? -eq 0 ] || TEARDOWN_FAILURE=1

  if [ "$DRIVER_DEPLOYED" -eq 1 ] && [ -n "$CURL_CONFIG" ] && [ -f "$CURL_CONFIG" ]; then
    curl --silent --show-error --fail-with-body --config "$CURL_CONFIG" > "$CLEANUP_RESPONSE"
    cleanup_status=$?
    if [ "$cleanup_status" -ne 0 ]; then
      node -e '
        const fs = require("node:fs");
        const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const allowed = new Set(["CONFIG", "DATABASE", "INPUT", "LIVE_MODE_FORBIDDEN", "STRIPE", "UNKNOWN"]);
        if (allowed.has(value.kind) || /^DATABASE_DELETE_[A-Z_]+$/.test(value.kind)) {
          process.stdout.write(`Task 17 cleanup error kind: ${value.kind}\n`);
        }
      ' "$CLEANUP_RESPONSE" 2>/dev/null || true
    fi
    if [ "$cleanup_status" -ne 0 ] || ! node -e '
      const fs = require("node:fs");
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const counts = ["event_count", "organizer_count", "connect_count", "order_count", "tier_count", "receipt_count", "ticket_count", "dispute_count", "refund_count", "item_count"];
      if (value.ok !== true || value.auth_user_absent !== true || value.connected_account_closed !== true || !counts.every((name) => value[name] === 0)) process.exit(1);
    ' "$CLEANUP_RESPONSE"; then
      TEARDOWN_FAILURE=1
    fi
  fi

  if [ "$DRIVER_DELETE_REQUIRED" -eq 1 ]; then
    pnpm exec supabase functions delete task17-transaction-driver \
      --project-ref "$PROJECT_REF" --yes >/dev/null
    [ $? -eq 0 ] || TEARDOWN_FAILURE=1
  fi
  if [ "$TEMP_SECRETS_SET" -eq 1 ]; then
    pnpm exec supabase secrets unset \
      TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID \
      TASK17_CLOSE_CONNECTED_ACCOUNT \
      --project-ref "$PROJECT_REF" >/dev/null
    [ $? -eq 0 ] || TEARDOWN_FAILURE=1
  fi

  if [ "$MATERIALIZED_CREATED" -eq 1 ]; then
    rm -f "$MATERIALIZED_SOURCE" "$MATERIALIZED_CONTRACTS_SOURCE"
  fi
  if [ "$MATERIALIZED_DIR_CREATED" -eq 1 ]; then
    rmdir "$MATERIALIZED_DIR" 2>/dev/null || true
  fi

  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    functions_after="$TEMP_DIR/functions-after.json"
    secrets_after="$TEMP_DIR/secrets-after.json"
    pnpm exec supabase functions list --project-ref "$PROJECT_REF" --output json > "$functions_after"
    if [ $? -ne 0 ] || [ "$(remote_function_count "$functions_after" 2>/dev/null)" != 0 ]; then
      TEARDOWN_FAILURE=1
    fi
    pnpm exec supabase secrets list --project-ref "$PROJECT_REF" --output json > "$secrets_after"
    if [ $? -ne 0 ] || [ "$(temporary_secret_count "$secrets_after" 2>/dev/null)" != 0 ]; then
      TEARDOWN_FAILURE=1
    fi
    rm -rf "$TEMP_DIR"
  fi

  if [ "$MATERIALIZED_CREATED" -eq 1 ] && {
    [ -e "$MATERIALIZED_SOURCE" ] || [ -e "$MATERIALIZED_CONTRACTS_SOURCE" ]
  }; then
    TEARDOWN_FAILURE=1
  fi
  if [ "$TEARDOWN_FAILURE" -ne 0 ]; then
    printf '%s\n' 'Task 17 teardown verification: fail' >&2
    exit 1
  fi
  printf '%s\n' 'Task 17 teardown verification: pass'
  exit "$original_status"
}

trap cleanup EXIT HUP INT TERM

cd "$REPO_ROOT"
[ -f "$DRIVER_SOURCE" ] || { printf '%s\n' 'Missing committed Task 17 driver source.' >&2; exit 1; }
[ -f "$DRIVER_CONTRACTS_SOURCE" ] || { printf '%s\n' 'Missing committed Task 17 driver contracts.' >&2; exit 1; }
[ -f "$PROJECT_REF_FILE" ] || { printf '%s\n' 'Missing linked Supabase project reference.' >&2; exit 1; }
[ ! -e "$MATERIALIZED_SOURCE" ] && [ ! -e "$MATERIALIZED_CONTRACTS_SOURCE" ] || {
  printf '%s\n' 'Refusing to overwrite an existing Task 17 function source.' >&2
  exit 1
}

for inherited_stripe_credential in \
  "${STRIPE_RESTRICTED_KEY-}" "${STRIPE_SECRET_KEY-}" "${STRIPE_API_KEY-}"
do
  case "$inherited_stripe_credential" in
    rk_live_*|sk_live_*) printf '%s\n' 'Inherited live Stripe credential rejected.' >&2; exit 1 ;;
  esac
done
unset STRIPE_RESTRICTED_KEY STRIPE_SECRET_KEY STRIPE_API_KEY STRIPE_WEBHOOK_SECRET

PROJECT_REF=$(tr -d '\r\n' < "$PROJECT_REF_FILE")
case "$PROJECT_REF" in
  *[!a-z0-9]*|'') printf '%s\n' 'Invalid linked Supabase project reference.' >&2; exit 1 ;;
esac
[ "${#PROJECT_REF}" -eq 20 ] || { printf '%s\n' 'Invalid linked Supabase project reference.' >&2; exit 1; }

TEST_SUPABASE_URL=$(read_public_env TEST_SUPABASE_URL VITE_SUPABASE_URL)
TEST_SUPABASE_PUBLISHABLE_KEY=$(read_public_env TEST_SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_PUBLISHABLE_KEY)
VITE_STRIPE_PUBLISHABLE_KEY=$(read_public_env VITE_STRIPE_PUBLISHABLE_KEY VITE_STRIPE_PUBLISHABLE_KEY)
TEST_CONNECTED_ACCOUNT_ID=${TEST_CONNECTED_ACCOUNT_ID-}
TEST_CONNECTED_ACCOUNT_DISPOSABLE=${TEST_CONNECTED_ACCOUNT_DISPOSABLE-}

case "$TEST_SUPABASE_URL" in https://*.supabase.co) ;; *) printf '%s\n' 'Invalid TEST_SUPABASE_URL.' >&2; exit 1 ;; esac
[ "$TEST_SUPABASE_URL" = "https://${PROJECT_REF}.supabase.co" ] || {
  printf '%s\n' 'TEST Supabase URL does not match the linked project.' >&2
  exit 1
}
case "$TEST_SUPABASE_PUBLISHABLE_KEY" in sb_publishable_*) ;; *) printf '%s\n' 'Invalid TEST_SUPABASE_PUBLISHABLE_KEY.' >&2; exit 1 ;; esac
case "$VITE_STRIPE_PUBLISHABLE_KEY" in pk_test_*) ;; *) printf '%s\n' 'Live or missing Stripe publishable key rejected.' >&2; exit 1 ;; esac
case "$TEST_CONNECTED_ACCOUNT_ID" in acct_*) ;; *) printf '%s\n' 'Missing TEST connected account fixture.' >&2; exit 1 ;; esac
[ "$TEST_CONNECTED_ACCOUNT_DISPOSABLE" = 1 ] || {
  printf '%s\n' 'TEST connected account must be explicitly disposable.' >&2
  exit 1
}

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/whereto-task17-run.XXXXXX")
chmod 700 "$TEMP_DIR"
projects_file="$TEMP_DIR/projects.json"
environment_file="$TEMP_DIR/environment.json"
pnpm exec supabase projects list --output json > "$projects_file"
PROJECT_REF="$PROJECT_REF" PROJECTS_FILE="$projects_file" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.PROJECTS_FILE, 'utf8'))
if (!Array.isArray(payload)) process.exit(1)
const linked = payload.filter((project) => project?.linked === true)
if (
  linked.length !== 1 || linked[0]?.id !== process.env.PROJECT_REF ||
  linked[0]?.status !== 'ACTIVE_HEALTHY'
) process.exit(1)
NODE
pnpm exec supabase db query --linked --output-format json \
  "select environment as policy_environment from private.organizer_policy_release_settings where singleton_id;" \
  > "$environment_file"
ENVIRONMENT_FILE="$environment_file" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.ENVIRONMENT_FILE, 'utf8'))
const rows = Array.isArray(payload.rows)
  ? payload.rows
  : Array.isArray(payload.result)
    ? payload.result
    : null
if (rows?.length !== 1 || rows[0]?.policy_environment !== 'development') process.exit(1)
NODE
chmod 600 "$projects_file" "$environment_file"
TEMP_SECRET_FILE="$TEMP_DIR/driver-secrets.env"
CURL_CONFIG="$TEMP_DIR/cleanup.curl"
CLEANUP_RESPONSE="$TEMP_DIR/cleanup.json"
PROOF_TOKEN=$(openssl rand -hex 32)
FIXTURE_SUFFIX=$(openssl rand -hex 6)
TEST_STRIPE_FIXTURE_PREFIX="task17_$FIXTURE_SUFFIX"
TEST_FUNCTION_URL="${TEST_SUPABASE_URL%/}/functions/v1/task17-transaction-driver"

{
  printf 'TASK17_PROOF_TOKEN=%s\n' "$PROOF_TOKEN"
  printf 'TASK17_FIXTURE_PREFIX=%s\n' "$TEST_STRIPE_FIXTURE_PREFIX"
  printf 'TASK17_CONNECTED_ACCOUNT_ID=%s\n' "$TEST_CONNECTED_ACCOUNT_ID"
  printf 'TASK17_CLOSE_CONNECTED_ACCOUNT=true\n'
} > "$TEMP_SECRET_FILE"
{
  printf 'url = "%s"\n' "$TEST_FUNCTION_URL"
  printf 'request = "POST"\n'
  printf 'header = "content-type: application/json"\n'
  printf 'header = "apikey: %s"\n' "$TEST_SUPABASE_PUBLISHABLE_KEY"
  printf 'header = "authorization: Bearer %s"\n' "$TEST_SUPABASE_PUBLISHABLE_KEY"
  printf 'header = "x-task17-proof-token: %s"\n' "$PROOF_TOKEN"
  printf 'data = "{\\"action\\":\\"cleanup\\"}"\n'
} > "$CURL_CONFIG"

[ -d "$MATERIALIZED_DIR" ] || MATERIALIZED_DIR_CREATED=1
mkdir -p "$MATERIALIZED_DIR"
MATERIALIZED_CREATED=1
sed 's#../../../../supabase/functions/#../#g' "$DRIVER_SOURCE" > "$MATERIALIZED_SOURCE"
cp "$DRIVER_CONTRACTS_SOURCE" "$MATERIALIZED_CONTRACTS_SOURCE"
chmod 600 "$MATERIALIZED_SOURCE" "$MATERIALIZED_CONTRACTS_SOURCE"

pre_functions="$TEMP_DIR/functions-before.json"
pre_secrets="$TEMP_DIR/secrets-before.json"
pnpm exec supabase functions list --project-ref "$PROJECT_REF" --output json > "$pre_functions"
[ "$(remote_function_count "$pre_functions")" = 0 ] || {
  printf '%s\n' 'A Task 17 test driver is already deployed; refusing to replace it.' >&2
  exit 1
}
pnpm exec supabase secrets list --project-ref "$PROJECT_REF" --output json > "$pre_secrets"
[ "$(temporary_secret_count "$pre_secrets")" = 0 ] || {
  printf '%s\n' 'Task 17 temporary secrets already exist; refusing to replace them.' >&2
  exit 1
}

pnpm exec deno check --config deno.json "$MATERIALIZED_SOURCE"
TEMP_SECRETS_SET=1
pnpm exec supabase secrets set --env-file "$TEMP_SECRET_FILE" --project-ref "$PROJECT_REF" >/dev/null
DRIVER_DELETE_REQUIRED=1
pnpm exec supabase functions deploy task17-transaction-driver \
  --project-ref "$PROJECT_REF" --no-verify-jwt --import-map deno.json >/dev/null
DRIVER_DEPLOYED=1

capture_checkout_switch
enable_checkout_for_fixture

export RUN_STRIPE_TRANSACTION_PROOF=1
export TEST_STRIPE_CREDENTIAL_MODE=managed_edge
export TEST_SUPABASE_URL TEST_SUPABASE_PUBLISHABLE_KEY VITE_STRIPE_PUBLISHABLE_KEY
export TEST_FUNCTION_URL
export TEST_STRIPE_DRIVER_TOKEN="$PROOF_TOKEN"
export TEST_STRIPE_FIXTURE_PREFIX TEST_CONNECTED_ACCOUNT_ID
export TEST_CONNECTED_ACCOUNT_DISPOSABLE
export STRIPE_RESTRICTED_KEY=managed:test-mode-authenticated
export STRIPE_WEBHOOK_SECRET=managed:signature-verified

pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/stripe-ticketing.test.ts
