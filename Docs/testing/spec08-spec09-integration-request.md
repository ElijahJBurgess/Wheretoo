Integrate Spec 08 + Spec 09 into one frozen local baseline. This is an integration/reconciliation task only — do not redesign or expand either spec.
Spec 08
-  Worktree: .worktrees/spec08-payment-recovery 
-  Branch: codex/spec08-payment-recovery 
-  Starting/current HEAD: 94c546bd0961f501584f8a3437298b2331cafd5c 
-  Locally complete and verified 
Spec 09
-  Worktree: .worktrees/spec09-refund-support 
-  Branch: codex/spec09-refund-support 
-  Locally complete and verified 
Spec 09 intentionally deferred small shared-file attachments until after Spec 08:
- router.tsx 
- OrderConfirmationView.tsx 
- FocusedTicketView.tsx 
-  combined Supabase type regeneration 
-  integration-only verification 
Produce one isolated combined checkout where:
-  Spec 08 payment recovery remains unchanged 
-  Spec 09 refund behavior is fully attached 
-  shared files preserve both specs 
-  Spec 06 and Spec 07 behavior remains intact 
-  no duplicate routes, competing state machines, or overwritten props/callers are introduced 
Do not merge either source branch into main.
Before editing:
1.  Record exact worktree paths, branch names, HEADs, and dirty/untracked state for Spec 08 and Spec 09. 
2.  Read: 
   -  Spec 08 verification report 
   -  Spec 09 implementation handoff 
   -  Spec 09 deferred shared-integration report 
   -  Spec 09 changed-files manifest 
3.  Identify every file changed by both specs. 
4.  Classify overlap as: 
   -  automatically compatible 
   -  needs narrow reconciliation 
   -  contract conflict 
If you find a real contract conflict, stop and report it. Ordinary shared-file overlap is not a blocker.
Create a new worktree/branch for this combined result, for example:
-  worktree: .worktrees/spec08-spec09-integration 
-  branch: codex/spec08-spec09-integration 
Use the approved shared dependency baseline already underlying Specs 08/09.
Do not modify either source worktree.
Spec 08 owns:
-  checkout attempt identity 
-  storage-loss/replay safety 
-  sold-out / unavailable states 
-  Stripe-hosted Checkout session reuse 
-  payment processing/failure/cancellation recovery 
-  same-order polling 
-  successful purchase confirmation behavior 
Spec 09 owns:
-  durable whole-order refund operations 
-  refund idempotency/recovery 
-  refund lifecycle states 
-  canonical refund reconciliation 
-  ticket/inventory refund consequences 
-  organizer refund UI 
-  buyer refund history 
- refund_notice 
-  secure refund-detail access 
-  configured support integration 
Spec 07 continues to own:
-  email delivery/access infrastructure 
- /tickets/recover 
- /ticket-access 
-  delivery status 
Do not collapse payment status, refund status, or delivery status into one state machine.
Attach Spec 09’s deferred routes without changing or removing:
-  existing purchase routes 
-  ticket collection routes 
-  Spec 06 RSVP routes 
-  Spec 07 /tickets/recover 
-  Spec 07 /ticket-access 
-  Spec 08 checkout/payment routes 
No duplicate route definitions.
Preserve Spec 08’s canonical successful-payment presentation and recovery behavior.
Add only the Spec 09 refund-history/refund-status attachment required by its handoff.
Preserve:
-  original View tickets navigation 
-  calendar behavior 
-  optional Spec 07 deliveryNotice 
-  existing props and callers wherever possible 
Payment status and refund status must remain distinct.
Preserve Spec 08/07 ticket presentation and QR rules.
Attach Spec 09 refunded-history behavior exactly as specified.
Requirements:
-  valid ticket can still show QR where authorized 
-  Used preserves original Used state/timestamp 
-  Refunded/Cancelled never expose an active QR 
-  refund history must not regenerate or alter credentials 
Preserve all existing migrations exactly.
Include:
-  Spec 08’s single forward-only corrective migration restoring 3 → 10 distinct tiers 
-  Spec 09’s two additive migrations 
Do not rewrite earlier migrations.
Check ordering/collisions across the combined migration set.
Replay only against a new disposable local database.
Regenerate combined Supabase database types from the fully replayed disposable integration schema.
Do not generate types from a stale linked/shared environment.
Review the generated diff so it reflects only the combined accepted schema.
At minimum prove:
-  Sold Out 
-  Tickets unavailable 
-  Ticket unavailable with retained cart 
-  RSVP Full 
-  Stripe-hosted decline remains hosted 
-  payment failed 
-  payment processing 
-  checkout cancelled 
-  payment successful 
-  unable to confirm 
-  same request ID/bearer reuse 
-  no replacement checkout from uncertainty 
-  one logical refund operation per order 
-  timeout/reload resolves same operation 
-  no duplicate provider operation identity 
-  processing / failed / unknown / review / complete states 
-  canonical completion only after authoritative reconciliation 
-  Used ticket remains Used 
-  unused tickets become Refunded 
-  inventory consequence remains correct 
-  historical metrics remain correct 
Test these specifically:
1.  successful purchase → refund submission → refund complete 
2.  successful purchase → refund unknown → reload/status reconciliation 
3.  payment processing cannot expose refund actions prematurely 
4.  payment failed/cancelled cannot appear as refundable paid order 
5.  refund completion does not alter original checkout identity 
6.  refund completion does not break original private ticket collection 
7.  refunded buyer view and ticket view agree 
8. refund_notice delivery failure does not alter financial refund state 
9.  Spec 07 delivery status remains separate from payment/refund states 
10.  no duplicate tickets, orders, refunds, or admissions 
Re-run relevant Spec 06 and Spec 07 regressions, especially:
-  Free RSVP isolation 
-  paid/free private-link parsing 
-  ticket-access routes 
-  delivery notice 
-  email grant access 
-  QR equality/credential preservation 
Run the combined project’s configured equivalents of:
- pnpm typecheck 
- pnpm lint 
- pnpm test 
- pnpm test:functions 
- pnpm typecheck:functions 
- pnpm build 
- git diff --check 
Plus the focused Spec 08 and Spec 09 SQL/integration/concurrency/browser suites that are safe against the new disposable database.
Do not perform actual Stripe TEST or real email sends unless separately authorized.
Stop only if you discover:
-  incompatible payment/refund truth contracts 
-  migration collision that cannot be resolved forward-only 
-  shared-file behavior that would require weakening Spec 08 or Spec 09 guarantees 
-  a security/privacy conflict 
Do not stop for normal merge conflicts or shared-file overlap.
Report:
1.  integration worktree/branch 
2.  starting HEAD 
3.  exact source snapshots used for Specs 08 and 09 
4.  files reconciled 
5.  deferred patches applied 
6.  migration order/result 
7.  generated-type result 
8.  Spec 08 regression result 
9.  Spec 09 regression result 
10.  cross-spec scenarios 
11.  full test counts 
12.  skipped external/provider proofs 
13.  remaining blockers 
No commit, merge to main, push, deployment, shared database mutation, provider change, or real transaction.