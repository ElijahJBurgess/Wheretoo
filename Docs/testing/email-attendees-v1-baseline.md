# Email Attendees pristine-main SQL baseline

HEAD: `8138cdf2d6f84ff98d7ca42b595a9f87f9f7b66a`. Dedicated local baseline DB only. All 110 existing root database SQL suites: 59 pass / 51 fail. No feature migration present. This is baseline evidence, not feature completion.

| Suite | Observed baseline failure |
| --- | --- |
| `checkout_integrity_confirmation.test.sql` | psql:/tmp/email-regressions/tests/database/checkout_integrity_confirmation.test.sql:233: ERROR:  permission denied for table orders |
| `checkout_integrity_contract_cleanup.test.sql` | psql:/tmp/email-regressions/tests/database/checkout_integrity_contract_cleanup.test.sql:197: ERROR:  permission denied for table order_items |
| `checkout_integrity_fixture_lifecycle.test.sql` | psql:/tmp/email-regressions/tests/database/checkout_integrity_fixture_lifecycle.test.sql:115: ERROR:  permission denied for table ticket_tiers |
| `checkout_integrity_fulfillment.test.sql` | psql:/tmp/email-regressions/tests/database/checkout_integrity_fulfillment.test.sql:276: ERROR:  permission denied for table orders |
| `checkout_integrity_refunds.test.sql` | psql:/tmp/email-regressions/tests/database/checkout_integrity_refunds.test.sql:150: ERROR:  permission denied for table orders |
| `checkout_integrity_reservation.test.sql` | psql:/tmp/email-regressions/tests/database/checkout_integrity_reservation.test.sql:416: ERROR:  permission denied for table ticket_tiers |
| `connect_refresh_sequence.test.sql` | psql:/tmp/email-regressions/tests/database/connect_refresh_sequence.test.sql:156: ERROR:  permission denied for table organizer_stripe_accounts |
| `core_ticket_truth_lite_collection.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `core_ticket_truth_lite_fulfillment.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `core_ticket_truth_lite_lifecycle.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `core_ticket_truth_lite_redemption.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `core_ticket_truth_lite_schema.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `moderation_evaluations.test.sql` | psql:/tmp/email-regressions/tests/database/moderation_evaluations.test.sql:180: ERROR:  permission denied for table events |
| `moderation_policy_acceptance.test.sql` | not ok 27 - the acceptance boundary has no client authority beyond event identity |
| `order_confirmation.test.sql` | psql:/tmp/email-regressions/tests/database/order_confirmation.test.sql:201: ERROR:  permission denied for table orders |
| `organizer_csv_export.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `organizer_csv_export_equivalence.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `organizer_csv_export_lifecycle.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `organizer_event_metrics.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `organizer_manual_admission.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `organizer_order_reads.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `organizer_refund_context.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `payment_fulfillment.test.sql` | psql:/tmp/email-regressions/tests/database/payment_fulfillment.test.sql:221: ERROR:  permission denied for table stripe_webhook_events |
| `publish_event.test.sql` | not ok 3 - another organizer event is rejected |
| `refunds_disputes.test.sql` | psql:/tmp/email-regressions/tests/database/refunds_disputes.test.sql:192: ERROR:  permission denied for table orders |
| `spec04_organizer_reads.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `spec05_admission_search.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `spec07_email_initial_status.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `spec07_email_preparation_resume.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `spec07_email_recipient_policy.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `spec08_checkout_expiry.test.sql` | not ok 2 - one exact database-owned expiry job remains inaccessible to browser and service roles |
| `spec08_spec09_integration.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec08_spec09_notice_failure.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `spec09_refund_lifecycle.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec09_refund_notice_access.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `spec09_refund_operations.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec10_cancellation_summary.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec10_event_notices.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec10_late_payment_read.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec10_notice_access_and_lifecycle.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec10_private_collection_facts.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec10_refund_summary_states.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec10_used_notice_audience.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec11_profile_revision.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders |
| `spec14_assembly_contracts.test.sql` | psql:/tmp/email-regressions/tests/database/spec14_assembly_contracts.test.sql:4: ERROR:  function plan(integer) does not exist |
| `storefront_attribution.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `storefront_transactions.test.sql` | psql:/tmp/email-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders |
| `ticketing_schema.test.sql` | not ok 14 - ticket columns are exact; not ok 22 - ticket column types are exact; not ok 34 - financial foreign keys are exact; not ok 57 - Stripe IDs and Day 2 domain keys are uniquely constrained; not ok 59 - all financial foreign keys use ON DELETE RESTRICT |
| `unattached_checkout_forward.test.sql` | not ok 19 - existing fulfillment enqueues initial email exactly once |
| `webhook_reconciliation.test.sql` | psql:/tmp/email-regressions/tests/database/webhook_reconciliation.test.sql:91: ERROR:  permission denied for table stripe_webhook_events |
| `webhook_review_safety.test.sql` | psql:/tmp/email-regressions/tests/database/webhook_review_safety.test.sql:306: ERROR:  permission denied for table orders |

## General integration baseline

`pnpm test:integration` before application implementation: 15 passing files, 5 failed files, 1 skipped; 257 passed assertions, 2 failed, 5 skipped. Three files cannot load without legacy test-account variables (`public-event-visibility.test.ts`, `ticketing-concurrency.test.ts`, `ticketing-database.test.ts`). `cspContract.test.ts` expects the older img-src without `blob:` and fails against unchanged current-main configuration. `moderation-public-projection.test.ts` hardcodes a linked-database query; it failed because this isolated worktree has no linked project. No hosted query succeeded. Do not link a hosted project to satisfy this old test. Feature proof uses dedicated local fixtures and must compare applicable assertions differentially.
