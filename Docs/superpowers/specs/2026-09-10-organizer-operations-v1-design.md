# Wheretoo V1 Organizer Operations — design and contract audit

Date: 2026-09-10

Status: **BLOCKED before production implementation.** The visual direction and requested scope are approved by the user's request. The new backend contracts and unresolved metric definitions below are not approved by this document. No production code, migrations, provider calls, or deployment accompany this audit.

## 1. Baseline and authority

- Branch: `codex/organizer-operations-v1`.
- Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-operations-v1`.
- Base: freshly fetched `origin/main`, `1d87c88fbb9da4ea4bf335659de7623af084c92e`.
- Base subject: `merge: integrate ticket truth, multi-tier ticket selection, and preview hub`.
- Committed migration head: `20260907010300_preserve_lite_ticket_invalidation.sql`.
- The original checkout contains uncommitted buyer work and a later uncommitted migration. Neither is part of this baseline; neither was copied or changed.
- Authority: the user's pasted Organizer Operations request, Image #1, `WHERETO_V1_PRODUCT_DEFINITION.md`, `WHERETO_V1_USER_FLOWS.md`, and `WHERETO_V1_TECHNICAL_ARCHITECTURE.md`.
- Image #1: the attached `codex-clipboard-1799859e-7cc7-49fc-979c-a6db6aaa9c71.png`. Its example identities, dates, amounts, and art are reference content, not production data.
- Historical plans and runbooks describe earlier work. Their deployment instructions do not authorize deployments in this project.

The worktree starts at current main; fetching confirms recency, not production readiness. Baseline verification is reported separately in the implementation plan.

## 2. Required outcome and boundaries

An organizer opens one owned event, understands its performance, finds a buyer/order, resolves basic ticket issues, and operates the door. Preserve creation, editing, moderation, publishing, tier management, Connect, checkout, issuance, collection access, refunds, and admission truth.

Exactly four primary dashboard metrics: gross ticket sales, tickets sold against configured inventory, order count, and checked-in admissions against the approved denominator. Include a tier breakdown with sold, remaining, and gross ticket sales.

Orders and search are scoped to the selected event. Search accepts only buyer name, buyer email, and order reference. Every historical order remains reachable. Each order shows each admission separately. Manual admission requires confirmation and the existing atomic authority. Refunds are whole-order only. Resend sends access to existing tickets without creating an order, ticket, or replacement admission credential. Ended events remain readable and reject new admission.

No map/discovery changes, buyer redesign, production deployment, cross-event customer UI, charts, advanced analytics, attribution, CRM, campaigns, team accounts, transfers, exchanges, partial refunds, payout controls, or NFC.

## 3. Existing implementation map

Paths below are relative to this worktree. These findings describe committed source, not a claim about deployed configuration.

| Capability | Existing boundary | Finding |
| --- | --- | --- |
| Organizer auth | `src/app/router/RequireSession.tsx`, `RequireOrganizer.tsx`; `supabase/functions/_shared/auth.ts` | UI guards and server `requireOrganizer` exist. Server identity comes from verified Auth, never a submitted organizer ID. |
| Event ownership | `20260824010100_secure_organizer_event_publishing.sql`; `src/features/events/event.api.ts` | Owner RLS plus owner-filtered reads exist. Historical owner reads do not require public discovery eligibility. |
| My Events | `/organizer/events`; `OrganizerEventsPage.tsx` | Lists owned events, creates events, routes drafts to edit and other events to published management. No operational metrics or approved artwork layout. |
| Create/edit/publish | `/organizer/events/new`, `/:eventId/edit`, `/:eventId/preview`, `/:eventId`; event editor/preview/published pages | Existing flows and moderation boundaries must remain. |
| Tier management | `/:eventId/tickets`; `OrganizerTicketTiersPage.tsx`; `list_owned_ticket_tiers`, `save_ticket_tiers` | Authoritative tier setup and ownership validation exist. |
| Connect | `/organizer/settings/payments`; Connect Edge Functions | Existing payment readiness remains separate from gross sales and payouts. |
| Dashboard shell | `/:eventId/dashboard`; `ticket-experience/dashboard/EventDashboardPage.tsx`; `contracts/dashboard.ts` | Development fixture reader only. Production runtime assigns `OrganizerDashboardRoute: NotEnabledRoute`. Existing four fixture metrics do not match the requested four metrics. |
| Order data | `public.orders`, `order_items`, `tickets`, `refunds` | Durable multi-tier order and individual ticket truth exists. Direct browser reads/writes are revoked. No owner order-list/detail/search RPC or Edge route exists. |
| Confirmation | `/orders/:confirmationToken`; `order-confirmation` | Buyer bearer-scoped read; not an organizer PII/query API. |
| Ticket collection | `/tickets/:collectionBearer[/:ticketSelector]`; `ticket-collection`; `server_lookup_paid_ticket_collection` | Coherent paid/refunded collection reader exists. It intentionally strips PII and internal source/hash material. It cannot substitute for an organizer order projection. |
| QR check-in | `/:eventId/check-in`; `ProductionOrganizerScannerRoute.tsx`; `ticket-admission`; `server_redeem_paid_ticket` | Real authenticated QR redemption and atomic transition exist. Request requires `{eventId, credential}`. Response returns outcome and tier label, not buyer identity, ticket ID, or used timestamp. |
| Manual check-in | No ticket-ID request contract | A ticket detail cannot invoke the existing HTTP contract without obtaining an admission secret. A safe server adapter is missing. |
| Refund execution | `_shared/refundOrder.ts:createWholeOrderRefund`; `server_prepare_whole_order_refund`; Stripe webhook reconciliation | Existing full-refund helper, stable order idempotency key, refund economics checks, and durable reconciliation exist. Only the integration test driver wires the helper to Stripe. No organizer endpoint exists. |
| Email | `ticket-experience/email/*`; `scripts/send-ticket-ready-test.tsx` | Templates and a gated one-off test harness exist. It sends a fixed test scenario with an example URL. No production order-aware send/resend service exists. |
| Historical admission | Lite migrations `20260907010000` through `20260907010300` | `used` is terminal; `used_at` immutable. Event cancellation affects unused valid tickets. Event end is checked server-side before new admission. |

Production routes are defined in `src/app/router/router.tsx`. New orders routes would be `/organizer/events/:eventId/orders` and `/organizer/events/:eventId/orders/:orderId`, beneath the existing authenticated organizer guards.

## 4. Blocking gaps

### B1 — Canonical dashboard formulas are not yet product-defined

Checkout Integrity design §8.6 names data sources, but intentionally leaves analytics out of scope. It does not define which order statuses contribute to gross sales, sold units, or order count. It also does not choose historical issued admissions versus current admissions as the check-in denominator.

These choices materially change results after refunds, event cancellation, and financial review. They cannot be selected independently by UI components. The existing fixture dashboard is not authority. Section 6 isolates the known facts and the decisions required before Slice 1.

### B2 — No safe organizer order projection

`20260825010100_secure_paid_sales_and_tiers.sql` revokes browser table privileges on orders, items, tickets, and refunds. This is a protective boundary, not an existing data exposure. No subsequent migration supplies the requested owner-scoped list/detail/search contract.

Required new contract: authenticated owner-only, event-bound, allowlisted projections, bounded server pagination, search by the three authorized fields, and safe unknown/error results. Do not grant broad table SELECT or return `select *` rows. Prove organizer A cannot read B's buyer information, ticket details, or counts.

### B3 — No organizer refund invocation

`server_prepare_whole_order_refund(orderId, reason)` is service-only and has no organizer identity parameter. Calling it from a browser or wrapping it without ownership validation would be unsafe. The final preparation chain requires a paid order, rejects succeeded refunds, and rejects pending/requires-action refunds. Existing helper execution is in `tests/integration/edge/task17-transaction-driver/index.ts`, not a production organizer function.

Required new contract: verified organizer identity, event/order ownership check before provider work, approved reason mapping, existing helper reuse, safe retry/pending/failure responses, and re-read of webhook-derived truth. It must never equate a provider request acknowledgment with a durably refunded order. No second refund algorithm is proposed.

### B4 — Transactional resend infrastructure and access recovery are missing

Missing pieces are an authenticated order-aware resend endpoint, server email transport, configured sender and runtime secret, delivery-attempt/idempotency/rate-limit policy, and safe buyer ticket-access material. This audit did not inspect or expose provider secrets; deployment configuration remains unverified.

The access problem is independent of email transport: `checkout.attempt.ts` creates an independent random confirmation bearer in the buyer's browser. Orders store only `confirmation_token_hash`. `ticket-collection` hashes the presented bearer and matches that hash. The original bearer cannot be recovered from this one-way hash.

Admission QR credentials can be deterministically reproduced by the existing server secret, but they are different from collection-access bearers. Do not expose or rotate either to make resend appear implemented. Do not scrape payment-provider URLs or logs to recover a bearer.

A decision is required on an additional secure email-access mechanism for the existing collection, or another approved delivery mechanism for existing credentials. It must preserve existing ticket IDs, credential hashes, prior links, issuance, and buyer presentation. This is a new access contract; it is not silently included in a UI task.

### B5 — Manual admission and richer scanner results need a server extension

The current strict request accepts only event ID and raw QR credential; its SQL function receives only the credential hash. Organizer ticket details cannot legitimately synthesize that request from a public ticket ID.

Proposed direction, requiring approval: a narrow owner-authorized ticket-ID adapter resolves the stored credential hash server-side and invokes the existing `server_redeem_paid_ticket` function. It must perform no independent ticket UPDATE. Retain wrong-event checks, event locking, coherence checks, terminal-state precedence, and the final conditional transition.

Separately, the image requires current counts, buyer name, and check-in time. Existing scanner responses provide none of those. Add an explicitly allowlisted owner-only result/context projection. Return PII only for an owned, correctly matched event. A wrong-event or invalid result must not leak a buyer or ticket label. Names are buyer names unless a real ticket-holder field exists; no ticket-holder identity is currently captured.

### B6 — Free-event operations have no implemented admission source

Main allows free event creation, but the audited transaction/admission path is explicitly paid-ticket-only. No production RSVP issuance/redeem service or registration table was found. Database order/item money constraints are positive, and Lite checks paid event type.

Free events can remain in the owned list and existing editor. Their operational metrics/admissions must be shown as unavailable unless an RSVP contract is supplied. Resolve whether this project operates paid events only; do not silently represent free-event attendance as zero or extend Core Ticket Truth to free admissions.

### Additional visual dependency — artwork availability

Events have `artwork_path`; the public page has limited safe URL rendering. The existing editor does not supply a complete artwork-upload flow and current moderation eligibility includes artwork restrictions. Render verified existing artwork where supported and a clearly neutral missing-art state otherwise. Matching reference photography cannot justify an upload/moderation redesign or sample production art.

## 5. Canonical truth that must remain unchanged

| Layer | Current truth |
| --- | --- |
| Orders | `creating_checkout`, `checkout_open`, `payment_processing`, `paid`, `expired`, `payment_failed`, `cancelled`, legacy `partially_refunded`, `refunded`, `requires_review`. |
| Order money | Immutable integer minor-unit snapshots. Ticket value is `subtotal_minor`; `total_minor` includes tax. Neither is an available payout balance. |
| Items | One item per distinct purchased tier; immutable tier name, quantity, unit price, subtotal, and currency snapshots. Current tier prices must not reprice historical orders. |
| Tickets | One per purchased item unit. Exactly `valid`, `used`, `refunded`, `cancelled` with constrained timestamps. An incomplete order does not imply issued tickets. |
| Used history | `used` is terminal. A whole-order refund can leave an order `refunded` with one used ticket and two refunded tickets. Event cancellation likewise preserves used history. |
| Refund pending/failure | Requesting a refund does not authorize a UI state change. Pending/requires-action retains inventory; failed/cancelled refund attempts do not mean the order is refunded. |
| Partial/refund anomaly | Exceptional review path, not a supported partial-refund action. Do not allocate partial money across ticket tiers. |
| Event cancellation | Stops unused admission without automatically initiating financial refunds. Event status and order financial status remain distinct. |
| Event end | New valid admission rejects when `ends_at <= clock_timestamp()`. End is derived, not a new stored order/ticket status. Existing used state remains historical. |
| Security | Ticket IDs are identifiers, not credentials. Organizer data projections exclude hashes, admission secrets, collection bearers, Stripe secrets, and unnecessary provider IDs. The existing buyer QR display and scanner input retain their separate credential contracts. |

## 6. Metric boundary: exact known formulas and unresolved decisions

Use one database/service projection with one authoritative snapshot time. React formats returned values and does not infer totals from a loaded order page. The My Events summary, dashboard, tier rows, and scanner count must consume the same definitions. Missing/failed data remains unavailable, never zero.

### Existing authoritative inventory formula

For tier `t` at database time `now`:

```text
committed(t) = SUM(order_items.quantity for t where
  order.status IN (paid, payment_processing, requires_review, partially_refunded)
  OR (order.status IN (creating_checkout, checkout_open)
      AND order.reservation_expires_at > now))

remaining(t) = ticket_tiers.quantity_total - committed(t)
```

Source: Checkout Integrity design §9.3 and `20260902010100_add_checkout_cart_reservation.sql`. Paid cancellation at the event/ticket layer does not release paid order commitments. Full reconciled refunds release order commitments even when used tickets remain. Remaining therefore cannot safely be `capacity - valid_ticket_count` or `capacity - historical_sales`.

Use tier inventory as paid capacity authority, not the unrelated free-event capacity field. Decide how archived tiers contribute to the dashboard capacity denominator while preserving their historical breakdown. Do not clamp an impossible negative result into normal-looking availability; surface inconsistent data. Event admission/sales eligibility is separate from inventory remaining.

### Existing authoritative check-in numerator

```text
checked_in = COUNT(owned event tickets with status = used AND used_at IS NOT NULL)
```

Source coherence and all lifecycle timestamp constraints must still pass. Refund/cancellation/end never erase those historical uses. The denominator remains a product decision.

### Decisions that must be recorded before Slice 1

| Metric | Option A | Option B | Why the choice matters |
| --- | --- | --- | --- |
| Gross ticket sales | Lifetime successful ticket subtotals, including subsequently refunded orders | Current reconciled paid-order subtotals, excluding refunded/review orders | Full refund leaves sales unchanged under A and reduces sales under B. The term gross alone is insufficient to select refund behavior. |
| Tickets sold | Historical successfully purchased item quantities | Current reconciled paid-order quantities | Refunded orders retain historical sales but no longer consume inventory. Used-after-refund tickets are not newly sold tickets. |
| Order count | All event order records, including incomplete/failed attempts | Successfully purchased orders, including historical refunds | Orders table includes checkout attempts; neither existing docs nor the image specifies inclusion. Listing history does not settle the headline metric. |
| Check-in denominator | All coherently issued historical tickets | Current `valid + used` admissions | Refunded/cancelled unused tickets remain in the first denominator and leave the second. Used history remains in both. |
| Review/anomaly money | Include independently verified historical success with an explicit rule | Mark affected aggregates unavailable pending reconciliation | `paid_at` alone cannot resolve partial refunds, disputes, or inconsistent financial snapshots. |
| Capacity | All configured tier inventory | Only tiers currently offered for sale | Archived tier sales and historical admissions can outlive sale availability. |

No option has been adopted. Final approval must produce an exact inclusion matrix for every order status and each cancellation/refund/review condition, then pin it in SQL fixtures. A blocked document must not pretend that an approved, tested formula already exists.

Concrete decision fixture: one order buys two GA at $20 and one VIP at $30. Initially gross is $70, quantity is 3, order count is 1, and check-in is 0/3. Admit one GA, then fully refund the order. Canonical tickets become `used/refunded/refunded`, and used time stays fixed. Option A sales remain $70 and 3; option B sales become $0 and 0. Historical admission ratio is 1/3; current ratio is 1/1. Inventory releases all three commitments under the existing contract. This difference must be resolved before implementing the UI.

## 7. Visual and interaction contract

- My Events: compact artwork rows, title/date/location, distinct lifecycle badge, reliable sales summary, prominent Create event. Selecting an event opens its dashboard; existing edit access stays available there.
- Desktop dashboard: restrained near-black surfaces, purple primary action, generous artwork header, prominent event title, date/time/location/status; Check in guests, View event, Edit event; exactly four metrics and tier breakdown. No extra analytics cards.
- Desktop Orders: selected event context, a compact search field, clear status indicators, buyer name/email, ticket quantity/tier summary, amount and canonical financial state. Simple bounded Load more. No global Orders destination without event context.
- Order Details: order reference, buyer, purchase timestamp, money/status, purchased item snapshots, individual admission cards and used timestamps. Whole-order refund confirmation and manual-admission confirmation must identify exactly what will change.
- Mobile Check-in: event name/count, large camera area, Scan guest ticket, Find guest; use the existing scanner lifecycle and camera teardown. Result screens match Image #1's green admission, amber already-used, and red refund/cancellation hierarchy; preserve Invalid and Wrong Event as equally explicit results.
- Used history is displayed even for a refunded order. No generic order badge overrides individual ticket truth.
- Artwork is data-dependent. No reference image values, photographs, names, or counts enter production fixtures.
- Scoped organizer styles prevent buyer/map visual changes. Retain existing fonts where possible; any typography change stays within organizer operations.
- Keyboard focus, labeled inputs, semantic tables/lists, accessible dialogs, live result announcements, sufficient contrast, and reduced-motion behavior are required. Decorative effects never obscure operational outcomes.

## 8. Proposed architecture after blockers are resolved

Preferred direction: additive organizer operations projections and narrow mutation adapters. Keep event/domain data and calculations server-side. Reuse existing React Query/API/schema conventions and existing session shell. Do not enable development fixture readers in production.

Alternatives considered: browser aggregation/direct table grants would expose excessive fields and create inconsistent metrics; a second ticket/refund subsystem would duplicate high-risk truth. Neither is acceptable under the locked request.

Read boundaries authenticate and scope the selected event before querying. Order detail additionally scopes the order to that event. Safe projections include operational PII only where needed. List queries use stable bounded pagination; max page size and query-length validation live server-side. Search failures retain the previous page with an explicit failure/retry state. Changing events cannot flash the previous event's PII.

Mutation boundaries return explicit success, pending/unknown, forbidden/unavailable, or failure. No optimistic money or admission status changes. Refetch metrics/order/tickets after authoritative completion. A timeout is unknown and must be reconciled rather than presented as a successful refund, send, or admission.

Ended/cancelled events continue to use owner projections, never active public discovery queries. A disabled button is convenience; the server remains the admission authority. Public View event can explain unavailability for a historical event without compromising organizer history.

## 9. Required resolution before production code

1. Choose and record the exact metric/status inclusion matrix and archived-tier denominator.
2. Approve the owner-scoped order/dashboard read contracts; retain revoked base-table access.
3. Supply or approve an organizer refund adapter around the existing helper, including reason mapping and retry semantics.
4. Resolve transactional email and secure recovery of access to existing collections without changing ticket credentials.
5. Approve the ticket-ID admission adapter and the safe scanner result/context fields.
6. Confirm paid-only operations for current main, or supply the missing free-RSVP contract separately.

The sequential implementation plan is `../plans/2026-09-10-organizer-operations-v1-implementation.md`. All production tasks remain gated by this section, as explicitly requested by the user.
