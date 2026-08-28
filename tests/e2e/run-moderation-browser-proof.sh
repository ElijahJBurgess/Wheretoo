#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
playwright_cli="$repository_root/node_modules/.bin/playwright"
deno_cli="$repository_root/node_modules/.bin/deno"

if [[ " ${*:-} " == *" --list "* ]]; then
  WHERETO_E2E_PROFILE=moderation "$playwright_cli" test --config "$repository_root/playwright.config.ts" \
    moderation-public-eligibility.spec.ts moderation-public-eligibility.visual.spec.ts "$@"
  exit $?
fi

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/whereto-task16-run.XXXXXX")"
chmod 700 "$temporary_directory"

run_id="$(openssl rand -hex 6)"
fixture_prefix="task16_${run_id}"
organizer_a_email="whereto-task16-a-${run_id}@example.invalid"
organizer_b_email="whereto-task16-b-${run_id}@example.invalid"
staff_email="whereto-task16-staff-${run_id}@example.invalid"
organizer_a_password="Task16-A-$(openssl rand -hex 18)"
organizer_b_password="Task16-B-$(openssl rand -hex 18)"
staff_password="Task16-Staff-$(openssl rand -hex 18)"
report_fingerprint_secret="$(openssl rand -hex 32)"
organizer_a_id=""
organizer_b_id=""
staff_id=""
admin_key=""
report_server_pid=""
cleanup_failed=0

uuid() {
  node -e "console.log(crypto.randomUUID())"
}

mobile_report_event_id="$(uuid)"
desktop_report_event_id="$(uuid)"
mobile_staff_event_id="$(uuid)"
desktop_staff_event_id="$(uuid)"
mobile_visual_event_id="$(uuid)"
desktop_visual_event_id="$(uuid)"
mobile_map_eligible_event_id="$(uuid)"
desktop_map_eligible_event_id="$(uuid)"

mobile_map_excluded_ids=()
desktop_map_excluded_ids=()
for _index in {1..8}; do
  mobile_map_excluded_ids+=("$(uuid)")
  desktop_map_excluded_ids+=("$(uuid)")
done

digest() {
  VALUE="$1" node --input-type=module <<'NODE'
import { createHash } from 'node:crypto'
process.stdout.write(createHash('sha256').update(process.env.VALUE).digest('hex'))
NODE
}

hmac_digest() {
  VALUE="$1" SECRET="$report_fingerprint_secret" node --input-type=module <<'NODE'
import { createHmac } from 'node:crypto'
process.stdout.write(createHmac('sha256', process.env.SECRET).update(process.env.VALUE).digest('hex'))
NODE
}

seed_actor_one="$(digest "${fixture_prefix}:seed-actor-one")"
seed_actor_two="$(digest "${fixture_prefix}:seed-actor-two")"
seed_network_one="$(digest "${fixture_prefix}:seed-network-one")"
seed_network_two="$(digest "${fixture_prefix}:seed-network-two")"
mobile_report_address="198.51.100.16"
desktop_report_address="198.51.100.32"
mobile_report_actor="$(hmac_digest "actor:ipv4:${mobile_report_address}")"
mobile_report_network="$(hmac_digest 'network:ipv4:198.51.100.0/24')"
desktop_report_actor="$(hmac_digest "actor:ipv4:${desktop_report_address}")"
desktop_report_network="$mobile_report_network"

known_bucket_sql="'$seed_actor_one','$seed_actor_two','$seed_network_one','$seed_network_two','$mobile_report_actor','$mobile_report_network','$desktop_report_actor'"

sanitize_log() {
  sed -E \
    -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/<fixture-id>/g' \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<fixture-email>/g' \
    -e 's#https://[a-z0-9]{20}\.supabase\.co#<development-project-url>#g' \
    -e 's/sb_(publishable|secret)_[A-Za-z0-9_-]+/<supabase-key>/g' \
    "$1" | sed -n '1,120p'
}

delete_auth_user() {
  local user_id="$1"
  [[ -n "$user_id" && -n "$admin_key" ]] || return 0
  SUPABASE_URL="$supabase_url" ADMIN_KEY="$admin_key" USER_ID="$user_id" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${process.env.USER_ID}`, {
  method: 'DELETE',
  headers: {
    apikey: process.env.ADMIN_KEY,
    authorization: `Bearer ${process.env.ADMIN_KEY}`,
  },
})
if (!response.ok && response.status !== 404) {
  console.error('Exact Task 16 Auth cleanup failed.')
  process.exit(1)
}
NODE
}

verify_auth_user_absent() {
  local user_id="$1"
  [[ -n "$user_id" && -n "$admin_key" ]] || return 0
  SUPABASE_URL="$supabase_url" ADMIN_KEY="$admin_key" USER_ID="$user_id" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${process.env.USER_ID}`, {
  headers: {
    apikey: process.env.ADMIN_KEY,
    authorization: `Bearer ${process.env.ADMIN_KEY}`,
  },
})
if (response.status !== 404) {
  console.error('Exact Task 16 Auth residue verification failed.')
  process.exit(1)
}
NODE
}

cleanup() {
  local original_status=$?
  trap - EXIT HUP INT TERM
  set +e

  if [[ -n "$report_server_pid" ]]; then
    kill "$report_server_pid" 2>/dev/null
    wait "$report_server_pid" 2>/dev/null
  fi

  if [[ -n "$organizer_a_id" && -n "$organizer_b_id" && -n "$staff_id" ]]; then
    "$supabase_cli" db query --linked "
      begin;
      set local session_replication_role = replica;
      create temporary table task16_events on commit drop as
        select id from public.events
        where organizer_id in ('$organizer_a_id'::uuid, '$organizer_b_id'::uuid);
      delete from private.event_legacy_history_resolutions where event_id in (select id from task16_events);
      delete from private.event_public_eligibility_intervals where event_id in (select id from task16_events);
      delete from private.event_reports where event_id in (select id from task16_events);
      delete from private.moderation_review_requests where event_id in (select id from task16_events);
      delete from private.event_moderation_actions where event_id in (select id from task16_events);
      delete from private.event_moderation_evaluations where event_id in (select id from task16_events);
      delete from private.event_policy_acceptances where event_id in (select id from task16_events);
      delete from private.event_policy_legacy_exemptions where event_id in (select id from task16_events);
      delete from private.event_risk_disclosures where event_id in (select id from task16_events);
      delete from public.events where id in (select id from task16_events);
      delete from private.staff_roles where user_id = '$staff_id'::uuid;
      delete from public.organizers where id in ('$organizer_a_id'::uuid, '$organizer_b_id'::uuid);
      delete from private.event_report_rate_buckets where bucket_digest in ($known_bucket_sql);
      commit;
    " >"$temporary_directory/database-cleanup.log" 2>&1 || cleanup_failed=1

    "$supabase_cli" db query --linked --output-format json "
      select (
        (select count(*) from public.organizers where id in ('$organizer_a_id'::uuid, '$organizer_b_id'::uuid))
        + (select count(*) from public.events where organizer_id in ('$organizer_a_id'::uuid, '$organizer_b_id'::uuid))
        + (select count(*) from private.staff_roles where user_id = '$staff_id'::uuid)
        + (select count(*) from private.event_report_rate_buckets where bucket_digest in ($known_bucket_sql))
      )::integer as residue_count;
    " >"$temporary_directory/residue.json" 2>/dev/null || cleanup_failed=1
    RESIDUE_FILE="$temporary_directory/residue.json" node --input-type=module <<'NODE' || cleanup_failed=1
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.RESIDUE_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
if (row?.residue_count !== 0) process.exit(1)
NODE
  fi

  for user_id in "$organizer_a_id" "$organizer_b_id" "$staff_id"; do
    [[ -n "$user_id" ]] || continue
    delete_auth_user "$user_id" || cleanup_failed=1
    verify_auth_user_absent "$user_id" || cleanup_failed=1
  done

  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory" 2>/dev/null || cleanup_failed=1
  if [[ $cleanup_failed -ne 0 ]]; then
    printf '%s\n' 'Task 16 exact cleanup verification: fail' >&2
    exit 1
  fi
  printf '%s\n' 'Task 16 exact cleanup verification: pass'
  exit "$original_status"
}

trap cleanup EXIT HUP INT TERM
cd "$repository_root"

[[ -x "$supabase_cli" ]] || { printf '%s\n' 'Missing project-local Supabase CLI.' >&2; exit 1; }
[[ -x "$playwright_cli" ]] || { printf '%s\n' 'Missing project-local Playwright.' >&2; exit 1; }
[[ -x "$deno_cli" ]] || { printf '%s\n' 'Missing project-local Deno.' >&2; exit 1; }
[[ -f supabase/.temp/project-ref ]] || { printf '%s\n' 'Missing linked Supabase project reference.' >&2; exit 1; }

project_ref="$(tr -d '\r\n' < supabase/.temp/project-ref)"
[[ "$project_ref" =~ ^[a-z]{20}$ ]] || { printf '%s\n' 'Invalid linked Supabase project reference.' >&2; exit 1; }
supabase_url="https://${project_ref}.supabase.co"

"$supabase_cli" projects list --output json >"$temporary_directory/projects.json"
PROJECT_REF="$project_ref" PROJECTS_FILE="$temporary_directory/projects.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const projects = JSON.parse(fs.readFileSync(process.env.PROJECTS_FILE, 'utf8'))
const linked = projects.filter((project) => project.linked === true)
if (linked.length !== 1 || linked[0].id !== process.env.PROJECT_REF || linked[0].status !== 'ACTIVE_HEALTHY') {
  console.error('Exactly one ACTIVE_HEALTHY linked project must match the local reference.')
  process.exit(1)
}
NODE

"$supabase_cli" migration list --linked >"$temporary_directory/migrations.json"
MIGRATIONS_FILE="$temporary_directory/migrations.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.MIGRATIONS_FILE, 'utf8'))
if (!Array.isArray(payload.migrations) || payload.migrations.length === 0 ||
    payload.migrations.some((row) => !row.local || row.local !== row.remote) ||
    payload.migrations.at(-1)?.remote !== '20260826011200') {
  console.error('Local and linked migrations must align through 20260826011200.')
  process.exit(1)
}
NODE

"$supabase_cli" db query --linked --output-format json \
  "select environment from private.organizer_policy_release_settings where singleton_id;" \
  >"$temporary_directory/policy-environment.json"
POLICY_FILE="$temporary_directory/policy-environment.json" node --input-type=module <<'NODE'
import fs from 'node:fs'
const payload = JSON.parse(fs.readFileSync(process.env.POLICY_FILE, 'utf8'))
const row = payload.rows?.[0] ?? payload.result?.[0]
if (row?.environment !== 'development') {
  console.error('The linked policy environment must be development.')
  process.exit(1)
}
NODE

"$supabase_cli" projects api-keys --project-ref "$project_ref" --reveal --output json \
  >"$temporary_directory/api-keys.json"
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

create_user() {
  local email="$1" password="$2"
  SUPABASE_URL="$supabase_url" ADMIN_KEY="$admin_key" EMAIL="$email" PASSWORD="$password" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: process.env.ADMIN_KEY,
    authorization: `Bearer ${process.env.ADMIN_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD, email_confirm: true }),
})
if (!response.ok) {
  console.error('Exact Task 16 Auth fixture creation failed.')
  process.exit(1)
}
const payload = await response.json()
if (!/^[0-9a-f-]{36}$/.test(payload.id ?? '')) process.exit(1)
process.stdout.write(payload.id)
NODE
}

organizer_a_id="$(create_user "$organizer_a_email" "$organizer_a_password")"
organizer_b_id="$(create_user "$organizer_b_email" "$organizer_b_password")"
staff_id="$(create_user "$staff_email" "$staff_password")"

mobile_excluded_csv="$(IFS=,; printf '%s' "${mobile_map_excluded_ids[*]}")"
desktop_excluded_csv="$(IFS=,; printf '%s' "${desktop_map_excluded_ids[*]}")"

event_values=""
add_event() {
  local event_id="$1" owner_id="$2" label="$3" day_offset="$4"
  event_values+="${event_values:+,}('$event_id'::uuid,'$owner_id'::uuid,'${fixture_prefix}_${label}','A bounded Task 16 moderation browser fixture for public eligibility verification.','community',statement_timestamp() + interval '$day_offset days',statement_timestamp() + interval '$day_offset days 2 hours','America/Los_Angeles','Task 16 Civic Hall','1 Market Street',null,'San Francisco','CA','94105','US','task16.${run_id}.${label}',37.7936,-122.3958,'free',40)"
}

add_event "$mobile_report_event_id" "$organizer_a_id" mobile_report 1
add_event "$desktop_report_event_id" "$organizer_b_id" desktop_report 1
add_event "$mobile_staff_event_id" "$organizer_a_id" mobile_staff 2
add_event "$desktop_staff_event_id" "$organizer_b_id" desktop_staff 2
add_event "$mobile_visual_event_id" "$organizer_a_id" mobile_visual 3
add_event "$desktop_visual_event_id" "$organizer_b_id" desktop_visual 3
add_event "$mobile_map_eligible_event_id" "$organizer_a_id" mobile_map_eligible 4
add_event "$desktop_map_eligible_event_id" "$organizer_b_id" desktop_map_eligible 4

excluded_labels=(draft cancelled held blocked removed stale invalid ended)
for index in "${!excluded_labels[@]}"; do
  day_offset=5
  add_event "${mobile_map_excluded_ids[$index]}" "$organizer_a_id" "mobile_map_${excluded_labels[$index]}" "$day_offset"
  add_event "${desktop_map_excluded_ids[$index]}" "$organizer_b_id" "desktop_map_${excluded_labels[$index]}" "$day_offset"
done

all_event_ids_sql="'$mobile_report_event_id'::uuid,'$desktop_report_event_id'::uuid,'$mobile_staff_event_id'::uuid,'$desktop_staff_event_id'::uuid,'$mobile_visual_event_id'::uuid,'$desktop_visual_event_id'::uuid,'$mobile_map_eligible_event_id'::uuid,'$desktop_map_eligible_event_id'::uuid"
for event_id in "${mobile_map_excluded_ids[@]}" "${desktop_map_excluded_ids[@]}"; do
  all_event_ids_sql+=",'$event_id'::uuid"
done

draft_ids_sql="'${mobile_map_excluded_ids[0]}'::uuid,'${desktop_map_excluded_ids[0]}'::uuid"
high_risk_ids_sql="'$mobile_staff_event_id'::uuid,'$desktop_staff_event_id'::uuid,'$mobile_visual_event_id'::uuid,'$desktop_visual_event_id'::uuid,'${mobile_map_excluded_ids[2]}'::uuid,'${desktop_map_excluded_ids[2]}'::uuid,'${mobile_map_excluded_ids[3]}'::uuid,'${desktop_map_excluded_ids[3]}'::uuid"

if ! "$supabase_cli" db query --linked "
  begin;
  insert into public.organizers (id, display_name, organizer_type, base_city, country_code, onboarding_completed_at) values
    ('$organizer_a_id', 'Whereto Task 16 Mobile Organizer', 'Community group', 'San Francisco', 'US', statement_timestamp()),
    ('$organizer_b_id', 'Whereto Task 16 Desktop Organizer', 'Community group', 'San Francisco', 'US', statement_timestamp());
  insert into private.staff_roles (user_id, role, active, granted_by)
    values ('$staff_id', 'moderator', true, '$staff_id');
  insert into public.events (
    id, organizer_id, title, description, category, starts_at, ends_at, timezone,
    venue_name, address_line1, address_line2, city, region, postal_code,
    country_code, mapbox_feature_id, latitude, longitude, admission_type, capacity
  ) values $event_values;
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present,
    explicit_adult_content, gambling_present, weapons_present, high_risk_activity
  )
  select id, 'all_ages', false, false, false, false, false, id in ($high_risk_ids_sql)
  from public.events where id in ($all_event_ids_sql);

  select pg_catalog.set_config('request.jwt.claim.sub', '$organizer_a_id', true);
  set local role authenticated;
  select public.accept_current_event_policies(id)
  from public.events where organizer_id = '$organizer_a_id'::uuid order by id;
  select public.publish_event(id)
  from public.events where organizer_id = '$organizer_a_id'::uuid and id not in ($draft_ids_sql) order by id;
  reset role;

  select pg_catalog.set_config('request.jwt.claim.sub', '$organizer_b_id', true);
  set local role authenticated;
  select public.accept_current_event_policies(id)
  from public.events where organizer_id = '$organizer_b_id'::uuid order by id;
  select public.publish_event(id)
  from public.events where organizer_id = '$organizer_b_id'::uuid and id not in ($draft_ids_sql) order by id;
  reset role;

  select pg_catalog.set_config('request.jwt.claim.sub', '$staff_id', true);
  select public.moderate_event(id, content_revision, private.compute_event_input_sha256(id), moderation_version, 'block', 'unsafe_activity', null)
  from public.events where id in ('${mobile_map_excluded_ids[3]}'::uuid, '${desktop_map_excluded_ids[3]}'::uuid) order by id;
  select public.moderate_event(id, content_revision, private.compute_event_input_sha256(id), moderation_version, 'remove', 'unsafe_activity', null)
  from public.events where id in ('${mobile_map_excluded_ids[4]}'::uuid, '${desktop_map_excluded_ids[4]}'::uuid) order by id;

  update public.events set status = 'cancelled'
  where id in ('${mobile_map_excluded_ids[1]}'::uuid, '${desktop_map_excluded_ids[1]}'::uuid);
  update public.events set content_revision = content_revision + 1
  where id in ('${mobile_map_excluded_ids[5]}'::uuid, '${desktop_map_excluded_ids[5]}'::uuid);
  update public.events set latitude = null, longitude = null
  where id in ('${mobile_map_excluded_ids[6]}'::uuid, '${desktop_map_excluded_ids[6]}'::uuid);
  update public.events set starts_at = statement_timestamp() - interval '3 hours', ends_at = statement_timestamp() - interval '1 hour'
  where id in ('${mobile_map_excluded_ids[7]}'::uuid, '${desktop_map_excluded_ids[7]}'::uuid);

  set local role service_role;
  select public.server_submit_event_report('$mobile_report_event_id', '$seed_actor_one', '$seed_network_one', 'unsafe');
  select public.server_submit_event_report('$mobile_report_event_id', '$seed_actor_two', '$seed_network_two', 'wrong_location');
  select public.server_submit_event_report('$desktop_report_event_id', '$seed_actor_one', '$seed_network_one', 'unsafe');
  select public.server_submit_event_report('$desktop_report_event_id', '$seed_actor_two', '$seed_network_two', 'wrong_location');
  reset role;

  do \$assert\$
  begin
    if private.production_policy_configuration_is_ready()
      or (select count(*) from private.event_reports where event_id in ('$mobile_report_event_id'::uuid, '$desktop_report_event_id'::uuid)) <> 4
      or exists (select 1 from public.events where id in ('$mobile_report_event_id'::uuid, '$desktop_report_event_id'::uuid) and moderation_status <> 'clear')
      or exists (select 1 from public.events where id in ('$mobile_staff_event_id'::uuid, '$desktop_staff_event_id'::uuid, '$mobile_visual_event_id'::uuid, '$desktop_visual_event_id'::uuid) and moderation_status <> 'under_review') then
      raise exception using errcode = 'P0001', message = 'TASK16_FIXTURE_ASSERTION_FAILED';
    end if;
  end
  \$assert\$;
  commit;
" >"$temporary_directory/setup.log" 2>&1; then
  sanitize_log "$temporary_directory/setup.log" >&2
  exit 1
fi

SUPABASE_URL="$supabase_url" SUPABASE_SERVICE_ROLE_KEY="$admin_key" \
APP_BASE_URL="http://127.0.0.1:3000" REPORT_FINGERPRINT_SECRET="$report_fingerprint_secret" \
  "$deno_cli" run --allow-env --allow-net supabase/functions/report-event/index.ts \
  >"$temporary_directory/report-server.log" 2>&1 &
report_server_pid=$!

REPORT_PID="$report_server_pid" node --input-type=module <<'NODE'
const deadline = Date.now() + 15_000
while (Date.now() < deadline) {
  try {
    const response = await fetch('http://127.0.0.1:8000/', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.1' },
      body: '{}',
    })
    if (response.status === 400) process.exit(0)
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100))
}
console.error('Local Task 16 report function did not become ready.')
process.exit(1)
NODE

TEST_SUPABASE_URL="$supabase_url" \
TEST_SUPABASE_PUBLISHABLE_KEY="$publishable_key" \
TEST_ORGANIZER_A_EMAIL="$organizer_a_email" \
TEST_ORGANIZER_A_PASSWORD="$organizer_a_password" \
TEST_ORGANIZER_B_EMAIL="$organizer_b_email" \
TEST_ORGANIZER_B_PASSWORD="$organizer_b_password" \
TEST_STAFF_EMAIL="$staff_email" \
TEST_STAFF_PASSWORD="$staff_password" \
TEST_MODERATION_FIXTURE_PREFIX="$fixture_prefix" \
TEST_MODERATION_REPORT_FUNCTION_URL="http://127.0.0.1:8000/" \
TEST_MODERATION_REPORT_CLIENT_MOBILE="$mobile_report_address" \
TEST_MODERATION_REPORT_CLIENT_DESKTOP="$desktop_report_address" \
TEST_MODERATION_REPORT_EVENT_MOBILE_ID="$mobile_report_event_id" \
TEST_MODERATION_REPORT_EVENT_DESKTOP_ID="$desktop_report_event_id" \
TEST_MODERATION_STAFF_EVENT_MOBILE_ID="$mobile_staff_event_id" \
TEST_MODERATION_STAFF_EVENT_DESKTOP_ID="$desktop_staff_event_id" \
TEST_MODERATION_VISUAL_EVENT_MOBILE_ID="$mobile_visual_event_id" \
TEST_MODERATION_VISUAL_EVENT_DESKTOP_ID="$desktop_visual_event_id" \
TEST_MODERATION_MAP_ELIGIBLE_MOBILE_ID="$mobile_map_eligible_event_id" \
TEST_MODERATION_MAP_ELIGIBLE_DESKTOP_ID="$desktop_map_eligible_event_id" \
TEST_MODERATION_MAP_EXCLUDED_MOBILE_IDS="$mobile_excluded_csv" \
TEST_MODERATION_MAP_EXCLUDED_DESKTOP_IDS="$desktop_excluded_csv" \
WHERETO_E2E_PROFILE=moderation \
  "$playwright_cli" test --config "$repository_root/playwright.config.ts" \
  moderation-public-eligibility.spec.ts moderation-public-eligibility.visual.spec.ts "$@"

printf '%s\n' 'Task 16 browser proof passed; exact cleanup runs on EXIT.'
