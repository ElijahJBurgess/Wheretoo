# Wheretoo development screen hub

The hub is disabled by default in local development, Vercel Preview, and production
builds. Enable it only for an intentional fixture-gallery run with
`WHERETOO_ENABLE_PREVIEW=1 pnpm dev`, then open `/preview`. Use
`WHERETOO_ENABLE_PREVIEW=1 pnpm build` for an explicitly opted-in static build. No
credentials are needed for previews.

## Buyer journey

All nine screens are directly accessible:

- `/preview/event-page`
- `/preview/ticket-selection`
- `/preview/checkout`
- `/preview/confirmation`
- `/preview/ticket-wallet`
- `/preview/qr-ticket`
- `/preview/used-ticket`
- `/preview/refunded-ticket`
- `/preview/cancelled-ticket`

The buyer previews reuse the real presentation components. Quantities and navigation
live only in an in-memory preview provider; preview actions never call Supabase, Stripe,
checkout creation, fulfillment, admission, or refund services. The checkout action is
explicitly labeled “Preview confirmation.” The preview QR encodes an obvious non-admission
message, not a valid `wta1_` credential. Invalid ticket states never mount a QR renderer.
The calendar action downloads a local sample `.ics` file.

Private screens use only fields available in the current private responses. They omit
artwork, organizer information, recipient email/delivery claims, and Apple Wallet.
Public previews use local synthetic event data. `assets/rooftop-reference.png` is an
artwork-only crop of the user-supplied `01-event-page-screen.png`, isolated to previews;
the source reference is small, so the crop is intentionally not represented as a
high-resolution production asset. Production public screens use real event artwork.

The existing development live test world on the hub is separate and retains its existing
live-flow labels and behavior. The nine fixture previews never enter that live flow.

## Other screens

Organizer and account screens remain read-only HTML captures of the actual React pages,
mounted against local fixtures in Vitest. Their markup has no handlers or navigation URLs
and is placed in an inert region. Policy pages are reused directly. Organizer Payments
requires a live Stripe account session and remains marked “Runtime data required.”

After intentionally changing a captured real screen, regenerate its capture:

```sh
UPDATE_PREVIEW_SCREENS=1 pnpm exec vitest run --exclude '**/.worktrees/**' src/preview/screens.render.test.tsx
```

Review `screens.json` and run `pnpm exec vitest run --exclude '**/.worktrees/**'`.
The renderer test compares captures with current components and rejects service calls.
The worktree exclusion prevents archived sibling checkouts from entering this checkout's suite.
