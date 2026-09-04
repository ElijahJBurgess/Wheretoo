# WHERETO V1 Context Map and Event Layer Specification

Status: Founder-directed V1 design specification

Date: 2026-09-04

Supersedes: the Build 3A requirement that the empty basemap itself must be a proprietary miniature Whereto city

Scope: specification only; no production code, schema, migration, ticketing, payment, or implementation-plan changes

## 1. Executive product decision

Whereto V1 will use a useful, populated, familiar Mapbox city map as its context layer and place a clearly branded Whereto event layer above it.

The city does not need to be visually reinvented. Streets, parks, neighborhoods, buildings, businesses, venues, and other points of interest make the map useful before organizer inventory is dense. Published Whereto events are the proprietary product objects and must dominate that context.

The default engineering decision is **evolve, do not rewrite**. The existing Build 3A Mapbox renderer and its security, lifecycle, camera, bounds, test, and visual-proof infrastructure are reusable. Nothing inspected justifies deleting `src/map/**` or resetting its history.

The V1 data-source decision is:

1. Use Mapbox Standard's native contextual geography, ordinary POI labels, and place/road labels.
2. Use Whereto's canonical public event projection for event data.
3. Do not fetch, copy, or maintain a baseline Whereto places database.
4. Use Mapbox Search only if a later, explicit search or user-invoked POI lookup requirement is approved; it is not required to populate the passive map.

Product language may use: **“Put your event on the map.”** Final marketing copy is not locked by this specification.

## 2. Problem being solved

The prior basemap direction made the product's sense of life depend on bespoke visual treatment and, implicitly, future event density. That creates two avoidable risks:

- With zero or few Whereto events, the map can feel empty rather than useful.
- Engineering effort can drift into custom city reconstruction instead of event discovery and transaction reliability.

The new direction solves the cold-start problem by letting ordinary city context carry baseline usefulness. Whereto's product differentiation moves to the event layer, selection experience, and path into the existing event transaction flow.

## 3. Old visual requirement being superseded

The following old requirement is no longer authoritative:

> The empty city itself must feel like a premium, proprietary miniature Whereto world; a conventional Mapbox-looking city is a failure.

It is replaced by:

> A useful, populated, familiar city map is the context. Whereto events are the distinct branded product layer. The map must remain useful with zero Whereto events and make a few Whereto events immediately recognizable.

This change supersedes miniature-city success criteria, not the underlying map engineering. Existing real geography, renderer, security, accessibility, responsiveness, and visual QA remain valuable.

## 4. Current repository and map state

The audit was performed from the repository at `/Users/exoh/Desktop/WhereTo -  Repository`.

- The checked-out branch is `main`.
- `main` HEAD is `bdd6e17a6b2a5a0985595811e60d65ac2dd9bff2` (`docs: add checkout integrity implementation plan`).
- `main` is two commits ahead of `origin/main` (`56a8ecd`) at audit time.
- The working tree contains user-owned visual-reference deletions and untracked reference images. This specification does not alter them.
- `main` does not currently contain `src/map/**`. The map implementation exists on separate Build 3A branches/worktrees rooted at `56a8ecd`.
- The latest inspected map branch is `codex/build-3a-cartoon-mood-mobile` at `0d74c5e`.
- Other verified map refs are `backup/build-3a-pre-cartoon-reset` at `8135306`, `codex/build-3a-cartoon-direction` at `d2ba50d`, and `codex/build-3a-living-map-core` at `0123a3c`.

The latest inspected map tree contains Mapbox GL JS `3.29.0`, a `/map` route and responsive page shell, one persistent renderer, Mapbox Standard configuration, a custom Mapbox Streets building extrusion, optional procedural park trees, deterministic local visual scenes, renderer unit tests, and Playwright visual proof suites. It does **not** yet contain the production event DTO/query adapter, event GeoJSON source/layers, clusters, selection, preview, or user-location control.

## 5. Current HEAD, branch, and history audit

The known historical commits were verified and are not current `main` HEAD:

| Commit | Verified subject | Meaning now |
|---|---|---|
| `23d3ba9` | `chore: add living map runtime boundary` | Reusable route/runtime/CSP foundation |
| `0666905` | `feat: define Whereto map renderer contracts` | Reusable renderer, camera, style, and scene seams |
| `04733abe6abbeb689e76fd65ff948f535dec3de1` | `feat: prove Whereto living city renderer` | Reusable persistent Mapbox renderer and visual proof |
| `edb154e92e76310ecbd3cd73c5159e66d2830bb1` | `feat: quiet living map cartography` | Partly reusable cartography work; POI suppression is superseded |
| `0a7af30aaafad6fc66046535005e84997f7cfdf9` | `feat: deepen living map buildings` | Experimental depth work requiring simplification/readability review |
| `8135306` | `feat: lock fantasy-scale building massing` | Miniature-city-specific direction, superseded as a target |
| `0123a3c` | `reset: restore Task 3 renderer baseline` | History-preserving reset within the map branch; not a reason to rewrite |
| `d2ba50d` | `feat: establish cartoon map foundation` | Experimental styling, mostly isolate or simplify |
| `0d74c5e` | `feat: refine cartoon map palette and mood` | Latest audited map tip; not yet integrated into `main` |

No old commit should be reset, squashed, or erased. Transition work should preserve the branch history and make reviewed forward changes.

## 6. Existing map architecture audit

### Renderer and lifecycle

`src/map/core/WheretoMap.tsx` owns a single Mapbox instance inside a mount-only effect, updates callback refs without rebuilding the renderer, removes event listeners and the map on unmount, waits for `idle` before reporting ready, bounds viewport output, redacts token-like diagnostics, and distinguishes unsupported WebGL, authentication, style-load, and renderer failures. These are sound foundations.

### Factory, token, security, and attribution

`src/map/core/mapbox.factory.ts` centralizes Standard style selection, public token injection, service bounds, camera, interactions, attribution, reduced-motion behavior, and Standard config. Environment validation requires a public `pk.` token. The renderer leaves `attributionControl: true` and the Playwright proofs assert both Mapbox logo and attribution visibility.

The current CSP integration allows Mapbox API and telemetry requests and was developed with contract tests. It must be rechecked when the map branch is integrated because official Mapbox guidance also identifies worker/image/WASM requirements, and a meta CSP has enforcement limitations compared with an HTTP response header.

### Cartography and depth

`src/map/style/standardConfig.ts` intentionally disables `showPointOfInterestLabels`, road labels, transit labels, landmark icons/labels, pedestrian roads, and indoor context. It preserves place labels. This setting directly conflicts with the new useful-context goal.

The custom `whereto-buildings` layer uses `mapbox.mapbox-streets-v8`, the Standard `middle` slot, a minimum zoom of `12.5`, and multiplied real heights (`1.5`, `1.75`, or `2`). Standard's native 3D buildings are disabled. The latest default camera is highly pitched (`55°` desktop and `58°` mobile), bearing-locked at `-28°`, and pitch-locked. These choices favored miniature-city depth over POI scanning and need tuning.

The park-tree system generates up to 260 decorative symbol points from visible land-use polygons and subtracts water. It is bounded and tested but adds visual and runtime complexity that is not necessary for context-map acceptance.

### Visual harness and test infrastructure

Local-only, allowlisted visual scenes provide deterministic SF/Oakland and mobile cameras. Unit tests cover persistence, cleanup, bounds, errors, configuration, building-layer installation, tree generation, and scene allowlisting. Playwright suites capture real Mapbox output and assert attribution, diagnostics, camera, overflow, console, network, and page errors. The harness is valuable; cartoon-specific assertions are not authoritative product requirements.

### Event data seam

The repository's current canonical backend boundary is `public.get_public_map_events(west, south, east, north, starts_at, ends_at, categories)`. It:

- validates geographic bounds, time ordering, a maximum seven-day window, and allowlisted categories;
- uses the private canonical public-eligibility predicate rather than exposing raw tables;
- applies PostGIS viewport intersection;
- filters by time/category and excludes invalid paid inventory;
- returns event identity, display data, coordinates, `animation_preset`, venue, admission/price, disclosure, and artwork fields;
- grants execution to anonymous and authenticated users while revoking direct broad access.

The database types include this RPC. No production client adapter or event-to-GeoJSON layer exists in the inspected map tree.

## 7. Disposition matrix

| Major piece | Decision | Rationale / later implementation implication |
|---|---|---|
| Persistent Mapbox instance | **KEEP** | Correct performance/lifecycle boundary; update sources and feature state instead of remounting |
| Mapbox factory/configuration | **KEEP BUT SIMPLIFY** | Retain central factory; replace miniature-specific options with useful-context defaults |
| Public token validation | **KEEP** | Correct client-token boundary |
| CSP/security work | **KEEP BUT VERIFY** | Preserve tests; reconcile exact worker, image, WASM, Search endpoint, and response-header requirements |
| Attribution compliance | **KEEP** | Mandatory and already visually tested |
| Renderer lifecycle/error handling | **KEEP** | Mature reusable infrastructure |
| Service bounds and bounded viewport | **KEEP** | Matches Bay Area V1 and viewport RPC |
| Camera logic | **REPURPOSE** | Keep responsive camera seam; reduce/default pitch and unlock user-readable navigation behavior |
| Current Standard configuration | **KEEP BUT SIMPLIFY** | Restore POIs, road labels, and pedestrian roads; tune density rather than erase context |
| Custom building extrusion | **KEEP BUT SIMPLIFY** | Evaluate as subtle close-zoom character; remove fantasy height multiplication from default |
| Quiet-cartography work | **REPURPOSE** | Retain restrained palette intent, reverse label suppression, validate hierarchy with events |
| Physical-depth work | **KEEP BUT SIMPLIFY** | Preserve seam/tests; lower pitch/height emphasis and make depth subordinate to labels/events |
| Procedural park trees | **REMOVE FROM DEFAULT / PRESERVE CODE INITIALLY** | Not needed for V1 discovery; isolate behind off/default and delete only in a reviewed later task if proven valueless |
| Warm-vivid LUT and cartoon variants | **REMOVE FROM DEFAULT / PRESERVE AS TESTED EXPERIMENT** | Conflicts with familiar context if it harms POI recognition; no immediate file deletion |
| Visual scene harness | **KEEP AND REPURPOSE** | Add cold-start/event-density/selection/mobile scenes |
| Playwright visual QA | **KEEP AND REPURPOSE** | Replace miniature gates with context/event hierarchy gates |
| Map DTO boundary | **NOT YET BUILT** | Add a validated frontend projection sourced only from the public RPC |
| Public map RPC | **KEEP** | Canonical security, moderation, time, filter, inventory, and geographic boundary |
| DTO to GeoJSON seam | **NOT YET BUILT** | Add a pure converter with explicit properties and tests |
| Event symbol-layer seam | **NOT YET BUILT** | Add Mapbox source/layers; do not use unbounded DOM markers |
| Clustering seam | **NOT YET BUILT** | Configure on the event GeoJSON source and add cluster layers/interactions |
| Selected-event seam | **NOT YET BUILT** | Feature-state or selected-ID-driven styling plus preview state |
| User-location seam | **NOT YET BUILT** | Add permission-aware control/state without coupling to event truth |
| Responsive/mobile shell | **KEEP BUT EXTEND** | Existing full-viewport shell is sound; add preview safe areas and mobile camera rules |

No destructive deletion is recommended by this specification. Therefore no deletion-impact appendix is needed. Later removal of a superseded experiment must name exact files, prove repurposing is insufficient, and assess migration/test impact.

## 8. New V1 map architecture

```text
Mapbox Standard style
  geography + roads + neighborhoods + native ordinary POIs
                         │
                         ├────────────── context only
                         │
Supabase/PostGIS         │
  public.get_public_map_events(bounds, time, categories)
            ↓
validated WheretoMapEvent DTO
            ↓
pure FeatureCollection<Point, WheretoEventProperties>
            ↓
persistent clustered Mapbox GeoJSON source
            ↓
cluster circles/counts + event hit area + event symbols/labels
            ↓
selected event state → preview → existing `/events/:eventId`
```

Map rendering, event-domain data, filtering/querying, and selection remain separate modules. The renderer accepts already-public DTOs and never decides publication, moderation, cancellation, payment validity, or visibility from raw event rows.

## 9. Base-map strategy

Use `mapbox://styles/mapbox/standard` through the existing Mapbox GL JS stack. Configure it into a calm but recognizable consumer map rather than a blank canvas or a miniature diorama.

Required baseline configuration intent:

- `showPlaceLabels: true`
- `showPointOfInterestLabels: true`
- `showRoadLabels: true`
- `showPedestrianRoads: true`
- retain parks/greenspace, water, streets, land use, and building context
- start POI density at a moderate Standard-supported value and validate separately for desktop and mobile
- transit and landmark labels may be enabled if they improve orientation without competing with events
- indoor labels remain off by default for this outdoor city-discovery surface
- Whereto events remain visible and legible above this context

Mapbox Standard exposes these label toggles and a POI density control from 1–5. The implementation should tune supported configuration properties, not depend on private basemap layer IDs. See [Mapbox Standard configuration](https://docs.mapbox.com/map-styles/reference/standard/) and [Standard styles guidance](https://docs.mapbox.com/map-styles/guides/standard-styles/).

## 10. Business and POI context strategy

Ordinary restaurants, cafes, bars, stores, venues, and services are passive context in this milestone. Their expected behavior is the normal behavior supplied by Mapbox Standard: recognizable labels/icons that help users orient themselves.

V1 does not require a Whereto business object, business details route, business ownership, reviews, menus, or recommendations. A normal POI may remain visible below a Whereto event at the same venue. It does not need to be suppressed unless collision/readability testing proves selective hiding is necessary.

Normal POI taps should retain Mapbox's default non-product role: no Whereto detail experience is opened. If Mapbox Standard emits queryable features and a tap handler is later desired, it may provide a minimal transient name/orientation affordance only after a separately approved requirement; it is not required here.

## 11. Data-source decision

### Chosen: native Mapbox context plus Whereto event data

This is the smallest legitimate production solution. Standard already supports POI icons/text, place labels, road labels, and related consumer-map context. The current map turns most of those off. First restore and tune them, then test the four cold-start scenarios.

### Deferred fallback: Mapbox Search

Mapbox Search Box can provide interactive text search, category search, reverse lookup, and POI results. It is appropriate for explicit user-initiated search or “search this area/category” behavior, not for continuously filling every viewport with a second passive POI layer. Search is explicitly outside V1 product scope, and passive Standard POIs should be proven insufficient before adding requests, UI, cost, or terms complexity. See [Search Box API](https://docs.mapbox.com/api/search/search-box/) and [Search Box overview](https://docs.mapbox.com/mapbox-search-js/guides/searchbox/).

### Rejected for V1: Whereto-owned baseline places database

There is no approved requirement that needs ownership of ordinary business data. A stored places corpus would introduce ingestion, freshness, deduplication, licensing, moderation, query, and product-scope burdens while duplicating the context already rendered by the basemap.

Google, Apple, Yelp, or other wholesale POI ingestion is not proposed. No such source should be introduced unless its exact production license, storage, derivative-display, attribution, and cross-map-display terms are reviewed for a newly approved requirement.

## 12. Licensing, storage, display, and attribution considerations

- Mapbox Standard and Mapbox-supplied data require the Mapbox logo and text attribution. Preserve the built-in controls, keep them legible, and include them in mobile preview safe-area tests. See [Mapbox attribution requirements](https://docs.mapbox.com/help/dive-deeper/attribution/).
- Native Standard POIs are rendered as part of the licensed basemap. Whereto does not copy them into Supabase and does not claim ownership of them.
- Search Box API responses are documented as temporary-use data; persistent position storage requires contacting Mapbox sales. Do not use Search Box category/reverse results to create a cached baseline business database. See [Search Box API restrictions](https://docs.mapbox.com/api/search/search-box/#search-box-api-restrictions-and-limits).
- The existing organizer location workflow stores a selected Mapbox feature ID, address, and coordinates as part of a real Whereto event. Before changing that workflow or its storage terms, conduct a separate contract/licensing review; this map spec does not alter it.
- If future permanent geocoding is approved, use the applicable Mapbox product/mode and commercial terms rather than assuming temporary Search results may be retained.
- Product and legal owners should verify the live Mapbox account agreement, plan, pricing, attribution, and storage rights before production launch. This specification records technical constraints, not legal advice.

## 13. Whereto event-layer architecture

The canonical flow is:

```text
Supabase/PostGIS
→ public.get_public_map_events
→ runtime-validated WheretoMapEvent[]
→ pure GeoJSON conversion
→ one persistent Mapbox GeoJSON source
→ Mapbox cluster and unclustered event layers
→ selection/preview state
```

The query is driven by a debounced/stabilized `moveend` viewport, the active time window, and approved category filters. Use a query envelope padded by approximately 20% of viewport width and height on each side, clamped to service bounds, so small pans and overlay-aware camera adjustments do not churn edge events. The first request follows map readiness. Responses update the existing source with `setData`; they do not reconstruct the map. Query cache keys must include normalized padded bounds/time/category inputs. Each request carries a monotonically increasing generation; only the latest generation may update the source or clear selection.

The renderer receives valid public projection data only. It does not read `events` directly, infer visibility, or reproduce moderation/payment rules.

## 14. DTO to GeoJSON contract

The frontend DTO must validate the current RPC output and use domain-friendly names:

```ts
type WheretoMapEvent = {
  id: string
  title: string
  category: WheretoEventCategory
  startsAt: string
  endsAt: string
  timezone: string
  latitude: number
  longitude: number
  animationPreset: string
  venueLabel: string
  admissionType: 'free' | 'paid'
  minimumPriceMinor: number | null
  minimumAge: string
  advisories: string[]
  artworkReference: string | null
}
```

The pure converter returns:

```ts
type WheretoEventProperties = {
  eventId: string
  title: string
  category: WheretoEventCategory
  startsAt: string
  endsAt: string
  timezone: string
  animationPreset: string
  markerAssetKey: string
  venueLabel: string
  admissionType: 'free' | 'paid'
  minimumPriceMinor: number | null
  minimumAge: string
  advisories: string[]
  artworkReference: string | null
  temporalState: 'upcoming' | 'starting-soon' | 'happening-now'
}
```

Each feature is a GeoJSON `Point` with `[longitude, latitude]`, top-level `id` equal to `eventId` for stable feature state, and no raw authorization fields. `temporalState` is a deterministic presentation derivation from one shared clock at conversion time; it does not determine public eligibility. Invalid rows fail the adapter explicitly and are reported without silently rendering unsafe partial data.

Arrays in GeoJSON properties must follow the actual Mapbox expression/runtime contract selected during implementation; if serialization is required, encode and decode it in the adapter rather than leaking renderer-specific shapes into the domain DTO.

## 15. Whereto pin asset contract

V1 uses Mapbox symbol layers and runtime-loaded, transparent raster assets for event identity. SVG source art may exist in the design pipeline, but runtime assets should be decoded to formats accepted by `map.loadImage`/`map.addImage`, such as PNG or WebP, or supplied as image data. SDF is reserved for truly single-color tintable glyphs; multicolor branded pins are non-SDF.

Asset registry contract:

```ts
type MarkerAssetDefinition = {
  key: string
  url: string
  pixelRatio: 2 | 3
  sdf: boolean
  intrinsicWidth: number
  intrinsicHeight: number
  anchor: 'bottom'
  fallbackKey: 'event-generic'
}
```

Rules:

- `markerAssetKey` is derived from an allowlisted registry, initially using `animationPreset` and category with fallback to `event-generic`.
- Unknown or failed assets use the generic marker; they never remove an otherwise valid event.
- One representative proof asset is required before the full library: a branded, high-contrast Whereto event pin with a compact event-category cue.
- Default rendered target: approximately 36–44 CSS px on mobile/neighborhood zoom and 32–40 CSS px on desktop, with data-driven zoom interpolation and a minimum 44×44 CSS px interactive hit area supplied by a transparent/circle hit layer rather than inflating artwork.
- Selected markers render in a dedicated layer above clusters and unselected events, scale about 1.15–1.25×, gain a clear halo/outline, set `icon-allow-overlap: true`, and use an independent hit area. Selected text may overlap only when its short label remains readable; otherwise the preview carries the full identity. Selection must not rely on motion alone.
- Unselected event icons may collide with other Whereto icons to protect readability; event icons should be allowed to displace or visually dominate ordinary context. Selected event rendering ignores ordinary collision where Mapbox permits and remains visible.
- A label may show concise event identity at neighborhood/close zoom. Do not put full flyer artwork on the map.
- Motion is not required for the representative proof and must have a reduced-motion fallback.

Mapbox requires images to be present before a symbol layer references them, and style layers are more efficient than HTML markers for many features. See [working with sources and layers](https://docs.mapbox.com/mapbox-gl-js/guides/styles/work-with-layers/) and [style-layer guidance](https://docs.mapbox.com/mapbox-gl-js/guides/add-your-data/style-layers/).

## 16. Layer ordering

Required visual order, bottom to top:

1. Standard land, water, greenspace, and land use.
2. Standard roads and geographic lines.
3. Optional subtle Whereto building extrusion, if retained.
4. Standard ordinary POI/business labels and icons.
5. Whereto cluster circles and cluster counts.
6. Whereto event hit areas, icons, and short labels.
7. Dedicated selected-event hit area, halo, icon, and optional short label with overlap enabled for the selected icon.
8. HTML application chrome and event preview.

Mapbox Standard has stable `bottom`, `middle`, and `top` slots. `top` is above POI labels but behind place/transit labels; a layer without a slot is above existing style layers. Because Level 3 must dominate all ordinary context, test Whereto symbols without a slot or in the highest suitable supported placement, while keeping related Whereto layers internally ordered. Do not target private Standard layer IDs. See [Standard layer slots](https://docs.mapbox.com/mapbox-gl-js/example/geojson-layer-in-slot/) and [layer-order guidance](https://docs.mapbox.com/mapbox-gl-js/guides/styles/work-with-layers/#specify-order-of-a-layer-at-runtime-for-mapbox-standard).

## 17. Visual hierarchy

### Level 1 — geographic context

Land, water, roads, neighborhoods, parks, and buildings provide orientation. They use familiar, restrained styling and never compete with event actions.

### Level 2 — ordinary places

Business/POI names and quiet icons make the city useful. They remain subordinate through normal Standard styling, moderate density, and collision handling.

### Level 3 — Whereto

Branded event icons, selected states, clusters, and concise event identity use the strongest color, contrast, outline, and state change. A user must be able to identify three Whereto events at a glance without studying the legend.

At an existing venue, the Whereto marker is rendered above the ordinary venue label. If collision makes both impossible, preserve the Whereto event and let the preview carry the venue name.

## 18. Camera decision

Keep the camera abstraction, service bounds, and responsive defaults; change the default posture from dramatic fixed diorama to readable consumer map.

- City/far zoom: near-planar, approximately `0–20°` pitch, north-up or minimal bearing.
- Neighborhood/default discovery: approximately `20–35°` desktop pitch and `0–25°` mobile pitch, validated against POI readability.
- Close zoom: may rise toward `35–45°` only if labels and event selection remain legible.
- Remove the current equal `minPitch`/`maxPitch` lock. Disable accidental rotation if desired, but do not force every view to `55–58°` and `-28°`.
- Mobile defaults should be less pitched than desktop because vertical screen space and label clearance are scarcer.
- `fitBounds`/camera transitions for location, clusters, and selection must account for preview overlays and safe areas and respect reduced motion.

Exact camera constants are an implementation calibration outcome, not locked by this spec. Acceptance is based on readability and cold-start utility.

## 19. Building and extrusion decision

Do not delete the custom extrusion layer now. Retain it as an evaluated, subtle close-zoom character layer with these constraints:

- no fantasy height multiplier as the production default; begin at real height (`1.0`) or use Standard native buildings as the comparison baseline;
- buildings appear only where they aid spatial comprehension, approximately neighborhood/close zoom;
- opacity, shadows, and color remain quieter than POIs and events;
- buildings must not obscure Whereto markers or make normal labels unreadable;
- compare custom extrusion against Standard native 3D buildings before choosing one production default;
- do not run both merely to preserve prior effort;
- turn extrusion down/off at city zooms and on constrained mobile views if it adds clutter or GPU cost.

The custom layer's source/layer tests and diagnostics remain useful. Rounded roofs, warm-vivid grading, and exaggerated massing are experiments, not V1 acceptance requirements.

## 20. Map interaction behavior

- **Pan:** free within service bounds; update event query after settled movement, not every frame.
- **Zoom:** continuous Mapbox zoom within reviewed bounds; change event/cluster representation by layer expressions.
- **Tap Whereto event:** select exactly one event, promote its marker, and open/update preview.
- **Tap selected Whereto event:** keep selection stable; do not immediately navigate without an explicit preview CTA.
- **Preview:** shows sufficient identity—title, time, venue, admission/price/status—and an explicit action to open the event.
- **Preview to detail:** navigate to existing `/events/:eventId`; do not create a parallel event route.
- **Directions:** this milestone adds no in-map routing, turn-by-turn navigation, or directions engine. It preserves the V1 event-detail directions CTA/flow defined by the product and user-flow documents, including an existing external-map handoff where implemented.
- **Tap empty map:** dismiss selection/preview unless doing so would conflict with an active gesture.
- **Normal POIs:** remain contextual and do not open a Whereto business page.
- **Keyboard:** standard controls and preview actions are focusable; map-only pointer interaction is not the sole route to event content when an accessible event representation is present.

## 21. Mobile behavior

- Default to a lower pitch and reduced ordinary POI density relative to desktop if testing shows label chaos.
- Maintain the branded pin's recognizable silhouette and at least a 44×44 CSS px touch hit area.
- Use a bottom preview sheet/card if consistent with the existing consumer shell; it begins compact, avoids covering the selected pin, respects bottom safe area, and provides an explicit close action and event-detail CTA.
- Camera fitting uses padding equal to visible sheet/header overlays so selection remains visible.
- Cluster circles/counts remain large enough to tap without overwhelming the base map.
- Attribution/logo remain visible and unobstructed.
- Preview scrolling does not accidentally pan the map; map gestures do not accidentally activate preview actions.
- Selected state cannot depend only on hover, color, or animation.
- Test 390×844 and at least one narrower supported viewport plus landscape behavior.

## 22. Clustering behavior

Configure clustering on the single event GeoJSON source (`cluster: true`) with implementation-tuned `clusterRadius` and `clusterMaxZoom`.

- Far/city view shows branded clusters with readable counts.
- Neighborhood view expands to individual events when spatially legible.
- Cluster tap uses `getClusterExpansionZoom`, then eases to the cluster coordinate with overlay-aware padding.
- Cluster styling remains unmistakably Whereto but less semantically specific than an individual event.
- Co-located events that cannot separate at maximum zoom require a deterministic multi-event selection/list affordance; they must not become unreachable. The exact compact UI can be chosen during implementation design.
- Do not cluster ordinary Mapbox POIs; they belong to the basemap.

Mapbox GL JS supports client-side clustering on GeoJSON sources and separate layers filtered by `point_count`. See [Mapbox cluster example](https://docs.mapbox.com/mapbox-gl-js/example/cluster/).

## 23. Event selection behavior

Selection is application state keyed by `eventId`; visual state is projected into Mapbox through feature state or deterministic layer filters.

- At most one individual event is selected.
- A selected event remains selected through source `setData` while it remains in the latest valid padded-envelope response.
- During a gesture or overlay-aware camera transition, retain the selected validated DTO until the latest request settles. A superseded response may never clear it. After the latest settled response, clear selection if the event coordinate is inside that response's padded envelope but the event is absent, because this indicates an authoritative filter/time/eligibility removal. If the selected coordinate is outside the new padded envelope, clear after camera settlement rather than carrying a stale off-screen preview. Explicit dismissal, selecting another event, or navigation clears it immediately.
- Selected icon and halo use a dedicated layer above ordinary event layers with `icon-allow-overlap: true`; they are visually dominant, collision-resilient, and reduced-motion safe.
- Preview content comes from the validated public DTO, not `queryRenderedFeatures` as the data authority.
- Navigation uses the stable public `eventId`.

## 24. User-location behavior

- User location is optional and separate from event/publication truth.
- Do not request permission on initial map load solely to render the map. Start at the supported Bay Area default.
- Request location only after a user action such as a locate control.
- On grant, show a familiar, subordinate location dot/accuracy treatment and fit within service bounds with overlay-aware padding.
- On denial, unavailable position, timeout, or out-of-service result, retain the current useful map and show a small non-blocking explanation.
- Never represent ambient objects, event attendees, or inferred traffic as the user.
- Location is not persisted or sent to the event backend unless a separately approved feature requires it.

## 25. Performance boundaries

- Keep one Mapbox instance for the page lifetime.
- Use one Whereto event GeoJSON source and Mapbox layers for normal event rendering.
- Update with `setData`; do not remount the map for filters, moves, selection, or previews.
- Query events by bounded viewport/time/category through the existing RPC; do not load all Bay Area events and filter only in the browser.
- Trigger requests after stabilized movement and prevent stale-response overwrite.
- Use clustering and collision rules before considering DOM markers.
- No unbounded React/HTML marker collection. Any future rich selected marker is capped to the selected event or a very small viewport-aware pool.
- No passive Search Box category sweep, massive custom places download, Three.js city renderer, custom building reconstruction, or decorative tree generation as a launch dependency.
- Lazy-load event artwork only in preview/detail, not every map feature.
- Avoid per-frame React state updates from map motion.
- Provisional production acceptance budgets, measured in a production build on the agreed representative desktop and mid-tier mobile devices, are:
  - exactly one Mapbox construction during a continuous map-page session and one removal on unmount;
  - one event request per settled camera state, debounced `250–400 ms`, with superseded requests aborted where supported and never committed;
  - functional and visual proof with `1,000` returned event points in one padded envelope and stress proof with `2,500`, without DOM markers proportional to feature count;
  - `setData` plus application-side conversion completes in `≤50 ms` p95 desktop and `≤100 ms` p95 mobile for 1,000 points;
  - after initial map readiness, pan/zoom interaction sustains at least `45 fps` p95 over a 10-second scripted gesture on the representative mobile device, with no application long task over `100 ms` caused by event conversion/render updates;
  - first useful map context (canvas plus geographic labels/POIs, independent of event response) appears within `3.0 s` p75 on the agreed production-like mobile network/device profile, and Whereto events appear within `1.0 s` p75 after map readiness when the RPC completes within `500 ms`;
  - a 10-minute pan/zoom/select/clear soak increases JavaScript heap by no more than `50 MB` after forced-GC comparison in the browser harness and does not create additional Mapbox instances, sources, layers, or image registrations.
- These are launch gates, not promises about every device or network. The later implementation plan must name the exact measurement profile and may tighten them. Relaxing one requires recorded evidence, founder approval, and an updated spec; it must not happen silently during implementation.

## 26. Security, CSP, and token considerations

- Continue using a public Mapbox token in the browser; never ship a secret token.
- Use a dedicated application token with least public scopes and production URL restrictions rather than the unrestricted default token. Mapbox explicitly recommends public client tokens, least privilege, per-application isolation, URL restrictions, and rotation. See [Mapbox token security](https://docs.mapbox.com/help/dive-deeper/how-to-use-mapbox-securely/).
- Preserve token-format validation and redaction of token-like error diagnostics.
- Keep publication/moderation/time/inventory enforcement in the canonical RPC and database policies; the client map is not an authorization boundary.
- Preserve Mapbox logo/text attribution and telemetry behavior required by the selected integration.
- Reconcile CSP with the actual GL JS 3.29 ESM bundle. Official guidance calls out `worker-src blob:`, `img-src data: blob:`, Mapbox `connect-src` endpoints, and Standard/3D WASM needs; prefer an HTTP response header over a meta tag for production enforcement where hosting permits. See [Mapbox GL JS security and testing](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/).
- If Search is later enabled, add only its required public scope/endpoints and rate/cost controls; do not broaden permissions preemptively.
- Re-review CSP and Mapbox endpoints on every Mapbox GL JS upgrade.

## 27. Testing strategy

### Unit and component contracts

- Standard config enables required context and uses a bounded POI density.
- Factory retains public token, bounds, attribution, reduced motion, and responsive camera behavior.
- Renderer constructs/removes one map, installs sources/layers idempotently, and updates GeoJSON without reconstruction.
- RPC schema adapter rejects malformed coordinates, identifiers, temporal fields, and unsupported categories.
- DTO-to-GeoJSON conversion is deterministic, emits stable feature IDs, chooses allowlisted/fallback asset keys, and derives temporal state from one clock.
- Event layers have correct filters/order/collision/selected styling.
- A colliding selected feature remains visible in its dedicated overlap-enabled layer above ordinary POIs and unselected events.
- Cluster expansion and co-located-event behavior are reachable.
- Selection clears on data disappearance and survives legitimate source refresh.
- Location grant/deny/error/out-of-bounds paths are non-blocking.

### Database/integration contracts

- Preserve and rerun tests for `get_public_map_events` validation, viewport/time/category filtering, public eligibility, moderation boundaries, paid inventory visibility, and anon/auth execution.
- Add client integration coverage proving the adapter invokes the public RPC rather than reading raw event tables.
- No migration is required for the first context-map/event-layer implementation unless repository evidence at implementation time proves a contract gap.

### Browser and visual QA

Repurpose deterministic scenes for zero, three, venue-overlap, many/clustered, selected, loading, empty, error, location denied, desktop, and mobile cases. Assert:

- Mapbox logo/text attribution visible;
- ordinary POIs, roads, and place context visibly present in representative SF and Oakland views;
- Whereto markers visually dominate POIs;
- selected marker remains visible with preview open;
- preview does not obscure required controls or attribution;
- clusters expand and individual events are tappable;
- no overflow, console errors, unexpected failed requests, or renderer rebuilds;
- reduced-motion behavior and keyboard/focus paths;
- screenshots at deterministic cameras reviewed against the three-level hierarchy.

Live Mapbox visual tests require a legitimate test token and network. Mocked unit tests remain responsible for deterministic API contracts.

## 28. Migration and data implications

- This specification requires no database migration.
- Keep `public.get_public_map_events` as the canonical public projection.
- Do not create a second event table or places table.
- Do not change event ownership, ticketing, payments, moderation, or payout data.
- Existing `animation_preset` is reused as an input to a safe frontend asset registry; it is not executed and does not require arbitrary organizer assets.
- Existing stored event coordinates and `mapbox_feature_id` remain unchanged.
- A future RPC change is justified only by a concrete event-layer field or query need that cannot safely be derived client-side; it must be migration-driven and independently reviewed.

## 29. Explicit non-goals

- full miniature city or proprietary reconstruction of the basemap
- custom-modeled Oakland or San Francisco
- Three.js or Blender city renderer
- custom building reconstruction, facades, roof-detail system, or thousands of decorative trees
- route/path animations or in-map routing/navigation infrastructure; the existing event-detail directions CTA/external handoff remains in scope
- full custom marker/animation library in this specification
- Yelp, Google Maps, or Apple Maps clone
- baseline Whereto places database
- business reviews, menus, editing, claiming, owner CMS, or profiles
- broad place recommendations or recommendation engine
- event search or primary feed
- consumer messaging/social graph
- private events
- ticketing, payment, refund, payout, or core transaction changes
- subscriptions, external ticketing, or enterprise functionality
- arbitrary organizer-executable marker code

## 30. Acceptance criteria

The future implementation is acceptable only when all of the following are evidenced:

1. One persistent Mapbox renderer displays a useful SF/Oakland map with familiar geographic and ordinary POI context.
2. The map remains useful with zero Whereto inventory.
3. Published eligible events come only from `public.get_public_map_events` through a validated DTO and GeoJSON adapter.
4. Whereto markers are custom, branded, interactive, and visually dominant over ordinary POIs.
5. Selection opens a usable preview and its explicit CTA reaches `/events/:eventId`.
6. Dense events cluster; co-located events remain reachable.
7. Map movement/filter/source updates do not reconstruct the map instance.
8. Mobile selection, preview, controls, attribution, and touch targets remain usable.
9. Token, CSP, attribution, error, reduced-motion, and accessibility contracts pass.
10. No places database, raw-table visibility decision, or payment/ticketing change is introduced.
11. Camera/building choices pass readability comparison rather than preserving dramatic depth by default.
12. Unit, integration, and real-browser visual gates pass with recorded evidence.

## 31. Cold-start acceptance scenarios

### Scenario A — zero Whereto events

Open representative Oakland and San Francisco views with the RPC returning an empty collection. Streets, neighborhoods, parks, buildings, ordinary businesses/POIs, and place context are visible. The UI may state that no Whereto events match, but it must not replace or dim the useful map. No empty/dead-map impression is acceptable.

### Scenario B — three Whereto events

Place three valid Whereto fixtures near the user in visually different ordinary contexts. Without opening a legend or studying labels, an evaluator can identify exactly which three objects are Whereto events. All three are tappable and lead to distinct previews.

### Scenario C — event at an existing venue

Use a fixture at a venue whose ordinary Mapbox POI is visible. The ordinary POI remains useful context. The Whereto event icon renders above it, wins collision/contrast hierarchy, and selection reveals event-specific identity plus the venue label.

### Scenario D — many Whereto events

Use a fixture set dense enough to trigger clusters and include co-located events. The base map remains readable, clusters communicate Whereto activity, cluster taps expand predictably, individual events emerge, and no event becomes permanently unreachable.

## 32. Transition from the current map branch

1. Preserve `main`, all Build 3A refs, and their commit history; do not reset or squash historical map commits.
2. Before implementation, choose a reviewed integration base that includes current `main` transaction work and the reusable map commits. Do not implement context-map work in the stale map worktree without first reconciling branch divergence.
3. Integrate or replay the smallest coherent map foundation: runtime boundary, renderer contracts, persistent renderer, security/CSP, route/shell, and visual harness. Resolve conflicts without touching transaction behavior.
4. Make forward commits that simplify defaults and repurpose tests. Do not delete cartoon/depth files in the integration commit merely for cleanliness.
5. Disable superseded experiments from production defaults first. Removal, if later worthwhile, is a separate reviewed cleanup with exact file/test impact.
6. Replace old visual acceptance gates with this specification's context and event-layer gates while retaining useful renderer diagnostics.
7. Keep implementation commits separable: foundation integration, context configuration, marker proof, real data, selection/preview, clustering, and verification.

This transition is a merge/reconciliation exercise, not a restart. Because `main` and the map branch have both advanced since `56a8ecd`, exact commit mechanics belong in the later formal implementation plan after the spec is approved.

## 33. Superseded Build 3A tasks and specifications

No standalone Build 3A design/plan document was present in the inspected branch trees. The audit therefore identifies superseded work from commit intent, test suite names, code contracts, and current product documents.

Superseded as product requirements:

- making the empty city proprietary or miniature as the principal success gate;
- A2.1 label suppression where it removes useful ordinary POI, street, transit, landmark, or pedestrian context;
- A2.2 fantasy-scale/deepened building massing as a production target;
- cartoon ground/palette and warm-vivid color grading as required defaults;
- dense procedural park trees as a required city-life proof;
- fixed high-pitch/bearing camera as a required visual composition;
- continuing A2.3/A2.4 or other miniature-city elaboration before event-layer proof;
- Playwright gates whose success is defined by cartoon mood, exaggerated depth, or decorative density rather than useful context and event hierarchy.

If an older untracked/external Build 3A plan later appears, this founder-directed specification wins on those conflicts.

## 34. Build 3A work that remains authoritative

The following work remains authoritative unless later implementation evidence finds a defect:

- Mapbox GL JS 3.29.0 integration and real Mapbox Standard geography;
- one persistent Mapbox renderer and mount/unmount ownership;
- environment/public-token validation and token-safe diagnostics;
- renderer readiness/error lifecycle;
- Mapbox attribution/logo compliance;
- Bay Area service bounds and viewport normalization;
- responsive full-viewport map shell and accessible map labeling;
- centralized factory/configuration seam;
- separation of map rendering from domain data;
- stable, local-only visual-scene allowlisting;
- unit and Playwright infrastructure for real renderer proof;
- custom layer/source idempotency patterns and runtime image seam demonstrated by park trees;
- reduced-motion configuration;
- the point-based event direction;
- the existing event-detail directions step/CTA, without adding an in-map routing engine;
- the public RPC → DTO → GeoJSON → Mapbox layer architecture from the technical architecture;
- Mapbox layer/clustering preference over unbounded DOM markers.

## 35. Proposed implementation sequence (not a formal plan)

1. **Reconcile the reusable map foundation onto the current transaction-safe base.** Preserve route, renderer, factory, bounds, security, attribution, shell, and test harness without adopting miniature defaults as immutable.
2. **Establish a useful Standard baseline.** Restore POIs, road/pedestrian/place context; select calm supported colors/density; compare custom versus Standard buildings and readable camera ranges.
3. **Prove cold start before event plumbing.** Capture SF/Oakland desktop/mobile with zero Whereto events and verify normal city utility.
4. **Prove one representative fake Whereto marker.** Load one production-shaped runtime asset and establish layer order, size, collision, hit target, fallback, and selected styling on the persistent renderer.
5. **Build the real public event data seam.** Add the RPC adapter, runtime validation, normalized cache key/race handling, pure GeoJSON conversion, and persistent source updates.
6. **Render real individual events.** Apply category/preset asset keys, temporal presentation state, and click/tap hit layers.
7. **Add selection and preview.** Keep selection keyed by event ID, clear stale selection, fit around overlays, and navigate through the existing event route.
8. **Add clustering and co-location handling.** Use GeoJSON source clustering, expansion zoom, and a deterministic maximum-zoom multi-event affordance.
9. **Add user location and mobile/readability polish.** Make permission user-initiated and non-blocking; tune pitch, POI density, touch, bottom sheet, safe areas, and attribution.
10. **Run production-oriented verification.** Execute unit/integration/browser gates, four cold-start scenarios, reduced-motion/accessibility checks, token/CSP/attribution review, and measured performance checks.
11. **Only then review obsolete experiments for deletion.** Any cleanup is separately scoped and justified; ticketing/payment work remains untouched.

This ordering improves the prompt's likely sequence by proving the zero-event product premise before real event integration and by resolving the diverged branch foundation before visual or data work.

## 36. Remaining founder decisions

No founder decision blocks this specification or the first context-map proof. The following decisions can be made from comparative prototypes before the formal implementation plan is finalized:

1. Which one representative branded marker visual becomes the V1 proof asset.
2. Whether the production default uses subtle custom extrusion, Standard native 3D buildings, or flat buildings at each zoom/mobile class.
3. Whether transit and landmark labels are on by default after hierarchy testing.
4. Whether normal POI taps do nothing or show a minimal transient name/orientation affordance; no business-detail product is implied.
5. The exact “starting soon” threshold and whether it changes marker styling in V1.
6. The compact UI for multiple events at the exact same coordinate after maximum cluster expansion.
7. Final product copy, including whether to adopt “Put your event on the map.”

Recommended defaults are: one static branded generic pin first; lower-pitch camera; moderate POI density; Standard native context; custom extrusion only if it clearly improves comprehension; no normal-POI product interaction; and a compact multi-event list for exact co-location.

## Review record

An independent read-only review was completed on 2026-09-04. It found no blockers and verified the repository/history assertions, architecture reuse, RPC description, Standard configuration, Mapbox slot semantics, Search storage restrictions, CSP guidance, attribution, licensing framing, and coverage of all 36 required sections. Its four recommendations were incorporated:

1. measurable provisional performance gates in Section 25;
2. padded viewport queries, response generations, and stable selection rules in Sections 13 and 23;
3. an explicit distinction between excluded in-map routing and the preserved event-detail directions flow in Sections 20, 29, and 34; and
4. a dedicated overlap-enabled selected-marker layer and browser test contract in Sections 15–16 and 27.

The review made no production code changes and did not authorize implementation.
