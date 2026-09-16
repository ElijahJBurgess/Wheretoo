# Spec 08 + Spec 09 frozen local integration

Status: locally integrated and verified. No implementation blocker or contract conflict remains. No commit, merge to main, push, deployment, shared database mutation, provider change, actual Stripe TEST transaction or real email send occurred.

## Checkout and exact sources

- Integration worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec08-spec09-integration`
- Integration branch: `codex/spec08-spec09-integration`
- Starting and final HEAD: `94c546bd0961f501584f8a3437298b2331cafd5c`; the result is intentionally uncommitted.
- Shared dependency baseline: the approved 716-file Spec 07 snapshot, including Spec 04–06 prerequisites. SHA-256 of the sorted compact JSON file map: `9306b44aa805738511d3742df5f59e916eab4049695a003dd5fcafc3ca3900e2`.

| Source | Exact worktree | Branch | HEAD | Dirty tracked / untracked files | Snapshot files | File-map SHA-256 |
|---|---|---|---|---|---:|---|
| Spec 08 | `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec08-payment-recovery` | `codex/spec08-payment-recovery` | `94c546bd0961f501584f8a3437298b2331cafd5c` | 79 / 151 | 735 | `c3c07aa4e7c53f52f824e24972168a711a29bbdf9496c4f656626f0042457104` |
| Spec 09 | `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec09-refund-support` | `codex/spec09-refund-support` | `94c546bd0961f501584f8a3437298b2331cafd5c` | 72 / 186 | 770 | `b180dae026056d6d9e1e5de1f5e072664d23846e44ef4cabc791d04c3a36c4a2` |

Exact porcelain status, per-file hashes, and source archives are in `.superpowers/spec08-spec09/spec08-source.json`, `spec09-source.json`, and the corresponding `*-source.tar.gz`. Both source worktrees retained zero file/status drift. The final combined file map and archive are `.superpowers/spec08-spec09/frozen-baseline.json` and `frozen-baseline.tar.gz`, with archive SHA-256 recorded separately. They capture local source and reports, excluding ignored dependencies, machine configuration and test evidence.

The 202 files changed in both source snapshots relative to HEAD are individually classified in [source reconciliation](spec08-spec09-source-reconciliation.md). Relative to their actual common dependency baseline, Spec 08 changes 37 files and Spec 09 changes 71, with no intersection. The 789-file automatic source union therefore preserves both implementations. The only narrow production reconciliations are the three deferred attachments below and schema-derived type verification. No contract conflict was found.

## Reconciled files and applied deferred patches

1. `src/app/router/router.tsx`: added exactly one lazy `/refund-details` route beside `/ticket-access`. Purchase, checkout, private ticket collection, RSVP, recovery and ticket-access routes remain present. Router tests prove no duplicate public definitions.
2. `src/features/buyer-journey/OrderConfirmationView.tsx`: applied the exact canonical refunded copy and refund-only `RefundSupportContext` with the already-authorized order number. Paid confirmation, original View tickets navigation, calendar, deliveryNotice, recovery actions and props are unchanged. `OrderConfirmationPage.tsx` remains byte-identical to Spec 08.
3. `src/features/ticket-experience/customer/FocusedTicketView.tsx`: applied only refund-status support context. Inactive artwork, credential discriminated union, QR gating, existing Used presentation and optional timestamp are unchanged. No financial bearer, credential generation, new query, fabricated reference or private-link parser expansion was added.
4. `src/lib/supabase/database.types.ts`: regenerated from the combined disposable schema, rather than copying a source branch or querying a linked environment. The resulting public schema is byte-identical to Spec 09 after trimming one trailing blank line. Spec 08 changes only a function body, not its type signature.

Spec 09's owned organizer attachment, durable refund operations, refund_notice worker support, configured support component and secure financial access are included from its source snapshot without redesign. Payment, refund and delivery continue to use their distinct existing authorities. Full integration-only inventory: [files](spec08-spec09-integration-files.md); reviewed patch: `.superpowers/spec08-spec09/integration-only.diff`.

## Migration order and fresh schema proof

All 110 inherited migrations remain byte-identical. The final additions, in chronological replay order, are:

1. `20260914010000_add_refund_operations.sql` — Spec 09.
2. `20260914010200_add_refund_notice.sql` — Spec 09.
3. `20260914010800_restore_checkout_preflight_cardinality.sql` — Spec 08, exact 3 → 10 distinct tier ceiling correction.

All 113 timestamps are distinct. All migration files match their source SHA-256; no earlier migration was rewritten and no integration migration was added. All 113 replayed successfully from an empty application schema. The Spec 08 cardinality and expiry regressions passed on the combined schema.

SQL ran only through `tests/integration/spec08-spec09-database.py`, which refuses arbitrary URLs/targets and checks exact recorded container ID, name, task label, loopback port and disabled cron before every SQL operation. New local container: `whereto-spec08-spec09-db`, label `wheretoo.task=spec08-spec09-integration`, port `127.0.0.1:55505`; REST uses a separately verified integration container on 55506. Edge harnesses use 55507/55517 and injected financial/mail providers, with Deno network permission restricted to loopback.

The inherited Spec 07 serial browser setup rebuilds only this recorded disposable integration DB to keep its fixed fixture namespace clean. Every rebuild replayed all 113 migrations; IDs and replay results are recorded in `database-first-identity.json`, `database-identity.json`, `migration-replay.log`, and browser logs. Original Spec 07/08/09 containers were never mutated. Final public types were regenerated again after the final fresh replay and matched the checked-in-path type file. Fixture auth compatibility and cron deactivation are test bootstraps, not application migrations.

Type generation used:

```sh
pnpm exec supabase gen types typescript --db-url 'postgresql://supabase_admin:spec08-spec09-disposable-only@127.0.0.1:55505/postgres' --schema public
```

The password is exclusively the synthetic disposable-container password. `pnpm db:types` was not run because it targets a linked environment.

## Fresh verification results

Counts are independent suite results, not unique behaviors to sum. Unit/function transports are fixtures. SQL and concurrency use real local PostgreSQL and synthetic records. Browser refund/delivery proofs mount the production routes, production handlers and canonical local SQL with injected providers.

| Check | Result | Evidence under `.superpowers/spec08-spec09/` |
|---|---:|---|
| Full frontend `pnpm test --maxWorkers=3` | 1,111 passed, 118 files | `frontend-final.log` |
| Deferred attachment regressions, included above | 79 passed, 3 files; 4 expected failures before attachment | `attachments-red.log`, `attachments-green.log` |
| Full functions `pnpm test:functions` | 321 passed, 0 failed | `functions.log` |
| Edge transaction-driver contracts | 35 passed | `edge-driver.log` |
| Safe integration suite | 258 passed, 5 skipped; 16 passed files, 1 skipped | `integration-safe.log` |
| Checkout/Spec 08 SQL | 266 assertions, 10 files | `sql-regressions.log` |
| Spec 06 free RSVP SQL | 120 assertions, 5 files | `sql-regressions.log` |
| Spec 07 email SQL | 187 assertions, 12 files | `sql-regressions.log` |
| Spec 09 refund SQL | 146 assertions, 4 files | `sql-regressions.log` |
| Spec 04 organizer / Spec 05 admission regressions | 63 / 23 assertions, 1 file each | `sql-regressions.log` |
| New combined lifecycle SQL | 30 assertions | `cross-spec-sql.log` |
| New combined notice-failure SQL | 23 assertions | `cross-spec-notice-sql.log` |
| All selected SQL totals | 858 assertions, 35 files, 0 failures | Three SQL logs above |
| Spec 08 real SQL concurrency | 5 scenarios passed | `concurrency08.log` |
| Spec 09 real SQL concurrency | 4 scenarios passed | `concurrency09.log` |
| Spec 07 real SQL concurrency | 5 scenarios passed | `concurrency07.log` |
| Spec 08 production browser | 23 passed | `browser08-final.log` |
| Extended Spec 09 + cross-spec production browser | 1 complete journey passed | `browser09.log` |
| Spec 07 production browser | 7 passed | `browser07-final.log` |
| Full configured TypeScript checks | Passed | `typecheck-final.log` |
| ESLint | Passed, no warnings/errors | `lint-final.log` |
| Function typecheck | Passed | `functions-check.log` |
| Both adapted browser Edge harness typechecks | Passed | `browser-edge-check.log` |
| Production build | Passed | `build.log`, final Spec 07 browser build |
| Spec 07 production boundary | Passed, 108 artifacts | `production-boundaries.log` |
| Ticket-shell production boundary | Passed | `production-boundaries.log` |
| Diff whitespace, source/migration preservation | Passed | `preservation-check.json`, `diff-check.log` |
| Independent integration code review | No actionable findings | `independent-review.md` |

The first frontend run lacked local browser environment values and could not load 23 suites. An ignored `.env.local` containing only synthetic values resolved that setup issue. The deliberate attachment red tests then failed for the missing route/copy/support and passed after the exact patches. Browser initial attempts exposed test-only hostname/Origin mismatches and an orphaned diagnostic preview port; those adapters were corrected and the final runs above passed. No product behavior was weakened to make a test pass.

## Spec 08 state coverage

All minimum states pass the existing frontend and production browser proofs: Sold Out; Tickets unavailable without an invented sales-closing reason; Ticket unavailable retaining the cart; RSVP Full versus positive capacity shortage; hosted Checkout navigation/decline ownership; persisted payment failed; payment processing with bounded same-order polling; verified checkout cancelled; successful paid confirmation; and Unable to confirm payment.

Same request ID/bearer and hosted-session reuse survive ambiguity/retries; storage loss and changed input cannot mint a replacement; cancellation waits and reconciles a payment race; unknown/expired labels alone cannot authorize replacement checkout. The original View tickets destination and QR survive uncertainty resolving to paid and reload. Actual issuer decline was not exercised: hosted behavior here is an intercepted navigation fixture, not Stripe TEST proof.

## Spec 09 state coverage

Processing, failed, unknown, review and completed states remain distinct; submission creates one durable order-bound operation before dispatch. Eight actual lock waiters grant one provider dispatch; lost responses and concurrent retries cannot create a new operation or rotate its key. Delayed unknown observations cannot erase failure. Only exact canonical reconciliation closes a refund. Concurrent repeated canonical completion keeps one refund/receipt, preserves Used and its original timestamp, refunds only unused admissions, releases inventory once and preserves historical $70/3 sold/1 order/3 issued/1 used metrics.

## Required cross-spec scenarios

| Scenario | Evidence/result |
|---|---|
| Successful purchase → refund submission → complete | Real fulfillment SQL and production paid confirmation/private collection → real organizer refund handler → authoritative refund writer → completed production views. |
| Successful purchase → refund unknown → reload/status reconciliation | Combined SQL preserves the operation and denies a second dispatch; production browser reloads unknown and later observes canonical completion. Original Spec 09 handler/unit/concurrency tests cover timeout recovery. |
| Processing payment cannot expose refund actions | Combined SQL owner projection is ineligible/action none; server claim dispatch false; refund UI ineligible regression has no refund button. |
| Failed/cancelled payment cannot look like refundable paid order | Combined SQL probes payment_failed/cancelled/expired, all ineligible and unable to dispatch; no operation is created. |
| Completion preserves checkout identity | Combined SQL compares order ID, client request ID, confirmation hash and hosted session before/after refund. |
| Completion preserves original private collection | Same original bearer resolves after refund; production browser revisits the original private URL and confirms the same selectors and three admissions. |
| Buyer refund history and focused tickets agree | Canonical confirmation says refunded; original unused focused ticket is Refunded with no QR; financial page shows two Refunded and one Used with original timestamp. |
| refund_notice delivery failure cannot alter money | 23-assertion failure SQL proves completed financial state and refunded original confirmation while delivery state is failed; UI tests also preserve completion on notice failure. |
| Spec 07 delivery remains separate | 187 SQL assertions, 7 production browser journeys, worker/function suites, failed notice on successful payment, original access/recovery routes and grants. |
| No duplicate orders/refunds/tickets/admissions | 30 combined assertions plus checkout/refund/RSVP/email races prove one request/order, one refund operation/provider identity/refund, original issued IDs/credentials and once-only inventory effects. |

Free RSVP isolation, paid/free private-link parsing, ticket-access routes, delivery notice, email grants and QR equality/credential preservation passed in the full suites and focused Spec 06/07 database/browser proofs.

## Visual and privacy verification

Scope: integrated local production build, synthetic organizer managing a paid order and anonymous buyer opening confirmation, original tickets and financial history. Representative routes: `/organizer/events/:eventId/orders/:orderId`, `/orders/:bearer`, `/tickets/:bearer/:selector`, `/refund-details#<synthetic grant>`; grants/bearers are not persisted in report URLs. Viewports: 320, 390, 768, 1440 CSS pixels. Reference is the approved source handoff/unchanged UI; this is an integration audit, not a redesign or global accessibility certification.

Project Playwright evidence (Level B) verifies route reachability, responsive horizontal bounds, dialog opening/focus/Cancel, original QR reload equality, refund QR removal, fragment stripping, Used/Refunded counts and revoked-link cached-data denial. Inspected images include `browser-visual/buyer-320.png`, `buyer-390.png`, `completed-1440.png`, `confirm-390.png`, plus Spec 08 `paid-320.png` and `unable-confirm-320.png`. No clipping/overlap or lost essential action was found in these inspected states. The narrow dialog scrolls internally; its heading is visible at opening and its confirmation action was exercised. Additional captures remain supporting artifacts, not an assertion that every image was visually inspected. No desktop/native or physical-device claim is made. Deployment status: not applicable; only the local combined build was served.

The paid collection DTO intentionally remains unchanged: exact paid Used timestamps are available through the authorized organizer/financial history; this integration does not invent a timestamp/reference in an admission DTO that does not supply it. Valid tickets still expose QR only where authorized; Used/Refunded/Cancelled states do not expose active QR. Refund history never generates credentials or turns financial grants into admission access.

## Reproduction and remaining limits

Run configured checks from this integration worktree using the ignored synthetic browser configuration. Use only `tests/integration/spec08-spec09-database.py` for integration SQL. Original source reports and original spec-specific DB runners are historical provenance; do not use those runners to mutate source containers. SQL suites should run before persistent browser/concurrency fixtures. The dedicated runner rebuild command verifies the recorded integration ID before removing only that disposable container and replaying its schema.

- Browser Spec 08: `pnpm exec playwright test --config playwright.spec08.config.ts` (local preview 3028).
- Browser Spec 07: `pnpm exec playwright test --config playwright.spec07.config.ts` (guarded fresh DB replay, loopback Edge 55517 and preview 3027; existing integration REST required).
- Browser Spec 09: verified integration REST on 55506, then `pnpm exec deno run --allow-env --allow-read=.superpowers/spec08-spec09 --allow-run=docker --allow-net=127.0.0.1:55506,127.0.0.1:55507 tests/integration/edge/spec09-local/index.ts`, production preview on 3029, and `pnpm exec playwright test --config playwright.spec09.config.ts`.
- Concurrency: `python3 tests/integration/spec08-checkout-concurrency.py`, `spec09-refund-concurrency.py`, `spec07-email-concurrency.py`; each adapted script uses the integration guard.

Safe integration excluded actual Stripe and the four shared/external database suites (`stripe-ticketing`, `public-event-visibility`, `ticketing-concurrency`, `ticketing-database`, `moderation-public-projection`). Five unrelated `coreTicketTruthLiteCleanup` auxiliary DB cases skipped because `WHERETO_TICKETING_DB_URL` was intentionally unset; required database behaviors ran through the guarded disposable runner instead.

Actual Stripe TEST creation/issuer decline/settlement/session expiry/webhook delivery, real Resend sends/inbox rendering and physical-camera scanning were not performed. This is local application/schema proof, not provider or deployed certification. No manual production setup was required or performed. Future activation still needs separately authorized Spec 07 provider/worker/support configuration and migration/deployment rollout. Source branches, main and existing shared services remain untouched.

No remaining blocker exists in the requested local integration scope. All diagnostic Edge/preview processes started for verification are stopped; the integration DB/REST may remain for inspection with cron and worker execution disabled.
