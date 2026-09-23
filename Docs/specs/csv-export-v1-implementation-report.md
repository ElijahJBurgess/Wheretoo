# CSV Export V1 — implementation and verification report

Status: **Initial implementation record — superseded by the final PASS / ready-to-commit-and-review verdict in [the final review report](csv-export-v1-final-review.md).**

On 2026-09-23 the user approved the narrow shared-helper optimization. It passes the exact mixed-event benchmark in 3.638 seconds under unchanged limits, with equivalence/regression/browser proof and independent review. The initial failure narrative and measurements below are retained as historical evidence; they are not the current blocker status.

Target baseline and final HEAD: `dcb39e6c9f1a155782352ac1f79bd3617fff5472`.
Branch: `codex/csv-export-v1`.
Worktree: `/Users/exoh/Desktop/WhereTo-csv-export`.
The implementation is uncommitted. No push, merge, hosted migration, or production deployment occurred.

The user's implementation approval supersedes the inspection report's original “implementation not authorized” status. The original report is preserved unchanged. Current main was inspected and remains at the approved baseline with only the previously existing untracked inspection document.

## Initial blocking finding and stopped scope (resolved by approved continuation)

The implementation retains the approved 10,000-source / 10,000-row limits, 8 MiB JSON and CSV limits, 30-second browser deadline, existing ownership helpers, and existing coherence functions.

**The exact paid-order cap cannot reliably complete under the existing database timeout when other events contain substantial ticket history.** In the dedicated test environment, an event with 10,000 paid orders plus another event with 10,000 free admissions returns PostgreSQL `57014` / HTTP 500 after approximately eight seconds. There is no partial projection or CSV. This is a review blocker under the approved specification's performance clause.

Evidence: the final anti-join in `private.organizer_order_coherent`, defined in `20260915010100_add_cancellation_summary.sql`, uses `(t.order_id=o.id OR i.order_id=o.id)` across a ticket/item left join. An `EXPLAIN (ANALYZE, BUFFERS)` probe for one order scanned 10,003 tickets and 20,000 order items, removed all 10,003 joined rows, and took 22.224 ms in that diagnostic run. The export invokes the unchanged authority once per source order. Statistics were explicitly refreshed after bulk fixture construction; the mixed-event timeout still reproduces.

**Stopped:** optimization/replacement of that shared authority. No timeout increase, silent cap reduction, new index, duplicated integrity authority, asynchronous export, or shared-helper change was made.

Smallest proposed resolution for founder review: a logically equivalent replacement of that helper's last anti-join with two indexed anti-joins, one covering tickets owned by the order and one covering tickets attached to the order's items. Both directions must remain to catch cross-order corruption. Existing indexes appear to cover these joins. Before adopting it, prove equivalence for corrupt/missing/cross-order items and tickets, rerun lifecycle/security regressions, and rerun the mixed-event benchmark. **Founder approval is required to expand this task into that shared-helper optimization**, because this task explicitly requires stopping for a failing benchmark and preserving that authority. This is a proposal, not implemented code or a promise of sufficient performance.

The complete-or-fail product behavior works for the tested smaller datasets and single-source cap fixtures; the acceptance gate is still unmet for mixed-event data. No general production capacity claim is made.

## Implemented contract and preservation

Initial read migration: `supabase/migrations/20260923010000_add_organizer_csv_export.sql`. The approved continuation adds `20260923010100_optimize_organizer_order_coherence.sql`, a performance-only replacement; see final report for equivalence proof.

`get_organizer_event_export(p_event_id uuid, p_kind text) -> jsonb`, authenticated execution only. Supported kinds: `orders`, `admissions`, `registrations`.

Response: `{ schemaVersion: 1, kind, event: { id, title, status, startsAt, endsAt, timezone }, exportedAt, rowCount, rows }`. Each discriminated row shape is explicitly defined in `export.schemas.ts`; the frontend rejects extra properties, unexpected event/kind, duplicates, incomplete groups, inconsistent money/counts and contradictory used timestamps.

The function is stable, security-definer, with an empty search path. It accepts no actor ID. Existing `require_owned_paid_event` / `require_owned_free_event` helpers derive ownership from `auth.uid()`. It reuses `organizer_order_coherent`, `free_registration_is_coherent` and `order_refund_state`, includes historical sources, and fails if source/ticket integrity is inconsistent. Explicit projections exclude credentials and private provider/access state. The scalar response avoids PostgREST's row pagination limit. Grants on base tables are unchanged.

No production tables, columns, backfills, triggers, lifecycle writes, RLS changes, provider calls, queues or storage infrastructure were added. The isolated proof harness has a temporary-purpose fixture template relation in its disposable database; that relation is absent from the migration and never used by the application.

The bulk export authorization entry point is separate from admission operations. Platform moderation roles do not grant export access. Staff Access remains unimplemented.

## Exact CSV schemas

Every file is UTF-8 with BOM, comma delimiters, quoted cells with doubled quotes, CRLF records, UTC ISO timestamps, fixed-width rows and blank nulls. Amounts use original integer minor-unit snapshots rendered with two decimal places. Header order is fixed.

Orders — one row per paid-event order, including unpaid/failed/expired/processing/review/refunded history:

```text
Event Name,Event Status,Event Start UTC,Event End UTC,Event Timezone,Exported At UTC,Order Number,Buyer Name,Buyer Email,Order Created At UTC,Paid At UTC,Order Status,Refund Workflow State,Quantity,Ticket Items,Currency,Subtotal,Tax,Order Total
```

`Ticket Items` contains newline-separated immutable purchased-tier summaries: `<tier name> × <quantity> @ <unit amount> <currency> (subtotal <item subtotal> <currency>)`. Multi-tier orders remain one row. Order Total is not money received or net revenue.

Admissions — one row per issued paid ticket, using Order Number + Ticket Position as its safe reference:

```text
Event Name,Event Status,Event Start UTC,Event End UTC,Event Timezone,Exported At UTC,Order Number,Ticket Position,Tickets In Order,Buyer Name,Buyer Email,Ticket Tier,Order Status,Ticket Status,Issued At UTC,Check-In Status,Check-In Time UTC
```

Registrations — one row per issued free admission, including cancelled registration history:

```text
Event Name,Event Status,Event Start UTC,Event End UTC,Event Timezone,Exported At UTC,Registration Reference,Registrant Name,Registrant Email,Registered At UTC,Registration Status,Registration Quantity,Admission Position,Admission Label,Admission Status,Issued At UTC,Check-In Status,Check-In Time UTC
```

Registration Reference is `RSVP-` + the full non-secret registration UUID. Group registration context repeats; summing Registration Quantity across rows would overcount. Check-In Status is `checked_in` only for a stored used timestamp, otherwise `not_checked_in`. Buyer/registrant contact is never relabelled individual attendee identity.

Filenames: `<sanitized-event-slug>-<event-local-start-date>-<kind>.csv`, using stored event timezone, with documented `event` / `undated` fallbacks. No customer details or UUIDs enter filenames.

## Frontend and CSV safety

Paid dashboard and Orders offer Export → Orders CSV / Admissions CSV. Free dashboard and registration lookup offer Export Registrations CSV. No new scanner/check-in action or reporting route. The visible all-event notice states that search and filters do not apply.

Preparing, download-started, empty, failure, oversized and retry states are implemented. Header-only output represents empty data. The UI never claims that a file was saved. A synchronous request guard prevents double dispatch. Route, event, source and session identity changes abort/discard pending results; existing identity-lifetime protection also catches A→B→A transitions before React renders. Export data does not enter React Query caches, localStorage, analytics or logs. Temporary anchors and Blob URLs are retired.

Formula-sensitive prefixes (`=`, `+`, `-`, `@`, full-width equivalents, including whitespace/format prefixes) receive a protective apostrophe in the exported representation. Leading tab/CR/LF is protected. Forbidden control characters and cells beyond 32,767 UTF-16 units cause the entire export to fail; source data is untouched. All cells are quoted, including numeric/header cells. Unicode is retained; schema text-length validation follows PostgreSQL codepoint semantics and preserves database-valid title padding.

Independent review found and verified two fixes: database-valid padded/emoji-heavy strings must not be rejected by JavaScript UTF-16 length limits, and success focus must be restored after the trigger becomes enabled. Both have regression proof; Chromium reproduced the focus failure before the fix and passed afterward.

## Verification environment and boundaries

Local machine: Intel Core i9-9980HK 2.40 GHz, 32 GiB RAM. Docker VM configured for 16 CPUs and 8 GiB RAM. These are local measurements, not hosted-production benchmarks.

Dedicated identity-recorded containers: `whereto-csv-export-db` on `127.0.0.1:55625`, cached Supabase PostgreSQL 17.6.1.155; `whereto-csv-export-rest` on `127.0.0.1:55626`, PostgREST 14.15 with `db-max-rows=1000`. The authenticated role's existing eight-second statement timeout remains unchanged. Every database operation verifies container ID, name, task label and loopback port; no hosted/shared URL is accepted. Cron launch is disabled before migrations.

All 128 repository migrations, including the new read RPC, replayed in this environment. The cached database image lacks Storage relations, so a test-only minimal Storage bootstrap supplies relations required by existing image migrations. No Storage-service behavior is claimed. Database types were generated against this isolated migrated schema; only the new RPC type block was copied into the tracked type file.

Browser proof uses the production Vite entry/build at `http://127.0.0.1:3036`, a synthetic session, signed local JWTs and real PostgREST/SQL/RLS reads. External destinations are blocked. GoTrue login and external providers are not exercised. Only the visible limit/retry fault test substitutes an HTTP 413; normal downloaded datasets come from real SQL. No new payment transactions or external payment/email services were used.

## Test results

- Final targeted frontend tests: **47 passed**, covering exact schemas, independent Python CSV parsing, Unicode/delimiters/line breaks, formula prefixes, controls/cell sizes, 10,000 rows / cap+1, CSV and JSON byte overflow, strict secret-key rejection, safe errors, filenames, duplicate clicks, empty output, retry, abort/identity/source changes, deadline and object URL cleanup.
- Full frontend run: **1,637 passed, 2 failed, 190 files** at that run. Both failures reproduced in unchanged main: `OrganizerDashboardPage.test.tsx` expects a public link for a fixture whose event has now ended; `src/preview/screens.render.test.tsx` has stale public-event markup. Neither baseline failure was rewritten or hidden. Later export-specific additions/focus fix were verified by the targeted run and browser rerun.
- Existing SQL regression suites: **28 passed, 860 assertions**. Includes organizer reads/metrics, manual admission, free source behavior/integrity/lifecycle/security, core ticket truth, refunds/disputes, cancellation summaries, late payment, historical access and RLS. Full suite names/results are in the local evidence file below.
- Export-specific SQL: **2 suites passed, 46 assertions**. Owner/unrelated/anonymous/non-organizer/platform-admin checks; paid/free mismatch; seven historical paid states plus payment-after-invalidation; stable grouping; rejected free request absent; actual paid/free source hashes excluded; whole-source read-only fingerprints; canonical refund workflow observations; used history preserved through cancellation and completed refund.
- Browser: **3 passed**. Real 2,000-order file despite UI's 25-row page and a nonmatching search/Paid filter; real three-admission file from dashboard; real 55-registration files from free dashboard and lookup; exact row widths/BOM and unique references checked with Python `csv.reader`; keyboard Enter/Tab/Escape/focus; visible limit failure/no download/retry; late navigation response discarded.
- Typecheck, lint and production build passed. `git diff --check` passed.
- Spreadsheet applications actually tested: **none**. No local Excel, Numbers or LibreOffice installation found. Google Sheets integration/session was not available or introduced. Independent parsing and browser downloads are proven; application-specific Excel/Sheets/LibreOffice behavior remains unverified.

## Completeness, size and performance measurements

These are real signed-JWT PostgREST requests with a 1,000-row server setting, not mocked results. All successful rowCount values matched actual array lengths. The scalar response preserves the complete array.

| Export | Sources / rows | Other data | HTTP | Seconds | Response bytes |
| --- | ---: | --- | ---: | ---: | ---: |
| orders | 55 | one free admission | 200 | 0.096 | 30,027 |
| orders | 2,000 | one free admission | 200 | 1.498 | 1,067,656 |
| orders | 10,000 | one free admission | 200 | 3.186 | 5,339,658 |
| orders | 10,001 | one free admission | 413 | 0.012 | 77 |
| registrations | 55 | 2000 paid orders / three paid admissions | 200 | 0.016 | 24,120 |
| registrations | 1,001 | 2000 paid orders / three paid admissions | 200 | 0.115 | 432,794 |
| registrations | 10,000 | 2000 paid orders / three paid admissions | 200 | 0.713 | 4,320,363 |
| registrations | 10,001 | 2000 paid orders / three paid admissions | 413 | 0.011 | 77 |
| orders | 10,000 | 10000 free admissions | 500 | 8.008 | 100 |

The 10,001-source paid fixture also rejects Admissions, even though it has only three issued paid tickets: the source-count bound is independent of output rows. Group RSVP correctness is separately proven in SQL (55 single registrations plus one three-person registration gives exactly 58 admissions, 56 distinct registration references).

A database-valid oversized padded event title drove the actual JSON projection above 8 MiB: HTTP 413 / `EXPORT_LIMIT_EXCEEDED`, 77-byte error body, 0.683 seconds, with no rows returned. The fixture title was restored. Frontend tests separately reject oversized CSV output and oversized JSON input. The first byte-limit probe used a 5,000-space title and correctly did not overflow the transport because event metadata appears once in JSON; the corrected probe used 8 MiB of padding. No production limit changed to make tests pass.

The first free 10,000-row attempt after rapid bulk loading timed out with stale statistics. Explicit fixture ANALYZE corrected that case; the final free cap measurement above is 0.713 seconds. The paid mixed-event failure persists with refreshed statistics and was reproduced at 8.037 and 8.008 seconds. All benchmark outcomes, including failures, are retained; the successful single-source cap does not waive the mixed-event blocker.

## Visual QA record

Scope: owner CSV actions in existing organizer operations; paid populated Orders/dashboard and free lookup/dashboard; local production build only; synthetic fixture reads and downloads authorized by this implementation task. Profiles: responsive, keyboard/state journey and browser output. Reference: existing organizer operations styles and approved inspection UX. No deployment freshness claim.

Inspected actual screenshots at 320, 390 and 1440 px (paid Orders) and 390 px (free registration lookup and oversized error). Export controls, explanatory copy and retry state remain within the viewport, with no horizontal overflow. Paid Enter/Tab/Escape and success focus restoration are browser-tested. Large text/zoom, screen-reader output and other browser engines are not separately verified. Delivery status: local implementation only.

Local evidence: `.superpowers/csv-export/visual/`, `performance.json`, `mixed-performance.json`, `sql-regressions.json`; raw command logs are `/tmp/whereto-csv-*.log`. Screenshots and synthetic data are not production/customer evidence and are not committed.

## Files changed

Production:

- `supabase/migrations/20260923010000_add_organizer_csv_export.sql`
- `supabase/migrations/20260923010100_optimize_organizer_order_coherence.sql` (approved continuation)
- `src/lib/supabase/database.types.ts` (new RPC block only)
- `src/features/organizer-operations/export.schemas.ts`
- `src/features/organizer-operations/export.api.ts`
- `src/features/organizer-operations/export.csv.ts`
- `src/features/organizer-operations/EventExportControl.tsx`
- `src/features/organizer-operations/OrganizerDashboardPage.tsx`
- `src/features/organizer-operations/OrganizerOrdersPage.tsx`
- `src/features/organizer-operations/OrganizerRegistrationLookup.tsx`
- `src/features/organizer-operations/organizer-operations.css`

Verification/documentation:

- Four frontend test files: `export.csv.test.ts`, `export.api.test.ts`, `export.download.test.ts`, `EventExportControl.test.tsx`
- `src/test/exportFixtures.ts`
- `supabase/tests/database/organizer_csv_export.test.sql`
- `supabase/tests/database/organizer_csv_export_lifecycle.test.sql`
- `supabase/tests/database/organizer_csv_export_equivalence.test.sql` and `helpers/csv_export_old_coherence.inc` (approved continuation)
- `playwright.csv-export.config.ts`, `tests/e2e/csv-export.spec.ts`, `tsconfig.e2e.json`
- `tests/integration/csv-export-database.py`, `csv-export-services.py`, `csv-export-proof.py`, `csv-export-platform-bootstrap.sql`
- `Docs/superpowers/plans/2026-09-23-csv-export-v1.md`
- This report and the unchanged copy of the approved inspection report.

`node_modules` is a local untracked symlink to current main's installed dependencies, not a feature deliverable. No dependency installation or lockfile change occurred.

## Reproduction and next decision

Use only this worktree's dedicated recorded containers. For a fresh local harness, run `python3 tests/integration/csv-export-database.py create`, then `migrate`, then `test`; create the REST facade with `csv-export-services.py create`. Existing recorded containers must not be recreated. At handoff the dedicated database is migrated and empty after the final rollback-only SQL run; run the proof script to seed browser datasets. The guarded `reset` command destroys only this task's disposable schemas; use it before replaying migrations when test data already exists. Do not use linked/hosted database type-generation commands.

`python3 tests/integration/csv-export-proof.py` loads synthetic fixtures and tests the real transport. It intentionally ends nonzero if the mixed-event cap benchmark fails, retaining the evidence and restoring the 2,000-paid/55-free browser fixtures. Run browser proof with `node_modules/.bin/playwright test --config playwright.csv-export.config.ts`. SQL regression suites require the empty migrated harness because existing rollback fixtures use fixed IDs.

No manual production setup has been performed. A future approved release needs its reviewed migration applied through the normal migration workflow and the frontend deployed; neither should happen while the blocker remains. Spreadsheet-app checks remain an explicit validation gap. No upstream Revel or Hi.Events code was imported. No Staff Access, Duplicate Event, Email Attendees, CSV Import or other next capability was started.

**Initial recommendation was to stop for approval. That approval and optimization are now complete; [the final report](csv-export-v1-final-review.md) contains the current PASS / commit-and-review recommendation and remaining release checks.**
