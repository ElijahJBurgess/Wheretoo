# Spec 10 implementation and verification

Local implementation complete on September 12, 2026. All changes remain uncommitted. This is a local verification result, not a deployment or provider-delivery claim.

## 1. Worktree and branch

Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes`. Branch: `codex/spec10-event-changes`. No staging, commit, merge or push was performed.

## 2. Starting integrated baseline

The starting point is `codex/spec08-spec09-integration` at `94c546bd0961f501584f8a3437298b2331cafd5c`, including its frozen uncommitted Specs 04–09 dependency files. All 797 source file hashes were preserved when copying the baseline into the isolated worktree. Final verification found no drift in the source integration worktree. Comparing only against Git HEAD would incorrectly attribute inherited dependency work to Spec 10.

Evidence: [frozen baseline manifest](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/integrated-baseline.json>), [incremental file manifest](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/incremental-files.json>), [incremental diff](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/incremental.diff>). The protected baseline verification confirms 120 migration/payment/refund/credential/recovery files remain byte-identical; other additive shared changes are listed in the incremental manifest.

## 3. Migrations

Five additive migrations were replayed after all 113 inherited migrations, for 118 total, exclusively in the identity-guarded disposable database:

| Migration | Result |
|---|---|
| `20260915010000_add_event_change_history.sql` | Immutable saved/public facts, persisted notice requirement, atomic owner context and conditional writer wrappers. |
| `20260915010100_add_cancellation_summary.sql` | Narrow late-payment/no-ticket owner-read correction. Despite its filename, this migration contains the read correction. |
| `20260915010150_add_owned_event_cancellation_summary.sql` | Authoritative owner-only cancellation, admission and financial summary. |
| `20260915010200_add_event_notices.sql` | Existing Spec 07 outbox/grant extensions, explicit notice preview/submit, immutable receipts, status access and revision suppression. |
| `20260915010300_add_approved_private_event_facts.sql` | Proven public event facts for existing paid/free private collections and email-access reads. |

Migration directory: [Spec 10 migrations](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/supabase/migrations>).

## 4. Event history

Immutable snapshots distinguish previous/current saved revisions from previous/current actually publicly eligible revisions. Unavailable legacy history stays unavailable; it is never inferred from current draft fields. Material schedule/timezone, venue, normalized location/address and entry-disclosure changes persist Notice required. Capacity-only edits do not require a notice. The owner comparison emphasizes changed facts and retains complete recorded details in expandable sections. Private collections use proven public facts and retain current ticket identity/status.

## 5. Stale-edit protection

Save, requirements, policy acceptance and publication use expected-context checks under the existing event lock. Atomic mutation replies carry the exact resulting context. A stale or unknown baseline cannot overwrite newer facts; reloading is deliberate. Capacity changes also invalidate old context, including an A→B→A sequence. Existing publication/moderation algorithms remain authoritative. The editor refreshes owner caches and prevents identity changes or stale in-flight reads from repopulating private data.

## 6. Cancellation

The UI calls the existing `cancel_owned_event`; there is no second cancellation engine. Confirmation remains successful if the independent summary or notification read fails. An ambiguous response triggers a read of the same event: cancelled confirms success, confirmed published permits deliberate retry, and failed reconciliation stays Unknown with cancellation retry disabled. Cancellation neither sends email nor dispatches refunds.

## 7. D07 notices

Organizers review the exact revision and audience before deliberate submission. Saving, publishing and cancellation do not send. Each canonical paid order or free registration contributes one message, regardless of ticket quantity or shared email addresses. Fully Used sources remain eligible for appropriate notices without gaining admission access. Financially held and incoherent sources remain separately restricted.

The existing Spec 07 outbox, worker, grants, dispatch idempotency, leases and provider observations are reused. Durable per-source receipts survive outbox retention. Superseded unsent work is suppressed and fresh review remains required. Ambiguous submission retries preserve the exact request identity and reviewed intent. Dispatch acceptance and actual delivery observations are reported separately.

Cancellation grants expire 30 days from preparation. Change grants use scheduled end plus 24 hours where independently eligible. Existing grants never extend in place. Private status access returns an allowlisted event/payment/admission view, scrubs the fragment, scopes local retention, and provides ticket access only when independently authorized. Cancellation status pages expose no admission QR.

## 8. D08 cancellation/refund summary

Server-derived counts separate issued, unused-cancelled, Used, refunded and other admissions. Paid summaries report received payments, unpaid attempts, confirmed whole-order refunds, eligible amounts and processing/action-required/unknown/failed/review states using Spec 09 authority. Incomplete or incoherent data is unavailable rather than fabricated zero. Free registrations show payments/refunds as Not applicable. Existing individual whole-order refund navigation is retained; no automatic, bulk, Refund All or per-ticket refund path was added.

## 9. Late-payment read correction

The owner can read the exact canonical `PAYMENT_AFTER_INVALIDATION` state with `requires_review`, received payment, reconciliation review and zero issued tickets. The DTO accepts that narrow exception. Admission stays disabled and refund authorization is not inferred. Other order-coherence checks remain enforced.

## 10. Paid/free results

| Separate canonical fixture | Verified result |
|---|---|
| Paid: one $70 order, three admissions, one Used | Cancellation preserves the Used timestamp, cancels two unused admissions, reports one eligible $70 whole order, and queues one cancellation message. No automatic refund. |
| Free: one registration, two admissions, one Used | Cancellation preserves the Used timestamp, cancels one unused admission, reports one cancelled registration and payments/refunds Not applicable, and queues one cancellation message. |
| Existing buyer links | Original paid/free collection links retain ticket identities and show current cancelled status; inactive focused tickets have no admission QR. |
| Changed-event link | Updated venue is visible; the status page has no QR; its independently permitted ticket CTA opens the existing collection and valid focused QR before cancellation. |
| Lost cancellation reply / failed status read | Committed cancellation is confirmed by reread despite summary failure; unresolved cancellation remains Unknown until a same-event read authorizes deliberate retry. |

Fixtures are separate paid and free events. No mixed event or zero-dollar paid order was introduced.

## 11. Verification results

| Check | Result | Evidence |
|---|---|---|
| Full frontend suite | 1,161 passed, 128 files | [frontend log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-frontend.log>) |
| Full function suite | 327 passed, 0 failed | [functions log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-functions.log>) |
| Spec 10 SQL | 216 assertions passed across 12 files | [207 assertions](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-spec10-sql.log>); [9 security assertions](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/status-access-security.log>) |
| Specs 04–09 and moderation SQL regressions | 931 assertions passed across 36 files | [dependency SQL](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-dependency-sql.log>) |
| Actual concurrent database sessions | 34 scenarios passed: history 9, email 5, checkout 5, refunds 4, cancellation/admission/issuance 8, notices 3 | Logs in [local evidence directory](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10>) |
| Offline integration contracts | 258 passed; 5 optional local-cleanup tests skipped | [integration log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/offline-integration.log>) |
| Production browser journeys | 2 passed | [browser log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/browser-proof.log>) |
| Full application/integration/E2E/scripts typecheck | Passed; E2E typecheck repeated after final harness wait correction | [typecheck log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-typecheck.log>) |
| Function typecheck | Passed, 85 files | [function typecheck](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-function-typecheck.log>) |
| Full lint | Passed; final E2E file checked again | [lint log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-lint.log>) |
| Production build | Passed with inert local API values | [build log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-build.log>) |
| Production boundary checks | Ticket-shell and Spec 07 checks passed; no server secrets/sender/worker/fixture markers in their inspected production graph/artifacts | Executed after final build |
| Diff/scope/credentials | Git whitespace check and protected baseline hashes passed; incremental text scan found no private credential values | [protected file list](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/protected-baseline-verification.json>) |

The 5 skipped tests belong to the optional `coreTicketTruthLiteCleanup.test.ts` database-URL suite; its generic database URL was intentionally not configured. Four hosted database/authorization suites and the real Stripe transaction suite were excluded from the offline command. The relevant canonical SQL, ownership, transaction, admission and concurrency behavior was exercised against the guarded local database, not a hosted service.

The initial preview snapshot failure was corrected by adapting the existing screen fixture to atomic context reads and regenerating three affected event captures; the twelve unrelated captures remained identical. Final browser teardown waits for the independent summary and notice reads after confirmation, so a successful early cancellation render no longer closes the mocked transport while those reads are in flight.

### Browser and visual scope

Current-render status: **verified for the exercised local Chromium states**. Local source/build/served-artifact identity: **matched**. Deployment: **not performed**.

The canonical target was production Vite preview at `http://127.0.0.1:3030`, backed by real guarded local SQL and production Edge handlers through loopback-only test transport. Fresh browser contexts intercepted the inert API domain; external requests were blocked. The built source digest is `0b47cf60f7292926b741397ffc2f385ea17af7ec74c3f75adb29fac2ea222114`; the 126-file artifact digest is `504be97d23c0bebcf7537a1c02a8614dcf6b895a9c93e74bda294a3f628e5a35`. Every served file matched the manifest. See [artifact identity](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-artifact-identity.json>) and [served-file verification](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/served-artifact-verification.json>).

Screenshots were opened and inspected for history, paid/free cancellation summaries, paid/free private status, and Unknown cancellation at 320/390/768/1440 CSS pixels (900px viewport height, DPR 1). No horizontal overflow, clipped primary controls or blocking layout defect was found. Mobile comparison labels stack explicitly; counts reflow; Used and inactive admissions remain readable. Additional inspected states include the updated buyer page, inactive focused ticket and confirmed cancellation with unavailable summary. The reference was the approved product/readiness contract, R08 comparison hierarchy and existing organizer/buyer styles; this is not a claim of pixel-identical concept-art reproduction.

Three actual HTML emails captured from the manually invoked shared worker with an in-memory provider were rendered and inspected at 390/768: change, paid cancellation, free cancellation. Private grants were redacted in the saved HTML. The browser journey exercised their original generated status links. This verifies browser rendering and local link behavior, not inbox delivery or Outlook/Gmail rendering.

The bundled mechanical sweep separately verified the no-grant `/event-status` branch at all four widths (mobile screenshots use the sweep's DPR 2; dimensions reported above remain CSS pixels). It reported zero errors and two large-viewport whitespace warnings. Inspection confirms the existing 440px buyer column is centered intentionally; no correction was required. The sweep is supplementary and does not replace the authenticated populated-route journeys.

Visual artifacts: [inspected screenshots](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/browser-visual>); [unavailable-status sweep](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/status-unavailable-sweep/frontend-visual-qa-report.json>); [audit contract](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/visual-qa-contract.md>). No claim is made about native browser chrome, real mobile hardware, screen-reader certification or external email clients.

## 12. Skipped provider proofs and local isolation

Per explicit user instruction, no real email, Stripe TEST call, provider configuration, deployment, shared database migration, commit, merge or push occurred. In-memory email acceptance is not real provider acceptance or delivery. Real email/webhook deliverability and Stripe end-to-end proofs remain outside this authorized local run.

The disposable database is `whereto-spec10-db`, recorded container identity beginning `e5ccc0a3f4d5`, label `wheretoo.task=spec10-event-changes`, loopback port 55525. REST uses 55526 and local Edge uses 55527. Each database operation verifies recorded identity, label, loopback port and disabled cron before writing. Scheduled execution remained off. The worker was enabled only for explicit local in-memory test invocations and is disabled at completion. Final checks show `cron.launch_active_jobs=off` and `worker_enabled=false`: [isolation log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/.superpowers/spec10/final-local-isolation.log>).

## 13. Remaining blockers and manual setup

No unresolved local implementation, contract or security blocker was identified. Scoped history/backend/frontend reviews were completed and their material findings corrected and rereviewed; the full runtime checks above followed those corrections.

No manual provider setup is required for this completed local verification. Nothing is deployed. A future release must separately authorize applying these migrations and deploying the changed functions/frontend together, and run its provider proofs under the existing Spec 07/09 operational controls. Existing provider credentials, worker setup, refund economics and reconciliation were not replaced.

## Changed files

The complete incremental list is in the linked manifest above. Main implementation areas are:

- [event changes feature](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/src/features/event-changes>): history comparison, cancellation recovery/summary, deliberate notice review, private event status and regression tests.
- [event editor](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/src/features/events/EventEditorPage.tsx>), [event preview](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/src/features/events/EventPreviewPage.tsx>), [published event](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/src/features/events/PublishedEventPage.tsx>), routing, owner cache boundaries and the existing preview fixture.
- [late-payment owner DTO](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/src/features/organizer-operations/operations.schemas.ts>) and its targeted test.
- [notice domain](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/supabase/functions/_shared/eventNotice.ts>), additive existing worker/access branches and [private status endpoint](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/supabase/functions/event-status-access/index.ts>).
- Existing private paid/free collection readers, ticket views and email renderers under [ticket experience](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/src/features/ticket-experience>); shared source identities and QR derivation are preserved.
- Five migrations, generated public database types, 12 SQL test files, guarded local fixture/race/service scripts and [production browser proof](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes/tests/e2e/spec10.spec.ts>).

Raw evidence and fixture bearers remain local in the ignored evidence directory; they are not committed.
