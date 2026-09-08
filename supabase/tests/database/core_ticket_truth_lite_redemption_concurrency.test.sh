#!/usr/bin/env bash
set -euo pipefail

: "${WHERETO_TICKETING_DB_URL:?Explicit disposable loopback database required}"
node --input-type=module -e 'const u=new URL(process.env.WHERETO_TICKETING_DB_URL); if (!["postgres:","postgresql:"].includes(u.protocol)||!["localhost","127.0.0.1","[::1]"].includes(u.hostname)) process.exit(1)'
export PGCONNECT_TIMEOUT=5
export PGOPTIONS='-c statement_timeout=20000'
fixture_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/helpers" && pwd -P)"
scratch="$(mktemp -d)"
psql_cmd=(psql "$WHERETO_TICKETING_DB_URL" -X -qAt -v ON_ERROR_STOP=1)
event_id=a6200000-0000-4000-8000-000000000001
owner_id=a6100000-0000-4000-8000-000000000001
run_tag="lite_scan_${$}"
setup_done=0
gate_pid=""
worker_a=""
worker_b=""
prior_switch="$("${psql_cmd[@]}" -c 'select checkout_creation_enabled from private.checkout_runtime_control where singleton')"
[[ "$prior_switch" == t || "$prior_switch" == f ]]

cleanup() {
  result=$?
  trap - EXIT
  for pid in "$gate_pid" "$worker_a" "$worker_b"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  if [[ "$setup_done" == 1 ]]; then
    "${psql_cmd[@]}" -v prior_switch="$prior_switch" <<'SQL' || result=1
begin;
set local session_replication_role=replica;
create temporary table cleanup_events as select id from public.events where organizer_id in ('a6100000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000002');
create temporary table cleanup_orders as select id from public.orders where event_id in (select id from cleanup_events);
delete from public.tickets where order_id in(select id from cleanup_orders);
delete from public.order_items where order_id in(select id from cleanup_orders);
delete from public.orders where id in(select id from cleanup_orders);
delete from public.stripe_webhook_events where stripe_event_id='evt_redeemrace';
delete from public.ticket_tiers where event_id in(select id from cleanup_events);
delete from private.event_public_eligibility_intervals where event_id in(select id from cleanup_events);
delete from private.event_moderation_evaluations where event_id in(select id from cleanup_events);
delete from private.event_moderation_actions where event_id in(select id from cleanup_events);
delete from private.event_policy_acceptances where event_id in(select id from cleanup_events);
delete from private.event_risk_disclosures where event_id in(select id from cleanup_events);
delete from public.events where id in(select id from cleanup_events);
delete from public.organizer_stripe_accounts where organizer_id='a6100000-0000-4000-8000-000000000001';
delete from public.organizers where id in ('a6100000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000002');
delete from auth.users where id in ('a6100000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000002');
update private.checkout_runtime_control set checkout_creation_enabled=:'prior_switch'::boolean where singleton;
commit;
SQL
  fi
  if [[ "$result" != 0 ]]; then
    for log in "$scratch"/*.log; do [[ ! -f "$log" ]] || sed -n '1,50p' "$log" >&2; done
  fi
  # Retain evidence on failure; successful scratch contains generated SQL output only.
  if [[ "$result" == 0 ]]; then rm -r -- "$scratch"; else echo "Race evidence: $scratch" >&2; fi
  exit "$result"
}
trap cleanup EXIT

# Collision means these are not our fixtures; do not claim or clean them.
[[ "$("${psql_cmd[@]}" -c "select count(*) from auth.users where id in ('$owner_id','a6100000-0000-4000-8000-000000000002')")" == 0 ]]
"${psql_cmd[@]}" >"$scratch/setup.log" <<SQL
begin;
\i '$fixture_dir/core_ticket_truth_lite_setup.inc'
select pg_temp.record_and_fulfill('redeemrace','redeemrace',id,session_id) from fulfillment_orders where kind='clean';
commit;
SQL
setup_done=1
ticket_hash="$("${psql_cmd[@]}" -c "select encode(credential_hash,'hex') from public.tickets where event_id='$event_id' order by order_item_id,unit_sequence limit 1")"
[[ "$ticket_hash" =~ ^[a-f0-9]{64}$ ]]

# A third connection holds the SAME event advisory lock that both scans need.
# Keep its FIFO open until pg_stat_activity proves both independent workers wait.
mkfifo "$scratch/gate"
"${psql_cmd[@]}" <"$scratch/gate" >"$scratch/gate.log" 2>&1 & gate_pid=$!
exec 3>"$scratch/gate"
printf "begin; set local statement_timeout='15s'; set local idle_in_transaction_session_timeout='20s'; select public.lock_event_ticketing_operation('%s'); select 'barrier-ready';\n" "$event_id" >&3
for ((attempt=0;attempt<100;attempt++)); do
  if grep -q '^barrier-ready$' "$scratch/gate.log"; then break; fi
  sleep 0.05
done
grep -q '^barrier-ready$' "$scratch/gate.log"
scan_sql="begin; set local role service_role; set local statement_timeout='15s'; set local lock_timeout='12s'; select outcome from public.server_redeem_paid_ticket('$owner_id','$event_id',decode('$ticket_hash','hex')); commit;"
PGAPPNAME="${run_tag}_a" "${psql_cmd[@]}" -c "$scan_sql" >"$scratch/a.log" 2>&1 & worker_a=$!
PGAPPNAME="${run_tag}_b" "${psql_cmd[@]}" -c "$scan_sql" >"$scratch/b.log" 2>&1 & worker_b=$!
for ((attempt=0;attempt<80;attempt++)); do
  waiting="$("${psql_cmd[@]}" -c "select count(distinct pid) from pg_stat_activity where application_name in ('${run_tag}_a','${run_tag}_b') and wait_event_type='Lock' and wait_event='advisory'")"
  if [[ "$waiting" == 2 ]]; then break; fi
  sleep 0.05
done
[[ "$waiting" == 2 ]]
echo 'Barrier confirmed: 2 independent PostgreSQL sessions waiting on event advisory lock.'
printf 'commit;\n\\q\n' >&3
exec 3>&-
wait "$gate_pid"; gate_pid=""
wait "$worker_a"; worker_a=""
wait "$worker_b"; worker_b=""
outcome_a="$(<"$scratch/a.log")"
outcome_b="$(<"$scratch/b.log")"
[[ ( "$outcome_a" == admitted && "$outcome_b" == already_used ) || ( "$outcome_b" == admitted && "$outcome_a" == already_used ) ]]
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tickets where event_id='$event_id' and status='used' and used_at is not null")" == 1 ]]
first_used="$("${psql_cmd[@]}" -c "select used_at from public.tickets where credential_hash=decode('$ticket_hash','hex')")"
[[ -n "$first_used" ]]
[[ "$("${psql_cmd[@]}" -c "select outcome from public.server_redeem_paid_ticket('$owner_id','$event_id',decode('$ticket_hash','hex'))")" == already_used ]]
[[ "$("${psql_cmd[@]}" -c "select used_at from public.tickets where credential_hash=decode('$ticket_hash','hex')")" == "$first_used" ]]
echo "Concurrent outcomes: $outcome_a / $outcome_b; exactly one durable used_at; replay preserved timestamp; bounded completion, no deadlock."
