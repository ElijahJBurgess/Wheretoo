# Discovery Redesign V1 Implementation Plan

> Use superpowers:executing-plans inline, then one fresh independent final reviewer. Founder delegates implementation without intermediate approval and prohibits commits.

**Goal:** Deliver reference-derived cinematic discovery over existing contracts.
**Architecture:** Presentation-only changes to DiscoveryView/presentation/CSS with supplied bridge asset; DiscoveryPage keeps query/API/public image authority intact and extends bounded public scroll restoration for the new mobile carousel. Map explicitly deferred by founder.
**Tech Stack:** Existing React/TypeScript/CSS, native selects, Vitest/Playwright.
**Spec:** Docs/specs/2026-09-29-discovery-redesign-v1.md.

## Global Constraints

No commit/push/merge/deploy, hosted writes, provider calls, payment/backend/schema changes or migrations. No map implementation. Existing canonical filters/cursors/navigation/eligibility unchanged; no new dependencies. Supplied clean asset only, not screenshot UI.

## Review Focus

- Unknown admission with artwork must not imply open tickets or fabricated prices.
- Pagination/appended artwork must not displace first-page feature or lose/duplicate rows.
- Failed images and later refreshed URLs recover without broken-image icons.
- Shortcuts/selects preserve canonical return-state and cache behavior.
- Long titles/200% text/mobile controls must not overflow or hide reachable links.

## Task 1: Truthful presentation and controls

Files: discovery.presentation.ts/test; DiscoveryView.tsx/test; DiscoveryPage.test; DiscoveryPreview.test.
Interfaces: selectDiscoveryHighlight(readonly DiscoveryDisplayItem[]) returns first artwork result else first result else null. Existing DiscoveryViewProps preserved; filters use existing onFiltersChange(DiscoveryFilters), canonical serialization for shortcuts. No API/types change.
- [x] Write failing tests: unknown-art first choice, missing-art fallback, first-page stability, native selects/all categories, real shortcut URLs, exact headline, no unsupported controls.
- [x] Run focused tests RED; implement selection, native filters, feature/cards/shortcuts, safe existing states and anchor.
- [x] Adapt existing interaction tests to new labelled selects and Feature text; preserve all navigation/availability assertions. Run focused Discovery/preview tests GREEN.

## Task 2: Visual composition and asset

Files: discovery.css; assets/bay-bridge-night.jpg; Docs asset attribution/spec. Existing obsolete SVG may remain if referenced elsewhere; remove only if unused.
Interfaces: existing/new discovery class names, production DiscoveryView rendered by preview and browser. Asset import with intrinsic2103×748 dimensions.
- [x] Integrate clean compressed asset; establish token palette, serif headline, rich feature and poster row,4shortcuts and matching skeletons.
- [x] Responsive390/768/1440, contained carousel,44px controls, focus/reduced-motion and honest empty/error states.
- [x] Inspect real browser screenshots and refine visual issues; no changes to backend contracts.

## Task 3: Build + Prove

Files: playwright.discovery-redesign.config.ts; tests/e2e/discovery-redesign.spec.ts; Docs/testing/2026-09-29-discovery-redesign-v1.md; preview artifact if render contracts require update.
- [x] Inject public discovery/image responses only on local dev; block external requests. Test artwork/fallback/empty/error/retry/loading/free/weekend/pagination/event-return at390/1440; inspect screenshots and geometry.
- [x] Run pnpm typecheck/lint/test/build/typecheck:functions/test:functions; report baseline failures separately, no invented SQL proof.
- [x] Fresh final reviewer on most capable model, read-only diff/untracked inventory; fix material findings RED→GREEN and final suite.
- [x] Final scope/diff/secret check; record32requested fields including founder-deferred map; leave uncommitted and STOP.

Self-review: each visual feature belongs to existing data; no map dependency. Task1 markup feeds Task2 selectors and Task3 browser locators. No shared backend or payment writes.
