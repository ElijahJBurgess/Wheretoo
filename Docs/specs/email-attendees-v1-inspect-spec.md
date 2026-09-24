# Wheretoo — Email Attendees V1 inspection and specification

Status: founder review; planning only. Inspected 2026-09-23. No implementation authorized or performed.

## Inspection baseline

Fetched remote main before inspection. Remote `origin/main` and inspected detached HEAD: **8138cdf2d6f84ff98d7ca42b595a9f87f9f7b66a** (integrated Duplicate Event V1). Canonical main checkout: `/Users/exoh/Desktop/WhereTo-main-final`. Inspection/report worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/email-attendees-v1-inspect`. The dirty recovery checkout at `/Users/exoh/Desktop/WhereTo -  Repository` was preserved. This report is the only task output.

Read the supplied governing brief and execution request, AGENTS.md, and `Docs/WHERETO_V1_PRODUCT_DEFINITION.md`, `Docs/WHERETO_V1_USER_FLOWS.md`, `Docs/WHERETO_V1_TECHNICAL_ARCHITECTURE.md`. The latest explicit brief permits this narrowly scoped organizer communication; it does not reopen deferred consumer messaging. References below are repository-relative current-main paths and symbols, not assertions about deployed configuration. No live credentials, provider settings, or hosted customer data were inspected.

## A. Current email architecture

| Evidence | Current behavior / reuse boundary |
| --- | --- |
| `supabase/migrations/20260913010000_create_ticket_email_foundation.sql` | Private settings, grants, members, outbox, observations and rate events. Outbox records represent ticket-related sources or recovery requests; immutable payload and access-grant relationships are enforced. Do not add an organizer purpose. |
| `20260913010100_add_ticket_email_worker_contracts.sql` in the same directory | `server_claim_ticket_email`, prepare/save/begin/finish/stop RPCs. Claim uses SKIP LOCKED, two-minute leases. Stale sending becomes unknown. Six dispatches, 23-hour retry boundary, persisted first-possible-dispatch time. Reuse the state-machine pattern, not grant-dependent RPCs. |
| `20260913010200_add_ticket_email_entry_points.sql`, `20260913010400_preserve_initial_email_deduplication.sql` | Initial enqueue, durable initial receipts, organizer resend request IDs, recovery entry points and scoped reads. Organizer messaging must invoke none of these. |
| `20260913010600_add_email_retention_and_recipient_suppression.sql` | Final general source/finish/observe/prune implementation; hashed bounce/complaint block list, immutable encrypted payload retention, verified observation precedence. Later notice migrations override prepare/begin. |
| `20260914010200_add_refund_notice.sql`, `20260915010200_add_event_notices.sql` | Refund and event-change/cancellation notices extend the ticket ledger and scoped access. `private.event_notices` and `event_notice_sources` preserve revision/source receipts. Notice audiences enqueue per source, not per unique email; therefore their submission function cannot implement this feature. |
| `supabase/functions/ticket-email-worker/index.ts` and README | POST with dedicated worker secret; environment AND database enable gates; at most three claims per invocation, refund-notice enqueue first. No scheduler installed by this code. Repository defaults are inactive; deployment state is unverified. |
| `supabase/functions/_shared/ticketEmailWorker.ts` | Parses ticket/refund/notice contexts, creates grants and bearer URLs, renders once, saves immutable encrypted provider payload, dispatches with stable key and lease checks. Reuse key loading and low-level patterns, never call `processTicketEmail` for organizer mail. |
| `supabase/functions/_shared/ticketEmailAccess.ts` | Canonical ASCII email validation, AES-GCM authenticated envelopes and strict provider payload validation. Provider context already accepts `grantId: null`; use that with an organizer delivery UUID. This creates no grant. Do not call `createEmailGrant` or `grantExpiresAt`. |
| `supabase/functions/_shared/ticketEmailProvider.ts` | Resend HTTP adapter: one recipient, reply-to, HTML/text, attempt tag, idempotency header, 15-second timeout, no SDK retries. Accepted requires provider ID; transport errors, throttling/conflicts/server failures are unknown; selected definite rejections are failed. Safe shared transport. |
| `supabase/functions/ticket-email-webhook/index.ts` | Bounded raw body (64 KiB), verified signature through provider helper, then `server_observe_ticket_email`. Provider helper requires signed attempt UUID and provider email ID. Extend routing only after signature verification. |
| `src/features/ticket-experience/email/{email.types.ts,renderEmail.ts,EmailFrame.tsx,emailStyles.ts}` | Shared React Email renderer and visual primitives. Existing templates: Tickets Ready, Recovery, Ticket/Order Refunded, Event Changed, Event Cancelled. Share rendering/spacing, explicitly replace ticket-specific action/privacy copy. |

Configured sender inputs are `TICKET_EMAIL_FROM` and `TICKET_EMAIL_SUPPORT_EMAIL`; provider credential is `RESEND_API_KEY`; signed observation secret is `RESEND_WEBHOOK_SECRET`. Encryption uses `TICKET_EMAIL_PAYLOAD_KEY_ID` and `TICKET_EMAIL_PAYLOAD_KEYS_JSON`. Existing worker uses support as reply-to. No values are assumed configured or verified here.

Existing rate settings intentionally have NULL limits until approval. Organizer messaging must not consume the resend/recovery lanes or enable those settings.

## B. Authoritative customer truth

Paid identity is `public.orders.buyer_email`, normalized with `lower(btrim(...))`; never a ticket holder identity. `order_items.ticket_tier_id` plus immutable `tier_version`, `tier_name`, quantities and prices represent the purchase. The original one-item constraint was removed by `20260902010000_expand_checkout_integrity_schema.sql`; multi-tier orders are supported. Tier FKs restrict deletion; archived tier IDs remain targetable.

The latest `private.organizer_order_coherent` is in `20260923010100_optimize_organizer_order_coherence.sql:8`. It checks organizer/event/admission alignment, test-mode/USD current system constraints, financial state consistency, item totals, exact ticket count, and both directions of ticket/item linkage. It explicitly permits used tickets, cancelled tickets on cancelled paid events, and used tickets retained on refunded orders. Used alone therefore cannot establish active financial eligibility.

`private.organizer_refund_state` (`20260910010350_add_owned_refund_evidence_recovery.sql:2`) is the older available/pending/recoverable projection. Prefer the newer operational truth `private.order_refund_state` (`20260914010000_add_refund_operations.sql:46`) because it includes a refund operation claimed before a refund row exists: submitting, processing, unknown, review, failed, completed, eligible/ineligible. Existing event-change notice qualification already requires `order_refund_state(o)='eligible'`. Use that conservative precedent; do not infer eligibility from `status='paid'` alone.

Free identity/status/coherence is in `20260912010000_create_free_registration_source.sql`: `free_registrations.email` is normalized ASCII by constraint, status confirmed/cancelled; quantity is a group reservation. `private.free_registration_is_coherent` verifies the durable request outcome, source identity and complete admission set. Cancellation changes registrations to cancelled and cancels valid admissions while retaining used history. `free_registration_requests` includes rejected requests and is not an audience table.

Event ownership is `events.organizer_id=auth.uid()` (organizer ID references auth user ID). Staff access does not imply organizer messaging permission. Schedule is canonical `events.starts_at/ends_at/timezone`; “ended” is derived, not a stored event status. Public eligibility is deliberately stricter than messaging: `private.event_is_publicly_eligible` requires `ends_at > as_of`, so it cannot gate the seven-day follow-up window.

## C. Exact proposed audience and event rules

All rules apply server-side, including individual sends. Invalid/malformed canonical emails are excluded. Incoherent otherwise relevant source data makes preview unavailable rather than returning a misleading partial count. Normalization is lower(trim(email)), ASCII syntax matching `canonicalEmail`; preserve dots and plus aliases. Do not merge Gmail aliases or invent Unicode-address support. Distinct normalized addresses define people for this feature; use identical normalization for suppression hashing.

Paid qualifying source predicate:

- Order belongs to the owned paid event and passes `organizer_order_coherent`.
- `status='paid'`, `paid_at IS NOT NULL`, `refunded_at IS NULL`, `reconciliation_status='reconciled'` and `private.order_refund_state(o)='eligible'`.
- At least one admission for the selected scope is valid or used. No requirement for an unused ticket. For Everyone/individual, scope is the order; for tier scope it is tickets tied to matching purchased items.
- Exclude pending/unpaid/expired/failed/cancelled orders, fully or partially refunded, review/unknown/submitting/processing refund state, and failed refund state under the conservative existing event-notice rule. A failed refund does not prove payment disappeared; exclusion reflects unresolved operational eligibility, not a new financial interpretation. Founder confirmation of this conservative rule is requested below.

| Selector | Resolution before global suppression and dedupe |
| --- | --- |
| Paid Everyone | All qualifying orders for this event; union their buyer emails. One qualifying order suffices even if another order for the same email is refunded. |
| Paid Ticket Tier | Selected UUID must belong to this event. EXISTS purchased item with `i.order_id=o.id AND i.ticket_tier_id=selectedId` and a valid/used admission tied to that item. Current tier status/name does not control relationship. Deduplicate after filtering. |
| Paid Individual | Exactly the owned event/order reference must qualify. Resolve that order's buyer email. Do not silently rescue an inactive selected order through another purchase; direct the organizer to a qualifying order or Everyone. |
| Free Everyone | `r.event_id=event.id`, owner matches, `r.status='confirmed'`, `cancelled_at IS NULL`, coherence true, at least one valid/used admission. Group quantity is not recipient count. |
| Free Individual | Same predicate on exactly the owned registration ID. No arbitrary address input. |

Tier picker includes current event tiers plus historically purchased archived tiers, grouped by UUID. Use current authoritative name with archived badge; immutable purchased name can supply explanatory historical labeling. Matching never uses names. Renaming/reordering does not move purchases between tiers. Two IDs with the same name remain distinct choices. Free events reject tier selectors, including forged requests.

Event policy proposal (requires approval where indicated):

| State | New send |
| --- | --- |
| Draft | Denied even with imported or anomalous customer rows. |
| Published, clear, upcoming or in progress | Allowed subject to audience, schedule, moderation holds and limits. |
| Published, clear, ended | Allowed through the exact boundary `server_now <= ends_at + interval '168 hours'`. No local-calendar/DST rounding. |
| After boundary | Denied. Server timestamp and canonical current end decide. |
| Cancelled | Recommend deny new organizer messages in V1; existing cancellation notices remain the supported path. This is a founder decision, not a silently approved exception. |
| Under review / flagged / not evaluated | Recommend deny pending clearance, even if previously public. |
| Blocked / removed or active blocking hold | Denied regardless of audience, timestamp or display status. |
| Missing/nonfinite start or end; end <= start; invalid timezone | Denied with schedule-unavailable explanation. |

Cancellation conflict: free cancellation makes every registration inactive, so the locked exclusion rule yields zero. Paid cancellation can retain used tickets and paid orders while cancelling remaining admissions. Allowing only these residual used paid relationships would create inconsistent follow-up semantics. Supporting all former attendees would require a new historical/cancelled audience exception, which is outside locked rules. Recommended narrow resolution: deny cancelled sends; do not alter cancellation notices.

Do not use the public eligibility function directly for messaging; factor a dedicated event-policy helper that explicitly evaluates current moderation/holds without imposing future end time. Schedule edits before confirmation change the fingerprint and window. After confirmation, membership and scheduled-end basis are frozen. Refund/cancellation/check-in/new purchases later do not add/remove recipients. New platform blocked/removed/holding moderation safety states can stop remaining dispatches; preserve rows and count. Already accepted mail cannot be recalled. Seven-day expiry alone never stops validly queued mail.

## D. Delivery architecture decision

Choose a **separate organizer message and recipient outbox**, with the existing provider adapter, nullable-grant encryption context, renderer and verified webhook parsing reused. Do not extend ticket purposes or call ticket worker/source eligibility.

Extending ticket outbox would require false source/grant relationships and incompatible post-event access rules. Building a universal mail platform would broaden this task substantially. A separate small queue with explicit state-machine contracts preserves domain meaning and failure isolation. One message is immutable content and request receipt; one recipient row is the immutable audience snapshot plus delivery state. No additional per-retry attempt table is required: the stable recipient delivery UUID identifies all retries. Observations remain separate because webhook replay/precedence is durable evidence.

## E. Proposed migration, records and contracts

No migration created. Future migration suffix: `add_organizer_messages_v1.sql`, timestamp later than the then-current last migration (currently `20260924010500_add_duplicate_event_v1.sql`). Use private tables, RLS with no browser policies, revoked direct access including service-role table access, and narrow security-definer RPCs with empty search_path and explicit grants.

| Proposed record | Required fields / constraints and purpose |
| --- | --- |
| `private.organizer_messages` | UUID id; event_id and requested_by FKs; globally unique request_id; request_digest; selector kind/reference; preview fingerprint; canonical subject/body; frozen event/organizer/sender/template facts JSON with explicit schema; confirmed_at, deadline_basis, recipient_count > 0; content_purged_at. Durable request receipt and immutable content. Immutable identity/digest/count survives content retention. |
| `private.organizer_message_recipients` | UUID id (provider attempt identity); message_id FK; canonical normalized_email, shared recipient_hash, optional private source-provenance JSON of qualifying kind/IDs; UNIQUE(message_id,recipient_hash); state queued/sending/accepted/failed/unknown/suppressed; provider_id unique; encrypted payload; first_possible_dispatch_at, dispatch_count, next_attempt_at, lease_id/until, stop_reason, observation, accepted_at, created/updated/payload_purged_at. Sole recipient snapshot/outbox; encrypted provider payload frozen before first dispatch. No grants or admission credentials. |
| `private.organizer_message_observations` | webhook_id PK; recipient delivery FK; provider_id, kind, observed_at, received_at. Durable signed evidence, duplicate/conflict checks and precedence. |
| `private.organizer_message_settings` | Singleton: accepting_sends=false, worker_enabled=false; approved numeric limits nullable; preview-HMAC secret; capacity allocation/configuration acknowledgement; worker health timestamp; allowlisted non-secret sender mailbox, support address, app/media origins and template version written only by service configuration. Separate controls; fail closed while unconfigured. No changes to recovery/resend limits. |
| `private.organizer_message_rate_events` | Lane, keyed identity hash, message/request reference, timestamp, recipient units. Necessary sliding-window actor/event/recipient-volume reservations; reserve once in the same send transaction. Index(lane,identity_hash,at). |

Indexes: unique request_id and provider_id; recipient uniqueness above; partial ready index `(next_attempt_at,id)` for queued/sending/unknown unstopped work; recipients(message_id); observations(recipient_id); messages(event_id,requested_by,request_id) only if needed beyond PK/unique lookup. Existing orders/event, registration/event and order-item/tier indexes support resolution; verify query plans before adding redundant audience indexes. No contact/customer table, no source-membership grant table, no analytics schema.

Guard triggers prevent updates to selector, recipient identity, snapshot, confirmed count, request digest and first dispatch basis; payload cannot be replaced after preparation; dispatch counters only increase. Only narrow retention RPC may null sensitive payload/content fields and recipient address/provenance after terminal retention; keep the immutable recipient hash, delivery identity and minimal receipt. Nullable post-purge fields must carry an explicit purge timestamp, never become dispatchable again. Retain request receipt indefinitely for V1 (no automatic request-ID reuse); propose 90-day terminal operational retention, accepted payload removable only after retry safety window, unknown payload retained at least 90 days and dispatch stopped. Keep minimal rows referenced by suppression/evidence. Retention values require approval; do not delete idempotency evidence when clearing content.

Contracts (names proposed, all new unless marked):

| Contract | Why necessary / output |
| --- | --- |
| `get_owned_organizer_message_options(event_id)` | Authenticated owner-only event availability/deadline and tier IDs/labels; no customer list. |
| Private `organizer_message_event_policy`, `organizer_message_audience`, `organizer_message_preview` | One implementation of window/moderation, exact audience and canonical fingerprint reused by preview/submit. Internal resolver may return private addresses; never grant it directly. |
| `preview_owned_organizer_message(event_id, selector, subject, body)` | Authenticated; count, audience label, deadline, canonical rendering facts/template version, content digest, opaque fingerprint and canSend/reason. No recipient address/name array or ticket information. |
| `submit_owned_organizer_message(event_id, selector, subject, body, fingerprint, request_id)` | Authenticated atomic revalidation, limit reservation, message+all recipients creation. Returns immutable `{messageId,requestId,queuedRecipients,confirmedAt}` after commit. No provider call. |
| `get_owned_organizer_message_receipt(event_id,request_id)` | Authenticated lost-response reconciliation; same receipt or not_found, never content/recipient list. Ownership checked even for existing IDs. |
| `server_claim_organizer_message_recipient` | Service-only bounded SKIP LOCKED lease and recovery of expired sending to unknown; checks separate enable/priority/capacity gates. |
| `server_prepare_organizer_message_recipient`, `server_save_organizer_message_payload` | Service-only lease-scoped explicit projection of frozen content and ONE destination, then single-assignment encrypted payload. Necessary for immutable retries. |
| `server_begin_organizer_message_dispatch`, `server_finish_organizer_message_dispatch`, `server_stop_organizer_message_recipient` | Service-only lease checks, dispatch-time suppression/moderation, persisted pre-network intent, monotonic outcome and terminal stop. Independent failure per recipient. |
| `server_observe_organizer_message` | Service-only verified observation storage/correlation, precedence and shared bounce/complaint suppression. |
| `server_observe_email` | New service-only narrow dispatcher for the existing webhook; exact attempt UUID lookup in the two ledgers, reject ambiguity, delegate to the proper observer. Existing transactional observer remains responsible for its records. |
| `server_prune_organizer_message_history` | Service-only explicit retention while preserving request identity and suppression references; no scheduler activation in Build. |
| Private limit-consumption helper | Atomic ordered advisory locks and reservation across organizer/event/recipient hash lanes. Cannot be invoked to bypass submit. |

New Edge Function `organizer-message`: authenticated preview rendering/options/submit/receipt façade; calls owner RPCs using caller JWT (never trust a submitted owner ID); applies bounded body/method validation and no-store. Existing-request reconciliation precedes new-send health/configuration/window gates, so disabling dispatch never hides a committed receipt. Preview uses the same versioned React Email component as delivery. New `organizer-message-worker`: dedicated invocation secret, env and DB gates, key loader and provider adapter. It runs independently of browser lifetime and transactional worker; deployment/scheduling activation is separate approval. No new webhook endpoint is needed; existing verified endpoint routes through `server_observe_email`.

## F. Preview, count and fingerprint

Preview validates text and selector, obtains one consistent server audience projection, applies suppression and deduplication, and returns N. Fingerprint is an HMAC of canonical JSON including actor/event/selector, sorted canonical recipient hashes (not count alone), content digest, event-policy facts/end, organizer/sender facts, assets/CTA choice and template version. Canonical serialization/order and Unicode counting must match on server; browser treats the token as opaque. No persisted preview/draft table is needed.

Send checks existing request receipt first after authentication/ownership; otherwise resolves a fresh audience under the existing event ticketing lock hierarchy (event advisory → tiers in stable order → event → relevant sources). Reuse/follow `private.lock_event_change_rows`/`lock_payment_order` conventions; never invert with organizer/profile locks. Materialize the candidate audience **once** within the transaction and use that same set both to compare the fingerprint and insert rows. Do not independently query count then recipients. Use a consistent snapshot for suppression; a concurrent new block after this linearization is handled at dispatch. Test this race explicitly.

New address, removed address or same count/different membership gives `AUDIENCE_CHANGED` and no writes. Text/event/sender/template changes give `PREVIEW_CHANGED`; owner re-previews and reconfirms. Extra qualifying orders for an already-included address do not materially change membership, unless they change a relevant selector or eligibility. Zero gives `NO_RECIPIENTS`, no message or rate charge. Count displayed and snapshot count committed must match exactly; later dispatch suppression can reduce actual delivery without rewriting the original receipt.

## G. Durable send idempotency

Create one browser UUID at confirmation; persist only actor/event/request UUID in session-scoped recovery storage before network dispatch (not text or recipients). Keep it for all retries. Server serializes by request UUID and enforces unique(request_id). Bind the receipt to actor, event, selector, canonical subject/body and accepted preview digest. Same request/same intent returns the original receipt, even after end-window expiry or later audience drift; different intent returns `REQUEST_CONFLICT`, never another send.

A lost response triggers receipt lookup and, if necessary, retry of the exact request. A racing lookup may see not_found before the first transaction commits; this is not permission to generate a fresh UUID. Never show “failed” for an ambiguous network outcome. Same-request concurrent transactions create one message and one recipient row per email. Deliberate “Write another message” resets the composer and uses a new UUID after a new preview/confirmation. Independent tabs deliberately confirming distinct UUIDs are separate sends, subject to rate limits; content-based global dedupe would incorrectly forbid intentional repeats.

Provider idempotency is independently `organizer-message/<recipientDeliveryUuid>` with frozen request bytes for every retry. This protects transport retries, not message creation. Database request receipt protects creation. Neither grants exactly-once inbox delivery; exhausted unknown remains unknown.

## H. Sender, template, images and CTA

No organizer contact-email field exists in the inspected organizer schema/settings/storefront contracts. `organizers` contains display_name, bio, website, location and storefront identity/media, not verified contact mail. Auth email is not a substitute. Recommend existing configured `TICKET_EMAIL_SUPPORT_EMAIL` as reply-to and explicit preview copy “Replies go to Wheretoo support.” No contact-email subsystem in V1.

Actual From mailbox comes only from validated platform `TICKET_EMAIL_FROM`; safely parse the allowed configured mailbox, never append an organizer string to an unchecked address. Visible display is escaped/quoted `<Organizer Display Name> via Wheretoo`; reject header controls in profile display name and use neutral Wheretoo fallback if unsafe. Server snapshots approved sender mailbox/support values and display name. Missing/invalid configuration means unavailable for new sends, not placeholder mail. Activation must verify monitored support and authorized sender; this inspection does not assert that they exist in deployment.

Add `OrganizerMessageEmail.tsx` to the existing renderer union. Layout: Wheretoo branding; organizer name; event title/date/time in event timezone and venue; subject; escaped message preserving newlines; optional public event CTA/flyer/logo; footer “You received this message because this email was associated with an active ticket purchase or RSVP when the organizer queued it.” Avoid claiming current active status after a later refund. No personalized name needed, avoiding arbitrary selection between orders sharing an address.

Use the React Email design primitives, override ticket-link/privacy language explicitly. Plain text and HTML versions both contain essential information. Subject 1–120 Unicode code points after trim; body 1–5,000 code points after CRLF/CR normalization to LF and outer whitespace trim. Reject subject CR/LF/all control characters; body permits LF and tab, rejects other C0/DEL controls; reject invalid Unicode, preserve valid Unicode and internal whitespace. Enforce independent bounded UTF-8 request size. Plain text URLs remain text; no auto-linkification, HTML/Markdown interpretation or remotely fetched organizer URLs.

Assets are better supported than expiring signed URLs, but not permanently public:

- `supabase/functions/event-images/index.ts:63` serves bytes via a stable GET `?id=<image UUID>` and `server_get_public_event_image` (`20260919010100_add_event_images.sql:127`). The storage bucket stays private; public eligibility is checked on each read. Eligible current flyer may be included via this allowlisted endpoint. Ended/cancelled/nonpublic event: omit flyer. Later expiry/removal can make a previously included image unavailable; alt text and layout must remain readable.
- `supabase/functions/organizer-media/index.ts` and final `server_get_organizer_media` in `20260924010300_add_storefront_merch.sql:24` expose current selected media anonymously only for published storefronts. Include current logo only through this anonymous public branch, never the authenticated-owner branch. Missing/draft/private logo: omit.
- These URLs contain asset IDs, not storage paths, signed tokens, customer identifiers or tracking parameters. Existing function gateway configuration permits these GET surfaces. Future proof must test anonymous email-client retrieval, including redirects/headers. No image retention/privacy extension is proposed.
- CTA is allowlisted `${APP_BASE_URL}/events/<event UUID>` only if currently publicly eligible at preview/confirmation. Ended/cancelled/unavailable: omit; no new public archive page, event-status bearer, order link or ticket-access grant. Later public-state changes can make an old CTA unavailable; never promise permanent availability.

Images are decoration and cannot block queueing. Transport outage while checking optional media yields imageless rendering; changed rendering facts require preview refresh. Frozen payload must not be silently regenerated on retry.

## I. Shared suppression and retry integration

Existing suppression is `private.ticket_email_recipient_blocks(recipient_hash PK, reason, attempt_id NOT NULL FK ticket_email_outbox, recorded_at)`. The FK prevents simply writing an organizer delivery UUID into it. Keep this **one block list and existing hash secret**, despite its historical name.

Minimal migration: make existing `attempt_id` nullable, add nullable `organizer_recipient_id` FK to the new recipient outbox, and CHECK exactly one provenance reference is populated. Existing rows retain ticket references unchanged. Update the transactional observer's conflict-update path to clear organizer_recipient_id when setting attempt_id; the organizer observer does the reverse. Preserve complaint precedence and recorded time. Existing ticket readers keep reading the same hashes; existing support-only clear RPC clears the shared block, never expose it to organizers. Existing prune remains unable to delete a referenced ticket attempt; new prune respects organizer references. Regression-test both bounce directions, conflict upserts and retention. This is a suppression provenance extension, not a ticket purpose or grant change.

Webhook routing must be signature-first, then exact UUID lookup and provider-ID binding. Reject UUID ambiguity between ledgers; no email/time guessing. Duplicate webhook ID must match original evidence; reject conflicts. Observations outrank uncertain HTTP responses; complaint > bounce > failed > delivered > delayed > sent follows the existing policy. Cross-ledger webhook ID replay must not create a second contradictory observation; dispatcher checks both observation tables before routing.

At confirmation, exclude blocked hashes. Before every unsent/retry dispatch, recheck blocks and platform safety holds. Stop remaining sends without changing membership. If an earlier request may have been accepted, keep unknown/accepted truth and record stopped reason; never relabel it “never sent.” Accepted is terminal for dispatch, not synonymous with delivered.

Adopt existing bounded transport mechanics: lease ownership and >=20 seconds headroom, two-minute claims, 15-second network bound, six attempts and 23 hours from first possible dispatch, backoff 60/300/1800/7200/21600 seconds. Treat these as conservative inherited implementation parameters; activation must verify current provider idempotency guarantees. Do not extend an uncertain request beyond its dedupe safety window or replace its key. Worker restarts use the saved encrypted payload; late verified evidence can reconcile after stop. Failure for one recipient cannot roll back another or the message receipt.

## J. Separate limits and transactional capacity

Proposed values for founder approval, not activated defaults: 120-code-point subject / 5,000 body; maximum 1,000 unique recipients per send (reject with explicit limit, never truncate); 3 confirmed messages/event/hour and 10/event/24h; 20/organizer/24h; 5,000 recipient deliveries/organizer/24h; maximum 3 messages to the same normalized recipient from the same organizer/24h across events. Requests rejected for drift/zero/validation consume no send budget; same-request replay consumes once. Propose a separate preview allowance of 30 requests/organizer/minute to prevent repeated expensive scans (also requires approval); rejected/preview requests do not debit send budgets. Limits belong only to organizer messages.

Separate workers prevent queue head-of-line blocking but **do not alone isolate a shared provider account's rate or daily quota**. Organizer lane must have an approved explicit share below verified provider capacity, bounded concurrency (propose one provider call at a time), and yield while transactional outbox has ready or leased sending work. Do not change transactional claim ordering or existing resend limits. A service-only organizer dispatch capacity check in its begin RPC atomically reserves organizer tokens and checks ticket backlog; bounded organizer share leaves reserved provider throughput/quota for transactional mail. Existing transactional sends need no new quota restriction. A ticket arriving immediately after that check may share at most the bounded organizer in-flight request; zero interference cannot be guaranteed on a shared external account.

Release gate: verify provider account allocation, reserve required transactional throughput and monthly/daily headroom, and approve organizer budget; otherwise organizer accepting_sends and worker remain false. If guaranteed provider-level isolation is required, a separately allocated provider quota must be approved operationally—do not assume another API key creates isolation. No infrastructure is provisioned by this specification.

Worker-disabled/configuration-missing/unhealthy before send: `EMAIL_UNAVAILABLE`, no new message. Check accepting/worker gates and fresh worker-health acknowledgement server-side; health age threshold is an activation parameter. A shutdown after commit does not erase the queue: retain it and truthfully report queued, with internal operational alert. Scheduler must run the independent worker for browser-close durability; configuring/enabling it is a separately approved deployment step.

## K. Minimal UX and failure behavior

One protected lazy route: `/organizer/events/:eventId/email-attendees`. Dashboard action “Email Attendees”; owned Order Detail action “Email customer” passes only orderId; Registration Detail action “Email registrant” passes only registrationId. Reference query parameters select individual mode; they are untrusted and reauthorized server-side. Keep all existing Resend Tickets entry points (free detail already renders it; paid ticket-delivery surfaces remain unchanged).

Composer has audience, subject, message and Preview. Paid dropdown: Everyone and tier choices; free: Everyone only. Individual context is fixed and labeled, with a clear back link; no address editing or directory. Heading “Message attendees about this event.” Show window/availability and support reply-to. Inline validation, loading, retryable availability error, zero-audience state. No drafts/history page.

Preview uses server-rendered safe HTML in a script-free sandbox or equivalent inert rendering plus accessible text; shows audience label, exact N and “Send to N people.” Back/edit invalidates preview. Disable send while submission is pending, but database idempotency is authoritative. On commit: “Message queued for N recipients.” Explain delivery may be prevented by suppression/provider issues; do not label it delivered.

| Failure | UX / server result |
| --- | --- |
| Unauthenticated / cross-owner event or selector | Unavailable/unauthorized; no existence leakage or recipient details. |
| Window/state/schedule closed | Explicit reason, no send. |
| Invalid selected tier/source | Correct selection or return to detail; no fallback to Everyone. |
| Count drift / preview changes | Refresh preview and require new confirmation; no queue created. |
| Zero/suppressed individual | No eligible recipients; avoid exposing global suppression history/reason details. |
| Limits reached | Retry-after where known; no partial audience queue. |
| Known validation/database rollback | Safe retry of original intent/request; no success message. |
| Network outcome uncertain | “Checking whether your message was queued”; receipt reconciliation, never automatic new UUID. |
| Provider outage / partial outcome after commit | Durable per-recipient handling; queued receipt remains true, no campaign rollback or blind resend button. |
| Logout/account switch | Cancel/ignore stale UI results, clear sensitive drafts/query cache, scope recovery UUID by actor/event; server may already have committed. Same owner can reconcile later. |

Focus moves to preview heading/error/result; native labels/buttons, visible focus, accessible status announcements, keyboard back/edit flow, 390px no overflow, desktop rendering. No visual redesign of existing dashboard/detail screens.

## L. Authorization, privacy and content safety

Every owner RPC rechecks authenticated owner; client route protection is not authorization. Never accept recipient arrays, sender/reply-to overrides, HTML, template URLs, supplied count, actor IDs or arbitrary provider payload. Use exact selector discriminated unions and reject unknown fields. Edge service credentials remain server-only; background RPCs are service-only and lease-bound. Revoked direct table access prevents arbitrary private data reads by authenticated clients.

Preview exports only canonical message/rendering facts, count and opaque fingerprint. Individual source labels use existing authorized context, not a new bulk email endpoint. No recipient/body/subject/payload logging, analytics events or URLs. Error logs use message/delivery IDs and sanitized codes. Private snapshots contain contact data necessary for delivery; restrict retention and access. Encryption keys must remain available while payload retries need them; unreadable payload stops safely without regeneration.

No tickets/orders/refunds/free sources are written by this feature. No QR, bearer, recovery grant, ticket-email member/outbox entry, replacement ticket or admission mutation. Content controls apply to organizer name as well as subject. React escaping and strict header validation cover HTML/header injection; untrusted URLs are not fetched. No legal classification assurances or unsubscribe system are introduced.

## M. Build + Prove acceptance plan (future work, not run here)

1. **SQL audience fixtures:** buyer with 4 tickets → 1 recipient; duplicate normalized email across orders → 1; distinct plus/dot aliases remain separate; multi-tier order included once for each selected matching tier; archived/renamed/same-name tiers; foreign tier; one refunded and one active order; all-used active order; fully refunded with retained used admission excluded; partially refunded/review/pending/submitting/unknown/failed refund cases; incoherent totals/linkage fail closed; free grouped/duplicate confirmed registrations, all-used, cancelled, wrong-event and rejected request exclusions.
2. **Authorization:** anonymous, authenticated non-owner, staff-but-not-owner, forged selector, forged arbitrary fields, direct private table access and every service RPC denied. Individual inactive source cannot be rescued via unrelated purchase. No bulk addresses in any browser projection.
3. **Time/state:** before/start/during/end/+168h exactly/+one microsecond; DST/timezones; missing/infinite/reversed schedule; reschedule between preview/submit; all moderation states/holds; cancelled behavior approved in P; queued-before-deadline dispatch-after-deadline succeeds unless safety suppression.
4. **Snapshot/concurrency:** same N/different addresses rejected; added/removed recipient; suppression between preview/send; same-address extra source does not force needless drift; content/facts/template changes; zero rejected; audience materialized once; commit count equals preview; refund/payment/free-registration/cancellation races preserve existing lock order. Later customers never join and later refund/cancel does not remove snapshot members.
5. **Request concurrency:** two real DB connections, same UUID → exactly one message/N recipients/one budget debit; lost response replay and reload reconciliation; lookup racing an uncommitted submit; changed payload same ID conflict; cross-owner ID probing; replay after deadline/purge returns receipt; deliberate new UUID permitted within limits.
6. **Worker/provider injected tests:** browser closes after commit; queue resumes with independent worker; one accepted/one failed/one unknown; lease loss/crash before and after dispatch; provider timeout, malformed success, definite rejection, 409/429/5xx; max attempts/window exhaustion; later rejection cannot erase prior uncertainty; retry request bytes/key unchanged; encryption tamper/wrong key stops; feature disabled after commit retains queue.
7. **Signed webhook/suppression tests:** invalid signature/raw body limits; wrong/unknown UUID/provider ID; both-ledger ambiguity; duplicates/conflicting IDs; webhook-before-HTTP-finish; out-of-order precedence; ticket bounce blocks organizer recipient and organizer complaint blocks ticket mail; opposite-source upsert clears other FK; organizer cannot clear; block appearing immediately before dispatch stops it; prune retains referenced evidence.
8. **Capacity:** configured organizer tokens/concurrency respected across concurrent workers, transactional backlog yields organizer dispatch, daily/monthly headroom guard, no change to existing NULL/unapproved recovery/resend profiles. Test disabled/unconfigured/unhealthy gates and release races.
9. **Template/security:** script/HTML/attribute/header injection, CRLF/controls, Unicode/emoji and boundaries in SQL/TS, line breaks/tabs, overlong bytes, raw URL text, unsafe organizer name, no ticket privacy copy/credential links, correct From/support; missing/expired/private image and ended-event CTA fallback; HTML and plain text meaningful without images. Anonymous GET image proof and no private path/signed URL leakage.
10. **Regression:** all existing ticket initial/resend/recovery/access suites; event change/cancellation revision notices; refunds and reconciliation; checkout/issuance, free RSVP, check-in/used history, RLS and inventory. Assert organizer submit/worker/webhook do not create grants/members/ticket outbox/tickets or mutate financial state. Suppression behavior changes only provenance, not eligibility or evidence meaning.
11. **Browser:** dashboard paid Everyone/tier and free Everyone; both individual details; preview/count/confirmation/queued; zero, expired, limits, known and unknown errors; refresh/double click/network loss; logout/switch owner and return; keyboard/focus/readers, 390px and desktop. Real provider sending prohibited in normal proof; inject/stub adapter and signed fixtures.
12. **Required checks:** `pnpm typecheck`, `pnpm typecheck:functions`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:functions`, relevant integration/SQL/concurrency runners and Playwright. Pin tested HEAD, migration order and fixtures. Existing baseline SQL ACL failures reported in prior work must be reproduced on pristine baseline if still present; list exact differential evidence, never claim an all-green suite or inherit old exceptions without review.

Accept only if all new proofs pass, no new regressions occur, production credentials/email stay unused during proof, and all scoped product decisions are reflected in tests. Activation proof/configuration is separate from code correctness.

## N. Smallest implementation plan and exact likely files

After founder approval only:

1. Add one tracked Supabase migration for E/C/F/G/I/J; SQL/concurrency proof first. Do not edit historical migrations. Reuse existing source coherence/refund helpers, shared suppression hash and lock conventions.
2. Add versioned template and message contracts, then independent worker using existing provider/encryption primitives. Extend signed webhook dispatch and narrowly extend suppression provenance. No general mail-platform extraction required.
3. Add authenticated façade, one composer route and three entry actions; preview/receipt API and identity-scoped query/mutation handling. Preserve existing surfaces.
4. Run M, inspect actual diff/permissions and absence of secret/grant writes; record proof. Stop before provider configuration/worker activation/deployment unless separately authorized.

New likely files:

- `supabase/migrations/<next_timestamp>_add_organizer_messages_v1.sql` (future only).
- `supabase/functions/organizer-message/index.ts` and `index.test.ts`.
- `supabase/functions/organizer-message-worker/index.ts`, `index.test.ts`, `README.md`.
- `supabase/functions/_shared/organizerMessage.ts`, `organizerMessage.test.ts`, `organizerMessageWorker.ts`, `organizerMessageWorker.test.ts`.
- `src/features/organizer-messages/EmailAttendeesPage.tsx`, `EmailAttendeesPage.test.tsx`, `organizerMessage.api.ts`, `organizerMessage.schemas.ts`, `organizerMessage.queries.ts` and focused companion tests.
- `src/features/ticket-experience/email/OrganizerMessageEmail.tsx` and rendering tests.
- `tests/integration/email-attendees-v1.sql`, `tests/integration/email-attendees-v1-concurrency.py`, `tests/e2e/email-attendees-v1.spec.ts` and isolated fixture/runner support as required.
- `Docs/testing/email-attendees-v1.md`.

Existing likely edits:

- `src/app/router/router.tsx` and its tests.
- `src/features/organizer-operations/OrganizerDashboardPage.tsx`, `OrganizerOrderDetailPage.tsx`, `OrganizerRegistrationDetailPage.tsx` and their tests; `organizer-operations.css` only for necessary composer integration or add scoped feature CSS.
- `src/features/ticket-experience/email/email.types.ts`, `renderEmail.ts`, `renderEmail.test.tsx`; `EmailFrame.tsx` only if a small explicit non-ticket presentation prop is necessary; existing templates unchanged in behavior.
- `supabase/functions/ticket-email-webhook/index.ts` and tests (verified dispatch RPC name); shared provider/access helper tests for null-grant organizer payload, without changing ticket formats.
- `src/lib/supabase/database.types.ts` regenerated from approved local schema; `supabase/config.toml` declares new endpoints without activation; `deno.json`, `package.json`/test configuration only if needed to register explicit checks.

No image endpoint, organizer profile, payment, ticket issuance, event-change workflow or public event-page redesign is required. SQL bodies for existing observer provenance are replaced only in the new migration, with regression proof.

## O. Scope guard

Include event-only operational text messages, paid Everyone/tier/individual, free Everyone/individual, unique normalized recipient snapshots, preview, durable confirmation, reliable independent delivery and internal evidence. Resend Tickets stays separate.

Exclude marketing/newsletters/CRM, cross-event campaigns, contact import/search, unsubscribe center, scheduled/recurring sends, templates/drafts/sent-mail/history UI, attachments/rich text/custom HTML/CSS/From/CC/BCC, open/click tracking, analytics, SMS/push, Staff Access, Waitlist, CSV import, promo codes, transfer, recurring event series, payment or ticket issuance changes. No new verified organizer-contact subsystem or private-media publication policy.

## P. Founder decisions and remaining risks

Only substantive decisions requiring approval:

1. **Cancelled-event conflict:** approve recommended no new sends after cancellation, retaining existing cancellation notices; or explicitly authorize a separate historical relationship exception. The latter changes the current locked exclusions and requires revising C/tests before Build.
2. **Moderation and financial ambiguity:** approve clear-only/no-active-hold sends and the existing event-change `order_refund_state='eligible'` conservative filter (including exclusion of failed refund operations). If failed-but-still-paid relationships must receive messages, approve a narrowly defined shared active-relationship policy first; do not silently reinterpret refund state.
3. **Limits/retention/activation allocation:** approve or replace proposed J numbers and E retention, and establish real provider capacity reserve/worker-health threshold before activation. These are proposed, not production defaults or changes to ticket limits.

Recommended support reply-to and optional public assets follow the brief's fallback bias; they need no new profile/image product. If founder requires direct organizer replies instead, that is a scope decision requiring a verified contact source. Operational activation still needs verified sender/support, key retention, signed webhook routing and independent scheduling; no values have been inspected or configured.

Risk: strict coherence/current payment code includes test-mode/USD predicates. This feature follows current-main behavior; it does not authorize live-payment launch or loosen existing boundaries. Bulk snapshot cost must be measured at the approved cap. Shared provider resources require honest capacity validation; a separate worker/API key alone is insufficient isolation. Images/CTA remain subject to future public-state changes. Unknown transport outcomes remain unknown.

## Q. Final recommended specification and readiness

Build one event-scoped composer and one separate durable organizer-message queue. Resolve active buyer/registrant email server-side; include used admissions, target purchased tier UUIDs, deduplicate addresses and apply the shared block list. Preview the server-rendered fixed template and exact fingerprinted count; atomically confirm one immutable message and one row per address using a durable request UUID. Independent server worker dispatches immutable encrypted payloads with stable provider keys and signed evidence, without grants/ticket writes. Use organizer display name via Wheretoo, platform sender and support reply-to; optional anonymous public images/CTA, otherwise text-complete fallback. Enforce canonical +168-hour new-send boundary, separate limits and transactional capacity reservation. No campaign system.

**Ready for Build + Prove: NO, pending founder approval of the explicit policy/limit decisions in P and this inspection specification.** The architecture is sufficiently bounded to implement once those decisions are recorded. Provider activation remains a separate operational gate even after successful Build + Prove.

Inspection verification: fetched main, inspected source/schema/latest relevant overrides and existing test/worker contracts, checked current HEAD and worktree status. No runtime tests run because no implementation was made; all tests above are a future proof plan, not passing results. No migrations, production source changes, provider changes, worker activation, real email, commit, push, merge or deployment performed.
