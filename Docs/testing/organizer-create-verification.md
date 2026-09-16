# Organizer Create Event verification — 2026-09-10

## Delivery and isolation

- Worktree: `/Users/exoh/Desktop/WhereTo-organizer-create`
- Branch: `codex/organizer-create-flow`
- Starting and final HEAD: `1d87c88fbb9da4ea4bf335659de7623af084c92e`
- No commit, merge, reset, squash, or staging of inherited changes.
- Original repository remains on `main` at the same HEAD. All 577 original-workspace baseline entries still match `.organizer-create-work/baseline.json` (including inherited deletions).
- Baseline source copies were byte-verified into `baseline.tar.gz` before removing duplicate source copies from test discovery. `baseline.json`, `inherited.patch`, and the ledger remain available.
- Incremental patch: `.organizer-create-work/organizer-create-only.patch`. This excludes inherited Buyer Journey/Organizer Onboarding changes. Full `git diff HEAD` also contains those inherited changes and must not be committed wholesale.

## Paid flow result

Basics validates before continuing and permits partial draft saving. Date & Location persists normalized verified addresses and dates. Ticket Type saves paid admission before navigating to the same owned event’s tiers. Draft tier saving retains IDs, slot order, maximum three tiers, prices, and inventory validation. Incomplete Stripe does not prevent tier continuation. Event Details saves event/disclosures, refreshes canonical state, accepts current policies, and then enters persisted preview. Dirty disclosures survive backward navigation into tier setup. Paid drafts with saved tiers resume at Details.

Preview uses owned persisted events and retained draft tiers; Event Page and Ticket Selection are inspection only. No checkout or inventory reservation is invoked. First Publish enters confirmation with zero publish mutations. Final confirmation refreshes canonical inputs and invokes the existing publish RPC once, guarded against duplicate clicks. Existing published-event editing remains on the revision path.

## Free flow result

Free RSVP skips tier editing and the paid Ticket Selection tab. It preserves optional event capacity and uses the same required disclosures/agreement sequence. Browser tests prove Ticket Type → Details → Preview with zero tier reads/writes; persisted free preview → confirmation → publication is also verified. Free RSVP buyer fulfillment was not added or modified.

## Stripe handoff and resume

The existing embedded Connect journey is reused. Handoff begins from persisted preview; draft and tiers are already saved. The payments return parameter must be a valid owned event UUID. Entry refreshes canonical Connect status, embedded exit refreshes it again, and Return/Do this later rechecks owner and status before navigating to the same event preview. No auto-publish, event creation, or status demotion occurs. Failed ownership/status checks prevent return. Eight unit cases and a browser handoff/resume case cover these boundaries. Standalone Organizer Onboarding behavior remains intact.

## Publication truth

Only a fresh matching public-eligibility response for a freshly checked published owner row shows “Your event is live!”. Under review and unavailable outcomes do not show the public-event action. Eligibility lookup errors show “Public availability unconfirmed” and a read-only retry. Publish errors reconcile the owner row: persisted publication routes to outcome, confirmed draft may retry, ambiguous lookup failure requires Check status before retry. Save as Draft preserves the existing draft by reconciliation/navigation; it never demotes a published event or inserts another event.

## Date, map, and artwork

The read-only minimap uses normalized coordinates and the existing public Mapbox token with the [Mapbox Static Images API](https://docs.mapbox.com/api/maps/static-images/). The browser’s image error handler removes a failed map and keeps the verified address and Continue usable. No marker dragging or new location model was introduced.

Real artwork upload is the remaining feature blocker. Existing HTTP(S) artwork is displayed only when actually present. There is no simulated upload, fabricated image, writable artwork form field, or permission widening. No migrations were added. The existing canonical publication/moderation rules still apply to events with artwork.

Scoped backend/storage work required to unblock upload:
1. Add tracked storage migration(s) for an event-artwork bucket and owner/event-bound policies, accepted MIME types, size limits, and immutable object paths.
2. Add a narrow authenticated owner RPC/server endpoint to authorize upload and finalize attachment/replacement/removal on that event. Preserve draft/revision rules and invalidate moderation and policy acceptance when content changes; do not grant broad event-column updates.
3. Verify uploaded bytes and durable object identity server-side; provide genuine image input to moderation and preserve fail-closed public eligibility.
4. Supply a supported owner/public image URL resolution contract, orphan/replacement cleanup, and tests for cross-owner access, spoofed/oversized files, failed uploads, and revision/moderation races.
5. Only then wire the real picker, upload/progress/retry/remove UI and browser verification.

## Final verification

All frontend commands used inert public Supabase/Mapbox/Stripe environment values. No secrets or live checkout credentials were needed.

| Command / proof | Final result |
| --- | --- |
| `pnpm typecheck` | Pass; app, integration, E2E, scripts |
| `pnpm lint` | Pass; zero errors/warnings |
| `pnpm test` | 966 passed, 93 files, zero failures |
| `pnpm test:build25` | 346 passed, 27 files, zero failures |
| `pnpm test:functions` | 219 passed, zero failures |
| `pnpm typecheck:functions` | Pass |
| `pnpm build` | Pass |
| `git diff --check` | Pass |
| `pnpm exec playwright test --config tests/e2e/organizer-create.config.ts` | 10 passed; isolated browser request fixtures |
| Safe integration runner contracts | 20 passed, 5 files |
| Disposable Postgres proofs | 419 TAP assertions passed, 9 SQL files |

Browser coverage: paid/free saved preview and confirmation/live at 390px and 1440px; failure/retry/under-review/lookup-failure at both widths; saved paid wizard and canonical agreement sequence at both widths; Stripe handoff/resume; free branch skipping. Screenshots were opened and inspected. Geometry checks caught and then verified fixes for desktop preview column collapse and narrow tier text. Map network failure was deliberately exercised. Evidence is in `test-results/organizer-create/`; logs are in `.organizer-create-work/`.

Disposable database: a uniquely named task-owned container from `public.ecr.aws/supabase/postgres:17.6.1.155`, with no host port or shared volume. All 91 repository migrations were applied transactionally; development policy configuration was set only there. Nine rollback SQL suites ran: organizers_events_schema, organizers_events_rls, publish_event, paid_sales, moderation_policy_acceptance, moderation_publish_eligibility, moderation_published_edits, public_eligibility_projections, connect_refresh_sequence. The container and its anonymous volume were removed afterward. Existing local Supabase/operations containers were untouched.

Integration runner contracts: cspContract, e2eEnv, browserEvidence, moderationRunnerContract, waitForApiJwtAcceptance, using `vitest.integration.config.ts`.

Earlier failures were investigated and resolved: stale organizer snapshots were regenerated only for create-event/edit-event/event-preview/ticket-tiers; a CPU-contention timeout in the inherited email-render test passed on the full rerun; disposable policy configuration was supplied before the passing DB rerun. Initial baseline duplicate-discovery counts are not used above. Counts overlap across targeted/full suites and must not be summed as unique tests.

## Skipped checks and remaining limitations

- Shared hosted organizer visual/reset runners were not run: they mutate shared fixture accounts. New isolated browser tests cover this implementation instead.
- Live Stripe onboarding, real money/payment transactions, and real Mapbox tile/address-provider success were not exercised. Browser fixtures intentionally isolate external services; existing API/function/database contracts were verified separately.
- Production dashboard enablement, checkout, buyer fulfillment, refunds, manual check-in, attendee tools, resend tickets, and payment architecture remain outside scope.
- Full visual parity with artwork in the approved reference remains blocked by the storage/moderation work above.
- No manual database or production setup is required for this frontend patch. Deployment still needs the existing approved public environment configuration; nothing was deployed.

## Incremental files changed

- `src/features/events/EventAttendeePreview.tsx`
- `src/features/events/EventCompositionSummary.tsx`
- `src/features/events/EventCreationLayout.tsx`
- `src/features/events/EventCreationOutcome.test.tsx`
- `src/features/events/EventCreationOutcome.tsx`
- `src/features/events/EventDetailsStep.tsx`
- `src/features/events/EventEditorPage.test.tsx`
- `src/features/events/EventEditorPage.tsx`
- `src/features/events/EventPreviewPage.test.tsx`
- `src/features/events/EventPreviewPage.tsx`
- `src/features/events/EventPublishConfirmation.tsx`
- `src/features/events/EventScheduleLocationStep.tsx`
- `src/features/events/PublishedEventPage.test.tsx`
- `src/features/events/PublishedEventPage.tsx`
- `src/features/events/eventCreation.css`
- `src/features/events/eventWizard.test.ts`
- `src/features/events/eventWizard.ts`
- `src/features/events/publishErrors.test.ts`
- `src/features/events/publishErrors.ts`
- `src/features/payments/OrganizerPaymentsPage.tsx`
- `src/features/payments/OrganizerPaymentsReturn.test.tsx`
- `src/features/payments/payment.queries.ts`
- `src/features/tickets/OrganizerTicketTiersPage.test.tsx`
- `src/features/tickets/OrganizerTicketTiersPage.tsx`
- `src/features/tickets/ticket.queries.ts`
- `src/map/preview/EventLocationPreview.test.tsx`
- `src/map/preview/EventLocationPreview.tsx`
- `src/preview/screens.json`
- `src/preview/screens.render.test.tsx`
- `tests/e2e/organizer-create.config.ts`
- `tests/e2e/organizer-create.spec.ts`
- `tests/e2e/organizer-create.support.ts`
- `Docs/testing/organizer-create-verification.md` (this report)
