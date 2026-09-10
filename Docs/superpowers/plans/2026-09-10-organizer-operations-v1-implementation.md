# Wheretoo V1 Organizer Operations Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to execute sequentially under the founder-approved contracts. Steps use checkbox syntax. Do not dispatch shared-contract slices in parallel.

**Goal:** Enable an organizer to operate one owned event through metrics, order lookup, individual admissions, whole-order refunds, and historical access.

**Architecture:** Add narrow owner-authorized projections and mutation adapters around the existing transaction systems. A single tested server boundary defines metrics. React consumes safe projections and preserves failures/unknown outcomes.

**Tech Stack:** Existing React/TypeScript/Vite, React Query, Supabase/PostgreSQL, Edge Functions, Stripe test-mode integration, Vitest, Deno, pgTAP, and Playwright. Email/resend and free-event operations are excluded.

**Spec:** `Docs/superpowers/specs/2026-09-10-organizer-operations-v1-design.md`.

**Execution state:** **AUTHORIZED.** Founder decisions resolve B1/B2/B3/B5; resend (B4) and free-event operations (B6) are excluded. The spec contains the exact historical metric matrix and approved additive contracts. Execute sequentially without another approval checkpoint; stop only for a new true product/contract blocker.

## Global constraints

- Work only in `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-operations-v1`, branch `codex/organizer-operations-v1`.
- Base HEAD: `1d87c88fbb9da4ea4bf335659de7623af084c92e`, freshly fetched `origin/main`.
- No map/discovery changes, buyer redesign, production deployment, or copying original-checkout changes.
- Keep one organizer-operations project; execute Slices 1–5, 7–9 in order; former Slice 6 is removed.
- Preserve Checkout Integrity and Core Ticket Truth Lite semantics.
- Exactly four primary dashboard metrics; no speculative analytics.
- All reads and writes validate organizer/event ownership server-side.
- No base-table browser grants, `select *` operational responses, secret-bearing payloads, client-side metric policy, or optimistic admission/refund success.
- One order with three purchased units remains one order and three tickets.
- Only whole-order refund actions; used history is terminal and immutable.
- No resend, email/access-token infrastructure, or free-event operations in this build.
- Retain historical orders and admissions; enforce end-of-event admission server-side.
- Each task follows RED → GREEN → relevant regression → diff review → scoped commit.
- Use only disposable local DB targets or explicitly configured nonproduction test environments for integration proof. Do not run an unqualified hosted runner that changes a shared checkout switch.

## Contract lock — complete before code

- [x] Founder approves historical gross/sold/successful-order counts and used/all-issued ratio; exact matrix recorded in spec §6.
- [x] Owner-scoped event metrics and order read RPCs approved; base-table privileges stay revoked.
- [x] Organizer whole-order refund adapter approved; reuse existing helper with `requested_by_customer`, stable idempotency, and canonical status rereads.
- [x] Ticket-ID manual admission adapter approved; delegate to existing atomic redemption.
- [x] Resend/email/access infrastructure removed from active work.
- [x] Paid events only; preserve existing free-event editor/publishing separately.
- [x] Commit updated documents before beginning Slice 1.

## Exact service interfaces

Use the RPC names and signatures in spec §4. Read payloads use camelCase JSON: metrics `{event, grossSalesMinor, sold, orderCount, issued, checkedIn, capacity, tiers, admissionEligible}`; tiers `{id,name,status,capacity,sold,remaining,grossSalesMinor}`. Event context contains `{id,title,startsAt,endsAt,venueName,city,status,artworkPath}`. Dates/artwork/title/location can be null for drafts; absent draft data is never invented.

Orders list returns `{orders,nextCursor}` with rows `{id,orderNumber,buyerName,buyerEmail,createdAt,paidAt,status,quantity,totalMinor,currency,items}` and purchased item snapshots `{tierName,quantity,subtotalMinor}`. Cursor is `{createdAt,id}` or null. Order detail adds `tickets: [{id,admissionLabel,status,usedAt,issuedAt}]`, `refundState` and `admissionEligible`. Empty issued tickets remains an empty array.

Manual result is `{outcome,admissionLabel?,buyerName?,usedAt?}` with no secrets. The refund Edge endpoint accepts exactly `{eventId,orderId}` and returns a safe request outcome; order/ticket state is re-read from the owned detail API. Shape extensions must remain strict and tested. These additive interfaces do not change the existing buyer contracts.

## File responsibilities after the gate

The following names are proposed implementation locations, not existing APIs.

| Path | Responsibility |
| --- | --- |
| `supabase/migrations/20260910010000_add_organizer_event_metrics.sql` | Owner-authorized snapshot and tier metrics; no client policy. Recheck timestamp uniqueness when executing. |
| `supabase/migrations/20260910010100_add_organizer_order_reads.sql` | Bounded event order search/list and detail projections; allowlisted operational data. |
| `supabase/migrations/20260910010200_add_owned_manual_admission.sql` | Approved server-only ticket selector adapter; invokes existing redemption authority. |
| `supabase/tests/database/organizer_event_metrics.test.sql` | Status matrix, multi-tier arithmetic, inventory holds, historical uses, ownership. |
| `supabase/tests/database/organizer_order_reads.test.sql` | Search, pagination, detail cardinality, historical visibility, no secret exposure. |
| `supabase/tests/database/organizer_manual_admission.test.sql` | Same ticket truth for QR and manual operations; ownership/wrong-event/end rejection. |
| `src/features/organizer-operations/operations.schemas.ts` | Strict validation of approved read models; no silent defaults for invalid data. |
| `src/features/organizer-operations/operations.api.ts` | Transport and safe errors, explicit inputs/results. |
| `src/features/organizer-operations/operations.queries.ts` | Event-scoped cache keys, bounded paging, invalidation after verified mutations. |
| `src/features/organizer-operations/OrganizerOrdersPage.tsx` | Event-only list/search and Load more. |
| `src/features/organizer-operations/OrganizerOrderDetailPage.tsx` | Financial summary, purchased tiers, individual admissions. |
| `src/features/organizer-operations/ManualAdmissionDialog.tsx` | Lightweight per-ticket confirmation and authoritative result. |
| `src/features/organizer-operations/RefundOrderDialog.tsx` | Explicit whole-order confirmation and asynchronous truth. |
| `src/features/organizer-operations/organizer-operations.css` | Scoped reference styling; no buyer/map selectors. |
| Existing event index/dashboard/scanner and runtime files | Connect real data and Image #1 visuals without duplicate systems. |
| `src/lib/supabase/database.types.ts` | Regenerate from the migrated disposable local schema; never hand-invent database types. |
| `tests/e2e/organizer-operations.spec.ts` | Integrated journey and two-owner negative tests. |

Refund endpoint: `supabase/functions/organizer-refund-order/index.ts` and `index.test.ts`, plus `20260910010300_add_owned_refund_context.sql` for service-only owner/event/order context. Manual adapter is the authenticated RPC in the file table. Neither creates a second lifecycle engine.

## Slice 1 — Canonical organizer event metrics

### Task 1A — Authoritative SQL projection

Files: metric migration and SQL test above. Inspect latest inventory and Lite lifecycle definitions before changing anything.

Consumes: event/organizer identity from authenticated context, `orders`, immutable `order_items`, `tickets`, tier inventory, and the approved status matrix.

Produces: one owner-scoped metric snapshot containing the four primary metrics, tier breakdown, configured denominator, server time, and explicit availability status. No PII or credentials.

- [ ] RED: use the existing Lite SQL fixture helper to create A/B organizers, owned events, GA/VIP inventory, and a paid 2-GA/1-VIP order. Assert aggregate quantities are 3 and order cardinality is 1; assert gross comes from historical item subtotals, not current tier prices.
- [ ] RED: table-driven scenarios cover creating/open reservations before/after expiry, processing, failed, cancelled, expired, paid, refunded, review, legacy partial, cancelled event, used tickets, and ended event. Use the exact spec §6 matrix; review/refund after paid_at must not decrease historical values.
- [ ] RED: reject anonymous and wrong-owner reads, preserve unavailable for incoherent money/source data, and keep used count after refund/cancellation.
- [ ] Run the new pgTAP file on a disposable migrated database; confirm failures are absent projection/assertion failures, not an invalid fixture or missing infrastructure.
- [ ] GREEN: implement one scoped server projection; aggregate order money independently of ticket joins to prevent multiplication; derive tiers from purchased snapshots and current configured inventory according to approved policy.
- [ ] Run metrics tests plus existing inventory, fulfillment, refund, and Lite lifecycle SQL suites. Regenerate local database types.
- [ ] Inspect diff; commit `feat: add canonical organizer event metrics`.

### Task 1B — Read adapter and cache

Files: `operations.schemas.ts`, `operations.api.ts`, `operations.queries.ts`, with colocated `.test.ts`/`.test.tsx` files.

- [ ] RED: reject malformed status/money values and event-ID mismatches; preserve query failure as error/unavailable; switching event clears previous data; cancellation prevents stale result replacement.
- [ ] GREEN: implement the approved wire signature using existing Supabase/React Query conventions. Query key includes event and authenticated owner context; sign-out clears operational data.
- [ ] Run adapter/query tests and `pnpm typecheck`; commit `feat: connect organizer metrics reader`.

## Slice 2 — Event Dashboard

### Task 2 — Owned event entry, dashboard, and visual structure

Modify: `src/features/events/OrganizerEventsPage.tsx`, its tests; `src/features/ticket-experience/dashboard/EventDashboardPage.tsx`, its tests; `contracts/dashboard.ts`; production/development runtime adapters and their tests; scoped organizer styles and layout tests as needed.

Consumes: Slice 1 projection and existing owned event/editor routes. Produces: operational dashboard and My Events entry points matching Image #1.

- [ ] RED: clicking an owned event reaches its dashboard; Create event/Edit event preserve existing flows. Assert exactly Gross ticket sales, Tickets sold, Orders, Checked in as primary metrics and one row per tier.
- [ ] RED: missing artwork/date/capacity has truthful fallback; query failure offers retry without 0 metrics; empty paid event shows real authoritative zero; free events stay outside operations with their existing editor routes. Historical owner page does not depend on public event eligibility.
- [ ] GREEN: add artwork/title/time/venue/status header and three primary actions. Keep desktop hierarchy, purple primary accent, dark surfaces, rounded cards. Display authoritative values without recalculating them in React.
- [ ] GREEN: wire production to the real reader; keep demo fixtures confined to development. Remove the obsolete primary Remaining card while retaining tier remaining values.
- [ ] Run affected event/dashboard/runtime/router tests, typecheck, and production fixture-exclusion check. Verify desktop/mobile layout in browser with frontend visual QA.
- [ ] Inspect diff; commit `feat: build organizer event dashboard`.

## Slice 3 — Event-specific Orders

### Task 3A — Ownership, search, and pagination contract

Files: order-read migration/test; operations schemas/API/query tests; generated database types.

- [ ] RED: query A's event as A succeeds; query B's event as A yields no records or buyer information. An unauthenticated request fails before any data projection.
- [ ] RED: match case-insensitive buyer name, email, and order reference only. Escape literal wildcard characters; reject overlong queries. Use the approved bounded page size and deterministic timestamp/ID ordering; multiple equal timestamps do not duplicate or skip rows.
- [ ] RED: paid/refunded/cancelled and all other supported historical statuses stay reachable. A 3-ticket, 2-tier order remains one row with quantity 3, two tier summaries, and one order amount.
- [ ] GREEN: implement allowlisted server projections, never broad table grants. Return only necessary row PII, item summaries, amount semantics, state, and paging cursor. Add indexes justified by the exact scoped query.
- [ ] Run order SQL tests, existing ticketing RLS tests, and transport schema tests; commit `feat: add owned event order search`.

### Task 3B — Orders screen

Files: `OrganizerOrdersPage.tsx`/tests, router/tests, operations queries/tests, scoped styles.

- [ ] RED: search by each permitted field; empty query/result; Load more; failure retains current rows and exposes retry; change-event cannot retain prior event PII. No cross-event Orders route or global customer filter exists.
- [ ] GREEN: build compact desktop list with readable mobile adaptation. Status filters, if used, remain simple and include an All view; they must not remove historical records from reach.
- [ ] Run page/router/query tests; inspect keyboard focus and narrow layout; commit `feat: build event-specific organizer orders`.

## Slice 4 — Order Details

### Task 4 — Allowlisted detail and individual tickets

Files: extend order-read migration before it is released, otherwise add a new migration; order-read SQL tests; `OrganizerOrderDetailPage.tsx`/tests; schemas/API; router.

- [ ] RED: detail requires both selected event and matching order ownership. Assert reference, buyer name/email, purchase time, historical paid amount, financial state, items, and exactly one card per actual issued ticket.
- [ ] RED: no issued tickets for incomplete payment is an explicit empty state; never create visual admission rows from cart quantities. Used/refunded/cancelled/valid remain distinct, and a refunded order with a used ticket retains that ticket's timestamp.
- [ ] RED: response excludes credential/hash/confirmation/Stripe fields. Absent purchase success does not label order creation time as a successful purchase or total due as total paid.
- [ ] GREEN: implement the approved safe projection and detail page; display fields with their actual semantics. Use buyer information, not invented per-ticket holder names.
- [ ] Run SQL/detail/schema/router tests and multi-tier regressions; commit `feat: add organizer order details`.

## Slice 5 — Manual Check-In

### Task 5A — Adapter into existing atomic redemption

Files: manual admission migration/SQL tests; approved authenticated Edge adapter and tests; existing `ticket-admission` response contract only as approved; admission adapters/types/tests.

- [ ] RED: valid ticket ID admits once, repeat returns already used and the original timestamp. Wrong owner, wrong event, invalid selector, refunded/cancelled ticket, incoherent source, and ended event do not mutate anything.
- [ ] RED: QR-first/manual-second and manual-first/QR-second return one admitted then already-used. Two concurrent requests produce exactly one transition. Race against refund/cancellation preserves existing event-lock ordering.
- [ ] RED: invalid/wrong-event responses expose no buyer/ticket information; normal responses include only approved safe fields. Browser never receives the resolved hash or credential.
- [ ] GREEN: server-only ownership check and selector resolution delegate to `server_redeem_paid_ticket`. Do not add an alternative UPDATE statement or reimplement eligibility in the adapter.
- [ ] Run new SQL/concurrency tests, existing Lite redemption/collision/lifecycle suites, Deno admission tests, and client admission transport tests; commit `feat: add authorized manual admission adapter`.

### Task 5B — Manual confirmation and scanner reference UI

Files: `ManualAdmissionDialog.tsx`/tests, detail page tests, scanner view/controller/tests and scoped styles.

- [ ] RED: confirmation identifies event/buyer/tier/ticket and requires explicit action. Cancel makes no request. Failed/unknown admission never marks Used. Successful operation refetches the ticket and counts.
- [ ] RED: scanner has server event name/count and Find guest link to this event's orders. Success/already-used display actual authoritative used time; refunded/cancelled/invalid/wrong-event/network results are distinct; Scan next ticket resets camera/result safely.
- [ ] GREEN: implement Image #1 mobile hierarchy with camera permissions/unavailable handling, accessible focus/result announcements, reduced motion, and existing scan controller safeguards.
- [ ] Run page/scanner tests and browser camera/fallback proof; commit `feat: build organizer manual and mobile check-in`.

## Former Slice 6 — removed from this build

Resend, email transport, delivery testing, and access-token infrastructure are explicitly excluded. Continue directly from Slice 5 to Slice 7; no stub endpoint or misleading action is created.

## Slice 7 — Whole-Order Refund UI

### Task 7 — Existing helper adapter, confirmation, and reconciliation

Use `organizer-refund-order` and the service-only owned context RPC. Reason is `requested_by_customer`; reuse `_shared/refundOrder.ts` and the existing Stripe client; no parallel refund implementation.

- [ ] RED: wrong owner/event never calls Stripe or prepares another organizer's order. Client amount/tier/ticket inputs are rejected. The request invokes the existing helper with stable order idempotency and its existing transfer/application-fee policy.
- [ ] RED: pending, failed, cancelled, timeout, existing succeeded refund, and repeated click cannot optimistically mark the order refunded or cause another refund. Retry behavior must reconcile existing state when preparation rejects an already-active/completed refund.
- [ ] RED: whole-order confirmation names the order, total, and all admissions affected. After verified full refund, unused tickets become refunded, the used ticket remains used with unchanged timestamp, and dashboard refresh follows the approved matrix.
- [ ] GREEN: implement approved owner adapter and `RefundOrderDialog.tsx`. Request acknowledgment presents pending until a durable read reports the canonical state. Refusal/failure preserves prior state and exposes a safe explanation/retry path.
- [ ] Run helper/webhook/SQL refund regressions, UI tests, and authorized nonproduction Stripe full-refund proof; commit `feat: add organizer whole-order refund action`.

## Slice 8 — Ended-event historical behavior

### Task 8 — Time boundary and permanent operational history

Files: operations projections/tests, dashboard/detail/orders/scanner tests; minimal production changes only if tests expose an omission.

- [ ] RED: at just before/end/after end time, list/dashboard/orders/detail and used history stay readable to the owner; new QR/manual admission is rejected at end. A stale page opened before end cannot bypass the server.
- [ ] RED: cancelled event history is readable while new admission rejects; already-used history still reports its existing time. Public View event unavailability does not hide the owner dashboard.
- [ ] GREEN: expose authoritative admission eligibility from the existing lifecycle rules; disable inappropriate controls with explanation without filtering historical data. Do not rewrite the existing atomic end check.
- [ ] Run owner/history/time-boundary integration tests and Lite lifecycle suite; commit `fix: preserve organizer history after event end`.

## Slice 9 — Integrated browser proof

### Task 9 — One complete operational journey and release evidence

Files: `tests/e2e/organizer-operations.spec.ts`, its sanitized test setup, and `Docs/testing/organizer-operations-v1-verification.md`.

- [ ] RED: automate A opening My Events → Dashboard → search Orders by name/email/reference → a three-ticket detail → confirmed manual admission → duplicate rejection → full refund → historical views. Assert all four metric values against the same authoritative fixture before/after each mutation.
- [ ] RED: B cannot inspect or mutate A's dashboard/orders/buyer/tickets/check-ins/refund; wrong-event ticket selectors reject; failures retain data and never show success.
- [ ] GREEN: close only defects found within this project. Capture desktop dashboard/orders/detail and mobile scanner/result states using synthetic non-secret UI fixtures; never record real QR credentials, bearers, or PII in screenshots/traces.
- [ ] Run frontend visual QA with the attached image: desktop 1440px, tablet 768px, mobile 390px and 320px, long names, no artwork, empty/error/loading states, keyboard dialogs, reduced motion, no overflow. Keep screenshots local unless required as a reviewed artifact.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:functions`, `pnpm typecheck:functions`, `pnpm build`, and production fixture-exclusion verification.
- [ ] Run relevant disposable-local SQL suites: organizer/event and ticketing RLS, metrics/order/admission additions, checkout reservation/fulfillment/refund, and Lite schema/collection/redemption/lifecycle/concurrency.
- [ ] Run the existing guarded real nonproduction Checkout Integrity/Lite proof only with its configured test environment and authorization; preserve all existing no-secret and exact cleanup safeguards. Record any unrun check as an open gate.
- [ ] Inspect actual diff for map/buyer scope drift, fake production fixtures, placeholders, imports, client secrets, and unintended dependencies. Record migrations and manual setup explicitly.
- [ ] Commit `test: prove organizer operations journey`; do not deploy production, merge, or push without separate instructions.

## Baseline verification record

This audit makes documentation changes only. The checks below concern unmodified base code and do not prove any new organizer behavior.

- `pnpm install --frozen-lockfile`: passed; lockfile unchanged.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- Production `pnpm build` with disabled non-secret public environment values: passed.
- `pnpm test:functions`: passed, 219 tests.
- Initial full `pnpm test`: 894 passed, 1 failed because the Node/tsx email-render subprocess exceeded its 5-second timeout during concurrent baseline checks.
- Isolated `scripts/send-ticket-ready-test.test.ts`: passed, 18 tests, without source changes.
- Full unit suite rerun with `pnpm exec vitest run --maxWorkers=2`: 894 passed, 1 failed. `src/features/ticket-experience/runtime/production.test.tsx:33` expected one camera-factory invocation and observed two. This assertion passed in the initial run; the full baseline is not clean. No source change or timeout adjustment was made to hide either failure.
- Isolated production-runtime test rerun: 1 passed, 1 failed with the same two-versus-one camera-factory assertion. Resolving that baseline failure is required before later implementation is declared verified.
- No new SQL, live Stripe/Resend operation, deployment, or browser proof was performed. This was the original documentation-only audit; no disposable DB was configured then. Hosted scripts were inspected, not invoked.

## Completion evidence required after implementation

Report changed files and migrations, the exact metric matrix, test counts/results, local versus provider/browser proof, remaining gaps, and manual setup. Passing unit tests cannot substitute for owner isolation, concurrent admission proof, real refund reconciliation, or actual refund reconciliation. Preserve the scanner camera test baseline separately from new regressions. Stop only for new true product/contract blockers.
