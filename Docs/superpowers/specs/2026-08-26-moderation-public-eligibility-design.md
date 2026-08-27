# Whereto Build 2.5 Moderation and Public Eligibility Design

**Status:** Proposed architecture awaiting founder review

**Date:** 2026-08-26

**Milestone:** Published event -> risk-gated moderation -> one canonical server-side public-eligibility decision -> trustworthy public and future map projections

## 1. Source of truth and process

This specification is governed, in order, by:

1. `AGENTS.md`;
2. `Docs/WHERETO_V1_PRODUCT_DEFINITION.md`;
3. `Docs/WHERETO_V1_USER_FLOWS.md`;
4. `Docs/WHERETO_V1_TECHNICAL_ARCHITECTURE.md`;
5. `Docs/superpowers/specs/2026-08-24-organizer-event-publishing-design.md`;
6. `Docs/superpowers/plans/2026-08-24-organizer-event-publishing-implementation.md`;
7. `Docs/superpowers/specs/2026-08-25-native-ticketing-payments-design.md`;
8. `Docs/superpowers/plans/2026-08-25-native-ticketing-payments-implementation.md`;
9. the current repository at `main`;
10. the Whereto Build 3 Living Map V1 Master Specification supplied on 2026-08-26; and
11. the founder-locked Build 2.5 decisions in the accompanying brief.

The Build 3 document is a dependency contract, not authorization to build the map in Build 2.5. The current files under `Visual Reference /` are visual context only and are not part of this design change.

This is an architecture specification, not an implementation plan. No database mutation, Edge Function deployment, Stripe operation, or product-code implementation is authorized by this document.

## 2. Goal

Build 2.5 must create the smallest production-minded system that can answer one question authoritatively:

> Is this event allowed to be publicly discovered right now?

The answer must be controlled by server/database state and must be shared by every public surface. Build 3 must receive only eligible map-safe events; it must not reproduce moderation policy in React.

The system must preserve immediate publishing for normal low-risk events, hold high-risk events from discovery, re-evaluate material edits without accepting stale results, support minimal reporting and human correction, and retain immutable operational history.

## 3. Non-goals and freeze boundaries

Build 2.5 does not build:

- the Build 3 map or any map rendering;
- a default manual approval queue;
- a large Trust and Safety dashboard;
- a city-by-city legal or permit engine;
- a full appeals or organizer-strike system;
- community voting or social reputation;
- an ML training platform;
- live moderator chat;
- automatic refunds or financial cancellation;
- AI flyer generation or artwork upload;
- QR/check-in, free RSVP, analytics dashboards, search, messaging, or Day 3 features.

Stripe is frozen. This design may describe the existing payment boundary and identify compatibility requirements, but it does not authorize Stripe calls, test fixtures, Connect work, Checkout creation, webhook replay, refunds, credential access, or Stripe regression testing.

## 4. Current state assessment

### 4.1 What already exists

Day 1 provides a durable event lifecycle and owner boundary:

- `public.events.status` is `draft`, `published`, or `cancelled`.
- `public.events.moderation_status` is `clear`, `flagged`, `blocked`, or `removed` and defaults to `clear`.
- `public.publish_event(uuid)` locks an owned event, validates content/time/location, and publishes idempotently.
- the organizer cannot directly update `status`, `moderation_status`, `published_at`, `artwork_path`, `animation_preset`, or computed `location` through browser column grants;
- event ownership is enforced through RLS and owner-filtered queries;
- published owners continue to see blocked and removed events;
- Mapbox-backed location data includes a stable feature ID, structured California address, coordinates, and a PostGIS point.

Day 2 preserves those event IDs and adds:

- up to three `ticket_tiers` per paid event;
- `activate_paid_sales(uuid)` and paid publication under the established event lock order;
- `get_public_event_ticketing(uuid)`, a security-definer paid-event projection;
- server-side checkout preflight and reservation functions that reject events unless they are published, paid, temporally valid, and moderation `clear` or `flagged`;
- authoritative orders, items, tickets, refunds, disputes, and confirmations;
- order confirmation that remains token-scoped and does not depend on anonymous event visibility.

There is no map subsystem in `src/` yet. That is correct for the current build order.

### 4.2 Existing public visibility rule

The current public rule is duplicated in several places:

```text
events.status = 'published'
AND events.moderation_status IN ('clear', 'flagged')
```

It appears in:

- the `events_public_read` RLS policy;
- `get_public_event_ticketing(uuid)`;
- checkout preflight/reservation functions;
- payment-fulfillment validity checks; and
- organizer UI copy that equates `clear` or `flagged` with publicly available.

This was sufficient for Day 1 and Day 2 but is not a safe Build 3 contract.

### 4.3 Reusable foundations

Reuse without redesign:

- `events.status` as the event/business lifecycle;
- `events.moderation_status` as the simple current moderation state, after tightening its vocabulary;
- the existing PostGIS point and Mapbox location fields;
- the event advisory lock and stable ticket/event lock order;
- owner-only event and tier mutation patterns;
- token-scoped order confirmation;
- immutable payment/order/ticket records;
- typed Supabase adapters and owner-aware client query keys;
- the existing public ticketing projection shape as an input to a replacement narrow projection.

### 4.4 Capabilities that do not exist

The current system cannot safely express or operate:

- a true `under_review` state;
- the content revision that a moderation result evaluated;
- a stored or derived canonical map/public eligibility answer;
- risk disclosures or age requirements;
- moderation evaluation jobs/results;
- immutable moderation action history;
- human moderator roles or safe moderation RPCs;
- review requests;
- user reports or anti-brigading controls;
- a restored action distinct from a mutable state;
- image-moderation status tied to image bytes/version;
- public cache invalidation beyond ordinary query refetch;
- a public all-event/map-safe projection.

### 4.5 Unsafe or insufficient behavior

1. New events default to `moderation_status = 'clear'` without an evaluation.
2. `flagged` remains public, although Build 2.5 requires high-risk content to be held.
3. Public access is granted to full base `events` rows and all public `organizers` columns. Adding internal moderation columns to either base table would create an immediate leakage risk.
4. Public eligibility logic is duplicated, so a future caller can omit one condition.
5. No revision binds a moderation result to the content it evaluated.
6. No append-only history proves who changed moderation state, why, or from which prior state.
7. Public ticket tier names/descriptions and organizer display names are public content but are outside the existing moderation concept.
8. `artwork_path` exists but has no asset-version or moderation contract.
9. Active client data uses a 30-second TanStack Query stale time. A removed event disappears on a fresh server request but can remain rendered until refetch.
10. Public published-event editing is required by the product documents and the founder brief, but the current editor and RLS allow ordinary edits only while an event is a draft. The organizer page explicitly describes published events as read-only.

### 4.6 Day 1/Day 2 behavior that must remain intact

- One organizer owns each event.
- Draft save/reload, persisted preview, publication identity, and `published_at` idempotency remain intact.
- Low-risk publication is not converted into a universal approval queue.
- Mapbox verification, service envelope, Los Angeles wall-time conversion, and PostGIS point storage remain intact.
- Paid tiers, inventory, fee snapshots, orders, tickets, webhook authority, refund/dispute records, and confirmation tokens remain intact.
- Moderation removal never deletes event, order, ticket, or payment records and never moves money automatically.

## 5. Founder-locked decisions

No further approval is required for these rules:

- low-risk events may publish and become discoverable without manual review;
- high-risk V1 events are held from public discovery;
- adult, raunchy, nightlife, burlesque, drag, queer, and mature events can be allowed contextually;
- Pride, LGBTQ+, drag, and protected/community identity terms are not sexual-risk indicators by themselves;
- Nazi/extremist advocacy is prohibited, while historical, journalistic, museum, and educational context must remain distinguishable;
- keyword matches may produce a risk signal or hold but may not be the final contextual decision;
- organizer disclosures are brief and structured;
- alcohol and cannabis are not automatically prohibited;
- declared high-risk content fails closed when contextual moderation is unavailable, while deterministically low-risk content may fail open;
- material edits and image replacement require re-evaluation;
- organizers cannot set moderation or eligibility state;
- published, moderated, and discoverable are separate concepts;
- organizers see simple safe states such as `Under review`, not internal scores or model reasoning;
- one basic review-request path is enough for V1;
- disclosure/content mismatches are audited;
- user reports are signals, not one-report takedowns;
- cancellation and moderation removal remain distinct;
- removed paid events stop discovery and new sales but retain existing financial and ticket records;
- existing buyers retain token-scoped order/confirmation access;
- removal is reversible and every meaningful action is audited;
- moderation operations must not require routine direct production SQL;
- Build 3 consumes a server-filtered map-safe projection only.

## 6. Genuine founder decision still required

### 6.1 Open unpaid Checkout Sessions whenever moderation/public-policy eligibility is lost

**Question:** Whenever a paid event loses moderation/public-policy eligibility—because of hold, block, removal, a material edit, organizer-name/tier-text invalidation, or automatic risk escalation—should already-open but unpaid Stripe Checkout Sessions be actively expired, or may they complete because they began before that policy cutoff?

**Why this changes architecture:** The database can atomically block new reservations at a recorded eligibility cutoff, but an already-created hosted Stripe Session can still accept payment after any of those transitions. The current webhook path treats an ineligible event as `requires_review`; it does not make the hosted Session disappear. Active expiration would require a narrow call through the existing server-side Stripe boundary, which conflicts with the Build 2.5 Stripe freeze unless explicitly approved.

**Recommendation:** Approve a narrow future compatibility operation for every moderation/public-policy eligible-to-ineligible transition: first close the current immutable eligibility epoch, increment the event's monotonic `public_eligibility_version`, hide the event, and block new reservations under the event lock; then asynchronously expire every exact open unpaid test/live-environment Session from prior eligible epochs through the existing server boundary. Each reservation/order/Session must snapshot its eligibility version, so repeated hide/restore cycles cannot erase which policy window authorized it. A payment completed before its epoch's recorded cutoff remains an existing buyer and is fulfilled/preserved; a payment completed after it enters review. Failure to expire does not restore discovery and must alert an operator. This is not a refund and does not alter existing paid tickets.

This decision does not apply to ordinary Day 2 ineligibility such as sold-out inventory, a Connect-readiness failure, or schedule start/end unless a later payment design explicitly says so. Build 2.5 owns moderation/public-policy transitions only.

Until the founder decides, the implementation plan must not silently alter Stripe behavior.

## 7. Recommended state model

### 7.1 Orthogonal state dimensions

Store separate facts rather than one overloaded status.

#### Event lifecycle — stored on `events.status`

- `draft`
- `published`
- `cancelled`

#### Moderation lifecycle — stored on `events.moderation_status`

- `not_evaluated` — current revision has not been evaluated; normal for a draft;
- `clear` — the exact current public-content revision is cleared;
- `under_review` — held from discovery while contextual/human review is needed;
- `blocked` — prohibited before or without prior public availability;
- `removed` — taken out of discovery after being public.

`flagged` is retired. Existing `flagged` data migrates conservatively to `under_review` and is re-evaluated. A flag becomes a signal/evaluation/action, not a publicly visible moderation state.

#### Review-request lifecycle — stored separately

- `open`
- `resolved`
- `withdrawn`
- `superseded`

#### Public eligibility — derived, never organizer-editable

An event is public-policy eligible only when all are true:

```text
event.status = published
AND event.moderation_status = clear
AND event.moderated_revision = event.content_revision
AND its public organizer identity is current/cleared
AND required location data is valid and map-safe
```

Discovery queries additionally apply their explicit time window and category/viewport filters. Cancellation, end time, or a missing/invalid point makes the event absent from active discovery without rewriting moderation history.

#### New-sales eligibility — derived from public eligibility plus Day 2 facts

```text
public-policy eligible
AND admission_type = paid
AND active tier exists
AND current Connect/payment readiness passes
AND event has not started/ended according to the checkout contract
```

Build 2.5 owns only the public-policy portion. Existing Day 2 functions continue to own payment readiness and inventory.

### 7.2 State invariants

- `draft + clear` is possible after preview evaluation but never public.
- `published + under_review|blocked|removed` is valid but not public.
- `cancelled + any moderation state` is never public. Moderation history remains for audit.
- `removed` does not imply `cancelled`.
- `restored` is an audited action that returns the exact current revision to `clear`; it is not a permanent state.
- `review_requested` is not a moderation state and never makes an event public.
- report counts never directly mutate lifecycle state.
- a state of `clear` with a mismatched revision is treated as not current and therefore not public.

## 8. Public-content revision and stale-result protection

### 8.1 Event revision

Add server-controlled revision facts to `public.events`:

| Field | Type | Purpose |
|---|---|---|
| `content_revision` | `bigint not null default 1` | Monotonic revision of public/safety-relevant content |
| `moderated_revision` | `bigint` | Exact revision to which the current clear/block decision applies |
| `moderation_version` | `bigint not null default 0` | Optimistic concurrency version for state-changing admin/service actions |
| `moderation_status` | constrained text | Tightened vocabulary above |
| `moderation_updated_at` | `timestamptz` | Last state transition timestamp |
| `first_publicly_eligible_at` | `timestamptz` | Immutable first time this event became discoverable; distinguishes block from later removal |
| `public_eligibility_version` | `bigint not null default 0` | Monotonic epoch changed on every moderation/public-policy eligibility transition |

Organizers have no direct grant to `moderated_revision`, `moderation_version`, `moderation_status`, or `moderation_updated_at`.

The eligibility transition transaction sets `first_publicly_eligible_at` once, with `coalesce(existing_value, statement_timestamp())`, when the event first becomes eligible; it is never cleared or overwritten. Every moderation/public-policy eligibility transition increments `public_eligibility_version` and opens or closes the corresponding immutable interval in section 12.8 under the same lock. Therefore a prohibited decision is `blocked` when `first_publicly_eligible_at is null`, and `removed` when it is non-null. No nullable current timestamp is used as the sole historical cutoff.

### 8.2 Revision-changing content

Full contextual re-evaluation is required after changes to:

- event title;
- event description;
- category;
- venue name;
- age requirement or any risk disclosure;
- artwork asset/content hash;
- public ticket tier name or description; and
- organizer public display name used by event projections.

Deterministic-only recheck is sufficient for:

- start/end/timezone;
- Mapbox feature ID, address, coordinates, or PostGIS point;
- admission type; and
- a verified correction to structured location fields.

No moderation recheck is needed for:

- paid tier price, capacity, or sort order when name/description are unchanged;
- order, inventory, ticket, refund, or reconciliation state;
- organizer-private operational settings not included in public projections.

The deterministic-only transaction increments the revision, validates the new facts, records an evaluation/action for that revision, and may immediately mark the new revision clear. It never carries an old revision forward implicitly.

Enforcement state is never relaxed by an organizer edit. The exact transition contract is:

| Current moderation state | Full-review edit | Deterministic-only edit |
|---|---|---|
| `not_evaluated` or `clear` | `under_review` for the new revision | may become `clear` only after the same transaction validates and records the new revision |
| `under_review` | remains `under_review`; prior work is superseded | remains `under_review` until the current revision is reviewed |
| `blocked` | remains `blocked`; current-revision evaluation may be queued for staff evidence | remains `blocked` |
| `removed` | remains `removed`; current-revision evaluation may be queued for staff evidence | remains `removed` |

Only a version-checked staff restore/clear action can release `blocked` or `removed`. A successful automated evaluation of edited content cannot do so. Cancellation remains non-public and does not erase the moderation state.

### 8.3 Related public content

The content fingerprint includes public ticket tier names/descriptions and organizer display name. Implementation must ensure those updates invalidate affected event revisions. A display-name update must bump every non-cancelled owned event through one server-controlled transaction or statement-level trigger; an old event clearance cannot authorize a new organizer name. Price/capacity-only tier edits do not require this invalidation. Organizer bio, website, and base city are removed from anonymous and non-owner authenticated base-table access and are not included in V1 event/map projections.

### 8.4 Stale result rule

Every evaluation captures `event_id`, `content_revision`, `input_sha256`, and `queued_moderation_version`. Applying it must lock the event and compare all four. A result for an older revision, different digest, or changed moderation version is recorded as `superseded` and cannot change moderation state, eligibility, or `moderated_revision`. Every human hold/block/remove/restore atomically supersedes all queued or processing evaluations for that event so automation cannot undo a later human decision.

## 9. Organizer risk disclosures

Use one compact age choice plus six yes/no disclosures. This remains within the intended seven-question interaction without creating two contradictory age booleans.

| Input | Values | V1 deterministic treatment |
|---|---|---|
| Minimum age | `all_ages`, `18_plus`, `21_plus` | Public age label; used by combination checks |
| Alcohol present | yes/no | Allowed; not a hold by itself |
| Cannabis present | yes/no | Allowed in California; not a hold by itself |
| Nudity or explicit sexual content | yes/no | High-risk; hold for contextual/human review |
| Gambling or wagering | yes/no | High-risk; hold for review |
| Weapons present/featured | yes/no | High-risk; hold for review |
| High-risk physical activity | yes/no | High-risk; hold for review |

Store these in a one-to-one `event_risk_disclosures` table so anonymous event reads never accidentally expose raw moderation inputs. Canonical public projections may expose only `minimum_age` and curated allowed advisories such as `alcohol`, `cannabis`, or `mature_content` after the event is clear.

Obvious V1 combination rules:

- explicit adult content with `all_ages` -> hold;
- cannabis with less than `21_plus` -> hold;
- weapons, gambling, or high-risk physical activity -> hold regardless of age until contextual review;
- alcohol with `all_ages` is not automatically held because legitimate all-ages festivals can have controlled alcohol service;
- Pride, drag, LGBTQ+, sexual-health, medical, museum, and historical terms are never deterministic high-risk categories by themselves.

## 10. Deterministic, contextual, and human decisions

### 10.1 Deterministic layer

The deterministic layer is the synchronous security and outage boundary. It verifies:

- required disclosures are present;
- age/disclosure combinations are coherent;
- Mapbox/service-area/location invariants still hold;
- prohibited client-controlled state was not supplied;
- content and related-public-content revision are current;
- high-risk disclosures cause a hold;
- a small risk-indicator vocabulary may cause `under_review`, but never a final prohibition;
- protected/community terms are explicitly excluded from adult-risk indicators.

A keyword or image-text indicator may say `needs_context`; it may not say `prohibited` by itself.

### 10.2 Contextual moderation layer

The contextual adapter receives only the minimum public/safety content:

- title and description;
- category and venue name;
- minimum age and risk disclosures;
- public organizer display name;
- public ticket tier names/descriptions;
- region/country (not precise buyer or organizer identity);
- image bytes or a short-lived server fetch when an image exists; and
- prior structured reason codes when a re-evaluation or report triggered the request.

It never receives buyer data, order data, Stripe IDs, organizer email, auth tokens, precise user location, report actor fingerprints, or internal staff notes.

The adapter returns a validated structured object only:

```text
outcome: clear_candidate | review_required | prohibited_candidate
risk: low | high
reason_codes: small approved taxonomy
confidence: optional bounded number
provider_reference: opaque non-secret ID
model_version: non-secret string
```

Store no chain of thought, hidden reasoning, raw request headers, or unbounded model prose. `prohibited_candidate` still requires the server policy/human boundary to produce `blocked` or `removed` unless an independently approved deterministic prohibition exists.

### 10.3 Human review layer

Human moderators can:

- clear the exact current revision;
- hold it under review;
- block a never-public/prohibited event;
- remove a previously public event;
- restore the exact current revision;
- resolve a review request; and
- select one structured reason and an optional bounded internal note.

Every action is an atomic state transition plus an append-only audit record. The UI never exposes model confidence, heuristics, reviewer identity, internal notes, or detailed reasoning to organizers.

## 11. Moderation lifecycle

### 11.1 Create and draft

1. Organizer creates a draft.
2. Draft content changes bump `content_revision` when they affect public/safety content.
3. Organizer answers the compact disclosures before publish.
4. Draft remains `not_evaluated` or carries a non-public preview evaluation. It is never publicly eligible because lifecycle is `draft`.

### 11.2 Publish

1. `publish_event` acquires the existing per-event ticketing advisory lock and row lock.
2. It validates ownership, lifecycle, required content, schedule, location, disclosures, and paid readiness exactly as applicable.
3. It computes the canonical moderation input digest for the current revision.
4. Deterministically low-risk content becomes `published + clear` with `moderated_revision = content_revision` in the same transaction and is immediately eligible.
5. Declared or detected high-risk/contextual content becomes `published + under_review` with no eligible revision and is never visible for a transient window.
6. An idempotent evaluation record is created for the exact revision when contextual work is required.
7. A repeated publish returns the same event and cannot duplicate the evaluation.

### 11.3 Moderator outage

- Low-risk content that passes every deterministic rule may be cleared and published.
- Explicit adult/nudity, weapons, gambling, high-risk physical activity, incoherent age combinations, unmoderated artwork, or contextual risk indicators remain `under_review`.
- Cannabis alone in a California event does not fail closed when age information is coherent.
- Vendor timeout, malformed output, or retry exhaustion is recorded; it never changes a held event to clear.
- Outage never changes a clear current revision to blocked solely because the vendor is unavailable.

### 11.4 Published edit

1. Published edits must use one ownership-checking server function; the current draft-only direct update policy is not expanded to arbitrary published row writes.
2. The function acquires the event advisory lock and row lock, applies only allowed content columns, and bumps the revision.
3. The function applies the transition matrix in section 8.2. Only a prior `not_evaluated` or `clear` event may become `under_review` after a full-review edit or become `clear` after a same-transaction deterministic validation.
4. An event already `under_review` stays there. An event already `blocked` or `removed` preserves that enforcement state across every organizer edit; neither deterministic nor contextual automation may release it.
5. A stale evaluation cannot clear the edit because its revision/digest no longer match.
6. Rapid edits coalesce queued work: earlier jobs become `superseded`; only the latest revision may change state.

### 11.5 Reports and review requests

1. A public report endpoint verifies that the event is currently public, rate-limits a server-derived actor fingerprint, and inserts at most one active report per actor/event/revision.
2. One report never hides or removes an event.
3. Three distinct valid actor fingerprints within 24 hours raise review priority and enqueue one evaluation; they do not auto-remove.
4. Report reason changes prioritization, not guilt. Report-only auto-hide is deferred.
5. An owner may create one open review request for an `under_review`, `blocked`, or `removed` event.
6. Reports and review requests bind to the event's exact `content_revision` and `input_sha256`. Only current-revision reports influence current escalation; older records remain audit evidence.
7. A material edit marks the prior open review request `superseded`. The organizer may request review again for the new revision.
8. Staff resolution and any state change are separately audited.

### 11.6 Admin action and restore

1. Staff RPC authenticates `auth.uid()` and verifies an active moderator/admin role server-side.
2. It requires the event ID, expected content revision, expected canonical input digest, expected moderation version, action, and reason code.
3. It acquires the event advisory lock and event row lock.
4. After locking, the function recomputes the canonical digest and compares expected `content_revision`, `input_sha256`, and `moderation_version`. Any mismatch returns a conflict with no state or audit mutation.
5. It changes state and inserts the audit record in one transaction.
6. Restore clears only the exact locked revision/digest supplied by the reviewer. If content changed, the stale action conflicts; staff must load the new revision and make a separate intentional action, which may hold it for review but cannot silently approve unseen content.

The database enforces this staff transition matrix; the client cannot choose a contradictory target:

| Action | Valid source and prior-public fact | Result |
|---|---|---|
| `hold` | `not_evaluated`, `clear`, or `under_review` | `under_review` |
| `block` | `not_evaluated`, `clear`, or `under_review`, and `first_publicly_eligible_at is null` | `blocked` |
| `remove` | `clear` or `under_review`, and `first_publicly_eligible_at is not null` | `removed` |
| `clear` | `not_evaluated`, `under_review`, or `blocked`, and `first_publicly_eligible_at is null` | `clear` for the exact current revision |
| `restore` | `removed`, and `first_publicly_eligible_at is not null` | `clear` for the exact current revision |

`block` after prior visibility, `remove` without prior visibility, `clear` of a removed event, `restore` of a never-public blocked event, and any attempt to weaken an enforcement state via `hold` are rejected. A generic staff “prohibit” intent may be translated server-side to `block` or `remove` from immutable prior-public history, but request input cannot override that fact.

## 12. Recommended database model

### 12.1 Changes to `public.events`

Reuse `status`, `moderation_status`, `published_at`, location, admission, and artwork foundations. Add the revision/version/timestamp fields in section 8. Retire `flagged` after a conservative data migration.

The event row contains only the organizer-safe current moderation state, never internal notes, scores, reports, model output, or reviewer identity.

The rollout does not grandfather the old default `clear` as proof of moderation. Before switching public projections to the new predicate, every existing published `clear` or `flagged` row receives a current deterministic/contextual bootstrap evaluation. Rows without a current successful evaluation become `under_review`; legacy `flagged` always becomes `under_review`.

Legacy mapping is explicit: published `clear`/`flagged` rows were discoverable under the old rule, so initialize immutable `first_publicly_eligible_at` from `published_at` (or the earliest defensible audit timestamp) before reclassification. Published `removed` rows receive that timestamp when prior visibility is defensible because `removed` means previously public. A legacy published `blocked` row retains a null timestamp only if existing history proves it was never eligible; if prior visibility is defensible, initialize the timestamp and preserve enforcement as `removed`. Any ambiguous published `blocked`/`removed`, draft/cancelled `removed`, or other state/history contradiction is quarantined as `under_review` with an anomaly audit record rather than guessed. Existing provably valid blocked/removed states otherwise remain enforced. New drafts default to `not_evaluated`.

### 12.2 `private.event_risk_disclosures`

| Field | Rules |
|---|---|
| `event_id uuid` | PK/FK to events, delete restricted |
| `minimum_age text` | `all_ages`, `18_plus`, `21_plus` |
| `alcohol_present boolean` | required |
| `cannabis_present boolean` | required |
| `explicit_adult_content boolean` | required |
| `gambling_present boolean` | required |
| `weapons_present boolean` | required |
| `high_risk_activity boolean` | required |
| `created_at`, `updated_at` | timestamps |

Organizers write this only through the event save/publish boundary so disclosure and revision changes are atomic.

### 12.3 `private.event_moderation_evaluations`

This table is both durable work record and structured evaluation result.

| Field | Purpose |
|---|---|
| `id uuid` | primary key |
| `event_id uuid` | target event |
| `content_revision bigint` | exact evaluated revision |
| `input_sha256 text` | canonical input digest |
| `queued_moderation_version bigint` | exact event moderation version at enqueue time |
| `status text` | `queued`, `processing`, `succeeded`, `failed`, `superseded` |
| `source text` | `deterministic`, `contextual`, `human`, `report` |
| `outcome text` | nullable `clear_candidate`, `review_required`, `prohibited_candidate` |
| `risk_level text` | nullable `low`, `high` |
| `reason_codes text[]` | constrained small taxonomy |
| `provider_reference text` | nullable opaque non-secret reference |
| `model_version text` | nullable bounded string |
| `attempt_count integer` | bounded retry count |
| `failure_code text` | safe bounded code, no raw provider payload |
| `created_at`, `started_at`, `finished_at` | timestamps |

Unique `(event_id, content_revision, input_sha256, source, queued_moderation_version)` prevents duplicate work for one exact input and enforcement epoch while allowing a later intentionally requested evaluation after a human action. Workers claim jobs transactionally. Old-revision or old-version jobs can finish only as `superseded`.

### 12.4 `private.event_moderation_actions`

Append-only audit fields:

- `id uuid`;
- `event_id uuid`;
- `content_revision bigint`;
- `input_sha256 text`;
- `actor_type` (`system`, `organizer`, `moderator`, `admin`);
- nullable `actor_user_id uuid`;
- `source` (`publish`, `edit`, `evaluation`, `report_escalation`, `review_request`, `manual`);
- `action` (`clear`, `hold`, `block`, `remove`, `restore`, `request_review`, `resolve_review`);
- `previous_status` and `new_status`;
- `reason_code`;
- optional bounded `internal_note`;
- nullable `evaluation_id` and `review_request_id`;
- `moderation_version`;
- `created_at`.

No application role can update or delete audit rows. Do not store chain of thought.

### 12.5 `private.event_reports`

Store only:

- `id uuid`;
- `event_id uuid`;
- `content_revision bigint`;
- `input_sha256 text`;
- HMAC `reporter_fingerprint` generated server-side;
- structured reason;
- `status` (`open`, `reviewed`, `dismissed`, `superseded`);
- `created_at` and `resolved_at`.

Use a unique active report per `(event_id, content_revision, reporter_fingerprint)`. A material edit marks older-revision open reports `superseded` for current escalation while retaining them as audit evidence, so the same actor may report genuinely new content. Do not store raw IP, user-agent, email, or free-form text in V1. Retain the fingerprint only for the anti-abuse window, recommended 30 days, then rotate/delete it while preserving aggregate/audit facts.

A private bounded rate-bucket table follows the existing checkout-rate-limit pattern. The public browser never writes the report table directly.

### 12.6 `private.moderation_review_requests`

Fields:

- `id uuid`;
- `event_id uuid`;
- `organizer_id uuid`;
- `content_revision bigint`;
- `input_sha256 text`;
- `requested_action_id uuid`;
- `status` (`open`, `resolved`, `withdrawn`, `superseded`);
- optional bounded organizer note;
- `created_at`, `resolved_at`;
- nullable `resolved_action_id`.

Allow only one open request per event and bind it to the exact current revision/digest. Creation is through an ownership-checking RPC; resolution is staff-only. A material edit atomically marks the prior open request `superseded` rather than letting a reviewer approve stale content.

### 12.7 `private.staff_roles`

Fields:

- `user_id uuid` primary key/FK to Auth;
- `role` (`moderator`, `admin`);
- `active boolean`;
- `granted_by uuid`;
- `created_at`, `updated_at`.

Organizers cannot read or mutate this table. Moderators cannot grant roles. Initial bootstrap and role changes use a narrow admin/service operational command, not editable JWT metadata and not routine SQL moderation.

### 12.8 `private.event_public_eligibility_intervals`

This append-oriented table preserves every moderation/public-policy eligibility epoch:

- `event_id uuid`;
- `public_eligibility_version bigint`;
- `eligible_from timestamptz`;
- nullable `ineligible_at timestamptz`;
- `opened_action_id uuid` and nullable `closed_action_id uuid`;
- constrained policy transition reason; and
- primary key `(event_id, public_eligibility_version)`.

At most one interval per event is open. The event lock serializes interval closure/opening with discovery and reservation policy checks. A later restore opens a new version; it never edits or deletes an older cutoff. The future compatibility change, if founder-approved, also adds `public_eligibility_version` to the reservation/order snapshot used to create each hosted Session. Existing orders are backfilled to the epoch active at reservation time or quarantined for operational reconciliation when that cannot be proven.

### 12.9 Reason taxonomy

Use this small V1 internal set:

- `adult_explicit`;
- `weapons`;
- `gambling`;
- `hate_extremism`;
- `scam_misleading`;
- `unsafe_activity`;
- `location_invalid`;
- `age_mismatch`;
- `disclosure_mismatch`;
- `user_report`;
- `no_violation`;
- `other`.

Report reasons map into, but do not expose, this taxonomy. Cannabis and alcohol are disclosures, not violations by themselves.

## 13. RLS and security architecture

### 13.1 Base-table access

- Revoke anonymous and non-owner authenticated `select *` access on `events` and `organizers` before adding internal/revision fields.
- Public clients read only named safe RPC/view projections.
- Authenticated organizers retain self reads of their organizer row and owner reads of their full event row plus simple moderation status, but no internal moderation tables.
- Organizer event/disclosure writes use narrow column grants or, for published content, a security-definer save function with exact ownership and revision behavior.
- No organizer/browser role can execute service moderation-result functions or staff actions.

The exact default-deny table contract is:

- revoke all table privileges from `PUBLIC` and `anon` on `events`, `organizers`, and every moderation table;
- grant `authenticated` only owner-scoped `SELECT` on its organizer/events rows plus the narrowly approved editable columns used by existing draft flows;
- expose `private.event_risk_disclosures`, evaluations, actions, reports, review requests, staff roles, and rate buckets to no browser role at all;
- permit organizer disclosure save, review-request creation, and public report submission only through purpose-specific functions that validate ownership/public eligibility and accept allowlisted fields;
- permit evaluation application only to the service boundary and staff decisions only to authenticated staff RPCs; and
- grant `anon`/`authenticated` execute only on explicitly named public projection/report functions, never on helper or mutation functions by default.

Each migration must revoke `PUBLIC` function execute before granting the exact intended role. RLS remains enabled as defense in depth on browser-reachable `public` tables; moving sensitive records into `private` prevents Data API exposure even if a future policy is added incorrectly.

### 13.2 Staff authorization

- Do not trust an `is_admin` request field or mutable Auth metadata.
- Staff RPCs use `auth.uid()`, query `private.staff_roles`, require `active = true`, and enforce exact role capability.
- Every state-changing staff RPC requires expected `content_revision`, expected canonical `input_sha256`, expected `moderation_version`, and a reason code.
- Security-definer functions set `search_path = ''`, fully qualify objects, revoke `PUBLIC`, and grant only intended roles.

### 13.3 Automated worker authorization

- Contextual moderation runs server-side and invokes service-only functions.
- The worker supplies evaluation ID, revision, digest, and structured output; the database revalidates all of them.
- Vendor credentials never enter Vite, browser logs, event rows, or public error payloads.
- Service failure cannot directly set a public row clear without passing the apply-result transaction.

### 13.4 Audit immutability

- State change and action insertion occur in the same transaction.
- No normal `UPDATE` or `DELETE` grant exists on the action table.
- Corrections are new actions, never history rewrites.
- Internal notes and reviewer IDs are unavailable to organizers and anonymous users.

## 14. Canonical public eligibility and projections

### 14.1 One policy helper

Define one stable database-owned predicate or canonical relation, conceptually:

```text
private.event_is_publicly_eligible(event_id, as_of)
```

It owns lifecycle, moderation state, revision freshness, organizer-public-identity freshness, required location validity, cancellation, and end-state checks. Callers cannot choose which moderation conditions to apply.

The implementation should expose an indexed canonical relation for query performance rather than execute expensive AI/report logic at read time. Eligibility is cheap because the expensive decision has already been reduced to trusted state and revision facts.

### 14.2 Public event-detail projection

Return only approved event content, curated organizer identity, allowed advisories, and transaction-facing facts. Return no moderation state/reason, disclosure raw inputs, risk score, evaluation, report, staff, audit, internal note, or model field.

### 14.3 Existing paid ticketing projection

`get_public_event_ticketing(uuid)` must consume the canonical eligibility relation instead of reproducing `published + clear/flagged`. It continues to apply paid/tier/inventory requirements and returns only the existing safe tier projection.

### 14.4 Future Build 3 map projection

Build 3 later consumes a viewport/time-window RPC or view that returns only:

- event ID;
- title;
- category;
- start/end/timezone;
- latitude/longitude;
- map animation preset or safe fallback asset ID;
- public venue/neighborhood label where approved;
- admission type and safe free/minimum-price summary;
- optional approved artwork thumbnail reference; and
- curated minimum-age/content advisories needed for preview UI.

The query accepts viewport bounds, Today/Tomorrow or seven-day window, and category filters. It filters canonical eligibility server-side, requires a valid point, and returns no exact moderation facts. Build 3 does not receive hidden rows and does not import moderation code.

### 14.5 Indexing

Use a partial discovery index over start/end/category and the existing GiST location index for rows whose stable state is published, clear, and revision-current. The map query adds bounds and date filters. Do not run contextual moderation, report aggregation, or JSON parsing per map request.

## 15. Public cache and removal propagation

The current public data path is direct Supabase RPC/Data API plus TanStack Query; there is no committed CDN cache for event projections.

V1 requirements:

- a new request after hold/block/remove returns no public row immediately;
- visible map/event queries use an explicit 15-second `refetchInterval`, plus focus/reconnect refetch, so normal scheduler variance still meets the 30-second active-client removal target; `staleTime` alone is not polling and is not accepted as the guarantee;
- each refresh replaces the event set, so absent rows are removed rather than merged forever;
- moderation-sensitive public responses are not persisted to localStorage and should be `no-store` if served through an Edge/HTTP boundary;
- organizer/admin mutations invalidate exact local public query keys where they share a browser, but polling remains the cross-client guarantee;
- Build 3 displays last-known data only during a transient request failure and clearly retries; it may not keep a removed event indefinitely.

Realtime push is optional later. It is not required for V1's 30-second active-client propagation target.

## 16. Image moderation boundary

There is currently no organizer artwork upload or AI flyer workflow. `events.artwork_path` exists, but organizer grants and UI do not set it, and the public page renders a placeholder. Therefore a full image pipeline is not required in Build 2.5.

The safety rule is still fail closed:

- `artwork_path is null` is acceptable for eligibility;
- any non-null artwork must resolve to a versioned asset/checksum with a clear moderation result for the current event revision;
- missing bytes, failed fetch, changed checksum, upload replacement, or image-moderation outage makes the event `under_review`;
- image text/OCR and visual signals feed the same structured contextual result;
- an old cleared asset cannot clear a replacement image.

The future artwork subsystem should introduce a versioned asset row rather than treating a mutable storage path as identity. Until that system exists, non-null unverified artwork is not public-eligible. This closes the image loophole without building AI flyers now.

## 17. Paid-event implications without Stripe work

### 17.1 Before sales

An under-review/blocked/removed paid event is absent from public projection and fails the canonical policy check used by checkout preflight. Tiers and Connect state remain stored.

### 17.2 After sales

Moderation hold/removal:

- hides public event and ticket-tier projections;
- blocks new database reservations atomically under the existing event ticketing advisory lock;
- preserves the event, tiers, orders, items, tickets, refunds, disputes, and Stripe references;
- does not cancel the event lifecycle;
- does not refund or move money;
- does not revoke already-paid tickets solely because discovery changed; and
- leaves token-scoped order confirmation available to existing buyers.

### 17.3 Concurrent sale/removal

The moderation action must acquire the same event advisory lock before the event row. This serializes the eligibility cutoff with reservation/tier/event operations. A reservation that commits before the cutoff is pre-existing; one attempting after it fails eligibility.

The disposition of already-open hosted Checkout Sessions after any moderation/public-policy eligible-to-ineligible transition remains the founder decision in section 6. No Build 2.5 implementation may pretend a database flag alone expires a Stripe-hosted payment page.

## 18. Reports and anti-brigading

V1 supports reports without requiring a Whereto consumer account, because public browsing and purchasing are guest-friendly. Abuse controls are server-side:

- exact-origin/CORS and input-schema validation;
- HMAC actor fingerprint using a server secret, never raw IP storage;
- one active report per actor/event/revision;
- bounded per-actor and per-network rate buckets;
- reports accepted only for an event that is currently publicly accessible;
- no free-form text in V1;
- no report-only automatic removal;
- three distinct valid actors in 24 hours enqueue/prioritize one review;
- repeated submissions from one actor for the same revision count once;
- high-volume report patterns are visible to staff and auditable.

This intentionally protects Pride, drag, queer, community, and controversial educational events from simple coordinated takedown. Future evidence-based thresholds can be added after real abuse data exists.

Report reasons shown to users:

- scam or misleading;
- unsafe;
- prohibited content;
- wrong location;
- event does not exist;
- adult content improperly represented;
- hate or extremism;
- other.

## 19. Minimum admin workflow

Provide one protected moderation route with:

- queue sorted by held state, review request, and report priority;
- event summary and current public revision;
- structured disclosures and curated evaluation reason codes;
- safe image preview when available;
- distinct report count, not reporter identities;
- current state and prior action timeline;
- `Clear`, `Hold`, `Block`, `Remove`, and `Restore` actions;
- mandatory reason selection;
- optional bounded internal note; and
- safe conflict/reload UI when moderation version changed.

Do not include staff management, policy editing, model tuning, chat, complex appeals, organizer reputation, refund buttons, or SQL consoles in this UI.

Organizer UI shows only:

- `Published` when current and clear;
- `Under review` for not-current/held content;
- `Blocked` or `Removed` with simple safe copy;
- `Cancelled` from lifecycle state; and
- one `Request review` action where allowed.

## 20. Failure and recovery behavior

| Failure | Required behavior |
|---|---|
| Contextual moderator unavailable | Deterministic low-risk may clear; declared/detected high-risk stays held |
| Contextual timeout/malformed response | Evaluation fails safely, bounded retry, held state unchanged |
| Duplicate job | Unique input contract returns the same evaluation; no duplicate state action |
| Old job finishes after edit | Mark superseded; do not change event |
| Image missing/vendor unavailable | Hold any event relying on that image |
| Reviewer closes mid-action | No partial state; one transaction either commits state+audit or commits neither |
| Admin action races with edit | Revision/version conflict; unseen content cannot be cleared |
| Restore races with new signal | Lock/version conflict; latest current revision wins safely |
| Report endpoint unavailable | Return retryable failure; event state does not change |
| Public projection request fails | Preserve last-known display briefly, retry, never broaden server result |
| Worker retries days later | Revision/digest comparison supersedes stale work |

## 21. Threat model

| Attack | System boundary | Expected result |
|---|---|---|
| Organizer directly sets moderation state | Column grants, RLS, security-definer functions | Write is denied; no state or audit change |
| Clean publish followed by risky edit | Revision trigger + published-edit RPC + eligibility revision match | New content becomes held before it can be returned publicly |
| Organizer lies in disclosures | Contextual text/image comparison + mismatch reason/action | Event is held; mismatch is audited; no reputation score invented |
| Organizer retries publish repeatedly | Event lock + idempotent evaluation key | One lifecycle transition and one evaluation per exact revision |
| Explicit image with clean text | Versioned image checksum requirement | Unverified/risky image holds the event regardless of text |
| Organizer manipulates public eligibility | No writable eligibility boolean; canonical server predicate | Client value is ignored/denied; projection returns trusted state only |
| Anonymous browser queries blocked ID | Base-table anon revoke + safe projection | Empty/not-found response with no moderation leakage |
| Brigade reports a Pride/drag event | HMAC dedupe/rate limits; no report-only auto-hide | Priority may rise, event is not removed by votes, staff sees aggregate signal |
| Fake moderator/admin request | `auth.uid()` plus private role lookup and versioned RPC | Authorization-safe denial; JWT/request flags cannot grant privilege |
| Stale evaluator clears newer content | Event ID + revision + digest lock check | Result becomes superseded and cannot change state |
| Removed event remains in cache | Server exclusion + 30-second refetch/replace + no persistent public cache | New request excludes immediately; active client drops on bounded refresh |
| Paid event accepts new sales after moderation/public-policy eligibility loss | Shared event advisory lock + canonical preflight + immutable eligibility epoch | New reservations fail; existing records remain; open Session policy awaits founder ruling |

Additional abuse boundaries:

- malicious tier text bumps/re-evaluates the event;
- malicious organizer display-name edits invalidate affected event eligibility;
- direct report-table writes are denied;
- internal notes, reason details, reviewer identity, and model metadata never appear in public projections.

## 22. Concrete event examples

### 22.1 Normal run club

- Disclosures: all ages; all six risks `no`.
- Automated treatment: deterministic low-risk; ordinary text.
- Public eligibility: clears immediately for current revision.
- Review: none unless a later signal/report/edit requires it.

### 22.2 21+ nightclub with alcohol

- Disclosures: `21_plus`, alcohol `yes`, other risks `no`.
- Automated treatment: alcohol is allowed and age context is coherent.
- Public eligibility: low-risk clear unless text/image adds another risk.
- Review: no default manual review.

### 22.3 Drag brunch

- Disclosures: accurate age/alcohol facts; adult-explicit `no` when appropriate.
- Automated treatment: `drag`, `queer`, and LGBTQ+ identity are not sexual-risk signals.
- Public eligibility: clear when other facts are low-risk.
- Review: reports alone do not remove it; brigading protections apply.

### 22.4 Adult burlesque event

- Disclosures: `18_plus` or `21_plus`; adult-explicit `yes`; alcohol as applicable.
- Automated treatment: declared high-risk -> `under_review`, never a keyword ban.
- Public eligibility: held until contextual/human clearance.
- Review: may clear with mature advisory or block/remove only for actual prohibited facts.

### 22.5 Explicit nudity event

- Disclosures: adult-explicit `yes` and coherent adult age.
- Automated treatment: fail-closed hold, including during vendor outage; image must be evaluated.
- Public eligibility: unavailable until human/contextual clearance.
- Review: allowed context is possible; all-ages mismatch remains a strong hold reason.

### 22.6 Cannabis event

- Disclosures: cannabis `yes`, normally `21_plus`.
- Automated treatment: cannabis alone in California is not prohibited.
- Public eligibility: may clear when age/location/context are coherent.
- Review: cannabis plus minors, illegal sales claims, or conflicting imagery holds for review.

### 22.7 Weapons-related event

- Disclosures: weapons `yes`.
- Automated treatment: high-risk hold.
- Public eligibility: hidden pending context.
- Review: museum/historical education may clear; unsafe sale/advocacy/activity may remain blocked.

### 22.8 Gambling event

- Disclosures: gambling `yes`.
- Automated treatment: high-risk hold.
- Public eligibility: hidden pending review.
- Review: legitimate non-wagering game night can be corrected/cleared; wagering claims require policy review.

### 22.9 Pride festival

- Disclosures: actual alcohol/age facts; adult-explicit `no` unless truly present.
- Automated treatment: Pride/LGBTQ+ language is explicitly neutral.
- Public eligibility: ordinary low-risk clear.
- Review: coordinated reports raise priority only; they do not vote the event off the platform.

### 22.10 Nazi rally

- Disclosures: likely misleading `no` answers do not override content.
- Automated treatment: extremist indicators produce a contextual hold, not a final keyword decision.
- Public eligibility: never public while held.
- Review: advocacy/recruitment is blocked with `hate_extremism`; mismatch is audited.

### 22.11 Holocaust museum discussion mentioning Nazis

- Disclosures: low-risk; educational category/context.
- Automated treatment: a term indicator may request context, but contextual evaluation distinguishes education from advocacy.
- Public eligibility: clears after context; during moderator outage it may be temporarily held rather than falsely prohibited.
- Review: human restore/clear is available; no permanent organizer penalty follows a keyword.

### 22.12 Published paid event removed after ticket sales

- Disclosures: prior clear revision; later report/admin evidence causes removal.
- Automated treatment: admin action acquires event lock, sets `removed`, and records prior/new state and reason.
- Public eligibility: event and tiers disappear immediately on new requests; new reservations fail.
- Review: organizer retains event/status and may request review; existing paid orders/tickets/confirmations remain; no automatic refund/cancellation. Open unpaid Checkout handling follows the founder decision in section 6.

## 23. Future verification strategy

This section defines the later Build 2.5 test contract. It does not authorize implementation now.

### 23.1 Database and structural tests

Prove:

- exact state/reason/disclosure constraints;
- revision and moderation version monotonicity;
- required indexes and foreign keys;
- no `flagged` public legacy state remains;
- evaluation uniqueness and supersession;
- append-only actions;
- one open review request per event;
- one active report per actor/event/revision;
- canonical eligibility for every lifecycle/moderation/revision/location combination;
- `public_eligibility_version` increments exactly once per policy eligibility transition;
- each eligibility version has one immutable interval, at most one interval per event is open, and close/open is atomic;
- two consecutive hide/restore cycles retain both historical cutoffs and never reuse a version;
- existing order/ticket/confirmation rows survive hold/remove/restore.

### 23.2 RLS and privilege tests

Prove:

- anonymous base-table event/organizer access is revoked;
- anonymous safe projections disclose only approved fields;
- organizer A cannot read or mutate B's drafts, disclosures, review requests, or events;
- organizers cannot set moderation, eligibility, revision-result, staff, evaluation, report, or audit fields;
- fake moderator calls fail;
- moderators cannot grant roles;
- service-only evaluation apply functions are not browser-executable;
- internal notes, reason detail, reports, scores, and reviewer identity never enter public/organizer projections.

### 23.3 Re-evaluation tests

- title, description, category, venue, disclosures, age, artwork, tier text, and organizer display-name changes invalidate the cleared revision;
- schedule/location edits take the deterministic-only path;
- price/capacity-only edits do not create moderation churn;
- image replacement changes checksum/revision and holds until clear;
- stale evaluation results become superseded;
- rapid edits leave only the latest applicable result;
- published content cannot appear publicly between edit and hold.

### 23.4 Failure tests

- contextual service unavailable: low-risk clear and declared high-risk hold;
- timeout/malformed output: bounded retry and no accidental clear;
- duplicate evaluation: one durable result/action;
- reviewer transaction failure: no partial action;
- delayed job for old revision: no state change;
- report service outage: no moderation mutation;
- unmoderated non-null artwork: not public.

### 23.5 Report and abuse tests

- duplicate actor reports for one revision count once, while a new revision can be reported independently;
- rate limits are atomic under concurrency;
- raw IP/user-agent/email are absent from storage;
- one report never removes;
- three distinct reports enqueue one priority review, not three jobs and not a takedown;
- brigade simulation against a Pride/drag event cannot directly hide it;
- report reason and staff resolution are audited.

### 23.6 Concurrency tests

- publish versus evaluation;
- edit versus evaluation apply;
- edit versus clear/restore;
- remove versus restore with optimistic version;
- report escalation versus admin action;
- paid reservation versus remove under the shared event lock;
- tier text edit versus public paid projection;
- organizer display-name edit versus public event query.
- concurrent hide/restore attempts preserve one open eligibility interval and monotonic versions;
- when the founder-approved Session compatibility path exists, reservation/order snapshots retain the authorizing eligibility version across two hide/restore cycles.

### 23.7 Build 3 dependency tests

For the canonical public/map projection, prove draft, cancelled, under-review, blocked, removed, stale-revision, invalid-location, and ended events are absent before data reaches the browser. Prove clear/current events inside viewport/time bounds are returned with only the map-safe shape. Prove a removal makes a subsequent query omit the row.

### 23.8 Application checks

Run focused unit/component tests, typecheck, lint, and build for changed contracts. Browser smoke covers organizer disclosures, under-review/removed status, review request, public report flow, admin actions, responsive/accessibility behavior, and bounded cache refresh.

Do not include Stripe, Connect, Checkout, charge, webhook, refund, destination-charge, or real payment integration tests in the Build 2.5 gate. If the unresolved open-Session decision authorizes a narrow payment-boundary change, it requires a separately approved focused verification scope before implementation.

## 24. Operational scale, cost, bias, and analytics

### 24.1 Scale

- At 100 events, the same durable model works without operational shortcuts.
- At 10,000 events, map reads remain bounded by partial eligibility, time, category, and GiST location indexes.
- At 1,000 reports/day, dedupe/rate buckets and aggregate queue priority prevent per-request public-query joins.
- Concurrent edits/jobs serialize only per event; unrelated events do not share locks.

### 24.2 Cost controls

- call contextual moderation only for a new canonical input digest;
- coalesce rapid edits to the latest revision;
- use deterministic low-risk clearance and risk indicators before vendor calls;
- do not repeatedly moderate price/capacity/order changes;
- moderate image bytes by content hash, not mutable URL;
- route ambiguous/high-risk cases to a small queue rather than repeated model retries;
- cap attempts and retain safe failure codes.

### 24.3 Bias controls

- protected/community terms are excluded from deterministic sexual-risk signals;
- risk indicators produce context review, not final prohibition;
- contextual outputs use structured reason codes and are auditable;
- human correction and reversible restore exist;
- report volume alone cannot remove an event;
- test fixtures explicitly include Pride, drag, sexual-health education, Holocaust education, anti-racism, art nudity, cannabis policy, and historical-weapons contexts.

### 24.4 Minimum instrumentation

The evaluation, action, report, and review-request tables already provide authoritative operational facts. Derive counts for:

- evaluations queued/succeeded/failed/superseded;
- events held/cleared/blocked/removed/restored;
- material-edit re-evaluations;
- report submissions/dedupes/rate limits;
- review requests/resolutions;
- vendor failures and time-to-decision.

Do not add a separate behavioral analytics platform or copy event text/model reasoning into analytics.

## 25. Pre-mortem classification

### 25.1 Must solve before implementation

- eliminate `clear`-by-default as proof of evaluation;
- define the exact moderation state machine and retire public `flagged` semantics;
- add revision/digest binding so stale results cannot clear edited content;
- centralize eligibility and remove anonymous base-table reads;
- include ticket-tier text and organizer display name in the moderated public-content boundary;
- enforce organizer/staff/service privileges in PostgreSQL, not just UI;
- make audit history append-only and state changes atomic;
- define paid moderation/public-policy eligibility-loss locking and decide open Checkout Session treatment;
- fail closed for non-null unmoderated artwork;
- make report escalation resistant to one-user spam and brigading.

### 25.2 Should design for now

- versioned future artwork assets and image checksum moderation;
- one review request per event;
- bounded internal notes and structured reasons;
- reversible restore with optimistic concurrency;
- provider/model references without raw reasoning;
- report-fingerprint retention/rotation;
- 30-second active-client removal propagation;
- public advisories and age labels;
- queue metrics, failure codes, and cost controls.

### 25.3 Safe to defer

- report-only automatic hiding;
- organizer reputation/strike scoring;
- formal appeals timelines and messaging;
- city-specific law/permit logic;
- model training/tuning UI;
- realtime public invalidation;
- full image upload/AI flyer generation until that subsystem exists;
- staff role-management UI;
- complex moderation analytics;
- automated financial refund/cancellation;
- the Build 3 map itself.

## 26. Build 2.5 scope recommendation

### 26.1 V1 must have

- tightened moderation lifecycle and content/moderated revisions;
- compact age plus six risk disclosures;
- deterministic risk/outage policy;
- structured contextual evaluation boundary and durable jobs/results;
- stale-result and rapid-edit protection;
- published-edit server boundary for safety-relevant changes;
- append-only moderation actions;
- private staff roles and minimal moderation RPC/UI;
- one basic organizer review request;
- minimal anonymous report endpoint with dedupe/rate limit/no auto-hide;
- canonical public event/ticketing eligibility projection;
- future Build 3 map-safe projection contract;
- no anonymous base-table event/organizer reads;
- paid-event moderation/public-policy eligibility-loss lock behavior and preservation of existing records;
- fail-closed treatment for any non-null unmoderated artwork;
- database/RLS/concurrency/application verification excluding Stripe.

### 26.2 Nice to have if cheap

- curated public content-advisory badges;
- moderator queue filters by reason/source;
- safe evaluation latency/failure metrics;
- automatic coalescing of queued old revisions;
- a dry-run moderator view showing why an event is held using reason codes only.

### 26.3 Defer

Everything in section 25.3, plus any map implementation, AI flyer work, QR/check-in, free RSVP, consumer account, search, social, or financial operations UI.

## 27. High-level execution order

The later implementation plan should sequence work as follows:

1. lock the founder decision for open unpaid Checkout Sessions;
2. introduce state/revision/disclosure/audit schema and migrate legacy moderation safely;
3. replace anonymous base-table reads with canonical public projections;
4. add RLS, staff authorization, service-only evaluation boundaries, and append-only actions;
5. implement deterministic publish/outage rules and exact-revision job creation;
6. implement contextual result validation, stale-result supersession, and bounded retries;
7. implement safe published edits and related-content invalidation for tiers/organizer identity;
8. add review requests and the minimal moderator surface;
9. add rate-limited/deduplicated reports and priority escalation;
10. route public paid-event and future map contracts through canonical eligibility;
11. add cache-refresh/removal behavior and image fail-closed seam;
12. run the focused database, RLS, concurrency, application, accessibility, responsive, secret, and Build 3 projection gates without reopening Stripe.

This is sequencing guidance only. It is not the detailed implementation plan.

## 28. Acceptance criteria for the future build

Build 2.5 is complete only when evidence proves:

1. normal low-risk events publish without manual approval;
2. declared/detected high-risk events are held before any public leak;
3. moderator outage does not stop deterministically low-risk publication;
4. stale evaluation results cannot clear newer content;
5. title/description/category/venue/disclosure/artwork/tier-text/organizer-name edits follow the required recheck path;
6. organizers cannot set moderation, eligibility, revision-result, staff, audit, or reviewer facts;
7. every meaningful state change has an immutable action record;
8. one report cannot remove an event and duplicate/brigade attempts are bounded;
9. anonymous clients cannot read base events/organizers or any internal moderation field;
10. one canonical policy controls public detail, paid tiers, checkout preflight, and the future map projection;
11. under-review/blocked/removed/cancelled/stale-revision/invalid-location events never reach the future map-safe result;
12. removal blocks new reservations under the established event lock;
13. existing orders/tickets/confirmations remain available and no moderation action moves money;
14. non-null unmoderated artwork fails closed;
15. unit, component, database, RLS, concurrency, typecheck, lint, build, responsive, accessibility, cache-removal, and secret gates pass;
16. no Stripe test, object, credential, function deployment, or payment fixture is used unless the founder separately approves the narrow open-Session compatibility decision.

## 29. Architecture self-review

The design was checked against the required failure modes:

- **Contradictory state:** lifecycle, moderation, review request, eligibility, and sales state are orthogonal.
- **Transient public leak:** high-risk publish/edit changes state under the same transaction before projections can return the new content.
- **Stale result:** event ID, revision, digest, queued moderation version, row lock, and optimistic moderation version prevent overwrite; human enforcement supersedes queued work.
- **Privilege gap:** no client-editable eligibility boolean exists; base-table anonymous access is removed; staff/service actions are narrow.
- **Audit gap:** state/action commit atomically and corrections append rather than rewrite.
- **Transition gap:** organizer edits preserve enforcement; staff actions follow a database-enforced matrix derived from immutable prior-public history.
- **False-positive bias:** identity/community vocabulary is neutral, keywords are signals only, reports cannot vote events away, and restoration is available.
- **Image gap:** no current upload exists, but any non-null unverified artwork fails closed and future assets are checksum-versioned.
- **Paid-event conflict:** existing records and confirmations survive; reservation/policy-eligibility-loss lock order is defined; monotonic eligibility epochs survive repeated hide/restore cycles; open hosted Sessions are explicitly unresolved rather than hand-waved.
- **Build 3 leakage:** map clients receive only a narrow eligibility-filtered projection and no moderation inputs or hidden rows.
- **Overbuilt scope:** no reputation engine, legal engine, full appeals system, map, Stripe regression, or AI flyer work is included.

No placeholder implementation choice is required except the explicit founder decision in section 6. Vendor selection, exact UI styling, and detailed task/file sequencing belong to the later implementation plan after approval.
