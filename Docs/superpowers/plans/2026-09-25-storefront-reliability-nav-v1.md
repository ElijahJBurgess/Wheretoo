# Storefront Reliability + Organizer Navigation V1 Implementation Plan

> Execute inline with superpowers:executing-plans; keep every change uncommitted for founder review.

**Goal:** Reliable Storefront loading and primary navigation beside My Events.
**Architecture:** Preserve existing editor/public routes, owner RPCs and public projection. Fix initial stale-cache hydration in the loader, reuse existing navigation and state styles.
**Tech Stack:** React, TanStack Query, React Router, Vitest, Playwright, Supabase/PostgreSQL.
**Spec:** Docs/specs/2026-09-25-storefront-reliability-nav-v1.md

## Global Constraints
No production/hosted changes, agreements, staging event publication, payments activation, commits, pushes or merges. No migration unless evidence requires one. No unrelated baseline fixes.

## Review Focus
- Cached old editor data must not win over refreshed profile data.
- Refresh failure must offer retry, never display an editable stale form.
- Sign-out during a delayed load must never expose private content.
- Missing handle must lead to existing Profile completion, not a broken public link.
- Empty events and request failures must remain distinct.

### Task 1: Navigation and initial loading reliability
Files: OperationsUi.tsx/test, OrganizerLayout.tsx, OrganizerStorefrontEditorPage.tsx/test.
Interfaces: Existing editor DTO and /organizer/settings/storefront route remain unchanged.
- [x] Add regression: seed query cache with old name, defer readEditor, assert no Display name input until response resolves, then assert new canonical name.
- [x] Add nav regression at Storefront and Events routes: Storefront follows My Events, aria-current is correct, Settings is not simultaneously active.
- [x] Run focused Vitest; expect failures demonstrating missing nav and old form visible.
- [x] Set `refetchOnMount: 'always'` and gate initial loader mount with `query.isPending || (query.isFetching && !query.isFetchedAfterMount)`; add NavLink to existing route and exclude Storefront subtree from Settings active matching. Add fallback-shell link.
- [x] Add successful empty-event and pending event-choice copy, preserving retry.
- [x] Verify focused tests including retry, no handle, saved public link and sign-out in flight.

### Task 2: Public and browser proof
Files: new public page tests and tests/e2e/storefront-reliability.spec.ts/config.
Interfaces: Existing public document and browser auth fixture conventions.
- [x] Test null => not-found, rejected RPC => retryable error, valid/empty projection => public view; preserve event URL and logo behavior.
- [x] Run local fixture journeys at 390/1440 for primary navigation, saved-handle public link, reload, empty/not-found, loading/retry, incomplete identity and sign-out. Assert no overflow and inspect screenshots.
- [x] Run existing local SQL owner/eligibility suites without hosted writes; document any inherited fixture failures.

### Task 3: Build, review, report
Files: Docs/testing/2026-09-25-storefront-reliability-nav-v1.md.
- [x] Run pnpm typecheck, lint, test, build, typecheck:functions, test:functions and inspect each result.
- [x] Perform read-only staging contract/route proof; distinguish unavailable fixture from infrastructure failure.
- [x] Review full uncommitted diff, security and scope; record all requested report fields and stop for founder review.

Self-review: all spec requirements mapped; same route/DTO across tasks; no placeholders or delegated product decisions requiring approval. Explicit founder instructions override skill commit/approval defaults.
