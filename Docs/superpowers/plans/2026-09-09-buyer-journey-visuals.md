# Buyer journey visual implementation

Goal: Deliver all nine real buyer screens and isolated interactive previews using the supplied 18 PNGs and the user's approved contract adaptations.

Constraints: Preserve checkout handlers, pricing, API contracts, private ticket reads, QR credentials, redemption and refund/cancellation truth. No backend/schema/migration edits. Omit wallet and unsupported sharing/email claims. Preserve pre-existing local changes. Do not push or merge.

Architecture: Small shared visual components with typed display props; production route containers retain queries and mutations. Preview imports only these display components and local fixtures, with local navigation and no service clients. Keep existing multi-tier quantity input semantics and ten-ticket limit.

- [x] Shared buyer header, progress, event metadata/summary, action and order surfaces. Near-black #080a0b, charcoal #131617, violet #8b2cff, white #f7f5f9, muted #b5b7bc, green #4ce2a0, red #ff635d. Georgia display headings, existing Manrope utility text. Center a 390px composition, fluid down to 320px, expand only to 440px on desktop.
- [x] Preserve TicketTierList behavior while restyling its rows. Reuse event presentation in real PublicTicketEventPage and TicketSelectionPreviewPage. Event page full-bleed photo + large bottom-aligned title; selection uses shorter artwork and compact ticket surface.
- [x] Extract CheckoutReview presentation; retain CheckoutPage submission/retry/cancellation exactly. Show selected quantities as read-only, edit via existing event route, real public-data total, buyer name/email, hosted-payment explanation, existing submit CTA.
- [x] Extract OrderConfirmationView; retain all persisted status copy, polling/retry/clearing and native private-ticket navigation. Render private metadata only, real order rows/total, paid-only ticket action and local calendar download derived from known event dates.
- [x] Restyle TicketCollectionOverview and FocusedTicketView, retain TicketCollectionPage request/selection lifecycle and AdmissionQr renderer. Omit unavailable wallet action. Invalid states use crossed-out decorative ticket pattern, never QR renderer or credential. Keep prior/next keyboard behavior.
- [x] Add all nine direct preview slugs and an isolated local click-through journey. Use fixture contracts without extra private metadata. Preview QR uses an explicitly non-admission value, no production credential or network access.
- [x] Run relevant tests, all frontend tests, functions/payment/core-ticket regressions, typecheck, lint, production build and production fixture isolation check. Refresh existing inert captures after intentional real-screen changes.
- [x] Browser QA: local Vite runtime, fixture states, all nine previews at 390px; spot-check 320/768/1440px, keyboard, local journey, calendar output, no unexpected requests, no invalid QR canvas. Inspect saved screenshots against supplied originals. Record adaptations and final evidence.

Visual parity inventory: naked black mobile canvas; centered small wordmark/header; purple thin three-step rail; serif event/display headings; 12–20px page insets; full-width pill primary actions; charcoal ticket rows with fine borders; valid QR on white with purple frame; green valid badge; used/refunded/cancelled centered status + crossed-out inactive graphic. Private pages intentionally omit reference artwork/organizer/email and Apple Wallet because their contracts do not expose them.
