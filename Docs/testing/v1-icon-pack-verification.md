# Prepared V1 map icon pack verification

Date: 2026-10-14

## Result and scope

Nine prepared icons were installed and published in the isolated local `wheretoo-map-integration-20261007` stack at API 64321 / DB 64322. No hosted data or configuration was modified. No new migration, schema change, dependency, or application-bundled raster asset was added.

Changed files: package.json; scripts/map-icons/import-v1-pack.ts; scripts/map-icons/import-v1-pack.test.ts; scripts/map-icons/v1-pack.json; scripts/map-icons/V1-PACK.md; this report.

## Verification

- All nine upstream source hashes, runtime hashes, dimensions and byte sizes match the approved archive/manifest; all runtime PNGs decode successfully.
- New importer tests: 3 passing. Full suite: 252 files, 1,998 tests passing. Existing jsdom navigation diagnostic remains non-failing.
- Typecheck, lint, production build and whitespace checks passed. Existing large Mapbox chunk build warning remains.
- Real Storage/catalog import published all nine. Repeating the import returned the same version IDs and left the total version count unchanged at 11 (two prior versions plus nine new versions).
- All nine new version IDs appear in the selectable catalog. Public Storage bytes, content type, CORS and one-year cache headers verified during import.
- Nine explicitly labeled LOCAL ICON PROOF events saved and published through normal authenticated RPCs. Each public map projection returned the assigned version. These are local-only fixtures, not real events or production data.
- Real desktop browser: all nine icons rendered together over Mapbox tiles; clicking DJ & Music opened its correct event preview.
- Organizer editor: all nine radio choices appeared; all images loaded at their expected native dimensions. Existing Grand Opening choice remained available.
- Mobile: 390px viewport / 390px document, no horizontal overflow; icon rendering and Community & Festival selection verified. The existing eight-active-version mobile budget uses a normal marker for a ninth simultaneous type; selection prioritizes its custom artwork. Performance budgets were not increased.
- Independent code review found no actionable correctness issue.

Local visual evidence, outside Git: /tmp/wheretoo-icon-pack-proof/desktop-map.png, desktop-selected.png, organizer-picker.png, mobile-map.png, mobile-selected.png. Credentials and generated local fixture IDs remain in ignored .superpowers/icon-pack only.

## Hosted blocker and manual rollout

Anonymous read-only staging preflight for `get_public_map_icon_versions(p_ids)` returned HTTP 404 / PGRST202: the icon-library API is absent in the hosted schema. PR #13's existing map-library migrations and reviewed rollout are a prerequisite. This pack must not be represented as installed on staging until that prerequisite and a reviewed hosted curator import are completed. This new helper intentionally accepts only the existing isolated loopback APIs.

The original and prepared ZIPs remain unchanged in Downloads. See scripts/map-icons/V1-PACK.md for exact provenance, commands, credential handling and rollback boundaries.
