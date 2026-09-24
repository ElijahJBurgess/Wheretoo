# Email Attendees V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** Build and prove the approved event-scoped organizer email flow without activating hosted delivery.
**Architecture:** Separate private message/recipient ledger, authenticated preview/submit/receipt, dedicated worker, existing provider/encryption, shared suppression and signed webhook dispatcher.
**Tech Stack:** Supabase PostgreSQL, Deno Edge Functions, React/Vite, React Email, Vitest, Playwright.
**Spec:** `Docs/specs/email-attendees-v1-inspect-spec.md`; latest binding decisions: `Docs/specs/email-attendees-v1-build-approval.md`.

## Global Constraints

- No hosted migration, real email, activation, push, merge or deployment. Defaults fail closed.
- No grants/members/ticket-outbox entries/issuance or financial changes.
- Exact approved audience, +168-hour boundary, limits, suppression and durable request UUID rules apply.
- Retention is 90 days after terminal safety; retain unknown/evidence/suppression/idempotency needs.
- Same shared worktree; implementations sequential, independently reviewed. No subagents from implementers. Do not commit until relevant verification passes; root coordinates final commit decision.
- Prior SQL debt is differential against pristine current main; new failures block completion.

## Review Focus

- Concurrent send/fingerprint reads must use one materialized audience and debit once.
- Receipt replay must work after config/window changes and browser identity switch must not leak data.
- Worker payload bytes/key must survive retries; unknown cannot become false failure.
- Shared suppression opposite-provenance upserts and webhook races must preserve FKs and evidence.
- Browser preview and worker template must share exact frozen facts without private media or ticket links.

### Task 1: Database ledger, policy and contracts

**Files:** new migration `supabase/migrations/20260924010600_add_organizer_messages_v1.sql`; SQL proof and concurrent Python runner under `tests/integration/`; generated `src/lib/supabase/database.types.ts` if locally possible.
**Consumes:** current authoritative order/free coherence, refund state, moderation and lock conventions.
**Produces:** precise RPC schemas documented in `Docs/testing/email-attendees-v1-contracts.md` for downstream tasks. Implement all E contracts from spec, including options, preview, submit, receipt, service worker and verified observer dispatcher, shared suppression provenance, separate settings/limits and pruning. Names may be refined coherently and documented.
- [ ] Inspect relevant latest schema overrides and current proof fixture patterns.
- [ ] Write failing SQL assertions for absent contracts and audience/authorization before implementing.
- [ ] Implement private tables, immutability/permissions, dedicated event policy, strict text/selectors, server snapshot/fingerprint, limits, request idempotency.
- [ ] Implement leased worker contracts, immutable payload, retry/observations/shared suppression, transactional backlog/capacity gate and retention; no hosted activation.
- [ ] Run SQL tests on isolated local DB plus real two-connection request concurrency; record exact commands/results and baseline differences.
- [ ] Document exact request/result types, configuration/health contracts and errors for Tasks 2/3. Review diff.

### Task 2: Server delivery, façade and React Email template

**Files:** `supabase/functions/organizer-message/`, `organizer-message-worker/`, `_shared/organizerMessage*.ts`; existing verified webhook index/test; `src/features/ticket-experience/email/OrganizerMessageEmail.tsx`, renderer/types/test; config and Deno test registration.
**Consumes:** Task 1 contracts document and approved spec.
**Produces:** authenticated façade `{action:options|preview|submit|receipt,...}` with strictly validated fields, no recipient projection; independently gated worker using injected transport.
- [ ] Write failing handler/template/worker tests for content safety, auth, unknown outcomes and grant-free delivery.
- [ ] Implement owner-JWT RPC façade, identical safe rendered preview/template facts, platform sender/support and optional anonymous images/CTA.
- [ ] Implement dedicated worker using existing provider adapter and null-grant AES-GCM context; claim/prepare/save/begin/send/finish with exact bytes/key preservation.
- [ ] Route signed webhook only after verification to database dispatcher. Preserve ticket behavior.
- [ ] Run Deno and template tests/typechecks; prove injected transport outcomes and no real network email. Document façade schemas and activation prerequisites for Task 3.

### Task 3: Organizer composer and entry points

**Files:** `src/features/organizer-messages/`; router; dashboard/order/registration details; focused component/API/browser tests.
**Consumes:** Task 2 façade and canonical preview/receipt schemas.
**Produces:** protected email-attendees route, paid/free/individual selection, preview/count/confirmation/queued and durable request reconciliation.
- [ ] Read frontend conventions and write failing user behavior tests.
- [ ] Add API/schema/query layer with identity-scoped state; no recipient lists/arbitrary destinations.
- [ ] Add composer/preview flow and three entry points; handle every specified failure and same-request ambiguous reconciliation.
- [ ] Add keyboard/focus, mobile 390px and desktop browser proofs including logout, double-click, drift/zero/limits.
- [ ] Run frontend tests, lint/typecheck/build and browser tests. Review actual UI and diff.

### Task 4: Integration, whole-branch review and final proof

**Files:** isolated local proof harness, regression/differential artifacts, `Docs/testing/email-attendees-v1.md`.
- [ ] Run all required current suites; reproduce preexisting SQL failures on pristine baseline, identify any new regression.
- [ ] Prove complete local submit→snapshot→independent worker→injected provider→signed observation chain, bulk 1000/1001, authorization, grant absence and isolation.
- [ ] Independent whole-branch review; fix substantive issues with focused regression proof.
- [ ] Record all 29 requested completion items, exact HEAD/state, tests and manual activation gates; stop before merge/deploy.
