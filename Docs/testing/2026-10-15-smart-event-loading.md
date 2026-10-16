# Discovery V1 Task 2 — smart event loading

Baseline: `37d6246` (PR #18). Scope: two bounded complete viewport snapshots in the existing hook, authoritative end-time cleanup, and non-blocking result feedback. No SQL, migrations, filter semantics, icon assets, budgets or clustering changes.

## Implementation and correctness

The current complete coverage and one previous complete response retain their original request-start-based 60-second expiry. A cache hit does not renew freshness. The two-entry bound prevents exploration from accumulating inventory. Returning to a prior viewport restores its events, rather than treating the current viewport's rows as interchangeable.

A new complete response invalidates an older snapshot if it contradicts any shared event or adds/removes an event in overlapping coverage. Partial/unknown-completeness responses cannot provide reusable coverage. Explicit/foreground/timed refresh, request failure and filter changes invalidate old snapshots. Superseded requests remain aborted and generation-guarded. Camera debounce remains 300 ms.

Known authoritative end times are pruned on receipt, cache restoration, failed refresh and a single next-expiry timer. Timer cleanup runs on changes/unmount. This also reconciles the selected event and chooser, independently of network success. Local expiry never infers cancellation/moderation or ticket availability. Unobserved server changes still follow the existing freshness contract; no client can discover offline revocation without a successful authoritative read.

Feedback distinguishes first-load failure from refresh failure; loading/updating, empty complete responses, and partial/unknown completeness receive a compact live status. Retry remains coalesced. The status occupies the space below the wordmark, leaving zoom controls and the map interactive. No full-screen ordinary-event loader.

## Database investigation — recommendation only

The canonical map function uses the spatial GiST index. Its PL/pgSQL result is materialized before an outer PostgREST row cap; the cap bounds transferred rows, not all database work. Audit repeats measured 20–23 ms / 1.57–1.85 s / 5.12–5.16 s for 9/500/2,000 eligible local rows. In the 2,000-row SELECT the eligibility/spatial filter stage consumed about 5.20 s; sorting about 4 ms. Ticket-price lookup and icon checks were not dominant.

The projection calls `event_is_publicly_eligible` per candidate, which calls `event_has_current_public_eligibility`. Security-definer SQL function boundaries keep the nested eligibility/acceptance work outside the outer query planner's full optimization. A focused 500-row rollback-only diagnostic compared the canonical RPC (1,919 ms) with a read-only SELECT exposing the same eligibility predicates and a statement-level policy-environment check (55 ms). Its plan can build policy-acceptance membership once for the statement instead of repeating that work behind each helper invocation. A separate repeated policy-environment-only probe took 262 ms for 2,000 calls versus 1.4 ms as one InitPlan, so that check alone does not explain the original five seconds.

Smallest proposed server change: optimize this one projection's query shape so eligibility relationships are planned together, retaining the exact same authorization interval, action/revision, policy acceptance or legacy exemption, policy-environment, organizer/disclosure, publication/moderation, end-time and paid-tier checks. Keep existing security-definer ownership/search_path, grants, deterministic order and row cap. Do not globally weaken or replace the shared eligibility helper. Before approval/implementation, prove result equivalence across canonical eligibility/moderation/permission fixtures and 9/500/2,000 cases, including bounded and out-of-view queries, then test limit/count behavior. No speculative new index is justified by the current plans.

Limits: uniform freshly populated local fixtures and transaction statistics are not a hosted SLA. A concurrent 2,000-row fixture-publication setup hit its 90-second diagnostic timeout; the transaction rolled back, and the focused 500-row probe completed. No live load fixtures or migrations were applied, and fixture row count was verified zero afterward. The read-only candidate has not been deployed or accepted as production SQL.

## Filter contract for Task 4 — recommendation only

| Dimension | Discovery list today | Embedded/full map today | Recommended common V1 contract |
|---|---|---|---|
| Date | `upcoming`: now to LA midnight after 30 calendar days; `today`: LA midnight–midnight; `weekend`: current/upcoming Friday–Monday | Rolling now–168 hours, no date preset prop | Default explicitly labeled **Next 7 days**, rolling 168 hours; Today and This weekend use shared server-derived LA calendar boundaries; always exclude ended events |
| Price | Any / free / paid, filtering authoritative admission type | No price parameter/filter | Any / Free / Paid using admission type, never inferred ticket stock or display price |
| Category | One optional category from the eight domain categories | RPC accepts category array; page passes null | One optional category with the same enum and All default; retain backend array capability without adding multi-select UI |
| Geography | Fixed SF Bay Area region, bounded cursor pages | Padded visible bounds, bounded map response | Keep geography explicit: list is Bay Area, map is visible area; shared filters do not promise identical geographic counts |
| URL/cache | Normalized `when`, `category`, `price`; list cache 60 s | No propagation; map key contains bounds/categories | Carry the same normalized filters into embedded/full-map navigation; include every server-affecting filter and stable window identity in map cache keys |

Changing the default list window from 30 days to seven days needs Task 4 approval. This recommendation preserves the map's existing maximum seven-day query protection; it does not propose lifting limits or downloading/filtering capped results in the client. Today/weekend boundaries must remain server-defined and DST-safe. “Paid” does not imply currently available tickets. Eligibility and transaction rules remain server authoritative. No filter wiring changed in Task 2.

## Verification

The initial new regression run failed on A→B→A request count, expiry cleanup/selection and missing feedback, then passed after implementation. Additional coverage verifies two-entry eviction, original TTL, conflicting overlapping edits/removals, incomplete results, explicit refresh/failure invalidation, filter switches, cache expiry and late expired responses. Browser fixtures expose Content-Range through CORS, as the real service does. A visual overlap regression was reproduced with a failing geometry assertion before moving the status away from controls.

Final local verification: `pnpm test --maxWorkers=2` passed 256 files / 2,068 tests; targeted query/page regressions passed 38 tests; `pnpm typecheck`, `pnpm lint`, `pnpm build` passed. All eight desktop/mobile browser cases passed with `WHERETOO_MAP_HARDWARE=1 pnpm exec playwright test --config tests/e2e/map-performance.config.ts`. The pre-existing build chunk-size warning remains. The suite emitted the existing jsdom navigation diagnostic without a failing test; no flaky test required exclusion. Independent code review found no actionable defects. Deployment identity and hosted acceptance are reported with the merged PR. Raw diagnostic JSON, SQL plans and logs remain outside the repository; generated screenshots and fixture inventory are not committed.

### Comparable fixture measurements

The repeatable loading probe runs Chrome at 1280×720 and mobile emulation at 390×844. Rows are identical across baseline/candidate and concentrated in the viewport overlap. Event transport has a controlled 100 ms delay. Full 2,000-row responses bypass the normal server cap for client stress; a separate probe returns 1,000/2,000.

| Fixture | A→B→A requests, desktop/mobile | Return payload avoided | Rapid sequence requests, desktop/mobile |
|---|---|---|---|
| 9 | 3→2 / 3→2 | 4,708 bytes | 1→0 / 1→0 |
| 500 | 3→2 / 3→2 | 263,181 bytes | 1→0 / 1→0 |
| 2,000 | 3→2 / 3→2 | 1,054,048 bytes | 1→0 / 1→1 |

The mobile stress case still issued only one coalesced rapid request; an outstanding response cannot establish reusable coverage before the hook accepts it. The complete sequence, including deliberate error/retry and the stress cap probe, used 7→5 reads for 9/500, 8→6 for desktop 2,000 and 8→7 for mobile 2,000. Slow responses retained every previous marker at the 700 ms observation during a 1,500 ms transport delay.

Initial transport durations remained 101–145 ms before and 101–136 ms after. First rendered events measured baseline/candidate desktop 1.93/1.73 s, 2.11/1.57 s, 2.01/1.59 s; mobile 1.68/1.37 s, 1.84/1.47 s, 1.88/1.52 s. Baseline was hosted and candidate was local; Mapbox/asset cache warmth differs, so these single startup samples do not establish a product startup speedup. The request and transfer reductions are the supported improvement. No FPS or physical-mobile-device claim is made.

Read-only comparison also verifies the new slow-refresh, empty and partial-result feedback. The 300 ms initial/camera delay and 60-second refresh policy remain unchanged. A final regression test prevents an unchanged cache hit from incrementing the applied revision or reapplying selection/chooser state, preserving Task 1 render suppression.
