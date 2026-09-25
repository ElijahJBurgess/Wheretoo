# Organizer Onboarding + Identity V1 Implementation Plan

> Execute inline using superpowers:executing-plans and test-driven-development. User explicitly delegates decisions, requests immediate implementation after self-review, and prohibits commits/push/PR/merge.

**Goal:** One safe Account → Profile → Payouts journey.
**Architecture:** Shared Profile editor uses canonical organizers and existing storefront identity/media contracts. Add a narrow revision-aware draft writer and allow optional logo on the existing permanent claim.
**Tech Stack:** React, TypeScript, React Query, Supabase/Postgres, Vitest, Playwright.
**Spec:** Docs/specs/2026-09-24-organizer-onboarding-identity-v1.md

## Global constraints
No hosted production changes. No payment/Connect changes. No replacement profile/handle/media system. Uncommitted handoff. Existing guards remain authoritative.

## Review focus
- A→B→A identity transition while reads/uploads/saves resolve: suppress results and follow-on writes.
- Completed organizer without logo: preserve completion, claim and storefront publication constraints separately.
- Competing Settings/Storefront updates: reject stale version without overwriting branding.
- Upload succeeds and claim fails: preserve uploaded ID for retry; no duplicate upload.
- Missing hosted RPCs: actionable blocked state, no fake empty identity or retry claim without consent.

## Pre-flight interfaces
Task 1 produces saveProfile(userId,input,expectedUpdatedAt,logoId,isCurrent), returning canonical organizer with handle/logo; Task 2 consumes it. Existing confirmIdentity gets nullable logo and lifetime callback. Task 3 verifies both over real routes and local SQL. No contradiction; optional logo needs narrow migration.

### Task 1: Canonical draft save and identity contract
Files: profile.api.ts/tests under src/features/organizers; storefront.identity.api.ts/tests; new Supabase migration and SQL test; database.types.ts.
- [ ] Write API tests for missing identity RPC, nullable logo, session binding and late identity change. Write SQL test for logo-free claim and draft save.
- [ ] Run focused Vitest and pre-migration SQL; expect failure for new contracts/optional logo.
- [ ] Add narrow draft-save RPC: validate input, insert first row or call save_owned_organizer_settings with expected version; update only type/site/city/logo; preserve completion and storefront fields. Reuse existing claim with nullable logo ownership check.
- [ ] Implement typed API. Preserve PGRST202 distinction; no silent fallback. Fence reads/writes and validate response.
- [ ] Run focused tests and migration fixtures; expect pass.

### Task 2: Shared Profile screen and routing
Files: OrganizerSetupPage.tsx/tests; OrganizerProfilePage.tsx/tests; ProfileEditor.tsx/tests; StorefrontIdentityPage.tsx/test; organizer-onboarding/onboarding.css; storefront link.
- [ ] Write tests for shared fields, required confirmation, read-only claimed handle, failure/retry, draft exit, Back, completed revisit, identity switch and late save.
- [ ] Run tests against old code; expect missing consolidated fields/navigation failure.
- [ ] Implement shared loader/editor, grouped fields, uploaded preview, available-handle status and permanent confirmation. Separate draft save from claim; reconcile returned timestamps; invalidate canonical profile/storefront/event caches.
- [ ] Replace standalone identity with redirect; point ordinary links to Profile. Preserve payout and organizer guards.
- [ ] Run focused tests; expect pass.

### Task 3: Build + Prove and review
Files: tests/e2e organizer onboarding proof; local isolated database runner; Docs/testing/organizer-onboarding-identity-v1.md.
- [ ] Adapt real-browser fixtures to authoritative contracts. Test signup→Profile→Payouts, reload, completed handle, optional fields/logo, save/exit, retry and sign-out at 390/768/1440. Inspect screenshots.
- [ ] Run local SQL/storage/handle concurrency proof and existing regression suites. Never touch unrelated stacks.
- [ ] Run pnpm typecheck, lint, test, build, typecheck:functions, test:functions. Compare failures with baseline.
- [ ] Inspect diff and obtain fresh branch review under executing-plans. Fix substantive findings with tests.
- [ ] Write all requested report fields including exact limits on hosted root-cause attribution. Stop uncommitted for founder review.

## Self-review
Scope matches requested single cleanup. No Settings/profile duplication, no payment behavior change, no storefront redesign. Missing backend deployment cannot be repaired without violating no-hosted-mutation boundary; report local proof separately. No ordinary decisions need founder approval.

## Execution result
Implementation and final review completed uncommitted. API/SQL/UI RED→GREEN proof and two concurrency-review fixes recorded in the ignored execution ledger. Final report: Docs/testing/organizer-onboarding-identity-v1.md.

Task 3 remains PARTIAL: the dedicated local Docker/Auth/database became intermittently unresponsive after 25 broad SQL suites passed; real Storage/concurrent-claim and full forward-fixture proof are incomplete. Hosted staging contract drift is diagnosed and remains unmodified by explicit user scope. All completed frontend/functions/build/browser checks passed. No commit/push/merge.
