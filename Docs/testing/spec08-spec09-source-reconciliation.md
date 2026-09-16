# Spec 08 + Spec 09 source reconciliation

Shared dependency baseline: 716 files, SHA-256 `9306b44aa805738511d3742df5f59e916eab4049695a003dd5fcafc3ca3900e2`. Both source HEADs: `94c546bd0961f501584f8a3437298b2331cafd5c`. Spec 08 has 37 incremental files; Spec 09 has 71; intersection is empty. No contract conflicts.

Source status, per-file SHA-256 manifests and exact archives are retained under `.superpowers/spec08-spec09/`.

| Source | Files | Snapshot SHA-256 |
|---|---:|---|
| Spec 08 | 735 | `c3c07aa4e7c53f52f824e24972168a711a29bbdf9496c4f656626f0042457104` |
| Spec 09 | 770 | `b180dae026056d6d9e1e5de1f5e072664d23846e44ef4cabc791d04c3a36c4a2` |

All 202 files changed in both working snapshots relative to HEAD:

| File | Classification | Resolution |
|---|---|---|
| `.env.example` | automatically compatible | identical inherited baseline |
| `Docs/superpowers/plans/2026-09-11-spec07-implementation.md` | automatically compatible | identical inherited baseline |
| `Docs/testing/spec07-ticket-email-verification.md` | automatically compatible | identical inherited baseline |
| `deno.json` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `deno.lock` | automatically compatible | identical inherited baseline |
| `package.json` | automatically compatible | identical inherited baseline |
| `playwright.spec07.config.ts` | automatically compatible | identical inherited baseline |
| `scripts/verify-spec07-production.ts` | automatically compatible | identical inherited baseline |
| `scripts/verify-ticket-shell-production.ts` | automatically compatible | identical inherited baseline |
| `src/app/router/OrganizerShell.tsx` | automatically compatible | identical inherited baseline |
| `src/app/router/router.test.tsx` | automatically compatible | identical inherited baseline |
| `src/app/router/router.tsx` | needs narrow reconciliation | identical inherited baseline |
| `src/config/browserEnv.test.ts` | automatically compatible | identical inherited baseline |
| `src/config/browserEnv.ts` | automatically compatible | identical inherited baseline |
| `src/features/buyer-journey/BuyerPrimitives.tsx` | automatically compatible | identical inherited baseline |
| `src/features/buyer-journey/CheckoutReview.tsx` | automatically compatible | identical inherited baseline |
| `src/features/buyer-journey/EventPageView.tsx` | automatically compatible | identical inherited baseline |
| `src/features/buyer-journey/OrderConfirmationView.tsx` | needs narrow reconciliation | Spec 08 delta; Spec 09 baseline |
| `src/features/buyer-journey/buyer.css` | automatically compatible | identical inherited baseline |
| `src/features/buyer-journey/calendar.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/buyer-journey/calendar.ts` | automatically compatible | identical inherited baseline |
| `src/features/buyer-journey/format.ts` | automatically compatible | identical inherited baseline |
| `src/features/checkout/CheckoutPage.tsx` | automatically compatible | Spec 08 delta; Spec 09 baseline |
| `src/features/events/event.queries.ts` | automatically compatible | identical inherited baseline |
| `src/features/events/organizerEventPresentation.ts` | automatically compatible | identical inherited baseline |
| `src/features/orders/OrderConfirmationPage.test.tsx` | automatically compatible | Spec 08 delta; Spec 09 baseline |
| `src/features/orders/OrderConfirmationPage.tsx` | automatically compatible | Spec 08 delta; Spec 09 baseline |
| `src/features/organizer-operations/CheckInContext.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/CheckInHomePage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/CheckInLayout.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/FindGuestPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/FindGuestPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/GuestTicketDetailPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/ManualAdmissionDialog.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/ManualAdmissionDialog.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OperationalScanner.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OperationalScanner.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OperationsDialog.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OperationsUi.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OrganizerDashboardPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OrganizerDashboardPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OrganizerOrderDetailPage.test.tsx` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `src/features/organizer-operations/OrganizerOrderDetailPage.tsx` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `src/features/organizer-operations/OrganizerOrdersPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OrganizerOrdersPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OrganizerRegistrationDetailPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/OrganizerRegistrationLookup.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/RefundOrderDialog.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/find-guest.css` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/findGuest.api.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/operations.api.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/operations.errors.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/operations.format.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/operations.format.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/operations.queries.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/operations.queries.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/operations.reads.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/operations.schemas.ts` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/organizer-operations.css` | automatically compatible | identical inherited baseline |
| `src/features/organizer-operations/useManualAdmission.ts` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/FreeRsvpEntry.tsx` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/RsvpConfirmationPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/RsvpConfirmationPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/RsvpPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/RsvpPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/rsvp.api.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/rsvp.api.ts` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/rsvp.attempt.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/rsvp.attempt.ts` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/rsvp.contract.ts` | automatically compatible | identical inherited baseline |
| `src/features/rsvp/rsvp.css` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/DeliverySupport.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/OrganizerRegistrations.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/ResendTicketsDialog.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/ResendTicketsDialog.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/TicketDeliveryNotice.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/TicketDeliveryNotice.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/TicketEmailAccessPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/TicketEmailAccessPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/TicketEmailHttpBridge.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/TicketRecoveryPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/TicketRecoveryPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/delivery.api.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/delivery.api.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/delivery.copy.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/delivery.public-api.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/delivery.queries.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/delivery.schemas.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/delivery.session.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/delivery.session.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-delivery/ticket-delivery.css` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/adapters/adapters.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/adapters/admissionChecker.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/adapters/ticketCollectionReader.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/contracts/admission.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/contracts/ticketCollection.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/customer/FocusedTicketView.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/customer/FocusedTicketView.tsx` | needs narrow reconciliation | identical inherited baseline |
| `src/features/ticket-experience/customer/InactiveTicketArtwork.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/customer/TicketCollectionOverview.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/customer/TicketCollectionPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/customer/TicketCollectionPage.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/email/EmailFrame.tsx` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `src/features/ticket-experience/email/TicketRecoveryEmail.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/email/TicketsReadyEmail.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/email/email.types.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `src/features/ticket-experience/email/emailStyles.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/email/renderEmail.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/email/renderEmail.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `src/features/ticket-experience/scanner/OrganizerScannerPage.test.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/scanner/OrganizerScannerView.tsx` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/scanner/cameraDecoder.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/scanner/cameraDecoder.ts` | automatically compatible | identical inherited baseline |
| `src/features/ticket-experience/scanner/useScannerController.ts` | automatically compatible | identical inherited baseline |
| `src/features/tickets/PublicTicketEventPage.test.tsx` | automatically compatible | Spec 08 delta; Spec 09 baseline |
| `src/features/tickets/PublicTicketEventPage.tsx` | automatically compatible | Spec 08 delta; Spec 09 baseline |
| `src/features/tickets/TicketTierList.tsx` | automatically compatible | Spec 08 delta; Spec 09 baseline |
| `src/features/tickets/publicTicketing.api.test.ts` | automatically compatible | identical inherited baseline |
| `src/features/tickets/publicTicketing.api.ts` | automatically compatible | identical inherited baseline |
| `src/lib/supabase/database.types.ts` | needs narrow reconciliation | Spec 09 delta; Spec 08 baseline |
| `src/main.development.tsx` | automatically compatible | identical inherited baseline |
| `src/main.tsx` | automatically compatible | identical inherited baseline |
| `src/preview/screens.json` | automatically compatible | Spec 08 delta; Spec 09 baseline |
| `src/preview/screens.render.test.tsx` | automatically compatible | identical inherited baseline |
| `supabase/config.toml` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `supabase/functions/.env.example` | automatically compatible | identical inherited baseline |
| `supabase/functions/_shared/freeRegistration.test.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/_shared/freeRegistration.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/_shared/freeRsvpHandler.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/_shared/ticketEmailAccess.test.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/_shared/ticketEmailAccess.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `supabase/functions/_shared/ticketEmailHttp.test.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/_shared/ticketEmailHttp.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `supabase/functions/_shared/ticketEmailProvider.test.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/_shared/ticketEmailProvider.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `supabase/functions/_shared/ticketEmailWorker.test.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `supabase/functions/_shared/ticketEmailWorker.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `supabase/functions/_shared/ticketEmailWorkerProjection.fixture.json` | automatically compatible | identical inherited baseline |
| `supabase/functions/free-rsvp-status/index.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/free-rsvp/index.test.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/free-rsvp/index.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-collection/freeCollection.test.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-collection/freeCollection.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-collection/index.test.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-collection/index.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-email-access/index.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-email-status/index.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-email-webhook/index.test.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-email-webhook/index.ts` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-email-worker/README.md` | automatically compatible | identical inherited baseline |
| `supabase/functions/ticket-email-worker/index.test.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `supabase/functions/ticket-email-worker/index.ts` | automatically compatible | Spec 09 delta; Spec 08 baseline |
| `supabase/functions/ticket-recovery-request/index.ts` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260909010100_allow_checkout_preflight_status_refresh.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260911010000_extend_spec04_organizer_reads.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260911020000_add_owned_admission_search.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260912010000_create_free_registration_source.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260912010100_add_atomic_free_registration.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260912010200_extend_shared_admission_for_free_sources.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260912010300_add_free_owner_reads_and_rate_limit.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260913010000_create_ticket_email_foundation.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260913010100_add_ticket_email_worker_contracts.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260913010200_add_ticket_email_entry_points.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260913010300_add_scoped_ticket_email_access.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260913010400_preserve_initial_email_deduplication.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260913010500_add_resend_request_status.sql` | automatically compatible | identical inherited baseline |
| `supabase/migrations/20260913010600_add_email_retention_and_recipient_suppression.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/core_ticket_truth_lite_schema.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/free_registration_behavior.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/free_registration_fixture.inc` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/free_registration_integrity.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/free_registration_lifecycle.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/free_registration_schema.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/free_registration_security.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec04_organizer_reads.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec05_admission_search.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_access_limits.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_behavior.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_dispatch.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_dispatch_block.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_eligibility.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_expiry.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_fixture.inc` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_initial_status.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_preparation_resume.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_recipient_policy.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_recovery.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_retention.test.sql` | automatically compatible | identical inherited baseline |
| `supabase/tests/database/spec07_email_schema.test.sql` | automatically compatible | identical inherited baseline |
| `tests/e2e/spec07.spec.ts` | automatically compatible | identical inherited baseline |
| `tests/e2e/support/spec07Harness.ts` | automatically compatible | identical inherited baseline |
| `tests/e2e/support/spec07Setup.ts` | automatically compatible | identical inherited baseline |
| `tests/e2e/support/spec07Teardown.ts` | automatically compatible | identical inherited baseline |
| `tests/integration/edge/spec07-local/index.ts` | automatically compatible | identical inherited baseline |
| `tests/integration/spec06-database-bootstrap.sql` | automatically compatible | identical inherited baseline |
| `tests/integration/spec07-browser-fixture.py` | automatically compatible | identical inherited baseline |
| `tests/integration/spec07-database-bootstrap.sql` | automatically compatible | identical inherited baseline |
| `tests/integration/spec07-database.py` | automatically compatible | identical inherited baseline |
| `tests/integration/spec07-email-concurrency.py` | automatically compatible | identical inherited baseline |
| `tests/integration/spec07-services.py` | automatically compatible | identical inherited baseline |
| `tests/integration/ticketShellProductionBoundary.test.ts` | automatically compatible | identical inherited baseline |
| `tsconfig.e2e.json` | automatically compatible | Spec 08 delta; Spec 09 baseline |
