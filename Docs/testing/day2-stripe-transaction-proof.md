# Day 2 real Stripe transaction proof

Task 17 uses the exact temporary Edge driver source in
`tests/integration/edge/task17-transaction-driver/index.ts`. The runner materializes that source
under `supabase/functions` only for deployment, supplies a one-time token and fixture tag through
temporary managed secrets, runs the canonical proof, and removes the function, temporary secrets,
local materialization, and exact Supabase fixture from its `EXIT` trap. It also captures the current
checkout-creation switch, enables creation only for the fixture, and restores the captured boolean
on success, test failure, signal, or setup failure after capture.

Run it only against the linked development Supabase project and Stripe test mode:

```sh
TEST_CONNECTED_ACCOUNT_ID=acct_test_fixture \
TEST_CONNECTED_ACCOUNT_DISPOSABLE=1 \
  tests/integration/run-stripe-ticketing-proof.sh
```

Before installing a temporary secret, deploying the driver, or changing the checkout-creation
switch, the runner requires exactly one CLI-linked project, verifies its reference and canonical
Supabase URL, requires `ACTIVE_HEALTHY`, and confirms the linked database policy environment is
`development`. A command or parse failure, ambiguous/missing link, reference or URL mismatch,
unhealthy project, or other environment aborts before mutation.

The account fixture must be an open, fully onboarded TEST Accounts v2 recipient using the approved
Express/application-owned responsibility configuration. It must be created solely for this proof:
the explicit `TEST_CONNECTED_ACCOUNT_DISPOSABLE=1` acknowledgement authorizes the cleanup guard to
close it. The runner proves test mode and readiness server-side before creating an event or Checkout
Session. All Whereto Auth, organizer, Connect, event, order, ticket, refund, receipt, temporary
function, temporary-secret, and connected-account fixture state is deleted or closed and verified.
Stripe payment, refund, and event records are immutable test records and are reconciled without
writing their identifiers to a report. Inline test Prices and Products are deactivated during
cleanup, and the disposable connected account is closed.

## Exact transaction contract

The proof creates one Checkout Session with two distinct lines: two General Admission admissions at
1,500 minor units each and one VIP admission at 2,500 minor units. The 5,500-minor-unit order has
three admissions and a 425-minor-unit application fee: five percent of the aggregate plus 50 minor
units per admission. Each Stripe Product carries only the stable internal order-item binding, and
the proof reconciles both lines to their distinct order items before accepting payment.

The paid path proves a destination charge, the expected platform fee and organizer proceeds, three
individually sequenced tickets, duplicate completion idempotency, and a confirmation response that
contains aggregate ticket information rather than ticket identifiers. A separate checkout attempt
uses a new request ID and bearer, proves a declined payment remains unpaid, expires the Session,
retries a transient expiry webhook, and releases only that order's reservation. The refund path uses
the shared whole-order helper and proves the full 5,500-minor-unit refund, destination-transfer
reversal, full 425-minor-unit application-fee refund, three refunded tickets, and duplicate refund
idempotency.

The managed proof surface resolves provider and database identifiers inside the temporary driver.
It exposes only fixed order handles, tier labels, aggregate ticket counts, and safe receipt status
summaries. Payment reconciliation also verifies the charge-to-PaymentIntent, charge-to-transfer,
transfer-to-source-charge, and application-fee-to-charge/account relationships. Browser failures
are reduced to a safe timeout or browser category before the test framework can render them.

The runner refuses to replace an existing temporary driver or temporary proof secret. Files that
hold the token, cleanup authorization, switch state, or materialized driver are mode `0600`; its
temporary directory is mode `0700`. Any inherited Stripe credential with a live-mode prefix is
rejected before fixture collection. The managed client rejects hosted Checkout URLs,
credential-shaped values, confirmation bearers, auth tokens, and buyer identity returned across the
driver boundary.

Fixture Auth lookup is paginated, deletion targets the exact fixture identity, and teardown verifies
that both the known Auth ID and the fixture email are absent before reporting success.

## Credential modes

The canonical runner uses `TEST_STRIPE_CREDENTIAL_MODE=managed_edge`. In this mode the real
`STRIPE_RESTRICTED_KEY` and `STRIPE_WEBHOOK_SECRET` remain in Supabase managed Edge secrets. The
Node test receives only the explicit, non-sensitive proof markers
`managed:test-mode-authenticated` and `managed:signature-verified`; the temporary server proves
those claims using an authenticated test-mode Accounts v2 retrieval and official Stripe signature
verification. It never returns either credential.

The loader also validates `direct` configuration for a compatible locally hosted server process.
That mode requires `rk_test_…` and `whsec_…` values injected only into the enclosing process; it
must never pass either value as a CLI argument, Vite variable, browser value, repository file, or
test report. The committed runner does not use direct mode.

Both modes require these names and fail nonzero with names only when configuration is missing:

- `TEST_STRIPE_CREDENTIAL_MODE`
- `TEST_SUPABASE_URL`
- `TEST_SUPABASE_PUBLISHABLE_KEY`
- `VITE_STRIPE_PUBLISHABLE_KEY`
- `TEST_FUNCTION_URL`
- `TEST_STRIPE_DRIVER_TOKEN`
- `TEST_STRIPE_FIXTURE_PREFIX`
- `TEST_CONNECTED_ACCOUNT_ID`
- `TEST_CONNECTED_ACCOUNT_DISPOSABLE`
- `STRIPE_RESTRICTED_KEY`
- `STRIPE_WEBHOOK_SECRET`

Live publishable or secret/restricted key prefixes are rejected before test collection. Every Stripe
object retrieved by the temporary server is also checked for `livemode: false`; any live object
aborts the proof and still runs teardown.
