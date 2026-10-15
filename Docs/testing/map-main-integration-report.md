# Living Map / Current Main integration verification

## Scope and provenance

- Integration branch: `codex/wheretoo-map-integration`.
- Main base: `4e61e616bc29f7000211fc8f3ff7bccfe96bc5c8`.
- Historical map source: `612d0168328b6f52bb9733c1897b20a9574874de`; its branch, tracked tree and eight protected untracked files remain unchanged.
- No hosted database, push, merge, deployment or production enablement.
- Map-side migrations were explicitly confirmed local-only. Existing main migrations were not renamed or edited.

## Migration reconciliation

| Historical map version | Integration version | Purpose |
| --- | --- | --- |
| 20260924010000 | 20261007010000 | Private catalog, immutable versions, approval/read contracts, disabled defaults |
| 20260924010100 | 20261007010100 | Storage guards |
| 20260929010000 | 20261007010200 | Atomic owned draft assignment |
| 20260929010100 | 20261007010300 | Icon-aware lower lifecycle operations and public map projection |
| New integration guard | 20261007010400 | Reserve /map without silently shadowing an existing storefront handle |

All 143 main migration files were byte-compared to the base. The isolated combined environment was provisioned from empty on API 64321 / DB 64322, initially applying 143 main plus four map migrations, followed by the route guard. A separate isolated exact-main baseline on API 65321 / DB 65322 was also built from empty; after baseline comparison, all five integration migrations applied successfully. Both now have the complete 148-migration chain. No existing unrelated stack was reset.

## Preserved contracts

- Current-main public context-token, locking, history and notice wrappers remain in place. Icon-aware behavior lives beneath them; internal writers are not directly granted to organizer/public roles.
- A mixed content/icon edit performs one strongest invalidation. Null icons remain compatible with existing events and moderation digests.
- Draft saves use the owned atomic RPC and stable retry intent. The legacy admission-only writer does not acquire icon-edit authority.
- Public map inventory remains exclusively `get_public_map_events`. Selected artwork resolves through main's `list_event_images` and guarded `event-images` endpoint, not raw storage paths.
- Persistent Mapbox, canonical clustered inventory, bounded selected presentation, application selection, resource controller, timeout fallback and night styling are retained.

## Verification recorded 2026-10-12

- Final configured application suite: 251 files, 1,992 tests passed.
- Focused map/icon/event-change integration: 40 files, 212 tests passed.
- Combined database gate: 13 suites, 462 assertions passed.
- Main notice revision tests, split into their two existing transactional TAP documents without editing source: 19 assertions passed.
- Moderation worker compatibility: 21 passed.
- CSP integration: 2 passed.
- Existing configured `test:build25`: 27 files, 406 tests passed after fixture compatibility correction.
- Typecheck, lint, production build and whitespace check passed.
- Final browser run: both journeys passed. Desktop 1440×900 and mobile 390×844 prove persisted picker choice, current-main publication, both runtime icons, canonical public cover, body tapping, normal previews, chooser/generic markers, same-instance style reload and selected single representation, and forced PNG failure fallback. The separate anonymous journey proves cluster-click expansion without map recreation.
- Pixel-based flag-tip checks passed the existing one-CSS-pixel tolerance on desktop and mobile.
- Latest screenshots were opened and inspected; controls and attribution remain visible, with no mobile horizontal overflow.

Final decision: **READY FOR PUSH / PR** against the pinned main base, with the nonblocking inherited test-harness and visual observations below. This is not production enablement approval.

### Exact-main inherited SQL harness failures

These were reproduced on the separate untouched 143-migration main schema before applying integration migrations. They are not the older map-branch six-failure disposition:

1. `moderation_policy_acceptance.test.sql` assertion 27 broadly matches multiple acceptance wrappers rather than the intended exact function signature. Combined tests explicitly check the canonical signature/grants.
2. `spec10_change_notice_revisions.test.sql` emits two TAP plans in one file. All 19 assertions pass when its existing transactions are tested separately.
3. `spec10_event_notices.test.sql` fixture reads `orders` as service_role after main revoked that table grant.
4. `moderation_evaluations.test.sql` reads `events` as service_role after main revoked that table grant.

No inherited test or database grant was weakened to manufacture a green result.

## Independent review

No Critical finding. One Important finding: global map preview CSS collided with main's organizer preview after SPA navigation. All preview/chooser selectors, including mobile rules, are now scoped beneath `.living-map`; a regression test failed on the unscoped selector and passed after the fix.

The reviewer also identified a legacy non-public-format Mapbox fixture in `test:build25`. This was treated as a verification-compatibility defect and corrected to an inert public-format fixture; a focused configuration regression failed before and passed after the change. The command's final rerun is recorded separately. No real token or production behavior changed.

The reviewer did not independently judge live database execution or rendered browser behavior; those remain separate measured gates, not inferred review approvals.

### Bounded reconciliation decisions

- Keep public context/history wrappers; adapt lower writers only. A wrong choice here would lose lifecycle guards, so combined history/context tests are the gate.
- Resolve only selected cover imagery through the existing public image boundary. A wrong choice could expose private/stale imagery; selected-identity unit tests and actual public-cover browser loading cover this boundary.
- Omit icon assignment from the legacy admission-only save path. Otherwise ticket conversion could accidentally acquire icon-edit authority; a focused API regression covers this case.
- Reserve the new root map route with a forward collision guard. An existing hosted `map` storefront is an explicit owner-resolution blocker, never silently reassigned.
- Preserve main GraphQL exports and nullable RPC input annotations when regenerating public types. Typecheck and real database calls cover generator limitations.
- Disposition inherited SQL harness failures only after exact-main reproduction; retain their source and grants unchanged. The risk is concealing a real integration failure, addressed by separate combined assertions and the split notice proof.
- Correct the maintained test entrypoint's inert token fixture rather than weaken production token validation. Configuration RED/GREEN and all 406 entrypoint tests passed.
- Use ignored exact-source local copies to package the existing image handler for isolated proof; do not change its production implementation to work around CLI symlink/import-map behavior.
- Browser code must not serialize the Mapbox instance returned by camera methods. The proof harness returns nothing from camera mutations and waits for canonical viewport data before testing cluster expansion; application runtime remains unchanged.

### Remaining minor observations

- Standard place labels can overlap cluster-count presentation at some views. This is inherited map layer ordering, not an integration regression; cluster expansion and chooser operation are verified. No redesign was performed.
- Production build retains the existing large-chunk warning (including the lazy Mapbox-containing route). No dependency upgrade or unrelated bundle redesign was included.

## Isolated icon identities

These are local verification identities only, not production configuration:

- Wheretoo Flag: `371c1500-db51-4341-98a8-ef4b48e9aebf`.
- Grand Opening: `174dee1b-d838-478f-ac11-eda329510649`.

The original no-redeploy acceptance is historical Phase 5B evidence. This reconciliation re-verifies both icons through the existing dynamic runtime; it does not claim a new production rollout.

## Later production enablement — checklist only

1. Verify hosted migration inventory and backup/restore procedures. Apply the five forward integration migrations after all current-main migrations; never rename current-main history.
2. Preflight whether organizer handle `map` already exists. The route migration deliberately aborts on a collision; an owner-approved resolution is required before proceeding.
3. Verify catalog RLS, immutable version guards, Storage buckets/policies and private originals. Do not grant arbitrary organizer upload or table-write access.
4. Publish approved icons through the curator boundary with exact-byte provenance and validated per-icon metadata. Local proof UUIDs are not production IDs.
5. Configure the public Mapbox token, intended Supabase origin and existing public image endpoint. Validate CSP and Storage CORS/cache headers for that exact origin.
6. Keep selection/rendering switches disabled until an authorized rollout. Then smoke-test organizer save/reload, revision/context conflict, publication, anonymous viewport query, both icons, normal fallback, selection, clusters/chooser and desktop/mobile previews.
7. Verify style reload and delayed/failed icon requests without replacing the map instance.

## Rollback

Disable library selection and rendering through the authorized settings boundary; normal markers remain the fallback and existing immutable assignments remain stored. Revoke a defective version through the curated lifecycle instead of mutating its bytes. If application rollback is needed, return to the compatible main deployment while retaining the additive schema and data; do not drop tables or rewrite migration history. Re-enable only after a new smoke test.

## Evidence handling

Raw local logs and browser captures remain ignored under the integration worktree's `.superpowers/sdd/2026-10-07-map-main-integration` and `test-results/map-main-integration`. No credentials, local Supabase state, screenshots or binaries are intended for the integration commit.

The principal screenshot directory is `test-results/map-main-integration/map-integration-combined-m-30d1d-over-and-desktop-mobile-map/`. It contains desktop picker/live map/flag/selected cover/style reload/Grand Opening/cluster/chooser/generic preview, mobile persisted picker/live map/flag/selected cover/generic preview, and desktop image-failure fallback captures. The sibling anonymous-cluster directory contains the settled cluster capture.
