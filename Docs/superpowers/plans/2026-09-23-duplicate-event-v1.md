# Duplicate Event V1 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution, followed by an independent whole-change review. Founder authorized Build + Prove and subsequently Git closeout under the differential SQL gate. Commit/push/PR/merge are authorized after final checks; production deployment remains prohibited.

**Goal:** Duplicate reusable owned event configuration into an independent, unpublished draft with blank schedule and independent flyer.
**Architecture:** Authenticated Edge validates identity, obtains an owner-only source fingerprint, stages validated private bytes, then calls one atomic authenticated SQL finalizer. No new model tables/columns. Browser uses the existing editor.
**Tech Stack:** React/TypeScript, Supabase PostgreSQL/Auth/Storage/Edge, Vitest, Deno, pgTAP, local HTTP and Playwright.
**Spec:** `Docs/specs/duplicate-event-v1-inspect-spec.md`, including approved founder override appendix.

## Global Constraints

- New event/tier/image IDs; starts_at and ends_at null; current non-archived paid tiers only.
- Reject blocked/removed, anonymous/missing/foreign sources server-side. No history/acceptance/payment copies.
- No automatic mutation retry or global idempotency subsystem. Unknown results require My Events inspection.
- No source model extension, RLS relaxation, ordinary-cover behavior change, merge or deployment.
- Local proof uses its own project/ports/database; never reset shared/hosted data.

## Review Focus

- Stage adoption through ordinary manual/AI cover RPCs must fail even when actor owns both events.
- A lost final response cannot cause cleanup to remove a successfully committed image.
- Price/capacity-only edits and absent disclosures must be covered by fingerprints.
- Emoji titles must satisfy the frontend UTF-16 limit as well as SQL character length.
- Identity A→B→A and component unmount must fence cache/navigation completion.

### Task 1: SQL atomic copy and image staging boundary

Files: new migration `supabase/migrations/20260924010500_add_duplicate_event_v1.sql`; new `supabase/tests/database/duplicate_event.test.sql`; new local runner `tests/integration/run-duplicate-event-local.py`; generated database types.
Interfaces: `get_owned_event_duplicate_context(uuid) -> {fingerprint,image:{id,path}|null}`; `duplicate_owned_event(uuid,uuid,text,text default null) -> uuid`. Both auth.uid-owned; no organizer argument. Service staging metadata binds owner/source/fingerprint/image and new target path. Context uses an explicit private configuration helper. Finalizer locks source via existing ticketing lock order and locks staged storage object, compares config, inserts explicit event/tier/disclosure fields plus canonical attachment/cover state in the same transaction. Ordinary cover commits cannot adopt unattached duplication objects.

- [x] Write SQL assertions before the migration; run against full baseline and observe missing-function failure.
- [x] Implement title UTF-16 budgeting; allowlist/fingerprint; auth/status checks; service-only staging trigger branch. Example contract assertions:
  ```sql
  select is((select starts_at from events where id=target),null::timestamptz,'new date required');
  select is((select status from events where id=target),'draft','always draft');
  select throws_ok($$select get_owned_event_duplicate_context(foreign_id)$$,'P0001','EVENT_NOT_FOUND');
  ```
- [x] Test absent/present requirements, zero–three tiers, archive exclusion, complete allowlist, source unchanged, fresh bookkeeping, agreement/publication guards, Unicode boundary and no inherited transaction rows.
- [x] Exercise full migration chain in dedicated local stack and verify grant/stage binding/expired-stage rollback cases.

### Task 2: Authenticated Edge orchestration and real Storage proof

Files: new `supabase/functions/duplicate-event/{index.ts,duplicateEvent.ts,duplicateEvent.test.ts}`; config entry; `tests/integration/duplicate-event-proof.py`.
Interfaces: strict POST `{sourceEventId}` -> 201 `{eventId}`; known errors carry stable codes, final RPC transport ambiguity yields `DUPLICATE_OUTCOME_UNKNOWN`. Request-scoped bearer RPC client; separate service-only Storage client. Reuse image byte validator. Storage copied with fresh metadata and upsert false. Never delete on uncertain finalization.

- [x] Write failing Deno orchestration tests for byte failures, source conflict, response loss, no-history metadata and cleanup preservation.
- [x] Implement bounded HTTP/auth/CORS envelope and orchestration; no client owner/source configuration accepted.
- [x] Run real Auth/Storage/Edge tests for no flyer, JPEG/PNG/WebP, AI-selected canonical pixels; byte equality and distinct IDs/paths; independent replace/remove in both directions.
- [x] Test corrupt/missing bytes, wrong MIME/size limits, ownership/path/fingerprint/expiry tampering, direct-RPC denial and ordinary-cover adoption denial.
- [x] Race source event/tier/disclosure/cover/lifecycle changes between read and finalization. Assert coherent success or conflict; no destination partials.

### Task 3: My Events action and editor guidance

Files: new `src/features/events/duplicateEvent.api.ts` and tests; `event.queries.ts`, `OrganizerEventsPage.tsx` and tests; editor guidance/tests; scoped existing CSS.
Interfaces: `duplicateEvent(sourceEventId, isCurrent) -> {eventId}`; mutation retry false and identity-lifetime guard. Page synchronous ref fence, all duplicate actions disabled while in flight, action outside link; success route `/organizer/events/<id>/edit?resume=1` with notice state. Unknown outcome disables retry until list inspection.

- [x] Write failing transport/page tests for success, double-click, known failure/conflict/unknown, logout/unmount and blocked/removed message.
- [x] Implement strict response/error mapping, mutation and button/guidance. No new editor/router.
- [x] Run targeted existing/new frontend tests and real Playwright 390px/desktop journey through saved editor, blank schedule, fresh agreement, refresh and keyboard; capture screenshots and inspect them.

### Task 4: Regression proof and review

Files: `tests/e2e/duplicate-event.spec.ts`, local proof config as needed, `Docs/testing/duplicate-event-v1.md`.
- [x] Run full frontend tests, typecheck, lint, build, Deno tests/checks. Record baseline failures separately.
- [x] Run impacted SQL event/RLS/tier/checkout/ticket/free/moderation/agreements/history/refund/image/storefront/CSV suites against dedicated current-main-derived database.
- [x] Review actual diff for authorization, transaction and Storage races, source metadata leakage, placeholders, scope and dependency/secret safety.
- [x] Independent whole-change review; fix substantive findings with regression proof.
- [x] Report all required status/HEAD/files/contracts/proof/risks/setup fields. Commit only if proof passes; no merge, push or deploy.

Execution outcome: implementation/proof completed. The founder subsequently approved a differential SQL gate; status PASS because all 33 existing failures reproduce on pristine baseline with no new SQL regression. Git commit/push/PR/merge closeout is authorized subject to final checks; production deployment remains prohibited. See `Docs/testing/duplicate-event-v1.md`.
