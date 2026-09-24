# Wheretoo — Duplicate Event V1 inspection and proposed specification

Status: **Approved for Build + Prove on 2026-09-23, then approved for Git closeout under the differential SQL gate. The latest founder overrides supersede historical inspection/implementation stop instructions.**

Founder overrides: schedule timestamps null, no hints; independent flyer via narrow service staging; allow owned draft/published/live/ended/cancelled/under-review, reject blocked/removed server-side. Implementation and migration authorized; no new model tables/columns. The subsequent founder decision authorizes commit, push, PR review and merge after feature checks and independent review, treating the 33 reproduced baseline SQL failures as existing test debt. Production deployment and hosted migrations remain prohibited. See `Docs/testing/duplicate-event-v1.md`.

Inspected 2026-09-23. The two supplied requests are preserved verbatim in the appendices and govern this report. Recommendations below are proposals, not silent changes to approved intent.

## Inspection provenance

- Remote: `https://github.com/ElijahJBurgess/WhereTo.git`, branch `main`.
- Inspected HEAD: **`52558793abe7927102b977aaeab170983356fb99`**, `Merge pull request #1 from ElijahJBurgess/codex/csv-export-v1`.
- Canonical local main checkout found at `/Users/exoh/Desktop/WhereTo-main-final`, branch `main`, HEAD `34a1f195c0b378e90da98d8e0f620412f6b8c119`. Fetch showed it behind by two commits. Its untracked `Docs/specs/` files overlap files arriving from remote main; they were not overwritten.
- Starting shared workspace `/Users/exoh/Desktop/WhereTo -  Repository` is on `codex/recovery-main-before-final-20260915` at `1d87c88`, with substantial unrelated edits/untracked files. It was not used as inspection truth and was not reset, cleaned, switched, or edited.
- Inspection checkout: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/duplicate-event-v1-inspect`, detached at the verified remote main commit. Initially clean. `.worktrees` is gitignored. A later `git ls-remote origin refs/heads/main` independently returned the same inspected SHA.
- Read governing `AGENTS.md`, the three `Docs/WHERETO_V1_*` product/flow/architecture documents, current implementation and migrations, relevant verification documents and the My Events preview snapshot. Existing preview snapshots/documented past test results are context, not new runtime proof.
- Only this specification is added. No product code, migration, dependency, configuration, commit, push, merge, or deployment is part of this task.
- Documentation verification passed: all 13 A–M sections present; both supplied requests preserved verbatim; 84 existing path references resolve; proposed new paths distinguished; no TODO/TBD/FIXME placeholders; whitespace/diff check clean; only this new file appears in inspection-checkout status. Canonical local main remains at its original HEAD with its untracked spec directory intact. Runtime/build/lint/SQL/browser tests were not run because this task changes no implementation and authorizes inspection/specification only.

## A. Current architecture findings

Paths below are repository-relative to the inspected checkout. SQL contracts are migration-defined; later wrappers override earlier definitions.

| Area | Current paths / contracts | Finding |
| --- | --- | --- |
| Event model | `supabase/migrations/20260824010000_create_organizers_and_events.sql`; `src/lib/supabase/database.types.ts` → `events`; `src/features/events/event.types.ts` | One organizer UUID equals its auth user UUID. Events have nullable draft content/schedule, PostGIS geography derived from coordinate columns, and statuses `draft`, `published`, `cancelled`. Ended/live are derived presentations, not additional persisted statuses. |
| Draft writes | `src/features/events/event.api.ts`: `draftPayload`, `saveEventDraft`, `eventRowToFormValues` | New drafts use a column-limited insert. The ordinary draft payload includes content, schedule, normalized location, admission and capacity, not status/moderation/artwork/animation. |
| Actual editor | `src/features/events/EventEditorPage.tsx`; `src/features/event-changes/eventChanges.api.ts` | Existing drafts load `get_owned_event_change_context`; edits use `save_owned_event_revision_if_current`, `save_owned_event_requirements_if_current`, `accept_current_event_policies_if_current`. Do not mistake older simple API wrappers for the complete current workflow. |
| Creation routing | `src/app/router/router.tsx`; `src/features/events/eventWizard.ts` | `/organizer/events/:eventId/edit?resume=1` enters the creation workflow. Resume chooses basics if incomplete, otherwise date/location when schedule is blank. Preview is `/organizer/events/:eventId/preview`; paid configuration is `/organizer/events/:eventId/tickets`. |
| Schedule/title validation | `event.schemas.ts`, `event.time.ts`, `EventDetailsStep.tsx`, `EventScheduleLocationStep.tsx` under `src/features/events/` | Complete `datetime-local` strings map to UTC `timestamptz`. UI timezone is fixed to `America/Los_Angeles`. Draft blanks map to null. Title input/schema limit is 120 UTF-16 units; SQL checks trimmed `char_length <= 120` (Unicode character count). |
| Ticket source | `src/features/tickets/ticket.api.ts`; `20260825010000_create_ticketing_payments_schema.sql`; `20260825010100_secure_paid_sales_and_tiers.sql` | `list_owned_ticket_tiers` returns non-archived `public.ticket_tiers` in sort order. Config includes name, description, `unit_amount_minor`, USD currency, `quantity_total`, and slot 1–3. There is no sold/reserved counter to copy on the tier row. Inventory derives from transaction truth. |
| Tier writes/locking | `save_ticket_tiers`, `save_ticket_tiers_without_revision`, intervening wrappers, ending in `20260826011475_restore_ticket_tier_owner_precheck.sql`; `20260825010190_serialize_paid_event_operations.sql` | Ownership check precedes the event advisory lock, ordered tier locks, then event lock. Existing tier writes preserve/freeze source prices under their existing sale rules. Duplication should insert fresh rows from current configuration, never reconstruct orders or reuse IDs. |
| Requirements | `src/features/moderation/EventRequirementsStep.tsx`, `moderation.api.ts`, `moderation.schemas.ts`; `private.event_risk_disclosures` in `20260826010000_create_moderation_foundation.sql` | One optional disclosure row per event, with seven non-null answers when present. Absence is meaningful: do not manufacture a completed all-ages/false disclosure from frontend display defaults. |
| Agreements | `OrganizerAgreementStep.tsx`; `get_owned_event_requirements`, `accept_current_event_policies`; `20260826010200_add_event_policy_acceptance.sql` and `20260915010000_add_event_change_history.sql` | Event-specific acceptance binds organizer/actor, event, content revision/digest and required policy versions. A new event cannot inherit it. Current policy availability still gates acceptance/publication. |
| Moderation/publication | Migrations `20260826010100_migrate_legacy_moderation.sql`, `20260826010300_add_moderation_eligibility_functions.sql`, `20260826010400_route_public_reads_through_eligibility.sql`, `20260826011250_support_active_event_republication.sql`; later change-history publication wrappers | Fresh defaults are `not_evaluated`, revision 1, `never_public`; authorization fields are empty. `publish_event` and `activate_paid_sales` remain authorities. Draft publication requires future start and valid end. `private.event_is_publicly_eligible` controls public reads. |
| New event bookkeeping | `20260915010000_add_event_change_history.sql`: deferred `event_change_events_final` / `event_change_disclosures_final`; moderation initialization trigger | Inserts naturally create a fresh ineligible interval and a new saved-facts snapshot/state. This is the duplicate's own initial bookkeeping, not copied source history. Keep these triggers enabled. |
| Canonical flyer | `private.event_images` in `20260919010100_add_event_images.sql`; `private.event_cover_state` in `20260922010000_add_ai_event_cover_foundation.sql` | Current flyer is position 1. Its image ID references `storage.objects.id`; path is unique. Modern cover operations replace the attachment set with one image. Legacy 2/3 images are not the selected cover. `events.artwork_path` is not current flyer truth. |
| Image client/server | `src/features/event-images/{eventImages.api.ts,eventFlyer.api.ts,coverTransport.ts,EventImageManager.tsx}`; `supabase/functions/event-images/{index.ts,coverMutation.ts,imageBytes.ts}` | Authenticated Edge handler validates bytes, stages an immutable object, calls `server_commit_event_cover`, then best-effort removes retired objects. Removal uses `server_remove_event_cover`; stale revisions cannot restore retired attachments. |
| Image storage | Private `event-images` bucket, 5 MiB JPEG/PNG/WebP; `private.attach_uploaded_event_image`, `private.prevent_event_image_overwrite`, `private.owns_image_event` | Paths are `<event UUID>/<object UUID>.<ext>`. Staging currently requires an existing owned draft/published event. Browser insert/update/delete are not an alternative copy primitive. Service writes still encounter validation triggers. |
| AI selected cover | `src/features/event-images/aiCover.api.ts`; `supabase/functions/event-cover-generation/`; migrations `20260922010000_add_ai_event_cover_foundation.sql`, `20260922020000_add_ai_cover_generation.sql` | Selected candidate bytes are promoted into the same canonical bucket/attachment. Copy that attachment only. Private generation/candidate records and candidate bucket are not duplication sources. Candidate cleanup does not clean arbitrary orphan canonical objects. |
| My Events | `src/features/events/OrganizerEventsPage.tsx`, `OrganizerEventsPage.test.tsx`; `src/features/organizer-operations/organizer-operations.css` | Each row is currently a navigation link, with status/artwork/sales summary. There is no existing duplicate menu. A sibling button is smaller and safer than nesting a button in the link or introducing a full action-menu system. |
| Authentication | `src/features/auth/SessionProvider.tsx`, `identityLifetime.ts`; `event.queries.ts` | Owner keys use auth user ID; identity-lifetime guards already prevent stale async completions affecting another login. Query scoping alone is not authorization. |
| RLS/grants | `20260824010100_secure_organizer_event_publishing.sql`, later moderation public-read migration, ticketing/image grants | Event owner reads are owner-only; public reads use eligibility projections. Draft inserts/updates are column-limited and RLS protected. Tiers/disclosures/private state require privileged narrow functions. New RPCs must independently authorize. |
| Storefront | `20260924010100_add_storefront_event_read.sql`, `20260924010200_add_storefront_editor.sql` | Feature choice lives on `organizers.storefront_featured_event_id`. Public cards require eligibility. Duplication does not touch the organizer row; normal automatic featured fallback can apply only after independent publication. |

No existing complete duplicate-event primitive was found. No existing safe cross-event shared-image lifecycle was found.

## B. Explicit copy / do-not-copy matrix

| Source field/system | Copy? | New value/behavior | Reason |
| --- | --- | --- | --- |
| `events.id` | No | Fresh server-generated UUID | Independent event identity. |
| `organizer_id` | Same owner, verified | Derive from authenticated actor and source ownership | Never browser authority. |
| `title` | Transform | Trimmed source + ` — Copy`, truncating base safely; blank/null → `Untitled event — Copy` | Clearly distinguish draft; meet both client and SQL limits. |
| `description`, `category` | Yes | Preserve current nullable values | Reusable event content; incomplete drafts remain incomplete. |
| `venue_name`, `address_line1`, `address_line2`, `city`, `region`, `postal_code`, `country_code` | Yes | Preserve normalized stored values | Do not synthesize or re-geocode an address. |
| `mapbox_feature_id`, `latitude`, `longitude` | Yes | Preserve current values | Existing verified-location source. |
| `location` geography | Recompute | Existing coordinate trigger | No copied derived geometry. |
| `timezone` | Yes when compatible | `America/Los_Angeles` | Current editor hardcodes this zone; reject incompatible legacy source instead of silently reinterpreting it. |
| `starts_at`, `ends_at` | No (recommended fallback) | Both null | Requires explicit new schedule; no fabricated date. Founder approval required for loss of automatic time retention. |
| `admission_type`, `capacity` | Yes | Preserve paid/free and nullable configured event capacity | No remaining-capacity calculation. |
| `animation_preset` | No in minimal V1 | Existing default `generic` | Not in current organizer draft payload/editor; no new map-preset feature. Call out non-generic legacy source rather than claiming full visual replication. |
| `artwork_path` | No | Null | Modern canonical flyer is the attachment, and legacy artwork path is explicitly outside public-candidate eligibility. |
| `status`, `published_at` | No | `draft`, null | Never automatically publish or reactivate. |
| `created_at`, `updated_at` | No | New-row defaults | Independent lifecycle. |
| `content_revision` | No | Fresh default 1 | No source revision history. Initial inserts should not invoke edit/publication wrappers. |
| `moderation_status`, `moderated_revision`, `moderation_version`, `moderation_updated_at` | No | `not_evaluated`, null, 0, null | No inherited approval, hold, denial, or evaluation. |
| `public_history_status`, `first_publicly_eligible_at`, `public_eligibility_version` | No | `never_public`, null, 0 | Fresh visibility lifecycle. |
| `publicly_authorized_revision`, `publicly_authorized_action_id` | No | Null | Normal new publication authorization required. |
| Paid tiers with `status IN ('draft','active')` | Yes | Current rows only, ordered by `sort_order` | Matches owner tier projection. Sold-out active tiers still qualify. |
| Tier `name`, `description`, `unit_amount_minor`, `currency`, `quantity_total`, `sort_order` | Yes | Exact current configured values; USD remains USD | Copy configured/frozen price and total quantity, not historical sale snapshots or remaining stock. Preserve gaps in sort order. |
| Tier `id`, `event_id`, `status`, `version`, timestamps | No | New UUID, new event, `draft`, 1, new timestamps | New inventory namespace; independently editable prices. |
| Archived tiers; all tiers on a free source | No | No corresponding rows | Not current reusable paid configuration. A paid draft with zero tiers remains an incomplete paid draft. |
| Requirement `minimum_age`, `alcohol_present`, `cannabis_present`, `explicit_adult_content`, `gambling_present`, `weapons_present`, `high_risk_activity` | Yes if row exists | Fresh row under new event; same seven answers | Factual organizer configuration only. Preserve absence if source has no disclosure row. |
| Requirement timestamps | No | Fresh defaults | Not historical evidence of review. |
| `event_policy_acceptances`, legacy policy exemptions | No | No new acceptance/exemption | Organizer reviews and agrees to current policies. |
| Moderation evaluations/actions/reports/review requests, holds, legacy resolution evidence | No | No source records copied | A fresh draft follows current publication/moderation rules. |
| Public eligibility intervals; event-change snapshots/state | No source copying | Existing insert triggers create the new initial ineligible interval/snapshot | Do not disable normal bookkeeping to chase an unrealistic “zero history rows” assertion. No prior public snapshot/notice required. |
| Position-1 `event_images` attachment | Bytes only | New immutable object, new storage/image ID, new event-scoped path, position 1 | Independent deletion/replacement lifecycle. |
| Source cover revision/generation pointer | No | Fresh cover state; 0 without flyer, 1 after first canonical attachment; `latest_generation_id = null` | Duplicate begins its own cover lifecycle. |
| Other attachment positions, retired objects | No | None | Only selected visible flyer is requested. |
| AI generations/candidates/input/prompts/jobs/request IDs/provider references/accounting | No | None | Selected image pixels are sufficient, including pixels that contain text; no AI call. New technical copy metadata is not copied AI metadata. |
| Orders/order items, buyers/customers, checkout sessions, payments/reservations | Never | Zero linked rows | No transaction graph copying. |
| Free registrations/requests, admissions/tickets, QR hashes/tokens, check-ins | Never | Zero linked rows/credentials | No attendance inherited. |
| Refunds/disputes, revenue/sales/analytics/attribution history | Never | Zero linked history; metrics derive independently | Source order and inventory truth stays unchanged. |
| Emails/delivery/outbox, recovery/access grants, customer communications | Never | None | No messages or bearer credentials generated. |
| Cancellation/history, change notices, CSV/export state | Never | None | No operational consequences of duplication. CSV remains a read of each event's own data. |
| Storefront featured choice, profile/Stripe configuration | No | Organizer profile stays untouched | Same organizer relationship does not clone organizer records or mutate featuring/payment setup. |
| Waitlists, staff assignments, saved templates/series | Never | None | No new subsystem or future schema implied. |

**Title algorithm:** suffix is seven UTF-16 units (` — Copy`), leaving 113 for the base. Normalize outer whitespace, use the fallback for an empty result, truncate the base on Unicode scalar boundaries to at most 113 UTF-16 units, trim its trailing whitespace, append suffix. Do this authoritatively on the server. PostgreSQL `left(title,113)` alone is insufficient for emoji-heavy titles because the client counts UTF-16 units. Preserve an existing `— Copy` in the base; repeated copies can read `Name — Copy — Copy`, within the same cap. No sequence allocation or uniqueness requirement. Test exact 120-unit boundaries, supplementary characters, combining text, and null/whitespace titles.

## C. Schedule decision

The current persistent model cannot represent “19:00 retained, date absent.” `starts_at` and `ends_at` each represent a complete instant; both are nullable. `EventFormValues` and the two `datetime-local` controls also require complete values. `event.time.ts` converts Los Angeles civil time, rejects DST gaps and picks the earlier repeated fall-back instant.

Options, in the requested preference order:

1. Existing model/UI: cannot retain time independently. Leaving a source timestamp set retains its date and is unacceptable, including for future source events.
2. Duplication-specific handoff: navigation state or session storage could carry hour/minute hints, but is not a reliable saved draft across devices, cleared storage, or direct reopening. A durable handoff would require persisted hints/provenance and split-input editor behavior, plus overnight/multiday decisions. No such primitive exists. Do not hide schedule hints in image metadata, titles or unrelated JSON.
3. **Recommend the explicitly permitted smallest fallback:** persist both schedule columns as null; use the existing editor to enter both date and time. Explain at success: “Draft created. Choose a new date and time before publishing.” This remains safe after refresh, logout/login and direct RPC publication attempts.

This does **not** satisfy automatic time-of-day reuse; founder approval of the documented fallback is required. No recurring subsystem or schedule columns are recommended. If automatic time retention is mandatory, return for a narrowly revised schedule design before Build + Prove.

“New date required” here means an explicit organizer choice with the current future-start/end checks. It does not introduce a prohibition on consciously choosing the same future calendar day as the source. Such a rule would require separate product approval and source comparison.

## D. Flyer/storage decision

Copy the bytes of `private.event_images WHERE event_id = source AND position = 1` into a **new** `event-images` object. Read source path server-side from the attachment, never from the browser or an arbitrary URL. Validate the actual JPEG/PNG/WebP bytes with existing `validImageBytes`, size 1–5 MiB, MIME/extension, and calculate a new byte digest. Upload with `upsert:false`, fresh UUID and `<newEventId>/<newObjectId>.<ext>`. Write only fresh operational metadata; do not duplicate AI `candidate_id` or generation information.

Sharing even an immutable source object is unsafe: each event's cover replacement removes retired objects, the attachment ID belongs to one storage object, and read policies derive ownership from the event prefix. Independent bytes avoid any reference-counting/image-system redesign.

**Critical current constraint:** ordinary staging invokes `private.lock_event_cover` and requires the target event to exist. “Upload first, then insert draft” does not work unchanged. “Insert draft, upload later, delete on failure” is also not a simple rollback: insert triggers create immutable, restrict-referenced history. Do not propose compensating deletion of normal event history.

Recommended narrow extension: a service-only, duplication-specific staging branch in `private.attach_uploaded_event_image` permits a validated object under a fresh, not-yet-existing destination UUID. It must validate service-role request context (not definer `current_user`), server-authenticated owner metadata, an owned source, explicit staging purpose, destination path, expected source fingerprint and current image identity. It creates **no** event, attachment, cover state, or AI record. Ordinary manual/AI staging continues through the existing branch unchanged. Keep real-file checks and the Storage rollback-only permission-probe behavior intact. No browser Storage insert policy is added.

The final duplication transaction validates that staged object, creates the new event/configuration and uses the existing canonical cover commit helper at expected revision 0, without a generation ID. The cover helper and transaction must prevent pre-create objects from being used by ordinary cover commits or attached to any event other than their intended freshly inserted duplicate. Lock the staging object against concurrent removal while committing.

If there is no selected attachment, create a coverless draft. If an attachment exists but bytes are missing/unreadable, fail explicitly; do not report a complete duplicate without its selected flyer. If only unsupported legacy `artwork_path` exists, reject as unsupported source artwork rather than pretend to have copied it. No generation request is issued.

Storage and PostgreSQL are not one transaction. Before SQL commit, failures can leave only an **unattached private object**, not a partially created event. Known definitive rollback permits best-effort deletion of that attempt's new path. Ambiguous commit responses must never trigger blind object deletion. A committed image must not be removed by failure compensation.

Use an explicit staging expiry: finalization accepts objects at most 15 minutes old; no background replay after expiry. Failed/abandoned objects can be inspected and removed through Storage API after 24 hours, only when unattached and outside the finalization window. Do not delete `storage.objects` rows with SQL as a substitute for deleting bytes. Document this in the local/rollout runbook; no new cleanup scheduler or job table in V1. Existing AI candidate cleanup is insufficient. Orphan storage retention is a known operational limitation requiring acceptance, not a claim of perfect distributed rollback.

## E. Recommended architecture and data flow

**Small combination: one browser POST → one authenticated Edge orchestrator → one final SQL mutation transaction**, with one preliminary source read and optional private Storage upload. SQL owns configuration copying; Edge owns bytes. There is no separate application API layer to add.

Proposed external contract:

- `POST /functions/v1/duplicate-event`, exact body `{ sourceEventId: UUID }`, bearer auth and existing app-origin/no-store conventions.
- Success `201 { eventId: UUID }`, emitted only after commit. No source transaction data, paths, tokens, or AI inputs in the response.
- Named failures distinguish missing/foreign source (same response), source changed, unsupported legacy configuration, flyer unavailable, known operation failure, and outcome unknown. Do not classify every HTTP/network failure as a safe retry.

Proposed SQL contracts (new, not implemented):

1. `public.get_owned_event_duplicate_context(p_source_event_id uuid) returns jsonb`: authenticated owner-only, explicit minimal projection of reusable source configuration/current image identity and a deterministic configuration fingerprint. No history reads or policy-acceptance side effects. Use a private explicit-allowlist builder shared with finalization.
2. `public.duplicate_owned_event(p_source_event_id uuid, p_new_event_id uuid, p_expected_fingerprint text, p_staged_path text default null) returns uuid`: authenticated owner-only `SECURITY DEFINER`, fixed empty search path, fully qualified names, grants only to authenticated. Obtain actor via `auth.uid()`; no organizer argument. New ID/path/fingerprint are correlation and consistency inputs, never authorization.

Edge validates token using the existing `auth.getUser(token)` pattern, creates a separate request-scoped user client carrying that bearer for both RPCs, and uses the service client only for private byte transfer. Never mutate the singleton service client's auth header. Edge generates the new event and object UUIDs. The database rejects an existing destination ID, including owned IDs; it must never “upsert” an event or recognize an arbitrary existing ID as a successful duplicate receipt.

Flow:

1. Validate method, origin, bounded strict body and session; obtain source context under owner authorization.
2. Capture a deterministic fingerprint covering the explicit event allowlist, source status/relevant revision state, source schedule, seven answers or absence, ordered non-archived tier configuration and IDs, and selected image ID/path plus cover revision. `updated_at`, `content_revision`, moderation digest and existing event-change token individually are insufficient: they omit parts of ticket money, capacity or canonical image truth.
3. If a flyer exists, read/validate its bytes and stage a fresh independent object. Staging metadata is new operational correlation, not a domain link or copied historical metadata. No database locks span network I/O.
4. Final RPC first checks ownership, then uses existing lock ordering: source event ticketing advisory lock, tiers ordered by UUID, event row, disclosures, then cover state/image/object locks as needed. Prefer reuse of `private.lock_event_change_rows` after the explicit ownership precheck. It must not invoke historical capture just to read the source. Coordinate destination finalization with a destination advisory lock; source/destination lock ordering and forbidden target-equals-source case need concurrency tests.
5. Reread and compare the complete fingerprint while locked. Configuration changes (including tier price/capacity and cover replacement/removal) fail with `DUPLICATE_SOURCE_CHANGED`, producing no draft. Transactions such as ticket sales need not cause rejection when reusable config is unchanged. Source cancel/moderation changes during the attempt are detected; a deliberate retry can use the new source state.
6. Validate expected flyer presence/absence, staged path/metadata/digest/size/age and owner. With a flyer, reject missing/foreign/stale stage; without one reject an unexpected path. A trusted service is responsible for validating bytes; SQL validates immutable object metadata and binding.
7. Insert the explicit event field allowlist with new identity, null schedule and fresh lifecycle defaults. Insert paid non-archived tier configuration with fresh default UUIDs and `draft` state; insert the seven disclosure answers only if present. Let constraints fail atomically. Attach the copied flyer using the canonical commit helper. Never call policy acceptance, publishing, paid activation, checkout or fulfillment.
8. Existing new-event triggers establish initial private state. Commit all persistent configuration together and return the new event ID. No tier/requirements/image-attachment partial success.
9. Browser verifies the response shape and identity lifetime, invalidates the owner's list, and navigates to the existing creation editor. A list-refresh error after confirmed creation must not invite another duplicate request.

Rejected alternatives:

- SQL-only RPC: good atomic config copy but cannot independently copy Storage bytes through the established API.
- Browser/Edge “create event then add parts”: leaves discoverable owner drafts missing parts; compensating deletion collides with intentional immutable history. Adding a pending-duplicate lifecycle/job table is larger than the proposed staging exception.
- Shared source image reference: incompatible with current independent deletion and path authorization.

**Failure contract:** missing/foreign source creates nothing; configuration/tier/disclosure/attachment SQL errors roll back all event configuration; byte download/upload failure creates no draft; source conflict fails without automatic retry. If the final RPC or client response is lost, say “The result could not be confirmed. Check My Events for a new draft before duplicating again.” Disable blind retry, offer a read-only list refresh. A separately initiated action can create another draft; V1 does not promise cross-tab or indefinite exactly-once deduplication. Existing AI request receipts are generation-specific and must not be repurposed as duplicate history.

## F. Migration/data-model decision

**Migration required; no new source-model tables or columns recommended.** Existing nullable schedule/configuration tables suffice.

One proposed forward migration: `supabase/migrations/20260924010500_add_duplicate_event_v1.sql` (verify next free ordering at build time; inspected main already contains migrations through `20260924010400`). It introduces the two public contracts above, narrowly scoped private allowlist/fingerprint/title helpers, and the service-only pre-create staging validation branch. A small binding check in the canonical cover commit helper may be needed to prevent misuse of duplication-stage objects. It must preserve current manual/AI semantics and grants.

No source-event foreign key, series ID, template ID, duplicate job table, schedule hints, request receipt table or “pending” event status. New staging `user_metadata` keys are transient operational data on a new object, not copied source provenance or a source-model extension. Ordinary event/tier/disclosure/image/cover-state rows are fresh uses of existing tables. No RLS relaxation, trigger disabling, storage sharing, or transaction-table changes.

Zero-table/column feasibility is a static design conclusion, **not yet proven against live Storage**. Failure to prove the narrow staging boundary must return to design review; it must not silently turn into a hidden partial-draft workflow.

## G. Minimal UX

1. My Events has a secondary **Duplicate event** button beside each row's existing link. Accessible name includes the title. Button is outside the anchor. No confirmation modal: creation is a draft-only action with no attendee side effects.
2. Set a synchronous in-flight guard before awaiting anything; use mutation `retry:false` and disable all duplicate actions while this page has one active request. Label the chosen action “Duplicating…” and announce status accessibly. Do not rely solely on a delayed React pending render to stop double clicks.
3. Confirmed success opens `/organizer/events/<new-id>/edit?resume=1`. Existing resume behavior handles incomplete draft basics and otherwise focuses date/location. Copied title is visible; schedule is blank. A small success notice explains required new date/time. No duplicate-specific editor or new route.
4. Organizer may edit all copied config, review requirements, newly accept policies, preview and publish normally. Paid tiers and Stripe readiness use existing gates.
5. Known pre-commit failures show a safe explicit retry. Source-change errors require refresh/review. Uncertain outcomes show “Check My Events,” not a generic automatic retry. If signed out or identity changed, discard stale navigation/cache/UI results. Completion may still have created the old owner's private draft; logout is not server rollback.
6. Cover copying happens even for eligible cancelled/blocked owned sources whose current My Events image display may be absent. Do not broaden existing image read/mutation UI just for duplication.

## H. Security/ownership and source eligibility

Both RPCs require non-null `auth.uid()` and a source row with `organizer_id = auth.uid()` before touching source-dependent locks/configuration. Recheck after locking. A guessed UUID belonging to another organizer and a missing UUID produce the same public error. The browser supplies no actor, owner, copied fields, tier IDs, object source URL or permission claims. Edge validates auth; SQL remains authoritative even when called directly.

Staging is service-only and independently validates the authenticated owner's source binding and intended unused destination. Ordinary authenticated users cannot manufacture staging metadata, upload arbitrary objects, invoke service cover functions or bypass RLS. Finalization verifies all bindings again. No privileged keys, bearer credentials or source private history enter logs/responses/caches.

| Source | Proposed eligibility |
| --- | --- |
| Owned draft, including incomplete | Yes; preserve missing fields and absent disclosures; null schedule. |
| Published/upcoming/live | Yes; no source publication state inherited. |
| Ended | Yes; derived time state does not limit copying. |
| Cancelled | Yes; no cancellation state copied. Existing image-management helpers exclude cancelled events, so duplication uses its own owner-only source read, not a blanket expansion of those helpers. |
| Under review / blocked / removed | Recommend yes, as requested ownership-first principle; fresh draft receives no prior approval and current moderation must run. This is not a reinstatement or bypass of the source decision. Founder confirms this policy before build. |
| Missing / another organizer / anonymous | No. |
| Unsupported legacy timezone/artwork or corrupt current selected image | Explicit incompatibility/failure; do not silently lose selected content or change timezone. |

No paid Connect readiness requirement just to duplicate a draft. The same organizer's live account readiness is evaluated by normal publication, not copied. Drafts remain excluded from discovery, public details, storefront, paid checkout and RSVP. Keeping source/configuration independent also means future cancellation/refund/check-in operations cannot affect the duplicate.

## I. Exact test and acceptance plan

**No implementation/runtime tests were run for this inspection-only change.** The following is required future proof, not a pass report.

### New SQL tests and concurrency proof

Add `supabase/tests/database/duplicate_event.test.sql` and `duplicate_event_concurrency.test.sh` against the complete current migration chain in an isolated local database.

- Owner A succeeds; owner B, anonymous, missing source, guessed UUID, injected organizer/extra body fields and direct RPC attempts cannot bypass authorization. Check function grants and unchanged base-table/Storage policies.
- Assert new UUID, same verified owner, every allowed field, SQL/client-compatible title truncation including emoji, recomputed geography, null schedule, draft/not-evaluated/never-public defaults and no public authorization. Source row/config/history hashes remain unchanged by duplication itself.
- Free sources with/null capacity and absent/present disclosure row; zero registrations, requests and admissions. Paid sources with zero (incomplete draft), one, two and three current tiers; all-archived source; sold-out active tier; mixed archived/current slots. Assert new disjoint tier IDs, version 1, draft, exact price/currency/total/sort order, no historical snapshot price.
- Populate the source with orders/items/reservations/tickets/refunds/check-ins/emails/access grants/change notices/moderation/AI/CSV-related activity. Assert no corresponding source-derived rows on destination. Permit only its normal initial eligibility/history and cover bookkeeping. Assert zero independent metrics, no notice required and no feature selection changed.
- Copied disclosures cannot satisfy agreement acceptance; copied prohibited/high-risk answers still pass through current moderation. Publication without schedule and without current agreement fails via authoritative RPCs. Later legitimate publication and paid/free admission operate independently.
- Test draft, upcoming, live, ended, cancelled, under-review, blocked and removed sources. Test policy environment unconfigured: duplication/draft editing works, acceptance/publication remains gated.
- Force failure at event insertion, tier insertion, disclosures and image attachment; assert rollback of all event-related inserts. Confirm no source mutation.
- Race source edits, tier price-only/quantity-only/archive changes, requirements saves, flyer replacement/removal/AI selection, cancellation and publication against duplication. Confirm complete expected config or conflict, never mixed snapshots. Include ordinary checkout/tier-lock regression and no lock inversion.
- Stage path/owner/source/target/fingerprint mismatch, preexisting target ID, target equal source, duplicate target finalization, expired stage, unexpected/missing flyer, removal race and unrelated object attachment fail closed. Direct ordinary-cover API cannot adopt an unbound duplication-stage object.

### Real Auth / PostgREST / Storage / Edge integration

Add `tests/integration/duplicate-event-proof.py` with a dedicated isolated local stack, using the patterns in `tests/integration/run-ai-cover-local.py` and `ai-cover-storage.py`.

- A real upload/probe must succeed before target creation only through the service duplication staging branch; authenticated/anonymous calls fail. Confirm object remains private/unattached, and no owner draft exists until final commit.
- Test manual JPEG/PNG/WebP, AI-selected canonical cover, legacy gallery (position 1 only), no cover, corrupt/missing bytes, 5 MiB boundary, wrong content type and destination upload failure. No provider invocation or AI records.
- Verify byte equality, different IDs/paths; replace/remove source then duplicate and vice versa, including cancellation and current AI selection. Each remaining image must still load through its own authorized path.
- Inject failure before upload, after upload, during SQL commit, after successful commit before response. Confirm cleanup cannot delete an attached successful image; ambiguous response yields unknown state. Exercise staging expiry and conservative orphan removal. Do not claim distributed rollback.
- Repeat concurrent same-target finalization: at most one insert; second response must not masquerade as an unrelated existing-event receipt. Separate browser requests remain separate requests, not claimed global deduplication.

### Frontend/browser proof

Extend `OrganizerEventsPage.test.tsx`, `event.api.test.ts` or focused duplicate API tests, and add focused mutation/identity tests. Add `tests/e2e/duplicate-event.spec.ts`.

- Correct source UUID only; strict response parsing; no retry middleware; synchronous double-click protection, keyboard activation and one in-flight request across rows.
- Pending, known error, source conflict, unsupported source, unknown result, confirmed creation plus failed list refresh. No false “failed; duplicate again” after known success.
- Navigate to new UUID/resume editor; old source unchanged. Refresh/reopen retains copied config, blank dates, fresh agreement state and independent flyer. Browser publish fails until new schedule and agreement are supplied; paid/free happy paths follow existing flows.
- Logout, account A→B→A, navigation/unmount during request cannot populate or navigate the wrong identity. No pending source content retained in another user's cache.
- Real browser at 390px and 1440px, keyboard/focus/live announcements, no nested interactive elements, no overflow, preserved row navigation and status filters. Existing free ended/live labeling limitations are outside this task.

### Existing regression suites to retain

| Boundary | Exact existing proof sources |
| --- | --- |
| Event/ownership | `supabase/tests/database/{organizers_events_schema,organizers_events_rls,publish_event}.test.sql`; `src/features/events/{event.api,event.schemas,event.time,eventWizard,EventEditorPage,OrganizerEventsPage,EventPreviewPage}.test.*`; `tests/e2e/organizer-publish.spec.ts` |
| Tier/payment/inventory | `supabase/tests/database/{ticketing_schema,ticketing_rls,checkout_boundaries,payment_fulfillment,checkout_integrity_reservation,checkout_integrity_fulfillment,checkout_integrity_refunds,refunds_disputes}.test.sql`; `paid_tier_lock_order.test.sh`; `tests/integration/run-ticketing-database.sh` |
| Canonical tickets/check-in | `supabase/tests/database/{core_ticket_truth_lite_fulfillment,core_ticket_truth_lite_redemption,core_ticket_truth_lite_lifecycle,spec05_admission_search}.test.sql`; `tests/e2e/organizer-qr.spec.ts` |
| Free admission | `supabase/tests/database/free_registration_{schema,security,behavior,integrity,lifecycle}.test.sql`; existing Spec06 integration fixtures/harness |
| Moderation/agreements | `supabase/tests/database/{moderation_schema,moderation_policy_acceptance,moderation_publish_eligibility,moderation_published_edits,draft_without_publication_policy}.test.sql`; `tests/integration/run-moderation-proof.sh` |
| History/refunds/notices | `supabase/tests/database/{spec10_event_change_history,spec10_event_change_history_review,spec10_event_notices,spec09_refund_operations,spec09_refund_lifecycle}.test.sql` |
| Manual/AI images | `supabase/tests/database/{spec15_event_images,ai_event_cover,ai_cover_generation}.test.sql`; `tests/integration/run-ai-cover-local.py test`; `tests/integration/spec15-storage.py` now delegates to `ai-cover-storage.py`; Deno `supabase/functions/event-images/{coverMutation,imageBytes}.test.ts`; frontend `EventImageManager`, `eventFlyer.api`, `coverTransport`, `aiCover.api` tests |
| Storefront/CSV integration | `supabase/tests/database/{storefront_read,storefront_transactions,storefront_editor,organizer_csv_export,organizer_csv_export_equivalence,organizer_csv_export_lifecycle}.test.sql`; `tests/e2e/csv-export.spec.ts` |

After implementation: `pnpm typecheck`, `pnpm lint`, `pnpm build`, relevant `pnpm test`, `pnpm test:functions`, `pnpm typecheck:functions`, new SQL/Storage/concurrency/browser proof and above impacted regressions. Use actual local Storage, not mocks alone for the new trigger branch. Do not run reset/proof harnesses against hosted production or shared databases. Existing Stripe test-mode end-to-end proof is required if the eventual implementation changes payment/tier lifecycle authorities; this specification explicitly avoids those changes.

## J. Smallest implementation plan and likely files

All entries below are future work after approval; none were implemented.

1. **Approve the schedule fallback, source eligibility and staged-image boundary.** Re-fetch main and revalidate the relevant contracts before build.
2. **Database operation:** one new migration `supabase/migrations/20260924010500_add_duplicate_event_v1.sql`, the two RPC contracts, private explicit config/fingerprint/title helpers, staging trigger branch and any necessary narrowly scoped canonical-commit binding. Update generated `src/lib/supabase/database.types.ts`. Add the two new database test files above.
3. **Edge orchestration:** new `supabase/functions/duplicate-event/index.ts`, a small `duplicateEvent.ts` if needed to keep orchestration testable, and matching `.test.ts` files. Reuse `supabase/functions/_shared/{database.ts,env.ts}` and `event-images/imageBytes.ts`; do not rewrite them. Add the function entry in `supabase/config.toml` using existing handler-auth conventions. No image provider or payment dependency.
4. **Frontend action:** `src/features/events/duplicateEvent.api.ts` (small strict Edge transport), `event.queries.ts`, `OrganizerEventsPage.tsx`, `src/features/organizer-operations/organizer-operations.css`; matching API/query/page tests. Add a small success notice in `EventEditorPage.tsx` with its test only if needed; existing resume routing and blank schedule controls already work. No new router entry or new editor. Ordinary tier/requirements/publish implementations should remain unchanged.
5. **Proof:** new `tests/integration/duplicate-event-proof.py` with isolated local-stack setup, `tests/e2e/duplicate-event.spec.ts`, and extend `tests/integration/run-ai-cover-local.py` only if needed to serve the new function in a dedicated proof. Add `Docs/testing/duplicate-event-v1.md` documenting results and safe orphan cleanup. Update this spec's status only after founder approval/proof.

Manual setup now: none. Eventual rollout would require the reviewed migration and Edge function plus frontend, existing Supabase credentials and app-origin settings, and an orphan-cleanup procedure. No new third-party account, AI call, payment setup or external service is required for duplication itself.

## K. Scope guard

V1 includes one organizer-owned source per action; fresh independent draft; allowlisted content/location/admission/capacity; current paid tiers; existing factual disclosures; current independent flyer; explicit schedule re-entry under the recommended fallback; normal editor/review/agreement/publication; scoped error/security/rollback proof.

Deferred: recurring series/rules/occurrence editing, saved templates, bulk/cross-organizer duplication, future auto-generation, CRM/reporting, Staff Access, Email Attendees, Waitlist, CSV Import, promo codes, imports/exports as part of copying, payment/ticket/refund/check-in changes, storefront redesign, new map animation functionality, general idempotency/cleanup platforms and unrelated refactors.

## L. Risks and unresolved founder decisions

1. **Schedule approval:** accept blank date/time as the smallest safe V1 fallback, or insist on durable retained time and commission a revised narrow design. This report does not quietly count blank time as fulfilling retained time.
2. **Image boundary approval/proof:** accept the narrow service-only pre-create staging extension and conservative orphan cleanup. It avoids persistent partial drafts, but changes a sensitive Storage trigger. Real permission-probe/finalization/concurrency tests are a build gate. Existing image functions cannot be reused completely unchanged.
3. **Historical/moderated source policy:** recommend all owned states, including cancelled/blocked/removed. Confirm that policy; publishing remains current-rules-only, and copying must not imply an appeal or reinstatement.
4. **Minimal UX defaults:** recommend no confirmation modal, `Untitled event — Copy` fallback, generic animation default and explicit unsupported legacy artwork/timezone errors. These are proposed product decisions rather than inferred capabilities.
5. **No exactly-once guarantee:** double-click prevention is page-local; separate tabs/explicit later attempts can each create a draft. Unknown outcomes require My Events inspection. Accept this stated V1 boundary unless a durable request receipt is separately approved.
6. **Static inspection limits:** no live database/storage/browser behavior was executed. Existing source tests and prior reports were read but not claimed as current passes. No production data scan established how often legacy artwork/non-LA timezones occur. Clean-current-main source is the evidence boundary.

**Ready for Build + Prove: NO, pending founder approval of this proposed specification, particularly items 1–3.** There is a concrete implementation path; no code authorization or runtime success is implied.

## M. Final recommended V1 specification

From My Events, an authenticated organizer chooses **Duplicate event** once. The server verifies ownership and reads only the source's current reusable configuration. It creates a new UUID and a clean, independently editable draft with a safely suffixed title, copied content/location/admission/capacity, fresh current paid tiers and factual requirement answers. It copies the current selected flyer into its own immutable event-scoped object, including AI-origin pixels, with no AI generation/history copied.

Under the proposed smallest schedule fallback, both timestamps are null. The organizer enters a new date/time in the existing editor, reviews requirements, accepts current agreements, previews and publishes through current authorities. No old date, approval, public/featured state, transaction, credential, attendee, operational history or source inventory is inherited. Normal fresh-draft bookkeeping is retained.

One authenticated Edge action stages optional private bytes and invokes one atomic SQL configuration/attachment transaction. Known failure produces no partial draft; uncertain results are reported honestly and never blindly retried or destructively cleaned up. A migration is required, with zero new source-model tables or columns. Broader infrastructure remains deferred.

Stop here for founder review. No implementation, migration creation, commit, push, merge or deployment is authorized by this document.


## Appendix 1. Supplied governing request (verbatim)

~~~~text
# Wheretoo — Duplicate Event V1 Inspect & Spec

Status: Planning / inspection only. Implementation is NOT authorized by this document.

## Goal

Add the smallest safe Duplicate Event capability for organizers.

The purpose is to solve the recurring-organizer problem without building recurring-event series infrastructure.

An organizer should be able to take an event they already created, duplicate its reusable setup into a completely new draft, update the new date/details, review it, and publish through Wheretoo's existing event creation flow.

This is NOT a recurring-events system.

---

# Product behavior

From My Events, an organizer can choose:

**Duplicate event**

Wheretoo creates a completely new event draft owned by the same organizer.

The duplicate:

- receives a new event ID
- is always a draft
- is not publicly discoverable
- has no transactional/history relationship to the source event
- reuses configuration only
- enters the existing event creation/editor workflow
- must go through the normal review/publish process

Suggested title:

`<Original Event Name> — Copy`

Inspect current title constraints and define safe suffix/truncation behavior.

---

# Intended fields to copy

## Event content

Copy where authoritative and compatible:

- title
- description
- category
- venue name
- normalized address/location
- Mapbox location data
- latitude/longitude
- timezone
- admission type
- event capacity

## Schedule

Product intent:

**Reuse the event's time-of-day but require the organizer to choose a new event date.**

Important inspection question:

Current Wheretoo appears to persist schedule as complete timestamps rather than separate date and time fields.

Determine the smallest safe implementation.

Do NOT silently invent a new date.

Do NOT allow an organizer to accidentally publish the duplicate using an old historical date simply because the source schedule was copied.

If preserving time-of-day while blanking date cannot be represented safely in the current persistent model without unnecessary schema complexity, explicitly document the tradeoff and recommend the smallest V1 behavior.

Prefer, in order:

1. reuse existing model/UI capabilities if they can represent "new date required + source time retained";
2. a minimal duplication-specific editor handoff if safe and durable;
3. otherwise leave schedule blank and require date/time entry rather than introduce a major recurring-event/date-template subsystem.

Do not add recurring-series infrastructure merely to preserve time-of-day.

---

# Paid ticket tiers

For paid events, copy the currently reusable ticket tier configuration.

Inspect exact current source-of-truth and determine which tiers qualify.

Expected copied configuration:

- tier name
- description
- frozen/configured price
- currency where applicable
- quantity/capacity
- sort order

Every duplicated tier must receive a new tier ID.

The duplicate begins with:

- zero sold inventory
- zero reservations
- zero issued tickets
- zero revenue
- zero check-ins

Do NOT copy historical/archived tiers unless current product semantics prove they are part of the reusable current configuration.

Do NOT preserve source ticket-tier IDs.

Do NOT derive new tiers from order snapshots.

Use current organizer ticket-tier truth.

---

# Free events

For free events:

- preserve free admission type
- preserve configured capacity
- create no registrations
- create no free admissions/tickets
- copy no registration request/history data

---

# Event requirements

Inspect the existing event-requirements source.

Copy reusable factual organizer configuration where appropriate, such as:

- minimum age
- alcohol present
- cannabis present
- explicit adult content
- gambling present
- weapons present
- high-risk activity

Do NOT blindly copy approval/acceptance state.

The duplicated event must require the normal current organizer review/agreement process before publication.

Do NOT copy:

- prior organizer agreement acceptance
- prior policy acceptance records tied to the old event
- moderation decisions
- moderation review history
- moderation reports
- content revision history

The duplicate must enter moderation/publishing as a fresh draft according to current Wheretoo rules.

---

# Flyer / cover

Product intent:

**Copy the source event's current selected flyer/cover into the duplicate.**

This includes a current manually uploaded flyer or a currently selected AI-generated cover.

However:

Do NOT copy AI-generation history, prompts, request IDs, generation jobs, token/accounting records, or historical discarded generations.

The new event only needs the current visible flyer.

Inspect the current event-image/storage architecture carefully.

Determine whether:

1. a new independent image object must be created;
2. an existing immutable image can safely be referenced by multiple events; or
3. another existing Wheretoo image-copy primitive already exists.

The duplicated event must not create a dangerous shared mutable asset where deleting/replacing one event's flyer unintentionally removes the other event's flyer.

If storage + database operations cannot be made perfectly transactional, document the safest minimal failure/cleanup model.

Do not redesign the entire image system.

---

# NEVER copy transactional data

The duplicate must NEVER inherit:

- orders
- order items
- checkout sessions
- payment/reservation state
- customers from the original event
- free registrations
- registration requests
- tickets
- QR credentials
- check-ins
- revenue
- sales analytics
- refunds
- disputes
- ticket emails
- recovery/access grants
- event-change notifications
- cancellation history
- attendee/customer communications
- CSV/export state
- waitlists
- staff assignments
- storefront feature selections
- analytics/event performance history

This is configuration duplication, not event history duplication.

---

# Storefront behavior

Duplicating an event must NOT automatically make the new draft public or featured on the organizer storefront.

The existing public/storefront eligibility rules remain authoritative.

Once the duplicate is separately published, normal storefront/event-selection behavior applies.

Do not change storefront architecture.

---

# Source event eligibility

Inspect whether duplication should safely support organizer-owned:

- draft events
- published/live events
- ended events
- cancelled events
- blocked/removed/moderated events

Recommended principle:

Ownership is the main authorization requirement.

Because the result is always a fresh draft and must pass current publishing/moderation rules, historical source state should generally not become duplicate state.

However, document any source state that current integrity rules make unsafe to duplicate.

Do not infer public availability from ownership.

---

# Architecture principle

Prefer a single server-authorized duplication operation for persistent event configuration.

Avoid a browser workflow that performs:

1. create event
2. copy tiers
3. copy requirements
4. copy flyer

as unrelated independent mutations if that can leave a broken partial duplicate.

Inspect the current database/RPC/Edge/storage boundaries and recommend the smallest reliable design.

Ideal conceptual flow:

Organizer action
→ authenticated server authorization
→ verify source event ownership
→ copy allowlisted reusable configuration
→ create fresh draft/new IDs
→ copy independent flyer safely
→ return new event ID
→ open existing event editor

Do NOT use `SELECT *` cloning.

Use explicit allowlists.

Do not accept organizer ID from the browser as authorization truth.

Derive identity from authenticated context.

---

# Failure behavior

The organizer should never receive a "successful duplicate" that secretly inherited transactional data.

Define behavior for:

- unauthorized source
- missing source
- source changes during duplicate request
- database failure
- tier-copy failure
- requirements-copy failure
- flyer/storage-copy failure
- network response lost after successful duplication
- double click / duplicate mutation

Prefer:

- one active duplicate request at a time
- no automatic mutation retry unless idempotency is proven
- visible retry/error state
- no accidental multiple clones from a double click

Do not add a giant idempotency subsystem unless the existing architecture already provides an easy pattern.

If a response is uncertain after server success, use safe messaging rather than blindly retrying and potentially creating another duplicate.

---

# UX

Keep the UX small.

Primary entry:

**My Events → event actions → Duplicate event**

Inspect existing event-row/action patterns and recommend the least disruptive implementation.

Expected behavior:

1. organizer selects Duplicate event
2. button/action enters busy state
3. Wheretoo creates new draft
4. organizer is taken to the existing event editor
5. duplicate title clearly indicates it is a copy
6. organizer selects/updates the date
7. organizer can edit any copied configuration
8. organizer completes existing requirements/agreement flow
9. organizer previews/publishes normally

Do not create a new duplicate-event editor.

Reuse the existing event creation flow.

If a confirmation dialog materially prevents accidental duplication and matches existing UI conventions, recommend it. Otherwise avoid unnecessary modal friction.

---

# Out of scope

Do NOT build:

- recurring event series
- "every Friday" recurrence rules
- edit one occurrence / edit all occurrences
- series analytics
- series inventory
- event templates
- saved templates
- automatic future event generation
- bulk duplication
- cross-organizer duplication
- import/export integration
- waitlist
- staff permissions
- email attendees
- promo codes

Future path may eventually be:

Duplicate Event
→ Save as Template
→ Recurring Series

But V1 is Duplicate Event only.

---

# Security

Inspect and preserve:

- organizer ownership
- authenticated user boundary
- RLS
- moderation rules
- event publishing rules
- ticket-tier ownership
- event-image ownership
- storage authorization

A malicious organizer must not be able to duplicate another organizer's event by guessing an event UUID.

Do not expose private transactional data while reading the source.

Do not copy secrets or bearer credentials.

Do not loosen existing base-table RLS merely to make duplication easier.

---

# Data integrity

The result must be independently editable.

After duplication:

- editing the new event cannot modify the source event
- deleting/replacing the new flyer cannot break the source flyer
- changing new ticket prices cannot change source tiers
- selling tickets to the new event cannot affect source inventory
- cancelling the source event cannot cancel the duplicate
- refunding a source order cannot affect the duplicate
- source and duplicate analytics remain independent

No shared mutable configuration references unless existing architecture explicitly makes them safe.

---

# Testing expectations

Inspection should define a concrete test matrix.

At minimum future implementation must prove:

## Authorization

- source owner can duplicate
- unrelated organizer cannot
- unauthenticated actor cannot
- guessed event UUID cannot bypass ownership

## Core event

- new UUID
- same organizer
- status = draft
- copied allowlisted fields correct
- source event unchanged
- schedule follows approved duplicate-date behavior

## Paid

- 1 tier
- multiple tiers
- new tier IDs
- price/name/quantity/sort copied correctly
- zero sold/reserved inventory
- no orders
- no tickets
- no refunds/check-ins

## Free

- free configuration copied
- zero registrations
- zero admissions

## Requirements

- reusable answers copied as approved
- agreement acceptance reset
- moderation state reset appropriately

## Flyer

- source flyer appears on duplicate
- source and duplicate asset lifecycle is safe
- replacing/removing duplicate flyer does not affect source
- replacing/removing source flyer does not affect duplicate
- AI generation history is not copied

## Historical source

Test approved behavior for:

- live
- ended
- cancelled
- draft
- moderated/blocked source if supported

## UX

- busy state
- double-click protection
- success navigation
- failure/retry
- identity/logout change during request
- mobile layout
- keyboard accessibility

---

# Required inspection output

Produce one report with these sections:

## A. Current architecture findings

Exact current paths/contracts/tables/functions for:

- events
- event creation/draft save
- ticket tiers
- event requirements
- organizer agreement/policy acceptance
- moderation state
- event images/storage
- organizer My Events UI
- current authentication/ownership boundaries

## B. Copy matrix

Create a table:

| Source field/system | Copy? | New value/behavior | Reason |

Explicitly cover every relevant source.

## C. Schedule decision

Explain how the current model stores event dates/times and recommend the smallest safe way to achieve:

**new date required, reusable time-of-day where practical**

Do not implement recurring architecture.

## D. Flyer decision

Explain exactly how current image records/storage work and how the duplicate receives an independent safe flyer.

Identify failure/cleanup behavior.

## E. Architecture

Give the exact recommended flow.

State whether the operation belongs in:

- SQL RPC
- Edge Function
- existing application API
- or a deliberately small combination

Explain why.

Prefer the fewest moving pieces.

## F. Migration decision

State:

- whether a migration is required
- exact new RPC/function if proposed
- whether any table/column changes are necessary

Bias strongly toward no new source-model fields/tables unless current architecture proves otherwise.

## G. UX

Show exact organizer interaction and destination route.

## H. Security

Document server-side authorization and no-cross-organizer proof.

## I. Test plan

List exact SQL/frontend/browser/regression proof required.

## J. Implementation plan

List likely files/migrations/contracts/tests that would change.

Keep this small.

## K. Scope guard

Explicitly list what V1 includes and what remains deferred.

## L. Risks / unresolved questions

Call out anything that requires founder approval before implementation.

---

# Engineering principle

Duplicate Event should be boring.

It is:

**copy reusable configuration → new clean draft**

It is NOT:

**copy an event database graph.**

Preserve Wheretoo's existing sources of truth.

---

# STOP

This is inspection/specification only.

Do NOT:

- implement code
- create migrations
- alter UI
- commit production changes
- push
- merge
- deploy

Return the inspection report and STOP for founder review.
~~~~


## Appendix 2. Supplied governing request (verbatim)

~~~~text
We are starting Wheretoo Duplicate Event V1.

First perform INSPECTION + SPECIFICATION ONLY.

Create/read the governing specification at:

Docs/specs/duplicate-event-v1-inspect-spec.md

Use the full supplied Duplicate Event V1 specification as the authority.

Target the CURRENT integrated `main`, not an old recovery checkout or stale feature branch.

The current remote main was recently advanced by CSV Export V1. Before inspection:

1. locate the canonical current-main checkout
2. fetch/verify current remote main
3. record branch + HEAD
4. inspect git status
5. preserve unrelated user-owned files
6. if local main is stale, use a clean read-only worktree or safely synchronize before inspection
7. do not reset/delete unrelated work

PLANNING ONLY.

Do not implement anything.

The approved product intent is:

Organizer chooses:

My Events → Duplicate event

Wheretoo creates a completely new draft with a new event ID and copies only reusable event configuration.

Expected reusable configuration includes, subject to current-source inspection:

- event title/content/category
- venue/location/map coordinates
- timezone
- admission type/capacity
- current paid ticket tier configuration
- reusable event requirement answers
- current visible flyer/cover

The duplicate must NEVER copy:

- orders
- buyers/customers as event history
- reservations
- payments
- registrations
- tickets
- QR credentials
- check-ins
- refunds
- revenue/analytics
- email/recovery history
- cancellation/change history
- moderation decisions/history
- organizer agreement acceptance
- AI generation history/jobs/prompts
- storefront feature state
- any bearer/security secret

The result must always be a fresh independent draft.

Important schedule requirement:

The founder wants the organizer to reuse the previous event's time-of-day while choosing a NEW date.

Inspect the actual current timestamp model before deciding how to achieve that.

Do not invent a new date.

Do not silently preserve an old historical date in a way that could accidentally be republished.

Do not create recurring-event architecture merely to solve schedule duplication.

Important image requirement:

The current visible flyer should carry over, including if it originated from AI Cover.

However, source and duplicate must not share a dangerous mutable storage relationship.

Inspect event image/storage deletion/replacement semantics and determine the smallest safe independent-copy approach.

Do NOT copy AI generation metadata/history.

Architecture bias:

Prefer one authenticated server-authorized duplication action with explicit allowlisted source fields and fresh IDs.

Do not build a browser-side sequence of unrelated mutations if failure could leave a broken partial duplicate.

Do not use SELECT * cloning.

Do not loosen RLS.

Do not accept organizer ID as authorization truth when auth.uid()/existing ownership helpers can establish ownership.

Inspect the current implementation for:

- `OrganizerEventsPage`
- event draft creation/editor APIs
- event schema/types
- ticket tiers and tier writes
- event requirements
- organizer agreement/policy acceptance
- moderation
- event image records
- flyer upload/remove lifecycle
- AI cover finalization/current-cover behavior
- storage bucket/object lifecycle
- routing/navigation
- RLS/ownership functions
- relevant SQL migrations/tests

Resolve these questions:

1. What exact event fields are safe reusable configuration?
2. How should title + "— Copy" respect current constraints?
3. Can time-of-day be retained while requiring a new date with the current model?
4. Which paid tiers should copy?
5. How do we guarantee all duplicated tier IDs are fresh?
6. Which requirement answers copy?
7. Which agreement/moderation values must reset?
8. How can the current flyer be independently copied safely?
9. Should drafts/live/ended/cancelled/blocked events all be eligible sources?
10. What is the smallest server-side transaction/orchestration boundary?
11. Is a migration/RPC needed?
12. Can this be done with zero new tables/columns?
13. How do we prevent cross-organizer duplication?
14. What happens on partial image/storage failure?
15. What prevents double-click duplicates or unsafe automatic retries?
16. Which existing regression suites protect ticket/payment/free RSVP/moderation/image truth?

The report must contain:

A. Current architecture findings with exact paths/contracts
B. Explicit copy / don't-copy matrix
C. Schedule decision
D. Flyer/storage decision
E. Recommended architecture and data flow
F. Migration/data-model decision
G. Minimal UX
H. Security/ownership model
I. Exact test plan
J. Smallest implementation plan with likely files
K. Scope guard
L. Risks/unresolved founder decisions
M. Final recommended V1 specification

Strong constraints:

- no recurring-series system
- no templates
- no new CRM/reporting system
- no Staff Access
- no Email Attendees
- no Waitlist
- no CSV Import
- no payment changes
- no ticket truth changes
- no refund/check-in changes
- no storefront redesign
- no unrelated refactor

Preserve existing Wheretoo architecture and sources of truth.

STOP after the inspection/spec report.

Do not code.
Do not create migrations.
Do not commit implementation.
Do not push.
Do not merge.
Do not deploy.

Return:

1. inspected main HEAD
2. recommended Duplicate Event architecture
3. copy matrix
4. schedule decision
5. flyer decision
6. whether a migration is required
7. exact files likely to change
8. test/acceptance criteria
9. unresolved decisions
10. recommendation: ready for Build + Prove — yes/no

Then STOP for founder review.
~~~~


## Approved founder implementation request (supersedes inspection recommendations)

~~~~text
Duplicate Event V1 inspection is approved for implementation with the founder decisions below.

Governing document:

Docs/specs/duplicate-event-v1-inspect-spec.md

Target the CURRENT integrated main.

Before implementation:
1. fetch and verify current remote main
2. confirm branch/HEAD and git status
3. preserve unrelated user-owned work
4. create an isolated feature branch/worktree
5. if main has advanced since inspected HEAD 52558793abe7927102b977aaeab170983356fb99, inspect the delta and adapt safely rather than resetting newer work

Proceed with BUILD + PROVE.

# Founder decisions

These decisions supersede unresolved recommendations in the inspection report.

## 1. Schedule

APPROVED:

The duplicate gets:

starts_at = null
ends_at = null

Do NOT retain the old date.

Do NOT implement time-of-day hints, session-storage handoff, schedule metadata, new schedule columns, templates, or recurring-series infrastructure.

After duplication, send the organizer into the existing event creation/editor flow and require them to enter a new date and time before publication.

Suggested success guidance:

“Draft created. Choose a new date and time before publishing.”

This is the approved V1 schedule behavior.

## 2. Flyer

APPROVED:

Copy the current selected flyer/cover into a new independent event-scoped storage object.

The duplicate must have:

- new storage object
- new image ID
- new event-scoped path
- independent lifecycle

Do NOT:

- share the source storage object
- copy AI generation records
- copy candidate records
- copy AI prompts/jobs/request IDs/provider metadata
- reuse the original image attachment ID

Implement the narrow service-only duplication staging mechanism proposed in the inspection.

Keep ordinary manual upload and AI-cover behavior unchanged.

Real Storage integration proof is mandatory.

## 3. Source eligibility

APPROVED:

Duplicate allowed:

- owned draft
- owned published/live
- owned ended
- owned cancelled
- owned under-review

Duplicate NOT allowed:

- blocked
- removed
- missing
- foreign organizer
- unauthenticated actor

Blocked/removed must fail safely with a clear organizer-facing message.

Do not treat duplication as a moderation appeal or reinstatement mechanism.

# Product behavior

My Events → Duplicate event

On success:

source event
→ server-authorized duplicate operation
→ fresh independent draft
→ organizer navigates to:

/organizer/events/<new-event-id>/edit?resume=1

No new duplicate editor.

No new router flow.

# Copy exactly the approved reusable configuration

Copy:

- title with safe ` — Copy` suffix
- description
- category
- venue
- normalized address
- Mapbox feature ID
- coordinates
- compatible timezone
- admission type
- configured event capacity
- current non-archived paid tiers
- factual event requirement/disclosure answers when present
- current selected flyer pixels

For paid tiers copy:

- name
- description
- unit amount
- currency
- total configured quantity
- sort order

Every copied tier gets a NEW ID and fresh draft state.

# Never copy

Never copy:

- source event ID
- source tier IDs
- orders
- order items
- checkout sessions
- reservations
- buyers/customer history
- Stripe/payment state
- registrations
- registration requests
- tickets
- QR credentials
- check-ins
- refunds
- disputes
- revenue
- analytics
- ticket emails
- recovery/access grants
- change notices
- cancellation history
- moderation decisions/history
- policy acceptance
- organizer agreement acceptance
- public authorization
- storefront featured state
- AI generation metadata/history
- staff data
- waitlists
- CSV state
- any bearer/security secrets

The destination must be a completely independent event namespace.

# Architecture

Implement the approved small combination:

Browser
→ authenticated `duplicate-event` Edge Function
→ owner-authorized source context read
→ optional independent flyer byte staging
→ atomic SQL configuration transaction
→ return new event ID
→ existing editor

Use explicit allowlists.

Do not use SELECT * cloning.

Do not accept organizer ID as authorization truth.

Use auth.uid()/existing authenticated ownership boundaries.

Do not loosen RLS.

# SQL / migration

A migration is authorized.

No new source-model table or column is authorized.

Implement the narrow contracts proposed by the inspection, adapted to current main if necessary:

- owner-only duplicate context read
- atomic duplicate finalization RPC
- private fingerprint/config helpers as necessary
- narrow duplication-only image staging validation/binding
- any minimal canonical-cover binding required to prevent staged-object misuse

The exact migration timestamp/name must follow current-main ordering at implementation time.

Do not disable existing new-event bookkeeping triggers.

The duplicate must naturally receive fresh:

- draft lifecycle
- content revision defaults
- not_evaluated moderation
- never_public state
- event-change/private bookkeeping

Do not copy source lifecycle rows.

# Consistency

The source may change while duplication is happening.

Use the approved source fingerprint / lock strategy.

If reusable configuration changed between read and finalization:

fail safely with a source-changed result.

Do not produce a mixed snapshot.

Ticket sales that do not alter reusable configuration do not need to invalidate the operation.

# Failure behavior

Known failure before commit:
- no partial destination event

Source change:
- no duplicate
- organizer can refresh/review and retry

Unknown network/final response:
- do NOT blindly retry
- show guidance equivalent to:

“The result could not be confirmed. Check My Events for a new draft before duplicating again.”

Double-click:
- synchronous client guard
- mutation retry disabled
- only one active duplicate operation from the page at a time

Do not build a durable global idempotency subsystem in V1.

# Image safety

This is a sensitive part of the implementation.

Prove:

- source and destination have different image IDs
- different storage paths
- same expected bytes
- removing destination cover does not affect source
- replacing destination cover does not affect source
- removing/replacing source does not affect destination
- AI-selected source cover copies only the promoted canonical pixels
- no AI generation/candidate metadata is copied

Do not report success if a selected source flyer was expected but could not be safely copied.

If source has unsupported legacy artwork with no valid canonical selected flyer, fail explicitly rather than silently dropping it.

Preserve conservative orphan handling from the approved design.

Do not implement a cleanup platform/job system.

# UX

In My Events add a secondary:

Duplicate event

action outside the existing event-row link.

Do not nest interactive controls inside the event link.

No confirmation modal in V1.

While active:

Duplicating…

Prevent another duplication action from the same page.

On confirmed success:

navigate to the new draft's existing editor.

The user must visibly understand that a new date/time is required.

Preserve keyboard accessibility, mobile layout and existing row navigation.

# Blocked / removed behavior

This is an explicit founder override to the inspection recommendation.

If source moderation state is:

blocked
or
removed

do not duplicate it.

Enforce this server-side, not only by hiding the button.

The frontend may hide/disable the action for those states if useful, but direct API/RPC calls must also fail.

Do not copy or reinterpret moderation state.

# Required proof

## Authorization

Prove:

- owner succeeds
- unrelated organizer fails
- anonymous fails
- guessed UUID fails
- direct RPC cannot bypass ownership
- blocked source fails
- removed source fails

## Event configuration

Prove:

- new event UUID
- same organizer
- destination status draft
- fresh moderation/public state
- source unchanged
- copied allowlisted content/location correct
- schedule null
- title suffix safe at boundaries, including emoji/supplementary characters

## Paid

Prove:

- 0, 1, 2, 3 current tiers
- archived tiers excluded
- fresh tier IDs
- copied price/name/description/quantity/sort
- zero sold/reserved state
- no orders
- no tickets
- no refunds/check-ins

## Free

Prove:

- admission type/capacity copied
- no registrations
- no admissions

## Requirements

Prove:

- absence remains absence
- factual disclosures copy when present
- policy/agreement acceptance does NOT copy
- destination publication still requires normal current agreement/moderation process

## Images

Use real local Storage/Edge integration where possible.

Prove:

- no flyer
- JPEG
- PNG
- WebP
- AI-selected canonical flyer
- independent object lifecycle
- byte equality
- path/ID inequality
- corrupt/missing bytes fail
- wrong content type fails
- size boundary
- staged-object ownership/source/target/fingerprint mismatch fails
- expired staging fails
- ordinary cover APIs cannot adopt an unrelated duplication-stage object
- failure cleanup cannot delete a committed successful cover

## Concurrency

Race duplication with:

- event edit
- ticket tier price change
- tier quantity change
- tier archive
- requirement change
- flyer replace/remove
- AI flyer selection
- cancellation
- moderation/publication state change

Result must be:

complete expected configuration
OR
safe conflict

Never a mixed duplicate.

## UX/browser

Prove:

- action works from My Events
- busy state
- double click protection
- success navigation
- blank schedule visible in editor
- copied data survives refresh/reopen
- fresh agreement requirement
- known failure
- source conflict
- unknown outcome
- logout/account identity change
- keyboard
- 390px
- desktop
- no nested interactive elements / layout regression

# Regressions

Run all impacted existing suites for:

- events
- ownership/RLS
- publishing
- event editor
- ticket tiers
- checkout/inventory boundaries
- ticket truth
- free RSVP
- moderation
- agreements
- event history/notices
- refunds
- manual and AI image lifecycle
- storefront
- CSV Export

Also run:

- typecheck
- lint
- build
- relevant frontend tests
- function tests/typecheck
- new SQL tests
- real local Storage/Edge proof
- browser/E2E proof

Do not run destructive/reset tooling against hosted/shared production data.

# Scope guard

Do NOT add:

- recurring events
- series IDs
- templates
- saved templates
- recurring schedule rules
- bulk duplication
- cross-organizer duplication
- Staff Access
- Email Attendees
- Waitlist
- CSV Import
- promo codes
- new payment behavior
- ticket lifecycle changes
- refund/check-in changes
- storefront redesign
- unrelated refactors

# Git behavior

Work on an isolated feature branch/worktree.

Do not commit unrelated user-owned files.

Do not deploy.

Do not merge into main during this task.

Implementation commits are allowed after proof if repository workflow supports them, but STOP before merge.

# Completion standard

PASS only when:

Duplicate event
→ authorized source
→ fresh clean draft
→ copied reusable configuration
→ independent flyer
→ new IDs
→ zero inherited transactions/history
→ existing editor
→ new schedule required
→ normal agreement/moderation/publication

works and the required security/integrity/regression proof passes.

# Final report

When complete, STOP and report:

1. status — PASS / PARTIAL / BLOCKED
2. branch/worktree
3. baseline HEAD
4. final HEAD/commit status
5. files changed
6. migration added
7. Edge function added
8. SQL contracts
9. exact copy matrix implemented
10. source eligibility implemented
11. schedule behavior
12. flyer/storage implementation
13. authorization proof
14. transaction/isolation proof
15. no-history-copy proof
16. concurrency proof
17. browser/UX proof
18. regression results
19. typecheck/lint/build/function results
20. known baseline failures
21. unresolved risks
22. manual setup required
23. confirmation no deployment occurred
24. recommendation: ready to commit/review for merge — yes/no

Do not begin Email Attendees, Staff Access, Waitlist, CSV Import, or any other feature.

Finish Duplicate Event V1 and STOP.
~~~~
