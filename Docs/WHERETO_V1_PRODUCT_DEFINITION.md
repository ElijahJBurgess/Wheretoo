# WHERETO V1 PRODUCT DEFINITION

## 1. Product
Whereto is a Bay Area-first web platform for discovering public things happening in the city and for organizers to create, promote, ticket, and operate those events.

The core consumer experience is a living city map:
Open Whereto -> see what is happening -> tap an event -> view event details -> RSVP or buy -> receive confirmation/QR -> get directions.

The core organizer experience is:
Create organizer account -> create event -> publish -> accept RSVPs/ticket sales -> operate check-in -> view basic results/payout state.

## 2. V1 Product Principle
If it does not help someone find somewhere to go, help an organizer put something on, or complete the transaction, it is not V1.

## 3. V1 Goals
1. Prove organizers can successfully run a public event through Whereto.
2. Prove consumers will use a map-first interface to discover events.
3. Prove Whereto can complete free RSVP and paid-ticket transactions reliably.
4. Prove the "living city" visual concept with a small set of real animations.
5. Launch a usable Bay Area product quickly and learn from real people.

The V1 decision marker is real-world usage after approximately 7 days of building, not a 30-day polish cycle.

## 4. Geography
V1 is Bay Area only, with initial focus on San Francisco and Oakland.

## 5. Consumer Discovery
### Required
- Web-first responsive experience.
- Map is the primary discovery interface.
- No required account to browse.
- Public events only.
- Events require a real location, start time, and end time.
- Consumers can browse events happening now and within the next 7 days.
- Time/category filters.
- Event tap opens the event experience.
- Finished events disappear from active consumer discovery.

### Not V1
- Event feed as a primary discovery surface.
- Search.
- Messaging.
- Private events.
- Route-based events/animations.
- Complex social graph.
- Saved places/favorites as a core requirement.
- Consumer profile/payment-management system unless required by implementation.

## 6. Living Map
Events should not feel like dead generic pins. The map should feel like a living miniature city.

### V1 Map
- Real Mapbox geography with custom Whereto styling.
- Published events loaded from real backend data.
- Point-based event locations only.
- Clustering/zoom behavior.
- Simple Whereto markers for generic events.
- 2-3 polished animated event concepts as proof of the system.
- "Happening now" and "starting soon" can receive stronger visual treatment.
- Prototype-level ambient city life may include simple cars and pedestrians if performance and schedule permit.
- Event animations remain visually distinct from ambient city life.

### North Star, Not Required for V1
- 10+ polished event animation presets.
- Rich ambient cars and pedestrians.
- Strong miniature-city depth and environmental motion.
- Neighborhood personality/day-night behavior.
- Route/path animation.
- More sophisticated custom rendering.

## 7. Event Animation Model
Every V1 event is anchored to one point (latitude/longitude). No routes.

Examples of future/preset language:
- runners
- ribbon cutting
- celebration/fireworks
- music/crowd
- food/drink
- flags
- generic Whereto marker

Organizers choose from the available Whereto-created presets. They do not upload arbitrary executable animation code.

## 8. Event Experience
An event page/detail experience should support:
- event artwork/flyer
- title
- organizer
- date/time
- location
- description
- ticket tiers or free RSVP
- directions
- transaction CTA
- status such as upcoming, happening now, sold out, cancelled, ended

Organizer artwork appears after selecting an event; the map itself should not become a wall of flyer thumbnails.

## 9. Consumer Identity
V1 minimizes account friction.

### Free RSVP
Required consumer information:
- name
- email

### Paid Ticket
Required consumer information:
- name
- email
- payment information through Stripe

Account creation must not block basic discovery or purchase/RSVP.

## 10. Organizer
"Organizer" is the umbrella term and can include venues, promoters, restaurants, run clubs, museums, community groups, festivals, businesses, and event creators.

### V1 Organizer Capabilities
- signup/login
- Stripe Connect onboarding for paid events/payouts
- create event
- save draft
- exact address/location
- start/end time
- free or paid event
- up to 3 ticket tiers
- choose available map animation
- upload event artwork
- use AI flyer generation
- preview
- publish
- edit published event
- cancel event
- see attendees/orders
- operate QR check-in
- see basic analytics
- see payout/payment status

### Ownership
- One organizer per event.
- No event transfer in V1.

## 11. Publishing and Safety
Events may be previewed before publishing.

Publishing should include strong safeguards against prohibited/hateful/abusive event content and other disallowed content. Moderation implementation should remain adaptable rather than encoding a narrow list of examples as the complete policy.

Organizers may edit published events. Cancellation must propagate clearly to consumer/ticket state.

## 12. Ticketing
Whereto owns the V1 transaction rather than sending consumers to external ticketing providers.

### Paid Events
- Stripe-based checkout.
- Stripe Connect for organizer payment infrastructure.
- Up to 3 ticket tiers.
- Whereto business model: percentage + fixed fee per paid transaction; exact pricing remains to be decided.
- Weekly payout intent, subject to Stripe/payment-risk constraints and final implementation.
- QR ticket/confirmation after successful payment.

### Free Events
- RSVP through Whereto.
- Confirmation/QR after successful RSVP.

Subscriptions are V1.5, not V1.

## 13. QR and Check-In
- Each valid RSVP/ticket receives a secure QR/token.
- Organizer can scan/check in attendee.
- Duplicate check-in must be prevented.
- Invalid, cancelled, or refunded credentials must not be accepted.
- Check-in state is persisted.

## 14. AI Flyers
AI flyer generation is a V1 differentiator.

Current product direction:
- organizer may provide up to 3 reference images
- system can generate multiple creative options (target: 3)
- AI generates visual creative/artwork
- Whereto controls exact event typography/text where practical
- organizer can use generated artwork or upload their own
- no full in-app design editor

Exact token/pricing mechanics are intentionally not hard-locked for V1. Subscription monetization is V1.5.

## 15. Organizer Analytics
Keep V1 analytics simple and based on real captured events. Examples:
- RSVPs/tickets sold
- revenue/gross sales where applicable
- check-ins
- conversion/traffic metrics where reliably captured
- payout/payment state

Do not overbuild analytics before usage exists.

## 16. Visual References
Approved concept images are design targets, not literal feature specifications. A visible element in concept art is not automatically V1.

Before implementation, visual references should be classified as:
- BUILD: required V1 behavior
- REFERENCE: visual/style inspiration
- IGNORE FOR V1: concepts that conflict with scope or belong later

## 17. Explicit V1 Exclusions
- route/path-based event animations
- consumer messaging
- private events
- primary feed experience
- event search
- organizer-to-organizer event transfer
- subscriptions
- full social network
- full design editor
- external ticketing integrations
- advanced enterprise analytics
- unnecessary consumer account complexity

## 18. Success Definition
V1 succeeds when a real organizer can create and publish an event, a real consumer can discover it, complete a free RSVP or paid purchase, receive a valid QR credential, and be successfully checked in — while the map already demonstrates the beginning of Whereto's living-city identity.
