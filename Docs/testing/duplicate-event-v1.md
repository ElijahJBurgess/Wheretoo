# Duplicate Event V1 — implementation and proof

Date: 2026-09-23 (America/Los_Angeles). Governing spec: `Docs/specs/duplicate-event-v1-inspect-spec.md`, including the founder implementation override. Local proof only. Complete raw logs and screenshots are retained in ignored `.duplicate-proof/`.

## Founder closeout approval

The founder approved commit, push, PR review and merge under a differential SQL gate: the 33 pre-existing failures reproduced on pristine current main are baseline test debt, not Duplicate Event regressions. Do not repair those unrelated suites or weaken ACLs in this feature. The earlier PARTIAL assessment used an all-green gate and is superseded by this decision. Remote main was freshly fetched for closeout and remains `52558793abe7927102b977aaeab170983356fb99`; no reconciliation or migration renumbering was needed.

## Required completion report

1. **Status: PASS under the founder-approved differential gate.** Feature-specific SQL, frontend, Edge, Storage and browser proof pass. 33 existing SQL suites fail identically on a separate current-main baseline; no new SQL regression was found. The entire repository SQL suite is not green. GitHub merge remains subject to its checks and final diff review; production deployment is not authorized.
2. **Branch/worktree:** `codex/duplicate-event-v1`, `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/duplicate-event-v1`. The dirty recovery checkout and canonical main checkout were preserved.
3. **Baseline HEAD:** `52558793abe7927102b977aaeab170983356fb99`; remote main fetched and verified before implementation.
4. **Commit identity:** the feature commit containing this report is titled `feat: add duplicate event workflow`; exact feature, PR and resulting main identifiers are recorded in the Git closeout report. The baseline above remains the comparison point. No history rewrite is authorized.
5. **Files changed:** inventory below. Includes the approved spec/plan, migration, Edge handler/orchestrator, typed browser transport/mutation, My Events/editor integration, preview fixture, and proof harnesses.
6. **Migration:** `supabase/migrations/20260924010500_add_duplicate_event_v1.sql`. Applied after current main's `20260924010400` and verified through a clean local migration reset. No new model table/column or relaxed RLS.
7. **Edge function:** `supabase/functions/duplicate-event/index.ts`; strict authenticated POST `{sourceEventId}` → 201 `{eventId}`. Bounded request body, configured origin, server-verified user, no owner/config payload, no automatic retries.
8. **SQL contracts:** owner-authenticated `get_owned_event_duplicate_context(uuid)` and `duplicate_owned_event(uuid,uuid,text,text default null)`; private eligibility/configuration/fingerprint/UTF-16-title helpers; narrow duplicate staging branch; ordinary `server_commit_event_cover` wrapper rejects unattached duplication-stage objects. The original helper is revoked from application roles. Initial canonical image and cover-state binding occur inside the atomic duplicate transaction; new-event triggers remain enabled.
9. **Copy matrix:** see below. Explicit columns/JSON keys; no SELECT-star clone.
10. **Source eligibility:** owned draft, published/live, ended, cancelled and under-review allowed; blocked/removed explicitly denied at context, stage, and finalization. Missing, guessed, foreign, and anonymous access fail. Unsupported legacy artwork and incompatible timezone fail explicitly.
11. **Schedule:** both timestamps null; existing `/organizer/events/<id>/edit?resume=1` route with “Draft created. Choose a new date and time before publishing.” No schedule hints or recurrence. Filling dates still requires fresh policy acceptance and normal publication.
12. **Flyer/Storage:** current canonical bytes downloaded and validated, then copied to a new private event path/object/image ID. Fresh seven-key technical metadata; no AI generation/candidate metadata. Service-only precreate stage bound to source, owner, image, fingerprint and destination UUID, 15-minute expiry. No draft during staging. Unknown commit outcomes retain the object; no cleanup job added.
13. **Authorization proof:** real owner/foreign/anonymous/missing/blocked/removed Edge checks; owner/foreign/anonymous direct-RPC checks; SQL grants; browser stage/sign denial; owner/source/image/fingerprint/target mismatch and expired-stage rejection; ordinary cover adoption denied.
14. **Transaction/isolation proof:** source and destination locks; fingerprint recheck before allowlisted inserts; selected staged object locked and validated. Injected failure after event/tier inserts rolls back event, tiers and private bookkeeping. Existing source row and history unchanged. Ticket sales/refunds/check-ins do not change the reusable fingerprint.
15. **No-history-copy proof:** populated paid source with reserved orders, real paid fulfillment, issued QR-bearing tickets, actual check-in and verified refund; populated free source with registration/admissions/check-in. New namespace has no orders, order-item reservations/sales, tickets or free registrations; source records/credentials/use history unchanged. Other excluded systems have no copy statements; normal new-event bookkeeping is created by existing triggers.
16. **Concurrency proof:** deterministic fingerprint changes plus genuinely overlapping event edit, tier price/quantity/archive, factual requirements, cancellation, moderation/publication, and real flyer replace/remove/AI-selection APIs. Outcomes are a complete original snapshot or safe source conflict. Real finalizer commit with deliberately discarded response leaves canonical attachment and Storage bytes intact, with zero cleanup calls.
17. **Browser/UX:** keyboard action, independent row link, busy state and synchronous double activation, success route, blank dates, copied venue/title/flyer persistence after reload, unchecked fresh agreement, conflict/known failure/unknown recovery, navigation away and logout. Unit proof covers account A→B→A and filtered unknown recovery. 390px/desktop screenshots inspected; no horizontal overflow. Busy feedback no longer inserts content above the clicked button, avoiding second-click row navigation. Errors appear beside the action, with a fallback when filtering hides its row. See visual audit below.
18. **Regression results:** full frontend 203 files / 1,724 tests pass. SQL sweep including inventory: 72 suites; 39 pass, 33 fail. Of 70 pre-existing suites, 37 pass and 33 fail identically on pristine baseline. Two new suites pass (22 + 14 assertions). Existing AI foundation/generation/manual-image suites also pass in the reproducible integration runner. Full SQL output includes 1,483 passing assertions across complete and early-failing suites; this is not a count of entirely green tests.
19. **Checks:** typecheck, lint, build, Edge typecheck, full function tests (383), local migration reset, real Storage/Edge integration (118 checks), and Playwright proof (4/4). Exact final command outcomes below.
20. **Known baseline failures:** table below. Most old fixtures read restricted tables directly as `service_role`; other assertions expect older schemas/authorization contracts. Reproduced without the duplicate migration on dedicated baseline port 59321/59322. Initial harness omissions (migration include path and disabled cron contract) were corrected and their affected suites passed. No application ACL was loosened to make regression suites pass.
21. **Unresolved risks:** the documented baseline SQL test debt remains; the founder accepts it under the differential gate. No unresolved actionable Duplicate Event issue remains after independent final review. Source artwork with no supported canonical image remains intentionally unsupported. Indeterminate outcomes can leave an orphan or a committed draft requiring organizer inspection; this is the approved conservative V1 behavior. Hosted deployment behavior was not tested. The local browser uses a Supabase proxy and disabled external providers; actual Mapbox/Stripe/provider network flows are outside this change's visual proof.
22. **Manual setup:** for local replay use the commands below. Future deployment requires applying the migration and deploying `duplicate-event` with the existing Supabase service environment and correct `APP_BASE_URL`, together with the frontend. No new secret/provider/account/table configuration is required. Those deployment steps were not performed.
23. **Deployment confirmation:** no hosted reset or deployment occurred during implementation; the founder separately authorized the Git push/PR/merge closeout. Only isolated local Supabase stacks (`wheretoo-duplicate-event` ports 583xx; `wheretoo-duplicate-baseline` ports 593xx) were created/reset. Existing stacks untouched. Both dedicated proof stacks were stopped after verification; local backups and proof logs remain.
24. **Ready to commit/review for merge: YES** under the founder-approved differential gate. Final closeout independently rechecks scope, current main, verification and GitHub merge eligibility. No other feature was started.

## Final command outcomes

| Check | Result |
| --- | --- |
| `pnpm test --maxWorkers=4` with synthetic public env | 203 files, 1,724 tests passed |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `pnpm build` with synthetic public env | Passed |
| `pnpm test:functions` | 383 passed |
| `pnpm typecheck:functions` | Passed |
| `deno check tests/integration/edge/duplicate-event-lost-response.ts` | Passed |
| New SQL | 22 configuration/authorization/rollback + 14 populated-history assertions passed |
| Real local integration | 118 checks passed |
| Playwright | 4 journeys passed; stationary-button assertion included |
| `git diff --check` | Passed |
| Independent code review | No unresolved actionable findings after recovery and double-click fixes |
| Broad SQL regression gate | PASS differentially; 33 unchanged baseline failures disclosed below |

## Exact copy matrix

| Source | Destination |
| --- | --- |
| Organizer | Same `auth.uid()`-authorized organizer |
| Title | Trimmed source or `Untitled event`, truncated without splitting supplementary characters to leave room within 120 UTF-16 units for ` — Copy` |
| Description, category | Same values |
| Venue/address/location | `venue_name`, both address lines, city, region, postal code, country code, Mapbox feature ID, latitude/longitude; PostGIS point maintained by existing trigger |
| Timezone | Compatible `America/Los_Angeles` value |
| Admission/capacity | Same configured values, no consumed inventory |
| Paid tiers | Current draft/active only; name, description, amount, currency, total configured quantity, sort order; new UUID, draft status/version defaults |
| Factual disclosures | Minimum age, alcohol, cannabis, explicit adult content, gambling, weapons, high-risk activity; absence remains absence |
| Flyer | Only selected canonical raster bytes; independent object/image/path |
| Dates | Both null |
| Lifecycle/authorization | Fresh draft, default revision, not evaluated, never public; no source approval/acceptance |
| All transactional/history/security/AI systems | Not copied: orders/items/checkout/reservations, buyers/Stripe state, registrations/requests, tickets/QR/check-ins, refunds/disputes/revenue/analytics, mail/recovery/access, notices/cancellation/moderation history, agreements/public authorization, storefront feature state, AI jobs/prompts/candidates/provider/request IDs, staff/waitlist/CSV state, bearer secrets |

## Local reproduction

All commands run from the feature worktree. Requires Docker and installed project dependencies (`pnpm install --frozen-lockfile`). The runner never uses a linked project.

```sh
python3 tests/integration/run-duplicate-event-local.py start
python3 tests/integration/run-duplicate-event-local.py reset
# Run the broad SQL sweep before HTTP fixtures populate the database.
# Currently exits 1 for the documented baseline failures.
python3 tests/integration/duplicate-event-regressions.py
# In a separate terminal:
python3 tests/integration/run-duplicate-event-local.py serve
# SQL + real HTTP/Storage + committed-lost-response proof:
python3 tests/integration/run-duplicate-event-local.py test
pnpm exec playwright test -c playwright.duplicate-event.config.ts
```

The integration run writes short-lived local browser credentials to ignored `.duplicate-proof/browser-fixture.json`; never commit it. Browser logout consumes that session; rerun the integration proof before another complete browser replay. All fixtures and tokens are local. External AI is mocked only in the local runner; the new duplicate function never calls an AI provider.

Frontend verification environment (synthetic public values):

```sh
export VITE_SUPABASE_URL=https://task16-disabled.supabase.co
export VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_task16_disabled
export VITE_MAPBOX_ACCESS_TOKEN=task16-disabled
export VITE_STRIPE_PUBLISHABLE_KEY=pk_test_task16_disabled
pnpm test --maxWorkers=4
pnpm typecheck
pnpm lint
pnpm build
pnpm test:functions
pnpm typecheck:functions
```

The initial unconfigured baseline frontend run failed for missing public environment variables; the configured baseline passed 202 files / 1,715 tests. These environment errors were not feature failures.

The populated paid-history SQL fixture grants service-role SELECT on orders only inside its rollback-only transaction, because the reused legacy setup helper reads order expiry directly. This is fixture setup, not an application grant or an ownership test bypass. The authenticated duplicate calls still use the real production contracts.

## Baseline SQL failures

Each row fails with and without the new migration on dedicated local databases. No production code changes were made to resolve unrelated obsolete test expectations.

| Suite | First failure |
| --- | --- |
| `checkout_integrity_confirmation.test.sql` | permission denied for table orders |
| `checkout_integrity_contract_cleanup.test.sql` | permission denied for table order_items |
| `checkout_integrity_fixture_lifecycle.test.sql` | permission denied for table ticket_tiers |
| `checkout_integrity_fulfillment.test.sql` | permission denied for table orders |
| `checkout_integrity_refunds.test.sql` | permission denied for table orders |
| `checkout_integrity_reservation.test.sql` | permission denied for table ticket_tiers |
| `core_ticket_truth_lite_collection.test.sql` | permission denied for table orders |
| `core_ticket_truth_lite_fulfillment.test.sql` | permission denied for table orders |
| `core_ticket_truth_lite_lifecycle.test.sql` | permission denied for table orders |
| `core_ticket_truth_lite_redemption.test.sql` | permission denied for table orders |
| `core_ticket_truth_lite_schema.test.sql` | permission denied for table orders |
| `moderation_evaluations.test.sql` | permission denied for table events |
| `moderation_policy_acceptance.test.sql` | not ok 27 - the acceptance boundary has no client authority beyond event identity |
| `organizer_csv_export.test.sql` | permission denied for table orders |
| `organizer_csv_export_equivalence.test.sql` | permission denied for table orders |
| `organizer_csv_export_lifecycle.test.sql` | permission denied for table orders |
| `payment_fulfillment.test.sql` | permission denied for table stripe_webhook_events |
| `publish_event.test.sql` | not ok 3 - another organizer event is rejected |
| `refunds_disputes.test.sql` | permission denied for table orders |
| `spec05_admission_search.test.sql` | permission denied for table orders |
| `spec09_refund_lifecycle.test.sql` | permission denied for table orders |
| `spec09_refund_notice_access.test.sql` | permission denied for table orders |
| `spec09_refund_operations.test.sql` | permission denied for table orders |
| `spec10_cancellation_summary.test.sql` | permission denied for table orders |
| `spec10_event_notices.test.sql` | permission denied for table orders |
| `spec10_late_payment_read.test.sql` | permission denied for table orders |
| `spec10_notice_access_and_lifecycle.test.sql` | permission denied for table orders |
| `spec10_private_collection_facts.test.sql` | permission denied for table orders |
| `spec10_refund_summary_states.test.sql` | permission denied for table orders |
| `spec10_used_notice_audience.test.sql` | permission denied for table orders |
| `storefront_attribution.test.sql` | permission denied for table orders |
| `storefront_transactions.test.sql` | permission denied for table orders |
| `ticketing_schema.test.sql` | not ok 14 - ticket columns are exact |

## Visual audit

Verification: verified for the local duplicate journey and viewports below. Hosted delivery and external provider flows remain unverified.

Artifact: existing My Events and creation wizard. Actor: authenticated organizer duplicating an owned event. Target: local Vite `http://127.0.0.1:3067/organizer/events`, source worktree on `codex/duplicate-event-v1`; authenticated backend proxy to dedicated local 58321 stack. Authority: user-authorized implementation and fixture-safe local proof. Reference: current app layout and approved duplicate spec; no redesign.

Profiles: responsive, core visual, state/journey. Screenshots: `.duplicate-proof/screens/events-390.png`, `events-1440.png`, `editor-390.png`, `editor-desktop.png`, `unknown-390.png`. Inspected typography, wrapping, controls, date inputs, feedback and row action separation. DOM checks prove no nested link controls, no horizontal overflow, and stationary button position during pending double activation. External address-search service loading is outside the duplicate feature proof. Delivery status: local only, no hosted freshness claim.

## File inventory

- `src/features/events/EventEditorPage.tsx`
- `src/features/events/OrganizerEventsPage.test.tsx`
- `src/features/events/OrganizerEventsPage.tsx`
- `src/features/events/event.queries.ts`
- `src/features/organizer-operations/organizer-operations.css`
- `src/lib/supabase/database.types.ts`
- `src/preview/screens.json`
- `src/preview/screens.render.test.tsx`
- `supabase/config.toml`
- `tsconfig.e2e.json`
- `Docs/specs/duplicate-event-v1-inspect-spec.md`
- `Docs/superpowers/plans/2026-09-23-duplicate-event-v1.md`
- `playwright.duplicate-event.config.ts`
- `src/features/events/duplicateEvent.api.test.ts`
- `src/features/events/duplicateEvent.api.ts`
- `supabase/functions/duplicate-event/index.ts`
- `supabase/functions/duplicate-event/duplicateEvent.ts`
- `supabase/functions/duplicate-event/duplicateEvent.test.ts`
- `supabase/migrations/20260924010500_add_duplicate_event_v1.sql`
- `supabase/tests/database/duplicate_event.test.sql`
- `supabase/tests/database/duplicate_event_history.test.sql`
- `tests/e2e/duplicate-event.spec.ts`
- `tests/integration/duplicate-event-proof.py`
- `tests/integration/edge/duplicate-event-lost-response.ts`
- `tests/integration/run-duplicate-event-local.py`
- `Docs/testing/duplicate-event-v1.md` (this report)

- `tests/integration/duplicate-event-regressions.py`
