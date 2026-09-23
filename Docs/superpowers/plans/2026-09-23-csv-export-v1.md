# CSV Export V1 Implementation Plan

> Execute the approved design inline using test-driven development, then independent final review.

**Goal:** Complete-or-fail owner CSV download for paid orders, paid admissions and free registrations.
**Architecture:** One authenticated read-only scalar JSON RPC; strict discriminated DTO; browser-only CSV/download. No lifecycle changes.
**Spec:** Docs/specs/csv-export-v1-inspection-report.md, approved by the user in this task.
**Baseline:** dcb39e6c9f1a155782352ac1f79bd3617fff5472; isolated codex/csv-export-v1 worktree.

## Global constraints
10,000 sources / 10,000 output rows; JSON and CSV each <=8 MiB; 30-second request deadline; exact headers; immutable source snapshots; existing owner/coherence/refund helpers; no new grants to base tables.

## Review focus
- A→B→A auth changes before React renders must discard pending downloads.
- Corrupt/orphan admissions must fail, not disappear in joins.
- Multi-tier/group rows must retain stable positions and source identity.
- Embedded delimiters and formula prefixes must remain inert after independent parsing.
- The real scalar PostgREST result must contain >1,000 rows and reject cap+1.

## Tasks
- [ ] 1. Write/run red SQL contract test in a uniquely labelled loopback Docker database. Add the single read migration and run green authorization, lifecycle, completeness and overflow tests. Generate only new RPC type from that local schema.
- [x] 2. Write/run red serializer/schema tests; implement export.schemas.ts and export.csv.ts. Parse output with Python csv independently; cover exact headers, money, text, limits and secrets.
- [x] 3. Write/run red API/control tests; implement export.api.ts and EventExportControl.tsx; integrate only dashboard, Orders and registration lookup. Reuse existing identity lifetime checks and discard stale responses.
- [ ] 4. Exercise real PostgREST, production browser downloads, mobile/keyboard and available spreadsheet applications. Run full frontend suite, relevant SQL regressions, typecheck, lint and build. Inspect complete diff and obtain independent review; fix findings with regression tests.

## Execution record
- Worktree created from exact approved baseline; source report copied unchanged, original preserved.
- pnpm dependency preflight attempts reinstall with a symlinked node_modules; invoke installed binaries/npm scripts without changing dependency state.

- CSV serializer, API and control implemented; 47 targeted frontend tests pass, including independent Python parsing and reviewer regression cases.
- 128 migrations replayed on identity-guarded disposable PostgreSQL; only the generated export type block was copied.
- 28 SQL regression suites / 860 assertions pass. Export-specific SQL covers owner/admin boundaries, real credential-hash exclusion, historical statuses, groups, rejection, read-only snapshots, and used/refunded/cancelled history.
- Production browser proof: three journeys pass with real PostgREST datasets, mobile screenshots inspected, keyboard success focus verified.
- Typecheck/lint/build pass. Full frontend run has two independently reproduced baseline failures (dashboard date fixture and stale public preview), recorded without changing unrelated tests.
- Tasks 1/4 are not fully accepted: exact 10,000 paid-order cap times out when another event has 10,000 free admissions. Shared coherence helper was not changed. Review blocker and smallest proposed resolution are in the implementation report. No commits, merge or deployment.

## Approved performance-only continuation (2026-09-23)
User explicitly approved splitting the shared helper anti-join, preserving all semantics. Add one replacement-function migration, freeze the old helper as a test reference, prove equivalence for corruption/missing/cross-order relations and SQL NULL logic, run expanded SQL and affected frontend/browser checks, then the exact mixed-event benchmark under unchanged 8 seconds. Stop if it fails; otherwise obtain final independent whole-feature review. No push/merge/deployment or next feature.

- [x] Old/new equivalence: 44 assertions; both cross-order directions explicitly rejected.
- [x] All original helper predicates outside the final anti-join retained, including grants/security properties; no new indexes.
- [x] Mixed-event benchmark and final independent review accepted: HTTP 200 / 10,000 rows / 3.638 seconds at unchanged 8 seconds; no actionable review findings. Three browser journeys and 47 frontend tests pass. Final report discloses baseline suite failures and remaining release checks. Ready to commit/review; no commit, push, merge or deployment performed.
