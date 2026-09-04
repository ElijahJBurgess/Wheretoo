# Checkout Integrity 1.0 Verification

Checkout creation remains disabled until this checklist and the bounded
test-mode release proof are complete. Run commands from the repository root.
Do not print credentials, call live mode, or use browser redirect state as
payment evidence.

## Automated gates

- [ ] The focused operational and payment suites pass:

  ```bash
  pnpm exec deno test --allow-env \
    supabase/functions/_shared/operationalLog.test.ts \
    supabase/functions/stripe-create-checkout/index.test.ts \
    supabase/functions/stripe-webhook/index.test.ts \
    supabase/functions/stripe-cancel-checkout/index.test.ts
  ```

- [ ] All function tests pass:

  ```bash
  pnpm test:functions
  ```

- [ ] Function type checking passes:

  ```bash
  pnpm typecheck:functions
  ```

- [ ] The documentation credential-shape scan exits zero without printing
  matched content:

  ```bash
  if rg -q '(rk_(test|live)_[A-Za-z0-9]|sk_(test|live)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9])' \
    Docs/runbooks/checkout-integrity-operations.md \
    Docs/testing/checkout-integrity-1-verification.md; then exit 1; fi
  ```

## Operational integrity gates

Run the diagnostics in `Docs/runbooks/checkout-integrity-operations.md` as the
database owner/operator inside a read-only transaction.

- [ ] Order/item aggregate disagreement returns zero rows.
- [ ] Duplicate tiers return zero rows.
- [ ] Mixed event, organizer, or currency returns zero rows.
- [ ] Paid incomplete ticket sets return zero rows.
- [ ] Incoherent ticket references or sequences return zero rows; a zero-ticket
  non-paid order is excluded, while any partial issued order remains covered.
- [ ] Cleanup-eligible count drains and oldest eligible age does not grow.
- [ ] Review inventory is included in protected quantity; no tier is over
  capacity.
- [ ] Refunded ticket mismatch returns zero rows.
- [ ] Partial refund outside review returns zero rows.
- [ ] Provider object reuse returns zero rows.
- [ ] Stuck retryable receipts return zero rows.
- [ ] The cleanup cron job exists, is active, and recent runs succeed.
- [ ] Unresolved review orders have an explicit operator disposition before
  cutover.

## Behavioral gates

- [ ] A bounded cart contains at most ten distinct lines and ten admissions in
  aggregate.
- [ ] One order item exists per distinct tier and persisted item totals equal
  the order totals.
- [ ] A retry reuses the same order and validated Checkout Session.
- [ ] An uncertain provider result preserves inventory for deterministic retry.
- [ ] A verified duplicate webhook causes no second domain transition.
- [ ] Exact current provider objects and line-item bindings are reconciled
  before payment fulfillment.
- [ ] Atomic fulfillment produces exactly one ticket per admission and is
  idempotent.
- [ ] Cancellation releases only an authoritative unpaid whole order.
- [ ] Expiry cleanup advances stale reservations without affecting paid or
  review inventory.
- [ ] Whole-order refunds reconcile refund money, destination reversal, and
  application-fee unwind; partial or incomplete economics enter review.
- [ ] Browser success/return state never creates tickets or marks an order paid.

## Logging safety gates

- [ ] Every emitted record uses contract `checkout_integrity_v1` and an
  allowlisted operation/outcome.
- [ ] Extra fields are rebuilt away at runtime, even when structural typing or
  a cast supplies them.
- [ ] Inherited or accessor-backed contract fields emit nothing.
- [ ] Operation/outcome/status combinations are discriminated and terminal
  cancellation retries report no transition.
- [ ] Invalid identifiers, enums, counters, money, duration, attempts, statuses,
  and error codes emit nothing.
- [ ] No record contains buyer identity, request IDs, confirmation/cancellation
  bearers, headers, authorization/signature values, raw bodies, IP/user agent,
  Checkout URLs, payment details, arbitrary provider errors, or credentials.
- [ ] A failed log sink does not change a checkout, webhook, cancellation,
  fulfillment, or refund result, including a rejected asynchronous sink.
- [ ] Refund events use the exact durable order/ticket status returned by
  `server_apply_verified_refund`, including cumulative refund outcomes, and
  every review includes a specific safe reason.
- [ ] Fulfillment events compare expected quantity with the exact committed
  ticket count returned by `server_fulfill_paid_order`; a non-paid or
  mismatched result fails closed, while receipt-level duplicates remain
  distinct from committed fulfillment.
- [ ] Operational events correlate only by already-known internal IDs, webhook
  IDs, and non-secret provider object identity.

## Cutover and rollback

- [ ] The database owner confirms the intended environment and that checkout
  creation is still disabled.
- [ ] The bounded test-mode release proof passes without creating or retrieving
  any live-mode object.
- [ ] Only after every preceding gate passes, the database owner uses the
  owner-only statement in the runbook to re-enable checkout creation.
- [ ] Re-disabling creation is verified not to disable webhooks, fulfillment,
  cancellation, expiration, refunds, cleanup, or confirmation.
- [ ] If a defect appears after cart data exists, stop new sales and fix
  forward. Never delete or collapse financial records.
