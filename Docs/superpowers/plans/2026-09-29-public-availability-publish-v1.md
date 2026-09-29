# Public Availability + Publish Flow Cleanup V1 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, then one independent whole-diff reviewer. Keep all changes uncommitted per founder instruction.

**Goal:** Preserve explicit disclosure answers and show current canonical publication status without reload.

**Architecture:** Extend the existing publisher's organizer-edit hold provenance guard without changing risk/eligibility gates. Separate nullable disclosure reads from strict writes and refresh existing owner/public queries on the status page.

**Tech Stack:** React, TypeScript, TanStack Query, Zod, Vitest, Playwright, local PostgreSQL/pgTAP.

**Spec:** `Docs/specs/2026-09-29-public-availability-publish-v1.md`

## Global Constraints

Execution complete. All tasks below were performed; detailed results and inherited baseline debt are recorded in `Docs/testing/2026-09-29-public-availability-publish-v1.md`. Checkbox lists below preserve the original execution plan. Final state is intentionally uncommitted for founder review.

- One narrowly scoped migration for proven organizer-edit hold provenance; no hosted application.
- Keep changes uncommitted; no push/merge.
- No hosted writes, real agreements, staging publication or payment changes.
- Preserve owner-only server publication, risk rules and context/revision checks.
- Browser proof at 390px and 1440px; synthetic local policy fixtures only.

## Review Focus

- Absent requirements with unavailable policies must stay unanswered.
- Existing saved false answers must remain valid after hydration.
- Cached draft must not redirect before the owner read finishes.
- A hold arriving after a live result must remove live actions on refresh.
- Failed/offline refresh and identity changes must not present stale private data as current.

## Task 1: Preserve unanswered disclosures

Files: moderation schemas/API, EventRequirementsStep, eventChanges schemas, EventEditorPage and focused tests.

Interface: nullable read fields; `EventRequirementsInput` remains strict for writes. Form booleans become boolean|null and age uses empty selection.

- [ ] Add failing tests: absent RPC returns null fields; unconfigured-policy context preserves null; editor renders no selected radios and cannot save/continue until every answer is explicit.
- [ ] Run focused tests and inspect expected failures.
- [ ] Implement nullable read schema/transform, nullable form defaults and strict schema validation before writes. Display answer errors. Preserve saved answers and agreements.
- [ ] Run focused schema/API/editor tests, including imported draft and saved false hydration.

## Task 2: Current publication outcome

Files: event/moderation query options, PublishedEventPage, EventCreationOutcome, EventPublishConfirmation and tests.

Interface: opt-in status-page revalidation/polling; explicit check refetches both owner and public reads.

- [ ] Add failing tests: cached draft loading before redirect, retry both reads, review result has refresh action, blocked state cannot claim live, pending refresh hides stale live actions.
- [ ] Run tests and inspect failures.
- [ ] Implement always-on-entry refresh, foreground 15-second refresh, coupled manual retry, safe pending/error handling, and truthful outcome/confirmation copy.
- [ ] Test then preserve allowlisted publish error codes in `publishIfCurrent`; unknown diagnostics stay sanitized and context conflicts keep their existing behavior.
- [ ] Run page/query/preview regression tests and typecheck.

## Task 3: Build + Prove

Files: focused SQL/browser proof and `Docs/testing/2026-09-29-public-availability-publish-v1.md`.

- [ ] Verify local migration baseline and execute SQL publication, policy, incomplete, worker, edit, ownership, projection, discovery and import suites. Record known baseline failures.
- [ ] Run local concurrency proof for stale publish/edit/disclosure/policy, duplicate publication, worker/hold/cancel boundaries. Keep all state local.
- [ ] Run real local API publication fixtures and browser journeys at both widths; distinguish route mocks from real database proof; inspect screenshots.
- [ ] Run pnpm typecheck, lint, test, build, typecheck:functions, test:functions; inspect exits and logs.
- [ ] Independent final diff review, address material findings with regression tests, and inspect final diff/check/status.
- [ ] Record all 32 requested report fields. Stop for founder review; no commit.

### Task 3 prerequisite: reproduced backend transition regression

- [ ] Add SQL regression reproducing repeated owner edits followed by clean free/paid publication; show failure on pristine main.
- [ ] Add private provenance helper walking exact owner revision/version history; extend only the publish hold-clear guard in `publish_event_without_change_history` via tracked migration.
- [ ] Prove human/system holds across later edits, current holds, broken history and elevated risk do not clear. Prove old workers cannot overwrite the new clear generation.
- [ ] Replay pristine main plus migration in dedicated local stack; run unchanged suites on both targets and compare. Re-run real browser proof against feature stack.

Updated self-review: initial frontend-only decision was provisional and disproved by real browser publication. This is the authorized outcome B, not a moderation redesign. No additional founder decision is needed; the existing all-No/risk contract stays intact.

Self-review: tasks cover spec and Review Focus; nullable read fields are never passed directly as valid writes. Query changes are opt-in so editor drafts keep their existing behavior. The browser-reproduced repeated-edit hold gap justifies the later prerequisite migration task. User's explicit immediate-execution and uncommitted instructions override skill approval/commit defaults.
