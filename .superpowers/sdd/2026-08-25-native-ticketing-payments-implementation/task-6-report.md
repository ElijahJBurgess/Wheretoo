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
