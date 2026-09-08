# Checkout Integrity 1.0 Verification

Checkout creation remains disabled throughout Task 15 and at branch handoff,
including after this checklist and the bounded test-mode release proof pass.
Any later enablement requires separate owner authorization. Run commands from the repository root.
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

- [ ] The committed disposable Stripe harness contracts, portable temporary
  driver, and repository typecheck pass without contacting Stripe:

  ```bash
  pnpm exec vitest run --config vitest.integration.config.ts \
    tests/integration/stripeHarnessContract.test.ts \
    tests/integration/stripeRunnerContract.test.ts
  pnpm exec deno check --config deno.json \
    tests/integration/edge/task17-transaction-driver/index.ts
  pnpm typecheck
  ```

- [ ] The documentation credential-shape scan exits zero without printing
  matched content:

  ```bash
  if rg -q '(rk_(test|live)_[A-Za-z0-9]|sk_(test|live)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9])' \
    Docs/runbooks/checkout-integrity-operations.md \
    Docs/testing/checkout-integrity-1-verification.md \
    Docs/testing/day2-stripe-transaction-proof.md; then exit 1; fi
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
- [ ] The bounded real test-mode proof uses one two-line Checkout Session for
  two General Admission admissions and one VIP admission, then reconciles all
  three admissions to exact Product/order-item bindings.
- [ ] The application fee is 425 minor units on the 5,500-minor-unit aggregate:
  five percent plus 50 minor units per admission.
- [ ] A retry reuses the same order and validated Checkout Session.
- [ ] An uncertain provider result preserves inventory for deterministic retry.
- [ ] A verified duplicate webhook causes no second domain transition.
- [ ] Exact current provider objects and line-item bindings are reconciled
  before payment fulfillment.
- [ ] Destination-charge reconciliation verifies charge-to-PaymentIntent,
  charge-to-transfer, transfer-to-source-charge, and application-fee-to-charge
  and connected-account relationships.
- [ ] Atomic fulfillment produces exactly one ticket per admission and is
  idempotent.
- [ ] Cancellation releases only an authoritative unpaid whole order.
- [ ] Expiry cleanup advances stale reservations without affecting paid or
  review inventory.
- [ ] Whole-order refunds reconcile refund money, destination reversal, and
  application-fee unwind; partial or incomplete economics enter review.
- [ ] The real test-mode proof uses a distinct second checkout attempt for the
  decline/expiry path, creates no tickets for it, and leaves inventory reserved
  only for the paid order.
- [ ] Proof teardown restores the captured checkout-creation switch, returns
  the stable Whereto fixture to its inert audit tombstone, removes runtime
  residue and temporary function/secrets/materialization, and deactivates
  inline Prices/Products. Any pre-certification failure preserves the TEST
  connected account. Retirement is authorized only after the canonical proof,
  postflight cleanup, immutable-audit verification, and tombstone certification
  all succeed.
- [ ] Before any proof mutation, exactly one linked `ACTIVE_HEALTHY` project
  matches the expected reference and canonical URL, and its database policy
  environment is `development`.
- [ ] Fixture Auth lookup scans every page, selects only the exact known
  identity, and proves that retained identity is password-rotated and banned
  while the audit-tombstone fixture is inert.
- [ ] Fixture preflight distinguishes preparation, organizer, account binding,
  event, tier setup, Auth, disclosure save, policy acceptance, moderation,
  publish, public eligibility, and checkout-preflight failures with fixed
  sanitized codes and no raw provider/database payload.
- [ ] If stable-fixture recovery requires moderation, a service-only,
  development-gated claim targets one exact event/revision/digest/version and
  the existing result RPC records its immutable clearance before any owner
  schedule revision. The fixture user
  receives no staff role and cannot access the shared queue or another event.
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
- [ ] Managed proof responses contain only opaque handles and aggregates; they
  reject provider IDs, individual ticket IDs, order-item IDs, receipt/event
  IDs, and similarly identifying fields. Hosted Checkout browser failures are
  sanitized before reaching the test runner.
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
- [ ] Review confirms that the forward-only singular-contract removal preserves
  all existing cart fulfillment locks, snapshot binding, inventory, ticket-set,
  lifecycle, and duplicate-delivery checks; only the legacy digest alternative
  and the exact obsolete function signatures are removed.
- [ ] The owner checks for unresolved legacy-digest orders/Sessions before
  applying the cleanup migration; none are silently rewritten or discarded.
- [ ] After the reviewed migration is committed, the owner dry-runs/applies it
  and regenerates database types separately. No migration or type-generation
  command below has an implicit checkout enablement:

  ```bash
  pnpm exec supabase db push --linked --dry-run
  pnpm exec supabase db push --linked
  pnpm db:types
  pnpm typecheck
  pnpm exec supabase test db --linked \
    supabase/tests/database/checkout_integrity_contract_cleanup.test.sql
  pnpm exec vitest run --config vitest.integration.config.ts \
    tests/integration/checkoutIntegrityCleanupContract.test.ts
  ```

- [ ] Installed-contract checks prove all obsolete signatures absent, exact
  canonical service/private ACLs retained, and normalized cardinality constraints
  unchanged. A rollback-only quantity-one JSON cart reserves, fulfills
  idempotently, and confirms through the generalized contract; lifecycle proof
  continues after checkout is re-disabled inside that transaction.
- [ ] Updated historical regression suites still cover reservation/ACL boundaries,
  receipt handling, refunds, confirmation status/privacy, eligibility, kill-switch
  serialization, and fulfillment concurrency using the canonical APIs.
- [ ] Checkout is explicitly verified disabled at handoff. A completed checklist
  is not a launch or permission to enable sales.
- [ ] Re-disabling creation is verified not to disable webhooks, fulfillment,
  cancellation, expiration, refunds, cleanup, or confirmation.
- [ ] If a defect appears after cart data exists, stop new sales and fix
  forward. Never revert the cleanup migration, deploy singular code, or delete,
  collapse, or rewrite financial records. Reconcile existing orders, rerun the
  affected gates, and retain the disabled handoff posture.
