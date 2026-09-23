# WHERETO V1 USER FLOWS

## 1. Consumer: Discover an Event
1. Consumer opens Whereto.
2. Map opens on supported Bay Area geography.
3. Whereto loads published, active events relevant to the viewport/time window.
4. Consumer can change time/category filters.
5. Map updates without a full page reload.
6. Dense events cluster/simplify according to zoom.
7. Consumer taps an event object.
8. Event preview/selection appears.
9. Consumer opens the full event experience.
10. Consumer chooses RSVP, ticket purchase, or directions.

### Important States
- loading
- no events in current view
- location permission denied
- map/data error
- event cancelled
- event ended
- event sold out
- multiple events near the same point

## 2. Consumer: Free RSVP
1. Consumer opens event.
2. Selects RSVP.
3. Enters name + email.
4. System validates event capacity/status.
5. RSVP is created.
6. Consumer receives confirmation and secure QR credential.
7. Confirmation can be emailed.
8. Repeat submission should not create unintended duplicate registrations.

### Failure/Edge States
- event sold out/full
- registration closed
- invalid email/input
- already registered
- event cancelled
- server/network failure

## 3. Consumer: Buy Paid Ticket
1. Consumer opens paid event.
2. Selects ticket tier and quantity within V1 rules.
3. System confirms ticket availability and current price.
4. Consumer provides name + email.
5. Stripe checkout/payment experience opens.
6. Payment is processed by Stripe.
7. Whereto does not treat a client redirect alone as authoritative payment success.
8. Server/webhook processing confirms the successful payment.
9. Order/ticket is issued.
10. Consumer receives confirmation + QR credential.
11. Organizer order/attendee view updates.

### Failure/Edge States
- sold out during checkout
- payment declined
- payment processing
- payment failed
- webhook delayed/retried
- duplicate webhook
- duplicate purchase attempt
- event cancelled
- refunded/cancelled ticket

## 4. Consumer: Ticket/RSVP Confirmation
Confirmation should show:
- event
- date/time
- location
- ticket/RSVP type
- QR credential
- directions
- status

The experience must distinguish valid, cancelled, refunded, used/checked-in, and expired/ended states.

## 5. Organizer: Create Account
1. Organizer signs up/logs in.
2. Organizer creates/establishes organizer identity/profile.
3. If paid events/payouts are needed, organizer starts Stripe Connect onboarding.
4. Incomplete verification remains visible and actionable.
5. Organizer can proceed with allowed non-payment setup while payment capabilities follow Stripe status.

## 6. Organizer: Create Event
1. Organizer selects Create Event.
2. Enters required basics:
   - title
   - description
   - exact location/address
   - start time
   - end time
   - category
3. Chooses free RSVP or paid.
4. If paid, configures up to 3 ticket tiers.
5. Adds/uploads artwork or uses AI event cover workflow.
6. Chooses an available map animation/marker preset.
7. Saves draft or previews.
8. Publishes.
9. Published event becomes eligible for consumer-map discovery.

### Validation
- required fields present
- supported geography
- valid start/end times
- valid capacity/tier configuration
- paid-event organizer payment capability as required
- moderation/safety checks

## 7. Organizer: AI Event Cover
1. Organizer chooses Generate with AI alongside the existing cover upload.
2. Save the current draft/revision and use existing event information.
3. Organizer chooses a lightweight creative preference and optional short direction.
4. Generate three private 4:5 cover options with independently persisted states.
5. Organizer chooses one; only explicit successful selection replaces the canonical cover.
6. Organizer may regenerate or replace the cover with an upload.

Refresh/reopening restores the generation and candidates. Partial failures preserve successful options. Generation does not lock other event editing or overwrite a newer cover. AI Flyer Generator, reference images, typography editing and exports are deferred to V3/V4.

## 8. Organizer: Preview and Publish
1. Organizer previews event experience/map representation.
2. Organizer confirms.
3. Safety/content validation runs.
4. Event publishes.
5. Event receives published status and appears according to discovery/time rules.

Publishing must be idempotent enough to avoid duplicate event creation from retries.

## 9. Organizer: Edit Published Event
1. Organizer opens owned event.
2. Edits allowed fields.
3. Validations run.
4. Changes persist.
5. Consumer experience/map reflects current data.

Material changes affecting attendees should be surfaced appropriately. Exact notification policy can evolve.

## 10. Organizer: Cancel Event
1. Organizer selects cancel.
2. Confirmation step explains impact.
3. Event becomes cancelled.
4. Event is removed/clearly excluded from active discovery.
5. Existing registrations/orders reflect cancelled state.
6. Paid-order refund behavior follows the approved payment/refund implementation.
7. QR credentials for cancelled/refunded admissions cannot check in.

## 11. Organizer: Orders and Attendees
Organizer can view:
- attendee/customer identity required for operation
- RSVP/ticket type
- order/payment state where applicable
- check-in state

Avoid exposing unnecessary payment-sensitive information.

## 12. Organizer: Check In Attendee
1. Organizer opens check-in mode.
2. Scans QR or uses supported lookup fallback.
3. Server validates credential.
4. Server checks event ownership/access.
5. Server checks ticket/RSVP validity.
6. Check-in is recorded atomically.
7. Success state displays.

### Rejection States
- invalid token
- wrong event
- already checked in
- cancelled
- refunded
- expired/not valid
- network/server error

## 13. Organizer: Analytics
Organizer opens event analytics and sees a small set of reliable V1 metrics derived from actual registrations/orders/check-ins.

No speculative metrics should be presented as real.

## 14. Organizer: Payout State
Organizer can understand:
- whether Stripe onboarding is complete
- whether payments are enabled
- pending/available/paid status as supported
- verification/action-required states

Do not imply Whereto directly controls a payout action unless the implemented Stripe configuration actually supports it.

## 15. Map Time State
For each published event:
- upcoming: visible according to 7-day rules
- starting soon: may receive stronger treatment
- happening now: visually active/prominent
- ended: removed from active consumer discovery
- cancelled: removed from active discovery and represented correctly in direct/event-order contexts

## 16. Map Zoom State
Target behavior:
- far/city-wide: clusters or simplified activity
- neighborhood: individual/simplified event objects emerge
- closer: richer event objects/approved animation
- selected: selected event dominates interaction
- event page: transaction/detail experience

Ambient cars/pedestrians are decorative world-life, not event records, and must never imply false real-world people/traffic data.
