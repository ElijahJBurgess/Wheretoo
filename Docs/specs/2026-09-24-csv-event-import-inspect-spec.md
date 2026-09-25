# CSV Event Import V1 — inspection, specification, and Build + Prove plan

Inspection date: September 24, 2026. **Specification only; not implemented.**

The user's request authorizes inspection and planning, not execution of the attached document's build instructions. No migrations, dependencies, application changes, hosted changes, geocoding requests, deployments, commits, pushes, or merges were made. Public provider documentation was consulted; no Mapbox API was called.

**Recommendation: ready for local Build + Prove under the recommended V1 operating model below. Not ready for activation.** The important qualification is publication authority: any active admin may import and inspect, but only the genuinely authenticated official organizer may edit, accept policies, and publish. An admin who is also that organizer can complete the entire flow. Other admins cannot publish its events. This is an explicit refinement of the attachment's “admin reviews/publishes” wording, not an existing cross-organizer staff capability. If individual non-owner admins must publish, that requirement needs a separate approved authority design before building that path.

## A. Current main HEAD and branch state

- Fetched `origin/main`: `3627e9a604b133dd129d60ee87e09eecff5a9e98`, “Merge pull request #5 from ElijahJBurgess/codex/waitlist-v1”. It exactly matches the expected integrated main in the attachment.
- Open checkout: `codex/recovery-main-before-final-20260915`, HEAD `1d87c88fbb9da4ea4bf335659de7623af084c92e`. It has extensive existing tracked/untracked work. It is not the inspection baseline.
- Inspected an isolated temporary `git archive` snapshot of fetched main. No checkout, stash, reset, merge, or worktree creation was performed.
- Read the three governing product/flow/architecture documents and main's AGENTS.md. This report distinguishes observed main behavior from new recommendations. Hosted database contents, account configuration, and deployment freshness were not inspected.
- Build + Prove must start in an isolated checkout of freshly verified integrated main, not the dirty recovery checkout. If main moves, reconcile the delta first.

## B. Current event ownership, creation, and publication

`public.organizers.id` is the corresponding `auth.users.id`; an event has one `organizer_id`. `saveEventDraft` directly inserts/updates allowed event columns through Supabase and owner RLS. Draft reads filter by both event and organizer. Published revisions use owner RPCs and optimistic event-change context.

The complete migration chain, rather than the first events migration, is authoritative:

- Ordinary defaults are `status=draft`, `moderation_status=not_evaluated`, `public_history_status=never_public`, `content_revision=1`, `animation_preset=generic`.
- Insert triggers derive the PostGIS point and establish an ineligible interval; deferred triggers capture event-change facts. Import must let these execute normally.
- `publish_event_if_current` checks context, then calls `publish_event`; the latter wraps the existing publication implementation with owner locks and change-history capture.
- Publication checks actual owner identity, future start for drafts, valid end, supported geography, disclosures, current policy configuration and exact revision/input-bound policy acceptance. It performs ordinary moderation and eligibility transitions.
- A server-created event must use an explicit insert column list containing only canonical draft content, organizer resolved by the server, free admission, and capacity. Do not set moderation/publication/authorization/history fields or bypass triggers.
- No artwork is required by the current publication contract. Canonical image attachments and cover controls can be used later by the owner. Leave legacy `artwork_path` null; do not populate it as a substitute for current image attachments.

**Fit:** a narrow privileged draft-creation RPC fits the codebase. Calling the ordinary browser insert as another organizer does not. Existing Duplicate Event provides a useful example of inserting canonical draft content without copying lifecycle truth, but its operation and retry contract are not the import engine.

## C. Staff/admin authorization

Current staff identities live in `private.staff_roles`, with `role` and `active`. Existing helpers are `private.get_active_staff_role(user_id)`, `private.require_active_staff_role(require_admin)`, and `public.get_my_staff_role()`.

`RequireStaff` admits both moderators and admins. It is a UX boundary, not sufficient import authorization. Existing staff routes are `/moderation` and `/moderation/events/:eventId`, inside the session/organizer shell and outside `RequireOrganizer`.

Add an admin-only child guard for import screens. Every read and mutation independently checks active admin status. JWT identity is verified on Edge through `auth.getUser`; a service-only SQL contract receives that verified actor ID and rechecks the existing staff-role table. A browser cannot supply an actor. Authenticated read RPCs can use `require_active_staff_role(true)` directly. Role revocation must defeat replay as well as fresh work.

## D. Official Wheretoo organizer strategy

No official-organizer configuration or production identity was found in inspected source, migrations, example environment, or seed. This does **not** establish that no such account exists in hosted Auth.

Use a singleton `private.event_import_settings` with nullable destination organizer FK and `enabled=false`. Configure a real official organizer through the established trusted operational setup process, not a public settings form, client environment variable, name lookup, or committed UUID. Give its public profile the intended Wheretoo display name. No source-venue accounts are created.

One private resolver owns the destination boundary. It checks settings, organizer existence, valid profile, completed onboarding, associated Auth user existence and non-deleted/non-banned state. Current organizers have no general `active` flag: define import availability through this setting plus real Auth/profile checks rather than inventing `organizers.active`. Missing or invalid configuration fails closed.

Snapshot the resolved destination and configuration revision on the batch. Recheck at every mutating operation. If configuration changes, refuse further writes for old batches with a clear configuration-changed result; never silently retarget their remaining rows. Previously imported event IDs remain readable by active admins. No ownership transfer occurs.

**V1 operating choice:** the official account has a genuine human operator and can also have an existing active admin role. That operator uses normal owner screens for edits/publishing. Another active admin can import to the configured account, but gets read-only import/draft inspection and a handoff status rather than an unauthorized editor link. Do not share or impersonate sessions programmatically.

## E. Current Free RSVP, tickets, and email

Observed current flow: `free-rsvp` → shared Free RSVP handler → service-only `server_confirm_free_registration` → canonical free issuance implementation → `free_registrations` and ordinary `tickets`.

- Accountless name/email identity; quantity is 1–10 per request. Names are normalized, emails trimmed/lowercased. Email validation is bounded and ASCII-based.
- `capacity IS NULL` means unlimited. Finite capacity compares requested quantity against `private.free_reserved_admissions`, inside the existing event ticketing lock. This counts confirmed registration quantities, retaining used admissions from cancelled registrations.
- A free ticket has `registration_id`; paid order/item/tier references are null. Credentials and collection access use the existing secure machinery. Do not create fake paid orders or free ticket tiers.
- Request UUID plus access proof provides retry identity. Same request/proof returns the durable result; changed payload conflicts. This is not a universal “one registration per email per event” guarantee.
- Initial ticket email is enqueued only when existing email configuration is enabled, issuance is after its activation timestamp, and the source is eligible. Durable initial receipts prevent duplicate initial enqueue, including late replays after outbox retention.
- Delivery depends on worker configuration, recipient policy/suppression and provider success. A confirmed RSVP does not guarantee inbox delivery. Existing organizer resend and buyer recovery apply to free registrations; collection/ticket truth remains usable independently of successful email.
- Import itself creates no registrations, tickets, email outbox entries, or customer messages. An imported event has no special branch in RSVP, fulfillment, QR, recovery, or email.

## F. CSV parser recommendation

No CSV parser dependency was found in package.json, deno.json, or the lockfiles. CSV attendee export is an output feature, not an input parser.

Recommend the small `csv-parse` package, pinned in the Deno import map and lockfile during Build + Prove. Use its ESM synchronous parser for the bounded file. Keep it server-side; a second browser parser is unnecessary. It supports BOM, strict quoting/column handling and record limits. Validate its Deno packaging in the first build task before committing to the integration. [Parser API](https://csv.js.org/parse/api/sync/), [parser options](https://csv.js.org/parse/options/).

Parse arrays first so duplicate headers cannot disappear through object-key overwriting. Do not use comma splitting, type inference, relaxed quotes, permissive column counts, or automatic header renaming. No dependency was installed during inspection.

## G. Exact CSV schema and limits

Required header names, order-independent, case-sensitive:

`title, description, category, start_date, start_time, end_date, end_time, venue_name, address, city, postal_code`

Optional: `capacity, source_url, source_name, notes`. Reject any other name, duplicate name, missing required header, or padded header name. One leading UTF-8 BOM is allowed and removed. Headers-only input is rejected as empty.

| Input | Recommended acceptance rule |
|---|---|
| File | Case-insensitive `.csv` suffix; UTF-8 decoded with fatal errors; at most 2,097,152 bytes of CSV content; no NUL |
| Rows | At most 500 nonblank data records; quoted multiline fields are one record; retain logical record number and physical start line |
| Structure | RFC-style quoted commas, escaped quotes, CRLF/LF supported; wrong field count or malformed quote structure rejects the entire file |
| Blank records | Ignore records whose fields are all whitespace; never ignore a partially populated record |
| Record size | Parser `max_record_size=65536`; semantic field limits below still apply |
| Title | Trim; 3–120 characters |
| Description | Trim edges; preserve internal paragraphs; 20–5,000 characters |
| Category | Trim; exactly one of `food_drink`, `music`, `fitness`, `art_culture`, `shopping`, `community`, `nightlife`, `other` |
| Venue | Trim; 1–160 characters |
| Address / city | Required; trim; proposed operational caps 250 / 120 characters |
| Postal code | Five digits or ZIP+4; retain as text; compare base ZIP to geocode |
| Capacity | Blank → SQL null; otherwise digits only, integer 1–2,147,483,647; reject zero, negatives, decimals, exponent notation and overflow |
| Source URL | Blank or HTTP(S), at most 2,048 characters; reject credentials; do not fetch it |
| Source name / notes | Private optional text, at most 160 / 1,000 characters |
| Text safety | Reject NUL and unsupported control characters; permit paragraph breaks/tab in description/notes; render inert text |

Use Unicode code-point counts aligned with PostgreSQL character lengths, rather than accidentally making astral characters count twice in one validator. Whitespace normalization is field-specific; do not rewrite descriptive text into a title-normalized form.

The importer supplies country US, region CA, Los Angeles timezone, free admission and destination identity. No coordinates, IDs, status, moderation, policy consent or image fields are accepted.

Structural failure creates zero events and zero durable source rows; an accepted, bounded upload can retain a failed batch/error receipt. Valid structure with invalid individual values creates durable invalid rows. Two MB is a proposed application ceiling, not a benchmark result; memory/JSON expansion must be measured in Build + Prove.

## H. Date/time normalization

Require exact `YYYY-MM-DD` and `HH:MM`, real calendar dates, 24-hour time, and finite supported instants. Use `America/Los_Angeles`, never local browser timezone or PostgreSQL's implicit handling of ambiguous wall times. Persist both source wall time and normalized UTC instants.

Current `event.time.ts` rejects nonexistent spring-forward times but explicitly chooses the earlier occurrence of a fall-back ambiguity. **Recommended import-specific refinement:** reject both zero-match and two-match wall times, since CSV has no offset/disambiguation column. Do not change the existing manual editor helper. Share semantics/tests for ordinary times; use a small server-compatible candidate-counting adapter for imports.

Examples: `2027-03-14 02:30` is invalid; `2026-11-01 01:30` needs a corrected, unambiguous time. `2026-02-29` is invalid. End must exceed start, and both checks use instants, not string order.

Require `start > server_now` for import because ordinary draft publication requires a future start. Reject already-ended or already-started rows, including those that become stale while waiting for review; recheck at import and ordinary publish. Do not impose a seven-day or 30-day creation horizon: neither is the current publication limit.

**Existing product/code discrepancy:** product/flow documents describe seven-day discovery; current `private.discovery_window('upcoming', …)` ends at Los Angeles local day +30. Preserve existing discovery behavior in this feature and report this discrepancy for separate product reconciliation. A published event outside a discovery window is not guaranteed to appear immediately.

## I. Mapbox/geocoding architecture

Current frontend uses `@mapbox/search-js-react` (declared `^1.6.0`), suggest/retrieve sessions, `VITE_MAPBOX_ACCESS_TOKEN`, and `normalizeSearchResult`. The normalizer accepts one address/POI result with complete CA/US context and consistent coordinates. Publication additionally enforces latitude 36.8–38.9 and longitude −123.6–−121.0. No server Mapbox helper or server-token configuration was found.

Use a new injectable server adapter for **Geocoding v6 structured forward geocoding**, not the React Search Box workflow. Supply `address_line1`, `place`, `postcode`, `region=CA`, `country=US`, `autocomplete=false`, `types=address`, `limit=5`, and `permanent=true`. Use the CSV venue only as event text, not proof that the venue hosts the event. Geocoding v6 does not provide POI search. [Mapbox Geocoding documentation](https://docs.mapbox.com/api/search/geocoding/).

Persisted coordinates require a storage-permitted result. Mapbox documents temporary results as non-cacheable, permanent results as storable, and permanent access as requiring an eligible account. Search Box results are temporary unless a separate arrangement permits storage. Confirm account entitlement before activation; do not reuse a browser URL-restricted token blindly. Add server-only `MAPBOX_GEOCODING_ACCESS_TOKEN`, excluded from VITE variables, logs, and report payloads. [Storage rules](https://docs.mapbox.com/api/search/geocoding/#storing-geocoding-results), [Search Box restrictions](https://docs.mapbox.com/api/search/search-box/#search-box-api-restrictions-and-limits).

**Application policy, deliberately conservative:**

- Hard gate: complete address identity, nonblank feature ID, city, postal code, CA/US context, finite consistent coordinates, and current Bay Area bounding box.
- Auto-verify only one distinct qualifying address with confidence `exact` or `high`, matched house number/street/postcode/place/region, country matched or inferred, and accuracy `rooftop`, `parcel`, or `point`. Deduplicate identical returned feature IDs before counting candidates. Other plausible competing addresses make the result ambiguous.
- Missing confidence, interpolation, conflicting components, multiple plausible addresses, no result, or unsupported unit details → `needs_review`, not silent first-result selection.
- Clearly malformed address input or confidently resolved out-of-service location → `invalid`. Provider outages never become “invalid address”. Do not use a bounding-box query filter as the sole verification; validate the returned geography.
- Smallest V1 resolution is skip or correct CSV and re-upload. No coordinate override, inline location editor, or “import anyway” for an unverified location. Duplicate override affects duplicate risk only.
- Store canonical selected fields, bounded candidate summaries, match evidence, verification timestamp and adapter/policy version; not full arbitrary provider payloads. Address line 2 remains null if not verified.

Durable claims happen in SQL; requests happen outside transactions; result commits require the current lease token and input revision. Start with 10 rows per continuation, at most two provider calls concurrently, an eight-second per-call timeout, and a 20-second invocation budget. Persist `next_attempt_at`; retry transient timeout/429/5xx up to five attempts with 2/10/30/120-second backoff and bounded Retry-After. Authentication/configuration errors pause work globally instead of burning every row's retry budget. A failed row retains an explicit admin retry action.

## J. Smallest durable private data model

Use three private tables, RLS enabled, no direct grants to anon/authenticated/service_role. Access is through narrow security-definer functions with empty search paths and explicit execute grants.

| Table | Fields and invariants |
|---|---|
| `event_import_settings` | Singleton; enabled default false; destination organizer FK; configuration revision; provider concurrency/rate budget counters and windows. Parser/file caps remain versioned constants, not an admin configuration product. |
| `event_import_batches` | Server UUID; uploading actor FK; destination FK and config revision; upload request UUID; SHA-256 of file bytes; bounded filename; parser version; row count; phase/error; timestamps; cancellation timestamp. Unique `(actor_id, upload_request_id)` binds replay to identical file digest/name. |
| `event_import_rows` | Server UUID; batch FK; record number/start line; bounded normalized input JSON; normalized times; state/errors; verified location/candidate summaries; input revision; duplicate fingerprint/candidate summaries; decision actor/time/fingerprint; requested import actor/time; lease token/expiry/attempts/next attempt; resulting event FK; imported actor/time; timestamps. Unique `(batch_id, record_number)` and unique nonnull resulting event ID. |

Rows are operational/provenance records, not another event model. After import, the ordinary event is the sole editable event truth. Do not synchronize later owner edits back into CSV values.

Add checks for valid states, bounded JSON, paired leases, valid result-state relationships, and immutable imported result/identity. An imported row must have exactly one resulting event; unimported rows must not. Restrict deletion of referenced events/organizers. Reject changes to batch destination or source values once persisted; corrected data is a new upload.

Indexes: `(batch_id, state, record_number)`, due-work index on `(next_attempt_at, id)` for retryable work, and batch history `(created_at desc,id)`. Compute counts from at most 500 authoritative rows in batch-read RPCs instead of independently maintained counters. No separate receipt table is necessary: batches hold upload receipts and rows hold event-creation receipts.

Proposed provider budget default: two concurrent live leases globally and 2,500 attempted calls per UTC day. Reserve attempts atomically before dispatch; uncertain attempts consume budget. This is an application cost cap, not a claim about Mapbox's account quota. Expose a paused-budget state and permit trusted configuration appropriate to the actual account.

## K. State machines

Batch: `uploaded → validating → ready ↔ importing → completed | completed_with_skips`; explicit terminal `failed` for structural failure and `cancelled` for cancellation. “Ready” means the review phase is available, not that every row is valid. Partial imports return to review if unresolved rows remain; do not mark them completed.

Row: `pending → invalid | geocoding`; `geocoding → ready | needs_review | invalid | failed`; `ready → duplicate_possible` on duplicate detection; `duplicate_possible → ready` only through an audited override of current candidates; eligible rows become `imported`; unimported rows can become `skipped`. Retryable failures can return to their prior operation. No durable row `importing` state is needed: pending intent plus lease expresses execution, and the event/result commit is atomic.

Imported/skipped rows are terminal. Invalid/needs-review/duplicate/failed rows remain unresolved until corrected in another upload or explicitly skipped. `completed` means every row imported; `completed_with_skips` means every row imported or skipped, with at least one skip. Cancellation preserves already committed events, prevents new commits, and marks remaining work skipped with cancellation reason. A crash cannot leave “importing” as the only durable truth: active work is derived from intents and unexpired leases.

## L. Deterministic duplicate heuristic

Use exact normalized title equality, not vague similarity or ML. Normalize with Unicode NFKC, lowercase, punctuation-to-space, trim and collapse whitespace; retain letters/digits and accents. Preserve original title for the event. Implement one SQL normalization authority, with conformance fixtures for any UI display of keys.

A possible duplicate requires all three:

1. Equal nonempty normalized titles.
2. Start instants within **30 minutes inclusive**.
3. Same nonblank Mapbox feature ID **or** same normalized canonical address line 1, unit, city, base ZIP, region and country.

Compare verified rows within the batch and existing dated/location-bearing events across organizers, including drafts, published, cancelled and moderation-held events. Within a batch, the earliest source record is the deterministic anchor; later matching records require a duplicate decision, while the anchor shows the group informationally. This prevents two otherwise identical new rows from making each other impossible to import without an override. Include status in the warning; cancellation is not proof that this is a different event. Never expose private event details through public endpoints. Exclude the row's own resulting event on replay.

Add private immutable normalization helpers and two expression indexes on existing events: `(normalized_title, mapbox_feature_id, starts_at)` and `(normalized_title, normalized_address, starts_at)`. Query two indexable branches and union candidates. No new public columns or duplicate-event lifecycle is required. The existing `event_duplicate_title` only generates a “— Copy” name; it is not a duplicate detector.

Persist bounded candidate previews (first 20), total count, and a server digest over the full ordered candidate identities/relevant facts. Show all same-batch conflicts. An override records actor/time and that digest. New or materially changed candidates invalidate the override and require another review; imports must not silently rely on a stale browser preview.

Recheck immediately before insertion. Serialize CSV import commits sharing a normalized title with an advisory lock before the final candidate query, so simultaneous CSV batches see previously committed CSV drafts. This does not promise exclusion against a simultaneous ordinary manual create that does not take that lock. Duplicates are warnings, not a uniqueness constraint; same-row idempotency is the hard guarantee. Title variants beyond normalization can be missed and nearby recurring sessions can be flagged: both are accepted V1 heuristic limits.

## M. Idempotency and transaction boundaries

Upload retries use `(verified actor, upload request UUID)` plus file digest/name; same request/different bytes conflicts. New upload request means a new batch, even for the same file; cross-batch duplicate warnings apply.

Import Selected accepts a batch ID and up to 50 `{rowId, expectedRevision, expectedDuplicateDigest}` records. It records durable row intents; it never accepts event content or destination identity. Repeated selection merges the same intent rather than minting new event identifiers. The UI chunks larger selections and resumes from server truth.

One SQL transaction per row:

1. Check active admin and acquire shared role/settings locks in a documented order.
2. Lock batch, then target row. If already imported, return its existing event ID after authorization checks, even if imports are now disabled or the batch was subsequently cancelled. For new creation, revalidate destination/configuration/gate and reject cancelled/invalid/stale intent.
3. Revalidate canonical fields/time/geocode evidence and current duplicate acknowledgement under the duplicate lock.
4. Insert one ordinary event using server defaults and allow all canonical triggers to run.
5. Set row result ID, imported actor and timestamp in the same transaction.

Any insert/trigger/receipt failure rolls back that row and event together. Successful earlier rows remain committed. A lost HTTP response is unknown outcome, not evidence of rollback: reread the row/continue idempotently. Do not issue a compensating event delete. Row locks and unique constraints make two simultaneous import actions return one event. Event IDs are database-generated.

## N. Admin UX

Use **`/moderation/event-imports`** and `/moderation/event-imports/:batchId` under the existing staff boundary plus admin guard. This fits the actual shell and uses an already reserved root. The suggested `/staff` root is not currently reserved against storefront handles; adding it would introduce an unnecessary namespace conflict/migration.

Provide upload limits and a downloadable header/template; progress counts; 50-row review pages; select-ready/select-visible controls; row errors; duplicate candidates with Skip/Import anyway; explicit retry/continue; Import Selected; result summary and owner-review handoff. Columns match the attachment: row, event, date, venue, address, category, capacity, status. Show “Unlimited” for null capacity and Los Angeles timezone explicitly.

No inline correction in V1. Correct the CSV and upload a new batch. Existing imported rows never become eligible for a second import just because a browser reloads. Keep unsuccessful/unresolved rows visible, preserve server-side decisions, and clear private query state on sign-out/session change using existing lifetime conventions. Use semantic table/checkboxes, keyboard focus, loading/error/empty states, mobile-contained scrolling, and text status announcements.

## O. Draft review/publish path

This is the material architecture qualification. `auth.uid() = organizer_id` is enforced by ordinary reads, editing, requirements, image management, context locks and publication. Policy-acceptance moderation actions currently constrain `actor_type='organizer'`. A foreign admin cannot simply call `publish_event`, and spoofing owner identity would produce false audit authority.

Recommended smallest path:

- Active admins can inspect import provenance and a narrow read-only canonical projection of **events linked to import rows**, including changed-since-import indicators. This is not access to all organizers' drafts or attendee data.
- If the current authenticated user is the configured destination owner, show the existing `/organizer/events/:eventId/edit` and `/organizer/events/:eventId/preview` links.
- The real owner completes existing requirements/disclosures, accepts current policies, optionally adds artwork, then explicitly publishes through the existing single-event flow.
- If not the owner, show “Awaiting official organizer review” and the event ID. No broken editor link, automatic sign-in switch, fake consent, or direct status update.

Imported rows intentionally omit risk disclosures and policy acceptance: CSV does not supply those facts. Do not fill every risk boolean with false or fabricate an “all ages” assertion. This owner review is required even when the row is import-ready.

Alternatives considered: an import-specific admin editor/publisher would need actor-aware shared policy/publication helpers, changes to acceptance-authority constraints, image authorization and extensive equivalence tests. Broad owner RLS expansion is unacceptable. The genuine-owner handoff achieves V1 with much less risk. If the founder requires every staff admin to publish personally, this report is not approval to implement that alternative.

Current public event UI says **“Hosted by {organizer display name}”**, not “Presented by”. Use the actual official profile name and existing presentation; the attachment permits rather than mandates the latter phrase. No consumer CSV badge/source field is needed.

## P. Private provenance and retention

Keep source URL/name/notes, upload actor, import actor, batch/row, file digest, normalized source snapshot, duplicate evidence/override and resulting event privately. Original filename is untrusted display text; never use it as a filesystem/storage key. No raw file storage bucket is needed; discard bytes after parsing and durable row persistence.

Recommended retention: retain imported-row linkage, original source attribution and override evidence as long as the event exists; purge unimported terminal-batch payloads and candidate details after 90 days through a bounded trusted maintenance contract. Retain a small upload receipt/tombstone so an old request ID cannot create a new batch after pruning. Abandoned open batches become cancelled before pruning. Do not activate a hosted cleanup schedule during Build + Prove.

Provenance never joins public event/discovery/storefront/ticket projections. Source URLs are inert references, not scraping targets. If a future report exports user content to a spreadsheet, it must apply the existing export formula-safety convention; no filled-data CSV export is part of this feature.

## Q. Security, RLS and contracts

Proposed public entry points (names are planned, not existing):

| Contract | Allowed inputs / authority |
|---|---|
| Edge `event-import-upload` | Authenticated admin; request UUID, filename and bounded raw CSV bytes; reject all other authority fields |
| Edge `event-import-process` | Admin; batch UUID and operation `continue`, `retry`, `skip`, `override_duplicate`, `select_import`, `cancel`, with operation-specific exact keys |
| `list_event_import_batches`, `get_event_import_batch`, `get_event_import_draft` | Authenticated RPCs; active admin check on every call; bounded projections/pages |
| `server_create_event_import_batch` | Service-only; verified actor, parsed values, file digest; SQL validates shape/caps/destination |
| `server_claim_event_import_work`, `server_complete_event_import_geocode` | Service-only; admin/config checks, fenced leases, bounded provider facts |
| `server_request_event_import_rows`, `server_import_event_row` | Service-only; row intent and atomic canonical event creation |
| `server_resolve_event_import_row`, `server_cancel_event_import_batch`, `server_prune_event_imports` | Narrow decision/cancellation/maintenance contracts; never direct table grants |

Reject browser organizer ID, actor ID, resulting event ID, free/paid selector, any event/moderation/publication status, trusted coordinates and Mapbox identity. Browser row IDs reference batch-owned records; SQL verifies membership. An ordinary organizer, moderator, anonymous user, inactive admin or service caller impersonated with a user JWT cannot execute service-only contracts.

Use request-scoped user clients for user RPCs; never attach a user's bearer to the cached privileged client. Strict Origin/CORS, POST mutations, no-store responses, byte-counted bodies, sanitized error codes and server-only tokens follow existing Edge patterns. Source URLs are never fetched, so no URL-based SSRF path is introduced. HTML/formula-like content is rendered as text and never evaluated. No HTML injection sink is added.

Checks happen before expensive work and again at commits. Share-lock the actor role/configuration during a mutation so role revocation/config changes serialize with in-flight commits. A revocation that wins first denies the action; a committed action remains historical truth. Releasing locks before Mapbox is mandatory; geocode completion checks authority again.

## R. Concurrency, retry and crash behavior

Geocode leases last 60 seconds and carry random fencing tokens plus input revision. A reclaimer after expiry replaces the token; a stale worker cannot save its result. Claim only work that fits the invocation budget, rather than leasing all 500 records. Every possible provider attempt consumes the durable budget even if its response/save is lost; duplicate external requests may happen after a crash, but event creation remains exactly once per row.

Recheck cancellation, role and destination before geocode result save and row import. Cancellation versus import is ordered by the batch lock: a committed event stays; any later attempt is denied. No DB/network transaction spans external calls. A failed batch summary read does not change results; recompute counts from row truth.

Chosen execution model is bounded **admin-triggered continuation**, not a new scheduler. The UI advances pages while open. Closing the browser may pause work; reopening restores progress and Continue resumes it without re-uploading or losing selected-row intents. Autonomous completion while every browser is closed is not promised. No unawaited background task is the only executor. Existing secret-gated workers/leases provide conventions if a future scheduler is approved, but none is required for V1 reliability.

## S. 500-row scale design

Bound file bytes, records, field sizes, provider response bytes (proposed 128 KiB), candidate summaries, page sizes, retries and provider concurrency. Parse the complete bounded file before accepting source rows. Persist rows atomically as one bounded metadata upload; this is distinct from creating 500 events in one transaction.

Geocode at most 10 rows per continuation, import at most 10 one-row transactions per continuation, page review at 50, and chunk selections at 50. No giant event transaction or unbounded Promise.all. Separate provider time from parsing/DB timings in evidence. Measure peak memory and elapsed time for the maximal byte-sized file as well as 500 average rows.

Use injected transport and a clock for scale tests. Measure indexed duplicate candidate plans against at least 10,000 unrelated existing events, not merely an empty database. Verify rate budget exhaustion pauses work without dropping rows. Do not claim hosted latency/quota certification from local mocks.

## T. Exact Build + Prove test plan

Run on dedicated local feature and pristine-main Supabase stacks with synthetic accounts, all hosted links/provider calls forbidden and local cron disabled. The latest Waitlist report records existing baseline SQL/integration failures; those are historical reports, not checks run here. Produce a fresh baseline differential rather than labeling every inherited failure a regression or silently ignoring it.

| Proof group | Required cases and assertions |
|---|---|
| Parser | Quoted commas/newlines/escaped quotes, CRLF/LF, BOM, multibyte UTF-8; 500 accepted/501 rejected; 2,097,152-byte boundary; invalid UTF-8/NUL; duplicate/unknown/padded/missing headers; wrong field counts; malformed final record creates zero events/source rows; ignored all-blank records preserve source numbering |
| Values | All eight categories; unknown category; title 2/3/120/121, description 19/20/5000/5001; astral characters; empty required values; capacity blank/1/max/0/negative/decimal/exponent/overflow; URL/control-character limits |
| Time | Ordinary PST/PDT conversions, leap dates, impossible dates, spring gap/fall fold, end=start/end<start, cross-midnight; different machine/browser zones give identical UTC; expires between review/import and between import/publish |
| Authorization | Anon, ordinary organizer, buyer, moderator, inactive admin denied at Edge and RPC; active admin allowed; spoof all authority fields; wrong-batch row; role revoked between claim and save; direct private table reads/writes denied, including service-role table access |
| Destination | Missing/disabled setting, missing profile/Auth identity, incomplete onboarding, banned/deleted Auth identity denied; config change mid-batch cannot retarget rows; official owner can edit; foreign admin read-only and cannot publish |
| Geocode | Single strong address; multiple candidates; no result; wrong state/country; California outside bbox; exact bbox edges; NaN/out-of-range/inconsistent coordinates; missing ID/postcode; house/ZIP mismatch; interpolated/missing confidence; timeout/429/5xx; malformed/oversized response; 401/403 global pause; stale lease rejected |
| Duplicates | Same-batch and cross-organizer existing draft/published/cancelled/held events; punctuation/Unicode normalization; 30-minute inclusive boundary; alternate feature IDs/same canonical address; different unit; first-20 preview with full digest; skip; override; changed candidate after review re-prompts; manual-create race limitation documented |
| Atomicity | Double-click and two real simultaneous DB connections import one row into one event; event insert/trigger failure rolls back receipt and event; crash before/after commit; lost response returns same event; new upload request is new batch; changed upload bytes under same request conflicts |
| Cancellation/retry | Browser close/reopen, stale claim reclaimed, same file resume, source config/role changes, cancel while Mapbox runs, cancel versus DB import, budget exhaustion/recovery, failed summary response; already imported events never deleted/recreated |
| Public truth | Draft absent from public event/discovery/storefront reads; missing disclosures/consent blocks ordinary publish; real owner adds requirements and accepts current policies; ordinary moderation hold prevents eligibility; successful publication exposes ordinary event, without provenance |
| RSVP/ticket/email | Null capacity; finite last-slot race with two connections; request replay; 1 and 10 tickets with canonical free source; QR valid/duplicate/wrong event/cancelled; cancellation retains used-admission capacity semantics; email disabled means no automatic enqueue; enabled means one initial receipt; injected provider failure/recovery/resend and suppression behave normally |
| Regression | Manual create/edit/publish, image attachment, policy acceptance/moderation/public eligibility, discovery/map geography, free registration/Ticket Truth/check-in/email recovery, paid ticketing, Waitlist, attendee CSV export, Duplicate Event, Email Attendees, organizer RLS; no import branch in consumer contracts |
| Browser | Admin/non-admin routes, accessible upload and review, empty/error/retry states, duplicate decisions, partial selection, reload/lost-response recovery, owner/non-owner handoff, 390px and 1440px layouts, no console errors or token/provenance leaks |

**Deterministic 500-row fixture:** 350 clean unique rows; 50 semantic-invalid; 25 rows duplicating distinct earlier rows; 25 existing-event duplicates; 25 ambiguous geocodes; 25 transient geocode failures. First wave imports the 350 ready rows only. Retry the transient group successfully. For the 50 duplicate rows, skip 30 and explicitly override 20. Inject one event-insert failure among these later 45 eligible rows; first later wave commits 44, retry commits the remaining one. Finally skip the 50 invalid and 25 ambiguous rows. Assert **395 distinct ordinary drafts, 105 skipped, zero unresolved, zero invented registrations/tickets/emails**. Replay every import and lost response: still exactly 395 events with identical row mappings. Separate race fixtures cover two batches simultaneously importing matching candidates.

Future verification commands, after implementation and local dependency setup:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm typecheck:functions
pnpm test:functions
python3 tests/integration/run-event-import-local.py start
python3 tests/integration/run-event-import-local.py reset
python3 tests/integration/event-import-proof.py
python3 tests/integration/event-import-concurrency.py
python3 tests/integration/event-import-scale.py
python3 tests/integration/event-import-regressions.py
pnpm exec playwright test --config playwright.event-import.config.ts
```

The `event-import-*` runners/config above are planned files, not existing runnable commands. They must hardcode/guard dedicated localhost project identities and reject remote targets. Do not use the existing `db:types` script blindly: it uses `--linked`; generate types from the dedicated local DB instead. Retain assertion counts, timings, query plans, baseline deltas and screenshot evidence. Do not activate real provider/email workers merely to make a test pass.

## U. Likely files and implementation sequence

The companion implementation plan supplies task order and contract boundaries. Proposed files:

- `supabase/migrations/<next_timestamp>_add_event_import_v1.sql`: three tables, checks/indexes, private normalization/destination helpers, authenticated reads, service-only row/lease/import/maintenance contracts. Timestamp chosen against main at build time; no migration exists yet.
- `supabase/functions/event-import-upload/index.ts`, `event-import-process/index.ts`.
- `supabase/functions/_shared/eventImportCsv.ts`, `eventImportValidation.ts`, `eventImportTime.ts`, `eventImportGeocode.ts`, `eventImportService.ts`, `eventImportHttp.ts`, with focused Deno tests.
- `src/features/event-imports/RequireImportAdmin.tsx`, `EventImportsPage.tsx`, `EventImportBatchPage.tsx`, `EventImportReviewTable.tsx`, `EventImportDraftPage.tsx`, `eventImports.api.ts`, `eventImports.queries.ts`, `eventImports.schemas.ts`, `eventImports.css`, corresponding Vitest/RTL tests.
- Modify routing and admin navigation in `src/app/router/router.tsx`, `src/components/layout/OrganizerLayout.tsx`, `src/features/organizer-operations/OperationsUi.tsx`; preserve moderator navigation behavior.
- Update `deno.json`, `deno.lock`, `deno.staging-import-map.json`, `supabase/config.toml`, `.env.example` and public DB RPC types as needed. CSV parser belongs in the Edge dependency map; no browser package is necessary.
- Add `supabase/tests/database/event_import_{schema,security,behavior}.test.sql`; the dedicated integration/concurrency/scale/regression runners named above; `tests/e2e/event-import.spec.ts`; `playwright.event-import.config.ts`; a fixture-only Edge adapter under `tests/integration/edge/event-import/`; `Docs/testing/csv-event-import-v1.md` and setup/retention runbook.
- No planned changes to owner publication implementation, payment/RSVP/ticket writers, public projection shapes, Mapbox browser behavior, existing discovery windows or manual time conversion.

## V. Scope guard

No paid imports, organizer picker, self-service organizer uploads, source-site fetching, scraping, recurring expansion, merging/updating/deleting existing events, external checkout, fake venue organizers, bulk publish, fabricated policy acceptance/disclosures, marketing mail, SMS, general Staff Access expansion, or public third-party API. No image ingestion/AI generation during import. The sole future extension point is destination resolution; parser and row engine have no hardcoded official UUID.

## W. Risks, qualifications and operational setup

1. **Owner handoff:** the recommended V1 cannot let every foreign admin publish. The official owner operator is mandatory. If that operating model is unacceptable, stop and approve a narrowly scoped staff publication design first; do not weaken RLS.
2. **Hosted configuration unknown:** official identity, active status, email activation, approved policy versions and Mapbox storage entitlement cannot be proved from Git. Verify during a separately authorized activation phase.
3. **Provider coverage:** strict address verification intentionally rejects some real parks, intersections, POIs and ambiguous unit addresses. Fix CSV/skip is the V1 answer; no invented coordinates.
4. **Existing drift:** 30-day discovery versus seven-day product docs is pre-existing. Keep it visible without changing it here. DST import rejection is intentionally stricter than the existing earlier-fold manual behavior.
5. **Baseline debt:** the Waitlist report records 51 SQL baseline failures plus environment/CSP integration issues. Fresh comparison is required; none of those tests was run in this inspection.
6. **Scheduling:** browser closure pauses continuation until an admin resumes; durable progress is the guarantee. If unattended completion is required, add a separately approved scheduler, not a fire-and-forget promise.
7. **Duplicate limits:** exact normalized title matching is conservative and incomplete; it is not an event identity guarantee. Row replay remains exact even when intentional duplicate overrides are permitted.

Manual setup after Build + Prove: select/verify official organizer and genuine operator; configure private destination with gate off; verify policy configuration; provision server-only storage-permitted Mapbox token and budget; validate existing email setup only if email delivery is expected; separately authorize migrations/deployment/enablement. No setup was performed now. Ordinary design choices above are recommended; the only material founder choice would be rejecting the owner-publisher operating model.

## X. Final recommended V1 specification

An active admin uploads a bounded UTF-8 CSV. The server authoritatively parses it, persists private normalized rows, verifies supported Bay Area addresses through a storage-permitted Mapbox adapter, and flags deterministic duplicate candidates. The admin reviews, skips, retries or explicitly overrides duplicate risk, then selects verified eligible rows. Resumable bounded processing atomically creates one ordinary official-organizer-owned free draft per row and durably records the result. Missing destination/configuration/authorization fails closed. The actual official owner completes ordinary requirements and policy acceptance and publishes individually. Existing eligibility/discovery and Free RSVP/ticket/email behavior applies unchanged. Private provenance remains private.

## Y. Ready for Build + Prove?

**Yes — for the recommended owner-publisher V1 and local, injected-provider proof.** The architecture fits current main and the implementation plan is concrete. This is not a claim that it is built, tested, hosted-ready, or authorized for deployment. **No** if “admin publishes” requires a different individual admin to bypass official-organizer ownership; that is the unresolved alternative, not an implicitly approved feature.

Checks actually performed: fetched/verified main and working branch; inspected source, cumulative migration definitions, dependency/configuration files, existing test conventions and historical proof reports; consulted official Mapbox/CSV documentation; cross-checked specification coverage and planned authority boundaries. No builds or tests were run because this task is inspection only and the working checkout is not current main. Added only this report and its companion plan; no migration or application file was changed.

## Evidence index — pinned to inspected main

All links below refer to commit `3627e9a604b133dd129d60ee87e09eecff5a9e98`, not the older working checkout.

- [Canonical event/organizer schema](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260824010000_create_organizers_and_events.sql); [owner grants/RLS](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260824010100_secure_organizer_event_publishing.sql); [event client contracts](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/src/features/events/event.api.ts).
- [Moderation/acceptance constraints](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260826010000_create_moderation_foundation.sql); [current draft defaults](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260826010100_migrate_legacy_moderation.sql); [publication implementation](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260826011250_support_active_event_republication.sql); [change-history wrappers](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260915010000_add_event_change_history.sql).
- [Staff role helpers](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260826010700_add_staff_moderation_operations.sql); [staff route guard](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/src/features/moderation/RequireStaff.tsx); [router](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/src/app/router/router.tsx).
- [Free source/capacity](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260912010000_create_free_registration_source.sql); [atomic free issuance](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260912010100_add_atomic_free_registration.sql); [email wrapper/recovery](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260913010200_add_ticket_email_entry_points.sql); [initial email receipts](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260913010400_preserve_initial_email_deduplication.sql).
- [Manual time semantics](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/src/features/events/event.time.ts); [Mapbox normalizer](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/src/lib/mapbox/normalizeSearchResult.ts); [Search Box integration](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/src/features/events/LocationSearchField.tsx).
- [Public eligibility](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260826010450_harden_public_eligibility_reads.sql); [current discovery window/query](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260917010000_add_public_discovery_read.sql); [image attachment boundary](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260919010100_add_event_images.sql).
- [Duplicate Event draft insertion](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/migrations/20260924010500_add_duplicate_event_v1.sql); [private workers/leases convention](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/supabase/functions/organizer-message-worker/index.ts); [latest historical test baseline](https://github.com/ElijahJBurgess/WhereTo/blob/3627e9a604b133dd129d60ee87e09eecff5a9e98/Docs/testing/waitlist-v1.md).
