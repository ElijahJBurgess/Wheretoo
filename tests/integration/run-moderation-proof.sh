#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
completed_children="$temporary_directory/completed-children"
chmod 700 "$temporary_directory"
: >"$completed_children"

moderation_sql_children=(
  moderation_schema
  moderation_legacy_migration
  moderation_policy_acceptance
  moderation_publish_eligibility
  public_eligibility_projections
  moderation_published_edits
  moderation_evaluations
  moderation_staff_actions
  moderation_reviews_reports
)

compatibility_sql_children=(
  organizers_events_schema
  organizers_events_rls
  organizer_onboarding_update
  publish_event
  ticketing_schema
  ticketing_rls
  paid_sales
  inventory_reservations
  payment_fulfillment
  order_confirmation
)

shell_children=(
  moderation_epoch_concurrency
  moderation_action_concurrency
  moderation_report_concurrency
)

expected_children=(
  "${moderation_sql_children[@]}"
  "${compatibility_sql_children[@]}"
  "${shell_children[@]}"
  moderation_public_projection
)

cleanup() {
  local original_exit=$?
  trap - EXIT
  rm -rf -- "$temporary_directory"
  exit "$original_exit"
}
trap cleanup EXIT

fail_with_log() {
  local message="$1"
  local log_file="${2:-}"
  echo "$message" >&2
  if [[ -n "$log_file" && -f "$log_file" ]]; then
    sed -n '1,160p' "$log_file" >&2
  fi
  exit 1
}

mark_child() {
  printf '%s\n' "$1" >>"$completed_children"
}

run_child() {
  local child_name="$1"
  shift
  "$@"
  mark_child "$child_name"
}

validate_pgtap_log() {
  local log_file="$1"
  local transport="${2:-official}"
  if grep -Eiq '(^|[^[:alpha:]])not ok([[:space:]]|$)|looks like you failed|bad plan|parse error|failed test' "$log_file"; then
    fail_with_log "pgTAP reported a failing assertion." "$log_file"
  fi
  if [[ "$transport" == official ]] && ! grep -Eq '1\.\.[0-9]+' "$log_file"; then
    fail_with_log "Official pgTAP output did not contain a test plan." "$log_file"
  fi
  if [[ "$transport" == linked-query ]] &&
     ! grep -Eq '1\.\.[0-9]+|ok [0-9]+ -' "$log_file"; then
    fail_with_log "Linked-query pgTAP output did not contain a successful assertion." "$log_file"
  fi
}

run_pgtap_file() {
  local child_name="$1"
  local sql_file="$2"
  local log_file="$temporary_directory/${child_name}.pgtap.log"

  if ! grep -Eiq 'select[[:space:]]+(no_plan|plan)\(' "$sql_file" ||
     ! grep -Eiq 'select[[:space:]]+\*[[:space:]]+from[[:space:]]+finish\(' "$sql_file"; then
    fail_with_log "Linked-query pgTAP fallback requires plan()/finish(): $child_name"
  fi
  if ! "$supabase_cli" db query --linked --file "$sql_file" >"$log_file" 2>&1; then
    fail_with_log "Linked pgTAP fallback failed: $child_name" "$log_file"
  fi
  validate_pgtap_log "$log_file" linked-query
  mark_child "$child_name"
}

if [[ ! -x "$supabase_cli" ]]; then
  fail_with_log "Supabase CLI is not installed at the project-local path."
fi

for child_name in "${expected_children[@]}"; do
  if [[ ! "$child_name" =~ ^[a-z0-9_]+$ ]]; then
    fail_with_log "Invalid moderation proof child name: $child_name"
  fi
done

project_ref="$(tr -d '\r\n' <"$repository_root/supabase/.temp/project-ref")"
if [[ ! "$project_ref" =~ ^[a-z]{20}$ ]]; then
  fail_with_log "The linked project ref is missing or malformed."
fi

"$supabase_cli" projects list --output json >"$temporary_directory/projects.json"
PROJECT_REF="$project_ref" PROJECTS_FILE="$temporary_directory/projects.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const projects = JSON.parse(fs.readFileSync(process.env.PROJECTS_FILE, 'utf8'))
const linked = projects.filter((project) => project.linked === true)
if (linked.length !== 1 || linked[0].id !== process.env.PROJECT_REF || linked[0].status !== 'ACTIVE_HEALTHY') {
  console.error('Exactly one ACTIVE_HEALTHY linked project must match supabase/.temp/project-ref.')
  process.exit(1)
}
NODE

"$supabase_cli" migration list --linked >"$temporary_directory/migrations.json"
MIGRATIONS_FILE="$temporary_directory/migrations.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.MIGRATIONS_FILE, 'utf8'))
const migrations = payload.migrations
if (!Array.isArray(migrations) || migrations.length === 0 ||
    migrations.some((migration) => !migration.local || migration.local !== migration.remote) ||
    migrations.at(-1)?.remote !== '20260826011000') {
  console.error('Local and linked migration histories must be fully aligned through 20260826011000.')
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
if (row?.policy_environment !== 'development') {
  console.error('The linked database is not authoritatively marked development.')
  process.exit(1)
}
NODE

all_sql_children=("${moderation_sql_children[@]}" "${compatibility_sql_children[@]}")
all_sql_paths=()
for child_name in "${all_sql_children[@]}"; do
  sql_file="$repository_root/supabase/tests/database/${child_name}.test.sql"
  if [[ ! -f "$sql_file" ]]; then
    fail_with_log "Required pgTAP file is missing: $sql_file"
  fi
  all_sql_paths+=("$sql_file")
done

official_pgtap_log="$temporary_directory/official-pgtap.log"
set +e
"$supabase_cli" test db --linked "${all_sql_paths[@]}" >"$official_pgtap_log" 2>&1
official_pgtap_exit=$?
set -e

if [[ $official_pgtap_exit -eq 0 ]]; then
  validate_pgtap_log "$official_pgtap_log"
  for child_name in "${all_sql_children[@]}"; do
    mark_child "$child_name"
  done
elif grep -Eq 'LegacyDockerRunError' "$official_pgtap_log" &&
     grep -Eiq 'Docker Desktop is a prerequisite' "$official_pgtap_log"; then
  echo "Official linked pgTAP is Docker-blocked; using the documented sequential linked-query fallback."
  for child_name in "${all_sql_children[@]}"; do
    run_pgtap_file "$child_name" "$repository_root/supabase/tests/database/${child_name}.test.sql"
  done
else
  fail_with_log "Official linked pgTAP failed for a reason other than the documented Docker prerequisite." "$official_pgtap_log"
fi

run_child "moderation_epoch_concurrency" "$repository_root/supabase/tests/database/moderation_epoch_concurrency.test.sh"
run_child "moderation_action_concurrency" "$repository_root/supabase/tests/database/moderation_action_concurrency.test.sh"
run_child "moderation_report_concurrency" "$repository_root/supabase/tests/database/moderation_report_concurrency.test.sh"
run_child "moderation_public_projection" pnpm exec vitest run --config vitest.integration.config.ts tests/integration/moderation-public-projection.test.ts

"$supabase_cli" db query --linked --output-format json "
  select
    (select count(*)::integer from pg_extension where extname = 'pgtap') as pgtap_count,
    (
      (select count(*) from auth.users where email like 'whereto-task15-%@example.invalid')
      + (select count(*) from public.organizers where display_name like 'WHERETO_TASK15_%')
      + (select count(*) from public.events where title like 'WHERETO_TASK15_%')
    )::integer as fixture_count;
" >"$temporary_directory/leakage.json"
LEAKAGE_FILE="$temporary_directory/leakage.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.LEAKAGE_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
if (row?.pgtap_count !== 0 || row?.fixture_count !== 0) {
  console.error('Moderation proof left pgTAP or Task 15 fixtures behind.')
  process.exit(1)
}
NODE

"$supabase_cli" db query --linked --output-format json "
  do \$acl\$
  begin
    if not pg_catalog.has_function_privilege('anon', 'public.get_public_event(uuid)', 'execute')
       or not pg_catalog.has_function_privilege('authenticated', 'public.get_public_event(uuid)', 'execute')
       or not pg_catalog.has_function_privilege('postgres', 'public.get_public_event(uuid)', 'execute')
       or pg_catalog.has_function_privilege('anon', 'public.moderate_event(uuid,bigint,text,bigint,text,text,text)', 'execute')
       or not pg_catalog.has_function_privilege('authenticated', 'public.moderate_event(uuid,bigint,text,bigint,text,text,text)', 'execute')
       or pg_catalog.has_function_privilege('anon', 'public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)', 'execute')
       or not pg_catalog.has_function_privilege('service_role', 'public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)', 'execute')
       or pg_catalog.has_table_privilege('anon', 'public.events', 'select')
       or pg_catalog.has_table_privilege('anon', 'private.event_moderation_actions', 'select')
       or pg_catalog.has_table_privilege('authenticated', 'private.event_moderation_actions', 'select') then
      raise exception 'Task 15 ACL inventory is not closed';
    end if;
  end
  \$acl\$;
  select true as acl_ok;
" >"$temporary_directory/acl.json"

"$supabase_cli" db lint --linked --schema public,private >"$temporary_directory/lint.log" 2>&1
"$supabase_cli" db push --linked --dry-run --output json >"$temporary_directory/dry-run.log" 2>&1
DRY_RUN_FILE="$temporary_directory/dry-run.log" node --input-type=module <<'NODE'
import fs from 'node:fs'
const output = fs.readFileSync(process.env.DRY_RUN_FILE, 'utf8')
let noOp = /Remote database is up to date\./.test(output)
if (!noOp) {
  try {
    const payload = JSON.parse(output)
    noOp = payload.upToDate === true &&
      ['migrations', 'seeds', 'roles'].every((key) => Array.isArray(payload[key]) && payload[key].length === 0)
  } catch {}
}
if (!noOp) {
  console.error('Linked database dry-run is not a no-op.')
  process.exit(1)
}
NODE

for child_name in "${expected_children[@]}"; do
  completed_count="$(grep -Fxc "$child_name" "$completed_children" || true)"
  if [[ "$completed_count" -eq 0 ]]; then
    echo "Required moderation proof child did not complete: $child_name" >&2
    exit 1
  fi
  if [[ "$completed_count" -ne 1 ]]; then
    echo "Moderation proof child completed more than once: $child_name" >&2
    exit 1
  fi
done

while IFS= read -r child_name; do
  expected=false
  for expected_child in "${expected_children[@]}"; do
    if [[ "$child_name" == "$expected_child" ]]; then
      expected=true
      break
    fi
  done
  if [[ "$expected" != true ]]; then
    echo "Unexpected moderation proof child completed: $child_name" >&2
    exit 1
  fi
done <"$completed_children"

echo "Moderation database proof passed (${#expected_children[@]}/${#expected_children[@]} children)."
