# Event Preview Polish Implementation Plan

> Execute inline using executing-plans and TDD. Founder approved implementation, merge and staging deployment; no further design approval required.

Goal: compact previews expose title, date/time, admission and venue under normal portrait conditions without compromising map context.
Architecture: retain shared EventPreviewCard, authoritative single-selected-event query, canonical artwork resolver, router and container-aware overlays. Change presentation/formatting only.
Spec: founder-approved Task 7 implementation request, 2026-10-17; preceding Task 7 audit.

Constraints: preserve nine icons, map sources/listeners/cache/clustering/filters/navigation, Task 5 focus/scroll/safe-area contracts. No payment/SQL/dependency changes. Task 6B untouched. Staging only, no extra preview deployments or public-production changes.

Review focus: embedded 300px map height; long title/venue and multiline local dates; landscape vs portrait artwork without cropping; unknown/refetch vs sold-out and unavailable; keyboard/focus and preserved bounded request counts.

- [x] Write failing compact-date and checking/refetch state regressions; retain authoritative minimum-tier pricing and error/unknown coverage.
- [x] Add renderer assertions for visible essential text, contained artwork, minimum targets and smaller landscape footprint. Confirm failure before layout edits.
- [x] Implement compact summary, contain-fit portrait artwork, quiet accessible Back, bounded footer and responsive landscape styles.
- [x] Run targeted and full application tests, relevant map journeys, typecheck/lint/build; independent whole-diff review. Inspect actual screenshots and resolve regressions.
- [ ] PR through existing GitHub workflow, staging-only deployment, hosted safe-response-fixture checks and identity proof. Report limitations and stop on significant regression.

Execution ledger: baseline fetched origin/main 80c451d; clean isolated worktree on codex/event-preview-polish. Audit-only fixture servers stopped before execution. No changes to Task 6B.

Implementation ledger:
- Compact date and explicit checking/refetch regressions: five failures before repair; targeted 44 tests pass afterward. Cross-year events keep both years; timezone and overnight distinction preserved.
- Renderer regression: original portrait facts hidden and original image object-fit cover both fail. Preview now uses existing canonical image with contain-fit portrait frame, compact summary and one-row action footer.
- Shared map, requests, caches, renderer, icon artwork/budgets, filters and event URL handlers remain unchanged. The only per-selection paid projection remains the existing authoritative query.
- Narrow-layout failures found and fixed locally: preserve full chooser scroll space; constrain tiny footer grid row and put disabled explanation on its own scrollable row. Added executable browser regression reproduced 8px controls before repair. Existing dynamic-height tests were retained rather than weakened.
- Full application suite: 263 files / 2,118 tests passed. Initial type error in new test tuple fixed; typecheck/lint/build passed. Final fresh commands and hosted proof recorded in delivery report.
- Independent whole-diff review: one P2 tiny disabled-footer issue; fixed and re-reviewed with no remaining blockers. Reviewer verified 80/140/172px map heights and bounded explanation scrolling.

- Final overnight regression: 320px embedded facts initially failed with repeated weekdays. Compact Intl date ranges now retain both local dates/months/years and avoid redundant weekdays; new same-month, cross-month and cross-year unit expectations were verified red before repair.

Release verification before PR: 263 application files / 2,119 tests passed with four workers; typecheck, lint and build passed. An unrestricted concurrent run had one unrelated scanner lazy-import 1s timeout, which passed isolated and in the full controlled-worker run; assertions and timeouts unchanged. All nine overnight renderer projects passed. Earlier full responsive suite: 25 passed, two expected desktop skips. Earlier journey suite: 18 passed, four expected skips, plus four added availability/photo cases passed. Independent final formatter review found no blockers. Existing bundle-size warning remains. Physical-device testing remains unverified. Hosted release checks follow merge.
