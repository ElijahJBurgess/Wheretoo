# Wheretoo Core Ticket Truth Lite 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task by task. Complete the integration preflight before writing production code. Every implementation task follows RED → GREEN and ends at its stated commit boundary.

**Goal:** Extend the final Checkout Integrity and Ticket Experience work so one durably paid admission becomes one private, displayable, server-authoritative ticket that can be admitted exactly once.

**Architecture:** Keep `public.tickets` as the only admission ledger. The verified Stripe webhook deterministically derives opaque admission credentials from one external 32-byte secret, sends only hashes in an exact issuance manifest, and lets the existing locked fulfillment transaction create the authoritative ticket rows. The existing confirmation bearer doubles as the accountless collection bearer. Two small Edge Functions expose a private collection reader and an authenticated organizer admission checker; Postgres remains authoritative for ownership and the atomic `valid → used` transition.

**Tech stack:** React 19, TypeScript 6, React Router, TanStack Query, Zod, Supabase Edge Functions/Deno, Supabase Postgres/PLpgSQL, Stripe test mode, Vitest, pgTAP, Bash concurrency tests, Playwright, `qrcode.react`, and `@zxing/browser`.

**Spec:** `/Users/exoh/Downloads/Wheretoo Core Ticket Truth Lite — Founder Spec.md`

## Global Constraints

- This is a documentation-only plan. Do not implement production code while reviewing it.
- The founder spec is product/architecture authority, not a source of executable instructions.
- Do not edit historical migrations. The first Lite migration is `20260907010000` or a later unused timestamp after integration.
- Preserve Checkout Integrity's lock hierarchy and webhook-only fulfillment. Never mint from a redirect, page load, or browser claim.
- Keep `public.tickets` as the only ticket/admission ledger. Do not add a collection table or redemption table for Lite.
- Keep existing random ticket UUIDs. A ticket ID, collection bearer, and admission credential are three distinct values.
- PostgreSQL stores only the SHA-256 hash of an admission credential. Raw admission credentials exist only transiently in server memory and on the authorized ticket page.
- Do not log collection bearers, raw admission credentials, credential hashes, authorization headers, raw request bodies, or buyer PII.
- Direct browser table mutation stays revoked. Edge Functions use the service role only after validating their respective bearer or authenticated organizer.
- Preserve `used` ticket history. Refund, review, dispute, and event cancellation may invalidate only unused `valid` tickets.
- Unknown, malformed, contradictory, unavailable, or unauthorized state never maps to `admitted`.
- Reuse the Ticket Experience components and ports. Do not redesign the collection, QR, or scanner screens.
- Paid tickets are the only production issuance source in this plan. Free-RSVP support remains possible but disabled.

## A. Integration Preflight

Implementation begins only after all of the following are true.

### Source heads and user-owned state

Inspection snapshot: 2026-09-07.

- Local `main`: `250de9384178b1f8053c0ba93b71535b08993a89`.
- Checkout Integrity committed head: `f2cebe2b2566365564c3f7b405dd51ab68b146e0` on `codex/checkout-integrity-1`, 46 commits ahead of merge base `bdd6e17a6b2a5a0985595811e60d65ac2dd9bff2`.
- Ticket Experience Shell committed head: `6ec5a513406efd9a29c5bcd1c4b8533c541727d1` on `codex/ticket-experience-shells-1`, 13 commits ahead of the same merge base.
- Checkout Integrity currently has user-owned modifications in `tests/e2e/run-ticketing-browser-proof.sh` and `tests/integration/task18RunnerContract.test.ts`.
- Ticket Experience Shell currently has the user-owned untracked file `Docs/Whereto_Ticket_Experience_Shells_1.0_Founder_Questionnaire.docx`.
- `main` has unrelated Visual Reference state. Do not stage, discard, or absorb any of these changes.

The owners must commit, discard, or otherwise resolve the two source worktrees before integration. Record the final commit IDs because they may supersede the snapshot above.

### Combined execution branch

Create a fresh `codex/` worktree from the latest stable integration base, merge the final Checkout Integrity history, then merge the final Ticket Experience Shell history. Resolve shared-file conflicts by retaining both workstreams' behavior, especially:

- Checkout's latest multi-tier types, Stripe webhook logic, integration scripts, and migration ledger.
- Shell routes and runtime split in `src/app/router/router.tsx`.
- Shell dependencies/scripts (`@zxing/browser`, `qrcode.react`, React Email, and ticket-shell verification) alongside Checkout scripts.
- Both sets of intentional `src/styles/global.css` changes.

Do not begin Lite work on either source branch. Do not copy uncommitted files into the execution branch.

Verify the integrated seams:

```bash
git status --short --branch
git log -1 --format='%H %s' codex/checkout-integrity-1
git log -1 --format='%H %s' codex/ticket-experience-shells-1
rg -n "create( or replace)? function (private|public)\.(fulfill_paid_order|server_fulfill_paid_order|apply_verified_refund|server_apply_verified_refund|mark_payment_requires_review|mark_checkout_reconciliation_review|apply_dispute|lock_payment_order)" supabase/migrations
rg -n "TicketCollectionReader|AdmissionChecker|productionTicketExperienceRuntime|createCameraDecoder" src/features/ticket-experience
find supabase/migrations -maxdepth 1 -type f -exec basename {} \; | sort | tail -n 20
```

Expected current contracts:

- Final fulfillment has 16 arguments ending in `p_destination_account_id text`, returns `(order_id, order_status, ticket_count)`, and calls `private.lock_payment_order`.
- `private.lock_payment_order` orders locks as event advisory → every tier by UUID → event → order → every order item.
- Fulfillment creates one ticket per `(order_item_id, unit_sequence)` and the existing unique constraint prevents duplicate units.
- Final refund is the `20260902010475` wrapper over the whole-order refund implementation.
- Review and dispute paths invalidate `status = 'valid'` tickets only.
- No authoritative event-cancellation RPC exists.
- Production ticket collection and scanner routes are present but return `NotEnabledRoute`.
- The shell already recovers unknown selectors and prevents two QRs from being mounted at once; do not re-plan that old prerequisite.
- Current committed migration head is `20260902010550_add_scoped_checkout_fixture_moderation.sql`.

### Data and traffic stop conditions

Lite intentionally has no legacy-ticket backfill. Before applying its first migration to any environment, disable the existing checkout creation switch, drain/reconcile any in-flight payment, and run:

```sql
select checkout_creation_enabled
from private.checkout_runtime_control
where singleton;

select status, count(*)
from public.orders
where status in ('creating_checkout', 'checkout_open', 'payment_processing')
group by status;

select count(*) as existing_ticket_count
from public.tickets;
```

Required result: checkout creation is false, there are zero in-flight orders, and there are zero durable tickets. Known disposable non-production fixtures may be removed only through their existing scoped cleanup. If any ticket cannot be proven disposable, stop: the no-backfill Lite assumption is false and a separately approved migration decision is required.

### Baseline

Install and run the combined baseline before Task 1:

```bash
pnpm install --frozen-lockfile
VITE_SUPABASE_URL=https://core-ticket-lite-disabled.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_core_ticket_lite_disabled \
VITE_MAPBOX_ACCESS_TOKEN=core-ticket-lite-disabled \
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_core_ticket_lite_disabled pnpm test
pnpm typecheck
pnpm lint
pnpm test:functions
pnpm build
pnpm test:ticket-shells
pnpm test:ticket-shells:production
```

The inspection-time `main` run was not a green baseline: 502 tests passed, environment-dependent suites lacked `VITE_SUPABASE_URL`, and `src/styles/global.test.js` disagreed with `main`'s mobile navigation CSS. The integrated branch must either be green with the explicit test environment above or record and resolve an owning-workstream failure before Lite changes are attributed to it.

## B. Minimal Schema Delta

### `public.tickets`: three columns, no new table

| Column | Type | Rule |
|---|---|---|
| `admission_label` | `text not null` | Immutable snapshot equal to the paid `order_items.tier_name` at issuance; trimmed length 1–80. |
| `credential_hash` | `bytea not null` | Exactly 32 bytes, unique; SHA-256 of the complete raw admission credential. |
| `used_at` | `timestamptz null` | Set once in the same statement/transaction as `status = 'used'`. |

Extend the existing status set from `valid/refunded/cancelled` to `valid/used/refunded/cancelled`. Replace the timestamp check with these exact shapes:

- `valid`: `used_at`, `refunded_at`, and `cancelled_at` are null.
- `used`: only `used_at` is non-null.
- `refunded`: only `refunded_at` is non-null.
- `cancelled`: only `cancelled_at` is non-null.

Add a small `BEFORE UPDATE` guard that makes ticket identity/source fields, `admission_label`, `credential_hash`, and `issued_at` immutable; permits only `valid → used/refunded/cancelled` and the existing verified-refund recovery `cancelled → refunded`; and makes `used` terminal. Normal runtime code never deletes tickets. Test fixture cleanup may continue to delete scoped rows with elevated tooling.

Do not constrain a raw credential format in PostgreSQL. Only the 32-byte lookup hash is a database concern, leaving future credential formats possible.

### Functions/RPCs

No second ledger is added. The only new or extended database boundaries are:

```text
public.server_fulfill_paid_order(existing 16 args, p_ticket_manifest jsonb)
  -> table(order_id uuid, order_status text, ticket_count bigint)

public.server_lookup_paid_ticket_collection(p_confirmation_token_hash text)
  -> private service-only collection projection

public.server_redeem_paid_ticket(
  p_organizer_id uuid,
  p_event_id uuid,
  p_credential_hash bytea
) -> table(outcome text, admission_label text)

public.cancel_owned_event(p_event_id uuid)
  -> public.events
```

`server_*` ticket functions are executable only by `service_role`; browsers reach them through the two Edge Functions. `cancel_owned_event` is executable only by `authenticated` and proves ownership with `auth.uid()` inside the security-definer transaction.

### Credential contract and the one unavoidable deferred-feature exception

The founder spec requires all three of these properties:

1. a server-generated opaque credential,
2. only its hash in PostgreSQL, and
3. repeatable later display by an accountless customer.

A one-time random value cannot satisfy (2) and (3) without storing the raw secret somewhere. Generating a new value on each page load would introduce the explicitly deferred generation/reissue system and would break fulfillment atomicity. Therefore one external secret is technically unavoidable, but a keyring is not.

Create a shared server helper with this exact Lite contract:

```ts
export type PaidAdmissionSource = {
  orderItemId: string
  unitSequence: number
}

export function getTicketCredentialSecret(read?: EnvReader): Uint8Array
export function derivePaidAdmissionCredential(
  secret: Uint8Array,
  source: PaidAdmissionSource,
): Promise<string>
export function hashAdmissionCredential(credential: string): Promise<Uint8Array>
```

- `TICKET_CREDENTIAL_SECRET` is one canonical unpadded base64url value decoding to exactly 32 random bytes.
- HMAC-SHA-256 input is the UTF-8 canonical string `wheretoo:paid-admission:lite:v1\n<lowercase-order-item-uuid>\n<base10-unit-sequence>`.
- Output is `wta1_` plus the unpadded base64url HMAC (48 characters total).
- The stored hash is SHA-256 of that complete output.
- UUID and sequence parsing is strict; sequence is an integer in `1..10`.
- The single secret is immutable until a later keyring migration. Missing or malformed configuration fails closed.

This is a deterministic pseudorandom server credential, not a deterministic ticket identity. Existing ticket UUIDs remain independent and random.

## C. Lock and Transaction Model

```text
Verified paid webhook
  event advisory -> tiers UUID order -> event -> order -> order items
  -> existing ticket rows UUID order -> validate exact manifest -> insert/compare

Organizer redemption
  event advisory -> requested event -> matching ticket row FOR UPDATE
  -> validate owner/event/order/source/status -> valid to used + used_at

Refund/review/dispute
  existing private.lock_payment_order hierarchy
  -> affected ticket rows UUID order -> invalidate unused valid rows only

Owner event cancellation
  event advisory -> event tiers UUID order -> event -> event ticket rows UUID order
  -> published to cancelled + valid tickets to cancelled in one transaction
```

All cooperating paths take the same per-event advisory lock first. Thus fulfillment cannot race redemption, and refund/cancellation cannot admit an unused ticket after invalidation. The ticket row lock makes two concurrent redemptions resolve serially: exactly one observes `valid` and writes `used`; the other observes `used` and returns `already_used`. No flow checks and commits later.

## File / Responsibility Map

| Path | Action | Responsibility |
|---|---|---|
| `supabase/functions/_shared/ticketCredentials.ts` | create | Strict single-secret parsing, deterministic opaque credential derivation, lookup hashing. |
| `supabase/functions/_shared/ticketCredentials.test.ts` | create | Golden vectors, canonical input, separation, missing-secret behavior. |
| `supabase/functions/_shared/env.ts` | modify | Export and reuse the strict environment reader type/helper. |
| `supabase/functions/.env.example` | modify | Add only the `TICKET_CREDENTIAL_SECRET` name and generation note, never a real value. |
| `supabase/migrations/20260907010000_integrate_core_ticket_truth_lite_fulfillment.sql` | create | Empty-ticket assertion, three ticket columns, lifecycle guard, tier-name snapshot, exact hashed manifest, and idempotent fulfillment accepting `valid/used` retries in one coherent migration. |
| `supabase/functions/stripe-webhook/index.ts` | modify | Parse `tier_name`, build exact credential-hash manifest, pass hashes only. |
| `supabase/functions/stripe-webhook/index.test.ts` | modify | Manifest/cardinality/retry/secret-failure behavior and no-leak assertions. |
| `supabase/functions/stripe-webhook/webhookFixtures.ts` | modify | Immutable tier label fixtures. |
| `supabase/migrations/20260907010100_add_lite_ticket_collection.sql` | create | Service-only, bearer-hash-resolved, exact paid collection projection. |
| `supabase/functions/ticket-collection/index.ts` | create | Collection bearer validation, projection validation, valid-only credential reproduction, safe HTTP response. |
| `supabase/functions/ticket-collection/index.test.ts` | create | Ready/inactive/unavailable/contradiction/no-cache/no-leak contract. |
| `supabase/migrations/20260907010200_add_atomic_lite_redemption.sql` | create | Service-only organizer-authorized atomic redemption and exact outcomes. |
| `supabase/functions/ticket-admission/index.ts` | create | Organizer JWT validation, credential hashing, exact RPC/outcome mapping. |
| `supabase/functions/ticket-admission/index.test.ts` | create | Auth, outcome, malformed input, DB uncertainty, and response secrecy. |
| `supabase/migrations/20260907010300_preserve_lite_ticket_invalidation.sql` | create | Final refund/review/dispute definitions preserving `used`; owner event cancellation. |
| `supabase/tests/database/core_ticket_truth_lite_schema.test.sql` | create | Exact delta, constraints, immutability, ACL, no parallel ledger. |
| `supabase/tests/database/core_ticket_truth_lite_fulfillment.test.sql` | create | Quantity, label/hash manifest, duplicate webhook, post-use retry, contradiction. |
| `supabase/tests/database/core_ticket_truth_lite_collection.test.sql` | create | Bearer isolation and coherent safe projection. |
| `supabase/tests/database/core_ticket_truth_lite_redemption.test.sql` | create | All six domain outcomes, ownership, state transition, fail-closed checks. |
| `supabase/tests/database/core_ticket_truth_lite_lifecycle.test.sql` | create | Refund/review/dispute/event cancellation and used-history preservation. |
| `supabase/tests/database/core_ticket_truth_lite_redemption_concurrency.test.sh` | create | One genuine independent-session scan-versus-scan proof. |
| `supabase/tests/database/checkout_integrity_fulfillment.test.sql` | modify | Supply coherent Lite fields for intentional corruption fixtures. |
| `supabase/tests/database/ticketing_schema.test.sql` | modify | Supply unique labels/hashes to direct ticket lifecycle fixtures. |
| `supabase/tests/database/task13_cleanup_concurrency.test.sh` | modify | Supply coherent Lite fields to its manufactured race ticket. |
| `tests/integration/run-ticketing-database.sh` | modify | Run Lite pgTAP and the single concurrency proof with existing environment/cleanup guards. |
| `tests/integration/coreTicketTruthLiteMigrationContract.test.ts` | create | Static proof that the empty-ticket stop condition precedes non-null schema/fulfillment replacement. |
| `src/features/ticket-experience/adapters/ticketCollectionReader.ts` | create | Strict Zod Edge response mapped to the existing `TicketCollectionReader`. |
| `src/features/ticket-experience/adapters/admissionChecker.ts` | create | Existing `AdmissionChecker` backed by `ticket-admission`. |
| `src/features/ticket-experience/adapters/adapters.test.ts` | create | Real-adapter contract and error mapping tests. |
| `src/features/ticket-experience/runtime/production.tsx` | modify | Compose real collection/scanner adapters, existing QR/scanner components, camera decoder, and unavailable wallet provider. |
| `src/features/orders/OrderConfirmationPage.tsx` | modify | Paid-only link from the existing confirmation bearer to its ticket collection. |
| `src/features/orders/OrderConfirmationPage.test.tsx` | modify | Link status gating and bearer encoding. |
| `src/features/events/event.api.ts` | modify | Call `cancel_owned_event`. |
| `src/features/events/event.api.test.ts` | modify | RPC name/input/result/error contract. |
| `src/features/events/event.queries.ts` | modify | Cancellation mutation and owned/public cache invalidation. |
| `src/features/events/PublishedEventPage.tsx` | modify | Small confirmed owner cancellation action; no page redesign. |
| `src/features/events/PublishedEventPage.test.tsx` | modify | Confirmation, pending/error, one-call, and cancelled-state behavior. |
| `src/lib/supabase/database.types.ts` | regenerate | Combined final public schema and RPC signatures. |
| `tests/e2e/core-ticket-truth-lite.spec.ts` | create | Paid order → collection → decoded QR → admit/already-used → invalidation proof. |
| `tests/e2e/run-core-ticket-truth-lite-proof.sh` | create | Guarded linked test-mode orchestration and exact scoped cleanup. |
| `tests/integration/coreTicketTruthLiteRunnerContract.test.ts` | create | Static safety contract for the runner and cleanup. |
| `package.json` | modify | Named Lite unit/database/E2E scripts. |
| `Docs/runbooks/core-ticket-truth-lite.md` | create | One-secret setup, deploy stop-the-world window, verification, recovery, and future-keyring warning. |

### Task 1: Add the Credential Primitive

**Goal:** Establish and prove the only cryptographic primitive Lite needs, with no identity system, keyring, database change, or new ledger.

**Files**

- Create: `supabase/functions/_shared/ticketCredentials.ts`
- Create: `supabase/functions/_shared/ticketCredentials.test.ts`
- Modify: `supabase/functions/_shared/env.ts`
- Modify: `supabase/functions/.env.example`

**Relevant existing interfaces**

- Existing `EnvReader`/`requireEnv` behavior in `_shared/env.ts`.
- Existing Web Crypto usage and base64url conventions in the Checkout Edge Functions.

**RED**

- [ ] Add Deno tests for fixed secret/source golden vectors, different units producing different credentials, exact 48-character canonical output, strict UUID/sequence rejection, and missing/malformed secret rejection.
- [ ] Add a test proving the helper returns a fresh byte array per secret read and never includes secret material in validation errors.

**Verify RED**

```bash
pnpm exec deno test --allow-env supabase/functions/_shared/ticketCredentials.test.ts
```

Expected: the helper contract does not exist.

**GREEN**

- [ ] Implement the exact credential contract in section B with Web Crypto only; do not add a key ID, generation, ticket UUID derivation, encryption, or storage.
- [ ] Document only the secret name and a safe generation command such as `openssl rand -base64 32` converted to canonical base64url; never commit the output.

**Verify GREEN**

```bash
pnpm exec deno test --allow-env supabase/functions/_shared/ticketCredentials.test.ts
pnpm typecheck:functions
```

**Regression gate**

```bash
pnpm test:functions
pnpm lint
```

**Commit boundary**

```bash
git add supabase/functions/_shared/ticketCredentials.ts supabase/functions/_shared/ticketCredentials.test.ts supabase/functions/_shared/env.ts supabase/functions/.env.example
git commit -m "feat: add lite ticket credential primitive"
```

### Task 2: Bind Exact Ticket Issuance to Verified Fulfillment

**Goal:** Make the existing durably paid webhook transaction issue exactly one fully credentialed ticket per purchased unit and remain idempotent before and after check-in.

**Files**

- Create: `supabase/migrations/20260907010000_integrate_core_ticket_truth_lite_fulfillment.sql`
- Modify: `supabase/functions/stripe-webhook/index.ts`
- Modify: `supabase/functions/stripe-webhook/index.test.ts`
- Modify: `supabase/functions/stripe-webhook/webhookFixtures.ts`
- Create: `supabase/tests/database/core_ticket_truth_lite_schema.test.sql`
- Create: `supabase/tests/database/core_ticket_truth_lite_fulfillment.test.sql`
- Create: `tests/integration/coreTicketTruthLiteMigrationContract.test.ts`
- Modify: `supabase/tests/database/checkout_integrity_fulfillment.test.sql`
- Modify: `supabase/tests/database/ticketing_schema.test.sql`
- Modify: `supabase/tests/database/task13_cleanup_concurrency.test.sh`
- Modify: `tests/integration/run-ticketing-database.sh`

**Relevant existing interfaces**

- `OrderItemSnapshot`, `OrderSnapshot`, `FulfillmentSnapshot`, `StripeWebhookDependencies.fulfillPaidOrder`.
- `public.server_get_checkout_integrity_order_snapshot` and payment-snapshot counterpart.
- Final 16-argument `private/public.*fulfill_paid_order` and `fulfillmentApplyResultFromRpc`.

**RED**

- [ ] Extend tests so a 2 GA + 1 VIP paid snapshot produces a sorted three-entry manifest containing only `order_item_id`, `unit_sequence`, `admission_label`, and lowercase 64-hex `credential_hash` at the Edge/RPC boundary.
- [ ] Prove the raw `wta1_...` values and the external secret never appear in RPC arguments, responses, operational events, or thrown errors.
- [ ] Add pgTAP assertions for the three columns, 32-byte unique hash, four statuses, exact timestamp shapes, immutable identity/credential fields, legal transitions, terminal `used`, existing table grants/RLS, and absence of any new collection/redemption ledger.
- [ ] Add a static migration-contract test proving the migration's first executable block raises `LITE_EXISTING_TICKETS_REQUIRE_DECISION` when any ticket exists and that this guard appears before every `ALTER TABLE public.tickets` or fulfillment replacement.
- [ ] Add pgTAP for exact three-ticket issuance, per-item labels, 32-byte unique hashes, duplicate fulfillment returning the same count, missing/extra/duplicate/mismatched manifest entries failing closed, and rollback on any invalid entry.
- [ ] Add the critical regression: after one exact ticket is `used`, replaying the same paid webhook returns the paid order and original count without changing `used` or cancelling remaining valid tickets.

**Verify RED**

```bash
pnpm exec deno test --allow-env supabase/functions/stripe-webhook/index.test.ts
pnpm vitest run --config vitest.integration.config.ts tests/integration/coreTicketTruthLiteMigrationContract.test.ts
pnpm test:integration:ticketing-db
```

Expected: snapshots omit `tier_name`, fulfillment accepts no manifest, ticket inserts lack the three new fields, and a post-use paid retry is classified as a mismatch.

**GREEN**

- [ ] Add `tier_name` to the service-only immutable item snapshot and its strict TypeScript parser. Do not expose buyer data or organizer-controlled current tier names.
- [ ] In the same migration, assert the ticket table is empty, add `admission_label`, `credential_hash`, and `used_at`, replace the lifecycle constraints, add the unique hash index and narrow immutable-transition guard, and then replace the snapshot/fulfillment functions. There is no intermediate deployable schema that breaks the current insert path.
- [ ] For each sorted item and `unitSequence = 1..quantity`, derive the raw credential, hash it, immediately discard the raw value, and construct the exact manifest.
- [ ] Add `p_ticket_manifest jsonb` as the 17th fulfillment argument. Validate exact keys, canonical types, exact source-unit cardinality, snapshot label equality, hash length, no duplicates, no missing/extra units, and no hash collision before inserting.
- [ ] Insert ticket rows inside the existing `private.lock_payment_order` transaction. On retry, require the persisted ticket source/label/hash set to equal the manifest exactly; create nothing when it already matches.
- [ ] Change paid-order lifecycle validation to accept an exact mixture of `valid` and `used`. It must still reject `refunded`, `cancelled`, malformed timestamps, or incoherent source rows while the order is paid.
- [ ] Preserve the existing `(order_item_id, unit_sequence)` uniqueness and total/per-item post-insert assertions.
- [ ] Update only the existing tests that directly manufacture ticket rows (`checkout_integrity_fulfillment.test.sql`, `ticketing_schema.test.sql`, and `task13_cleanup_concurrency.test.sh`) to provide unique valid labels/hashes. Do not weaken production defaults or constraints for fixtures.

**Verify GREEN**

```bash
pnpm exec deno test --allow-env supabase/functions/stripe-webhook/index.test.ts
pnpm vitest run --config vitest.integration.config.ts tests/integration/coreTicketTruthLiteMigrationContract.test.ts
pnpm test:integration:ticketing-db
pnpm typecheck:functions
```

**Regression gate**

```bash
pnpm test:functions
pnpm test:integration
pnpm lint
```

**Commit boundary**

```bash
git add supabase/migrations/20260907010000_integrate_core_ticket_truth_lite_fulfillment.sql supabase/functions/stripe-webhook/index.ts supabase/functions/stripe-webhook/index.test.ts supabase/functions/stripe-webhook/webhookFixtures.ts supabase/tests/database/core_ticket_truth_lite_schema.test.sql supabase/tests/database/core_ticket_truth_lite_fulfillment.test.sql supabase/tests/database/checkout_integrity_fulfillment.test.sql supabase/tests/database/ticketing_schema.test.sql supabase/tests/database/task13_cleanup_concurrency.test.sh tests/integration/coreTicketTruthLiteMigrationContract.test.ts tests/integration/run-ticketing-database.sh
git commit -m "feat: issue exact hashed paid tickets"
```

### Task 3: Expose the Private Accountless Ticket Collection

**Goal:** Reuse the existing confirmation bearer as one order/event collection link and reproduce raw credentials only for currently valid tickets.

**Files**

- Create: `supabase/migrations/20260907010100_add_lite_ticket_collection.sql`
- Create: `supabase/functions/ticket-collection/index.ts`
- Create: `supabase/functions/ticket-collection/index.test.ts`
- Create: `supabase/tests/database/core_ticket_truth_lite_collection.test.sql`
- Modify: `tests/integration/run-ticketing-database.sh`

**Relevant existing interfaces**

- `hashConfirmationBearer` and the `order-confirmation` body/CORS pattern.
- `orders.confirmation_token_hash` unique constraint and `/tickets/:collectionBearer/:ticketSelector?` route.
- `TicketCollectionReader`, `TicketCollectionResult`, and `TicketDisplay`.

**RED**

- [ ] Test a valid paid bearer returning every ticket in stable order with event details and a raw credential only for `valid` tickets.
- [ ] Test `used`, `refunded`, and `cancelled` tickets returning `admissionCredential: null`.
- [ ] Test malformed/unknown bearers, wrong order state, zero/extra/missing/incoherent tickets, stored-hash mismatch, and secret failure all producing one uniform unavailable response with no partial collection.
- [ ] Assert `Cache-Control: private, no-store`, `Pragma: no-cache`, exact CORS, bounded request size, and no bearer/raw credential/hash in errors or logs.
- [ ] Add pgTAP proving only `service_role` can execute the projection and that it returns no buyer email/name, Stripe IDs, reconciliation details, or raw credential.

**Verify RED**

```bash
pnpm exec deno test --allow-env supabase/functions/ticket-collection/index.test.ts
pnpm test:integration:ticketing-db
```

Expected: the function and projection do not exist.

**GREEN**

- [ ] Add a service-only projection resolved by `confirmation_token_hash`. It returns only one coherent paid/refunded order-event group and the internal `order_item_id`, `unit_sequence`, and stored hash needed by the Edge verifier.
- [ ] In the Edge Function, validate the same canonical 43-character confirmation bearer used today, hash it, load the projection, require ticket count/source coherence with the order, and derive each valid ticket credential from the shared helper.
- [ ] Compare every derived credential hash to the stored hash with a byte-wise constant-time helper before returning any ticket. One mismatch makes the entire collection unavailable.
- [ ] Map ticket UUID to the existing `selector`; map persisted tier snapshot to `admissionLabel`; map a null venue to `Venue to be announced`; set `collectionLabel` to `<event title> tickets`; and omit `attendeeLabel` and `directionsUrl` when not authoritatively available. Positions follow the projection's stable `(order_item_id, unit_sequence)` order and every row carries the same exact total.
- [ ] Return raw credentials only in the successful response for `valid` tickets. Do not add a collection table, collection revocation flow, or customer account.

**Verify GREEN**

```bash
pnpm exec deno test --allow-env supabase/functions/ticket-collection/index.test.ts
pnpm test:integration:ticketing-db
pnpm typecheck:functions
```

**Regression gate**

```bash
pnpm test:functions
pnpm test:integration
```

**Commit boundary**

```bash
git add supabase/migrations/20260907010100_add_lite_ticket_collection.sql supabase/functions/ticket-collection/index.ts supabase/functions/ticket-collection/index.test.ts supabase/tests/database/core_ticket_truth_lite_collection.test.sql tests/integration/run-ticketing-database.sh
git commit -m "feat: expose private paid ticket collections"
```

### Task 4: Add Authorized Atomic One-Time Redemption

**Goal:** Turn a decoded QR into exactly one server-authorized `valid → used` transition and prove the real double-scan race with independent database sessions.

**Files**

- Create: `supabase/migrations/20260907010200_add_atomic_lite_redemption.sql`
- Create: `supabase/functions/ticket-admission/index.ts`
- Create: `supabase/functions/ticket-admission/index.test.ts`
- Create: `supabase/tests/database/core_ticket_truth_lite_redemption.test.sql`
- Create: `supabase/tests/database/core_ticket_truth_lite_redemption_concurrency.test.sh`
- Modify: `tests/integration/run-ticketing-database.sh`

**Relevant existing interfaces**

- `_shared/auth.ts::requireOrganizer(request)` returns a server-verified `organizerId`.
- `AdmissionChecker.checkAdmission({ eventId, credential, signal })` and its six domain outcomes plus `network_error`.
- `public.lock_event_ticketing_operation(event_id)`.

**RED**

- [ ] Add function tests for exact request shape, organizer JWT required, strict event UUID and `wta1_` credential parsing, hashing before RPC, and no raw credential in the RPC call or response.
- [ ] Add pgTAP for `admitted`, `already_used`, `refunded`, `cancelled`, `wrong_event`, and `invalid`; non-owner denial; order/event/source contradictions; unpublished/cancelled event; and unavailable database state.
- [ ] Assert `admitted` is possible only when the same transaction writes `status = 'used'` and non-null `used_at`.
- [ ] Add a Bash proof that holds two independent SQL sessions at a barrier, submits the same valid credential hash/event/organizer, and asserts exactly one `admitted`, exactly one `already_used`, one durable `used_at`, bounded completion, and no deadlock.

**Verify RED**

```bash
pnpm exec deno test --allow-env supabase/functions/ticket-admission/index.test.ts
pnpm test:integration:ticketing-db
```

Expected: neither RPC nor endpoint exists and the concurrency script cannot obtain outcomes.

**GREEN**

- [ ] Edge: authenticate with `requireOrganizer`, validate inputs, hash the credential, and call the service-only RPC with the derived organizer ID, requested event ID, and 32-byte hash only.
- [ ] RPC: take the event advisory lock, lock the requested event, prove it is owned by `p_organizer_id`, then resolve/lock the unique ticket hash. An unauthorized requested event returns an authorization failure and never probes ticket truth.
- [ ] Return `wrong_event` when an otherwise coherent ticket belongs to a different event; return its stored terminal outcome for `used/refunded/cancelled`; return `invalid` for unknown or contradictory truth.
- [ ] For `valid`, require coherent ticket/order/item/event/organizer/tier source, `orders.status = 'paid'`, and `events.status = 'published'`, then perform one guarded update to `used/used_at` and return `admitted` only from `RETURNING`.
- [ ] Return domain outcomes as HTTP 200 exact safe JSON. Transport/auth/database uncertainty is non-200 and the browser adapter later maps it to `network_error`, never `admitted`.

**Verify GREEN**

```bash
pnpm exec deno test --allow-env supabase/functions/ticket-admission/index.test.ts
pnpm test:integration:ticketing-db
pnpm typecheck:functions
```

**Regression gate**

```bash
pnpm test:functions
pnpm test:integration
```

**Commit boundary**

```bash
git add supabase/migrations/20260907010200_add_atomic_lite_redemption.sql supabase/functions/ticket-admission/index.ts supabase/functions/ticket-admission/index.test.ts supabase/tests/database/core_ticket_truth_lite_redemption.test.sql supabase/tests/database/core_ticket_truth_lite_redemption_concurrency.test.sh tests/integration/run-ticketing-database.sh
git commit -m "feat: redeem paid tickets atomically"
```

### Task 5: Preserve Admission History Through Invalidation and Add Event Cancellation

**Goal:** Make every existing invalidation path aware of `used`, and add the missing normal owner cancellation operation without adding ticket-level cancellation products.

**Files**

- Create: `supabase/migrations/20260907010300_preserve_lite_ticket_invalidation.sql`
- Create: `supabase/tests/database/core_ticket_truth_lite_lifecycle.test.sql`
- Modify: `tests/integration/run-ticketing-database.sh`
- Modify: `src/features/events/event.api.ts`
- Modify: `src/features/events/event.api.test.ts`
- Modify: `src/features/events/event.queries.ts`
- Modify: `src/features/events/PublishedEventPage.tsx`
- Modify: `src/features/events/PublishedEventPage.test.tsx`

**Relevant existing interfaces**

- Final `private.apply_verified_refund` / `public.server_apply_verified_refund`.
- `private.mark_checkout_reconciliation_review`, `private.mark_payment_requires_review`, and final dispute function.
- `saveEventRevision`, `publishEvent`, `useOwnedEvent`, and organizer-owned `PublishedEventPage`.

**RED**

- [ ] Add database cases where a full verified refund converts unused `valid/cancelled` tickets to `refunded` but leaves `used/used_at` unchanged.
- [ ] Prove review, ticket mismatch, payment review, and dispute paths cancel only unused `valid` tickets and preserve used history.
- [ ] Prove owner event cancellation atomically changes `published → cancelled`, changes every unused valid event ticket to `cancelled`, preserves used/refunded tickets, is idempotent, and rejects another organizer.
- [ ] Prove a cancelled event cannot be fulfilled or redeemed after the cancellation commits.
- [ ] Add page/API tests for an explicit confirmation, one RPC call, disabled pending state, safe retry, cache invalidation, and no cancellation action once already cancelled.

**Verify RED**

```bash
pnpm test:integration:ticketing-db
VITE_SUPABASE_URL=https://core-ticket-lite-disabled.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_core_ticket_lite_disabled VITE_MAPBOX_ACCESS_TOKEN=core-ticket-lite-disabled VITE_STRIPE_PUBLISHABLE_KEY=pk_test_core_ticket_lite_disabled pnpm vitest run src/features/events/event.api.test.ts src/features/events/PublishedEventPage.test.tsx
```

Expected: `used` is absent from final lifecycle definitions and no cancellation RPC/UI action exists.

**GREEN**

- [ ] Replace only the final function definitions. Keep their signatures and Checkout locks; narrow all ticket invalidation predicates to `status = 'valid'` and never clear `used_at`.
- [ ] Preserve the existing guarded `cancelled → refunded` whole-order recovery. Do not convert `used` to financially styled ticket status; the related order/refund rows carry the later financial truth.
- [ ] Implement `cancel_owned_event` as one authenticated security-definer transaction using the event advisory lock, tier locks in UUID order, event lock/ownership check, event status update, and ticket locks/updates in UUID order.
- [ ] Add a small destructive-action confirmation to the existing organizer event page, call the typed mutation once, and show safe pending/error/success state. Do not redesign the page or add automatic refunds; event cancellation and money movement remain separate explicit operations.

**Verify GREEN**

```bash
pnpm test:integration:ticketing-db
VITE_SUPABASE_URL=https://core-ticket-lite-disabled.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_core_ticket_lite_disabled VITE_MAPBOX_ACCESS_TOKEN=core-ticket-lite-disabled VITE_STRIPE_PUBLISHABLE_KEY=pk_test_core_ticket_lite_disabled pnpm vitest run src/features/events/event.api.test.ts src/features/events/PublishedEventPage.test.tsx
pnpm typecheck
```

**Regression gate**

```bash
pnpm test:integration:moderation
pnpm test:functions
pnpm lint
```

**Commit boundary**

```bash
git add supabase/migrations/20260907010300_preserve_lite_ticket_invalidation.sql supabase/tests/database/core_ticket_truth_lite_lifecycle.test.sql tests/integration/run-ticketing-database.sh src/features/events/event.api.ts src/features/events/event.api.test.ts src/features/events/event.queries.ts src/features/events/PublishedEventPage.tsx src/features/events/PublishedEventPage.test.tsx
git commit -m "feat: preserve ticket history on invalidation"
```

### Task 6: Wire the Existing Ticket and Scanner Shells to Real Adapters

**Goal:** Turn on the already-approved production collection and scanner routes with strict adapters; add the paid confirmation link without changing shell layouts.

**Files**

- Create: `src/features/ticket-experience/adapters/ticketCollectionReader.ts`
- Create: `src/features/ticket-experience/adapters/admissionChecker.ts`
- Create: `src/features/ticket-experience/adapters/adapters.test.ts`
- Modify: `src/features/ticket-experience/runtime/production.tsx`
- Modify: `src/features/orders/OrderConfirmationPage.tsx`
- Modify: `src/features/orders/OrderConfirmationPage.test.tsx`
- Regenerate: `src/lib/supabase/database.types.ts`

**Relevant existing interfaces**

- `TicketCollectionReader`, `AdmissionChecker`, `WalletProvider`, and `TicketExperienceRuntime`.
- `TicketCollectionPage`, `OrganizerScannerPage`, `createCameraDecoder`, and `useTicketDocumentPrivacy`.
- `/orders/:confirmationToken`, `/tickets/:collectionBearer/:ticketSelector?`, and protected `/organizer/events/:eventId/check-in` routes.

**RED**

- [ ] Run the existing shared reader/checker contract suites against strict mocked Edge responses rather than fixture adapters.
- [ ] Reject extra/missing keys, malformed dates/UUIDs/credentials, wrong event IDs, duplicate selectors/positions, inconsistent collection totals, inactive tickets with credentials, and valid tickets without credentials.
- [ ] Prove abort signals reach Edge invocation, unavailable collection errors become `{kind:'unavailable'}`, and admission transport/auth/schema errors become `{outcome:'network_error'}`.
- [ ] Assert the production runtime renders the real `TicketCollectionPage` and `OrganizerScannerPage`, uses `createCameraDecoder()`, contains no fixture imports, leaves the dashboard disabled, and retains the unavailable Wallet capability.
- [ ] Assert only a `paid` confirmation renders `View tickets` to `/tickets/${encodeURIComponent(confirmationToken)}`; processing/review/failure/refund states do not claim a usable collection.

**Verify RED**

```bash
VITE_SUPABASE_URL=https://core-ticket-lite-disabled.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_core_ticket_lite_disabled VITE_MAPBOX_ACCESS_TOKEN=core-ticket-lite-disabled VITE_STRIPE_PUBLISHABLE_KEY=pk_test_core_ticket_lite_disabled pnpm vitest run src/features/ticket-experience/adapters/adapters.test.ts src/features/orders/OrderConfirmationPage.test.tsx src/app/router/router.test.tsx
```

Expected: real adapters do not exist and production routes remain not enabled.

**GREEN**

- [ ] Implement strict Zod schemas at both browser boundaries and map only allowlisted fields into existing shell contracts.
- [ ] Compose stable singleton adapters, `TicketCollectionPage`, `OrganizerScannerPage`, real camera decoder, and a production-only unavailable wallet provider in `production.tsx`. Keep development fixtures and routes unchanged.
- [ ] Keep organizer authentication in the existing protected route/session shell; the server independently verifies the JWT and ownership.
- [ ] Add the paid-only confirmation link using the already-present raw confirmation route parameter as the collection bearer. Do not add a second collection secret or change the order-confirmation database projection.
- [ ] Regenerate combined database types after every migration is applied; do not hand-edit generated signatures.

**Verify GREEN**

```bash
VITE_SUPABASE_URL=https://core-ticket-lite-disabled.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_core_ticket_lite_disabled VITE_MAPBOX_ACCESS_TOKEN=core-ticket-lite-disabled VITE_STRIPE_PUBLISHABLE_KEY=pk_test_core_ticket_lite_disabled pnpm vitest run src/features/ticket-experience/adapters/adapters.test.ts src/features/orders/OrderConfirmationPage.test.tsx src/app/router/router.test.tsx
pnpm test:ticket-shells
pnpm test:ticket-shells:production
pnpm typecheck
```

**Regression gate**

```bash
pnpm build
pnpm lint
```

**Commit boundary**

```bash
git add src/features/ticket-experience/adapters src/features/ticket-experience/runtime/production.tsx src/features/orders/OrderConfirmationPage.tsx src/features/orders/OrderConfirmationPage.test.tsx src/lib/supabase/database.types.ts
git commit -m "feat: connect production ticket experience"
```

### Task 7: Prove the Paid Journey and Write the Release Runbook

**Goal:** Establish one launch-level paid/customer/organizer proof and the small operational procedure required to deploy a single-secret system safely.

**Files**

- Create: `tests/e2e/core-ticket-truth-lite.spec.ts`
- Create: `tests/e2e/run-core-ticket-truth-lite-proof.sh`
- Create: `tests/integration/coreTicketTruthLiteRunnerContract.test.ts`
- Modify: `package.json`
- Create: `Docs/runbooks/core-ticket-truth-lite.md`
- Modify as required by the existing scoped fixture: `tests/e2e/support/ticketingFixture.ts`
- Modify as required by the existing journey driver: `tests/e2e/support/ticketingJourney.ts`

**Relevant existing interfaces**

- `tests/e2e/run-ticketing-browser-proof.sh` and its guarded Stripe test-mode transaction driver.
- Ticket Shell Playwright QR artifact decoding in `tests/e2e/support/qrArtifactDecoder.ts`.
- Existing exact cleanup, linked-development checks, disposable organizer fixtures, and real Stripe test Checkout journey.

**RED**

- [ ] Add a static runner test requiring: test-mode keys only, linked-development guard, checkout switch capture/restore, random scoped fixture IDs, presence checks for the already-configured `TICKET_CREDENTIAL_SECRET` and deployed production Edge Functions without reading or overwriting their values/state, signal-safe fixture cleanup, and zero database/provider residue proof.
- [ ] Add one serial Playwright journey that buys 2 GA + 1 VIP through real Stripe test Checkout, receives a durably `paid` confirmation, follows `View tickets`, and sees exactly three individually selectable tickets with exactly one mounted QR.
- [ ] Decode the rendered QR artifact using the existing ZXing test helper, authenticate as the owning organizer, submit that decoded value through the real admission adapter, and assert `admitted`; submit it again and assert `already_used`.
- [ ] As the second organizer, prove the same event/credential cannot admit. Prove an unknown credential and a valid credential paired with another owned event fail closed.
- [ ] Refund the paid order through the existing verified whole-order Stripe test path (or cancel the event through the owner UI in a separate fixture), then prove every previously unused ticket renders inactive and cannot admit while the used ticket remains `used`/`already_used`.
- [ ] Assert exact ticket count/source/hash uniqueness directly through the safe fixture driver, but never return raw credential/hash/secret in test logs or attachments.

Optical camera acquisition is not reimplemented here. Existing ZXing camera-decoder tests prove camera-to-string behavior; this E2E decodes the actual rendered QR and exercises the real string-to-authoritative-admission path. That is the smallest deterministic browser proof without adding a production test route or fake-camera feature gate.

**Verify RED**

```bash
pnpm vitest run tests/integration/coreTicketTruthLiteRunnerContract.test.ts
pnpm test:e2e:core-ticket-lite
```

Expected: the runner/script/spec and package command do not exist.

**GREEN**

- [ ] Extend the existing guarded proof infrastructure rather than creating a second provider harness.
- [ ] Add `test:core-ticket-lite`, `test:integration:core-ticket-lite`, and `test:e2e:core-ticket-lite` scripts that compose existing commands and the new focused files.
- [ ] Ensure cleanup works from success, assertion failure, interrupt, and partial fixture creation; it may delete only captured fixture IDs, proof-created Stripe objects, and the existing temporary transaction driver. It must never unset, overwrite, or reveal `TICKET_CREDENTIAL_SECRET`, nor delete the production ticket functions.
- [ ] Write the runbook: create the 32-byte secret, resolve preflight stop conditions, disable checkout, deploy migrations/functions/app, run smoke proof, reopen checkout, and treat accidental secret change as an incident requiring restoration of the prior value until a future keyring migration.
- [ ] Record commands and evidence only. Do not add automated email, dashboard, feature-gate framework, provider scanner, privacy sentinel, or rotation tooling.

**Verify GREEN**

```bash
pnpm vitest run tests/integration/coreTicketTruthLiteRunnerContract.test.ts
pnpm test:core-ticket-lite
pnpm test:e2e:core-ticket-lite
```

**Final regression gate**

```bash
VITE_SUPABASE_URL=https://core-ticket-lite-disabled.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_core_ticket_lite_disabled \
VITE_MAPBOX_ACCESS_TOKEN=core-ticket-lite-disabled \
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_core_ticket_lite_disabled pnpm test
pnpm typecheck
pnpm lint
pnpm test:functions
pnpm test:integration
pnpm test:integration:moderation
pnpm test:integration:ticketing-db
pnpm test:ticket-shells
pnpm test:ticket-shells:production
pnpm build
git diff --check
git status --short --branch
```

If a linked Stripe/Supabase proof cannot run, do not call Lite launchable. Report the exact missing credential, environment, deployment, or cleanup blocker.

**Commit boundary**

```bash
git add tests/e2e/core-ticket-truth-lite.spec.ts tests/e2e/run-core-ticket-truth-lite-proof.sh tests/integration/coreTicketTruthLiteRunnerContract.test.ts tests/e2e/support/ticketingFixture.ts tests/e2e/support/ticketingJourney.ts package.json Docs/runbooks/core-ticket-truth-lite.md
git commit -m "test: prove core ticket truth lite journey"
```

## D. Deferred-Upgrade Map

| Deferred feature | Lite seam that preserves the upgrade path |
|---|---|
| Deterministic UUIDv8 identity | Existing random `tickets.id` remains stable and independent of credentials. A future source-derived identity can be added as a separate unique column without changing order-item/unit issuance or redemption by hash. |
| HMAC keyring infrastructure | All derivation is isolated in one helper and the raw credential carries a format prefix. Existing rows are implicitly key version 1; a later nullable-then-backfilled `credential_key_version` can dispatch old/new keys. |
| Credential generations | Existing tickets are implicitly generation 1. A later `credential_generation` plus history table can be added without changing ticket identity or payment source. |
| Credential reissue | A future transaction can append old-hash history and replace the active hash/generation for an unused ticket; the collection and scanner ports remain unchanged. |
| Credential rotation | A future keyring can mint a new generation while retaining old-key verification during rollout. Lite explicitly forbids changing the one secret in place. |
| Key retirement | Later usage queries over key-version/generation metadata can gate retirement; no current ticket ID or scan outcome must change. |
| Dedicated legacy-ticket backfill | The pre-launch empty-ticket assertion avoids inventing legacy truth. If legacy data later exists, a separate source-unit backfill can populate the same three columns before enforcing constraints. |
| Staged multi-environment migration orchestration | Forward-only timestamped migrations and the checkout kill switch provide a manual pre-launch deployment window; automation can wrap the same steps later. |
| Elaborate runtime feature gates | Missing secret/endpoints fail closed and the existing checkout switch controls new sales. Independent collection/scanner rollout switches can wrap the adapters later. |
| Exhaustive six-way concurrency harness | All paths share the event advisory lock and ticket row lock. The required scan/scan proof lands now; scan/refund, scan/review, scan/cancel, reissue, and duplicate-manifest stress cases can be added without changing the lock protocol. |
| Privacy sentinel framework | Lite has strict schemas, no-store headers, safe errors, allowlisted logs, and focused no-leak tests. A future sentinel can inspect the same boundaries and artifacts. |
| Bundle artifact secret scanner | The secret is server-only and has no `VITE_` name. A future build scanner can be added independently. |
| Provider metadata forensic scanner | Stripe metadata remains order-scoped and never receives the credential. Future forensic automation does not affect ticket truth. |
| Offline check-in | Redemption remains a server RPC. Future offline grants/synchronization can be layered as a separate risk model without weakening online atomic redemption. |
| Rotating QR | Stable ticket identity and server-authoritative lookup allow later short-lived presentations to resolve to the same ticket. |
| Transfers/resale | Current ticket identity is stable; future ownership/entitlement history can reference it without rewriting the paid source or redemption result. |
| Wallet passes | `WalletProvider` already exposes an unavailable capability. Future passes can carry a presentation derived for the same ticket. |
| Customer accounts | The collection bearer is an authorization mechanism, not ownership. A future account claim can map account → order/collection while retaining bearer fallback. |
| Branded QR | `AdmissionQr` owns presentation while the credential contract stays opaque; styling can change independently. |
| Fraud engine | A future decision layer can run before the same atomic RPC; only that RPC may return admission. |
| Free-RSVP issuance | `tickets` does not encode payment as admission status. A future source discriminator/RSVP source can create one ticket per RSVP through a separate issuer while reusing collection/scanner ports. |
| Automatic ticket email orchestration | The confirmation page supplies the collection link now. Existing email shells can later deliver that same link once durable notification idempotency is approved. |
| Microservices | Edge ports and database functions form explicit seams that can be moved behind a service later without changing browser contracts. |
| CQRS/event sourcing | Durable order and ticket rows remain normalized sources of truth. A later event stream/read model can subscribe to committed transitions without replacing them. |
| Partial ticket refunds | Checkout Integrity currently enforces whole-order safety. Later item allocation can update selected unused tickets through the same lifecycle guard while preserving used history. |
| Attendee reassignment | `attendeeLabel` is optional and omitted. A future assignment record can project into the existing shell without changing admission credentials. |
| Automatic anomaly repair | Contradictions fail closed and route to existing review state. Later tooling can inspect and repair through explicit audited operations. |
| Paid event dashboard adapter | Dashboard reporting is not required for payment → ticket → scan. Its existing shell remains disabled until authoritative aggregate requirements are approved. |

## E. Definition of Done

Core Ticket Truth Lite is launchable only when a single guarded linked-development proof demonstrates this exact journey without manual row edits:

1. An organizer publishes a paid event with GA and VIP tiers.
2. An accountless buyer purchases 2 GA + 1 VIP through Stripe test Checkout.
3. A verified webhook establishes durable payment and one locked fulfillment transaction creates exactly three tickets: two GA labels and one VIP label, unique source units, unique 32-byte credential hashes, no raw credentials in PostgreSQL.
4. Replaying fulfillment changes nothing and still reports three tickets, including after one ticket has been used.
5. The paid confirmation links to the private collection using its existing confirmation bearer.
6. The collection shows exactly three stable ticket selectors and renders one valid QR at a time; decoding it reproduces the hash stored for that ticket.
7. The owning organizer's real admission boundary consumes the decoded credential and returns `admitted`; the ticket is durably `used` with `used_at` in that same transaction.
8. A second request and a separate two-session concurrent proof return `already_used`; never two admissions.
9. Another organizer cannot redeem it. Unknown credentials, wrong-event credentials, malformed requests, contradictory rows, and backend uncertainty never admit.
10. A verified refund or owner event cancellation makes every unused ticket non-admissible and removes its QR. The already-used ticket remains `used`, with its original `used_at`, while the order/refund rows retain the financial outcome.
11. The existing Checkout Integrity, moderation, Ticket Experience, typecheck, lint, function, build, and focused linked-environment gates all pass, exact fixture cleanup reports zero residue, and the checkout switch is restored to its prior state.

That is the Lite launch boundary. Anything beyond it belongs to the deferred map unless new production evidence changes the founder scope.

## Plan Self-Review

- Seven tasks cover schema/credentials, issuance, collection, redemption, invalidation/cancellation, UI adapters, and one paid E2E proof.
- The plan adds three ticket columns, zero tables, two new service ticket RPCs, one extended fulfillment RPC, and one owner cancellation RPC.
- Every production behavior begins with a failing test, names the GREEN implementation, lists a focused verification command, carries a broader regression gate, and ends at a scoped commit.
- The only deferred architecture pulled forward is one external HMAC secret, with the technical necessity stated in section B. No keyring, generation, rotation, reissue, UUIDv8, backfill framework, dashboard, email orchestration, or privacy/forensics framework is included.
- Placeholder scan must be empty:

```bash
rg -n "TO""DO|TB""D|write appropriate te""sts|handle edge ca""ses|implement la""ter|fill this i""n" Docs/superpowers/plans/2026-09-07-core-ticket-truth-lite-implementation.md
```
