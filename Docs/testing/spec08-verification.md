# Spec 08 implementation and verification

Status: local implementation and authorized verification complete. No commit, merge, push, deployment, shared-database migration, provider change or real transaction was performed. Actual Stripe TEST proof was not authorized and was skipped. This report supersedes the historical blocked checkpoint.

## Worktree and frozen starting point

- Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec08-payment-recovery`
- Branch: `codex/spec08-payment-recovery`
- Starting and final HEAD: `94c546bd0961f501584f8a3437298b2331cafd5c` (no commits).
- Baseline: frozen Spec07 working snapshot, including implemented Spec06 prerequisites. Both dependencies had uncommitted work, so the per-file manifests and baseline archive identify the actual source, rather than HEAD alone. See `spec08-dependency-snapshots.md`.
- Final checks: Spec06 634 files and Spec07 716 files show zero source drift. Existing migrations and protected local RSVP/API/webhook/router files retain baseline hashes. Exactly one new migration exists. Evidence: `.superpowers/spec08/frozen-final-check.json`.

## Approved corrective migration

`20260914010800_restore_checkout_preflight_cardinality.sql` follows the frozen migration set (latest inherited migration `20260913010600`). It reads the existing function definition and guards an exact single replacement of `cardinality(p_tier_ids) not between 1 and 3` with `cardinality(p_tier_ids) not between 1 and 10`. Unexpected function contents abort the migration. The old `20260909010100_allow_checkout_preflight_status_refresh.sql` remains byte-identical.

A local before/after function-definition comparison confirmed that this expression is the only function change. Per-tier maximum ten, total order maximum ten, duplicate-tier rejection, Connect refresh, reservation, locking, identity and Stripe behavior remain intact. The new 21-assertion regression proves cardinalities 1–10 reach canonical tier lookup, 11 fails `CHECKOUT_INPUT_INVALID`, missing/inactive tiers reach `TIER_NOT_ACTIVE`, valid preflight reaches reservation `TIER_SOLD_OUT`, independent quantity ceilings hold, and failed checks add no orders/tickets. Before correction, the seven cardinality cases 4–10 failed; after correction all pass. Existing reservation tests retain `TIER_NOT_FOUND` coverage.

Only the task-owned disposable database was migrated. A fresh replay of all 111 migrations preceded a restart of the complete checkout database suite.

## Attempt safety and preserved contracts

Existing checkout request/response schemas, canonical order statuses, bearer confirmation API, Stripe idempotency keys, reservation and webhook ticket issuance are unchanged. New lifecycle fields are browser attempt metadata, not a payment status model. No buyer PII was added to attempt storage.

- Unresolved cart/email changes cannot replace the durable request ID or bearer. Exact concurrent submissions coalesce; changed concurrent input is rejected.
- Corrupt/unreadable storage fails closed. A separate seen marker distinguishes a lost attempt record from no previous record. Active-page replay requires a retained attempt matching its expected bearer, even if all session storage was deleted.
- Storage readback compares the entire saved record, including lifecycle, original selection and verified event association. Submission is persisted before transport.
- Only the first definitive pre-reservation rejection permits explicit cart editing. `TIER_SOLD_OUT`, `TIER_NOT_FOUND`, `TIER_NOT_ACTIVE` after a timeout remain uncertain. Generic event/Connect rejections are also definitive only on the first submission.
- Retry checks the same bearer first. Only an explicitly requested hosted retry of the same processing attempt can reuse its exact request ID, bearer and canonical input. Unknown/not-found/expired outcomes do not create a replacement. An ambiguous creation with no attached session remains unresolved under the existing contract.
- Cancellation awaits in-flight creation and the existing cancellation endpoint. Errors reconcile the same bearer. A database `expired`, `cancelled` or `payment_failed` label alone does not authorize another purchase. Replacement requires the endpoint's verified terminal acknowledgment; paid/refunded cleanup uses authoritative confirmation.
- Processing uses existing bounded 1-second/60-second polling, checks the same order and disables hosted replay while checking. Delayed authoritative paid reuses the original collection.
- Recovery event navigation requires a validated public event or a stored association created from that validation. Cancel return restores the verified original selection. Unknown tokens do not produce guessed event routes or a `/` fallback.
- Removing unavailable selections does not silently accept a price change on another selected tier. The buyer must explicitly review the updated selection.

The attached-session backend guard now returns the existing hosted URL only when the validated session ID exactly equals the stored session ID and `status === 'open'`. Wrong-ID, complete and expired sessions fail with existing `INVALID_STRIPE_SESSION`; no replacement create/attach is introduced and cleanup protections remain intact.

## All ten reference states

| Reference | Implemented result and safe action | Contract/evidence |
|---|---|---|
| Event Sold Out | Sold out, disabled purchase action; selected lines retained for explicit review. Mixed stock remains purchasable. | Fresh nonempty public paid tiers all `sold_out`; frontend/browser proofs. |
| Sales Closed | Deliberately adapted to **Tickets unavailable** where no canonical closing reason exists. No invented sales deadline. | First `EVENT_NOT_SELLABLE`, `EVENT_NOT_FOUND`, `CONNECT_NOT_READY`, `CONNECT_ACTION_REQUIRED`; unknown later responses stay uncertain. |
| Ticket Unavailable During Checkout | Retain the complete selection and allow explicit editing after the first definitive stock rejection. | `TIER_SOLD_OUT`, `TIER_NOT_FOUND`, `TIER_NOT_ACTIVE`; timeout followed by these codes never clears identity. |
| Free RSVP Full | Existing Spec06 RSVP full presentation and disabled action; positive remaining quantity is shortage, not full. | Actual public `availability.status: 'full'`, `remaining: 0`; existing rejection `{kind:'rejected', reason:'full', remaining?}` preserved. |
| Payment Declined | Stripe-hosted Checkout owns decline presentation and card retry. No fabricated local decline details. | Hosted-only navigation contract verified with fixtures; actual issuer decline not exercised. |
| Payment Failed | Terminal failure copy for persisted `payment_failed`. Verify cancellation before offering a new selection. | Canonical confirmation plus existing cancellation acknowledgment. |
| Payment Processing | Honest processing copy and bounded checks of the same order; no fake stages or new purchase. | Canonical `processing`; delayed webhook fixtures and existing SQL fulfillment proofs. |
| Checkout Cancelled | Await cancellation, reconcile race, then show verified cancellation. Failed/uncertain cancellation stays unknown. | Existing cancel response; paid wins cancellation race. |
| Payment Successful | Existing paid confirmation, actual amounts, original View tickets and collection, calendar, optional independent delivery notice. | Canonical `paid`; browser opens the same original ticket after uncertainty and preserves its QR on reload. |
| Unable to Confirm Payment | Amber uncertainty state with same-bearer status retry. No replacement attempt or guessed event action. | Transport/schema/status uncertainty, storage loss/corruption, ambiguous creation/cancellation and unresolved expired label. |

Visual adaptations preserve the existing Buyer Journey and reference hierarchy. Styles are scoped to recovery/paid availability. No inline card fields, invented last-four, issuer reason, fees, tax additions or processing stages. Null artwork stays absent. See `spec08-visual-proof.md` for inspected evidence.

## Spec06 and Spec07 integration / shared-file overlaps

Spec06 registration, capacity, private-link, issuance and recovery implementations remain unchanged. `PublicTicketEventPage.tsx` adds paid availability behavior while retaining `FreeRsvpEntry`. RSVP Full and positive quantity shortage use the actual Spec06 contract. Its five database suites pass 120 assertions, alongside browser integration and the full frontend/function suites.

Spec07 delivery/access is preserved: `/tickets/recover`, `/ticket-access`, optional paid `deliveryNotice`, original View tickets navigation and original collection. Delivery status does not affect payment polling, attempt cleanup, fulfillment or purchase retry. Its 12 database suites pass 187 assertions; production boundary inspection passes 104 artifacts.

Every shared production overlap:

| File | Narrow Spec08 change / preserved ownership |
|---|---|
| `src/features/orders/OrderConfirmationPage.tsx` | Payment recovery/cleanup/navigation; original paid deliveryNotice and View tickets preserved. |
| `src/features/buyer-journey/OrderConfirmationView.tsx` | Truthful payment state copy, optional recovery action and scoped styles; delivery/ticket/calendar slots retained. |
| `src/features/tickets/PublicTicketEventPage.tsx` | Paid stock/selection review; Spec06 free entry untouched. |
| `src/features/tickets/TicketTierList.tsx` | Retain unavailable selected quantities; disable stale availability. |
| `src/features/checkout/CheckoutPage.tsx` | Same-attempt recovery and original-selection replay using existing contracts. |
| `src/features/checkout/checkout.attempt.ts`, `checkout.cart.ts` | Durable lifecycle/readback and selection parsing; request identity and wire shape preserved. |
| `supabase/functions/stripe-create-checkout/index.ts` | Exact attached open-session reuse guard only. |

Corresponding tests are updated. Router, base Buyer Journey CSS, confirmation polling module, checkout/order API schemas, webhook fulfillment, ticket issuance and all inherited migrations are unchanged. `src/preview/screens.json` changes only its public-event rendering snapshot. A scanner production test now waits for the lazy loading state to settle before rerendering; its production implementation is unchanged. `tsconfig.e2e.json` includes the isolated browser config.

## Verification results

Counts below are separate suites and must not be summed as unique behaviors. Provider transports in unit/function/browser proofs are fixtures. Database assertions and concurrency scenarios ran against real local PostgreSQL with synthetic records.

| Check | Result | Evidence under `.superpowers/spec08/` |
|---|---:|---|
| Full frontend | 1,076 passed, 111 files | `vitest-final.log` |
| Recovery-focused frontend | 143 passed, 10 files; later confirmation regression 31 passed | task-1 report; `order-alert-green.log` |
| All functions | 303 passed | `functions-full.log` |
| Attached checkout session tests (included above) | 33 passed | targeted function log |
| Edge transaction-driver contracts | 35 passed | `edge-driver-contracts.log` |
| Safe integration suite | 258 passed, 5 skipped; 16 files passed, 1 skipped | `integration-safe.log` |
| Fresh local migration replay | 111 migrations | `database-fresh-replay.log` |
| Checkout database from beginning | 266 assertions, 10 files | `database-checkout.log` |
| New cardinality regression (included above) | 21 assertions | `database-checkout.log` |
| Spec06 database | 120 assertions, 5 files | `database-rsvp.log` |
| Spec07 database | 187 assertions, 12 files | `database-delivery.log` |
| Real local SQL concurrency | 5 scenarios passed | `database-concurrency.log` |
| Production browser journeys | 23 passed | `browser-final.log` |
| Screenshot inspection | 45 PNG captures, 320/390/768/1440 widths | `screenshots/` |
| Full typecheck (four configurations) | Passed | `typecheck-final.log` |
| Full lint | Passed, zero errors; all 18 reported errors resolved | `lint-final.log` |
| Function typecheck | Passed | `functions-check.log` |
| Production build | Passed | `build-final.log` |
| Spec07 production boundary | Passed, 104 artifacts | `production-delivery.log` |
| Ticket-shell production boundary | Passed | `production-tickets.log` |
| Final diff whitespace / frozen dependency checks | Passed | `frozen-final-check.json` |

Concurrency proves one winner among eight final-ticket buyers, one order across eight identical requests, atomic stock-race rollback, no deadlock for reversed overlapping carts, and one stored session/order with zero prepayment tickets across eight attached-session replays. Existing database suites cover fulfillment idempotency and inventory/ownership boundaries. Browser callbacks prove timeout→later stock rejection→eventual paid, retained identity after changed input/storage loss, awaited cancellation/payment race, delayed same-order polling, Spec06 availability and Spec07 notice/collection compatibility. Independent review found three issues (price acceptance, cancel-return selection, paid cleanup); each was fixed and rereviewed with no remaining actionable finding.

Reproduction commands from this worktree:

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm exec vitest run --maxWorkers=3 --exclude '**/.superpowers/**' --exclude '**/.worktrees/**'
pnpm exec deno task test
pnpm exec deno task check
pnpm exec deno test --allow-env tests/integration/edge/task17-transaction-driver/contracts.test.ts
pnpm exec playwright test --config playwright.spec08.config.ts
python3 tests/integration/spec08-database.py test
python3 tests/integration/spec08-checkout-concurrency.py
pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/verify-spec07-production.ts
pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/verify-ticket-shell-production.ts
RUN_STRIPE_TRANSACTION_PROOF=0 pnpm exec vitest run --config vitest.integration.config.ts   --exclude tests/integration/stripe-ticketing.test.ts   --exclude tests/integration/public-event-visibility.test.ts   --exclude tests/integration/ticketing-concurrency.test.ts   --exclude tests/integration/ticketing-database.test.ts   --exclude tests/integration/moderation-public-projection.test.ts
```

The guarded database runner accepts explicit SQL test paths for the Spec06/07 suites; their logs enumerate every file. It verifies the exact owned container ID, task label, loopback port 55485 and cron disabled before SQL. Test bootstrap adds an auth fixture shim for the cached local image; this is not another application migration. No linked/shared database shell was executed. The five integration skips are the unrelated `coreTicketTruthLiteCleanup.test.ts` auxiliary database cases requiring unset `WHERETO_TICKETING_DB_URL`; four shared/external database suites and the actual Stripe suite were explicitly excluded. Relevant Spec08/06/07 database proofs ran via the guarded local runner instead.

## Limits and remaining work outside authorization

No implementation blocker remains in the approved local scope. Actual Stripe TEST creation, decline, provider session expiry and webhook delivery were **skipped**, so this is not end-to-end Stripe TEST or deployed-environment certification. Fixtures prove application behavior; local PostgreSQL proves database behavior. No manual provider setup was performed.

The existing contract cannot safely resolve ambiguous creation with no attached session: it remains Unable to confirm payment and retains its identity. If a buyer erases every browser-storage trace and reloads without the original bearer, the application has no remaining signal identifying the lost attempt. Detectable record loss/corruption and active-page replay fail closed; recovering an entirely lost identity would require a separately approved contract, not a speculative Spec08 endpoint.

The migration is prepared and locally verified only. Applying it to a shared environment, deploying code or exercising Stripe TEST requires separate authorization. The isolated branch/worktree and task-owned cron-disabled database are preserved for review.

## Exact incremental file inventory

This inventory is relative to the frozen 716-file Spec07 baseline, excluding ignored local evidence/build/dependencies. Git also shows inherited uncommitted dependency work; it must not be attributed to Spec08.

### Modified (18)

- `src/features/buyer-journey/OrderConfirmationView.tsx`
- `src/features/checkout/CheckoutPage.states.test.tsx`
- `src/features/checkout/CheckoutPage.test.tsx`
- `src/features/checkout/CheckoutPage.tsx`
- `src/features/checkout/checkout.attempt.test.ts`
- `src/features/checkout/checkout.attempt.ts`
- `src/features/checkout/checkout.cart.test.ts`
- `src/features/checkout/checkout.cart.ts`
- `src/features/orders/OrderConfirmationPage.test.tsx`
- `src/features/orders/OrderConfirmationPage.tsx`
- `src/features/ticket-experience/runtime/production.test.tsx`
- `src/features/tickets/PublicTicketEventPage.test.tsx`
- `src/features/tickets/PublicTicketEventPage.tsx`
- `src/features/tickets/TicketTierList.tsx`
- `src/preview/screens.json`
- `supabase/functions/stripe-create-checkout/index.test.ts`
- `supabase/functions/stripe-create-checkout/index.ts`
- `tsconfig.e2e.json`

### Added (19)

- `Docs/superpowers/plans/2026-09-11-spec08-implementation.md`
- `Docs/testing/spec08-blocked-checkpoint.md`
- `Docs/testing/spec08-dependency-snapshots.md`
- `Docs/testing/spec08-verification.md`
- `Docs/testing/spec08-visual-proof.md`
- `playwright.spec08.config.ts`
- `src/features/buyer-journey/BuyerRecoveryView.tsx`
- `src/features/buyer-journey/buyer-availability.css`
- `src/features/buyer-journey/buyer-recovery.css`
- `src/features/checkout/checkout.recovery.test.ts`
- `src/features/checkout/checkout.recovery.ts`
- `supabase/migrations/20260914010800_restore_checkout_preflight_cardinality.sql`
- `supabase/tests/database/spec08_checkout_expiry.test.sql`
- `supabase/tests/database/spec08_preflight_cardinality.test.sql`
- `tests/e2e/spec08.spec.ts`
- `tests/e2e/support/spec08Harness.ts`
- `tests/integration/spec08-checkout-concurrency.py`
- `tests/integration/spec08-database-bootstrap.sql`
- `tests/integration/spec08-database.py`
