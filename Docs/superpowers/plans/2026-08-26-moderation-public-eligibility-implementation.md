# Whereto Build 2.5 Moderation and Public Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove the smallest production-minded moderation, organizer-policy acknowledgment, and canonical public-eligibility foundation that keeps low-risk publishing immediate and gives every public surface—including the future Build 3 map contract—one server-controlled answer.

**Architecture:** PostgreSQL owns lifecycle constraints, revision/digest/version concurrency, immutable eligibility epochs, policy acceptance, staff authorization, reporting, and canonical public projections. Supabase Edge Functions own contextual-moderator and anonymous-report request boundaries; React owns only typed organizer, public, and staff experiences and never decides eligibility. Existing Day 2 records and payment-side code remain intact under founder-locked Stripe Option A.

**Tech Stack:** Node 22, pnpm, React, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, Supabase Auth/PostgreSQL/PostGIS/Edge Functions, Deno, pgTAP, Vitest, React Testing Library, and Playwright.

**Spec:** `Docs/superpowers/specs/2026-08-26-moderation-public-eligibility-design.md`

## Global Constraints

- Read `AGENTS.md`, the approved Build 2.5 spec, the three V1 product documents, and the Day 1/Day 2 specs and plans before Task 1.
- Work in a dedicated `codex/build-2-5-moderation-public-eligibility` worktree created with `superpowers:using-git-worktrees`; preserve the two committed Build 2.5 design commits and all user-owned visual-reference changes.
- Confirm the linked Supabase project is development before every remote mutation. Never run concurrent linked Supabase CLI commands; the CLI's ephemeral login role races under concurrency.
- Applied migrations are immutable. If a pushed migration needs correction, add the next forward-only migration; never edit or replay an applied migration.
- Database TDD protocol: run `pnpm supabase test db --linked` first. If the established Docker `LegacyDockerRunError` prevents pgTAP from starting, run the unchanged SQL suite through the authenticated linked query boundary inside one rollback-only transaction, then prove `pgtap` and fixture leakage are both absent.
- Before every `db push`: re-confirm development identity, run `pnpm supabase db push --linked --dry-run`, and require the dry-run to list exactly the task's migration(s).
- Use the existing per-event `public.lock_event_ticketing_operation(uuid)` advisory lock before event/tier row locks. Moderation/public-policy loss may call existing database reservation checks, but it must not call Stripe.
- Stripe is frozen: zero Stripe/Connect/Checkout/webhook/refund/destination-charge fixtures, API calls, CLI commands, credential reads, secret changes, integration tests, or payment-side implementation changes.
- Founder-locked Option A: hide immediately, block new database reservations, preserve all records, do not expire already-open Sessions, and let the unchanged Day 2 abnormal/reconciliation path handle a rare stale completion.
- Do not build the Build 3 map. The map-safe database projection and typed response are Build 2.5 dependency contracts only.
- Build 2.5 development uses two explicit non-production policy versions: `dev-organizer-terms-v1` at `/organizer-terms` and `dev-event-policy-v1` at `/event-policy`. Their pages contain only the founder-approved placeholder notices and must never be represented as production legal consent.
- Final Organizer Terms and Event Policy are a production-launch prerequisite only. Their absence cannot block Build 2.5 implementation, internal verification, completion, or Build 3 planning/build work.
- Production launch fails closed unless both current required policies are production-approved immutable versions with canonical HTTPS URLs, approved version IDs, effective dates, and exact content digests; development-placeholder versions can never satisfy that readiness check.
- Do not build a policy CMS, full appeals system, organizer reputation, automatic report takedown, automatic refunds, artwork uploader, AI flyer generator, staff-management UI, or giant analytics product.
- Contextual moderation is provider-adapted. If no provider is configured, the worker returns bounded `MODERATOR_UNAVAILABLE`, retries at most three times, and leaves contextual/high-risk events held; deterministically low-risk publication continues.
- Never store chain of thought, raw model prose, raw IP addresses, user agents, auth tokens, or provider secrets. Store only validated structured outcomes and bounded safe codes.
- Use TDD for every behavior: observe focused RED, implement the minimum, observe focused GREEN, then run the task regression set.
- Each task gets a fresh implementation subagent under `superpowers:subagent-driven-development`, followed by spec-compliance and quality/security review. Do not parallelize migrations or shared generated types; frontend-only tasks may proceed only after their database/type dependency is committed.
- After each task: run `git diff --check`, a task-scoped credential scan, stage only listed files, commit with the specified message, write the ignored task evidence report, and leave unrelated files untouched.

## Development Policy Configuration and Production Launch Gate

There is no founder/legal blocker before Build 2.5 execution. Task 3 seeds only these clearly marked development/test policy records:

- `dev-organizer-terms-v1` -> `/organizer-terms` -> `Whereto Organizer Terms will be finalized before public launch.`
- `dev-event-policy-v1` -> `/event-policy` -> `Whereto Event Policy will be finalized before public launch.`

The migration records an explicit `development_placeholder` policy stage and the SHA-256 digest of each exact notice. A private singleton policy environment starts `unconfigured`; a service/admin-only operation sets the confirmed linked development project to `development`, while `production` is rejected unless the current pair is production-approved. Acceptance, publish, and canonical public eligibility fail closed while unconfigured or when the configured environment and required pair disagree. These records prove version selection, event/revision binding, server timestamps, immutable acceptance, and re-acceptance behavior for development only. They contain no invented substantive terms and cannot be promoted or interpreted as production-approved policy versions.

Before any real organizer/public production launch, an operational launch gate must prove all nine conditions: production Organizer Terms exist; production Event Policy exists; both have stable canonical HTTPS URLs; both have approved version identifiers; both have effective dates; both have exact content digests; no `development_placeholder` version satisfies the production-required check; current required-policy configuration references the approved production pair and the policy environment is `production`; and real organizers accept the production pair as appropriate. The production deployment remains closed to real organizer/public traffic until this check passes. This gate does not block Build 2.5 completion or Build 3 planning/build work.

---

## Planned File Map

### Database migrations

- `supabase/migrations/20260826010000_create_moderation_foundation.sql` — additive event revision/history fields and private moderation/policy tables.
- `supabase/migrations/20260826010100_migrate_legacy_moderation.sql` — explicit legacy state classification, quarantine, bootstrap actions/exemptions, epoch initialization, and final moderation constraint.
- `supabase/migrations/20260826010200_add_event_policy_acceptance.sql` — immutable staged policy registry/requirements, fail-closed environment gate, development placeholder pair, owner requirements projection, acceptance RPC, and exact ACL.
- `supabase/migrations/20260826010300_add_moderation_eligibility_functions.sql` — canonical digest, deterministic rules, artwork seam, publication authorization, publish/re-publish, candidate/canonical eligibility, and epoch transitions.
- `supabase/migrations/20260826010400_route_public_reads_through_eligibility.sql` — revoke anonymous base reads and replace event, ticketing, checkout-preflight, fulfillment-validity, and map-safe projections with canonical eligibility.
- `supabase/migrations/20260826010500_add_published_event_revision_paths.sql` — owner-safe published edits plus tier-text and organizer-display-name invalidation.
- `supabase/migrations/20260826010600_add_contextual_moderation_queue.sql` — service-only claim/apply/retry/supersession functions.
- `supabase/migrations/20260826010700_add_staff_moderation_operations.sql` — staff roles, transition matrix, history resolution, queue/case RPCs, and audit ACL.
- `supabase/migrations/20260826010800_add_review_requests_and_reports.sql` — review requests, report/rate buckets, three-actor escalation, and service/owner RPCs.

### Database verification

- `supabase/tests/database/moderation_schema.test.sql`
- `supabase/tests/database/moderation_legacy_migration.test.sql`
- `supabase/tests/database/moderation_policy_acceptance.test.sql`
- `supabase/tests/database/moderation_publish_eligibility.test.sql`
- `supabase/tests/database/public_eligibility_projections.test.sql`
- `supabase/tests/database/moderation_published_edits.test.sql`
- `supabase/tests/database/moderation_evaluations.test.sql`
- `supabase/tests/database/moderation_staff_actions.test.sql`
- `supabase/tests/database/moderation_reviews_reports.test.sql`
- `supabase/tests/database/moderation_epoch_concurrency.test.sh`
- `supabase/tests/database/moderation_action_concurrency.test.sh`
- `supabase/tests/database/moderation_report_concurrency.test.sh`

### Edge Functions

- `supabase/functions/moderate-event-queue/contracts.ts`, `moderator.ts`, `index.ts`, `index.test.ts` — exact structured contextual adapter and one-job worker boundary.
- `supabase/functions/report-event/contracts.ts`, `index.ts`, `index.test.ts` — anonymous report CORS/schema/HMAC/rate boundary.
- `supabase/functions/_shared/env.ts`, `contracts.ts`, `cors.ts`, `.env.example` — server-only environment and shared safe response extensions.

### Browser/domain modules

- `src/features/moderation/moderation.types.ts`, `moderation.schemas.ts`, `moderation.api.ts`, `moderation.queries.ts` — disclosures, policy status, review, reports, staff queue/actions, and typed query keys.
- `src/features/moderation/EventRequirementsStep.tsx`, `OrganizerAgreementStep.tsx` — late organizer flow steps.
- `src/features/moderation/OrganizerTermsPage.tsx`, `EventPolicyPage.tsx` — development-only notice routes; no substantive legal copy.
- `src/features/moderation/ReportEventDialog.tsx` — bounded public report UI.
- `src/features/moderation/RequireStaff.tsx`, `ModerationQueuePage.tsx`, `ModerationCasePage.tsx` — protected minimal moderation console.
- Existing event, ticket, organizer, router, layout, and style modules — narrow integrations only.
- `src/lib/supabase/database.types.ts` — regenerated from the linked schema after all database contracts are applied.

### End-to-end and runbooks

- `tests/e2e/moderation-public-eligibility.spec.ts`
- `tests/e2e/moderation-public-eligibility.visual.spec.ts`
- `tests/integration/moderation-public-projection.test.ts`
- `tests/integration/moderationRunnerContract.test.ts`
- `tests/integration/run-moderation-proof.sh`
- `Docs/testing/build-2-5-moderation-public-eligibility-verification.md`

---

### Task 1: Create the Additive Moderation Foundation Schema

**Purpose:** Add the approved server-controlled facts and private records without yet changing public visibility or legacy meanings.

**Files:**
- Create: `supabase/migrations/20260826010000_create_moderation_foundation.sql`
- Create: `supabase/tests/database/moderation_schema.test.sql`

**Interfaces:**
- Consumes: existing `public.events`, `public.organizers`, `public.ticket_tiers`, Auth users, and `private` schema.
- Produces: event revision/history/authorization columns; private disclosures, artwork decisions, evaluations, actions, reports, review requests, eligibility intervals, policy registry/requirements/acceptances/exemptions, and staff roles.

- [ ] **Step 1: Write the structural RED pgTAP suite**

Assert exact columns/checks/FKs/indexes, default `public_eligibility_version = 0`, transitional moderation vocabulary, private-table presence, action/evaluation vocabularies, interval open-row uniqueness, and default-deny table privileges. Include a compile-time assertion that no organizer-editable `map_eligible` or public-eligibility boolean exists.

- [ ] **Step 2: Run RED against the unchanged linked schema**

Run `pnpm supabase test db --linked`; if Docker blocks before execution, run `moderation_schema.test.sql` unchanged through the rollback-only linked query path. Expected: failures for missing columns/tables and no fixture leakage.

- [ ] **Step 3: Implement the additive migration**

Use exact event fields from the spec:

```sql
alter table public.events
  add column content_revision bigint not null default 1,
  add column moderated_revision bigint,
  add column moderation_version bigint not null default 0,
  add column moderation_updated_at timestamptz,
  add column public_history_status text,
  add column first_publicly_eligible_at timestamptz,
  add column public_eligibility_version bigint not null default 0,
  add column publicly_authorized_revision bigint,
  add column publicly_authorized_action_id uuid;
```

Create all private tables with `revoke all ... from public, anon, authenticated`; allow legacy `flagged` only in the transitional event constraint. Add the partial unique index enforcing one open eligibility interval and append-only trigger guards for actions, closed intervals, acceptances, policy versions, and legacy exemptions.

- [ ] **Step 4: Verify the exact migration before applying**

Confirm development identity, run linked migration history, then `pnpm supabase db push --linked --dry-run`. Expected: only `20260826010000_create_moderation_foundation.sql` pending. Push exactly it.

- [ ] **Step 5: Run GREEN and prior-schema regression gates**

Run focused schema pgTAP, then existing organizer/event and ticketing schema suites. Run `pnpm supabase db lint --linked --schema public,private`; expected: all assertions pass and lint has no new warning/error.

- [ ] **Step 6: Run focused review and scope/security checks**

Review constraints, FK deletion behavior, private privileges, append-only enforcement, absence of public execute defaults, and diff for credential patterns. Do not add functions or application code in this task.

- [ ] **Step 7: Commit the foundation**

```bash
git add supabase/migrations/20260826010000_create_moderation_foundation.sql supabase/tests/database/moderation_schema.test.sql
git commit -m "feat: add moderation foundation schema"
```

---

### Task 2: Migrate Legacy Moderation and Initialize Eligibility History

**Purpose:** Classify every legacy lifecycle/moderation combination without inventing prior-public facts, quarantine ambiguity, retire `flagged`, and initialize version-0 ineligible epochs.

**Files:**
- Create: `supabase/migrations/20260826010100_migrate_legacy_moderation.sql`
- Create: `supabase/tests/database/moderation_legacy_migration.test.sql`
- Modify: `supabase/tests/database/organizers_events_schema.test.sql`
- Modify: `supabase/tests/database/organizers_events_rls.test.sql`

**Interfaces:**
- Consumes: Task 1 tables/columns.
- Produces: final moderation vocabulary, explicit `unknown|never_public|previously_public`, quarantined ambiguous rows, v0 intervals, migration actions/exemptions/authorization pointers, and no remaining `flagged` row.

- [ ] **Step 1: Write the legacy-matrix RED suite**

Create transactional fixtures for published clear/flagged/blocked/removed, draft blocked/removed, cancelled blocked/removed, and anomalous history. Assert positive evidence requirements, quarantine behavior, defensible observed timestamps, exemption/action/pointer atomicity, final status vocabulary, and no fabricated acceptance actor.

- [ ] **Step 2: Run RED on the Task 1 schema**

Expected: legacy rows retain old vocabulary/history and v0 interval/bootstrap assertions fail.

- [ ] **Step 3: Implement the explicit forward migration**

Use a staging CTE/table that records classification evidence before mutation. Insert one open v0 `ineligible` interval per event. For qualifying pre-rollout published revisions, insert `pre_build_2_5_publication` exemption plus migration-sourced `authorize_publication` action and pointers in one transaction. Tighten `moderation_status` to only `not_evaluated|clear|under_review|blocked|removed`; set new-event defaults to `never_public + not_evaluated`.

- [ ] **Step 4: Dry-run and push only the legacy migration**

Reconfirm development, require dry-run to list only `20260826010100_migrate_legacy_moderation.sql`, then push.

- [ ] **Step 5: Run GREEN plus Day 1 ownership/public regressions**

Run the focused legacy suite, organizer/event schema/RLS/publish suites, history alignment, lint, and leakage checks. Expected: no `flagged`, ambiguous rows held, old public rule never exposes `under_review`.

- [ ] **Step 6: Review migration evidence and rollback safety**

Verify every mapping row is deterministic, `published_at` alone is not treated as prior-public proof for blocked/removed, exemption never equals acceptance, and migration does not touch ticket/payment records.

- [ ] **Step 7: Commit the migration**

```bash
git add supabase/migrations/20260826010100_migrate_legacy_moderation.sql supabase/tests/database/moderation_legacy_migration.test.sql supabase/tests/database/organizers_events_schema.test.sql supabase/tests/database/organizers_events_rls.test.sql
git commit -m "feat: migrate legacy moderation safely"
```

---

### Task 3: Add Versioned Organizer Policy Acceptance

**Purpose:** Make the late organizer agreement auditable, immutable, owner/revision/digest-bound, server-versioned, and non-activating.

**Files:**
- Create: `supabase/migrations/20260826010200_add_event_policy_acceptance.sql`
- Create: `supabase/tests/database/moderation_policy_acceptance.test.sql`
- Test: `supabase/tests/database/organizers_events_rls.test.sql`

**Interfaces:**
- Consumes: the two founder-approved development placeholder identifiers/routes/notices and Task 1/2 policy tables; no final legal document is required for this task.
- Produces: `get_required_event_policies()`, `get_owned_event_requirements(uuid)`, `accept_current_event_policies(uuid)`, service/admin-only `private.configure_policy_environment(text)`, `private.production_policy_configuration_is_ready()`, and minimal owner agreement status.

- [ ] **Step 1: Write development-placeholder and production-readiness RED**

Assert the exact development IDs, relative routes, `development_placeholder` stage, exact-notice digests, server-controlled requirement pair, and singleton environment default `unconfigured`. Prove acceptance/public eligibility fail closed while unconfigured; service/admin can configure the confirmed dev project as `development`; browser roles cannot configure it; the development pair is then acceptable for internal event-flow tests while `private.production_policy_configuration_is_ready()` remains false; immutable placeholder rows cannot be relabeled production-approved; production configuration rejects either placeholder requirement; and production readiness requires two distinct production-stage rows with HTTPS URLs/version IDs/effective dates/digests.

- [ ] **Step 2: Write acceptance/security RED pgTAP**

Cover owner A success, owner B denial, anonymous denial, client-selected old version rejection, ignored client timestamp/actor, server timestamp, exact retry idempotency, new revision/new version new row, immutable history, non-activating acceptance, policy change not hiding untouched published events, legacy exemption exact-revision behavior, public leakage denial, and an acceptance of a development version remaining explicitly non-production.

- [ ] **Step 3: Implement the policy migration and exact RPCs**

Add immutable policy stage `development_placeholder|production_approved` and private singleton `organizer_policy_release_settings.environment` with `unconfigured|development|production`, changed only by reviewed migration/admin-service operations. Seed the singleton as `unconfigured` and seed exactly two immutable development rows and requirement references:

```text
dev-organizer-terms-v1 | development_placeholder | /organizer-terms | 2026-08-26T00:00:00Z | 5adc8a233232f30a58152a663394ce01d0af29ddbff8401bdad7f836ee49d475
dev-event-policy-v1    | development_placeholder | /event-policy    | 2026-08-26T00:00:00Z | 797aa818b4e7ee9b1d9eb8e7b5b4dba013616080cdf09ccf33875c9a81429de3
```

The two digests are over the exact UTF-8 notice sentences shown in the development-policy section, with no trailing newline.

Allow relative app routes only for `development_placeholder`; require canonical `https://` URLs for `production_approved`. `private.configure_policy_environment('development')` requires both current rows to be development placeholders; `private.configure_policy_environment('production')` requires both to be production-approved and pass readiness metadata checks; any other value fails. Acceptance, publish, and canonical public eligibility require a configured environment and a matching pair. Production readiness returns true only when the singleton is `production` and the current pair contains one production-approved row of each policy kind with nonblank approved ID, effective date, and 64-character lowercase content digest. Define authenticated RPCs with no client version/timestamp arguments:

```sql
public.get_required_event_policies()
public.get_owned_event_requirements(p_event_id uuid)
public.accept_current_event_policies(p_event_id uuid)
private.configure_policy_environment(p_environment text)
private.production_policy_configuration_is_ready()
```

All security-definer functions use `set search_path = ''`, derive `auth.uid()`, verify owner, lock event then requirements in stable order, recompute the digest, and revoke `PUBLIC` before granting only intended execution. The readiness helper is service/admin operational only and does not expose private policy history to browsers.

- [ ] **Step 4: Dry-run and push only Task 3**

Reconfirm development; dry-run must list only `20260826010200_add_event_policy_acceptance.sql`. Push it, invoke the service/admin-only environment operation with literal `development`, and verify the exact development rows by IDs/stages/digests only. The absence of final production policy documents is not a stop condition; no production environment operation is invoked.

- [ ] **Step 5: Run GREEN and privilege verification**

Run focused acceptance pgTAP and organizer RLS. Inspect `information_schema.routine_privileges` and table ACLs: anon may read only the narrow required-policy projection, authenticated owners may execute owner RPCs, no browser role may read private acceptance/configuration tables or configure the environment, development readiness is false, a rollback-only valid production pair plus production environment makes readiness true without rewriting any development version, and either placeholder/unconfigured state makes it false again.

- [ ] **Step 6: Review idempotency and policy-change semantics**

Prove acceptance inserts no action/epoch/public transition, a browser boolean is irrelevant, current required pair is server-selected, old rows cannot be rewritten, the exact legacy branch cannot advance revisions, and development acceptance cannot be reported by any operational check as production legal consent.

- [ ] **Step 7: Commit the policy contract**

```bash
git add supabase/migrations/20260826010200_add_event_policy_acceptance.sql supabase/tests/database/moderation_policy_acceptance.test.sql supabase/tests/database/organizers_events_rls.test.sql
git commit -m "feat: add organizer policy acceptance"
```

---

### Task 4: Centralize Deterministic Moderation, Publication, and Eligibility Epochs

**Purpose:** Replace clear-by-default publishing with exact digest/revision authorization, synchronous low-risk clearance, fail-closed high-risk handling, and one atomic eligibility transition primitive.

**Files:**
- Create: `supabase/migrations/20260826010300_add_moderation_eligibility_functions.sql`
- Create: `supabase/tests/database/moderation_publish_eligibility.test.sql`
- Modify: `supabase/tests/database/publish_event.test.sql`
- Modify: `src/features/events/publishErrors.ts`
- Modify: `src/features/events/publishErrors.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 tables and `public.lock_event_ticketing_operation(uuid)`.
- Produces: `private.compute_event_moderation_input(uuid)`, `private.compute_event_input_sha256(uuid)`, `private.event_meets_public_candidate(uuid,timestamptz)`, `private.transition_event_public_eligibility(uuid,boolean,uuid)`, replacement `public.publish_event(uuid)`, and stable safe error codes.

- [ ] **Step 1: Write RED for deterministic rules and epochs**

Cover complete low-risk immediate publication; missing disclosures/acceptance; alcohol allowed; coherent California cannabis allowed; explicit/nudity, gambling, weapons, and high-risk activity held; invalid age combinations; protected/community terms never deterministic-prohibited; null artwork allowed; non-null unverified/current-mismatch artwork held; initial clear/hold actions; acceptance non-activation; duplicate publish; unknown-history rejection; and blocked/removed re-publish preservation.

- [ ] **Step 2: Run focused RED**

Expected: current `publish_event` ignores disclosures/revision/authorization and epoch functions are missing.

- [ ] **Step 3: Implement canonical input, rules, and atomic transitions**

Canonical JSON uses sorted stable keys and includes event public fields, disclosures, versioned artwork checksum, tier public name/description, and organizer display name; hash with `digest(..., 'sha256')`. `publish_event` locks advisory -> event -> policy environment -> requirements, rejects `unconfigured`, requires development placeholders only in `development` and production-approved rows only in `production`, validates exact acceptance/exemption, writes distinct `authorize_publication` plus `clear|hold` actions, sets authorization pointers, and calls candidate-to-epoch transition. A production environment with either development placeholder fails before publication and public eligibility. Every status/epoch/action commit is atomic.

- [ ] **Step 4: Dry-run and push exactly Task 4**

Reconfirm development and require only `20260826010300_add_moderation_eligibility_functions.sql` pending before push.

- [ ] **Step 5: Run GREEN plus retained publish/paid-sales DB tests**

Run focused moderation publish suite, existing publish suite, paid-sales suite, schema/RLS suites, DB lint, history, and leakage. Do not run Stripe tests.

- [ ] **Step 6: Review state/action/epoch semantics**

Verify version increments once per true transition; v0 initialization; one open interval; closed interval immutability; first-public timestamp set once; authorization action distinct from moderation action; high-risk no transient public window; and Option A contains no Stripe operation.

- [ ] **Step 7: Commit deterministic eligibility**

```bash
git add supabase/migrations/20260826010300_add_moderation_eligibility_functions.sql supabase/tests/database/moderation_publish_eligibility.test.sql supabase/tests/database/publish_event.test.sql src/features/events/publishErrors.ts src/features/events/publishErrors.test.ts
git commit -m "feat: centralize moderation eligibility"
```

---

### Task 5: Route Public and Day 2 Database Reads Through Canonical Eligibility

**Purpose:** Remove duplicated `published + clear|flagged` rules and anonymous base-table reads while preserving the Day 2 database boundary without touching Stripe/payment-side code.

**Files:**
- Create: `supabase/migrations/20260826010400_route_public_reads_through_eligibility.sql`
- Create: `supabase/tests/database/public_eligibility_projections.test.sql`
- Modify: `supabase/tests/database/ticketing_rls.test.sql`
- Modify: `supabase/tests/database/inventory_reservations.test.sql`
- Modify: `supabase/tests/database/payment_fulfillment.test.sql`

**Interfaces:**
- Consumes: Task 4 canonical/candidate eligibility.
- Produces: `public.get_public_event(uuid)`, replacement `get_public_event_ticketing(uuid)`, `get_public_map_events(...)`, canonical reservation/fulfillment validity, and revoked anon/auth base-table reads.

- [ ] **Step 1: Write public-projection RED**

Assert draft/cancelled/under-review/blocked/removed/stale-revision/unknown-history/invalid-location/ended rows are absent before browser receipt; `unconfigured` policy environment and production-with-placeholder requirements also return no public row; clear current rows in configured development and valid production fixtures return only allowlisted fields; event detail/ticketing/map results agree; organizer bio/site/base city and all moderation/policy internals are absent; anon `select *` fails.

- [ ] **Step 2: Run RED and characterize current leakage**

Expected: existing anonymous base selects succeed and public/ticketing/reservation paths still use `clear|flagged` duplication.

- [ ] **Step 3: Implement narrow projections and replace database predicates**

Create map signature:

```sql
public.get_public_map_events(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_categories text[] default null
)
```

Return only event ID/title/category/time/timezone/point/public venue label/admission/minimum price/minimum age/curated advisories/artwork reference. Revoke anon/auth base-table select, retain owner RLS, and replace only the duplicated database eligibility clauses inside final reservation/fulfillment functions. Do not modify Edge Stripe functions or call Stripe.

- [ ] **Step 4: Dry-run and push only Task 5**

Reconfirm development; dry-run must list exactly `20260826010400_route_public_reads_through_eligibility.sql`; push.

- [ ] **Step 5: Run GREEN, Day 1 public, and Day 2 DB compatibility suites**

Run focused projection tests plus ticketing RLS, inventory reservation, fulfillment, order-confirmation, organizer event RLS, DB lint/history/leakage. Explicitly skip all Stripe integration/webhook/function tests.

- [ ] **Step 6: Review projection and ACL surface**

Inspect function return columns, execute grants, RLS, no hidden row in JSON, no moderation-state oracle, viewport/date/category/location predicates, and no payment-side diff.

- [ ] **Step 7: Commit canonical public reads**

```bash
git add supabase/migrations/20260826010400_route_public_reads_through_eligibility.sql supabase/tests/database/public_eligibility_projections.test.sql supabase/tests/database/ticketing_rls.test.sql supabase/tests/database/inventory_reservations.test.sql supabase/tests/database/payment_fulfillment.test.sql
git commit -m "fix: route public reads through eligibility"
```

---

### Task 6: Add Safe Published Edits and Related-Content Invalidation

**Purpose:** Permit owner edits through server boundaries while revisioning all moderated public content and preserving blocked/removed enforcement.

**Files:**
- Create: `supabase/migrations/20260826010500_add_published_event_revision_paths.sql`
- Create: `supabase/tests/database/moderation_published_edits.test.sql`
- Modify: `supabase/tests/database/paid_sales.test.sql`
- Modify: `supabase/tests/database/organizer_onboarding_update.test.sql`

**Interfaces:**
- Consumes: Task 4 digest/actions/candidate transition and existing tier/event lock order.
- Produces: `save_owned_event_revision(uuid,jsonb)`, revision-aware disclosure save, tier-text invalidation inside `save_ticket_tiers`, and display-name invalidation inside organizer update.

- [ ] **Step 1: Write published-edit RED**

Cover full-review fields, deterministic-only fields, price/capacity no churn, tier name/description invalidation, organizer display-name invalidation of every non-cancelled owned event, private organizer fields no churn, stale acceptance, old review/report supersession, rapid edits, and blocked/removed edit -> accept -> re-publish preservation.

- [ ] **Step 2: Run RED on current direct/draft-only behavior**

Expected: published event save is unavailable; tier and organizer public text do not bump event revision.

- [ ] **Step 3: Implement exact owner mutation functions**

All paths lock event advisory -> event -> tiers as applicable, allowlist JSON keys and reject missing/unknown keys, compute old/new digest, increment `content_revision` once when public/safety content changes, write `record_revision`, supersede active evaluations/reports/review request, preserve enforcement, and require new acceptance before re-publish. Deterministic-only changes may be evaluated without contextual vendor work but cannot bypass agreement.

- [ ] **Step 4: Dry-run and push only Task 6**

Reconfirm development; dry-run lists only `20260826010500_add_published_event_revision_paths.sql`; push.

- [ ] **Step 5: Run GREEN and retained lock-order tests**

Run focused edit suite, paid tier/activation tests, organizer onboarding update, publish eligibility, RLS, and existing tier/event concurrency scripts. No Stripe integration.

- [ ] **Step 6: Review privilege and invalidation boundaries**

Verify browser cannot write protected event columns, missing JSON keys are rejected, owner mismatch is safe not-found, unrelated events stay untouched, and automation never restores blocked/removed.

- [ ] **Step 7: Commit revision paths**

```bash
git add supabase/migrations/20260826010500_add_published_event_revision_paths.sql supabase/tests/database/moderation_published_edits.test.sql supabase/tests/database/paid_sales.test.sql supabase/tests/database/organizer_onboarding_update.test.sql
git commit -m "feat: secure published event revisions"
```

---

### Task 7: Add Durable Contextual Moderation Queue and Worker Adapter

**Purpose:** Process exact-revision contextual work through a validated server-only adapter with bounded retry, safe outage behavior, and no raw reasoning.

**Files:**
- Create: `supabase/migrations/20260826010600_add_contextual_moderation_queue.sql`
- Create: `supabase/tests/database/moderation_evaluations.test.sql`
- Create: `supabase/functions/moderate-event-queue/contracts.ts`
- Create: `supabase/functions/moderate-event-queue/moderator.ts`
- Create: `supabase/functions/moderate-event-queue/index.ts`
- Create: `supabase/functions/moderate-event-queue/index.test.ts`
- Modify: `supabase/functions/_shared/env.ts`
- Modify: `supabase/functions/.env.example`
- Modify: `deno.json`

**Interfaces:**
- Consumes: Task 4 canonical input/digest and Task 1 evaluation table.
- Produces: service-only `server_claim_moderation_evaluation(text)`, `server_apply_moderation_evaluation(...)`, `server_fail_moderation_evaluation(...)`, and one-job HTTP worker.

- [ ] **Step 1: Write database and Deno RED tests**

DB tests cover exact uniqueness `(event,revision,digest,source,queued_version)`, SKIP LOCKED claim, max three attempts, stale supersession, human-action supersession, duplicate apply, malformed result rejection, and no blocked/removed automation release. Deno tests cover worker-token auth, structured input/output schemas, timeout, provider unavailable, bounded safe codes, and no raw provider payload in response/log calls.

- [ ] **Step 2: Run focused RED**

Run linked evaluation pgTAP and `pnpm exec deno test supabase/functions/moderate-event-queue --allow-env`; expected missing functions/modules.

- [ ] **Step 3: Implement exact queue and adapter contract**

Define structured output:

```ts
type ContextualModerationResult = {
  outcome: 'clear_candidate' | 'review_required' | 'prohibited_candidate'
  riskLevel: 'low' | 'high'
  reasonCodes: ModerationReasonCode[]
  providerReference: string | null
  modelVersion: string | null
}
```

The HTTP adapter uses server-only `CONTEXTUAL_MODERATION_ENDPOINT` and optional bearer token, 8-second abort timeout, and strict Zod validation. Unconfigured/timeout/malformed responses persist only safe failure codes and leave the event held. Worker auth uses `MODERATION_WORKER_TOKEN`; neither secret is exposed to Vite.

- [ ] **Step 4: Apply the queue migration and deploy only after static GREEN**

Reconfirm development, dry-run/push only `20260826010600_add_contextual_moderation_queue.sql`, run DB GREEN, then deploy only `moderate-event-queue` with `verify_jwt = false` after setting a nonprinting managed worker token. Provider configuration may remain absent to exercise approved fail-closed outage behavior.

- [ ] **Step 5: Run GREEN and hosted safe-failure probes**

Run only `moderate-event-queue/index.test.ts` plus its shared moderation-contract tests, then function typecheck/lint/fmt, linked evaluation pgTAP, invalid/missing worker-token 401, configured local fake-provider success, unavailable-provider bounded failure, DB lint/history/leakage, and credential/log scans. Do not invoke the repository-wide Edge suite because it contains frozen Stripe coverage.

- [ ] **Step 6: Review stale/human precedence and data minimization**

Verify apply locks and compares all four facts, any human enforcement increments moderation version and supersedes active jobs, protected/community words are not deterministic reasons, and no chain of thought/raw prose/header/token persists.

- [ ] **Step 7: Commit the worker boundary**

```bash
git add supabase/migrations/20260826010600_add_contextual_moderation_queue.sql supabase/tests/database/moderation_evaluations.test.sql supabase/functions/moderate-event-queue supabase/functions/_shared/env.ts supabase/functions/.env.example deno.json
git commit -m "feat: process contextual moderation jobs"
```

---

### Task 8: Add Staff Roles, Transition Matrix, and Moderation Case RPCs

**Purpose:** Provide a minimal operational moderation boundary with database-enforced roles, expected-fact conflicts, reversible enforcement, and one-way legacy-history resolution.

**Files:**
- Create: `supabase/migrations/20260826010700_add_staff_moderation_operations.sql`
- Create: `supabase/tests/database/moderation_staff_actions.test.sql`

**Interfaces:**
- Consumes: Tasks 1–7 actions/evaluations/history/candidate transition.
- Produces: `get_my_staff_role()`, `list_moderation_queue(...)`, `get_moderation_case(uuid)`, `moderate_event(...)`, and admin-only `resolve_legacy_public_history(...)`.

- [ ] **Step 1: Write staff/security RED pgTAP**

Test no-role/fake-metadata denial, inactive role, moderator/admin capabilities, moderator cannot grant/resolve history, exact revision/digest/version conflicts, full transition matrix, same-state action allowances, internal-note bound, atomic action/state/epoch, restore, and unknown-history one-way resolution with evaluation supersession.

- [ ] **Step 2: Run RED**

Expected: staff RPCs are missing and private tables remain inaccessible.

- [ ] **Step 3: Implement exact staff functions and ACL**

`moderate_event` derives `auth.uid()`, verifies active role, acquires advisory/event locks, recomputes digest, compares expected facts, and never accepts client target status. Encode the approved matrix literally: hold from `not_evaluated|clear|under_review`; block from those states only with `never_public`; remove from `clear|under_review` only with `previously_public`; clear from `not_evaluated|under_review` with either known history or from `blocked` only with `never_public`; restore from `removed` only with `previously_public`. Reject every weakening hold, every action while history is `unknown`, clear-from-removed, block-after-public, remove-before-public, and restore-from-blocked. Preserve the schema's approved same-state audit allowances for `authorize_publication`, `hold`, `record_revision`, and `resolve_legacy_history`, then write state+action+epoch atomically. `resolve_legacy_public_history` is admin-only, increments moderation version, supersedes work, records evidence code/timestamp, leaves `under_review`, and cannot change known history.

- [ ] **Step 4: Dry-run/push only Task 8 and bootstrap no user silently**

Require only `20260826010700_add_staff_moderation_operations.sql` pending. Push without inserting a real staff user. Staff bootstrap uses a separate explicit service/admin command during test fixture setup, never mutable JWT metadata.

- [ ] **Step 5: Run GREEN and privilege inventory**

Run focused staff pgTAP, evaluation/publish/epoch suites, DB lint/history/leakage, function execute grants, and direct private-table denial for anon/authenticated.

- [ ] **Step 6: Review operational safety**

Verify no routine SQL is needed for event actions, queue/case results are bounded, organizer never sees internal notes/reviewer identity, corrections append rather than rewrite, and removed/blocked distinctions follow known history.

- [ ] **Step 7: Commit staff operations**

```bash
git add supabase/migrations/20260826010700_add_staff_moderation_operations.sql supabase/tests/database/moderation_staff_actions.test.sql
git commit -m "feat: add staff moderation operations"
```

---

### Task 9: Add Review Requests and Anonymous Report Anti-Abuse

**Purpose:** Provide one organizer review request and guest report signals without auto-hide, free text, raw-IP storage, or brigade voting.

**Files:**
- Create: `supabase/migrations/20260826010800_add_review_requests_and_reports.sql`
- Create: `supabase/tests/database/moderation_reviews_reports.test.sql`
- Create: `supabase/functions/report-event/contracts.ts`
- Create: `supabase/functions/report-event/index.ts`
- Create: `supabase/functions/report-event/index.test.ts`
- Modify: `supabase/functions/_shared/env.ts`
- Modify: `supabase/functions/_shared/cors.ts`
- Modify: `supabase/functions/.env.example`
- Modify: `deno.json`

**Interfaces:**
- Consumes: canonical public event revision/digest, evaluations, staff actions, and shared Edge CORS/DB helpers.
- Produces: `request_event_review(uuid,text)`, `withdraw_event_review(uuid)`, service-only `server_submit_event_report(...)`, and `report-event` Edge endpoint.

- [ ] **Step 1: Write RED for review/report contracts**

Cover one open request, owner/cross-owner, exact revision/digest, edit supersession, withdraw/resolution, report reason allowlist, no free text, public-event-only, HMAC actor fingerprint, no raw IP/user-agent/email, same actor/event/revision dedupe, later revision new report, atomic rate limits, three distinct actors/24h one priority job, and zero report-only state change.

- [ ] **Step 2: Run DB and Deno RED**

Expected: review/report RPCs and Edge handler missing.

- [ ] **Step 3: Implement database and Edge boundaries**

`report-event` validates exact origin/CORS and JSON, computes `HMAC-SHA256(REPORT_FINGERPRINT_SECRET, normalizedClientAddress)` and a separately HMACed network bucket in memory, then passes only digests/reason/event ID to the service RPC. Database revalidates current public revision/digest, dedupes, applies rate buckets, supersedes older-revision open reports, and queues one report-source evaluation at threshold without hiding.

- [ ] **Step 4: Dry-run/push and deploy only report-event**

Reconfirm development; apply only `20260826010800_add_review_requests_and_reports.sql`. Set a nonprinting managed `REPORT_FINGERPRINT_SECRET`; deploy only `report-event` after Deno GREEN.

- [ ] **Step 5: Run GREEN and hosted safe probes**

Run focused pgTAP/Deno, function check/lint/fmt, OPTIONS 204 exact origin, bad origin 403, malformed reason 400, unknown/nonpublic event safe not-found, exact disposable valid report/dedupe/cleanup, and zero raw address/header persistence.

- [ ] **Step 6: Review anti-brigading and privacy**

Prove one actor counts once per revision, three actors only prioritize, Pride/drag/community content cannot be removed by reports, fingerprints expire/rotate per retention job contract, and public responses reveal no count/reason/state oracle.

- [ ] **Step 7: Commit review/report foundation**

```bash
git add supabase/migrations/20260826010800_add_review_requests_and_reports.sql supabase/tests/database/moderation_reviews_reports.test.sql supabase/functions/report-event supabase/functions/_shared/env.ts supabase/functions/_shared/cors.ts supabase/functions/.env.example deno.json
git commit -m "feat: add moderation review and reports"
```

---

### Task 10: Regenerate Types and Add Browser Moderation Contracts

**Purpose:** Establish strict frontend schemas, owner/staff/public APIs, identity-scoped query keys, and safe error mappings before building UI.

**Files:**
- Modify: `src/lib/supabase/database.types.ts`
- Create: `src/features/moderation/moderation.types.ts`
- Create: `src/features/moderation/moderation.schemas.ts`
- Create: `src/features/moderation/moderation.schemas.test.ts`
- Create: `src/features/moderation/moderation.api.ts`
- Create: `src/features/moderation/moderation.api.test.ts`
- Create: `src/features/moderation/moderation.queries.ts`
- Create: `src/features/moderation/moderation.queries.test.tsx`
- Modify: `src/features/events/event.types.ts`
- Modify: `src/features/events/event.schemas.ts`
- Modify: `src/features/events/event.schemas.test.ts`

**Interfaces:**
- Consumes: Tasks 3–9 generated database RPC/table types.
- Produces: `EventRequirements`, `PolicyStage`, `RequiredPolicy`, `AgreementStatus`, `ModerationCase`, `ModerationActionInput`, `ReportReason`; `moderationKeys`; typed API functions for requirements/acceptance/reviews/reports/staff.

- [ ] **Step 1: Write schema/API/query RED tests**

Test exact development policy routes/version IDs/stage, canonical HTTPS production policy URLs/stage, rejection of a relative production URL or a development-prefixed production version, seven disclosure values, no acceptance internals, report reason union, staff action union, expected revision/digest/version payload, owner-aware keys, identity-switch isolation, exact invalidation, safe not-found, and raw database error suppression.

- [ ] **Step 2: Run RED before generating/implementing**

Expected: modules and regenerated moderation RPC types are absent.

- [ ] **Step 3: Regenerate linked types and implement strict contracts**

Run `pnpm db:types` only after confirming linked history through `20260826010800`. Define no `any` or broad casts. API adapters must parse every JSON/RPC result, derive authenticated identity from session-owned call sites, and expose only safe errors.

- [ ] **Step 4: Implement query keys and mutations**

Use keys such as `['moderation','requirements',organizerId,eventId]`, `['moderation','case',staffUserId,eventId]`, and `['public-event',eventId]`. Agreement/save/review/staff mutations invalidate only exact owner/public/case/list families; sign-out/identity switch cannot reuse private cache.

- [ ] **Step 5: Run focused GREEN**

Run moderation schema/API/query tests under a real QueryClient, event schema/API tests, `pnpm typecheck`, and `pnpm lint`.

- [ ] **Step 6: Review browser data minimization and bundle safety**

Confirm no private table direct calls, no service function, no staff note in organizer contracts, no report fingerprint, no server secret name/value, and no eligibility logic duplicated in TypeScript.

- [ ] **Step 7: Commit browser contracts**

```bash
git add src/lib/supabase/database.types.ts src/features/moderation src/features/events/event.types.ts src/features/events/event.schemas.ts src/features/events/event.schemas.test.ts
git commit -m "feat: add moderation browser contracts"
```

---

### Task 11: Extend the Organizer Editor With Requirements and Agreement

**Purpose:** Implement the approved late-flow seven-stage organizer experience, owner-safe reload, acceptance, and published editing without an upfront compliance interrogation.

**Files:**
- Create: `src/features/moderation/EventRequirementsStep.tsx`
- Create: `src/features/moderation/EventRequirementsStep.test.tsx`
- Create: `src/features/moderation/OrganizerAgreementStep.tsx`
- Create: `src/features/moderation/OrganizerAgreementStep.test.tsx`
- Create: `src/features/moderation/OrganizerTermsPage.tsx`
- Create: `src/features/moderation/OrganizerTermsPage.test.tsx`
- Create: `src/features/moderation/EventPolicyPage.tsx`
- Create: `src/features/moderation/EventPolicyPage.test.tsx`
- Modify: `src/features/events/EventEditorPage.tsx`
- Modify: `src/features/events/EventEditorPage.test.tsx`
- Modify: `src/features/events/EventReviewStep.tsx`
- Modify: `src/app/router/router.tsx`
- Modify: `src/app/router/router.test.tsx`
- Modify: `src/components/ui/StepRail.tsx`
- Modify: `src/components/ui/ui.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: Task 10 requirements/agreement/save APIs and current event editor blocker/save flow.
- Produces: Basics -> Date/location -> Tickets/admission -> Event details/requirements -> Organizer agreement -> Preview -> Publish UX.

- [ ] **Step 1: Write organizer-flow RED tests**

Prove disclosures are late, minimum-age select plus six yes/no controls, exact agreement copy/links/supporting text, one checkbox, no legal scroll box, acceptance required before Preview, values reload, server error retains values, stale agreement after material edit, published owner edit allowed, and blocked/removed edits preserve safe status. Route tests must prove `/organizer-terms` renders only `Whereto Organizer Terms will be finalized before public launch.` and `/event-policy` renders only `Whereto Event Policy will be finalized before public launch.`, with visible `Development placeholder` labeling and no production-consent claim.

- [ ] **Step 2: Run RED**

Expected: editor has only three steps, published events are read-only, and requirements/agreement modules are missing.

- [ ] **Step 3: Implement focused step components and editor state**

Keep React Hook Form authoritative for editable values and TanStack Query for persisted requirements/agreement state. Saving content never forges acceptance. Checkbox submission calls `acceptCurrentEventPolicies(eventId)` after the latest save; Preview navigation only follows successful returned current agreement status. Any revision-changing edit resets the displayed agreement state. Add the two temporary public routes as simple semantic pages containing only the exact development notices and a clear non-production label; do not invent legal obligations, warranties, prohibited-content clauses, or substantive policy text.

- [ ] **Step 4: Implement published-edit navigation and unsaved-change safety**

Remove the read-only milestone branch only for owners; call the published revision RPC, preserve current moderation status copy, retain the existing route-aware mutex/blocker/dialog/focus behavior, and never navigate on a mismatched returned owner/event ID.

- [ ] **Step 5: Run focused GREEN plus responsive component checks**

Run editor/step/ui tests, typecheck, lint, and build. Assert 320/375px controls remain contained, all inputs have labels/errors, checkbox/links are keyboard accessible, and reduced-motion styles remain respected.

- [ ] **Step 6: Review UX and security boundary**

Verify browser never supplies versions/timestamp/actor, policy links match the server-returned development routes (and accept canonical HTTPS production URLs without client rewriting), agreement follows disclosures, placeholder pages cannot be mistaken for production legal consent, no giant legal text exists, private disclosure row is read only through owner RPC, and published blocked/removed state cannot weaken.

- [ ] **Step 7: Commit organizer requirements UI**

```bash
git add src/features/moderation/EventRequirementsStep.tsx src/features/moderation/EventRequirementsStep.test.tsx src/features/moderation/OrganizerAgreementStep.tsx src/features/moderation/OrganizerAgreementStep.test.tsx src/features/moderation/OrganizerTermsPage.tsx src/features/moderation/OrganizerTermsPage.test.tsx src/features/moderation/EventPolicyPage.tsx src/features/moderation/EventPolicyPage.test.tsx src/features/events/EventEditorPage.tsx src/features/events/EventEditorPage.test.tsx src/features/events/EventReviewStep.tsx src/app/router/router.tsx src/app/router/router.test.tsx src/components/ui/StepRail.tsx src/components/ui/ui.test.tsx src/styles/global.css
git commit -m "feat: add organizer event requirements"
```

---

### Task 12: Integrate Publish, Organizer Status, and Review Requests

**Purpose:** Make Preview/Publish enforce persisted agreement/moderation results and give organizers safe under-review/blocked/removed/review-request states.

**Files:**
- Modify: `src/features/events/EventPreviewPage.tsx`
- Modify: `src/features/events/EventPreviewPage.test.tsx`
- Modify: `src/features/events/PublishedEventPage.tsx`
- Modify: `src/features/events/PublishedEventPage.test.tsx`
- Modify: `src/features/events/OrganizerEventsPage.tsx`
- Modify: `src/features/events/OrganizerEventsPage.test.tsx`
- Modify: `src/features/events/publishErrors.ts`
- Modify: `src/features/events/publishErrors.test.ts`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: Task 10 agreement/review queries and existing publish mutation.
- Produces: safe `Published`, `Under review`, `Blocked`, `Removed`, `Cancelled` organizer states and one review-request flow.

- [ ] **Step 1: Write preview/status/review RED tests**

Cover persisted requirements/agreement summary, publish disabled for stale/missing acceptance, low-risk immediate public result, high-risk under-review result, stable safe error copy, double-submit idempotency, blocked/removed re-publish preservation, one open review request, material-edit supersession, withdraw/retry, and no internal reasons/scores/reviewer identity.

- [ ] **Step 2: Run RED**

Expected: current preview knows only event schema/paid branch and organizer pages treat clear/flagged as public.

- [ ] **Step 3: Implement persisted preview and publish state mapping**

Render server-returned requirements/policy labels, call publish only when current agreement state is valid, navigate on returned exact event, and derive organizer copy from safe row fields. Remove `flagged` handling and never infer public eligibility in React; use server-returned public status/projection availability.

- [ ] **Step 4: Implement simple review request interaction**

Show `Request review` only for eligible owner states, bounded optional note, pending/error/retry, and existing request status. Keep one action, no thread/timeline/legal SLA.

- [ ] **Step 5: Run focused GREEN and application regressions**

Run preview/published/list/publish-error/moderation query tests, then `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Do not run unrelated payment/Stripe suites.

- [ ] **Step 6: Review disclosure and focus behavior**

Confirm headings/alerts/status semantics, pending mutex, focus recovery, no internal moderation leakage, no report/staff data, and no client-side public predicate.

- [ ] **Step 7: Commit organizer moderation states**

```bash
git add src/features/events/EventPreviewPage.tsx src/features/events/EventPreviewPage.test.tsx src/features/events/PublishedEventPage.tsx src/features/events/PublishedEventPage.test.tsx src/features/events/OrganizerEventsPage.tsx src/features/events/OrganizerEventsPage.test.tsx src/features/events/publishErrors.ts src/features/events/publishErrors.test.ts src/styles/global.css
git commit -m "feat: add organizer moderation states"
```

---

### Task 13: Add Public Report Flow and Bounded Removal Refresh

**Purpose:** Consume only canonical public projections, allow minimal reporting, and remove newly hidden rows from active clients within 30 seconds without realtime or persistence.

**Files:**
- Create: `src/features/moderation/ReportEventDialog.tsx`
- Create: `src/features/moderation/ReportEventDialog.test.tsx`
- Modify: `src/features/tickets/publicTicketing.api.ts`
- Modify: `src/features/tickets/publicTicketing.api.test.ts`
- Modify: `src/features/tickets/publicTicketing.queries.ts`
- Modify: `src/features/tickets/publicTicketing.queries.test.tsx`
- Modify: `src/features/tickets/PublicTicketEventPage.tsx`
- Modify: `src/features/tickets/PublicTicketEventPage.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: Task 5 public projections and Task 9 report endpoint.
- Produces: canonical public event query, 15-second visible refetch, replacement-on-absence behavior, and accessible report dialog.

- [ ] **Step 1: Write public/report/cache RED tests**

Cover safe projection parsing, no moderation fields, eight report reasons/no free text, dialog keyboard/focus, duplicate-safe success, safe unknown/nonpublic errors, `refetchInterval: 15_000`, focus/reconnect refetch, absent row replacement, transient error last-known status, and no localStorage/sessionStorage persistence.

- [ ] **Step 2: Run RED**

Expected: public API uses old projection/query policy and report UI is missing.

- [ ] **Step 3: Implement canonical query and report dialog**

Parse only `get_public_event_ticketing`/safe event projection results. Render report trigger only for a currently returned public event; POST only `{eventId, reason}` to `report-event`. Close/reset/focus on success; never display report counts or moderation outcome.

- [ ] **Step 4: Implement bounded refresh semantics**

Set explicit 15-second interval only while page is visible/mounted, refetch on focus/reconnect, replace cache with null on authoritative not-found, retain last-known content only during retryable network error with a status indicator, and never persist the query family.

- [ ] **Step 5: Run focused GREEN and bundle checks**

Run only the public projection/query, report-dialog, and report integration cases changed by this task, then typecheck, lint, build, and search built output for private moderation field names/secrets. Existing Checkout-selection cases are outside this gate and remain frozen.

- [ ] **Step 6: Review privacy, accessibility, and brigade behavior**

Verify no raw IP/header/browser fingerprint computation, no free text, one report cannot alter page visibility, dialog is semantic/focus-safe, and protected/community content receives no special client treatment.

- [ ] **Step 7: Commit public report/refresh flow**

```bash
git add src/features/moderation/ReportEventDialog.tsx src/features/moderation/ReportEventDialog.test.tsx src/features/tickets/publicTicketing.api.ts src/features/tickets/publicTicketing.api.test.ts src/features/tickets/publicTicketing.queries.ts src/features/tickets/publicTicketing.queries.test.tsx src/features/tickets/PublicTicketEventPage.tsx src/features/tickets/PublicTicketEventPage.test.tsx src/styles/global.css
git commit -m "feat: add public report and refresh flow"
```

---

### Task 14: Build the Minimal Protected Moderation Console

**Purpose:** Give authorized staff a bounded queue/case/action workflow so moderation never depends on routine production SQL.

**Files:**
- Create: `src/features/moderation/RequireStaff.tsx`
- Create: `src/features/moderation/RequireStaff.test.tsx`
- Create: `src/features/moderation/ModerationQueuePage.tsx`
- Create: `src/features/moderation/ModerationQueuePage.test.tsx`
- Create: `src/features/moderation/ModerationCasePage.tsx`
- Create: `src/features/moderation/ModerationCasePage.test.tsx`
- Modify: `src/app/router/router.tsx`
- Modify: `src/app/router/router.test.tsx`
- Modify: `src/components/layout/OrganizerLayout.tsx`
- Modify: `src/components/layout/OrganizerLayout.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: Task 10 staff queries/actions and Task 8 queue/case RPCs.
- Produces: protected `/moderation` and `/moderation/events/:eventId` routes with Clear/Hold/Block/Remove/Restore and admin-only history resolution.

- [ ] **Step 1: Write guard/queue/case RED tests**

Cover loading/no-flash, nonstaff safe denial, inactive role, moderator/admin route access, queue empty/error/retry, current revision/disclosures/reasons/report count/action timeline, no reporter identity/model prose, transition-specific buttons, required reason, bounded note, stale conflict/reload, focus recovery, and admin-only unknown-history resolution.

- [ ] **Step 2: Run RED**

Expected: modules/routes are missing.

- [ ] **Step 3: Implement route guard and queue**

Use authenticated user ID in staff query keys. Render only server-projected cases sorted by held/review/report priority. Staff navigation appears only after confirmed role; direct URL remains server-authorized regardless of hidden nav.

- [ ] **Step 4: Implement case action workflow**

Capture displayed revision/digest/version with each action, require reason, cap note client-side and server-side, disable with a per-attempt mutex, map conflict to reload, and invalidate exact queue/case/owner/public keys. Never let the client send target moderation state independent of action.

- [ ] **Step 5: Run focused GREEN and responsive/accessibility tests**

Run moderation guard/pages/router/layout suites, typecheck, lint, and build. Assert 320/375/1440 containment, semantic tables/lists/forms, keyboard order, alerts/status, and reduced motion. Do not invoke unrelated payment/Stripe suites.

- [ ] **Step 6: Review minimal scope and authorization**

Confirm no staff management, policy editor, model tuning, chat, reputation, refund, SQL, or analytics UI; no organizer-facing internal notes; and every operation still fails without DB staff role.

- [ ] **Step 7: Commit moderation console**

```bash
git add src/features/moderation/RequireStaff.tsx src/features/moderation/RequireStaff.test.tsx src/features/moderation/ModerationQueuePage.tsx src/features/moderation/ModerationQueuePage.test.tsx src/features/moderation/ModerationCasePage.tsx src/features/moderation/ModerationCasePage.test.tsx src/app/router/router.tsx src/app/router/router.test.tsx src/components/layout/OrganizerLayout.tsx src/components/layout/OrganizerLayout.test.tsx src/styles/global.css
git commit -m "feat: add moderation console"
```

---

### Task 15: Prove Database Concurrency, RLS, and Option A Compatibility

**Purpose:** Establish deterministic evidence for the load-bearing lock/version/history boundaries using real concurrent database sessions without Stripe.

**Files:**
- Create: `supabase/tests/database/moderation_epoch_concurrency.test.sh`
- Create: `supabase/tests/database/moderation_action_concurrency.test.sh`
- Create: `supabase/tests/database/moderation_report_concurrency.test.sh`
- Create: `tests/integration/moderation-public-projection.test.ts`
- Create: `tests/integration/moderationRunnerContract.test.ts`
- Create: `tests/integration/run-moderation-proof.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: all database/Edge contracts from Tasks 1–14.
- Produces: mandatory `pnpm test:integration:moderation` gate and deterministic two-session proof scripts.

- [ ] **Step 1: Write runner-contract and concurrency RED**

Require the canonical runner to execute all moderation pgTAP plus three shell races; mutation-test the runner so omitting a child fails. Race publish/evaluate, edit/evaluate, edit/staff, remove/restore, report/admin, final reservation/moderation loss, and repeated hide/restore. Assert one winner/safe conflict, no deadlock, one open interval, monotonic versions, stale work superseded, and no auto-hide.

- [ ] **Step 2: Run RED**

Expected: scripts/runner/package command missing.

- [ ] **Step 3: Implement exact disposable-fixture harnesses**

Use generated UUID prefixes, two authenticated PostgreSQL sessions, explicit barriers, `trap` cleanup, and count-only residue proof. The reservation race calls the existing database service reservation boundary with fake DB-only fixtures; it creates no Checkout Session, Stripe object, webhook, charge, or refund.

- [ ] **Step 4: Run focused concurrency GREEN**

Run each shell script sequentially, then `pnpm test:integration:moderation`. Expected: all child commands mandatory/nonzero on mutation, exact fixture cleanup zero, no pgTAP extension leakage, and no deadlocks.

- [ ] **Step 5: Run complete database/RLS compatibility gate**

Run every Build 2.5 pgTAP suite plus this explicit database-compatibility allowlist through exact CLI or approved rollback fallback: `organizers_events_schema`, `organizers_events_rls`, `organizer_onboarding_update`, `publish_event`, `ticketing_schema`, `ticketing_rls`, `paid_sales`, `inventory_reservations`, `payment_fulfillment`, and `order_confirmation`. Then run DB lint public/private, migration history/dry-run empty, and owner/anon/staff/service ACL inventory. Do not run checkout, Connect, webhook, refund/dispute, payment-concurrency, or Stripe function/integration coverage.

- [ ] **Step 6: Review race realism and cleanup safety**

Verify barriers reproduce the intended lock order, parser failures make cleanup fail safe, every destructive cleanup target is an exact fixture ID, Option A leaves records intact, and no script reads `.env.local` Stripe values.

- [ ] **Step 7: Commit concurrency proof**

```bash
git add supabase/tests/database/moderation_epoch_concurrency.test.sh supabase/tests/database/moderation_action_concurrency.test.sh supabase/tests/database/moderation_report_concurrency.test.sh tests/integration/moderation-public-projection.test.ts tests/integration/moderationRunnerContract.test.ts tests/integration/run-moderation-proof.sh package.json
git commit -m "test: prove moderation concurrency boundaries"
```

---

### Task 16: Run Browser Verification, Final Review, and Finish the Branch

**Purpose:** Prove the approved organizer/public/staff journeys and Build 3 dependency contract, then complete the verified branch without beginning Build 3.

**Files:**
- Create: `tests/e2e/moderation-public-eligibility.spec.ts`
- Create: `tests/e2e/moderation-public-eligibility.visual.spec.ts`
- Create: `Docs/testing/build-2-5-moderation-public-eligibility-verification.md`
- Modify: `tests/e2e/support/e2eEnv.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: completed Build 2.5 branch and disposable organizer/staff/public fixtures.
- Produces: repeatable E2E/visual/accessibility evidence, clean final review, and a branch ready for `superpowers:finishing-a-development-branch`.

- [ ] **Step 1: Write E2E/static-runner RED**

Define mobile 390x844 and desktop 1440x900 projects. Cover low-risk create/disclosures/agreement/preview/immediate publish/public result; high-risk hold; material edit/re-accept; blocked/removed edit preservation; review request; anonymous report; three-actor priority without hide; staff action/conflict/restore; active-client removal under 30 seconds; and map-safe RPC exclusion for draft/cancelled/held/blocked/removed/stale/invalid/ended rows.

- [ ] **Step 2: Run RED and prove missing-config fails closed**

`pnpm test:e2e:moderation --list` must discover only the intended cases. Missing required non-secret test identifiers/credentials exits nonzero with names only, never skips/passes and never prints values.

- [ ] **Step 3: Implement the bounded fixture/cleanup runbook and browser proof**

Provision exact disposable organizer, reporter actors, and staff role through an enclosing admin-only harness; Playwright receives only publishable/user credentials. Capture current-render screenshots, keyboard/focus/landmark/alert smoke, responsive overflow, reduced motion, both development-placeholder policy pages/labels, agreement links, and public-cache removal. EXIT cleanup removes exact reports/reviews/evaluations/actions/events/organizers/Auth rows in FK-safe order and proves zero residue.

Add a dedicated **Pre-launch production policy gate** to the runbook. It must block real organizer/public launch until: (1) production Organizer Terms exist; (2) production Event Policy exists; (3) each has a stable canonical HTTPS URL; (4) each has an approved version identifier; (5) each has an effective date; (6) each has an exact content digest; (7) neither required row is `development_placeholder`; (8) `organizer_policy_requirements` references the approved production pair and the service/admin operation successfully changes the policy environment to `production`; and (9) real organizers accept the required production versions as appropriate. The production operation must reject the transition before items 1–8 are true, leaving publication and public projections fail closed. State explicitly that this checklist is not a Build 2.5 completion gate and not a Build 3 planning/build gate.

- [ ] **Step 4: Run the full final verification gate**

Add exact package scripts `test:build25` and `test:functions:moderation` whose file allowlists contain only the moderation feature, directly changed event/public/router/layout tests, and the two Build 2.5 Edge Functions. Run focused E2E mobile/desktop, `pnpm test:build25`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:functions:moderation`, `pnpm typecheck:functions`, `pnpm test:integration:moderation`, every new moderation pgTAP/concurrency proof plus Task 15's explicit Day 1/Day 2 database-compatibility allowlist, DB lint/history/dry-run, `git diff --check`, `.env.local` ignored/untracked proof, tracked/staged/build secret scans, and artifact redaction scans. The development gate must show policy acceptance journeys pass while `production_policy_configuration_is_ready()` remains false; a rollback-only valid production-pair fixture must make it true, and either placeholder in the required pair must make it false again. Prove the two package allowlists and database allowlist contain no checkout, Connect, webhook, refund/dispute, Stripe function, or Stripe integration path; do not run any Stripe command or test.

- [ ] **Step 5: Run verification-before-completion and independent final code review**

Use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review` over the full Build 2.5 base..HEAD diff. Fix every evidence-backed Critical/Important finding with focused RED/GREEN and rerun only affected gates before the full final gate. Require final review Critical=0, Important=0.

- [ ] **Step 6: Commit final verification artifacts**

```bash
git add tests/e2e/moderation-public-eligibility.spec.ts tests/e2e/moderation-public-eligibility.visual.spec.ts Docs/testing/build-2-5-moderation-public-eligibility-verification.md tests/e2e/support/e2eEnv.ts playwright.config.ts package.json
git commit -m "test: verify moderation public eligibility"
```

- [ ] **Step 7: Finish the development branch without starting Build 3**

Use `superpowers:finishing-a-development-branch`: confirm feature worktree clean, preserve current local `main` commits, merge the verified feature branch safely, rerun the merged-main final gate, verify no secrets/artifacts, and push `main` only after success. Report final main hash and stop; do not create a map/Day 3 task.

---

## Plan Self-Review Checklist

- Every approved design section maps to Tasks 1–16.
- Schema/interfaces are defined before generated types and UI consume them.
- Legacy migration enumerates all required combinations and quarantines unknown history.
- Policy acceptance is immutable, server-versioned, owner/revision/digest-bound, non-activating, and legacy-safe.
- Development policy placeholders are explicit, minimal, digest-bound, and usable only for internal Build 2.5 verification; no final legal document is required to execute or complete Build 2.5.
- Production launch has a fail-closed nine-item policy gate; placeholder versions can never satisfy production readiness or be represented as production legal consent.
- Deterministic low-risk publish remains immediate; contextual/high-risk failure stays held.
- Human enforcement supersedes automation; blocked/removed edits and re-publish cannot restore.
- Report dedupe is actor/event/revision; three actors prioritize but never auto-hide.
- Canonical event/ticketing/map projections filter before browser receipt.
- Eligibility epochs include v0, atomic close/increment/open, one open row, immutable history, repeated cycles, and stale-generation tests.
- Public base-table leakage, fake staff calls, and cross-owner disclosure access are explicitly tested.
- Image behavior is a fail-closed seam only; no uploader or AI flyer subsystem exists.
- Admin UI is minimal and contains no staff management, policy editor, chat, reputation, refund, SQL, or analytics features.
- Build 3 has a projection contract and tests only; no map UI/rendering task exists.
- Build 3 planning/build work is not blocked by final production policy documents.
- Stripe tasks/tests/calls/credentials/fixtures count is zero.
- Task order has no downstream interface before its producer.
- Every task has RED, implementation, GREEN, review, and commit checkpoints.
- No task edits an applied migration; fix rounds are forward-only.
- Final verification, final code review, and branch-finishing workflows are explicit.
