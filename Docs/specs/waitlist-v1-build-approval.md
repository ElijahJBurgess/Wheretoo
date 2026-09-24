Waitlist V1 inspection/spec is approved.

Proceed to IMPLEMENTATION PLANNING + BUILD + PROVE.

Governing document:

Docs/specs/waitlist-v1-inspect-spec.md

If the inspection report currently exists under another path/name, first copy/preserve the approved report at that repository path without altering its substance.

Target CURRENT integrated main.

Inspected baseline was:

dd33333c4f9f17079559be62ffa1ad2762b4061b

Do not assume it is still current.

Before changing code:

1. fetch origin/main
2. record remote main HEAD
3. inspect worktrees/branches/status
4. preserve unrelated user-owned files
5. create an isolated feature worktree/branch:
   `codex/waitlist-v1`
6. if main advanced, inspect the delta and reconcile the approved design safely
7. do not reset or overwrite recovery/staging work

# Founder approval

The Waitlist V1 specification is APPROVED.

No further founder decision is required for ordinary implementation choices described in the spec.

The polling limitation is explicitly accepted:

Waitlist V1 guarantees OBSERVED sold-out → available cycles.

It does NOT guarantee capture of an inventory transition that opens and closes completely between observer runs.

Do not expand scope into writer-side inventory events merely to eliminate this limitation.

# Mandatory planning step

Before production implementation, write:

Docs/superpowers/plans/2026-09-23-waitlist-v1.md

The plan must implement the approved specification task-by-task.

Use test-first execution where practical.

The plan must explicitly preserve:

- Checkout Integrity
- reservation truth
- payment fulfillment
- refund truth
- ticket issuance
- Email Attendees
- ticket email/recovery
- CSV Export
- Duplicate Event

Self-review the plan for:

- spec coverage
- missing failure modes
- lock-order correctness
- migration ordering
- exact interface/type consistency
- no placeholders/TODOs

Then proceed with implementation using the reviewed plan.

Do not pause again unless implementation exposes a genuine contradiction or architecture expansion.

# Core product behavior

Waitlist V1 is:

- paid events only
- ticket-tier specific
- automatically available on sold-out active tiers
- accountless
- Name + Email only
- one active enrollment per normalized email + tier
- notify-all when inventory is OBSERVED reopening
- first come, first served through NORMAL checkout
- buyer remains enrolled until qualifying purchase/removal/closure
- organizer can view demand
- secure Leave Waitlist
- no ticket reservation from Waitlist

Waitlist NEVER owns inventory.

Checkout Integrity remains the sole reservation authority.

# Critical invariant

Joining the waitlist:

RESERVES ZERO TICKETS.

Receiving a restock email:

RESERVES ZERO TICKETS.

Opening the email:

RESERVES ZERO TICKETS.

Only existing checkout reservation can reserve inventory.

Do not create:

- waitlist holds
- hidden inventory
- exclusive inventory
- timed offers
- queue positions
- auto-checkout
- priority order

# Task 1 — inventory equivalence first

Before building Waitlist lifecycle behavior, implement and prove the approved shared read-only inventory helper.

Extract the current protected-inventory calculation into the proposed narrow helper, adapted to the exact current-main schema.

It must preserve:

quantity_total > protected_quantity
→ available

otherwise
→ sold_out

Protected inventory must remain equivalent to current authoritative semantics, including:

- paid
- payment_processing
- requires_review
- partially_refunded
- live creating_checkout reservations
- live checkout_open reservations
- expired reservations excluded
- refunded/cancelled/failed/expired orders excluded according to current truth

Do NOT derive inventory from:

- ticket count
- unused tickets
- check-ins
- order count
- waitlist count

Public ticket projection must remain byte/shape/semantic compatible except for internal helper use.

Do NOT alter:

- reserve_checkout behavior
- fulfillment
- refunds
- reservation expiry
- order lifecycle

Required proof before moving forward:

- extracted helper equals pre-change public availability
- helper math equals checkout capacity rejection math for equivalent inventory facts
- exact quantity boundary
- reservation-expiry boundary
- all protected order states
- multi-tier fixtures
- partial/full refund behavior
- capacity edits
- overcommitted state

If equivalence cannot be proven without changing Checkout Integrity:

STOP and report.

Do not refactor checkout to make Waitlist work.

# Data model

Implement the smallest durable model approved by the specification.

Expected private concepts:

- waitlist_settings
- waitlist_enrollments
- waitlist_tier_state
- waitlist_availability_cycles
- waitlist_deliveries
- waitlist_leave_tokens
- waitlist_delivery_observations
- waitlist_join_requests
- waitlist_rate_events

Use exact current-main migration ordering.

Prefer TWO focused migrations:

1. shared read-only inventory helper/public projection equivalence
2. Waitlist domain + mail/suppression integration

No new payment/order/ticket columns.

All runtime gates default OFF.

No scheduler installation in migration.

Private tables:

- RLS enabled
- no browser direct access
- narrow explicit SECURITY DEFINER contracts
- empty search_path
- explicit grants

Do not expose organizer ID as caller authority.

# Join behavior

Public accountless join receives only:

- eventId
- tierId
- name
- email
- requestId

Reject unknown/arbitrary fields.

Server verifies:

- current public/sales eligibility
- paid event
- before event start
- active tier
- tier belongs to event
- current inventory SOLD OUT
- valid name/email
- abuse limits
- service accepting joins

Inventory truth must be sampled AFTER the approved ticketing lock boundary with fresh time.

If current inventory is AVAILABLE:

return `TICKETS_AVAILABLE`

Create nothing.

Frontend then refreshes normal ticket availability.

# Dedupe

Normalize using current canonical email rules:

trim + lowercase

Do not collapse:

- plus aliases
- Gmail dots
- other provider-specific identities

One active enrollment per:

tier UUID + normalized email

Duplicate active request:

return the same generic success.

Do not reveal that it already existed.

Do not:

- rename it
- rotate leave authorization unnecessarily
- enqueue another confirmation
- reset join time
- reset notification history

Rejoin after Purchased/Removed/operational closure:

new enrollment UUID
new join timestamp
new lifecycle

Durable request UUID protects lost-response retries.

# Buyer UI

Modify current ticket selection flow minimally.

Available tier:

normal quantity controls.

Sold-out eligible tier:

Sold out
[ Join Waitlist ]

Use a small inline form:

Name
Email

[ Join Waitlist ]

No:

- account
- quantity
- marketing checkbox
- phone

Success:

“You’re on the waitlist. We’ll email you if [Tier] tickets become available.”

Duplicate active join gets the same public response.

If inventory reopens while the form is being submitted:

- return TICKETS_AVAILABLE
- close join form
- refetch tickets
- announce current availability
- focus normal tier purchasing controls

Do NOT automatically choose quantity or enter checkout.

Preserve current cart/price-review behavior.

# Availability observer

Implement independent Waitlist observer.

Recommended cadence for eventual activation:

60 seconds

But do NOT activate scheduler during Build + Prove.

Observer works only on tiers with open active demand.

Concept:

claim due tier
→ release claim lock appropriately
→ acquire existing ticketing boundary non-destructively
→ sample fresh authoritative inventory
→ compare durable prior observation
→ persist transition
→ create availability cycle if sold_out → available
→ reconcile purchases
→ fan out delivery rows

Important:

Do NOT hold a Waitlist claim row lock while waiting for checkout/event ticketing locks.

Use nonblocking/short lock behavior so Waitlist cannot materially slow checkout.

Recommended defaults:

- 25 tiers per observer invocation
- 100 enrollment reconciliation/fanout rows per transaction

Configurable downward.

Do not fan out thousands of recipients inside one long transaction.

# Availability cycles

Initial successful sold-out join:

observed state = sold_out
cycle = 0

sold_out → available:

increment cycle ONCE
create durable cycle

available → available:

nothing

available → sold_out:

arm next restock

sold_out → available again:

new cycle

One enrollment may receive:

maximum one restock delivery per cycle.

Continuous availability must never generate repeated cycles.

Join after cycle opened:

does NOT receive that already-open cycle.

# Polling limitation

Explicit approved V1 behavior:

If inventory goes:

sold out
→ available
→ sold out

entirely between observer runs, no transition may be recorded.

Do NOT synthesize an unseen availability cycle.

Do NOT add payment/refund/reservation writer hooks solely to solve this.

This limitation must be documented in final proof.

# Restock behavior

NOTIFY ALL eligible active members for the observed tier cycle.

Do not use remaining inventory quantity to cap notifications.

No FIFO promise.

No queue position.

No priority.

No fairness ranking.

Every eligible waiting member may be considered.

Before first possible dispatch, recheck current availability.

If it has sold out again:

suppress stale unsent restock delivery.

Do not send a knowingly stale “tickets available” message.

If provider dispatch may already have happened:

preserve accepted/unknown historical truth.

# Purchase reconciliation

Enrollment becomes Purchased only for authoritative completed purchase satisfying:

- same event
- same normalized buyer email
- order contains same ticket tier UUID
- order is coherent
- order status paid
- paid_at > joined_at
- reconciliation_status reconciled
- refunded_at null
- current approved refund state eligible

Do not count:

- checkout session
- reservation
- creating_checkout
- checkout_open
- payment_processing
- failed
- expired
- review/unknown financial state

Wrong tier purchase does not remove enrollment.

Purchase before current join does not remove new enrollment.

Once Purchased:

future refund does NOT automatically re-enroll old enrollment.

Rejoin requires explicit new join when sold out again.

Do not alter fulfillment to maintain Waitlist.

Reconciliation is observational.

# Leave Waitlist

Implement approved secure accountless bearer.

Namespace:

wl1_

Use cryptographically random 32-byte token.

Store only hash/authorization record.

Do not expose enrollment/email in URL.

Recommended:

/waitlist/leave#<token>

Capture and scrub fragment before normal app routing/imports using established secure-link patterns.

GET/navigation performs NO mutation.

Page:

Leave Waitlist

[ Leave Waitlist ]

POST token to server.

Valid leave:

mark/remove enrollment appropriately.

Repeat valid leave:

same harmless completion result.

Invalid/expired:

generic unavailable.

Token from old Purchased/Removed enrollment cannot mutate a future new enrollment.

Leaving must continue to work even if waitlist joining/delivery is disabled.

# Organizer UX

Add protected:

/organizer/events/:eventId/waitlist

Reachable from:

- Event Dashboard
- Tickets page

Tier summary:

GA      48 waiting
VIP     12 waiting

Open tier list:

- Name
- Email
- Joined
- Status

Statuses:

- Waiting
- Notified
- Purchased
- Removed

Do not show queue number.

Notified means provider-accepted restock notification, NOT proven inbox delivery.

Page:

- 50 rows
- stable pagination
- newest first
- loading/empty/error/closed states

Include organizer:

Remove from waitlist

with confirmation.

Server authorizes:

auth.uid() owns event
tier belongs to event
enrollment belongs to tier/event

No:

- priority
- reordering
- custom message
- manual blast
- reservation control
- CSV
- import

# Email architecture

Waitlist is its OWN domain.

Do not insert into:

- ticket_email_grants
- ticket email recovery membership
- organizer_messages campaigns
- ticket issuance

Reuse low-level:

- Resend/provider adapter
- encryption
- immutable payload patterns
- retry semantics
- signed webhook verification
- shared suppression
- React Email visual primitives

Implement dedicated Waitlist delivery rows/worker.

Purposes:

- confirmation
- restock

Stable provider key:

waitlist/<delivery UUID>

Preserve standard truthful states:

- queued
- sending
- accepted
- failed
- unknown
- suppressed

Accepted ≠ delivered.

# Confirmation email

One per NEW enrollment only.

Include:

- Wheretoo branding
- Event
- Tier
- Date/time
- Venue
- “You’re on the waitlist”
- explicit no-reservation explanation
- Leave Waitlist action

No purchase CTA while sold out.

Duplicate active join does not create another confirmation.

# Restock email

Include:

- Event
- Tier
- current price at payload preparation
- date/time
- venue
- Buy Tickets
- Leave Waitlist

CTA goes only to normal:

/events/:eventId/tickets

No:

- private checkout
- selected quantity
- reservation
- discount
- ticket grant

Required copy meaning:

“Tickets are available again, but they may sell out before you complete checkout.”

“Availability is not guaranteed.”

# Anti-spam

Approved configurable defaults:

Join attempts per normalized email+tier:
- 3/hour
- 10/rolling 24h

Join attempts per trusted IP:
- 60/hour
- 300/rolling 24h

Leave attempts per trusted IP:
- 60/hour
- 300/rolling 24h

Restock:
- one per availability cycle
- maximum 3 per enrollment per rolling 24 hours

Retry:
- same delivery does not count as another restock notification

Count Unknown deliveries toward anti-spam restock budget.

Do not burst old skipped cycles later.

# Suppression

Extend shared recipient suppression to Waitlist provenance.

Ticket bounce/complaint must suppress Waitlist delivery.

Organizer-message bounce/complaint must suppress Waitlist delivery.

Waitlist bounce/complaint must suppress ticket + organizer mail under the existing shared suppression truth.

Exactly one provenance reference must remain authoritative.

Do not build a second suppression list.

Update shared verified webhook routing so attempt UUID belongs to exactly one ledger:

- ticket
- organizer message
- waitlist

Reject ambiguity.

Signature verification occurs BEFORE domain routing.

# Capacity isolation

Waitlist gets its own:

- settings
- worker gate
- delivery capacity budget

Do not consume:

- ticket transactional quotas
- Organizer Email limits

Transactional ticket email retains priority/headroom.

Production provider allocation verification remains an activation task.

# Lifecycle closure

Close Waitlist operations when:

- event starts
- event cancelled
- event blocked
- event removed
- tier archived/inactive
- event permanently not sellable

Closed enrollments are not silently revived.

Historical rows remain visible to organizer as appropriate.

If event later becomes eligible again:

buyer must explicitly join again when tier is sold out.

No automatic resurrection.

# Retention

Use approved V1:

90-day sensitive PII/payload cleanup after terminal lifecycle where retry/evidence/leave/idempotency requirements permit.

Never purge data required for:

- provider retry
- unknown outcome
- suppression evidence
- leave authorization lifetime
- request-id replay
- anti-spam active window

Minimal immutable receipts may remain longer.

No history UI beyond event waitlist list.

# Concurrency proof

Use real separate database connections/barriers.

Required races:

- join vs reservation expiry
- join vs capacity increase
- join vs refund
- simultaneous duplicate joins
- two observers same tier
- fanout interruption/resume
- purchase before cycle membership
- purchase before first dispatch
- leave vs dispatch
- event start while waiting for lock
- cancellation/moderation while observer waits
- restock rate cap concurrency

Waitlist must not alter lock order or materially extend checkout critical sections.

Measure checkout latency under observer/fanout load versus pristine main.

# Scale proof

At least:

1,000 active enrollments on a sold-out tier.

Prove:

sold_out → available
→ one cycle
→ all eligible recipients processed resumably
→ no truncation
→ no duplicates

Use injected/local provider transport only.

No real email.

Measure:

- observer transaction duration
- fanout page duration
- checkout latency impact
- purchase-reconciliation lookup plan

Add narrow indexes only if evidence requires them.

# Existing feature regressions

Required differential proof against pristine current main:

- public ticket availability unchanged
- cart behavior unchanged
- Checkout Integrity unchanged
- reservation expiration unchanged
- fulfillment unchanged
- refunds unchanged
- ticket issuance unchanged
- QR/check-in unchanged
- Ticket Email/Recovery unchanged
- Email Attendees unchanged
- CSV Export unchanged
- Duplicate Event does not copy Waitlist data
- storefront ticket availability unchanged

Known baseline SQL/CSP failures may remain only if they reproduce identically on pristine current main.

Any feature-branch-only failure is a regression and blocks completion.

Do NOT repair unrelated baseline debt in this branch.

# Browser proof

Buyer:

- mixed available/sold-out tiers
- one sold-out tier
- all sold out
- join form
- generic duplicate success
- reopen during submission
- refresh failure
- event started/closed
- mobile 390px
- desktop
- keyboard/focus

Organizer:

- tier counts
- pagination
- statuses
- confirmed removal
- closed state
- foreign access denial

Leave:

- fragment capture
- no GET mutation
- confirm leave
- repeat leave
- invalid/expired token
- keyboard/mobile

# Activation boundary

Build + Prove does NOT authorize Waitlist production activation.

All defaults must ship OFF:

- accepting_joins = false
- observer_enabled = false
- delivery_enabled = false
- hosted scheduler absent

Do NOT:

- apply hosted migration
- deploy live Waitlist functions
- configure scheduler
- configure provider capacity
- change DNS
- send real email
- activate gates
- deploy live production

Staging frontend deployment caused automatically by a future merge may be addressed separately at merge time.

# Scope guard

Do NOT build:

- free RSVP waitlist
- ticket reservations from waitlist
- queue position
- queue ranking
- timed offers
- exclusive windows
- notify-next
- auto-charging
- desired ticket quantities
- buyer accounts
- SMS
- push
- priority customers
- manual organizer blasts
- waitlist CSV
- import
- CRM
- dynamic pricing
- transfers
- Staff Access
- recurring events

# Completion standard

PASS only when:

sold-out paid tier
→ accountless buyer joins
→ one active enrollment
→ zero reserved inventory
→ observed sold-out→available cycle
→ one durable notification per eligible entry for that cycle
→ no stale notification when currently sold out before dispatch
→ buyer uses normal checkout
→ qualifying later purchase stops future notifications
→ secure leave works
→ organizer can view/remove demand
→ no ticket/payment truth changed

is proven.

# Final report

STOP after Build + Prove and report:

1. PASS / PARTIAL / BLOCKED
2. branch/worktree
3. baseline main HEAD
4. final HEAD/commit state
5. files changed
6. migrations
7. inventory helper/equivalence proof
8. Waitlist data model
9. join/dedupe proof
10. availability-cycle proof
11. polling limitation confirmation
12. purchase reconciliation proof
13. leave-token proof
14. organizer UX proof
15. buyer UX proof
16. email/worker proof
17. suppression/webhook proof
18. anti-spam proof
19. capacity/isolation proof
20. concurrency/locking proof
21. 1,000-enrollment scale proof
22. checkout latency comparison
23. regression results
24. known baseline failures
25. new regressions
26. typecheck/lint/build/function results
27. security/privacy review
28. unresolved risks
29. activation/manual setup still required
30. confirmation no real email/hosted migration/deployment/scheduler activation occurred
31. recommendation: ready to commit/review for merge — yes/no

Do not start CSV Import, live payment activation, Staff Access, or another feature.

Finish Waitlist V1 and STOP.