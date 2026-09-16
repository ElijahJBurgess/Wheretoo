# Spec 09 changed files

This inventory is relative to the verified 716-file frozen dependency snapshot, not the branch HEAD (which intentionally predates inherited Spec 04–07 changes). No file was deleted. The generated public database types should be regenerated after combining both specs.

## Modified

- `deno.json`
- `src/features/organizer-operations/OrganizerOrderDetailPage.test.tsx`
- `src/features/organizer-operations/OrganizerOrderDetailPage.tsx`
- `src/features/ticket-experience/email/EmailFrame.tsx`
- `src/features/ticket-experience/email/email.types.ts`
- `src/features/ticket-experience/email/renderEmail.ts`
- `src/lib/supabase/database.types.ts`
- `supabase/config.toml`
- `supabase/functions/_shared/ticketEmailAccess.ts`
- `supabase/functions/_shared/ticketEmailHttp.ts`
- `supabase/functions/_shared/ticketEmailProvider.ts`
- `supabase/functions/_shared/ticketEmailWorker.test.ts`
- `supabase/functions/_shared/ticketEmailWorker.ts`
- `supabase/functions/organizer-refund-order/index.test.ts`
- `supabase/functions/organizer-refund-order/index.ts`
- `supabase/functions/ticket-email-worker/index.test.ts`
- `supabase/functions/ticket-email-worker/index.ts`

## Added

- `Docs/superpowers/plans/2026-09-11-spec09-implementation.md`
- `Docs/testing/spec09-activation-readiness.md`
- `Docs/testing/spec09-deferred-shared-integration.md`
- `Docs/testing/spec09-implementation-handoff.md`
- `playwright.spec09.config.ts`
- `src/features/refunds/RefundDetailsPage.test.tsx`
- `src/features/refunds/RefundDetailsPage.tsx`
- `src/features/refunds/RefundNoticeStatus.tsx`
- `src/features/refunds/RefundOrderDialog.tsx`
- `src/features/refunds/RefundOrderPanel.test.tsx`
- `src/features/refunds/RefundOrderPanel.tsx`
- `src/features/refunds/RefundStateNotice.tsx`
- `src/features/refunds/RefundSupport.test.tsx`
- `src/features/refunds/RefundedTicketContext.tsx`
- `src/features/refunds/refundRoutes.tsx`
- `src/features/refunds/refunds.api.test.ts`
- `src/features/refunds/refunds.api.ts`
- `src/features/refunds/refunds.css`
- `src/features/refunds/refunds.fixtures.ts`
- `src/features/refunds/refunds.public-api.ts`
- `src/features/refunds/refunds.queries.test.ts`
- `src/features/refunds/refunds.queries.ts`
- `src/features/refunds/refunds.schemas.test.ts`
- `src/features/refunds/refunds.schemas.ts`
- `src/features/refunds/refunds.session.test.ts`
- `src/features/refunds/refunds.session.ts`
- `src/features/ticket-experience/email/OrderRefundedEmail.tsx`
- `supabase/functions/_shared/emailTimestamp.ts`
- `supabase/functions/_shared/refundDetailAccess.test.ts`
- `supabase/functions/_shared/refundNotice.ts`
- `supabase/functions/organizer-refund-order/refundObservation.test.ts`
- `supabase/functions/organizer-refund-order/refundObservation.ts`
- `supabase/functions/organizer-refund-order/refundOperation.test.ts`
- `supabase/functions/organizer-refund-order/refundOperation.ts`
- `supabase/functions/refund-detail-access/index.ts`
- `supabase/migrations/20260914010000_add_refund_operations.sql`
- `supabase/migrations/20260914010200_add_refund_notice.sql`
- `supabase/tests/database/helpers/spec09_refund_setup.inc`
- `supabase/tests/database/spec09_refund_lifecycle.test.sql`
- `supabase/tests/database/spec09_refund_notice_access.test.sql`
- `supabase/tests/database/spec09_refund_notice_schema.test.sql`
- `supabase/tests/database/spec09_refund_operations.test.sql`
- `tests/e2e/spec09-harness/README.md`
- `tests/e2e/spec09-harness/index.html`
- `tests/e2e/spec09-harness/main.tsx`
- `tests/e2e/spec09.spec.ts`
- `tests/integration/edge/spec09-local/index.ts`
- `tests/integration/edge/spec09-local/refund.ts`
- `tests/integration/spec09-browser-fixture.py`
- `tests/integration/spec09-database-bootstrap.sql`
- `tests/integration/spec09-database.py`
- `tests/integration/spec09-refund-concurrency.py`
- `tests/integration/spec09-services.py`

- `Docs/testing/spec09-changed-files.md` (this inventory)
