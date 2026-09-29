# Discovery Experience Redesign V1

Baseline origin/main: a82166c696e1c6b357b9f76c3ffb9fbaf1335b71. Branch codex/discovery-redesign-v1, isolated worktree. Build + Prove only; no commit/push/merge/deploy/hosted data changes.

## Intent and scope ruling

Make actual Wheretoo discovery look derived from the supplied premium dark Bay Area reference: cinematic bridge masthead, editorial serif headline, compact filter controls, image-led feature/poster cards and useful editorial shortcuts. Use the supplied clean bridge image, never the screenshot with UI baked in. No fake events, availability, popularity or unsupported navigation.

Inspection found no map component/route/marker system or Mapbox GL dependency on current main. DiscoveryItem and strict public response have no coordinates. Mapbox integration is organizer address search only. Founder explicitly chose: “Finish the visual redesign and defer the map, clearly reporting that gap.” Therefore omit a map card/toggle entirely; no placeholder masquerading as a map, new map architecture, geocoding or backend extension. Map integration and map browser selection proof are deferred, not PASS.

## Existing truth

DiscoveryPage at /discover uses useDiscovery and canonical public-discovery POST transport. It parses/canonicalizes URL parameters, maintains cursor pages, deduplicates IDs, drops ended events against server time, handles invalid rows/rate limits/refresh/restart, and stores public discovery return state/scroll on event navigation. Public images come separately from list_event_images and controlled public delivery. Preserve those API/security authorities; first-page and appended image lookups are separate to protect featured selection.

Supported filters: upcoming (30 days), today, weekend; eight canonical categories; free/paid admission. Region is fixed sf_bay_area, not selectable neighborhoods/cities. No tonight-specific query, description field, favorite count, reliable live open prices, or map coordinates. Existing highlight requires open admission and artwork, so live unknown-admission events never become featured. Change display selection only: first first-page eligible result with artwork, else first first-page result; never imply ticket availability. Keep feature stable across pagination. Event CTA remains View event, with existing honest Free/View prices status.

Old page: narrow 1040px shell, split oversized headline/SVG poster masthead, rows of filter chips, conditional feature and vertical event rows, mobile bottom navigation.

## Design

Palette: ink #080b10, panel #11151e, border #343744, white #f5f2fa, muted #b7b6c5, purple #a78bfa (primary CTA #7952e8). Display: Georgia/Times serif, bold restrained tight tracking; interface existing Manrope; wordmark existing brand treatment, no font dependency. Signature: real Bay Bridge night panorama fading into event posters.

Composition:

    brand / Discover / Organize                      SF Bay Area
    [bridge panorama, dark left/bottom overlay]
    BAY AREA EVENTS · CURATED FOR REAL LIFE
    Find somewhere worth going.
    concise supporting copy
    [fixed region] [date] [category] [admission]    Explore events
    [Featured: title/date/place/CTA | real poster imagery]
    Events in the Bay / Today in the Bay / This weekend in the Bay
    [poster][poster][poster][poster][poster][poster] (remaining results)
    pagination/recovery
    [This Weekend][Free Events][Music][Food & Drink]

Native select controls expose existing exact filter values and automatically update canonical URL/query. Explore events is an anchor to results (no fake search submit). Fixed region is text, not a disabled fake location selector. Clear filters stays available for nondefault state. Shortcuts are real /discover query links that use existing interception/navigation; each is a deliberate standalone filter destination.

Feature uses a split text/art composition so full existing poster can remain contained without losing artwork. No description when unavailable. Cards use consistent compact 4:3 frames, contain existing poster artwork, category/title/date/place/admission and View event. Branded category fallback for missing/failed images; reset naturally for changed URL. No duplicated featured event in row. Sparse/single result stays intentional, no fabricated fillers.

Hero asset: supplied 2103×748 clean PNG (approximately 2.81:1), converted to optimized local JPEG without content edits; isolated import in DiscoveryView. Suggested replacement >=2400×900. Desktop object-position 65% center, mobile 66% center; dark overlay always behind copy. Decorative alt empty; intrinsic dimensions reserved, eager high-priority. Cards below feature lazy-load; no new dependencies or providers.

Desktop max width1440, gutters clamp20–52px. Hero natural padding, no fixed viewport assumption. Feature split; poster rows6 columns at wide width,4 tablet and horizontal snapping cards on mobile. Mobile390: native filter2-column wrapping, hero readable around42px, feature stacks with artwork, header navigation kept touch-accessible, horizontal card scrolling contained (no page overflow). Shortcuts2×2mobile,4desktop. Reduced-motion disables optional transitions/smooth scroll.

Loading skeleton approximates feature + poster row, distinct empty vs backend error with retry. Existing rate-limit timers and pagination failure controls retained. Semantic headings, labelled selects, visible focus,44px controls, decorative image alt and descriptive event links. No animation library or new font/download.

## Verification

Focused display selection tests (unknown price never becomes fabricated availability, first-page stability), filters/all categories/shortcuts, fallback media, loading/empty/rate limit/pagination, canonical return path and public image association. Real browser /discover with injected public transport on localhost at1440/390: full artwork, missing/broken artwork, empty, loading, error/retry, free/weekend filters, cursor append, event navigation/return state. Inspect full screenshots and geometry. No hosted fixture writes/provider calls. Map proof explicitly deferred by founder.

Run full frontend/functions, both typechecks, lint/build; no SQL/migration work because backend unchanged. Final fresh independent review via inline execution workflow; leave uncommitted.

Self-review: matches visual hierarchy within explicit map deferral; no invented filters/features, prices, descriptions or event data. Existing query/navigation/image authority preserved. Risks: selection changes across image refresh, carousel overflow/keyboard focus, selectors in old tests, preview snapshot updates.

## Browser-driven refinements

Cards use compact 4:3 artwork frames with object-fit: contain; this matches the reference density while preserving full artwork. The mobile card row stores a bounded horizontal scroll offset in the existing public history entry and restores it on browser Back, alongside the existing page scroll. No private state or backend contract is added.

## Reference relationship inventory

Reference is 1448×1086: approximately 51px (3.5%) main gutters, 55px top shell, ~60px serif headline against ~14px body, compact 42px filters, featured/map row at y289–579, six ~212px cards, four secondary shortcuts. New page retains 52px desktop gutters, serif/sans hierarchy, image masthead, compact filters, six-card desktop grid and four shortcuts. Deliberate adaptations: current brand/navigation only; full-width feature because map is founder-deferred; poster containment avoids cropping event information; metadata expands for actual canonical schedule; pagination remains visible. Mobile stacks the feature and uses a contained touch-scroll row.
