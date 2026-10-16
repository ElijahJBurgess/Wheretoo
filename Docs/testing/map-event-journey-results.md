# Task 3 — implementation verification

Baseline: origin/main `5ddfb1a` (PR #20). Scope: the four user-approved audit recommendations. No migration, API/eligibility, payment/fulfillment, filter semantics, event cache, clustering or icon artwork changes. No new dependencies.

## Changes

- Existing React Router/browser history carries a bounded public camera, selected ID, chooser IDs/paging/scroll and canonical Discovery context. It stores no event records. Restored selection is reconciled with fresh successful inventory and authoritative end times; failures do not authorize cached selections. Current map camera is sampled synchronously when leaving, with separate debounced history bookkeeping while exploring. Existing Mapbox creation effect remains container-only.
- One keyboard-accessible Events in view control opens the existing bounded chooser. Preview/chooser focus, selected-row focus on Back, Close/Escape and map/trigger restoration are covered. If inventory removes every choice and disables the trigger, focus falls back to the canvas.
- Existing ticket/RSVP entry precedes long descriptions. Ticket selection omits repeated description and lands/focuses the quantity control without waiting for images. Valid existing cart quantities and public return hints carry through event, tickets, checkout edit/return and RSVP return links. Transaction logic remains unchanged.
- Failed covers use the existing no-artwork hero. A new artwork URL can load after an earlier URL failed. No-artwork responsive layouts remain unchanged.

## Before/after observations

| Observation | Before | After |
| --- | --- | --- |
| Back after zoomed selection | 16.25 resets to 14.6 desktop / 14.8 mobile, selection lost | 16.25, center, pitch 40 and bearing 12 restored; eligible selection restored |
| Map entry UI return | `/discover` | Original `/map` or canonical filtered `/discover` |
| Chooser keyboard entry/focus | No keyboard entry; selection/Back could focus BODY; chooser Escape ineffective | Trigger → chooser → preview → selected row; Escape/Close → trigger or canvas |
| Long-copy Get tickets top, desktop | y=939 (800px viewport) | y=408.5 |
| Long-copy Get tickets top, mobile | y=1,281 (844px viewport) | y=398.4 |
| Ticket quantity landing | Desktop quantity y=-89; mobile in repeated description | Desktop y=227.3, mobile y=473.4, focused and visible |
| Failed mobile cover | Approximately 440px broken image box | No broken image/box; normal no-artwork layout |
| Preview visibility bound median | 58.1ms desktop / 38.8ms mobile | 59.0ms desktop / 45.0ms mobile |

Timing is observational, not an improvement claim: five desktop and six mobile implementation samples. The first desktop cold sample reached 151.9ms with DOM already present at 46.5ms; the other four bounds were 53.6–69.8ms. Investigation repeated the same harness against unchanged staging: its cold sample reached 138.1ms and medians were 95.1ms desktop / 47.9ms mobile. This supports cold renderer/frame scheduling variability rather than a sustained selection regression. Small sample sizes, native Chrome update, dev/hosted builds and network variance limit comparison. Live View event→ready RSVP single samples varied from 578–1,433ms across runs; no server latency improvement is claimed. Exact series and method: map-event-journey-measurements.json.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed. Existing large-chunk build warning remains.
- Full application suite: **258 files / 2,081 tests passed**. Final focused map, navigation, event, tickets, RSVP, checkout and Discovery run after the focus fallback: **33 files / 236 tests passed**.
- New desktop/mobile browser cases cover camera/selection/browser history, quantity continuity, keyboard focus/Back/Escape, expired/removed selection, free RSVP entry/UI return, broken covers, sold-out/unavailable state and canonical Discovery filters/document scroll. All ten cases passed across the verification run and an unchanged isolated rerun. One native Chromium session closed before rendering; isolated desktop RSVP rerun passed in 7.9s. Earlier test-fixture omissions and screenshot capture stalls were diagnosed separately from product assertions.
- Existing map/loading hardware browser suite: **8/8 passed**, desktop/mobile, including all nine approved assets, mobile eight-image budget/selected fallback priority, cluster expansion, one canvas through interaction, retained markers during errors/retry, empty/partial feedback, A→B→A cache reuse and rapid camera coalescing.
- Responsive mechanical sweep: 1280×800, 390×844, 320×640, zero horizontal overflow and no mechanical issues. Screenshots inspected; controls remain separate and usable. Browser fixture and live journey screenshots also inspected.
- Independent whole-branch review, plus the final focus fallback review: no important findings.
- Red/green guards proved navigation-state validation, fresh selection restoration, chooser focus, camera applied once, event action order, image fallback, quantity continuity and checkout return-state propagation.

## Boundaries and delivery

All browser fixtures are response interceptions only; no test data was inserted or changed remotely. No purchase/RSVP was submitted. Physical iOS/Android and assistive-technology speech are not verified; mobile is Chromium touch emulation. The existing long-title internal preview scrolling remains deliberately unchanged. No Task 4 work.

The branch disables its own Vercel deployment; only the existing GitHub main→wheretoo-staging integration is authorized. Hosted deployment identity and smoke results are reported after merge. Public production and database state are outside this change.

Evidence (local, not committed): `/tmp/wheretoo-task3-implementation/`; original audit: `/tmp/wheretoo-task3-audit/`. Source areas changed: map core/navigation/preview and presentation; public event/ticket, Discovery/RSVP/checkout navigation; regression tests, public-event markup fixture and Vercel branch-deployment suppression.
