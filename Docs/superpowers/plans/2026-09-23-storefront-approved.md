Approved to begin implementation of the Wheretoo Organizer Storefront plan from:

main
HEAD: dcb39e6c9f1a155782352ac1f79bd3617fff5472

Use a new isolated storefront worktree/branch.

Proceed using the approved process:

implementation
→ verification
→ fix/review
→ final proof

Do not deploy production.

Before implementation, apply these four corrections to the plan:

1. ORGANIZER LOGO / AVATAR

Follow the locked Organizer Storefront product spec.

Organizer logo/avatar is part of establishing the organizer identity.

Capture it during organizer onboarding/setup.

Do not turn onboarding into full storefront customization, but do not silently defer the required organizer identity image indefinitely.

Cover image, accent, social links, merch, featured-event selection, and attribution remain optional later polish.

2. SOCIAL LINKS

Reduce V1 supported social links to:

- Instagram
- TikTok
- Website
- X/Twitter
- YouTube

Optionally allow one bounded generic custom link if the existing implementation makes that simple.

Do not add Facebook, Spotify, or SoundCloud in this build unless separately approved.

Do not create an unlimited arbitrary-link system.

3. ATTRIBUTION

Keep attribution fully isolated as Phase 6.

Phases 1–5 must not depend on attribution being complete.

The proposed 30-day attribution lifetime and latest-valid-visit semantics are approved as implementation defaults for Phase 6, but attribution failure must never prevent a valid ticket purchase or RSVP.

Do not add promoter payouts, balances, or commissions.

4. SEO / SOCIAL METADATA

The narrow server HTML/social-preview handler is approved in principle.

Treat it as a late integration step.

It must not block completion of:

- public storefront
- organizer editor
- event aggregation
- paid ticket entry
- free RSVP entry
- merch
- share behavior

Do not redesign hosting architecture.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPLEMENTATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Preserve the accepted baseline and all unrelated user-owned work.

Do not integrate or overwrite:

- AI-cover work
- CSV export work
- product-polish work
- map worktrees
- recovery checkout
- older storefront/spec worktrees

Coordinate only where shared files or migration numbering actually overlap.

Do not rebuild:

- event truth
- event visibility
- ticket tiers
- inventory
- checkout
- Stripe handling
- payment confirmation
- fulfillment
- tickets
- refunds
- cancellation
- admission/check-in
- Free RSVP

The storefront is an aggregation and transaction-entry layer only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISUAL CONTRACT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the approved mobile organizer-storefront design direction.

Critical visual rule:

EVENT ARTWORK MUST PRESERVE FLYER PROPORTIONS.

Use the existing 4:5 flyer system with object-fit contain and a dark image mat.

Do not crop event flyers into:
- YouTube-thumbnail proportions
- landscape hero crops
- wide marketing images

Featured-event mobile layout should be approximately:

Featured Event

[ 4:5 flyer ] [ event information ]
                date
                location
                time
                price/state
                CTA

The layout should use the horizontal space efficiently so there is no large dead area beneath the event information.

On narrow phones, adapt cleanly while keeping the flyer visibly portrait.

Upcoming-event thumbnails should also preserve flyer artwork instead of aggressively cropping text.

Do not add:
- Follow
- follower counts
- attendee avatars
- attendee counts
- public analytics
- feed
- comments
- music player

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXECUTION ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Implement in this order.

PHASE 1 — STOREFRONT IDENTITY

Implement:

- organizer permanent handle
- normalization and validation
- reserved-route protection
- database uniqueness
- atomic claim
- confirmation timestamp
- V1 immutability
- draft storefront state
- organizer public identity fields
- organizer logo/avatar
- public storefront route skeleton
- onboarding handle confirmation

Required behavior:

- display-name changes never change handle
- confirmed handle cannot be self-edited
- duplicate race is resolved by database truth
- unpublished and nonexistent handles behave identically publicly

Run focused tests and inspect the diff before Phase 2.

PHASE 2 — EVENT AGGREGATION

Implement:

- coherent public storefront read
- featured-event preference
- automatic featured fallback
- upcoming events
- canonical event-state presentation
- portrait flyer rendering
- pagination / load-more if required

Reuse:

- event ownership
- publication eligibility
- paid ticket state
- free RSVP state
- event-image delivery

Do not create duplicated storefront event records.

Initial page target:

1 featured event
+
approximately 5 upcoming events

Featured event should be excluded from the ordinary upcoming list.

A sold-out event may remain visible with Sold Out and no misleading purchase CTA.

Ended/canceled/private/ineligible events must leave normal public merchandising.

Run database + frontend tests and inspect the diff before Phase 3.

PHASE 3 — FAST TRANSACTION ENTRY

Paid:

Storefront
→ /events/:eventId/tickets
→ existing ticket selection
→ existing checkout

Free:

Storefront
→ /events/:eventId/rsvp
→ existing RSVP system

Full event details remain available as secondary navigation.

Do not create direct storefront checkout.

Do not bypass ticket selection for multi-tier events.

Prove that storefront-initiated transactions produce the same durable:

- orders
- fulfillment
- tickets
- refund behavior
- admission behavior

as normal Wheretoo transactions.

Run focused paid and RSVP journey tests before Phase 4.

PHASE 4 — STOREFRONT EDITOR

Add:

/organizer/settings/storefront

and owner-only preview.

Editor supports:

- display name
- immutable handle display
- logo/avatar
- cover
- bio
- home city
- optional accent
- approved social links
- featured event
- publish/unpublish
- preview

Reuse existing:

- organizer settings patterns
- optimistic concurrency
- unsaved-change protection
- session protection
- image-upload safety

Preview must use the actual storefront presentation and canonical event data.

Do not create a second fake preview model.

Publish requires:

- confirmed handle
- organizer name
- logo/avatar
- at least one eligible public event

Optional fields must not block publication.

After a published storefront naturally runs out of upcoming events:

KEEP THE STOREFRONT PUBLISHED.

Show:

No upcoming events right now.

Do not automatically unpublish it.

PHASE 5 — MERCH + SHARE

Merch:

maximum 3 cards.

Each may contain:

- organizer-owned image
- title
- optional display-price text
- HTTP/HTTPS external URL

Optional Visit Store URL.

No:
- inventory
- variants
- merchandise checkout
- shipping
- taxes
- refunds
- Shopify API

Share:

Web Share API where available
→ clipboard fallback
→ selectable URL fallback

Never share preview/private state.

PHASE 6 — ATTRIBUTION

Only begin after Phases 1–5 pass their verification gates.

Implement:

- storefront visit
- optional ref label
- ticket CTA start
- RSVP CTA start
- durable RSVP association
- durable paid-order association
- attributed ticket gross

Use the existing payment/order and registration systems as transaction truth.

Attribution must remain telemetry/measurement.

It must never become transaction authority.

A failed or expired attribution context must degrade to an unattributed valid transaction.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERIFICATION AFTER EACH PHASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For every phase:

1. implement the smallest complete slice
2. run focused tests
3. inspect actual diff
4. run relevant integration tests
5. fix failures
6. re-run
7. record proof
8. only then move to the next phase

Do not batch all six phases and debug them at the end.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before claiming Organizer Storefront complete, run:

- typecheck
- lint
- frontend tests
- functions typecheck/tests
- isolated database integration tests
- build
- storefront E2E
- paid transaction regression
- Free RSVP regression
- refund/cancellation regression
- ticket/access regression
- QR/admission regression
- organizer operations regression
- discovery regression
- auth/session regression
- image/publication security tests
- migration replay
- git diff --check

Perform visual browser proof at:

- 320px
- 390px
- 430px
- tablet
- desktop
- 200% text zoom

Inspect screenshots manually.

Specifically verify portrait event flyers are not cropped into landscape artwork.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIX / REVIEW PASS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After implementation tests pass:

perform an independent review of:

- migrations
- RLS/grants
- public DTO
- handle immutability
- routing conflicts
- owner authorization
- event eligibility
- checkout/RSVP reuse
- image ownership
- URL validation
- public-data leakage
- attribution idempotency
- responsive UI
- existing-system regressions

Fix discovered issues.

Re-run affected proof.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL PROOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Do not call the feature complete merely because UI tests pass.

Final proof should demonstrate:

1. permanent handle claimed
2. handle cannot change
3. public storefront loads from the handle
4. organizer branding loads safely
5. featured event resolves correctly
6. automatic fallback works
7. upcoming events update automatically
8. vertical flyers render correctly
9. sold-out state behaves honestly
10. paid CTA enters existing ticket flow
11. successful paid transaction uses existing durable ticket truth
12. free CTA enters existing RSVP flow
13. successful RSVP uses existing ticket/admission truth
14. merch exits Wheretoo safely
15. publish/unpublish only affects storefront visibility
16. no private organizer information leaks
17. no parallel ticket/payment/RSVP logic exists
18. attribution uses completed transaction truth
19. mobile and desktop screenshots match the approved design direction
20. all required regressions are green

When finished, report:

- implementation branch/worktree
- exact final HEAD
- migrations added
- files added/modified
- tests run
- pass/fail counts
- database proof
- paid-flow proof
- RSVP proof
- responsive screenshot proof
- security review findings
- fixes made
- remaining hosted/provider steps
- any known limitations
- confirmation that no production deployment occurred

Do not commit, push, merge, or deploy unless separately instructed.

Begin Phase 1 now.