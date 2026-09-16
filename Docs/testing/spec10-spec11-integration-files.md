# Spec 10 + Spec 11 integration file inventory

Source comparisons are against the 797-file frozen 08+09 map, not Git HEAD. File-map hashes use SHA-256 of Python json.dumps(files, sort_keys=True), UTF-8. Full status and per-file hashes are recorded in the local snapshot JSON files.

## Spec 10
Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-event-changes`
Branch: `codex/spec10-event-changes`
HEAD: `94c546bd0961f501584f8a3437298b2331cafd5c`
Source files: 861. Snapshot hash: `63e397749d6b7499ee2965c50cc4af435f641cb31553abf058ccea48cb12dd8d`.
Changed files relative to frozen baseline: 102.

| File | Change |
|---|---|
| `Docs/testing/spec10-implementation-verification.md` | added |
| `deno.json` | modified |
| `playwright.spec10.config.ts` | added |
| `src/app/router/router.tsx` | modified |
| `src/features/auth/privateQueryCache.test.ts` | modified |
| `src/features/auth/privateQueryCache.ts` | modified |
| `src/features/buyer-journey/format.ts` | modified |
| `src/features/event-changes/CancellationPanel.test.tsx` | added |
| `src/features/event-changes/CancellationPanel.tsx` | added |
| `src/features/event-changes/CancellationSummary.test.tsx` | added |
| `src/features/event-changes/CancellationSummary.tsx` | added |
| `src/features/event-changes/EventCancellationPage.tsx` | added |
| `src/features/event-changes/EventChangesPage.test.tsx` | added |
| `src/features/event-changes/EventChangesPage.tsx` | added |
| `src/features/event-changes/EventEditorContext.integration.test.tsx` | added |
| `src/features/event-changes/EventNoticePanel.test.tsx` | added |
| `src/features/event-changes/EventNoticePanel.tsx` | added |
| `src/features/event-changes/EventStatusPage.test.tsx` | added |
| `src/features/event-changes/EventStatusPage.tsx` | added |
| `src/features/event-changes/cancellationRecovery.ts` | added |
| `src/features/event-changes/event-changes.css` | added |
| `src/features/event-changes/eventChanges.api.test.ts` | added |
| `src/features/event-changes/eventChanges.api.ts` | added |
| `src/features/event-changes/eventChanges.cache.test.ts` | added |
| `src/features/event-changes/eventChanges.cache.ts` | added |
| `src/features/event-changes/eventChanges.fixtures.ts` | added |
| `src/features/event-changes/eventChanges.queries.ts` | added |
| `src/features/event-changes/eventChanges.schemas.ts` | added |
| `src/features/event-changes/eventStatus.contract.test.ts` | added |
| `src/features/event-changes/eventStatus.public-api.ts` | added |
| `src/features/event-changes/eventStatus.schemas.ts` | added |
| `src/features/event-changes/eventStatus.session.ts` | added |
| `src/features/event-changes/noticeIntent.ts` | added |
| `src/features/event-changes/testEnvMock.ts` | added |
| `src/features/events/EventEditorPage.test.tsx` | modified |
| `src/features/events/EventEditorPage.tsx` | modified |
| `src/features/events/EventPreviewPage.test.tsx` | modified |
| `src/features/events/EventPreviewPage.tsx` | modified |
| `src/features/events/PublishedEventPage.test.tsx` | modified |
| `src/features/events/PublishedEventPage.tsx` | modified |
| `src/features/events/event.api.ts` | modified |
| `src/features/moderation/moderation.api.ts` | modified |
| `src/features/organizer-operations/OrganizerDashboardPage.tsx` | modified |
| `src/features/organizer-operations/operations.late-payment.test.ts` | added |
| `src/features/organizer-operations/operations.schemas.ts` | modified |
| `src/features/rsvp/RsvpConfirmationPage.tsx` | modified |
| `src/features/ticket-delivery/TicketEmailAccessPage.tsx` | modified |
| `src/features/ticket-delivery/delivery.public-api.ts` | modified |
| `src/features/ticket-delivery/delivery.schemas.ts` | modified |
| `src/features/ticket-experience/adapters/adapters.test.ts` | modified |
| `src/features/ticket-experience/adapters/ticketCollectionReader.ts` | modified |
| `src/features/ticket-experience/contracts/ticketCollection.ts` | modified |
| `src/features/ticket-experience/customer/FocusedTicketView.tsx` | modified |
| `src/features/ticket-experience/customer/TicketCollectionOverview.tsx` | modified |
| `src/features/ticket-experience/email/EventCancelledEmail.tsx` | modified |
| `src/features/ticket-experience/email/EventChangedEmail.tsx` | added |
| `src/features/ticket-experience/email/email.types.ts` | modified |
| `src/features/ticket-experience/email/renderEmail.ts` | modified |
| `src/lib/supabase/database.types.ts` | modified |
| `src/preview/screens.json` | modified |
| `src/preview/screens.render.test.tsx` | modified |
| `supabase/config.toml` | modified |
| `supabase/functions/_shared/eventNotice.test.ts` | added |
| `supabase/functions/_shared/eventNotice.ts` | added |
| `supabase/functions/_shared/ticketEmailAccess.ts` | modified |
| `supabase/functions/_shared/ticketEmailHttp.ts` | modified |
| `supabase/functions/_shared/ticketEmailWorker.ts` | modified |
| `supabase/functions/event-status-access/index.ts` | added |
| `supabase/functions/ticket-collection/freeCollection.ts` | modified |
| `supabase/functions/ticket-collection/index.test.ts` | modified |
| `supabase/functions/ticket-collection/index.ts` | modified |
| `supabase/migrations/20260915010000_add_event_change_history.sql` | added |
| `supabase/migrations/20260915010100_add_cancellation_summary.sql` | added |
| `supabase/migrations/20260915010150_add_owned_event_cancellation_summary.sql` | added |
| `supabase/migrations/20260915010200_add_event_notices.sql` | added |
| `supabase/migrations/20260915010300_add_approved_private_event_facts.sql` | added |
| `supabase/tests/database/helpers/spec10_event_history_setup.inc` | added |
| `supabase/tests/database/spec10_cancellation_summary.test.sql` | added |
| `supabase/tests/database/spec10_change_notice_revisions.test.sql` | added |
| `supabase/tests/database/spec10_event_change_history.test.sql` | added |
| `supabase/tests/database/spec10_event_change_history_contract.test.sql` | added |
| `supabase/tests/database/spec10_event_change_history_review.test.sql` | added |
| `supabase/tests/database/spec10_event_notices.test.sql` | added |
| `supabase/tests/database/spec10_late_payment_read.test.sql` | added |
| `supabase/tests/database/spec10_notice_access_and_lifecycle.test.sql` | added |
| `supabase/tests/database/spec10_private_collection_facts.test.sql` | added |
| `supabase/tests/database/spec10_refund_summary_states.test.sql` | added |
| `supabase/tests/database/spec10_status_access_security.test.sql` | added |
| `supabase/tests/database/spec10_used_notice_audience.test.sql` | added |
| `tests/e2e/spec10.spec.ts` | added |
| `tests/integration/edge/spec10-local/index.ts` | added |
| `tests/integration/spec10-browser-fixture.py` | added |
| `tests/integration/spec10-cancellation-concurrency.py` | added |
| `tests/integration/spec10-checkout-concurrency.py` | added |
| `tests/integration/spec10-database.py` | added |
| `tests/integration/spec10-email-concurrency.py` | added |
| `tests/integration/spec10-event-history-concurrency.py` | added |
| `tests/integration/spec10-event-history-review-concurrency.py` | added |
| `tests/integration/spec10-notice-concurrency.py` | added |
| `tests/integration/spec10-refund-concurrency.py` | added |
| `tests/integration/spec10-services.py` | added |
| `tsconfig.e2e.json` | modified |
## Spec 11
Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings`
Branch: `codex/spec11-organizer-settings`
HEAD: `94c546bd0961f501584f8a3437298b2331cafd5c`
Source files: 832. Snapshot hash: `2c7c186e5e252941fdfcb5ce90c58ed3f0d7ab176a11173b974ab5358011cc7f`.
Changed files relative to frozen baseline: 58.

| File | Change |
|---|---|
| `.env.example` | modified |
| `Docs/testing/spec11-implementation.md` | added |
| `Docs/testing/spec11-visual-proof.md` | added |
| `playwright.spec11.config.ts` | added |
| `src/app/providers/AppProviders.test.tsx` | modified |
| `src/app/providers/AppProviders.tsx` | modified |
| `src/app/router/OrganizerShell.tsx` | modified |
| `src/app/router/router.tsx` | modified |
| `src/components/layout/OrganizerLayout.tsx` | modified |
| `src/config/browserEnv.ts` | modified |
| `src/features/auth/SessionProvider.test.tsx` | modified |
| `src/features/auth/SessionProvider.tsx` | modified |
| `src/features/auth/SignInPage.tsx` | modified |
| `src/features/auth/SignOutProvider.test.tsx` | added |
| `src/features/auth/SignOutProvider.tsx` | added |
| `src/features/auth/account.api.test.ts` | added |
| `src/features/auth/account.api.ts` | added |
| `src/features/auth/account.lifecycle.test.ts` | added |
| `src/features/auth/identityLifetime.test.ts` | added |
| `src/features/auth/identityLifetime.ts` | added |
| `src/features/auth/isolatedAccountClient.test.ts` | added |
| `src/features/auth/isolatedAccountClient.ts` | added |
| `src/features/auth/privateMutationLifetime.test.tsx` | added |
| `src/features/auth/privateQueryCache.ts` | modified |
| `src/features/organizer-operations/OperationsUi.tsx` | modified |
| `src/features/organizer-settings/AccountActionsPage.tsx` | added |
| `src/features/organizer-settings/AccountSecurityPage.test.tsx` | added |
| `src/features/organizer-settings/AccountSecurityPage.tsx` | added |
| `src/features/organizer-settings/HelpAndActions.test.tsx` | added |
| `src/features/organizer-settings/HelpLegalPage.tsx` | added |
| `src/features/organizer-settings/OrganizerProfilePage.test.tsx` | added |
| `src/features/organizer-settings/OrganizerProfilePage.tsx` | added |
| `src/features/organizer-settings/SettingsLayout.tsx` | added |
| `src/features/organizer-settings/UnsavedSettingsGuard.tsx` | added |
| `src/features/organizer-settings/organizer-settings.css` | added |
| `src/features/organizer-settings/settings.config.test.ts` | added |
| `src/features/organizer-settings/settings.config.ts` | added |
| `src/features/organizer-settings/settings.profile.api.test.ts` | added |
| `src/features/organizer-settings/settings.profile.api.ts` | added |
| `src/features/organizers/organizer.api.test.ts` | modified |
| `src/features/organizers/organizer.api.ts` | modified |
| `src/features/organizers/organizer.queries.ts` | modified |
| `src/features/payments/OrganizerPaymentsPage.test.tsx` | modified |
| `src/features/payments/OrganizerPaymentsPage.tsx` | modified |
| `src/features/payments/payment.api.test.ts` | modified |
| `src/features/payments/payment.api.ts` | modified |
| `src/features/payments/payment.queries.test.tsx` | modified |
| `src/features/payments/payment.queries.ts` | modified |
| `src/lib/supabase/database.types.ts` | modified |
| `supabase/migrations/20260916010000_add_owned_organizer_settings.sql` | added |
| `supabase/tests/database/spec11_profile_revision.test.sql` | added |
| `supabase/tests/database/spec11_settings.test.sql` | added |
| `tests/e2e/spec11-configured.spec.ts` | added |
| `tests/e2e/spec11.spec.ts` | added |
| `tests/e2e/support/spec11Harness.ts` | added |
| `tests/integration/spec11-database.py` | added |
| `tests/integration/spec11-profile-concurrency.py` | added |
| `tsconfig.e2e.json` | modified |

## Overlap classification

| File | Classification | Reconciliation |
|---|---|---|
| `src/app/router/router.tsx` | Automatically compatible | Three-way union of Spec10 routes and nested six-route Settings subtree. |
| `src/features/auth/privateQueryCache.ts` | Narrow reconciliation | Union private query scopes, retain Spec11 identity invalidation, add event mutation eviction. |
| `src/lib/supabase/database.types.ts` | Narrow reconciliation | Regenerate after all 119 migrations; normalize final newline. |
| `tsconfig.e2e.json` | Narrow reconciliation | Include both browser configs. |

No incompatible contract or migration collision was found.

## Integration patches beyond byte-identical source attachments

- `playwright.spec11.config.ts`
- `src/app/router/router.test.tsx`
- `src/app/router/router.tsx`
- `src/components/layout/OrganizerLayout.tsx`
- `src/features/auth/SessionProvider.test.tsx`
- `src/features/auth/SignInPage.tsx`
- `src/features/auth/privateQueryCache.ts`
- `src/features/event-changes/CancellationPanel.tsx`
- `src/features/event-changes/EventEditorContext.integration.test.tsx`
- `src/features/event-changes/EventNoticePanel.test.tsx`
- `src/features/event-changes/EventNoticePanel.tsx`
- `src/features/events/EventEditorPage.tsx`
- `src/features/events/EventPreviewPage.tsx`
- `src/features/events/PublishedEventPage.test.tsx`
- `src/features/events/event.queries.ts`
- `src/features/organizer-operations/OperationalScanner.test.tsx`
- `src/features/organizer-settings/settings.config.test.ts`
- `src/lib/supabase/database.types.ts`
- `src/preview/screens.json`
- `tests/e2e/spec09.spec.ts`
- `tests/e2e/spec10.spec.ts`
- `tests/e2e/spec11.spec.ts`
- `tests/e2e/support/spec07Harness.ts`
- `tests/e2e/support/spec08Harness.ts`
- `tests/e2e/support/spec11Harness.ts`
- `tests/integration/edge/spec07-local/index.ts`
- `tests/integration/edge/spec09-local/index.ts`
- `tests/integration/edge/spec09-local/refund.ts`
- `tests/integration/edge/spec10-local/index.ts`
- `tests/integration/spec07-database.py`
- `tests/integration/spec08-database.py`
- `tests/integration/spec08-spec09-database.py`
- `tests/integration/spec09-database.py`
- `tests/integration/spec09-services.py`
- `tests/integration/spec10-browser-fixture.py`
- `tests/integration/spec10-database.py`
- `tests/integration/spec10-services.py`
- `tests/integration/spec11-database.py`
- `tsconfig.e2e.json`

## New integration files

- `Docs/superpowers/plans/2026-09-12-spec10-spec11-integration.md`
- `Docs/testing/spec10-spec11-integration-files.md`
- `Docs/testing/spec10-spec11-integration-request.md`
- `Docs/testing/spec10-spec11-integration-verification.md`
- `src/features/auth/SignInPage.return.test.tsx`
- `src/features/auth/spec10Spec11.integration.test.tsx`
- `supabase/tests/database/spec10_spec11_integration.test.sql`
- `tests/integration/spec10-spec11-database.py`
