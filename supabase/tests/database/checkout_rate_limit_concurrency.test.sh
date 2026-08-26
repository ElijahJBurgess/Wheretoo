#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
identity_hash="$(printf 'task-12-rate-concurrency' | shasum -a 256 | awk '{print $1}')"

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  "$supabase_cli" db query --linked "
    delete from private.checkout_rate_limit_buckets as buckets
    using private.checkout_rate_limit_config as config
    where buckets.identity_digest = extensions.hmac(
      decode('$identity_hash', 'hex'), config.identity_hmac_secret, 'sha256'
    );
  " >"$temporary_directory/cleanup.log" 2>&1
  cleanup_status=$?
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  if [[ $original_status -ne 0 ]]; then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT

"$supabase_cli" db query --linked "
  delete from private.checkout_rate_limit_buckets as buckets
  using private.checkout_rate_limit_config as config
  where buckets.identity_digest = extensions.hmac(
    decode('$identity_hash', 'hex'), config.identity_hmac_secret, 'sha256'
  );
  set role service_role;
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
" >"$temporary_directory/prefill.log" 2>&1

"$supabase_cli" db query --linked "
  set role service_role;
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
" >"$temporary_directory/first.log" 2>&1 &
first_pid=$!

"$supabase_cli" db query --linked "
  set role service_role;
  select * from public.server_consume_checkout_rate_limit('$identity_hash');
" >"$temporary_directory/second.log" 2>&1 &
second_pid=$!

wait "$first_pid"
wait "$second_pid"

allowed_count="$(grep -h -c '"allowed": true' \
  "$temporary_directory/first.log" "$temporary_directory/second.log" | \
  awk '{ total += $1 } END { print total + 0 }')"
denied_count="$(grep -h -c '"allowed": false' \
  "$temporary_directory/first.log" "$temporary_directory/second.log" | \
  awk '{ total += $1 } END { print total + 0 }')"

if [[ "$allowed_count" -ne 1 || "$denied_count" -ne 1 ]]; then
  echo "Expected one allowed and one denied concurrent rate-limit result." >&2
  sed -n '1,120p' "$temporary_directory/first.log" >&2
  sed -n '1,120p' "$temporary_directory/second.log" >&2
  exit 1
fi

echo "Atomic checkout rate-limit concurrency passed: one allowed, one denied."
