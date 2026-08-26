#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
DRIVER_SOURCE="$SCRIPT_DIR/edge/task17-transaction-driver/index.ts"
MATERIALIZED_DIR="$REPO_ROOT/supabase/functions/task17-transaction-driver"
MATERIALIZED_SOURCE="$MATERIALIZED_DIR/index.ts"
PROJECT_REF_FILE="$REPO_ROOT/supabase/.temp/project-ref"
ENV_FILE="$REPO_ROOT/.env.local"
TEMP_DIR=""
TEMP_SECRET_FILE=""
CURL_CONFIG=""
CLEANUP_RESPONSE=""
DRIVER_DEPLOYED=0
DRIVER_DELETE_REQUIRED=0
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

cleanup() {
  original_status=$?
  trap - EXIT HUP INT TERM
  set +e

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
      if (value.ok !== true || value.connected_account_closed !== true || !counts.every((name) => value[name] === 0)) process.exit(1);
    ' "$CLEANUP_RESPONSE"; then
      TEARDOWN_FAILURE=1
    fi
  fi

  if [ "$DRIVER_DELETE_REQUIRED" -eq 1 ]; then
    pnpm exec supabase functions delete task17-transaction-driver \
      --project-ref "$PROJECT_REF" --yes >/dev/null
    [ $? -eq 0 ] || TEARDOWN_FAILURE=1
  fi
  pnpm exec supabase secrets unset \
    TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID \
    TASK17_CLOSE_CONNECTED_ACCOUNT \
    --project-ref "$PROJECT_REF" >/dev/null
  [ $? -eq 0 ] || TEARDOWN_FAILURE=1

  rm -f "$MATERIALIZED_SOURCE"
  rmdir "$MATERIALIZED_DIR" 2>/dev/null || true

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

  if [ -e "$MATERIALIZED_SOURCE" ]; then
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
[ -f "$PROJECT_REF_FILE" ] || { printf '%s\n' 'Missing linked Supabase project reference.' >&2; exit 1; }
[ ! -e "$MATERIALIZED_SOURCE" ] || {
  printf '%s\n' 'Refusing to overwrite an existing Task 17 function source.' >&2
  exit 1
}

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
case "$TEST_SUPABASE_PUBLISHABLE_KEY" in sb_publishable_*) ;; *) printf '%s\n' 'Invalid TEST_SUPABASE_PUBLISHABLE_KEY.' >&2; exit 1 ;; esac
case "$VITE_STRIPE_PUBLISHABLE_KEY" in pk_test_*) ;; *) printf '%s\n' 'Live or missing Stripe publishable key rejected.' >&2; exit 1 ;; esac
case "$TEST_CONNECTED_ACCOUNT_ID" in acct_*) ;; *) printf '%s\n' 'Missing TEST connected account fixture.' >&2; exit 1 ;; esac
[ "$TEST_CONNECTED_ACCOUNT_DISPOSABLE" = 1 ] || {
  printf '%s\n' 'TEST connected account must be explicitly disposable.' >&2
  exit 1
}

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/whereto-task17-run.XXXXXX")
chmod 700 "$TEMP_DIR"
TEMP_SECRET_FILE="$TEMP_DIR/driver-secrets.env"
CURL_CONFIG="$TEMP_DIR/cleanup.curl"
CLEANUP_RESPONSE="$TEMP_DIR/cleanup.json"
PROOF_TOKEN=$(openssl rand -hex 32)
FIXTURE_SUFFIX=$(openssl rand -hex 6)
TEST_STRIPE_FIXTURE_PREFIX="task17_$FIXTURE_SUFFIX"
TEST_FUNCTION_URL="${TEST_SUPABASE_URL%/}/functions/v1/task17-transaction-driver"

umask 077
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

mkdir -p "$MATERIALIZED_DIR"
install -m 600 "$DRIVER_SOURCE" "$MATERIALIZED_SOURCE"

pre_functions="$TEMP_DIR/functions-before.json"
pnpm exec supabase functions list --project-ref "$PROJECT_REF" --output json > "$pre_functions"
[ "$(remote_function_count "$pre_functions")" = 0 ] || {
  printf '%s\n' 'A Task 17 test driver is already deployed; refusing to replace it.' >&2
  exit 1
}

pnpm exec deno check --config deno.json "$MATERIALIZED_SOURCE"
pnpm exec supabase secrets set --env-file "$TEMP_SECRET_FILE" --project-ref "$PROJECT_REF" >/dev/null
DRIVER_DELETE_REQUIRED=1
pnpm exec supabase functions deploy task17-transaction-driver \
  --project-ref "$PROJECT_REF" --no-verify-jwt --import-map deno.json >/dev/null
DRIVER_DEPLOYED=1

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
