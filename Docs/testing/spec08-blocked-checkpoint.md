# Spec 08 — historical blocked checkpoint

Superseded by the user-approved one-migration exception and resumed verification. See `spec08-verification.md` for the final state. The material below records the earlier stopped checkpoint, not current defects.

Implementation stopped on discovery of a frozen dependency contract conflict, per the user's explicit stop condition. This is **not a completion report or release approval**. No further source changes or verification are authorized until the conflict is resolved.

## Worktree and baseline

- Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec08-payment-recovery`
- Branch: `codex/spec08-payment-recovery`
- Starting and current HEAD: `94c546bd0961f501584f8a3437298b2331cafd5c`
- No commits, merges, pushes, deployments, provider changes, or real transactions.
- Frozen Spec06 (634 files) and Spec07 (716 files) source snapshots are documented in `spec08-dependency-snapshots.md`; source file hashes still match both manifests at stop.
- Isolated worktree inherited the entire frozen Spec07 integrated working snapshot, including Spec06. Changes below are incremental against that snapshot, not the much older Git HEAD.
- Exact original content is archived in `.superpowers/spec08/baseline.tar.gz`; file hashes are in `baseline.json`.

## Contract blocker

`supabase/migrations/20260902010250_expand_checkout_cart_tier_cardinality.sql` explicitly expanded service preflight to 1–10 distinct requested tier IDs, independently of the event-authoring maximum of three configured tier types.

The frozen inherited `supabase/migrations/20260909010100_allow_checkout_preflight_status_refresh.sql:21` replaces that function and restores `cardinality(p_tier_ids) not between 1 and 3`. This regresses the existing checkout boundary while refreshing the stale Connect preflight behavior.

Reproduced in the owned disposable database after all 110 inherited migrations: `checkout_integrity_reservation.test.sql`, assertion 16, “preflight accepts ten distinct tier identifiers before authoritative lookup”, receives `P0001: CHECKOUT_INPUT_INVALID`; expected `P0001: TIER_NOT_ACTIVE`. Authoring still limits actual configured tiers to three; this is a service contract regression, not evidence of an oversell or charge.

The failed assertion is retained unchanged. We did not mask it, narrow the client contract, edit a frozen migration, or apply a corrective migration.

### Concrete proposed resolution requiring approval

Approve one forward-only corrective migration, `20260911010800_restore_checkout_preflight_cardinality.sql`, that reads `pg_get_functiondef('private.get_checkout_preflight(uuid,uuid[])'::regprocedure)`, asserts exactly one occurrence of `cardinality(p_tier_ids) not between 1 and 3`, replaces only that expression with `cardinality(p_tier_ids) not between 1 and 10`, and executes the resulting definition. Preserve the September 9 Connect refresh logic, function security, schema, signature, grants, reservation behavior, and every wire field. This follows the existing September 2 migration's guarded transformation. No migration file has been created.

Alternatively, resume from an explicitly approved corrected dependency snapshot. Either path requires resolving the user's no-migration/frozen-dependency constraint first.

## Attempt-safety work present, review incomplete

- Existing storage keys and original request ID/bearer fields preserved. Added client-only submission lifecycle evidence and a seen marker; malformed/unreadable and previously present-but-missing storage fail closed.
- Changed cart/email cannot overwrite an existing unresolved identity. Legacy records are treated conservatively as possibly submitted.
- Submission state is persisted before transport. First definitive pre-reservation stock rejection can be explicitly released; the same rejection after earlier uncertainty remains unresolved.
- Same-request hosted retry first checks the same bearer, then reuses the original canonical request ID/bearer. No replacement on timeout, not-found, processing, or an expired label alone.
- Cancellation is awaited, coalesced, and reconciled by same-bearer confirmation on failure. Strict existing cancellation acknowledgment gates cleanup and replacement.
- Stripe attached session responses now require exact stored session ID and open status. Existing safe release rules remain in place.
- Canonical paid uses the original ticket link and optional Spec07 deliveryNotice. Payment results and email results remain separate.
- Saved association is created from a validated public event/submission; no event route is derived from a bearer. Final navigation/security review is still pending.

### Known unfinished attempt-safety issues — do not release

The implementation report identified these gaps before stopping; passing targeted tests do not establish full attempt safety:

- If all session storage is deleted during an active page, the record and seen marker are both gone. Current explicit replay lacks an expected-original-bearer guard and can mint a replacement identity. This needs a regression and an in-memory identity guard before replay; complete state loss across reload cannot be inferred from absent browser data.
- Persistence readback compares original identity fields but not newly added lifecycle/association/selection. A stale lifecycle write could escape validation; compare the full record.
- Concurrent different submissions for the same event currently share the first operation's result rather than explicitly rejecting mismatched input; they create no second checkout but should not receive another input's hosted result.
- Current availability may block original hosted replay when an existing order's tier disappears. Reconcile same-order behavior before considering the flow complete.
- Checkout's recovered processing view links to the existing automatic polling route and supports manual checks; it does not automatically poll in that checkout view.
- Failure/unknown headings and responsive reference adaptation still require final review. Eighteen lint errors remain.

## Ten reference-state checkpoint

| State | Implementation at stop | Evidence / remaining work |
|---|---|---|
| Event Sold Out | Current, nonempty all-sold-out paid tiers disable purchase and say Sold out; mixed tiers remain purchasable | Public-page unit tests pass; browser/reference audit pending |
| Sales Closed | No canonical closed reason invented; generic unavailable remains the intended adaptation | Stale availability test passes; final checkout generic-error presentation review pending |
| Ticket Unavailable During Checkout | Whole cart retained; first definitive stock rejection offers explicit edit; refreshed missing/changed tiers require review | Recovery/cart/page tests pass; browser cart-race proof pending |
| Free RSVP Full | Uses unchanged Spec06 `get_public_free_rsvp` full/remaining contract; existing quantity-shortage flow retained | 120 Spec06 pgTAP assertions pass; browser integration pending |
| Payment Declined | Stays in Stripe-hosted Checkout; no local issuer details or fake fields added | Existing transport retained; actual Stripe TEST decline proof skipped |
| Payment Failed | Persisted payment_failed has terminal failure copy; replacement requires verified cancellation | Targeted page tests pass; visual and final safety review pending |
| Payment Processing | Same-order confirmation polling preserved; same-request hosted retry only after same-bearer check | Recovery tests pass; delayed webhook browser sequence pending |
| Checkout Cancelled | Awaited cancellation and strict acknowledgment; races resolve to same-order truth | Recovery/page tests pass; browser race proof pending |
| Payment Successful | Existing success view, original View tickets and optional deliveryNotice preserved | Targeted confirmation tests and 187 Spec07 pgTAP assertions pass; browser ticket identity proof pending |
| Unable to Confirm Payment | Unknown attempts retain identity and block replacement | Core uncertainty tests pass; final copy alignment, lint and browser verification incomplete |

## Dependency ownership and shared-file overlaps

The following protected local areas remain byte-identical to frozen Spec07: `src/features/rsvp/`, `src/features/ticket-delivery/`, `src/app/router/`, and all `supabase/migrations/`. No Spec08 migration exists.

Shared overlaps: `PublicTicketEventPage.tsx` keeps Spec06 FreeRsvpEntry and only changes paid availability/cart behavior. `OrderConfirmationPage.tsx` and `OrderConfirmationView.tsx` receive payment recovery patches while retaining Spec07 paid-only deliveryNotice and original reloadDocument View tickets route. The inherited scanner runtime test receives only a Suspense-commit wait before rerender; scanner production code is unchanged. Buyer base CSS is unchanged; new styles are separate.

## Verification performed

All logs below are in `.superpowers/spec08/`. Counts are per command and overlap; do not add them as unique tests.

| Command / proof | Result |
|---|---|
| Offline frozen pnpm install | 339 packages installed; no provider configuration copied |
| Corrected baseline Vitest (`--maxWorkers=3 --exclude '**/.superpowers/**' --exclude '**/.worktrees/**'`) | 1,059 passed, 1 failed, 110 files. Failure: inherited scanner test rerendered before Suspense committed |
| PublicTicketEventPage + TicketTierList new red run | 7 failed, 18 passed — expected missing behaviors reproduced |
| `pnpm exec vitest run src/features/tickets/PublicTicketEventPage.test.tsx src/features/tickets/TicketTierList.test.tsx src/features/ticket-experience/runtime/production.test.tsx --maxWorkers=2` | 27 passed, 3 files |
| Task1 identity/cart/recovery targeted run | 32 passed, 3 files |
| `pnpm exec vitest run src/features/checkout src/features/orders --maxWorkers=2 --exclude '**/.superpowers/**'` | 128 passed, 10 files; covers checkout and order pages, not the complete Spec07 frontend suite |
| `pnpm exec deno test --allow-env supabase/functions/stripe-create-checkout/index.test.ts` before guard | 32 passed, 1 failed: returned 200 for an unrelated attached session |
| Same Deno command after guard | 33 passed, 0 failed; exact stored open session reuses; mismatched/complete/expired sessions never redirect/create/attach |
| `python3 tests/integration/spec08-database.py migrate` | 110 inherited migrations replayed in owned disposable container; cron execution disabled at process startup |
| `python3 tests/integration/spec08-database.py test` | 211 pgTAP assertions passed, 1 failed across 7 reached files; halted on cardinality blocker. Later files not reached |
| `python3 tests/integration/spec08-checkout-concurrency.py` | 5 real concurrent SQL scenarios passed: eight final-ticket buyers one winner; eight same-request replays one order; four stock-race carts atomic rollback; reversed overlapping carts no deadlock; eight attached replays one session/order and zero prepayment tickets |
| Spec06 five free_registration suites through Spec08 DB runner | 120 pgTAP assertions passed |
| Spec07 twelve email suites through Spec08 DB runner | 187 pgTAP assertions passed |
| Typecheck/lint | Interim `pnpm typecheck` failed on two unused test constants; later `pnpm exec tsc -b --pretty false` passed. Full multi-config typecheck was not repeated. Scoped eslint has 18 errors (render-time ref access and unused compatibility parameter); not cleared at stop |
| Full final Vitest/function suite, final lint/typecheck/build, browser/visual proofs, final independent review | Not completed — stopped on contract blocker |
| Actual Stripe TEST | Skipped. No actual provider session, decline, payment, or webhook was exercised. Deno provider doubles and SQL fixtures are not Stripe TEST proof |

The first baseline command mistakenly discovered an archived source backup and lacked synthetic env; it was interrupted and replaced by the corrected baseline above. The backup now lives in a tar archive and cannot be discovered as duplicate tests.

Disposable-only harness adaptations: adds missing cached-image `auth.users.banned_until` shim; uses Spec07's existing local auth/policy bootstrap; disables all inherited cron jobs. New `spec08_checkout_expiry.test.sql` preserves original expiry behavior assertions but expects inactive jobs and Spec07's revoked cron object privileges. This owned variant was queued after the failed reservation suite and was not reached in the latest run. These are test-environment changes, not application migrations or provider changes.

The DB is `whereto-spec08-db`, exact ID recorded in `.superpowers/spec08/database-identity.json`, task label `wheretoo.task=spec08-payment-recovery`, loopback port 55485, cron execution off. Other task databases were not accessed. Synthetic fixture records remain in this disposable container for inspection.

The scoped lint command was `pnpm exec eslint src/features/checkout src/features/orders src/features/buyer-journey/OrderConfirmationView.tsx src/features/buyer-journey/BuyerRecoveryView.tsx`. Task1's detailed stopped report is `.superpowers/sdd/2026-09-11-spec08-implementation/task-1-report.md`.

## Incremental files changed

Modified (16):

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
- `supabase/functions/stripe-create-checkout/index.test.ts`
- `supabase/functions/stripe-create-checkout/index.ts`

Added before this report (11):

- `Docs/superpowers/plans/2026-09-11-spec08-implementation.md`
- `Docs/testing/spec08-dependency-snapshots.md`
- `src/features/buyer-journey/BuyerRecoveryView.tsx`
- `src/features/buyer-journey/buyer-availability.css`
- `src/features/buyer-journey/buyer-recovery.css`
- `src/features/checkout/checkout.recovery.test.ts`
- `src/features/checkout/checkout.recovery.ts`
- `supabase/tests/database/spec08_checkout_expiry.test.sql`
- `tests/integration/spec08-checkout-concurrency.py`
- `tests/integration/spec08-database-bootstrap.sql`
- `tests/integration/spec08-database.py`

This checkpoint report is also newly added. Ignored manifests, logs, local synthetic environment, baseline archive and task ledger/report are local evidence, not production source.
