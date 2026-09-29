# Discovery Experience Redesign V1 — Build + Prove

Result: **PASS — ready to commit/review for merge within the founder-approved map deferral.** Map is explicitly founder-deferred; this is not a claim of map integration or hosted-provider proof.

The Build + Prove record below is the pre-closeout snapshot. Founder subsequently authorized Git/GitHub closeout; the closeout record at the end supersedes its uncommitted-state restriction.

## Scope and identity

- Branch: `codex/discovery-redesign-v1`.
- Isolated worktree: `/Users/exoh/.codex/worktrees/discovery-redesign-v1/WhereTo -  Repository`.
- Fetched origin/main baseline and unchanged final HEAD: `a82166c696e1c6b357b9f76c3ffb9fbaf1335b71`.
- All feature changes remain uncommitted. No staging, commit, push, merge or deploy performed. Unrelated worktrees preserved.
- Source authority: founder's Discovery Experience Redesign V1 brief and explicit reply, “Finish the visual redesign and defer the map, clearly reporting that gap.”
- Governing spec: `Docs/specs/2026-09-29-discovery-redesign-v1.md`.
- Plan: `Docs/superpowers/plans/2026-09-29-discovery-redesign-v1.md`.

## Requested completion record

| # | Item | Result |
|---|---|---|
| 1 | Status | **PASS** for the approved visual scope; map deferral remains explicit. |
| 2 | Branch/worktree | Above; isolated feature worktree. |
| 3 | Baseline main | `a82166c696e1c6b357b9f76c3ffb9fbaf1335b71`. |
| 4 | Final HEAD/state | Same HEAD; intended changes uncommitted and unstaged. |
| 5 | Old structure | Narrow discovery shell, decorative SVG poster, chip filters and vertical event rows; feature required known-open admission. |
| 6 | New structure | Cinematic bridge masthead, editorial headline, native supported filters, full-width feature, compact poster cards, four real shortcuts. |
| 7 | Files | Inventory below. |
| 8 | Migrations | None. No database changes. |
| 9 | Hero | Full-width dedicated image, cover crop, readable dark overlays, responsive position and safe serif stack. |
| 10 | Bridge asset | `src/features/discovery/assets/bay-bridge-night.jpg`; supplied clean PNG converted to JPEG, 2103×748, approximately 339 KB. Desktop 65% center; mobile 66% center. Replacement recommendation ≥2400×900 wide night image. No concept screenshot pixels shipped. |
| 11 | Filters | Native Date, Category (all eight), Admission controls; fixed SF Bay Area label. Automatic canonical filtering retained; Explore events scrolls to results. |
| 12 | Featured event | First first-page item with artwork, else first first-page item. Unknown admission stays unknown; no invented availability, price, description, rank or counts. Separate first-page image query protects selection through append delay/failure. |
| 13 | Map integration | Deferred by founder. Baseline has no discovery map/marker/cluster route or coordinate response. No fake map, toggle or link added. |
| 14 | Event cards | Single event link per card; canonical image, category, title, schedule, place and honest admission label. Featured event excluded from remaining rows. |
| 15 | Shortcuts | This Weekend, Free Events, Music, Food & Drink → existing canonical filter URLs. |
| 16 | Responsive | Local Chromium 320, 390, 768 and 1440 CSS px; no document horizontal overflow. Mobile horizontal card row; two-column tablet shortcuts. |
| 17 | Mobile screenshot | `.superpowers/discovery-redesign/visual/mobile-390.png`; opened and inspected. |
| 18 | Desktop screenshot | `.superpowers/discovery-redesign/visual/desktop-1440.png`; opened and inspected. |
| 19 | States | Loading skeletons, filtered/unfiltered empty, friendly error/retry, image failure fallback, pagination recovery retained. |
| 20 | Accessibility | Labelled native controls, visible keyboard focus, semantic headings/links, decorative image alt, reduced-motion rule, bounded carousel scroll restoration, 200% text reflow checked. Not a full assistive-technology certification. |
| 21 | Performance/images | Supplied asset optimized locally; no new dependency/provider. Below-fold images lazy; hero eager; canonical public image endpoint and containment retained. First-page and appended image subscriptions retain existing public access/security. |
| 22 | Discovery API regression | Existing API/types/query/filter/eligibility contracts unchanged. Full frontend/function suites and injected production-route pagination/filter tests cover regressions. |
| 23 | Map regression | Not applicable/unverified: absent subsystem, founder-deferred. |
| 24 | Navigation/return | Canonical filter URL, reload, event navigation/Back and public return-state preserved; new bounded horizontal offset restores mobile card position. |
| 25 | Frontend tests | **1,808 PASS**, 219 files, zero failures (final run). |
| 26 | Functions | 432 PASS, zero failures. |
| 27 | Static/build | Frontend typecheck PASS; function typecheck PASS; lint PASS; build PASS (final run). |
| 28 | Baseline failures | No failing assertions in executed frontend/function suites. Legacy SQL inventory not rerun or claimed green. |
| 29 | New regressions | No unresolved feature regression observed. |
| 30 | Hosted/providers | None. No staging data/publication, agreements, Stripe, Mapbox configuration, backend hosting or real AI calls. |
| 31 | Remaining issues | Map integration and map-selection proof deliberately deferred. No hosted-provider/real-device proof claimed. System serif rendering may vary by platform as intended by the brief. |
| 32 | Recommendation | **Yes**, ready for commit/review for merge; leave uncommitted for founder review. |

## Verification evidence and limits

Commands and full outputs are retained locally under `.superpowers/discovery-redesign/`:

- `pnpm test --maxWorkers=3` → frontend-final.log.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` → corresponding *-final.log.
- `pnpm typecheck:functions`, `pnpm test:functions` → functions-typecheck.log / functions.log.
- `pnpm exec playwright test --config playwright.discovery-redesign.config.ts` → browser-final.log, **11 PASS**.
- Focused initial Discovery/preview suite: **50 PASS**. Test-first presentation change: six expected RED assertions before implementation.
- Browser regression RED: horizontal Back reset to 0; fixed and GREEN.
- Independent-review regression RED: later first-page artwork feature changed to first fallback during appended image delay/failure; both cases fixed and GREEN.
- Enlarged-text proof found the long headline word overflowing at 200%; wrapping fixed and re-proven.
- `git diff --check` clean at review; final scope check recorded at completion.

The 11 browser cases exercise production `/discover` with injected canonical responses: artwork/pagination, mobile free/weekend/category/clear filters and event return/reload, no-artwork at 390/1440, empty state, loading/error/retry, broken artwork, carousel Back, keyboard/narrow/tablet/200% text, appended-image delay and appended-image failure. All non-local requests are intercepted or blocked. These are local fixture proofs, not hosted-provider or public staging proofs. Existing preview fixture imagery is test-only and is not inserted into live discovery results.

Existing `tests/e2e/spec13.spec.ts` selectors/counts were adapted to native controls, one featured event and the mobile header. Its disposable database/RSVP harness was not rerun in this visual task; no claim is made that it passed. Free/paid/RSVP/storefront/image-access regression coverage is supplied by the full automated suites; this feature does not change those authorities.

Independent fresh read-only review found one P2 (first-page artwork stability on append). The regression was reproduced and corrected; targeted reviewer inspection confirmed the fix. No remaining actionable review finding.

## Visual audit

Current-render verification: local diagnostic Vite from this exact worktree; anonymous buyer; populated/empty/error/fallback states. Browser config uses port 3042, with service responses injected. Supplementary mechanical preview sweep uses port 3043, `/preview/discovery`, existing local fixture data. Delivery status: not applicable; no deployment/freshness claim.

Reference relationships: 52px desktop gutters approximate the reference's 51px; large serif editorial headline, near-black ground, purple active/CTA accents, bridge panorama, bordered feature, six compact cards and four shortcuts retained. Unsupported navigation, search, social proof and map deliberately omitted. Full-width feature replaces the absent map column. 4:3 contained image frames preserve whole flyers while keeping the reference's compact density. Tablet shortcuts use two columns to avoid broken words. No fabricated production content.

Supplementary sweep: zero page overflow and zero broken/loading images at 390/768/1440. Its nine mechanical “errors” are triaged false positives: intentional full-bleed hero media extending beyond the inner section (three) and the clipped screen-reader-only live count (six). Two image-crop warnings are intentional responsive cover crops of decorative bridge art. The original tablet shortcut orphan warning was fixed. Sweep output is disclosed rather than described as wholly green. Primary production-route screenshots and DOM checks establish the actual layout.

Font probe confirms bundled `Manrope Variable` is loaded. Georgia is a system font and Times New Roman is a platform fallback; generic serif/sans-serif are intentional. The probe's warning about unbundled system serif fonts is expected under the explicit no-new-font-dependency design decision. No library class bridge was introduced.

Screenshot files are local diagnostic evidence, intentionally excluded from the commit candidate. Captures contain synthetic local data only. Final visual identity and image hashes are retained in `.superpowers/discovery-redesign/evidence-identity.json`.

## Changed files

- `src/features/discovery/DiscoveryView.tsx`, `discovery.css`: reference-derived composition and states.
- `src/features/discovery/DiscoveryPage.tsx`: separate first-page/appended public artwork and horizontal scroll restoration.
- `src/features/discovery/discovery.presentation.ts`, `discovery.navigation.ts`: feature selection and bounded public scroll parser.
- `src/features/discovery/assets/bay-bridge-night.jpg`: optimized founder-supplied clean asset.
- `src/features/discovery/assets/discovery-hero.svg`: obsolete unused asset removed.
- `src/features/discovery/DiscoveryView.test.tsx`, `DiscoveryPage.test.tsx`, `discovery.presentation.test.ts`, `discovery.navigation.test.ts`.
- `src/preview/DiscoveryPreview.test.tsx`, `tests/e2e/spec13.spec.ts`: existing expectations adapted.
- `playwright.discovery-redesign.config.ts`, `tests/e2e/discovery-redesign.spec.ts`: isolated browser proof.
- Spec, implementation plan and this governing report.

## Decisions carried to founder

- User instruction overrides intermediate skill approvals/commits: work remains uncommitted. Consequence: integration requires later authorization.
- Card artwork frames changed from the draft plan's 4:5 to 4:3 after screenshot comparison; full images remain contained. Tradeoff: less vertical poster area, more reference-like density.
- Existing public history state was extended with a bounded horizontal offset because the new carousel otherwise lost browsing position. No private state/authorization change.
- No deferred minor review findings. Map is a founder ruling, not a reviewer finding.

No manual setup is required for the visual implementation. Map work requires a separate future product/architecture task. Do not begin it, Homepage or payment readiness in this task.

## Founder-authorized closeout — 2026-09-29

Founder approved commit, push, PR review and merge after passing checks, with map deferral explicitly accepted. Fresh `git fetch origin main` confirms remote main remains `a82166c696e1c6b357b9f76c3ffb9fbaf1335b71`; no reconciliation is needed. Correct feature worktree/branch and clean canonical local main were verified. Source hashes match the completed independent-review/browser-proof snapshot. Intended diff is confined to 18 Discovery source/asset/test/documentation paths; no backend, migration, payment or dependency paths. Unrelated worktrees/files are preserved. `git diff --check` is clean.

Fresh closeout frontend suite, function suite and production build are run before commit; their final outputs and Git/GitHub operation metadata are retained under the ignored `.superpowers/discovery-redesign/` directory. The final user-facing closeout report records feature SHA, PR/check results, merge SHA, canonical main synchronization and automatic staging frontend deployment status. Map proof remains unclaimed.
