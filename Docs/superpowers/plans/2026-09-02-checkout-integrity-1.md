# Whereto Checkout Integrity 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely evolve Whereto's proven single-ticket checkout into one bounded multi-tier cart that produces one order, one immutable order item per distinct tier, one Stripe Checkout line per order item, and one individual ticket per purchased admission without weakening money, inventory, idempotency, refund, or security guarantees.

**Architecture:** PostgreSQL remains authoritative for cart canonicalization, purchase-time snapshots, integer money, event/tier locking, inventory, lifecycle, fulfillment, refunds, and bearer-safe confirmation. Supabase Edge Functions accept only strict non-financial intent, create and reconcile one Stripe test-mode destination-charge Checkout Session, and fail closed on any mismatch. React owns only accessible quantity selection, tab-scoped retry credentials, hosted-Checkout handoff, and safe persisted confirmation presentation.

**Tech Stack:** Node 22, pnpm 11, React 19, TypeScript 6, Vite 8, React Router 7, TanStack Query 5, Zod 4, Supabase PostgreSQL/PostgREST/Auth/Edge Functions, Deno 2.9.5, `stripe@22.5.0`, pgTAP, Vitest, React Testing Library, Playwright, and Stripe-hosted Checkout in test mode.

**Spec:** `Docs/superpowers/specs/2026-09-02-checkout-integrity-design.md`

## Global Constraints

- Before Task 1, read `AGENTS.md`, the approved Checkout Integrity specification, the three V1 product documents, and the effective Day 2/Build 2.5 migrations. Do not reinterpret the approved architecture.
- Create an isolated `codex/checkout-integrity-1` worktree with `superpowers:using-git-worktrees`. The current `Visual Reference /` changes are user-owned and must remain untouched in the original checkout.
- Use `superpowers:test-driven-development` for every behavior: write the narrow failing test, run it and record the intended RED, implement only that task, run focused GREEN, then run the listed regression set.
- Use `superpowers:systematic-debugging` for unexpected failures. Do not patch around a failing money, inventory, concurrency, idempotency, security, or reconciliation assertion.
- Use `superpowers:requesting-code-review` and `superpowers:receiving-code-review` after every task. Fix evidence-backed Critical/Important findings before the task commit.
- Applied migrations are immutable. All schema changes in this plan are new forward-only migrations after `20260826011475_restore_ticket_tier_owner_precheck.sql`. If an applied migration is wrong, add the next timestamped migration; never edit or replay it.
- Never parallelize migrations, linked Supabase commands, generated database types, Edge deployment, real Stripe proof, or contract cleanup. The linked CLI's ephemeral login role is not concurrency-safe.
- Before every linked database mutation, prove the linked Supabase project is the known development project. Before every Stripe operation, run the nonprinting credential gate and prove every retrieved or created object has `livemode === false`.
- Never print, log, persist in reports, pass as CLI arguments, or commit Stripe restricted keys, webhook secrets, Supabase service credentials, authorization tokens, confirmation bearers, buyer PII, raw IP addresses, raw webhook bodies, hosted Checkout URLs, or payment details.
- Keep `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` as the only Stripe credential allowed in client code. All restricted/server secrets remain managed Edge secrets.
- The browser may send only event ID, normalized buyer intent, client request UUID, tier IDs, quantities, and the independent confirmation bearer header. It never sends authoritative prices, fee values, totals, destination IDs, Stripe IDs, inventory, refund amounts, or fulfillment state.
- The maximum is ten admissions per order. Duplicate tier IDs are rejected. Each item quantity is `1..10`; aggregate quantity is `1..10`; all items belong to one event and organizer.
- Preserve the current fee semantics exactly: calculate the percentage once against aggregate subtotal, add `platform_fixed_minor * order.quantity`, add the existing processing estimate only when configured, and require application fee `< subtotal`. Do not add fee-basis or per-order-fee schema.
- Automatic refunds are whole-order only and use `reverse_transfer: true` plus `refund_application_fee: true`. A partial or economically incomplete refund is `requires_review`, invalidates the whole ticket set conservatively, and continues to hold all inventory.
- The checkout-creation kill switch gates only new order creation. Existing idempotent requests, webhooks, payment reconciliation, fulfillment, cancellation, expiration, refunds, cleanup, and confirmation remain operational.
- Preserve Build 2.5's canonical public-eligibility and lock boundaries. Do not modify map/discovery work or organizer analytics. Existing rows with one item and quantity one remain naturally valid; do not build a permanent V1/V2 compatibility layer.
- Database RED/GREEN protocol: first run the exact pgTAP command listed by the task. If the established Supabase CLI Docker `LegacyDockerRunError` prevents pgTAP from starting, run the unchanged SQL file through the authenticated linked rollback-only query path, record both results, and prove no fixtures or `pgtap` extension state leaked.
- Before each `db push`: run `pnpm exec supabase migration list --linked`, `pnpm exec supabase db push --linked --dry-run`, and verify the dry-run lists exactly the task migration(s). Then push sequentially and re-check local/remote history.
- After each task: run `git diff --check`; review `git diff --stat` and `git status --short`; run a nonprinting credential scan; stage only the listed files; run `git diff --cached --check`; and make the listed small commit.
- Use this nonprinting staged credential gate after every task:

```bash
if git diff --cached --binary --no-ext-diff | LC_ALL=C grep -Eq '(rk_(test|live)_[A-Za-z0-9]|sk_(test|live)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9])'; then
  printf '%s\n' 'Credential-like value detected in staged changes.' >&2
  exit 1
fi
```

- Transaction-integrity failures are release-blocking. Responsive/accessibility and broad regressions remain required, but an unrelated low-severity visual defect is not classified as equivalent to a money, inventory, ticket, refund, idempotency, or security defect.

---

## Finalized Interfaces

### Browser-to-checkout request

```ts
export type CheckoutCartItem = {
  tierId: string
  quantity: number
}

export type CheckoutInput = {
  eventId: string
  buyerName: string
  buyerEmail: string
  clientRequestId: string
  items: CheckoutCartItem[]
}
```

The body contains exactly those five keys. The independent 32-byte canonical base64url bearer travels only in `X-Whereto-Confirmation-Bearer`. The Checkout response remains exactly `{ checkoutUrl: string }`.

### Browser retry record

```ts
export type CheckoutAttemptRecord = {
  contractVersion: 'checkout_integrity_v1'
  submissionFingerprint: string
  clientRequestId: string
  confirmationBearer: string
}
```

The record is stored under `whereto.checkout-attempt.v1:<eventId>` in `sessionStorage`. `submissionFingerprint` is SHA-256 over the canonical event, normalized buyer identity, and sorted tier/quantity pairs. The clear buyer identity is not stored. Same fingerprint reuses both random values; a changed fingerprint creates both anew. The bearer is generated independently with `crypto.getRandomValues(new Uint8Array(32))` and is never derived from the request UUID.

### Database reservation RPC

```sql
public.server_reserve_checkout(
  p_event_id uuid,
  p_items jsonb,
  p_name text,
  p_email text,
  p_client_request_id uuid,
  p_confirmation_token_hash text
)
```

`p_items` is an array of exact objects `{ "tier_id": <uuid>, "quantity": <integer> }`. One returned row contains order aggregates plus `order_items jsonb`, a tier-ID-sorted array of:

```ts
type ReservationItemSnapshot = {
  order_item_id: string
  ticket_tier_id: string
  tier_name: string
  unit_amount_minor: number
  quantity: number
  subtotal_minor: number
  currency: 'usd'
}
```

### Stable Stripe line binding

The pinned Stripe SDK exposes `Checkout.SessionCreateParams.line_items[].price_data.product_data.metadata`, and retrieved `LineItem.price.product` can be expanded as a Product. Therefore Checkout Integrity 1.0 will write exactly:

```ts
price_data: {
  currency: item.currency,
  unit_amount: item.unitAmountMinor,
  product_data: {
    name: item.tierName,
    metadata: { whereto_order_item_id: item.orderItemId },
  },
}
```

Creation/retrieval expands `line_items.data.price.product`. Reconciliation reads `product.metadata.whereto_order_item_id` and performs an exact set comparison with persisted order items. It never matches by line array position, display name, quantity, or price alone.

Session and PaymentIntent metadata becomes exactly:

```ts
{
  contract_version: 'checkout_integrity_v1',
  event_id: eventId,
  order_id: orderId,
}
```

### Webhook order snapshot

```ts
export interface OrderItemSnapshot {
  orderItemId: string
  tierId: string
  currency: 'usd'
  unitAmountMinor: number
  quantity: number
  subtotalMinor: number
}

export interface OrderSnapshot {
  orderId: string
  checkoutSessionId: string
  eventId: string
  currency: 'usd'
  subtotalMinor: number
  totalMinor: number
  applicationFeeAmountMinor: number
  destinationAccountId: string
  items: OrderItemSnapshot[]
}
```

### Confirmation response

```ts
export type ConfirmationStatus =
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'requires_review'

export type OrderConfirmation = {
  orderNumber: string
  status: ConfirmationStatus
  event: {
    title: string
    startsAt: string
    endsAt: string
    timezone: string
    venueName: string | null
  }
  items: Array<{
    tierName: string
    quantity: number
    unitAmountMinor: number
    subtotalMinor: number
    currency: 'usd'
  }>
  quantity: number
  currency: 'usd'
  subtotalMinor: number
  taxAmountMinor: 0
  totalMinor: number
}
```

No ticket UUID, unit sequence, order-item ID, buyer PII, Stripe ID, reconciliation detail, or credential is returned.

---

## Migration Sequence and Deployment Compatibility

Apply these migrations in order and never alter one after it is linked:

1. `20260902010000_expand_checkout_integrity_schema.sql` — cardinality constraints and default-off checkout control; guard both the current singular reservation and future cart reservation.
2. `20260902010100_add_checkout_cart_reservation.sql` — authoritative cart parsing, central money calculation, sorted locks, new reservation/preflight overloads, and public availability correction.
3. `20260902010200_schedule_checkout_reservation_expiry.sql` — timestamp-correct idempotent cleanup plus database-owned scheduler.
4. `20260902010300_add_checkout_item_reconciliation.sql` — additive V2 snapshots, order-review transition, multi-item lock set, and all-or-nothing ticket fulfillment.
5. `20260902010400_enforce_whole_order_refund_safety.sql` — exact refund economics, partial-refund review evidence, and whole-ticket-set transitions.
6. `20260902010500_add_checkout_confirmation_v2.sql` — token-scoped multi-item confirmation projection.
7. `20260902010600_remove_single_ticket_checkout_contract.sql` — after the real test-mode smoke gate only, remove obsolete singular RPC/helpers and prove no runtime reference remains.

Migrations 1–6 are additive or generalizing. They retain temporary singular RPCs only so the currently deployed development Edge Functions cannot break during ordered rollout. Migration 7 is intentionally delayed until the new webhook, confirmation, cancellation, and checkout functions are deployed and the multi-item Stripe proof passes.

The private singleton `private.checkout_runtime_control` starts with `checkout_creation_enabled = false`. New order creation stays off through migrations 1–6 and Edge deployment. Existing matching request IDs may resume; all lifecycle endpoints remain on. The real proof runner temporarily enables creation inside a guarded development fixture and restores the previous value in its `EXIT` trap. Permanent development cutover occurs in Task 15 only after the release gates pass.

---

## Pre-Execution Baseline

Before writing the first RED test, create the isolated worktree, confirm it starts at the approved design commit or its descendant, and record the unchanged baseline:

```bash
git status --short --branch
git log -1 --oneline
pnpm typecheck
pnpm lint
pnpm test
pnpm test:functions
pnpm typecheck:functions
pnpm test:integration
pnpm build
pnpm exec supabase migration list --linked
pnpm exec supabase test db --linked
```

Expected: existing deterministic and linked suites pass, or any pre-existing failure is recorded before Checkout Integrity changes and left untouched unless it blocks an approved invariant. Do not run the real Stripe proof at baseline. Confirm the original checkout's user-owned visual files are absent from the feature worktree diff.

---

## Planned File Map

### Forward-only migrations

- `supabase/migrations/20260902010000_expand_checkout_integrity_schema.sql`
- `supabase/migrations/20260902010100_add_checkout_cart_reservation.sql`
- `supabase/migrations/20260902010200_schedule_checkout_reservation_expiry.sql`
- `supabase/migrations/20260902010300_add_checkout_item_reconciliation.sql`
- `supabase/migrations/20260902010400_enforce_whole_order_refund_safety.sql`
- `supabase/migrations/20260902010500_add_checkout_confirmation_v2.sql`
- `supabase/migrations/20260902010600_remove_single_ticket_checkout_contract.sql`

### Database proof

- Create `supabase/tests/database/checkout_integrity_schema.test.sql`
- Create `supabase/tests/database/checkout_integrity_reservation.test.sql`
- Create `supabase/tests/database/checkout_integrity_expiry.test.sql`
- Create `supabase/tests/database/checkout_integrity_fulfillment.test.sql`
- Create `supabase/tests/database/checkout_integrity_refunds.test.sql`
- Create `supabase/tests/database/checkout_integrity_confirmation.test.sql`
- Create `supabase/tests/database/checkout_integrity_contract_cleanup.test.sql`
- Create `supabase/tests/database/checkout_integrity_concurrency.test.sh`
- Modify the existing ticketing schema, RLS, reservation, fulfillment, webhook-review, refund/dispute, confirmation, public-eligibility, and concurrency suites where they encode the retired singular contract.

### Edge Functions

- Modify `supabase/functions/_shared/cors.ts` and `shared.test.ts`.
- Create `supabase/functions/_shared/operationalLog.ts` and `operationalLog.test.ts`.
- Create `supabase/functions/_shared/refundOrder.ts` and `refundOrder.test.ts`.
- Modify `supabase/functions/stripe-create-checkout/index.ts` and `index.test.ts`.
- Modify `supabase/functions/stripe-webhook/index.ts`, `index.test.ts`, and `webhookFixtures.ts`.
- Modify `supabase/functions/stripe-cancel-checkout/index.ts` and `index.test.ts`.
- Modify `supabase/functions/order-confirmation/index.ts` and `index.test.ts`.

### Browser

- Create `src/features/checkout/checkout.cart.ts` and `checkout.cart.test.ts`.
- Create `src/features/checkout/checkout.attempt.ts` and `checkout.attempt.test.ts`.
- Modify checkout schemas, API, query, page, and all co-located tests.
- Modify ticket selection/event page components and tests.
- Modify order types, API, query, confirmation page, and tests.
- Modify `src/styles/global.css` only for the approved cart/confirmation controls.
- Regenerate `src/lib/supabase/database.types.ts` after migrations 1–6 and again after migration 7.

### Integration, browser proof, and operations

- Modify `tests/integration/run-ticketing-database.sh`, `ticketing-database.test.ts`, `ticketing-concurrency.test.ts`, and `ticketing-final-inventory-race.sh`.
- Modify `tests/integration/stripe-ticketing.test.ts`, `stripeTestObjects.ts`, `stripeHarnessContract.test.ts`, `stripeRunnerContract.test.ts`, and `stripeWebhookHarness.ts`.
- Modify `tests/integration/edge/task17-transaction-driver/index.ts` and `run-stripe-ticketing-proof.sh`.
- Modify `tests/e2e/support/ticketingFixture.ts`, `ticketingJourney.ts`, `ticket-purchase.spec.ts`, `ticket-purchase.visual.spec.ts`, and `run-ticketing-browser-proof.sh`.
- Create `Docs/runbooks/checkout-integrity-operations.md`.
- Create `Docs/testing/checkout-integrity-1-verification.md`.

---

### Task 1: Expand Cardinality and Install the Checkout-Creation Kill Switch

**Purpose:** Remove the physical one-item/one-unit ceiling and establish a default-off gate before any new cart runtime exists.

**Files:**
- Create: `supabase/migrations/20260902010000_expand_checkout_integrity_schema.sql`
- Create: `supabase/tests/database/checkout_integrity_schema.test.sql`
- Modify: `supabase/tests/database/ticketing_schema.test.sql`

**Interfaces:**
- `orders_quantity_check`: `quantity between 1 and 10`.
- `order_items_quantity_check`: `quantity between 1 and 10`.
- Replace `order_items_order_id_key` with `UNIQUE(order_id, ticket_tier_id)`.
- Add private singleton `private.checkout_runtime_control(singleton boolean primary key, checkout_creation_enabled boolean, updated_at timestamptz)` seeded `false`.
- Guard the existing `private.reserve_checkout(uuid,uuid,text,text,uuid,text)` so only an already-persisted matching request can resume while disabled; a new request raises `CHECKOUT_DISABLED`.

- [ ] **Step 1: Write the structural RED**

Assert the new checks and uniqueness, successful insertion of two distinct items for one order, rejection of a duplicate tier, rejection of aggregate/item quantity above ten, exact private-table ACL, default-off control state, browser-role denial, and kill-switch behavior that blocks only a new reservation.

- [ ] **Step 2: Observe RED on unchanged main**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_schema.test.sql \
  supabase/tests/database/ticketing_schema.test.sql
```

Expected RED: `private.checkout_runtime_control` is absent, `order_items_order_id_key` still rejects the second distinct tier, and quantity eleven is not rejected by the existing order check.

- [ ] **Step 3: Implement only the expansion migration**

Use `numeric` casts in multiplication checks to retain overflow safety. Revoke all private table/function access from `public`, `anon`, `authenticated`, and `service_role`; expose no browser RPC for toggling the switch. The existing reservation function must check for a matching existing order before consulting the off switch.

- [ ] **Step 4: Dry-run and apply migration 1**

```bash
pnpm exec supabase migration list --linked
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
pnpm exec supabase migration list --linked
```

Expected: dry-run lists only `20260902010000`; history aligns after push; new creation is disabled.

- [ ] **Step 5: Run focused GREEN and schema/RLS regressions**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_schema.test.sql \
  supabase/tests/database/ticketing_schema.test.sql \
  supabase/tests/database/ticketing_rls.test.sql
pnpm exec supabase db lint --linked --schema public,private
```

Expected GREEN: exact constraints and ACL pass; no browser role can read/update the switch; lint adds no warning/error.

- [ ] **Step 6: Review and commit**

Review that no direct `orders`/`order_items` browser writes were granted, existing one-item rows remain valid, and no fee column was added.

```bash
git add supabase/migrations/20260902010000_expand_checkout_integrity_schema.sql \
  supabase/tests/database/checkout_integrity_schema.test.sql \
  supabase/tests/database/ticketing_schema.test.sql
git diff --cached --check
git commit -m "feat: expand checkout order cardinality"
```

---

### Task 2: Add Authoritative Cart Reservation, Money, and Locking

**Purpose:** Reserve one canonical multi-tier cart atomically with server-owned snapshot and fee arithmetic.

**Files:**
- Create: `supabase/migrations/20260902010100_add_checkout_cart_reservation.sql`
- Create: `supabase/tests/database/checkout_integrity_reservation.test.sql`
- Create: `supabase/tests/database/checkout_integrity_concurrency.test.sh`
- Modify: `supabase/tests/database/inventory_reservations.test.sql`
- Modify: `supabase/tests/database/payment_fulfillment_concurrency.test.sh`
- Modify: `supabase/tests/database/paid_tier_lock_order.test.sh`
- Modify: `supabase/tests/database/public_eligibility_projections.test.sql`

**Interfaces:**
- Add `private.calculate_checkout_money(bigint,integer,integer,bigint,text,integer,bigint)` returning the six authoritative aggregate money values.
- Add `private.get_checkout_preflight(uuid,uuid[])` and service-only `public.server_get_checkout_preflight(uuid,uuid[])`.
- Add `private.reserve_checkout(uuid,jsonb,text,text,uuid,text)` and service-only `public.server_reserve_checkout(uuid,jsonb,text,text,uuid,text)` returning one aggregate row plus sorted `order_items jsonb`.
- Keep the singular overload temporarily, still protected by the Task 1 switch.
- Change public availability accounting so `paid`, `payment_processing`, `requires_review`, and legacy `partially_refunded` always count; open/creating rows count only while `reservation_expires_at > statement_timestamp()`.

- [ ] **Step 1: Write cart, money, and idempotency RED tests**

Cover one item, `2 GA + 1 VIP`, ten total, empty/eleven/fractional/zero/negative quantities, duplicate IDs, extra keys, wrong event, inactive/unknown tiers, mixed organizer/currency, reordered equivalent retry, material retry conflict, immutable snapshots after tier/fee edits, percentage rounding once on aggregate subtotal, fixed fee per admission, application-fee bound, and full rollback when one tier is sold out.

Use the locked formula in the expected SQL:

```sql
platform_product_fee_minor =
  floor(subtotal_minor::numeric * platform_percent_bps::numeric / 10000::numeric)::bigint
  + platform_fixed_minor * quantity
```

- [ ] **Step 2: Write concurrent RED cases**

The shell proof must open separate database sessions and cover same-tier final inventory, overlapping carts, reverse input order, different tiers in one event, concurrent tier edits, eligibility loss, and one insufficient line causing zero inserted rows for the whole cart. Require bounded completion and treat a deadlock as failure.

- [ ] **Step 3: Observe RED**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_reservation.test.sql \
  supabase/tests/database/inventory_reservations.test.sql \
  supabase/tests/database/public_eligibility_projections.test.sql
bash supabase/tests/database/checkout_integrity_concurrency.test.sh
```

Expected RED: the JSON cart signatures are absent; multi-tier insert/retry and aggregate fee assertions fail; current committed-quantity logic omits review states.

- [ ] **Step 4: Implement canonical parsing and sorted locks**

Reject non-array JSON, unknown/extra item fields, duplicates, and invalid totals before mutation. Sort tier UUIDs, then acquire:

```text
event advisory transaction lock
-> requested tier rows ascending by UUID
-> event row
-> existing/new order rows
```

Within the same transaction, lazily expire eligible stale reservations, compute availability per tier, snapshot all items, calculate order money once, insert one order and all items, prove cross-row sums, then calculate the immutable request digest from sorted persisted snapshots.

- [ ] **Step 5: Implement durable retry behavior**

For an existing `(organizer_id,event_id,client_request_id)`, compare normalized buyer, bearer hash, and exact sorted tier/quantity set to persisted values. Equivalent reorder returns the same order, item IDs, digest, and attached Session ID. Any material difference raises `IDEMPOTENCY_CONFLICT`. Terminal/review outcomes follow the approved lifecycle and never create another order.

- [ ] **Step 6: Dry-run and apply migration 2**

```bash
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
pnpm exec supabase migration list --linked
```

Expected: only `20260902010100` applies; checkout creation remains off.

- [ ] **Step 7: Run GREEN plus concurrency regression**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_reservation.test.sql \
  supabase/tests/database/inventory_reservations.test.sql \
  supabase/tests/database/public_eligibility_projections.test.sql
bash supabase/tests/database/checkout_integrity_concurrency.test.sh
bash supabase/tests/database/payment_fulfillment_concurrency.test.sh
bash supabase/tests/database/paid_tier_lock_order.test.sh
```

Expected GREEN: no oversell, deadlock, partial cart, or fee mismatch; review inventory remains committed; reordered retry is stable.

- [ ] **Step 8: Review and commit**

Review every integer conversion, error path, lock order, status set, direct privilege, and digest input.

```bash
git add supabase/migrations/20260902010100_add_checkout_cart_reservation.sql \
  supabase/tests/database/checkout_integrity_reservation.test.sql \
  supabase/tests/database/checkout_integrity_concurrency.test.sh \
  supabase/tests/database/inventory_reservations.test.sql \
  supabase/tests/database/payment_fulfillment_concurrency.test.sh \
  supabase/tests/database/paid_tier_lock_order.test.sh \
  supabase/tests/database/public_eligibility_projections.test.sql
git commit -m "feat: reserve multi-tier checkout carts"
```

---

### Task 3: Automate Reservation Expiration Without Weakening Timestamp Truth

**Purpose:** Make expired holds stop counting immediately and make durable lifecycle cleanup automatic, idempotent, and observable.

**Files:**
- Create: `supabase/migrations/20260902010200_schedule_checkout_reservation_expiry.sql`
- Create: `supabase/tests/database/checkout_integrity_expiry.test.sql`
- Modify: `supabase/tests/database/inventory_reservations.test.sql`

**Interfaces:**
- Preserve `public.server_expire_checkout_reservations(p_now timestamptz) returns integer` as service-only.
- Schedule database-owned job `whereto-expire-checkout-reservations` once per minute with `select public.server_expire_checkout_reservations(clock_timestamp());`.
- Cleanup advances only expired `creating_checkout|checkout_open` rows; it cannot change `payment_processing|paid|requires_review|partially_refunded|refunded`.

- [ ] **Step 1: Write expiration/scheduler RED**

Assert that availability ignores an elapsed reservation before cleanup; lazy reservation advances eligible stale rows; explicit cleanup advances every eligible item/order once; repeat cleanup returns zero; all protected statuses remain unchanged; multi-tier quantity is released as a whole; the exact named cron job exists once; and browser/service roles cannot inspect `cron` internals or mutate the job.

- [ ] **Step 2: Observe RED**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_expiry.test.sql \
  supabase/tests/database/inventory_reservations.test.sql
```

Expected RED: no Checkout expiry cron job exists and protected multi-item behavior is not yet proven.

- [ ] **Step 3: Implement the focused migration**

Use the existing `pg_cron` extension and existing cron privilege posture. Preserve the function signature, add stable event/tier/order locking inside cleanup, set `expired_at`/safe failure code once, and return the count actually advanced. Do not call Stripe from the scheduler.

- [ ] **Step 4: Apply and prove GREEN**

```bash
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_expiry.test.sql \
  supabase/tests/database/inventory_reservations.test.sql
pnpm exec supabase db lint --linked --schema public,private
```

Expected GREEN: timestamp release is immediate, cleanup is automatic/idempotent, and protected inventory never releases.

- [ ] **Step 5: Review and commit**

```bash
git add supabase/migrations/20260902010200_schedule_checkout_reservation_expiry.sql \
  supabase/tests/database/checkout_integrity_expiry.test.sql \
  supabase/tests/database/inventory_reservations.test.sql
git commit -m "feat: automate checkout reservation expiry"
```

---

### Task 4: Generalize Checkout Creation and Bind Every Stripe Line

**Purpose:** Accept the strict cart/bearer contract and construct one exact Stripe line per persisted order item.

**Files:**
- Modify: `supabase/functions/_shared/cors.ts`
- Modify: `supabase/functions/_shared/shared.test.ts`
- Modify: `supabase/functions/stripe-create-checkout/index.ts`
- Modify: `supabase/functions/stripe-create-checkout/index.test.ts`

**Interfaces:**
- `CreateCheckoutInput` becomes `{ eventId, buyerName, buyerEmail, clientRequestId, items }`.
- `ReservationSnapshot` adds `quantity`, `totalMinor`, and `items: ReservationItemSnapshot[]`.
- `StripeCreateCheckoutDependencies.refreshConnect(eventId, tierIds)` receives the complete sorted tier set.
- Checkout requires `X-Whereto-Confirmation-Bearer`; `deriveConfirmationToken(clientRequestId)` is removed.
- CORS allows `x-whereto-confirmation-bearer` only with the existing exact application-origin response.

- [ ] **Step 1: Write request/bearer RED tests**

Cover exact top/item keys, 1–10 items/aggregate, duplicate tiers, UUID/quantity/name/email normalization, extra client money/provider fields, missing/malformed bearer, method/content type/byte limit, origin rejection, and the allowed custom header. Prove two equal request UUIDs with different random bearers produce different hashes and request-ID knowledge cannot derive the bearer.

- [ ] **Step 2: Write Stripe construction/retry RED tests**

Assert sorted one-line-per-item construction, persisted name/unit/quantity/currency, exact aggregate amount/fee/destination, dynamic payment methods, no tax/discount/shipping/optional items, exact Session/PaymentIntent metadata, Product metadata binding, `expand: ['line_items.data.price.product', 'payment_intent']`, and idempotency key `whereto-checkout-integrity-v1:<orderId>`.

Cover attached Session reuse, unknown create outcome, definitive noncreation, conflicting Session, attachment failure, terminal Session, malformed URL, missing/extra/duplicate Product bindings, and no inventory release while a payable Session may exist.

- [ ] **Step 3: Observe RED**

```bash
pnpm exec deno test --allow-env \
  supabase/functions/_shared/shared.test.ts \
  supabase/functions/stripe-create-checkout/index.test.ts
```

Expected RED: the endpoint still requires singular `tierId`, derives the bearer from request ID, creates one generic quantity-one line, and does not allow the new header.

- [ ] **Step 4: Implement strict parsing and independent bearer hashing**

Read the bearer only from the exact header, validate canonical 43-character base64url/32 decoded bytes, hash with SHA-256, and never retain/log the clear value. Pass snake-case cart objects to the new RPC. Convert all returned `bigint` JSON values only after `Number.isSafeInteger` validation.

- [ ] **Step 5: Implement exact multi-line construction and validation**

Create line items only from persisted `ReservationItemSnapshot`s. On every create/retrieve, expand the Product, map by `whereto_order_item_id`, reject any set/amount/quantity/currency mismatch, require `has_more === false`, and validate Session/PaymentIntent aggregates and destination.

- [ ] **Step 6: Run GREEN and Edge regressions**

```bash
pnpm exec deno test --allow-env \
  supabase/functions/_shared/shared.test.ts \
  supabase/functions/stripe-create-checkout/index.test.ts \
  supabase/functions/stripe-cancel-checkout/index.test.ts
pnpm test:functions
pnpm typecheck:functions
```

Expected GREEN: strict cart and bearer tests pass; all existing Edge functions still typecheck; no Stripe API is called by unit tests.

- [ ] **Step 7: Review and commit**

Review CORS, URL construction, live-mode rejection, exact metadata, safe error codes (`CHECKOUT_DISABLED`, `IDEMPOTENCY_CONFLICT`, existing sellability codes), and release-on-failure rules.

```bash
git add supabase/functions/_shared/cors.ts \
  supabase/functions/_shared/shared.test.ts \
  supabase/functions/stripe-create-checkout/index.ts \
  supabase/functions/stripe-create-checkout/index.test.ts
git commit -m "feat: create bound multi-line checkouts"
```

---

### Task 5: Build the Bounded Browser Cart and Durable Tab Retry Identity

**Purpose:** Let a buyer choose multiple quantities, submit the exact cart, and safely reuse one request/bearer pair after refresh or ambiguous network failure.

**Files:**
- Create: `src/features/checkout/checkout.cart.ts`
- Create: `src/features/checkout/checkout.cart.test.ts`
- Create: `src/features/checkout/checkout.attempt.ts`
- Create: `src/features/checkout/checkout.attempt.test.ts`
- Modify: `src/features/checkout/checkout.schemas.ts`
- Modify: `src/features/checkout/checkout.schemas.test.ts`
- Modify: `src/features/checkout/checkout.api.ts`
- Modify: `src/features/checkout/checkout.api.test.ts`
- Modify: `src/features/checkout/CheckoutPage.tsx`
- Modify: `src/features/checkout/CheckoutPage.test.tsx`
- Modify: `src/features/checkout/CheckoutPage.states.test.tsx`
- Modify: `src/features/tickets/TicketTierList.tsx`
- Create: `src/features/tickets/TicketTierList.test.tsx`
- Modify: `src/features/tickets/PublicTicketEventPage.tsx`
- Modify: `src/features/tickets/PublicTicketEventPage.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Checkout route query uses repeated public values `item=<tierUuid>:<quantity>`; parser sorts by tier UUID and rejects duplicates/malformed/overflow values.
- `TicketTierList` accepts `quantities`, `maxTotal`, and `onQuantityChange(tierId, quantity)` instead of one selected radio tier.
- `createCheckout(input, confirmationBearer)` sends the strict body and header.
- `getOrCreateCheckoutAttempt(canonicalSubmission)` returns the exact `CheckoutAttemptRecord` above.

- [ ] **Step 1: Write cart codec/schema RED**

Assert exact request keys, sorted canonical items, URL encode/decode round trip, one and ten admissions, multiple tiers, duplicates, unknown/malformed tiers, aggregate overflow, and rejection of client prices/fees. The URL contains only public event/tier IDs and quantities.

- [ ] **Step 2: Write retry-state RED**

With mocked Web Crypto/session storage, prove same canonical submission after refresh reuses UUID and bearer, reordered items reuse them, buyer/cart edits rotate both, generated bearer decodes to 32 random bytes, UUID does not determine bearer, corrupt records fail closed and rotate, and terminal cleanup deletes only the matching attempt.

- [ ] **Step 3: Write component/API RED**

Cover keyboard-operable quantity inputs, aggregate limit feedback, sold-out controls, `2 GA + 1 VIP` navigation, multi-line review and total, exact custom header, one in-flight request, retry after rejected/ambiguous fetch, refresh reuse, validation focus, availability refresh, hosted URL validation, and no bearer/request ID rendered or logged.

- [ ] **Step 4: Observe RED**

```bash
pnpm test -- \
  src/features/checkout/checkout.cart.test.ts \
  src/features/checkout/checkout.attempt.test.ts \
  src/features/checkout/checkout.schemas.test.ts \
  src/features/checkout/checkout.api.test.ts \
  src/features/checkout/CheckoutPage.test.tsx \
  src/features/checkout/CheckoutPage.states.test.tsx \
  src/features/tickets/TicketTierList.test.tsx \
  src/features/tickets/PublicTicketEventPage.test.tsx
```

Expected RED: singular radio/tier/quantity-one contracts fail and retry values are regenerated per submit.

- [ ] **Step 5: Implement the minimal cart and retry modules**

Use native `URLSearchParams`, `crypto.randomUUID`, `crypto.getRandomValues`, and `crypto.subtle.digest`; add no cart dependency/store. Keep selection local to the public event, encode it into the checkout URL, and recompute displayed totals from safe public tier data for UX only. Server results remain authoritative.

- [ ] **Step 6: Implement accessible quantity and checkout UI**

Use labeled integer inputs/buttons, a live aggregate count/limit message, per-tier line summaries, and one aggregate total. Disable submit only for invalid/unavailable carts or active request. Do not expose internal item/ticket IDs.

- [ ] **Step 7: Run GREEN and frontend regressions**

```bash
pnpm test -- \
  src/features/checkout \
  src/features/tickets/TicketTierList.test.tsx \
  src/features/tickets/PublicTicketEventPage.test.tsx
pnpm typecheck
pnpm lint
pnpm build
```

Expected GREEN: cart/retry/browser tests pass; production build contains no server secret name/value and no type/lint error.

- [ ] **Step 8: Review and commit**

```bash
git add src/features/checkout/checkout.cart.ts \
  src/features/checkout/checkout.cart.test.ts \
  src/features/checkout/checkout.attempt.ts \
  src/features/checkout/checkout.attempt.test.ts \
  src/features/checkout/checkout.schemas.ts \
  src/features/checkout/checkout.schemas.test.ts \
  src/features/checkout/checkout.api.ts \
  src/features/checkout/checkout.api.test.ts \
  src/features/checkout/CheckoutPage.tsx \
  src/features/checkout/CheckoutPage.test.tsx \
  src/features/checkout/CheckoutPage.states.test.tsx \
  src/features/tickets/TicketTierList.tsx \
  src/features/tickets/TicketTierList.test.tsx \
  src/features/tickets/PublicTicketEventPage.tsx \
  src/features/tickets/PublicTicketEventPage.test.tsx \
  src/styles/global.css
git commit -m "feat: add bounded multi-tier checkout cart"
```

---

### Task 6: Add Multi-Item Payment Snapshots and Atomic Ticket Fulfillment

**Purpose:** Generalize the database webhook boundary and issue exactly one durable ticket for every purchased unit in one transaction.

**Files:**
- Create: `supabase/migrations/20260902010300_add_checkout_item_reconciliation.sql`
- Create: `supabase/tests/database/checkout_integrity_fulfillment.test.sql`
- Modify: `supabase/tests/database/payment_fulfillment.test.sql`
- Modify: `supabase/tests/database/webhook_reconciliation.test.sql`
- Modify: `supabase/tests/database/webhook_review_safety.test.sql`
- Modify: `supabase/tests/database/payment_fulfillment_concurrency.test.sh`

**Interfaces:**
- Add service-only `public.server_get_checkout_integrity_order_snapshot(uuid,text)` and `public.server_get_checkout_integrity_payment_snapshot(uuid)` returning one order row plus sorted `order_items jsonb`.
- Add service-only `public.server_mark_checkout_reconciliation_review(uuid,text,text,text)` for a known order/session/event/safe-code mismatch.
- Generalize `private.lock_payment_order(uuid)` to lock every tier ascending and validate an unchanged exact item set.
- Preserve the existing `public.server_fulfill_paid_order(...)` call signature; its returned row becomes `{ order_id, order_status, ticket_count }`.

- [ ] **Step 1: Write snapshot/fulfillment RED**

Cover exact `2 GA + 1 VIP` snapshot, stable order, no singular tier field, two item rows, three tickets with GA sequences `1,2` and VIP sequence `1`, coherent duplicated references, server timestamps, duplicate fulfillment no-op, concurrent duplicate events, and unchanged ticket IDs/timestamps on retry.

- [ ] **Step 2: Write corruption/all-or-nothing RED**

Seed a partial ticket set, extra sequence, wrong parent tier/event/organizer, or mismatched order aggregates before retry. Require `requires_review`, `TICKET_SET_MISMATCH`, zero new tickets, and all inventory held. Force an exception during a fresh multi-ticket insert and prove the transaction commits no ticket or paid transition.

- [ ] **Step 3: Observe RED**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_fulfillment.test.sql \
  supabase/tests/database/payment_fulfillment.test.sql \
  supabase/tests/database/webhook_reconciliation.test.sql \
  supabase/tests/database/webhook_review_safety.test.sql
bash supabase/tests/database/payment_fulfillment_concurrency.test.sh
```

Expected RED: current snapshot/lock selects one item and current fulfillment hard-codes one ticket with sequence one.

- [ ] **Step 4: Implement additive V2 snapshots and exact lock set**

Return sorted item JSON with safe integer fields. Acquire event advisory lock, all tier rows ascending, event, order, then items. Re-read and compare the item set after locks; mismatch raises `ORDER_CHANGED_RETRY`.

- [ ] **Step 5: Implement atomic generation and retry validation**

For a clean paid transition, insert tickets with `generate_series(1, item.quantity)` for every item in one statement/transaction. Before inserting, require either zero tickets or the complete exact expected set. After insertion, assert total and per-item counts/sequences/references. Existing partial/extra/incoherent state routes to review and creates nothing.

- [ ] **Step 6: Apply migration 4 and run GREEN**

```bash
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_fulfillment.test.sql \
  supabase/tests/database/payment_fulfillment.test.sql \
  supabase/tests/database/webhook_reconciliation.test.sql \
  supabase/tests/database/webhook_review_safety.test.sql
bash supabase/tests/database/payment_fulfillment_concurrency.test.sh
```

Expected GREEN: exact ticket set is atomic and retry-stable; corruption fails closed; no oversell/deadlock.

- [ ] **Step 7: Review and commit**

```bash
git add supabase/migrations/20260902010300_add_checkout_item_reconciliation.sql \
  supabase/tests/database/checkout_integrity_fulfillment.test.sql \
  supabase/tests/database/payment_fulfillment.test.sql \
  supabase/tests/database/webhook_reconciliation.test.sql \
  supabase/tests/database/webhook_review_safety.test.sql \
  supabase/tests/database/payment_fulfillment_concurrency.test.sh
git commit -m "feat: fulfill checkout items atomically"
```

---

### Task 7: Reconcile Every Stripe Line and Preserve Webhook Idempotency

**Purpose:** Require exact set-level Stripe/Whereto agreement before any paid fulfillment.

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`
- Modify: `supabase/functions/stripe-webhook/index.test.ts`
- Modify: `supabase/functions/stripe-webhook/webhookFixtures.ts`

**Interfaces:**
- Replace singular `OrderSnapshot.tierId` with `items: OrderItemSnapshot[]`.
- `getOrderSnapshot` calls `server_get_checkout_integrity_order_snapshot`; payment-bound refunds/disputes call `server_get_checkout_integrity_payment_snapshot`.
- Retrieve Checkout with `expand: ['line_items.data.price.product', 'payment_intent.latest_charge']`.
- Add safe mismatch codes: `CHECKOUT_LINE_COUNT_MISMATCH`, `CHECKOUT_ITEM_BINDING_MISSING`, `CHECKOUT_ITEM_BINDING_DUPLICATE`, `CHECKOUT_ITEM_BINDING_UNKNOWN`, `CHECKOUT_LINE_TIER_MISMATCH`, `CHECKOUT_LINE_QUANTITY_MISMATCH`, `CHECKOUT_LINE_AMOUNT_MISMATCH`, `CHECKOUT_LINE_CURRENCY_MISMATCH`, and `CHECKOUT_AGGREGATE_MISMATCH`.

- [ ] **Step 1: Write exact multi-line RED**

Build fixtures for exact reordered Stripe lines and each missing/extra/duplicate/unknown binding, wrong quantity/unit/currency/subtotal, aggregate total, Session metadata, destination, fee, PaymentIntent, charge, and reused object. Assert the exact success case fulfills three tickets and line order is irrelevant.

- [ ] **Step 2: Write delivery/lifecycle RED**

Cover duplicate identical event, conflicting digest reuse, out-of-order completion, completed-unpaid, async success/failure, failure after paid, invalidated late payment, transient dependency retry, processed no-op, and permanent mismatch routing the known order to `requires_review` without tickets or inventory release.

- [ ] **Step 3: Observe RED**

```bash
pnpm exec deno test --allow-env supabase/functions/stripe-webhook/index.test.ts
```

Expected RED: current webhook requires one line/quantity one and matches singular tier metadata.

- [ ] **Step 4: Implement exact set reconciliation**

Validate Product object/metadata, construct a map keyed by `whereto_order_item_id`, require a bijection with persisted items, then compare each numeric/currency invariant. Sum validated lines independently and compare to Session/order totals. Only then validate PaymentIntent/charge and invoke fulfillment.

- [ ] **Step 5: Implement known-order mismatch review**

Once order/session binding is established, catch line/aggregate mismatches and invoke the service-only review transition with the allowlisted code. Keep raw Stripe/body/provider error content out of the database and response. Signature/envelope failures with no trustworthy order identity do not mutate an order.

- [ ] **Step 6: Run GREEN and full Edge regression**

```bash
pnpm exec deno test --allow-env supabase/functions/stripe-webhook/index.test.ts
pnpm test:functions
pnpm typecheck:functions
```

Expected GREEN: exact multi-line payment fulfills; every mismatch is safe and durable; duplicate delivery changes neither tickets nor financial identifiers.

- [ ] **Step 7: Review and commit**

Review raw-signature-first behavior, live-mode rejection, retrieval authority, exact metadata keys, provider-object uniqueness, transient/permanent classification, and no browser redirect authority.

```bash
git add supabase/functions/stripe-webhook/index.ts \
  supabase/functions/stripe-webhook/index.test.ts \
  supabase/functions/stripe-webhook/webhookFixtures.ts
git commit -m "feat: reconcile checkout lines exactly"
```

---

### Task 8: Enforce Whole-Order Cancellation and Refund Safety

**Purpose:** Make all normal cancellation/refund behavior order-wide and route partial or economically incomplete refunds to manual review.

**Files:**
- Create: `supabase/migrations/20260902010400_enforce_whole_order_refund_safety.sql`
- Create: `supabase/tests/database/checkout_integrity_refunds.test.sql`
- Modify: `supabase/tests/database/refunds_disputes.test.sql`
- Modify: `supabase/tests/database/webhook_review_safety.test.sql`
- Modify: `supabase/functions/stripe-webhook/index.ts`
- Modify: `supabase/functions/stripe-webhook/index.test.ts`
- Modify: `supabase/functions/stripe-webhook/webhookFixtures.ts`
- Modify: `supabase/functions/stripe-cancel-checkout/index.ts`
- Modify: `supabase/functions/stripe-cancel-checkout/index.test.ts`
- Create: `supabase/functions/_shared/refundOrder.ts`
- Create: `supabase/functions/_shared/refundOrder.test.ts`

**Interfaces:**
- Add refund evidence columns `transfer_reversal_amount_minor`, `application_fee_refund_amount_minor`, `policy_verified`, and `policy_failure_code` with bounded checks.
- Generalize `public.server_apply_verified_refund(...)` to receive exact reversal/fee-refund amounts and policy outcome.
- Add service-only `public.server_prepare_whole_order_refund(p_order_id uuid,p_reason text)` returning only persisted order ID, charge/payment/transfer/fee IDs, currency, total, application fee, and canonical reason.
- Add internal `createWholeOrderRefund(orderId, reason, dependencies)`; no browser/public refund endpoint is introduced.

- [ ] **Step 1: Write cancellation RED**

Cover multi-item open unpaid cancellation, repeated cancellation, already expired, paid/processing/review refusal, Session complete while DB lags, ambiguous retrieve/expire response, all-tier release, and preservation of payment/fulfillment lifecycle APIs while the creation switch is off.

- [ ] **Step 2: Write refund database RED**

Cover exact full succeeded refund, pending/requires-action hold, failed/cancelled preservation of paid valid tickets, duplicate/out-of-order events, multiple partial refunds, cumulative exact customer amount with incomplete reversal/fee unwind, exact cumulative full economics, over-refund, partial review inventory hold, and all-ticket invalidation without allocation.

For a successful partial refund assert:

```text
order.status = requires_review
order.reconciliation_status = requires_review
order.failure_code = PARTIAL_REFUND_REQUIRES_REVIEW
every ticket.status = cancelled
every tier quantity remains committed
```

- [ ] **Step 3: Write internal Stripe refund RED**

Mock dependencies and prove callers cannot supply amount/tier/ticket; the helper reads the service snapshot and sends exactly `amount = order.total_minor`, `reverse_transfer = true`, `refund_application_fee = true`, canonical policy metadata, and idempotency key `whereto-refund-integrity-v1:<orderId>`. Retry resolves the same refund.

- [ ] **Step 4: Observe RED**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_refunds.test.sql \
  supabase/tests/database/refunds_disputes.test.sql \
  supabase/tests/database/webhook_review_safety.test.sql
pnpm exec deno test --allow-env \
  supabase/functions/_shared/refundOrder.test.ts \
  supabase/functions/stripe-cancel-checkout/index.test.ts \
  supabase/functions/stripe-webhook/index.test.ts
```

Expected RED: current partial refund uses `partially_refunded`, marks tickets refunded, and can report reconciliation without proving the complete unwind.

- [ ] **Step 5: Implement migration 5**

Drop/replace the legacy refund-ticket reconciliation trigger so `partially_refunded` can no longer become a normal automatic result. Persist exact verified evidence. Mark fully refunded only when successful customer refund sum equals total, reversal sum equals total, application-fee refund sum equals persisted application fee, and no conflict exists. Otherwise hold review state/inventory.

- [ ] **Step 6: Implement the internal helper and webhook behavior**

Keep refund creation non-public. The helper retrieves the authoritative snapshot, creates/retrieves one test-mode refund with the fixed flags/key, retrieves reversal/application-fee-refund evidence, and attaches canonical policy metadata. Webhook retrieval remains provider-authoritative and persists even mismatch evidence with a safe code.

- [ ] **Step 7: Apply, run GREEN, and regress disputes**

```bash
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_refunds.test.sql \
  supabase/tests/database/refunds_disputes.test.sql \
  supabase/tests/database/webhook_review_safety.test.sql
pnpm exec deno test --allow-env \
  supabase/functions/_shared/refundOrder.test.ts \
  supabase/functions/stripe-cancel-checkout/index.test.ts \
  supabase/functions/stripe-webhook/index.test.ts
pnpm test:functions
pnpm typecheck:functions
```

Expected GREEN: normal refund is whole-order with both unwind flags; every partial/incomplete case is review-held; disputes remain monotonic.

- [ ] **Step 8: Review and commit**

```bash
git add supabase/migrations/20260902010400_enforce_whole_order_refund_safety.sql \
  supabase/tests/database/checkout_integrity_refunds.test.sql \
  supabase/tests/database/refunds_disputes.test.sql \
  supabase/tests/database/webhook_review_safety.test.sql \
  supabase/functions/_shared/refundOrder.ts \
  supabase/functions/_shared/refundOrder.test.ts \
  supabase/functions/stripe-cancel-checkout/index.ts \
  supabase/functions/stripe-cancel-checkout/index.test.ts \
  supabase/functions/stripe-webhook/index.ts \
  supabase/functions/stripe-webhook/index.test.ts \
  supabase/functions/stripe-webhook/webhookFixtures.ts
git commit -m "feat: enforce whole-order refund safety"
```

---

### Task 9: Return and Render a Safe Multi-Item Confirmation

**Purpose:** Show customer-facing purchased tiers/quantities and aggregate totals without exposing ticket or payment internals.

**Files:**
- Create: `supabase/migrations/20260902010500_add_checkout_confirmation_v2.sql`
- Create: `supabase/tests/database/checkout_integrity_confirmation.test.sql`
- Modify: `supabase/tests/database/order_confirmation.test.sql`
- Modify: `supabase/functions/order-confirmation/index.ts`
- Modify: `supabase/functions/order-confirmation/index.test.ts`
- Modify: `src/features/orders/order.types.ts`
- Modify: `src/features/orders/order.api.ts`
- Modify: `src/features/orders/order.api.test.ts`
- Modify: `src/features/orders/order.queries.ts`
- Modify: `src/features/orders/order.queries.test.tsx`
- Modify: `src/features/orders/OrderConfirmationPage.tsx`
- Modify: `src/features/orders/OrderConfirmationPage.test.tsx`
- Modify: `src/features/checkout/checkout.attempt.ts`
- Modify: `src/features/checkout/checkout.attempt.test.ts`

**Interfaces:**
- Add service-only `public.server_lookup_checkout_integrity_confirmation(p_token_hash text)` returning one row whose `items` is sorted JSON plus aggregate safe fields.
- Preserve the old singular projection temporarily for the deployed old confirmation function.
- Edge/browser response is the exact `OrderConfirmation` interface finalized above.

- [ ] **Step 1: Write database projection RED**

Cover every lifecycle mapping, two items/three admissions, stable sort, immutable labels/prices, aggregate totals, invalid bearer hash, and exact column/ACL. Serialize the result and prove it contains no UUID, unit sequence, buyer, Stripe, reconciliation, failure-detail, or credential field.

- [ ] **Step 2: Write Edge/browser RED**

Cover exact schema, list rendering (`General admission × 2`, `VIP × 1`), aggregate quantity/total, processing polling, paid, failed, cancelled, expired, refunded, and requires-review copy. Prove no internal ID appears in DOM/API fixtures. Terminal status clears only the matching tab attempt; processing/review retains the bearer needed for later refresh.

- [ ] **Step 3: Observe RED**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_confirmation.test.sql \
  supabase/tests/database/order_confirmation.test.sql
pnpm exec deno test --allow-env supabase/functions/order-confirmation/index.test.ts
pnpm test -- \
  src/features/orders/order.api.test.ts \
  src/features/orders/order.queries.test.tsx \
  src/features/orders/OrderConfirmationPage.test.tsx \
  src/features/checkout/checkout.attempt.test.ts
```

Expected RED: current projection/response contains one tier name and conflates cancelled/review with expired/failed.

- [ ] **Step 4: Implement migration 6 and safe mapping**

Return one row with `jsonb_agg` of safe item snapshots. Map legacy `partially_refunded` to `requires_review`; map `cancelled` and `requires_review` distinctly. Keep token hash validation and service-only ACL unchanged in strength.

- [ ] **Step 5: Apply and implement Edge/browser rendering**

```bash
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
```

Parse exact item/aggregate fields with safe integers and USD/tax-zero checks. Render tier names/quantities, not individual tickets.

- [ ] **Step 6: Run GREEN and confirmation regressions**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_confirmation.test.sql \
  supabase/tests/database/order_confirmation.test.sql
pnpm exec deno test --allow-env supabase/functions/order-confirmation/index.test.ts
pnpm test -- src/features/orders src/features/checkout/checkout.attempt.test.ts
pnpm typecheck
```

Expected GREEN: all statuses and multi-item totals render from persisted truth; no internal ticket identity leaks.

- [ ] **Step 7: Review and commit**

```bash
git add supabase/migrations/20260902010500_add_checkout_confirmation_v2.sql \
  supabase/tests/database/checkout_integrity_confirmation.test.sql \
  supabase/tests/database/order_confirmation.test.sql \
  supabase/functions/order-confirmation/index.ts \
  supabase/functions/order-confirmation/index.test.ts \
  src/features/orders/order.types.ts \
  src/features/orders/order.api.ts \
  src/features/orders/order.api.test.ts \
  src/features/orders/order.queries.ts \
  src/features/orders/order.queries.test.tsx \
  src/features/orders/OrderConfirmationPage.tsx \
  src/features/orders/OrderConfirmationPage.test.tsx \
  src/features/checkout/checkout.attempt.ts \
  src/features/checkout/checkout.attempt.test.ts
git commit -m "feat: show multi-item order confirmation"
```

---

### Task 10: Add Sanitized Operational Signals and Integrity Queries

**Purpose:** Diagnose cart, cleanup, webhook, fulfillment, and refund failures without exposing secrets or building analytics UI.

**Files:**
- Create: `supabase/functions/_shared/operationalLog.ts`
- Create: `supabase/functions/_shared/operationalLog.test.ts`
- Modify: `supabase/functions/stripe-create-checkout/index.ts`
- Modify: `supabase/functions/stripe-create-checkout/index.test.ts`
- Modify: `supabase/functions/stripe-webhook/index.ts`
- Modify: `supabase/functions/stripe-webhook/index.test.ts`
- Modify: `supabase/functions/stripe-cancel-checkout/index.ts`
- Modify: `supabase/functions/stripe-cancel-checkout/index.test.ts`
- Create: `Docs/runbooks/checkout-integrity-operations.md`
- Create: `Docs/testing/checkout-integrity-1-verification.md`

**Interfaces:**
- `emitOperationalEvent(event, sink?)` accepts only an allowlisted `CheckoutOperationalEvent`; it cannot accept arbitrary request/provider objects.
- Safe fields: operation, outcome, contract version, order/event/provider object ID when already non-secret, item count, aggregate quantity, currency, integer totals, attempt, duration, prior/result status, and allowlisted error code.
- Runbook queries are read-only and return counts/IDs/statuses only, never buyer fields or credentials.

- [ ] **Step 1: Write logging RED**

Prove allowlisted fields serialize, while buyer name/email, bearer/header, authorization, raw body, raw IP, Checkout URL, provider error, payment details, and secret-like keys cannot enter the type/runtime output. Test checkout success/reuse/failure, webhook duplicate/mismatch, cancellation ambiguity, and refund review events.

- [ ] **Step 2: Observe RED**

```bash
pnpm exec deno test --allow-env \
  supabase/functions/_shared/operationalLog.test.ts \
  supabase/functions/stripe-create-checkout/index.test.ts \
  supabase/functions/stripe-webhook/index.test.ts \
  supabase/functions/stripe-cancel-checkout/index.test.ts
```

Expected RED: the allowlisted logger does not exist and required operational events are absent.

- [ ] **Step 3: Implement structured event boundaries**

Emit one sanitized JSON record at meaningful transitions only. Do not log full inputs/outputs. Keep database receipt/error fields bounded to the safe mismatch codes.

- [ ] **Step 4: Write exact operational queries**

Document read-only queries for order/item count/subtotal disagreement, duplicate tiers, mixed event/organizer/currency, paid incomplete ticket sets, incoherent ticket sequences/references, cleanup-eligible stale rows and oldest age, review inventory omission, refunded ticket mismatch, partial refund not in review, provider object reuse, stuck retryable receipt, cron job health, and unresolved review orders.

Document switch operations and rollback:

```sql
update private.checkout_runtime_control
set checkout_creation_enabled = false, updated_at = statement_timestamp()
where singleton;
```

Only the database owner/operator executes this; there is no public toggle RPC. Re-enable only after the verification checklist passes.

- [ ] **Step 5: Run GREEN and documentation safety scan**

```bash
pnpm exec deno test --allow-env \
  supabase/functions/_shared/operationalLog.test.ts \
  supabase/functions/stripe-create-checkout/index.test.ts \
  supabase/functions/stripe-webhook/index.test.ts \
  supabase/functions/stripe-cancel-checkout/index.test.ts
pnpm test:functions
pnpm typecheck:functions
if grep -ERq '(rk_(test|live)_[A-Za-z0-9]|sk_(test|live)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9])' \
  Docs/runbooks/checkout-integrity-operations.md \
  Docs/testing/checkout-integrity-1-verification.md; then exit 1; fi
```

Expected GREEN: logs are useful and allowlisted; docs contain names/instructions only, no value-shaped credentials.

- [ ] **Step 6: Review and commit**

```bash
git add supabase/functions/_shared/operationalLog.ts \
  supabase/functions/_shared/operationalLog.test.ts \
  supabase/functions/stripe-create-checkout/index.ts \
  supabase/functions/stripe-create-checkout/index.test.ts \
  supabase/functions/stripe-webhook/index.ts \
  supabase/functions/stripe-webhook/index.test.ts \
  supabase/functions/stripe-cancel-checkout/index.ts \
  supabase/functions/stripe-cancel-checkout/index.test.ts \
  Docs/runbooks/checkout-integrity-operations.md \
  Docs/testing/checkout-integrity-1-verification.md
git commit -m "chore: add checkout integrity operations"
```

---

### Task 11: Regenerate Types and Prove Linked Database Contracts

**Purpose:** Make every new RPC/column consumable through generated types and prove browser-role denial plus linked concurrency behavior.

**Files:**
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/integration/run-ticketing-database.sh`
- Modify: `tests/integration/ticketing-database.test.ts`
- Modify: `tests/integration/ticketing-concurrency.test.ts`
- Modify: `tests/integration/ticketing-final-inventory-race.sh`
- Modify: `supabase/tests/database/moderation_epoch_concurrency.test.sh`
- Modify: `tests/integration/run-moderation-proof.sh`

**Interfaces:**
- Generated types include migrations 1–6, both temporary singular and new cart RPCs, refund evidence, and V2 confirmation/snapshot functions.
- The linked runner enables checkout creation only for its exact fixture and restores the previous switch value in its trap.

- [ ] **Step 1: Write integration RED before regeneration**

Update integration calls to the JSON cart RPC and assert exact two-item/three-ticket cardinality, browser-role RPC denial, item snapshot immutability, review inventory accounting, timestamp expiry, and concurrent final-inventory rejection. Add runner-contract assertions for switch restoration on success and failure.

- [ ] **Step 2: Observe RED**

```bash
pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/ticketing-database.test.ts \
  tests/integration/ticketing-concurrency.test.ts
pnpm typecheck
```

Expected RED: generated types lack the new RPC/columns and old integration inputs remain singular.

- [ ] **Step 3: Regenerate without hand-editing**

```bash
pnpm db:types
```

Review the diff to ensure it reflects only the linked migrations and contains no credential or unexpected unrelated schema.

- [ ] **Step 4: Implement guarded linked runner updates**

Capture the prior switch state into a `0600` temporary file, enable only during the disposable fixture, and restore it in `EXIT` before removing the temporary directory. Never print the state query alongside credentials. Update exact cleanup for multiple items/tickets.

- [ ] **Step 5: Run linked GREEN**

```bash
pnpm test:integration:ticketing-db
pnpm typecheck
pnpm lint
```

Expected GREEN: linked development schema accepts multi-item carts atomically, rejects browser access/oversell, and leaves zero fixture residue with original switch state restored.

- [ ] **Step 6: Review and commit**

```bash
git add src/lib/supabase/database.types.ts \
  tests/integration/run-ticketing-database.sh \
  tests/integration/ticketing-database.test.ts \
  tests/integration/ticketing-concurrency.test.ts \
  tests/integration/ticketing-final-inventory-race.sh \
  supabase/tests/database/moderation_epoch_concurrency.test.sh \
  tests/integration/run-moderation-proof.sh
git commit -m "test: prove linked checkout cart contracts"
```

---

### Task 12: Upgrade the Disposable Real Stripe Test Harness

**Purpose:** Make the committed test harness prove the exact approved cart, payment, fulfillment, expiration, refund, and teardown contract without exposing credentials.

**Files:**
- Modify: `tests/integration/stripe-ticketing.test.ts`
- Modify: `tests/integration/stripeTestObjects.ts`
- Modify: `tests/integration/stripeHarnessContract.test.ts`
- Modify: `tests/integration/stripeRunnerContract.test.ts`
- Modify: `tests/integration/stripeWebhookHarness.ts`
- Modify: `tests/integration/edge/task17-transaction-driver/index.ts`
- Modify: `tests/integration/run-stripe-ticketing-proof.sh`
- Modify: `Docs/testing/day2-stripe-transaction-proof.md`
- Modify: `Docs/testing/checkout-integrity-1-verification.md`

**Interfaces:**
- Driver `setup` returns `event_id`, at least two tier IDs, expected item/aggregate money, and no secret/hosted URL.
- Driver `inspect` returns safe order/item/ticket/refund/receipt/inventory fields needed for assertions.
- Driver `checkout_status` includes safe line summaries and exact Product binding validation, never the Checkout URL.
- Driver `create_refund` calls the shared whole-order helper.
- Runner temporarily enables new checkout creation and restores the previous value on every exit path.

- [ ] **Step 1: Write harness/runner RED**

Assert setup creates GA/VIP, checkout request is `2 + 1` with an independently random bearer header, status/reconciliation sees two lines/three admissions, refund uses both required flags, and cleanup accounts for all item/ticket rows. Simulate test failure and prove switch, temporary function, secrets, local materialization, database fixture, and disposable connected account cleanup still run.

- [ ] **Step 2: Observe RED without real Stripe**

```bash
pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/stripeHarnessContract.test.ts \
  tests/integration/stripeRunnerContract.test.ts
pnpm exec deno check --config deno.json \
  tests/integration/edge/task17-transaction-driver/index.ts
```

Expected RED: the current fixture and assertions are singular and the runner does not guard the new switch.

- [ ] **Step 3: Implement exact fixture and nonprinting guards**

Use one disposable connected test account, one event, at least two tiers, separate paid/declined-expired orders, exact cleanup tracking, `0600` temp files, managed Edge credentials, and test-only IDs kept out of reports. Reject any live publishable/restricted key prefix before collection and every `livemode !== false` object during proof.

- [ ] **Step 4: Implement multi-line/refund reconciliation assertions**

Prove exact destination charge, application fee using aggregate percentage plus per-ticket fixed component, line-to-order-item bindings, three ticket IDs internally, duplicate webhook no-op, decline/unpaid, expiry release, whole-order refund, transfer reversal, application-fee refund, and final database/Stripe reconciliation. Do not expose individual ticket IDs to the confirmation response.

- [ ] **Step 5: Run deterministic GREEN**

```bash
pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/stripeHarnessContract.test.ts \
  tests/integration/stripeRunnerContract.test.ts
pnpm exec deno check --config deno.json \
  tests/integration/edge/task17-transaction-driver/index.ts
pnpm typecheck
```

Expected GREEN: the harness is test-mode-only, multi-item-aware, exact-cleanup-safe, and reveals no secret value.

- [ ] **Step 6: Review and commit**

```bash
git add tests/integration/stripe-ticketing.test.ts \
  tests/integration/stripeTestObjects.ts \
  tests/integration/stripeHarnessContract.test.ts \
  tests/integration/stripeRunnerContract.test.ts \
  tests/integration/stripeWebhookHarness.ts \
  tests/integration/edge/task17-transaction-driver/index.ts \
  tests/integration/run-stripe-ticketing-proof.sh \
  Docs/testing/day2-stripe-transaction-proof.md \
  Docs/testing/checkout-integrity-1-verification.md
git commit -m "test: expand real Stripe checkout proof"
```

---

### Task 13: Deploy the Compatible Runtime and Run the Real Stripe Test-Mode Gate

**Purpose:** Prove the complete transaction against linked development Supabase and Stripe test mode before removing any singular compatibility surface.

**Files:**
- Evidence only in an ignored secure temporary directory; do not commit generated evidence, Checkout URLs, IDs, screenshots containing PII, or credentials.

**Interfaces:**
- Deploy order: webhook, order confirmation, cancellation, checkout creation.
- Database migrations 1–6 must be applied; migration 7 must remain pending.

- [ ] **Step 1: Run nonprinting environment/security preflight**

```bash
test -f supabase/.temp/project-ref
pnpm exec supabase projects list --output json >"$(mktemp)"
pnpm exec supabase migration list --linked
git status --short
git grep -Il -E '(rk_(test|live)_[A-Za-z0-9]|sk_(test|live)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9])' -- . ':!pnpm-lock.yaml' || true
```

Validate project JSON in a short Node process without printing IDs/keys: exactly one linked `ACTIVE_HEALTHY` project and it equals the recorded approved development project. Validate secret names exist through `supabase secrets list`; never request/reveal secret values. Fail if tracked credential-pattern filenames are returned after reviewing known false positives.

- [ ] **Step 2: Prove no real/open object blocks cutover**

Run read-only linked queries that return counts only: `livemode=true` rows must be zero; non-disposable paid/open/review orders and untracked Checkout Sessions must be zero. If any real financial record/object appears, stop before destructive cleanup or migration 7.

- [ ] **Step 3: Deploy new lifecycle runtime while switch stays off**

```bash
pnpm exec supabase functions deploy stripe-webhook --no-verify-jwt
pnpm exec supabase functions deploy order-confirmation --no-verify-jwt
pnpm exec supabase functions deploy stripe-cancel-checkout --no-verify-jwt
pnpm exec supabase functions deploy stripe-create-checkout --no-verify-jwt
pnpm exec supabase functions list --output json
```

Expected: all four deployments succeed; webhook/lifecycle remain callable; new creation remains blocked by the database switch outside the guarded proof.

- [ ] **Step 4: Run the canonical guarded real proof**

```bash
TEST_CONNECTED_ACCOUNT_ID="$TEST_CONNECTED_ACCOUNT_ID" \
TEST_CONNECTED_ACCOUNT_DISPOSABLE=1 \
  tests/integration/run-stripe-ticketing-proof.sh
```

The account ID is supplied through the environment, never printed by the plan/runner. Expected proof:

```text
test mode
2 GA + 1 VIP
one hosted Checkout
one destination charge
exact aggregate application fee with per-ticket fixed component
two deterministically bound Stripe lines
three individual tickets
duplicate webhook creates zero extra tickets
decline remains unpaid
expiry releases the whole cart
whole-order refund succeeds
transfer reversal equals refunded order amount
application-fee refund equals persisted application fee
database/Stripe reconciliation passes
fixture cleanup and zero residue pass
prior checkout-switch state is restored
```

- [ ] **Step 5: Rerun security/reconciliation checks**

Run the read-only queries from `Docs/runbooks/checkout-integrity-operations.md`, the nonprinting tracked/staged credential gate, and function/temporary-secret absence checks. Expected: no unexplained mismatch/review/stale reservation, no deployed temporary driver, no temporary secrets, no local materialization, and no credential artifact.

- [ ] **Step 6: Independent payment-critical review**

Use `superpowers:requesting-code-review` on Tasks 1–13 with emphasis on money, lock ordering, Session ambiguity, line bijection, ticket atomicity, refunds, bearer handling, logs, and cleanup. Apply `superpowers:receiving-code-review`; fix and rerun affected gates before proceeding. No commit is created for a clean operational-only task.

---

### Task 14: Expand Browser, Responsive, Accessibility, and Retry Proof

**Purpose:** Prove the customer journey and transaction comprehension at supported mobile/desktop viewports against the deployed compatible runtime before removing singular compatibility.

**Files:**
- Modify: `tests/e2e/support/ticketingFixture.ts`
- Modify: `tests/e2e/support/ticketingJourney.ts`
- Modify: `tests/e2e/ticket-purchase.spec.ts`
- Modify: `tests/e2e/ticket-purchase.visual.spec.ts`
- Modify: `tests/e2e/run-ticketing-browser-proof.sh`
- Modify: `tests/integration/task18RunnerContract.test.ts`
- Modify: `tests/integration/browserEvidence.test.ts`

**Interfaces:**
- Browser fixture creates at least GA and VIP tiers with enough inventory for `2 + 1`.
- Journey helpers choose quantities, intercept one ambiguous create response, reload, prove the same request/bearer pair is reused without exposing either value, complete hosted Checkout, and assert safe multi-item confirmation.

- [ ] **Step 1: Write E2E/runner RED**

Cover multi-tier selection, total ten limit, keyboard quantity changes, mobile/desktop overflow, validation focus/error announcements, ambiguous retry plus refresh, hosted-domain boundary, processing-to-paid transition, confirmation lines/total, and absence of UUID/Stripe/bearer strings from visible content and saved screenshots.

- [ ] **Step 2: Observe focused RED**

```bash
pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/task18RunnerContract.test.ts \
  tests/integration/browserEvidence.test.ts
pnpm exec playwright test --config playwright.config.ts \
  tests/e2e/ticket-purchase.spec.ts --project=mobile-chromium --grep "multi-tier cart"
```

Expected RED: fixtures/helpers still configure and purchase one tier/one ticket.

- [ ] **Step 3: Implement deterministic fixture/journey updates**

Keep disposable identities and cleanup exact. Ensure screenshots are taken only on local Whereto routes after query/hash sanitization and with email fields empty. Preserve reduced-motion and focus-ring checks. Reuse the Task 13 deployed runtime and the upgraded guarded driver; do not recreate a separate payment harness.

- [ ] **Step 4: Run functional and visual GREEN**

```bash
pnpm exec playwright test --config playwright.config.ts \
  tests/e2e/ticket-purchase.spec.ts --project=mobile-chromium
pnpm exec playwright test --config playwright.config.ts \
  tests/e2e/ticket-purchase.spec.ts --project=desktop-chromium
pnpm exec playwright test --config playwright.config.ts \
  tests/e2e/ticket-purchase.visual.spec.ts \
  --project=mobile-chromium --project=desktop-chromium
```

Expected GREEN: both viewports complete and understand the real test-mode cart; no overflow, inaccessible control, credential/PII artifact, or material visual regression.

- [ ] **Step 5: Review screenshots and commit**

Use `frontend-visual-qa` on generated screenshots. Fix transaction-critical accessibility/visual issues; classify unrelated low-severity differences separately.

```bash
git add tests/e2e/support/ticketingFixture.ts \
  tests/e2e/support/ticketingJourney.ts \
  tests/e2e/ticket-purchase.spec.ts \
  tests/e2e/ticket-purchase.visual.spec.ts \
  tests/e2e/run-ticketing-browser-proof.sh \
  tests/integration/task18RunnerContract.test.ts \
  tests/integration/browserEvidence.test.ts
git commit -m "test: verify multi-tier checkout browser flow"
```

---

### Task 15: Remove Singular Runtime Paths and Perform Development Cutover

**Purpose:** Remove temporary compatibility only after the new runtime and real Stripe proof are verified, then enable the new contract.

**Files:**
- Create: `supabase/migrations/20260902010600_remove_single_ticket_checkout_contract.sql`
- Create: `supabase/tests/database/checkout_integrity_contract_cleanup.test.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `Docs/runbooks/checkout-integrity-operations.md`
- Modify: `Docs/testing/checkout-integrity-1-verification.md`

**Interfaces removed:**
- `public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)` and `private.reserve_checkout(uuid,uuid,text,text,uuid,text)`.
- `public.server_get_checkout_preflight(uuid,uuid)` and `private.get_checkout_preflight(uuid,uuid)`.
- `private.checkout_reservation_v1(...)`.
- Singular request-digest helper overload.
- Old singular webhook snapshot functions superseded by `server_get_checkout_integrity_*`.
- Old singular order-confirmation projection superseded by V2.
- Production references to `items[0]`, `quantity === 1`, `quantity !== 1`, generic one-line Checkout, singular checkout `tierId`, and hard-coded ticket sequence one.

- [ ] **Step 1: Write contract-cleanup RED**

Assert every obsolete function resolves to null with `to_regprocedure`, every new function/ACL remains exact, and source scans find no reachable singular checkout runtime. Quantity-one single-item data must still pass through the generalized contract.

- [ ] **Step 2: Observe RED**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_contract_cleanup.test.sql
rg -n "deriveConfirmationToken|items\[0\]|quantity:\s*1|z\.literal\(1\)|p_tier_id" \
  src/features/checkout src/features/orders \
  supabase/functions/stripe-create-checkout \
  supabase/functions/stripe-webhook \
  supabase/functions/order-confirmation
```

Expected RED: temporary singular database functions still exist. Any source hit must be classified; fixture data may use quantity one, but no runtime may enforce singular cardinality.

- [ ] **Step 3: Implement migration 7 and remove only obsolete references**

Drop exact old signatures, helpers, comments, and grants. Do not drop normalized tables/columns, collapse existing items, delete financial history, or restore `UNIQUE(order_id)`.

- [ ] **Step 4: Review, commit, then apply cleanup**

```bash
git add supabase/migrations/20260902010600_remove_single_ticket_checkout_contract.sql \
  supabase/tests/database/checkout_integrity_contract_cleanup.test.sql \
  Docs/runbooks/checkout-integrity-operations.md \
  Docs/testing/checkout-integrity-1-verification.md
git commit -m "refactor: remove single-ticket checkout paths"
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
```

Expected: only migration 7 applies, and the already-deployed new runtime remains compatible.

- [ ] **Step 5: Regenerate final types and commit separately**

```bash
pnpm db:types
pnpm typecheck
git add src/lib/supabase/database.types.ts
git commit -m "chore: refresh checkout integrity types"
```

- [ ] **Step 6: Run cleanup GREEN and cutover checks**

```bash
pnpm exec supabase test db --linked \
  supabase/tests/database/checkout_integrity_contract_cleanup.test.sql
pnpm test:functions
pnpm typecheck:functions
pnpm test:integration:ticketing-db
```

After all checks pass, the database owner sets `checkout_creation_enabled = true` in linked development and verifies one new cart request reaches the new overload. Re-disabling it must still leave webhook/cancel/expiry/refund/confirmation operational.

- [ ] **Step 7: Record forward-fix rollback procedure**

If a defect appears after any multi-item order/Session exists: disable new creation, keep lifecycle processing on, do not revert migration 7 or deploy singular code, add a forward migration/release, reconcile existing orders, rerun the affected gates, then re-enable.

---

### Task 16: Run the Full Release Gate, Final Review, and Finish the Branch

**Purpose:** Verify the final branch and merged result with evidence before any completion claim.

**Files:**
- Modify only evidence-backed fixes found by final review, each in a separate scoped commit.
- Finalize: `Docs/testing/checkout-integrity-1-verification.md` with commands/outcomes only; no secrets, PII, Checkout URLs, or provider IDs.

- [ ] **Step 1: Run the complete database gate sequentially**

```bash
pnpm exec supabase migration list --linked
pnpm exec supabase test db --linked
pnpm exec supabase db lint --linked --schema public,private
bash supabase/tests/database/checkout_integrity_concurrency.test.sh
bash supabase/tests/database/payment_fulfillment_concurrency.test.sh
bash supabase/tests/database/paid_tier_lock_order.test.sh
pnpm test:integration:ticketing-db
```

Expected: all migrations align; all pgTAP/concurrency/integration suites pass; no oversell, deadlock, partial fulfillment, stale eligible hold, or fixture residue.

- [ ] **Step 2: Run complete code and Edge gates**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:functions
pnpm typecheck:functions
pnpm test:integration
pnpm build
```

Expected: zero failures. Investigate warnings; payment/security warnings cannot be waived.

- [ ] **Step 3: Run full browser proof**

```bash
pnpm test:e2e:ticketing
pnpm test:e2e
```

Expected: multi-tier purchase, refresh retry, confirmation, mobile/desktop, accessibility, moderation/public eligibility, and broad regression suites pass. Inspect visual artifacts with `frontend-visual-qa`; do not commit them.

- [ ] **Step 4: Rerun the real Stripe proof after final code/migration state**

```bash
TEST_CONNECTED_ACCOUNT_ID="$TEST_CONNECTED_ACCOUNT_ID" \
TEST_CONNECTED_ACCOUNT_DISPOSABLE=1 \
  tests/integration/run-stripe-ticketing-proof.sh
```

Expected: the exact Task 14 proof passes again with zero residue and test mode only.

- [ ] **Step 5: Run `superpowers:verification-before-completion` and independent final review**

Review the complete branch diff against every approved design section. Block release for any unresolved Critical/Important issue in money, inventory, idempotency, fulfillment, refund, security, or reconciliation. Apply evidence-backed fixes as new commits and rerun every affected focused/full gate.

- [ ] **Step 6: Run final repository/security checks**

```bash
git diff --check main...HEAD
git status --short
git log --oneline --decorate main..HEAD
git grep -Il -E '(rk_(test|live)_[A-Za-z0-9]|sk_(test|live)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9])' -- . ':!pnpm-lock.yaml' || true
find . -type f \( -name '*.log' -o -name '*.har' -o -name 'playwright-report*' -o -name 'test-results*' \) -not -path './node_modules/*' -not -path './.git/*'
```

Expected: worktree clean, only intentional commits, no credential-bearing tracked file, and no unignored test artifact. Review filenames from nonprinting scans; never print file contents containing a suspected credential.

- [ ] **Step 7: Finish and integrate**

Use `superpowers:finishing-a-development-branch`. Rebase/merge only after verification, preserve Day 1/Day 2/Build 2.5 history, verify merged `main` with the required fast/full gates, and push the verified `main` to `origin`. Do not begin map, analytics, QR/check-in, or partial-refund product work.

---

## Release-Blocking Acceptance Matrix

| Area | Required evidence |
|---|---|
| Cart contract | Strict exact-key JSON, duplicate rejection, aggregate `1..10`, multi-tier UX, no browser money |
| Money | Persisted integer snapshots, aggregate percentage rounding, per-ticket fixed component, exact Stripe amount/fee/destination |
| Inventory | Event + sorted-tier locks, all-or-nothing cart, review inventory held, timestamp expiry, automated cleanup, no oversell/deadlock |
| Stripe mapping | Product metadata stable item ID, exact item bijection, no position/name/price-only matching, test mode only |
| Fulfillment | One ticket per unit, exact sequences/references, atomic transaction, retry-stable IDs/timestamps |
| Idempotency | Browser UUID/bearer reuse, independent bearer randomness, database digest conflict, Stripe keys, receipt dedupe |
| Cancellation/refund | Whole order only, ambiguous state holds, both Stripe unwind flags, partial/incomplete refund review, no allocation |
| Confirmation | Tier labels/quantities/totals, safe states, no ticket/order-item/Stripe IDs or buyer PII |
| Security | RLS/ACL deny, raw signature verification, sanitized errors/logs, no credentials/bearers/artifacts |
| Rollout | Default-off switch, migrations 1–6 before Edge, real smoke before migration 7, lifecycle always on, forward-fix rollback |
| Regression | Database, Edge, unit, integration, E2E, responsive, accessibility, visual, and real Stripe gates pass |

## Definition of Done

Checkout Integrity 1.0 is complete only when all 16 tasks are finished and review-clean; all code/document changes are committed; migrations 1–7 align locally/remotely; obsolete singular runtime paths are unreachable; linked development checkout uses only the new contract; the full deterministic suite and two final real Stripe test-mode proofs pass; the switch/runbook/forward-fix path is verified; exact cleanup leaves no disposable residue; no secret/PII/artifact is tracked or staged; independent final review has no unresolved Critical/Important finding; verified work is integrated into `main`; and verified `main` is pushed. No organizer analytics, map, QR/check-in, or partial-refund product flow begins in this milestone.
