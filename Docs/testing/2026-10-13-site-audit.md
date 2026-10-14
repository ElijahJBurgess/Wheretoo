# Site loading and discovery audit — 13 October 2026

## Scope and environment

Audited the working checkout at `/Users/exoh/Desktop/WhereTo -  Repository`, branch `codex/recovery-main-before-final-20260915`. Existing uncommitted buyer, organizer, branding and preview work was preserved. This report concerns the local development server (`http://127.0.0.1:3000`) and a locally built production preview (`http://127.0.0.1:3001`), not a deployed public release.

The verification actor is an anonymous visitor, with isolated browser-only fixtures for selection/navigation. Desktop viewport: 1440×900. Mobile viewport: 390×844. No real purchase, refund, check-in, account creation, deployment or remote schema mutation was performed.

Source of truth: the three V1 product/flow/architecture documents and the context-map specification. The existing map implementation was restored from `codex/wheretoo-map-integration`; it was not recreated or broadly merged with unrelated platform branches.

## Fixed

- Home previously redirected every visitor to organizer sign-in. It now presents a public home page with an interactive map, an explicit full-map entry, and organizer entry points. `/map` opens full-screen discovery; `/discover` resolves to home.
- Added next-seven-days, Today and Happening-now filters, category filtering, an accessible event list, event previews and links into the existing event route. The map uses the canonical public PostGIS RPC, bounded responses, cancellation, validated data and genuine empty/error states. No sample events appear in normal discovery.
- Startup import failures previously left the page blank. Startup, route errors and unmatched routes now have usable states and recovery actions.
- A stalled authentication lookup previously left protected pages checking the session indefinitely. Session initialization now has a deadline and explicit retry state. Sign-in also restores validated organizer/moderation destinations instead of losing the requested page.
- Invalid checkout event IDs previously stayed on Loading checkout. They now show an unavailable state with a browse link.
- Stalled public event, order, ticket, organizer, payment-status and moderation/policy reads now have deadlines and recoverable errors. Ticket collection failures expose a retry action. The shared helper covers response-body parsing and cleans up its timers and abort listeners; write/payment mutations retain their existing behavior.
- Real organizer scanner URLs in development previously entered the fixture-only scanner and rejected actual event IDs. Real events now use the authenticated production scanner; explicit demo routes remain isolated.
- Added navigation from buyer and onboarding screens back to home/discovery, plus an organizer map link and live-platform links in the development hub.
- Synthetic ticket previews and navigation tests no longer change meaning when the wall clock passes their fixture event dates.
- Map interactions no longer query missing layers during startup. Recoverable tile failures, delayed styles and responsive startup changes are handled; failed startup has a deadline and retry. Embedded maps use cooperative gestures to preserve page scrolling.
- Production CSP now includes the Mapbox worker/blob, tile and WebAssembly requirements while retaining restricted script sources. See [Mapbox security documentation](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/).
- Test and lint discovery now excludes nested worktrees and archived development artifacts.

## Coverage and remaining gaps

| Surface | Evidence and status |
| --- | --- |
| Public home and map | Real Mapbox rendering, desktop/mobile screenshots, home → full map, filters, empty state, list selection, preview close and event-route navigation exercised. |
| Auth screens | Sign-in, signup and email-check pages render; anonymous organizer routes redirect correctly. Unit tests cover auth errors, session deadline and retry. No real account/session was created. |
| Event, checkout, order and tickets | Invalid-link and unavailable states exercised in browsers; API, page and recovery behavior tested. Existing paid transaction server tests also ran. A new complete Stripe TEST purchase was not performed. |
| Organizer creation, payments and check-in | Existing automated coverage exercised. Real scanner dispatch fixed. Authenticated browser publishing, Stripe onboarding and camera/device check-in remain unverified in this audit. |
| Event inventory | Read-only anonymous live query succeeded, returning zero eligible public events in the Bay Area during the next seven days. Empty discovery is accurate for this backend; the audit did not seed fake production inventory. |
| Free RSVP | **Missing in this recovery checkout and linked backend.** No free-registration RPCs or free-RSVP Edge functions are deployed. Newer branches contain implementations requiring their own schema and function integration. |
| Organizer sales/attendee dashboard | **Missing in this recovery checkout and linked backend.** Production still uses the existing not-enabled boundary; development has a labelled fixture. The required organizer operations RPCs are absent. |
| Event policy and organizer terms | Routes render, but their existing content says it will be finalized before public launch. This audit does not invent legal/product policy. |
| Deployment | Local source and local builds only. No public site was deployed or certified. |

The loading fixes and discovery entry are reviewable locally. This checkout must not be described as a fully launch-ready platform while the missing RSVP, organizer operations and policy work remain.

## Changed areas

| Area | Files |
| --- | --- |
| Public entry and discovery | `src/features/home/HomePage.tsx`, `home.css`; restored `src/map/**` and the map-icon reader/schema modules in `src/features/map-icons/` |
| Startup and route recovery | `src/app/bootstrap.tsx`, `src/main.tsx`, `src/main.development.tsx`, `src/app/router/router.tsx`, `RouteFallback.tsx`, `route-fallback.css` |
| Session and return navigation | `src/features/auth/SessionProvider.tsx`, `SignInPage.tsx`, `src/app/router/RequireSession.tsx` |
| Read deadlines | `src/lib/readTimeout.ts`; read APIs in events, organizers, moderation, orders, payments, tickets and the ticket-collection adapter |
| Buyer/scanner recovery | `src/features/checkout/CheckoutPage.tsx`, ticket collection page and development ticket runtime |
| Connected navigation | Buyer primitives, onboarding/organizer layouts, `src/preview/PreviewApp.tsx`, regenerated preview screen snapshot |
| Build/runtime configuration | `package.json`, lockfiles, `index.html`, `src/config/browserEnv.ts`, `vite.config.ts`, `eslint.config.js` |
| Regression and browser checks | Associated unit tests, CSP contract test, `tests/e2e/public-routes.config.ts`, `tests/e2e/public-routes.smoke.ts` |

This list describes this audit's changes. The checkout also contains earlier uncommitted work, including a preexisting migration; those changes were preserved and are not claimed as audit work.

## Reproduction and verification

- Final application/integration/E2E/scripts type checking, ESLint, production build and two CSP contract tests passed. The existing Edge-function suite passed all 219 tests; four offline integration files passed all 32 tests.
- Final frontend suite on the completed, stable source: **117 files and 1,133 tests passed** (`pnpm test --maxWorkers=4`, 187.61 seconds).
- Final production browser run: **28 passed, two intentionally skipped DEV-only cases**. Across 24 route checks and four map journeys, diagnostics recorded zero page errors, console errors, failed requests or HTTP errors. Fresh desktop/mobile screenshots were inspected. Development also passed all 30 route/map cases, plus a final two-case demo rerun.
- The production browser run verified entry `/assets/index-CiWqevmN.js`. Built and served `index.html` SHA-256 matched before and after verification: `925c9b1e0c80a7471c8d1ef6b768d21f2e95be210077a3953fa6b86db63c4ee3`. Final screenshots/diagnostics: `test-results/public-routes-production-final/`.
- The production build retains a chunk-size warning for the lazily loaded Mapbox renderer. This audit checked ordinary desktop/mobile journeys; it did not benchmark dense production event inventory.
- `pnpm dev` serves the platform home and real map. The existing `.env.local` public configuration is sufficient; no new environment variable or migration is required.
- `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm test --maxWorkers=4` are the repository checks.
- `pnpm test:functions` exercises the existing Edge handlers, including checkout, verified webhook processing, refunds and admission rejection/retry cases.
- `pnpm exec playwright test --config tests/e2e/public-routes.config.ts` runs the anonymous route and map smoke journeys against the running development server.
- For the local production preview, set `WHERETO_SMOKE_BASE_URL=http://127.0.0.1:3001` and `WHERETO_SMOKE_PRODUCTION=1`. Explicit development-fixture cases are skipped.
- Screenshots and sanitized browser diagnostics are under ignored `test-results/public-routes*` directories. They are local audit artifacts, not shipped assets.

No migrations were added or applied. No setup is required for the fixes beyond the existing environment and installed dependencies. Completing the missing subsystems requires choosing and integrating the newer platform baseline together with its backend migrations/functions; copying isolated UI screens would produce misleading or broken functionality.
