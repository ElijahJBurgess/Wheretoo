# Spec 07 — Ticket email, resend and secure recovery

Implementation and authorized local verification are complete in `.worktrees/spec07-ticket-email` on `codex/spec07-ticket-email`, uncommitted at inherited HEAD `94c546bd0961f501584f8a3437298b2331cafd5c`. The final whole-feature review found two P2 issues and one P3 issue; one consolidated fix wave addressed all three and the scoped re-review approved both spec compliance and code quality. No local implementation findings remain open. Production activation remains blocked by the targeted numeric-limit approval and external setup below.

## Scope and inherited state

Spec 07 supplies shared delivery/access: authoritative initial enqueue, owner resend, anonymous recovery, scoped access to existing collections, durable worker and verified observations. It does not create an RSVP/payment/refund/check-in system. Only authoritative paid/free wrappers enqueue initial intents; resend/recovery never call issuance. Private hashes cannot reconstruct original bearers: each email uses a fresh, scoped `em1_` grant with an encrypted immutable provider payload.

The root repository was left untouched. Spec 04 and Spec 05 are implemented but uncommitted/unmerged in their local worktrees; completed Spec 06 was inspected before the scoped 120-file import. The source snapshot and 642-file inherited manifest are recorded in `.superpowers/spec07/{imports,reconciliation,inherited-manifest}.json`. Root's pre-existing uncommitted work is separate. Spec 06 supplies namespaced free issuance/resolver/owner reads; it does not supply the general free registration detail/resend UI. Spec 07 adds only that minimal attachment. Spec 05's separate free check-in UI boundary remains unchanged.

Spec 08 was contacted under explicit coordination approval and confirmed additive recovery/access routes and an optional paid confirmation delivery notice. Its availability/payment recovery work was plan-only at inspection. Existing paid confirmation lifecycle, polling, cleanup and `reloadDocument` ticket link remain intact.

Read-only worktree snapshot (all HEADs `94c546b`):

|Worktree|Changed paths|Migration files|
|---|---:|---:|
|spec04-integration|134|98|
|spec05-check-in|165|99|
|spec06-free-rsvp|54|100|
|organizer-operations-v1|0|96|

Spec 07 combines the necessary prerequisite migration union (103 inherited files), then adds seven delivery/access migrations. All 120 imported source hashes were rechecked unchanged. The source worktrees have not been committed or merged by this task.

## Contracts and decisions

- Initial/resend grant expiry is canonical scheduled event end +24h fixed at preparation, with no 30-day cap. Recovery is 24h. Reads/rescheduling never extend grants or mutate prepared payloads; after a reschedule, request a fresh eligible resend/recovery link. Existing paid and namespaced free private links remain usable under their original rules.
- Whole coherent collections with at least one Valid admission are eligible; mixed Used/Valid retains all admissions/history. Fully Used/ended/cancelled/refunded/financially unresolved sources refuse new sends. Existing history/access is not deleted by send eligibility. Verified bounce/complaint suppresses new recipient sends; service-only support clear is explicit.
- Recovery snapshots up to 200 eligible paid/free collections once, 20/page. More than 200 means a support handoff with zero partial access, requiring a real configured support mailbox. Zero matches is silently suppressed. Public acknowledgement never reveals matches/counts/links.
- Initial receipts permanently dedupe by source beyond metadata retention. Each explicit resend/recovery has a durable request UUID. Provider retries reuse one attempt UUID tag, idempotency key and byte-identical payload; at most 6 dispatches, bounded 23h from immutable first-possible dispatch. An expired lease fences stale workers. Unknown remains Unknown after retry exhaustion.
- Queued is durable waiting; Sending is an active possibly dispatched attempt; Accepted is provider acknowledgement/evidence, not inbox arrival; Failed is definite rejection with no prior possible acceptance; Unknown is unresolved possible acceptance; Suppressed is stopped before any possible send. Provider delivered/delayed/bounced/complained/failed evidence is separately retained and signature-correlated to both attempt and provider message IDs.
- Ciphertexts are purged after safe retry closure; 90-day metadata retention preserves unexpired grants/membership. Permanent initial receipts remain. Minimal active bounce/complaint evidence is retained until support clears its suppression; encrypted message content is not retained for that purpose.
- Access tokens are stripped from fragments before app imports and kept in a bounded tab session with a 24h client cap and downward-only authoritative expiry. No email bearer in route selectors/query caches/logs; member/ticket URL selectors confer no access alone.

## Proposed limits — pending approval, never activated

|Lane|Candidate production limit|Rationale|
|---|---|---|
|Recovery recipient|1/min,3/hour,5/day|Mailbox protection and coalescing|
|Recovery IP|60/15min,300/hour,1000/day|Allows shared venue networks while bounding anonymous work|
|Organizer resend recipient and source, independent lanes|1/min,3/hour,5/day each|Prevents repeated recipient/source sends|
|Organizer actor / event|30/hour /60/hour|Authenticated operational allowance separate from anonymous pressure|
|Initial|Does not consume above lanes|Anonymous requests cannot starve fulfillment email|
|Verified access grant|60/min|Capacity follows verified access|
|Aggregate access IP|6000/min|Shared-network safeguard|
|Invalid access IP|120/min|Bounds invalid bearer traffic|

Only a synthetic local test profile uses those numbers. Production `limits` remains NULL. Numeric approval is required before activation; no whole-plan reapproval is requested.

## Local safety and reproducibility

Own Docker database 127.0.0.1:55475 and REST 55476 carry task label `wheretoo.task=spec07-ticket-email`. Harnesses verify exact recorded container ID/name/label/loopback binding before writes; DB must start with `cron.launch_active_jobs=off`. Edge 55477 uses production handlers with injected fake transport and a loopback-only Deno network allowlist. App 3017 is a production build with synthetic disabled public configuration. Provider captures are synthetic; no real email or provider account was accessed.

Incident: the first disposable replay ran inherited migrations registering two housekeeping schedules. This crossed the no-scheduler-activation boundary and was disclosed immediately. The database was rebuilt with cron execution disabled at process startup; bootstrap also deactivates all inherited jobs. Subsequent replays verify cron off and zero active jobs. No Spec 07 schedule was added, and no shared DB/provider was affected.

The unfiltered inherited integration runner attempted a `--linked` moderation query and failed with `LegacyProjectNotLinkedError` before connecting; this was disclosed. The isolated worktree has no linked project. Subsequent integration verification explicitly excluded the four environment-dependent suites and external Stripe proof, using the owned SQL/concurrency harness for database behavior.

## Verification record

- Inherited baseline: 992 frontend tests across 102 files after narrow snapshot/expectation reconciliation; typecheck passed.
- Inherited database regression: 505 assertions across 16 suites passed covering paid fulfillment/collection/redemption/refunds/owner reads and free issuance/lifecycle/security.
- New SQL: **187 assertions across 12 suites passed** after the review fixes; clean replay of **110 migrations** passed with cron disabled.
- Concurrency: 5 scenarios passed:8 authoritative replays,2 competing claims,8 same-UUID resends,stale lease fencing,8 duplicate observations before lost-response persistence; ticket rows identical.
- Edge: **302 tests passed**; full Edge typecheck passed. This includes production worker/provider signature handling with injected transport only.
- Isolated integration: **258 passed, 5 optional skipped**. Updated production guard: 23 tests passed; literal UI “resend” no longer falsely means provider SDK, while import/provider/call boundaries remain tested.
- Frontend: full corrected suite **1,060 passed across 110 files**. The shared-header regression and review findings are covered; the expanded focused fix suite also passed 247 tests across 19 files.
- Browser: **7 scenarios passed** using the production build and real local SQL/handlers. Includes original paid/free links, a 60-day event, fresh-session mixed-source recovery, identical QR output, exact-request remount, lost response and signed webhook, definite failure then fresh resend, wrong-owner refusal, responsive widths 320/390/768/1440, and byte-for-byte unchanged original ticket records.
- Production boundary: Spec 07 scan: 102 artifacts passed; existing source+build ticket-shell guard passed after correcting its broad text false positive. Final production browser build passed; full TypeScript, ESLint and Edge checks passed. Final browser run: 7 passed in 48.4s. The invariant comparison covers all five original admissions (three paid, two free).

Final review evidence: `.superpowers/sdd/2026-09-11-spec07-implementation/{final-review-report,final-fix-report,final-rereview-report}.md`. The fixes preserve transient HTTP failures as retryable 503, retire verified Suppressed request capacity while requiring a deliberate fresh resend, and distinguish otherwise identical purchases with stable visible collection numbers. An actual handler-to-client test covers same-grant retry. Final source verification: all 120 imported hashes unchanged. `git diff --check` passed; the incremental credential-pattern scan found zero matches. Final owned database inspection verifies `cron.launch_active_jobs=off`, zero active jobs, `enabled_at=NULL`, `worker_enabled=false`, and `limits=NULL`.

## Rendered visual verification

Inspected the actual production browser captures for recovery acknowledgement, mixed collection index, Valid and Used ticket views, organizer Unknown/reconciled/Failed states, and recovery form at 320/768/1440. The final 390px form, visibly numbered collection index and Used view were also inspected after the final fixes. No horizontal overflow was detected at 320/390/768/1440; actions and labels remained visible. Existing one-QR layout, Used timestamp, dark surfaces, purple primary actions and serif recovery hierarchy were retained. R04/R05 references inform hierarchy; excluded mockup wallet/social features were not added. Existing email templates were reused, and local mixed/recovery/overflow HTML renders were inspected at 375px; the implementer's six-width/scenario proof also covers 900px. These are browser HTML previews, not real-inbox/email-client delivery proofs.

## External setup still required

No sender or support mailbox is assumed verified. Before any live activation, separately approve/configure the sender identity and real monitored support destination, provider credentials and signed webhook, server-only AES keyring/current key ID, independent rate secret, exact app origin, trusted client-IP header with gateway overwrite attestation, and the approved numeric profile. `TICKET_EMAIL_PUBLIC_ENABLED`, worker enable flag/database enablement and initial cutover timestamp remain explicit. A separate authorized scheduler/worker invocation setup is required; this implementation creates no schedule. Older encryption keys must remain available until their persisted retry payloads are purged. Do not backfill historical initial email by moving the cutover timestamp.

No commits, merges, pushes, deployments, shared database migrations, provider/DNS changes or real email sends were performed. The scheduler incident above is the disclosed exception to the requested local execution boundary and has been corrected.

## Implementation decisions and their tradeoffs

These are the ledger rulings, in their original order, with the cost if a different decision is required:

1. Use scoped stable prerequisite snapshots instead of forbidden commits/merges. Later source changes require deliberate reconciliation; the source worktrees remain untouched.
2. Keep the numeric profile configurable and NULL pending approval, with independent quota lanes. Activation must wait for the targeted approval; changing the profile requires new capacity validation.
3. Preserve unexpired grants and membership beyond normal 90-day metadata retention. This retains minimal private metadata longer; shortening retention would break approved long-lived links.
4. Split migrations by coherent contract rather than the provisional five-file grouping. The initial six grew to seven for retention/suppression, adding review overhead without expanding admissions scope.
5. Keep compact permanent initial-delivery receipts after metadata pruning. This grows minimal source metadata; removing the receipts would allow historical initial-email replay.
6. Persist the prepared scheduled-end basis separately from the live schedule. Rescheduling needs a fresh-link/recovery handoff; changing this choice would require revisiting immutable grant/payload guarantees.

## Reproduction boundaries

Run all commands from the isolated Spec 07 worktree. The database runner refuses a missing/mismatched recorded identity; do not substitute another database URL or copy identities from other tasks. On a fresh setup, `python3 tests/integration/spec07-database.py create` creates the labelled loopback-only container, then `migrate` replays migrations with cron disabled. `rebuild` destroys/recreates **only** that verified disposable container. `python3 tests/integration/spec07-services.py create` creates its dedicated REST facade once.

Use `python3 tests/integration/spec07-database.py test` for the new rollback SQL suites, followed by `python3 tests/integration/spec07-email-concurrency.py` for the committed synthetic race fixture. Run rollback suites before concurrency, or rebuild the owned fixture DB between them. `pnpm test:spec07:browser` rebuilds the owned DB, seeds synthetic paid/free records, invokes the real handlers with a fake provider over loopback, and resets the email settings to inactive at teardown. It never invokes a scheduler or a real provider. Browser traces/videos are disabled to avoid persisting bearer-bearing network traces; screenshots contain only synthetic admissions.

Do not use the inherited linked `db:types`/payment/moderation proof scripts for this scope. Generated types came from the verified localhost:55475 database, never a linked project. The recorded optional integration skips require external authenticated test configuration and are outside this local authorization.

## Incremental file inventory

The 111 incremental files in this inventory are compared with the recorded inherited manifest, rather than attributing the complete prerequisite diff to Spec 07. Paths are relative to the isolated Spec 07 worktree. Shared overlap files are included explicitly.

### Database migrations

- `supabase/migrations/20260913010000_create_ticket_email_foundation.sql`
- `supabase/migrations/20260913010100_add_ticket_email_worker_contracts.sql`
- `supabase/migrations/20260913010200_add_ticket_email_entry_points.sql`
- `supabase/migrations/20260913010300_add_scoped_ticket_email_access.sql`
- `supabase/migrations/20260913010400_preserve_initial_email_deduplication.sql`
- `supabase/migrations/20260913010500_add_resend_request_status.sql`
- `supabase/migrations/20260913010600_add_email_retention_and_recipient_suppression.sql`

### Backend delivery/access

- `supabase/functions/.env.example`
- `supabase/functions/_shared/ticketEmailAccess.test.ts`
- `supabase/functions/_shared/ticketEmailAccess.ts`
- `supabase/functions/_shared/ticketEmailHttp.test.ts`
- `supabase/functions/_shared/ticketEmailHttp.ts`
- `supabase/functions/_shared/ticketEmailProvider.test.ts`
- `supabase/functions/_shared/ticketEmailProvider.ts`
- `supabase/functions/_shared/ticketEmailWorker.test.ts`
- `supabase/functions/_shared/ticketEmailWorker.ts`
- `supabase/functions/_shared/ticketEmailWorkerProjection.fixture.json`
- `supabase/functions/ticket-collection/index.ts`
- `supabase/functions/ticket-email-access/index.ts`
- `supabase/functions/ticket-email-status/index.ts`
- `supabase/functions/ticket-email-webhook/index.test.ts`
- `supabase/functions/ticket-email-webhook/index.ts`
- `supabase/functions/ticket-email-worker/README.md`
- `supabase/functions/ticket-email-worker/index.test.ts`
- `supabase/functions/ticket-email-worker/index.ts`
- `supabase/functions/ticket-recovery-request/index.ts`

### Frontend and shared routes/confirmation

- `src/app/router/OrganizerShell.tsx`
- `src/app/router/router.test.tsx`
- `src/app/router/router.tsx`
- `src/config/browserEnv.test.ts`
- `src/config/browserEnv.ts`
- `src/features/buyer-journey/BuyerPrimitives.tsx`
- `src/features/buyer-journey/OrderConfirmationView.tsx`
- `src/features/orders/OrderConfirmationPage.test.tsx`
- `src/features/orders/OrderConfirmationPage.tsx`
- `src/features/organizer-operations/OrganizerDashboardPage.tsx`
- `src/features/organizer-operations/OrganizerOrderDetailPage.tsx`
- `src/features/organizer-operations/OrganizerRegistrationDetailPage.tsx`
- `src/features/organizer-operations/OrganizerRegistrationLookup.tsx`
- `src/features/rsvp/RsvpConfirmationPage.test.tsx`
- `src/features/rsvp/RsvpConfirmationPage.tsx`
- `src/features/ticket-delivery/DeliverySupport.tsx`
- `src/features/ticket-delivery/OrganizerRegistrations.test.tsx`
- `src/features/ticket-delivery/ResendTicketsDialog.test.tsx`
- `src/features/ticket-delivery/ResendTicketsDialog.tsx`
- `src/features/ticket-delivery/TicketDeliveryNotice.test.tsx`
- `src/features/ticket-delivery/TicketDeliveryNotice.tsx`
- `src/features/ticket-delivery/TicketEmailAccessPage.test.tsx`
- `src/features/ticket-delivery/TicketEmailAccessPage.tsx`
- `src/features/ticket-delivery/TicketEmailHttpBridge.test.tsx`
- `src/features/ticket-delivery/TicketRecoveryPage.test.tsx`
- `src/features/ticket-delivery/TicketRecoveryPage.tsx`
- `src/features/ticket-delivery/delivery.api.test.ts`
- `src/features/ticket-delivery/delivery.api.ts`
- `src/features/ticket-delivery/delivery.copy.ts`
- `src/features/ticket-delivery/delivery.public-api.ts`
- `src/features/ticket-delivery/delivery.queries.ts`
- `src/features/ticket-delivery/delivery.schemas.ts`
- `src/features/ticket-delivery/delivery.session.test.ts`
- `src/features/ticket-delivery/delivery.session.ts`
- `src/features/ticket-delivery/ticket-delivery.css`
- `src/features/ticket-experience/adapters/adapters.test.ts`
- `src/features/ticket-experience/adapters/ticketCollectionReader.ts`
- `src/features/ticket-experience/customer/TicketCollectionPage.tsx`
- `src/features/ticket-experience/email/EmailFrame.tsx`
- `src/features/ticket-experience/email/TicketRecoveryEmail.tsx`
- `src/features/ticket-experience/email/TicketsReadyEmail.tsx`
- `src/features/ticket-experience/email/email.types.ts`
- `src/features/ticket-experience/email/emailStyles.ts`
- `src/features/ticket-experience/email/renderEmail.test.tsx`
- `src/features/ticket-experience/email/renderEmail.ts`
- `src/lib/supabase/database.types.ts`
- `src/main.development.tsx`
- `src/main.tsx`
- `src/preview/screens.json`
- `src/preview/screens.render.test.tsx`

### Tests, configuration and verification

- `.env.example`
- `Docs/superpowers/plans/2026-09-11-spec07-implementation.md`
- `Docs/testing/spec07-ticket-email-verification.md`
- `deno.json`
- `deno.lock`
- `package.json`
- `playwright.spec07.config.ts`
- `scripts/verify-spec07-production.ts`
- `scripts/verify-ticket-shell-production.ts`
- `supabase/config.toml`
- `supabase/tests/database/spec07_email_access_limits.test.sql`
- `supabase/tests/database/spec07_email_behavior.test.sql`
- `supabase/tests/database/spec07_email_dispatch.test.sql`
- `supabase/tests/database/spec07_email_dispatch_block.test.sql`
- `supabase/tests/database/spec07_email_eligibility.test.sql`
- `supabase/tests/database/spec07_email_expiry.test.sql`
- `supabase/tests/database/spec07_email_fixture.inc`
- `supabase/tests/database/spec07_email_initial_status.test.sql`
- `supabase/tests/database/spec07_email_preparation_resume.test.sql`
- `supabase/tests/database/spec07_email_recipient_policy.test.sql`
- `supabase/tests/database/spec07_email_recovery.test.sql`
- `supabase/tests/database/spec07_email_retention.test.sql`
- `supabase/tests/database/spec07_email_schema.test.sql`
- `tests/e2e/spec07.spec.ts`
- `tests/e2e/support/spec07Harness.ts`
- `tests/e2e/support/spec07Setup.ts`
- `tests/e2e/support/spec07Teardown.ts`
- `tests/integration/edge/spec07-local/index.ts`
- `tests/integration/spec07-browser-fixture.py`
- `tests/integration/spec07-database-bootstrap.sql`
- `tests/integration/spec07-database.py`
- `tests/integration/spec07-email-concurrency.py`
- `tests/integration/spec07-services.py`
- `tests/integration/ticketShellProductionBoundary.test.ts`
- `tsconfig.e2e.json`

