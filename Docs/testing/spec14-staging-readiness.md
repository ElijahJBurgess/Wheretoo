# Spec 14 — staging readiness and service inventory

> **Source-freeze checkpoint:** This source document records the pre-terminal verification state. The delivered detached handoff report and `handoff/evidence-index.json` carry subsequent build/export, Payments rerun and terminal-journey results with their actual identities. Those later results supersede pending checkpoint statuses here. Keeping results detached avoids changing the source bytes that those executions verify.

**Current moderation verification:** both targeted forward migrations are approved and applied locally. The supplemental correction restores the inherited active-event schedule condition; all eight targeted SQL suites and the independent preservation comparison pass. All previous122 migration files and ledger entries remain unchanged. All four concurrency cases pass with cleanup verified; the updated worker passed J06c/J06d connected checks; final readiness remains incomplete.

## Gate B status

**Local implementation is in progress; staging is not authorized or verified.** B1 is paused pending the explicitly requested SDK patch approval. G07/J08g also reproduced a late paid-evidence gap for an unattached checkout; the contract repair is unapproved and that branch is paused. The user has approved the separate incomplete-draft moderation repair for local work. Its forward migration applied locally after independent implementation review. Both approved forwards are applied; independent preservation, all494 targeted SQL assertions, four concurrency cases, and J06c/J06d connected verification pass. App, edge and bridge processes have restarted after the passing SQL, race and static checks; task data and inbox histories were preserved. At the recorded post-moderation checkpoint, all149 served artifacts matched that bound build; later source changes require a newly bound artifact. J01/J02/J03/J04 connected cores and J02a/J03a/J07a have local runtime proof; the remaining connected matrix and final export evidence are still pending. This document retains the source-derived Gate A plan for services and configuration; no hosted target, account, provider, or integration was inspected in Gate B.

The local environment now exists: internal task-only PostgreSQL, real local Auth, REST, and Auth inbox services, 22 real Edge handlers, and provider boundary simulators. All121 unchanged historical migration files and both separately approved moderation forward migrations were replayed. These local results establish neither deployment nor provider readiness. See [verification](spec14-final-assembly-verification.md) and [the local walkthrough](spec14-manual-walkthrough.md).

Each external action below still requires separate approval. A future mismatch in a target or its configuration requires a concrete proposal; missing hosted values do not block independent local work.

### Current local evidence, with limits

The [verification record](spec14-final-assembly-verification.md) is the authoritative local result index. It keeps the failed Auth command, two retained SQL metadata failures, timeout-only concurrency adaptations, exact original journey identities, inspected visual findings, and unexecuted cases separate. Four guarded role-browser smokes passed with provider state unchanged. Neither those smokes nor the local provider simulations establish staging or real-delivery readiness.

## 1. Exact inventory and provenance

- [121 ordered migration files and function-definition history](spec14-inherited-migration-inventory.json): exact relative paths and SHA-256 values. Existing definitions may be replaced by later migrations; evaluate the last definition, its grants and policies together.
- [22 Edge functions](spec14-inherited-edge-inventory.json): entrypoint paths, direct imports, transitive local import closure, lexical RPC calls and environment references.
- [Browser action/read/write matrix](spec14-flow-route-matrix.md) and [request inventory](spec14-inherited-request-inventory.json).
- [Environment reference inventory](spec14-inherited-env-inventory.json): lexical source references, including test harnesses. This is an overapproximation, not a list of required production secrets. Import closure can include unused exports.
- Gate A local configuration inspection: names and nonsecret linkage only. Primary has no `.env.local`, `.vercel/project.json` or `supabase/.temp/project-ref`. Main has a linked Supabase ref; it is not an approved staging target. No provider/account inspection took place.

All functions are under `supabase/functions/<name>/index.ts`; current `supabase/config.toml` explicitly sets `verify_jwt=false` for each. This allows custom handler authorization, including opaque bearer and webhook signatures. It does **not** make an organizer endpoint anonymous. Preserve/test `requireOrganizer`, which validates the bearer with Auth and checks organizer membership.

### Approved local forward migrations

[The append manifest](spec14-approved-forward-migrations.json) binds two approved files after the unchanged121-file baseline. The second restores the inherited active-event `ends_at` condition while preserving the first file and its ledger entry. The first file adds `private.event_has_moderation_disclosures(uuid)` and service-only `public.server_reject_moderation_evaluation_input(uuid,uuid,bigint,text,bigint,integer)`, adds the disclosure predicate only to contextual enqueue in `private.invalidate_event_public_revision`, and retires incomplete queued/processing jobs under event/evaluation locks. It adds no Edge entrypoint or automatic job. Claim/hash/apply/fail authorities stay unchanged. Rejection is available only to `service_role`; browser roles remain denied. Any later staging application of this same migration requires its own target-specific approval and preflight.

## 2. Edge entrypoints: caller, proof, authority and dependencies

| Entrypoint | Caller and proof | Reads / writes / dependencies | Required failure verification |
|---|---|---|---|
| `public-discovery` | Anonymous; validated filters/cursor; trusted ingress HMAC limiter | Service-only discovery RPC, public eligibility; no raw public table read | Bad filters/cursor; quota; spoofed/missing header; neutral price/null artwork |
| `free-rsvp` | Anonymous request ID + collection bearer; strict identity/cart | Atomic free registration/capacity/ticket issuance; original collection proof; rate limiter | Retry creates no duplicate; stale/ended/full; malformed input; lost/partial proof |
| `free-rsvp-status` | Same request ID + collection bearer | Original free registration status only | Wrong/unknown proof; status refresh cannot mint a new registration |
| `stripe-create-checkout` | Anonymous confirmation bearer header + client request ID and strict cart | Reservation/attempt authority, Stripe TEST Session, canonical account/fee/tier facts | Disabled; stale cart; full; provider timeout; original attempt reuse; unknown remains unknown |
| `stripe-cancel-checkout` | Original confirmation token | Existing attempt/session reconciliation and authorized cancellation | Race with fulfillment; already paid; invalid proof; no replacement attempt |
| `order-confirmation` | Original opaque confirmation token | Persisted order status and bounded payment evidence reconciliation | URL/client success not payment truth; invalid/unknown status |
| `ticket-collection` | Original paid collection or `rsvp_` proof | Persisted issued tickets; credential derivation; paid/free source projection | Wrong token/selector; cancelled/refunded; no ticket duplication |
| `ticket-email-access` | Purpose-scoped `em1` grant, fingerprint/rate context | Grant resolution to constrained ticket collection DTO | Expired/wrong-purpose/invalid grant; no credential leaks |
| `ticket-email-status` | Original collection bearer | Delivery state for the authorized collection | No recipient enumeration; delivery failure independent of ticket truth |
| `ticket-recovery-request` | Neutral email/request-ID flow; independent rate gates | Recovery lookup, durable intent, encrypted payload, stored recipient | Enumeration-safe result; public switch off; limits; duplicate/unknown dispatch |
| `refund-detail-access` | Refund-purpose grant | Canonical refund snapshot and related ticket history | Wrong purpose/source; no refund mutation from access |
| `event-status-access` | Event-change/cancellation-purpose grant | Authorized source and current event notice/status | Wrong purpose; unavailable/expired; no unrelated source data |
| `report-event` | Bounded public report input; fingerprint/rate controls | Report deduplication, evaluation/retention authority | Invalid event/input; rate; no private data disclosure |
| `stripe-connect-status` | Auth JWT + organizer | Existing canonical connected-account readiness; TEST Stripe retrieval | Foreign organizer; network unknown; stale identity; no frontend-ready override |
| `stripe-connect-session` | Auth JWT + organizer; explicit action | Existing Connect account/session authority; onboarding/manage setup | Duplicate actions; unknown; session secrets stay ephemeral |
| `stripe-express-login` | Auth JWT + organizer; explicit action | Existing account's Express login link | Unauthorized/foreign account; stale identity; no arbitrary destination |
| `organizer-refund-order` | Auth JWT + owner; event/order IDs; submit or reconcile | Whole-order refund operation and evidence; Stripe TEST; notice receipt | Wrong owner; free source; concurrent retry; refund unknown; original operation retained |
| `ticket-admission` | Auth JWT + event owner + secure credential | Shared atomic admission writer; paid/free admission truth | Wrong event/owner; invalid/refunded/cancelled; duplicate; manual/QR race |
| `moderate-event-queue` | Dedicated worker bearer | Existing claim/apply/fail; service-only exact-envelope/attempt rejection for malformed canonical input; optional contextual provider | Missing token/provider; malformed envelope/input; stale or reclaimed lease; schema disagreement stays visible; no publication from failure |
| `stripe-webhook` | Signed raw Stripe event; separate snapshot/thin secrets when used; TEST mode | Durable event receipts; payment/refund/dispute/account evidence and canonical writers | Invalid signatures/live mode; replay; object binding mismatch; provider unavailable |
| `ticket-email-worker` | Dedicated worker bearer + environment/DB gates | Refund-notice enqueue, durable outbox dispatch, payload key ring, Resend | Disabled; lease/race; provider accepted/failed/unknown; no duplicate issuance |
| `ticket-email-webhook` | Resend signature over raw bytes | Provider observations only, bound to attempt/provider IDs | Invalid signature/timestamp/tags; duplicate/out-of-order observation |

Browser-facing handlers use their existing POST/OPTIONS contracts. Shared CORS in `_shared/cors.ts` accepts the exact `APP_BASE_URL` origin and headers `authorization`, `content-type`, `x-client-info`, `apikey`, `x-whereto-confirmation-bearer`. Keep endpoint-specific method/body checks. Webhooks/workers do not rely on browser CORS for authorization.

Known source bounds to preserve: discovery body 2,048 bytes/cursor 1,024 bytes/max cursor age 15 minutes/page 1–50 (default 20); free create/status body 4,096 bytes and quantity 1–10; shared email HTTP body 2,048 bytes; collection/admission body 512 bytes; organizer refund body 256 bytes; email webhook raw body 65,536 bytes. Source validators remain authoritative for each full shape. A payment cart accepts at most ten distinct submitted items; authoring still permits three tiers. Do not harmonize these unrelated limits.

Manual free admission already has an owner-only browser RPC: `redeem_owned_ticket(p_event_id, p_ticket_id)` routes to `server_redeem_organizer_ticket`. No new free admission service or replacement ticket identity is proposed.

## 3. Browser build variables

The exact allowlist is `src/config/browserEnv.ts`; Vite uses `envPrefix: []`. These are **public build inputs**, never server secrets. A changed value requires a new frontend build. Record a nonsecret configuration profile with the artifact.

| Name | Consumer / role | Local synthetic profile | Staging value and failure check |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `src/lib/env.ts` → browser Supabase client | Task-only gateway URL | Exact approved staging project URL; startup/read errors explicit |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase client | Synthetic task public key | Correct project public key; RLS/owner denial verified; never service role |
| `VITE_MAPBOX_ACCESS_TOKEN` | Existing address-search adapter | Synthetic value plus injected address transport | Approved restricted public token only if address requests authorized; map rendering remains excluded |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Embedded Connect frontend | Synthetic `pk_test_` value + adapter | Approved TEST publishable key for the same server account |
| `VITE_TICKET_SUPPORT_EMAIL` | Buyer support; Settings fallback | Unset in the bound task build; unavailable branch verified | Actual monitored approved destination or explicit unavailable UI |
| `VITE_ORGANIZER_SUPPORT_EMAIL` | Settings Help | Unset in the bound task build; unavailable branch verified | Approved destination; falls back to ticket support |
| `VITE_ACCOUNT_CLOSURE_EMAIL` | Settings account closure request | Unset in the bound task build; unavailable branch verified | Approved destination; falls back to support; no automatic destructive closure |
| `VITE_TERMS_URL` | Validated Settings legal link | Unset in the bound task build; unavailable branch verified | Approved real HTTPS document; placeholder/example URLs rejected |
| `VITE_PRIVACY_URL` | Validated Settings legal link | Unset in the bound task build; unavailable branch verified | Approved real HTTPS document; no fabricated legal content |
| `VITE_SCREEN_PREVIEW_ENABLED` (computed) | `main.tsx` chooses fixture gallery on `/preview/**` | Gallery separate opt-in build | **False** for final application Preview; explicit opt-in implemented as `WHERETOO_ENABLE_PREVIEW=1` |

The first four inputs are required by the current public environment reader. Missing support/legal inputs must produce unavailable states, not dead links. Settings legal links alone do not configure the database's publication policy requirements.

## 4. Edge/server secrets and runtime configuration

Place server values only in the explicitly approved Edge environment/secret store. Keep synthetic local values in ignored task configuration. Never import a source worktree's `.env.local`; never print values in artifacts, shell output, browser code or evidence. The table names are current source names, not generic provider conventions.

| Variable | Consumer / purpose | Validation / continuity / unavailable behavior |
|---|---|---|
| `SUPABASE_URL` | `_shared/env.ts`, service database | Task loopback or named staging project; fail closed when invalid |
| `SUPABASE_SERVICE_ROLE_KEY` | Service database / Auth validation | Privileged; server only; wrong-target check before any call |
| `APP_BASE_URL` | CORS, checkout returns, email links | One exact approved origin; match public frontend, Auth and protected tester access |
| `STRIPE_RESTRICTED_KEY` | `_shared/stripeClient.ts` | Existing parser requires `rk_test_`; not `STRIPE_SECRET_KEY`; restricted permissions must cover actual reachable calls |
| `STRIPE_WEBHOOK_SECRET` | Snapshot event verification | Receiver-specific signing secret; verify raw body and TEST envelope |
| `STRIPE_THIN_WEBHOOK_SECRET` | Thin event verification, when configured | Separate receiver secret; keep account event retrieval/binding checks |
| `TICKET_CREDENTIAL_SECRET` | Issuance/collection/admission credentials | Canonical 43-character base64url encoding of 32 bytes; continuity across functions and deployments |
| `DISCOVERY_RATE_SECRET` | Independent discovery fingerprint HMAC | 32 decoded bytes; no quota/key sharing with payments/email |
| `DISCOVERY_TRUSTED_IP_HEADER` | Discovery limiter ingress | Exact overwritten gateway header; direct spoofing test required |
| `DISCOVERY_TRUSTED_IP_HEADER_VERIFIED` | Explicit discovery trust gate | Must equal `true` only after verification; missing gate returns unavailable |
| `TICKET_EMAIL_RATE_SECRET` | Recovery/access fingerprinting | 32 decoded bytes; preserve independent lane |
| `TICKET_EMAIL_TRUSTED_IP_HEADER` | Email HTTP limiter ingress | Required trusted overwritten header, not arbitrary browser assertion |
| `TICKET_EMAIL_PUBLIC_ENABLED` | Public recovery gate | Exact `true` enables; disabled until separately approved |
| `TICKET_EMAIL_PAYLOAD_KEY_ID` | Current encrypted payload key | Must resolve in key ring; record key ID only |
| `TICKET_EMAIL_PAYLOAD_KEYS_JSON` | Worker/recovery encrypted payload key ring | Map IDs to canonical base64 32-byte keys; keep old keys for outstanding payloads |
| `TICKET_EMAIL_WORKER_SECRET` | Worker authorization | 32–256 characters; never expose in frontend or scheduler logs |
| `TICKET_EMAIL_WORKER_ENABLED` | Worker environment gate | Exact `true`; DB switch also required |
| `TICKET_EMAIL_FROM` | Outbound sender | Approved/verified sender identity; validated format |
| `TICKET_EMAIL_SUPPORT_EMAIL` | Template support/reply destination | Approved monitored mailbox; no invented separate reply-to environment variable |
| `RESEND_API_KEY` | `_shared/ticketEmailProvider.ts` transport | `re_` credential; scoped approved account; local transport injected |
| `RESEND_WEBHOOK_SECRET` | Signed provider observations | Verify with pinned Resend SDK over raw payload |
| `MODERATION_WORKER_TOKEN` | Moderation queue worker | 32–256 characters; dedicated token |
| `REPORT_FINGERPRINT_SECRET` | Report privacy/rate control | 32–256 characters; independent purpose |
| `CONTEXTUAL_MODERATION_ENDPOINT` | Optional moderation service | Approved HTTPS endpoint only; absence does not authorize auto-approval |
| `CONTEXTUAL_MODERATION_BEARER_TOKEN` | Optional moderation service authorization | Server only; no new provider proposed |

Checkout/free ingress currently reads `cf-connecting-ip`, then the first `x-forwarded-for` entry, then `unknown`. Unlike discovery, it does not require the explicit verified-header flag. That is a **staging trust verification gate**, not proof that either header is trustworthy. Requests go directly to Supabase; Vercel's ingress behavior cannot establish trust at Supabase. Run malicious-header and shared-NAT controls against the exact later gateway. If source changes are needed, propose the smallest bounded adapter repair with evidence.

Database gates to configure through existing authority, with exact target and rows approved:

- `private.checkout_runtime_control.checkout_creation_enabled`: initially false. Enable only in the approved synthetic local context or separately authorized Stripe TEST run.
- `private.ticket_email_settings.enabled_at`: initially null; sets eligibility timing for automatic initial intent creation. Configure before scenario fulfillment when testing initial delivery.
- `private.ticket_email_settings.worker_enabled`: initially false. Both DB and environment switches must agree.
- `private.ticket_email_settings.limits`: initially null. No approved hosted numeric profile exists in the audited source.
- `private.ticket_email_settings.rate_secret`: generated private database secret; do not expose or replace casually.
- Publication policy environment: existing enum supports **development or production**, not staging. Use the existing development pair only for explicitly approved synthetic staging, visibly labeled test-only; otherwise supply the real approved production pair's version/hash/URL through `private.configure_policy_environment`. Browser legal links are a separate configuration.

### Candidate email numeric profile — pending D3 for hosted use

These are existing candidate values, not an approval implied by this document. Synthetic local tests can install a labeled test profile after Gate B authorization.

| Lane | Candidate limits |
|---|---|
| Recovery recipient | 1/minute, 3/hour, 5/day |
| Recovery IP | 60/15 minutes, 300/hour, 1,000/day |
| Resend recipient | 1/minute, 3/hour, 5/day |
| Resend source | Independently 1/minute, 3/hour, 5/day |
| Resend actor | 30/hour |
| Resend event | 60/hour |
| Verified grant | 60/minute |
| Access IP | 6,000/minute |
| Invalid access IP | 120/minute |

Initial delivery has its own purpose and does not consume recovery/resend quota. Discovery's separate current M02 quota is **60/minute**, hardcoded and provisional; hosted use requires the explicit D2 quota/ingress decision before activation. P01 neutral price summary remains deferred; there is no approval to turn on minimum-price aggregation or remaining-capacity summary. M03 is absent.

## 5. Jobs, invocation and stop controls

| Existing operation | Schedule / bounds in source | Proposed local evidence | Separate staging approval |
|---|---|---|---|
| `whereto-expire-checkout-reservations` | pg_cron every minute → `server_expire_checkout_reservations(clock_timestamp())` | Disable launcher before replay; invoke expired/paid/racing controls explicitly | Named cron job enablement; prove no browser dependency; monitor reservation age |
| `whereto-expire-event-report-fingerprints-daily` | 03:17 UTC → `server_expire_event_report_fingerprints()` | Check 30-day boundary and rate cleanup with synthetic clock/data | Named job enablement and retention verification |
| `moderate-event-queue` | No new scheduler in assembly | Controlled claims/retries/provider-unavailable/staff review | Named invoker/cadence or approved staff procedure; never bypass public eligibility |
| `ticket-email-worker` | Deliberately unscheduled; enqueues up to 25 refund notices then at most 3 processing iterations | One controlled invocation at a time; all six purposes, duplicate and unknown transport | Approve invoker, cadence, batch/recipient cap, secrets and both stop switches |
| `server_enqueue_refund_notices` | Called by email worker | Catch-up repeated invocation produces no duplicate receipt | Included only with named notice purpose authorization; no refund write implied |
| `server_prune_ticket_email_history` | Unscheduled; 90-day history rules and accepted-payload 23-hour rule | Test exact latest SQL while preserving live grants/permanent source receipts/blocks | Named retention operation/cadence; no blanket deletion |
| `server_clear_ticket_email_recipient_block` | Service-only manual support | Isolated suppression/clear proof | Explicit source-specific support action; never an automatic retry tactic |
| `recoverExistingRefundEvidence` / owner reconcile | Existing evidence reconciliation, no new scheduler | Replay original refund operation; unknown/no-replacement proof | Named existing operation; no new refund creator |
| Discovery rate cleanup | Request-driven, ≤100 expired unlocked rows; age one hour | Verify bounded work and retained active quota | No cron proposed; age is eligibility, not guaranteed deletion deadline |

Track oldest queued intent/evaluation, unknown dispatch/refund, canonical anomaly, expired reservation backlog and unavailable ingress. Monitoring here means evidence/operator checks; no new external observability product is proposed. A stop disables new checkout/work dispatch while keeping original confirmation, collection and reconciliation available. Do not delete history or rotate secrets to hide uncertainty.

## 6. URLs, Auth and provider receivers

Use the actual approved origin and Supabase project URL to instantiate this table later. These are relative contracts, **not invented hosted addresses**.

| Contract | Existing path / rule | Later verification |
|---|---|---|
| Frontend start | `/discover`; `/` redirects | Production build, anonymous eligibility and gated unavailable state |
| Auth confirmation | `/organizer/setup` on exact approved origin | Fresh signup, delivered Auth link, single adoption, owner onboarding |
| Settings Auth callback | `/organizer/settings/account` | Approved email/password/reauth flows; old identity writes suppressed |
| Event Connect return | `/organizer/settings/payments?eventId=<owned UUID>` → `/organizer/events/<same UUID>/preview` | Fresh event and Connect reads; incomplete readiness retained; no autopublish |
| Checkout return/confirmation | Existing original confirmation-token `/orders/<token>` flow | URL refresh and pending/unknown; signed fulfillment required; no URL-success trust |
| Ticket collection | `/tickets/<bearer>` or `/rsvp/<bearer>` and selected ticket routes | Original proof continuity; exact ticket position; no bearer in shared evidence |
| Email access | `/ticket-access`, `/refund-details`, `/event-status` with existing purpose-scoped fragment | SPA deep link; fragment retained client-side; received link purpose binding |
| Stripe event receiver | Supabase project URL + `/functions/v1/stripe-webhook` | Raw signed snapshot/thin payloads; TEST mode; idempotent durable receipts |
| Delivery observation receiver | Supabase project URL + `/functions/v1/ticket-email-webhook` | Signature, attempt/provider binding, replay/out-of-order states |

Register only source-consumed Stripe event families with the correct platform/connected-account context and snapshot/thin destination format, after remote configuration review:

- Checkout: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
- Refund: `refund.created`, `refund.updated`, `refund.failed`.
- Dispute: `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`, `charge.dispute.funds_withdrawn`.
- Accounts v2: `v2.core.account.created`, `v2.core.account.updated`, `v2.core.account.closed`, `v2.core.account[configuration.recipient].capability_status_updated`, `v2.core.account[configuration.recipient].updated`, `v2.core.account[defaults].updated`, `v2.core.account[future_requirements].updated`, `v2.core.account[requirements].updated`.

Current Stripe client pins `2026-07-29.dahlia`; verify account/key permissions against actual used operations before activation. A webhook subscription is not authorization to manufacture every event or perform disputes/payouts. No payout test is proposed.

Resend observations consumed: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`. Preserve `svix-id`, `svix-timestamp`, `svix-signature` and raw body; require the existing `attempt_id` tag. Sending records are separate from webhook delivery observations and from ticket/refund truth. Auth SMTP and transactional mail are separate configuration/test lanes; receiving one kind does not prove the other.

## 7. Vercel/staging execution preparation

1. After local approval and verification, produce the concrete source export, per-function bundle/import identity, migration list, public env profile and secret **names**. Record all remaining nonlocal evidence gaps.
2. Under C0, inspect only named nonproduction targets and Git integration side effects. Determine whether a push itself builds/deploys or applies schema. Record the actual database, extension and relevant CLI versions. Stop on any production, live or unknown target classification. No guessed project, cached main linkage or automatic production selection.
3. Decide the stable frontend origin before Auth/CORS/email/Stripe setup. Preview protection must permit the approved testers opening email/Stripe returns; no bypass token in shared links. Edge webhooks must remain reachable at Supabase and validate signatures.
4. Vite preset, root export, frozen pnpm install, `pnpm build`, output `dist`. Record actual Node 22 patch and package-manager version. Gallery is disabled in this application build. No automatic Production promotion.
5. Review `vercel.json` SPA rewrites and `index.html` CSP using served production output. Test `/discover`, public event, organizer deep links, checkout return, original bearer collection and fragment access on hard refresh. Check JS/CSS MIME/cache behavior and no secret/token leakage. Local Vite development strips CSP and is not this proof.
6. Apply only individually authorized backend/config/provider operations below. Keep job/public/checkout switches off until the corresponding scenario is approved. A schema replay that installs cron requires a reviewed inert-job mechanism for the actual hosted platform; do not assume local PostgreSQL launcher privileges exist in managed staging.
7. Run anonymous read and owner isolation checks before approved paid/free/admission mutations. Record deploy URL/ID/time, source commit/export digest, output identity, Supabase project/ref and schema digest, function versions and nonsecret config profile. A Vercel build alone cannot establish backend readiness.

Official references checked during Gate A: [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite), [Vercel environment variables](https://vercel.com/docs/environment-variables), [Supabase Auth redirects](https://supabase.com/docs/guides/auth/redirect-urls), [Supabase Edge deployment](https://supabase.com/docs/guides/functions/deploy). Provider UI/CLI syntax and permissions must be rechecked against the exact approved target before execution.

### Independent external action approvals

The C0–C13 rows in the main plan organize work; **they are not bundled permissions**. Each external mutation or test must name target, operation, payload/config diff, cost/count/value ceiling, stop condition and evidence. In particular, split the following before requesting approval:

| Approval family | Independently reviewable actions |
|---|---|
| Targets | Read Vercel target/integration; read Supabase target/schema/config; read Stripe TEST context; read email configuration |
| Git | Commit exact allowlist; push exact ref with explicitly listed automatic side effects; any later merge separately |
| Infrastructure | Create/reuse named staging Supabase project; link local destination; create/configure named Vercel project; any domain/DNS change separately |
| Backend | Apply exact migration manifest; configure policy pair; configure fee/runtime rows; create/authorize test staff; deploy exact function versions |
| Config | Set each reviewed server secret group; set frontend public profile; set CORS origin; set Auth Site URL/redirects; set Auth confirmation/password policies; configure Auth SMTP |
| Webhooks | Register Stripe snapshot destination; register Stripe thin destination if used; register Resend observation receiver |
| Frontend | Deploy exact Preview artifact; configure tester protection/access; no production alias/promotion |
| Auth tests | Signup/confirmation; sign-in/out; name change; email change and its notifications; password/reauth; synthetic-user cleanup separately |
| Connect/address tests | Connect TEST setup; manage/status return; Express login; bounded Mapbox address searches. No account/payout behavior beyond the reviewed source |
| Payment tests | One approved 3-ticket successful TEST checkout at exact persisted prices; separately one failed/cancelled checkout control; separately one whole-order TEST refund; separately any signed event replay |
| Delivery tests | Initial paid; initial free; organizer resend; buyer recovery; refund notice; event-change notice; cancellation notice — each with named recipients and cap. For each purpose, distinguish provider acceptance, an actually received message, and a usable received link with the correct source/purpose |
| Other staging writes | Free RSVP test; explicit manual ticket admission; QR admission and duplicate attempt; owner event edit; explicit notice submit; event cancellation, with scenario IDs/limits |
| Door/device tests | Separately approve named devices/browsers, camera permission and denial, stream teardown, and a bounded QR/manual race on an exact ticket; preserve the first Used timestamp |
| Jobs | Each cron activation; moderation invocation; email worker invocation/cadence; history cleanup; suppression clear only if actually needed |
| Cleanup | Stop named job/service; remove exact task resources/test users only if approved; preserve canonical financial/admission history |

An unknown payment, refund or delivery response does not authorize another payment identity, refund operation or unbounded send. Stop and reconcile the original authority. Missing recipients/prices/project IDs are explicit later decision inputs, not placeholders to auto-fill.


## Approval request template — complete before each external action

No action is authorized by filling this template. Request approval for one concrete target/action at a time:

| Required field | Exact value supplied at that later gate |
|---|---|
| Target | Account/project/ref, environment, region and TEST/live classification |
| Operation | Read/configure/deploy/invoke/send/mutate, exact API/CLI and payload/config diff |
| Frozen input | Source/lock/migration/function/build identity as applicable |
| Scope | Named synthetic identities, event/order namespace, recipient list, purpose and count/value/cost ceiling |
| Side effects | Git-trigger deployment, notifications, scheduled work, external requests and persistence |
| Safety/stop | Target checks, stop switches, unknown-outcome reconciliation and rollback compatibility |
| Evidence | Sanitized result path and acceptance/rejection criteria |

The next hosted step is read-only inspection of individually named targets and automatic Git effects. Commits, pushes, schema changes, function/Preview deployments, credentials, Auth mutations, Stripe TEST transactions, real emails and jobs each need their own approval. No production promotion is proposed.
