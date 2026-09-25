# CSV Event Import V1 — reproducible local proof

Baseline: `3627e9a604b133dd129d60ee87e09eecff5a9e98`. Worktree: `.worktrees/csv-event-import-v1`, branch `codex/csv-event-import-v1`.

All commands run from the feature worktree. Read the [operations runbook](../runbooks/csv-event-import-v1.md). The dedicated runners refuse other container/port identities. Never substitute a hosted URL, linked project, actual Mapbox token, or real email provider.

## Order

1. `pnpm install --frozen-lockfile`.
2. Start dedicated baseline and feature with `python3 tests/integration/run-event-import-local.py start --baseline` and `python3 tests/integration/run-event-import-local.py start`.
3. On fresh databases, run `python3 tests/integration/event-import-regressions.py baseline` and `python3 tests/integration/event-import-regressions.py feature`. These compare the same 110 baseline SQL suites. Compare individual errors/assertion counts, not only totals. The SQL suites each roll back. Configure development policies/cron only inside the test transaction; no scheduler remains enabled.
4. Execute both new SQL test files through the guarded feature database. Schema-default tests need a fresh disabled setting.
5. Run `event-import-proof.py`, `event-import-scale.py`, then `event-import-concurrency.py` sequentially. Scale serializes SQL transactions over a persistent local connection and uses the production CSV parser, field validator and geocoder through a Deno transport with **no network permission**. Concurrency uses separate real PostgreSQL connections and observes lock waits before releasing blockers.
6. Run `event-import-browser-fixture.py`, then `event-import-supplement.py`, `event-import-finite-race.py`, `event-import-email.py`, `event-import-boundaries.py`, and `event-import-performance.py`. Do not reseed configuration while another proof is running. The email proof uses ordinary queued/access/recovery SQL contracts inside a rollback transaction with synthetic settings and no provider request.
7. `pnpm exec playwright test --config playwright.event-import.config.ts`. The harness builds the real production application, uses local Auth/PostgREST and injected geocoding. Its network allowlist routes the synthetic Supabase host to loopback and blocks other hosts. It exercises four denied roles; active admin upload/structural failure; review, duplicate decisions, partial selection, Retry, reload, cancellation; foreign-admin handoff and actual-owner editor; 50-row paging; keyboard focus; 390/1440 viewports and document containment. Inspect the screenshots, including the horizontally scrollable review table.
8. `pnpm typecheck`, `pnpm lint`, `pnpm test --maxWorkers=4`, `pnpm build`, `pnpm typecheck:functions`, `pnpm test:functions`. Frontend tests/build need synthetic public Supabase/Mapbox/Stripe environment values. No secret provider key is required. The branch adds no consumer import-condition branch.
9. Measure parser/validation with `pnpm exec deno run tests/integration/edge/event-import/memory.ts`. It consumes an exact 2 MiB file containing 500 rows; measured RSS is a local observed process sample, not hosted peak memory/SLA.
10. Return local configuration to disabled or reset the disposable feature database. Disable cron in both dedicated projects. Preserve evidence; do not touch unrelated stacks/worktrees.

Proof evidence is written under `.superpowers/sdd/2026-09-24-csv-event-import-v1` and `.superpowers/event-import-proof`, ignored by Git. Browser fixture JSON contains only disposable local credentials but must remain private and uncommitted. Source CSV/provenance screenshots are synthetic. The final Build + Prove report records actual results and any limitations; command listings here are not success claims.

## Visual QA contract

Target: production Vite preview at `http://127.0.0.1:3090/moderation/event-imports`, its batch and imported-draft routes, and the existing owner editor. Actor/job: active admin turns legitimate free CSV rows into official-owner drafts; actual owner reviews. Authoritative requirements are the approved inspection and existing staff shell. Profiles: responsive, state/journey, page contract. Viewports: 390×900 and 1440×900. Level B evidence: repository Playwright, real local data contracts, inspected screenshots. Authorized local rebuild/fixture state changes only. No deployment claim. Pass requires contained page layout, independently scrollable table, usable focus, expected role boundaries, recoverable state and no unexpected console/page errors.

The optional `tests/integration/edge/event-import/consumer-http.ts` follow-through uses the production Free RSVP and ticket-collection handlers, real localhost service RPCs and real synthetic HMAC credentials. After the browser fixture and supplement scripts, run it with `pnpm exec deno run --allow-env --allow-read=.superpowers --allow-write=.superpowers --allow-net=127.0.0.1:60321 tests/integration/edge/event-import/consumer-http.ts`. It performs no provider calls and records receipt/status replay plus ordinary QR/check-in results.
