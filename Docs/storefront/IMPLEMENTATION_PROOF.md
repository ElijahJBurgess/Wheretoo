# Organizer Storefront — implementation and local proof

Implemented all six approved phases plus the late social-metadata integration. Local verification is complete. Production deployment and hosted provider verification were not performed.

## Delivery identity

- Branch: `codex/organizer-storefront`
- Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront`
- Exact final HEAD: `dcb39e6c9f1a155782352ac1f79bd3617fff5472` (approved baseline, unchanged).
- Changes are unstaged and uncommitted. No commit, push, merge, production deployment, shared-database write, or provider activation occurred.
- AI-cover, CSV-export, product-polish, map, recovery, and older storefront worktrees were not integrated or edited.

## What changed

1. Required onboarding logo/avatar and permanent normalized handle; reserved-route checks, database uniqueness, atomic claims, timestamp, immutable handle, and draft status.
2. Public `/:organizerHandle` reads canonical eligible events, one featured event with automatic fallback, five initial upcoming events, and bounded pagination. Sold-out cards retain honest state without purchase CTA. Empty published storefronts stay published.
3. Paid and free CTAs use existing ticket-selection and RSVP routes. No new inventory, checkout, payment, ticket, refund, or admission authority was introduced.
4. Owner editor with branding, approved social destinations, featured selection, optimistic concurrency, session fences, shared draft protection, publishing, and full-width owner-only preview using the same renderer and initial pagination as public.
5. Up to three external merch cards, optional store link, owner media cleanup, and Web Share → clipboard → selectable public URL fallback.
6. Isolated best-effort visits/ref labels/CTA starts and immutable event-scoped transaction associations. Latest valid visit, 30-day lifetime, frozen first submission per attempt, private owner insights, completed-order item gross grouped by currency. Gross is explicitly before refunds and is not a payout balance.
7. Narrow Vercel Node HTML handler injects escaped public title/description/canonical/social-image metadata into the existing built SPA. Missing/draft storefronts share the not-found response; metadata failures preserve the SPA. No hosting framework replacement.

## Migrations

Only new migrations were added; historical migrations were not edited.

| File | Purpose |
|---|---|
| `20260924010000_add_storefront_identity.sql` | Handle/identity, logo media, private Storage bucket, atomic claim and immutable guard |
| `20260924010100_add_storefront_event_read.sql` | Canonical event aggregation, featured fallback, bounded cursor |
| `20260924010200_add_storefront_editor.sql` | Branding/social validation, owner editor, versioned save/publish, paginated preview |
| `20260924010300_add_storefront_merch.sql` | Bounded merch, owner image checks, referenced-image deletion protection |
| `20260924010400_add_storefront_attribution.sql` | Private visits/starts/source association, rate limits, owner insights |

Migration numbering avoids the observed CSV and AI-cover ranges. Final clean replay applied the complete repository migration history and all five new migrations successfully in dedicated local project `wheretoo-storefront` (API 57321 / database 57322). The local harness reproduces existing platform default grants and grants its local postgres role permission required by inherited corruption-detection tests; neither is an application/hosted migration.

## Verification results

| Verification | Result |
|---|---|
| Full frontend suite | 195 files, **1,654 tests passed**, 0 failed |
| Final affected frontend rerun after preview refinement | 30 files, **290 tests passed**, 0 failed; overlaps the full suite |
| Metadata unit rerun after moving tests outside the deployable API directory | **3 passed**, 0 failed; overlaps the full suite |
| Full edge-function suite | **365 passed**, 0 failed |
| Isolated SQL regression suite | 33 suites, **829 assertions passed**, 0 failed |
| Real browser storefront proof | **16 checkpoints passed**, 0 page errors |
| Real Auth/Storage/ownership/race HTTP proof | **17 checks passed** |
| Built-template metadata HTTP proof | **11 assertions passed** against the real local public DTO |
| Frontend/integration/E2E/script typechecks | Passed |
| Edge function typecheck | Passed |
| ESLint | Passed |
| Production build | Passed |
| Clean migration replay | Passed |
| Actual diff review / `git diff --check` | Passed; nothing staged |
| Changed-file secret-pattern scan | Passed; local env, stack files, logs, screenshots remain ignored |

The inherited jsdom auth test emits “Not implemented: navigation to another Document”; assertions still pass. No failed assertion is suppressed.

## Transaction and security proof

- Paid browser journey enters `/events/:id/tickets`, selects a canonical tier, and opens existing checkout review. Canonical SQL receipt/fulfillment proof produces the same paid order and three shared tickets. Existing reservation, fulfillment, collection, refund, cancellation, redemption, manual admission, and owner-operation suites pass. No hosted Stripe charge or webhook delivery was exercised.
- Free browser journey calls the actual local `free-rsvp` endpoint and reaches “You’re on the list.” A subsequent database query proves one confirmed registration, one valid shared ticket, and one durable attribution association, still intact after storefront unpublish/republish.
- Handle race proof has exactly one winner and an actionable loser; retries cannot rename the handle or overwrite later branding.
- Public projection omits private owner/contact/payment/admission data. Draft and absent handles are indistinguishable; private image reads reject anonymous and foreign owners.
- Anonymous/cross-origin/SVG/forged-MIME/oversized uploads are rejected. Cleanup deletes unused media and preserves referenced logo/merch images.
- Unpublishing affects storefront visibility only. Canonical event and transaction lifecycles remain authoritative.
- Pending checkouts add no paid gross. Expired, foreign, invalid, or failed measurement does not reject valid purchases/RSVPs. Repeated association calls cannot reassign a source. Public clients cannot read insights or attach transaction sources.

## Independent review and fixes

A separate reviewer inspected migrations/grants, public DTOs, identity, owner authorization, canonical event visibility, image ownership, URLs, routing, checkout/RSVP reuse, attribution, metadata, and responsive code.

Resolved findings:

- Paid attribution now includes verified event ID, matching canonical request scope.
- Returning to a previous ref creates a fresh latest visit instead of reviving cached context.
- Legacy unsafe website URLs are sanitized on owner read so the editor remains usable.
- Website input follows the existing 500-character database bound.
- Integration proof caught authenticated organizer INSERT failing new CHECK validator permissions. Only pure validator EXECUTE grants were added; private schema/table access remains restricted. Existing RLS and profile writes, including nonempty social links, pass.
- Identity claim retry is read-only after confirmation; it cannot replace later branding.
- Featured choices and owner preview paginate; preview now matches public width and initial card count.
- Visual proof fixed inherited CTA text color, native unstyled merch fields, narrow-width expansion, zoomed merch reflow, and preview return-link contrast.
- CSP permits blob image URLs only in `img-src`, required by authenticated owner previews.
- Existing exact routing/CORS tests were updated for the intentional additions. Stale preview HTML fixtures were regenerated from current components. A date-sensitive dashboard test now fixes its clock. A flaky email-copy test excludes random URL bearer text when checking the letters “QR.” No underlying transaction/email behavior was changed for these fixture corrections.

## Visual proof

Current-render status: **verified locally**. Delivery status: **not applicable to hosted production**. Fix-closure status: **verified on the local target**.

Target: loopback `http://127.0.0.1:3070/night-sessions`, actual Vite source in this worktree, backed by the dedicated local database/Auth/Storage stack. Data: synthetic test-only organizer, 26 canonically published events, real private raster uploads, three external merch links. Actor states: anonymous public visitor and signed-in owner. Authorization: approved local implementation, fixture-safe testing, and fix/recheck. No real customer data or hosted writes.

Inspected public screenshots at 320, 390, 430, 768, and 1440px plus 200% text sizing. Owner editor exercised at all five widths. Geometry checks compare against the actual visual viewport, avoiding mobile viewport-expansion false passes. Flyers remain 4:5 with `object-fit: contain`, dark mats, and visible top/bottom border labels; featured flyer and information stay adjacent. Text zoom reflows merch and the header without horizontal overflow. Keyboard/semantic controls follow existing form/link patterns; native mobile share-sheet behavior is not claimed from headless Chromium.

- [320px public](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/screenshots/public-320.png>)
- [390px public](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/screenshots/public-390.png>)
- [430px public](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/screenshots/public-430.png>)
- [Tablet](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/screenshots/public-768.png>)
- [Desktop](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/screenshots/public-1440.png>)
- [200% text](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/screenshots/public-text-200.png>)
- [Owner editor](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/screenshots/editor-390.png>)
- [Private preview](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/screenshots/owner-preview.png>)

## Remaining hosted/provider steps and limitations

No known local implementation blocker remains. Release verification still needs a separately authorized staging/production deployment:

- Apply the five migrations and deploy `organizer-media`, `storefront-telemetry`, and changed checkout/RSVP functions together with the frontend.
- Set/verify trusted `APP_BASE_URL` for exact-origin behavior and server canonical URLs; the metadata function also needs the existing public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Existing privileged edge credentials remain server-only.
- Verify Vercel routing/function packaging and public crawler responses on the deployed hostname. The Node handler and built template were proven locally; Vercel deployment was not run. Configuration follows official [Vercel rewrites](https://vercel.com/docs/routing/rewrites) and [function includeFiles](https://vercel.com/docs/project-configuration/vercel-json) documentation.
- Run a Stripe test-mode hosted purchase through signed webhook delivery, then confirm storefront attribution and existing refund/admission behavior in that environment. Local canonical SQL/provider-fixture proofs are not a claim of live Stripe completion.
- Native Web Share sheets require device/OS verification. Clipboard and selectable-link fallbacks are covered.
- Attribution is deliberately best effort; blocked storage/network or unavailable measurement may undercount. This never changes transaction truth. Insights are all-time counts with bounded top-50 ref labels, not financial reconciliation or payout accounting.

Local reproduction uses the dedicated harness `tests/integration/storefront-local.py`; never substitute a linked/shared project. Test setup scripts and synthetic artwork are confined to tests and ignored local proof output.

## Database suites

| Suite | Passed assertions |
|---|---:|
| `checkout_integrity_fulfillment.test.sql` | 37 |
| `checkout_integrity_refunds.test.sql` | 32 |
| `checkout_integrity_reservation.test.sql` | 49 |
| `core_ticket_truth_lite_collection.test.sql` | 40 |
| `core_ticket_truth_lite_fulfillment.test.sql` | 35 |
| `core_ticket_truth_lite_redemption.test.sql` | 45 |
| `free_registration_behavior.test.sql` | 31 |
| `free_registration_integrity.test.sql` | 35 |
| `free_registration_lifecycle.test.sql` | 13 |
| `free_registration_schema.test.sql` | 9 |
| `free_registration_security.test.sql` | 32 |
| `moderation_publish_eligibility.test.sql` | 87 |
| `organizer_event_metrics.test.sql` | 34 |
| `organizer_manual_admission.test.sql` | 12 |
| `organizer_onboarding_update.test.sql` | 6 |
| `organizer_order_reads.test.sql` | 23 |
| `organizers_events_rls.test.sql` | 38 |
| `spec09_refund_operations.test.sql` | 26 |
| `spec10_cancellation_summary.test.sql` | 18 |
| `spec10_refund_summary_states.test.sql` | 14 |
| `spec11_profile_revision.test.sql` | 7 |
| `spec11_settings.test.sql` | 20 |
| `spec13_discovery_pagination.test.sql` | 15 |
| `spec13_discovery_read.test.sql` | 21 |
| `spec13_discovery_security.test.sql` | 11 |
| `spec15_event_images.test.sql` | 18 |
| `storefront_attribution.test.sql` | 20 |
| `storefront_editor.test.sql` | 16 |
| `storefront_identity.test.sql` | 21 |
| `storefront_merch.test.sql` | 7 |
| `storefront_read.test.sql` | 12 |
| `storefront_transactions.test.sql` | 12 |
| `ticketing_rls.test.sql` | 33 |

## Proof logs

- [final-frontend.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-frontend.log>)
- [final-functions-tests.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-functions-tests.log>)
- [final-database-all.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-database-all.log>)
- [final-affected-tests.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-affected-tests.log>)
- [final-typecheck.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-typecheck.log>)
- [final-lint.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-lint.log>)
- [final-build.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-build.log>)
- [final-functions-typecheck.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-functions-typecheck.log>)
- [final-migration-replay.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-migration-replay.log>)
- [browser-proof.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/browser-proof.log>)
- [final-image-http.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-image-http.log>)
- [final-metadata-http.log](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-storefront/.superpowers/storefront/final-metadata-http.log>)

## Files added or modified

- `Docs/storefront/IMPLEMENTATION_PROOF.md`
- `Docs/superpowers/plans/2026-09-23-storefront-approved.md`
- `src/features/storefront/storefront.metadata.test.ts`
- `api/storefront.ts`
- `eslint.config.js`
- `index.html`
- `src/app/router/OrganizerShell.tsx`
- `src/app/router/router.tsx`
- `src/features/auth/SignInPage.tsx`
- `src/features/checkout/checkout.api.ts`
- `src/features/organizer-operations/OrganizerDashboardPage.test.tsx`
- `src/features/organizer-settings/SettingsLayout.tsx`
- `src/features/organizers/OrganizerSetupPage.presentation.test.tsx`
- `src/features/organizers/OrganizerSetupPage.test.tsx`
- `src/features/organizers/OrganizerSetupPage.tsx`
- `src/features/organizers/organizer.api.test.ts`
- `src/features/organizers/organizer.api.ts`
- `src/features/rsvp/rsvp.api.ts`
- `src/features/storefront/OrganizerStorefrontEditorPage.test.tsx`
- `src/features/storefront/OrganizerStorefrontEditorPage.tsx`
- `src/features/storefront/OrganizerStorefrontPage.tsx`
- `src/features/storefront/StorefrontIdentityPage.test.tsx`
- `src/features/storefront/StorefrontIdentityPage.tsx`
- `src/features/storefront/StorefrontInsights.tsx`
- `src/features/storefront/StorefrontMedia.tsx`
- `src/features/storefront/StorefrontMerchEditor.tsx`
- `src/features/storefront/StorefrontPreviewPage.tsx`
- `src/features/storefront/StorefrontShare.tsx`
- `src/features/storefront/StorefrontView.test.tsx`
- `src/features/storefront/StorefrontView.tsx`
- `src/features/storefront/storefront.api.ts`
- `src/features/storefront/storefront.attribution.test.ts`
- `src/features/storefront/storefront.attribution.ts`
- `src/features/storefront/storefront.css`
- `src/features/storefront/storefront.editor.api.ts`
- `src/features/storefront/storefront.editor.test.ts`
- `src/features/storefront/storefront.editor.ts`
- `src/features/storefront/storefront.handle.test.ts`
- `src/features/storefront/storefront.handle.ts`
- `src/features/storefront/storefront.identity.api.ts`
- `src/features/storefront/storefront.schemas.ts`
- `src/features/storefront/storefront.share.test.ts`
- `src/features/storefront/storefront.share.ts`
- `src/lib/supabase/database.types.ts`
- `src/preview/PreviewApp.test.tsx`
- `src/preview/screens.json`
- `supabase/config.toml`
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/_shared/eventNotice.test.ts`
- `supabase/functions/_shared/freeRsvpHandler.ts`
- `supabase/functions/_shared/shared.test.ts`
- `supabase/functions/_shared/storefrontAttribution.ts`
- `supabase/functions/free-rsvp/index.test.ts`
- `supabase/functions/organizer-media/index.ts`
- `supabase/functions/storefront-telemetry/index.ts`
- `supabase/functions/stripe-create-checkout/index.test.ts`
- `supabase/functions/stripe-create-checkout/index.ts`
- `supabase/functions/ticket-collection/index.test.ts`
- `supabase/migrations/20260924010000_add_storefront_identity.sql`
- `supabase/migrations/20260924010100_add_storefront_event_read.sql`
- `supabase/migrations/20260924010200_add_storefront_editor.sql`
- `supabase/migrations/20260924010300_add_storefront_merch.sql`
- `supabase/migrations/20260924010400_add_storefront_attribution.sql`
- `supabase/tests/database/storefront_attribution.test.sql`
- `supabase/tests/database/storefront_editor.test.sql`
- `supabase/tests/database/storefront_identity.test.sql`
- `supabase/tests/database/storefront_merch.test.sql`
- `supabase/tests/database/storefront_read.test.sql`
- `supabase/tests/database/storefront_transactions.test.sql`
- `tests/e2e/storefront-browser-proof.mjs`
- `tests/e2e/storefront-fixture-art.mjs`
- `tests/integration/storefront-browser-fixture.py`
- `tests/integration/storefront-identity-proof.py`
- `tests/integration/storefront-local.py`
- `tests/integration/storefront-metadata-proof.ts`
- `tsconfig.scripts.json`
- `vercel.json`
- `vite.config.ts`
