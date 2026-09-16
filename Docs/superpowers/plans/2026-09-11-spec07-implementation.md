# Spec07 approved execution reference

The following explicit user approval/amendments supersede every conflicting proposal below. No external activation, sends, commits or merges. Numeric limits remain approval-pending.

pprove the Spec 07 architecture and scoped implementation, with the amendments below. Do not restart the entire planning process.

Scope remains:

Automatic ticket email → Organizer resend → Public lost-link recovery → Access to existing paid/free tickets.

1. Approved architecture

Implement the proposed durable outbox, scoped email-access grants, encrypted immutable retry payloads, worker, verified provider observations, and existing-template reuse.

Additive migrations are approved for the isolated Spec 07 worktree and its own verified disposable local database only.

Preserve existing paid/private links, namespaced free links, ticket IDs, QR credentials, original Used timestamps, and admission/refund behavior. Resend and recovery must never invoke issuance or create replacement tickets.

2. Link-lifetime amendment

Replace the initial/resend 30-day cap with a fixed expiry of the event’s canonical scheduled end plus 24 hours, calculated when the grant is prepared.

Keep recovery grants at 24 hours. Opening a collection must not extend them.

Keep grants narrowly scoped and revocable. Do not automatically extend existing grants when an event is rescheduled; document the fresh-link/recovery handoff needed for that case. Never mutate an already-prepared provider payload under its existing idempotency key.

Retention must preserve unexpired grants and their required membership records.

3. Eligibility and source coverage

Approve the plan’s current-ticket eligibility policy: coherent paid/free sources with at least one Valid admission; mixed Used/Valid collections retain all history. Fully Used, ended, refunded, cancelled, and financially unresolved sources follow the proposed refusal/temporary-block rules.

These rules govern new ticket-access emails, not deletion of history or invalidation of otherwise usable existing links.

Approve the fixed recovery snapshot, 20-source pagination, and 200-source bound. Overflow-to-support requires a real configured support destination; never silently truncate results.

Approve the minimal free-registration detail/resend attachment only if Spec 06 has not already supplied it. Reuse its owner search and detail infrastructure; do not create a competing guest-management feature.

4. Rate-limit amendment

Do not treat the originally proposed shared-IP caps as approved production limits.

Preserve recipient/source cooldowns and abuse controls, but separate anonymous recovery capacity from authenticated organizer resend capacity. Anonymous requests must not exhaust initial-delivery or organizer-resend allowances.

Add a test involving many distinct legitimate guests sharing one IP. Use verified-grant limits for authorized ticket reads alongside an appropriate aggregate IP safeguard.

Produce a short revised numeric-limit table with its rationale for approval. Continue independent implementation while that targeted decision remains open; do not restart the full plan or activate unapproved limits.

5. Delivery and uncertain outcomes

Include a non-secret attempt ID in the immutable provider payload’s tags. Signed webhook evidence must correlate to that attempt and provider message ID—not merely match a recipient or timestamp.

Preserve the proposed same-key/same-payload retry policy, six-attempt bound, fixed first-possible-dispatch timestamp, and 23-hour automatic replay cutoff.

Test acceptance followed by a lost response, webhook arrival before response persistence, duplicate/out-of-order observations, and stale workers. Unknown must not become Failed merely because retries stop.

Keep Queued, Sending, Accepted, Failed, Unknown, and Suppressed truthful. Provider acceptance is not proof of inbox arrival.

6. Parallel-work boundaries

Recheck Spec 06’s actual handoff before integrating its issuance transaction, collection resolver, or generated types. Do not build those integrations against files that are still changing.

Independent templates, delivery modules, grant helpers, and isolated tests may proceed against explicit interfaces. Unfinished dependency integration must remain clearly identified.

Coordinate shared routes and confirmation components with Spec 08. Spec 07 owns delivery/access; Spec 08 owns availability and payment recovery. Do not overwrite either task’s worktree or copy its entire diff.

Record the inherited baseline so Spec 07 changes can be reviewed separately.

7. Verification and handoff

Run the plan’s local database, security, concurrency, frontend, Edge, browser, visual, and production-bundle checks.

Include a ticket purchased 60 days before its event, shared-IP guest access, lost-send-response reconciliation, unchanged paid/free links, and unchanged ticket identities/history.

Report incremental files/migrations, exact test results, outstanding integrations, the revised limit table, and external setup still required.

No commits, merges, pushes, deployments, shared-database migrations, DNS/provider changes, scheduler activation, or real email sends.

Proceed within these boundaries. Stop only the affected work for an unresolved approval, dependency, or security blocker.

---

# Spec 07 — Ticket Email, Resend, and Secure Recovery: proposed action plan

**Status:** Plan for approval, September 11, 2026. No application files, migrations, provider configuration, or other task worktrees were edited. No commit, merge, push, deployment, or real email send was performed. This document is outside the repository.

**Goal:** Deliver and recover access to existing paid and free ticket collections through automatic email, organizer resend, and anonymous lost-link recovery, preserving every admission identity, credential, status, and original Used timestamp.

**Architecture:** Add a database outbox and a separate email-access grant. A worker sends through the existing Resend direction after authoritative issuance commits. Grant verification delegates to existing paid/free collection projections and QR reconstruction. Neither sending nor recovery calls issuance or admission writers.

**Stack:** Existing React/TypeScript/Vite, Supabase PostgreSQL and Deno Edge Functions, React Email, and Resend. No new email provider, buyer account system, or admissions ledger.

**Source:** [Standalone Spec 07, including September 11 handoff and R04/R05 boards](</Users/exoh/Downloads/Wheretoo_Spec_07_Ticket_Email_Resend_Recovery.pdf>), [start brief](</Users/exoh/Downloads/Wheretoo_Spec_07_Ticket_Email_Resend_Recovery_START_CHAT.txt>), the explicit user request, and the inspected product/user-flow/architecture documents under `/Users/exoh/Desktop/WhereTo -  Repository/Docs/`.

The choices below are recommendations requiring approval, not claims that these contracts already exist. Implementation, if approved later, should follow the writing-plans task sequence with test-first changes and review at each security boundary. Approval of this plan does not authorize deployment, provider configuration, or real sends.

## 1. Verified local baseline

| Checkout/worktree | Branch and HEAD | Actual state | On-disk migrations |
|---|---|---|---|
| `/Users/exoh/Desktop/WhereTo -  Repository` | `main`, `1d87c88fbb9da4ea4bf335659de7623af084c92e` | 40 dirty tracked paths and 44 untracked files using `git status -uall`; includes buyer/onboarding/preview/reference work | 91; latest `20260909010100_allow_checkout_preflight_status_refresh.sql` |
| `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-operations-v1` | `codex/organizer-operations-v1`, `94c546bd0961f501584f8a3437298b2331cafd5c` | Clean committed operations base | 96; latest `20260910010350_add_owned_refund_evidence_recovery.sql` |
| `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec04-integration` | `codex/spec04-integration`, same `94c546b` | 74 dirty tracked paths, 73 untracked files; implemented on disk, uncommitted | 98; latest `20260911010000_extend_spec04_organizer_reads.sql` |
| `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in` | `codex/spec05-check-in`, same `94c546b` | 86 dirty tracked paths, 92 untracked files; inherits Spec 04 source plus Spec 05 changes, uncommitted | 99; latest `20260911020000_add_owned_admission_search.sql` |
| `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp` | `codex/spec06-free-rsvp`, same `94c546b` | Active, uncommitted implementation; snapshot had 22 dirty tracked paths and 47 untracked files | 100; four candidate free migrations through `20260912010300_add_free_owner_reads_and_rate_limit.sql` |

Counts are a filesystem snapshot, not a frozen integration base. Spec 06 files and logs changed during this audit. No applied remote migration state was queried. No Spec 08 branch/worktree or clearly named implementation file was found in the local Git worktree/branch inventory and targeted source search; its accepted handoff remains unverified.

Spec 04 and Spec 05 contain real implementation. All 52 existing Edge files and six original operations migrations compared byte-for-byte equal to the clean operations base. Spec 05 carries the current Spec 04 source changes; its copied Spec 04 verification report is stale. Use the report in the actual Spec 04 worktree. Cherry-picking `94c546b` alone cannot integrate either uncommitted feature.

Reported prior verification, not rerun in this audit:

- [Spec 04 verification](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec04-integration/Docs/testing/spec04-organizer-operations-verification.md>): 1,021 frontend tests, 228 Edge tests, 251 SQL assertions, eight browser journeys, typechecks/lint/build and production-boundary check passed.
- [Spec 05 verification](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/Docs/testing/spec05-check-in-verification.md>): 1,043 frontend tests, 228 Edge tests, 304 SQL assertions, three admission races, four browser journeys, typechecks/lint/build passed. Physical-camera and remote-provider proof remain outside that evidence.
- [Spec 06 implementation ledger](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/Docs/testing/spec06-progress.md>) and [approved contracts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/.superpowers/spec06/contracts.md>): substantial implementation, no completed handoff. At the final retained-log snapshot (13:11 PDT / 20:11 UTC), its latest frontend result was 952 passed/97 files; integration reported 257 passed and 5 skipped. Its database log had advanced beyond earlier failures to a successful 32-assertion suite footer, while the retained browser result still showed 12 passed and 1 failed (Used/cancellation case). These files were being updated during the audit; no final accepted handoff or full current proof was established. This is an actively changing dependency, not a diagnosis of an unresolved Spec 06 code defect.

## 2. Existing capabilities to reuse

| Capability | Exact inspected source and implications |
|---|---|
| Paid private links | [checkout.attempt.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/checkout/checkout.attempt.ts>), [stripe-create-checkout/index.ts:198](</Users/exoh/Desktop/WhereTo -  Repository/supabase/functions/stripe-create-checkout/index.ts:198>). Browser generates a random canonical 43-character bearer. Paid hash is SHA256 of decoded bytes. The immutable checkout snapshot binds the hash and buyer email. Preserve `/orders/:confirmationToken` and `/tickets/:collectionBearer` exactly. |
| Atomic paid issuance | [Lite fulfillment migration:511](</Users/exoh/Desktop/WhereTo -  Repository/supabase/migrations/20260907010000_integrate_core_ticket_truth_lite_fulfillment.sql:511>), public wrapper at line 651. Tickets, paid/reconciled state, and processed webhook receipt commit together. Duplicate processed webhooks can exit early, so a separate post-webhook enqueue is insufficient. |
| Private collection and focused ticket | [ticket-collection/index.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/supabase/functions/ticket-collection/index.ts>), [TicketCollectionPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/features/ticket-experience/customer/TicketCollectionPage.tsx>), [FocusedTicketView.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/features/ticket-experience/customer/FocusedTicketView.tsx>). One source/event collection with 1–10 admissions. A focused UUID selects within that authorized collection; it is not a separate arbitrary ticket lookup API. |
| Credential reconstruction | [ticketCredentials.ts](</Users/exoh/Desktop/WhereTo -  Repository/supabase/functions/_shared/ticketCredentials.ts>). Existing QR HMAC sources and `TICKET_CREDENTIAL_SECRET` remain unchanged. Reconstructing an admission QR is distinct from reconstructing a private collection bearer. Every reconstructed hash is checked; inactive tickets suppress active QR presentation. |
| Free source | [atomic free registration migration](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/supabase/migrations/20260912010100_add_atomic_free_registration.sql>), [freeRegistration.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/supabase/functions/_shared/freeRegistration.ts>). `confirmed/cancelled` source, existing ticket ledger, one name/email and quantity 1–10. Private locator is exactly `rsvp_` plus canonical 43-character bearer. Free hashing is SHA256 of the bearer text after stripping the prefix; preserve this distinction from paid hashing. |
| Current free collection | [freeCollection.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/supabase/functions/ticket-collection/freeCollection.ts>), [RsvpConfirmationPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/features/rsvp/RsvpConfirmationPage.tsx>). Reads current cancellation, end time, timezone and Used history. Original creation receipt can remain `kind: confirmed` after cancellation; it proves past issuance, not present validity. |
| Buyer confirmation | [OrderConfirmationPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/orders/OrderConfirmationPage.tsx>), [OrderConfirmationView.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/buyer-journey/OrderConfirmationView.tsx>). Preserve existing successful purchase and immediate ticket link. Add independent delivery status; never send on mount. |
| Organizer detail | [OrganizerOrderDetailPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/OrganizerOrderDetailPage.tsx>), [operations.queries.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/operations.queries.ts>). Current owned, reauthorized, paid order context supplies recorded recipient, purchase snapshots and exact admission history. No resend action or resend-eligibility contract exists. |
| Owner free reads | [free owner read migration](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/supabase/migrations/20260912010300_add_free_owner_reads_and_rate_limit.sql>). Metrics and bounded owner admission search exist in candidate code. No coherent read-by-registration detail RPC/page or free organizer UI caller exists. Never pass a registration ID to paid `get_organizer_order_v2`. |
| Reusable email | [TicketsReadyEmail.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/email/TicketsReadyEmail.tsx>), [EmailFrame.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/email/EmailFrame.tsx>), [renderEmail.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/email/renderEmail.ts>). React Email HTML/plain text, source-neutral admission labels, private CTA, previews and tests exist. Current styling is a light shell; R04 needs the approved dark branded treatment and a visible fallback URL. No recovery template exists. |
| Test sender only | [send-ticket-ready-test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/scripts/send-ticket-ready-test.tsx>). Fixed synthetic scenario, explicitly authorized recipient gate, Resend SDK. Its example ticket URL is deliberately unusable. It collapses thrown errors into rejection, has no durable deduplication and cannot be promoted unchanged into production. |

There is no discovered production delivery outbox, worker, access-grant table, public recovery route, or durable send-state contract. Installed dependencies and `.env.example` files do not prove a configured sender/domain/support mailbox. Paid email schedule formatting must use canonical event timezone; the existing paid ticket DTO's LA fallback is not that proof.

## 3. Proposed product and security decisions

### Access: separate grants, with original links intact

Use a new 32-byte cryptographically random grant, encoded as a versioned `em1_` locator. Store its hash for lookup; store the exact provider request, including the raw link, only in an authenticated encrypted delivery payload. Use a dedicated AES-GCM key and key ID, fresh nonce, and associated data binding payload version, attempt ID and grant ID. Do not reuse the QR credential secret or modify existing paid/free hashes.

Emailed link: `/ticket-access#em1_<canonical-bearer>`. The fragment avoids putting the grant in the initial HTTP request path. The page captures it into bounded tab session storage, removes the fragment with history replacement, and posts it to the access endpoint with `no-store`, omitted cookies, and no referrer. No grant, buyer email, raw provider body, or QR secret goes into logs, telemetry, error messages or screenshots. Verify email-client link handling and disable access-email click/open tracking in the approved provider configuration. These are deployment requirements, not verified settings.

The grant's membership contains explicit paid order/free registration IDs with real foreign keys. Every grant index/member read checks its stored purpose, fixed scope, expiry and revocation server-side; selectors and cursors are not authority. A service-only resolver verifies expiry, revocation and membership, then delegates to existing coherent collection readers using stored source hashes internally. It never returns those hashes or the lost original bearer. It uses the same existing credential derivation and comparison. Legacy paid and `rsvp_` parsing remain unchanged, including a valid 43-character paid bearer whose text happens to start with `rsvp_`.

Recommendations requiring approval:

- Initial/resend grant lifetime: **30 days from preparation, capped at event end plus 24 hours**. This can expire before a distant event; eligible buyers can recover another link. Existing original paid/free links retain their current lifetime.
- Recovery grant lifetime: **24 hours**, including any selected collection view. Selection never silently upgrades it to a longer-lived grant.
- Grants are reusable until their fixed expiry. Email scanners/GET requests do not consume them. A new resend/recovery does not revoke prior grants.
- Grant revocation changes access only. A subsequently Used/refunded/cancelled collection displays its current history through a still-valid grant where the existing collection projection allows it. Grant possession never overrides admission authorization or source coherence.
- Expired/invalid/revoked grants share a safe recovery prompt. An expired prepared payload that was never possibly dispatched is suppressed. If it may already have been dispatched, stop further dispatch but retain Unknown/accepted outcome and continue evidence reconciliation. Never rewrite it under the same provider idempotency key.

Alternatives considered: retaining encrypted original checkout/RSVP bearers would require changing both issuance handoffs and would not solve old orders; a permanent email/account credential would broaden access to future purchases. Separate bounded grants solve historical lost-bearer access without either change.

### Eligibility: current tickets, not historical purchase recovery

One new server policy evaluates initial-send preparation, organizer resend, and recovery membership. Recheck it immediately before a new provider dispatch. It is not a copy of the UI `admissionEligible` flag.

| Canonical source/state | New ticket-access email/recovery policy |
|---|---|
| Paid, reconciled coherent order; published noncancelled event before end; at least one Valid ticket | Allow to canonical recorded buyer email. |
| Confirmed coherent free registration; published noncancelled event before end; at least one Valid ticket | Allow to canonical recorded registrant email. |
| Mixed Used/Valid | Allow the same whole collection. Preserve every Used ticket and timestamp; copy must not imply every ticket is unused. |
| Fully Used or event ended | Block new ticket-access send and anonymous recovery. Existing private access/history continues under its current rules. |
| Fully refunded/cancelled, event cancelled, no issued admissions | Block. Never manufacture replacements. |
| Partial/refund-review/unreconciled/incoherent source | Block or safely report unavailable. Do not widen current collection-reader boundaries. |
| Pending refund or unresolved refund operation | Temporarily block new sends using canonical server refund state; reevaluate when it resolves. This is a conservative proposed policy, not a new refund rule. |
| Unknown source, wrong owner/event, invalid recipient | Fail closed for organizer operations; anonymous response stays neutral. |

Do not require active checkout/Connect capability to access already issued tickets. Do not add a new moderation-hold admission rule: current owner/collection contracts keep moderation and operational history separate. If a later accepted moderation contract restricts private collection access, the shared resolver must honor that contract.

This recommendation excludes new anonymous recovery of historical/refund information. Specs 09/10 may later define distinct message purposes and access windows; Spec 07 does not implement those flows. An eligibility race after provider submission cannot unsend email, but the destination reads live ticket status and the server admission writer still rejects invalid entry.

### Multiple matching collections

Normalize request email using existing canonical rules: trim and case normalization, no provider-specific dot/plus alias merging. Match only recorded source email. Never accept an alternate destination or organizer-entered replacement email.

For one valid recovery request, create one bounded snapshot of eligible source IDs and send one recovery email. The worker freezes membership atomically when it first processes the durable request, using sources authoritatively fulfilled/confirmed and visible in that transaction. It persists that snapshot once; later purchases and retries cannot add members. This is a snapshot at processing, not a historical as-of-request reconstruction from timestamps. Keep separate purchases/registrations distinct even for the same event and email. Store IDs, not a frozen copy of Valid status.

- One source: open that existing collection directly.
- Multiple sources: open a small paginated collection selector, **20 sources per page**, showing event/date/source identity after grant verification. Selecting a member loads the existing collection/focused-ticket UI. No account tabs, consumer profile or permanent cross-purchase credential.
- Snapshot bound: **200 sources**. If exceeded, send a configured-support recovery explanation to the recorded inbox; do not silently truncate or claim all tickets were recovered. This exceptional bound/help behavior requires approval and a working support destination.
- Recheck each source on access. Previously included cancelled/refunded/Used history can display under existing projection rules; an incoherent/unavailable member stays unavailable and never expands grant scope.

### Rate limits and anonymous privacy

Use atomic database limits, keyed by a dedicated HMAC secret over normalized email and trusted infrastructure-provided IP. Do not trust an arbitrary forwarded IP header. Discard expired buckets and bound request/recipient retention. Proposed limits:

| Boundary | Proposed limit |
|---|---|
| Anonymous recovery by IP | 5 requests / 15 minutes; 20 / 24 hours |
| Recipient across recovery + organizer resend | 1 / 60 seconds; 3 / hour; 5 / 24 hours |
| Organizer resend per source | 1 / 60 seconds; 3 / hour; 5 / 24 hours |
| Organizer actor | 30 resends / hour |
| Event | 60 organizer resends / hour |
| Access-grant reads by trusted IP | 60 / minute, with bounded request bodies and pagination |

Initial emails from authoritative issuance use a separate queue/quota lane. An attacker must not suppress a real purchase's initial email by exhausting anonymous-recipient limits. Global provider throughput limits delay the worker queue instead of discarding initial delivery.

For syntactically valid public input, enqueue bounded recovery work without looking up purchases on the request path; matching, missing and recipient-throttled inputs return identical `202` JSON/copy: “Check your inbox. If eligible tickets match that email, we'll send access instructions.” No counts, event names, recipient echoes or per-email status polling. Missing addresses consume the same recipient-limit bookkeeping. Input-independent IP throttling may return a generic `429`/Retry-After; global persistence outage returns a generic failure, never false durable acknowledgment. Test status, body, headers and timing distribution for parity. Invalid syntax stays in the form.

## 4. Durable delivery and outcome contracts

Keep domain intent, logical delivery attempt, permission to dispatch again, and provider observations distinct. Stopping future dispatch cannot turn an uncertain past send into a definite failure.

1. **Atomic initial intent:** In a new migration, preserve `public.server_fulfill_paid_order` signature/result and its private fulfillment call, adding one idempotent outbox insert in the same database transaction after coherent paid issuance. For free registrations, coordinate the equivalent narrow post-success enqueue inside the accepted `server_confirm_free_registration` transaction. No network, rendering, encryption or sender credentials in either transaction. No calls to issuance from resend/recovery.
2. **Initial uniqueness:** Unique initial intent per `(source_kind, source_id, purpose=initial)`, not per Stripe webhook event. Duplicate fulfillment/registration returns the original outcome without another initial email.
3. **Explicit resend:** Browser creates one request UUID per confirmed action. Database binds it to actor, event, source and purpose. Duplicate click/remount/transport retry resolves that attempt; another request UUID means a new deliberate resend only after eligibility/cooldown checks. Persist operation identity before network; restore it after remount and reconcile rather than automatically resubmit.
4. **Worker:** Claim due work with `FOR UPDATE SKIP LOCKED`, bounded batches, a lease and fencing version. Prepare the grant hash, member rows and encrypted immutable provider payload atomically before sending. A crash before preparation retries the intent; a crash afterward reuses the exact persisted token/payload. Use one provider idempotency key such as `wheretoo-email/<attempt-uuid>`. Before any network call, durably set `first_possible_dispatch_at` and Sending with a lease-fenced compare-and-set; never reset that timestamp on retry. Recheck lease, dispatch deadline and current eligibility immediately before the call; use a bounded 15-second request timeout. Database fencing cannot by itself stop a stale worker from making an external request.
5. **Outcomes:** Require a valid provider message ID to persist acceptance. A timeout, connection loss, malformed success or uncertain server error becomes Unknown. Known pre-dispatch validation failure or explicit permanent rejection becomes Failed. Keep accepted timestamp separate from later delivery/bounce evidence.
6. **Reconciliation:** Retry Unknown with the same key and bytes only inside a conservative **23-hour window measured from first possible dispatch**, with bounded backoff. Resend documents a 24-hour idempotency window. After the safe window, reconcile by known provider ID or verified correlated webhook evidence; otherwise hold Unknown. Never rotate a token/key or create a fresh automatic send to clear ambiguity. [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).
7. **Webhook evidence:** Verify raw body/signature/timestamp, deduplicate event IDs, bind observations to the intended attempt/provider message ID, and tolerate duplicate/out-of-order events. Only allow safe metadata into logs. `email.sent` means API success and an attempted delivery; `email.delivered` means the recipient mail server accepted it, not observed inbox placement. [Resend event semantics](https://resend.com/docs/webhooks/event-types), [signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests).
8. **Scheduling/configuration:** Proposed Supabase Cron invocation once per minute of a service-authenticated worker, with its token in server Vault and bounded dispatch batches. The source outbox is durable; browser polling is not the scheduler. Add an activation timestamp and disabled-by-default sender switch. Queue post-activation issuance durably, checking the persisted first authoritative issuance time (`paid_at`/the accepted free confirmation timestamp), never the time of a replay or wrapper invocation. A replay of an older purchase must not create a new initial email. Do not mail every historical order when applying migrations. A bounded reconciliation scan can repair eligible post-activation gaps and alert on stalled work. Historical resend/recovery remains intentional.

| Persisted state | UI wording and permitted action |
|---|---|
| `not_requested` / configuration unavailable | Tickets remain accessible; explain email availability truthfully. Never say “sent.” |
| `queued` | “Email queued.” A durable intent exists; no provider acceptance claimed. |
| `sending` | “Sending…” while a worker lease is active. Disable duplicate submission. |
| `accepted` | “Tickets resent” / “Email sent,” meaning durable provider acceptance. Include inbox/spam reminder; no inbox-delivery guarantee. |
| `failed` | “Couldn't send.” Safe known reason; explicit retry after applicable cooldown, creating a new intentional logical attempt. |
| `unknown` | “Send not confirmed. Check status.” Retain identity, reconcile; no blind Try again. |
| `suppressed` | No dispatch may have occurred, and source/link/configuration now prevents a send. For a possibly dispatched attempt, retain Unknown/accepted instead and separately stop future dispatch. Explain safely on authenticated surfaces. |

Track delivery observations (`delivered_to_mail_server`, delayed, bounced, complained/suppressed) separately so a late event does not erase prior provider acceptance or authorize a duplicate send. Bound retries (proposed six automatic transport attempts with backoff inside the safe window); exhaustion stays Unknown if acceptance is uncertain. For a known bounced/suppressed recipient, offer configured support instead of repeated sends.

Purge encrypted payloads after acceptance and the safe reconciliation window, or after definite failure needs no transport replay. Keep the minimal attempt/grant metadata through grant expiry plus an approved audit retention period; proposed metadata retention is 90 days, recovery request/bucket retention 24 hours after expiry. Unknown attempts past their reconciliation window retain safe metadata for investigation, not reusable plaintext links. Never log decrypted payloads. Key rotation retains old decryption keys only for pending prepared attempts.

## 5. All twelve reference panels and missing states

Both full-resolution embedded boards were visually inspected. Preserve their dark mobile surfaces, purple primary action, event hierarchy, recipient confirmation and clear result illustrations; use the existing responsive desktop shell. Text, names, prices, artwork and QR values in the boards are examples.

| Panel | Implementation mapping |
|---|---|
| R04-1 Purchase Complete | Extend existing paid confirmation and Spec 06 confirmation with delivery summary. Successful purchase/RSVP and View tickets remain usable while email queues/fails. Keep existing calendar action where already implemented. |
| R04-2 Ticket Email | Extend reusable Tickets Ready template with Wheretoo branding, “Your tickets are here,” canonical event/date/timezone/venue, readable approved artwork or neutral branded fallback, CTA and fallback URL. HTML and plain text. No active QR. |
| R04-3 View Tickets | Email grant resolves into existing order/registration collection, then the existing focused QR view. Account tabs, profile nav, tiny row QRs, Wallet and Send to a friend are omitted per the spec adaptation. |
| R04-4 Lost the Link | New unauthenticated `/tickets/recover`: labeled email, Send me my tickets, configured help destination; reachable from buyer shell and invalid-link states without organizer login. |
| R04-5 Recovery Email | Shared branded frame, recovery explanation, View my tickets, fallback secure URL and configured support/reply destination. Multiple-source link opens the bounded selector. |
| R04-6 Back to Your Tickets | Same existing collection/focused view, preserving quantities, Used timestamps and all current statuses. Multi-source selector has return navigation without becoming an account wallet. |
| R05-1 Review order | Existing owned paid Order Details, real recipient, purchase items and total. Free uses the narrow approved registration-detail attachment described below, with no invented paid total/order status. |
| R05-2 Confirm resend | Existing accessible dialog primitives; exact recorded recipient, no editing, explanation that access is resent without new tickets/QRs. Cancel performs no write. |
| R05-3 Sending | Pending view with duplicate suppression, request identity retention and safe close/remount reconciliation. |
| R05-4 Tickets resent | Only after durable provider acceptance; correct recipient, inbox/spam reminder, return to the same owned source. Queued is a distinct state. |
| R05-5 Email send failed | Definite failure permits deliberate cooldown-limited retry. Unknown gets its own Check status treatment rather than this panel's blind retry. |
| R05-6 Cannot resend | Block refunded/cancelled/invalid sources and the proposed fully Used/ended/review cases. Show actual source status and return action. No misleading resend after full refund. |

Additional states use existing shells: public neutral acknowledgment, invalid syntax, cooldown/IP limit, service unavailable, queued, Unknown, invalid/expired/revoked link, multiple collections, empty/unavailable member, snapshot overflow and missing support configuration. Test keyboard focus/restoration, live announcements, reduced motion and real wrapping at **320, 390, 768 and 1440 px**. Render and visually inspect emails with images blocked as well as loaded. Use only readable approved asset URLs; never make private storage public for email.

## 6. API and database additions proposed

Exact public-facing contracts, subject to the approval choices above:

```ts
type TicketSource =
  | { kind: 'paid_order'; id: string }
  | { kind: 'free_registration'; id: string };

// Authenticated organizer: server derives recipient and checks current ownership.
type ResendRequest = { eventId: string; source: TicketSource; requestId: string };
type DeliveryStatus = 'queued' | 'sending' | 'accepted' | 'failed' | 'unknown' | 'suppressed';
type ResendResult = { attemptId: string; state: DeliveryStatus; retryAfterSeconds?: number };

// Anonymous: same acknowledgment for match, miss, and recipient throttling.
type RecoveryRequest = { email: string };
type RecoveryAcknowledgment = { kind: 'check_inbox' };

// Email-access endpoint: grant required for every index/member request.
type AccessRequest =
  | { action: 'index'; grant: string; cursor?: string }
  | { action: 'collection'; grant: string; memberId: string };
type AccessIndex = {
  kind: 'index';
  members: {
    memberId: string; eventName: string; startsAt: string; timezone: string;
    sourceLabel: string; quantity: number; state: 'available' | 'unavailable';
  }[];
  nextCursor: string | null;
};
// Each opaque memberId is checked against the grant before a collection read.
// collection returns the existing TicketCollectionResult, never original bearers/hashes.
```

Organizer context/status reads are reauthorized on every request, owner/event/source keyed, and return no email-access tokens. Buyer delivery summary accepts the existing private paid/free bearer and returns only that source's initial-delivery state; it does not create a send or disclose unrelated recipient/history. Keep the existing strict collection DTO shape, with a separate index DTO rather than adding multiple events into it.

Proposed migrations are **new files only**, allocated after the accepted Spec 06 head. These exact candidate names must be collision-checked at implementation time; they are not created or applied by this plan:

| Proposed file under the future Spec 07 checkout | Contents |
|---|---|
| `supabase/migrations/20260913010000_add_ticket_email_access.sql` | Private grants and explicit source-member FKs; exactly-one-source constraints; unique token hashes; expiry/revocation indexes; service-only lookup delegating to current paid/free projections. No changes to ticket identities or old bearer hashes. |
| `supabase/migrations/20260913010100_add_ticket_email_delivery.sql` | Intents, attempts, immutable encrypted payload metadata, request deduplication, provider observation receipts, leases/fencing and queue indexes; source-bound initial uniqueness; owner context/status RPCs. |
| `supabase/migrations/20260913010200_enqueue_authoritative_ticket_email.sql` | Narrow additive paid wrapper/free success enqueue integration; preserved wire signatures; feature activation state; no provider calls; no historical bulk-send backfill. |
| `supabase/migrations/20260913010300_add_ticket_recovery_and_limits.sql` | Durable public request queue, HMAC rate buckets, atomic bounded snapshot creation and owner/source cooldown enforcement; normalized email indexes matching existing source conventions; worker scheduling SQL and runtime gate. |
| `supabase/migrations/20260913010400_add_owned_registration_delivery_context.sql` | Only if the missing free-detail attachment is approved for Spec 07: coherent authenticated owner/event/registration detail plus delivery context, reusing the Spec 06 source. No registration creation or admission writer. |

Private tables have no direct anon/authenticated access. Use RLS/explicit grants, fixed empty search paths, schema-qualified SECURITY DEFINER functions, strict bounded arguments, foreign keys and purpose/state checks. Grant access and email enqueue routines have no route to modifying ticket rows. Enforce source equality between grant membership, attempt and canonical recipient. Do not expose encrypted payloads through service projections intended for the browser.

## 7. Exact file map and shared ownership

**Proposed isolated implementation checkout, not created:** `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec07-ticket-email`, branch `codex/spec07-ticket-email`. Paths in the following creation manifest are relative to that explicitly named future checkout; none is claimed to exist now.

New cohesive files:

| Exact proposed path | Responsibility |
|---|---|
| `supabase/functions/_shared/ticketEmailAccess.ts` | Grant encoding/hash/encryption, strict parsing and source-scoped access helpers. Separate keys from admission crypto. |
| `supabase/functions/_shared/ticketEmailDelivery.ts` | Attempt lifecycle, immutable preparation, leases/fencing, safe provider adapter and reconciliation policy. |
| `supabase/functions/_shared/ticketEmailContracts.ts` | Strict source/status/recipient-safe contracts and error allowlists. |
| `supabase/functions/_shared/ticketEmailLog.ts` | IDs/status codes only; bounded diagnostics without personal data or secrets. |
| `supabase/functions/ticket-email-worker/index.ts` | Authenticated scheduled outbox dispatch and bounded reconciliation. |
| `supabase/functions/ticket-email-resend/index.ts` | Authenticated organizer resend and attempt reconciliation, never caller-selected recipient. |
| `supabase/functions/ticket-recovery-request/index.ts` | Anonymous bounded request/neutral response and request-only rate limits. |
| `supabase/functions/ticket-email-access/index.ts` | Grant index/member resolution; delegates to existing collection projection/credential verification. |
| `supabase/functions/ticket-email-status/index.ts` | Private buyer delivery summary authorized by the original paid/free locator. |
| `supabase/functions/resend-webhook/index.ts` | Verified, deduplicated provider observations; no payment/admission updates. |
| `supabase/functions/_shared/ticket-email/EmailFrame.tsx` | Canonical reusable server-compatible email frame, relocated from existing source with compatibility export. |
| `supabase/functions/_shared/ticket-email/emailStyles.ts` | Shared email-safe styling and dark/purple R04 treatment. |
| `supabase/functions/_shared/ticket-email/TicketsReadyEmail.tsx` | Reused/improved canonical ready template, no QR secrets. |
| `supabase/functions/_shared/ticket-email/TicketsRecoveryEmail.tsx` | Recovery-specific explanation and CTA. |
| `supabase/functions/_shared/ticket-email/ticketEmail.types.ts` | Shared production template props; no browser/provider secrets. |
| `supabase/functions/_shared/ticket-email/renderTicketEmail.ts` | Server HTML/plain-text rendering for these two purposes. |
| `src/features/ticket-delivery/delivery.api.ts` | Safe browser transport for summary, organizer operation and recovery/access reads. |
| `src/features/ticket-delivery/delivery.schemas.ts` | Strict public/browser response schemas. |
| `src/features/ticket-delivery/delivery.queries.ts` | Owner/source keyed status/context reads and recovery of operation state. |
| `src/features/ticket-delivery/useTicketResend.ts` | Persisted request identity, duplicate latch, abort and reconciliation state machine. |
| `src/features/ticket-delivery/ResendTicketsDialog.tsx` | R05 confirm/sending/accepted/failed/unknown/ineligible views. |
| `src/features/ticket-delivery/TicketRecoveryPage.tsx` | R04 public form, validation and neutral acknowledgment. |
| `src/features/ticket-delivery/TicketEmailAccessPage.tsx` | Fragment capture, scoped session storage, snapshot index and existing collection bridge. |
| `src/features/ticket-delivery/TicketDeliveryNotice.tsx` | Truthful independent buyer delivery state. |
| `src/features/ticket-delivery/ticket-delivery.css` | Narrow responsive styling using buyer/operations design conventions. |
| `src/features/organizer-operations/OrganizerRegistrationLookup.tsx` | Conditional minimal free source lookup attachment if approved; reuse existing Spec 06 owner search. |
| `src/features/organizer-operations/OrganizerRegistrationDetailPage.tsx` | Conditional free detail/resend attachment using the existing detail shell; no free scanner/dashboard feature. |

Tests accompany these units rather than mirroring trivial presentation. Exact principal new proof paths: `supabase/functions/_shared/ticketEmailAccess.test.ts`, `supabase/functions/_shared/ticketEmailDelivery.test.ts`, each new Edge handler's `index.test.ts`, `src/features/ticket-delivery/useTicketResend.test.tsx`, `ResendTicketsDialog.test.tsx`, `TicketRecoveryPage.test.tsx`, `TicketEmailAccessPage.test.tsx`, `supabase/tests/spec07_ticket_email_access.test.sql`, `spec07_ticket_email_delivery.test.sql`, `spec07_ticket_recovery.test.sql`, `tests/integration/spec07-email-concurrency.py`, `tests/integration/spec07-email-database.sh`, `playwright.spec07.config.ts`, `tests/e2e/spec07.spec.ts`, `tests/e2e/support/spec07Harness.ts`, and `Docs/testing/spec07-ticket-email-verification.md`.

Existing files to modify only after reconciling their accepted versions:

| Existing file(s), with current location | Minimal change and owner coordination |
|---|---|
| [router.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/app/router/router.tsx>) | Add static `/tickets/recover`, `/ticket-access`, and conditional free detail attachment routes. Reconcile Spec 06 RSVP paths, Spec 05 nested check-in routes and any accepted Spec 08 routes first. |
| [TicketCollectionPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/features/ticket-experience/customer/TicketCollectionPage.tsx>), [runtime/production.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/features/ticket-experience/runtime/production.tsx>) | Small optional collection/navigation adapter so the email route reuses the existing overview/focused view without putting the grant in a path. Legacy route behavior remains the default. |
| [ticket-collection/index.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/supabase/functions/ticket-collection/index.ts>), [freeCollection.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/supabase/functions/ticket-collection/freeCollection.ts>) | Export/reuse coherent projection and credential-verification functions from one implementation; keep paid/free request behavior intact. Email access has a separate endpoint, avoiding new ambiguity in old bearer parsing. |
| [ticketCollection.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/features/ticket-experience/contracts/ticketCollection.ts>), [ticketCollectionReader.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/features/ticket-experience/adapters/ticketCollectionReader.ts>) | Reuse strict DTO validation for authorized email-member responses; avoid expanding the old DTO into a multi-event account wallet. Coordinate Spec 06 field allowlists and Spec 08 focused-ticket contract. |
| [OrderConfirmationPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/orders/OrderConfirmationPage.tsx>), [OrderConfirmationView.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/buyer-journey/OrderConfirmationView.tsx>), [RsvpConfirmationPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/features/rsvp/RsvpConfirmationPage.tsx>) | Mount read-only delivery notice and recovery entry point. No issuance or send side effects; preserve immediate links, current lifecycle and calendar behavior. |
| [BuyerPrimitives.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/buyer-journey/BuyerPrimitives.tsx>), [useTicketDocumentPrivacy.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/customer/useTicketDocumentPrivacy.ts>) | Public recovery navigation and early privacy treatment for the new grant route; no account navigation. |
| [OrganizerOrderDetailPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/OrganizerOrderDetailPage.tsx>), [OrganizerOrdersPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/OrganizerOrdersPage.tsx>) | Attach resend/context read; conditional small free lookup handoff. Preserve Spec 04 reauthorization and Spec 05 exact-ticket/manual-admission work. |
| [operations.api.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/operations.api.ts>), [operations.schemas.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/operations.schemas.ts>), [organizer-operations.css](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/organizer-operations.css>) | Only conditional free detail read/schema/shell reuse; keep delivery state in its own feature modules. Do not alter admission/refund API writers. |
| [EmailFrame.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/email/EmailFrame.tsx>), [emailStyles.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/email/emailStyles.ts>), [TicketsReadyEmail.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/email/TicketsReadyEmail.tsx>), [email.types.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/email/email.types.ts>), [renderEmail.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/ticket-experience/email/renderEmail.ts>) | Compatibility exports/delegation to the canonical Edge-compatible frame/ready renderer, add recovery preview coverage. Preserve cancellation/refund template purpose and content contracts; do not build their send flows. |
| [database.types.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/src/lib/supabase/database.types.ts>), [supabase/config.toml](</Users/exoh/Desktop/WhereTo -  Repository/supabase/config.toml>), [deno.json](</Users/exoh/Desktop/WhereTo -  Repository/deno.json>), [package.json](</Users/exoh/Desktop/WhereTo -  Repository/package.json>), [functions/.env.example](</Users/exoh/Desktop/WhereTo -  Repository/supabase/functions/.env.example>) | Merge accepted type/function additions; add server renderer imports and explicit TSX check coverage; add proof scripts/config names only. Generate types from the disposable local schema, not the current linked remote `db:types` script. |
| [verify-ticket-shell-production.ts](</Users/exoh/Desktop/WhereTo -  Repository/scripts/verify-ticket-shell-production.ts>) | Extend bundle exclusion proof for new server-only renderer/provider modules. Preserve the existing no-Resend/no-React-Email/no-secret production browser boundary. |

**Free detail decision:** Recommend approving the narrow owner registration lookup/detail attachment above, coordinated with Spec 06/04. It is needed to make organizer resend reachable for free registrations. If another task supplies it before integration, reuse that implementation and drop these conditional files. If it is excluded, the resulting product is paid-only organizer resend with paid+free automatic/recovery email; that is a scope reduction requiring explicit approval, not completion of full source coverage.

**Spec 08 coordination:** Before editing shared customer/route/contract files, obtain its accepted snapshot and file ownership. Spec 07 owns only grant authorization and entry into the existing collection/focused view; Spec 08 owns its ticket-view behavior. Do not copy another task's entire diff or implement its flow.

## 8. Ordered implementation and acceptance gates

1. **Freeze an accepted integration baseline.** Reconcile clean operations base, preserved buyer/Create Event changes, Spec 04, incremental Spec 05, then the verified Spec 06 source. Record commits or precise authorized uncommitted snapshots. Resolve router, collection DTO, confirmation and generated-type overlaps once. Create only the new Spec 07 worktree after approval; do not alter other task worktrees. Gate: fresh baseline checks and accepted Spec 06 evidence, plus free detail/Spec 08 ownership decision.
2. **Implement grant authorization first.** Add access migration, crypto helpers and resolver. Write failing tests for cross-source/member access, expiry/revocation, legacy paid/free parsing and unchanged ticket identity/history; then implement. Gate: real disposable-database permissions and same-admission projections through old and new access paths.
3. **Implement durable intent/attempt lifecycle.** Add outbox/lease/dedup constraints and narrow paid/free enqueue hooks. Write failure/concurrency tests before worker code. Gate: issuance replay yields one intent; failed/unknown sends cannot write admission rows; crash after commit leaves discoverable work; rollback leaves neither partial issuance nor initial intent.
4. **Make existing templates server-compatible and implement one worker.** Relocate shared canonical renderer with frontend compatibility exports, add recovery template, pin Deno/npm renderer imports and test TSX bundling. Add disabled worker/runtime configuration and verified provider observation adapter. Gate: mock transport tests, HTML/plain text inspection and local Edge bundle smoke test; provider package never enters browser production graph.
5. **Attach organizer resend.** Add owner context/read, request identity, all six R05 states plus queued/Unknown and conditional free detail attachment. Gate: wrong-owner/event/source denial; exact recorded recipient; no alternate recipient; repeated clicks/remounts/late responses cannot generate another send; accepted and queued copy differ.
6. **Implement public recovery and email access.** Add neutral asynchronous request path, atomic limits/snapshot, index/member route and invalid-link recovery states. Gate: match/miss parity, fresh-browser access, correct multiple-source behavior, no future-purchase access, no account creation, no new ticket rows.
7. **Connect buyer delivery copy.** Add only read-only delivery notices to accepted paid/free confirmations. Gate: tickets remain immediately usable after issuance despite missing/queued/failed/Unknown email; mount/refresh causes no send.
8. **Integrated proof and review.** Run the checks below against the frozen integrated checkout. Inspect actual diff, shared-file reconciliation, production bundle and synthetic screenshots. Report all failed/skipped checks and fixture/provider distinctions. Stop before any external configuration or send; request those only with a concrete environment, sender and authorized recipient.

## 9. Required tests and evidence

Run in the isolated accepted Spec 07 checkout after implementation:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm typecheck:functions
pnpm test:functions
pnpm build
pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/verify-ticket-shell-production.ts
git diff --check
```

Run the new SQL and independent-session races only on a newly identified disposable Spec 07 database. Never reuse/reset the active Spec 04/05/06 containers. Configure the new `tests/integration/spec07-email-database.sh`, `tests/integration/spec07-email-concurrency.py` and `playwright.spec07.config.ts` to enforce loopback/disposable identity. Retain relevant Spec 04/05 owner-read/admission and Spec 06 issuance/collection regressions in that combined schema.

| Proof boundary | Required cases |
|---|---|
| Issuance/outbox | Paid and free success; duplicated fulfillment/registration; crash after commit; rollback; no send before authoritative commit; no browser-triggered initial send; no historical bulk-send on enablement. |
| No admission changes | Compare exact ticket IDs, source unit identities, credential hashes and original Used timestamps before/after initial preparation, resend, recovery, provider failures and concurrent retries. Assert zero new orders/registrations/tickets from resend/recovery. |
| Authorization | Wrong owner, changed owner/session, wrong event/source, guessed attempt ID, direct anon/authenticated table/RPC access, arbitrary recipient, mismatched grant member, forged/malformed grants. Reauthorize status reads; no cached private content after account change. |
| Eligibility/history | Mixed Used/Valid preserves all rows; fully Used/ended/refunded/cancelled blocked for new sends; refund pending/review; cancellation between enqueue and dispatch; cancellation after acceptance displays current inactive history; free original confirmed receipt is not present-validity proof. |
| Dedup/crash | Repeat click, reload, concurrent workers, expired lease and stale worker completion, crash before/after payload preparation, provider acceptance before DB acknowledgment, exact immutable replay, changed payload under old key rejected, 23/24-hour boundary, Unknown held beyond window, expired prepared link. |
| Provider semantics | Known rejection, network timeout, malformed success/no provider ID, transient failure, same-key replay, signed/invalid/duplicate/out-of-order webhook observations, bounce/suppression. No accepted→queued regression and no delivered-to-inbox claim. |
| Recovery privacy | Matching/missing/throttled neutral parity; invalid syntax; trusted IP extraction; concurrent recipient/source/event limits; malformed/oversized body; queue outage; recipient cap cannot suppress initial issuance; bounded timing distribution across matches/misses; no email/PII/token leakage. |
| Multiple collections | Paid+free, multiple purchases of same event, same-email repeat RSVP, 1/20/21/200/201 matches, deterministic bounded pagination, tampered cursor, snapshot excludes purchases committed after snapshot creation, changing member lifecycle stays live, no credential for nonmembers. |
| Fresh access | Fresh browser/session, email-scanner prefetch, fragment removal, reload, expiry/revocation, invalid-link form, one QR mounted at a time, unknown selector cannot select a foreign ticket, old paid and namespaced free links still work. |
| UI/email | All 12 mapped panels plus gaps; 320/390/768/1440 widths; keyboard/dialog focus; reduced motion; long event/recipient content; image failure; real timezone; HTML and plain text CTA/fallback; configured help only. |

Record evidence separately: template rendering; mocked provider sends; disposable SQL/RLS/concurrency; local real Edge/browser navigation; actual provider acceptance; observed recipient inbox arrival; successful received-link access. Passing a fixture renderer or a send API alone is not completion.

## 10. Configuration and approval checklist

Approve or change these concrete recommendations before implementation:

1. Separate random email grants with encrypted immutable retry payload; fragment-based email route; 30-day/end+24h initial/resend lifetime and 24-hour recovery lifetime.
2. Current-ticket-only recovery/resend eligibility, including fully Used/ended exclusion and temporary pending-refund block, without changing old link behavior.
3. One recovery email with fixed source snapshot, 20-per-page selector, 200-source overflow-to-support behavior.
4. Numeric rate limits, six bounded transport retries, 23-hour automatic idempotent-replay cutoff, retention and disabled-by-default worker activation.
5. Narrow free organizer registration lookup/detail attachment ownership; otherwise explicitly accept paid-only organizer resend.
6. Additive migrations and the shared-file integration sequence after accepted Spec 06 verification and Spec 08 handoff.

Manual setup needed later, not performed or assumed: approved application origin, sender identity and verified Resend domain/DNS, server `RESEND_API_KEY`, real From and Reply-To, working support URL/mailbox, dedicated grant-payload encryption key/key ID, rate-limit HMAC secret, worker token/Vault scheduling, signed webhook secret/endpoint, tracking policy, activation timestamp and a designated nonproduction recipient. Suggested environment names: `TICKET_EMAIL_FROM`, `TICKET_EMAIL_REPLY_TO`, `TICKET_SUPPORT_URL`, `TICKET_EMAIL_PAYLOAD_KEY`, `TICKET_EMAIL_PAYLOAD_KEY_ID`, `TICKET_EMAIL_RATE_LIMIT_SECRET`, `TICKET_EMAIL_WORKER_TOKEN`, `RESEND_WEBHOOK_SECRET`, `TICKET_EMAIL_ENABLED`. All remain server-only except a validated public help destination.

No real-send approval is requested by this plan. After local proof, a separate concrete provider test must identify the intended nonproduction setup and an explicitly authorized recipient. No DNS/provider change, scheduler activation, hosted migration, commit, merge, push or deployment is implied.

**Planning verification:** All 11 PDF pages were read and both embedded boards inspected. Product documents, worktree states, relevant executable code/migrations and retained reports/logs were reviewed. The template/mock-sender command initially matched 18 test files across the root and nested worktrees and returned 234 passed; collection listing confirmed the broad match. The root-only rerun, `pnpm exec vitest run src/features/ticket-experience/email/renderEmail.test.tsx scripts/send-ticket-ready-test.test.ts --exclude '**/.worktrees/**'`, passed **26 tests / 2 files** with exit code 0. All sends in these tests were mocked; no real sender CLI was executed. Root `git diff --check` passed. No full application, database, browser or provider proof was performed by this planning task. No migrations were added/applied and no application files were changed.

### Task 2: Independent grant and encrypted payload helpers

Implement ONLY supabase/functions/_shared/ticketEmailAccess.ts and ticketEmailAccess.test.ts in this Spec07 worktree. No other source edits, no commits, no provider/network/database operations, no subagents. Existing paid/free credential files must remain unchanged.

Exports and contracts:
- type EmailPurpose = 'initial'|'resend'|'recovery'.
- type ProviderEmailPayload = {from:string;to:string;replyTo:string;subject:string;html:string;text:string;tags:{name:'attempt_id';value:string}[]}.
- type EmailPayloadContent = {kind:'provider';request:ProviderEmailPayload}|{kind:'recovery_request';email:string}.
- type PayloadContext = {kind:'provider';attemptId:string;grantId:string|null}|{kind:'recovery_request';requestId:string}.
- type EncryptedEmailPayload = {version:1;keyId:string;nonce:string;ciphertext:string}.
- createEmailGrant(): Promise<{token:string;tokenHash:string}>: cryptographically random32byte canonical unpadded base64url, token em1_<43chars>. Do not use QR secret.
- hashEmailGrant(token:string):Promise<string>: strict47char canonical token, SHA256 UTF8('wheretoo:email-access:v1\n'+token) lowercasehex64. Reject malformed/padded/alternate encodings.
- grantExpiresAt(purpose:EmailPurpose,preparedAt:string,eventEndsAt?:string):string: recovery exactlyprepared+24hours; initial/resend canonical eventend+24hours, NO30daycap. Validate dates and reject result notfuture relativeprepared. Expiry fixed atpreparation; no reschedule extension.
- encryptEmailPayload(content:EmailPayloadContent,context:PayloadContext,keyId:string,key:Uint8Array):Promise<EncryptedEmailPayload>: AES256GCM random12byte nonce; AAD binds canonical explicitcontext,version,keyId. Validatepurposecontentmatchand UUIDIDs; plaintext<=256KiB.
- decryptEmailPayload(envelope:EncryptedEmailPayload,context:PayloadContext,keys:ReadonlyMap<string,Uint8Array>):Promise<EmailPayloadContent>: authenticate then strict runtimevalidate unionand content, bounded ciphertext, strictcanonicalencoding; generic errors withoutvalues. Providerpayload exactlyone attempt_id tag, valid UUIDmatchingcontext.attemptId. For recoverycanonicalemailmatchingSpec06ASCIIrules. No tokens/emails inerrors.
- emailRateFingerprint(secret:Uint8Array,lane:string,subject:string):Promise<string>: separate32byteHMACkey, boundedlane/subject, domain-separatedstablehexHMAC. Differentlanesmustnotcollide. Do notcall existing credentialderivation.

Use Deno WebCrypto; no Node-only code/dependencies. Follow existing source formatting and test-first. Tests include60daysbeforeeventexpiry,eventrescheduleunchangedpreparedexpiry,recoveryexpiry,randomtokenuniqueness/canonicalproof,rejection/oldpaidfreeprefixisolation,roundtripimmutablepayloadincludingattempttag,tamper/wrongkey/wrongcontext/wrongtag/oversize,previouskeylookup,randomnonces,and genericerrors that don'tcontainPII.

Read applicable AGENTS and existing ticketCredentials.ts for conventions. RED then GREENwith pnpm exec deno test --allow-env supabase/functions/_shared/ticketEmailAccess.test.ts; pnpm exec deno check correspondingfiles. Report detailed evidence, exactfiles, issues to .superpowers/sdd/2026-09-11-spec07-implementation/task-2-report.md. Return briefstatus only. No commits evenifskilltemplateasks.
