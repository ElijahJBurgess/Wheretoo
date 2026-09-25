# CSV Event Import V1 — Build + Prove report

1. **Result.** **PASS for local BUILD + PROVE**, with the explicitly permitted inherited SQL-suite failures below. No feature-only regression remains. This is not production activation or a hosted performance claim.

2. **Branch / worktree.** `codex/csv-event-import-v1` at `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/csv-event-import-v1`. The dirty recovery checkout was preserved.

3. **Baseline main HEAD.** Fetched `origin/main` and verified `3627e9a604b133dd129d60ee87e09eecff5a9e98` before starting. It matched the approved inspection baseline.

4. **Final HEAD / working state.** HEAD remains `3627e9a604b133dd129d60ee87e09eecff5a9e98`. Implementation, migration, tests and reports are **uncommitted**. No commit, push, merge, PR publication or deployment was performed.

5. **Files changed.** See the complete inventory below. Production changes are limited to the importer, its private migration/RPCs, admin routes/navigation/cache isolation, generated RPC types, and function packaging/configuration. Consumer event/RSVP/ticket/payment behavior was not edited.

6. **Migration.** One new migration: `supabase/migrations/20260925010000_add_event_import_v1.sql`. It adds three private RLS-enabled tables, narrow read/service RPCs, fenced work/receipts and two expression indexes on ordinary events. Full migration chain applied successfully from a fresh **dedicated local** reset. No hosted schema changes. New schema/ACL suites pass **23 assertions** (6 + 17).

7. **Parser proof.** Pinned `csv-parse@7.0.2` in Deno; arrays precede named fields. Quoted commas, doubled quotes, multiline values, physical start lines, malformed structure, NUL/invalid UTF-8 and one-BOM handling are tested. Structural failure creates a failed batch with zero source rows and zero events. Parser is absent from the production browser assets.

8. **CSV schema / limits.** Exact required/optional headers; authority and unknown/duplicate headers rejected. Server enforces CSV extension/content type, bounded records, 2,097,152-byte body limit and at most 500 nonblank records. Exact 2 MiB and 500 succeed; one byte over / 501 fail. HTML-like field content remains inert. Filename is bounded database text, never a filesystem key.

9. **Authorization.** Active-admin checks independently protect reads and every mutation. Denial covers anonymous, buyer, ordinary organizer, moderator, inactive/revoked admin, wrong batch-row membership and forged service actor calls. All private tables deny direct browser access; service mutation RPCs are not callable by browser roles. A reviewer-found missing ACL was fixed and directly regression-tested.

10. **Destination organizer.** One private configured destination with batch snapshot/revision. Browser cannot choose it. Disabled/missing destination, incomplete onboarding, banned/deleted Auth identity and configuration changes fail closed. Real concurrent revision changes prevent pending import. No silent retarget, impersonation, broader owner RLS or admin publish path.

11. **Date/time / DST.** Strict calendar/date/time validation in Los Angeles; both spring gaps and fall folds reject. Request-scoped conversion cache avoids repeated work. SQL revalidates fields/time at insertion after lock waits. Real race held a pending import until its start passed; it became invalid and created no event. Existing manual editor conversion is untouched.

12. **Geocode adapter.** Server-only structured Mapbox v6 permanent request, injected fetch, eight-second provider timeout, bounded response, strong unique address policy and existing Bay Area box. Ambiguous/weak/unsupported secondary units require review; out-of-area invalid; timeout/429/5xx retry; auth/config globally pauses. Unit evidence cannot silently become a parent address. No live Mapbox request or hosted token/entitlement setup.

13. **Duplicate detection.** Exact NFKC/lower/punctuation-normalized title + inclusive ±30-minute instant + same feature OR canonical address, across owners and lifecycle states. Earlier unresolved rows anchor same-batch comparisons. Imported anchors use current ordinary event facts; reverse completion cannot bypass detection. Candidate digest includes identity/title/start/status/moderation/revision/update/location. Stale override persists refreshed evidence and requires another explicit choice; audit retains actor/time/digest. No merge/update of existing events.

14. **Upload / batch idempotency.** Actor + request UUID receipt binds file digest and filename. Same receipt returns same batch; changed content conflicts; deliberate new request creates new batch. Session-scoped upload receipt survives an uncertain response/reload until success; identity changes clear it along with private import queries. Counts derive from rows; no background-only worker. Browser reload restores durable state.

15. **Row idempotency.** One row transaction writes canonical event and result receipt together; failures retain a retryable row without a partial event. Replay returns the existing ID after active-admin authorization, including cancelled/disabled work. Real double-click/concurrent/lost-response tests pass; **1,000 independent replay transactions** preserve one event (mean 5.79 ms, p95 8.79 ms locally).

16. **Admin UI.** Seven real production-build Playwright cases pass: four denied roles; admin upload/malformed CSV/progress/review/duplicate override/partial selection/Retry/reload/result/cancel; fifty-row paging. Desktop 1440 and mobile 390, keyboard focus, contained page and independently scrollable table verified with inspected screenshots. No unexpected console/page errors. Template download, Unlimited capacity and owner handoff are present. Continue processes at most ten geocodes and ten selected rows per call; large selections resume with Continue.

17. **Owner handoff.** Foreign admin sees read-only canonical imported-event facts and “Awaiting official organizer review,” with no owner links. Actual configured owner reaches the unchanged editor with the imported title/content. Foreign publish denied; actual owner supplied synthetic disclosures, accepted current development policies, then published normally. No fabricated production consent or risk answers.

18. **Ordinary event insertion.** Draft/free/default moderation/history; genuine destination organizer; canonical location/PostGIS; null or finite capacity; no legacy artwork injection. Import creates zero ticket tiers, paid orders, registrations, tickets or email. Existing event triggers initialize ordinary lifecycle/change truth. Private import rows remain provenance/operations, not an alternate event model.

19. **Free RSVP / ticket / email proof.** Imported-event follow-through passes real Free RSVP and ticket-collection HTTP handlers over local RPCs, receipt/status replay, real synthetic HMAC credentials and check-in duplicate rejection. Null capacity remains unlimited. Two real connections competing for finite capacity one produce exactly one registration/ticket. Existing email initial receipt/access/recovery contracts pass on an imported event with rollback-only synthetic settings; no new ticket IDs and no provider send. Email-disabled behavior creates no outbox. Existing downstream suites also participate in the differential; no import-specific consumer branch.

20. **500-row proof.** **395 distinct ordinary drafts / 105 skipped / 0 unresolved**, replay all395 stable. Distribution:350clean,50invalid,25same-batch duplicates,25existing duplicates,25ambiguous,25transient. Retry25; skip30duplicates/override20; injected event-creation failure commits44 other later drafts and retry creates exactly1. Explicit zero registration/ticket/email delta. Production parser/validator and **475 injected geocode transport calls**, with Deno network capability absent; real SQL leases/transactions. Fixture CSV 103,470 bytes; full run 44.207s locally.

21. **Concurrency proof.** Separate real PostgreSQL connections and observed lock waits: same-row double execution; simultaneous requests; matching rows across batches; revoke during provider work/before commit; destination revision change; cancel during geocode/import; stale lease after reclaim; real event start passing during lock wait; committed response replay. Cancellation preserves earlier events. Authority changes serialize with transactions already holding locks; they do not retroactively undo committed events.

22. **Duplicate query/index performance.** 10,000 additional unrelated ordinary events; EXPLAIN ANALYZE confirms importer index use. Recorded execution 0.071 ms, planning 1.772 ms. Seeding/query proof rolled back. Local measurement only; not a hosted SLA.

23. **Memory / timing.** Exact 2 MiB /500-row parse+validation with request cache: 561.2 ms. Observed RSS after 97.8 MiB; heap used 16.0 MiB. Earlier uncached boundary sample1.55s/~103.7MiB. These are observed process samples, not proven peak memory or hosted limits. Provider/network latency is excluded from injected measurements; per-call/budget tests independently prove numerical bounds.

24. **Baseline differential.** Fresh pristine-main versus final fresh feature database: **110 identical suite outcomes**, 59passing/51identically failing, same assertions/errors, **zero differences**. Frontend: pristine209files/1756tests; feature210files/1757tests, all passing before the final identity-storage cleanup. After that cleanup, all5 targeted auth/importer tests passed, including its new regression (the suite now contains1758tests). SQL total includes1,976 successful assertions on each side despite aborted/failed inherited suites.

25. **Known inherited failures.** The51 SQL-suite failures are enumerated below. Most are legacy fixture/service-role permission failures; remaining cases assert outdated schema/contracts or lack a pgTAP search path. They were reproduced exactly on pristine fetched main. No unrelated baseline repair was made. Earlier overloaded frontend timeouts and initial missing-env/dependency setup failures were resolved/retested and are not counted as inherited debt.

26. **New regressions.** None remain in the completed checks/differential. During development, tests/review found and fixed owner insertion permission through the index helper, service RPC exposure, source-line/BOM handling, reverse-order duplicate detection/stale review, secondary-unit loss and mobile grid overflow. Whole-branch reviewer rechecked their important findings and cleared them.

27. **Build quality results.** PASS: `pnpm typecheck`; `pnpm lint`; full frontend1757tests before final identity-storage cleanup, followed by5 passing targeted tests including the new regression; production `pnpm build` in the browser harness; `pnpm typecheck:functions`; **432 function tests**; targeted importer tests;23new SQL assertions; local integration/scale/races;7browser cases; Python syntax and `git diff --check`. Public RPC types generated from guarded localhost; existing GraphQL declarations preserved. Deno uses isolated npm cache/explicit JSX mappings to preserve pnpm’s patched frontend dependencies; pnpm lock unchanged.

28. **Security / privacy review.** No organizer/status/admission/moderation/coordinate/feature/policy/ticket authority in browser inputs. No source URL fetching, raw CSV filesystem storage, or public provenance field/badge. Import is POST/origin/bearer protected; actor derived from Auth; response/error bodies bounded and sanitized; private no-store. Production scan of151 JS assets excludes server Mapbox env/token, parser, service credential and private provenance canary. No secrets committed; disposable credential fixtures remain ignored/private.

29. **Activation / manual setup.** Separately authorized migration/deployment, verified real official organizer configuration, active-admin grants, server-only Mapbox token and permanent-storage entitlement, production budget/monitoring and a live geocoder smoke test remain. Cleanup is a bounded service contract, no installed schedule. See `Docs/runbooks/csv-event-import-v1.md`.

30. **Activation boundary confirmation.** No real Mapbox call, hosted migration, function/production deployment, real consumer email, Stripe change, provider activation, push or merge. All proof targets were the guarded dedicated localhost stacks. Final local import setting disabled, destination cleared, provider paused; email gates and cron disabled. Unrelated stacks were left alone.

31. **Remaining risks.** Inherited SQL test debt reduces the breadth of green legacy proof despite exact differential equality. Real Mapbox confidence/entitlement, hosted latency/memory, real email delivery and production setup were intentionally not tested. Unsupported units require corrected CSV/new upload. Provider backoff and ten-row continuation may require repeated Continue actions. Retention is manual/service-only; pruned batch row totals are historical. None is hidden behind an unconditional production-ready claim.

32. **Recommendation.** **Yes — ready to commit and review for merge**, subject to normal human review and the documented inherited test debt. **No production activation yet.** Work remains uncommitted for the requested handoff. Stop here; no payment/live-readiness or next feature started.

## Identical inherited SQL-suite failures

- `checkout_integrity_confirmation.test.sql` — ERROR:  permission denied for table orders
- `checkout_integrity_contract_cleanup.test.sql` — ERROR:  permission denied for table order_items
- `checkout_integrity_fixture_lifecycle.test.sql` — ERROR:  permission denied for table ticket_tiers
- `checkout_integrity_fulfillment.test.sql` — ERROR:  permission denied for table orders
- `checkout_integrity_refunds.test.sql` — ERROR:  permission denied for table orders
- `checkout_integrity_reservation.test.sql` — ERROR:  permission denied for table ticket_tiers
- `connect_refresh_sequence.test.sql` — ERROR:  permission denied for table organizer_stripe_accounts
- `core_ticket_truth_lite_collection.test.sql` — ERROR:  permission denied for table orders
- `core_ticket_truth_lite_fulfillment.test.sql` — ERROR:  permission denied for table orders
- `core_ticket_truth_lite_lifecycle.test.sql` — ERROR:  permission denied for table orders
- `core_ticket_truth_lite_redemption.test.sql` — ERROR:  permission denied for table orders
- `core_ticket_truth_lite_schema.test.sql` — ERROR:  permission denied for table orders
- `moderation_evaluations.test.sql` — ERROR:  permission denied for table events
- `moderation_policy_acceptance.test.sql` — not ok 27 - the acceptance boundary has no client authority beyond event identity
- `order_confirmation.test.sql` — ERROR:  permission denied for table orders
- `organizer_csv_export.test.sql` — ERROR:  permission denied for table orders
- `organizer_csv_export_equivalence.test.sql` — ERROR:  permission denied for table orders
- `organizer_csv_export_lifecycle.test.sql` — ERROR:  permission denied for table orders
- `organizer_event_metrics.test.sql` — ERROR:  permission denied for table orders
- `organizer_manual_admission.test.sql` — ERROR:  permission denied for table orders
- `organizer_order_reads.test.sql` — ERROR:  permission denied for table orders
- `organizer_refund_context.test.sql` — ERROR:  permission denied for table orders
- `payment_fulfillment.test.sql` — ERROR:  permission denied for table stripe_webhook_events
- `publish_event.test.sql` — not ok 3 - another organizer event is rejected
- `refunds_disputes.test.sql` — ERROR:  permission denied for table orders
- `spec04_organizer_reads.test.sql` — ERROR:  permission denied for table orders
- `spec05_admission_search.test.sql` — ERROR:  permission denied for table orders
- `spec07_email_initial_status.test.sql` — ERROR:  permission denied for table orders
- `spec07_email_preparation_resume.test.sql` — ERROR:  permission denied for table orders
- `spec07_email_recipient_policy.test.sql` — ERROR:  permission denied for table orders
- `spec08_checkout_expiry.test.sql` — not ok 2 - one exact database-owned expiry job remains inaccessible to browser and service roles
- `spec08_spec09_integration.test.sql` — ERROR:  permission denied for table orders
- `spec08_spec09_notice_failure.test.sql` — ERROR:  permission denied for table orders
- `spec09_refund_lifecycle.test.sql` — ERROR:  permission denied for table orders
- `spec09_refund_notice_access.test.sql` — ERROR:  permission denied for table orders
- `spec09_refund_operations.test.sql` — ERROR:  permission denied for table orders
- `spec10_cancellation_summary.test.sql` — ERROR:  permission denied for table orders
- `spec10_event_notices.test.sql` — ERROR:  permission denied for table orders
- `spec10_late_payment_read.test.sql` — ERROR:  permission denied for table orders
- `spec10_notice_access_and_lifecycle.test.sql` — ERROR:  permission denied for table orders
- `spec10_private_collection_facts.test.sql` — ERROR:  permission denied for table orders
- `spec10_refund_summary_states.test.sql` — ERROR:  permission denied for table orders
- `spec10_used_notice_audience.test.sql` — ERROR:  permission denied for table orders
- `spec11_profile_revision.test.sql` — ERROR:  permission denied for table orders
- `spec14_assembly_contracts.test.sql` — ERROR:  function plan(integer) does not exist
- `storefront_attribution.test.sql` — ERROR:  permission denied for table orders
- `storefront_transactions.test.sql` — ERROR:  permission denied for table orders
- `ticketing_schema.test.sql` — not ok 14 - ticket columns are exact; not ok 22 - ticket column types are exact; not ok 34 - financial foreign keys are exact; not ok 57 - Stripe IDs and Day 2 domain keys are uniquely constrained; not ok 59 - all financial foreign keys use ON DELETE RESTRICT
- `unattached_checkout_forward.test.sql` — not ok 19 - existing fulfillment enqueues initial email exactly once
- `webhook_reconciliation.test.sql` — ERROR:  permission denied for table stripe_webhook_events
- `webhook_review_safety.test.sql` — ERROR:  permission denied for table orders

## Complete changed-file inventory

- `.env.example`
- `Docs/runbooks/csv-event-import-v1.md`
- `Docs/specs/2026-09-24-csv-event-import-inspect-spec.md`
- `Docs/superpowers/plans/2026-09-24-csv-event-import-v1.md`
- `Docs/testing/2026-09-24-csv-event-import-build-prove.md`
- `Docs/testing/csv-event-import-v1.md`
- `deno.json`
- `deno.lock`
- `deno.staging-import-map.json`
- `package.json`
- `playwright.event-import.config.ts`
- `src/app/router/router.tsx`
- `src/components/layout/OrganizerLayout.tsx`
- `src/features/auth/privateQueryCache.test.ts`
- `src/features/auth/privateQueryCache.ts`
- `src/features/event-imports/EventImportBatchPage.tsx`
- `src/features/event-imports/EventImportDraftPage.tsx`
- `src/features/event-imports/EventImportReviewTable.test.tsx`
- `src/features/event-imports/EventImportReviewTable.tsx`
- `src/features/event-imports/EventImportsPage.tsx`
- `src/features/event-imports/RequireImportAdmin.tsx`
- `src/features/event-imports/eventImports.api.ts`
- `src/features/event-imports/eventImports.css`
- `src/features/event-imports/eventImports.queries.ts`
- `src/features/event-imports/eventImports.schemas.ts`
- `src/features/organizer-operations/OperationsUi.tsx`
- `src/lib/supabase/database.types.ts`
- `supabase/config.toml`
- `supabase/functions/_shared/eventImportCsv.test.ts`
- `supabase/functions/_shared/eventImportCsv.ts`
- `supabase/functions/_shared/eventImportGeocode.test.ts`
- `supabase/functions/_shared/eventImportGeocode.ts`
- `supabase/functions/_shared/eventImportHttp.test.ts`
- `supabase/functions/_shared/eventImportHttp.ts`
- `supabase/functions/_shared/eventImportRuntime.ts`
- `supabase/functions/_shared/eventImportTime.ts`
- `supabase/functions/_shared/eventImportValidation.ts`
- `supabase/functions/event-import-process/index.ts`
- `supabase/functions/event-import-upload/index.ts`
- `supabase/migrations/20260925010000_add_event_import_v1.sql`
- `supabase/tests/database/event_import_authorization.test.sql`
- `supabase/tests/database/event_import_schema.test.sql`
- `tests/e2e/event-import.spec.ts`
- `tests/integration/edge/event-import/consumer-http.ts`
- `tests/integration/edge/event-import/local.ts`
- `tests/integration/edge/event-import/memory.ts`
- `tests/integration/edge/event-import/scale-transport.ts`
- `tests/integration/event-import-boundaries.py`
- `tests/integration/event-import-browser-fixture.py`
- `tests/integration/event-import-concurrency.py`
- `tests/integration/event-import-email.py`
- `tests/integration/event-import-finite-race.py`
- `tests/integration/event-import-performance.py`
- `tests/integration/event-import-proof.py`
- `tests/integration/event-import-regressions.py`
- `tests/integration/event-import-scale.py`
- `tests/integration/event-import-supplement.py`
- `tests/integration/run-event-import-local.py`
- `tsconfig.e2e.json`

## Evidence and reproduction

See `Docs/testing/csv-event-import-v1.md` and `Docs/runbooks/csv-event-import-v1.md`. Machine-readable local evidence lives in `.superpowers/sdd/2026-09-24-csv-event-import-v1/` (`scale.json`, `concurrency.json`, `finite-race.json`, `supplement.json`, `email.json`, `consumer-http.json`, `boundaries.json`, `query-plan.json`, `memory-cached.json`, `safe-state.json`, build/test logs); exact baseline comparison is `.superpowers/event-import-proof/differential.json`. Inspected synthetic screenshots are `.superpowers/event-import-proof/screens/`. These ignored local artifacts and credentials are not committed. The report records the outcomes needed for review, and source proof runners are included for reproduction.


## Git/GitHub closeout verification — 2026-09-25

The numbered report above records the original uncommitted Build + Prove handoff. The subsequent user-authorized closeout fetched `origin/main`, which remained `3627e9a604b133dd129d60ee87e09eecff5a9e98`; no reconciliation or SQL/provider change was needed.

A fresh independent whole-branch review checked authorization, owner boundaries, geocode trust, CSV safety, duplicate races, row replay, provenance, ordinary RSVP integration and activation defaults. Staged review identified one additional privacy race: sign-out during asynchronous file hashing could recreate the old actor's session-storage upload receipt. A guard now rejects the stale identity before any receipt access. A deferred-hash component regression failed before the fix and passed afterward; the independent reviewer rechecked and cleared it.

Final closeout verification passed **211 frontend test files / 1,759 tests**, **432 function tests**, full typecheck, lint (plus the changed-file lint after the correction), production build, function typecheck and staged whitespace checks. The full frontend suite and production build were rerun after the correction. No database/provider code changed during closeout. The seven browser cases, 23 new SQL assertions, 500-row proof, real concurrency and identical 51 inherited SQL failures remain the preceding Build + Prove evidence; they are not represented as newly rerun closeout checks.

The new closeout test is `src/features/event-imports/EventImportsPage.test.tsx`, in addition to the original inventory above. Ignored logs, credentials and proof artifacts remain untracked. Dedicated local settings were read back as disabled, destination unset, provider paused and cron inactive. Source defaults are disabled/unconfigured; no hosted schema/configuration or provider activation was performed. Git commit/PR/merge identities and the automatic staging frontend result are recorded in the closeout handoff, rather than claimed in this pre-commit report.
