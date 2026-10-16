# Task 2.5 — installed-migration verification

Baseline: origin/main `2cd59606659d312edab54234173ab37339b1f552`. Approved scope: private inlineable eligibility set, existing current-eligibility wrapper delegation, map/list query projections; no API, eligibility, RLS, index, table, payment/ticketing, cache, icon or filter semantic changes.

## Implementation

- `20261016010000_optimize_discovery_eligibility_projection.sql` matches the audited proposal exactly except its approval header. Existing owner/ACL/security-definer/empty-search-path boundaries remain. New helper is private, stable, invoker-only, fully qualified and has no SET clause, permitting planner inlining.
- The current wrapper remains time-independent for accepted in-flight fulfillment. Map/list enforce strict event-end freshness separately. List eligibility is joined before pagination; existing row limits remain.
- Verified the 16-field map contract was intentionally introduced by the merged icon projection. Corrected the outdated 15-field assertion, preserving production output.
- Added real migrated-function equivalence/permission tests and a service-role fulfillment regression. Frozen baseline functions live only in pg_temp in rollback-only tests. No production function is replaced by a test candidate.
- Added a disposable-database-only performance fixture. Branch-specific Vercel suppression prevents an extra preview; main retains the existing staging workflow.

## Migration and rollback

Actual forward migration, exact rollback, and reapplication succeeded in an isolated PostgreSQL 17.6 clone. Rollback restored all original function-definition hashes and removed only the new helper. A deliberate exception before COMMIT proved transactional abort leaves the baseline intact. Neither test touched hosted data. The rollback script rejects optimized-body drift; verify metadata/intervening changes before use.

Read-only staging preflight verified project `oznjmliqnczotunksafx` is `wheretoo-staging`, healthy, and matches all four audited function hashes, owners, ACLs and RLS flags. Remote migration history matches local history with only version `20261016010000` pending. Vercel project `prj_rOJVTvXCkSNMGqnfmCjGAPYrysao` is the sole project linked to this repository in the verified team; its main branch deploys the existing staging application. Actual remote application/hosted verification is a separate final delivery gate.

## Performance

Three comparable analyzed local fixture runs per shape; medians below. See performance-results.json for every sample, query-plan-summary.json for actual nested plans. These are database execution timings on local x86_64 Docker PostgreSQL, not browser/network or staging SLA measurements.

| Events | Map before → after | List before → after |
|---|---:|---:|
| 9 | 17.35 → 7.67 ms | 17.33 → 5.81 ms |
| 500 | 1,047.08 → 24.98 ms | 56.15 → 19.72 ms |
| 2,000 | 4,226.39 → 174.44 ms | 98.16 → 53.76 ms |

The 2,000-row optimized samples ranged 97–205 ms. A subsequent nested-plan check measured 4,131.35 → 74.41 ms, 75,325 → 48,837 shared buffer hits, and 2,000 rows on both plans. The optimizer sees indexed eligibility joins instead of per-event nested scalar eligibility checks. Buffer hits are access counts, not unique rows or disk reads. Existing spatial and authorization indexes remain in use; no index change is justified.

Full ordered map payloads and initial list payloads matched at all three sizes. A 40-page, 2,000-event list walk matched every page/cursor. Map still materializes all viewport candidates before its existing external 1,000-row cap; this existing scaling limit is unchanged.

## Regression evidence

- 78 adversarial cases / 4,156 comparisons against real installed functions: current/final eligibility, all 16 map fields, ordered list payloads/cursors, date/category/price windows, policy/legacy authorization linkage, hidden/blocked/removed/cancelled/expired states, ownership, location, icons and malformed requests.
- API-role direct-table/private-helper/service-only RPC denials remain enforced. Search-path and metadata checks from the audit remain applicable; no security-boundary change.
- Seven focused shared-caller assertions pass on baseline and optimized versions: actual service-role reservation/attachment/fulfillment, eligible payment, post-expiry accepted payment, blocked/cancelled review, and denied direct order reads. Elevated fixture reads never grant the service role table access.
- Full application suite: 256 files / 2,068 tests pass with two workers. Typecheck, lint and build pass. Build retains its existing >500 kB chunk warning.
- Public-discovery Edge tests: 15 pass.
- Additional integration run: 257 pass, five skip, five suites report issues. Three need missing organizer integration credentials, one needs a linked database (intentionally unlinked to prevent hosted fixture writes), and one has an inherited placeholder-token assertion (`task16-disabled` versus existing `pk.task16-disabled`). These files/package settings are unchanged from main. No hosted fixture mutation occurred. These are environment/stale-contract limitations, not a green full integration suite.
- Broad SQL suite: 120 pre-existing files executed on baseline and optimized databases with **identical outcomes**. 66 files fully pass (1,679 assertions); all-file output includes 2,143 passing assertions, 14 failed assertions and 47 execution errors. The 54 affected files are inherited incompatibilities, chiefly old direct service-role table-read fixtures, obsolete schema/signature assertions, and cron expectations (cron intentionally excluded from disposable clones). See sql-suite-results.json for every file and error. No broad SQL regression was observed; the entire legacy SQL suite is not green.
- Independent static SQL/security review and the follow-up fixture review found no Critical/Important issues. The reviewer did not rerun the tests.

The original primary checkout's unrelated changes were untouched. No fixtures were written to staging/production. Hosted deployment results and any remaining gates are reported separately at delivery. Task 3 is out of scope.
