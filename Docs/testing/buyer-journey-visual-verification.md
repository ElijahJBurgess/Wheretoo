# Buyer journey implementation and verification

Implemented September 8, 2026 (Pacific), on `codex/buyer-journey-v1`.

## Review the nine screens

The local development server is available at [the preview hub](http://127.0.0.1:3000/preview). Each screen is also directly accessible:

| Screen | Preview |
| --- | --- |
| Event page | [Open](http://127.0.0.1:3000/preview/event-page) |
| Ticket selection | [Open](http://127.0.0.1:3000/preview/ticket-selection) |
| Checkout review | [Open](http://127.0.0.1:3000/preview/checkout) |
| Order confirmation | [Open](http://127.0.0.1:3000/preview/confirmation) |
| Ticket wallet | [Open](http://127.0.0.1:3000/preview/ticket-wallet) |
| Valid QR ticket | [Open](http://127.0.0.1:3000/preview/qr-ticket) |
| Used ticket | [Open](http://127.0.0.1:3000/preview/used-ticket) |
| Refunded ticket | [Open](http://127.0.0.1:3000/preview/refunded-ticket) |
| Cancelled ticket | [Open](http://127.0.0.1:3000/preview/cancelled-ticket) |

The previews share the production presentation components. Start at the event page, select quantities, review the order, select **Preview confirmation**, open the wallet, and move through the tickets. Quantities persist while navigating within the preview. The header navigation exposes every screen, including the three invalid states. Reloading resets the local fixtures.

## What changed

The nine screens use the supplied PNGs for hierarchy, dark palette, serif display typography, purple actions, ticket surfaces, progress rail, and valid/invalid ticket treatment. Public pages display actual event artwork when supplied. The desktop presentation keeps a centered mobile composition, capped at 440px.

Production event, selection, checkout, confirmation, collection, and focused-ticket routes reuse these views. The dedicated selection route is `/events/:eventId/tickets`. The existing purchase controls and quantity validation remain available on the original event route.

The implementation applies the user's approved adaptations:

- Checkout retains the existing buyer fields, submission, cancellation/retry handling, and Stripe-hosted redirect. The payment section explains the handoff; there is no inline payment form.
- Pricing comes from existing public ticket prices and private order totals. Checkout adds no fees or taxes. Confirmation renders the subtotal, tax, and total fields already supplied by its response.
- Private confirmation and wallet screens omit unavailable artwork, organizer details, recipient email, delivery claims, and Apple Wallet. The calendar download uses known event dates, title, and venue; it makes no service request.
- Valid tickets retain the existing secure QR renderer and credential lifecycle. Used, refunded, and cancelled tickets display a crossed-out decorative pattern without mounting a QR renderer or rendering their credential. The reader, status derivation, native private navigation, and ticket-switching lifecycle remain intact.
- Fixture checkout never calls a service. Its QR contains an explicit non-admission message; it is not a production admission credential. The existing development live test world remains separate.

## Files changed by this task

- `src/features/buyer-journey/`: shared visual primitives, event view, checkout review, confirmation view, formatting, scoped CSS, calendar download and its tests.
- `src/features/checkout/CheckoutPage.tsx`, `src/features/orders/OrderConfirmationPage.tsx`: connect existing route behavior to the shared views.
- `src/features/tickets/PublicTicketEventPage.tsx`, `TicketSelectionPreviewPage.tsx`, `TicketTierList.tsx`, and `src/app/router/router.tsx`: public event/selection presentation and dedicated selection route.
- `src/features/ticket-experience/customer/FocusedTicketView.tsx`, `TicketCollectionOverview.tsx`, `TicketCollectionPage.tsx`, `InactiveTicketArtwork.tsx`, and the affected component tests: wallet, secure QR, invalid-state presentation, and header navigation.
- `src/preview/BuyerJourneyPreview.tsx`, `buyerScreens.ts`, `buyerJourney.test.tsx`, `PreviewApp.tsx`, `PreviewApp.test.tsx`, `catalog.ts`, `preview.css`, `screens.json`, `README.md`, and `assets/rooftop-reference.png`: nine interactive fixtures, navigation, regression coverage, refreshed existing captures, and a preview-only artwork crop.
- `src/features/ticket-experience/runtime/production.test.tsx`: wait for the lazy scanner's loading fallback to disappear before rerendering, avoiding a precommit race while retaining all scanner assertions. No production scanner change.
- `Docs/superpowers/plans/2026-09-09-buyer-journey-visuals.md` and this report.

No backend, API contract, pricing logic, Stripe architecture, database schema, or migration was changed by this task. Pre-existing local changes were preserved, including the development test world and its untracked migration. No commit, push, merge, or deployment was performed.

## Automated verification

| Check | Result |
| --- | --- |
| `pnpm exec vitest run --maxWorkers=3 --exclude '**/.worktrees/**'` | 915 tests passed across 88 files; 0 failed |
| `pnpm typecheck` | Passed: application, integration, E2E, and script configurations |
| `pnpm exec eslint . --ignore-pattern '.worktrees/**'` | Passed |
| `pnpm build` | Passed |
| `pnpm test:functions` | 219 passed, 0 failed |
| `pnpm test:integration:core-ticket-lite` | 7 integration checks and 35 driver contract tests passed; 5 database-dependent checks skipped |
| Production output verification, `scripts/verify-ticket-shell-production.ts` | `ticket-shell-production=passed` |
| `git diff --check` | Passed |

The database checks require `WHERETO_TICKETING_DB_URL` pointing to an explicitly configured disposable loopback database. That configuration was not supplied, so no database proof or live Stripe transaction was run. Existing function and frontend contract regression tests ran without changing backend behavior.

Archived `.worktrees` are excluded from this checkout's test/lint commands; they contain separate historical source trees. Initial concurrent test runs hit time limits under machine load. The final suite uses three workers. The scanner test's Suspense race was reproduced in isolation, fixed only in the test's wait condition, and independently reviewed.

## Browser and visual verification

Real Chromium inspection covered all nine screens at 390px, with additional screenshots of selection, checkout, and QR at 320px and 1440px. All supplied primary references were opened and compared with the implementation. This is reference-directed fidelity with the documented contract adaptations, not a claim of pixel equality with the small raster references.

The browser proof exercised the complete local journey, quantity persistence after editing, the ten-ticket cap, calendar download, each wallet row, previous/next keyboard navigation, out-of-range ticket selectors, and all three invalid states. All 36 combinations of nine routes and 320/390/768/1440px viewports passed geometry checks with no page overflow. Valid QR canvases measured 240×240px at every viewport. Invalid states had no QR canvas. Wallet and focused ticket schedules agreed when the browser timezone was set to America/New_York. There were no page errors, external requests, or network writes during the fixture journey.

The bundled visual layout sweep was also run on checkout at all four widths. Its mechanical flags were inspected: the clipped 1px heading is intentionally screen-reader-only; the preview navigation intentionally wraps; the event thumbnail intentionally uses cover cropping; and the centered desktop mobile column intentionally leaves side space. No unresolved visible defect remained from those flags.

Independent review identified and then verified fixes for out-of-range preview selection, schedule consistency, and narrow QR sizing. The follow-up review reported no outstanding findings.

Local evidence:

- `/tmp/wheretoo-buyer-visuals/`: nine mobile screenshots, six additional responsive screenshots, the downloaded calendar, and `verification.json` with the 36-route geometry results.
- `/tmp/wheretoo-buyer-baseline/`: test/build/lint logs, layout audit output, and the independent review report.
- `/tmp/wheretoo-buyer-journey-verify.cjs`: browser journey proof used for this review.

## Remaining limits and setup

No new setup is required to use the local preview. After stopping the server, run `pnpm dev` and open `/preview`. Preview fixtures need no credentials. Normal production flows retain their existing service configuration requirements.

The supplied artwork is a small raster reference. Its preview-only crop is correspondingly soft; production pages use the event's real artwork. This work was verified locally and has not been deployed. Live payment, refund, check-in, and database proofs were not repeated as part of this visual-only change.
