# AI Event Cover Phase 1 verification

Date: 2026-09-22. Worktree: `/Users/exoh/Desktop/WhereTo-ai-event-cover`. Branch: `codex/ai-event-cover`. Base: `dcb39e6c9f1a155782352ac1f79bd3617fff5472`.

## Foundation and behavior

The existing canonical cover is the first attachment in `private.event_images`, delivered by the existing `event-images` function. The old upload/replace/remove sequence lacked a single revision-checked transaction. Private AI alternatives also needed durable ownership and selection state without becoming public attachments.

Migration `20260922010000_add_ai_event_cover_foundation.sql` adds private cover state, generation and candidate tables. Each generation has exactly three durable slots, a request UUID for payload-checked deduplication, an expected cover revision, and an immutable selection receipt. Candidate states are pending, ready and failed. Starting a later generation supersedes earlier selections. Owners can reload generation state; service-only candidate completion supports fixture ingestion without adding a production fixture endpoint.

The separate `event-cover-candidates` bucket is private, limited to raster images and 5 MiB. Anonymous users and other organizers cannot read or sign candidates. Ready candidates can be signed by their owning organizer while the event is active. Direct table access is revoked and RLS remains enabled.

Selection verifies the authenticated organizer, active event ownership, generation/event/slot relationship, latest generation and expected cover revision. The server validates the candidate bytes and stages an immutable copy in the existing private `event-images` bucket. Only after staging succeeds does a database transaction switch the canonical attachment and increment the shared revision. Staged objects are not attached or publicly delivered. The stage's original revision is also checked, preventing delayed cleanup from enabling old objects to be reattached.

Manual upload and removal now use the same event lock and revision contract. The UI sends the revision of the state actually displayed; conflicts are not silently retried with a newer revision. Existing visible upload/replace/remove controls and copy are unchanged. Legacy direct Storage deletion and reorder writes are closed so old clients cannot bypass concurrency protection.

Repeated selection returns its original receipt without restoring an older image after later changes. A failed copy or transaction preserves the previous canonical cover. Retired objects are deleted best-effort after commit; cleanup failure cannot undo a successful selection.

## Files changed

- SQL: the new migration, `supabase/tests/database/ai_event_cover.test.sql`, and updated `spec15_event_images.test.sql`.
- Edge: `supabase/functions/event-images/index.ts`, new `coverMutation.ts` and its tests.
- Frontend: event-images API, queries, manager and tests; new `coverTransport.ts` and tests; editor test fixture updates; Supabase RPC types.
- Local verification: `tests/integration/ai-cover-storage.py`, `run-ai-cover-local.py`, and the updated legacy Storage harness entry point. ESLint excludes the already gitignored local runtime directory `.supabase/`.
- Documentation: scoped AI-cover corrections in the three V1 source-of-truth documents, the implementation plan, and this report.

## Verification results

All verification ran locally with fixture PNG images, never an AI provider.

| Check | Result |
| --- | --- |
| Complete migration chain from clean local reset | Pass |
| SQL tests | 32 assertions pass (15 foundation, 17 canonical image compatibility) |
| Real Auth/PostgREST/Storage/Edge HTTP tests | 58 checks pass |
| Focused frontend and existing cover consumers | 151 tests across 15 files pass |
| Deno image bytes and mutation tests | 9 tests pass |
| Deno function type check | Pass |
| Application typecheck | Pass |
| ESLint | Pass |
| Production build | Pass, local placeholder public configuration |
| Independent security/concurrency diff review | No blocking findings |

HTTP coverage includes three slots and refresh/reload, anonymous and foreign-organizer denial, canonical public delivery of the selected bytes, duplicate selection and manual requests, simultaneous duplicate selection, stale generation/revision rejection, simultaneous manual upload versus selection with exactly one winner, invalid/missing candidate data and forced destination-copy failure preserving the old cover, legacy full-gallery replacement, removal, cancelled events, and denial of old-client bypass paths. SQL tests include rejection of retired-object reattachment. Existing discovery, preview, My Events, RSVP, ticket and checkout components were included in focused frontend verification. No interactive browser walkthrough is claimed.

Tests first demonstrated missing foundation/transport failures; the retired-object reattachment regression also failed before its fix and passed afterward.

## Reproduce the local integration proof

With Docker running and frozen-lockfile dependencies installed, use `python3 tests/integration/run-ai-cover-local.py start`, then `reset`. Run `serve` in another terminal and `test` in the first. Finish with `stop`. This harness targets only the dedicated `wheretoo-ai-cover-phase1` local stack, API port 56321 and database port 56322. Fixture tests reset their own local records and disable cron only in that dedicated database. Do not aim this harness at a hosted project.

## Status, limitations and later rollout

Phase 1 is implemented and verified locally. Changes are uncommitted. No OpenAI calls or credentials, generation UI, workers, schedulers, deployment, push, hosted Supabase changes or Vercel changes were made. No package or lockfile change was needed.

Interrupted staging or failed post-commit deletion can leave private orphan objects. Phase 1 intentionally adds no retention scheduler or recovery worker. This is storage cleanup debt; unattached objects cannot pass the existing public delivery path. Candidate originals remain private after selection.

A future hosted rollout must coordinate this migration, the updated `event-images` function, and the frontend: older mutation clients fail closed after the legacy bypass paths are revoked. No hosted setup is required to review or reproduce this local proof.

## Exact Phase 2 recommendation

Build one bounded vertical slice: an organizer-only **Generate 3 covers** action and private candidate chooser, backed by a server-only provider adapter that fills these existing three slots. Define prompt inputs, provider timeout/retry behavior, per-organizer limits and cost controls before connecting credentials. Keep selection and all public cover delivery on this Phase 1 contract. Add only the failure recovery and private-object retention mechanism required by the chosen execution model, with explicit authorization before provider or hosted configuration changes. Continue deferring flyer typography, exports, reference images and design editing.
