# Spec 08 approved implementation work order

Authority: approved conversation plan and user amendments; standalone /Users/exoh/Downloads/Wheretoo_Spec_08_Sold_Out_Payment_Recovery.pdf. This records execution, not a new planning gate.

## Global constraints

Preserve Stripe-hosted Checkout, wire contracts, request IDs/bearers, inventory/issuance/webhook behavior, idempotency and actual money. Only approved exception: exactly one additive post-dependency migration restores existing preflight cardinality 3 to 10, with no other schema changes. No new payment status model, inline payment details, invented bank/fee/tax/stage data, merge, push, deployment, provider change or real transaction. No generic buyer recovery to `/`; verified event association or omit action. Unknown is never failed and never authorizes replacement. Spec06 owns free capacity/registration/recovery; Spec07 owns email/access. Preserve /tickets/recover, /ticket-access, original View tickets reloadDocument and optional paid deliveryNotice. Freeze dependency snapshots before changes. No commits of inherited work. Work in this isolated worktree only.

### Task 1: Recovery safety and payment presentation

Implement approved same-order recovery in checkout.attempt.ts, checkout.recovery.ts, CheckoutPage.tsx, checkout.cart.ts, OrderConfirmationPage.tsx, order.queries.ts, OrderConfirmationView.tsx and cohesive new BuyerRecoveryView / buyer-recovery.css. These are browser lifecycle/operation metadata, not new financial statuses. Write failing tests first, preserve existing API contracts.

Unresolved stored identity blocks changed buyer/cart and never rotates for corrupt/unreadable storage. Persist submission history before invoking creation; valid legacy records are potentially submitted. Preserve no-PII identity storage, handle lost/deleted/corrupt state conservatively where detected. Same input uses exact original ID/bearer after status checking. Await/reconcile cancel. Persisted expired/cancelled/payment_failed alone does not unlock replacement: require existing cancel endpoint strict terminal acknowledgment. First sole definitive pre-reservation stock rejection may permit explicit edit; same code after earlier uncertainty cannot. Status errors/not-found on prior submission retain identity. Deduplicate clicks and stale completions. No generic '/' navigation, fabricated event associations, new recovery API, silent cart reductions, or resetting identity to dismiss UI.

Keep cart items on stock change, distinguishing syntax from membership. Known event route comes from validated public event or saved verified checkout association; private token cannot yield event ID. Existing order snapshot totals take precedence over current public prices for existing attempts. Exact same canonical input replay only; no buyer PII storage added.

Payment_failed: terminal failure copy, safe verified-new-attempt action. Processing: same-order 1s/60s bounded polling; no new checkout during checking. Cancel return: pending -> real result or unable confirm, never fire-and-forget. Paid: existing confirmation/collection/calendar plus separate Spec07 deliveryNotice. Unknown: same-bearer status retry with no replacement, support only if real configured capability. Hosted decline remains hosted (no local decline reason). Preserve other refunded/requires_review outcomes.

Tests: unresolved changed email/cart; missing/corrupt/legacy storage; timeout then stock rejection; first stock rejection then edit; repeated click/reload/Back; cancel failure and payment race; expired DB without provider terminal proof; polling exhaustion/delayed paid; no create on unknown status; private navigation and delivery slot compatibility. Run targeted frontend tests and report red/green evidence.

### Task 2: Attached Stripe session reuse hardening

In supabase/functions/stripe-create-checkout/index.ts and index.test.ts require retrieved attached session ID equals stored existingCheckoutSessionId and validated status=open before returning existing checkoutUrl. Preserve original key, request/response, financial snapshots, all cleanup protections and no downgrade of complete sessions. Test wrong ID, complete/expired sessions with syntactically valid URLs, paid session, and valid original open reuse. Existing INVALID_STRIPE_SESSION is safe fallback; no new API code. Run red then green function tests/types.

### Task 3: Availability presentation

Modify only paid availability/selection presentation in PublicTicketEventPage.tsx and TicketTierList.tsx with tests and scoped CSS. Nonempty current eligible paid tiers all sold_out -> Sold out, disabled CTA; mixed remains purchasable. Generic sellability -> Tickets unavailable. Preserve chosen quantities through availability change; require explicit review before removal/quantity/price changes. Never infer sold out from fetch/artwork failure or generic code. Use existing EventPageView and preserve Spec06 FreeRsvpEntry verbatim; its actual full status/remaining=0 owns RSVP Full, positive shortage is not full. No registration logic edits.

### Task 4: Verification and isolated evidence

Add fixture/browser proof for all 10 states (Sales closed and local decline use honest capability adaptations), actual production callbacks, 320/390/768/1440 widths, keyboard/live status/reduced motion/screenshots. Create own task-labelled disposable local DB with cron disabled, never reuse Spec06/07 containers; replay frozen migrations plus the one authorized cardinality correction, run existing reservation/expiry/confirmation/fulfillment and free compatibility/ownership/concurrency proofs. Keep provider transports fake/loopback-only. Run typecheck, lint, full frontend/functions/build/integration-safe suites, diff checks, independent review. Real Stripe TEST proof remains skipped without environment authorization. Report exact counts, source-vs-incremental files, all ten results and remaining limitations.
