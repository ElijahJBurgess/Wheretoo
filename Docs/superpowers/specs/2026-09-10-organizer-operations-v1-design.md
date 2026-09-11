# Wheretoo V1 Organizer Operations — approved design

Date: 2026-09-10

Status: **APPROVED for sequential implementation.** Founder decisions on 2026-09-10 resolve the original audit gaps. Image #1 remains visual authority. Scope is paid events only; resend and all new email/access-token infrastructure are excluded. Existing scanner camera-factory test failure remains a recorded baseline issue, not a reason to weaken tests.

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

Orders and search are scoped to the selected event. Search accepts only buyer name, buyer email, and order reference. Every historical order remains reachable. Each order shows each admission separately. Manual admission requires confirmation and the existing atomic authority. Refunds are whole-order only. Ended events remain readable and reject new admission.

No resend, email/access-token infrastructure, free-event operations, map/discovery changes, buyer redesign, production deployment, cross-event customer UI, charts, advanced analytics, attribution, CRM, campaigns, team accounts, transfers, exchanges, partial refunds, payout controls, or NFC.

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

## 4. Founder-approved contracts

The previous B1–B6 audit findings are resolved by the latest explicit instruction. New secure Wheretoo-owned read APIs, a whole-order refund adapter, and a manual admission adapter are approved. These are additive boundaries over existing truth, not changes to checkout or ticket semantics.

### Read APIs

Authenticated SQL RPCs validate `auth.uid()` against event ownership before returning any data. Base tables retain their revoked browser privileges. All operations reject free events. Readable event states include draft, published, cancelled, and derived ended; public discovery eligibility never controls owner history.

- `get_organizer_event_metrics(p_event_id uuid) -> jsonb`: safe event context, historical metrics, configured capacity, current tier remaining, tier breakdown, server admission eligibility.
- `list_organizer_event_orders(p_event_id uuid, p_search text, p_limit integer, p_cursor_created_at timestamptz, p_cursor_id uuid) -> jsonb`: event-specific substring search on name/email/order number, stable descending `(created_at,id)` cursor, default 25 and maximum 50 rows, maximum 320-character query, plus next cursor. Escape wildcard metacharacters. All canonical order statuses stay readable.
- `get_organizer_order(p_event_id uuid, p_order_id uuid) -> jsonb`: allowlisted buyer identity, financial status, original item snapshots, each issued ticket with canonical status and timestamps, and actionable eligibility. No credentials, hashes, confirmation bearers, or provider secrets/IDs.

Unknown or corrupt data fails explicitly. Presentation does not silently turn an amount due into an amount paid, or a created timestamp into a purchase timestamp. No order-wide ticket state overrides individual admissions.

### Manual admission

`redeem_owned_ticket(p_event_id uuid, p_ticket_id uuid) -> jsonb` is an authenticated owner adapter. It resolves the existing hash server-side, invokes `server_redeem_paid_ticket`, and returns safe result context. It performs no separate ticket UPDATE or eligibility implementation. QR remains on the same SQL authority. Wrong-event input never admits and never leaks foreign PII. The existing admission response may be additively enriched with safe owned-event buyer/tier/used-time fields, with strict transport tests updated to enforce that allowlist.

### Whole-order refund

`organizer-refund-order` accepts exactly eventId/orderId, verifies organizer identity and event/order ownership server-side, and invokes `createWholeOrderRefund` with `requested_by_customer`. No caller-selected amount, tier, ticket, provider ID, or refund-policy override. Reuse the existing Stripe dependency configuration and helper, including order-derived idempotency, destination reversal, and application-fee policy. Existing pending/completed requests are read/reconciled rather than represented as new refunds. Failed or unknown requests leave durable order/ticket state unchanged in the UI. Only a canonical backend read can display Refunded.

### Excluded paths

Resend, email delivery, and access-token recovery are removed from this build. No disabled resend promise is needed in the UI. Free events retain existing creation/edit/publish access but do not enter paid Organizer Operations and receive no invented RSVP counts or check-in flow. The original email/free-event audit explains future work only; neither blocks this approved scope.

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

## 6. Locked historical metric matrix

One tested server query boundary owns these formulas. React only validates/formats the projection. All aggregation uses one database snapshot time, integer USD minor units, independent order/item/ticket aggregates, and coherent source rows. Historical purchase success is the server-written non-null `orders.paid_at` marker established by successful fulfillment, not current order status or a browser redirect. Later refunds, financial review, disputes, cancellation, or event end do not erase that marker or historical performance. An incoherent order/item/ticket source set or impossible state produces an unavailable error rather than plausible partial totals.

Let `H` be event orders with a durable `paid_at` and coherent original purchase/item/ticket source snapshots. `paid` without the success marker, or unpaid lifecycle states with a success marker, are inconsistent and fail closed. A refund before successful fulfillment is coherent when it has its refund timestamp and no issued tickets; it contributes zero historical purchases, as shown below. A `requires_review`/legacy `partially_refunded` order contributes if it has prior successful purchase evidence; it does not contribute if payment was never successfully fulfilled. Review changes money/admission eligibility, not historical success.

```text
grossSalesMinor = SUM(H.subtotal_minor)              -- before refunds; not net proceeds
sold = SUM(H.quantity)                             -- includes later refunds/cancellations
orderCount = COUNT(H)                              -- one per successful order, not buyer/ticket
issued = COUNT(all coherent historically issued event tickets)
checkedIn = COUNT(those tickets WHERE status = used AND used_at IS NOT NULL)
capacity = SUM(quantity_total across all configured event tiers, including archived)

committed(tier) = SUM(item.quantity WHERE order.status IN
  (paid, payment_processing, requires_review, partially_refunded)
  OR (order.status IN (creating_checkout, checkout_open)
      AND order.reservation_expires_at > snapshot_time))
remaining(tier) = tier.quantity_total - committed(tier)
tierSold = SUM(item.quantity belonging to H for this tier)
tierGrossSalesMinor = SUM(item.subtotal_minor belonging to H for this tier)
```

No tiers means capacity is unavailable (`null`), not an invented capacity of zero. All configured tiers remain in the historical breakdown, with their current configuration name and original purchase-price subtotals; archived tiers remain labelled as such. Remaining is inventory, not a promise that an archived/cancelled/ended tier is on sale. A negative remaining or contradictory source set is an error. Historical sold can exceed configured capacity after refunds/resales; do not cap it or imply `sold + remaining = capacity`. State clearly that sales/sold totals include refunded purchases. Gross sales exclude tax and do not imply organizer take-home or payout availability.

| Current order state | Historical gross/sold/orders | Inventory commitment | Historical tickets / used |
| --- | --- | --- | --- |
| `creating_checkout`, `checkout_open`, unexpired hold | 0 | Item quantities | None; unexpected issuance is inconsistent |
| `creating_checkout`, `checkout_open`, expired hold | 0 | 0 | None |
| `payment_processing` | 0 | Item quantities | None |
| `payment_failed`, `expired`, unpaid `cancelled` | 0 | 0 | None |
| `paid` with successful fulfillment | Original subtotal / quantity / 1 | Item quantities | All issued / used count |
| `refunded` with prior successful fulfillment | Original subtotal / quantity / 1 | 0 | All issued, including refunded and preserved used |
| `refunded` before successful fulfillment | 0 | 0 | None; never synthesize issued admissions |
| `requires_review`, legacy `partially_refunded`, previously fulfilled | Original subtotal / quantity / 1 | Item quantities | Retain all issued and used history; no new admission |
| `requires_review`, legacy `partially_refunded`, never fulfilled | 0 | Item quantities | None |
| Pending/failed/cancelled refund attempt | Follow current order state and prior success | Follow current order state | No optimistic ticket transition |
| Cancelled event or ticket, successful order | Historical values unchanged | Follow order status, not ticket/event status | Retain issued and used history |
| Ended event | Historical values unchanged | Follow order status | Retain history; reject new admission |

Decision fixture: one order buys two GA at $20 and one VIP at $30. Initial metrics are $70 gross, 3 sold, 1 order, 0/3 checked in. Admit one GA then fully refund: metrics remain $70 gross, 3 sold, 1 order, and become 1/3 checked in. Tickets are `used/refunded/refunded`; the used timestamp remains fixed; all three inventory commitments release. A later successful resale increases historical gross/sold/orders and the issued denominator.

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

## 8. Implementation architecture

Preferred direction: additive organizer operations projections and narrow mutation adapters. Keep event/domain data and calculations server-side. Reuse existing React Query/API/schema conventions and existing session shell. Do not enable development fixture readers in production.

Alternatives considered: browser aggregation/direct table grants would expose excessive fields and create inconsistent metrics; a second ticket/refund subsystem would duplicate high-risk truth. Neither is acceptable under the locked request.

Read boundaries authenticate and scope the selected event before querying. Order detail additionally scopes the order to that event. Safe projections include operational PII only where needed. List queries use stable bounded pagination; max page size and query-length validation live server-side. Search failures retain the previous page with an explicit failure/retry state. Changing events cannot flash the previous event's PII.

Mutation boundaries return explicit success, pending/unknown, forbidden/unavailable, or failure. No optimistic money or admission status changes. Refetch metrics/order/tickets after authoritative completion. A timeout is unknown and must be reconciled rather than presented as a successful refund or admission.

Ended/cancelled events continue to use owner projections, never active public discovery queries. A disabled button is convenience; the server remains the admission authority. Public View event can explain unavailability for a historical event without compromising organizer history.

## 9. Execution authorization

All original product-contract blockers are resolved or removed from scope by the founder. Update and commit this spec and the sequential implementation plan, then execute Slice 1 and continue through the remaining active slices with RED → GREEN and scoped commits. Stop only for a newly discovered true product/contract blocker. Keep scanner baseline failures visible and preserve their meaningful assertions. No production deployment is authorized.

The plan is `../plans/2026-09-10-organizer-operations-v1-implementation.md`.

## 10. Implemented refund reconciliation boundary

The organizer endpoint uses the existing whole-order helper and its stable order idempotency key. Stripe Refund responses do not carry `livemode`; the adapter establishes test mode from the matching Charge and verifies its payment, amount, and currency before adapting the response for the existing helper. No helper policy or canonical writer is changed.

The one repairable state is a previously fulfilled order in `requires_review` with `REFUND_POLICY_MISMATCH` and exactly one succeeded, unverified refund carrying that same failure. Its service-only context supplies durable economic snapshots. The browser receives only `refundState: recoverable`, never provider IDs. “Retry refund confirmation” validates the existing refund, transfer reversal, and application-fee refund using the existing recovery validator, then fills missing matching metadata. It cannot create a refund or directly mutate ticket/order truth. The existing signed `refund.updated` webhook remains the completion authority. Contradictory evidence and unrelated review states fail closed.

The dialog reconciles canonical detail after both request success and ambiguous request failure. A later canonical refund overrides an earlier timeout and removes the refund action. Pending acknowledgments never display Refunded. [Stripe documents metadata changes as `refund.updated` events](https://docs.stripe.com/refunds?dashboard-or-api=api).

Implementation and verification evidence: `../../testing/organizer-operations-v1-verification.md`. Local verification is separate from real Stripe delivery, physical-camera proof, and production readiness.

## Implemented presentation finish — 2026-09-10

The subsequent founder finish request preserves this contract and locks the displayed result labels to **ADMITTED**, **ALREADY SCANNED**, **TICKET REFUNDED**, and **TICKET CANCELLED**. Orders expose canonical tier summaries alongside quantity. Supported Supabase artwork uses the image allowlist with a neutral fallback; no upload/moderation contract is added. A result received as admission closes remains visible only for its owner/event, with dashboard access instead of another scan.

See [the finish verification report](../../testing/organizer-operations-v1-finish.md) for the complete screen comparison, four viewport sizes, actual-decoder local QR proof, current tests, intentional differences, and outstanding hardware/provider release checks.
