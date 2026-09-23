# AI Event Cover Phase 1 implementation plan

**Goal:** Three private durable candidates, explicit selection into the existing canonical cover, and safe concurrent manual changes.
**Spec:** User-approved BUILD AI EVENT COVER — PHASE 1 request, 2026-09-22.
**Execution:** Inline, tests first. No commits, hosted operations, OpenAI, generation UI, worker or scheduler.

## Architecture and decisions

Private generation and three candidate records; private staging bucket; a small private event cover state row supplies a revision without modifying event content/moderation revisions. All mutations lock the event before reading/changing cover state. Validated uploads stage immutable objects in the existing private event-images bucket; staged objects have no event_images attachment and cannot pass public delivery. A single transaction switches the canonical attachment only after bytes exist, ownership/status and expected revision match. Legacy direct delete/reorder mutation paths must be closed to prevent bypass. Manual upload UI remains unchanged; its transport carries the revision from the displayed state, never a freshly fetched revision that would silently authorize a stale tab.

Selected generation stores an immutable receipt. Duplicate selection returns that receipt without restoring artwork after later manual changes. Successful replacement retires old attachment records transactionally; best-effort Storage deletion follows. Interrupted staging can leave private orphan bytes; no cleanup worker is added in Phase 1.

## Tasks

- [x] SQL tests: generation ownership/deduplication, exactly three slots, private candidate access, stale/duplicate selection, full legacy gallery, failure preservation and manual races. Run against baseline and observe missing foundation failure.
- [x] Add one migration: private state/generations/candidates, narrow owner and service RPCs, staging trigger and atomic commit/removal, revoke bypass mutation grants/policies.
- [x] Extend event-images Edge transport: validated revision-bound manual upload, selected-candidate copy with byte validation, removal, idempotent retry/reconciliation. No fixture ingestion endpoint.
- [x] Frontend transport tests first, then atomic state reads and displayed-revision mutations in existing manager. Preserve all visible copy/layout.
- [x] Disposable local Storage/Auth/PostgREST/function proof with service-seeded fixture candidates: privacy, reload, successful canonical bytes, duplicate/stale/concurrent requests, failure and manual compatibility.
- [x] Run SQL, HTTP, Deno, focused frontend, typecheck, lint, build. Inspect diff and independent final review. Record results and exact Phase 2 boundary.

## Review focus

- Stale requests from pre-migration clients must not bypass revisions.
- An idempotent retry after a newer replacement must not reattach the old candidate.
- No attachment exists while an object copy is incomplete or unconfirmed.
- Empty cover states and full legacy galleries must both support atomic replacement.
- Candidate metadata/read/signing must not leak to anonymous users or another organizer.
