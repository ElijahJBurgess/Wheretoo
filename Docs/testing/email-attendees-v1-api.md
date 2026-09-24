# Organizer Message browser API

POST `/functions/v1/organizer-message`, authenticated owner Bearer JWT. JSON only; exact request fields, max 32 KiB UTF-8. No recipient addresses, owner IDs, sender overrides, HTML, or provider data accepted. Every RPC uses the supplied owner JWT (never service role).

Requests:
- `{action:'options',eventId:UUID}`
- `{action:'preview',eventId:UUID,selector,subject:string,body:string}`
- `{action:'submit',eventId:UUID,selector,subject:string,body:string,fingerprint:string,requestId:UUID}`
- `{action:'receipt',eventId:UUID,requestId:UUID}`

`selector` is exactly `{kind:'everyone'}` or `{kind:'tier'|'order'|'registration',id:UUID}`.

Success (HTTP 200):
- options: `{options:{eventId,admissionType:'paid'|'free',deadline:string|null,canSend:boolean,reason:string|null,replyTo:string|null,tiers:[{id,name,archived}]}}`
- preview: `{preview:{recipientCount,canSend,reason,audienceLabel,deadline,fingerprint,subject,body,html,text,from,replyTo}}`. `html` and `text` come from the same frozen `organizer-message-v1` React Email renderer as delivery. Render HTML only as an inert sanitized presentation: allowlisted React elements/attributes, external scoped CSS, no scripts, styles from input, forms, links that navigate, or unsafe images. A scriptless sandboxed frame is also acceptable only if the production CSP permits it. Never insert unrestricted HTML. No recipient projection. Zero Everyone is a successful preview with count 0, canSend false and NO_RECIPIENTS.
- submit: `{receipt:{messageId,requestId,queuedRecipients,confirmedAt}}`
- receipt: `{receipt:<same receipt>|null}`. Null does not prove rollback or permit another request UUID.

Failure: `{error:{code:string,submissionOutcome?:'not_queued'|'unknown'}}`. `submissionOutcome` occurs on submit failures only. An owner RPC's explicit SQL `P0001` rejection establishes `not_queued`; failed HTTP transport, thrown errors, malformed success and non-domain database failures remain `unknown`. Strict request validation before any RPC is `not_queued`. Preserve request UUID, selector and content after unknown; reconcile receipt and retry the SAME submit intent/UUID. Never automatically mint a new UUID. REQUEST_CONFLICT must remain blocked pending reconciliation of the original intent.

Domain codes match `email-attendees-v1-contracts.md`. Additional façade codes: INVALID_REQUEST, METHOD_NOT_ALLOWED, CORS_ORIGIN_DENIED, UNAVAILABLE, SUBMISSION_UNKNOWN. Preview `{error:{code}}` from SQL is a rejection, never a rendering result. All responses are no-store. Error details and private RPC fields are never forwarded.

New-send availability is enforced atomically by the owner SQL submit contract AFTER durable replay reconciliation, including dedicated settings and fresh worker health. The façade adds no pre-replay environment gate. Worker health is acknowledged only after its independent ORGANIZER_MESSAGE_WORKER_ENABLED/SECRET, RESEND_API_KEY and encryption key configuration validate. Defaults stay disabled; production activation/scheduler/provider setup are separate approvals.
