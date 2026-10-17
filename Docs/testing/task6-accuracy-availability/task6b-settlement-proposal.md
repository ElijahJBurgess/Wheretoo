# Task 6B — settlement policy proposal (not implemented)

Status: separate founder approval required. Task 6A changes admission of **new reservations**, not settlement. No historical order, payment, ticket, refund, notification, or reservation scheduler changes are authorized here.

## Current contracts and gap

- `private.reserve_checkout` admits new paid requests under the event/tier/order lock hierarchy. Exact persisted requests recover the immutable order snapshot rather than creating another order. Task 6A adds a final wall-clock eligibility check immediately before insertion.
- `stripe-create-checkout` binds the provider Checkout Session to the frozen server order and request digest. A reservation and a provider Session have separate expiry deadlines; neither proves a payment succeeded.
- `stripe-webhook` verifies signatures, stores the Stripe event ID/digest/`stripe_created_at`, retrieves current Session/PaymentIntent/Charge truth, and validates amounts, currency, account, metadata, lines and financial bindings before the service-only fulfillment RPC.
- `private.fulfill_paid_order` distinguishes existing success/replay from new issuance; protects inventory; routes invalidated paid orders to review. It uses current **timeless** authorization, active tiers, reservation/order state and inventory. Its canonical eligibility check does not itself reject an ended event. Redemption independently rejects ended events.
- The fulfillment RPC does not currently receive an immutable, verified payment-success timeline or a frozen event cutoff revision. Provider event creation is not webhook delivery time, but is also not a universal payment-initiation/success timestamp. PaymentIntent/Charge creation alone does not establish successful capture time, especially for asynchronous payment methods.
- The rollback-only Task 6 audit demonstrated that an event which has ended can still acquire new valid ticket rows under the current settlement path; those rows cannot be redeemed. That synthetic test did not prove when a real customer initiated or completed a payment. It does not justify rejecting all delayed webhooks.

Stripe documents duplicate, retried and unordered deliveries. Its Event `created` field timestamps the Event object; Charge `created` timestamps the Charge object. These timestamps must retain their actual meaning. See [webhook delivery behavior](https://docs.stripe.com/webhooks), [Event fields](https://docs.stripe.com/api/events/object), and [Charge fields](https://docs.stripe.com/api/charges/object). A signed payload alone must still be reconciled with the exact existing order and provider objects.

## Recommended policy for approval

| Case | Evidence required | Recommended treatment |
| --- | --- | --- |
| A. Legitimate pre-end payment; late delivery | Exact admitted order/Session, preserved event cutoff and authorization revision, provider-verified successful payment timeline before cutoff, unchanged monetary bindings | Preserve the successful financial fact and idempotency. Delayed delivery alone must not invalidate it. If event has ended or a hold was released, record/reconcile the payment and route unfulfilled admissions to review; do not mint newly usable post-event admissions or automatically refund. Separate approval must decide customer remediation and whether historical admission records are needed. |
| B. Genuinely new payment initiated after ineligibility | Original order/Session creation and admission evidence; verified provider timeline, cutoff/authorization history; distinguish an old admitted Session from a new attempt | Reject new reservations (Task 6A). A payment that nevertheless succeeds remains a real payment: record it and route to explicit review without new admissions. Session expiry/cancellation at the provider should be best effort and must not erase payment truth. |
| C. Payment succeeds after reservation expiry | Hold deadline and release history, payment timeline, already-issued admissions, current inventory under existing locks | Never reclaim another buyer's inventory or blindly revive an expired hold. Record the success and use the existing review boundary. Any optional safe reacquisition needs a separate explicit policy and atomic contention proof; default proposal is no automatic reacquisition. A pre-expiry success delivered after expiry is a different subcase and must be reconciled from evidence rather than delivery time. |
| D. Previously successful payment; late replay | Exact existing order/provider IDs, immutable money snapshot, receipt/event digest and persisted fulfillment/ticket manifest | Return the existing committed outcome. Never issue duplicate tickets, reverse paid status, invalidate issued tickets, refund, or notify merely because the replay arrives late or the event is now unavailable. Conflicting bindings remain review/errors under the existing contract. |

If provider/history evidence cannot distinguish A from B/C, preserve the verified financial fact and classify it as unresolved review. Do not fabricate a precise success time from `received_at`, `event.created`, `PaymentIntent.created`, or `Charge.created` alone.

## Smallest technical work after separate approval

1. Define the exact cutoff policy (event end, authorization withdrawal, and event edits), asynchronous-method policy, and remedy for a valid on-time payment processed after the event. Agree whether event cutoffs are frozen when admitted or revised under explicit existing-order rules.
2. Inventory which provider timeline evidence the current test-mode API actually supplies per enabled method. Preserve source IDs, raw evidence/digests, and event occurrence versus received/processed timestamps. Do not upgrade the API/SDK or enable methods as part of this repair.
3. Add a private immutable admission/payment reconciliation context, or extend the existing private order snapshot only if necessary. Capture admission time, event revision/cutoff, hold deadline/release, and verified provider evidence. Backfill historical records only as unknown; never infer historical success timing.
4. Extend the verified Edge-to-service RPC boundary with validated evidence, not client timestamps. Classify new unsettled payments under locks, **after** exact existing-success recovery. Keep the existing issuer, money validation, manifests, receipt deduplication and order/charge uniqueness guarantees.
5. Add tests for reordered and duplicate events, concurrent replay, delayed pre-end success, genuinely post-cutoff initiation, hold expiry/reallocation, async success/failure, provider snapshot outage, refund/dispute already present, cancellation/moderation changes, and historical successful orders. Test invalid evidence as review/retry, never as a fabricated failure or refund.
6. Review a migration and rollback strategy separately. Rollback must preserve every recorded financial fact and issued admission; no destructive down migration. Cancellation, ticket invalidation, refunds, transfer reversal and buyer notifications remain separate approved operations.

No Task 6B SQL, webhook, fulfillment, refund or notification code is included in Task 6A.
