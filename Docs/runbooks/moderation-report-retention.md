# Moderation report retention operations

## Owned schedule

The linked database owns one pg_cron job:

- Job name: `whereto-expire-event-report-fingerprints-daily`
- Schedule: `17 3 * * *` (03:17 UTC daily)
- Command: `select public.server_expire_event_report_fingerprints();`
- Owner: the database migration role

The retention function clears report fingerprints older than 30 days and deletes expired actor/network HMAC rate buckets. Application roles have no `cron` schema usage. The existing `service_role` execution grant on the retention function is the bounded manual-recovery boundary; never grant application roles access to the scheduler schema.

## Monitoring

An authorized database operator should monitor this job without copying report rows, fingerprints, rate-bucket digests, credentials, or raw database errors into tickets or logs.

At least daily, verify:

1. Exactly one active job has the name, schedule, command, database, and owner above.
2. `cron.job_run_details` has a successful completion for that job within the last 26 hours.
3. No report with a non-null fingerprint is older than 30 days.
4. No rate bucket has an `expires_at` value in the past.
5. `anon`, `authenticated`, and `service_role` still have no `cron` schema usage; only `service_role` can execute the retention function.

Alert immediately on a missing/disabled/duplicate job, a failed run, no successful run within 26 hours, retained data past either boundary, or an ACL mismatch. Monitoring output should contain counts, timestamps, status, and the job identifier only. Treat raw `return_message` values as internal diagnostic data and redact them before escalation.

## Failure recovery

1. Confirm the linked project and migration history before any write.
2. Capture only the failing job ID, status, and timestamps. Do not capture report content, fingerprints, network digests, credentials, or secrets.
3. Correct the database or scheduler fault through a reviewed forward-only migration. Do not edit applied migration history or the existing job in place through an ad hoc client.
4. If immediate retention is required, an authorized operator may invoke `public.server_expire_event_report_fingerprints()` through the existing bounded service boundary.
5. Verify zero overdue fingerprints and zero expired buckets, then verify a new successful scheduled run.
6. Record the redacted incident outcome and continue daily monitoring for 48 hours.

## `REPORT_FINGERPRINT_SECRET` rotation

Never read, print, export, query, screenshot, or place the current secret in a command, report, or ticket. Refer to it only by the exact variable name `REPORT_FINGERPRINT_SECRET`.

1. Confirm retention is healthy and no fingerprint is older than 30 days.
2. Schedule rotation during a low-traffic window. Rotation changes new HMAC digests immediately, so monitor abuse controls across the boundary.
3. Generate and install the replacement only through the managed deployment secret control, then redeploy the report boundary using the established reviewed release workflow. Do not use local shell history or repository files.
4. Run a bounded anonymous-report smoke check that records status only, then confirm new reports and rate limiting operate without exposing any digest.
5. Monitor report failures, duplicate-rate behavior, retention job health, and overdue counts for 48 hours.
6. If rotation causes failure, restore through the managed secret control and reviewed deployment rollback; never retrieve or disclose either secret value during diagnosis.

Rotate after a suspected exposure and on the organization’s managed secret-rotation cadence. A rotation does not replace the daily 30-day retention job.
