# Wheretoo development screen hub

Open `/preview` with `pnpm dev`. Vercel Preview deployments enable the hub automatically
when `VERCEL_ENV=preview` is available during the build. For another development host,
build with `WHERETOO_ENABLE_PREVIEW=1 pnpm build`. Production builds leave it disabled
unless explicitly opted in. No credentials are needed for previews.

The existing approved Ticket Selection preview retains its styling and uses the current multi-tier quantity controls. Policy pages are
also reused directly. Other available screens are **read-only HTML captures of the real
React pages**, mounted against local fixtures in Vitest. They are not invented designs
or interactive workflow demos. Create/Edit Event show the existing Basics step.

The browser entry imports only the hub, approved preview, policy components, and captured
HTML. It never mounts the production session provider, queries, checkout logic, or SDKs.
Captured markup has no event handlers or navigation URLs and is placed in an inert region.
The preview toolbar remains interactive so every screen has a route back to the hub.

Organizer Payments is marked **Runtime data required** because the full Stripe embedded
setup/management interface needs a live account session. Wallet, QR, used, refunded and
cancelled ticket screens are implemented by Core Ticket Truth Lite; their isolated hub captures are **Preview not available**. Existing order confirmation
is not represented as a wallet or a QR ticket.

After intentionally changing a real screen, regenerate its captures:

```sh
UPDATE_PREVIEW_SCREENS=1 pnpm exec vitest run src/preview/screens.render.test.tsx
```

Review `screens.json` and run `pnpm test`. The renderer test compares captures with the
current components to detect stale markup; it fails if any mocked write or service call
runs. `fixtures.ts` is test-only and contains synthetic display data. `screens.json` is a
small checked-in display asset so a Vercel build does not need a test renderer or services.
