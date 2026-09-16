# Spec 09 approved implementation work order

Authority: user approval after Docs/testing/spec09-activation-readiness.md; PDF and original request remain scope. Work only in .worktrees/spec09-refund-support; no commits, shared DB mutation, provider calls, merge/push/deploy. Frozen 716-file Spec07 archive inherited from Spec08's pre-edit baseline, SHA256 map 9306b44aa805738511d3742df5f59e916eab4049695a003dd5fcafc3ca3900e2. No Spec08 implementation copied.

## Decisions under the approved complete-domain scope

- Preserve existing canonical review safety holds for partial/anomalous successful refunds; only normal submission/processing/unknown leaves admission unchanged. Do not change approved economics/inventory. Used remains terminal.
- Use purpose-scoped refund_notice grants lasting 30 days from preparation, usable after event end, revoked/expired server-side; no anonymous financial-history recovery. Minimal private read: event title/schedule/venue, order reference, currency/immutable total/subtotal/items, refund amount/completion time, ticket IDs/labels/states/original used times; no provider data, raw QR, buyer email or original bearer. Notice recipient comes from original order buyer email. These reversible defaults are recorded for review; do not enable external delivery.
- Durable one-per-order operation around existing helper; safe reconciliation never generates a new key or second logical refund. Persist possible dispatch before provider work. No automatic new attempt after definite provider failure; ambiguous cases inspect existing evidence. Same-key replay, if exposed, must be bounded and explicit; prefer conservative no-create recovery.
- Existing Spec07 worker/outbox/encryption/signed observations handle refund_notice. Add purpose-specific preparation and financial resolver, not a second sender/access system. Canonical-completion catch-up enqueue runs separately from the money transaction.
- Spec08 concurrently owns CheckoutPage, checkout attempts/recovery/cart, OrderConfirmationPage/View, order.queries, PublicTicketEventPage, TicketTierList, stripe-create-checkout and possibly router/support/buyer shared components. Do not edit these. Supply exact deferred attachments for router/confirmation/buyer. Isolated Spec09 test harness can mount owned routes directly.

## Tasks and owned boundaries

1. Core (root): migration 20260914010000_add_refund_operations.sql, supabase/functions/organizer-refund-order/{index,refundAdapter,refundOperation,refundObservation}.ts, tests; dedicated local DB/harness. Preserve helper and canonical webhook writer. SQL operation/read APIs have strict ownership, snapshots, one-operation uniqueness, durable dispatch, safe state projection from refunds/order. Enrich observation/recovery without a second create path. Test first.
2. Delivery implementer: migration 20260914010200_add_refund_notice.sql; existing shared ticketEmailWorker/Access + narrow refund purpose modules; new refund-detail-access Edge and OrderRefundedEmail; SQL/unit tests. Do not touch core migration/endpoint/UI/router/types/package or Spec08 files. Consult root for shared interfaces. Root owns DB execution and generated types.
3. UI implementer: src/features/refunds/* plus narrow OrganizerOrderDetailPage attachment (not Spec08 owned), refund-specific CSS/tests and deferred shared-file patch doc. Do not edit backend, router, checkout/confirmation/buyer shared components. Own new RefundDetailsPage and refundRoutes.tsx. Use existing shells and actual approval state map; no QR in refund detail.
4. Integration (root): dedicated loopback DB with cron off, SQL migrations/tests/concurrency, Edge/browser harness, actual UI screenshots at 320/390/768/1440, generated types, regression and full configured checks. Shared files remain deferred only where concurrent Spec08 ownership applies; tests mount owned routes independently.
5. Independent review: security/economics/idempotency/admission/privacy/notification review of incremental files; fix actionable findings and rerun affected checks. Handoff records baseline vs owned delta, deferred patches and real-provider evidence not run.

## Organizer wire contract (new; legacy detail reads unchanged)

get_organizer_refund_status(p_event_id uuid,p_order_id uuid) -> strict JSON:
{orderId,eventId,orderNumber,eventName,buyerName,buyerEmail,currency:'usd',totalMinor,quantity,items:[{tierName,quantity,subtotalMinor}],tickets:[{id,admissionLabel,status:'valid'|'used'|'refunded'|'cancelled',usedAt:string|null}],state:'eligible'|'submitting'|'processing'|'failed'|'unknown'|'review'|'completed'|'ineligible',action:'submit'|'reconcile'|'none',requestedAt:string|null,completedAt:string|null}

organizer-refund-order POST {eventId,orderId,action?:'submit'|'reconcile'} -> {outcome:'processing'|'unknown'|'review'|'failed'|'completed'|'already_refunded'|'ineligible'|'unauthorized'}. Invalid input -> 400, auth -> 401/403, safe state refusals -> 409 or 200. Never return raw provider text/IDs/operation keys. Default action submit preserves old request shape; caller must read new canonical summary for result. No new payment status.

## Verification

Synthetic paid 2 GA $20 + VIP $30: fulfill, admit one, retain exact timestamp/IDs, submit, prove pending no mutation, signed offline/canonical SQL completion -> Used/Refunded/Refunded; historical $70/3 sold/1 order/1 of 3 entry, all 3 inventory commitments released independently. Test old QRs, resend, auth/owner/event/amount injections, duplicate/reload, unknown/no webhook/evidence failures, review anomalies, notification independent failures, purpose/expiry/revocation/member isolation. Production providers blocked; own disposable DB only. Baseline typecheck/frontend/functions before changes; run full configured checks on final tree. No physical-camera or real Stripe/Resend proof claims.
