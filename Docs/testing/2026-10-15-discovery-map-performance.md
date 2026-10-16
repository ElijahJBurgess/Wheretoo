# Discovery V1 Task 1 — map performance

Baseline: fetched `origin/main` at `38a865584a6ca326e8f0cc538bbe3879c9efaece` (PRs #13–#17 included), matching the verified staging deployment. Implementation uses an isolated managed worktree and the existing Mapbox/React/PostgREST architecture. No migrations, dependencies, artwork, sizing, palette, clustering architecture, transaction rules or staging data changes.

## Changes

- Coalesce in-flight and paired foreground event/descriptor refreshes. Hidden notifications do not consume the visible foreground debounce window. Preserve cancellation, late-result guards, explicit retry, descriptor renewal and hard expiry.
- Request PostgREST's exact count. Reuse a fresh successful padded viewport only with complete `Content-Range` proof, matching filters and unexpired original TTL. Unknown/truncated results fetch again. Live staging confirmed `0-8/9`; previous responses supplied `0-8/*`.
- Retain unchanged canonical event-array identity and skip equal GeoJSON source payloads. Source snapshots use weak keys, so replacements/reloads do not inherit a removed source's cache. Genuine field, geometry, removal and selection changes still update.
- Rank one candidate per icon version with linear event scanning, cache rankings until relevant inputs change, and prefer visible residents over distance-only eviction. Selected and newly visible versions retain priority. Existing 16/8 resident limits, 64/32MiB decoded/reserved budgets, four concurrent loads, leases, retries and generic fallback remain.

Independent review found one hidden→visible debounce edge case. A new test reproduced it, the visibility guard fixed it, and follow-up review reported no remaining actionable production issue.

## Comparable measurements

Production builds of baseline and candidate used identical public Mapbox/Supabase configuration, served locally on 3113/3114. Installed Chrome 155 used hardware Intel/AMD GPU devices (not the initial SwiftShader audit environment). Desktop 1280×720 and mobile/touch emulation 390×844, DPR 1, normal motion. Same deterministic Oakland event grid and nine immutable icon assignments; browser-only responses had a 100ms artificial event delay and explicit complete range. No synthetic event was persisted.

The sequence is four 800ms camera transitions with 600ms rests, identical moveend notifications, paired focus/visibility notifications, then a cluster probe. Each table entry is one completed short sequence, not a statistically broad population estimate. One desktop-500 pair was repeated without overlap with a short regression-test run. Main-thread rAF intervals are not GPU presentation or physical-phone FPS.

| Fixture | Desktop p95 frame interval, before → after | Mobile p95, before → after |
|---|---:|---:|
| 9 events | 33.7 → 33.3ms | 18.0 → 18.0ms |
| 500 events | 99.0 → 49.3ms | 82.8 → 18.6ms |
| 2,000 stress | 99.9 → 50.5ms | 82.8 → 34.8ms |

Median frame intervals stayed near 16.7ms (mobile stress 17.4 → 16.8ms). The 2,000-event case exceeds the checked-in API's 1,000-row setting; it intentionally tests renderer stress rather than present staging inventory. Stress tails remain above a 60Hz frame budget; this is an improvement, not a claim of universal 60FPS.

| Per complete sequence | Before | Candidate desktop | Candidate mobile |
|---|---:|---:|---:|
| Event requests, including initial/foreground/cluster | 8 | 3 | 4 |
| Event requests during four camera moves | 4 | 0 | 1 |
| Descriptor requests, including initial/foreground | 3 | 2 | 2 |
| Redundant source writes after instrumentation | 12 | 0 | 0 |
| React root commits during camera sequence | 16 | 8 | 10 |

Source-write counts exclude initial source creation and apply to unchanged fixture content. Changed data/selection updates are covered separately by tests. Mobile image removals/registrations during camera motion fell from 23/23 to 0/0 at 500 events and 30/30 to 0/0 at 2,000. The 9-event and desktop fixtures already had zero churn. Mobile icon-reconcile p95 fell from 19.3 → 0.4ms at 500 and 23.2 → 0.5ms at 2,000. Every completed case retained one canvas and no horizontal overflow.

Renderer-ready observations for the fixture runs ranged approximately 0.97–1.19s before and 1.07–1.28s after; these single observations vary with assets/GPU/network startup and do not establish a repeatable startup regression or gain. The earlier audit's unexplained 9s cold observation remains unproven, not declared fixed.

Live anonymous read sample: baseline 112–507ms across seven completed reads; candidate 185–301ms across three. Different request counts/cache state and small samples prevent a statistical latency conclusion; no clear exact-count latency regression was observed. Fixture delay timings are not backend timings.

Non-GC heap snapshots varied, so separate 2,000-event probes forced GC before/after. Post-sequence used JS heap: desktop 33.1 → 32.6MiB; mobile 30.3 → 26.7MiB. Desktop decoded artwork was 32,016,784 bytes with nine versions. Candidate mobile retained eight versions / 27,982,072 decoded bytes, zero reserved bytes and zero active requests, below its 32MiB limit. JS heap excludes GPU/worker allocations; short probes do not certify long-session leak freedom.

Reproduction: `scripts/map-performance/README.md` and `measure.cjs`. Private raw data/logs are under `/tmp/wheretoo-map-audit`, including `comparison.json`, before/after fixture and live files, and forced-GC resource files. `MAP_PERFORMANCE_GC=1` normalizes the resource probes; do not mix their frame samples into the primary table. Raw seeds, credentials, screenshots and generated builds are not committed.

## Verification

- Full Vitest: 256 files / 2,053 tests passed with two workers. No candidate-suite failures. The audit baseline's unrelated five-second email-render timeout passed in isolation, and passed in this full candidate run; no test was relaxed.
- Focused map/icon suite: 31 files / 188 tests passed. Regression coverage includes duplicate foregrounds, hidden→visible, TTL, incomplete/unknown/empty ranges, filters, unchanged identity, real edits/removals, late uncovered responses after cached return, replacement sources, mobile residency/selected ninth priority and byte budget. Existing style/lease/disposal tests remain green.
- Typecheck, lint, production build and E2E TypeScript checks passed. Build retains the existing large-chunk warning.
- New local production-browser acceptance: 4/4 passed (desktop/mobile). All nine desktop images; eight mobile images and selected fallback priority; preview selection; cluster expansion; one mounted canvas; dark config/no overflow; failed refresh retaining markers and successful retry. Desktop-ready and mobile-selected screenshots were opened and inspected.
- Existing local startup/error suite: 8/8 passed, including delayed readiness, retry, reduced motion and recoverable resource errors. Hosted post-merge acceptance and release identity are reported in the task delivery follow-up.

No manual provider setup or database migration is required. Staging deployment uses the existing GitHub PR/main workflow and existing staging alias; no additional hosted environment or configuration is introduced. Task 2 is not included.
