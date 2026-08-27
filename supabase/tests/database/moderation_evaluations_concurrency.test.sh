#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
supabase_cli="$repository_root/node_modules/.bin/supabase"
temporary_directory="$(mktemp -d)"
claim_session_pid=""

fixture_user='17000000-0000-0000-0000-000000000009'
fixture_event_one='27000000-0000-0000-0000-000000000009'
fixture_event_two='27000000-0000-0000-0000-000000000010'
fixture_evaluation_one='37000000-0000-4000-8000-000000000009'
fixture_evaluation_two='37000000-0000-4000-8000-000000000010'
concurrency_marker='918507'

if [[ ! -x "$supabase_cli" ]]; then
  echo "Supabase CLI is not installed at the project-local path." >&2
  exit 1
fi

sanitize_log() {
  local log_file="$1"

  rg -o \
    'ERROR: +[0-9A-Z]+|ASSERT_[A-Z0-9_]+|constraint \\"[A-Za-z0-9_.-]+\\"|relation \\"[A-Za-z0-9_.-]+\\"' \
    "$log_file" | head -n 6 >&2 || true
}

run_query() {
  local phase="$1"
  local sql="$2"
  local log_file="$temporary_directory/${phase}.log"
  local query_status

  set +e
  "$supabase_cli" db query --linked "$sql" >"$log_file" 2>&1
  query_status=$?
  set -e

  if [[ $query_status -ne 0 ]]; then
    echo "$phase failed with exit code $query_status." >&2
    sanitize_log "$log_file"
    return "$query_status"
  fi
}

cleanup_sql="begin;
set local session_replication_role = replica;
delete from private.event_public_eligibility_intervals
where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from private.moderation_review_requests
where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from private.event_reports
where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from private.event_moderation_actions
where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from private.event_moderation_evaluations
where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from private.event_policy_acceptances
where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from private.event_policy_legacy_exemptions
where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from private.event_risk_disclosures
where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from public.events
where id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid);
delete from public.organizers where id = '$fixture_user'::uuid;
delete from auth.users where id = '$fixture_user'::uuid;
commit;"

cleanup() {
  local original_status=$?
  local cleanup_status

  trap - EXIT
  set +e
  if [[ -n "$claim_session_pid" ]] && kill -0 "$claim_session_pid" 2>/dev/null; then
    wait "$claim_session_pid"
  fi
  "$supabase_cli" db query --linked "$cleanup_sql" \
    >"$temporary_directory/cleanup.log" 2>&1
  cleanup_status=$?
  if [[ $cleanup_status -ne 0 ]]; then
    echo "Moderation concurrency fixture cleanup failed with exit code $cleanup_status." >&2
    sanitize_log "$temporary_directory/cleanup.log"
  fi
  find "$temporary_directory" -type f -delete
  rmdir "$temporary_directory"
  if [[ $original_status -ne 0 ]]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}

trap cleanup EXIT

wait_for_claim_marker() {
  local marker_log="$temporary_directory/claim-marker.log"
  local marker_status=1
  local claim_status

  for _attempt in 1 2 3 4 5 6 7 8; do
    if ! kill -0 "$claim_session_pid" 2>/dev/null; then
      set +e
      wait "$claim_session_pid"
      claim_status=$?
      set -e
      claim_session_pid=""
      echo "first claim session ended before the overlap marker with exit code $claim_status." >&2
      sanitize_log "$temporary_directory/first-claim.log"
      return 1
    fi
    set +e
    "$supabase_cli" db query --linked "
      do \$assert\$
      begin
        if not exists (
          select 1
          from pg_catalog.pg_locks
          where locktype = 'advisory'
            and classid = 0
            and objid = '$concurrency_marker'::oid
            and granted
        ) then
          raise exception using errcode = 'P0001', message = 'ASSERT_CLAIM_MARKER_NOT_READY';
        end if;
      end
      \$assert\$;
    " >"$marker_log" 2>&1
    marker_status=$?
    set -e
    if [[ $marker_status -eq 0 ]]; then
      return 0
    fi
  done

  echo "claim marker was not reached before the overlap deadline." >&2
  sanitize_log "$marker_log"
  return "$marker_status"
}

run_query "pre-cleanup" "$cleanup_sql"

run_query "setup" "
  begin;
  insert into auth.users (id, email)
  values ('$fixture_user', 'queue-concurrency@example.invalid');
  insert into public.organizers (
    id, display_name, organizer_type, base_city, country_code,
    onboarding_completed_at
  ) values (
    '$fixture_user', 'Queue Concurrency Fixture', 'Community group',
    'San Francisco', 'US', statement_timestamp()
  );
  insert into public.events (
    id, organizer_id, status, moderation_status, title, description, category,
    starts_at, ends_at, timezone, venue_name, address_line1, city, region,
    postal_code, country_code, mapbox_feature_id, latitude, longitude,
    admission_type, capacity, published_at, content_revision,
    moderation_version, public_history_status
  ) values
    (
      '$fixture_event_one', '$fixture_user', 'published', 'under_review',
      'Queue Fixture One',
      'A complete fixture for durable queue concurrency proof.', 'community',
      statement_timestamp() + interval '2 days',
      statement_timestamp() + interval '2 days 2 hours',
      'America/Los_Angeles', 'Fixture Hall', '1 Market Street',
      'San Francisco', 'CA', '94105', 'US', 'mapbox.queue-one',
      37.7936, -122.3958, 'free', 10, statement_timestamp(), 1, 1,
      'never_public'
    ),
    (
      '$fixture_event_two', '$fixture_user', 'published', 'under_review',
      'Queue Fixture Two',
      'A complete fixture for durable queue concurrency proof.', 'community',
      statement_timestamp() + interval '3 days',
      statement_timestamp() + interval '3 days 2 hours',
      'America/Los_Angeles', 'Fixture Hall', '2 Market Street',
      'San Francisco', 'CA', '94105', 'US', 'mapbox.queue-two',
      37.7936, -122.3958, 'free', 10, statement_timestamp(), 1, 1,
      'never_public'
    );
  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present,
    explicit_adult_content, gambling_present, weapons_present,
    high_risk_activity
  ) values
    ('$fixture_event_one', 'all_ages', false, false, false, false, false, false),
    ('$fixture_event_two', 'all_ages', false, false, false, false, false, false);
  insert into private.event_moderation_evaluations (
    id, event_id, content_revision, input_sha256, queued_moderation_version,
    status, source, created_at
  ) values
    (
      '$fixture_evaluation_one', '$fixture_event_one', 1,
      private.compute_event_input_sha256('$fixture_event_one'),
      1, 'queued', 'contextual', '2000-01-01 00:00:00+00'
    ),
    (
      '$fixture_evaluation_two', '$fixture_event_two', 1,
      private.compute_event_input_sha256('$fixture_event_two'),
      1, 'queued', 'contextual', '2000-01-01 00:00:01+00'
    );
  commit;
"

"$supabase_cli" db query --linked "
  begin;
  set local statement_timeout = '30s';
  set local role service_role;
  do \$assert\$
  declare
    claimed_id uuid;
  begin
    select evaluation_id into claimed_id
    from public.server_claim_moderation_evaluation('concurrency-a');
    if claimed_id is distinct from '$fixture_evaluation_one'::uuid then
      raise exception using errcode = 'P0001', message = 'ASSERT_FIRST_CLAIM_MISMATCH';
    end if;
  end
  \$assert\$;
  select pg_catalog.pg_advisory_xact_lock($concurrency_marker);
  select pg_catalog.pg_sleep(15);
  commit;
" >"$temporary_directory/first-claim.log" 2>&1 &
claim_session_pid=$!

wait_for_claim_marker

run_query "skip-locked-claim" "
  begin;
  set local statement_timeout = '10s';
  set local role service_role;
  do \$assert\$
  declare
    claimed_id uuid;
  begin
    select evaluation_id into claimed_id
    from public.server_claim_moderation_evaluation('concurrency-b');
    if claimed_id is distinct from '$fixture_evaluation_two'::uuid then
      raise exception using errcode = 'P0001', message = 'ASSERT_SKIP_LOCKED_CLAIM_MISMATCH';
    end if;
  end
  \$assert\$;
  commit;
"

set +e
wait "$claim_session_pid"
claim_session_status=$?
set -e
claim_session_pid=""
if [[ $claim_session_status -ne 0 ]]; then
  echo "first claim session failed with exit code $claim_session_status." >&2
  sanitize_log "$temporary_directory/first-claim.log"
  exit "$claim_session_status"
fi

run_query "overlap-state" "
  do \$assert\$
  begin
    if (
      select count(*)
      from private.event_moderation_evaluations
      where id in ('$fixture_evaluation_one'::uuid, '$fixture_evaluation_two'::uuid)
        and status = 'processing'
        and attempt_count = 1
    ) <> 2 then
      raise exception using errcode = 'P0001', message = 'ASSERT_OVERLAP_STATE_MISMATCH';
    end if;
  end
  \$assert\$;
"

run_query "revision-supersession" "
  begin;
  select private.invalidate_event_public_revision(
    '$fixture_event_one', 'full_review', '$fixture_user'
  );
  do \$assert\$
  declare
    apply_result text;
  begin
    if not exists (
      select 1
      from public.events
      where id = '$fixture_event_one'::uuid
        and content_revision = 2
        and moderation_version = 2
        and moderation_status = 'under_review'
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_REVISION_VERSION_NOT_ADVANCED';
    end if;
    if not exists (
      select 1
      from private.event_moderation_evaluations
      where id = '$fixture_evaluation_one'::uuid
        and status = 'superseded'
        and attempt_count = 1
        and failure_code = 'CONTENT_REVISION_CHANGED'
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_CLAIM_NOT_SUPERSEDED';
    end if;
    if (
      select count(*)
      from private.event_moderation_actions
      where event_id = '$fixture_event_one'::uuid
        and actor_type = 'organizer'
        and actor_user_id = '$fixture_user'::uuid
        and source = 'edit'
        and previous_content_revision = 1
        and content_revision = 2
        and moderation_version = 2
    ) <> 1 then
      raise exception using errcode = 'P0001', message = 'ASSERT_ORGANIZER_ACTION_MISSING';
    end if;

    select public.server_apply_moderation_evaluation(
      evaluations.id,
      evaluations.content_revision,
      evaluations.input_sha256,
      evaluations.queued_moderation_version,
      'clear_candidate',
      'low',
      array['no_violation'],
      null,
      null
    )
    into apply_result
    from private.event_moderation_evaluations as evaluations
    where evaluations.id = '$fixture_evaluation_one'::uuid;

    if apply_result is distinct from 'superseded' then
      raise exception using errcode = 'P0001', message = 'ASSERT_STALE_APPLY_NOT_SUPERSEDED';
    end if;
  end
  \$assert\$;
  commit;
"

run_query "post-cleanup" "$cleanup_sql"

run_query "leakage" "
  do \$assert\$
  begin
    if exists (
      select 1 from auth.users where id = '$fixture_user'::uuid
      union all
      select 1 from public.organizers where id = '$fixture_user'::uuid
      union all
      select 1 from public.events
        where id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid)
      union all
      select 1 from private.event_risk_disclosures
        where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid)
      union all
      select 1 from private.event_moderation_evaluations
        where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid)
      union all
      select 1 from private.event_moderation_actions
        where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid)
      union all
      select 1 from private.event_public_eligibility_intervals
        where event_id in ('$fixture_event_one'::uuid, '$fixture_event_two'::uuid)
    ) then
      raise exception using errcode = 'P0001', message = 'ASSERT_FIXTURE_LEAKAGE';
    end if;
  end
  \$assert\$;
"

echo "moderation queue SKIP LOCKED and organizer-revision supersession: PASS"
