# Spec 09 implementation handoff

Spec 09 is implemented and independently verified locally on `codex/spec09-refund-support` in `.worktrees/spec09-refund-support`. Three shared UI attachments remain intentionally deferred because Spec 08 owns those files concurrently. No commit, merge, push, deployment, shared database change, or real Stripe/Resend operation was performed.

## Completed behavior

- One private, durable whole-order operation per order. The claim commits the immutable payment snapshot and existing idempotency key before possible provider dispatch. Ownership, event binding, paid-source coherence, and the existing payment lock hierarchy are enforced server-side. Simultaneous claims permit exactly one call to the existing financial helper.
- Submission, processing, unknown, failed, review and completed projections are distinct. Duplicate submits cannot dispatch again. Recovery observes the existing refund and uses the existing strict economic-evidence repair. It cannot create another refund, rotate the key, invent a partial amount, or assert financial completion. A pre-dispatch crash may conservatively remain unknown and require support; there is deliberately no automatic new attempt after ambiguous or definitive failure.
- Existing canonical reconciliation remains the only money/admission authority. Canonical full completion overrides intermediate operation states; contradictory evidence and definitive failure remain visible despite older pending rows or delayed unknown responses. Existing partial/anomalous refund review holds remain unchanged.
- The $70, three-ticket lifecycle is proven: the original Used admission and timestamp survive; the two unused admissions become Refunded; original admission credentials cannot admit again; all three inventory commitments release once; historical paid-order/sales/issued/used metrics remain intact.
- Organizer order detail uses a whole-order confirmation, immutable amount/item summary, cancellation, duplicate-submit guard, identity-scoped reads, explicit uncertain/failure/review states, and separate notice delivery status. Refund state gates ordinary admission resend. Mobile dialog focus and scrolling are corrected without changing the shared dialog.
- The buyer refund-detail page provides purpose-authorized order history, confirmed full amount, event details, Used/Refunded distinctions and original check-in times. It exposes no QR, admission secret, buyer email, Stripe IDs, provider errors or operation keys. It removes the fragment, scopes tab storage separately, honors server expiry/revocation and clears inaccessible history. Configured support is reused; no organizer login address or invented contact channel is substituted.
- Spec 07's existing worker, encrypted immutable payload, bounded dispatch/retry rules, signed delivery observations and access infrastructure now support `refund_notice`. A bounded catch-up step queues only already-committed canonical refunds, independently of the financial transaction. Permanent receipts prevent duplicate notices even after outbox retention. Financial grants last a fixed 30 days from preparation and work after event end; ordinary admission/recovery grants cannot read financial history, and financial grants cannot mint/access admissions.

The existing `refundOrder.ts`, `refundAdapter.ts`, Stripe webhook, checkout creation, checkout/confirmation queries and Spec 08 buyer files were hash-checked against the frozen baseline and remain unchanged. Approved destination-charge economics remain `reverse_transfer=true`, `refund_application_fee=true`, full immutable order total, and the existing order-bound idempotency key. No new payment status or checkout/payment-recovery behavior was introduced.

## Migrations

1. `supabase/migrations/20260914010000_add_refund_operations.sql`: operation ledger, immutable authority, owner status read, service claim/observation/recovery read, canonical completion bookkeeping and admission-email eligibility gate.
2. `supabase/migrations/20260914010200_add_refund_notice.sql`: refund purpose, permanent receipt, canonical catch-up, worker preparation/dispatch, financial-grant resolver and separate organizer delivery status.

Both were applied only to the task's recorded disposable container `whereto-spec09-db`, loopback port 55495, with cron execution disabled. The frozen 110 migrations were replayed first. Final function changes were applied from their migration definitions to that same guarded database. REST 55496 and the test Edge 55497 also have task-specific identity checks; external provider network access was unavailable to the Edge harness.

## Verification results

| Check | Result |
| --- | --- |
| Full frontend suite, final tree | 1,092 tests passed in 117 files |
| Full Edge function suite | 320 tests passed |
| Edge function typecheck | Passed |
| Full configured TypeScript checks | Passed |
| Full ESLint | Passed, no warnings |
| Production build | Passed |
| Core refund SQL | 26 assertions passed |
| Canonical lifecycle SQL | 89 assertions passed |
| Refund notice schema/access SQL | 31 assertions passed |
| Spec 07 SQL regression | 148 assertions passed across nine suites |
| Refund concurrency | Four scenarios passed, including eight actual lock waiters granting one dispatch, eight unknown retries granting none, eight delayed observations preserving failure, and eight canonical completion retries preserving one refund/release |
| Browser journey | Passed using real production UI, production refund handler/helper, real local SQL, synthetic financial provider and synthetic mail transport |
| Visual/keyboard QA | Organizer and buyer at 320/390/768/1440 CSS pixels; mobile dialog opening/scroll/focus, Escape/Cancel, unknown/failed/review/completed and revoked financial link verified |
| Boundary/diff checks | Frozen shared-file and financial-writer hashes verified; incremental diff reviewed; whitespace checks passed |

Frontend/Edge counts include their focused tests; they are not additional tests to sum. Browser completion is driven through a synthetic webhook receipt and the real canonical SQL writer. Cryptographic Stripe webhook signature/retrieval behavior is covered by the existing passing Edge tests, not a live Stripe event. Physical-camera scanning, email-client inbox rendering, and real provider settlement/delivery were not run.

Independent review found and fixed two regressions: durable review/failure being hidden by an older pending row, and a late unknown observation erasing failure. Regression SQL and concurrent tests cover both. Browser inspection found the long dialog initially scrolled past its heading; the failing geometry assertion now passes with the warning focused at the top.

## Deferred shared-file integration

Exact additive patches are in `Docs/testing/spec09-deferred-shared-integration.md`:

- `src/app/router/router.tsx`: lazy public `/refund-details` route.
- `src/features/buyer-journey/OrderConfirmationView.tsx`: canonical refunded copy plus `RefundSupportContext` using the existing authorized order number.
- `src/features/ticket-experience/customer/FocusedTicketView.tsx`: refund-only support context beside the existing inactive ticket content.

These three files were intentionally not patched. `src/features/orders/OrderConfirmationPage.tsx` needs no change. The refund route and buyer page are exercised through the isolated test mount now; the production URL becomes reachable after the small router attachment. No financial-history access is added to ordinary admission links.

After combining both specs, regenerate `src/lib/supabase/database.types.ts` from the combined migration set; do not replace Spec 08's types with this snapshot. Reconcile the narrow `deno.json` email import and `supabase/config.toml` refund endpoint additions if Spec 08 also changed those files. Re-run router, confirmation, focused-ticket and refund tests and a production `/refund-details` smoke. Those shared-integration-only checks are deferred, not the local refund lifecycle proof.

## Reproduction and setup

Run from this worktree. No production setup or provider activation was performed. The existing Spec 07 worker/configuration must be enabled under its separately approved rollout before real notices can send. It needs its existing encryption/fingerprint/worker credentials, sender, signed-mail-webhook setup, trusted access-IP configuration and `TICKET_EMAIL_SUPPORT_EMAIL`; browser support uses the existing optional `VITE_TICKET_SUPPORT_EMAIL`. Spec 09 introduces no new sender, provider account, support desk or scheduler.

Local database tests run through `python3 tests/integration/spec09-database.py test`; run SQL suites before seeding persistent browser/concurrency fixtures because inherited Spec 07 fixtures assume a clean disposable data set. The runner refuses other container identities or arbitrary database URLs. Concurrency is `python3 tests/integration/spec09-refund-concurrency.py`.

For a fresh local proof, create/migrate the dedicated database through that runner, create the dedicated REST service with `python3 tests/integration/spec09-services.py create`, then start the test-only Edge harness with Deno network permission limited to 127.0.0.1:55496 and 127.0.0.1:55497. Start Vite on 3019 using the dummy configuration in `tests/e2e/spec09-harness/README.md`, and run `pnpm exec playwright test --config playwright.spec09.config.ts`. The browser test creates a new synthetic fixture namespace on each run and blocks external traffic. These services/fixtures are diagnostic only, never deployment artifacts. The test Edge and Vite processes were stopped after verification; the dedicated DB/REST containers and synthetic fixtures remain for inspection, with cron execution disabled.

Exact changed-file inventory: `Docs/testing/spec09-changed-files.md`. Local machine evidence, baseline hashes, source delta, screenshots and independent reports are retained under `.superpowers/spec09/` and `.superpowers/sdd/2026-09-11-spec09-implementation/`; they are ignored, not committed. The frozen snapshot contains 716 files, map digest `9306b44aa805738511d3742df5f59e916eab4049695a003dd5fcafc3ca3900e2`, based on commit `94c546bd0961f501584f8a3437298b2331cafd5c`.
