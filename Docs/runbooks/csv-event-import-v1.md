# CSV Event Import V1 — activation and operations

The feature ships disabled. Build + Prove does not approve hosted activation. No organizer UUID or Mapbox secret belongs in source. The only event authority remains `public.events` and its existing owner contracts.

## Before a separately authorized activation

1. Review and apply `20260925010000_add_event_import_v1.sql` through the normal tracked migration process. Deploy the two new functions through the normal release process. Neither action was performed by this build.
2. Confirm permanent-geocoding storage entitlement with Mapbox. Configure a server-only `MAPBOX_GEOCODING_ACCESS_TOKEN` and the existing exact-origin `APP_BASE_URL`. Never use a `VITE_` name for the geocoding token. Confirm token billing/rate limits and the supported confidence/address policy using a separately authorized live smoke test.
3. Identify the genuine official organizer by `organizers.id = auth.users.id`. It needs an onboarded profile, a nonblank display name, and an available, non-banned/non-deleted Auth account. Do not create a fake account or grant another admin its identity.
4. Through trusted SQL administration, set the private singleton destination and increment `revision`, then explicitly enable it. Example placeholders below are intentionally not executable production setup:

   ```sql
   begin;
   update private.event_import_settings
   set destination_organizer_id = :verified_official_organizer_id,
       revision = revision + 1,
       enabled = true,
       provider_paused = false,
       updated_at = clock_timestamp()
   where singleton;
   commit;
   ```

5. Grant the intended humans active `admin` using the existing staff-role administration process. Moderator is insufficient. Confirm an ordinary organizer/moderator cannot use the route or contracts.
6. The official organizer must separately complete normal disclosures, policy acceptance, preview, and publish for each event. Admin import does not grant owner edit/image/publication rights. Nothing bulk publishes.

## Processing and recovery

Upload a UTF-8 `.csv` up to 2 MiB / 500 records. Download the header template from `/moderation/event-imports`. Use exact supported columns; dates/times are Los Angeles wall times. Both DST gaps and folds are rejected. Blank capacity means unlimited.

Each Continue makes one bounded request: at most ten provider calls and ten selected-row import transactions. Large selections remain durable; press Continue to finish them. Closing the browser pauses progress; reopen the same batch. A transient address failure observes stored backoff (2/10/30/120 seconds, bounded Retry-After); Continue later, or Retry after exhaustion. Leases expire after 60 seconds and are fenced. A stale response cannot overwrite a reclaimed claim.

Provider authorization/configuration errors pause all provider work. Investigate credentials/entitlement outside logs containing tokens; only after correction should a trusted administrator clear `provider_paused`. Daily budget defaults to 2,500 and resets on a UTC date boundary. At most two unexpired provider claims exist globally. Review capacity/cost before changing the budget.

For ambiguous, unsupported-unit, invalid or out-of-area addresses: fix the CSV and make a new upload. There is no coordinate override or inline correction. Possible duplicates require Skip or an audited Import anyway. A changed candidate causes a new warning and a second explicit decision. Ordinary event edits/status changes are read live when duplicate decisions are checked.

A same-file retry after an uncertain upload retains its actor-scoped request receipt in session storage until success. A completed upload deliberately submitted again gets a new request and batch. Refresh after an uncertain row response; never delete or recreate a draft to compensate. Resulting event IDs are durable and replayable even after cancellation or feature disablement, following active-admin authorization.

Changing the destination or its configuration revision invalidates unresolved work in existing batches; it never retargets them. Cancel old work and re-upload deliberately. Disablement prevents new work. Cancellation preserves created events and skips remaining rows. Revocation/configuration/cancellation serialize with already-committing transactions: an operation that holds the authority locks may finish before the later administrative change commits.

## Retention

`server_prune_event_imports()` is service-only, handles at most ten batches older than 90 days, cancels abandoned work and deletes only rows with no resulting event. Imported linkage/provenance and a small batch receipt remain. It does not delete events. No scheduler is installed or activated by this feature. Pruned batch original file row totals remain historical; current row counts show retained rows only.

## Local proof safety

Use only `tests/integration/run-event-import-local.py` for these disposable projects:

- feature `wheretoo-event-import`: API 60321, PostgreSQL 60322;
- baseline `wheretoo-event-import-baseline`: API 65321, PostgreSQL 65322.

The runner never reads a linked project. Proof scripts verify exact container and loopback port. Do not run fixture/configuration-changing proofs concurrently against the same database. Run the legacy differential before persistent fixtures. A Supabase reset can finish migrations but fail container health checks; inspect its log and migration ledger and keep cron disabled before resuming. No test should silently reinterpret a reset error as a complete pass.

The Deno function runtime uses its own npm cache; `DENO_NO_PACKAGE_JSON=1` in function task scripts prevents the frontend's pnpm dependencies from being replaced. Do not run `deno install --node-modules-dir=auto` in this worktree. The parser is pinned only in Deno imports, not shipped as a browser dependency.
