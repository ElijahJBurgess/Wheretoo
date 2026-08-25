# Whereto Day 2 Native Ticketing and Marketplace Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a secure Stripe test-mode marketplace journey from organizer Connect onboarding and paid-tier activation through guest Checkout, authoritative webhook fulfillment, exactly-once ticket issuance, and persisted confirmation.

**Architecture:** Preserve the Day 1 React/Supabase ownership model. PostgreSQL owns paid-sale readiness, fee arithmetic, inventory reservations, and monotonic order/ticket state; narrowly scoped Supabase Edge Functions own Stripe Accounts v2, hosted Checkout, webhooks, and private projections; React consumes only typed organizer or bearer-safe public contracts.

**Tech Stack:** Node 22, pnpm 11, `deno@2.9.5`, React 19, TypeScript 6, Vite 8, React Router 7, TanStack Query 5, React Hook Form, Zod 4, Supabase Auth/PostgreSQL/Edge Functions, Stripe Accounts v2, Stripe-hosted Checkout, `stripe@22.5.0`, `@stripe/connect-js@3.4.6`, `@stripe/react-connect-js@3.4.4`, Vitest, React Testing Library, pgTAP, Stripe CLI, and Playwright.

**Spec:** `Docs/superpowers/specs/2026-08-25-native-ticketing-payments-design.md`

## Global Constraints

- Read `AGENTS.md`, the approved spec, and the three V1 product documents before execution.
- Treat the latest approved fee addendum as binding for test mode: `platform_percent_bps = 500`, `platform_fixed_minor = 50`, `processing_fee_treatment = 'platform_fee_only'`, and `application_fee_amount_minor = floor(subtotal_minor * 500 / 10000) + 50 * quantity`.
- The 5% + $0.50 rule is test-only configuration. Do not define, infer, or deploy live pricing.
- Use Stripe test mode only. Reject any `livemode = true` object in Day 2 code and tests.
- Never commit or print Stripe keys, webhook secrets, Supabase service-role keys, customer PII, Account Session secrets, Checkout URLs, or credentialed artifacts.
- Only `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` may enter the Vite bundle. All restricted/secret Stripe values stay in Supabase Edge Function secrets.
- Prefer a least-privilege `rk_test_` key. A test `sk_test_` key is acceptable only when the Accounts v2 API operation cannot be granted to a restricted key; record that exception in the runbook.
- Confirm the linked Supabase project and Stripe account are non-production before remote schema, function deployment, or Stripe-object creation.
- Use Stripe Accounts v2 recipient configuration, Express Dashboard, application fee/loss responsibility, and destination charges. Do not substitute direct charges or separate charges/transfers.
- Use Stripe-hosted Checkout in payment mode. Do not pass browser money, destination IDs, fee values, inventory values, or payment success into authoritative state transitions.
- A verified raw-body webhook is the only authority for paid state and ticket issuance. Redirect state remains processing until persisted truth changes.
- Day 2 supports one tier and quantity one per checkout, up to three tiers per event, USD only, integer minor units only, and no Stripe Tax collection.
- Preserve `events.capacity` for later free RSVP. Paid inventory is tier-specific and derived from durable order state.
- Preserve Day 1 event IDs, ownership, moderation visibility, `published_at`, auth/session behavior, Mapbox behavior, owner-aware query keys, and LA wall-time contracts.
- No live mode, free RSVP, QR/check-in, analytics, attendee management, payouts dashboard, refund UI, map work, AI flyer, consumer account, search, messaging, promotion codes, resale, transfers, subscriptions, or reserved seating.
- Use TDD for every behavior: write the focused failing test, observe the intended failure, implement the smallest contract, rerun the focused test, then run the task-level regression gate.
- Use direct imports and focused files. Do not add application barrel files or move Day 1 modules without necessity.
- Every task ends with `git diff --check`, a scoped secret scan, a scoped commit, and a fresh report/checkpoint. Never stage the execution-plan checklist while workers update it.
- Local Docker absence is not a blocker: keep local Supabase commands documented and use the positively identified linked development project plus rollback-only authenticated pgTAP fallback when necessary.

---

## Planned File Map

### Repository, environment, and verification

- `.env.example`, `src/lib/env.ts`, `src/config/browserEnv.ts`, `src/vite-env.d.ts` — public Stripe publishable-key contract only.
- `package.json`, `pnpm-lock.yaml`, `deno.json` — pinned Connect packages plus Deno imports, checks, and isolated Edge unit tests.
- `supabase/config.toml`, `supabase/functions/.env.example` — function routes and secret names without values.
- `Docs/testing/day2-ticketing-payments-verification.md` — test-mode setup, deployment, webhook replay, cleanup, reconciliation, and live blockers.

### Database

- `supabase/migrations/20260825010000_create_ticketing_payments_schema.sql` — Connect, fee, tier, order, item, ticket, webhook, and refund tables.
- `supabase/migrations/20260825010100_secure_paid_sales_and_tiers.sql` — grants, RLS, owned tier functions, public projection, and paid activation.
- `supabase/migrations/20260825010200_create_order_inventory_functions.sql` — reservation, Checkout attachment, cancellation, and expiry.
- `supabase/migrations/20260825010300_create_payment_fulfillment_functions.sql` — payment, refund, and dispute reconciliation.
- `supabase/tests/database/ticketing_schema.test.sql`, `ticketing_rls.test.sql`, `paid_sales.test.sql`, `inventory_reservations.test.sql`, `payment_fulfillment.test.sql`, `refunds_disputes.test.sql` — structural, authorization, arithmetic, concurrency, and idempotency proof.

### Edge Functions

- `supabase/functions/_shared/{env,cors,http,auth,database,stripeClient,stripeErrors,connectState,contracts}.ts` — server-only environment, clients, validation, safe errors, and transport contracts.
- `supabase/functions/{stripe-connect-session,stripe-connect-status,stripe-express-login,stripe-create-checkout,stripe-cancel-checkout,stripe-webhook,order-confirmation}/index.ts` — seven narrow boundaries.
- Co-located `*.test.ts` files — protocol, auth, raw-signature, retry, and response tests.

### React features

- `src/features/payments/*` — organizer Connect types, API/query hooks, embedded components, and status/setup page.
- `src/features/tickets/*` — tier schemas, API/query hooks, organizer tier management, and public event projection.
- `src/features/checkout/*` — guest validation, Checkout creation/cancellation, and tier review page.
- `src/features/orders/*` — bearer-token confirmation projection, polling, and confirmation states.
- `src/app/router/router.tsx`, `src/components/layout/OrganizerLayout.tsx`, `src/styles/global.css` — exact Day 2 routes, organizer entry, and established visual system extension.
- `tests/integration/*ticketing*`, `tests/e2e/ticket-purchase*.spec.ts`, `tests/e2e/support/ticketingJourney.ts` — hosted Supabase/Stripe and browser proof.

---

### Task 1: Establish the Test-Mode Boundary and Edge Test Harness

**Files:**
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Modify: `src/config/browserEnv.ts`
- Modify: `src/config/browserEnv.test.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `supabase/config.toml`
- Create: `supabase/functions/.env.example`
- Create: `supabase/functions/_shared/harness.test.ts`
- Create: `deno.json`

**Interfaces:**
- Consumes: existing fail-fast `readPublicEnv` and Vite allowlist.
- Produces: `publicEnv.stripePublishableKey`, `pnpm test:functions`, `pnpm typecheck:functions`, pinned Connect packages, and explicit function JWT settings.

- [ ] **Step 1: Record safe environment preconditions**

Run key-name-only checks and confirm test projects without printing values:

```bash
git status --short --branch
git check-ignore -v .env.local
awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' .env.local | sort -u
supabase projects list
npx --yes @stripe/cli --version
pnpm dlx deno@2.9.5 --version
```

Expected: `.env.local` is ignored; no live-key name is required; the operator positively identifies linked Supabase and Stripe environments as development/test.

- [ ] **Step 2: Write failing public-env and function-harness tests**

Assert `readPublicEnv` rejects a missing/blank `VITE_STRIPE_PUBLISHABLE_KEY` and `selectBrowserEnv` returns only four approved public names. Add a Deno smoke test that imports the shared test directory without reading repository `.env` files.

- [ ] **Step 3: Observe RED**

Run: `pnpm test -- src/lib/env.test.ts src/config/browserEnv.test.ts`

Expected: FAIL because the Stripe public key is not part of either contract.

- [ ] **Step 4: Install and configure exact browser dependencies**

```bash
pnpm add @stripe/connect-js@3.4.6 @stripe/react-connect-js@3.4.4
pnpm add -D deno@2.9.5
```

Add `VITE_STRIPE_PUBLISHABLE_KEY=` to `.env.example`; add only secret names to `supabase/functions/.env.example`:

```dotenv
STRIPE_RESTRICTED_KEY=
STRIPE_WEBHOOK_SECRET=
APP_BASE_URL=
```

Configure all seven Edge Functions with `verify_jwt = false`; authenticated functions must verify bearer tokens explicitly in Task 7. Pin `stripe` to `npm:stripe@22.5.0` in `deno.json`; define Deno tasks `test = "deno test --allow-env supabase/functions"` and `check = "deno check supabase/functions/**/*.ts"`; expose them as `pnpm test:functions` and `pnpm typecheck:functions`.

- [ ] **Step 5: Prove GREEN and bundle boundaries**

Run: `pnpm test -- src/lib/env.test.ts src/config/browserEnv.test.ts && pnpm test:functions && pnpm typecheck:functions && pnpm typecheck && pnpm build`

Expected: env and Deno smoke tests pass; all Edge entry points typecheck; build contains the publishable-key name but no server secret names or values.

- [ ] **Step 6: Commit**

```bash
git add .env.example package.json pnpm-lock.yaml deno.json src/lib/env.ts src/lib/env.test.ts src/config/browserEnv.ts src/config/browserEnv.test.ts src/vite-env.d.ts supabase/config.toml supabase/functions/.env.example supabase/functions/_shared/harness.test.ts
git diff --cached --check
git commit -m "chore: establish Stripe test boundary"
```

### Task 2: Create the Financial Schema and Locked Test Fee Rule

**Files:**
- Create: `supabase/migrations/20260825010000_create_ticketing_payments_schema.sql`
- Create: `supabase/tests/database/ticketing_schema.test.sql`

**Interfaces:**
- Produces: `organizer_stripe_accounts`, `platform_fee_rules`, `ticket_tiers`, `orders`, `order_items`, `tickets`, `stripe_webhook_events`, `refunds`; stable checks and unique keys.

- [ ] **Step 1: Write structural pgTAP RED**

Test exact tables/columns/types/checks/FKs/indexes, updated-at triggers, unique Stripe IDs, one order item per Day 2 order, unique `(order_item_id, unit_sequence)`, USD/livemode guards, and one active test fee rule with:

```sql
platform_percent_bps = 500
and platform_fixed_minor = 50
and processing_fee_treatment = 'platform_fee_only'
and livemode is false
and currency = 'usd'
```

- [ ] **Step 2: Observe RED against the confirmed development schema**

Run: `pnpm supabase test db --linked supabase/tests/database/ticketing_schema.test.sql`

Expected: FAIL on missing tables. If CLI invokes Docker unconditionally, run the unchanged pgTAP file through the established rollback-only authenticated database query endpoint and record both results.

- [ ] **Step 3: Implement the migration**

Create all eight tables and constraints from spec section 7. Use `bigint` minor units, normalized lowercase Stripe IDs/currency, checks against `livemode = true` for the Day 2 test rule, and this deterministic fee expression:

```sql
floor((subtotal_minor * platform_percent_bps)::numeric / 10000)::bigint
  + (platform_fixed_minor * quantity)
```

Seed exactly one non-live USD fee rule at 500 bps + 50 minor units per ticket. Do not seed a live rule.

- [ ] **Step 4: Dry-run, apply, and prove GREEN**

Run sequentially:

```bash
pnpm supabase db push --linked --dry-run
pnpm supabase db push --linked
pnpm supabase migration list --linked
pnpm supabase db lint --linked --schema public
```

Expected: dry-run lists only `20260825010000`; local/remote history aligns; schema pgTAP passes with no extension or fixture leakage.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825010000_create_ticketing_payments_schema.sql supabase/tests/database/ticketing_schema.test.sql
git diff --cached --check
git commit -m "feat: add ticketing payment schema"
```

### Task 3: Secure Tiers, Public Projection, and Paid-Sales Activation

**Files:**
- Create: `supabase/migrations/20260825010100_secure_paid_sales_and_tiers.sql`
- Create: `supabase/tests/database/ticketing_rls.test.sql`
- Create: `supabase/tests/database/paid_sales.test.sql`
- Modify: `supabase/tests/database/publish_event.test.sql`

**Interfaces:**
- Produces: `public.list_owned_ticket_tiers(uuid)`, `public.save_ticket_tiers(uuid,jsonb)`, `public.activate_paid_sales(uuid)`, `public.get_public_event_ticketing(uuid)`.

- [ ] **Step 1: Write authorization and activation RED**

Prove anon/auth have no table access to financial/customer tables; organizer A cannot inspect/mutate B's tiers or Connect status; public projection returns only discoverable paid event plus active safe tiers; blocked/removed/draft events return no row; `flagged` remains public.

Prove `activate_paid_sales` requires owner, current public/draft-valid event, 1-3 valid tiers, active non-live fee rule, fresh active transfers/payouts, clear requirements, and preserves an already-published event's ID and `published_at`.

- [ ] **Step 2: Observe RED**

Run the three focused pgTAP files. Expected: missing functions/policies and Day 1 paid rejection failures.

- [ ] **Step 3: Implement least-privilege functions and grants**

All security-definer functions use `set search_path = ''`, qualified identifiers, row locks, exact `auth.uid()` ownership, `revoke all ... from public, anon`, and narrow grants. `get_public_event_ticketing` returns JSON with only event display fields and tier `id/name/description/unit_amount_minor/currency/availability_status`; it never returns counts, Connect IDs, fee rules, customer data, or financial IDs.

Replace Day 1's blanket `PAID_PUBLISHING_NOT_AVAILABLE` with paid-readiness validation. `activate_paid_sales` may convert an already-published free event without replacing it or modifying `published_at`.

- [ ] **Step 4: Apply and prove GREEN**

Dry-run must list only `20260825010100`; push it, run focused pgTAP, rerun all four Day 1 pgTAP files, lint the public schema, and verify migration alignment.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825010100_secure_paid_sales_and_tiers.sql supabase/tests/database/ticketing_rls.test.sql supabase/tests/database/paid_sales.test.sql supabase/tests/database/publish_event.test.sql
git diff --cached --check
git commit -m "feat: secure paid event activation"
```

### Task 4: Add Atomic Checkout Reservations and Expiry

**Files:**
- Create: `supabase/migrations/20260825010200_create_order_inventory_functions.sql`
- Create: `supabase/tests/database/inventory_reservations.test.sql`

**Interfaces:**
- Produces private service-only functions:

```sql
private.reserve_checkout(p_event_id uuid, p_tier_id uuid, p_name text, p_email text, p_client_request_id uuid, p_confirmation_token_hash text) returns table(order_id uuid, organizer_id uuid, subtotal_minor bigint, currency text, application_fee_amount_minor bigint, stripe_account_id text, checkout_expires_at timestamptz, existing_checkout_session_id text)
private.attach_checkout_session(p_order_id uuid, p_session_id text, p_expires_at timestamptz) returns uuid
private.cancel_checkout_reservation(p_order_id uuid, p_reason text) returns uuid
private.expire_checkout_reservations(p_now timestamptz) returns integer
```

- [ ] **Step 1: Write reservation RED**

Cover exact 500 bps + 50-per-ticket snapshots, quantity one, normalized email, bearer-token hashing, event/tier/Connect/fee revalidation, same-request idempotency, final-ticket locking, stale reservation release, Checkout attachment once, and no browser execution grant.

- [ ] **Step 2: Observe RED**

Run the focused pgTAP file. Expected: missing private functions.

- [ ] **Step 3: Implement the transaction**

Lock tier then event in stable order; count `paid`, `payment_processing`, and unexpired `checkout_open` quantities; create `creating_checkout` order/item only when availability is positive. Never accept browser amount/currency/fee/destination/organizer. The server caller generates a 32-byte confirmation token before reservation and passes only its SHA-256 hash to this function. The clear token is placed only in Stripe's success/cancel return URLs; it is never stored in PostgreSQL or returned separately from the hosted Checkout URL.

- [ ] **Step 4: Prove race and arithmetic GREEN**

Run focused pgTAP plus a two-session SQL race: one final-ticket reservation commits; the other returns `TIER_SOLD_OUT`; one inventory unit is reserved. Verify retry returns the same order and does not add 50 cents twice.

- [ ] **Step 5: Apply migration and commit**

Dry-run/push only `20260825010200`, rerun linked history/lint, then:

```bash
git add supabase/migrations/20260825010200_create_order_inventory_functions.sql supabase/tests/database/inventory_reservations.test.sql
git diff --cached --check
git commit -m "feat: reserve paid ticket inventory"
```

### Task 5: Add Exactly-Once Fulfillment, Refund, and Dispute State

**Files:**
- Create: `supabase/migrations/20260825010300_create_payment_fulfillment_functions.sql`
- Create: `supabase/tests/database/payment_fulfillment.test.sql`
- Create: `supabase/tests/database/refunds_disputes.test.sql`

**Interfaces:**
- Produces `private.record_webhook_receipt`, `private.fulfill_paid_order`, `private.mark_payment_processing`, `private.mark_payment_failed`, `private.apply_refund`, and `private.apply_dispute`.

- [ ] **Step 1: Write fulfillment RED**

Assert exact Session/order/mode/currency/subtotal/total/application-fee/destination matching; paid-only fulfillment; monotonic states; one ticket; duplicate events/sessions/payment intents are idempotent; invalidated inventory becomes `requires_review`; partial/full refunds invalidate correctly; dispute recovery is recorded once.

- [ ] **Step 2: Observe RED**

Run both focused pgTAP files. Expected: missing functions and grants.

- [ ] **Step 3: Implement locked-order transitions**

Use a unique Stripe event receipt plus domain uniqueness. Lock webhook receipt, order, and tier in stable order. Insert `tickets(unit_sequence=1)` only after all Stripe snapshots match and status is paid. Never move terminal states backward. Refund/dispute functions store Stripe truth and make tickets non-valid without deleting history.

- [ ] **Step 4: Prove GREEN and apply**

Run focused pgTAP, all ticketing pgTAP, migration dry-run/push for only `20260825010300`, linked lint/history, and leakage checks.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825010300_create_payment_fulfillment_functions.sql supabase/tests/database/payment_fulfillment.test.sql supabase/tests/database/refunds_disputes.test.sql
git diff --cached --check
git commit -m "feat: fulfill paid tickets exactly once"
```

### Task 6: Regenerate Types and Define Browser Domain Contracts

**Files:**
- Modify: `src/lib/supabase/database.types.ts`
- Create: `src/features/payments/payment.types.ts`
- Create: `src/features/tickets/ticket.types.ts`
- Create: `src/features/tickets/ticket.schemas.ts`
- Create: `src/features/tickets/ticket.schemas.test.ts`
- Create: `src/features/checkout/checkout.schemas.ts`
- Create: `src/features/checkout/checkout.schemas.test.ts`
- Create: `src/features/orders/order.types.ts`

**Interfaces:**
- Produces exact `ConnectStatus`, `TicketTierInput`, `PublicTicketingEvent`, `CheckoutInput`, and `OrderConfirmation` discriminated unions.

- [ ] **Step 1: Write schema RED**

Cover 1-3 unique trimmed tiers, 80/240 character limits, USD integer bounds, positive capacity, quantity fixed to one, normalized guest name/email, UUID IDs, and rejection of money/destination fields in checkout input.

- [ ] **Step 2: Observe RED**

Run: `pnpm test -- src/features/tickets/ticket.schemas.test.ts src/features/checkout/checkout.schemas.test.ts`

- [ ] **Step 3: Regenerate and implement contracts**

Run `pnpm db:types`. Define exhaustive unions matching migration states; no `any`, unchecked casts, or duplicated database row shapes.

- [ ] **Step 4: Prove GREEN**

Run focused tests, `pnpm typecheck`, `pnpm lint`, and assert generated types contain all eight tables and four public RPCs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/database.types.ts src/features/payments/payment.types.ts src/features/tickets src/features/checkout/checkout.schemas.ts src/features/checkout/checkout.schemas.test.ts src/features/orders/order.types.ts
git diff --cached --check
git commit -m "feat: define ticketing payment contracts"
```

### Task 7: Build the Shared Server-Only Stripe Boundary

**Files:**
- Create: `supabase/functions/_shared/env.ts`
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/http.ts`
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/_shared/database.ts`
- Create: `supabase/functions/_shared/stripeClient.ts`
- Create: `supabase/functions/_shared/stripeErrors.ts`
- Create: `supabase/functions/_shared/connectState.ts`
- Create: `supabase/functions/_shared/contracts.ts`
- Create: `supabase/functions/_shared/shared.test.ts`

**Interfaces:**
- Produces `getStripe(): Stripe`, `requireOrganizer(req)`, `getServiceClient()`, `deriveConnectStatus(account)`, `safeErrorResponse(error)`, and exact-origin CORS helpers.

- [ ] **Step 1: Write shared-boundary RED**

Test fail-fast `rk_test_`/allowed test-key validation, rejection of live keys/objects, explicit API version, one client instance, bearer verification through `auth.getUser`, organizer lookup, exact CORS origin, safe error codes, and no PII/header/body logging.

- [ ] **Step 2: Observe RED**

Run: `pnpm test:functions -- supabase/functions/_shared/shared.test.ts`

- [ ] **Step 3: Implement minimal adapters**

Instantiate `npm:stripe@22.5.0` once with an explicit current API version. Parse env only inside function runtime. `requireOrganizer` returns authorization-safe 401/404 and never trusts a user ID from JSON.

- [ ] **Step 4: Prove GREEN**

Run focused functions tests, functions TypeScript check, lint, and a secret-name/value scan over `src`, `dist`, and tracked files.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared deno.json
git diff --cached --check
git commit -m "feat: add server-only Stripe boundary"
```

### Task 8: Implement Accounts v2 Connect Functions

**Files:**
- Create: `supabase/functions/stripe-connect-session/index.ts`
- Create: `supabase/functions/stripe-connect-session/index.test.ts`
- Create: `supabase/functions/stripe-connect-status/index.ts`
- Create: `supabase/functions/stripe-connect-status/index.test.ts`
- Create: `supabase/functions/stripe-express-login/index.ts`
- Create: `supabase/functions/stripe-express-login/index.test.ts`

**Interfaces:**
- Produces authenticated JSON contracts for ephemeral Account Session, safe current status, and short-lived Express login URL.

- [ ] **Step 1: Write protocol RED**

Assert one non-live account per organizer, Accounts v2 recipient configuration, `dashboard='express'`, `fees_collector='application'`, `losses_collector='application'`, requested `stripe_balance.stripe_transfers`, no merchant/card-payments request, embedded component permissions, ownership, and current Account retrieval before readiness.

- [ ] **Step 2: Observe RED**

Run the three focused function tests; expect missing handlers.

- [ ] **Step 3: Implement handlers**

Use deterministic database uniqueness and Stripe idempotency keys. Persist only account ID plus safe capabilities/requirements projection. Account Session response contains only its client secret and safe status. Express URL is returned only for the caller's account and is never logged.

- [ ] **Step 4: Prove GREEN and deploy to development**

Run focused/all functions tests and typecheck. Deploy only the three functions to confirmed development; invoke missing/invalid/authenticated paths and verify no secret appears in output.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-connect-session supabase/functions/stripe-connect-status supabase/functions/stripe-express-login
git diff --cached --check
git commit -m "feat: onboard organizers with Stripe Connect"
```

### Task 9: Build the Organizer Payments Experience

**Files:**
- Create: `src/features/payments/payment.api.ts`
- Create: `src/features/payments/payment.api.test.ts`
- Create: `src/features/payments/payment.queries.ts`
- Create: `src/features/payments/payment.queries.test.tsx`
- Create: `src/features/payments/ConnectEmbeddedPanel.tsx`
- Create: `src/features/payments/OrganizerPaymentsPage.tsx`
- Create: `src/features/payments/OrganizerPaymentsPage.test.tsx`
- Modify: `src/app/router/router.tsx`
- Modify: `src/components/layout/OrganizerLayout.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes Task 8 functions; produces `/organizer/settings/payments` and organizer-scoped query keys.

- [ ] **Step 1: Write organizer journey RED**

Cover loading/error/not-started/pending/action-required/restricted/ready states, exact authenticated function calls, lazy Connect package loading, Account Session refresh, embedded onboarding/account-management/notification components, Express login, focus recovery, and no financial dashboard UI.

- [ ] **Step 2: Observe RED**

Run focused payment tests; expect missing modules/route.

- [ ] **Step 3: Implement API, query, and page**

Use `paymentKeys.connect(userId)`; never share cached status across users. Render the established organizer-console hierarchy, one dominant remediation action, 44px targets, safe generic error copy, and no Account ID or raw Stripe requirements.

- [ ] **Step 4: Prove GREEN**

Run focused tests, full unit suite, typecheck, lint, build, and bundle inspection proving Connect libraries are lazy and server secrets absent.

- [ ] **Step 5: Commit**

```bash
git add src/features/payments src/app/router/router.tsx src/components/layout/OrganizerLayout.tsx src/styles/global.css
git diff --cached --check
git commit -m "feat: add organizer payment setup"
```

### Task 10: Build Owned Ticket Tiers and Paid-Sales Activation

**Files:**
- Create: `src/features/tickets/ticket.api.ts`
- Create: `src/features/tickets/ticket.api.test.ts`
- Create: `src/features/tickets/ticket.queries.ts`
- Create: `src/features/tickets/ticket.queries.test.tsx`
- Create: `src/features/tickets/OrganizerTicketTiersPage.tsx`
- Create: `src/features/tickets/OrganizerTicketTiersPage.test.tsx`
- Create: `src/features/tickets/paidSalesErrors.ts`
- Create: `src/features/tickets/paidSalesErrors.test.ts`
- Modify: `src/features/events/EventEditorPage.tsx`
- Modify: `src/features/events/EventEditorPage.test.tsx`
- Modify: `src/app/router/router.tsx`

**Interfaces:**
- Produces `/organizer/events/:eventId/tickets`, `ticketKeys.owned(organizerId,eventId)`, save and activation mutations.

- [ ] **Step 1: Write tier/activation RED**

Cover owner-aware loading/not-found, 1-3 tier edit/replace/archive, exact price-to-minor conversion, capacity protection, retained values/errors, unsaved-change blocker, incomplete Connect guidance, draft and already-published activation, unchanged published event identity/timestamp, and no fee editor.

- [ ] **Step 2: Observe RED**

Run focused tier/editor tests; expect missing modules and route.

- [ ] **Step 3: Implement page and hooks**

Call only the owned RPCs from Task 3. Cache keys include organizer and event IDs. On activation, invalidate exact owned event/list, owned tiers, public event projection, and Connect status; never seed mismatched owner data.

- [ ] **Step 4: Prove GREEN**

Run focused tests, full unit tests, typecheck, lint, and build. Verify paid selection routes to ticket setup without changing Day 1 free draft behavior.

- [ ] **Step 5: Commit**

```bash
git add src/features/tickets src/features/events/EventEditorPage.tsx src/features/events/EventEditorPage.test.tsx src/app/router/router.tsx
git diff --cached --check
git commit -m "feat: manage paid ticket tiers"
```

### Task 11: Add the Anonymous Public Event and Tier Experience

**Files:**
- Create: `src/features/tickets/publicTicketing.api.ts`
- Create: `src/features/tickets/publicTicketing.api.test.ts`
- Create: `src/features/tickets/publicTicketing.queries.ts`
- Create: `src/features/tickets/PublicTicketEventPage.tsx`
- Create: `src/features/tickets/PublicTicketEventPage.test.tsx`
- Create: `src/features/tickets/TicketTierList.tsx`
- Modify: `src/app/router/router.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces `/events/:eventId`, `ticketKeys.public(eventId)`, and navigation to `/events/:eventId/checkout?tier=<uuid>`.

- [ ] **Step 1: Write public projection/page RED**

Cover public published clear/flagged display, draft/blocked/removed not found, unpaid/not-on-sale, safe tier fields, sold-out state, currency formatting from minor units, one selected tier, mobile/desktop semantics, and absence of organizer financial details.

- [ ] **Step 2: Observe RED**

Run focused public ticket tests; expect missing modules/route.

- [ ] **Step 3: Implement public read and UI**

Call `get_public_event_ticketing` with the anon client. Use persisted data only, semantic tier radios, a single checkout CTA, Day 1 typography/tokens, and reference-informed hierarchy without QR, wallet, consumer nav, or analytics.

- [ ] **Step 4: Prove GREEN and commit**

Run focused/full tests, typecheck, lint, build, and a browser-free safe-field assertion, then commit only listed files as `feat: add public paid event flow`.

### Task 12: Create Idempotent Hosted Checkout and Cancellation Functions

**Files:**
- Create: `supabase/functions/stripe-create-checkout/index.ts`
- Create: `supabase/functions/stripe-create-checkout/index.test.ts`
- Create: `supabase/functions/stripe-cancel-checkout/index.ts`
- Create: `supabase/functions/stripe-cancel-checkout/index.test.ts`

**Interfaces:**
- Consumes Task 4 private RPCs; produces `{ checkoutUrl }` and bearer-safe cancellation.

- [ ] **Step 1: Write exact Stripe protocol RED**

Assert parsed input permits only event/tier/name/email/clientRequestId; server refreshes Connect state; reservation precedes Stripe; Session uses `mode='payment'`, one server-derived line item, 30-minute expiry, customer email, success/cancel URLs, destination account, exact application fee, opaque IDs, no PII metadata, no `payment_method_types`, and an order-derived idempotency key.

Cover retry returning one Session, sold out, invalid IDs, inactive event/tier/Connect, Stripe failure release, explicit cancellation, exact CORS, rate-limit response, and live-object rejection.

- [ ] **Step 2: Observe RED**

Run both focused function tests; expect missing handlers.

- [ ] **Step 3: Implement handlers**

Use the browser's random client request UUID for request idempotency and generate a 32-byte confirmation token server-side before reservation. Pass only its hash to PostgreSQL; place the clear token only in the Stripe Session's success and cancel URLs. On retry, retrieve the already attached Session by ID and return its hosted URL rather than creating a new token or Session. Validate returned Session fields before attachment. Return safe codes only. Cancellation validates the token from the cancel return URL, expires only an open matching Session, then idempotently releases the order.

- [ ] **Step 4: Prove GREEN and deploy**

Run focused/all functions tests, typecheck/lint, deploy only both functions to development, invoke validation paths, and confirm logs contain no buyer data, token, Session URL, or secrets.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-create-checkout supabase/functions/stripe-cancel-checkout
git diff --cached --check
git commit -m "feat: create hosted ticket checkout"
```

### Task 13: Build Guest Checkout Review and Redirect

**Files:**
- Create: `src/features/checkout/checkout.api.ts`
- Create: `src/features/checkout/checkout.api.test.ts`
- Create: `src/features/checkout/checkout.queries.ts`
- Create: `src/features/checkout/CheckoutPage.tsx`
- Create: `src/features/checkout/CheckoutPage.test.tsx`
- Modify: `src/app/router/router.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces `/events/:eventId/checkout`, guest form, one-click mutex, and hosted redirect.

- [ ] **Step 1: Write checkout-page RED**

Cover persisted selected-tier review, invalid/missing tier redirect, name/email validation summary, retained values, quantity fixed to one, pending disabled state, rapid double-click single mutation, safe error mapping, sold-out recovery, cancel-return token handling through `stripe-cancel-checkout`, `window.location.assign(checkoutUrl)`, and no client-created paid state.

- [ ] **Step 2: Observe RED**

Run focused checkout tests; expect missing page/API.

- [ ] **Step 3: Implement minimal guest flow**

Generate `clientRequestId` once per submission attempt, call the public Edge Function, and redirect only to its validated Stripe-hosted URL. The browser never receives a separate confirmation token before Stripe redirects it through the server-generated success/cancel URL; never persist either return token in logs, analytics, or localStorage.

- [ ] **Step 4: Prove GREEN and commit**

Run focused/full tests, typecheck, lint, build, keyboard/focus component assertions, and commit as `feat: add guest ticket checkout`.

### Task 14: Implement Raw-Body Webhook Reconciliation

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`
- Create: `supabase/functions/stripe-webhook/index.test.ts`
- Create: `supabase/functions/stripe-webhook/webhookFixtures.ts`

**Interfaces:**
- Consumes Task 5 private RPCs; handles account, Checkout, refund, and dispute events.

- [ ] **Step 1: Write webhook RED**

Cover raw-body signature verification, normal tolerance, invalid/missing signature 400/no write, event-ID digest receipt, duplicate 2xx, out-of-order retrieval, paid completed fulfillment, unpaid processing, async success/failure, expired Session, refund, dispute, transient non-2xx retry, permanent safe failure, and rejection of live events.

- [ ] **Step 2: Observe RED**

Run focused webhook tests; expect missing handler.

- [ ] **Step 3: Implement event dispatcher**

Use `request.text()` exactly once before JSON parsing. Retrieve current Stripe objects when ordering matters. Match Session/order totals, fee, currency, destination, and metadata before private RPC calls. Never persist the full webhook payload.

- [ ] **Step 4: Prove GREEN and deploy**

Run focused/all functions tests and typecheck; deploy webhook to development; create a Stripe CLI test endpoint; send signed fixtures twice and verify one receipt/domain transition. Do not claim real payment proof yet.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-webhook
git diff --cached --check
git commit -m "feat: reconcile Stripe webhooks"
```

### Task 15: Add Bearer-Safe Processing and Confirmation

**Files:**
- Create: `supabase/functions/order-confirmation/index.ts`
- Create: `supabase/functions/order-confirmation/index.test.ts`
- Create: `src/features/orders/order.api.ts`
- Create: `src/features/orders/order.api.test.ts`
- Create: `src/features/orders/order.queries.ts`
- Create: `src/features/orders/OrderConfirmationPage.tsx`
- Create: `src/features/orders/OrderConfirmationPage.test.tsx`
- Modify: `src/app/router/router.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces `/orders/:confirmationToken` and minimal processing/paid/failed/expired/refunded projections.

- [ ] **Step 1: Write confirmation RED**

Assert constant-form token hashing, authorization-safe not found, minimum fields only, no email/name/fees/Stripe IDs, polling only for nonterminal states, processing on redirect, paid only from persisted webhook state, reload success, timeout guidance, refunded state, headings/status semantics, and polling cleanup.

- [ ] **Step 2: Observe RED**

Run focused function and page tests; expect missing handlers/page.

- [ ] **Step 3: Implement projection and page**

Return event title/time/venue, tier name, order number, and discriminated status only. Derive `tokenFingerprint = sha256(confirmationToken)` with Web Crypto and use `orderKeys.confirmation(tokenFingerprint)` so the clear token is not copied into the Query cache key; poll at 1 second with a 60-second bounded UI transition while allowing manual retry.

- [ ] **Step 4: Prove GREEN and deploy/commit**

Run focused/all tests, typecheck, lint, build; deploy `order-confirmation`; verify random/expired tokens disclose nothing; commit listed files as `feat: confirm webhook-backed ticket orders`.

### Task 16: Prove Database, RLS, Arithmetic, and Concurrency as One Gate

**Files:**
- Create: `tests/integration/ticketing-database.test.ts`
- Create: `tests/integration/ticketing-concurrency.test.ts`
- Modify: `vitest.integration.config.ts`
- Modify: `tests/integration/testEnv.ts`

**Interfaces:**
- Produces repeatable linked-development proof using publishable clients plus exact disposable identities and rollback/cleanup.

- [ ] **Step 1: Write hosted integration RED**

Create two organizer clients and one anon client. Prove cross-organizer tier isolation, public safe projection, exact 500-bps-plus-50 calculation, manipulated browser field rejection, invalid event/tier/Connect blocking, one-ticket race, retry idempotency, and no anonymous financial-table reads.

- [ ] **Step 2: Observe RED safely**

Run `pnpm test:integration -- tests/integration/ticketing-database.test.ts tests/integration/ticketing-concurrency.test.ts`; missing required `TEST_` values must exit nonzero with names only and no skip.

- [ ] **Step 3: Implement exact fixture lifecycle**

Provision unique test users/rows with unprinted admin authority outside Vitest; pass only publishable credentials to tests; use metadata/prefix IDs; install an EXIT trap that removes exact orders/items/tickets/refunds/webhooks/tiers/Connect rows/events/organizers/Auth users and proves zero residue.

- [ ] **Step 4: Run the complete database gate**

Run all six Day 2 pgTAP files, all four Day 1 pgTAP files, linked DB lint, migration alignment, hosted integrations, and post-run leakage queries sequentially. Expected: every assertion passes; no fixture or pgTAP extension remains.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/ticketing-database.test.ts tests/integration/ticketing-concurrency.test.ts tests/integration/testEnv.ts vitest.integration.config.ts
git diff --cached --check
git commit -m "test: prove ticketing database boundaries"
```

### Task 17: Prove Real Stripe Test-Mode Connect, Checkout, Webhooks, and Refunds

**Files:**
- Create: `tests/integration/stripe-ticketing.test.ts`
- Create: `tests/integration/stripeWebhookHarness.ts`
- Create: `tests/integration/stripeTestObjects.ts`
- Modify: `tests/integration/testEnv.ts`
- Modify: `vitest.integration.config.ts`

**Interfaces:**
- Produces one real test-mode destination-charge proof and exact cleanup ledger; never imports credentials into browser tests.

- [ ] **Step 1: Write required-config RED**

Require names for Supabase test values, Stripe test publishable/restricted key, webhook secret, development function URL, and test connected-account fixture. Missing values exit 1 listing names only; `sk_live_`, `rk_live_`, or live Stripe objects hard-fail.

- [ ] **Step 2: Write the real integration assertions**

Prove Accounts v2 recipient state, application/loss responsibility, current capability projection, real hosted Checkout Session, successful Stripe test payment, destination account, exact `floor(subtotal*0.05)+50`, webhook-created paid order/item/ticket, duplicate delivery once, forced first failure then retry, decline/unpaid behavior, explicit expiry release, invalid signature no write, and one test refund updating refund/order/ticket once.

- [ ] **Step 3: Observe controlled RED**

Run the focused test before secrets are injected. Expected: nonzero missing-config gate, not skip/pass. Then inject values only through the enclosing process and run against confirmed test/development environments.

- [ ] **Step 4: Reach real GREEN and reconcile**

Use Stripe test data only. Retrieve PaymentIntent, Charge, Transfer, Application Fee, Balance Transaction, Refund, and relevant events; compare persisted IDs and actual fee/proceeds fields. Replay the same event. Clean exact Stripe test objects where API permits and exact Supabase fixtures; list retained immutable Stripe test records by opaque test metadata in the local ignored report only.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/stripe-ticketing.test.ts tests/integration/stripeWebhookHarness.ts tests/integration/stripeTestObjects.ts tests/integration/testEnv.ts vitest.integration.config.ts
git diff --cached --check
git commit -m "test: verify Stripe ticket transaction"
```

### Task 18: Run the Full Browser, Visual, Security, and Branch-Completion Gate

**Files:**
- Create: `tests/e2e/ticket-purchase.spec.ts`
- Create: `tests/e2e/ticket-purchase.visual.spec.ts`
- Create: `tests/e2e/support/ticketingJourney.ts`
- Modify: `tests/e2e/support/e2eEnv.ts`
- Modify: `playwright.config.ts`
- Create: `Docs/testing/day2-ticketing-payments-verification.md`

**Interfaces:**
- Produces canonical mobile/desktop evidence, operational runbook, clean feature branch, and execution report. It does not merge or push without explicit user authorization.

- [ ] **Step 1: Write browser RED before helpers**

Define mobile `390x844` and desktop `1440x900` projects. Cover organizer signup/sign-in, onboarding/ready state, three tiers, paid activation, anonymous public event, tier selection, guest fields, real hosted Stripe test Checkout, processing, webhook confirmation, reload, sold out, keyboard/focus, reduced motion, and cross-user isolation.

- [ ] **Step 2: Implement deterministic credentialed harness**

Require all test env names before browser launch; create exact disposable organizers/event/tier/order; drive Stripe-hosted Checkout with official test data; redact query/fragment values and external origins; disable trace/video/automatic screenshots; capture only deliberately named application screenshots after sensitive fields are absent.

- [ ] **Step 3: Run affected browser cases first**

Run mobile functional, desktop functional, then both visual projects. Inspect screenshots for hierarchy, typography, wrapping, overflow, responsive tier controls, focus, status clarity, and alignment with approved references. A visual defect requires focused systematic debugging and rerun before the full gate.

- [ ] **Step 4: Run final required verification**

```bash
pnpm test
pnpm test:functions
pnpm test:integration
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
pnpm supabase db lint --linked --schema public
pnpm supabase migration list --linked
git diff --check
```

Also rerun all Day 1 and Day 2 pgTAP, the real Stripe test integration, secret scans of tracked history/build/artifacts, `.env.local` ignore proof, Stripe/Supabase exact cleanup proof, and Mapbox lazy-chunk regression.

- [ ] **Step 5: Write the non-secret runbook**

Document secret names and owners, test/live separation, Connect responsibility settings, function deployment order, webhook endpoint/events, test fee rule, payment-method configuration, replay/recovery, reservation cleanup, reconciliation queries, refund/dispute operations, Stripe-object cleanup limits, local-Docker parity, and explicit legal/tax/live-mode blockers. Include no project ref, personal email, key, Checkout URL, buyer PII, or credentialed screenshot.

- [ ] **Step 6: Perform final scope and Git checkpoint**

Verify every changed path belongs to Day 2, no Day 1 source-of-truth doc was weakened, no excluded feature exists, all commits are scoped, and the worktree is clean. Use `superpowers:verification-before-completion`, request final code review, resolve only evidence-backed findings, then use `superpowers:finishing-a-development-branch`. Do not merge or push until the user authorizes that external Git action.

- [ ] **Step 7: Commit the verification deliverable**

```bash
git add tests/e2e/ticket-purchase.spec.ts tests/e2e/ticket-purchase.visual.spec.ts tests/e2e/support/ticketingJourney.ts tests/e2e/support/e2eEnv.ts playwright.config.ts Docs/testing/day2-ticketing-payments-verification.md
git diff --cached --check
git commit -m "test: prove native ticket purchase journey"
```

---

## Execution Completion Contract

Execution is complete only when all 18 task commits have passed their focused review gates and fresh final evidence proves:

1. one non-live Accounts v2 recipient account per organizer with correct responsibilities and current readiness;
2. one to three owned tiers and safe paid activation for draft or already-published events;
3. anonymous reads expose only public event/tier projection;
4. the test fee is exactly 5% plus $0.50 per purchased ticket and no live rule exists;
5. last-ticket races yield one reservation and one sold-out result;
6. hosted Checkout creates a real test-mode destination charge;
7. only verified webhooks mark paid and issue exactly one ticket;
8. duplicate, retry, expiry, decline, invalid signature, refund, dispute, and late-payment paths are monotonic and auditable;
9. confirmation reflects persisted truth without a consumer account or customer/financial disclosure;
10. unit, component, pgTAP, linked integration, real Stripe test-mode, mobile/desktop E2E, accessibility, responsive, visual, build, lint, type, secret, cleanup, and Git gates all pass;
11. no live credential, real charge, Day 2-excluded feature, or Day 1 regression exists.
