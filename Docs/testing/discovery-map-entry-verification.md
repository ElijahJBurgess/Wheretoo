# Discovery map entry verification

Date: 2026-10-14

## Scope

Add a live map preview above discovery results and an Explore the map link to the full /map route. Add Map to the public header. Preserve the current discovery page and organizer navigation. Base: d58a340, the existing map integration in PR #13.

## Changed files

- src/features/discovery/DiscoveryView.tsx: front-page entry and header link; remove obsolete map placeholder.
- src/features/discovery/DiscoveryMapPreview.tsx: lazy loading and local failure boundary.
- src/features/discovery/discovery.css: preview layout, desktop and mobile sizing.
- src/features/discovery/DiscoveryView.test.tsx: navigation across loading, empty, and error states; map failure containment.
- src/map/LivingMapPage.tsx: optional embedded mode uses a section instead of nesting main landmarks.

## Verification

- Observed navigation regression fail before implementation and pass afterward.
- Observed map-failure regression fail before the local boundary and pass afterward.
- Browser: real Mapbox tiles render at desktop 1280px and mobile 390px. Embedded height is 360px / 300px. Mobile document width is 390px with no horizontal overflow. Explore the map navigates to /map.
- Review: the map failure boundary finding was fixed and reviewed again; no unresolved findings.
- Final checks: pnpm typecheck, pnpm build, and pnpm lint passed. pnpm test --maxWorkers=8 passed 1,995 tests across 251 files. Build reports the existing large Mapbox chunk warning.

## Limits and rollout

No new migrations or infrastructure changes in this change. It depends on PR #13 for the existing map route, map subsystem, and five previously authored integration migrations. Merge and enable that dependency through its documented rollout before deploying this entry point.

The hosted discovery endpoint rejects Origin http://127.0.0.1:3107 with HTTP 403 and no Access-Control-Allow-Origin header. This explains the local event-list error. Real event selection through this new preview was not verified against hosted staging. Staging was not modified. No fake events were added.

Desktop/mobile screenshots are local, outside Git at /tmp/wheretoo-map-entry-proof/. Public environment configuration is ignored; no credentials or generated binaries are committed.
