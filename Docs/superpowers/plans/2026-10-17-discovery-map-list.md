# Discovery Map/List Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved plan inline. Steps use checkbox syntax for tracking.

**Goal:** Switch Discovery between Map (default) and List without losing context or creating redundant background work.
**Architecture:** Keep the existing map mounted at stable dimensions inside an inert, invisible inactive panel. Reuse existing query caches, filters, result cards, pagination and bounded navigation hints. Display mode is URL/navigation state only; the active view owns periodic freshness.
**Tech Stack:** React, TypeScript, React Router, TanStack Query, Mapbox, Vite.
**Spec:** Founder-approved Task 9 implementation in this conversation; current product/flow/architecture documents and Tasks 1–8 remain authoritative.

## Global Constraints
- Preserve `/map`, filters, geography, selection, icons, clustering and navigation contracts.
- Preserve 300 ms debounce, two coverage snapshots, 60-second freshness and icon resource limits.
- No payment, RSVP, SQL, backend, dependency or Task 6B changes.
- Only deploy the existing staging project; no extra previews or public production changes.

## Review Focus
- Hidden-map orientation/resize must not silently change List geographic membership.
- Hidden selected previews must not poll or steal focus when resumed.
- Expired snapshots and icon leases must never gain freshness from switching.
- Direct List links and broaden-area must establish a bounded area without hidden event downloads.
- Pagination/scroll restoration must yield to buyer interaction and never replay repeatedly.

### Task 1: URL and navigation contract
**Files:** discovery.navigation.ts/tests, mapNavigation.ts/tests, DiscoveryPage.tsx/tests, LivingMapPage.tsx.
**Interfaces:** `DiscoveryMode = 'map' | 'list'`, `discoveryMode(search)`, `discoverySearch(filters, mode)`; bounded per-mode scroll hints in existing public return state.
- [x] Add failing canonical URL/return-state regressions for `view=list`, legacy filters, invalid mode and safe return paths.
- [x] Implement shared display URL helpers without changing filter serialization or query keys.
- [x] Add mode switching/history and one-shot per-view scroll restoration to DiscoveryPage; preserve filters on filter/shortcut navigation.
- [x] Verify focused navigation tests.

### Task 2: View presentation and lifecycle
**Files:** DiscoveryView.tsx/tests, discovery.css, DiscoveryPage.tsx/tests, LivingMapPage.tsx/tests, WheretooMap.tsx/tests, mapEvents.query.ts/tests, discovery.queries.ts/tests.
**Interfaces:** optional `active` map prop (default true); optional query activity flags; existing map handle retains area/context publication while network inactive.
- [x] Add failing regressions for toggle semantics, inert inactive panels, same mounted map, fresh resume, stale resume, hidden preview reads and active-list freshness.
- [x] Add compact keyboard-accessible mode controls, stable hidden map panel, desktop grid and mobile vertical cards. Reuse existing loading/error/empty/pagination components.
- [x] Separate area publication from map inventory fetching. Pause map event/icon refreshes and preview observers when inactive; retain local expiry and hard icon leases. Reuse fresh manifest on resume.
- [x] Give active List the existing 60-second freshness cadence without putting mode in query keys or issuing overlapping reads; preserve rate-limit protections.
- [x] Verify focused map/discovery unit suites and baseline behavior.

### Task 3: Browser, release and review
**Files:** tests/e2e/discovery-map-list.spec.ts/config; scoped testing evidence document.
- [x] Add renderer regressions for desktop/touch mobile, 9/500/2000 fixtures, same canvas/camera/selection, URL/Back/event return, pagination/scroll, hidden accessibility, rapid filters, stale/error recovery and request/source/icon counts.
- [x] Run local canonical browser harness, inspect screenshots and fix confirmed regressions.
- [x] Run full application tests, relevant Edge tests, typecheck, lint and build. Review actual diff independently before release.
- [ ] Open scoped PR, attach it, wait required GitHub checks, merge through existing workflow and deploy only verified staging project.
- [ ] Verify hosted desktop/mobile journeys and deployed artifact identity. Report evidence and limitations; do not start Task 10.
