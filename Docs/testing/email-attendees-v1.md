# Email Attendees V1 — Build + Prove

Status: **PASS — approved Build + Prove scope complete; ready to commit and review for merge. Production activation remains separate.**

Governing documents: `Docs/specs/email-attendees-v1-inspect-spec.md` and founder approval `Docs/specs/email-attendees-v1-build-approval.md`.

1. **Status:** PASS. Implementation, scoped reviews, final whole-branch review and required local proof complete. Known legacy baseline failures are disclosed below.
2. **Branch/worktree:** `codex/email-attendees-v1`, `Email Attendees V1 has passed Build + Prove.

Proceed with Git/GitHub closeout and merge review.

Feature branch:

codex/email-attendees-v1

The feature remains uncommitted.

Governing final report:

Docs/testing/email-attendees-v1.md

Current verified baseline from the report:

8138cdf2d6f84ff98d7ca42b595a9f87f9f7b66a

Do not assume remote main is still unchanged. Fetch it first.

# Merge-readiness decision

Email Attendees V1 is APPROVED for commit and merge review.

Use a DIFFERENTIAL regression standard against pristine current main.

Known pre-existing baseline SQL/CSP failures are documented and do not block this feature if they reproduce identically on main.

A failure that exists only on the Email Attendees branch is a new regression and MUST block merge.

Do not fix unrelated baseline test debt in this branch.

# 1. Pre-commit safety

Verify:

- correct worktree
- branch is `codex/email-attendees-v1`
- fetch origin/main
- current main HEAD
- git status
- git diff --stat
- git diff --check

Inspect all modified/untracked files.

Confirm the diff contains only:

- Email Attendees V1
- organizer-message queue/domain
- suppression provenance extension
- shared verified webhook routing
- organizer-message worker
- React Email organizer template
- organizer composer/entry points
- required generated database types
- focused tests/proof/docs

Do not commit:

- local credentials
- screenshots unless intentionally tracked by repo convention
- generated local fixtures
- provider captures
- /tmp logs
- proof-state directories
- local Supabase data
- node_modules
- unrelated recovery/staging work
- secrets

Preserve unrelated user-owned files.

# 2. Reconcile current main

If origin/main advanced since the tested baseline:

- inspect the exact delta
- determine whether it touches Email Attendees dependencies
- safely rebase/merge/update the feature branch using normal repository workflow
- rerun affected verification if necessary

Do not reset away newer main work.

If the delta materially invalidates the Build + Prove evidence, STOP and report it.

# 3. Final implementation review

Confirm the final diff still matches approved behavior.

## Product

- Event Dashboard → Email Attendees
- Paid: Everyone / Ticket Tier
- Free: Everyone
- Order Detail → Email customer
- Registration Detail → Email registrant
- subject + plain-text message
- Preview
- authoritative count
- Send to N people
- Message queued for N recipients

## Audience

- one email per normalized address
- no per-ticket duplicates
- buyer identity for paid
- registrant identity for free
- active/coherent relationship only
- order_refund_state = eligible
- used admissions still qualify
- cancelled/refunded relationships excluded
- tier targeting uses purchased tier UUID, not names

## Event policy

- draft denied
- cancelled denied
- blocked/removed denied
- unresolved moderation/active hold denied
- valid send window through `ends_at + 168 hours`
- committed sends may finish after deadline

## Architecture

- separate organizer-message ledger
- no organizer purpose added to ticket email outbox
- no ticket email grants
- no ticket-email members
- no ticket issuance
- no recovery bearer
- independent worker
- server-side immutable audience snapshot
- durable request UUID/idempotency
- shared suppression
- verified webhook routing

## Privacy/security

- no arbitrary recipient arrays
- no arbitrary email addresses
- no sender override
- no reply-to override
- no organizer HTML
- no recipient-list leakage
- no message content logging
- no customer list returned by preview

## Sender

- organizer display name via Wheretoo
- platform-controlled From
- Wheretoo support Reply-To
- auth/login email never used

## Limits

Confirm configured defaults remain:

- 1,000 unique recipients/send
- 3/event/hour
- 10/event/24h
- 20/organizer/24h
- 5,000 recipient deliveries/organizer/24h
- 3/same organizer-recipient/24h
- 30 previews/organizer/minute

No silent truncation.

## Activation

Confirm defaults remain FAIL CLOSED.

Do not enable:

- accepting_sends
- worker_enabled
- scheduler
- real provider transport
- hosted pruning
- real email delivery

# 4. Baseline regression handling

The final report documented:

- 1,750 frontend tests passed
- 406 function tests passed
- 176 Email Attendees SQL assertions passed
- 9 browser journeys passed
- 1,000-recipient simulated delivery passed
- typecheck passed
- function typecheck passed
- lint passed
- production build passed
- bundle/security boundary checks passed
- independent whole-branch review passed
- no new regressions identified

It also documented pre-existing baseline SQL/CSP failures.

Do NOT claim the entire repository test suite is green.

Do NOT weaken ACL/RLS/security behavior to satisfy stale fixtures.

If current closeout produces a new failure that does not reproduce on current main, STOP.

# 5. Commit

Stage only intended files.

Review staged diff before commit.

Commit message:

`feat: add organizer attendee email messaging`

Record resulting feature commit HEAD.

# 6. Push

Push:

`codex/email-attendees-v1`

to origin with upstream tracking.

No force push.

Verify remote branch HEAD matches the feature commit.

# 7. Open PR

Base:

`main`

Head:

`codex/email-attendees-v1`

Title:

`feat: add organizer attendee email messaging`

PR description should include:

## Product

- event-scoped attendee messaging
- Paid Everyone / Ticket Tier / Individual
- Free Everyone / Individual
- one email per normalized recipient
- preview + exact recipient count
- durable send confirmation

## Architecture

- separate organizer-message queue
- immutable recipient snapshots
- durable request-id reconciliation
- independent organizer worker
- reused provider/encryption primitives
- shared bounce/complaint suppression
- verified shared webhook dispatcher
- no ticket access grants or issuance

## Safety

- no arbitrary recipient submission
- no CRM/contact database
- no marketing/newsletter system
- no recipient-list browser exposure
- no auth email used as Reply-To
- no HTML organizer input
- no private ticket/storage bearer URLs
- no payment/ticket/refund/check-in writes

## Limits

Document approved V1 limits.

## Verification

Include:

- 1,750 frontend tests
- 406 function tests
- 176 SQL assertions
- 9 browser journeys
- 1,000 simulated deliveries
- typecheck/lint/build/function typecheck
- bundle/security checks
- independent review PASS

## Baseline disclosure

State clearly:

Known SQL/CSP failures reproduce on pristine current main.

No new regression was identified.

Do not claim all legacy suites are green.

## Activation boundary

Explicitly state:

Production sending is NOT activated by this PR.

Still required separately:

- hosted migration
- function deployment verification
- verified sender/support mailbox
- DNS/provider configuration
- provider quota/capacity verification
- independent worker scheduler
- retention pruning schedule
- webhook health verification
- explicit accepting_sends/worker enablement
- real deliverability/mail-client proof

# 8. CI / final PR review

Wait for relevant required GitHub/Vercel checks.

Inspect full PR diff against latest main.

If CI reveals a feature-specific failure:

fix → reverify → update PR.

If a failure reproduces on current main:

document it accurately.

Do not bypass required checks.

Do not disable security/tests.

# 9. Deployment boundary

If merging the PR triggers the already-authorized existing `wheretoo-staging` Vercel deployment, that staging frontend deployment is allowed.

Do NOT:

- deploy to a separate real/live production project
- apply hosted Supabase migration
- deploy/activate organizer-message worker for live email
- configure provider/DNS
- install hosted scheduler
- enable accepting_sends
- enable worker_enabled
- send real email

The feature must remain operationally inactive after merge until the separate activation task.

# 10. Merge

If:

- final diff is clean
- required checks pass
- no new regression exists versus current main
- independent final review remains clean

merge the PR into main using the repository's normal merge method.

Do not force-update main.

# 11. Sync canonical main

After merge:

- fetch origin
- safely fast-forward canonical local main
- preserve unrelated/untracked user files
- verify local main matches origin/main
- record resulting remote main HEAD
- inspect final status

Do not destructively clean other worktrees.

# 12. Post-merge smoke

Perform a lightweight code-level smoke only.

Verify main contains:

- organizer message migration
- organizer-message façade
- organizer-message worker
- organizer message template
- Email Attendees route/composer
- dashboard/detail entry actions
- shared suppression provenance
- shared webhook dispatcher

Verify production gates remain disabled/fail closed.

No real provider calls.

# 13. STOP

Do not start:

- Staff Access
- Waitlist
- CSV Import
- Stripe/live readiness
- another feature

Do not activate live email.

Final report:

1. pre-commit safety PASS/FAIL
2. feature commit HEAD
3. branch push status
4. PR number/link
5. CI/check status
6. final diff review status
7. baseline failures documented yes/no
8. new regressions yes/no
9. merged yes/no
10. resulting main HEAD
11. canonical local main sync status
12. staging deployment status if triggered
13. post-merge smoke PASS/FAIL
14. organizer email production gates still disabled yes/no
15. hosted migration performed yes/no
16. real email/provider activation performed yes/no
17. unrelated feature work begun yes/no

Desired final state:

Email Attendees V1 ✅ merged into main
Production email sending 🔒 still inactive

Then STOP./Users/exoh/Desktop/WhereTo -  Repository/.worktrees/email-attendees-v1`. Unrelated recovery checkout preserved.
3. **Baseline:** freshly fetched current integrated `origin/main`, `8138cdf2d6f84ff98d7ca42b595a9f87f9f7b66a`; refetched after implementation, unchanged.
4. **Final HEAD/commit state:** same HEAD, feature changes uncommitted. No push, PR, merge or deployment.
5. **Files:** complete manifest below. Changes are limited to the new domain, shared webhook/suppression integration, dedicated email template, composer/entry points, generated RPC types and proof/documentation. Generated types reorder previously hand-added cover/duplicate contracts into generator order; no corresponding behavior change.
6. **Migration:** `supabase/migrations/20260924010600_add_organizer_messages_v1.sql`. Full migration history replayed successfully on the dedicated local stack after database review corrections. No hosted migration.
7. **Tables/contracts:** five private RLS-enabled tables: `organizer_messages`, `organizer_message_recipients`, `organizer_message_observations`, `organizer_message_settings`, `organizer_message_rate_events`. Shared `ticket_email_recipient_blocks` gains nullable organizer-recipient provenance with exactly-one provenance constraint. Four owner contracts provide options/preview/submit/receipt. Narrow service contracts claim/prepare/save/begin/finish/stop/configure/acknowledge/prune/observe; browser roles cannot execute them or access tables. Exact signatures and JSON unions: `email-attendees-v1-contracts.md`.
8. **Edge functions:** new `organizer-message` authenticated façade and `organizer-message-worker`; existing verified `ticket-email-webhook` calls the exact-ledger dispatcher after signature verification. Browser API: `email-attendees-v1-api.md`.
9. **Worker:** independent settings/secret/health/capacity; one recipient per invocation, two-minute lease, immutable AES-GCM provider payload using null-grant context, persisted dispatch intent before network. Key `organizer-message/<delivery UUID>`. Exact stored bytes reused; six dispatch attempts,23-hour idempotency window,20-second lease headroom, existing15-second provider timeout/backoff. Accepted/failed/unknown and evidence precedence remain truthful; later rejection does not erase earlier ambiguity. No ticket grant/member/issuance/recovery/resend calls.
10. **Audience:** paid coherent/reconciled paid orders, nonnull paid_at/null refunded_at, `order_refund_state='eligible'`, at least valid/used admission. Tier targets immutable purchased UUID, including archived purchased tiers; same names never imply membership. Selected order itself must qualify. Free coherent confirmed/null cancelled_at registration with valid/used admission; selected registration itself qualifies. Group/multiple tickets and normalized same-address orders deduplicate to one email. Shared suppression removes recipients. No arbitrary addresses/recipient arrays. Relevant incoherence yields AUDIENCE_UNAVAILABLE, never a partial count.
11. **Event/window:** drafts/cancelled/blocked/removed/unresolved moderation/active holds/stale clear revision/invalid schedule denied. New confirmation allowed through exact `ends_at +168 hours`, denied one microsecond later. Committed delivery survives later event end/window/cancellation or attendee membership changes; current platform moderation and suppression can still stop it.
12. **Limits:** configurable defaults1000 unique recipients/send,3 confirmed/event/hour,10/event/24h,20/organizer/24h,5000recipient units/organizer/24h,3/same organizer-recipient/24h across events,30previews/organizer/minute. No truncation/partial campaign. Authorized rejected previews still consume preview allowance. Failed/empty previews do not consume send allowance; idempotent replay does not double-debit. Ticket-email limits/settings unchanged.
13. **Retention:**90-day terminal sensitive subject/body/facts/address/encrypted payload cleanup after safety checks. Unknown or retry/evidence/suppression-required data retained; minimal immutable request digest/receipt remains to prevent UUID reuse. No campaign-history UI. Production pruning invocation belongs to separate activation operations.
14. **Sender/template:** dedicated frozen React Email template, plain escaped organizer subject/body with code-point/control validation and line breaks. Organizer display name via Wheretoo; unsafe display fallback; real From configured platform mailbox; Reply-To configured Wheretoo support, never auth email. Branding/event/date/time/venue/message/relationship/footer; optional anonymous endpoint images and current safe public event CTA, no bearer/private/signed storage URL. Browser uses inert allowlisted React presentation from server HTML with scoped CSS under unchanged CSP. Content/hierarchy match; email-client pixel parity is not asserted.
15. **Preview/fingerprint proof:** exact counts/no addresses, audience additions and same-count substitutions, suppression race, subject/body/schedule/sender/template changes and zero audience. HMAC covers actor/event/selector/label/text/facts/policy/member hashes. Submit materializes once, compares, inserts snapshot atomically or rejects with no campaign. UI freezes reviewed selector and disables editing while preview loads.
16. **Idempotency proof:** real simultaneous psql connections and concurrent owner HTTP calls yield one message/recipient set/send debit/identical receipt. Lost response resolves original receipt; changed intent conflicts. Browser doubleclick guard, persisted owner/event/request IDs only, immutable same-ID retry, null receipt remains unresolved, reload guards against new sends. Once any outcome is unknown, later attempt-local rejection cannot release its protection. Storage failures fail closed. No content stored in sessionStorage.
17. **Suppression/webhook proof:** ticket bounce blocks organizer delivery; organizer complaint blocks ticket source, provenance switches preserve complaint precedence. Existing ticket provenance remains valid. Real HMAC signed fixture reaches actual DB dispatcher; invalid signature, unknown/ambiguous attempt, wrong provider ID, conflicting duplicate and cross-ledger webhook reuse reject. Duplicate evidence is idempotent; late lesser observations cannot overwrite complaint truth. Organizer cannot clear blocks.
18. **Transactional isolation:** ready/leased ticket work wins; independent configured provider capacity bounds organizer dispatch at claim and begin. Ticket claim order and numeric limits unchanged. SQL/real integrated/bulk proof compare ticket/grant/member/ticket-outbox data/counts and observe no creation or mutation from messaging.
19. **Bulk delivery:** local fixture commits1000 unique recipients, completes request, then worker processes all1000 through injected provider. Each distinct address/key appears once, exact HTML/text equals preview, all1000 accepted, next claim empty.1001 preview fails without truncation. Two-recipient proof also records accepted/failed siblings independently. No real provider call permitted by the Deno network boundary.
20. **Authorization/privacy:** owner succeeds; foreign/anonymous/staff-not-owner and foreign selectors denied; service/private contracts unavailable to browser. Façade exact fields reject arbitrary addresses/sender/owner/HTML overrides, uses caller JWT not service role, returns strict safe projections/no-store. Unit, SQL, real JWT flow and browser identity tests cover these boundaries. No content/recipient/payload logging or analytics added.
21. **Browser/UX:** protected route and all three entry points, paid Everyone/tier/order and free Everyone/registration, authoritative preview/count/confirmation/queued, zero/window/limit/drift, unknown/lost response/reload/null receipt, doubleclick, live account switch, actual Sign out, keyboard/focus,390×844 and1440×1000. Ten screenshots opened and visually inspected; no clipping/overflow or blocking visual defect. Final delayed-preview interaction regression also passed. Browser window/limit/drift failure surfaces use injected authoritative responses; database truth separately tested. Optional images have sanitizer/template unit coverage; image-loaded browser screenshot not claimed. Details: `email-attendees-v1-visual.md`.
22. **Regressions:** clean feature versus pristine baseline110 SQL suites:59pass/51fail with identical errors, zero new/changed failures. Existing checkout/issuance/refund/check-in/RSVP/ticket-mail/provider/recovery/notices/CSV/Duplicate paths are represented in SQL and frontend/function suites. No blanket claim that all legacy SQL is green.
23. **Known baseline failures:** complete51-suite SQL inventory in `email-attendees-v1-baseline.md`, mainly legacy fixture service-role SELECT assumptions plus outdated contract expectations. General integration baseline also has old CSP expectation missing existing `blob:`, three unavailable legacy TEST_* account setups, and one linked-only moderation test. Final safe general integration excludes those four environment/linked files:15files/257assertions pass,1known CSP assertion fails,1file/5assertions skip. Never linked a hosted project to satisfy that test.
24. **New regressions:** none identified in completed verification. Review defects were fixed with observed red/green regressions. Final whole-branch review PASS with no actionable findings or deferred minors.
25. **Checks:** database176SQL assertions plus4real concurrency/receipt/routing checks;9lock-delay checks;31connected owner API/worker/signed-webhook assertions plus no-ticket-effects check;1000bulk deliveries;406function tests and Deno check pass. Full typecheck, lint and production build pass. Full frontend207files/1750tests pass (baseline203files/1724tests). Existing ticket-shell and Spec07 production boundary scripts pass across164built artifacts; no server-only email/provider/secret markers found.
26. **Risks:** production remains unexercised/inactive. Local Edge code ran in Deno with real PostgREST and injected transport; full Supabase CLI Edge packaging was separated from database startup because its existing extensionless import-map scan failed. Deployment packaging, live credentials/deliverability/capacity/monitoring and mailbox-client rendering remain activation work. Unknown outcome after reload may require continued status checks/support; safety deliberately prevents a fresh UUID without resolution. Baseline test debt remains.
27. **Manual/production requirements:** separate approval/task to apply hosted migration before dispatcher deployment; verify platform sender/support mailbox and DNS/provider account, shared-provider transactional reserve and quotas, retained encryption key ring and independent worker secret, deploy functions/UI, install dedicated worker schedule and retention pruning, verify health/webhook routing, then explicitly enable accepting_sends/worker. No automatic scheduler added. Local reproduction commands: `email-attendees-v1-local-proof.md`.
28. **Boundary confirmation:** no real email, real provider configuration, DNS change, hosted migration/activation, production scheduler, deployment, push or merge. Only isolated local synthetic proof temporarily enabled local gates; final read confirms accepting_sends=false, worker_enabled=false and0activecron jobs. Recovery checkout untouched.
29. **Recommendation:** **Yes — ready to commit and review for merge.** Changes remain uncommitted on the isolated feature branch; no push/merge/deployment. No adjacent feature started.

## Verification evidence / review record

- Database original review found relevant incoherence filtering, rejected-preview rate bypass and stale lock-wait timestamps. Fixed with10failing SQL and8failing lock tests observed before fix, then139SQL+4concurrency+9lock passing; scoped re-review clean. Supplemental23policy and14audience assertions cover staff/state/hold/template/schedule and exact purchased-ticket/dedup variants.
- Server review: spec and quality PASS, no findings. Template2tests +23newDeno tests; full406pass.
- Composer review found prior-unknown protection lost on retry auth failure and preview-selection race. Three new tests observed failing; fixed with sticky unknown protection/frozen selector/disabled pending inputs.21feature tests pass; delayed-preview browser regression passes. Scoped re-review PASS; both findings addressed, no new breakage.
- Local real-flow proof and1000bulk proof used injected transport with networking restricted to localhost. Fresh fixtures randomize identities, customer addresses and provider IDs because shared suppression and provider binding intentionally persist. Legacy comparison precedes persistent fixtures; runner rejects contaminated ordering. SQL proof snapshots include nullable registration IDs correctly so prior paid fixtures cannot distort no-ticket-effect comparisons.
- Logs are local under `/tmp/email-attendees-*`; reproducible proof scripts are committed-source candidates, generated fixtures/screenshots/logs remain ignored.

## Controller decisions and their tradeoffs

1. Existing explicit Build+Prove approval authorizes execution without another approval pause. Cost if misread: excess implementation scope; this work remains limited to the named feature.
2. Founder90-day retention supersedes earlier shorter suggestion. Cost: longer sensitive-data retention, explicitly approved and safety constrained.
3. Separate DB startup from CLI Edge packaging; use installed-via-pnpm Deno. Cost: actual deployment packaging remains to verify during activation; real handlers/RPC/crypto/renderer were still exercised locally.
4. Require clean replay to classify SQL regressions; never waive fixture-induced differences. Cost: extra local runs; no reduced correctness gate.
5. Treat all three DB review findings as required fixes; structured preview rejection commits preview-rate debit. Cost: explicit error union in façade/client contract, tested end-to-end.
6. Keep production CSP unchanged and render allowlisted inert HTML with application CSS. Cost: preview content/hierarchy is faithful but not pixel-identical to every email client.

## File manifest
- `Docs/specs/email-attendees-v1-build-approval.md`
- `Docs/specs/email-attendees-v1-inspect-spec.md`
- `Docs/superpowers/plans/2026-09-23-email-attendees-v1.md`
- `Docs/testing/email-attendees-v1-api.md`
- `Docs/testing/email-attendees-v1-baseline.md`
- `Docs/testing/email-attendees-v1-contracts.md`
- `Docs/testing/email-attendees-v1-local-proof.md`
- `Docs/testing/email-attendees-v1-visual.md`
- `Docs/testing/email-attendees-v1.md`
- `deno.json`
- `playwright.email-attendees.config.ts`
- `src/app/router/router.tsx`
- `src/features/organizer-messages/EmailPreview.test.tsx`
- `src/features/organizer-messages/EmailPreview.tsx`
- `src/features/organizer-messages/OrganizerMessagePage.test.tsx`
- `src/features/organizer-messages/OrganizerMessagePage.tsx`
- `src/features/organizer-messages/messages.api.test.ts`
- `src/features/organizer-messages/messages.api.ts`
- `src/features/organizer-messages/messages.css`
- `src/features/organizer-operations/OrganizerOrderDetailPage.test.tsx`
- `src/features/organizer-operations/OrganizerOrderDetailPage.tsx`
- `src/features/organizer-operations/OrganizerRegistrationDetailPage.test.tsx`
- `src/features/organizer-operations/OrganizerRegistrationDetailPage.tsx`
- `src/features/ticket-experience/dashboard/EventDashboardPage.test.tsx`
- `src/features/ticket-experience/dashboard/EventDashboardPage.tsx`
- `src/features/ticket-experience/email/OrganizerMessageEmail.test.tsx`
- `src/features/ticket-experience/email/OrganizerMessageEmail.tsx`
- `src/features/ticket-experience/email/email.types.ts`
- `src/features/ticket-experience/email/renderEmail.ts`
- `src/lib/supabase/database.types.ts`
- `supabase/config.toml`
- `supabase/functions/.env.example`
- `supabase/functions/_shared/organizerMessage.test.ts`
- `supabase/functions/_shared/organizerMessage.ts`
- `supabase/functions/_shared/organizerMessageWorker.test.ts`
- `supabase/functions/_shared/organizerMessageWorker.ts`
- `supabase/functions/organizer-message-worker/README.md`
- `supabase/functions/organizer-message-worker/index.test.ts`
- `supabase/functions/organizer-message-worker/index.ts`
- `supabase/functions/organizer-message/index.test.ts`
- `supabase/functions/organizer-message/index.ts`
- `supabase/functions/ticket-email-webhook/index.test.ts`
- `supabase/functions/ticket-email-webhook/index.ts`
- `supabase/migrations/20260924010600_add_organizer_messages_v1.sql`
- `tests/e2e/email-attendees.spec.ts`
- `tests/e2e/support/emailAttendees.ts`
- `tests/integration/edge/email-attendees/local.ts`
- `tests/integration/email-attendees-v1-audiences.sql`
- `tests/integration/email-attendees-v1-concurrency.py`
- `tests/integration/email-attendees-v1-fixture.py`
- `tests/integration/email-attendees-v1-flow.py`
- `tests/integration/email-attendees-v1-locks.py`
- `tests/integration/email-attendees-v1-policy.sql`
- `tests/integration/email-attendees-v1-regressions.py`
- `tests/integration/email-attendees-v1-review.sql`
- `tests/integration/email-attendees-v1.sql`
- `tests/integration/run-email-attendees-local.py`
- `tsconfig.e2e.json`
