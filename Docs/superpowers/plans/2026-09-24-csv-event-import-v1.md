# CSV Event Import V1 Implementation Plan

> For agentic workers: use the executing-plans skill if implementation is subsequently authorized. This document authorizes no execution, subagent dispatch, commit, migration, deployment, or provider activation. Steps use checkboxes for future tracking.

**Goal:** let active admins import reviewed CSV rows into exactly one ordinary official-organizer-owned free draft per row, then let the genuine official owner review and publish through existing contracts.

**Architecture:** three private tables hold configuration, batch receipts and durable rows/intents/results. Bounded admin-triggered Edge processing parses and verifies locations outside DB transactions; a service-only SQL contract atomically creates one event and its row receipt. Existing owner editing, policy acceptance, publication, discovery, RSVP and ticket/email systems remain authoritative.

**Tech stack:** existing React/TypeScript/Vite, Supabase Auth/PostgreSQL/PostGIS, Deno Edge, Zod, Vitest/RTL, pgTAP, Python local proof runners and Playwright; proposed server-only pinned csv-parse and injectable Mapbox v6 adapter.

**Spec:** [complete inspection/specification](</Users/exoh/Desktop/WhereTo -  Repository/Docs/specs/2026-09-24-csv-event-import-inspect-spec.md>). The report's A–Y sections, including explicit recommendations and qualifications, govern this plan. Baseline is `3627e9a604b133dd129d60ee87e09eecff5a9e98`.

## Global constraints

- Inspection only until the user authorizes Build + Prove. Preserve all existing recovery-checkout work.
- Free only; official destination resolved server-side; no picker, source accounts, new payment/ticket/RSVP path, auto-publish, broad staff authority or consumer provenance.
- Genuine-owner publication is the selected V1 operating model. Foreign admins get read-only imported-draft inspection, not owner impersonation. If that model is rejected, stop before building an alternative publisher.
- At most 500 nonblank CSV records and 2,097,152 bytes; strict UTF-8 and exact supported headers; full structural parse before source-row persistence.
- Reject unknown authority fields; fatal malformed structure creates no events; individual invalid rows do not block valid rows.
- Preserve canonical Bay Area bounds and owner publication rules. Imports reject ambiguous DST times without changing manual editor semantics.
- No real Mapbox/email/Stripe calls needed for import proof. No hosted DB access, activation, scheduler, deployment, commit/push/merge is implied by future local build permission.
- No network call inside a SQL transaction; one event-creation transaction per row; durable selection intent and immutable imported event receipt.
- New geocoding token server-only; storage entitlement verified before eventual activation; source URLs never fetched.
- Keep report and test evidence honest about baseline failures, provider mocks, and owner-only publication.

## Review focus

1. Two admins, two tabs or a lost response must never create a second event for one row (Tasks 3 and 6).
2. A revoked role, changed destination or cancelled batch must fence a stale worker without erasing committed results (Tasks 2, 3 and 6).
3. Apparently valid addresses outside the Bay Area or ambiguous returned candidates must never receive import permission (Tasks 1, 2 and 6).
4. A fall-back wall time or an event whose start passes while under review must not silently become a different/unpublishable event (Tasks 1 and 3).
5. Admin draft review must not pretend foreign ownership grants editing, policy acceptance, image rights or publication (Tasks 4 and 5).

## Task 1 — strict parser, field/time validation and provider adapter

**Create:** `supabase/functions/_shared/eventImportCsv.ts`, `eventImportValidation.ts`, `eventImportTime.ts`, `eventImportGeocode.ts`, and adjacent `*.test.ts` files.

**Modify:** `deno.json`, `deno.lock`, `deno.staging-import-map.json` only for the pinned Edge parser dependency. Keep the parser out of browser bundles.

**Consumes:** raw `Uint8Array` CSV, injected time and injected fetch; no browser event object.

**Produces:** `parseImportCsv(bytes) -> ParsedImportFile`; `validateImportRow(cells, now) -> ValidatedRow | InvalidRow`; `geocodeImportAddress(input, dependencies) -> GeocodeOutcome`.

Contract data definitions:

```ts
type RowIssue = { field: string; code: string; message: string };
type ParsedImportFile = {
  rows: { recordNumber: number; startLine: number; cells: Record<string, string> }[];
};
type ImportLocation = {
  mapboxFeatureId: string; addressLine1: string; addressLine2: string | null;
  city: string; region: 'CA'; postalCode: string; countryCode: 'US';
  latitude: number; longitude: number;
};
type GeocodeOutcome =
  | { kind: 'verified'; location: ImportLocation; evidence: Record<string, unknown> }
  | { kind: 'needs_review'; code: string; candidates: Record<string, unknown>[] }
  | { kind: 'invalid'; code: string }
  | { kind: 'retryable'; code: string; retryAfterSeconds: number | null }
  | { kind: 'configuration_error'; code: string };
```

All objects from transport must be runtime-validated and bounded before satisfying these types. The internal JSON fields do not make arbitrary provider objects trusted.

- [ ] Write failing Deno fixture tests for the exact parser/value/time/geocode matrix in report T. Include a malformed last row after 499 good rows; assert the parser returns no accepted file. Include invalid UTF-8 split across chunks and the maximum byte-size case.
- [ ] Run `pnpm exec deno test --allow-env supabase/functions/_shared/eventImportCsv.test.ts supabase/functions/_shared/eventImportValidation.test.ts supabase/functions/_shared/eventImportTime.test.ts supabase/functions/_shared/eventImportGeocode.test.ts` and record failures attributable to absent implementation.
- [ ] Add/pin csv-parse after verifying its supported ESM entry in the existing Deno runtime. Implement parse-to-arrays/header validation; semantic row validation is separate. Enforce every limit before adding persistent work.
- [ ] Implement explicit LA candidate-count conversion: zero/two matches reject, exactly one yields an instant. Cache conversions within the request for repeated values; do not import React/browser runtime modules into Edge.
- [ ] Implement structured Mapbox request construction with permanent mode and server-only token; use only injected transport in tests. Enforce the report's hard gates and conservative confidence policy; never conflate outage and invalid address.
- [ ] Rerun those tests and `pnpm typecheck:functions`. Verify no fetch in tests can reach a real provider. Record maximal-file parse CPU/memory measurements for later scale comparison.

**Deliverable:** deterministic parser/validation/geocode modules with no DB or event writes.

## Task 2 — private persistence, admin/destination authority and resumable geocoding

**Create:** `supabase/migrations/<next_timestamp>_add_event_import_v1.sql`, `supabase/tests/database/event_import_schema.test.sql`, `event_import_security.test.sql`; `supabase/functions/_shared/eventImportService.ts`, `eventImportHttp.ts` with tests; `supabase/functions/event-import-upload/index.ts`, `event-import-process/index.ts` with tests.

**Modify:** `supabase/config.toml`, `.env.example`, Deno function mappings and generated public RPC types through a dedicated local database, never the linked script.

**Consumes:** Task 1 normalized rows and geocode outcomes; authenticated bearer verified by Supabase; existing private staff role infrastructure.

**Produces:** the three tables from report J; upload receipt and batch history/read RPCs; fenced claim/complete RPCs; upload/continue/retry/cancel operations. Service-only parameters carry verified actor ID; public clients cannot call these contracts directly.

- [ ] Write failing SQL tests for gates/defaults, FKs, uniqueness, imported-result invariants, zero direct table privileges, anon/organizer/moderator/inactive-admin denials, malformed service payloads and wrong batch membership.
- [ ] Create a guarded dedicated local feature DB runner before applying migrations; assert target localhost/project identity and disable local cron. Record the expected initial SQL failures.
- [ ] Implement singleton config/destination resolution with no default UUID, no fallback organizer name, and checks for actual Auth/profile availability. Lock role/config to serialize revocation and destination changes with mutations.
- [ ] Implement batch upload uniqueness `(actor,requestId)` bound to file digest/name. Completely parse a bounded file before persisting rows. On repeated key with different content, return a conflict; preserve failed structural-upload receipts without storing raw bytes.
- [ ] Implement a streamed raw-file upload envelope: query parameters requestId/filename only, content type `text/csv`, 2 MiB measured body cap; exact-key metadata validation. Authenticate before buffering. Treat filename as bounded text, not a path. Non-upload mutation JSON gets a 16 KiB cap and exact per-operation keys.
- [ ] Implement work claims with 60-second fenced leases, due times, five-attempt transient policy, global two-call concurrency and durable daily budget. Save only if lease/revision/role/config/batch state remain valid. Complete network I/O outside SQL.
- [ ] Implement continuation with 10-row/20-second bounds; do not await a sleeping retry loop. Persist backoff and return progress. UI-triggered future requests advance due work.
- [ ] Add bounded cancellation and retention contracts with no scheduler. Cancellation preserves imported rows; prune only eligible terminal payloads and keep replay tombstones.
- [ ] Run schema/security suites plus injected HTTP/worker tests. Assert no service-role direct table grants, no raw token logs, and no current-owner/public projections change.

**Deliverable:** durable admin-only upload/geocode/review data, still creating zero events.

## Task 3 — duplicates, reviewed selections and atomic draft creation

**Extend:** the same feature migration before it is applied outside the isolated proof environment; `eventImportService.ts`; `event-import-process/index.ts`.

**Create:** `supabase/tests/database/event_import_behavior.test.sql` and duplicate/idempotency tests.

**Consumes:** immutable normalized rows, verified geocode evidence, admin identity and batch destination.

**Produces:** normalization/index helpers, duplicate snapshot/digest, audited skip/override decisions, durable selected-row intent, and `server_import_event_row` returning `imported` with a durable event ID, `needs_review`, or a bounded failure code.

```ts
type ImportSelection = {
  rowId: string;
  expectedRevision: number;
  expectedDuplicateDigest: string;
};
type ImportRowResult =
  | { kind: 'imported'; rowId: string; eventId: string }
  | { kind: 'needs_review'; rowId: string; code: string }
  | { kind: 'failed'; rowId: string; code: string; retryable: boolean };
```

- [ ] Write failing tests for exact normalized title/address matching, 30-minute edge, same-batch earliest-record anchor, cross-organizer/event-state matches, override digest changes, and candidate preview truncation with full digest truth.
- [ ] Implement private immutable normalization helpers and the two expression indexes. Explicitly test manual authenticated insert/update and index evaluation privileges: grant narrowly necessary execution on pure normalizers if required; never grant access to private import data to make an index work.
- [ ] Implement duplicate decisions with server-computed candidate set and expected fingerprint, never browser-authored candidates. No “import anyway” for invalid or unverified locations.
- [ ] Persist row intents for at most 50 selections per call. Fresh readiness/fingerprint mismatch returns a per-row review result; selection retries do not create new identities or erase earlier intents.
- [ ] Implement per-row transaction with role/settings → batch → row → title-deduplication lock order. All import mutation paths use that order; none waits for provider I/O. For a replayed imported row, return the same result after current admin authorization even if creation is now gated off.
- [ ] Recheck time, location, destination and duplicate evidence; insert explicit normal draft columns; atomically persist row result. Do not insert disclosures, policy acceptance, paid tiers, orders, tickets or email.
- [ ] Process at most 10 row transactions per continuation; preserve successful rows when a later one fails. Record sanitized retryable errors only after the failed row transaction has rolled back.
- [ ] Run SQL behavior/security tests and actual two-connection races. Verify 1,000 same-row retry calls still map to one event; inspect ordinary defaults, PostGIS point, ineligible interval and change-history initialization.

**Deliverable:** exactly-once row-to-draft creation with bounded partial success.

## Task 4 — admin review interface and genuine-owner handoff

**Create:** `src/features/event-imports/RequireImportAdmin.tsx`, `EventImportsPage.tsx`, `EventImportBatchPage.tsx`, `EventImportReviewTable.tsx`, `EventImportDraftPage.tsx`, `eventImports.api.ts`, `eventImports.queries.ts`, `eventImports.schemas.ts`, `eventImports.css`, with adjacent tests.

**Modify:** `src/app/router/router.tsx`, `src/components/layout/OrganizerLayout.tsx`, `src/features/organizer-operations/OperationsUi.tsx` and relevant route/navigation tests.

**Consumes:** bounded batch/row read projections and mutation result contracts from Tasks 2–3. Browser owns only selection intent and display state.

**Produces:** `/moderation/event-imports`, batch review and imported-draft read-only view, admin navigation and normal owner editor links when actual ownership matches.

- [ ] Write failing RTL/API tests for admin versus moderator rendering, upload limits, strict response decoding, paged status counts, selection/retry/skip/override, malformed-response handling, and logout clearing private cache.
- [ ] Add routes under existing RequireStaff plus the new admin-only guard. Keep `/staff` unused and preserve storefront route allocation.
- [ ] Add template download with headers/example values; no bulk user-data export. Render source content as text, not HTML. Source metadata remains inside admin screens.
- [ ] Implement progress/Continue as a bounded sequence of awaited server calls; no duplicate loops per tab, stop on authentication/configuration error, honor retry timestamps, and recover from server truth after reload/lost response.
- [ ] Display only owner-authorized editor/preview links. For a foreign admin, show canonical read-only imported-draft details and owner-review handoff; no ability to edit event fields, disclose risks, attach images, consent or publish.
- [ ] Add existing-pattern loading/error/empty states, semantic selection controls, focus management and mobile table containment. Do not redesign existing owner screens.
- [ ] Run targeted Vitest/RTL tests plus typecheck/lint. Inspect API arguments to confirm the browser cannot pass actor, organizer, event ID, coordinates, moderation or publication authority.

**Deliverable:** usable admin workflow with honest ownership behavior.

## Task 5 — canonical event, publication and Free RSVP end-to-end proof

**Create:** `tests/integration/event-import-proof.py`, `tests/integration/edge/event-import/local.ts`, SQL integration fixtures, `tests/e2e/event-import.spec.ts`, `playwright.event-import.config.ts`.

**Consumes:** real local Supabase Auth/PostgREST/database and built application from Tasks 1–4, injected external transports only.

**Produces:** a documented real canonical journey and owner-boundary evidence.

- [ ] Authenticate an active admin who is not the destination owner; upload/import two valid events (one null capacity, one finite). Assert private row provenance exists and public reads cannot see drafts.
- [ ] Prove that admin cannot use normal owner edit/publish/image RPCs, while its imported-draft read-only route works. Authenticate the real official owner separately; no identity spoofing or shared JWT mutation.
- [ ] Open imported draft through the ordinary editor; verify no invented risk answers/consent. Complete real synthetic disclosure choices and configured development policy acceptance. Publish through unchanged owner contract. Hold a second event through normal moderation and prove it remains ineligible.
- [ ] Confirm standard event/discovery/storefront projection, official organizer display and absence of provenance. Test current time-window behavior explicitly without changing the seven/30-day discrepancy.
- [ ] RSVP to the published event through normal Free RSVP HTTP; assert ordinary registration/ticket/credential/collection source shape and idempotent retry. Exercise null capacity and race finite last slot using two connections.
- [ ] Verify normal QR success, duplicate rejection and cancellation behavior. Enable email only in isolated fixtures; prove exactly one initial receipt, injected delivery failure, normal recovery/resend, and disabled-email behavior. Never send email to a real recipient.
- [ ] Assert imported events cause zero paid tiers/orders/registrations/tickets/email at import time. Confirm public/buyer implementation contains no import-specific logic.

**Deliverable:** canonical downstream integration proof; not a hosted deployment claim.

## Task 6 — crash/race/scale, baseline comparison, visual proof and handoff

**Create:** `tests/integration/event-import-concurrency.py`, `event-import-scale.py`, `event-import-regressions.py`, `Docs/testing/csv-event-import-v1.md`, a setup/retention runbook. Extend the dedicated local runner to support an isolated pristine-main baseline.

**Consumes:** complete feature, deterministic injected Mapbox fixtures and the report T assertion matrix.

**Produces:** reproducible evidence and an honest completion report.

- [ ] Run role revocation, destination change, stale lease, cancellation versus commit and simultaneous import on separate real connections with barriers. Verify earlier commits survive and late workers cannot mutate rows.
- [ ] Simulate death after claim, before request, after external response, before DB commit, after DB commit/before HTTP response, and during the summary response. Resume without re-upload and verify stable event IDs.
- [ ] Run report T's exact 500-row scenario: final 395 drafts/105 skipped. Re-run every selection/continuation and compare the full row→event mapping. Force one insertion failure and prove no orphan event or missing receipt.
- [ ] Run the 2 MiB parser stress case separately, provider budget exhaustion and a 10,000-existing-event duplicate-query plan check. Record peak memory, elapsed time, per-page queries and lease/provider call counts; keep credential/provider payloads out of evidence.
- [ ] Build a fresh pristine-main local baseline at the same upstream commit; run relevant SQL/frontend/Edge/integration suites on both. Label pre-existing failures exactly and require zero new unexplained failures. Avoid linked/hosted legacy runners.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm typecheck:functions`, `pnpm test:functions`, the new local runners, and Playwright production-build journeys. Use the frontend-visual-qa skill when implementation exists; inspect 390px/1440px screenshots, overflow/focus/loading/error states and browser console/network errors.
- [ ] Review actual code diff, grants, bundle/env output and public projections. Confirm scope, no secret leakage, no placeholders, no new consumer branches, and no broad ownership/policy changes.
- [ ] Document files/migrations, exact commands/results and baseline deltas, provider/mock limits, owner-publisher prerequisite, manual activation steps and remaining risks. Return local gates OFF and leave scheduler inactive. Stop without deploy/commit/push/merge unless separately authorized.

**Deliverable:** evidence-backed Build + Prove result ready for a separate activation decision.

## Plan self-review and coverage

Report A–E/B–D/O map to Tasks 2, 4 and 5; F–I to Task 1; J–M/P–R to Tasks 2–3 and 6; N to Task 4; S–T to Tasks 5–6; U–Y constrain every task. The five Review Focus failure modes each have owned tests. Task 6 uses the exact fixture arithmetic in the report. External-provider behavior is injected, while database transactions, role grants and canonical consumer paths are real local contracts. No step requires a real Mapbox call, hosted change, broad staff access, or another ticket truth.

This is the complete future implementation sequence. Execution has not started.
