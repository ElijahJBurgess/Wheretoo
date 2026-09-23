# CSV Export V1 — final optimization and review report

Status: **PASS for CSV Export V1 implementation and the approved optimization — ready to commit and review for merge.**

This is not a production-release or all-repository-tests-green claim. Existing baseline failures and unperformed environment/application checks are disclosed below.

Date: 2026-09-23. Branch: `codex/csv-export-v1`. Worktree: `/Users/exoh/Desktop/WhereTo-csv-export`. Final HEAD remains `dcb39e6c9f1a155782352ac1f79bd3617fff5472`; all feature work is uncommitted. No push, merge, deployment or hosted database mutation occurred. Current main remains unchanged at that baseline.

This report supersedes the earlier PARTIAL readiness verdict in [the implementation report](csv-export-v1-implementation-report.md). That earlier report retains the exact CSV schemas, full file inventory, safety design, browser/visual scope, environment and original failure evidence. The user explicitly approved the narrow shared-helper optimization in this continuation.

## What changed

Added `supabase/migrations/20260923010100_optimize_organizer_order_coherence.sql`. It replaces only the last anti-join in `private.organizer_order_coherent(uuid)`, splitting its OR predicate into two indexed search paths. Existing indexes are used; **no new index, table, column, trigger, infrastructure, timeout increase or cap reduction** was introduced. Every other coherence predicate is byte-for-byte unchanged. The function remains stable, security-definer, with an empty search path and the same revoked browser/service-role execution privileges. Ownership, ticket/payment/refund truth, export schemas and frontend behavior are unchanged.

CSV Export now has two additive migrations: the export read RPC migration `20260923010000_add_organizer_csv_export.sql` and this authorized performance-only replacement. Neither performs source-data backfills or lifecycle writes. There is no new caller-supplied actor identity or new authorization path.

## Equivalence proof

Let A mean `t.order_id=o.id`, B mean `i.order_id=o.id`, and C be the complete unchanged invalid-relationship predicate. The old check rejects if there exists a joined row satisfying `(A OR B) AND C`. The new checks reject if any row satisfies `A AND C` or any row satisfies `B AND C`. These are the same set of invalid witnesses; duplicates cannot affect EXISTS. PostgreSQL WHERE retains only TRUE, so this equivalence holds for TRUE/FALSE/NULL, not merely two-valued Boolean logic.

The order-owned branch keeps LEFT JOIN: a ticket with a missing item must remain visible and be rejected by `i.id IS NULL`. The item-owned branch uses INNER JOIN because a missing item cannot satisfy `i.order_id=o.id`. Both directions remain necessary: a foreign order's ticket can reference this order's item without changing this order's own ticket count.

Proof artifacts:

- `supabase/tests/database/helpers/csv_export_old_coherence.inc`: frozen exact old function body from migration `20260915010100`, renamed only into the test temporary schema. A byte comparison verified it matches that original source.
- `supabase/tests/database/organizer_csv_export_equivalence.test.sql`: **44 passing assertions** across 13 independent rollback scenarios, all original fixture orders, null/missing order IDs, all 27 three-valued predicate combinations, and security/grant checks.
- Cases include valid sources; missing ticket, item, item tier, event and parent; wrong event, organizer, tier, label and unit position; and the existing payment-after-invalidation exception.
- Explicit cross-order case moves a paid order's ticket reference to an unpaid order's valid same-tier item. For the paid order, its ticket count remains correct but the outgoing item relationship is wrong. For the unpaid order, its zero own-ticket count remains correct but a foreign ticket points to its item. **Both orders are rejected**, exercising each direction without relying on a ticket-count failure.
- A source comparison verified that all function text outside the replaced final anti-join is unchanged.

Fixture corruption disables writer/FK triggers only inside independently rolled-back test subtransactions. Production constraints and the queried helpers are never weakened. No live payment/provider operations are involved.

## Exact performance acceptance

The previous mixed-event case returned HTTP 500 / PostgreSQL 57014 in **8.008 seconds**. After this rewrite, the identical fixture generator and real authenticated PostgREST RPC returned **HTTP 200, all 10,000 orders, 5,339,658 response bytes, in 3.638 seconds** while another event contained **10,000 free admissions**. Parsed `rowCount` and actual array length both equal 10,000.

The authenticated and authenticator roles still have `statement_timeout=8s`. PostgREST still has `db-max-rows=1000`. CSV limits remain 10,000 source records and 10,000 rows, 8 MiB JSON, 8 MiB CSV and the 30-second browser deadline. No limit or environment sizing was changed for the passing run.

| Kind | Source count | Background | HTTP | Seconds | Response bytes |
| --- | ---: | --- | ---: | ---: | ---: |
| orders | 55 | one free admission | 200 | 0.106 | 30,027 |
| orders | 2,000 | one free admission | 200 | 1.225 | 1,067,657 |
| orders | 10,000 | one free admission | 200 | 3.593 | 5,339,658 |
| orders | 10,001 | one free admission | 413 | 0.014 | 77 |
| registrations | 55 | 2000 paid orders / three paid admissions | 200 | 0.022 | 24,120 |
| registrations | 1,001 | 2000 paid orders / three paid admissions | 200 | 0.092 | 432,794 |
| registrations | 10,000 | 2000 paid orders / three paid admissions | 200 | 0.947 | 4,320,363 |
| registrations | 10,001 | 2000 paid orders / three paid admissions | 413 | 0.014 | 77 |
| orders | 10,000 | 10000 free admissions | 200 | 3.638 | 5,339,658 |

The script also passed actual JSON-byte overflow, admission source-count overflow, and HTTP authorization checks. Every cap+1 response contained only the error, with no partial rows. The benchmark script completed with exit 0, restoring the 2,000-order / 55-registration browser fixtures. Full results: `.superpowers/csv-export/optimized-performance.json`; raw log `/tmp/csv-optimized-performance.log`.

Environment is unchanged: Intel i9-9980HK, 32 GiB host RAM, Docker VM 16 CPUs/8 GiB; isolated identity-guarded PostgreSQL 17.6.1.155 and PostgREST 14.15 containers. These are local acceptance measurements, not claims about unmeasured hosted-production capacity.

## Rerun verification

- **90 export SQL assertions passed** across the original export/security/lifecycle suites and the new equivalence suite (30 + 44 + 16).
- Expanded existing SQL run: **52 suites; 49 passed completely, three retained baseline failures**. 1,495 assertions passed and seven failed. The additional organizer metrics/manual-admission suites passed another **46 assertions**. Coverage includes checkout reservation/fulfillment/expiry, ticket truth, free RSVP, organizer reads, refunds, cancellation, event history, late payments, access boundaries and RLS.
- All seven failed SQL assertions reproduce with the **old helper restored in a rollback-only transaction**: `checkout_integrity_expiry` has one cron ownership/active/ACL expectation incompatible with the safe local harness/current migration state; `ticketing_schema` has five pre-free-RSVP exact-schema/FK expectations; `unattached_checkout_forward` has one initial-email-enqueue expectation under the local disabled-email configuration. No assertions were skipped, rewritten or made weaker to report success. The current `spec08_checkout_expiry`, newer core/free-source schemas, actual fulfillment, refund/lifecycle and export security tests pass.
- Targeted export frontend: **47 passed**. Wider organizer frontend: **149 passed, one known baseline failure** in the date-sensitive dashboard fixture, already reproduced on unchanged main. Earlier full frontend run also documented the unrelated stale public-event preview snapshot; no unrelated test was changed.
- Typecheck, lint, production build and diff whitespace check passed.
- Production-browser rerun: **3 passed in 13.0 seconds**, using the optimized migrated database and actual authenticated RPCs. Paid Orders (2,000 rows, ignoring filters/pagination), paid Admissions, free Registrations, retry/no-partial-download, navigation fencing and keyboard focus all passed.
- Final independent whole-feature review: **no actionable code findings**. Reviewer independently reran all 47 targeted frontend tests, verified the frozen old body and unchanged predicates, reviewed SQL NULL/missing-item/cross-order semantics, and checked authorization, field allowlists, formula escaping, bounds, identity lifetime and integration scope.

SQL result inventory: `.superpowers/csv-export/optimized-regressions.json`. Logs: `/tmp/csv-optimized-sql.log`, `/tmp/csv-optimized-regressions.log`, `/tmp/csv-optimized-additional-sql.log`, `/tmp/csv-expiry-old-helper.log`, `/tmp/csv-baseline-ticketing_schema.log`, `/tmp/csv-baseline-unattached_checkout_forward.log`.

## Scope, known limitations and handoff

The feature remains a thin authenticated read-only projection with strict transport validation and safe local CSV generation. Exact Orders/Admissions/Registrations schemas, formula protection, secret allowlists, identity/route fencing and filename rules remain as documented in the implementation report. No Revel/Hi.Events source code was reused.

Spreadsheet applications actually tested remain **none**: no locally available Excel, Numbers or LibreOffice, and no Google Sheets session/integration was introduced. Independent Python parsing and real browser-download proof are not represented as spreadsheet-application testing. Baseline suite failures remain disclosed; readiness below is a feature-specific verdict, not an all-repository-tests-green claim.

Additional files in this continuation: the optimization migration, old-reference `.inc`, equivalence SQL suite, this final report and plan/report status updates. No frontend production code changed in this continuation. No dependency or lockfile changes. No production setup was performed; a future approved release must apply both reviewed migrations through the usual workflow. No push, merge or deployment is authorized by this report.

## Final decision

The approved optimization resolves the measured blocker while preserving the old helper's security/integrity semantics. **CSV Export V1 is PASS for implementation/local acceptance and ready to commit and review for merge.** No commit was made; the final HEAD is still the baseline listed above, with the complete worktree diff available for review.

Remaining release checks: actual supported spreadsheet application open/import behavior when available; deployed authenticated-response cache/header behavior and hosted migration parity. There is no explicit concurrent writer/export interleaving test; a single STABLE read-only statement snapshot preserves membership by PostgreSQL semantics and was reviewed, but no concurrency execution claim is made. Baseline SQL/frontend failures remain visible and should be considered by the merge reviewer. No production deployment, push or merge occurred, and no other feature was started.
