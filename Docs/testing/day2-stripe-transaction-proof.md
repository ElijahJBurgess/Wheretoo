# Day 2 real Stripe transaction proof

Task 17 uses the exact temporary Edge driver source in
`tests/integration/edge/task17-transaction-driver/index.ts`. The runner materializes that source
under `supabase/functions` only for deployment, supplies a one-time token and fixture tag through
temporary managed secrets, runs the canonical proof, and removes the function, temporary secrets,
and local materialization from its `EXIT` trap. The stable development-only Whereto fixture is
returned to an inert audit tombstone rather than deleting its immutable moderation and eligibility
history. The runner also captures the current checkout-creation switch, enables creation only for
the fixture, and restores the captured boolean on success, test failure, signal, or setup failure
after capture.

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
Express/application-owned responsibility configuration. It must be created solely for this proof.
The explicit `TEST_CONNECTED_ACCOUNT_DISPOSABLE=1` acknowledgement permits retirement only after
the canonical proof, Whereto cleanup, immutable-audit verification, and final audit-tombstone
certification have all succeeded. The runner proves test mode and readiness server-side before
creating an event or Checkout Session. Every failure before final certification returns the
Whereto fixture to its inert state and preserves the connected account for an owner-authorized
retry. The retained organizer and Auth identity are inert; active tiers, Connect binding, public
projection, open eligibility, orders, tickets, refunds, receipts, and fulfillment residue must be
absent. Stripe payment, refund, and event records are immutable test records and are reconciled
without writing their identifiers to a report. Inline test Prices and Products are deactivated
during cleanup. Only then does the runner install the temporary close authorization and retire the
account. An invalid or restricted account is not retired automatically; that requires a separate
explicit owner decision.

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

Fixture Auth lookup is paginated and exact. Teardown rotates the fixture password, applies a
long-lived ban, and verifies that the retained Auth identity is inert before reporting success.
If recovery of the stable tombstone creates contextual review for its current revision, the driver
uses the service-only development fixture claim boundary. That boundary fails closed unless
checkout is disabled, policy configuration is development-only, the namespace/organizer/Auth/event
identity is exact, and one queued contextual evaluation matches the current revision, digest, and
moderation version. The existing exact moderation-result boundary then records the low-risk result
and immutable action before the authenticated owner revises the event schedule, so revision cannot
supersede the queued evidence required by recovery. The fixture identity never receives a staff
role, cannot access the shared moderation queue, and cannot read or mutate another event through
staff APIs.

Fixture preflight failures are reported only through fixed safe stage codes: fixture preparation,
organizer recovery, account binding, event recovery, tier setup, Auth recovery, disclosure save,
policy acceptance, moderation recovery, publish, public eligibility, or checkout preflight.
Provider payloads, database error text, tokens, credentials, and buyer data never cross this
diagnostic boundary. `TASK13_FIXTURE_PREFLIGHT_ONLY=1` may be used for an owner-authorized diagnostic
run that materializes and then tombstones the Whereto fixture without enabling checkout, running
the canonical payment test, or authorizing account retirement.

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
