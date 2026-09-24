# Email Attendees V1 — visual proof contract

Status: VERIFIED for the scoped local production build; no hosted delivery claimed.

Artifact: protected organizer composer and dashboard/order/registration entry actions.
Actor/job: authenticated event owner chooses existing active audience, reviews authoritative count/content and confirms durable queue; reconcile unknown result without duplicate sends.
Canonical local target: production Vite build at `http://127.0.0.1:3077/organizer/events/<fixture-event>/email-attendees`; actual CSP retained. Paid/free owners and identifiers generated in ignored `.superpowers/email-proof/browser.json`, real dedicated local Supabase API61321 plus local facade61330. Hosted deployment is not claimed.
Reference: approved Email Attendees specification/founder approval and existing organizer operations layout/tokens; no unrelated redesign.
States: paid/free Everyone, tier, order/registration individual, preview/count/confirmation, queued, zero, windowclosed, limits, drift, unknown/reconciliation, logout/accountchange, storagefailure.
Viewports:390×844 and1440×1000. Keyboard/focus and horizontal overflow checks accompany screenshots.
Profiles: core visual, responsive, state/journey.
Authority: user-approved Build+Prove permits feature fixes and fixture-safe local interactions. No real email, hosted mutation or deployment.
Pass: working accessible organizer flow, inert legible preview, truthful queue language, visible failure/recovery states, no clipping/overflow, no sensitive content retained across identity changes. Screenshots must be opened and inspected; passing DOM checks alone do not constitute visual proof.

## Inspected evidence

Controller opened all10 screenshot files using image inspection: `free-mobile-composer`, `paid-desktop-composer`, `free-mobile-preview`, `paid-desktop-preview`, `zero-mobile`, `limit-error-mobile`, `unresolved-reload-mobile`, `free-individual-queued`, `paid-tier-queued`, and `lost-response-reconciled` under `.superpowers/email-proof/screens`.

No blocking visual defect found. Composer fields/button labels are legible; mobile header wraps cleanly; long From/support metadata wraps inside the card; email hierarchy, literal escaped script text and message line breaks survive the inert preview; zero audience has no send action; limit error preserves draft text; unresolved reload has focused status and only reconciliation; queued receipts say queued and distinguish it from delivery. No clipping/overlap/horizontal overflow was observed. Normal vertical scrolling is used for longer previews.

Nine browser journeys passed across the full initial seven and targeted actual-sign-out/delayed-preview checks. Browser journey evidence is recorded in the main proof report. Production CSP was retained, no active anchors/inline styles/scripts rendered within preview, and keyboard focus moves to preview/status. The preview preserves server content/hierarchy with application CSS; it does not promise pixel-identical rendering across email clients. Real mailbox rendering, actual provider acceptance and hosted performance are outside this disabled local Build+Prove scope.
