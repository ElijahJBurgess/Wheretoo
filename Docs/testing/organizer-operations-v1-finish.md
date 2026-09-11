# Organizer Operations V1 — product finish pass

Date: 2026-09-10. Branch: `codex/organizer-operations-v1`. This pass continues `8a889fa`; it does not replace the existing backend. The attached `Organizer Journey.png` is the visual authority. The historical metric matrix and founder decisions remain locked in the design spec. No production deployment, push, or merge occurred.

## Completed screens and connections

- **My Events:** dark compact artwork rows, lifecycle pills, date/location, canonical historical sold/gross, Create event, and paid-event dashboard entry. Free-event editing remains unchanged.
- **Dashboard:** photographic artwork when a supported stored URL exists, upright serif title, event context, Check in/View/Edit, exactly four canonical historical metrics, and canonical tier breakdown.
- **Orders:** obvious event context, buyer name/email, individual order reference, quantity and newly visible tier summary, amount/status, three-field search and bounded pagination. Retained rows explicitly say when results are updating.
- **Order Details:** compact buyer/purchase summary, purchased tiers, every issued ticket, authoritative used time, confirmed manual admission, and whole-order refund. Pending/unknown refund does not become Refunded until the canonical read confirms it. No resend action.
- **Check-In:** artwork/name/count, large purple corner frame, Scan guest ticket, Find guest, existing sound control and camera recovery.
- **Admission results:** ADMITTED, ALREADY SCANNED, TICKET REFUNDED, TICKET CANCELLED, plus explicit invalid/wrong-event/network failure. Identity, tier and authoritative time come from the existing response. Success is green, duplicate amber, invalidated tickets red; next scan remains prominent.
- **Historical access:** ended/cancelled dashboard, orders and ticket history remain readable. When cancellation closes the scanner after a request, its canonical result remains visible and owner/event scoped; scanning controls disappear and the owner can return to the dashboard. A change of owner cannot retain the previous buyer's result.

## Visual comparison and intentional differences

Local render and fix-closure status: verified for all nine requested screen types and additional scanner errors. Delivery status: not applicable; no hosted deployment. Production build served on loopback port 3012, reduced motion, at **1440×1000, 768×1024, 390×844 and 320×800**. Screenshots of all major states were inspected individually and in contact sheets; overflow assertions supplement that inspection.

The reference uses a narrow dark sidebar, compact outlined surfaces, purple primary pills, a photographic hero above four metrics, serif event titles, and centered phone admission results. The finish follows these relationships. The desktop sidebar is 196px; content is bounded rather than stretched across wide displays. The scanner is bounded to 460px on desktop, with a frame up to 248px and larger text/action targets on mobile. Green/amber/red icons and labels convey results without relying on color alone.

Intentional differences:

- Real long order references wrap, and all individually issued tickets remain visible. Detail pages can scroll farther than the two-ticket mockup; IDs are not shortened into ambiguous fake references.
- Mobile management uses wrapping navigation/actions and a two-by-two metric grid. Accessible controls and actual content take precedence over shrinking the reference's desktop screenshot.
- No global Orders entry before an event is selected; orders remain event-specific. No resend button. No invented event/customer/sales values.
- A closed event returns to its dashboard rather than offering another scan. Existing sound and camera-recovery controls remain available where applicable.
- Existing supported HTTPS event artwork is displayed; absent, failed or unsupported storage paths use a neutral fallback. No upload/storage infrastructure was invented. The image security policy now permits Supabase images, consistent with the existing backend host allowlist; scripts and other directives were not broadened.
- The rooftop photograph used in the visual proof is **generated synthetic test artwork**, optional through `WHERETO_OPERATIONS_ARTWORK_PROOF`. It is stored only in ignored local test results and seeded only into the guarded disposable fixture. It is not production/default event artwork. The physical camera stream is synthetic, not a photograph of a real device.

The visual pass found and closed: missing order tier summaries, overly loose ticket spacing, incorrect result labels/hierarchy, missing neutral artwork fallback, artwork blocked by CSP, and a cancellation result disappearing when refreshed event eligibility closed admission. Browser captures now wait for populated artwork to load. No unresolved overlap or horizontal overflow was observed at the required widths.

## Verification

| Check | Observed result |
| --- | --- |
| Typecheck (app, integration, E2E, scripts) | Passed |
| Lint | Passed |
| Full frontend suite | **924 passed, 1 failed**, 92 files; the failure is the preserved camera-factory baseline |
| Edge tests | 228 passed |
| Edge source/test typecheck | Passed |
| Relevant SQL | 188 assertions passed, 7 suites: organizer metrics/reads/manual admission/refund context, Checkout Integrity refunds, Lite lifecycle/redemption |
| CSP regression | RED: missing Supabase image host; GREEN: 2 tests passed |
| Production build | Passed in the final browser harness |
| Production fixture exclusion | `ticket-shell-production=passed` |
| Connected browser journeys | 2 passed: owner management/customer resolution/history/isolation; actual QR decoder → admission handler → local SQL with every result state |
| Repeated final QR proof | 3 complete journeys passed in 49.7 seconds with independent reseeding |
| Independent diff review | No actionable production regression found |

RED → GREEN evidence also covers tier summary, result wording, artwork error handling and preserving a cancellation result after closure. No scanner factory assertion or behavior was changed to silence the baseline. The full-suite failure is `src/features/ticket-experience/runtime/production.test.tsx:33`: expected one factory invocation, received two. It remains open.

The initial synthetic fixture exposed idle canvas frames and decoding failures at a fixed, perfectly aligned QR pose (also reproduced outside the browser). The final fixture uses the existing buyer `qrcode.react` encoder/Q error correction, continuous frames and small handheld-style pose changes at an 83 ms cadence, avoiding alignment with the decoder’s 500 ms retry interval. It still requires the real decoder to return the exact credential and preserves every result assertion. Production camera/decoder behavior is unchanged. Physical-device capture remains an explicit release check; this does not claim reliable decoding at every possible fixed pose.

The QR proof replaces only the physical camera with a canvas MediaStream and hosted authentication with synthetic token verification. It uses the real ZXing decoder, frontend transport, production Edge handler (including hash/input/response handling), and existing atomic SQL redemption. The management proof covers manual admission, duplicate rejection and a two-session QR/manual race. It also confirms buyer search, keyboard confirmation cancellation/focus restoration, other-owner denial, direct-table denial, ended admission rejection, and unchanged historical metrics after refund. Only blank-camera ready frames and result states are captured; QR credentials are not recorded. Traces/video are disabled.

Refund requests in the browser proof receive a stubbed pending acknowledgment; canonical completion uses the existing receipt/refund writer with synthetic provider evidence. **Actual Stripe execution and signed webhook delivery were not run.** Edge tests cover the production adapter. This is verified local product behavior, not a claim of physical-device or provider release certification.

Logs: `/tmp/ops-finish-unit.log`, `/tmp/ops-finish-types.log`, `/tmp/ops-finish-lint.log`, `/tmp/ops-finish-edge.log`, `/tmp/ops-finish-edge-types.log`, `/tmp/ops-finish-sql.log`, `/tmp/ops-artwork-csp-red.log`, `/tmp/ops-artwork-csp-green.log`, `/tmp/ops-finish-browser.log`, `/tmp/ops-finish-boundary.log`, `/tmp/ops-qr-stability.log`. Screenshots: ignored `test-results/organizer-operations/`; contact sheets: `test-results/audit/`. Only synthetic identities and data were used.

## Files, migrations and remaining setup

Production files changed in this finish: `index.html`; `src/features/events/OrganizerEventsPage.tsx`; `src/features/organizer-operations/{EventArtwork,OperationalScanner,OperationsUi,OrganizerOrdersPage,OrganizerOrderDetailPage,RefundOrderDialog}.tsx`; `organizer-operations.css`; and `src/features/ticket-experience/scanner/OrganizerScannerView.tsx`. Associated component tests and only the organizer-events preview row changed. No buyer/map implementation was changed.

Proof files: `playwright.organizer-operations.config.ts`, `tests/e2e/organizer-operations.spec.ts`, `tests/e2e/organizer-qr.spec.ts`, `tests/e2e/support/organizerQrFixture.sql`, `tests/e2e/support/organizerArtwork.ts`, `tests/integration/edge/organizer-local-admission/index.ts`, and `tests/integration/cspContract.test.ts`. The local proof server is not deployed or bundled with production.

**No new migrations or backend contracts in this finish.** The six previously verified migrations and nonproduction function setup remain documented in [the implementation report](organizer-operations-v1-verification.md). No new dependencies, email infrastructure, refund engine, admission algorithm, or free RSVP operations.

Remaining release checks: physical-device camera permission/capture/teardown; the preserved camera-factory baseline; authorized Stripe test refund and signed webhook/recovery proof. These require the existing nonproduction setup described in the implementation report. No new founder product/contract blocker was found.

Reproduction: use only the fully migrated disposable loopback database and synthetic PostgREST setup from the original report. Reset/reseed the management fixture before the two-test run; the QR test resets its guarded fixture itself. Optionally provide an existing local image file via `WHERETO_OPERATIONS_ARTWORK_PROOF`. Run `pnpm exec playwright test --config playwright.organizer-operations.config.ts`. Never run these fixture resets against shared or hosted data.
