# Map performance measurements

Run from the repository root with the existing Playwright dependency and installed Chrome. This uses a separate hardware-backed browser, not the user's Chrome session. Do not run builds/tests or another benchmark concurrently. Mobile is viewport/touch emulation on the same computer, not physical-phone certification.

Accepted targets: local production builds on ports 3113 and 3114, or the existing staging alias. The script allows only the two anonymous map RPCs through its REST interception. Fixture responses are browser-local; no events, icons or staging settings are written. Do not point this at public production.

Capture the canonical public response into a private scratch seed (never commit it):

```sh
LIVE=1 MAP_PERFORMANCE_URL=https://wheretoo-staging.vercel.app \
MAP_PERFORMANCE_SEED=/tmp/map-performance-seed.json \
MAP_PERFORMANCE_OUTPUT=/tmp/map-live.json \
node scripts/map-performance/measure.cjs
```

Serve baseline and candidate production builds on 3113 and 3114 using the same public Mapbox/Supabase configuration. Run the same command for each target, `COUNT=9`, `500`, `2000`, and `MOBILE=0`/`1`, with distinct output files:

```sh
MAP_PERFORMANCE_URL=http://127.0.0.1:3114 \
MAP_PERFORMANCE_SEED=/tmp/map-performance-seed.json \
MAP_PERFORMANCE_OUTPUT=/tmp/map-candidate-mobile-500.json \
COUNT=500 MOBILE=1 node scripts/map-performance/measure.cjs
```

Fixtures cycle seed icon assignments through a deterministic Oakland grid with non-production IDs/titles and a 100ms artificial event-response delay. They supply an exact complete Content-Range; unit tests separately cover missing/truncated counts. The 2,000-event case intentionally exceeds the checked-in API's 1,000-row setting and is a renderer stress test. Fixture network timings do not measure backend performance. `LIVE=1` uses actual anonymous reads instead.

Outputs include rAF frame intervals, React root commits, source setData/source-ready observations, image registration/removal calls, request phases/counts, cluster callback timing and CDP JS heap metrics. Source updates include separate start/done records; count records with `t` for actual setData calls. Restrict image counts to interactionStart/interactionEnd for camera churn. Frame p95 is calculated within one short sequence, not across a statistically representative population. JS heap excludes GPU/worker/bitmap allocations and is not GC-normalized. The read-only React-fiber map lookup follows the existing map integration test harness; it is not production instrumentation.

The sequence is four 800ms camera transitions with 600ms rests, unchanged-viewport notifications, paired focus/visibility notifications, and a cluster callback probe. The script deliberately preserves real map geography, artwork, clustering and resource budgets. Browser error/delay/selection acceptance belongs to the existing map browser suites and the task's hosted verification, not this timing harness alone.

For a separate resource probe, set `MAP_PERFORMANCE_GC=1` to force GC before/after the sequence. Output also records hardware devices and the icon controller's resident/decoded/reserved/active counts. Do not substitute these frame samples for the main comparison. Repeated long-session leak analysis and physical-device tests remain separate work.

Read-only behavior acceptance (requires the nine existing staging icon test listings): run `pnpm exec playwright test --config tests/e2e/map-performance.config.ts` against the local candidate on 3114, or set `WHERETOO_MAP_PERFORMANCE_BASE_URL=https://wheretoo-staging.vercel.app` after deployment. It exercises actual anonymous inventory/images, mobile fallback selection, cluster expansion and refresh failure/retry without creating or editing records.
