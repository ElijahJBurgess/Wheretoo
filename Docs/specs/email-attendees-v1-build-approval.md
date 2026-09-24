Email Attendees V1 inspection/spec is approved for implementation.

Governing document:

Docs/specs/email-attendees-v1-inspect-spec.md

Proceed with BUILD + PROVE.

Target the CURRENT integrated main.

Before implementation:

1. fetch and verify origin/main
2. record current main HEAD
3. inspect git/worktree status
4. preserve all unrelated user-owned files
5. create an isolated feature branch/worktree
6. if main advanced since inspected HEAD 8138cdf2d6f84ff98d7ca42b595a9f87f9f7b66a, inspect and reconcile the delta safely
7. do not reset or overwrite unrelated recovery/staging work

# Founder decisions

The following decisions resolve section P of the approved inspection report.

## 1. Cancelled events

APPROVED:

Do NOT allow new custom Email Attendees messages after an event has been cancelled.

Existing automatic event-cancellation notices remain the supported cancellation communication path.

Do not create a historical cancelled-attendee exception in V1.

Server-side enforcement is required.

## 2. Moderation / financial eligibility

APPROVED:

Organizer messaging is allowed only when the event satisfies the approved clear/no-active-hold messaging policy.

Blocked, removed, active moderation holds, and unresolved moderation states are denied.

For paid recipients, use the conservative current operational rule:

private.order_refund_state(order) = 'eligible'

along with the other approved coherent paid-order requirements.

Exclude:

- submitting
- processing
- unknown
- review
- completed/refunded
- ineligible
- failed refund workflow states

Do not invent a new payment/refund interpretation.

Do not weaken existing refund, order, ticket, or financial truth.

## 3. V1 send limits

APPROVED as configurable V1 defaults:

- maximum 1,000 unique recipients per send
- maximum 3 confirmed messages per event per hour
- maximum 10 confirmed messages per event per 24 hours
- maximum 20 confirmed messages per organizer per 24 hours
- maximum 5,000 recipient deliveries per organizer per 24 hours
- maximum 3 messages to the same normalized recipient from the same organizer per 24 hours across events
- preview limit: 30 preview requests per organizer per minute

Never truncate an audience to satisfy a limit.

If a send exceeds the limit:

fail visibly
and create no partial campaign.

These limits belong only to Organizer Messages.

Do NOT activate or modify ticket recovery/resend numeric limits.

## 4. Retention

APPROVED:

Use the proposed 90-day operational retention for sensitive organizer-message content and encrypted provider payloads after terminal safety requirements are satisfied.

Preserve the minimum durable request/idempotency receipt needed to prevent request-ID reuse and duplicate sends.

Do not purge records still needed for:

- unknown outcomes
- provider evidence
- suppression provenance
- idempotency
- active retry safety

No general campaign-history UI is authorized.

## 5. Reply-To

APPROVED:

No organizer contact-email field exists today.

For V1:

- actual sender remains Wheretoo-controlled
- visible sender is `<Organizer Display Name> via Wheretoo`
- reply-to uses the configured Wheretoo support address
- preview should make this clear

Do NOT use auth/login email.

Do NOT add an organizer contact-email subsystem.

## 6. Images / CTA

APPROVED:

Event flyer and organizer logo are optional enhancements only where current anonymous/public media endpoints make them safe.

They must never block an otherwise valid send.

No private signed URLs.

No storage paths.

No ticket-access links.

CTA is only the safe public event URL when currently appropriate.

Otherwise omit it.

# Core product

Organizer flow:

Event Dashboard
→ Email Attendees
→ choose audience
→ subject
→ message
→ Preview
→ authoritative recipient count
→ confirm `Send to N people`
→ durable queue
→ `Message queued for N recipients`

Paid audiences:

- Everyone
- Ticket Tier
- Individual customer/order

Free audiences:

- Everyone
- Individual registration

One email per unique normalized email address.

No per-ticket duplicate emails.

No invented attendee identities.

# Architecture

Implement the approved separate Organizer Messages domain.

Do NOT add organizer messaging as another ticket-email purpose.

Do NOT create ticket-access grants.

Do NOT create ticket-email members.

Do NOT invoke ticket resend/recovery/issuance.

Architecture:

authenticated organizer action
→ owner-authorized preview
→ server-side audience resolution
→ authoritative count + fingerprint
→ confirmed request UUID
→ atomic immutable message + recipient snapshot
→ dedicated organizer-message worker
→ existing low-level provider/encryption mechanics
→ verified provider observations
→ shared suppression truth

Keep Organizer Messages operationally isolated from transactional ticket-email delivery.

# Data model

Implement the minimum durable records approved in the inspection:

- private.organizer_messages
- private.organizer_message_recipients
- private.organizer_message_observations
- private.organizer_message_settings
- private.organizer_message_rate_events

Do NOT add:

- customer/contact CRM table
- campaign analytics schema
- marketing subscription table
- ticket-access grants
- general newsletter system

Use explicit constraints and narrow SECURITY DEFINER contracts.

No browser direct table access.

No broad service-role table grants.

# Audience truth

## Paid Everyone

Recipient qualifies only when:

- event is owned by current organizer
- paid event
- order passes current organizer coherence
- status is paid
- paid_at exists
- refunded_at is null
- reconciliation state is valid/current
- order_refund_state = eligible
- qualifying order has at least one valid or used admission
- canonical email is valid

Deduplicate by normalized email.

One qualifying order is enough even if another order under the same email is inactive/refunded.

## Paid Tier

Use purchased ticket-tier UUID relationships.

Do not use tier-name string matching.

Archived but historically purchased tier IDs remain valid targeting choices.

Buyer must have at least one qualifying purchased item/admission associated with the selected tier.

Deduplicate after filtering.

## Paid Individual

Selected owned order must itself qualify.

Do not silently rescue an inactive selected order because the same email has another qualifying order.

## Free Everyone

Use:

- owned event
- confirmed registration
- cancelled_at null
- coherent registration
- at least one valid or used admission

Group RSVP = one email.

Deduplicate normalized email.

## Free Individual

Selected owned registration must itself qualify.

No arbitrary recipient input.

# Send window

Allow new sends only when:

- event is not draft
- event is not cancelled
- event is not blocked/removed
- no active blocking moderation condition exists
- canonical schedule is valid
- current server time <= ends_at + 168 hours

At exactly +168 hours, allow.

After it, deny.

Messages validly confirmed before the deadline continue dispatching after the deadline.

The send window must not invalidate an already committed recipient snapshot.

# Preview

Preview must:

- validate selector
- validate subject/body
- resolve server-side audience
- apply suppression
- dedupe
- return exact count
- return audience label
- return opaque HMAC fingerprint
- return safe rendering/template facts
- never return recipient addresses

Fingerprint must cover enough facts to detect:

- added recipient
- removed recipient
- same count/different recipients
- content changes
- event-policy changes
- sender/template changes
- relevant asset/CTA changes

Send must materialize the audience once and compare against preview.

If changed:

AUDIENCE_CHANGED or PREVIEW_CHANGED

No queue created.

Require preview again.

# Idempotency

Use one durable request UUID generated for the confirmation action.

The server must ensure:

same request ID + same intent
→ same message receipt

same request ID + different intent
→ REQUEST_CONFLICT

Double click
→ one message

Lost HTTP response
→ reconcile same request ID

Do NOT generate a new UUID automatically after an ambiguous response.

Provider delivery idempotency remains independent and per recipient:

organizer-message/<recipientDeliveryUuid>

# Message content

Organizer controls only:

- audience
- subject
- message

Subject:

- 1–120 code points after trim
- reject CR/LF/header controls

Body:

- 1–5,000 code points
- normalize CRLF/CR to LF
- preserve line breaks
- reject unsafe controls
- plain text only

No HTML input.

No Markdown interpretation.

No rich text.

No attachments.

No arbitrary links transformed into HTML.

React Email must escape organizer content.

# Template

Add a dedicated OrganizerMessageEmail template using the existing Wheretoo React Email design system.

Include where safe:

- Wheretoo branding
- organizer display name
- event title
- event date/time
- venue
- organizer message
- optional event flyer
- optional organizer logo
- optional public `View Event` CTA
- Wheretoo footer
- relationship explanation

Do NOT reuse ticket privacy/grant wording.

No personalized buyer name required.

Email must remain useful with:

- no flyer
- no logo
- no CTA

# Suppression

Extend the existing shared recipient block truth using the approved provenance change.

Existing ticket suppression rows remain valid unchanged.

Organizer message bounce/complaint can add the same canonical recipient block.

Ticket mail must respect organizer-origin suppression.

Organizer mail must respect ticket-origin suppression.

Organizer cannot override suppression.

Do not create a second block list.

Regression-test both provenance directions.

# Worker

Add a separate organizer-message worker.

Do NOT send recipient emails from the browser/API submission request.

The worker:

- claims one recipient delivery
- uses leases
- prepares immutable encrypted provider payload
- rechecks suppression/safety before dispatch
- persists dispatch intent before network
- uses stable idempotency key
- records accepted/failed/unknown truth
- follows approved retry/backoff semantics
- does not affect sibling recipient states

Use the existing provider adapter and encryption primitives where safe.

Do not call processTicketEmail.

No ticket grants.

# Transactional email priority

Organizer email must not starve:

- Tickets Ready
- Resend Tickets
- Ticket Recovery
- Event Change/Cancellation
- Refund notices

Separate worker/settings/limits.

Before organizer dispatch, yield when transactional ticket email has ready/leased work as specified in the approved architecture.

Do not modify transactional claim ordering.

Do not activate currently NULL ticket-email limits.

# Webhook

Reuse the existing verified webhook endpoint.

Signature verification happens before ledger routing.

Implement the approved dispatcher so a verified attempt UUID routes to exactly one:

- ticket email ledger
OR
- organizer message ledger

Reject ambiguity.

Never guess by recipient/time.

Preserve provider-ID binding and observation precedence.

# UI

Add:

`/organizer/events/:eventId/email-attendees`

Event dashboard action:

Email Attendees

Page heading:

Message attendees about this event

Paid audience dropdown:

- Everyone
- each targetable ticket tier

Free audience:

- Everyone

Individual modes from existing:

- Order Detail → Email customer
- Registration Detail → Email registrant

Individual recipient address is not editable.

Composer:

Audience
Subject
Message
Preview

Preview:

- safe email rendering
- audience label
- exact count

Primary action:

Send to N people

Success:

Message queued for N recipients.

Do not say delivered.

# Failure UX

Handle explicitly:

- unauthorized
- event unavailable
- send window closed
- moderation blocked
- zero eligible recipients
- invalid tier
- inactive individual
- suppression
- audience drift
- preview drift
- limits reached
- worker unavailable before submit
- provider configuration unavailable
- database rollback
- ambiguous network result
- committed send with later provider failures

Unknown submission outcome:

reconcile by request ID.

Never suggest creating a new send until the original request is reconciled.

# Security/privacy

Browser never submits:

- recipient arrays
- arbitrary addresses
- owner IDs
- sender overrides
- reply-to overrides
- HTML
- provider payloads

Browser never receives the bulk recipient list.

Every selector must be reauthorized server-side.

Do not log:

- subject/body
- recipient list
- decrypted payload

Use message/delivery IDs and sanitized error codes.

No analytics tracking of message content.

# Testing

Implement test-first where practical.

## Authorization

Prove:

- owner succeeds
- foreign organizer denied
- anonymous denied
- staff-but-not-owner denied
- foreign tier denied
- foreign order denied
- foreign registration denied
- arbitrary recipient input impossible
- service contracts unavailable to browser actors

## Audience

Paid:

- 1 buyer / 1 ticket = 1
- 1 buyer / 4 tickets = 1
- same normalized email / multiple qualifying orders = 1
- different normalized emails remain distinct
- multi-tier targeting
- archived tier targeting
- same tier names/different UUIDs
- refunded excluded
- unresolved refund state excluded
- used but otherwise active included

Free:

- one registration = 1
- group RSVP = 1
- duplicate normalized email = 1
- cancelled excluded
- used/check-in still included

## Preview/fingerprint

Prove:

- exact count
- no recipient leakage
- same count/different membership rejected
- added/removed recipient rejected
- suppression race
- event schedule/state change
- subject/body change
- template version change
- zero recipients

## Idempotency

Prove with real concurrent DB requests:

- same request UUID creates one message
- one recipient row per unique address
- rate debit once
- lost response retry returns original receipt
- receipt lookup race is safe
- changed intent same request conflicts
- deliberate new UUID works within limits

## Worker/provider

Prove:

- browser closes after submit
- queue continues
- accepted
- failed
- unknown
- provider timeout
- 429
- 5xx
- malformed provider response
- lease expiry
- worker crash before/after network
- retries preserve exact payload/idempotency key
- max attempt/window behavior
- one recipient failure does not affect another

## Suppression/webhook

Prove:

- ticket bounce blocks organizer email
- organizer complaint blocks ticket mail
- existing ticket suppression unchanged
- organizer cannot clear
- verified webhook routing
- invalid signature
- unknown UUID
- ambiguous UUID
- wrong provider ID
- duplicate webhook
- conflicting observation
- observation precedence

## Window/state

Prove:

- upcoming
- during
- ends_at
- +168h exactly
- +168h + 1 microsecond
- cancelled denied
- draft denied
- blocked denied
- removed denied
- active hold denied
- invalid schedule denied
- confirmed-before-deadline continues afterward

## Limits

Prove:

- 1,000 succeeds
- 1,001 fails, no truncation
- hourly/daily event limits
- organizer limits
- recipient frequency limits
- preview rate limit
- replay does not double-debit
- failed preview/zero audience does not consume send budget

## Template/security

Prove:

- CRLF/header injection rejected
- HTML/script rendered as escaped text
- Unicode
- emoji
- line breaks
- length boundaries
- unsafe organizer display name fallback
- correct platform From
- correct support reply-to
- no ticket bearer/grant
- no signed/private storage URL
- optional image/CTA fallback

## Existing system regression

Prove no behavior regression in:

- Tickets Ready
- Resend Tickets
- Recovery
- ticket access grants
- ticket email provider
- signed webhook
- event change/cancellation notices
- refund notices
- checkout
- ticket issuance
- QR/check-in
- refund state
- free RSVP
- CSV Export
- Duplicate Event

Existing known SQL failures must be evaluated DIFFERENTIALLY against pristine current main.

Do not require unrelated baseline debt to become green.

If a failure exists on the feature branch and does NOT reproduce on current main:

treat it as a new regression and block completion.

## Browser

Prove:

- paid Everyone
- paid Tier
- free Everyone
- paid Individual
- free Individual
- preview
- recipient count
- send confirmation
- queued success
- zero audience
- closed window
- limit error
- ambiguous network reconciliation
- double click
- logout/account switch
- keyboard
- focus
- 390px
- desktop

No real provider sends during normal Build + Prove.

Use injected/local provider transport and signed fixtures.

# Activation boundary

IMPORTANT:

Build + Prove does NOT authorize production email activation.

Do NOT:

- enable organizer message accepting_sends
- enable organizer message worker in hosted production
- install production scheduler
- change DNS
- configure provider sender
- configure real support email
- send real email
- apply hosted migration
- deploy production

Implementation configuration defaults must fail closed.

Production activation will be a separate task after code merge and provider/capacity verification.

# Git

Use isolated feature branch/worktree.

Do not modify unrelated user-owned files.

Do not merge to main during this task.

Do not deploy.

Implementation commits may be made only after verification if normal repo workflow supports them, but stop before merge.

# Completion standard

PASS only when:

authorized organizer
→ valid event
→ server-resolved active audience
→ unique normalized recipients
→ truthful preview count
→ immutable snapshot
→ durable request-id-safe queue
→ independent worker
→ provider-safe immutable delivery
→ shared suppression
→ no ticket grant/issuance effects

is proven.

# Final report

STOP and report:

1. status — PASS / PARTIAL / BLOCKED
2. branch/worktree
3. baseline HEAD
4. final HEAD/commit state
5. files changed
6. migration added
7. tables/contracts added
8. Edge functions added
9. worker architecture
10. exact audience rules implemented
11. event-state/window behavior
12. limits implemented
13. retention behavior
14. sender/reply-to/template implementation
15. preview/fingerprint proof
16. idempotency proof
17. suppression/webhook proof
18. transactional email isolation proof
19. bulk delivery proof
20. authorization/privacy proof
21. browser/UX proof
22. regression results
23. known baseline failures
24. new regressions, if any
25. typecheck/lint/build/function results
26. unresolved risks
27. manual/production activation requirements
28. confirmation no real email/provider activation/deployment occurred
29. recommendation: ready to commit/review for merge — yes/no

Do not begin Staff Access, Waitlist, CSV Import, payment/live readiness or another feature.

Finish Email Attendees V1 and STOP.