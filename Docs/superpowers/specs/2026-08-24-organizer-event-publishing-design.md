# Whereto Day 1 Organizer Event Publishing Design

**Status:** Approved design awaiting written-spec review
**Date:** 2026-08-24
**Milestone:** Organizer signup/login -> organizer profile -> event draft -> preview -> immediate publish -> publicly discoverable Supabase event

## 1. Source of Truth

This specification implements the first Day 1 subsystem defined by:

1. `AGENTS.md`
2. `Docs/WHERETO_V1_PRODUCT_DEFINITION.md`
3. `Docs/WHERETO_V1_USER_FLOWS.md`
4. `Docs/WHERETO_V1_TECHNICAL_ARCHITECTURE.md`

The files under `Visual Reference /` are visual context only. They guide hierarchy, typography, spacing, form density, progress indicators, and preview/publish presentation. They do not add features to this milestone.

## 2. Goal

Build the smallest secure organizer subsystem that proves a real person can:

1. sign up or sign in with Supabase Auth;
2. establish one Whereto organizer profile;
3. create and persist an event draft;
4. reload and continue that draft;
5. preview the persisted event;
6. publish it once it satisfies server-enforced requirements; and
7. read the resulting event through Supabase as an anonymous public consumer.

Publishing is immediate. Normal events do not enter a manual approval queue before discovery.

## 3. Non-Goals

This milestone does not implement:

- Stripe or Stripe Connect;
- paid checkout or ticket tiers;
- free RSVP transactions;
- QR credentials or check-in;
- AI flyer generation;
- artwork upload or Supabase Storage buckets;
- Mapbox GL map rendering, clustering, or living-map animation;
- organizer analytics, orders, payouts, or attendee management;
- event editing after publication;
- cancellation UI or refund behavior;
- admin moderation tools;
- consumer accounts, favorites, messaging, search, or a primary feed;
- deployment automation or production database rollout.

The schema includes only small, stable foundations needed to avoid an immediate destructive migration later: admission type, optional capacity, an artwork path, a generic animation preset, cancellation lifecycle state, and moderation operational state.

## 4. Approved Architectural Decision

Use a React + TypeScript + Vite single-page application that accesses Supabase Auth and the Supabase Data API through `@supabase/supabase-js` with a client-safe publishable key.

Security and business invariants live in PostgreSQL:

- Row Level Security controls organizer ownership and public visibility.
- Grants limit which operations authenticated and anonymous roles can perform.
- Check constraints protect stable row-level invariants.
- A single `publish_event(event_id uuid)` database function owns the draft-to-published transition.
- No service-role or Supabase secret key is present in the browser.

Direct client access is appropriate because RLS is the authorization boundary. Edge Functions are deferred until a workflow requires secrets or external integrations, such as Stripe, OpenAI, Resend, or future automated moderation.

## 5. Repository and Environment Decisions

### 5.1 Application tooling

Use pnpm with the installed Node 22 runtime. The application stack is:

- React and TypeScript;
- Vite;
- React Router;
- `@supabase/supabase-js`;
- TanStack Query for server state and mutations;
- React Hook Form and Zod for form state and client validation;
- `@mapbox/search-js-react` for address selection and coordinate retrieval;
- Vitest and React Testing Library;
- Playwright for the organizer journey.

### 5.2 Client environment variables

The browser may receive only:

- `VITE_SUPABASE_URL`;
- `VITE_SUPABASE_PUBLISHABLE_KEY`;
- `VITE_MAPBOX_ACCESS_TOKEN`.

`VITE_` variables are public bundle inputs. Service-role, secret, database, Stripe, OpenAI, Resend, and webhook credentials must never use that prefix or enter the frontend repository.

Commit `.env.example` containing variable names only. Keep actual values in ignored local environment files and deployment-secret configuration.

### 5.3 Local and hosted Supabase

Use the currently linked hosted Supabase project as the Day 1 development environment only after confirming, before the first migration push, that it is not production.

Docker installation is not a prerequisite for starting implementation. The team will:

- create migration and pgTAP files from Day 1;
- use `npx supabase` for linked-project inspection, migration dry-runs, and development deployment;
- run browser and TypeScript integration verification against the confirmed development project;
- add local Supabase reset and pgTAP execution as soon as a Docker-compatible runtime is available;
- treat missing local pgTAP execution as an explicitly reported verification gap, not as a reason to omit the tests.

No migration may be pushed until the linked project identity and environment purpose are confirmed.

### 5.4 Local URL consistency

Run Vite on port `3000` to match the existing Supabase Auth site URL. Normalize local redirects to HTTP and allow both:

- `http://127.0.0.1:3000`;
- `http://localhost:3000`.

The UI supports both hosted-development Auth configurations:

- confirmation disabled: signup returns a session and proceeds to organizer setup;
- confirmation enabled: signup routes to a check-email screen, and organizer setup begins after authentication.

## 6. Application Boundaries

```text
src/
  app/
    providers/
    router/

  features/
    auth/
    organizers/
    events/

  components/
    layout/
    ui/

  lib/
    mapbox/
    supabase/

  styles/
```

Responsibilities:

- `app/providers`: session, query-client, and application-level providers.
- `app/router`: public routes, protected organizer routes, and route guards.
- `features/auth`: signup, sign-in, sign-out, confirmation-state handling, and auth-facing validation.
- `features/organizers`: organizer profile queries, mutations, onboarding form, and completion guard.
- `features/events`: event types, validation, queries, draft mutations, editor, preview, publish mutation, and status presentation.
- `components/ui`: reusable accessible controls without business rules.
- `components/layout`: auth and organizer shells.
- `lib/supabase`: one configured client, generated database types, and narrowly typed shared helpers.
- `lib/mapbox`: address-search adapter that returns a Whereto-owned normalized location object.

Feature modules depend on `lib` adapters; presentation components do not call Supabase or Mapbox directly.

## 7. Authentication and Organizer Lifecycle

### 7.1 Signup and login

Signup collects:

- full name;
- email;
- password.

The full name is included in Supabase Auth user metadata for display during onboarding. Auth metadata is not the authorization source for organizer or event ownership.

Sign-in uses email and password. The application subscribes to Supabase auth-state changes, resolves the initial session, and renders a deterministic loading state before choosing a route.

### 7.2 Organizer profile

After authentication, the organizer guard queries `public.organizers` using the authenticated user ID.

- No organizer row: redirect to `/organizer/setup`.
- Existing incomplete row: remain in organizer setup.
- Completed row: allow organizer application routes.

Organizer setup collects:

- public organizer name;
- optional organizer type;
- optional short bio;
- optional website;
- optional base city.

Submission inserts or updates the row whose `id` equals `auth.uid()`. Completing valid setup records `onboarding_completed_at`.

There is no `auth.users` trigger in this milestone. Organizer-profile creation is an explicit, visible onboarding operation after a valid session exists, avoiding signup failure caused by an application-table trigger.

## 8. Database Schema

All application schema changes are delivered in committed Supabase migrations. Enable PostGIS in the migration and keep extensions outside the exposed application schema where supported.

### 8.1 `public.organizers`

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | Primary key; references `auth.users(id)`; one organizer per authenticated user |
| `display_name` | `text` | Required when onboarding completes; trimmed length 2-100 |
| `organizer_type` | `text` | Nullable; trimmed length at most 80 |
| `bio` | `text` | Nullable; length at most 500 |
| `website_url` | `text` | Nullable; length at most 500; when present must begin with `https://` or `http://` in both application validation and a database check constraint |
| `base_city` | `text` | Nullable; length at most 120 |
| `country_code` | `text` | Required; default `US`; exactly two uppercase ASCII letters |
| `onboarding_completed_at` | `timestamptz` | Nullable until valid setup completes |
| `created_at` | `timestamptz` | Required; default `now()` |
| `updated_at` | `timestamptz` | Required; default `now()`; maintained by shared trigger |

The table contains only public organizer-facing information. Email and authentication data remain in `auth.users`.

### 8.2 `public.events`

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | Primary key; default `gen_random_uuid()` |
| `organizer_id` | `uuid` | Required; references `public.organizers(id)`; `on delete restrict` |
| `status` | `text` | Required; `draft`, `published`, or `cancelled`; default `draft` |
| `moderation_status` | `text` | Required; `clear`, `flagged`, `blocked`, or `removed`; default `clear` |
| `title` | `text` | Nullable in draft; publish length 3-120 |
| `description` | `text` | Nullable in draft; publish length 20-5000 |
| `category` | `text` | Nullable in draft; publish value from approved vocabulary |
| `starts_at` | `timestamptz` | Nullable in draft; required and future-dated at first publish |
| `ends_at` | `timestamptz` | Nullable in draft; required; later than `starts_at` |
| `timezone` | `text` | Required; default `America/Los_Angeles`; Day 1 UI keeps this fixed and visible |
| `venue_name` | `text` | Nullable; length at most 160 |
| `address_line1` | `text` | Nullable in draft; required to publish |
| `address_line2` | `text` | Nullable |
| `city` | `text` | Nullable in draft; required to publish |
| `region` | `text` | Nullable in draft; required to publish; Day 1 requires `CA` |
| `postal_code` | `text` | Nullable in draft; required to publish |
| `country_code` | `text` | Required; default `US`; Day 1 requires `US` |
| `mapbox_feature_id` | `text` | Nullable in draft; required to publish |
| `latitude` | `double precision` | Nullable in draft; valid range -90 to 90; required to publish |
| `longitude` | `double precision` | Nullable in draft; valid range -180 to 180; required to publish |
| `location` | `geography(Point,4326)` | Synchronized from longitude/latitude by database trigger |
| `admission_type` | `text` | Required; `free` or `paid`; default `free`; only `free` can publish in this milestone |
| `capacity` | `integer` | Nullable; greater than zero when present |
| `artwork_path` | `text` | Nullable foundation; no upload workflow in this milestone |
| `animation_preset` | `text` | Required; default `generic`; no selection workflow in this milestone |
| `published_at` | `timestamptz` | Nullable until first successful publish; never changed by retry |
| `created_at` | `timestamptz` | Required; default `now()` |
| `updated_at` | `timestamptz` | Required; default `now()`; maintained by shared trigger |

Approved Day 1 category values are:

- `food_drink`;
- `music`;
- `fitness`;
- `art_culture`;
- `shopping`;
- `community`;
- `nightlife`;
- `other`.

The database enforces stable value sets with check constraints rather than PostgreSQL enums so V1 vocabulary can evolve through ordinary migrations without enum-specific migration hazards.

### 8.3 Geographic publish rule

The selected Mapbox result must resolve to California, United States and fall inside the initial coarse Bay Area service envelope:

- latitude from `36.8` through `38.9` inclusive;
- longitude from `-123.6` through `-121.0` inclusive.

This envelope is an explicit Day 1 approximation, not the permanent service-area model. It prevents clearly unsupported publication while avoiding a third service-area table in this subsystem. A later geospatial milestone may replace it with an approved PostGIS boundary without changing stored event points.

### 8.4 Indexes

Create:

- B-tree index on `events.organizer_id`;
- B-tree index on `(events.organizer_id, events.status)`;
- B-tree index on `events.starts_at`;
- B-tree index on `(events.status, events.moderation_status, events.starts_at)` for public discovery;
- GiST index on `events.location`.

## 9. Grants and Row Level Security

Enable RLS explicitly on both application tables. Define separate policies for each operation.

### 9.1 Organizers

- `anon` and `authenticated` may select organizer rows because every stored field is public-facing.
- `authenticated` may insert only when `id = auth.uid()`.
- `authenticated` may update only the row where `id = auth.uid()`, and the resulting ID must still equal `auth.uid()`.
- No client delete grant or policy exists.

### 9.2 Events

- `authenticated` may select every event it owns, regardless of lifecycle state.
- `authenticated` may insert only a row whose `organizer_id = auth.uid()` and `status = 'draft'`.
- Ordinary authenticated updates may target only an owned draft and must leave it owned by the same organizer with `status = 'draft'`.
- Lifecycle and moderation columns are excluded from ordinary client-update privileges.
- No client delete policy exists.
- `anon` and `authenticated` may publicly select events only when:
  - `status = 'published'`; and
  - `moderation_status in ('clear', 'flagged')`.

`flagged` is an operational signal and does not automatically hide an event. `blocked` and `removed` events are not publicly readable. Future privileged moderation tooling may change moderation state; the organizer client cannot.

An authenticated owner can still read an owned blocked or removed event through the ownership policy so operational status can eventually be communicated accurately.

## 10. Publish Operation

Expose `public.publish_event(event_id uuid)` to `authenticated` only.

The function is `SECURITY DEFINER` because ordinary organizer grants intentionally cannot change lifecycle columns. It must:

- set `search_path = ''`;
- fully qualify every schema and relation;
- reject an absent `auth.uid()`;
- lock the target row for update;
- verify `organizer_id = auth.uid()`;
- reject `blocked` or `removed` moderation states;
- validate all publish requirements;
- reject `admission_type = 'paid'` with a stable domain error;
- set `status = 'published'` and `published_at = now()`;
- leave `moderation_status` unchanged;
- return the persisted event row.

Publishing is immediate. A normal draft starts with `moderation_status = 'clear'`, so a successful publish is instantly readable through the public RLS policy.

The operation is idempotent:

- if the owned event is already published, return it unchanged;
- never create a second event;
- never replace the original `published_at` during a retry.

Stable error codes exposed to the frontend are:

- `EVENT_NOT_FOUND`;
- `EVENT_NOT_OWNED`;
- `EVENT_INCOMPLETE`;
- `EVENT_TIME_INVALID`;
- `EVENT_LOCATION_INVALID`;
- `EVENT_OUTSIDE_SERVICE_AREA`;
- `PAID_PUBLISHING_NOT_AVAILABLE`;
- `EVENT_MODERATION_BLOCKED`.

The frontend maps these codes to plain-language recovery instructions and preserves the draft.

## 11. Frontend Routes and Screens

### 11.1 Routes

| Route | Access | Responsibility |
|---|---|---|
| `/auth/sign-up` | Public | Create an organizer login |
| `/auth/check-email` | Public | Explain confirmation and next action |
| `/auth/sign-in` | Public | Restore an organizer session |
| `/organizer/setup` | Authenticated | Create or finish the organizer profile |
| `/organizer/events` | Completed organizer | List owned drafts and published events |
| `/organizer/events/new` | Completed organizer | Begin a new event draft |
| `/organizer/events/:eventId/edit` | Owning organizer | Reload and edit an owned draft |
| `/organizer/events/:eventId/preview` | Owning organizer | Render a preview from the persisted row |
| `/organizer/events/:eventId` | Owning organizer | Show published-event confirmation and status |

### 11.2 Route guards

- `RequireSession` waits for initial auth resolution and redirects signed-out users to sign-in.
- `RequireOrganizer` loads the organizer row and redirects missing/incomplete profiles to organizer setup.
- Event loaders handle RLS-empty results as not found without revealing whether another organizer owns the ID.

### 11.3 Event editor

Use three stages:

1. **Details:** title, description, category, free/paid foundation, optional capacity.
2. **Schedule and location:** date/time, fixed displayed timezone, venue, Mapbox-selected address and coordinates.
3. **Review:** read-only summary, preview action, save-draft action, and publish action.

Draft behavior:

- The first explicit save inserts a real `events` row and redirects from `/new` to `/:eventId/edit`.
- Later saves update the same row.
- Moving between steps does not silently claim persistence; saved and unsaved states are visually distinct.
- Save failure preserves form values and offers a retry.
- Leaving with unsaved changes triggers a navigation warning.
- Reloading an edit route hydrates the form from Supabase.

### 11.4 Preview

Preview loads the saved event by ID from Supabase. It never treats unsaved in-memory form state as proof of persistence.

Preview includes:

- title and organizer;
- date/time and timezone;
- category and free-event status;
- venue and exact address;
- description;
- a deliberate Whereto placeholder where future artwork will appear;
- a publish CTA for a valid owned draft.

It does not render a map, ticket selector, RSVP flow, AI artwork, or animation picker.

### 11.5 Publish result

After a successful RPC response:

- invalidate event list/detail queries;
- route to `/organizer/events/:eventId`;
- show `Published` with the persisted timestamp;
- state that the event is publicly available;
- verify public readability in automated development checks with a separate anonymous Supabase client; no organizer-facing verification control is required;
- never claim tickets, map placement, or checkout exists.

## 12. Visual Direction

Use the approved light organizer-console family:

- white and soft-neutral surfaces;
- deep ink text;
- violet for progress, focus, and organizer actions;
- compact mobile-first form controls;
- clear step progression;
- one dominant CTA per screen;
- rounded surfaces used for grouping, not decorative card proliferation.

The dark neon map references are reserved for later consumer-map work. Organizer UI must remain responsive on mobile and desktop, keyboard accessible, visibly focused, and compatible with reduced motion.

## 13. Data Flow

```text
Supabase Auth signup/sign-in
  -> resolved authenticated session
  -> organizer profile select/upsert under RLS
  -> owned draft insert/update under RLS
  -> persisted draft select for preview
  -> publish_event(event_id)
  -> published event row
  -> anonymous select succeeds immediately
```

TanStack Query owns server-state caching. React Hook Form owns only current editable input. Feature API modules translate Supabase rows/errors into domain-facing results. Components receive typed data and callbacks rather than importing the Supabase client.

## 14. Error Handling

Every asynchronous screen distinguishes:

- initial loading;
- empty/not-found state;
- recoverable validation error;
- authorization-safe not-found result;
- network/server failure;
- successful persistence.

Rules:

- Never erase draft form state after a failed mutation.
- Never reveal another organizer's resource existence.
- Keep field errors beside fields and provide a form-level summary on submit.
- Use active recovery copy such as `Try saving again` or `Choose a verified address`.
- Keep action names consistent: `Save draft`, `Preview`, and `Publish event`.
- Publish remains disabled while the mutation is active to prevent accidental duplicate requests; database idempotence remains authoritative.

## 15. Test and Verification Strategy

### 15.1 Database tests

Commit pgTAP coverage for:

- required tables, columns, constraints, triggers, grants, and indexes;
- RLS enabled on both tables;
- organizer self-insert and self-update;
- rejection of organizer impersonation;
- owned draft insert/select/update;
- cross-organizer draft isolation;
- anonymous draft denial;
- direct lifecycle and moderation mutation denial;
- publish rejection for incomplete, invalid-time, invalid-location, unsupported-area, paid, blocked, and non-owned events;
- successful immediate publication;
- unchanged `published_at` on retry;
- anonymous read immediately after successful normal publication;
- anonymous denial after `blocked` or `removed` moderation state;
- continued owner visibility after operational blocking/removal.

Run these locally once Docker-compatible Supabase is available. Their absence from the first local run must be reported, not hidden.

### 15.2 Frontend tests

Vitest and React Testing Library cover:

- signup validation and Supabase errors;
- signup with and without immediate session;
- sign-in failure and success;
- initial auth-loading behavior;
- organizer guard routing;
- organizer setup validation and persistence;
- event step validation;
- draft insert/update failure recovery;
- reload hydration;
- persisted preview;
- domain error mapping from publish RPC;
- successful publish routing and query invalidation;
- keyboard labels, focus, and error summary behavior.

### 15.3 Development-project integration tests

Proceed without waiting for Docker by testing against the confirmed linked development project using unique test identities and records:

1. create Organizer A;
2. complete Organizer A's profile;
3. save and reload an incomplete draft;
4. complete required event data with a Mapbox address;
5. preview the persisted event;
6. publish it;
7. query anonymously and confirm immediate visibility;
8. retry publish and confirm the same event and timestamp;
9. create Organizer B and confirm it cannot read or mutate Organizer A's draft/owned non-public data;
10. use an authorized SQL or Supabase CLI session against the development project—not the browser application—to set moderation state and confirm public visibility rules;
11. remove all disposable application test rows where authorized, without embedding elevated credentials in frontend code.

### 15.4 End-to-end and visual verification

Playwright covers the full organizer journey at representative mobile and desktop widths. Final verification includes:

- typecheck;
- lint;
- unit/component tests;
- production build;
- database migration dry-run;
- linked development migration result;
- database/RLS verification available in the current environment;
- Playwright journey;
- screenshot inspection using the approved visual references as context;
- keyboard and responsive smoke checks;
- clean Git diff and secret scan.

## 16. Acceptance Criteria

The milestone is complete only when all of the following are demonstrated with evidence:

1. A new organizer can sign up or an existing organizer can sign in.
2. The authenticated user has exactly one owned organizer row.
3. The organizer can save a partial event draft to Supabase.
4. Refreshing the editor restores the same draft.
5. Another organizer cannot read or mutate the draft.
6. Preview renders the persisted event, not unsaved form state.
7. Invalid or incomplete events cannot publish.
8. Paid events cannot publish in this milestone.
9. A valid free event publishes through the database function.
10. The same publish request is safe to retry.
11. The published event is immediately returned to an anonymous client.
12. A blocked or removed event is no longer returned publicly.
13. No secret or privileged key exists in the frontend bundle or committed files.
14. Relevant automated checks pass, with any Docker-dependent gap reported explicitly.

## 17. Implementation Order

The later implementation plan must preserve this sequence:

1. confirm linked-project environment identity;
2. normalize repository setup needed by the subsystem;
3. scaffold Vite/React/TypeScript and quality gates;
4. add safe environment configuration;
5. write migration and pgTAP tests;
6. dry-run and apply the migration to the development project;
7. generate Supabase TypeScript types;
8. implement providers and protected routing;
9. implement auth screens;
10. implement organizer setup;
11. implement event draft editing and Mapbox address selection;
12. implement persisted preview;
13. implement immediate publish and public-read verification;
14. add component, integration, E2E, accessibility, and visual verification;
15. run final checks and report any remaining local-Docker verification gap.

No Stripe, QR, AI flyer, ticketing, map-rendering, or analytics task may be folded into this plan.
