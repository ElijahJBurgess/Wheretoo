# Spec 09 Activation / Implementation Readiness Report

11 September 2026. Activation/readiness only; no implementation approval assumed.

The existing whole-order writer is reusable, but Spec 09 is **blocked on contract decisions**, not merely missing screens. The largest gaps are durable recovery before webhook evidence, distinct refund outcomes, and refund-purpose delivery/private financial access.

Source: the user's pasted activation request and [Spec 09 PDF](/Users/exoh/Downloads/Wheretoo_Spec_09_Refund_Customer_Support.pdf). All 12 PDF pages were inspected; appendix R07, R01 and R05 were rendered and visually reviewed. Repository product definition, user flows, architecture, current code, migrations and relevant local handoff reports were inspected. Historical reports and their old authorizations were treated as evidence, not authorization for this pass.

## 1. Actual baseline and dependencies

Current directory is `/Users/exoh/Desktop/WhereTo -  Repository` (two spaces before “Repository”). Branch **main**, HEAD **1d87c88fbb9da4ea4bf335659de7623af084c92e**. Local `origin/main` points there too; no fetch or remote-state certification was performed. Main contains 72 pre-existing dirty/untracked entries, including Buyer Journey, Onboarding, preview/reference changes and checkout-preflight migration. They were not staged, reset or absorbed.

The clean organizer-operations branch is exactly 15 commits ahead of main, with no main-only commits. Spec 04–07 worktrees all have committed HEAD **94c546bd0961f501584f8a3437298b2331cafd5c**, plus distinct uncommitted work. Branch HEAD alone does not identify their contents.

| Worktree / branch | Actual role and state |
|---|---|
| `.worktrees/organizer-operations-v1` / `codex/organizer-operations-v1` | Clean committed organizer read/manual/refund foundation, including founder metric decisions and evidence-recovery adapter. |
| `.worktrees/spec04-integration` / `codex/spec04-integration` | 134 dirty entries at snapshot. Filtered order reads, V2 immutable detail, responsive operations and delayed canonical refresh implemented locally. |
| `.worktrees/spec05-check-in` / `codex/spec05-check-in` | 165 dirty entries. Inherits Spec 04; adds individual guest search/manual flow, scanner recovery and original Used-time presentation. |
| `.worktrees/spec06-free-rsvp` / `codex/spec06-free-rsvp` | 54 dirty entries. Real separate free registrations, atomic request/replay, shared tickets/admission dispatch and private collection implemented. No paid order or Stripe refund target. |
| `.worktrees/spec07-ticket-email` / `codex/spec07-ticket-email` | Broadest dependency working tree: Spec 04/05/06 migrations plus outbox/grants/resend/recovery code. Uncommitted and still changing during inspection (143, later 150 entries); not a frozen integration baseline. |

All 21 worktrees were inventoried. Additional relevant lineage: `checkout-integrity-1` at `4814d42`, `core-ticket-truth-lite-1` at `f05f907`, `ticket-experience-shells-1` at `6ec5a51`, and `final-integration` at main's HEAD. Organizer Create at `/Users/exoh/Desktop/WhereTo-organizer-create` has inherited uncommitted work. Map/cartoon/context-map/preview and older planning worktrees were inventoried and left untouched. Local buyer/dev-world branches also point at main; their names do not capture main's uncommitted changes.

Byte comparisons found the committed refund helper, organizer endpoint/adapter and evidence validator unchanged in Spec 07. Spec 05's operations files match Spec 07 except dashboard and order-detail integration. Spec 06's RSVP files match except confirmation/delivery integration. Spec 04/05/06 migration files are present in Spec 07. This makes Spec 07 a dependency integration candidate, **not permission to copy its entire working tree**.

### Migration baseline

| Location | Latest migration file / observed database state |
|---|---|
| main committed HEAD | `20260907010300_preserve_lite_ticket_invalidation.sql` |
| main working tree | Also untracked `20260909010100_allow_checkout_preflight_status_refresh.sql` |
| committed organizer operations | `20260910010350_add_owned_refund_evidence_recovery.sql` |
| Spec 04 | `20260911010000_extend_spec04_organizer_reads.sql` |
| Spec 05 | `20260911020000_add_owned_admission_search.sql` |
| Spec 06 | Four migrations `20260912010000` through `20260912010300` |
| Spec 07 | Seven email migrations `20260913010000` through `20260913010600_add_email_retention_and_recipient_suppression.sql` |
| Default local `supabase_db_WhereTo` | Read-only migration ledger: **68 entries; max version 20260826011475**. It lacks the newer refund preparation/owner APIs inspected here. |
| Dedicated Spec 04/06/07 databases | Running on loopback 55445/55465/55475. Read-only catalog inspection confirms relevant APIs, including Spec 07 scoped email access. These databases have no `supabase_migrations.schema_migrations` ledger, so a verified migration head cannot be inferred from their names or reports. |

No migration was created/applied. No hosted database was inspected. Filename timestamps are ordering identifiers, not proof of deployment. Use a fresh dedicated Spec 09 database after approval.

## 2. Exact refund implementation and truth

The following paths are relative to the inspected Spec 07 worktree unless stated otherwise; they also exist in the clean organizer-operations baseline where noted.

| Responsibility | Existing implementation |
|---|---|
| Auth and authorization | `_shared/auth.ts: requireOrganizer` verifies the bearer with Supabase Auth and finds the organizer. `organizer-refund-order/index.ts` then calls service-only `server_get_organizer_refund_context(organizer,event,order)` before provider work. SQL checks both event/order ownership, paid source, TEST mode and coherence. |
| Entry point | `supabase/functions/organizer-refund-order/index.ts`. Strict JSON accepts **only** `{eventId, orderId}`; extra amount/ticket/provider fields are rejected. CORS, body bound and private/no-store responses already exist. |
| Preparation | `server_prepare_whole_order_refund` → guarded `private.prepare_whole_order_refund`; defined/hardened by `20260902010400`, `10450`, `10475`. Existing event/payment locking; immutable order total/currency/payment/transfer/fee snapshots. |
| Sole financial writer | `supabase/functions/_shared/refundOrder.ts: createWholeOrderRefund`, called by `organizer-refund-order/refundAdapter.ts: refundOwnedOrder`. Provider call is `stripe.refunds.create`. Organizer reason is fixed to `requested_by_customer`. |
| Identity and economics | Key **`whereto-refund-integrity-v1:${orderId}`**; amount is stored `total_minor`, currency USD; `reverse_transfer: true`, `refund_application_fee: true`. Evidence must match the full total and original application fee. Preserve this exact policy and helper. |
| TEST guard | Existing restricted TEST-key client and bound Charge validation; `providerContract.ts` handles Stripe Refund objects without inventing a provider `livemode` field. |
| Durable reconciliation | `stripe-webhook/index.ts` verifies the signed raw event, retrieves current provider objects/economics and calls `server_apply_verified_refund`. `public.refunds` stores provider identities/status/economics; `stripe_webhook_events` deduplicates evidence. A provider acknowledgement alone returns pending. |
| Evidence repair | `recoverOwnedRefund` → `_shared/refundEvidenceRecovery.ts: recoverExistingRefundEvidence`. Validates bounded refund/reversal/fee evidence and updates matching missing metadata on the existing refund. It neither creates a refund nor directly changes order/tickets; signed webhook reconciliation completes it. |
| Canonical projection | Full verified economics set order `refunded` and `refunded_at`. Unused valid/cancelled tickets become refunded; Used rows and their timestamps are untouched. IDs/items/paid history remain. |
| Inventory vs history | Full refund removes **all three paid inventory commitments**, including the unit previously used. Historical sold, subtotal gross, successful order count, issued denominator and prior entry remain. This is the founder-approved matrix, not a new Spec 09 policy. |

**Important missing contract:** preparation only locks/reads. There is **no durable pre-provider refund-request/operation row**, dispatch timestamp, or retained submission outcome in the inspected schema. `public.refunds` is a provider-evidence ledger, not a pre-call request ledger. Until a webhook arrives, a submitted order can still project `available`.

On a thrown provider call, the endpoint rereads owner context: recorded pending/refunded is returned; otherwise it returns generic `unconfirmed`/503. Recovery is exposed only for `requires_review` + `REFUND_POLICY_MISMATCH` with exactly one recorded succeeded/unverified refund. The shared validator supports a nullable refund ID, but the organizer recovery schema requires one and does not expose the no-evidence timeout case. It also expects succeeded evidence, not general pending/failure observation.

The stable key is valuable but is not permanent local request persistence. Stripe documents that keys may be pruned after at least 24 hours, after which reuse creates a new request. Consequently, an unlimited “retry safely” UI is not a complete unknown-outcome guarantee. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)

## 3. Requirement-by-requirement gap classification

**Reusable** = implemented in the identified dependency code, not claimed deployed. **Adapt** = implemented but insufficient for Spec 09. **Missing**, **Dependency**, and **Decision** identify their respective gates.

| Requirement | Classification and exact gap |
|---|---|
| Whole-order only; immutable amount; reversal/fee economics | **Reusable.** Keep the single helper, strict input and fixed reason/key. No partial/per-ticket writer. |
| Organizer → event → order; invalid IDs/client amount/free-source rejection | **Reusable.** Existing server boundaries; retain negative tests. Current response hides several refusal classes as generic unconfirmed. |
| Refund eligibility | **Adapt.** Current owner states are available/pending/refunded/unavailable/recoverable. Available requires coherent paid/reconciled order with no succeeded refund; preparation also requires provider references. Failed/cancelled refund evidence can project available; `requires_action` projects pending. No new used-ticket or event-end restriction should be invented. |
| Submitting | **Adapt.** Local button disabling exists; no durable cross-tab/reload request state. |
| Accepted / processing | **Adapt.** Endpoint acknowledges pending and polls canonical detail; no pre-webhook operation persistence. |
| Action required / review | **Adapt.** SQL stores requires_action and review reasons, but owner projection collapses them. Narrow evidence repair exists; unrelated review must never invite blind retry. |
| Definite failure | **Missing safe presentation contract.** Provider failed/cancelled evidence exists; endpoint/browser discard the distinction and retry permission. |
| Unknown after timeout | **Missing complete recovery contract.** Local error + reread exists; no durable uncertain-operation state or no-evidence provider reconciliation through the organizer endpoint. |
| Canonical complete / already refunded | **Adapt.** Canonical-only completion and no-create already-refunded handling work. Add historical result summary, actual refund amount/time and disabled completed action; existing detail lacks refund timestamp/evidence summary. |
| Ineligible / unauthorized | **Adapt.** Server refusal exists; preserve safe categories and auth expiry instead of generic error. Do not disclose foreign resource existence. |
| Orders / Order Details integration (Spec 04) | **Reusable + adapt.** `get_organizer_order_v2`, filtered list and owner/identity caches exist. Preserve legacy/V2 compatibility and canonical refresh beyond dialog closure. Add refund result projection separately or version it; strict consumers must not break. |
| Destructive confirmation | **Adapt.** `RefundOrderDialog`/`OperationsDialog` already exist with modal/focus behavior. Add event, actual buyer/recipient, affected ticket states, explicit post-reconciliation wording and R07 hierarchy. Cancel must make no request. |
| Used + Refunded mixed truth | **Reusable.** SQL preserves Used and exact timestamps; organizer reads show them. Paid buyer collection currently exposes status but omits Used timestamp and order reference; its client rejects those additional paid fields. Any buyer enrichment requires an explicit allowlist extension. |
| Buyer refunded ticket UI | **Reusable + adapt.** Existing inactive crossed-out artwork contains no real QR; status and tier/position retained. Add approved safe order reference/support context. Never render or copy a saved credential into the inactive treatment. |
| Old QR rejection / scanner result (Spec 05) | **Reusable.** `server_redeem_organizer_ticket` → existing paid redemption authority; Used/refunded/cancelled terminal outcomes, original Used time, atomic first entry. QR/manual share the writer; red “Ticket refunded” result exists. Regress refund/check-in races. |
| Free registration (Spec 06) | **Reusable dependency boundary.** Separate free source with exclusive ticket source and `tickets_free_not_refunded` constraint. Not a zero-dollar refund target. Keep free flow regression coverage. |
| Admission resend disabled | **Adapt / Spec 07.** Server eligibility and Cannot resend dialog block refunded/cancelled/unresolved/no-valid-ticket sources. Order Details still shows an enabled Resend entry on refunded orders; disable it with explanatory state. Pre-webhook unknown refunds are not yet visible to send eligibility. |
| Buyer whole-order refund notice | **Dependency + missing.** `TicketRefundedEmail.tsx` is an existing per-ticket rendering shell, not a connected whole-order message. Outbox/grant purposes allow only initial/resend/recovery. No canonical refund enqueue or refund-notice retry/deduplication exists. |
| Secure View order details | **Dependency + decision.** `server_read_ticket_email_access` resolves scoped ticket collections, not financial order details. Still-valid old grants can show current refunded-ticket history; new current-ticket sends/recovery exclude refunded sources. Neither grants private financial access. |
| Notification independent of refund | **Reusable foundation + missing integration.** Shared email worker/outbox preserve accepted/failed/unknown and delivery observations, immutable retries and suppression. Add refund-purpose integration; never equate refund completion, provider acceptance and inbox delivery. |
| Historical metrics / inventory | **Reusable.** Historical paid-at based totals and all issued/Used counts survive refund; current inventory is computed separately. No erasing sales or prior entry. |
| Support/contact | **Decision/configuration.** Spec 07 has `DeliverySupport`, `VITE_TICKET_SUPPORT_EMAIL` and server `TICKET_EMAIL_SUPPORT_EMAIL`. No approved monitored destination was established by this audit; no public organizer-support field or working refund support route was found. Login email must not be substituted. |
| R07/R01/R05 visual/accessibility | **Adapt.** Use existing dark/purple shells, red destructive treatment and existing scanner/buyer components. R07's enabled resend and “all tickets invalid”/“buyer notified” copy must be corrected. Additional pending/review/failure/unknown shells need implementation and visual proof. |

## 4. Decisions and conflicts requiring approval

1. **Durable operation extension:** approve a small service-only operation ledger around the existing writer, one logical row per order with immutable key/reason/snapshot, pre-dispatch evidence and outcome/recovery state. Recovery must inspect the existing operation/provider evidence; no fresh key after timeout. Proposed conservative rule: an uncertain or expired replay window permits status/recovery only; definite failure does not automatically authorize a new financial operation. This is an additive request/recovery contract and schema change, not a competing writer.
2. **Admission review-hold conflict:** the latest request says unused tickets become non-admissible only after canonical full completion. Existing approved anomaly handling instead sets partial/economically unverified succeeded refunds to `requires_review`, cancels unused tickets, and retains inventory; the paid reader/admission authority also fails closed on review. Recommend retaining that safety hold as an explicit exception while normal submission/pending/failure leaves admissions unchanged. This exception needs your decision; it will not be silently adopted.
3. **Spec 07 refund access/message agreement:** approve a distinct whole-order `refund_notice` purpose using the shared outbox/worker, bound to one canonical completed refund/order. Approve the recipient source (stored buyer email), minimal financial-detail allowlist, grant lifetime/revocation/retention, after-event access and any expired-link recovery policy. Recommend a separate purpose-scoped financial read; current ticket grants must not gain financial authority. No numerical access window or new anonymous history recovery is assumed.
4. **Support and rollout scope:** provide/approve the actual monitored support destination and permitted label (“Contact support” unless a real organizer channel exists). Decide whether to approve financial/UI implementation with notice/access explicitly incomplete while Spec 07 finishes, or require that dependency first. Implementation approval must name the accepted dependency snapshot and local test environment. Provider/email activation remains separate.

No need to revisit pricing, partial refunds, event cancellation, dashboard design or the existing fee/refund economics. These remain outside the plan.

## 5. Incremental implementation sequence for approval

Execute sequentially; changes overlap Spec 04–07 contracts.

1. **Freeze and verify the dependency baseline.** After approval, create an isolated `codex/spec09-refund-support` worktree from `94c546b` plus explicitly reviewed Spec 04/05/06/07 deltas. Preserve main/Create/Buyer/Onboarding/map work. Recompare the current Spec 07 working tree before integrating, establish migration order and resolve its baseline test/typecheck failures in the owning dependency. No blanket copying or merge is assumed.
2. **Specify and test durable refund operations.** Add the service-only order-unique operation ledger and safe owner status projection. Claim/replay under existing event/order locking before possible dispatch; retain exact amount/currency/fee/key/reason. Extend the current adapter's dispatch/recovery bookkeeping and observation of absent/pending/failed evidence. The only create call remains in `refundOwnedOrder` through `createWholeOrderRefund`; canonical money/ticket writes remain webhook-owned. Test concurrent clicks, server crash, no-webhook timeout and aged replay before UI changes.
3. **Expose authoritative outcome states without breaking Spec 04.** Add a dedicated owner-scoped refund summary/status read, preserving `get_organizer_order` and V2 strict shapes. Return allowlisted state, whole-order amount/currency, available request/completion timestamps and permitted action (`submit`, `check_status`, `recover_existing`, or none). Keep provider IDs, payloads, keys and hashes service-only. Adapt endpoint/transport error mapping; unauthorized and unavailable remain privacy-safe.
4. **Attach R07 confirmation/results to existing Order Details.** Implement all eight required state classes, current eligibility, pending/unknown recovery, destructive cancel/focus behavior and canonical completion summary. Unknown has Check status, not generic Refund again. Refresh V2 order, list, metrics and delivery eligibility after authoritative changes. Disable Resend for refunded/ineligible/uncertain orders; keep the R05 explanation accessible. No dashboard rebuild.
5. **Integrate the approved Spec 07 purpose and read.** Extend existing purpose constraints, deduplication, preparation/dispatch and grant resolution for one whole-order refund notice. Add a service-only catch-up enqueue step to the shared worker: select already-committed canonical full refunds and insert the unique logical notice. Enqueue failures remain recoverable independently of financial completion; no email call belongs in the refund transaction. Freeze retry payloads, retain the same logical notification identity, and keep resend eligibility separate. Add the approved financial-detail read/page with purpose/membership/expiry/revocation checks and no order-number-only authorization.
6. **Finish buyer/support and admission integration.** Reuse inactive ticket/scanner shells. Add only approved safe reference/Used-history fields to paid collection contracts if required; preserve existing ticket IDs and QR authority. Add configured support links to refund results/notice/private history. Free registrations stay excluded. Apply the explicit decision on anomalous review holds without creating client-side precedence rules.
7. **Run local acceptance, accessibility and reference verification.** Use the exact three-ticket proof below and regress affected Spec 04–07 boundaries. Compare R07's eight panels and exception states at 320/390/768/1440px, keyboard/focus/live announcements, reduced motion and no stale private data on identity change. Review actual diffs and sanitize evidence.
8. **Separate release proof.** Only with later environment/recipient authorization, run a real Stripe TEST whole-order refund and signed-webhook reconciliation, then independently prove configured email delivery. Record exact cleanup and distinguish accepted versus delivered. No production keys, provider configuration or external sends are included in this activation pass.

### Expected files/modules and schema impact

Existing modules to adapt:

- `supabase/functions/organizer-refund-order/{index.ts,refundAdapter.ts}` and tests; `_shared/refundEvidenceRecovery.ts` only for narrowly reviewed existing-operation observation. Preserve `_shared/refundOrder.ts` economics and single-writer role.
- `src/features/organizer-operations/{RefundOrderDialog.tsx,OrganizerOrderDetailPage.tsx,operations.api.ts,operations.schemas.ts,operations.queries.ts,organizer-operations.css}` and tests. Add cohesive `refund.state.ts`/`refund.state.test.ts` for presentation mapping.
- Spec 07 `_shared/{ticketEmailWorker.ts,ticketEmailAccess.ts}`, corresponding Edge access/status boundaries, `src/features/ticket-delivery/` schemas/queries/support and `src/features/ticket-experience/email/{email.types.ts,renderEmail.ts,EmailFrame.tsx}`. Add `OrderRefundedEmail.tsx` and a private refund-order details page under `ticket-delivery/`; retain existing ticket template compatibility.
- Router for the approved private history destination; paid collection SQL/Edge/adapter schemas only for approved history/reference enrichment. Buyer/scanner presentation changes stay scoped; admission writer changes are not presumed.
- `src/lib/supabase/database.types.ts`, regenerated from the dedicated migrated local schema; new SQL/Edge/UI/E2E tests and verification report.

**Schema changes appear necessary:** (a) pre-provider operation persistence and owner-safe refund status/read functions; (b) shared refund-notice purpose, deduplication, financial grants/projection and enqueue/status functions. Use additive migrations after the accepted dependency head; do not rewrite earlier migrations. Separate the two migrations/contract reviews. Any review-hold policy change needs its own approved transition changes/tests. No new payments/tickets engine, card data, broad browser grants or parallel email sender.

## 6. Exact verification sequence

Use a synthetic **paid order: 2 GA at $20 + 1 VIP at $30**, USD total/subtotal $70 and zero tax; use its persisted application-fee snapshot, not an invented fee formula. Record all three IDs, both unused credentials privately, original item snapshots and metric/inventory baselines. Use the existing fixture/credential helpers; never print bearer/QR/provider payloads.

1. Canonically fulfill once; assert three issued tickets, historical gross 7000, sold 3, order count 1, check-ins 0/3. Admit one GA through the existing authority and capture exact database `used_at` (not rounded UI text).
2. Cancel confirmation: zero operation/provider effects. Submit whole-order refund: one logical operation/key and immutable $70 amount. Duplicate clicks/tabs/server retries cannot create another financial operation.
3. At local submitting, provider acceptance and pending webhook: order remains paid, tickets **Used/Valid/Valid**, used timestamp/IDs/items unchanged, inventory still committed. Include a further admission-versus-refund race as a separate fixture.
4. Reconcile verified full completion: order refunded; tickets **Used/Refunded/Refunded**; exact used timestamp/IDs and order/items preserved. Historical metrics remain $70, 3 sold, 1 order, 1/3 entry. Assert inventory independently: GA commitment decreases by 2 and VIP by 1, including the used unit.
5. Present both saved unused QRs through the real server admission handler: both refused as refunded. Rescan used ticket: original Already used/time, no new entry. Check buyer history has no inactive QR and admission resend is disabled/refused server-side.
6. Negative matrix: existing pending/refunded operation, wrong organizer, same organizer/wrong event, malformed/missing identifiers, free-registration ID, client amount/currency/ticket injection, auth expiry before submit, owner switch and stale cache. Assert zero unauthorized provider work and no private-data disclosure.
7. Recovery matrix: timeout before dispatch, timeout after provider acceptance before webhook, crash between dispatch/receipt, reload, delayed/duplicate/out-of-order signed webhook, missing evidence, evidence retrieval failure, malformed/conflicting economics, partial external refund, requires_action, definite failed/cancelled refund, stale idempotency window. Assert unknown stays unknown until evidence; recovery never creates another refund. Test the specifically approved review-hold behavior.
8. Notification matrix: only completed refund queues notice; duplicate completion deduplicates; enqueue/worker/provider failures leave money/tickets unchanged; retry only notification; acceptance is distinct from signed delivered/bounced/failed observation. Test expired/revoked/wrong-purpose/wrong-member financial grants, order-number guessing, cross-order selectors and no new current-ticket resend for refunded orders.
9. Regression commands in the accepted worktree: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:functions`, `pnpm typecheck:functions`, `pnpm build`, `git diff --check`; focused integration recovery suite below. Run SQL suites for checkout refunds, Lite lifecycle/redemption, organizer metrics/reads/refund context, Spec 05 races, free-source isolation and Spec 07 delivery/access in a dedicated disposable database. Add `spec09_refund_lifecycle.test.sql`, `spec09_refund_operations.test.sql`, notification/access tests and `playwright.spec09.config.ts`/`tests/e2e/spec09-refund.spec.ts`.

**Evidence separation:** stubbed provider acknowledgements, offline signed fixtures, real local SQL transitions/races and browser journeys are local/synthetic proof. Actual Stripe TEST objects, real signed-webhook delivery and economics are a later release gate. Email acceptance/delivery needs separate actual-provider evidence. Browser decoder proof is not physical-camera proof.

## 7. Checks actually run in this activation pass

These are fresh observations from `.worktrees/spec07-ticket-email`, not copied historical passing counts:

- `pnpm exec deno test --cached-only --allow-env supabase/functions/_shared/refundOrder.test.ts supabase/functions/organizer-refund-order/index.test.ts supabase/functions/organizer-refund-order/providerContract.test.ts supabase/functions/stripe-webhook/index.test.ts supabase/functions/_shared/ticketEmailWorker.test.ts supabase/functions/_shared/ticketEmailAccess.test.ts` — **114 passed, 0 failed**. Runtime network permission not granted; provider/DB dependencies injected. Signed tests use offline fixtures.
- `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/task14RefundRecovery.test.ts` — **55 passed**, fixture/contract tests, not actual provider or database reconciliation.
- `pnpm exec vitest run src/features/organizer-operations/RefundOrderDialog.test.tsx src/features/organizer-operations/operations.reads.test.ts src/features/ticket-delivery/ResendTicketsDialog.test.tsx src/features/ticket-delivery/TicketEmailAccessPage.test.tsx src/features/ticket-experience/customer/FocusedTicketView.test.tsx src/features/ticket-experience/scanner/OrganizerScannerPage.test.tsx` — initial run lacked public environment configuration (2 suite-load failures; 21 passed/10 failed). Rerun with synthetic `VITE_SUPABASE_URL=https://spec09-disabled.invalid`, `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_spec09_disabled`, `VITE_MAPBOX_ACCESS_TOKEN=spec09-disabled`, `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_spec09_disabled`: **44 passed, 10 failed; 4 files passed, 2 failed**.
- Frontend failures: nine focused-ticket tests mount outside Router context after the inherited BuyerHeader gained a Link; one access test queries heading “Tickets unavailable” although the actual fail-closed result renders that text as a paragraph/alert. These do not establish an access leak, but the dependency test baseline needs repair. No source/test files were fixed.
- `pnpm typecheck` — initial run **failed**, TS2345 in `src/config/browserEnv.ts:27` (`flatMap` tuple inference after adding support-email configuration); later chained checks did not execute. Concurrent Spec 07 work then changed that file to use an explicit tuple type. A final rerun **passed, exit 0**, including all four chained TypeScript checks. This pass did not make that fix. Full build, lint, full suites and browser/SQL mutation proofs were not run; this pass does not certify them.
- Read-only Git/history/worktree/content comparisons and PostgreSQL catalogs/available migration ledger inspected. Stripe docs CLI returned 403; official web documentation supplied the idempotency reference. No refund/email/provider operation was executed.

Final content comparison found only this report added in the main checkout and unchanged HEADs. Spec 07 changed concurrently in browser environment/types, delivery schemas, browser harness and expiry-test files; its latest handoff must be rechecked before integration. The findings above identify observed contracts and test runs, not a frozen or release-certified Spec 07 snapshot.

Deliverable change by this pass: this report only. No application edits, migrations, commits, staging, merging, pushes, deployment or provider configuration. Scratch PDF renders/test output are outside the repository under `/tmp/wheretoo-spec09-readiness`. Existing ignored tool caches may be updated by tests/typecheck. Manual setup now: none. Implementation/test-database setup and delivery/provider activation await the approvals above.

BLOCKED — DECISION REQUIRED
