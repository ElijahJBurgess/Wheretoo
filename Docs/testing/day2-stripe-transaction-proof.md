# Day 2 real Stripe transaction proof

Task 17 uses the exact temporary Edge driver source in
`tests/integration/edge/task17-transaction-driver/index.ts`. The runner materializes that source
under `supabase/functions` only for deployment, supplies a one-time token and fixture tag through
temporary managed secrets, runs the canonical proof, and removes the function, temporary secrets,
local materialization, and exact Supabase fixture from its `EXIT` trap.

Run it only against the linked development Supabase project and Stripe test mode:

```sh
TEST_CONNECTED_ACCOUNT_ID=acct_test_fixture \
TEST_CONNECTED_ACCOUNT_DISPOSABLE=1 \
  tests/integration/run-stripe-ticketing-proof.sh
```

The account fixture must be an open, fully onboarded TEST Accounts v2 recipient using the approved
Express/application-owned responsibility configuration. It must be created solely for this proof:
the explicit `TEST_CONNECTED_ACCOUNT_DISPOSABLE=1` acknowledgement authorizes the cleanup guard to
close it. The runner proves test mode and readiness server-side before creating an event or Checkout
Session. All Whereto Auth, organizer, Connect, event, order, ticket, refund, receipt, temporary
function, temporary-secret, and connected-account fixture state is deleted or closed and verified.
Stripe payment, refund, and event records are immutable test records and are reconciled without
writing their identifiers to a report.

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

Live publishable or restricted key prefixes are rejected before test collection. Every Stripe
object retrieved by the temporary server is also checked for `livemode: false`; any live object
aborts the proof and still runs teardown.
