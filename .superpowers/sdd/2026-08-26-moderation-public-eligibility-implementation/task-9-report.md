# Task 9 Report: Review Requests and Anonymous Report Anti-Abuse

## Status

DONE_WITH_CONCERNS

## What changed

- Added authenticated owner RPCs for one exact-revision review request and withdrawal.
- Added service-only `server_submit_event_report` with a reason allowlist,
  current-public revision/digest revalidation, actor/revision dedupe, atomic
  actor/network rate buckets, and one queued `report` evaluation after three
  distinct actors in 24 hours. It never changes moderation status or public
  eligibility.
- Added an immutable staff-action trigger that resolves only a matching current
  open review request and writes a distinct `resolve_review` audit action.
- Added 30-day fingerprint-retention cleanup through a service-only operation;
  the function comment records the required managed-secret rotation cadence.
- Added the unauthenticated `report-event` Edge boundary. It accepts only
  `{eventId, reason}`, exact-origin CORS, and computes separate in-memory
  actor/network HMAC fingerprints from the normalized forwarded client address.
  It sends only opaque digests to the service RPC and returns bounded,
  non-oracular responses.
- Added `[functions.report-event] verify_jwt = false`. This is a necessary
  deployment dependency for the approved anonymous endpoint; no existing
  function configuration changed.

## Migrations

- `20260826010800_add_review_requests_and_reports.sql` was dry-run as the only
  pending migration and applied once to the linked development project.
- Lint identified one unused local in the applied function. Under controller
  ruling 27, forward-only `20260826010850_harden_review_reports_lint.sql`
  replaced only `server_submit_event_report` to remove that variable and
  reassert its service-only ACL. It was separately dry-run as the only pending
  migration and applied once. `010800` was not edited or replayed.

## Verification

- RED: Deno failed because `report-event/index.ts` and `contracts.ts` were
  absent; linked pgTAP failed because `server_submit_event_report` was absent.
- Focused Deno: `5/5` green.
- Focused linked rollback pgTAP: `13/13` green. It proves service-only ACLs,
  empty search paths, no raw identifier/free-text columns, report dedupe,
  three-actor one-job escalation, and no Pride/drag event state/eligibility
  change.
- Official `supabase test db --linked` reached the linked target but stopped
  only at the known local Docker prerequisite (`LegacyDockerRunError`); the
  established rollback-only linked fallback passed.
- `deno check`, `deno lint`, `deno fmt --check`, `git diff --check`, and
  `supabase db lint --linked --schema public,private` passed.
- Linked history is aligned through `010850`; final exact linked dry-run is
  empty (no migrations, seeds, or roles pending).
- Hosted `report-event` deployed only. The first deploy attempted normal
  packaging and failed before release because the CLI did not automatically
  upload the root Deno import map for the existing shared bare module import.
  Retrying only this function with `--import-map deno.json` uploaded the map
  and deployed successfully. This flag is required by the current CLI/package
  layout; no source workaround or unrelated function deployment was made.
- Hosted safe probes: invalid origin OPTIONS/POST returned `403` with only
  `CORS_ORIGIN_DENIED`; approved exact-origin OPTIONS returned `204`; malformed
  exact-origin POST returned `400` with only `INVALID_REQUEST`; and an unknown
  exact-origin event returned the same safe `404 EVENT_NOT_FOUND` response.

## Remaining concern / blocker

The hosted valid-report/dedupe/cleanup probe is not run. The global private
rate-bucket schema stores only opaque bucket digests and types; it has no event
or fixture correlation key. The hosted endpoint must not return or log the
separately HMACed network bucket digest, and task rules prohibit reading or
printing HMAC values. Therefore an exact post-HTTP cleanup of the one network
bucket cannot be performed without deleting an unsafe timestamp-wide set of
unrelated buckets or adding a forward schema/API cleanup contract. The direct
rollback pgTAP provides valid/dedupe/threshold proof with zero persisted
fixture state. Controller ruling 28 explicitly prohibits a broad timestamp
cleanup, secret-derived digest inspection, or an added correlation contract;
the hosted valid/dedupe probe remains intentionally omitted.

## Security/process incident

The initial package-runner managed-secret command echoed the generated report
fingerprint secret in command output. The value is intentionally not recorded
here. It was immediately rotated through the direct CLI binary, which did not
echo the replacement. No repository file contained a secret, and no Stripe,
payment, or Build 3 source/API/test was accessed.
