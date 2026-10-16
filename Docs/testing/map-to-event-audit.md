# Task 3 — map-to-event audit and proposal

2026-10-16. Audit only; no implementation, migration, deployment, publishing, purchase or RSVP submission.

## Audit contract and evidence

- Actor/job: anonymous buyer, icon → preview → public event → existing ticket selector or free-RSVP quantity screen → discovery/map return.
- Authoritative source: latest origin/main **5ddfb1a71ad3459e585825c8d957fea5e0f8db0a**, including PR #20; existing product definition, user flows, technical architecture and buyer-journey presentation conventions.
- Canonical target: https://wheretoo-staging.vercel.app, verified READY deployment **dpl_3Q5WgGGUq4hN1Y4vfxhasoxbtwTJ**, matching that commit. Routes exercised: /map, /discover, /events/:id, /events/:id/tickets, /events/:id/rsvp.
- Profiles: state/journey, responsive, map and keyboard; headed Chrome at 1280×800 and touch-emulated 390×844; edge/geometry checks at 320×640.
- Live data: nine existing staging icon listings, all free in the sampled inventory. Paid, sold-out, unavailable, image-failure, long-copy, co-located and short-expiry cases use isolated browser response fixtures against the existing hosted application. No database fixtures or remote mutations.
- Verification status: **partial**. Tested browser journeys and findings below are verified; physical iOS/Android, screen-reader announcements and real paid checkout submission are not verified. The audit deliberately stops before submitting a transaction.
- Local evidence/harness: `/tmp/wheretoo-task3-audit/`; summary: map-to-event-measurements.json. Screenshots listed below were opened and visually inspected. No source-build claim rests on screenshots alone: deployment identity was checked separately.

## What already works

- Immediate title/date/timezone/venue/admission preview from loaded map inventory. Five measured selections per profile: median click-to-two-animation-frame visibility bound **58.1 ms desktop** (48.1–79.6), **38.8 ms mobile emulation** (33.6–61.8). These are browser observations, not device input-to-photon measurements or a latency SLA.
- One cold live View-event → ready RSVP action sample took **1,433 ms desktop / 990 ms mobile**. Selection itself does not wait for a fresh event-detail read or cover image.
- Selected approved icon remains emphasized with halo/title; selected overlay remains present when zoomed out into clusters. Region clusters expand on click/tap (11.5 → approximately 13.0 in the sampled interaction). Nine co-located events open the existing bounded chooser; selecting and Back-to-events work for pointer users.
- Eight rapid inputs per profile leave the last target selected; desktop exercised eight distinct markers, small-mobile two distinct markers due to the available uncovered area. No stale earlier preview replaced the final selection.
- Ordinary canvas Escape and Close dismiss selection and focus the canvas. Large View-event and close controls are touch friendly (48 px action height / 44 px close target).
- Actual free event navigation reaches the live RSVP quantity screen with quantity 1 and Continue available; no submission was made. Public event URLs and the dedicated tickets route work.
- Sold-out fixture clearly says sold out and disables purchase. Expired/unavailable detail says Event not found; temporary detail failure offers Try again. Selected short-expiry fixtures clear the preview and markers by the next observation, 92–276 ms after the fixture end time (includes observation/polling delay).
- Missing artwork already has a map-preview calendar fallback. The standard preview fits desktop/mobile and leaves its CTA visible. Mechanical event-page sweep at 320/390/1280 px found no horizontal overflow or broken live media; inspected screenshots confirm normal short-copy presentation.

## Actual findings, ranked

### 1. High impact — return loses the buyer's place

On both desktop and mobile: pan/zoom to 16.25 → select → View event → browser Back returns to the default center, zoom **14.6 desktop / 14.8 mobile**, with no selected event or preview. The event-page back control points to **/discover** even when the buyer came from /map. A buyer must find their event again.

Evidence: context-results.json; desktop/mobile-icons-preview.png versus desktop/mobile-panned-back.png. Map state is component-local; preview Link carries no return context; public event derives only the existing discovery return path.

**Recommend:** preserve a small validated navigation context (origin, camera, selected ID, chooser position/focus) through event/ticket/RSVP navigation and restore it on return. Reconcile restored selection against authoritative current inventory; do not restore cached event records or resurrect ineligible events. Preserve current public URLs and discovery return contracts.

### 2. High impact — keyboard event access and chooser focus break

From the standalone map, repeated Tab cycles canvas, zoom and attribution controls; there is no keyboard-accessible event choice. When an already-open co-located chooser is keyboard-activated, its selected button unmounts and focus becomes BODY. Escape then fails to close the preview, reproducible on both profiles. Back-to-events also leaves focus on BODY.

Evidence: live-results.json tabStops; context-results.json chooserSelectedFocus=BODY / escapeAfterChooser=1 / afterBackFocus=BODY. The existing Escape handler is scoped to the map container, which no longer receives the key from BODY.

**Recommend:** expose the existing bounded chooser through one accessible map control, and deliberately move/restore focus on open, selection, Back and Close. Keep existing chooser pagination; do not add DOM markers or a primary event feed.

### 3. High impact — primary action and ticket-route landing are inconsistent

A valid isolated **1,202-character** description places Get tickets at **y=939 on an 800px desktop viewport** and **y=1,281 on an 844px mobile viewport**. After clicking it, the dedicated ticket route repeats the description and retains the previous document scroll position. In the desktop run, the quantity control landed **89px above the viewport**. The mobile run opened in the middle of the repeated description. Short live free-event copy does not show this problem; the issue is conditional on longer content and navigation scroll.

Evidence: fixture-results.json; mobile-paid-top.png, desktop-paid-selection-top.png and mobile-paid-selection-top.png. EventPageView places its action after the full description; selection mode still renders the full description and does not set a deliberate landing/focus point.

**Recommend:** promote the existing primary ticket/RSVP action before long description text, and make /tickets land and focus on its current quantity controls with compact event context. Keep routes, current availability checks, cart validation and checkout/RSVP systems intact; avoid duplicate availability readers.

### 4. Medium impact — failed cover leaves a large broken image

The missing-image case (no cover) is clean. When the resolver supplies a cover that fails to load, the event page keeps an undecodable image/alt-text box; on mobile it occupies approximately **440px**, pushing the useful content and Get tickets down further (y≈1,724 in the long-copy fixture). Preview already has an error fallback, but EventPageView has no image-error fallback.

Evidence: mobile-broken-image-top.png; fixture-results.json brokenImages=1.

**Recommend:** fall back to the existing no-artwork event-page treatment on image error. Do not invent artwork, change approved map icons or alter flyer proportions.

### 5. Lower priority — long mobile preview titles displace useful facts

At 320×640, a valid long title occupies seven lines inside the preview's 202px scroll region; date/venue/admission require internal scrolling. View event remains visible and the content is reachable; there is no horizontal overflow. Bounding rectangles overlap the close-button area slightly, but inspected pixels do not show actual title/close text overlap, so that is not filed as a separate defect.

Evidence: small-mobile-long-preview.png and edge-results.json.

**Optional polish:** bound the visible title to a few lines while preserving its complete accessible name and the full event-page title. This is lower priority than restoring navigation and keyboard access.

## Smallest recommended implementation scope

Implement findings **1–4** as focused navigation, focus-management and existing presentation changes. Keep the long-title adjustment optional. Reuse the existing chooser, map selection reconciliation, preview styling, public queries and transaction controls. No Mapbox rendering/clustering/icon changes, backend/API/schema work, new libraries, new event caching, filter-semantic integration or Task 4 work.

After approval, regression coverage should reproduce map → event → tickets/RSVP → browser/UI return; expired restored selections; co-located chooser keyboard focus/Escape; rapid selection; long-copy CTA/route landing; missing/broken covers; unavailable/sold-out/network-error recovery. Recheck the existing map request/source/icon-budget protections and desktop/mobile rendering before using the existing staging workflow.

## Limits and untouched state

No physical phone, VoiceOver/NVDA, real paid inventory transaction or final RSVP confirmation was tested. Paid and adversarial cases are presentation fixtures, not proof of payment eligibility or server authorization changes. No source implementation edits, migrations, new environments or deployments were made. Only these audit documents and temporary read-only harness/evidence files were created. Task 4 has not started.
