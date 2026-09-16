# Spec 08 + Spec 09 integration plan

**Goal:** Freeze the two approved local implementations in one isolated, uncommitted checkout.
**Architecture:** Use the verified Spec 07 dependency file map; overlay disjoint Spec 08 and Spec 09 deltas. Keep payment, refund and delivery authorities independent.
**Spec:** User integration request and Docs/testing/spec09-deferred-shared-integration.md.

- [x] Capture exact source paths, branch/HEAD, status, file hashes and archives; classify every shared file in Docs/testing/spec08-spec09-source-reconciliation.md.
- [x] Create codex/spec08-spec09-integration at 94c546bd0961f501584f8a3437298b2331cafd5c and combine source snapshots without source modifications.
- [x] Apply the three exact deferred patches: lazy /refund-details route, refunded confirmation copy/support, refund-only inactive ticket support. Preserve all props, payment actions, delivery notice, calendar, View tickets and credential unions.
- [x] Add focused attachment and cross-spec tests for original purchase identity/collection through refunds, payment eligibility, notice independence and secure history.
- [x] Adapt guarded test tooling to a new disposable integration database/container/ports; replay every migration unchanged with cron disabled. Regenerate public Supabase types from that schema and inspect the diff.
- [x] Run full configured frontend/function/type/lint/build checks, safe integration tests, Spec 06/07/08/09 SQL and concurrency suites, and real-browser production route/combined journeys with synthetic providers only.
- [x] Review diff, migration/source hashes, routes and production boundaries; record exact counts, skipped external proofs and remaining limits. No commit, push, deployment, shared DB/provider changes or transactions.
