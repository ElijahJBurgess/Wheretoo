# Wheretoo CSV Export V1 — inspection and proposed specification

Status: **For founder review. Implementation not authorized.**

Inspection date: 2026-09-22 (America/Los_Angeles).

## Baseline and governing input

The requested `Docs/specs/csv-export-v1-inspect-spec.md` was absent from both the attached checkout and current main. The supplied attachment, `pasted-text.txt`, was read completely and used as the governing inspection specification. This report does not silently replace that input document.

The attached checkout is `/Users/exoh/Desktop/WhereTo -  Repository`, branch `codex/recovery-main-before-final-20260915`, HEAD `1d87c88fbb9da4ea4bf335659de7623af084c92e`, with pre-existing tracked and untracked changes. It predates the integrated organizer operations and free RSVP implementation. A read-only worktree inventory located current main at `/Users/exoh/Desktop/WhereTo-main-final`, HEAD `dcb39e6c9f1a155782352ac1f79bd3617fff5472`; that checkout was clean before this report. **The user explicitly confirmed current main as the target.** All paths below are relative to that main worktree unless another root is stated.

The three V1 source-of-truth documents were read; byte comparisons confirmed they match between the two checkouts. Findings below come from current code and the ordered migration definitions, not old implementation reports. No hosted database, live customer dataset, or deployment was queried. Migration files establish repository intent, not proof that a particular hosted environment has applied them.

## Recommended decision

Use the existing authenticated organizer SQL boundary, add **one small read-only export RPC**, validate its explicit projection, generate CSV in the browser, and download locally. No new table, background worker, storage bucket, provider integration, or reporting subsystem.

- Paid event: **Orders CSV** and **Admissions CSV**.
- Free event: **Registrations CSV**, with one row per issued admission and repeated registration context.
- Export the entire event, including historical and inactive records; ignore current search, status filters, and UI pagination.
- One additive migration is recommended for the read RPC and its grants. **No data-model migration is needed.** Existing search contracts cannot enumerate all free registrations, so zero migrations cannot deliver the whole feature safely through the present authorized reads.
- Do not call ticket holders “attendees” with invented personal identities. Paid data contains buyer identity; free data contains registrant identity. Neither identifies every person in a group.

## A. Current-state findings

### Events, ownership, and history

`public.events.id` is a UUID; `organizer_id` points to `public.organizers.id`, which is the authenticated user's ID in the current owner model. `admission_type` distinguishes paid/free. Stored event status is `draft`, `published`, or `cancelled`; Ended is derived from `ends_at`, not a fourth database status.

`src/features/events/event.api.ts:getOwnedEvent` filters by both event and organizer. The `events_owner_read` RLS policy is defined in `20260824010100_secure_organizer_event_publishing.sql`. Organizer history is not restricted by public discovery eligibility. `src/features/events/organizerEventPresentation.ts` supplies current list status and destinations, including ended/cancelled history.

The operative SQL authorization helpers are:

- `private.require_owned_paid_event(uuid)` in `20260910010000_add_organizer_event_metrics.sql`: matches `events.organizer_id = auth.uid()` and paid source.
- `private.require_owned_free_event(uuid)` in `20260912010300_add_free_owner_reads_and_rate_limit.sql`: the equivalent free-source boundary.

Both support owner history without requiring a currently public or admission-eligible event. Base ticketing tables remain unavailable to anonymous/authenticated direct reads. Free source tables explicitly revoke access from service role too; do not assume a service client can directly select them.

### Paid orders and money

Authoritative tables are `orders`, `order_items`, `tickets`, and `refunds`, initially defined in `20260825010000_create_ticketing_payments_schema.sql`. Later migrations are essential:

- `20260902010000_expand_checkout_integrity_schema.sql`: multi-item orders, unique `(order_id,ticket_tier_id)`, quantities 1–10.
- `20260907010000_integrate_core_ticket_truth_lite_fulfillment.sql`: immutable admission identity and used history.
- `20260915010100_add_cancellation_summary.sql`: latest organizer coherence exception for verified payment after invalidation without tickets.
- `20260914010000_add_refund_operations.sql`: durable refund operation and the current refund-panel state projection.

Orders have a unique `order_number`, buyer name/email, `created_at`, nullable `paid_at`, status, quantity, currency, original subtotal/tax/total minor-unit snapshots, and refund timestamps. **Created date is not purchase date; original total is not necessarily money paid.** Failed, expired, open, and processing orders exist alongside paid/refunded orders.

Order items preserve purchased `tier_name`, `unit_amount_minor`, quantity, subtotal, and currency. Export these snapshots, never current tier name/price. Archived tiers must not remove historical items. Per-person attendee identity is not collected in these records.

Canonical order statuses are `creating_checkout`, `checkout_open`, `payment_processing`, `payment_failed`, `expired`, `cancelled`, `paid`, `refunded`, `requires_review`, and legacy `partially_refunded`.

`private.organizer_order_coherent` is the existing read-integrity authority. Its latest definition preserves the recognized `PAYMENT_AFTER_INVALIDATION` case: recorded payment, order requiring review, no tickets. CSV must include that order without inventing admissions. Other incoherent records fail the complete export rather than silently disappearing.

### Exact organizer read contracts

| Current caller | Authoritative contract | Important behavior |
| --- | --- | --- |
| `src/features/organizer-operations/operations.api.ts:listEventOrders` | `list_organizer_event_orders_filtered` | 25 requested rows, server max 50; descending `(created_at,id)` cursor; name/email/order-number search; `all`, `paid`, `refunded` filters. Empty search lists all statuses. |
| `operations.api.ts:getOrderDetails` | `get_organizer_order_v2` | Delegates ownership/coherence/tickets to `get_organizer_order`; adds immutable unit amounts, subtotal and tax. |
| `operations.api.ts:listEventAdmissions` | `list_organizer_event_admissions` | Ticket-level cursor; max 50. **Blank search intentionally returns an empty page.** |
| `freeOperations.api.ts:listFreeAdmissions` | `get_organizer_free_admissions` | Registration/admission projection; name substring or exact email; **blank search intentionally returns an empty page**. UI requests 25; parser allows 25 although SQL allows 50. |
| `freeOperations.api.ts:getFreeRegistration` | `get_organizer_free_registration_detail` | One owned coherent registration with its full ordered ticket set. Requires a known registration ID. |
| `src/features/refunds/refunds.api.ts` | `get_organizer_refund_status` | Current refund-panel state, including pending/unknown/review situations before or after provider evidence. |

Contract schemas live in `operations.schemas.ts`, `freeOperations.schemas.ts`, and `src/features/refunds/refunds.schemas.ts`. Existing allowlists and parser failures should be retained; no broad “accept any JSON” export adapter.

SQL definitions: `20260910010100_add_organizer_order_reads.sql`, `20260910010150_add_organizer_order_detail.sql`, `20260911010000_extend_spec04_organizer_reads.sql`, `20260911020000_add_owned_admission_search.sql`, `20260912010300_add_free_owner_reads_and_rate_limit.sql`, and `20260913010200_add_ticket_email_entry_points.sql`.

### Tickets, check-in, refunds, and cancellation

Tickets carry order/item/tier source IDs for paid orders, `unit_sequence`, frozen `admission_label`, `issued_at`, `status`, `used_at`, `refunded_at`, `cancelled_at`, and a private `credential_hash`. Statuses are `valid`, `used`, `refunded`, `cancelled`.

Paid ticket position is the existing order-detail order: `(order_item_id,unit_sequence)`, across the complete order. Do not number rows by export page or current sort/filter. Free position is `unit_sequence`.

Used status and its original timestamp survive subsequent whole-order refunds and event cancellation. An order can be refunded while one ticket remains used and the unused tickets are refunded. Event cancellation does not itself mean payment refund. A stored `valid` ticket at an ended event does not mean current admission is permitted. CSV shows source status, parent order/registration status, and event time/status separately; it is not an admission credential or door authorization list.

There are two different refund projections. The older `private.organizer_refund_state` returns eligibility-oriented values such as `available`/`recoverable`. The current refund panel uses **`private.order_refund_state`**, via `get_organizer_refund_status`, yielding `eligible`, `submitting`, `processing`, `failed`, `unknown`, `review`, `completed`, or `ineligible`. Export the latter as **Refund Workflow State**, not a newly invented “refund status.” `eligible` does not mean a refund exists; `completed` is the canonical reconciled completed refund state. Partial/anomalous refunds must remain review cases; do not allocate refund money across ticket units.

### Free RSVP

`20260912010000_create_free_registration_source.sql` defines real `free_registrations` with ID, request ID, event/organizer IDs, name, email, quantity (1–10), status (`confirmed`/`cancelled`), creation/cancellation time, and private access hash. `free_registration_requests` is the durable request/replay receipt, not the attendee list; rejected requests are not registrations.

Tickets share the existing admission infrastructure via `registration_id`. The exact-source constraint makes a ticket either paid-order-backed or free-registration-backed. Free tickets have no paid order/item/tier source, cannot be refunded, and retain used history on cancellation. `private.free_registration_is_coherent` verifies the source/receipt/ticket relationship. Creation is in `20260912010100_add_atomic_free_registration.sql`; shared admission dispatch is extended in `20260912010200_extend_shared_admission_for_free_sources.sql`.

There is no unique human registration number. `FreeGuestTicketDetailPage.tsx` displays the last eight characters of the registration UUID, which is useful visually but not guaranteed unique. For export use the full non-secret registration UUID, prefixed `RSVP-`, as a necessary stable grouping reference. Do not use the access hash or bearer. No new numbering sequence or database column is justified.

### Current organizer UX

Real production routes exist in `src/app/router/router.tsx` for dashboard, Orders, order detail, registration lookup/detail, and check-in/guest lookup.

- `OrganizerDashboardPage.tsx`: event action strip, paid or free metrics, paid “View orders,” free “Find registration / resend tickets.”
- `OrganizerOrdersPage.tsx`: search, All/Paid/Refunded, 25-row load-more pages.
- `OrganizerRegistrationLookup.tsx`: deliberate search-first UI; deduplicates registration IDs from admission search pages. This displayed array is not the export dataset.
- `FindGuestPage.tsx` and guest detail pages: admission operation surfaces, not bulk-export entry points.
- Free events can be reached through `PublishedEventPage.tsx`, which links to their dashboard. Preserve that navigation.

No CSV-specific approved visual contract was found. Reuse existing operations controls and layout. Historical planning docs are not evidence of current runtime behavior.

## B. Gap analysis

| Area | Missing | Preserve |
| --- | --- | --- |
| Backend/read boundary | Complete event export projection, strict source selection, count/size handling | Existing ownership helpers, coherence functions, source snapshots, refund state helper |
| Frontend | Export control, request lifecycle, strict export DTO, safe CSV serialization, local download | Existing queries, filters, routes, layout, manual admission, refund UI |
| Database | One additive read-only RPC and grants | No new source tables, columns, lifecycle triggers, backfill, RLS loosening, or indexes initially |
| Security | Bulk capability entry point, exact export allowlists, formula safety, stale-session download cancellation | Auth UID enforcement; no browser table privileges; no service-role browser client |
| Tests | Export auth/completeness/format/state/download tests | Existing ticketing, organizer, free-source, refund and cancellation suites |

## C. Recommended V1 UX

Paid dashboard action strip: **Export** → **Orders CSV** / **Admissions CSV**. Reuse that small component in the Orders header so the action is discoverable where customers are already viewed. Free dashboard and registration lookup header: **Export registrations CSV**. No export button in scanner/guest check-in views.

Visible supporting copy: “Exports all records for this event. Search and filters do not apply.” Admissions copy: “One row per ticket. Contact details belong to the buyer.” Free copy: “One row per admission. Contact details and registration quantity repeat for group RSVPs.”

Click → “Preparing CSV…” → validate → browser download → “Download started.” Do not claim the browser saved the file. Disable concurrent clicks for the event. Errors remain visible with retry; never download a partial result. Empty data produces a header-only CSV and “No records yet.” No confirmation modal, report screen, progress-history page, or email delivery.

Keep the action for live, ended, cancelled, blocked/removed events when owner access is valid. Do not tie it to public availability, payment onboarding, or check-in eligibility. Hide it on drafts; the RPC can return a valid empty draft export if called by the owner, rather than inventing a special historical access restriction.

On route/event/source change, logout, or session identity-version change: abort, discard pending rows, and prevent a late result from downloading. Use semantic buttons, keyboard-operable disclosure/menu, restored focus, live busy status, and alert errors. Maintain mobile wrapping using current operations styles.

## D. Final proposed CSV schemas

Three fixed schemas. Headers and order are exact below. No optional columns or user-selected fields.

Every schema starts with these six columns, in this order:

| Header | Source / representation |
| --- | --- |
| Event Name | `events.title`; blank if null |
| Event Status | Stored `events.status`, unchanged |
| Event Start UTC | `events.starts_at`, UTC ISO 8601; blank if null |
| Event End UTC | `events.ends_at`, UTC ISO 8601; blank if null |
| Event Timezone | `events.timezone` |
| Exported At UTC | One database statement timestamp for the export, UTC ISO 8601 |

### Orders CSV — one row per paid-event order

Include **all** canonical order statuses, not just successful purchases. This mirrors “All” in Orders and preserves failed/processing/history truth. Subsequent headers:

| Header | Authoritative value |
| --- | --- |
| Order Number | `orders.order_number` |
| Buyer Name | `orders.buyer_name` |
| Buyer Email | `orders.buyer_email` |
| Order Created At UTC | `orders.created_at` |
| Paid At UTC | `orders.paid_at`; blank for no recorded payment |
| Order Status | Canonical `orders.status` |
| Refund Workflow State | Existing `private.order_refund_state(order)` result |
| Quantity | `orders.quantity` |
| Ticket Items | Human-readable purchased-item summary, in existing `order_items.id` order; see format below |
| Currency | Stored currency, currently `usd` |
| Subtotal | Original `subtotal_minor`, decimal USD, two digits |
| Tax | Original `tax_amount_minor`, decimal USD, two digits |
| Order Total | Original `total_minor`, decimal USD, two digits; **not labelled Total Paid** |

Ticket Items contains one line per purchased tier: `<tier name> × <quantity> @ <unit amount> <currency> (subtotal <item subtotal> <currency>)`. Preserve the exact tier name within that text; apply CSV protection to the complete cell. This is a display summary, not a second CSV or a machine-parsed nested contract. The transport retains structured item fields for validation. Two tiers share one order row; do not duplicate order totals per tier. Separate raw Unit Price/Ticket Tier columns are intentionally omitted because they are ambiguous at order grain. No payout/net revenue/refund allocation is calculated.

### Admissions CSV — one row per issued paid ticket

Include every existing paid ticket, including used/refunded/cancelled. No row for an unissued ticket. Subsequent headers:

| Header | Authoritative value |
| --- | --- |
| Order Number | Parent `orders.order_number` |
| Ticket Position | Existing 1-based position across the complete immutable order ticket set |
| Tickets In Order | Parent `orders.quantity` |
| Buyer Name | Parent buyer, repeated; never represented as attendee name |
| Buyer Email | Parent buyer, repeated |
| Ticket Tier | Frozen `tickets.admission_label` |
| Order Status | Parent canonical order status |
| Ticket Status | Canonical ticket status |
| Issued At UTC | `tickets.issued_at` |
| Check-In Status | `checked_in` iff `used_at` is present; otherwise `not_checked_in` |
| Check-In Time UTC | `tickets.used_at`; blank otherwise |

`Order Number` + `Ticket Position` is the safe stable reference; no raw ticket UUID, selector, credential, or collection URL. Check-In Status is only a rendering of the stored used fact, not a new ticket-validity state. Refunded/cancelled unused tickets remain not checked in, with their explicit terminal Ticket Status visible. Fail a contradictory status/timestamp projection.

### Registrations CSV — one row per free admission

This combines registration context and each actual free ticket in one useful file, avoiding an additional export menu. Include confirmed/cancelled registrations and every issued ticket. Never include rejected request receipts. Subsequent headers:

| Header | Authoritative value |
| --- | --- |
| Registration Reference | `RSVP-` followed by full `free_registrations.id`; safe grouping identifier |
| Registrant Name | `free_registrations.name`, repeated for a group |
| Registrant Email | `free_registrations.email`, repeated for a group |
| Registered At UTC | `free_registrations.created_at` |
| Registration Status | `confirmed` or `cancelled`, unchanged |
| Registration Quantity | Source quantity, repeated; do not sum this column across admission rows |
| Admission Position | `tickets.unit_sequence`, 1–quantity |
| Admission Label | Frozen `tickets.admission_label` |
| Admission Status | `valid`, `used`, or `cancelled`, unchanged |
| Issued At UTC | `tickets.issued_at` |
| Check-In Status | Same timestamp-based rendering as paid admissions |
| Check-In Time UTC | `tickets.used_at`, blank otherwise |

Registration Reference + Admission Position uniquely identifies a row. Count rows for issued admissions; count distinct Registration Reference for registrations. Example: a three-person RSVP yields three rows with positions 1, 2, 3; only position 2 has a used timestamp if only that admission checked in. No fake order number, paid amount, refund field, or attendee identity.

### Formatting and filenames

Use UTC ISO 8601 timestamps with `Z`; dates are not localized spreadsheet strings. Use safe integer minor units in the DTO, validated before integer-to-decimal formatting; no currency symbols or thousands separators in money cells. Null is an empty cell, never `undefined`, `null`, or an invented date. Preserve Unicode and embedded text line breaks.

Filename: `<event-slug>-<event-local-start-date>-<kind>.csv`, where kind is `orders`, `admissions`, or `registrations`. Date uses the stored event timezone, not browser timezone. For the slug: NFKC-normalize title, lowercase, replace runs outside Unicode letters/numbers with `-`, trim hyphens, cap at 80 Unicode code points, trim again; fall back to `event`. Missing/unusable start/timezone yields `undated`. Do not put email, customer names, UUIDs, slashes, controls, or arbitrary extensions in filenames. Example: `rnb-fridays-2026-10-09-orders.csv`. Duplicate downloads use the browser's normal collision handling.

## E. Architecture, completeness, and migration decision

**Organizer action → authenticated Supabase RPC → existing owner/coherence authorization → bounded explicit export projection → strict frontend validation → CSV Blob → browser download.**

Proposed contract: `get_organizer_event_export(p_event_id uuid, p_kind text) returns jsonb`. Kinds: `orders`, `admissions`, `registrations`. Returns exactly `{schemaVersion:1, kind, event:{id,title,status,startsAt,endsAt,timezone}, exportedAt, rowCount, rows}`. Each kind has a discriminated strict row schema corresponding to D; money remains minor-unit numbers and items remain structured until serialization. `event.id` is transport context validation, not an exported column. No wildcard record serialization.

The RPC must be `STABLE SECURITY DEFINER`, empty search path, fully qualified objects, execute granted only to `authenticated`; explicitly revoke PUBLIC/anon/service-role execution. Derive actor from `auth.uid()`; accept no caller organizer/user ID. Authorize before evaluating counts or touching customer data, dispatching to the existing paid/free owner helpers. Wrong kind/source fails safely. Reuse `private.organizer_order_coherent`, `private.free_registration_is_coherent`, and the current refund-state helper. Existing detail projections are field/ordering authorities; do not rebuild payment, ticket, or refund rules.

Use one read statement/RPC snapshot for membership and underlying record data. Deterministic ordering: paid orders `(created_at DESC,id DESC)`; paid admissions parent order order followed by `(order_item_id,unit_sequence)`; free admissions `(registration.created_at DESC,registration.id DESC,unit_sequence ASC)`. No new order or registration appearing midway can shift page membership. States reflect the database observation during this call; the time-dependent refund helper retains its existing semantics. Separate downloads are separate observations, not a cross-file transaction.

Construct arrays set-wise; do not copy the list RPC's repeated JSON array concatenation for thousands of rows. Reuse coherence helpers on source records once per source rather than once per repeated ticket where practical. Inspect query plans and measured behavior before deciding an index is needed.

`supabase/config.toml` has `api.max_rows = 1000`. This RPC returns one scalar JSON value with an explicit bounded array, not a set of rows that can be clipped by that setting. Verify this through PostgREST with a >1,000-row fixture. Count must equal validated rows; never infer completeness from a successful HTTP status.

Proposed V1 bounds: **10,000 source records examined and 10,000 output rows per download**, plus **8 MiB UTF-8 JSON projection** and **8 MiB final CSV**. Count event sources and output rows before constructing the full projection, reject overflow, then enforce actual serialized byte sizes. A 2,000-order event fits Orders unless its payload exceeds the byte budget; 2,000 ten-ticket orders exceed the admissions row budget and must visibly fail. These are provisional engineering limits requiring the performance proof below, not measured production capacity claims.

Error copy: “This export exceeds the current download limit. No file was downloaded.” Timeouts: “The complete export could not be prepared. Try again.” Do not silently lower the limit, return the first 10,000 records, or tell organizers to use filters that V1 does not support. Browser request deadline: 30 seconds; abort and discard on expiry. Target <=10 seconds for 2,000 orders and for 10,000 admission rows on the chosen test environment, report the hardware/environment and actual timings. A failing benchmark is a review blocker, not permission to add jobs or lift platform limits.

### Why not zero migrations?

Paid Orders alone could page `list_organizer_event_orders_filtered('', 'all')`; detailed refunds/tickets would require further per-order reads, with potentially different observation times. Paid admissions could then be flattened from those details. But **free source enumeration has no authorized all-records contract**: both guest searches suppress blank search and free email search is exact. Searching arbitrary characters or known names is incomplete. Direct free table access is revoked, including service role.

Changing blank-search behavior would alter the intentional search-first guest boundary. Granting base-table access or bypassing coherence in a privileged Edge reader is a larger security change. Therefore the recommended full V1 uses **one read-contract migration, zero table/schema-model changes**. A new HTTP/Edge endpoint is unnecessary. Existing UI list/search RPCs remain unchanged. A narrower paid-only zero-migration implementation would not satisfy the requested free-export scope.

### Future Staff Access seam

Keep export authorization at this single RPC entry point, separate from scanning/manual admission. Today it delegates to unchanged owner helpers. A future Staff Access design can replace the entry authorization with an event-scoped bulk-export capability for approved roles; it must explicitly retain the event organizer as data scope instead of filtering data by the acting staff member's ID. Owner/Manager export rights and denial for check-in-only staff remain future policy decisions. Do not add roles, membership tables, UI permissions, or manager claims now. Platform moderation staff are not automatically event export staff.

## F. Current open-source findings

Read-only source inspection used pinned GitHub revisions, fetched from the repositories' default branches during this inspection. No upstream code was copied into Wheretoo.

### Revel

Repository: `letsrevel/revel-backend`, main revision `083b4610098c7d898b3b3dfc08a2daac1db57584`.

- Its attendee export endpoint requires event `manage_event`, starts a Celery export, and returns a polling resource. Polling is requester-scoped. Useful lesson: bulk PII belongs behind explicit event permission. Ignore the job/resource/storage architecture for this bounded download. [Ticket controller](https://github.com/letsrevel/revel-backend/blob/083b4610098c7d898b3b3dfc08a2daac1db57584/src/events/controllers/event_admin/tickets.py), [export controller](https://github.com/letsrevel/revel-backend/blob/083b4610098c7d898b3b3dfc08a2daac1db57584/src/events/controllers/exports.py).
- The implementation exports XLSX, loading ticket and RSVP collections into memory. It selects active/checked-in tickets and yes RSVPs, combines them in an attendees sheet, and includes a summary. Wheretoo should reuse the idea of explicit source projections, but **not** those exclusions: refunded/cancelled history is required here. Its guest/user/pronoun/seat/attribution fields are not Wheretoo fields. Async execution is not evidence of memory-bounded streaming. [Attendee exporter](https://github.com/letsrevel/revel-backend/blob/083b4610098c7d898b3b3dfc08a2daac1db57584/src/events/service/export/attendee_export.py).
- Formula protection prefixes hazardous initial characters; endpoint tests cover ownership, staff permission, unauthenticated access, and private polling. Adopt test categories, not implementation code. A standalone order CSV exporter was not identified in the inspected export modules; do not claim Revel provides a matching Wheretoo order contract. [Formatting](https://github.com/letsrevel/revel-backend/blob/083b4610098c7d898b3b3dfc08a2daac1db57584/src/events/service/export/formatting.py), [endpoint tests](https://github.com/letsrevel/revel-backend/blob/083b4610098c7d898b3b3dfc08a2daac1db57584/src/events/tests/test_controllers/test_export_endpoints.py).
- Repository license is MIT, with its copyright/permission-notice condition. Actual reuse proposed: **none**. Porting Django/openpyxl/Celery modules is less simple than the small native SQL/TypeScript layer. [License](https://github.com/letsrevel/revel-backend/blob/083b4610098c7d898b3b3dfc08a2daac1db57584/LICENSE).

### Hi.Events

Repository: `HiEventsDev/Hi.Events`, develop revision `7dec84caeaa39012871544fda0af7b2e425adaea`.

- Distinct order and attendee pages each expose Export with pending/error feedback. The inspected handlers request XLSX and pass the selected occurrence, not the page's general search/status filters. Useful lesson: explicit row grain and documented filter behavior. Wheretoo does not need occurrence selection. [Orders UI](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/frontend/src/components/routes/event/orders.tsx), [attendees UI](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/frontend/src/components/routes/event/attendees.tsx).
- Export actions authorize the event through the common account/user authorization boundary. Orders request page 1 with 10,000 records; the attendee repository applies `limit(10000)`. These paths do not demonstrate fail-on-overflow handling. **Do not copy a hard limit that silently becomes a partial export.** [Orders action](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/backend/app/Http/Actions/Orders/ExportOrdersAction.php), [attendees action](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/backend/app/Http/Actions/Attendees/ExportAttendeesAction.php), [repository](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/backend/app/Repository/Eloquent/AttendeeRepository.php), [authorization entry](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/backend/app/Http/Actions/BaseAction.php).
- Order mapping distinguishes order/payment/refund states and original/refunded amounts; attendees include individual identity/check-ins and custom answers. Learn to preserve distinct states. Ignore notes, billing addresses, marketing consent, custom questions, product/event IDs, and other fields Wheretoo does not need or collect. Their individual attendee identity model must not be imported by inference. [Orders mapping](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/backend/app/Exports/OrdersExport.php), [attendees mapping](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/backend/app/Exports/AttendeesExport.php).
- Its separate formula escaper and tests are useful research prompts. Do not assume that helper proves every XLSX/CSV path is protected; the inspected mapping files do not themselves establish that integration. [Escaper](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/backend/app/Services/Infrastructure/Export/SpreadsheetFormulaEscaper.php).
- The repository declares AGPLv3 plus attribution terms and mentions commercial licensing. **Reference only; no copied or translated code.** No licensing exception is assumed. [License declaration](https://github.com/HiEventsDev/Hi.Events/blob/7dec84caeaa39012871544fda0af7b2e425adaea/LICENCE).

## G. Security and CSV safety

### Authorization and leakage

Authorize every request server-side through authenticated RPC execution and `auth.uid()` ownership helpers. Client route guards/button visibility are UX only. Foreign/missing event responses disclose no customer identity or row counts. Forged organizer parameters are absent from the contract. Cursors from existing reads are not accepted by the export RPC.

Keep credentials and hashes inside their existing systems. Export excludes QR/admission credentials, collection/recovery/access bearers and URLs, confirmation/access/credential hashes, source request IDs, idempotency keys, Stripe IDs/secrets, provider credentials, payment payloads, private refund snapshots, delivery/grant records, moderation notes and unnecessary internal IDs. The sole new identifier exposure is the necessary non-secret registration reference; it already corresponds to organizer detail routing and does not grant access.

Build an explicit SQL projection and explicit TypeScript mapping; never strip a few fields from `SELECT *`. Strictly reject unexpected fields at the transport boundary. Tests must inject sentinel secrets into source fields and prove their absence from RPC output, CSV, logs and errors. Do not log customer rows or persist export data in React Query/localStorage/analytics. Keep in memory for the request, discard after download/error, and revoke object URLs. Verify authenticated RPC responses are not publicly cached in the actual serving path; an existing auth or transport header is not a substitute for checking deployed cache behavior.

### Exact CSV encoding

1. Fixed UTF-8 encoding with a single UTF-8 BOM for spreadsheet interoperability; MIME `text/csv;charset=utf-8`. Fixed comma delimiter and CRLF record separators; no `sep=` directive.
2. Format typed numbers/timestamps first; missing nullable values become empty strings. Validate safe integers and known enum values. Do not infer numeric type from a customer string.
3. For each text cell, keep the original content. Detect a hazardous formula prefix after any leading Unicode whitespace, control (`Cc`), or format (`Cf`) characters: `=`, `+`, `-`, `@`, and their fullwidth equivalents. Also treat a leading tab, CR, or LF as hazardous even without a formula character. For detection only, inspect through that leading run; do not trim or normalize the exported source value.
4. If hazardous, prepend one ASCII apostrophe to the **entire original cell**. Do not delete formula characters, trim the value, turn it into a formula such as `="..."`, or exempt numeric-looking customer input. Apply this to names, emails, titles, labels, references, and composed Ticket Items text. A legitimate leading `+`/`-` is preserved after the apostrophe.
5. Quote **every** cell with ASCII double quotes; double every embedded double quote. Preserve embedded commas, CR/LF and Unicode within quoted fields. End the final record with CRLF.
6. Reject NUL and non-tab/non-CR/non-LF C0/C1 controls with a visible formatting error rather than deleting them. If a cell exceeds 32,767 UTF-16 code units after protective prefixing, reject the whole export; no truncation. Expected source length constraints are far below this except composed cells, which must also be measured.

This intentionally adds a visible apostrophe in some CSV readers to keep hazardous text inert; disclose that behavior in the export help text. Original database values are unchanged. CSV has no universal cell-type metadata, so initial-open/import verification in supported spreadsheet applications is a release requirement; do not promise that editing and resaving a CSV in every application preserves the safeguard. The implementation must fail its security acceptance gate if a tested application executes a crafted cell. The current task does not claim those application tests have run.

## H. Smallest ordered implementation plan — after approval only

| Step | Proposed files/contracts | Verification |
| --- | --- | --- |
| 1. Pin target and export contract | This report; new `src/features/organizer-operations/export.schemas.ts` | Confirm main baseline/migration order; fixed schemas, kinds, bounds, error contract |
| 2. Add read projection | One new timestamped migration under `supabase/migrations`; `get_organizer_event_export`; update `src/lib/supabase/database.types.ts` from an isolated local schema | New `supabase/tests/database/organizer_csv_export.test.sql`: grants, ownership, kind mismatch, coherent data, counts, historical state, limits; no writer changes |
| 3. Add native serializer/download adapter | New `export.csv.ts`, `export.api.ts`, and focused tests alongside organizer operations | Injection/round-trip, exact columns, safe money, references, filename, sizes, no secret fields |
| 4. Add small shared control | New `EventExportControl.tsx`; edit `OrganizerDashboardPage.tsx`, `OrganizerOrdersPage.tsx`, `OrganizerRegistrationLookup.tsx`; minimal `organizer-operations.css` only if existing layout needs it | Busy/error/empty states, filters ignored, one call, identity switch/abort, keyboard and mobile checks |
| 5. Prove complete download and regressions | New `tests/e2e/organizer-csv-export.spec.ts`; reuse existing isolated DB/test harness patterns | Real RPC >1,000-row export; multi-quantity states; spreadsheet open/import safety; benchmark and relevant existing suites |

No production code, migration, or test implementation was added during this inspection. No new Edge function/dependency/configured external service is proposed. Generate types from an isolated migrated test schema during the build; do not blindly run the current linked-production-oriented `db:types` script.

### Required test matrix

- Authorization: owner succeeds; unrelated organizer fails; unauthenticated fails; non-organizer fails; platform moderation identity has no implicit export rights; mismatched paid/free kind fails. No direct base-table grant appears. Test RPC bypass of all UI controls.
- Paid Orders: one/many orders; two tiers; quantity >1; same buyer on different orders; all canonical statuses; original prices after tier edits/archive; nullable paid date; full refund; pending/failed/unknown/review refund workflow; legacy partial state; payment-after-invalidation with no tickets.
- Paid admissions: all ticket states; exact immutable positions; used then refunded order; used then cancelled event; ended event with stored valid tickets; no invented identity or ticket row.
- Free: one/many RSVPs; 1–10 quantity; correct repeated registrant/quantity; positions unique per registration; mix of used/unused; cancelled registration preserves used timestamp; rejected request absent; no paid/provider fields.
- Completeness: 55 single-unit orders produce 55 order rows despite UI page size 25; 55 single-unit registrations produce 55 free rows; mixed groups produce exactly summed registration quantity, not deduplicated browser rows. Prove 2,000 orders and >1,000 admissions over real PostgREST. Exact-cap passes; cap+1, bytes+1, timeout, coherence error, and malformed payload produce **no file**.
- Concurrency: simultaneous creation, check-in, cancellation and refund do not make one response cross database snapshots, duplicate rows, mix parent/ticket lifecycle states, or mutate source data. Separate files can legitimately differ if downloaded at different times.
- CSV: commas, double quotes, CR/LF, Unicode/emoji, blank values, maximum source lengths, composed long items; all formula triggers including whitespace/control/format-prefix variants, email beginning with `+`, numeric-looking strings, quote/delimiter breakout attempts; BOM and CRLF; exact schema header/row width. Parse with an independent CSV parser and compare values plus documented protective prefix.
- Download: actual filename/MIME/bytes, header-only empty export, busy double-click, visible retry, no hidden truncation, route/logout identity race, object URL cleanup, no storage/cache/log PII. Test Orders filters/search have no effect.

Run `pnpm typecheck`, `pnpm build`, `pnpm lint`, targeted new/existing Vitest tests, isolated SQL tests and browser download E2E. Relevant SQL regressions include `organizer_order_reads.test.sql`, `spec04_organizer_reads.test.sql`, `spec05_admission_search.test.sql`, `free_registration_*`, `spec09_refund_operations.test.sql`, `spec10_cancellation_summary.test.sql`, `ticketing_rls.test.sql`, and core ticket lifecycle tests. Reuse existing fixture/setup runners after checking their target safety; do not reset a shared or hosted database. No new payment requests are required for a read-only export; preserve transaction behavior through existing regression fixtures.

Manually open adversarial fixture CSVs in current Excel, Google Sheets import, and LibreOffice Calc, recording versions/import path and whether any formula cell is executable. Use synthetic data only. No connector setup or sending files to a real customer is needed.

## I. Strict acceptance criteria

Implementation passes only when all are true:

1. The three menu choices use the exact schemas and row grains above, with only real authoritative records.
2. All authorized event records at the read snapshot are present within the declared limits; no UI/query filter or 1,000-row API clipping changes the dataset.
3. Every overflow, integrity failure, permission failure, transport failure, or stale-identity response prevents any download and yields appropriate feedback.
4. Unauthenticated/unrelated actors receive no event customer data, counts, credentials, or cross-event rows, including by direct RPC invocation.
5. Orders use immutable item snapshots; created and paid timestamps remain distinct; totals are never mislabelled as received funds.
6. Current canonical refund workflow is preserved, and ticket status/used history remain independent of order refund/cancellation status.
7. Group purchases/RSVPs never acquire fabricated per-attendee names/emails; free records have no fake financial values.
8. CSV round-trips through an independent parser with deterministic columns, Unicode and line breaks intact except the documented formula-protection prefix; supported spreadsheet checks show no formula execution.
9. RPC response and CSV contain only allowlisted fields; secret-sentinel tests pass; no retained application cache/log copy is created.
10. Live, ended and cancelled owner history works independently of public eligibility and check-in state. Draft controls are hidden.
11. Limits are tested over real PostgREST, benchmark results meet the agreed target or revised limits are reviewed explicitly; no silent fallback to partial data.
12. Only the additive read contract and export UI/formatting are changed; existing auth, ticket/RSVP/refund/payment writers and schema models remain intact. All relevant verification passes with evidence.

### Assumptions and unresolved validation

- **Resolved:** target current main, expressly confirmed by the user. The attached recovery checkout must not be used as the implementation base.
- **Governing-file discrepancy:** requested spec path absent; attachment treated as the authoritative input. No missing content beyond that attachment is assumed.
- **Proposed, awaiting design review:** three downloads, free per-admission grain, all-event/no-filter behavior, one additive RPC migration, full safe registration reference, and the explicit size/time limits.
- **Not established:** hosted migration parity, deployed cache/header behavior, actual event sizes, SQL query timings/memory at limits, or spreadsheet-version compatibility. These are implementation/release verification gates, not facts inferred from source.
- Source currently constrains paid data to test-mode/USD behavior. Export must preserve that mode and currency truth; it must not enable live sales or mix in unsupported currencies. A future payment-mode change needs its own existing authorization/release process.
- No unique short registration reference exists. The proposed full UUID-derived reference avoids suffix collision and new numbering infrastructure; confirm the product tradeoff during review.
- No separate attendee identity or marketing-consent capture was found in these source models. CSV contact export must not imply either.
- Per-event historical datasets beyond 10,000 output rows/8 MiB cannot be delivered by this proposed bounded V1; visible failure is intentional. Revisit with actual organizer demand rather than silently introducing job infrastructure.
- There is no CSV-specific approved visual reference. Current operations UI is the layout baseline; no redesign is proposed.

### Inspection verification and change report

Performed: complete attachment read; source-of-truth reads and cross-checkout byte comparison; read-only Git status/HEAD/worktree inventory; current-main route/API/schema/migration/test inspection; pinned upstream source/license inspection; report consistency and scope review.

Changed: only this documentation file. Migrations added: **none**. Production code changed: **none**. Commits/pushes/merges/deployments: **none**. Build/lint/test suites and spreadsheet execution tests were **not run**, because this deliverable is inspection/specification only and contains no executable change; they are specified above for the authorized build. No production readiness or test-pass claim is made. No manual setup is required to review this report.

## J. Scope guard

### V1 includes

- One-event authorized complete-or-fail export.
- Paid order rows, paid ticket-admission rows, and free registration/admission rows.
- Existing historical states and buyer/registrant identity only.
- One narrow read RPC migration; native typed CSV formatting and browser download.
- Formula/leakage protection, predictable filenames, empty/error states, measurable bounds and verification.

### Explicitly deferred

- Staff Access implementation, new roles/membership, and new authorization grants beyond the export RPC.
- Cross-event CRM/customer directory, marketing consent workflows, search/filter expansion, custom columns, and financial reporting/reconciliation redesign.
- Scheduled/asynchronous exports, export history, emailed links, stored files, resumable jobs, queues, warehouses, and enterprise-scale infrastructure.
- XLSX/PDF, Sheets integrations, API keys, external ticketing, and upstream code reuse.
- New attendee data collection, ownership transfer, source-model changes, payments/refunds/ticket/check-in redesign, and unrelated UI polish.

**STOP: inspection and proposed specification complete. Implementation requires separate explicit authorization.**
