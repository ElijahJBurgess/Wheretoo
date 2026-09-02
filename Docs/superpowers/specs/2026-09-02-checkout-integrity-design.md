# Whereto Checkout Integrity 1.0 Design

**Status:** APPROVED Phase 1 design; ready for implementation planning; not implemented

**Date:** 2026-09-02

**Milestone:** One buyer -> one bounded multi-tier cart -> one order -> one order item per distinct tier -> one Stripe Checkout payment -> one ticket per purchased admission -> exact reconciliation and whole-order refund safety

## 1. Source of truth and process

This specification is governed, in order, by:

1. `AGENTS.md`;
2. `Docs/WHERETO_V1_PRODUCT_DEFINITION.md`;
3. `Docs/WHERETO_V1_USER_FLOWS.md`;
4. `Docs/WHERETO_V1_TECHNICAL_ARCHITECTURE.md`;
5. `Docs/superpowers/specs/2026-08-25-native-ticketing-payments-design.md`;
6. `Docs/superpowers/specs/2026-08-26-moderation-public-eligibility-design.md`;
7. the effective schema and implementation on `main` at the start of Checkout Integrity 1.0;
8. the Checkout Integrity Phase 0 forensic audit; and
9. the owner-approved Phase 1 decisions recorded on 2026-09-01 and 2026-09-02.

This document supersedes the Day 2 design only where that design assumes exactly one tier, quantity one, one order item, one Stripe line item, or one ticket per order. It preserves the existing hosted Checkout, destination-charge, verified-webhook, private-table, moderation/public-eligibility, and reconciliation architecture unless this specification explicitly changes it.

The design was produced through `superpowers:brainstorming`, with owner approval after each section. Stripe-specific decisions were checked against the installed official Stripe guidance for hosted Checkout, destination charges, webhook fulfillment, dynamic payment methods, and refund behavior. No Stripe API call, Stripe object mutation, product-code edit, migration, or test change was performed during brainstorming.

This is a formal design specification, not an implementation plan. Task breakdown, exact migration names, operational tuning, and code sequencing beyond the architectural rollout gates remain for a separately approved planning phase.

## 2. Goal

Checkout Integrity 1.0 must safely support this transaction:

> A buyer purchases two General Admission tickets and one VIP ticket in one hosted Checkout, producing one order, two order-item rows, three independently identifiable ticket rows, exact per-tier inventory consumption, one destination charge, one application fee, and retry-safe webhook fulfillment.

The system must preserve the existing guarantees that:

- browser input is never authoritative for money, inventory, payment success, or fulfillment;
- Stripe-hosted Checkout remains the payment surface;
- a verified webhook and authoritative Stripe retrieval are required for payment-state transitions;
- one order routes to exactly one organizer destination;
- all monetary values use integer minor units;
- payment retries cannot create duplicate orders, charges, or tickets;
- inventory cannot be oversold by concurrent checkouts;
- private payment, buyer, and reconciliation records remain inaccessible to browser roles; and
- abnormal financial states fail closed and remain auditable.

## 3. Locked owner decisions

The following decisions are final for this milestone:

1. An order may contain at most ten tickets in total.
2. A buyer may purchase multiple ticket tiers in one order.
3. The canonical model is one order item per distinct tier with quantity `N`.
4. Stripe receives one line item per canonical order item.
5. Fulfillment creates one individual ticket row per purchased unit.
6. Fixed platform fees remain per ticket for Checkout Integrity 1.0.
7. Fee calculation remains centralized so a future version can adopt different semantics without redesigning carts, order items, or fulfillment.
8. No speculative fee-basis or per-order-fee schema is added now. A future fee-policy change must introduce explicitly versioned semantics.
9. Automatic refunds are whole-order only.
10. Approved automatic refunds use `reverse_transfer = true` and `refund_application_fee = true`.
11. Stripe processing-fee economics remain separate from the refund-policy decision.
12. Unexpected partial refunds route to `requires_review`; the system must not automatically allocate refunded money to tiers or tickets.
13. Order confirmation shows purchased tier labels and quantities, not internal ticket identities.
14. Individual ticket identities must exist in the database for future secure QR/check-in.
15. Organizer analytics and dashboard work are out of scope, but the data must support correct future order, ticket, tier, revenue, and refund metrics.
16. Reservation expiration must be automated and may not be assumed to work merely because an expiry function exists.
17. New checkout traffic uses only the new cart contract after cutover.
18. Whereto has no real customer orders or open production Checkout Sessions requiring a broad V1/V2 compatibility layer.

## 4. Scope and non-goals

### 4.1 In scope

- A strict multi-tier cart/API contract.
- Aggregate quantity enforcement with a maximum of ten.
- Multiple canonical order items per order.
- Per-tier atomic inventory reservation and release.
- Reliable automated reservation cleanup.
- Centralized order-level money calculation with current per-ticket fixed fees.
- One Stripe line per order item and exact reconciliation.
- One ticket per admission with all-or-nothing fulfillment.
- Browser, Stripe, webhook, database, cancellation, and refund idempotency.
- Whole-order unpaid cancellation and whole-order post-payment refunds.
- Exceptional partial-refund review handling.
- Multi-item confirmation presentation without ticket-ID disclosure.
- Internal integrity observability and reconciliation queries.
- Deterministic tests plus a bounded real Stripe test-mode release proof.
- Clean forward rollout, a checkout-creation kill switch, and forward-fix rollback.

### 4.2 Out of scope

- Persistent server-side shopping carts.
- Cross-event carts.
- Multi-organizer or multi-destination orders.
- More than ten tickets per order.
- Discounts, coupons, promotions, gift cards, credits, optional Stripe items, shipping, or tax enablement.
- Automatic ticket-level, item-level, or quantity-level refunds.
- A customer or organizer partial-refund workflow.
- Organizer analytics or dashboard UI.
- QR credential generation, wallet passes, check-in, ticket transfer, ticket resale, or attendee assignment.
- A broad permanent V1/V2 checkout compatibility layer.
- Unrelated Stripe Connect onboarding or account-model redesign.
- Map/discovery work except preserving existing event-eligibility boundaries.
- Live-mode payment proof during development.

## 5. Selected architecture and alternatives

### 5.1 Selected model

```text
one event
  └─ one order
      ├─ one order_item for each distinct purchased tier
      │   └─ quantity N produces N individual ticket rows
      └─ zero or more refund audit rows

one Whereto order
  └─ one Stripe Checkout Session
      └─ one Stripe line item for each Whereto order_item
          └─ one destination-charge PaymentIntent for the order total
```

An example cart of two GA and one VIP produces:

- one order;
- two order items: GA quantity two and VIP quantity one;
- two Stripe line items with those quantities;
- one payment and destination charge;
- three ticket rows after verified fulfillment; and
- one customer confirmation listing GA x2 and VIP x1.

### 5.2 Rejected alternatives

**One Checkout per tier** was rejected because it splits one buyer intent into multiple orders and payments, complicates fees, cancellation, confirmation, and refund behavior, and can leave the buyer with only part of the desired purchase.

**One order item per ticket unit** was rejected because it duplicates identical tier and price snapshots, bloats Stripe line items, and makes the line item the admission identity rather than the purchased tier grouping.

**One synthetic Stripe line for the entire cart** was rejected because it prevents exact tier-level reconciliation and produces a poor hosted Checkout summary.

**A persistent cart subsystem** was rejected because a bounded immutable checkout request is sufficient. Browser retry state does not justify server-side mutable cart infrastructure.

**Automatic partial-refund allocation** was rejected because Stripe refunds operate against the order charge while the milestone has no approved policy for assigning partial money to tier units. Guessing would create money, inventory, and admission ambiguity.

## 6. End-to-end lifecycle

1. The buyer selects quantities from one event. The browser enforces an immediate ten-ticket total limit for usability.
2. On first submission, the browser creates an independent random `clientRequestId` and a 256-bit random confirmation bearer, stores them in tab-scoped session storage for that submitted cart, and reuses them across refreshes and ambiguous retries.
3. The browser sends the exact cart body and the confirmation bearer over HTTPS. No authoritative monetary value is supplied by the browser.
4. The checkout server validates the request and bearer, hashes the bearer, and invokes the service-only reservation boundary.
5. The database acquires the event lock, locks requested tiers in stable order, revalidates all eligibility and Connect gates, expires eligible stale reservations, calculates current availability, calculates authoritative money, and inserts one order plus all canonical order items atomically.
6. The checkout server creates or safely resumes one Stripe-hosted Checkout Session using only persisted snapshots and one Stripe idempotency key derived from the order.
7. Each Whereto order item becomes one Stripe line item with the same unit amount, quantity, currency, and customer-facing tier label.
8. The Checkout Session creates one destination-charge PaymentIntent with the exact persisted order total, application fee, and organizer destination.
9. The browser redirect is not fulfillment evidence. The confirmation route shows processing until persisted webhook state proves a terminal result.
10. The webhook endpoint verifies the raw-body signature, records/deduplicates the Stripe event, retrieves authoritative Stripe objects, and reconciles every order and line invariant.
11. Paid reconciliation invokes one atomic fulfillment transaction. It locks the entire order tier set, rechecks inventory and validity, creates one ticket per unit, and commits the paid order, Stripe identifiers, tickets, and receipt result together.
12. Confirmation reads token-scoped persisted truth and lists purchased tiers and quantities without exposing ticket UUIDs.
13. Cancellation, expiration, refund, and exceptional review paths operate on the entire order while preserving item and ticket audit history.

## 7. Cart and API contract

### 7.1 Request body

The new checkout endpoint accepts exactly:

```ts
type CreateCheckoutRequest = {
  eventId: string;
  buyerName: string;
  buyerEmail: string;
  clientRequestId: string;
  items: Array<{
    tierId: string;
    quantity: number;
  }>;
};
```

The JSON body must contain no additional top-level or item fields. In particular, it must not accept client prices, subtotals, totals, fees, currency overrides, availability, Stripe identifiers, destination accounts, fulfillment state, refund amounts, or ticket identities.

### 7.2 Confirmation bearer transport

The confirmation bearer is not part of the JSON cart shape. The browser generates 32 cryptographically random bytes with Web Crypto, encodes them as a canonical URL-safe value, and sends that value in the `X-Whereto-Confirmation-Bearer` request header over HTTPS. The checkout endpoint's exact CORS policy must allow that header only for the approved application origin.

The browser stores the bearer and `clientRequestId` together in `sessionStorage`. This state:

- survives ordinary refreshes in the same tab;
- is reused for the same submitted cart after an ambiguous network result;
- is replaced when the buyer materially edits and resubmits the cart;
- is cleared after a confirmed terminal flow when it is no longer needed; and
- is not a persistent server-side cart.

The server validates the bearer format, stores only its cryptographic hash, and redacts the clear value from logs and errors. The bearer must be independently random and must not be a hash, encoding, or deterministic derivation of `clientRequestId`.

If the browser loses the clear bearer, the server cannot recover it from its hash. The client must not weaken the credential boundary to recover a lost local secret.

### 7.3 Validation and canonicalization

The server must:

- require an item array with between one and ten entries;
- require each quantity to be an integer from one through ten;
- require total quantity across all entries to be from one through ten;
- reject duplicate tier IDs rather than silently merging them;
- require every tier to belong to the supplied event;
- require every tier and the event to satisfy current sellability rules;
- normalize buyer fields according to existing server rules;
- sort items by tier ID before locking, hashing, persistence, and Stripe construction; and
- preserve the existing separate limit on the number of tier types an organizer may configure for one event.

Reordering identical tier/quantity entries does not create a different canonical cart. Changing the event, buyer identity, tier set, or any quantity does.

### 7.4 Response and confirmation shape

Checkout creation returns only what the browser needs to enter the validated Stripe-hosted flow, including the Checkout URL and the safe order reference required by the existing route architecture.

The token-scoped confirmation projection returns:

- order number and lifecycle status;
- purchased tier label;
- quantity per tier;
- unit amount and line subtotal;
- aggregate quantity, subtotal, tax, and total; and
- safe processing, paid, cancelled, expired, refunded, or review presentation.

It must not return individual ticket UUIDs, unit sequences, order-item IDs, private buyer fields beyond the approved confirmation need, internal Stripe IDs, hidden reconciliation data, or credentials intended for a future QR system.

### 7.5 Immutable submission

There is no mutable submitted cart. After checkout creation begins, changes require a new random request ID and confirmation bearer. The old order follows its normal payment, cancellation, or expiry lifecycle.

## 8. Database cardinality and constraints

### 8.1 `orders`

`orders` remains the payment, refund, and aggregate accounting boundary. It retains:

- one event and organizer;
- one environment/mode;
- lifecycle and expiry timestamps;
- buyer identity;
- one client request identity and confirmation hash;
- aggregate quantity;
- currency, subtotal, tax, total, fee, and expected-proceeds snapshots;
- destination and Stripe object identifiers; and
- reconciliation state and safe failure code.

The order quantity constraint becomes `1..10`.

No fee-basis or speculative per-order-fee field is added. Existing fee-rule fields continue to mean the Checkout Integrity V1 per-ticket formula. A future formula change requires explicit versioned semantics at that time.

### 8.2 `order_items`

Each order contains one or more immutable item snapshots. Each item records:

- order ID;
- ticket tier ID and version;
- purchase-time tier label and description;
- purchase-time unit amount;
- quantity;
- line subtotal;
- currency; and
- creation timestamp.

Replace `UNIQUE(order_id)` with:

```text
UNIQUE(order_id, ticket_tier_id)
```

Each item quantity must be `1..10`, and:

```text
subtotal_minor = unit_amount_minor * quantity
```

Purchase snapshots must not be rewritten after order creation.

### 8.3 Cross-row order integrity

Before the reservation transaction commits, PostgreSQL must prove:

- the order has at least one item;
- every item tier belongs to the order event and organizer;
- every tier appears once;
- all item currencies equal the order currency;
- `orders.quantity = SUM(order_items.quantity)`;
- `orders.subtotal_minor = SUM(order_items.subtotal_minor)`;
- total quantity is between one and ten; and
- order totals and fee snapshots match the authoritative calculation result.

Use the simplest reliable PostgreSQL mechanism consistent with the existing private, service-owned transaction architecture. The expected minimum is focused checks inside the sole reservation function plus ordinary table constraints and revoked direct browser writes. Add a narrowly scoped trigger only where the function and existing privilege boundary cannot reliably preserve an invariant. Do not create a generalized deferred-validation framework for this milestone.

### 8.4 `tickets`

Each fulfilled admission remains an individual row with:

- order, order-item, event, organizer, and tier references;
- an item-local `unit_sequence`;
- validity status; and
- issuance, cancellation, and refund timestamps.

Preserve:

```text
UNIQUE(order_item_id, unit_sequence)
```

For an item of quantity `N`, sequences must be exactly `1..N`. Duplicated ticket references must agree with the parent item and order. The service-only fulfillment function is responsible for proving the exact set atomically.

Ticket UUIDs remain internal identities, not secure admission credentials. QR/check-in can later add a separate opaque credential without altering order, item, payment, or refund identity.

### 8.5 Refund and webhook records

Refunds remain separate immutable provider-event records linked to one order. Webhook receipts remain keyed by Stripe event ID and retain only the safe envelope, digest, processing status, attempt metadata, and safe error code.

### 8.6 Future metrics correctness

No analytics UI or aggregate table is added. The normalized data supports future metrics as follows:

- order count from `orders`;
- ticket count from valid order quantities or individual ticket rows;
- tier mix and tier revenue from `order_items`;
- gross and fee metrics from immutable order money snapshots; and
- refund metrics from `refunds` joined to orders.

Metrics code must never assume order count equals ticket count.

## 9. Reservation, locking, and expiration

### 9.1 Lock hierarchy

All inventory-sensitive operations for an event use the existing lock family in this order:

1. per-event advisory transaction lock;
2. affected ticket-tier rows in ascending tier-ID order;
3. event row;
4. order and order-item rows as applicable.

This applies to:

- checkout reservation;
- paid-tier inventory edits;
- explicit checkout cancellation;
- Checkout-expired handling;
- payment fulfillment and failure;
- reservation cleanup; and
- moderation/public-eligibility operations that share the existing event ticketing boundary.

The event lock deliberately serializes same-event checkouts, including checkouts for different tiers. That is the smallest safe extension of the established model.

### 9.2 Atomic reservation

While the lock set is held, the reservation function must:

1. validate and canonicalize the cart;
2. lock and verify every requested tier;
3. revalidate event eligibility, timing, paid status, Connect readiness, and fee availability;
4. lazily advance eligible stale reservations for the event;
5. calculate committed quantity independently for every requested tier;
6. reject the full cart if any tier lacks capacity;
7. calculate authoritative item and order money; and
8. insert the order and all items in one transaction.

There is no partial reservation. Failure for one tier commits nothing for all tiers.

### 9.3 Committed quantity

For a tier, committed quantity includes:

- `paid` orders;
- `payment_processing` orders;
- `requires_review` orders;
- unresolved historical `partially_refunded` orders; and
- `creating_checkout` or `checkout_open` orders whose reservation timestamp remains in the future.

An unfinished reservation whose `reservation_expires_at` is not in the future does not hold inventory, even if its status cleanup has not yet run.

The reservation succeeds only when each tier satisfies:

```text
requested_quantity <= quantity_total - committed_quantity
```

### 9.4 Expiration and automated cleanup

Stripe Checkout retains its configured expiry. The database reservation retains the existing short grace interval beyond Checkout expiry so a valid boundary-time provider event can reconcile safely.

Checkout Integrity 1.0 must install and verify automated invocation of the reservation-expiry boundary. The architecture requires:

- expired timestamps stop holding inventory;
- cleanup is automated;
- cleanup is idempotent;
- cleanup changes only eligible `creating_checkout` and `checkout_open` orders;
- cleanup cannot release paid, processing, refund-pending, partially refunded, or review inventory;
- cleanup shares the event-ticketing concurrency boundary;
- explicit Stripe expiry and cancellation remain immediate release paths; and
- lazy expiry during a new reservation remains a backup path.

Scheduler cadence, batch size, lock-skipping strategy, and alert thresholds are operational tuning decisions for the implementation plan unless correctness testing shows a value must be fixed.

If Checkout creation definitively fails after reservation, the server attempts immediate safe cancellation. If the process crashes or the external outcome is uncertain, the reservation remains protected until retry, reconciliation, or expiry proves it releasable.

## 10. Money calculation

### 10.1 Authority and units

All authoritative monetary values are calculated server-side in integer minor units. Browser values are presentation only.

While tier rows are locked:

```text
item_subtotal = unit_amount_minor * item_quantity
order_quantity = SUM(item_quantity)
order_subtotal = SUM(item_subtotal)
tax_amount = 0
order_total = order_subtotal
```

### 10.2 Central Checkout Integrity V1 calculator

One authoritative server-side calculation boundary consumes aggregate subtotal, aggregate quantity, and the selected fee-rule snapshot.

The current product fee remains:

```text
platform_product_fee =
  floor(order_subtotal * platform_percent_bps / 10,000)
  + platform_fixed_minor * order_quantity
```

For `platform_fee_only`:

```text
stripe_fee_estimate = 0
```

For an existing `stripe_fee_estimate` rule, preserve its current aggregate percentage and per-ticket fixed semantics:

```text
stripe_fee_estimate =
  floor(order_subtotal * processing_percent_bps / 10,000)
  + processing_fixed_minor * order_quantity
```

Then:

```text
application_fee = platform_product_fee + stripe_fee_estimate
expected_organizer_proceeds = order_subtotal - application_fee
```

Percentage components are rounded once against the aggregate order subtotal. They are not separately rounded per order item.

### 10.3 Required checks

- Use exact integer/numeric arithmetic, never binary floating point.
- Detect and reject values outside database or Stripe-supported bounds.
- Require one supported currency across all items.
- Require nonnegative derived fees.
- Require application fee to be strictly less than order subtotal.
- Persist fee-rule identity and all fee inputs on the order.
- Persist every item unit amount and line subtotal.
- Construct Checkout from stored outputs; do not recalculate in the Edge Function.
- Render confirmation and reconcile webhooks from stored snapshots.
- Never reinterpret an old order through the current fee rule.

Database arithmetic constraints defend persisted identities, but they do not create a second operational fee calculator.

## 11. Stripe mapping and reconciliation

### 11.1 Checkout Session

Create one Stripe-hosted Checkout Session for the order with:

- `mode = payment`;
- one line item per Whereto order item;
- each line's purchase-time tier label, unit amount, quantity, and currency;
- the persisted buyer email according to the existing privacy boundary;
- the persisted Checkout expiry;
- exact success and cancellation URLs;
- `client_reference_id` bound to the order;
- the existing integration identifier convention;
- automatic tax disabled;
- no discounts, promotions, shipping, or optional items; and
- no explicit `payment_method_types`, preserving Stripe-configured dynamic methods.

Customer-facing Stripe product text uses tier labels and optional approved descriptions. It must not expose ticket UUIDs, order-item IDs, reconciliation labels, or other technical identifiers.

### 11.2 Destination charge

The Checkout Session's PaymentIntent must use:

```text
amount                  = persisted order total
currency                = persisted order currency
application_fee_amount  = persisted application fee
transfer_data.destination = persisted organizer Stripe account
```

The order metadata and `client_reference_id` locate the candidate order. Metadata contains only opaque Whereto identifiers and contract information necessary for reconciliation; it contains no buyer PII, serialized cart, ticket identity, or fee arithmetic.

### 11.3 Deterministic line binding

Every Stripe line item must map deterministically to exactly one Whereto order item through a stable internal identifier.

The implementation plan must verify the cleanest supported Stripe API location for carrying or resolving this binding. The architecture does not preselect Stripe product metadata, line metadata, Price metadata, or positional storage before confirming the actual API shape.

The chosen mechanism must satisfy all of these conditions:

- stable across Session creation, retrieval, and webhook reconciliation;
- available through supported Stripe retrieval/expansion;
- unambiguous when two tiers have identical names and prices;
- non-customer-facing;
- exact one-to-one cardinality; and
- testable in a real Stripe test-mode Checkout.

Lines must never be matched by array position, display name, unit price, or a combination of presentation fields alone.

### 11.4 Authoritative reconciliation

Webhook metadata is a locator, not proof. Before fulfillment, the handler retrieves current Stripe state as needed and proves:

- signature validity;
- environment/mode agreement;
- Session-to-order binding;
- expected Session mode, status, and payment status;
- exact order and event references;
- exact Session currency, subtotal, and total;
- exact PaymentIntent amount and currency;
- exact destination account;
- exact application fee;
- exact Stripe line count;
- one unique stable mapping for each database order item;
- no missing, extra, or duplicate line mapping;
- exact per-item tier binding, unit amount, quantity, currency, and subtotal;
- summed line values equal Session and order totals; and
- PaymentIntent, charge, transfer, application-fee, balance-transaction, and other unique provider IDs are not bound to another order.

Any mismatch fails closed, issues no tickets, records a safe reason, and moves the order/reconciliation state to `requires_review` where domain state exists to update safely.

### 11.5 Webhook authority

- Fulfillment occurs from verified webhook processing, never the success page.
- `checkout.session.completed` may fulfill only when the current Session is paid.
- Completed but unpaid Sessions move to `payment_processing`.
- `checkout.session.async_payment_succeeded` may fulfill after full current-state reconciliation.
- `checkout.session.async_payment_failed` records failure without fulfillment.
- Out-of-order events retrieve current Stripe truth and apply monotonic transitions.

## 12. Fulfillment and ticket generation

### 12.1 Atomic fulfillment

Paid fulfillment is one PostgreSQL transaction. It:

1. acquires the event advisory lock;
2. locks all order tiers in ascending ID order;
3. locks the event, order, and item set;
4. revalidates the immutable payment and item snapshot;
5. rechecks every tier's committed inventory;
6. proves the order remains eligible for automatic fulfillment;
7. creates the complete ticket set;
8. verifies the complete set;
9. persists Stripe identifiers and paid/reconciled state; and
10. completes the webhook receipt.

All changes commit together. A failure rolls back the order transition, tickets, and receipt completion so a retry can safely resume.

### 12.2 Ticket generation

For each item of quantity `N`, generate sequences `1..N` and one ticket per sequence. Each ticket receives server-generated identity and issuance time plus coherent order, item, event, organizer, and tier references.

After generation, prove:

- ticket count per item equals item quantity;
- total ticket count equals order quantity;
- sequences are complete and unique;
- references are coherent; and
- every newly issued ticket is `valid`.

### 12.3 Abnormal fulfillment

Fulfillment is all-or-nothing across tiers. If one tier is invalid, oversold, or inconsistent, no subset of tickets is issued.

A verified payment received after terminal cancellation, failure, expiry, or another applicable invalidation does not silently revive the order. The handler preserves payment identifiers and moves the order to `requires_review` without issuing admissions.

An unexpected pre-existing partial or mismatched ticket set is not repaired opportunistically. It moves the order to `requires_review`.

For an already fulfilled order, a valid retry verifies the complete expected ticket set and returns the existing result without generating new ticket identities or rewriting issuance timestamps.

## 13. Idempotency and retry behavior

### 13.1 Browser request identity

`clientRequestId` identifies one immutable submitted cart. The browser reuses the same value across ordinary refreshes, explicit retries, and ambiguous network failures for that submission.

A canonical request digest binds:

- event;
- normalized buyer identity;
- sorted tier IDs and quantities;
- confirmation-bearer hash;
- immutable item snapshots;
- monetary outputs;
- destination;
- Checkout URLs and expiry; and
- Stripe contract identity.

Behavior:

- same request ID and same canonical submission -> same order/result;
- same request ID and reordered equivalent items -> same order/result;
- same request ID with any material difference -> idempotency conflict;
- materially edited cart -> new request ID and bearer.

### 13.2 Existing-order retry outcomes

- Unexpired `creating_checkout` or `checkout_open`: safely resume the same Checkout creation or return the validated Session.
- `payment_processing` or `paid`: do not create a new Session; return the existing confirmation state.
- `expired`, `cancelled`, or `payment_failed`: return the terminal state; a new purchase uses a new request ID.
- `requires_review`: fail closed with safe review presentation.

### 13.3 Stripe request identity

Use one order-derived Checkout Integrity V1 Stripe idempotency key. Every retry reconstructs byte-equivalent semantic parameters from persisted purchase-time snapshots, not current tier, fee, or destination configuration.

- Attached Session: retrieve and validate that exact object.
- Unknown external outcome: keep the reservation and retry with the same key.
- Definitive noncreation: cancel the reservation idempotently.
- Conflicting returned Session: do not expose it or create another.
- Confirmed harmless conflicting Session: expire it before release.
- Unconfirmed conflict: retain inventory and require review.
- Same Session attachment: no-op.
- Different Session attachment: fail closed.

Inventory must never be released while a payable Session might still exist.

### 13.4 Webhook and fulfillment identity

Stripe event ID remains the delivery key. Duplicate delivery with identical immutable envelope/digest is a retry; reuse with conflicting data is a security error.

Unique Stripe object IDs, the order lock, and `(order_item_id, unit_sequence)` provide independent secondary boundaries. Concurrent event types for one order serialize, retrieve current provider state, and apply monotonic transitions.

Transient dependency failures remain retryable. Successfully completed receipts are not processed again. A permanent mismatch is safely recorded and routed to review.

## 14. Cancellation and refund behavior

### 14.1 Whole-order unpaid cancellation

Cancellation applies only before payment and always targets the full order.

An explicit buyer cancellation requires the valid confirmation bearer. For an attached Session, the server must:

1. retrieve and validate the exact Session;
2. prove it is open and unpaid;
3. ask Stripe to expire it;
4. prove it is no longer payable; and
5. atomically mark the order cancelled and release all item quantities.

Repeated cancellation is idempotent. A paid, completed, or processing Session cannot be cancelled or released. An ambiguous Stripe result keeps the inventory protected until reconciliation or expiry resolves it. Browser close/navigation is not cancellation.

### 14.2 Approved automatic whole-order refund

The trusted refund boundary accepts an order identity and approved reason. It does not accept a caller-selected amount, tier, quantity, or ticket.

Preconditions include:

- reconciled successful payment;
- known charge and destination objects;
- no partial, conflicting, or active refund requiring review;
- exact target equal to persisted order total; and
- eligibility for the approved automatic-refund path.

Create the refund against the verified charge with:

```text
amount                 = order.total_minor
reverse_transfer       = true
refund_application_fee = true
```

Use an order-derived refund idempotency key and explicit refund-policy metadata. Stripe processing fees remain a separate platform accounting and reconciliation concern.

Provider truth controls the result:

- pending/requires action -> persist state, retain inventory, do not mark tickets refunded;
- succeeded for the exact whole order -> atomically mark order and every ticket refunded and release every tier quantity;
- failed/cancelled with no money returned -> preserve paid order and valid tickets while retaining audit history;
- ambiguous or inconsistent -> `requires_review`.

A retry must resolve the existing refund rather than create a second full refund.

### 14.3 Unexpected partial refunds

Any verified successful amount below the order total is exceptional. The system must:

- persist exact refund evidence;
- set order and reconciliation state to `requires_review`;
- use a safe partial-refund reason code;
- conservatively invalidate the complete ticket set from automatic admission;
- keep all associated quantity committed;
- avoid tier, ticket, quantity, and fee proration; and
- avoid automatically refunding the remainder.

Partial-refund ticket invalidation is an exceptional safety state requiring manual resolution, not normal refund behavior.

If multiple external refunds later equal the exact full order amount, the order may become `refunded` only after proving the customer refund, destination reversal, and application-fee unwind are all complete and conflict-free. Otherwise it remains under review.

The legacy `partially_refunded` value may be retained for historical/development data, but Checkout Integrity does not create it as a normal automatic outcome. Such rows hold inventory and remain review-required.

## 15. Compatibility and cleanup of single-ticket paths

Whereto has no real customers, production paid orders, or open customer Checkout Sessions at this cutover. Therefore:

- do not build a permanent V1/V2 customer compatibility layer;
- use a clean forward migration to the cart model;
- accept only the new cart contract for new traffic after cutover;
- generalize shared order, reconciliation, confirmation, and fulfillment code so quantity-one single-item rows remain naturally valid;
- remove obsolete singular request parsers, RPCs, `items[0]` assumptions, singular tier snapshots, hard-coded quantity one, and hard-coded sequence one paths;
- do not retain a second single-ticket fulfillment implementation; and
- remove any temporary callable overlap after deployment ordering no longer requires it.

Existing disposable development/test fixtures may be retained if they already satisfy the generalized model or recreated if that is safer. Preserving disposable fixtures must not complicate the architecture or deployment.

Real financial records and real Stripe objects, if discovered during preflight despite the current assumption, are protected and become a stop condition for destructive cleanup or incompatible cutover.

## 16. Rollout and rollback

### 16.1 Preflight

Before enabling new checkout traffic:

- verify environment and Stripe mode;
- verify the absence of real customer/open production objects assumed by this design;
- inventory current development order states;
- confirm retained rows satisfy new invariants or authorize fixture recreation;
- take the normal database recovery checkpoint;
- confirm automated cleanup can be installed and observed; and
- keep checkout creation disabled.

### 16.2 Ordered deployment

1. **Database expansion:** apply a new forward-only migration; never rewrite applied history. Change item uniqueness, quantity checks, transaction functions, confirmation projection, and automated cleanup. Retain only temporary overlap needed for deployment safety.
2. **Webhook and fulfillment:** deploy generalized multi-item reconciliation and ticket generation before allowing new carts.
3. **Checkout server:** deploy strict cart parsing, random-bearer handling, canonical digesting, and multi-line Stripe construction.
4. **Browser:** deploy multi-tier quantities, the ten-ticket limit, scoped retry state, and multi-item confirmation.
5. **Test-mode smoke:** prove reservation, hosted Checkout, payment, line reconciliation, destination fee, fulfillment, confirmation, expiration/cancellation, refund, and cleanup.
6. **Cutover:** enable new checkout creation only after all readiness checks pass.
7. **Contract cleanup:** remove obsolete single-ticket runtime paths and prove no references remain.

The server-side kill switch controls only new Checkout creation. It must not disable webhooks, reconciliation, fulfillment of already-valid paid Sessions, cancellation, expiry, refunds, or cleanup.

### 16.3 Rollback

Before any cart order exists, application deployments may roll back while additive database support remains.

After any multi-item order or Stripe Session exists:

- do not restore `UNIQUE(order_id)`;
- do not deploy singular webhook or fulfillment code;
- disable only new checkout creation;
- continue lifecycle processing for existing objects;
- correct defects through a new forward-only migration or release; and
- resume traffic only after affected gates pass.

Rollback never deletes, merges, or collapses real orders, items, tickets, refunds, or Stripe identifiers. Once multi-item data exists, the safe rollback strategy is stop-new-sales and fix forward.

## 17. Observability and operational integrity

### 17.1 Structured events

Use existing durable domain records plus sanitized structured server logs. Correlate operations with internal order/event identity and, when applicable, Checkout Session, Stripe event, and refund identity.

Record:

- operation and safe outcome;
- prior/resulting lifecycle state;
- contract version;
- item count and aggregate quantity;
- currency and integer totals;
- retry/delivery attempt;
- duration; and
- specific safe error code.

Never log buyer name/email, confirmation bearer, credentials, authorization headers, raw IP, raw webhook body, payment details, or arbitrary provider error content.

### 17.2 Required signals

Checkout and reservation signals include request validation, idempotent reuse/conflict, reservation outcome, sold-out rejection, Session creation/reuse/attachment, uncertain external outcomes, and kill-switch rejection.

Cleanup signals must show whether cleanup runs, how much eligible work it advances, whether stale eligible rows remain, oldest eligible age, errors, lock contention, and whether lazy expiry is compensating excessively.

Webhook/reconciliation signals include signature failures, duplicate deliveries, delivery lag, transient retries, permanent mismatches, object reuse, processing/paid/refunded/review transitions, and mismatch category.

Fulfillment signals compare expected items and ticket quantity with actual committed tickets and distinguish new work from idempotent retry.

Refund/cancellation signals cover safe cancellation, blocked/ambiguous cancellation, refund lifecycle, destination reversal, application-fee unwind, separate processing-fee economics, partial refunds, and unresolved review.

### 17.3 Safe mismatch codes

At minimum, distinguish:

- Session/order binding;
- line count;
- missing, duplicate, or unknown item binding;
- tier/quantity/unit amount/currency/line subtotal;
- order subtotal/total;
- destination;
- application fee;
- provider-object reuse;
- invalid lifecycle transition;
- ticket-set mismatch;
- partial refund; and
- incomplete refund economics.

Codes contain no hidden provider response or PII.

### 17.4 Read-only integrity checks

Provide internal verification that detects:

- order/item quantity or subtotal disagreement;
- duplicate tier within an order;
- mixed event, organizer, or currency;
- paid order with incomplete tickets;
- incoherent ticket references or sequences;
- stale cleanup-eligible reservations;
- review inventory omitted from committed counts;
- fully refunded order with non-refunded tickets;
- partial refund not held for review;
- Stripe object reused across orders;
- stuck retryable webhook receipt; and
- unresolved `requires_review` orders.

These are operational tools, not organizer analytics. Provider selection, exact thresholds, scheduler cadence, and retention tuning belong in implementation planning.

## 18. Testing strategy

### 18.1 Release-severity policy

Release-blocking proof prioritizes:

1. money correctness;
2. inventory integrity and concurrency;
3. browser/Stripe/webhook/database idempotency;
4. all-or-nothing ticket fulfillment;
5. cancellation and refund correctness;
6. RLS, credential, bearer, signature, and logging security; and
7. real Stripe test-mode reconciliation.

Responsive, accessibility, and broad regression coverage remain required. Unrelated low-severity UI defects are not classified as equivalent to payment, inventory, fulfillment, refund, idempotency, or security failures. Critical accessibility failures affecting purchase completion or material transaction understanding remain release-blocking.

### 18.2 Cart and browser tests

Cover single/multiple tiers, quantity one/ten, aggregate overflow, empty/invalid/fractional quantities, duplicates, extra fields, wrong-event/unknown/inactive tiers, canonical ordering, buyer normalization, and rejection of client money/provider fields.

Prove ordinary refresh and ambiguous retry reuse the request ID and bearer; editing creates a new pair; the bearer uses secure independent randomness; request-ID knowledge does not reveal it; and clear bearer values are limited to scoped browser state and required transport/URL surfaces.

### 18.3 Database and money tests

Cover item uniqueness, aggregate invariants, event/organizer/currency coherence, immutable snapshots, quantity limits, private access, integer bounds, order-level percentage rounding, per-ticket fixed fees, processing treatment, application-fee bounds, and resistance to later tier/fee changes.

### 18.4 Concurrency and expiration tests

Use concurrent database sessions for same-tier oversell, overlapping carts, reverse item order, different tiers, tier edits, eligibility transitions, atomic cart rejection, review inventory, and deadlock resistance.

Prove timestamp-based release, automated cleanup, idempotency, protected paid/processing/review states, lazy backup expiry, and whole-cart cancellation/expiry release.

### 18.5 Checkout server tests

With mocked Stripe dependencies, prove exact multi-line construction, stable item binding, persisted amounts/destination/fee, hosted URL validation, tax/discount/shipping/optional-item exclusions, dynamic payment methods, safe URLs, stable expiry/idempotency, and sanitized errors/logs.

Cover concurrent identical submissions, timeouts before/after Session creation, same-key retry, attached Session reuse, conflicts, failed attachment, definitive noncreation, and ambiguous outcomes.

### 18.6 Webhook and reconciliation tests

Cover signature rejection, receipt/digest deduplication, out-of-order delivery, transient retry, processed no-op, and each mismatch category.

Multi-line cases include exact success plus missing/extra/duplicate/unknown binding, wrong tier/quantity/amount/currency/subtotal, aggregate mismatch, destination mismatch, fee mismatch, and object reuse.

Lifecycle cases include immediate paid, completed unpaid, asynchronous success/failure, duplicate success, failure after paid, invalidated late payment, and retry after committed fulfillment.

### 18.7 Fulfillment tests

Prove exact ticket count and sequences per item, reference coherence, server timestamps, no public ticket-ID disclosure, all-or-nothing rollback, stable retry identity, duplicate-event no-op, and review routing for a partial or mismatched ticket set.

### 18.8 Cancellation and refund tests

Cover open unpaid cancellation, repeat, already expired, paid/processing refusal, ambiguous provider state, and all-tier release.

Cover exact full refund, both required Stripe refund flags, stable refund idempotency, pending/succeeded/failed/cancelled states, ticket invalidation, inventory release, duplicate events, and separate processing-fee accounting.

Exceptional cases include one/multiple partial refunds, cumulative exact full refund, over-refund/conflict, incomplete transfer reversal, incomplete application-fee unwind, review state, admission invalidation, no ticket allocation, and continued inventory commitment.

### 18.9 Browser, responsive, accessibility, and regression tests

E2E must cover multi-tier selection, the aggregate limit, keyboard-operable quantity controls, transaction state presentation, tier/quantity confirmation, retry after refresh, and non-disclosure of internal IDs.

Run required mobile/desktop responsive and accessibility checks for labels, focus, errors, announcements, and transaction comprehension. Run existing event, moderation/public-eligibility, tier, Connect, payment, confirmation, refund/dispute, RLS, generated-type, unit, integration, and E2E regressions.

### 18.10 Observability and security tests

Prove safe codes, correlation without sensitive data, cleanup health detection, anomaly queries, browser-role denial, malformed provider-response containment, and absence of bearer/credential/PII/raw payload logging.

### 18.11 Real Stripe test-mode gate

Before traffic enablement, one tracked disposable fixture must prove:

- multi-tier hosted Checkout;
- aggregate quantity greater than one;
- successful test payment;
- exact destination charge and application fee;
- deterministic Stripe-line/order-item reconciliation;
- webhook fulfillment and duplicate delivery;
- confirmation presentation;
- cancellation or expiration release;
- approved whole-order refund;
- destination reversal and application-fee refund; and
- final database/Stripe reconciliation and authorized fixture cleanup.

The proof must remain test mode throughout and must never print, persist, or commit credentials. Deterministic tests may prove partial-refund safety unless a separately controlled Stripe test fixture is necessary.

### 18.12 Final release blockers

Do not release with:

- an oversell or inventory-release error;
- an unexplained monetary mismatch;
- duplicate or partial ticket fulfillment;
- unsafe idempotency behavior;
- incorrect cancellation/refund economics;
- a missing automated expiry path;
- a credential, bearer, PII, raw-payload, or authorization exposure;
- a failed real Stripe reconciliation;
- reachable obsolete single-ticket runtime logic; or
- an unresolved Critical/Important review finding in a transaction-critical path.

## 19. Approval and next boundary

All twelve Phase 1 design sections were approved by the owner, including the recorded adjustments:

- per-ticket fees retained without speculative fee-basis schema;
- focused PostgreSQL integrity enforcement rather than a generalized framework;
- reliable automated expiry without prematurely fixing tuning values;
- deterministic Stripe-line binding without prematurely choosing one metadata carrier;
- independent random confirmation bearer and browser request-ID reuse;
- whole-order refunds with transfer reversal and application-fee refund;
- no broad customer V1/V2 compatibility layer;
- disposable development fixtures subordinate to rollout safety; and
- transaction-integrity failures prioritized above unrelated low-severity UI defects.

There are no open owner product decisions inside this approved design.

The next authorized phase is to write a Superpowers implementation plan. Product code, migrations, tests, Stripe fixtures, deployment, merge, and push remain unauthorized until that plan is separately requested and approved.
