# Spec 15 Phase 1 — event images

## Delivery boundary

Implemented on `codex/spec15-image-upload`, based on GitHub/main commit `d9283d3adcddaacbac8d91e4ac1b146a73fe6676`, in `.worktrees/spec15-image-upload`. No commit, push, hosted migration, function deployment, provider operation, or Vercel deployment was performed. The hosted application does not have this feature yet.

## Organizer experience

- Create: **Event Details**, following Ticket Type/tiers, once the event has a durable draft ID. Basics explains where to add images.
- Edit: the first **Basics** step, below the existing event fields.
- Select one or multiple local files; JPEG/JPG, PNG and WebP only, maximum three attachments, 5 MiB each and 40 million pixels.
- Immediate local thumbnails, saving/error/retry states, remove controls, and accessible move-earlier/move-later controls. Position 1 is primary.
- Image changes save immediately to the event, independently of unsaved text fields. Saving a draft/reopening preserves the attachment order.
- Organizer preview shows persisted images. Public event hero uses primary; remaining images appear below the description. Discovery cards use primary. Events without images retain existing presentation.

## Storage and authorization

One additive migration: `supabase/migrations/20260919010100_add_event_images.sql`.

- Private Supabase Storage bucket `event-images`; no public bucket or anonymous Storage SELECT.
- Immutable server-generated paths: `<event UUID>/<image UUID>.<extension>`.
- `private.event_images` ties Storage object ID to event ID and position 1–3. Event-row locking plus a deferred unique ordering constraint enforce the limit under concurrent uploads.
- Owner-only Storage SELECT/DELETE policies. No authenticated INSERT/UPDATE; uploading goes through the validating Edge Function, preventing direct Storage bypass. Storage deletion cascades the attachment and compacts surviving positions. Uploads append after survivors.
- Narrow RPCs list authorized metadata, reorder a complete owner-owned list, and perform service-only ownership/public-eligibility checks. No new broad service-role table privileges.
- `event-images` POST checks exact `APP_BASE_URL` origin, verifies the JWT with Auth, checks event ownership/state, bounds streamed bytes, validates raster signatures/container/dimensions (including PNG CRC), and writes through Storage. The browser also decodes selected images before sending. This is format validation, not image-content moderation or a complete server pixel decoder.
- Public GET checks canonical public eligibility on every request and returns bytes with `no-store`/`nosniff`. Drafts, cancelled/removed/ineligible events and deleted images cannot be fetched through it. No public signed-URL minting. Owner previews use short 60-second signed URLs; owner query data is evicted across identity changes.
- Public image metadata queries use anonymous requests without organizer Auth context/credentials. They cannot expose an owner's drafts while browsing public routes.

Existing event publication, payment, admission, ticket and delivery authorities are unchanged. All 124 historical migration files remain byte-identical. No runtime worker/checkout/cron switch is enabled by this migration.

## Verification performed

Disposable local Supabase stack only: `wheretoo-spec15-images`, API `127.0.0.1:55321`, DB port `55322`; frontend `127.0.0.1:3050`. Other source worktrees and Spec 14 scenario data were untouched.

- 135 focused frontend tests: image validation/manager/API/public no-Auth reader, create/edit, preview/publish, discovery, public paid/free event page, private-cache boundary and router.
- 6 Deno image-format tests; Edge Function typecheck.
- 18 pgTAP assertions: private bucket, durable attachments, limits, MIME/size constraints, primary order, stale-order rejection, foreign/anonymous boundaries, removal and service-only grants.
- 31 real HTTP checks against Auth, PostgREST, Storage and the Edge Function: one/three/fourth, concurrent cap, foreign upload/reorder/delete, draft privacy, canonical publish, real public image bytes, public signing denial, direct-upload bypass denial, disguised/oversized uploads, wrong origin, anonymous writes, removal/order compaction, overwrite rejection and immediate public denial after cancellation.
- Exact additive migration applied successfully in a rollback-only rehearsal after removing only its own objects within that transaction; existing disposable scenario restored by rollback.
- Actual browser: PNG, JPEG and WebP uploads; loading thumbnails; unsupported SVG rejection; three-image limit; primary reorder; removal; save draft; leave/reopen/full reload with same order; persisted preview; explicit publish; signed-out public hero/secondary image; discovery primary image. Decoded rendered images reported 640×400. Published-event edit upload also verified. Desktop screenshots inspected; mobile 390px edit/public/discovery checked without document overflow.
- Full repository typecheck, lint and production build. `git diff --check`.

Reproduction commands (isolated environment only):

```sh
corepack pnpm@11.19.0 run typecheck
corepack pnpm@11.19.0 run lint
corepack pnpm@11.19.0 run build
corepack pnpm@11.19.0 exec vitest run src/features/event-images src/features/events/EventEditorPage.test.tsx src/features/events/EventPreviewPage.test.tsx src/features/discovery/DiscoveryPage.test.tsx src/features/tickets/PublicTicketEventPage.test.tsx src/features/auth/privateQueryCache.test.ts src/app/router/router.test.tsx
corepack pnpm@11.19.0 exec deno test supabase/functions/event-images/imageBytes.test.ts
corepack pnpm@11.19.0 exec deno check supabase/functions/event-images/index.ts
python3 tests/integration/spec15-storage.py
```

The HTTP proof intentionally refuses any API URL except the dedicated local port and writes disposable test fixtures. Run the SQL pgTAP file in that local DB with `ON_ERROR_STOP=1`; it rolls back.

## Hosted rollout still required

After separate rollout authorization: apply only the new migration to `oznjmliqnczotunksafx`, deploy only the new `event-images` function with the existing root Deno import map and `verify_jwt=false` (POST authorization is in-function), then deploy the reviewed frontend source. Function config declares its import map. It uses existing platform Supabase URL/service credentials and the existing exact `APP_BASE_URL=https://wheretoo-staging.vercel.app`; no new provider secret or activation is required. Verify Storage upload/canonical public read on the hosted origin before calling hosted delivery complete.

## Phase 1 limits / deferred work

No AI generation, URL fetching/import, flyers, editing studio, crop tools, image moderation provider, transforms or CDN thumbnail variants. Import means selecting local image files. Images are served at original size, bounded to 5 MiB; public delivery intentionally avoids CDN caching to preserve eligibility checks. A viewer cannot be made to forget an image already downloaded. Removing an image uses Storage's normal delete API; it is not a trash/recovery UI. Whole-event hard-deletion orphan-file maintenance is not added (objects stay private/inaccessible if the event ceases to exist); there is no new cleanup job.

## Changed files

- `src/features/event-images/`: upload UI, gallery, owner/public transport and queries, validation, records, styles and focused tests.
- `src/features/events/{EventDetailsStep,EventEditorPage,EventPreviewPage}.tsx`.
- `src/features/discovery/DiscoveryPage.tsx` and its test.
- `src/features/tickets/PublicTicketEventPage.tsx` and its test.
- `src/features/auth/privateQueryCache.ts` and its test; `src/lib/supabase/database.types.ts`.
- `supabase/config.toml`; `supabase/functions/event-images/`.
- New migration and `supabase/tests/database/spec15_event_images.test.sql`.
- `tests/integration/spec15-storage.py`; this runbook.

No dependency versions or lockfiles changed.
