# Ticket email worker: deliberately inactive

No scheduler or provider setup is installed by this change. Database worker settings and the endpoint's `TICKET_EMAIL_WORKER_ENABLED=true` gate must both be explicitly enabled in a later approved activation. Invoke with POST and `Authorization: Bearer <TICKET_EMAIL_WORKER_SECRET>`. Each invocation processes at most three claims; each provider call has a 15-second timeout. Six total dispatches and 23 hours from the first possible dispatch are enforced independently by the database and worker. The last lease check requires at least 20 seconds remaining.

Required server-only configuration:

- `TICKET_EMAIL_WORKER_ENABLED`: absent/default is inactive.
- `TICKET_EMAIL_WORKER_SECRET`: private 32–256-character worker invocation secret.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: existing service RPC configuration.
- `RESEND_API_KEY`: sending credential for the separately configured verified sender.
- `TICKET_EMAIL_FROM`: configured sender address, optionally `Whereto <address>`.
- `TICKET_EMAIL_SUPPORT_EMAIL`: real monitored support address used as Reply-To and in the email; absent/invalid support stops only the affected attempt, including overflow recovery. Do not configure a placeholder address.
- `APP_BASE_URL`: exact app origin, reused from existing server configuration.
- `TICKET_EMAIL_PAYLOAD_KEY_ID`: active encryption key identifier.
- `TICKET_EMAIL_PAYLOAD_KEYS_JSON`: JSON object mapping key identifiers to canonical standard base64 encodings of exactly 32 random bytes. Preserve older keys while retry payloads or pending recovery requests require them. Never log these keys, recovery email, ticket URL, or provider request bodies.
- `RESEND_WEBHOOK_SECRET`: endpoint signing secret for `ticket-email-webhook`.

The webhook accepts only signed raw-body observations for sent, delivered, delivery_delayed, bounced, complained, and failed. It correlates `data.tags.attempt_id` and `data.email_id`; no recipient or time matching is used. The webhook remains capable of reconciling observations while worker dispatch is disabled. SQL handles races, duplicates, and evidence precedence. Accepted means provider acceptance, not inbox arrival.

Initial/resend grant expiry is fixed from the canonical scheduled event end plus 24 hours at preparation. A rescheduled event does not extend an existing grant or mutate a prepared retry payload. When an old link no longer covers the revised schedule, use fresh-link/recovery handoff. Recovery snapshot grants last 24 hours and preserve separate collections; overflow sends only a neutral support handoff without a ticket link or truncated result count.

Verification used injected local functions and offline signed fixtures, never a live provider. SDK behavior was checked against installed Resend 6.26.0 and official documentation:

- [Verify Webhooks Requests](https://resend.com/docs/webhooks/verify-webhooks-requests): verify the untouched raw body.
- [Email sent](https://resend.com/docs/webhooks/emails/sent): event timestamp, `data.email_id`, and object-shaped tags.
- [Managing Tags](https://resend.com/docs/dashboard/emails/tags): send tags carry through to webhook events.
