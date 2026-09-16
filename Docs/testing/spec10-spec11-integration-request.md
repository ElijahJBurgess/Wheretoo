Integrate Spec 10 + Spec 11 into one frozen local baseline. This is an integration/reconciliation task only — do not redesign or expand either spec.
Spec 10 — Event Changes + Cancellation
-  Worktree: .worktrees/spec10-event-changes 
-  Branch: codex/spec10-event-changes 
-  Starting HEAD: 94c546bd0961f501584f8a3437298b2331cafd5c 
-  Built from the frozen 08+09 integrated dependency snapshot 
-  Locally complete and verified 
-  Five additive migrations 
Spec 11 — Organizer Settings
-  Worktree: .worktrees/spec11-organizer-settings 
-  Branch: codex/spec11-organizer-settings 
-  Starting HEAD: 94c546bd0961f501584f8a3437298b2331cafd5c 
-  Built from the same frozen 08+09 integrated dependency snapshot 
-  Locally complete and verified 
-  One additive Settings/profile migration 
Both source worktrees must remain unchanged.
Produce one isolated combined checkout where:
-  Spec 10 event-change/cancellation behavior is unchanged 
-  Spec 11 Settings behavior is unchanged 
-  Specs 04–09 remain intact 
-  all migrations replay together 
-  shared router/shell/config/type changes coexist 
-  no feature owned by either spec is lost or rewritten 
This is not a new feature spec.
Do not merge into main.
Before editing:
1.  Record exact Spec 10 and Spec 11: 
   -  worktree 
   -  branch 
   -  HEAD 
   -  tracked/untracked state 
   -  file hashes/snapshot 
2.  Read both implementation verification reports. 
3.  Produce the exact changed-file set for each spec relative to their common frozen 08+09 baseline. 
4.  Identify every overlapping file. 
5.  Classify overlap as: 
   -  automatically compatible 
   -  narrow reconciliation required 
   -  genuine contract conflict 
Ordinary file overlap is not a blocker.
Stop only for a real incompatible contract/security issue.
Create:
-  Worktree: .worktrees/spec10-spec11-integration 
-  Branch: codex/spec10-spec11-integration 
Start from the exact frozen 08+09 integrated baseline used by both specs.
Do not modify:
-  Spec 10 worktree 
-  Spec 11 worktree 
-  previous 08+09 integration worktree 
-  main 
-  published event edits 
-  immutable Previous → New event facts 
-  stale-edit/version protection 
-  event cancellation 
-  cancellation reconciliation 
-  event-change notices 
-  event-cancellation notices 
-  cancellation impact/refund summaries 
-  late-payment/no-ticket organizer read correction 
-  buyer event-change/cancellation status 
-  organizer Settings 
-  Account & Security 
-  Auth identity/email/password presentation 
-  organizer profile editing 
-  profile concurrency protection 
-  Settings Stripe Connect presentation 
-  Help & Legal 
-  Account Actions 
-  shared sign-out/identity cleanup 
-  Spec 08 owns checkout/payment recovery 
-  Spec 09 owns refund operations and refund_notice 
-  Spec 07 owns shared email/access infrastructure 
-  Spec 06 owns Free RSVP 
-  Spec 05 owns admission/check-in 
Do not collapse these authorities.
Inspect actual overlap first. Likely shared areas include:
Preserve all existing routes, including:
-  buyer purchase/checkout 
-  confirmation 
-  ticket collections 
-  RSVP 
-  ticket recovery/access 
-  refund details 
-  organizer operations/check-in 
-  Spec 10 event-change/cancellation routes 
-  Spec 11 Settings routes 
No duplicate or shadowed route definitions.
Preserve:
-  Events 
-  operational/event navigation 
-  check-in flows 
-  Settings entry 
-  event-scoped navigation 
Spec 11 Settings navigation must not remove Spec 10 event management actions.
Spec 10 event-management additions must not remove Settings.
Preserve both:
-  existing onboarding/event-specific Stripe return flow 
-  Spec 11 /organizer/settings/payments 
Do not replace one with the other.
Preserve:
-  Spec 09 refund support 
-  Spec 10 cancellation/change support destinations 
-  Spec 11 Help/Legal/closure configuration 
Keep purpose-specific behavior separate.
Missing production config must remain truthful/unavailable rather than invented.
Regenerate only after all Spec 10 + 11 migrations replay successfully in the combined disposable schema.
Do not copy generated types blindly from either branch.
Preserve every migration from the frozen 08+09 baseline exactly.
Add:
-  all five Spec 10 additive migrations 
-  the Spec 11 additive migration 
Check:
-  timestamp collisions 
-  ordering dependencies 
-  function replacement order 
-  grants/RLS 
-  generated types 
Do not rewrite historical migrations.
Replay the complete migration set from an empty application schema on a new disposable local database.
Cron/workers must remain disabled unless the existing guarded tests explicitly require them.
Never target a shared or linked database.
Prove:
-  event edits persist correctly 
-  authoritative Previous → New history remains correct 
-  stale save/publish/acceptance conflicts remain protected 
-  cancellation still uses the canonical writer 
-  ambiguous cancellation reconciles the same event 
-  Used admissions retain original Used timestamps 
-  unused admissions cancel 
-  free cancellation remains separate from paid 
-  event-change notices remain revision-bound 
-  stale unsent notices suppress correctly 
-  cancellation notices remain separate from refunds 
-  no automatic/bulk refunds appear 
-  late payment with zero tickets remains review-required/readable 
Prove:
-  all six Settings routes 
-  account/public organizer names remain independent 
-  fresh Auth identity read 
-  current/pending email states 
-  authenticated password change/reauthentication states 
-  organizer profile conflict protection 
-  hidden fields/onboarding remain preserved 
-  public-name edit keeps moderation/review consequences 
-  all five canonical Connect states 
-  Settings mount does not create Stripe account 
-  existing event-specific Stripe return still works 
-  support/legal configured and unavailable states 
-  manual closure handoff does not claim submission 
-  sign-out identity cleanup remains safe 
-  guest ticket/refund access is not globally cleared 
-  scanner cleanup continues to work 
Add explicit combined tests for:
1.  Organizer edits an event → returns to Settings → event draft/review state remains correct. 
2.  Organizer changes public display name in Settings → existing event-review/public-eligibility consequence remains intact. 
3.  Organizer changes event → sends event-change notice → navigates to Settings → delivery state remains intact. 
4.  Organizer cancels event → opens Settings → cancellation status remains canonical. 
5.  Cancelled event with refund follow-up → Settings navigation does not disturb Spec 09 refund state. 
6.  Organizer enters Stripe Settings → returns to an owned event → Spec 10 event state remains correct. 
7.  Session expires while on a Spec 10 event-management screen → sign-in restores only a validated internal destination. 
8.  Sign-out during an active event-management/notice request does not allow late private cache writes. 
9.  Sign-out while scanner/camera activity exists preserves existing teardown guarantees. 
10.  Owner A → Owner B transition never shows Owner A event-change, cancellation, Settings, Stripe, or profile state. 
11.  Spec 10 notification support configuration and Spec 11 Help support configuration coexist without purpose confusion. 
12.  No duplicate notice, refund, payment, ticket, registration, or admission authority is introduced. 
Retain:
- /tickets/recover 
- /ticket-access 
- /refund-details 
-  event-change/cancellation private access 
-  original paid ticket links 
- rsvp_ free links 
Verify:
-  payment state 
-  refund state 
-  event cancellation/change state 
-  delivery state 
-  admission state 
remain distinct.
No private Settings/Auth data may enter buyer-facing projections.
Run the combined repository's configured equivalents of:
- pnpm typecheck 
- pnpm lint 
- pnpm test 
- pnpm test:functions 
- pnpm typecheck:functions 
- pnpm build 
- git diff --check 
Also run relevant:
-  Spec 10 SQL suites 
-  Spec 11 SQL suites 
-  Spec 10 concurrency suites 
-  Spec 10 browser suite 
-  Spec 11 browser suite 
-  selected Specs 06–09 regression suites affected by shared files 
Use only guarded disposable-local database runners.
Do not perform:
-  actual Stripe TEST transactions 
-  real email sends 
-  hosted Auth mutations 
-  physical-camera proof 
-  production/shared DB writes 
unless separately authorized.
Verify the combined organizer experience at:
-  320px 
-  390px 
-  768px 
-  1440px 
Check at minimum:
-  Event management/change state 
-  Cancellation state 
-  Settings index 
-  Account & Security 
-  Organizer Profile 
-  Payments 
-  Help 
-  Account Actions 
Ensure navigation between Spec 10 and 11 surfaces does not produce:
-  missing shell/navigation 
-  horizontal overflow 
-  duplicated headers 
-  stale private state 
-  lost primary actions 
This is integration verification, not a redesign.
Stop only for:
-  incompatible Spec 10/11 data contracts 
-  migration collision that cannot safely be resolved forward-only 
-  Auth/security conflict 
-  shared file reconciliation that would require weakening an already verified guarantee 
Do not stop for normal merge conflicts or additive shared-file overlap.
Report:
1.  integration worktree/branch 
2.  starting frozen baseline 
3.  exact Spec 10 snapshot 
4.  exact Spec 11 snapshot 
5.  overlapping files found 
6.  reconciliation patches 
7.  migration order and replay 
8.  generated-type result 
9.  Spec 10 regression results 
10.  Spec 11 regression results 
11.  cross-spec scenarios 
12.  full frontend/function/SQL/concurrency/browser counts 
13.  responsive/visual result 
14.  external/provider proofs skipped 
15.  remaining blockers 
Freeze the resulting combined local file map/hash so it can become the starting baseline for Spec 12.
No commit, merge to main, push, deployment, shared database mutation or provider change.
Proceed with the Spec 10 + 11 integration now.