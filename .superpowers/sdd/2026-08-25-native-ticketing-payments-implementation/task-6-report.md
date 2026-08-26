# Task 6 Report — Browser Ticketing and Payment Contracts

Status: `DONE_WITH_CONCERNS`

## What changed

- Regenerated `src/lib/supabase/database.types.ts` from the linked Supabase project using
  `pnpm db:types`; it now represents all current Day 2 tables and service RPCs after Tasks 2–5.
- Added strict, browser-safe ticket-tier input validation: one to three tiers, unique
  case-insensitive trimmed names and positions, exact 80/240 text limits, USD minor-unit pricing,
  positive integer capacity, UUID IDs, and blank optional descriptions normalized to `null` to
  match database persistence.
- Added a strict checkout input contract accepting only opaque event/tier/request UUIDs, normalized
  guest name/email, and literal quantity `1`. It rejects all unknown browser inputs, including
  price, fee, currency, and Stripe destination fields.
- Added generated-row-derived domain types for ticket tiers, the anonymous public event/tier
  projection, safe organizer Connect readiness states, and the minimal discriminated order
  confirmation states. No browser contract includes server financial truth or secrets.
- Added a compile-time/runtime test guard for the reviewed linked schema surface: the nine current
  Day 2 tables (including Task 5 disputes) and fourteen approved user/service RPCs.

## Files changed

- `src/lib/supabase/database.types.ts`
- `src/features/tickets/ticket.schemas.ts`
- `src/features/tickets/ticket.schemas.test.ts`
- `src/features/tickets/ticket.types.ts`
- `src/features/checkout/checkout.schemas.ts`
- `src/features/checkout/checkout.schemas.test.ts`
- `src/features/payments/payment.types.ts`
- `src/features/orders/order.types.ts`

## Migrations

- None. `pnpm db:types` performed the approved read-only linked-schema generation only.

## TDD and verification evidence

- RED: the initial focused command failed only because both new schema modules were absent.
- GREEN: the focused test command passes 28 files / 276 tests. The ticket suite covers tier count,
  normalization, uniqueness, exact bounds, USD, capacity, and sort positions; the checkout suite
  covers UUIDs, guest normalization, literal-one quantity, and strict rejection of financial or
  destination data.
- A second RED/Green cycle proved blank tier descriptions now normalize to `null`, matching
  `nullif(btrim(...), '')` in `save_ticket_tiers`.
- `pnpm typecheck` passes.
- `pnpm lint` passes.
- `pnpm test` passes: 28 files / 276 tests.
- `pnpm build` passes. Vite emitted only the pre-existing chunk-size advisory.
- `git diff --check` passes. `.env.local` is ignored by `.gitignore` and is untracked. A
  non-printing secret-pattern scan found no task-file or generated-type secret value.

## Remaining concern

- `pnpm test:integration` is blocked before tests start because this worktree lacks the existing
  required Node-only integration variables: `TEST_SUPABASE_URL`, `TEST_SUPABASE_PUBLISHABLE_KEY`,
  `TEST_ORGANIZER_A_EMAIL`, `TEST_ORGANIZER_A_PASSWORD`, `TEST_ORGANIZER_B_EMAIL`, and
  `TEST_ORGANIZER_B_PASSWORD`. No credentials were read, printed, or added. This is an existing
  environment prerequisite, not a Task 6 schema failure.

## Review fix round 1

- Reduced `OrderConfirmation` to the approved Task 15 bearer-safe projection: only event title,
  start/end time, timezone, venue, tier name, order number, and one of `processing`, `paid`,
  `failed`, `expired`, or `refunded`. It no longer exposes order/ticket UUIDs, tier description or
  quantity, ticket state, issuance timestamps, or failure internals.
- Added `publicTicketingEventSchema` as the strict JSONB trust boundary for
  `get_public_event_ticketing`. It accepts only a fully published paid-event projection with
  non-null public fields, US/CA Bay Area invariants, USD active availability states, and one to
  three tiers. Its output uses an explicit one/two/three-tier tuple union.
- Replaced generic UUID validation for persisted tier/check-out IDs with normalization to lowercase
  plus RFC version 1–5 and variant validation, matching the database tier-ID contract.
- Added exact inclusive and one-beyond boundary proof for 80/240 text limits, 1/99,999,999 minor
  USD amounts, and 1/2,147,483,647 capacity. Added compile-time exactness/exhaustiveness guards for
  Connect, public ticketing, and order-confirmation contracts.
- TDD evidence: new public-parser exports and uppercase UUID normalization failed before the
  contract implementation; the focused suite now passes. The final app gate passes 28 Vitest files
  / 286 tests, TypeScript, ESLint, and production build. The only build output is the pre-existing
  chunk-size advisory. `git diff --check`, ignored/untracked `.env.local`, and a non-printing
  secret-pattern scan are clean. No migration or linked-database mutation was performed.
