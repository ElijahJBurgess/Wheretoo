# Spec08 visual and browser verification contract

Target: production build served only at http://127.0.0.1:3018 in the Spec08 isolated worktree. Browser fixture requests are intercepted for the synthetic spec08-disabled Supabase origin and the Stripe hosted navigation URL. No real provider or shared database traffic. Actor: anonymous buyer resolving availability/payment while retaining the same order identity. Authorization: Spec08 source implementation, isolated local preview and synthetic transactional tests; no deploy/provider operation.

Reference: user-supplied R06 board in Wheretoo_Spec_08_Sold_Out_Payment_Recovery.pdf page9. Profiles: state/journey, responsive, reference adaptation. Viewports:390×844 and320/768/1440×900, reduced-motion checks. Browser and screenshot evidence is fixture evidence, not actual Stripe TEST.

Reference inventory measured from 1491×1055 board:

- Recovery phone content is a centered single column, roughly 194px wide inside 214px outer phone. Existing BuyerJourney uses centered max-width440px rather than stretching at desktop: matched container relationship.
- Wordmark is centered at top. Status symbol sits about 55–75px beneath the screen top, heading immediately below, then explanatory copy. Body margins roughly8–12px within194px (4–6%): port to18–20px within390px.
- Serif recovery headings about18–22px over8–10px body at board scale (roughly2:1). Preserve existing serif display and sans body; adapt long truthful headings with natural wrapping.
- Failure red, processing purple, cancellation gray, paid green, unknown amber. Preserve status words alongside colors; no color-only meaning.
- Primary actions are full-width purple pill buttons; secondary actions outlined. Disabled availability actions gray. No extra promotional sections.
- Stock failure shows selected lines above its action; preserve full quantities. Availability shows real event facts and tier rows. Event artwork is shown only when supplied by the real projection; fixtures use null artwork, no stock-image substitute.
- Deliberate functional adaptations approved by user: generic unavailable instead of invented sales-closed reason; decline remains hosted; omit card/last-four/bank reasons; use actual integer totals; omit invented fees and fake bank-processing stages; unknown has same-order checking without a new-purchase button. Paid preserves original ticket collection, calendar and separate Spec07 email notice. RSVP uses the unchanged Spec06 presentation/contract.

Initial inspected captures exposed stock summary omission and uncolored unknown/cancel marks. These were corrected, and the final same-state screenshots were inspected. Cancellation links now use the existing primary button styling. No base BuyerJourney CSS or RSVP/email stylesheet is replaced.

Final status: verified locally. All 23 production-build browser journeys pass. All 45 PNG captures were inspected (contact sheets plus native narrow/detail views), covering 320/390/768/1440 widths. No observed clipping, overlap or horizontal overflow; keyboard status retry, live announcements and reduced-motion behavior are covered. The original ticket opens after uncertain payment resolves paid, and the same QR survives reload. Existing Spec06 free-hero spacing is preserved.

The ten-state inventory is satisfied through the documented Sales Closed and hosted-decline adaptations. No local decline screen claims actual Stripe behavior. Evidence remains fixture/browser evidence, separate from real local database proofs and skipped actual Stripe TEST. Production screenshots use the final build. Detailed commands/results and limitations are in `spec08-verification.md`.

Representative local captures in `.superpowers/spec08/screenshots/`: `sold-out-390.png`, `tickets-unavailable-390.png`, `stock-race-390.png`, `rsvp-full-390.png`, `rsvp-quantity-shortage-390.png`, `payment-failed-verified-390.png`, `processing-390.png`, `cancelled-390.png`, `paid-delivery-failure-390.png`, `unable-confirm-320.png`, `original-ticket-after-uncertainty-390.png`.
