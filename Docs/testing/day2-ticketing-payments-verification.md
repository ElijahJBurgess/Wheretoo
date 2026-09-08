# Day 2 native ticketing and payments verification

This runbook covers the test-mode Day 2 marketplace-payment boundary. It does not authorize live charges, live Connect accounts, QR/check-in, consumer accounts, organizer analytics, payouts UI, or refunds UI.

## Environment and secret ownership

| Name | Boundary | Owner / purpose |
|---|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | Public Vite client, `pk_test_` only | Loads Stripe-hosted and embedded client surfaces. It is not privileged. |
| `STRIPE_RESTRICTED_KEY` | Supabase managed Edge secret, `rk_test_` only | Server-side Accounts v2, Checkout, payment, transfer, fee, refund, and reconciliation calls. Never put it in Vite or a file. |
| `STRIPE_WEBHOOK_SECRET` | Supabase managed Edge secret | Verifies snapshot webhook signatures over the unmodified request body. |
| `STRIPE_THIN_WEBHOOK_SECRET` | Optional Supabase managed Edge secret | Verifies a separately configured thin-event endpoint during migration. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase managed Edge environment | Server-only database writes through the narrow Edge/RPC boundary. |
| `APP_BASE_URL` | Supabase managed Edge secret/config | Exact application origin used for Checkout return and cancel URLs. |

Use separate Stripe keys, webhook secrets, Supabase projects, and Connect accounts for every environment. The committed loaders reject live Stripe key prefixes and the test driver rejects any live Stripe object. Never log request headers, Account Session client secrets, Checkout URLs, webhook bodies, buyer PII, or Stripe credentials.

## Deployment order

1. Apply every committed Supabase migration in timestamp order and confirm the remote migration list matches the repository.
2. Configure the managed secrets above. Keep `VITE_STRIPE_PUBLISHABLE_KEY` only in the deployment's public Vite boundary.
3. Deploy `stripe-connect-session`, `stripe-connect-status`, and `stripe-express-login`.
4. Deploy `stripe-create-checkout` and `stripe-cancel-checkout`.
5. Deploy `stripe-webhook`, then `order-confirmation`.
6. Configure the Stripe test webhook endpoint for:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `refund.created`, `refund.updated`, and `refund.failed`
   - `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`, and `charge.dispute.funds_withdrawn`
7. Configure a test payment-method configuration that permits an immediate card method. The application deliberately does not send `payment_method_types`.
8. Refresh one disposable Accounts v2 recipient through the server boundary and require active transfers, active payouts, and clear requirements before enabling test sales.

The test Connect configuration is recipient-only, uses Express Dashboard, and assigns both fee collection and negative-balance loss responsibility to the platform application. Checkout uses destination charges to one connected organizer.

## Test fee rule

The locked TEST rule is exactly **5% + $0.50 per purchased ticket**:

```text
application_fee_minor = floor(subtotal_minor * 500 / 10_000) + 50
organizer_proceeds_minor = subtotal_minor - application_fee_minor
```

All arithmetic is server-side in integer USD minor units and snapshotted onto the order. Browser-supplied amounts, fees, destination IDs, inventory, or currency are never trusted. This rule is not approved live pricing.

## Checkout, reservation, and fulfillment operations

- `stripe-create-checkout` refreshes Connect readiness, validates the published event and active tier, locks inventory, creates one reservation, snapshots the fee, and creates a test Checkout Session idempotently.
- One Checkout Session reserves one ticket for thirty minutes plus the committed grace window. Expiry, explicit cancellation, async failure, and safe cleanup release inventory monotonically.
- A last-ticket race serializes on the tier row: one reservation wins and the other request receives sold out without creating another Checkout Session.
- Redirect success is not payment truth. Only a verified webhook can mark an order paid and issue a ticket.
- Webhook receipt ID, order/Stripe IDs, and ticket constraints form independent exactly-once boundaries. Retried or out-of-order events update monotonic state and never issue a second ticket.
- `order-confirmation` exposes only the token-scoped confirmation projection. It does not expose financial reconciliation, Connect identity, or other buyers.

When delivery is delayed, leave the buyer on the persisted processing state and allow Stripe retries. Inspect `stripe_webhook_events.processing_status`, `delivery_attempt_count`, and safe `error_code`; fix the underlying transient failure, then replay the exact Stripe test event. Do not edit an order or ticket into a successful state by hand.

## Reconciliation

For a paid order, compare the persisted Checkout Session, PaymentIntent, Charge, Transfer, Application Fee, and Balance Transaction IDs to Stripe test objects. Confirm:

- every retrieved object is non-live;
- the PaymentIntent destination is the expected connected account;
- the charge, transfer, currency, and order total agree;
- the application fee equals the snapshotted `5% + $0.50` rule;
- transfer less application fee equals expected organizer proceeds;
- one paid order item and one valid ticket exist;
- the durable webhook receipt is processed and replay-safe.

Stripe payment, event, transfer, fee, and refund records are immutable test records. Clean exact Supabase fixtures and disposable connected accounts by tracked IDs/prefixes; retain no customer PII or Stripe identifiers in committed reports.

## Refund and dispute foundation

Day 2 provides the secure data/webhook foundation, not organizer-facing controls.

- An approved destination-charge refund must explicitly use `reverse_transfer: true`; whether the application fee is returned must be an explicit policy choice and persisted on the refund.
- Verified refund events update refund totals, order status, and ticket validity idempotently. Retry recovery reconciles a previously missed ticket invalidation without duplicating the refund.
- Dispute events persist monotonic audit state and invalidate or restore ticket state only through the verified server path. Operations must retrieve current Stripe truth before intervention.
- Never promise organizers instant payout, cash-out, or direct dispute control. Express visibility is limited and the platform owns the operational response for this charge pattern.

## Local and linked verification

Local Docker parity remains required for routine migration and pgTAP development but is not a blocker for the linked development proof. Before release, run the repository's full unit, Edge, integration, type, lint, build, Playwright, linked DB lint, migration, secret-scan, and cleanup gates. The real Stripe runner is documented separately in `Docs/testing/day2-stripe-transaction-proof.md` and must use one fully disposable TEST account.

The current checkout-integrity Task 14 browser proof runs four buyer-only cases at `390x844` and `1440x900`: one visual case and one real-payment case per viewport. It covers anonymous GA ×2 + VIP ×1 selection ($55 total), the aggregate ten-ticket limit, guest validation/focus, ambiguous retry plus reload, real hosted Stripe TEST payment, webhook-backed confirmation and reload, keyboard focus, reduced motion, responsive overflow, and application-only screenshots. Organizer publishing and cross-organizer authorization remain separate regression suites; this guard does not invoke their stale historical UI journeys.

Both cases reuse the committed Task 13 driver's stable audit-tombstone fixture through its `setup` action. Each viewport runs visual proof before payment and completes exact cleanup before the next viewport starts, preserving the canonical one-refund/three-ticket bounds without creating new immutable event rows. Captures use separate `test-results/e2e/task14/<project>/visual` and `purchase` directories so later invocations do not erase earlier evidence.

Browser settlement now resolves the same authoritative TEST refund after creation, including a create/enrich race. It never repeats creation when inspection already contains a refund. Evidence polling is bounded to five attempts, requires exact provider identities/currency and the 5500 transfer reversal plus 425 application-fee refund, and only then enriches existing metadata. A fresh signed `refund.updated` must leave one refunded/reconciled order, one policy-verified succeeded refund, and exactly three refunded (non-admitting) tickets before financial cleanup.

The exceptional current paid-review residue has a separate owner-controlled command (using the already-configured disposable TEST account):

```sh
TASK14_REFUND_RECOVERY_ONLY=1 TEST_CONNECTED_ACCOUNT_DISPOSABLE=1 \
  tests/integration/run-stripe-ticketing-proof.sh
```

This mode requires checkout already disabled and the exact inert, published/clear fixture with two active tiers, one Connect binding, one succeeded-but-policy-mismatched refund with 5500 reversal/zero fallback fee evidence, and exactly three `cancelled` (non-admitting) tickets. It cannot prepare a fixture, enable checkout, create a checkout/refund, or retire the account. Contradictions or exhausted missing evidence fail closed and preserve financial rows. After recovery, locked SQL rechecks terminal economics before exact runtime cleanup and audit-tombstone certification; temporary function, secrets, and local materialization are removed. Normal fixture admission is unchanged. This command is not a substitute for rerunning both browser viewports and inspecting their safe screenshots.

The browser process is intentionally least-privileged and must not own destructive cleanup. Run it only through the committed guard, supplying one fully onboarded disposable TEST recipient:

```sh
TEST_CONNECTED_ACCOUNT_ID=<disposable-test-account> \
TEST_CONNECTED_ACCOUNT_DISPOSABLE=1 \
pnpm test:e2e:ticketing
```

The wrapper delegates each viewport to the canonical Task 13 guard in browser mode. It preserves development/TEST/account readiness and migration preflight, temporarily enables checkout only from the disabled state, and passes public keys plus the temporary managed-driver credential to the test process; it creates no additional organizer identities. Its trap restores checkout disabled, expires unpaid sessions or verifies succeeded whole-order refunds with transfer and fee reversal (including after browser failure), makes fixture Auth/public visibility inert, uses the locked exact runtime-cleanup SQL, and certifies the retained audit tombstone. The connected TEST account is always preserved in browser mode. Immutable event/moderation history is never deleted. Failed financial settlement blocks database deletion and fails the gate, while safe inerting and temporary driver/secret teardown still run. It never changes `APP_BASE_URL`; the canonical development origin must already be configured. A failed guard is a failed browser gate; never repair cleanup with a broad project reset.

Visual QA uses the approved transaction reference for hierarchy only: light neutral surfaces, dark high-contrast type, violet primary actions, event identity before ticket selection, compact single-column mobile checkout, and an unmistakable confirmation state. QR, wallet passes, attendee dashboards, payout balances, analytics, and other reference-only features remain excluded.

## Task 18 verification evidence

The initial 2026-08-26 linked TEST run completed with:

- 431 application tests across 50 files and 100 Edge-function tests;
- the committed hosted integration, ticketing database, concurrency, and all 15 pgTAP migration suites;
- eight total mobile/desktop cases across `390x844` mobile and `1440x900` desktop projects;
- real Stripe-hosted card payment, verified webhook fulfillment, persisted confirmation reload, sold-out inventory, and cross-organizer isolation;
- non-live PaymentIntent, Charge, Transfer, Application Fee, Balance Transaction, and refund reconciliation with the exact TEST fee rule;
- keyboard focus, visible focus treatment, reduced-motion, semantic-heading, responsive-overflow, and accessibility smoke checks;
- manual inspection of 12 redacted application screenshots against the approved transaction and organizer visual references; and
- zero exact Supabase fixture residue, one closed disposable non-live recipient, and no temporary function, secret, credential file, or test endpoint left behind.

The linked proof retained only Stripe's immutable test transaction history. No Stripe IDs, buyer data, credential values, hosted Checkout screenshots, or onboarding URLs are recorded here.

Final review removed cross-test inventory coupling, split base Playwright configuration from temporary Task 18 driver credentials, and checked in the enclosing fixture/reconciliation/cleanup guard. The final deterministic inventory completed eight total mobile/desktop cases: four Day 1 organizer-publishing cases and four Day 2 paid-ticketing cases.

## Live-mode blockers

Do not enable live payments until all of the following are separately approved and configured:

- Stripe and counsel confirm merchant-of-record, seller-contract, statement-descriptor, receipt, refund, dispute, and negative-balance responsibilities;
- finance approves live platform pricing and actual Stripe-fee treatment;
- counsel/tax advisors identify the tax-liable entity, event-ticket tax treatment, registrations, and supported jurisdictions before Stripe Tax is enabled;
- production Connect profile, restricted live key permissions, webhook endpoints/secrets, payment-method configuration, support ownership, monitoring, alerting, refund/dispute runbooks, and reconciliation are production-ready;
- live-mode E2E is replaced with an explicitly authorized low-risk release procedure. Test credentials and test object IDs are never promoted.
