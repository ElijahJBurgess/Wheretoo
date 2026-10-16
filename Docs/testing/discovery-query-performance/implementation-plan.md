# Task 2.5 implementation plan

Approved spec: user's 2026-10-16 Task 2.5 SQL Optimization request; audited SQL in proposed.sql. Baseline origin/main 2cd5960.

1. Verify isolated baseline and intentional 16-field map contract; add regression coverage for private set, shared callers and equivalence before applying SQL.
2. Install the reviewed SQL as one migration. Test real application, permission/eligibility suites, exact results, performance at 9/500/2000, transactional failure and rollback/reapplication.
3. Run application typecheck/lint/build/tests; inspect final diff and independent review.
4. Verify staging identity/schema and Git workflow; merge reviewed PR, apply only new migration to staging, deploy existing staging and run hosted read/security/map smoke tests.

Risks: shared current-eligibility wrapper is used outside discovery; inlining depends on invoker/no SET helper; pagination must filter before limit; target schema must match audited hashes. No ticket/payment function changes, API/RLS changes, new indexes/tables, preview environments or public production.

## Execution ledger

- Worktree reused, branch codex/discovery-query-optimization. Main unchanged since audit. Unrelated primary checkout left untouched.
- Baseline audit already reproduced exact equivalence and inherited 15-versus-16 assertion failure; actual application/rollback tests still required.
- User explicitly authorizes merge, staging migration and staging deploy after checks; no repeated approval required.
- Actual forward/rollback/reapply and intentional pre-COMMIT abort verified. Baseline hashes restored exactly; fixtures zero after rollback.
- All120 broad SQL outcomes identical baseline/candidate. Ruling: do not repair unrelated legacy service-read/schema/cron tests; report every failure, and add a narrow real-service fulfillment regression to cover the shared wrapper dependency without loosening grants.
- Intentional16-field map contract confirmed from icon migration and tests; stale assertion corrected only.
- Independent static review and fixture follow-up: no blockers. App256files2068tests/typecheck/lint/build and Edge15tests passed. Final SQL rerun passes (45 TAP assertions plus 4,156 adversarial comparisons). Additional integration run257pass5skip, with missing credentials/linkage and unchanged placeholder-token contract failure documented; no unexpected SQL/app regression.
