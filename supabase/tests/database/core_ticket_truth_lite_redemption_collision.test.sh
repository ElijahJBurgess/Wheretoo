#!/usr/bin/env bash
set -euo pipefail

: "${WHERETO_TICKETING_DB_URL:?Explicit disposable loopback database required}"
node --input-type=module -e 'const u=new URL(process.env.WHERETO_TICKETING_DB_URL); if (!["postgres:","postgresql:"].includes(u.protocol)||!["localhost","127.0.0.1","[::1]"].includes(u.hostname)) process.exit(1)'
export PGCONNECT_TIMEOUT=5
export PGOPTIONS='-c statement_timeout=20000'
psql_cmd=(psql "$WHERETO_TICKETING_DB_URL" -X -qAt -v ON_ERROR_STOP=1)
test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# Only claim an absent receipt and fixture namespace on this disposable DB.
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.stripe_webhook_events where stripe_event_id='evt_redeemrace'")" == 0 ]]
[[ "$("${psql_cmd[@]}" -c "select count(*) from auth.users where id in ('a6100000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000002')")" == 0 ]]
"${psql_cmd[@]}" >/dev/null <<'SQL'
select * from public.server_record_webhook_receipt(
  'evt_redeemrace', 'checkout.session.completed', false,
  'cs_test_integrityclean', '2026-07-29.dahlia',
  '2026-09-02 12:00:00+00', repeat('a', 64)
);
SQL
cleanup() {
  result=$?
  trap - EXIT
  "${psql_cmd[@]}" -c "delete from public.stripe_webhook_events where stripe_event_id='evt_redeemrace'" || result=1
  exit "$result"
}
trap cleanup EXIT
prior_receipt="$("${psql_cmd[@]}" -c "select to_jsonb(receipt) from public.stripe_webhook_events receipt where stripe_event_id='evt_redeemrace'")"
prior_switch="$("${psql_cmd[@]}" -c 'select checkout_creation_enabled from private.checkout_runtime_control where singleton')"
race_status=0
bash "$test_dir/core_ticket_truth_lite_redemption_concurrency.test.sh" || race_status=$?
current_receipt="$("${psql_cmd[@]}" -c "select to_jsonb(receipt) from public.stripe_webhook_events receipt where stripe_event_id='evt_redeemrace'")"
if [[ "$race_status" == 0 || "$current_receipt" != "$prior_receipt" ]]; then
  echo 'FAIL: collision must refuse the race and preserve the entire pre-existing receipt.' >&2
  exit 1
fi
[[ "$("${psql_cmd[@]}" -c 'select checkout_creation_enabled from private.checkout_runtime_control where singleton')" == "$prior_switch" ]]
[[ "$("${psql_cmd[@]}" -c "select count(*) from auth.users where id in ('a6100000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000002')")" == 0 ]]
echo 'PASS: pre-existing matching receipt refused; entire receipt, checkout switch, and fixture namespace preserved.'
