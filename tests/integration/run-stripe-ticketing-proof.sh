#!/bin/sh
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
DRIVER_SOURCE="$SCRIPT_DIR/edge/task17-transaction-driver/index.ts"
DRIVER_CONTRACTS_SOURCE="$SCRIPT_DIR/edge/task17-transaction-driver/contracts.ts"
CLEANUP_SQL_RENDERER="$SCRIPT_DIR/task17CleanupSql.sh"
TASK17_CLEANUP_SQL_TEMPLATE="$SCRIPT_DIR/sql/task17-cleanup-runtime.sql"
[ -f "$CLEANUP_SQL_RENDERER" ] || {
  printf '%s\n' 'Missing committed Task 17 cleanup SQL renderer.' >&2
  exit 1
}
[ -f "$TASK17_CLEANUP_SQL_TEMPLATE" ] || {
  printf '%s\n' 'Missing committed Task 17 cleanup SQL template.' >&2
  exit 1
}
. "$CLEANUP_SQL_RENDERER"
MATERIALIZED_DIR="$REPO_ROOT/supabase/functions/task17-transaction-driver"
MATERIALIZED_SOURCE="$MATERIALIZED_DIR/index.ts"
MATERIALIZED_CONTRACTS_SOURCE="$MATERIALIZED_DIR/contracts.ts"
MATERIALIZED_CREATED=0
MATERIALIZED_DIR_CREATED=0
PROJECT_REF_FILE="$REPO_ROOT/supabase/.temp/project-ref"
ENV_FILE="$REPO_ROOT/.env.local"
TEMP_DIR=""
TEMP_SECRET_FILE=""
RETIREMENT_SECRET_FILE=""
CURL_CONFIG=""
CLEANUP_RESPONSE=""
DIAGNOSTIC_CURL_CONFIG=""
DIAGNOSTIC_RESPONSE=""
CHECKOUT_DIAGNOSTIC_CURL_CONFIG=""
CHECKOUT_DIAGNOSTIC_RESPONSE=""
FIXTURE_PREFLIGHT_CURL_CONFIG=""
FIXTURE_PREFLIGHT_RESPONSE=""
RETIREMENT_CURL_CONFIG=""
RETIREMENT_RESPONSE=""
TOMBSTONE_CERTIFICATION_FILE=""
CHECKOUT_SWITCH_STATE_FILE=""
DRIVER_DEPLOYED=0
DRIVER_DELETE_REQUIRED=0
TEMP_SECRETS_SET=0
CHECKOUT_SWITCH_CAPTURED=0
ACCOUNT_OWNERSHIP_ACCEPTED=0
PROOF_COMPLETED=0
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

write_driver_request_config() {
  task17_config_file=$1
  task17_request_body=$2
  {
    printf 'url = "%s"\n' "$TEST_FUNCTION_URL"
    printf 'request = "POST"\n'
    printf 'header = "content-type: application/json"\n'
    printf 'header = "apikey: %s"\n' "$TEST_SUPABASE_PUBLISHABLE_KEY"
    printf 'header = "authorization: Bearer %s"\n' "$TEST_SUPABASE_PUBLISHABLE_KEY"
    printf 'header = "x-task17-proof-token: %s"\n' "$PROOF_TOKEN"
    printf 'data = "%s"\n' "$task17_request_body"
  } > "$task17_config_file"
  chmod 600 "$task17_config_file"
}

write_cleanup_config() {
  write_driver_request_config "$CURL_CONFIG" \
    '{\"action\":\"cleanup\",\"close_connected_account\":false}'
}

write_retirement_config() {
  retirement_body=$(TOMBSTONE_CERTIFICATION_FILE="$TOMBSTONE_CERTIFICATION_FILE" \
    node --input-type=module <<'NODE'
import fs from 'node:fs'
const certification = JSON.parse(fs.readFileSync(process.env.TOMBSTONE_CERTIFICATION_FILE, 'utf8'))
const body = JSON.stringify({ action: 'retire_connected_account', certification })
process.stdout.write(body.replaceAll('\\', '\\\\').replaceAll('"', '\\"'))
NODE
  )
  write_driver_request_config "$RETIREMENT_CURL_CONFIG" "$retirement_body"
}

authorize_account_retirement() {
  printf '%s\n' 'TASK17_CLOSE_CONNECTED_ACCOUNT=true' > "$RETIREMENT_SECRET_FILE"
  chmod 600 "$RETIREMENT_SECRET_FILE"
  pnpm exec supabase secrets set --env-file "$RETIREMENT_SECRET_FILE" \
    --project-ref "$PROJECT_REF" >/dev/null
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

verify_checkout_disabled() {
  switch_disabled="$TEMP_DIR/checkout-switch-disabled.json"
  pnpm exec supabase db query --linked --output-format json \
    "select checkout_creation_enabled as enabled from private.checkout_runtime_control where singleton;" \
    > "$switch_disabled"
  SWITCH_DISABLED_FILE="$switch_disabled" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.SWITCH_DISABLED_FILE, 'utf8'))
const rows = Array.isArray(payload.rows)
  ? payload.rows
  : Array.isArray(payload.result)
    ? payload.result
    : null
if (rows?.length !== 1 || rows[0]?.enabled !== false) process.exit(1)
NODE
  switch_disabled_status=$?
  chmod 600 "$switch_disabled"
  return "$switch_disabled_status"
}

delete_fixture_runtime() {
  database_cleanup="$TEMP_DIR/database-cleanup.log"
  database_cleanup_sql="$TEMP_DIR/database-cleanup.sql"
  TASK17_CLEANUP_FIXTURE_PREFIX="$TEST_STRIPE_FIXTURE_PREFIX" \
    TASK17_CLEANUP_CONNECTED_ACCOUNT_ID="$TEST_CONNECTED_ACCOUNT_ID" \
    TASK17_CLEANUP_ONLY="$TASK13_CLEANUP_ONLY" \
    render_task17_cleanup_sql > "$database_cleanup_sql" || return 1
  chmod 600 "$database_cleanup_sql"
  pnpm exec supabase db query --linked --file "$database_cleanup_sql" \
    > "$database_cleanup" 2>&1
  database_cleanup_status=$?
  chmod 600 "$database_cleanup"
  return "$database_cleanup_status"
}

cleanup() {
  original_status=$?
  trap - EXIT HUP INT TERM
  set +e

  restore_checkout_switch
  [ $? -eq 0 ] || TEARDOWN_FAILURE=1

  if [ "$DRIVER_DEPLOYED" -eq 1 ] && [ -n "$CURL_CONFIG" ] && [ -f "$CURL_CONFIG" ]; then
    write_cleanup_config
    curl --silent --show-error --fail-with-body --config "$CURL_CONFIG" > "$CLEANUP_RESPONSE"
    cleanup_status=$?
    if [ "$cleanup_status" -ne 0 ]; then
      node -e '
        const fs = require("node:fs");
        const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const allowed = new Set([
          "CONFIG", "DATABASE", "INPUT", "FIXTURE_CLEANUP_UNSAFE",
          "FIXTURE_NOT_SELLABLE", "LIVE_MODE_FORBIDDEN", "STRIPE", "UNKNOWN",
          "CLEANUP_SESSION_RETRIEVE_FAILED", "CLEANUP_SESSION_EXPIRE_FAILED",
          "CLEANUP_CATALOG_DISCOVERY_FAILED", "CLEANUP_PRICE_ARCHIVE_FAILED",
          "CLEANUP_PRODUCT_ARCHIVE_FAILED", "DATABASE_DELETE_AUTH",
          "DATABASE_DELETE_RUNTIME",
        ]);
        if (allowed.has(value.kind)) {
          process.stdout.write(`Task 17 cleanup error kind: ${value.kind}\n`);
        }
        const diagnostic = value.cleanup_diagnostic;
        const classes = new Set([
          "AUTHENTICATION", "PERMISSION", "RESOURCE_MISSING_OR_SCOPE",
          "INVALID_REQUEST_OR_OBJECT_STATE", "RATE_LIMIT", "NETWORK",
          "PROVIDER_5XX", "RESPONSE_CONTRACT", "UNKNOWN",
        ]);
        const reached = diagnostic?.request_reached_stripe;
        const status = diagnostic?.http_status;
        if (
          diagnostic !== null && typeof diagnostic === "object" &&
          [true, false, null].includes(reached) &&
          classes.has(diagnostic.failure_class) &&
          (status === null || (Number.isInteger(status) && status >= 400 && status <= 599))
        ) {
          process.stdout.write(
            `Task 17 cleanup diagnostic: request_reached_stripe=${String(reached)} ` +
              `failure_class=${diagnostic.failure_class} http_status=${String(status)}\n`,
          );
        }
      ' "$CLEANUP_RESPONSE" 2>/dev/null || true
    fi
    cleanup_contract_status=0
    if [ "$cleanup_status" -ne 0 ] || ! env TASK13_CLEANUP_ONLY="$TASK13_CLEANUP_ONLY" node -e '
      const fs = require("node:fs");
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const lifecycleMatches = value.connected_account_closed === false &&
        value.connected_account_preserved === true;
      const absent = value.event_count === 0 && value.organizer_count === 0 &&
        value.auth_user_absent === true &&
        ["connect_count", "order_count", "tier_count", "receipt_count", "ticket_count", "dispute_count", "refund_count", "item_count"]
          .every((name) => value[name] === 0);
      const tombstone = value.stable_fixture === true &&
        value.fixture_reusable === true &&
        value.event_count === 1 && value.organizer_count === 1 &&
        value.auth_user_inert === true &&
        value.event_sellable === false && value.public_projection_count === 0 &&
        value.active_tier_count === 0 &&
        ["connect_count", "order_count", "receipt_count", "ticket_count", "dispute_count", "refund_count", "item_count"]
          .every((name) => value[name] === 0);
      const preparedBase = value.database_cleanup_required === true &&
        value.stable_fixture === true && value.fixture_reusable === true &&
        value.event_count === 1 && value.organizer_count === 1 &&
        value.auth_user_inert === true && value.event_sellable === false &&
        value.public_projection_count === 0 && value.active_tier_count === 2 &&
        value.tier_count === 2 && value.connect_count === 1 &&
        value.dispute_count === 0;
      const residual = preparedBase && value.order_count === 1 &&
        value.item_count === 2 && value.ticket_count === 0 &&
        value.receipt_count === 1 && value.refund_count === 0;
      const canonical = preparedBase && value.order_count === 2 &&
        value.item_count === 4 && value.ticket_count === 3 &&
        Number.isSafeInteger(value.receipt_count) && value.receipt_count >= 1 &&
        value.receipt_count <= 100 && value.refund_count === 1;
      const bounded = (candidate, maximum) => Number.isSafeInteger(candidate) &&
        candidate >= 0 && candidate <= maximum;
      const boundedRuntime = value.database_cleanup_required === true &&
        value.stable_fixture === true && value.fixture_reusable === true &&
        value.event_count === 1 && value.organizer_count === 1 &&
        value.auth_user_inert === true && value.event_sellable === false &&
        value.public_projection_count === 0 &&
        bounded(value.active_tier_count, 2) && value.tier_count === value.active_tier_count &&
        bounded(value.connect_count, 1) && bounded(value.order_count, 2) &&
        bounded(value.item_count, 4) && bounded(value.ticket_count, 3) &&
        bounded(value.receipt_count, 100) && bounded(value.refund_count, 1) &&
        value.dispute_count === 0;
      const prepared = process.env.TASK13_CLEANUP_ONLY === "1"
        ? residual || canonical
        : boundedRuntime;
      if (value.ok !== true || !lifecycleMatches ||
        !(absent || tombstone || prepared)) process.exit(1);
    ' "$CLEANUP_RESPONSE"; then
      TEARDOWN_FAILURE=1
      cleanup_contract_status=1
    fi
    if [ "$cleanup_status" -eq 0 ] && [ "$cleanup_contract_status" -eq 0 ]; then
      delete_fixture_runtime
      if [ $? -ne 0 ]; then
        printf '%s\n' 'Task 17 cleanup error kind: DATABASE_DELETE_RUNTIME'
        TEARDOWN_FAILURE=1
      fi
    fi
    if [ "$cleanup_status" -eq 0 ] && [ "$cleanup_contract_status" -eq 0 ] && \
      [ "$TEARDOWN_FAILURE" -eq 0 ] && [ "$ACCOUNT_OWNERSHIP_ACCEPTED" -eq 1 ]; then
      tombstone_audit="$TEMP_DIR/tombstone-audit.json"
      pnpm exec supabase db query --linked --output-format json "with fixture_namespace as (
          select organizers.display_name as prefix
          from public.organizers as organizers
          where organizers.display_name ~ '^task17_[a-z0-9]{12}$'
          union
          select split_part(auth.users.email, '@', 1) as prefix
          from auth.users
          where auth.users.email ~ '^task17_[a-z0-9]{12}@example[.]invalid$'
          union
          select regexp_replace(events.title, ' transaction$', '') as prefix
          from public.events as events
          where events.title ~ '^task17_[a-z0-9]{12} transaction$'
        ), fixture as (
          select events.id as event_id, organizers.id as organizer_id,
            events.status, events.moderation_status,
            events.publicly_authorized_action_id
          from public.organizers as organizers
          join public.events as events on events.organizer_id = organizers.id
          where organizers.display_name = '$TEST_STRIPE_FIXTURE_PREFIX'
            and events.title = '$TEST_STRIPE_FIXTURE_PREFIX transaction'
        )
        select
          (select count(*) from fixture_namespace) as namespace_prefix_count,
          (select count(*) from fixture) as event_count,
          (select count(*) from public.organizers where display_name = '$TEST_STRIPE_FIXTURE_PREFIX') as organizer_count,
          (select count(*) = 0 from auth.users where email = '$TEST_STRIPE_FIXTURE_PREFIX@example.invalid') as auth_user_absent,
          (select count(*) = 1 from auth.users where email = '$TEST_STRIPE_FIXTURE_PREFIX@example.invalid' and banned_until > statement_timestamp()) as auth_user_inert,
          (select count(*) from private.event_public_eligibility_intervals as intervals join fixture on fixture.event_id = intervals.event_id) as audit_interval_count,
          (select count(*) from private.event_moderation_actions as actions join fixture on fixture.event_id = actions.event_id) as audit_action_count,
          (select count(*) from private.event_public_eligibility_intervals as intervals join fixture on fixture.event_id = intervals.event_id where intervals.eligibility_state = 'eligible' and intervals.ended_at is null) as open_eligible_interval_count,
          (select count(*) from public.ticket_tiers as tiers join fixture on fixture.event_id = tiers.event_id where tiers.status = 'active') as active_tier_count,
          (select count(*) from public.ticket_tiers as tiers join fixture on fixture.event_id = tiers.event_id) as tier_count,
          (select count(*) from public.organizer_stripe_accounts as accounts join fixture on fixture.organizer_id = accounts.organizer_id) as connect_count,
          (select count(*) from public.orders as orders join fixture on fixture.event_id = orders.event_id) as order_count,
          (select count(*) from public.order_items as items join public.orders as orders on orders.id = items.order_id join fixture on fixture.event_id = orders.event_id) as item_count,
          (select count(*) from public.tickets as tickets join fixture on fixture.event_id = tickets.event_id) as ticket_count,
          (select count(*) from public.refunds as refunds join public.orders as orders on orders.id = refunds.order_id join fixture on fixture.event_id = orders.event_id) as refund_count,
          (select count(*) from private.staff_roles as roles join fixture on fixture.organizer_id = roles.user_id) as staff_role_count,
          (select count(*) from fixture cross join lateral public.get_public_event(fixture.event_id)) as public_projection_count,
          (select coalesce(bool_and(status = 'published' and moderation_status in ('clear', 'under_review') and publicly_authorized_action_id is null), false) from fixture) as event_inert,
          (select coalesce(bool_and(status = 'published' and moderation_status = 'clear' and publicly_authorized_action_id is null), false) from fixture) as event_tombstoned;" \
        > "$tombstone_audit"
      tombstone_query_status=$?
      chmod 600 "$tombstone_audit"
      TOMBSTONE_AUDIT_FILE="$tombstone_audit" \
        TOMBSTONE_CERTIFICATION_FILE="$TOMBSTONE_CERTIFICATION_FILE" \
        PROOF_COMPLETED="$PROOF_COMPLETED" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.TOMBSTONE_AUDIT_FILE, 'utf8'))
const rows = Array.isArray(payload.rows)
  ? payload.rows
  : Array.isArray(payload.result)
    ? payload.result
    : null
const row = rows?.length === 1 ? rows[0] : null
const runtimeEmpty = row !== null && Number.isSafeInteger(row.namespace_prefix_count) &&
  row.open_eligible_interval_count === 0 &&
  row.active_tier_count === 0 && row.tier_count === 0 && row.connect_count === 0 &&
  row.order_count === 0 && row.item_count === 0 && row.ticket_count === 0 &&
  row.refund_count === 0 && row.staff_role_count === 0 &&
  row.public_projection_count === 0
const absent = runtimeEmpty && row.namespace_prefix_count === 0 &&
  row.event_count === 0 && row.organizer_count === 0 &&
  row.auth_user_absent === true && row.audit_interval_count === 0 &&
  row.audit_action_count === 0 && row.event_tombstoned === false
const tombstoneSafe = runtimeEmpty && row.namespace_prefix_count === 1 &&
  row.event_count === 1 && row.organizer_count === 1 &&
  row.auth_user_inert === true && Number.isSafeInteger(row.audit_interval_count) &&
  row.audit_interval_count >= 1 && Number.isSafeInteger(row.audit_action_count) &&
  row.audit_action_count >= 0 &&
  (row.event_inert === true || row.event_tombstoned === true)
const tombstoneCertified = tombstoneSafe && row.audit_interval_count >= 3 &&
  row.audit_action_count >= 3 && row.event_tombstoned === true
const proofCompleted = process.env.PROOF_COMPLETED === '1'
if (proofCompleted ? !tombstoneCertified : !(absent || tombstoneSafe)) process.exit(1)
if (proofCompleted) {
  const fields = [
    'namespace_prefix_count', 'event_count', 'organizer_count', 'auth_user_inert',
    'audit_interval_count', 'audit_action_count', 'open_eligible_interval_count',
    'active_tier_count', 'tier_count', 'connect_count', 'order_count', 'item_count',
    'ticket_count', 'refund_count', 'public_projection_count', 'event_tombstoned',
    'staff_role_count',
  ]
  const certification = Object.fromEntries(fields.map((field) => [field, row[field]]))
  fs.writeFileSync(process.env.TOMBSTONE_CERTIFICATION_FILE, JSON.stringify(certification), { mode: 0o600 })
}
NODE
      tombstone_parse_status=$?
      if [ "$tombstone_query_status" -ne 0 ] || [ "$tombstone_parse_status" -ne 0 ]; then
        TEARDOWN_FAILURE=1
      fi
      if [ "$PROOF_COMPLETED" -eq 1 ] && [ "$TEARDOWN_FAILURE" -eq 0 ]; then
        authorize_account_retirement
        retirement_authorization_status=$?
        retirement_config_status=1
        if [ "$retirement_authorization_status" -eq 0 ]; then
          write_retirement_config
          retirement_config_status=$?
        fi
        retirement_status=0
        if [ "$retirement_authorization_status" -eq 0 ] && \
          [ "$retirement_config_status" -eq 0 ]; then
          curl --silent --show-error --fail-with-body \
            --config "$RETIREMENT_CURL_CONFIG" > "$RETIREMENT_RESPONSE"
          retirement_status=$?
          chmod 600 "$RETIREMENT_RESPONSE"
        else
          retirement_status=1
        fi
        if [ "$retirement_status" -ne 0 ] || ! node -e '
          const fs = require("node:fs");
          const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          const exact = Object.keys(value).sort().join(",") ===
            ["connected_account_closed", "connected_account_preserved", "ok"].sort().join(",");
          if (!exact || value.ok !== true || value.connected_account_closed !== true ||
            value.connected_account_preserved !== false) process.exit(1);
        ' "$RETIREMENT_RESPONSE"; then
          TEARDOWN_FAILURE=1
        fi
      fi
    fi
  fi

  if [ "${TASK13_CLEANUP_ONLY-0}" -eq 1 ] && [ -n "$TEMP_DIR" ]; then
    verify_checkout_disabled
    [ $? -eq 0 ] || TEARDOWN_FAILURE=1
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
TEST_CONNECTED_ACCOUNT_ID=$(read_public_env TEST_CONNECTED_ACCOUNT_ID TEST_CONNECTED_ACCOUNT_ID)
TEST_CONNECTED_ACCOUNT_DISPOSABLE=${TEST_CONNECTED_ACCOUNT_DISPOSABLE-}
TASK13_FIXTURE_PREFLIGHT_ONLY=${TASK13_FIXTURE_PREFLIGHT_ONLY-0}
TASK13_CHECKOUT_DIAGNOSTIC_ONLY=${TASK13_CHECKOUT_DIAGNOSTIC_ONLY-0}
TASK13_BROWSER_DIAGNOSTIC_ONLY=${TASK13_BROWSER_DIAGNOSTIC_ONLY-0}
TASK13_CLEANUP_ONLY=${TASK13_CLEANUP_ONLY-0}

case "$TEST_SUPABASE_URL" in https://*.supabase.co) ;; *) printf '%s\n' 'Invalid TEST_SUPABASE_URL.' >&2; exit 1 ;; esac
[ "$TEST_SUPABASE_URL" = "https://${PROJECT_REF}.supabase.co" ] || {
  printf '%s\n' 'TEST Supabase URL does not match the linked project.' >&2
  exit 1
}
case "$TEST_SUPABASE_PUBLISHABLE_KEY" in sb_publishable_*) ;; *) printf '%s\n' 'Invalid TEST_SUPABASE_PUBLISHABLE_KEY.' >&2; exit 1 ;; esac
case "$VITE_STRIPE_PUBLISHABLE_KEY" in pk_test_*) ;; *) printf '%s\n' 'Live or missing Stripe publishable key rejected.' >&2; exit 1 ;; esac
case "$TEST_CONNECTED_ACCOUNT_ID" in
  acct_*[!A-Za-z0-9_]*|acct_) printf '%s\n' 'Invalid TEST connected account fixture.' >&2; exit 1 ;;
  acct_*) ;;
  *) printf '%s\n' 'Missing TEST connected account fixture.' >&2; exit 1 ;;
esac
[ "$TEST_CONNECTED_ACCOUNT_DISPOSABLE" = 1 ] || {
  printf '%s\n' 'TEST connected account must be explicitly disposable.' >&2
  exit 1
}
case "$TASK13_FIXTURE_PREFLIGHT_ONLY" in
  0|1) ;;
  *) printf '%s\n' 'Invalid TASK13_FIXTURE_PREFLIGHT_ONLY value.' >&2; exit 1 ;;
esac
case "$TASK13_CHECKOUT_DIAGNOSTIC_ONLY" in
  0|1) ;;
  *) printf '%s\n' 'Invalid TASK13_CHECKOUT_DIAGNOSTIC_ONLY value.' >&2; exit 1 ;;
esac
case "$TASK13_BROWSER_DIAGNOSTIC_ONLY" in
  0|1) ;;
  *) printf '%s\n' 'Invalid TASK13_BROWSER_DIAGNOSTIC_ONLY value.' >&2; exit 1 ;;
esac
case "$TASK13_CLEANUP_ONLY" in
  0|1) ;;
  *) printf '%s\n' 'Invalid TASK13_CLEANUP_ONLY value.' >&2; exit 1 ;;
esac
[ "$((TASK13_FIXTURE_PREFLIGHT_ONLY + TASK13_CHECKOUT_DIAGNOSTIC_ONLY + TASK13_BROWSER_DIAGNOSTIC_ONLY + TASK13_CLEANUP_ONLY))" -le 1 ] || {
  printf '%s\n' 'Task 13 diagnostic modes are mutually exclusive.' >&2
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
if [ "$TASK13_CLEANUP_ONLY" -eq 1 ]; then
  capture_checkout_switch
  [ "$(tr -d '\r\n' < "$CHECKOUT_SWITCH_STATE_FILE")" = false ] || {
    CHECKOUT_SWITCH_CAPTURED=0
    printf '%s\n' 'Cleanup-only requires checkout disabled.' >&2
    exit 1
  }
  residual_fixture_file="$TEMP_DIR/residual-fixture.json"
  residual_fixture_query_log="$TEMP_DIR/residual-fixture-query.log"
  if pnpm exec supabase db query --linked --output-format json "with fixture_namespace as (
      select organizers.display_name as prefix
      from public.organizers as organizers
      where organizers.display_name ~ '^task17_[a-z0-9]{12}$'
      union
      select split_part(auth.users.email, '@', 1) as prefix
      from auth.users
      where auth.users.email ~ '^task17_[a-z0-9]{12}@example[.]invalid$'
      union
      select regexp_replace(events.title, ' transaction$', '') as prefix
      from public.events as events
      where events.title ~ '^task17_[a-z0-9]{12} transaction$'
    ), candidate as (
      select fixture_namespace.prefix, organizers.id as organizer_id,
        events.id as event_id, orders.id as order_id,
        orders.stripe_checkout_session_id as session_id
      from fixture_namespace
      join public.organizers as organizers
        on organizers.display_name = fixture_namespace.prefix
      join auth.users as owner
        on owner.id = organizers.id
        and owner.email = fixture_namespace.prefix || '@example.invalid'
        and owner.banned_until > statement_timestamp()
      join public.events as events
        on events.organizer_id = organizers.id
        and events.title = fixture_namespace.prefix || ' transaction'
        and events.status = 'published'
        and (events.moderation_status = 'clear' or (
          events.moderation_status = 'under_review' and exists (
            select 1 from private.event_moderation_evaluations as evaluations
            where evaluations.event_id = events.id
              and evaluations.content_revision = events.content_revision
              and evaluations.queued_moderation_version = events.moderation_version
              and evaluations.status = 'queued'
              and evaluations.source = 'contextual'
          )
        ))
        and events.publicly_authorized_action_id is null
      join public.orders as orders
        on orders.event_id = events.id and orders.organizer_id = organizers.id
        and orders.livemode = false and orders.status = 'expired'
        and orders.reconciliation_status = 'pending'
        and orders.quantity = 3 and orders.currency = 'usd'
        and orders.subtotal_minor = 5500 and orders.tax_amount_minor = 0
        and orders.total_minor = 5500
        and orders.application_fee_amount_minor = 425
        and orders.stripe_destination_account_id = '$TEST_CONNECTED_ACCOUNT_ID'
        and orders.stripe_checkout_session_id ~ '^cs_test_[A-Za-z0-9]+$'
        and orders.stripe_payment_intent_id is null
        and orders.stripe_charge_id is null and orders.stripe_transfer_id is null
        and orders.stripe_application_fee_id is null
        and orders.stripe_balance_transaction_id is null
        and orders.stripe_customer_id is null
        and orders.last_stripe_event_id is null
        and orders.paid_at is null and orders.failed_at is null
        and orders.expired_at is not null and orders.refunded_at is null
        and orders.reservation_expires_at <= statement_timestamp()
    ), exact_candidate as (
      select candidate.prefix,
        (select count(*) from fixture_namespace) = 1
        and (select count(*) from public.organizers where display_name = candidate.prefix) = 1
        and (select count(*) from auth.users where email = candidate.prefix || '@example.invalid') = 1
        and (select count(*) from public.events where organizer_id = candidate.organizer_id) = 1
        and not exists (select 1 from public.get_public_event(candidate.event_id))
        and exists (select 1 from private.event_public_eligibility_intervals where event_id = candidate.event_id)
        and not exists (select 1 from private.event_public_eligibility_intervals where event_id = candidate.event_id and eligibility_state = 'eligible' and ended_at is null)
        and (select count(*) from private.event_public_eligibility_intervals where event_id = candidate.event_id and eligibility_state = 'ineligible' and ended_at is null) = 1
        and exists (select 1 from private.event_moderation_actions where event_id = candidate.event_id)
        and exists (select 1 from private.event_policy_acceptances where event_id = candidate.event_id)
        and not exists (select 1 from private.staff_roles where user_id = candidate.organizer_id)
        and not exists (select 1 from private.event_reports where event_id = candidate.event_id)
        and not exists (select 1 from private.moderation_review_requests where event_id = candidate.event_id)
        and (select count(*) from public.ticket_tiers where event_id = candidate.event_id) = 2
        and (select count(*) from public.ticket_tiers where event_id = candidate.event_id and name = 'Task 17 General Admission' and unit_amount_minor = 1500 and currency = 'usd' and quantity_total = 10 and status = 'active' and sort_order = 1) = 1
        and (select count(*) from public.ticket_tiers where event_id = candidate.event_id and name = 'Task 17 VIP' and unit_amount_minor = 2500 and currency = 'usd' and quantity_total = 10 and status = 'active' and sort_order = 2) = 1
        and (select count(*) from public.organizer_stripe_accounts where organizer_id = candidate.organizer_id and livemode = false and stripe_account_id = '$TEST_CONNECTED_ACCOUNT_ID' and transfers_status = 'active' and payouts_status = 'active' and requirements_status = 'clear') = 1
        and (select count(*) from public.organizer_stripe_accounts where organizer_id = candidate.organizer_id) = 1
        and (select count(*) from public.orders where event_id = candidate.event_id) = 1
        and (select count(*) from public.order_items where order_id = candidate.order_id) = 2
        and (select count(*) from public.order_items as items join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id where items.order_id = candidate.order_id and tiers.name = 'Task 17 General Admission' and items.tier_name = tiers.name and items.tier_version = tiers.version and items.quantity = 2 and items.unit_amount_minor = 1500 and items.subtotal_minor = 3000 and items.currency = 'usd') = 1
        and (select count(*) from public.order_items as items join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id where items.order_id = candidate.order_id and tiers.name = 'Task 17 VIP' and items.tier_name = tiers.name and items.tier_version = tiers.version and items.quantity = 1 and items.unit_amount_minor = 2500 and items.subtotal_minor = 2500 and items.currency = 'usd') = 1
        and not exists (select 1 from public.tickets where order_id = candidate.order_id)
        and not exists (select 1 from public.refunds where order_id = candidate.order_id)
        and not exists (select 1 from public.disputes where order_id = candidate.order_id)
        and (select count(*) from public.stripe_webhook_events where stripe_object_id = candidate.session_id) = 1
        and (select count(*) from public.stripe_webhook_events where stripe_object_id = candidate.session_id and event_type = 'checkout.session.completed' and livemode = false and processing_status = 'processed' and processed_at is not null and error_code = 'STRIPE_OBJECT_INVALID') = 1
        as residual_fixture_exact
      from candidate
    )
    select prefix as residual_fixture_candidate, residual_fixture_exact
    from exact_candidate order by prefix;" > "$residual_fixture_file" 2> "$residual_fixture_query_log"; then
    chmod 600 "$residual_fixture_file" "$residual_fixture_query_log"
  else
    chmod 600 "$residual_fixture_file" "$residual_fixture_query_log" 2>/dev/null || true
    printf '%s\n' 'Task 17 cleanup error kind: CLEANUP_RESIDUAL_QUERY_FAILED'
    exit 1
  fi
  residual_fixture_parse_log="$TEMP_DIR/residual-fixture-parse.log"
  if ! TEST_STRIPE_FIXTURE_PREFIX=$(RESIDUAL_FIXTURE_FILE="$residual_fixture_file" node --input-type=module 2> "$residual_fixture_parse_log" <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.RESIDUAL_FIXTURE_FILE, 'utf8'))
const rows = Array.isArray(payload.rows)
  ? payload.rows
  : Array.isArray(payload.result)
    ? payload.result
    : null
const row = rows?.length === 1 ? rows[0] : null
const exactKeys = row !== null && Object.keys(row).sort().join(',') ===
  ['residual_fixture_candidate', 'residual_fixture_exact'].sort().join(',')
if (!exactKeys || row.residual_fixture_exact !== true ||
  typeof row.residual_fixture_candidate !== 'string' ||
  !/^task17_[a-z0-9]{12}$/.test(row.residual_fixture_candidate)) process.exit(1)
process.stdout.write(row.residual_fixture_candidate)
NODE
  ); then
    chmod 600 "$residual_fixture_parse_log" 2>/dev/null || true
    printf '%s\n' 'Task 17 cleanup error kind: CLEANUP_RESIDUAL_ADMISSION_FAILED'
    exit 1
  fi
  chmod 600 "$residual_fixture_parse_log"
else
  stable_fixture_file="$TEMP_DIR/stable-fixture.json"
  pnpm exec supabase db query --linked --output-format json "with fixture_namespace as (
    select organizers.display_name as prefix
    from public.organizers as organizers
    where organizers.display_name ~ '^task17_[a-z0-9]{12}$'
    union
    select split_part(auth.users.email, '@', 1) as prefix
    from auth.users
    where auth.users.email ~ '^task17_[a-z0-9]{12}@example[.]invalid$'
    union
    select regexp_replace(events.title, ' transaction$', '') as prefix
    from public.events as events
    where events.title ~ '^task17_[a-z0-9]{12} transaction$'
  ), candidate as (
    select fixture_namespace.prefix,
      (select organizers.id from public.organizers as organizers where organizers.display_name = fixture_namespace.prefix order by organizers.id limit 1) as organizer_id,
      (select events.id from public.events as events join public.organizers as organizers on organizers.id = events.organizer_id where organizers.display_name = fixture_namespace.prefix and events.title = fixture_namespace.prefix || ' transaction' order by events.id limit 1) as event_id
    from fixture_namespace
  ), classified as (
    select candidate.*,
      (select count(*) from public.organizers as exact_organizers where exact_organizers.display_name = candidate.prefix) = 1
      and (select count(*) from auth.users as exact_users where exact_users.email = candidate.prefix || '@example.invalid') = 1
      and (select count(*) from auth.users as owner_user where owner_user.id = candidate.organizer_id and owner_user.email = candidate.prefix || '@example.invalid') = 1
      and (select count(*) from public.events as owned where owned.organizer_id = candidate.organizer_id) = 1
      and (select count(*) from public.events as exact_events where exact_events.title = candidate.prefix || ' transaction') = 1
      and (select count(*) from public.events as events where events.id = candidate.event_id
        and events.status = 'published'
        and events.publicly_authorized_action_id is null
        and (
          events.moderation_status = 'clear'
          or (
            events.moderation_status = 'under_review'
            and exists (
              select 1 from private.event_moderation_evaluations as evaluations
              where evaluations.event_id = events.id
                and evaluations.content_revision = events.content_revision
                and evaluations.queued_moderation_version = events.moderation_version
                and evaluations.status = 'queued'
                and evaluations.source = 'contextual'
            )
          )
        )) = 1
      and not exists (select 1 from private.staff_roles where staff_roles.user_id = candidate.organizer_id)
      and not exists (select 1 from public.ticket_tiers where ticket_tiers.event_id = candidate.event_id)
      and not exists (select 1 from public.organizer_stripe_accounts where organizer_stripe_accounts.organizer_id = candidate.organizer_id)
      and not exists (select 1 from public.orders where orders.event_id = candidate.event_id)
      and not exists (select 1 from private.event_reports where event_reports.event_id = candidate.event_id)
      and not exists (select 1 from private.moderation_review_requests where moderation_review_requests.event_id = candidate.event_id)
      and not exists (select 1 from public.get_public_event(candidate.event_id))
      and exists (select 1 from private.event_public_eligibility_intervals as intervals where intervals.event_id = candidate.event_id)
      and (select count(*) from private.event_public_eligibility_intervals as intervals where intervals.event_id = candidate.event_id and intervals.eligibility_state = 'eligible' and intervals.ended_at is null) = 0
      and (select count(*) from private.event_public_eligibility_intervals as intervals where intervals.event_id = candidate.event_id and intervals.eligibility_state = 'ineligible' and intervals.ended_at is null) = 1
      as stable_fixture_recoverable
    from candidate
  )
  select classified.prefix as stable_fixture_candidate,
    classified.stable_fixture_recoverable,
    classified.stable_fixture_recoverable
      and (select count(*) from auth.users as owner_user where owner_user.id = classified.organizer_id and owner_user.banned_until > statement_timestamp()) = 1
      and exists (select 1 from private.event_moderation_actions as actions where actions.event_id = classified.event_id)
      and exists (select 1 from private.event_policy_acceptances as acceptances where acceptances.event_id = classified.event_id)
      as stable_fixture_safe
  from classified
  order by classified.prefix;" > "$stable_fixture_file"
chmod 600 "$stable_fixture_file"
TEST_STRIPE_FIXTURE_PREFIX=$(STABLE_FIXTURE_FILE="$stable_fixture_file" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.STABLE_FIXTURE_FILE, 'utf8'))
const rows = Array.isArray(payload.rows)
  ? payload.rows
  : Array.isArray(payload.result)
    ? payload.result
    : null
if (rows === null || rows.length > 1) process.exit(1)
if (rows.length === 1 && rows[0]?.stable_fixture_safe !== true &&
  rows[0]?.stable_fixture_recoverable !== true) process.exit(1)
const prefix = rows.length === 0 ? 'task17_checkout0001' : rows[0]?.stable_fixture_candidate
if (typeof prefix !== 'string' || !/^task17_[a-z0-9]{12}$/.test(prefix)) process.exit(1)
process.stdout.write(prefix)
NODE
)
fi
TEMP_SECRET_FILE="$TEMP_DIR/driver-secrets.env"
RETIREMENT_SECRET_FILE="$TEMP_DIR/retirement-secret.env"
CURL_CONFIG="$TEMP_DIR/cleanup.curl"
CLEANUP_RESPONSE="$TEMP_DIR/cleanup.json"
DIAGNOSTIC_CURL_CONFIG="$TEMP_DIR/account-diagnostic.curl"
DIAGNOSTIC_RESPONSE="$TEMP_DIR/account-diagnostic.json"
CHECKOUT_DIAGNOSTIC_CURL_CONFIG="$TEMP_DIR/checkout-diagnostic.curl"
CHECKOUT_DIAGNOSTIC_RESPONSE="$TEMP_DIR/checkout-diagnostic.json"
FIXTURE_PREFLIGHT_CURL_CONFIG="$TEMP_DIR/fixture-preflight.curl"
FIXTURE_PREFLIGHT_RESPONSE="$TEMP_DIR/fixture-preflight.json"
RETIREMENT_CURL_CONFIG="$TEMP_DIR/retirement.curl"
RETIREMENT_RESPONSE="$TEMP_DIR/retirement.json"
TOMBSTONE_CERTIFICATION_FILE="$TEMP_DIR/tombstone-certification.json"
PROOF_TOKEN=$(openssl rand -hex 32)
TEST_FUNCTION_URL="${TEST_SUPABASE_URL%/}/functions/v1/task17-transaction-driver"

{
  printf 'TASK17_PROOF_TOKEN=%s\n' "$PROOF_TOKEN"
  printf 'TASK17_FIXTURE_PREFIX=%s\n' "$TEST_STRIPE_FIXTURE_PREFIX"
  printf 'TASK17_CONNECTED_ACCOUNT_ID=%s\n' "$TEST_CONNECTED_ACCOUNT_ID"
  printf 'TASK17_CLOSE_CONNECTED_ACCOUNT=false\n'
} > "$TEMP_SECRET_FILE"
write_cleanup_config
write_driver_request_config "$DIAGNOSTIC_CURL_CONFIG" \
  '{\"action\":\"account_diagnostic\"}'
write_driver_request_config "$CHECKOUT_DIAGNOSTIC_CURL_CONFIG" \
  '{\"action\":\"checkout_diagnostic\"}'
write_driver_request_config "$FIXTURE_PREFLIGHT_CURL_CONFIG" \
  '{\"action\":\"fixture_preflight\"}'

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

if [ "$TASK13_CLEANUP_ONLY" -eq 1 ]; then
  ACCOUNT_OWNERSHIP_ACCEPTED=1
  exit 0
fi

diagnostic_curl_status=0
curl --silent --show-error --fail-with-body --config "$DIAGNOSTIC_CURL_CONFIG" \
  > "$DIAGNOSTIC_RESPONSE" || diagnostic_curl_status=$?
chmod 600 "$DIAGNOSTIC_RESPONSE"
diagnostic_parse_status=0
DIAGNOSTIC_RESPONSE_FILE="$DIAGNOSTIC_RESPONSE" node --input-type=module <<'NODE' || diagnostic_parse_status=$?
import fs from 'node:fs'
const value = JSON.parse(fs.readFileSync(process.env.DIAGNOSTIC_RESPONSE_FILE, 'utf8'))
const record = (candidate) => typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
const exactKeys = (candidate, keys) => Object.keys(candidate).sort().join(',') === [...keys].sort().join(',')
const predicateKeys = [
  'dashboard_is_express',
  'recipient_configuration_only',
  'default_currency_is_usd',
  'fees_collector_is_application',
  'losses_collector_is_application',
  'requirements_collector_is_stripe',
]
if (record(value) && value.ok === false && value.kind === 'ACCOUNT_RETRIEVE_FAILED' &&
  exactKeys(value, ['kind', 'ok'])) {
  process.stderr.write('Task 17 account diagnostic: ACCOUNT_RETRIEVE_FAILED\n')
  process.exit(1)
}
if (record(value) && value.ok === false && value.kind === 'ACCOUNT_CONTRACT_MISMATCH' &&
  exactKeys(value, ['account_contract', 'kind', 'ok']) && record(value.account_contract) &&
  exactKeys(value.account_contract, predicateKeys) &&
  predicateKeys.every((key) => typeof value.account_contract[key] === 'boolean')) {
  const bitmap = predicateKeys.map((key) => `${key}=${value.account_contract[key]}`).join(' ')
  process.stderr.write(`Task 17 account diagnostic: ACCOUNT_CONTRACT_MISMATCH ${bitmap}\n`)
  process.exit(1)
}
const readyKeys = [
  'ok',
  'restricted_key_authenticated',
  'webhook_signature_verified',
  'livemode',
  'connected_account_matches',
  'transfers_status',
  'payouts_status',
  'requirements_status',
]
if (!record(value) || !exactKeys(value, readyKeys) || value.ok !== true ||
  value.restricted_key_authenticated !== true || value.webhook_signature_verified !== true ||
  value.livemode !== false || value.connected_account_matches !== true ||
  value.transfers_status !== 'active' || value.payouts_status !== 'active' ||
  value.requirements_status !== 'clear') {
  process.stderr.write('Task 17 account diagnostic: INVALID_OR_NOT_READY\n')
  process.exit(1)
}
NODE
if [ "$diagnostic_curl_status" -ne 0 ] || [ "$diagnostic_parse_status" -ne 0 ]; then
  exit 1
fi
ACCOUNT_OWNERSHIP_ACCEPTED=1

if [ "$TASK13_CHECKOUT_DIAGNOSTIC_ONLY" -eq 1 ]; then
  checkout_diagnostic_curl_status=0
  curl --silent --show-error --fail-with-body \
    --config "$CHECKOUT_DIAGNOSTIC_CURL_CONFIG" \
    > "$CHECKOUT_DIAGNOSTIC_RESPONSE" || checkout_diagnostic_curl_status=$?
  chmod 600 "$CHECKOUT_DIAGNOSTIC_RESPONSE"
  checkout_diagnostic_parse_status=0
  CHECKOUT_DIAGNOSTIC_RESPONSE_FILE="$CHECKOUT_DIAGNOSTIC_RESPONSE" \
    node --input-type=module <<'NODE' || checkout_diagnostic_parse_status=$?
import fs from 'node:fs'
const value = JSON.parse(fs.readFileSync(process.env.CHECKOUT_DIAGNOSTIC_RESPONSE_FILE, 'utf8'))
const record = (candidate) => typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
const exactKeys = (candidate, keys) => Object.keys(candidate).sort().join(',') === [...keys].sort().join(',')
const predicateKeys = [
  'session_object_valid',
  'test_mode',
  'payment_mode',
  'currency_usd',
  'subtotal_exact',
  'total_exact',
  'payment_status_unpaid',
  'fixture_buyer_bound',
  'client_reference_bound',
  'metadata_bound',
  'integration_identifier_bound',
  'automatic_tax_disabled',
  'line_items_complete',
  'line_count_exact',
  'admission_count_exact',
  'line_amounts_exact',
  'line_bindings_unique',
  'payment_intent_present',
  'payment_intent_expanded',
  'payment_intent_test_mode',
  'payment_intent_amount_exact',
  'application_fee_exact',
  'destination_bound',
  'payment_intent_metadata_bound',
  'failure_cleanup_expired',
]
if (record(value) && value.ok === false &&
  (value.kind === 'CHECKOUT_SESSION_LIST_FAILED' ||
    value.kind === 'CHECKOUT_SESSION_RETRIEVE_FAILED' ||
    value.kind === 'CHECKOUT_FIXTURE_BINDING_FAILED') &&
  exactKeys(value, ['kind', 'ok'])) {
  process.stderr.write(`Task 13 checkout diagnostic: ${value.kind}\n`)
  process.exit(1)
}
if (record(value) && value.ok === false &&
  value.kind === 'CHECKOUT_SESSION_CANDIDATE_MISMATCH' &&
  exactKeys(value, ['candidate_count', 'kind', 'ok']) &&
  Number.isSafeInteger(value.candidate_count) && value.candidate_count >= 0 &&
  value.candidate_count <= 100) {
  process.stderr.write(
    `Task 13 checkout diagnostic: CHECKOUT_SESSION_CANDIDATE_MISMATCH candidate_count=${value.candidate_count}\n`,
  )
  process.exit(1)
}
if (!record(value) || value.ok !== true || value.candidate_count !== 1 ||
  !exactKeys(value, ['candidate_count', 'ok', 'session_contract']) ||
  !record(value.session_contract) ||
  !exactKeys(value.session_contract, predicateKeys) ||
  !predicateKeys.every((key) => typeof value.session_contract[key] === 'boolean')) {
  process.stderr.write('Task 13 checkout diagnostic: INVALID_RESPONSE\n')
  process.exit(1)
}
for (const key of predicateKeys) {
  process.stdout.write(`Task 13 checkout diagnostic: ${key}=${value.session_contract[key]}\n`)
}
NODE
  if [ "$checkout_diagnostic_curl_status" -ne 0 ] || \
    [ "$checkout_diagnostic_parse_status" -ne 0 ]; then
    exit 1
  fi
  exit 0
fi

fixture_preflight_curl_status=0
curl --silent --show-error --fail-with-body --config "$FIXTURE_PREFLIGHT_CURL_CONFIG" \
  > "$FIXTURE_PREFLIGHT_RESPONSE" || fixture_preflight_curl_status=$?
chmod 600 "$FIXTURE_PREFLIGHT_RESPONSE"
fixture_preflight_parse_status=0
FIXTURE_PREFLIGHT_RESPONSE_FILE="$FIXTURE_PREFLIGHT_RESPONSE" node --input-type=module <<'NODE' || fixture_preflight_parse_status=$?
import fs from 'node:fs'
const value = JSON.parse(fs.readFileSync(process.env.FIXTURE_PREFLIGHT_RESPONSE_FILE, 'utf8'))
const failureKinds = new Set([
  'FIXTURE_PREPARATION_FAILED',
  'FIXTURE_ORGANIZER_FAILED',
  'FIXTURE_ACCOUNT_BINDING_FAILED',
  'FIXTURE_EVENT_FAILED',
  'FIXTURE_TIER_SETUP_FAILED',
  'FIXTURE_MODERATION_FAILED',
  'FIXTURE_AUTH_FAILED',
  'FIXTURE_DISCLOSURE_SAVE_FAILED',
  'FIXTURE_POLICY_ACCEPTANCE_FAILED',
  'FIXTURE_PUBLISH_FAILED',
  'FIXTURE_ELIGIBILITY_FAILED',
  'FIXTURE_CHECKOUT_PREFLIGHT_FAILED',
])
if (value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === ['kind', 'ok'].join(',') &&
  value.ok === false && failureKinds.has(value.kind)) {
  process.stderr.write(`Task 17 fixture preflight: ${value.kind}\n`)
  process.exit(1)
}
const exact = Object.keys(value).sort().join(',') ===
  ['cleanup_strategy', 'fixture_purchasable', 'ok', 'stable_fixture'].sort().join(',')
if (!exact || value.ok !== true || value.fixture_purchasable !== true ||
  value.cleanup_strategy !== 'audit_tombstone' || value.stable_fixture !== true) {
  process.stderr.write('Task 17 fixture preflight: NOT_SELLABLE_OR_UNSAFE\n')
  process.exit(1)
}
NODE
if [ "$fixture_preflight_curl_status" -ne 0 ] || [ "$fixture_preflight_parse_status" -ne 0 ]; then
  exit 1
fi
if [ "$TASK13_FIXTURE_PREFLIGHT_ONLY" -eq 1 ]; then
  printf '%s\n' 'Task 17 fixture preflight-only verification: pass'
  exit 0
fi

capture_checkout_switch
if [ "$TASK13_BROWSER_DIAGNOSTIC_ONLY" -eq 1 ] && \
  [ "$(tr -d '\r\n' < "$CHECKOUT_SWITCH_STATE_FILE")" != false ]; then
  CHECKOUT_SWITCH_CAPTURED=0
  printf '%s\n' 'Browser diagnostic requires checkout disabled.' >&2
  exit 1
fi
enable_checkout_for_fixture

export RUN_STRIPE_TRANSACTION_PROOF=1
export TASK13_BROWSER_DIAGNOSTIC_ONLY
export TEST_STRIPE_CREDENTIAL_MODE=managed_edge
export TEST_SUPABASE_URL TEST_SUPABASE_PUBLISHABLE_KEY VITE_STRIPE_PUBLISHABLE_KEY
export TEST_FUNCTION_URL
export TEST_STRIPE_DRIVER_TOKEN="$PROOF_TOKEN"
export TEST_STRIPE_FIXTURE_PREFIX TEST_CONNECTED_ACCOUNT_ID
export TEST_CONNECTED_ACCOUNT_DISPOSABLE
export STRIPE_RESTRICTED_KEY=managed:test-mode-authenticated
export STRIPE_WEBHOOK_SECRET=managed:signature-verified

if [ "$TASK13_BROWSER_DIAGNOSTIC_ONLY" -eq 1 ]; then
  pnpm exec vitest run --config vitest.integration.config.ts \
    tests/integration/stripe-ticketing.test.ts \
    -t 'runs one guaranteed-decline hosted browser diagnostic'
  exit 0
fi

pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/stripe-ticketing.test.ts
PROOF_COMPLETED=1
