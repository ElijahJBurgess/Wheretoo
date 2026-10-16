# Discovery V1 Task 4 — unified filters verification

> **Release blocked.** PR #22 is merged (`7dd5086`), but the staging alias is restored to Task3 deployment `dpl_6eWc4vgo5AWs7QyUJNbJVQVgYy7e` (`dd9c0bf`). The additive SQL migration and discovery Edge version6 remain applied and backward compatible. PR #23 is unmerged. Do not deploy main or begin Task5 until the icon-bearing renderer defect below is resolved.

Baseline: `dd9c0bf8aa752f6b2185f29fdd967240627bda70` (PR #21). Scope is Discovery, embedded/standalone map, and viewport list. No Task 5 work, event inventory writes to staging, or transaction changes.

## Contract and implementation

- Default `next7`: server statement time through exactly 168 hours later. Today and This Weekend retain Bay Area / America/Los_Angeles calendar boundaries; Weekend remains Friday 00:00 through Monday 00:00. At Monday midnight it resolves the following weekend.
- Explicit legacy `when=upcoming` links retain the original local-midnight 30-day window and display **Next 30 Days** in the date control. It is shown when that legacy preset is active; fresh navigation exposes the three V1 presets.
- Existing eight categories and authoritative `admission_type` drive native, labelled controls. Clear restores Next 7 Days / Any / Any without moving the camera. Consecutive changes compose the changed dimension against the latest submitted selection, including while Router props are catching up.
- The settled viewport, clamped to the existing service bounds and rounded outward to six decimals, scopes **Events in this area**. The map retains its existing small query padding for coverage reuse. List pages and cursors are keyed to the exact active area. Initial list reads wait for a known area; map startup failure explicitly falls back to labelled Bay Area results.
- Zoom out broadens the current map area using existing camera controls and zoom limits. Filters stay selected. Individual filter changes never scroll the document. Actual event return and history POP restore camera, eligible selection/chooser, area and scroll through the existing Router state, including when the map remains mounted.
- Filter transitions mask prior-filter rows and previews. Existing two-snapshot viewport caching, 60-second freshness, foreground coalescing, 300 ms camera settle, bounded image controller and clustering remain. Date rollover refreshes at the earlier midnight deadline; a failed rollover cannot present the prior weekend as the new weekend.

## SQL and rollback

Migration `20261016020000_unify_discovery_filters.sql` adds the filtered map RPC, extends the shared date-window resolver, validates optional viewport bounds on the service-only list RPC, and binds scoped cursors to those bounds. Unscoped legacy requests/cursors retain version 1; scoped cursors use version 2. The list encodes only its outgoing cursor, avoiding per-row bounds encoding overhead.

The new map RPC keeps the existing 16 event columns and sends small authoritative date/clock metadata in an exposed response header, including for empty results. PostgREST retains its normal row cap. Both filtered endpoints use exact geometry rectangle membership, fixing the prior geography-edge discrepancy. The existing raw-window map RPC and canonical Task 2.5 inline eligibility function are unchanged. No tables, indexes, RLS policies, checkout or publishing rules change.

The migration checks the expected existing list, date resolver, raw map, and inline eligibility definitions before changing anything. An isolated PostgreSQL database was cloned without the unrelated cron scheduler. Apply followed by transactional rollback restored **all public/private function definitions, owners and ACLs exactly**; final application then passed SQL tests. All fixtures use transactions that roll back; final checks found zero fixture events/users. The isolated REST cap probe was dropped after testing.

Frontend rollback remains compatible with the new backend: legacy list requests and the raw map RPC still work. If SQL rollback is required, restore the previous date/list definitions from main before this migration, then drop the new filtered RPC and private bounds resolver. Do not reverse database state before an older frontend is serving. No table data rollback is necessary. Deploy backend/Edge support before the frontend to avoid a missing-RPC interval.

## Query measurements

Local isolated database, correctly published policy-accepted fixtures, 9 / 500 / 2,000 events; first warm-up excluded, median of five subsequent runs. Map timings read the complete SQL result; list timings use a bounded 50-row page. Before uses the Task 2.5 main implementation. The same day-one fixtures match Next 7 Days and legacy 30 Days, enabling exact comparisons. These are database timings, not network/Supabase service latency.

| Events | Map before | Map Next 7 | Map legacy 30 | List before | List Next 7 | List legacy 30 |
|---:|---:|---:|---:|---:|---:|---:|
| 9 | 6.773 ms | 1.082 ms | 1.035 ms | 6.030 ms | 1.600 ms | 1.212 ms |
| 500 | 38.151 ms | 15.736 ms | 21.347 ms | 19.744 ms | 15.891 ms | 16.001 ms |
| 2,000 | 77.950 ms | 52.300 ms | 52.687 ms | 47.944 ms | 49.323 ms | 45.949 ms |

The 2,000-event Next 7 list difference is approximately 1.4 ms (2.9%); no scalar eligibility regression appeared. Nested plans retain set-based eligibility: the measured full map emits 2,000 rows and the 20-row list query reads its 21-row lookahead. The inherited approximately 1.9-second / 500-event scalar-query bottleneck is not reintroduced. Fixture publication itself is slower than discovery and was excluded from query timing; an initial setup timeout was rerun with an appropriate isolated setup budget.

All ordered IDs matched across complete paginated list and map results for both Next 7 and legacy 30 at all three scales. Separate SQL tests cover all four date presets × nine category states × three admission states, plus edge/cursor/state cases. Browser tests preserve the 1,000-marker cap while list pagination remains bounded at 20 rows by default (server maximum 50). Padding and the cap can legitimately make the displayed map a subset of the full paginated list.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build`: pass. Existing large-bundle warning remains.
- Full application suite: **260 files / 2,095 tests pass**, `pnpm test --maxWorkers=2 --testTimeout=15000`. Initial run at the default timeout had three failures in unchanged authentication/refund tests; both files passed alone (55 tests). The final full run passed with a larger test timeout; no production code or assertions in those unrelated files changed.
- Additional list midnight-failure regression and map midnight/expiry regressions: **38 hook tests pass**, including the new list test added after the full run began.
- Edge functions: **433 tests pass**, including 16 public-discovery contracts.
- SQL: **133 unified-filter checks**, **32 eligibility suite assertions covering 78 adversarial scenarios**, and **6 permission checks** pass. The eligibility suite also compares every event field from the additive map projection using the same statement-time window.
- Browser desktop/mobile: **8 unified-filter cases**, **10 map-to-event/paid/RSVP/history cases**, **8 icon/cluster/resource/loading/cache cases** pass. The approved nine icon versions remain; mobile retains its existing eight-image budget and fallback/selection priority.
- Local REST: empty map response preserves authoritative date metadata and browser header exposure; a 2,000-row probe returns exactly `0-999/2000` (1,000 rows). No bypass through a JSON aggregate.
- Independent branch review found same-route POP, delayed-response scrolling and midnight refresh issues; all three received failing regression coverage and fixes. No deferred findings or additional security/eligibility mismatch.

Scale browser fixtures are response interception only; they never upload inventory or create tickets/RSVPs. Before/after frame sampling uses the same public icon assets, camera motion and 9/500/2,000 fixtures; wait for the complete desktop/mobile icon budget before measuring. With all icons settled, desktop median frame intervals before/after were 16.7/16.7, 16.6/16.6 and 16.7/16.6 ms for 9/500/2,000 events; mobile was 16.7/16.6, 16.6/16.7 and 16.7/16.7 ms. P95 stayed within 18.0–19.0 ms; source updates and image additions/removals during camera motion were zero in every sample. Initial map and list each issued one request. Initial local dev-bundle latency is not directly comparable with the hosted production bundle. Hosted production smoke and final deployment identifiers are recorded in the PR after release.

## Remaining limits

Today/Weekend remain explicitly Bay Area calendar dates; this is not a multi-timezone product expansion. Map results retain the existing PostgREST cap, list pagination and query padding. Freshness remains bounded rather than real-time cancellation push. There is no new background polling system, cache, library, or additional Vercel preview project.

## Hosted verification follow-up

Release checks found two issues: the new mobile empty-state action squeezed the feedback into narrow wrapping, and a restored selected preview could repeat its prior camera-fit pan. Empty feedback/action now stack within the existing status card. Returning to the same normalized viewport remembers the eligible preview without another pan; changed viewports and later resize keep normal fitting. A controller regression verifies the initial no-pan and subsequent resize remeasure, and the browser retains its original strict center/zoom assertions with stable-frame capture. Three consecutive mobile return cases passed locally after the fix. No SQL or Edge changes are needed for this follow-up.

## Confirmed release blocker: icon-bearing inventory to empty

The final browser regression first confirms that event features are actually rendered, then replaces the authoritative inventory with an empty response and inspects visible event layers, excluding transparent hit-only layers. **Both desktop and mobile fail:** source serialization has0features while27visible layer features remain after a5-second wait. These correspond to nine old markers across tail/circle/glyph layers. The empty feedback is already visible. The failure is reproducible with the existing approved icon-version fixture; no icon artwork or sizing was changed.

An earlier control with icon version IDs removed cleared within1.1–9.7ms on Task4 (baseline1.2–21.3ms). That control was not representative of the approved icon lifecycle and did not establish correctness with icons enabled. It is not yet determined whether the icon-bearing defect predates Task4. The next investigation should isolate icon-controller layer/image removal and source-update ordering, preserving clustering, eligibility and budgets. No workaround or further release was attempted after confirming this accuracy blocker.

Final application run:260files/2,097tests pass; focused Discovery/map240tests pass; all433Edge tests and171SQL assertions pass. Typecheck/lint/build pass. Earlier26browser-case passes used weaker input/count assertions. The stronger final resource/loading suite is **6 passed /2 failed**, one failure per device profile. Camera/mobile follow-up fixes passed local coverage, including three consecutive mobile return cases at the original center tolerance, but remain in unmerged PR23.

The staging frontend alias rollback was verified both in Vercel and through the browser (previous default `upcoming`, map ready). Backend migration20261016020000 and Edge version6 remain installed;17hosted API/security/legacy checks passed. SQL fixtures left zero users/events and the disposable database/REST container were removed. Public production was untouched. Main still contains PR22: a later main deployment would reintroduce its frontend until this blocker is fixed or that change is reverted.
