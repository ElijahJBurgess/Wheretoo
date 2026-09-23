# Organizer Storefront — visual pass proof

Written design specification applied in the existing storefront worktree. This report covers the visual pass only; the original implementation report remains the record for backend and transaction proof.

## Identity and scope

- Branch: `codex/organizer-storefront`
- Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront`
- HEAD remains `dcb39e6c9f1a155782352ac1f79bd3617fff5472`.
- Source of truth: [written design spec](/Users/exoh/Downloads/Wheretoo_Organizer_Storefront_Design_Spec.md), then supplied desktop/mobile images for visual direction.
- Authorization: visual-only source changes and local verification. No SoundCloud; all featured and upcoming flyers remain 4:5 contain. No commit, push, merge, deployment, or shared/production data changes.
- Snapshot: all pre-pass source hashes and fresh 320/390/430/768/1440 screenshots saved under ignored `.superpowers/storefront/design-before/`.
- Hash comparison confirms every pre-existing backend, migration, API, transaction, attribution, routing, and shared UI file is unchanged by this pass. No new migrations, dependencies, fonts, or provider setup.

## Presentation changes

- Constrained 1280px near-black frame; existing Georgia editorial headings/wordmark and Manrope body/UI.
- Wide cover with overlapping circular identity, public URL, compact metadata, and accessible icons for only supported social destinations.
- Events/Merch/About section anchors, with absent sections omitted. Native anchor navigation retains page and transaction routes.
- Featured flyer and information remain adjacent at 390–430px; 320px and enlarged text may stack for readability. Tablet flyer size is bounded to avoid unused space.
- Desktop featured/upcoming columns. First two upcoming cards use portrait images; additional events use compact rows. With more than two upcoming events, Merch and About follow Featured in the left column while the list continues on the right. With two, Merch/About sit alongside each other below the event region. This accommodates the canonical five initial upcoming events without hiding data or creating a large empty left column.
- Mobile upcoming rows retain transaction actions; event titles provide secondary details navigation. Sold Out/Unavailable have readable neutral treatment and no transaction link.
- Three-card merch grid with external-link icons and square image frames; lower merch images lazy-load. Long bios have an identity excerpt and full About text; short bios are not repeated.
- Restrained footer using only existing destinations. No invented Pricing/Help/Privacy route or nonfunctional menu. Existing Load more events stays accurate rather than promising a separate View all page.
- Scoped accent colors retain white CTA text with measured contrast ratios of 6.00, 5.98, 6.35, and 6.02 for violet, blue, rose, and amber.

## Reference relationship inventory and verdict

Measurements refer to the supplied reference's inner page, excluding browser/device mockup chrome.

| Reference relationship | Implementation/verdict |
|---|---|
| Desktop centered content, roughly 3% inner side inset | Matched with 1280px maximum and 24–32px desktop padding |
| Compact Wheretoo header, branding below it | Matched; real existing destinations only |
| Cover width/height about 5.5:1 desktop, about 2:1 phone | Matched direction: up to 260px desktop, 190px phone; cover crop is allowed by written spec |
| Circular logo overlaps roughly half its height | Matched: 132px/-68px desktop; 104px/-54px mobile |
| Serif organizer/section/event headings, sans metadata | Matched using existing font families; no package added |
| Featured and upcoming occupy approximately equal desktop regions | Matched; adaptive continuation for five events described above |
| Featured artwork around 42–46% mobile width, information adjacent | Matched at 390/430; controlled stack at 320 and 200% text |
| All event artwork portrait and uncropped | Written spec takes priority: 4:5 contain for every flyer, including upcoming and missing-image footprint |
| Merch three across, square product frames | Matched; reflows at large text sizes |
| Mobile sequence identity → events → merch → about → footer | Matched; no independent tab-routing system |
| Screenshot-only SoundCloud/landscape flyers and invented descriptors | Deliberately omitted per written scope |

Synthetic local artwork differs from the Midnight Ritual reference by design. The implementation supplies structure; organizer-uploaded cover/logo/flyers supply the brand. No screenshot was baked into the product, and no test artwork was added to production assets.

## Verification

Current-render status: **verified locally**. Fix-closure status: **verified locally**. Hosted delivery: **not applicable / not deployed**.

Canonical target: `http://127.0.0.1:3070/night-sessions`, existing Vite process serving this worktree, dedicated local Supabase project `wheretoo-storefront` (API 57321). Actors: anonymous visitor and signed-in fixture owner. Real proof uses canonical published events and private image delivery. The added cover was uploaded to the test organizer through the existing owner API. Presentation-only empty/long/sold-out cases intercept DTO copies in a separate browser context; they do not change database truth.

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `pnpm test` | 195 files / **1,656 passed**, 0 failed |
| Storefront-focused frontend tests | 8 files / 56 passed, 0 failed |
| `pnpm build` | Passed |
| Existing storefront browser proof | 16 checkpoints passed, 0 page errors |
| Additional design browser proof | 11 checkpoints passed, 0 page errors |
| Actual diff and source boundary comparison | Passed |
| `git diff --check` | Passed |

The full frontend suite includes existing checkout, RSVP, ticket/access, organizer, discovery, auth/session, and storefront tests. No shared components or backend source changed, so backend SQL/function suites were not rerun for this visual-only pass; their prior proof remains in IMPLEMENTATION_PROOF.md.

Browser journeys re-proved: canonical tier selection → checkout review, actual local RSVP confirmation, pagination, safe external merch links, public share fallback, owner event picker, real owner preview, unpublish/absent response equivalence, and republish. No hosted Stripe charge or webhook was exercised.

Visual checks: 320, 390, 430, 768, 1024, 1440px; all flyer geometries; loaded public images; 200% text reflow; keyboard anchor activation and visible focus before navigation; reduced motion; missing cover/links/merch; published-empty state; long organizer name/bio; missing flyer; sold-out/unavailable treatment. Screenshots were opened and inspected, including lower sections. The first focus assertion incorrectly checked the original anchor after native navigation moved focus; corrected to inspect keyboard focus before activation, then verify navigation separately. Final source review also moved the Events anchor from a desktop `display: contents` wrapper to the visible grid container; the browser proof now checks return-to-Events scrolling at desktop width.

Known limits: Chromium viewport emulation and text-size doubling are not a real-device native share-sheet test. Existing inherited jsdom navigation diagnostic still prints during the full suite, without a failed assertion. Hosted verification remains unchanged from the original implementation report. No manual setup is needed for this source-only pass.

## Screenshots

- [320px](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/public-320.png>)
- [390px](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/public-390.png>)
- [430px](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/public-430.png>)
- [Tablet](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/public-768.png>)
- [1024px](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/public-1024.png>)
- [Desktop](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/public-1440.png>)
- [200% text](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/text-200.png>)
- [No optional sections / no events](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/empty-390.png>)
- [Long text / sold out / missing flyer](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-proof/long-soldout-390.png>)

## Files changed in this pass

- [src/features/storefront/StorefrontView.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/src/features/storefront/StorefrontView.tsx>)
- [src/features/storefront/storefront.css](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/src/features/storefront/storefront.css>)
- [src/features/storefront/StorefrontIcon.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/src/features/storefront/StorefrontIcon.tsx>)
- [src/features/storefront/StorefrontMedia.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/src/features/storefront/StorefrontMedia.tsx>)
- [src/features/storefront/StorefrontShare.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/src/features/storefront/StorefrontShare.tsx>)
- [src/features/storefront/StorefrontView.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/src/features/storefront/StorefrontView.test.tsx>)
- [tests/e2e/storefront-design-proof.mjs](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/tests/e2e/storefront-design-proof.mjs>)
- [Docs/storefront/DESIGN_PASS_PROOF.md](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/Docs/storefront/DESIGN_PASS_PROOF.md>)

## Local logs

- [design-typecheck.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-typecheck.log>)
- [design-lint.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-lint.log>)
- [design-tests.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-tests.log>)
- [design-focused.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-focused.log>)
- [design-build.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-build.log>)
- [design-browser.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-browser.log>)
- [design-visual.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/design-visual.log>)
