# Development buyer test world

Start from the repository root on a development branch:

```sh
pnpm dev:seed
pnpm dev
```

Open http://127.0.0.1:3000/preview and choose **Open live buyer flow**. The canonical event is `/events/8ad057c1-f7b1-4aec-90cb-260908000011`. Buyers need no login. Choose 2 General Admission ($20 each) and 1 VIP ($45): $85 for three individual tickets. Enter fictional details (`buyer@example.invalid`), continue to hosted Stripe TEST checkout, use the public test card 4242 4242 4242 4242 with future expiry/valid CVC/postal code, and return to confirmation. **View tickets** opens the real accountless collection. Open a ticket to see its admission QR. Bookmark your private ticket link yourself; never put it in source or reports.

## Scope and prerequisites

Uses the existing CLI-linked Supabase development project, `.env.local` public configuration and `TEST_CONNECTED_ACCOUNT_ID`. Requires operator CLI access, exact local/remote migration alignment, deployed checkout/webhook/confirmation/collection/admission functions, and the existing ready Stripe TEST connected account. It never creates or retires a Stripe account, retrieves secret values, or changes payment/fulfillment code. Seed intentionally enables the existing development checkout switch and sets the development redirect origin to `http://127.0.0.1:3000`. It refuses other publicly authorized paid events before enabling this shared switch. Do not use this command to reopen sales during an incident.

The temporary authenticated `dev-world-probe` checks Stripe readiness through the same `getStripe`, Accounts v2 include configuration and `validateApprovedConnectAccount` used by the existing Task17 fixture. Only readiness/test-mode and application origin return to the operator. The function and its one-time secret are removed in `finally`; no persistent administrative endpoint is installed. Production environment, live keys, mismatched project URL, migration drift, an account bound elsewhere, and identity conflicts fail closed. If an interrupted process leaves the probe behind, inspect and remove exactly `dev-world-probe` and `DEV_WORLD_PROBE_TOKEN` before rerunning; never remove unrelated functions/secrets.

## Reset and history

```sh
pnpm dev:reset
```

Reset uses the same fixed organizer/event/tier IDs. It replenishes capacity above all historical order-item quantities and refreshes aging event dates through the existing revision, moderation and publication paths. It does not clear reservations, paid orders, tickets, used timestamps, refunds, audit intervals, or webhook receipts. Existing browser checkout attempts keep their normal idempotency behavior. Cancel an unfinished checkout normally or let it expire. Reset preserves the project checkout gate and redirect origin; run seed only when intentionally enabling the development world. Cancelled events fail closed for operator review rather than being silently resurrected.

The seven events and one banned, passwordless synthetic organizer use `wheretoo-dev-world-v1` markers and fixed UUIDs in `src/preview/devWorldCatalog.ts`. Their names include `[DEV]`. All locations are sample Bay Area addresses with fictional venue descriptions; no real event is advertised. Six additional free event pages are for display; this task does not implement free RSVP.

Task14/17's existing inert audited namespace remains untouched. Its destructive proof lifecycle cannot own persistent buyer purchases: it removes tiers and tombstones its fixture after every proof, and can retire an account in some modes. This world reuses its TEST account and safety conventions but owns a separate persistent namespace. Do not run the destructive Stripe proof against the world's bound account. It will refuse a conflicting binding; use an independently approved proof account if that separate proof is needed.

## Preview versus real state

The local-development live doorway performs a full document navigation into the actual buyer app. It is removed from production builds, even when static previews are explicitly enabled. Static captures remain labeled Preview. Existing synthetic valid/used/refunded/cancelled ticket states are linked separately and are not purchased tickets. Apple/Google Wallet remains the existing “Coming later” capability. The production collection reader now receives real bearers in development; known fixture scenarios retain their isolated readers.

## Removal later

Remove the grouped operator code, temporary-probe source, catalog, `DevWorld` UI, package commands and corresponding tests. Data retirement must preserve financial and immutable moderation history: first close fixture sales, settle open payments through existing operational procedures, then archive/tombstone the exact fixed fixture identities. There is deliberately no blind delete/reset-all command. Do not remove or rotate the ticket credential secret.

## Verification commands

```sh
pnpm exec vitest run --exclude '.worktrees/**' scripts/dev-world/world.test.ts src/preview src/features/checkout src/features/orders src/features/ticket-experience src/app/router/router.test.tsx
pnpm typecheck
pnpm exec eslint scripts/dev-world src/preview src/features/ticket-experience/runtime/development.tsx src/features/ticket-experience/runtime/development.test.tsx
pnpm build
git diff --check
```

Browser verification must use the normal signed Stripe webhook. A redirect or fake paid database row is not proof. Check exact order/ticket counts, accountless collection, actual QR, and desktop/mobile layouts. No map work or production deployment belongs in this task.

## Verified September 8, 2026

- Branch `codex/dev-buyer-test-world-1`, based on `1d87c88`; no merge, commit, production deployment or map work.
- Seed ran twice: one persistent organizer, seven events, two tiers, same fixed identities. The original Task17 namespace and unrelated user events remain intact.
- Browser entered from /preview without login, selected 2 GA + 1 VIP, reviewed $85, and completed the public Stripe TEST card purchase on hosted Checkout. Normal webhook delivery produced a paid, reconciled order with two order items and exactly three unique tickets.
- **View tickets** opened one VIP and two GA admissions. Opening VIP mounted the Admission QR code. Private collection URLs and credentials are deliberately omitted from this record.
- Reset after purchase retained all three tickets and the order. Total capacities became 502 GA / 101 VIP, leaving the intended 500 / 100 available after the purchase. Checkout remained enabled. No order/ticket/refund deletion occurred.
- Desktop and 390 px mobile event/checkout inspected. Mobile checkout scroll width equals viewport width (390 px). The hub is left open at /preview, and the purchased QR remains in the other browser tab.
- Typecheck, scoped ESLint, production build, Deno probe check and git diff --check passed. Production assets contain neither the world catalog nor test-card instructions.
- Scoped Vitest: 378 passed, one pre-existing scanner mock-count failure (`runtime/production.test.tsx`, expects one camera factory call, sees two). The identical failure reproduces in a clean archive of starting commit `1d87c88`; no test was disabled or weakened. New world, hub and runtime tests pass.
- Remote cleanup checked: zero `dev-world-probe` functions and zero `DEV_WORLD_PROBE_TOKEN` secrets remain.

## Files changed for this task

- `README.md`
- `package.json`
- `scripts/dev-world/run.ts`
- `scripts/dev-world/world.ts`
- `scripts/dev-world/world.test.ts`
- `tests/integration/edge/dev-world-probe/index.ts`
- `src/preview/devWorldCatalog.ts`
- `src/preview/DevWorld.tsx`
- `src/preview/DevWorld.test.tsx`
- `src/preview/PreviewApp.tsx`
- `src/preview/PreviewApp.test.tsx`
- `src/preview/catalog.ts`
- `src/preview/preview.css`
- `src/features/ticket-experience/runtime/development.tsx`
- `src/features/ticket-experience/runtime/development.test.tsx`
- `Docs/superpowers/plans/2026-09-08-dev-buyer-test-world.md`
- `Docs/runbooks/dev-buyer-test-world.md`

No migrations or dependencies added. User-owned Visual Reference changes are untouched.

### Checkout cache expiry fix (2026-09-08)

Manual testing after the world had been idle exposed `CONNECT_NOT_READY`:
`get_checkout_preflight` rejected a Connect cache older than five minutes before
`stripe-create-checkout` could refresh it. Migration
`20260909010100_allow_checkout_preflight_status_refresh.sql` removes only the
preflight age condition. Fresh Stripe retrieval and validation, and the reservation
function's five-minute freshness requirement, remain required.

Applied to the linked development project only. The preflight query reproduced the
failure before migration and succeeded afterward. The transaction-scoped regression
`tests/integration/sql/dev-world-checkout-freshness.sql` verifies that an aged cache
permits preflight while reservation still rejects it, rolling back all fixture changes.
Browser retry reached Stripe Sandbox with two General Admission tickets totaling $40;
left payment completion to the user. This supersedes the original “no migrations” report.
