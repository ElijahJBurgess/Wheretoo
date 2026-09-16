# Integration-only file inventory

Relative to the exact 789-file source union. Source feature inventories remain in their original handoffs. No source file was deleted.

## Modified

- `playwright.spec07.config.ts`
- `playwright.spec08.config.ts`
- `playwright.spec09.config.ts`
- `src/app/router/router.test.tsx`
- `src/app/router/router.tsx`
- `src/features/buyer-journey/OrderConfirmationView.tsx`
- `src/features/orders/OrderConfirmationPage.test.tsx`
- `src/features/ticket-experience/customer/FocusedTicketView.test.tsx`
- `src/features/ticket-experience/customer/FocusedTicketView.tsx`
- `tests/e2e/spec07.spec.ts`
- `tests/e2e/spec09.spec.ts`
- `tests/e2e/support/spec07Harness.ts`
- `tests/e2e/support/spec07Setup.ts`
- `tests/e2e/support/spec07Teardown.ts`
- `tests/e2e/support/spec08Harness.ts`
- `tests/integration/edge/spec07-local/index.ts`
- `tests/integration/edge/spec09-local/index.ts`
- `tests/integration/edge/spec09-local/refund.ts`
- `tests/integration/spec07-browser-fixture.py`
- `tests/integration/spec07-email-concurrency.py`
- `tests/integration/spec08-checkout-concurrency.py`
- `tests/integration/spec09-browser-fixture.py`
- `tests/integration/spec09-refund-concurrency.py`
- `tests/integration/spec09-services.py`
- `tsconfig.e2e.json`

## Added

- `tests/integration/spec08-spec09-database.py`
- `supabase/tests/database/spec08_spec09_integration.test.sql`
- `supabase/tests/database/spec08_spec09_notice_failure.test.sql`
- `Docs/superpowers/plans/2026-09-12-spec08-spec09-integration.md`
- `Docs/testing/spec08-spec09-source-reconciliation.md`
- `Docs/testing/spec08-spec09-integration-request.md`
- `Docs/testing/spec08-spec09-integration-files.md`
- `Docs/testing/spec08-spec09-integration-verification.md`

Database types were regenerated against the freshly replayed disposable schema and are byte-identical to the accepted Spec 09 public types after removing the generator’s extra final blank line. All migrations are inherited unchanged; no integration migration was added.
