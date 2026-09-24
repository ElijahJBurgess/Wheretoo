# Wheretoo — Waitlist V1 inspection and recommended specification

Status: inspection/specification only; proposed implementation, not implemented or tested.

Inspected repository: `/Users/exoh/Desktop/WhereTo-main-final`.
Fetched `origin/main`: **dd33333c4f9f17079559be62ffa1ad2762b4061b**; local main matches and was clean.
Governing intent: supplied Waitlist V1 product specification and inspection request. Read all three V1 product/flow/architecture documents. The new explicit Waitlist scope extends the older V1 scope without changing checkout ownership.

Recommendation: **ready for Build + Prove after founder review of this specification**. No additional founder decision is required to choose the ordinary implementation defaults below. Polling limitations are explicit in F/S; exact capture of every intervening transition would require a different scope.

## A. Current ticket availability/inventory truth

### Authoritative predicate

`public.get_public_event_ticketing(uuid)` is currently defined in `supabase/migrations/20260902010100_add_checkout_cart_reservation.sql:528`. It projects active tiers and computes protected quantity from `order_items.quantity` joined to `orders`:

- All quantity on `paid`, `payment_processing`, `requires_review`, and `partially_refunded` orders.
- Quantity on `creating_checkout` and `checkout_open` only while `reservation_expires_at > as_of`.
- No protected quantity from other states, including fully refunded, failed, cancelled and expired orders.

A tier is available iff `quantity_total > protected_quantity`; otherwise it is sold out. Zero and negative remaining capacity are sold out. Count item quantities, not issued tickets, unused admissions, order count, or capacity minus checked-in people. Partial refunds do **not** independently release partial inventory under this predicate.

`private.reserve_checkout` in that same migration rejects a requested cart when protected quantity plus requested quantity exceeds tier capacity. It additionally validates tier/event membership, active status, public eligibility, runtime checkout control, current test-mode Connect readiness and fee rules. Those operational checkout checks are not all part of the public inventory projection. Do not label an infrastructure outage as sold out.

`private.fulfill_paid_order` in `20260907010000_integrate_core_ticket_truth_lite_fulfillment.sql` retains protected-inventory checks and uses `private.lock_payment_order`. Completed payment and ticket issuance remain authoritative and untouched. Refund application uses that lock too; the current wrapper is in `20260902010475_harden_refund_review_recovery.sql`, delegating the whole-order behavior introduced in `20260902010400_enforce_whole_order_refund_safety.sql`.

`20260902010200_schedule_checkout_reservation_expiry.sql` expires eligible orders every minute. Inventory reads already disregard expired reservation time without waiting for that cron to update status. A Waitlist worker must not expire or mutate an order.

Tier editing uses `public.save_ticket_tiers` and its revision/active-free wrappers; the final owner-precheck wrapper is in `20260826011475_restore_ticket_tier_owner_precheck.sql`. Capacity increases can reopen a tier. Inspection found the older quantity-edit guard uses a narrower committed-state set than the current checkout/public projection. **Do not reuse that guard as Waitlist availability and do not repair it in this feature.** Checkout still independently protects inventory; excessive commitments must project sold out.

### Decision: one shared read helper, no checkout writer changes

Extract only the read-only aggregate from the current public projection into proposed `private.ticket_tier_inventory(p_tier_id uuid, p_as_of timestamptz)`. Return tier/event identity, total, protected quantity and sold-out/available state; no writes or authorization bypass. Missing/inactive tiers are not purchasable. Keep public response shape, tier ordering, eligibility and `statement_timestamp()` semantics exactly unchanged by calling that helper from the public projection. Storefront already consumes that projection and therefore needs no new calculation.

Waitlist calls the same helper using a fresh database `clock_timestamp()` **after acquiring locks**, under READ COMMITTED with a fresh post-lock statement snapshot. This prevents a request that waited across reservation expiry from enrolling on stale time. A direct call to the existing public RPC alone is less suitable because its fixed statement timestamp can predate that wait.

Leave the checkout aggregate and all reservation writer semantics unchanged. Prove the helper equivalent to both existing public output and checkout admission math over every order state, quantity boundary and time boundary. If this narrow extraction cannot preserve equivalence, stop Build + Prove rather than expanding into Checkout Integrity refactoring.

## B. Current email/retry/suppression primitives

Reusable code:

- `_shared/ticketEmailProvider.ts`: transport, timeout, stable idempotency header, accepted/failed/unknown result classification, signed raw-body webhook verification.
- `_shared/ticketEmailAccess.ts`: canonical ASCII email, AES-GCM immutable provider payload envelopes, authenticated context and key IDs, fingerprint/token patterns.
- `_shared/ticketEmailWorker.ts` and `_shared/organizerMessageWorker.ts`: lease → prepare → persist encrypted payload → commit possible dispatch → provider → persist result.
- `_shared/emails/`: React Email templates/design conventions.
- `ticket-email-webhook/index.ts`: verifies provider signatures before calling `server_observe_email`.
- `private.ticket_email_recipient_blocks`: shared HMAC-address suppression, currently with exactly one ticket or organizer provenance.

There is **no clean shared domain-neutral delivery ledger** on current main. Ticket outbox rows carry ticket/recovery purposes and grants. Organizer rows belong to campaigns and immutable audiences. Reuse lower-level code, not either domain's rows or worker quota.

Existing retry precedent: two-minute lease, maximum six possible dispatches, bounded 23-hour retry window from first possible dispatch, immutable payload and stable key, terminal uncertainty preserved. These are repository conventions inspected here, not a fresh verification of provider guarantees. Provider idempotency/capacity contracts must be checked during separate activation.

## C. Exact join eligibility

Server accepts only:

1. Explicit Waitlist acceptance enabled and storage/confirmation preparation configuration healthy.
2. Existing published paid event satisfying `private.event_is_publicly_eligible(event_id, now)` and current moderation/public revision rules.
3. Finite starts/ends, ends after starts, valid timezone; `now < starts_at`.
4. Correct event/tier relationship; tier active, valid current USD price and capacity.
5. Canonical inventory helper reports sold out under the lock.
6. Valid trimmed name (1–120 characters, reject control characters), canonical ASCII email up to 320 characters, valid bounded request, independent abuse checks.

Use current `private.event_has_current_public_eligibility` / `event_is_publicly_eligible`, not a hand-written shortcut for moderation. The final definition is in `20260826010450_harden_public_eligibility_reads.sql`; it checks published/current authorized revisions, public interval, policy environment, organizer/disclosure and required event facts. Its time cutoff is event **end**; Waitlist explicitly adds event **start**.

If otherwise eligible inventory is now available, return `TICKETS_AVAILABLE`, create nothing, refresh normal purchase UI. For denied event/tier return generic `WAITLIST_UNAVAILABLE`; do not expose moderation details. Invalid form → `INVALID_INPUT`; abuse → `RATE_LIMITED`; lock contention/disabled service → retryable `WAITLIST_UNAVAILABLE` without committing an enrollment.

No Stripe network call on join. Transient Connect freshness is not an inventory state and does not permanently close enrollments. Dispatch additionally requires the existing checkout runtime creation gate enabled; normal checkout still validates all payment prerequisites. A separate public Waitlist capability response may disclose enabled/eligible/closed only—no demand counts or addresses.

## D. Exact dedupe/rejoin behavior

Normalize with trim + lowercase using existing canonical-email rules. Preserve dots and plus aliases. Database uniqueness on `(ticket_tier_id, normalized_email)` where lifecycle is active is mandatory; SQL and TypeScript validation must agree.

New enrollment and duplicate active enrollment return the same status/body: HTTP 202, `{"kind":"joined"}`. No enrollment ID, timestamp, prior name, purchase status, notification state or leave token. Duplicate requests do not rename the entry, rotate tokens, enqueue another confirmation or reset rate history. For a fresh request, availability/eligibility checks precede the active-entry dedupe branch, so even a prior member gets `TICKETS_AVAILABLE` when the tier has reopened, without revealing membership.

Waiting and Notified are both active. Purchased and Removed are terminal for that enrollment. A valid subsequent sold-out join creates a **new UUID**, join time and confirmation. Each public join carries an opaque client request UUID, scoped to its canonical event/tier/email request, with a private minimal durable receipt: replaying a successful request returns the same generic success and cannot create a new enrollment after that enrollment was removed/purchased. A deliberate new join uses a new request UUID. Retain request receipts through event closure + 90 days; expired receipts are not replayed by the client. Old delivery/token history remains bound to the old enrollment. Never resurrect it. Qualifying purchases are reconciled before dedupe so stale active storage does not prevent a genuine new enrollment.

No automatic re-enrollment on refund. No desired quantity. Same email can independently enroll on another tier.

## E. Proposed minimal data model

All new domain tables in `private`, RLS enabled, no direct anon/authenticated/service-role table grants. Public wrappers grant only the intended server or owner RPC access.

| Proposed table | Essential fields and constraints |
|---|---|
| `waitlist_settings` | Singleton; accepting_joins, observer_enabled, delivery_enabled all false; sender/support/origin configuration, health timestamps, independent capacity, join/leave/restock limits, batch/retention settings. |
| `waitlist_enrollments` | UUID, event_id, tier_id, name, normalized_email, shared suppression recipient hash, lifecycle active/purchased/removed, joined_at, purchased_at, qualifying_order_id, removed_at/reason, operational_closed_at/reason, last accepted restock cycle/time, purge metadata. Partial unique active email+tier. Immutable event/tier/email/join identity. |
| `waitlist_tier_state` | Tier PK, event_id; observed_state sold_out/available/closed/paused; monotonic cycle; observed_at, transitioned_at; fair next-check time and lease metadata. No inventory counters treated as truth. |
| `waitlist_availability_cycles` | UUID, tier_id, sequence, opened_at, membership cutoff/cursor, completion marker; unique tier+sequence. Durable resumable notify-all fanout. |
| `waitlist_deliveries` | UUID, enrollment_id, purpose confirmation/restock, cycle_id, queued/sending/accepted/failed/unknown/suppressed, encrypted immutable payload, stable provider key/ID, lease, first_possible_dispatch_at, count, next_attempt_at, stop reason, observed result, timestamps. Unique confirmation per enrollment; unique restock enrollment+cycle; purpose/cycle consistency checks. |
| `waitlist_leave_tokens` | Hash PK, enrollment_id, delivery_id unique, creation/expiry/revocation metadata. No plaintext token. Multiple email links can remove the same enrollment. |
| `waitlist_delivery_observations` | Signed webhook ID PK, delivery/provider IDs, kind/time, immutable evidence. |
| `waitlist_join_requests` | Request UUID PK, keyed canonical request digest, enrollment reference, created_at/retention cutoff. Private durable successful-join receipt; replay never re-enrolls. |
| `waitlist_rate_events` | Independent lane + hashed subject + timestamp/units; indexed rolling-window lookup. Separate dispatch and abuse accounting. |

Use event/tier consistency checks and server validation; no public ability to pass an organizer identity. Add indexes for tier+active enrollment/cursor; ready deliveries; recipient dispatch history; observer next-check; token lookup; webhook/provider uniqueness. Purchase matching must have an efficient event+normalized buyer email+paid_at access path and existing order-item order/tier indexes; add a narrow expression index only if EXPLAIN proves needed. No new payment columns.

Names/emails may remain plaintext **inside the private enrollment table**, consistent with existing private organizer-recipient handling, because organizer reads and purchase matching require them. No extra original-case email is needed. Provider content is encrypted. Do not describe HMAC fingerprints as encryption.

Operational closure is separate from the four requested organizer statuses. A closed list displays a clear Closed banner/reason; historical rows retain Waiting/Notified/Purchased/Removed labels, but active-demand count is zero and no notification qualifies. New enrollment requires reopening eligibility and a fresh explicit join; do not silently revive closed enrollment. The partial unique index applies only where lifecycle is active AND `operational_closed_at IS NULL`; closed historical rows therefore cannot block a new explicit enrollment if the event later becomes eligible again.

## F. Restock availability-cycle architecture

Initialize first successful sold-out join with tier state sold_out; cycle starts at zero. All successful joins also contribute a serialized sold-out observation. Never reset an already incremented cycle when a new member joins.

For each due tier with open demand:

1. Obtain a short exclusive event ticketing lock, then tier/event locks in existing order; sample fresh time and canonical inventory.
2. Apply lifecycle policy. Terminal closure stops new delivery; transient public uncertainty pauses it.
3. Sold_out → available increments cycle exactly once and creates a durable cycle row in the same transaction. available → available does nothing. available → sold_out arms the next transition. Capacity increases while already available do not create cycles.
4. Commit promptly. Fanout is resumed in small pages; each page reacquires the same boundary, reconciles purchases, and inserts unique eligible delivery rows. Persist cursor transactionally so crashes cannot skip members.
5. Only enrollments active and joined by cycle opening are members. After a later sell-out, a new join does not receive a previous cycle's mail.

Notify all means every qualifying active member is considered, with **no inventory-sized cap, priority ranking, silent truncation or FIFO entitlement**. Suppression, purchase/removal, operational closure and the approved anti-spam cap still exclude delivery. Cursor processing order is an implementation detail, never a customer promise.

If availability disappears before a pending restock's first possible dispatch, suppress it as stale; do not tell buyers tickets are currently available when the latest check says sold out. A newer cycle supersedes undispatched older-cycle messages. Once a possible dispatch was committed, preserve that evidence; stopping retries is allowed, rewriting accepted/unknown as unsent is not.

**Polling limitation:** the worker recognizes observed transitions. A sold-out → available → sold-out pulse entirely between polls may be missed, as may a sold-out interval between two available observations. A successful join can also record the intervening sold-out state. Do not invent cycles for unseen transitions. This follows the explicitly preferred independent 1–2 minute observation model. Guaranteeing every real transition requires writer-side durable events and is not claimed by V1.

## G. Purchase reconciliation rule

For the current enrollment, find an order with:

- Same event and organizer coherence; `lower(btrim(buyer_email))` equals enrollment normalized email.
- `order_items.ticket_tier_id` equals the enrolled tier UUID, with positive coherent quantity.
- `status='paid'`, non-null `paid_at > joined_at`, null refunded_at, `reconciliation_status='reconciled'`.
- `private.organizer_order_coherent(order_id)` true and `private.order_refund_state(order)='eligible'`.

This uses the same conservative qualified paid truth as Email Attendees. Used admissions still qualify; wrong-tier purchases do not. Processing/reservations/session creation, failed/expired orders, review/refund uncertainty and incomplete ticket reconciliation do not qualify. Mark Purchased observationally; do not write orders, tickets, grants or refunds. Once marked Purchased, a subsequent refund does not reopen that enrollment.

`paid_at` is Wheretoo's persisted fulfillment observation time, set with `statement_timestamp()` and preserved with coalesce. It is not the buyer's redirect time or a guaranteed provider payment timestamp. Use it strictly as the supplied after-join criterion; do not substitute updated_at. Delayed reconciliation with an older paid_at will not retire a new enrollment. Equal timestamps do not qualify. Document/test this conservative boundary rather than changing fulfillment solely for Waitlist.

Reconcile on observer sweeps even while continuously sold out, before cycle membership, on duplicate joins and immediately before possible dispatch. Paginate reconciliation. A purchase committed before notification membership is finalized wins under the shared event lock; after possible dispatch commits an email may still arrive. No external provider guarantee can retract it.

## H. Email/delivery architecture

Use dedicated confirmation and restock deliveries and an independent worker. Join transaction atomically commits enrollment plus one confirmation row; browser lifetime is irrelevant. Worker prepares React Email HTML+text, server-controlled From/Reply-To and normal public links, encrypts payload and commits it before any provider call.

Confirmation: event, tier, date/time, venue, no-reservation explanation, Leave Waitlist. No purchase CTA while sold out. Duplicate joins produce no additional confirmation.

Restock: current tier name/price and current public event facts at preparation, normal `/events/:eventId/tickets` CTA, Leave Waitlist, and both “Availability is not guaranteed” and “Tickets are available again, but they may sell out before you complete checkout.” No private checkout, discount, auto-selected quantity, ticket grant or bearer on the purchase CTA. Freeze provider bytes at first preparation; on pre-dispatch material-fact change suppress stale content rather than mutate an idempotent request. Normal selection remains the final price/availability authority.

Stable key: `waitlist/<delivery UUID>`. Preserve provider accepted separately from inbox-delivered observation. Mirror bounded unknown/retry mechanics, with no blind new-key retry and no second provider call after accepted. Recheck lifecycle, suppression and current restock availability at dispatch authorization. Stops after possible dispatch preserve accepted/unknown history. Confirmation does not count toward the restock cap.

Extend shared suppression with `waitlist_delivery_id` provenance and an exactly-one-of-three constraint. Update all three writers to clear other provenance columns on conflict. Extend `server_observe_email` to dispatch only when exactly one ledger owns the attempt UUID. Add cross-ledger webhook-ID collision checks in all observation routes; checking only the new Waitlist observer is insufficient. Reuse existing signed Edge handler unchanged unless tests expose a necessary narrow adjustment.

Capacity is a third explicit lane: no ticket grants/outbox and no organizer campaign/recipient quotas. Dispatch reservations must be atomic within Waitlist. Before activation, the sum of configured ticket, organizer and Waitlist budgets must fit provider limits with ticket headroom; separate database counters alone do not guarantee provider-level isolation. Leave capacities unset/disabled until verified.

## I. Leave-token design

Use a separate `wl1_` token namespace with 32 cryptographically random bytes; hash with a Waitlist-specific SHA-256 domain separator. Store only its hash in authorization records. Do not reuse ticket/recovery grants or expose enrollment UUID/email in the URL.

During each delivery's initial preparation, generate a token, build `/waitlist/leave#<token>`, encrypt the complete immutable email payload, and atomically save the token hash plus encrypted payload under the lease. A retry uses the saved payload. A lost preparation response must read the winning stored payload, not overwrite it with a new token. Thus earlier confirmation links and later restock links all remain valid for **that enrollment only**, without storing a recoverable raw token column. The encrypted email necessarily contains its link, just as existing encrypted email payloads do; raw bearer is never logged or persisted in plaintext.

Capture and scrub fragment synchronously before application routing, using a separate bounded tab session (24-hour local session default) and memory fallback. No localStorage, analytics, query-string token or referrer leakage. Show a simple “Leave Waitlist” confirmation button; GET/navigation alone makes no mutation, protecting against mail-link scanners. POST token in body; server hashes/looks up exact enrollment and removes it idempotently. Invalid/expired links get generic unavailable; valid repeat removal gets the same completion message and no private metadata. A token for an already Purchased enrollment is a harmless completed removal response without rewriting Purchased history.

Server link expiry: event end + 90 days or enrollment removal/purchase + 90 days, whichever is earlier once terminal. Token never authorizes a future re-enrollment. Leaving must remain available when acceptance/delivery flags are off. A stop that wins before possible dispatch blocks mail; it cannot unsend an already authorized dispatch.

## J. Organizer UX

Add one protected route `/organizer/events/:eventId/waitlist`, reachable from the existing Event Dashboard and a small Tickets-page link. Dashboard implementation is `src/features/ticket-experience/dashboard/EventDashboardPage.tsx`.

Tier summary: name + active waiting count (Waiting and Notified, excluding purchased/removed/operationally closed). Click tier to see owner-scoped paginated Name, Email, Joined, Status. Page size 50, stable `(joined_at,id)` cursor; no queue-position column or implied priority. Sort newest first for operational browsing.

Waiting = active with no accepted restock; Notified = active with at least one provider-accepted restock. UI explanatory text says notification was sent, not that it reached the inbox. Terminal status wins over Notified. Confirmation alone does not make a row Notified. No provider diagnostics.

Include a small confirmed “Remove from waitlist” row action for active members, server ownership checked with event+tier+enrollment scoping. No custom composer, export, upload, reorder, priority, manual blast or reservation control. Empty/loading/error and closed-list states required. Counts may lag purchase reconciliation briefly; never use them as ticket inventory.

## K. Buyer UX

Extend existing `TicketTierList` and `PublicTicketEventPage` without changing cart math. Sold-out eligible tiers show Sold out + Join Waitlist, available tiers retain quantity controls. Unknown/stale availability is Unavailable, never Join Waitlist. The all-sold-out heading already exists; retain it with actionable per-tier joins.

Use an inline expandable form per selected tier: Name, Email, Join Waitlist, cancel. This avoids nesting form/modal focus behavior inside the existing ticket fieldset. No quantity/account/marketing fields. Clear no-ticket-reservation text. Preserve the current purchase cart and price-change review behavior while opening/closing the form.

Success, including duplicate: “You’re on the waitlist. We’ll email you if GA tickets become available.” No enrolled metadata. On TICKETS_AVAILABLE, close the form, refetch ticket data, announce availability and focus that tier's normal controls; do not automatically reserve, submit checkout or silently change quantity. If refresh fails, show retry rather than claiming purchase readiness.

At event start, hide/close joins and show waitlist closed; server remains authoritative despite client-clock differences. Support mixed tiers, all sold out, 390px and desktop, keyboard, associated labels/errors, aria-live feedback and predictable focus restoration. Keep existing buyer and organizer visual contracts; no unrelated redesign.

## L. Scheduler/worker design

Two independently authenticated/gated Edge entry points: `waitlist-observer` and `waitlist-email-worker`. Public join/leave are separate small HTTP façades; organizer reads/removal use authenticated owner RPCs. Service-only observer/delivery RPCs are never browser executable.

Observer cadence recommendation: 60 seconds, tolerating 1–2 minute latency at normal demand. Claim due tier with Waitlist-only lease, commit claim, then call a bounded observation transaction. **Never hold a claimed Waitlist row lock while attempting the event ticketing lock.** Fair next-check ordering prevents a busy tier starving others. Batch defaults: 25 tiers per invocation, 100 enrollment reconciliation/fanout rows per transaction, configurable downward for lock budgets. Continue durable cursor work across invocations without truncating recipients.

Use the existing event advisory-lock key for a nonblocking try-lock; contention yields a deferred observation, not a held checkout transaction. Join uses short bounded lock acquisition and retryable failure. Rendering/encryption/provider calls happen outside ticket/payment locks. Delivery worker uses short claim/preparation/dispatch transactions and small configurable concurrency; not a one-email-per-minute design for a large restock.

Retain due sweeps for active entries during sold-out periods and close entries at lifecycle boundaries. Keep undispatched/potentially dispatched work visible to maintenance even after active demand reaches zero. No cron jobs or worker enablement in the schema migration. Future scheduler/health/pruning installation is a distinct activation task.

Retention default: purge enrollment name/email and encrypted payloads 90 days after terminal closure, once no dispatch/lease/retry needs them; retain minimal immutable non-content receipts and suppression provenance. No purge can undermine retry idempotency, leave behavior within its stated lifetime, audit state or anti-spam accounting. Abuse history needs at least its longest rolling window; dispatch accounting follows configured capacity windows.

## M. Rate limits/anti-spam

Configurable defaults, independent Waitlist namespace:

| Limit | Default |
|---|---|
| Normalized email + tier join attempts | 3/hour, 10/rolling 24 hours |
| Trusted IP join attempts | 60/hour, 300/rolling 24 hours |
| Restock deliveries per enrollment | 1 per availability cycle, at most 3/rolling 24 hours |
| Leave requests per trusted IP | 60/hour, 300/rolling 24 hours; invalid tokens included |
| Worker lease / retry ceiling | 2 minutes / 6 possible calls within 23 hours |

Count duplicate join attempts too. Use independently namespaced keyed IP/email fingerprints; never browser-supplied IP or guessed forwarded headers. Require a configured gateway-overwritten trusted IP source, following ticket email HTTP precedent. Rate accounting must commit for rejected/rate-limited attempts rather than roll back in a raised exception.

For restock cap, serialize by enrollment; count distinct deliveries with first possible dispatch in the preceding 24 hours, including unknown results. Retries of the same delivery do not consume a new notification slot. At enqueue, cap-exhausted members receive a terminal suppressed delivery receipt for that cycle, preserving uniqueness without scheduling a send; at dispatch, recheck to prevent queued cycles racing past the cap. They remain enrolled. Do not burst-send skipped historical cycles when the window clears; they qualify at a subsequent observed restock. Never silently drop a member because a worker batch ended.

No organizer or transactional capacity borrowing. No CAPTCHA or global contact system in initial scope; anonymous enrollment abuse beyond these budgets is an operational risk to measure before activation.

## N. Security/privacy

Strict bounded JSON schemas; reject recipient arrays, organizer IDs, sender/Reply-To, HTML, state/cycle/price overrides and provider payloads. Server assembles all facts. Browser never receives recipient lists except authenticated event-owner views. No cross-event search or CRM. Names are escaped text in UI/email.

Private tables deny direct reads/writes even to authenticated organizers. Owner RPC validates auth.uid against event organizer on every page/removal; foreign/missing event responses are equivalent. Worker façades require independent secrets and default-off flags in addition to service RPC grants. Use empty SQL search_path and explicit grants.

Shared suppression HMAC identity must remain exactly compatible with ticket and organizer lanes; independent abuse keys must not change that identity. Suppressed join returns the same generic success and commits no deliverable email. Provider/payload/token/recipient data must not enter logs, errors, telemetry, URLs or public cache. POSTs and private owner/leave responses use no-store; bearer route uses no-referrer. Origin checks are useful browser controls, not standalone authentication.

## O. Concurrency/locking analysis

Existing hierarchy: event advisory lock → tier UUID order → event → order UUID order. Payment fulfillment/refunds use `private.lock_payment_order` from `20260902010300_add_checkout_item_reconciliation.sql`. Waitlist must join this hierarchy, never acquire it after holding enrollment/delivery locks from a previous phase.

- Join/opening: after acquiring event/tier/event locks, fresh-time inventory read linearizes join. Clock-driven expiry is handled in the post-lock read. Inventory writers cannot reopen behind a knowingly stale check. A release after that linearization is an ordinary subsequent transition.
- Same email/tier joins: serialized short transaction plus partial unique constraint gives one enrollment and one confirmation. Lost response safely retries.
- Multiple observers: event boundary and tier-state lock atomically increment one epoch; cycle/delivery uniqueness backs it up.
- Fanout: bounded page under ticketing boundary finalizes membership, reconciles purchases, commits cursor+delivery rows. Checkout gets the lock between pages. No full-list fanout while holding it.
- Purchase/leave vs dispatch: begin-dispatch obtains event boundary before enrollment/delivery locks, rechecks truth and commits possible dispatch. Leave takes enrollment lock only and never waits for event lock, avoiding inversion. Lifecycle change after authorization may still race with the network call; preserve evidence and stop subsequent attempts when disallowed.
- Rate/capacity locks: separate transactions/namespaces or a single documented total order; never hold Waitlist global capacity while waiting for a payment/event lock. Payload preparation and lease claims release their locks before begin-dispatch.
- Moderation/cancellation: event-row protection plus current canonical eligibility; final dispatch recheck. No promise to retract an already authorized message.

Performance proof must measure checkout under concurrent observer/fanout/join load. “Read-only inventory” does not imply zero contention. Bound locks and skip busy workers; do not change checkout to make Waitlist tests pass.

## P. Exact testing/proof plan

Build + Prove must produce evidence, not only mocked happy paths:

1. **Inventory equivalence:** compare extracted helper, pre-change public RPC and checkout acceptance for every order state; active/expired/exact-boundary/null reservations; quantities 0/1/many/overcommitted; multi-tier carts; partial/full refunds; used tickets; capacity edits. Public JSON shape/order unchanged. No order mutation from helper/Waitlist.
2. **Join policy:** sold-out success; available/TICKETS_AVAILABLE; free/draft/cancelled/started/ended/blocked/removed/held/revision mismatch/invalid schedule/inactive tier/wrong event denied; disabled gates; malformed/oversized/control-character input; server-only fields rejected.
3. **Dedupe:** case/outer whitespace, dots/plus preservation, concurrent duplicates, different tiers, new enrollment after Removed/Purchased, old token cannot remove new enrollment, active duplicate neither renames nor re-confirms. Generic response equivalence.
4. **Cycles:** first sold-out baseline; sold-out→available once; repeated available no cycle; available→sold-out→available next cycle; capacity increase; reservation expiration without cron; full refund; partial refund remains protected; concurrent workers; interrupted fanout resumes; joins after cycle excluded; transient state paused and terminal closure stops notifications. Explicit test of unobserved pulse producing no invented epoch.
5. **Purchase:** strictly later paid/reconciled/coherent same-email same-tier order qualifies; prior/equal-time purchase does not; multi-tier matches only purchased tiers; used ticket qualifies; processing/session/reservation/failed/expired/wrong-tier/incoherent/review/refund state excluded; delayed old paid_at case documented; observer reconciles even while sold out. No fulfillment writes.
6. **Mail:** one confirmation/enrollment and restock/epoch; cap across concurrency and exact 24-hour boundary; unknown consumes slot; retry same identity/bytes; signed webhook replay/out-of-order/cross-ledger collision; all suppression directions; no grants/campaigns/tickets. Crash before/after payload save, possible dispatch, provider acceptance, DB result; invalid envelope/key; lease loss; six-call/23-hour boundary; provider accepted is not delivered.
7. **Leave/security:** strong-token/hash-only authorization, URL fragment scrub before app startup, no GET mutation, repeat/invalid/expired token, no foreign enrollment effect, disabled-send leave still works, removal versus dispatch, owner/foreign/anonymous access and direct table/RPC denial. No secrets/PII in browser bundles, logs or error responses.
8. **Real DB concurrency:** join vs reservation expiry across lock wait; join vs capacity increase/refund; duplicate joins; two observers/fanout crash; purchase before membership and before dispatch; removal versus dispatch; global capacity and per-entry cap; cancellation/start crossed during waits. Separate connections and deliberate barriers, not sequential SQL masquerading as concurrency.
9. **Scale/load:** at least 1,000 local enrollments/notify-all simulated deliveries, fair progress across busy tiers, bounded fanout, no list truncation, measured lock duration and checkout latency versus pristine main. EXPLAIN indexed purchase lookup; no provider network.
10. **Browser:** mixed/all sold out and one sold-out tier; form, success/duplicate, reopening mid-form, started/closed/unavailable, retry/refresh failure, preserved cart/price review, organizer counts/pagination/removal/foreign access, secure leave, 390px/desktop, keyboard/focus and inspected screenshots.
11. **Regressions:** Checkout Integrity, payment/refund/ticket issuance, ticket email/recovery, Email Attendees source audience unaffected, CSV unchanged, Duplicate Event fresh tier IDs with no enrollment/cycle/token/delivery copies, check-in unchanged, public/storefront projection stable.
12. **Verification:** frontend and Deno tests, SQL and real JWT→Edge→PostgREST tests, typechecks/lint/build, production bundle boundaries, migration/reset on isolated local DB, final full diff/security review. Compare known SQL/CSP failures against pristine then-current main; any feature-only failure blocks completion. Do not claim legacy suites universally pass.

No implementation tests were run in this inspection. Existing Email Attendees report's numbers are historical evidence, not Waitlist proof.

## Q. Smallest implementation outline/files/migrations

This is a scoped outline for later approval, not an executable implementation performed now.

1. Freeze baseline + inventory equivalence fixtures. Add one narrow migration for shared read helper and public-projection equivalent replacement, with rollback/equivalence proof. Do not replace reserve/fulfill/refund functions.
2. Add one Waitlist domain migration: tables/indexes/constraints, join/leave/owner RPCs, observer/cycle/fanout/reconciliation, leases/dispatch/limits/retention, shared suppression third provenance and verified webhook dispatch. All gates false, no scheduler installation. Generate database types.
3. Add anonymous façades and independent observer/delivery workers; templates; unit/HTTP/DB/concurrency proof. Reuse immutable encryption/provider machinery without widening ticket purposes.
4. Add buyer inline form, leave route/fragment handling, owner list/removal and entry links. Run browser/visual proof.
5. Run differential regressions/security review and return Build + Prove report. Activation remains separate.

Likely new files:

- `supabase/migrations/<timestamp>_share_ticket_inventory_read.sql`
- `supabase/migrations/<timestamp>_add_waitlist_v1.sql`
- `supabase/functions/waitlist-join/index.ts`, `waitlist-leave/index.ts`, `waitlist-observer/index.ts`, `waitlist-email-worker/index.ts`
- `supabase/functions/_shared/waitlistHttp.ts`, `waitlistWorker.ts`, `waitlistEmail.ts`, `_shared/emails/WaitlistEmail.tsx`, focused colocated tests
- `src/features/waitlist/{WaitlistJoinForm,WaitlistLeavePage,OrganizerWaitlistPage}.tsx`; scoped API/schema/query/session/style files/tests
- `tests/integration/waitlist-v1*.sql`, local flow/concurrency/regression harnesses; `tests/e2e/waitlist.spec.ts`; specification and proof reports

Likely existing edits:

- `src/features/tickets/TicketTierList.tsx`, `PublicTicketEventPage.tsx`, their tests
- `src/features/ticket-experience/dashboard/EventDashboardPage.tsx`, `src/features/tickets/OrganizerTicketTiersPage.tsx`, their tests
- `src/app/router/router.tsx`, `src/main.tsx` for early Waitlist fragment capture
- `src/lib/supabase/database.types.ts`
- `supabase/config.toml`, `.env.example`, Deno/test discovery configuration as needed
- Shared webhook/suppression SQL via the new migration; existing Edge webhook tests for third-domain routing
- Narrow bundle-boundary/test scripts only if required for new fixtures/secrets

No mandatory changes to checkout creation, fulfillment, refund handlers, ticket issuance, Duplicate Event implementation, CSV serializer or Email Attendees audience sources.

## R. Scope guard

Paid active-tier Waitlist only. No free RSVP, reservation/hold, queue position, fairness order, timed/exclusive offers, notify-next, buyer accounts, automatic charging, quantity request, marketing preference, priority, manual blast, CRM/import/export, SMS/push, transfers, dynamic pricing, Staff Access or unrelated baseline fixes. No schema/deployment/provider action performed by this inspection.

## S. Risks and remaining decisions

No blocking founder question; ordinary choices above are delegated recommendations.

- **Observed cycles only:** required polling cannot guarantee unseen transitions. This is the central limitation, explicitly part of recommended V1. If “every physical transition” is required, readiness becomes no until writer-event scope is approved.
- **Lock/time correctness:** helper equivalence and post-lock timestamps are proof gates, not assumed solved by writing SQL.
- **Purchase timestamp:** paid_at is current authoritative application timestamp, not commit/provider time; conservative delayed reconciliation cases may receive a redundant notification. Do not rewrite fulfillment for this.
- **Shared-provider capacity:** independent counters need real reserved capacity allocation before activation. A large notify-all list takes time and may sell out before dispatch/open; no reservation guarantee.
- **Public eligibility changes:** unresolved moderation/policy outage pauses; explicit cancellation/block/removal/start/archive closes. Preserve historical status and distinguish paused/closed in owner UI. Re-publication never silently restarts a terminally closed enrollment.
- **Anonymous abuse:** rate limits reduce but do not eliminate unsolicited signups. No double-opt-in is added because immediate one-step enrollment is locked intent; monitor before broad activation.
- **Operational truth:** suppression can prevent confirmation/restock while public join remains generic; accepted does not prove inbox delivery. Domain closure/suppression/purchase can stop queued sends.
- **Existing baseline debt:** older tier quantity guard and documented SQL/CSP failures remain outside scope; differential tests must expose any new failure.

## T. Final recommended V1 specification

An upcoming publicly eligible paid tier becomes sold out under the exact existing protected inventory rules. An accountless buyer submits name/email; the server rechecks current truth under the ticketing boundary, creates one active enrollment and one durable confirmation, and reserves nothing. Existing duplicate enrollment returns the same safe success.

An independent observer polls open-demand tiers, records durable observed availability, opens one epoch on each observed sold-out→available transition, reconciles later qualifying purchases and considers every eligible member with resumable fanout. Independent durable delivery enforces one restock per epoch and three per enrollment per rolling day, shared suppression, current lifecycle/availability and reserved worker capacity. Emails direct to normal ticket selection and securely allow removal. Normal checkout exclusively controls reservations and ticket purchase.

The owner sees per-tier demand and a small event-scoped list with optional confirmed removal. No priority or manual campaign tooling. Purchase/removal/terminal lifecycle stops future sends. All new runtime gates ship off; hosted migrations, functions, schedules, sender/DNS/provider settings, capacity and real-mail proof require a separate activation task.

Inspection outcome: **ready for Build + Prove following founder review; no implementation, migration, push, merge, deployment, scheduler activation or email sending performed.**

## Evidence navigation

Primary inspected sources (all at the main SHA above):

- [Public inventory and cart reservation](/Users/exoh/Desktop/WhereTo-main-final/supabase/migrations/20260902010100_add_checkout_cart_reservation.sql:528)
- [Current public eligibility](/Users/exoh/Desktop/WhereTo-main-final/supabase/migrations/20260826010450_harden_public_eligibility_reads.sql:1)
- [Payment locking hierarchy](/Users/exoh/Desktop/WhereTo-main-final/supabase/migrations/20260902010300_add_checkout_item_reconciliation.sql:128)
- [Current order coherence](/Users/exoh/Desktop/WhereTo-main-final/supabase/migrations/20260923010100_optimize_organizer_order_coherence.sql:8)
- [Organizer message ledger and shared suppression](/Users/exoh/Desktop/WhereTo-main-final/supabase/migrations/20260924010600_add_organizer_messages_v1.sql:1)
- [Provider transport/signature parsing](/Users/exoh/Desktop/WhereTo-main-final/supabase/functions/_shared/ticketEmailProvider.ts:1)
- [Paid buyer UI](/Users/exoh/Desktop/WhereTo-main-final/src/features/tickets/PublicTicketEventPage.tsx:116)
- [Tier selection UI](/Users/exoh/Desktop/WhereTo-main-final/src/features/tickets/TicketTierList.tsx:1)
- [Organizer dashboard](/Users/exoh/Desktop/WhereTo-main-final/src/features/ticket-experience/dashboard/EventDashboardPage.tsx:198)
- [Existing secure fragment handling](/Users/exoh/Desktop/WhereTo-main-final/src/features/ticket-delivery/delivery.session.ts:13)
