# Organizer Operations V1 — implementation and verification

Date: 2026-09-10. Branch: `codex/organizer-operations-v1`.

The approved paid-event organizer workflow is implemented: My Events → Dashboard → event Orders → individual Order Details → manual admission → whole-order refund → historical access. Image #1 remains the visual authority. The founder decisions were committed in `0c6049d` before implementation began. There is no production deployment or claim of production readiness.

## What changed

- Added owner-scoped SQL projections for metrics, order search, and individual order detail. Browser roles retain no direct order/item/ticket-table access. Searches are literal, event-specific, length bounded, and cursor paginated.
- Added the dark organizer console, exactly four metrics, tier breakdown, compact event rows, searchable orders, ticket cards, accessible confirmation dialogs, and scanner event context. Free events keep their existing editor routes. No resend UI or email/access-token work.
- Manual admission resolves the selected ticket server-side and delegates to the unchanged atomic admission authority used by QR. Invalid/foreign selectors disclose no buyer context. Used timestamps survive refund/cancellation.
- Whole-order refund requests call the existing helper with its stable idempotency key. A narrowly eligible policy-evidence repair reuses the existing recovery validator; it never creates a second refund. Only canonical reads can display Refunded.
- Owner/event/order cache keys, identity-change eviction, and private mutation-cache removal prevent stale cross-account details. Unknown failures remain unconfirmed; failed searches retain prior same-event rows with an explicit explanation.
- Ended and cancelled history remains readable. Server admission eligibility controls UI actions without replacing the server's existing end/eligibility enforcement.

The canonical metric matrix is in [the approved design](../superpowers/specs/2026-09-10-organizer-operations-v1-design.md#6-locked-historical-metric-matrix). Gross is original successful ticket subtotal excluding tax; sold and orders count successfully fulfilled purchases even after refund. Checked in is used / all historically issued tickets. Inventory is calculated separately and can release after refund. Historical sold can exceed current configured capacity after resale.

## Migrations

Apply these tracked migrations in order in an authorized nonproduction environment:

1. `20260910010000_add_organizer_event_metrics.sql`
2. `20260910010100_add_organizer_order_reads.sql`
3. `20260910010150_add_organizer_order_detail.sql`
4. `20260910010200_add_owned_manual_admission.sql`
5. `20260910010300_add_owned_refund_context.sql`
6. `20260910010350_add_owned_refund_evidence_recovery.sql`

These add projections/adapters and an event-order index. Existing checkout, fulfillment, canonical refund, and atomic ticket redemption writers remain unchanged. The recovery context containing provider identifiers is service-only; the browser detail contains only the safe state.

## Verification results

| Check | Observed result |
| --- | --- |
| `pnpm typecheck` | Passed app, integration, E2E, and script TypeScript projects |
| `pnpm lint` | Passed without warnings |
| Full frontend `pnpm exec vitest run --maxWorkers=2` | 922 tests passed across 90 files |
| Final affected UI/component checks | 33 tests passed across 9 files after visual/navigation fixes |
| Dashboard public-link RED → GREEN | Failing old owner-management URL; corrected public event URL; 3 tests passed |
| `pnpm test:functions` | 228 Deno tests passed |
| `pnpm typecheck:functions` | Passed all Edge Function source/tests |
| Existing refund recovery plus dynamic organizer amounts | 55 integration tests passed; original fixed proof contract retained |
| Organizer SQL + refund/lifecycle/redemption regressions | 188 assertions passed across 7 suites |
| Organizer/ticketing RLS + reservation/fulfillment + Lite schema/collection/fulfillment | 299 assertions passed across 7 suites |
| Existing atomic redemption concurrency script | Two independent sessions confirmed waiting on the event advisory lock; one admitted, one already-used; one durable unchanged timestamp; no deadlock |
| Existing redemption fixture-collision script | Pre-existing receipt refused; receipt, switch and namespace preserved |
| Production build | Passed through the browser harness |
| Production fixture exclusion | `ticket-shell-production=passed` |
| Real local DB browser journey | 1 integrated scenario passed in 27.1 seconds, across all four viewports |
| Scanner camera baseline, isolated runtime test | **1 failed / 1 passed**; expected one factory call, observed two; assertion preserved |

The scanner baseline is intermittent: the aggregate frontend run passed, but the isolated `src/features/ticket-experience/runtime/production.test.tsx:33` assertion failed. The adjacent dashboard assertion changed because the dashboard is now enabled; the camera-factory assertion and creation behavior were not weakened. This is an open baseline issue, not a new all-green claim.

Local logs are `/tmp/ops-unit-final.log`, `/tmp/ops-ui-final.log`, `/tmp/ops-camera-baseline.log`, `/tmp/ops-deno-final.log`, `/tmp/ops-recovery-final.log`, `/tmp/ops-final-sql.log`, `/tmp/ops-extra-sql.log`, `/tmp/ops-admission-race.log`, `/tmp/ops-admission-collision.log`, `/tmp/ops-types-final.log`, `/tmp/ops-lint-final.log`, `/tmp/ops-functions-types-final.log`, and `/tmp/ops-production-boundary.log`. They are temporary local evidence, not committed artifacts. The isolated free-event page test initially imported the newly added operational API without its public environment; its query boundary is now mocked like the existing event query, and all six original free-event assertions pass without environment configuration.

## Browser and visual audit

Current-render status: **partial** across the full device/provider scope. Local layout and journey verification are reported separately from physical camera and external provider behavior. Fix-closure status: **verified** for the listed local layout defects, with same-route/state/viewport reruns. Delivery status: **not applicable**; no hosted target was deployed.

- Actor/job: authenticated owner operating one paid event; separate other-owner token verifies denial.
- Canonical local target: production Vite build served at `http://127.0.0.1:3012/organizer/events`, then its dashboard/orders/detail/check-in routes. No query credentials. The Playwright configuration builds the current worktree before serving it, with no reused server.
- Data: synthetic organizer/event/buyer in the disposable Postgres container `whereto-organizer-ops-v1-db` at loopback port 55435; real migrated SQL/ACLs through local PostgREST at port 55436. Authentication is synthetic; operational RPCs are real. The existing source database and original dirty checkout were left untouched.
- Viewports: 1440×1000, 768×1024, 390×844, 320×800 CSS pixels; reduced motion enabled.
- Authority: source fixes, local builds, and disposable synthetic state changes authorized by the implementation request. No real customer mutations, provider refund, or production deployment.
- Profiles: reference parity, responsive, and state/journey. Evidence level B: project Playwright journey plus inspected screenshots. Geometry guards support, rather than replace, visual inspection.

Reference relationships: narrow dark desktop sidebar and selected navigation; event hero preceding actions; serif event title; exactly four equal metric cards before tier rows; compact search and order rows; buyer summary above purchased items and individual admissions; mobile event/count above camera and Find guest. These relationships are implemented. Two-column mobile metrics and wrapped actions preserve hierarchy. Reference photography is deliberately absent when the event has no supported artwork; a neutral fallback is truthful. No fake production photograph or upload infrastructure was added.

Visual fixes found during review: long order references wrapped inside their card; scanner fullscreen positioning stopped covering event controls; the hidden search label received its scoped accessibility utility; event cards received an explicit dark background. The event-card regression was demonstrated RED (white instead of dark computed background), then GREEN in the final full journey. Browser geometry/visibility assertions cover order wrapping and visible scanner controls. The public View event link likewise had a failing route assertion before its fix.

Browser proof exercises real owner reads, three issued tickets, search by name/email/reference, empty results, keyboard dialog cancellation/focus return, manual admission and duplicate rejection, two-session QR/manual race, pending refund acknowledgment without false completion, unavailable-camera fallback, event end with stale admission rejection, and canonical SQL refund reconciliation preserving used timestamps and historical metrics. Other-owner reads and direct order-table access return 403.

The refund request in this browser harness returns a **stubbed pending acknowledgment**. Completion is then driven through the existing SQL receipt/refund writer with synthetic verified evidence. This proves UI/backend state handling and historical metrics, **not real Stripe execution or signed webhook delivery**. Deno tests separately cover endpoint ownership, exact input, retries, provider response shape, and evidence recovery.

Screenshot directory (ignored, local only): `test-results/organizer-operations/organizer-operations-owned-e414a-database-desktop-and-mobile/`. Captures include `events-*`, `dashboard-*`, `orders-*`, `detail-*`, and `scanner-camera-fallback-390.png`. No actual credentials or customer PII are captured; traces/video are disabled.

Opened and visually inspected evidence includes desktop dashboard/orders/events, tablet dashboard/detail, 320px dashboard/orders/detail, 390px events/orders/detail, and 390px scanner fallback. Final event-card captures have readable dark surfaces, mobile order references wrap, and scanner controls remain within the page. The full browser log is `/tmp/ops-browser-responsive.log`; the demonstrated contrast regression is `/tmp/ops-event-contrast-red.log`.

## Files and scope review

Primary changes are `src/features/organizer-operations/*`, `src/features/events/OrganizerEventsPage.tsx`, organizer shell/router, private auth cache, the organizer scanner composition and safe admission transport, generated database RPC types, the six migrations, organizer SQL tests, `supabase/functions/organizer-refund-order/*`, and its function configuration.

The existing recovery validator moved from the integration driver into `supabase/functions/_shared/refundEvidenceRecovery.ts`; the driver's wrapper preserves its old fixed fixture amounts. Provider adapters pass durable order amounts. Associated tests and `tsconfig.integration.json` support this shared Deno import. Browser proof lives in `playwright.organizer-operations.config.ts`, `tests/e2e/organizer-operations.spec.ts`, and `tests/e2e/support/organizerOperationsFixture.sql`. Only the organizer-events preview fixture changed; buyer previews remain unchanged.

Review covered actual diffs, ownership/allowlists, the provider mode contract, retry/recovery behavior, canonical completion after timeout, private cache eviction, no fake production values, and production fixture exclusion. The independent reviewer approved the refund adapter/recovery fixes without additional actionable findings. No package or lockfile changes, privileged client keys, map/discovery implementation edits, buyer journey edits, or changes to Core Ticket Truth / Checkout Integrity semantics.

Code commits culminate in `f1f0d4d` (verified provider evidence recovery) and `80a5f55` (responsive operations, canonical refund UI, and historical views), following the sequential slice commits listed in the implementation plan. Browser proof and this report are committed separately.

## Remaining verification and setup

- Real nonproduction Stripe refund and signed webhook delivery, including recovery after an interrupted evidence update, remain unrun: this worktree has no configured authorized Stripe test proof environment. The existing guarded Checkout Integrity/Lite proof must run with its exact configured test accounts, restricted credentials, webhook setup, and cleanup safeguards before release. Local synthetic SQL evidence is not a substitute.
- Physical-device camera permission, QR capture, teardown and all scanner result layouts on hardware remain unverified. Browser camera-unavailable handling and existing controller tests were exercised. The existing camera-factory baseline failure stays open.
- Populated layouts, missing artwork, empty search and keyboard cancellation have browser evidence. Loading/error branches have component tests; exhaustive browser screenshots of those transient states and every scanner outcome remain outside this local proof.
- Before an authorized nonproduction rollout: apply the six migrations; deploy the updated `ticket-admission` and new `organizer-refund-order` functions; provide the existing Supabase server credentials, approved app origin, Stripe test configuration, and existing signed-webhook configuration. `verify_jwt = false` follows the existing Edge convention; the handler itself verifies the bearer with `requireOrganizer`. No new email secrets or access-token service is required.
- The refund adapter remains test-mode-only under the existing Stripe policy. This work does not authorize or enable live payments.

Local reproduction uses a **disposable, fully migrated** database only. Seed `tests/e2e/support/organizerOperationsFixture.sql` after SQL suites; run PostgREST with this test's synthetic JWT secret and loopback endpoints; then run `pnpm exec playwright test --config playwright.organizer-operations.config.ts`. The journey mutates its synthetic tickets/event and must be reseeded for another run. Never seed or reset a shared/hosted database with this fixture. Synthetic JWT/public values in the harness are intentionally nonproduction.
