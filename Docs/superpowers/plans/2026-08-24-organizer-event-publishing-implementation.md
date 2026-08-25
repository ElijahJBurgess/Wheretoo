# Whereto Day 1 Organizer Event Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove the organizer signup/login -> organizer profile -> saved event draft -> persisted preview -> immediate publish -> anonymous Supabase discovery milestone.

**Architecture:** Build a React + TypeScript + Vite SPA that uses a typed Supabase browser client and feature-local API modules. PostgreSQL migrations own schema, grants, RLS, PostGIS synchronization, and the idempotent publish transition; TanStack Query owns server state, React Hook Form owns editable state, and React Router owns access guards.

**Tech Stack:** Node 22, pnpm, React, TypeScript, Vite, React Router, Supabase Auth/PostgreSQL/PostGIS, `@supabase/supabase-js`, TanStack Query, React Hook Form, Zod, Mapbox Search JS React, Vitest, React Testing Library, pgTAP, and Playwright.

**Spec:** `Docs/superpowers/specs/2026-08-24-organizer-event-publishing-design.md`

## Global Constraints

- Read `AGENTS.md`, the approved spec, and the three V1 product documents before execution.
- Treat `Visual Reference /` as visual context only; it cannot add product behavior.
- Run Vite at port `3000` and permit both `http://127.0.0.1:3000` and `http://localhost:3000` Supabase Auth redirects.
- Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_MAPBOX_ACCESS_TOKEN` may enter the browser bundle.
- Never commit real environment values, a Supabase service-role key, database credentials, or third-party secret keys.
- Confirm the linked Supabase project is a non-production development project before any migration push or linked pgTAP run.
- Docker is not a prerequisite: author local pgTAP support immediately, use the confirmed linked development project for current verification, and report any unrun local-Docker check.
- Normal valid events publish immediately. There is no approval queue. `flagged` remains public; `blocked` and `removed` are hidden.
- Only free events can publish in this subsystem.
- Do not add Stripe, checkout, ticketing, RSVP, QR/check-in, AI flyers, uploads, map rendering, consumer feed/search, analytics, published-event editing, cancellation UI, or moderation UI.
- Use test-driven development for behavior: failing test, observed failure, minimal implementation, observed pass.
- Use direct module imports rather than application barrel files. Derive display state during render and perform user-triggered mutations in event handlers, not effects.
- Preserve user changes, keep each commit scoped, and stop if the linked environment cannot be positively identified as development.

---

## Planned File Map

### Repository and tooling

- `.env.example` — public client variable names only.
- `.gitignore` — local env, build, coverage, Playwright, and Supabase temporary artifacts.
- `package.json`, `pnpm-lock.yaml` — dependencies and repeatable scripts.
- `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` — Vite/TypeScript entry and strict compilation.
- `eslint.config.js` — TypeScript/React linting.
- `playwright.config.ts` — port-3000 E2E configuration.
- `src/vite-env.d.ts`, `src/test/setup.ts` — environment typing and test DOM setup.

### Database

- `supabase/config.toml` — correct local Auth redirect allowlist.
- `supabase/seed.sql` — intentionally data-free seed file so local reset succeeds without fake production data.
- `supabase/migrations/20260824010000_create_organizers_and_events.sql` — extensions, tables, checks, triggers, and indexes.
- `supabase/migrations/20260824010100_secure_organizer_event_publishing.sql` — grants, RLS policies, and `publish_event`.
- `supabase/tests/database/organizers_events_schema.test.sql` — structural pgTAP coverage.
- `supabase/tests/database/organizers_events_rls.test.sql` — ownership and public-read pgTAP coverage.
- `supabase/tests/database/publish_event.test.sql` — publish validation, moderation, and idempotency pgTAP coverage.

### Application core

- `src/main.tsx`, `src/app/App.tsx` — application entry and router host.
- `src/app/providers/AppProviders.tsx` — Query Client and session providers.
- `src/app/router/router.tsx`, `src/app/router/RequireSession.tsx`, `src/app/router/RequireOrganizer.tsx` — routes and access boundaries.
- `src/lib/env.ts` — fail-fast public environment parsing.
- `src/lib/supabase/client.ts`, `src/lib/supabase/database.types.ts` — typed Supabase client and generated schema.
- `src/components/layout/AuthLayout.tsx`, `src/components/layout/OrganizerLayout.tsx` — page shells.
- `src/components/ui/Button.tsx`, `Field.tsx`, `FormErrorSummary.tsx`, `AsyncState.tsx`, `StepRail.tsx` — accessible reusable controls.
- `src/styles/tokens.css`, `src/styles/global.css` — Whereto organizer-console visual system and responsive rules.

### Auth and organizer features

- `src/features/auth/auth.schemas.ts`, `auth.api.ts`, `SessionProvider.tsx` — validation, Auth calls, and initial-session state.
- `src/features/auth/SignUpPage.tsx`, `SignInPage.tsx`, `CheckEmailPage.tsx` — organizer authentication screens.
- `src/features/organizers/organizer.schemas.ts`, `organizer.api.ts`, `organizer.queries.ts` — profile contract and persistence.
- `src/features/organizers/OrganizerSetupPage.tsx` — explicit organizer profile creation/completion.

### Event features

- `src/features/events/event.schemas.ts`, `event.types.ts`, `event.api.ts`, `event.queries.ts` — form/domain contract, typed persistence, and query keys.
- `src/features/events/publishErrors.ts` — stable database-code-to-copy mapping.
- `src/features/events/OrganizerEventsPage.tsx` — owned event list and create entry.
- `src/features/events/EventEditorPage.tsx`, `EventDetailsStep.tsx`, `EventScheduleLocationStep.tsx`, `EventReviewStep.tsx` — saved-draft workflow.
- `src/lib/mapbox/normalizeSearchResult.ts`, `src/features/events/LocationSearchField.tsx` — Mapbox result normalization behind a small adapter.
- `src/features/events/EventPreviewPage.tsx`, `EventSummary.tsx`, `PublishedEventPage.tsx` — persisted preview, publish action, and confirmation.

### Verification

- Co-located `*.test.ts` and `*.test.tsx` files — unit/component tests beside their owning modules.
- `tests/e2e/organizer-publish.spec.ts` — real-browser milestone journey.
- `tests/integration/public-event-visibility.test.ts` — separate anonymous-client publication assertion.
- `Docs/testing/day1-organizer-event-verification.md` — non-secret linked-development and local-Docker runbook.

---

### Task 1: Confirm the Development Boundary and Scaffold the Tested SPA

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `eslint.config.js`
- Create: `src/vite-env.d.ts`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/App.test.tsx`
- Create: `src/test/setup.ts`
- Modify: `supabase/config.toml`
- Create: `supabase/seed.sql`

**Interfaces:**
- Consumes: existing Git repository, Node 22, `supabase/config.toml`, and a human-confirmed non-production Supabase project identity.
- Produces: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm supabase`; Vite on port 3000; a renderable `App` component.

- [x] **Step 1: Prove the linked project is safe before changing remote state**

Run read-only commands:

```bash
node --version
pnpm --version
npx supabase --version
npx supabase projects list
npx supabase migration list --linked
git status --short --branch
```

Expected: Node reports major version 22; Git has no unrelated changes; the operator explicitly confirms the linked project reference and name are development, not production. Do not continue to any `db push` or `test db --linked` command without that confirmation.

- [x] **Step 2: Install the exact subsystem dependencies and let pnpm pin them**

```bash
pnpm init
pnpm add react react-dom react-router-dom @supabase/supabase-js @tanstack/react-query react-hook-form @hookform/resolvers zod @mapbox/search-js-react @fontsource-variable/space-grotesk @fontsource-variable/manrope
pnpm add -D typescript vite @vitejs/plugin-react eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom supabase @playwright/test
```

Set these scripts in `package.json`:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 3000",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "supabase": "supabase"
  }
}
```

- [x] **Step 3: Add safe environment and artifact ignores**

`.env.example` must contain names only:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_MAPBOX_ACCESS_TOKEN=
```

`.gitignore` must include:

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.env
.env.*
!.env.example
supabase/.temp/
```

- [x] **Step 4: Write the failing application smoke test**

```tsx
// src/app/App.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the Whereto organizer entry point', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Create what happens next' })).toBeInTheDocument()
  })
})
```

- [x] **Step 5: Run the test and observe the expected failure**

Run: `pnpm test -- src/app/App.test.tsx`

Expected: FAIL because `src/app/App.tsx` does not exist or does not export `App`.

- [x] **Step 6: Add the minimal Vite app and test setup**

```tsx
// src/app/App.tsx
export function App() {
  return <h1>Create what happens next</h1>
}
```

```tsx
// src/main.tsx
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Configure Vitest with `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, and `globals: false`; import `@testing-library/jest-dom/vitest` from `src/test/setup.ts`. Configure strict TypeScript and ESLint without allowing `any`.

- [x] **Step 7: Correct the local Auth redirect allowlist**

In `supabase/config.toml`, keep:

```toml
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["http://localhost:3000"]
```

Create `supabase/seed.sql` with comments only; do not add fake users or events.

- [x] **Step 8: Verify the scaffold**

Run:

```bash
pnpm test -- src/app/App.test.tsx
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: one passing smoke test; typecheck, lint, build, and diff check exit 0.

- [x] **Step 9: Commit the scaffold**

```bash
git add .env.example .gitignore package.json pnpm-lock.yaml index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json eslint.config.js src/vite-env.d.ts src/main.tsx src/app/App.tsx src/app/App.test.tsx src/test/setup.ts supabase/config.toml supabase/seed.sql
git commit -m "chore: scaffold organizer application"
```

---

### Task 2: Create Organizer and Event Schema with Structural pgTAP Coverage

**Files:**
- Create: `supabase/tests/database/organizers_events_schema.test.sql`
- Create: `supabase/migrations/20260824010000_create_organizers_and_events.sql`

**Interfaces:**
- Consumes: Supabase PostgreSQL 17 and `auth.users(id)`.
- Produces: `public.organizers`, `public.events`, `public.set_updated_at()`, `public.sync_event_location()`, constraints, and documented indexes.

- [x] **Step 1: Write the structural pgTAP test before the migration**

The test must begin/rollback its transaction and assert the exact contract:

```sql
begin;
select plan(16);

select has_extension('postgis', 'postgis is enabled');
select has_table('public', 'organizers', 'organizers exists');
select has_table('public', 'events', 'events exists');
select col_is_pk('public', 'organizers', 'id', 'organizer id is primary key');
select col_is_fk('public', 'organizers', 'id', 'organizer id references auth.users');
select col_is_fk('public', 'events', 'organizer_id', 'event belongs to an organizer');
select col_type_is('public', 'events', 'location', 'geography', 'event location is geography');
select col_default_is('public', 'events', 'status', '''draft''::text', 'events default to draft');
select col_default_is('public', 'events', 'moderation_status', '''clear''::text', 'events default to clear moderation');
select has_check('public', 'organizers', 'organizers have check constraints');
select has_check('public', 'events', 'events have check constraints');
select has_index('public', 'events', 'events_organizer_id_idx', 'organizer index exists');
select has_index('public', 'events', 'events_organizer_status_idx', 'organizer/status index exists');
select has_index('public', 'events', 'events_starts_at_idx', 'start index exists');
select has_index('public', 'events', 'events_discovery_idx', 'discovery index exists');
select has_index('public', 'events', 'events_location_gix', 'spatial index exists');

select * from finish();
rollback;
```

- [x] **Step 2: Run the structural test and observe failure**

If a Docker-compatible runtime is available, run `pnpm supabase start && pnpm supabase test db supabase/tests/database/organizers_events_schema.test.sql`.

If Docker is unavailable, record the local red-run as unavailable with the exact runtime error. Do not push an empty or partial remote migration merely to manufacture a failing test. Continue authoring the migration, then use the confirmed linked development project for the green run in Step 4.

Expected with local execution before migration: FAIL because the tables do not exist. Expected without local execution: a documented Docker-only verification gap, not an implementation blocker.

- [x] **Step 3: Write the schema migration**

Create the extension in `extensions`, tables in `public`, a shared timestamp trigger, and a location trigger. The migration must use these exact stable checks:

```sql
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table public.organizers (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  organizer_type text,
  bio text,
  website_url text,
  base_city text,
  country_code text not null default 'US',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizers_display_name_check check (char_length(btrim(display_name)) between 2 and 100),
  constraint organizers_type_check check (organizer_type is null or char_length(btrim(organizer_type)) between 1 and 80),
  constraint organizers_bio_check check (bio is null or char_length(bio) <= 500),
  constraint organizers_website_check check (
    website_url is null or (
      char_length(website_url) <= 500 and
      (website_url like 'https://%' or website_url like 'http://%')
    )
  ),
  constraint organizers_base_city_check check (base_city is null or char_length(btrim(base_city)) between 1 and 120),
  constraint organizers_country_code_check check (country_code ~ '^[A-Z]{2}$')
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizers(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  moderation_status text not null default 'clear' check (moderation_status in ('clear', 'flagged', 'blocked', 'removed')),
  title text check (title is null or char_length(btrim(title)) <= 120),
  description text check (description is null or char_length(description) <= 5000),
  category text check (category is null or category in ('food_drink', 'music', 'fitness', 'art_culture', 'shopping', 'community', 'nightlife', 'other')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/Los_Angeles',
  venue_name text check (venue_name is null or char_length(btrim(venue_name)) <= 160),
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country_code text not null default 'US',
  mapbox_feature_id text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  location extensions.geography(Point, 4326),
  admission_type text not null default 'free' check (admission_type in ('free', 'paid')),
  capacity integer check (capacity is null or capacity > 0),
  artwork_path text,
  animation_preset text not null default 'generic',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_coordinate_pair_check check ((latitude is null) = (longitude is null)),
  constraint events_time_order_check check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint events_country_code_check check (country_code ~ '^[A-Z]{2}$')
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.sync_event_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.location := case
    when new.longitude is null or new.latitude is null then null
    else extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography
  end;
  return new;
end;
$$;

create trigger organizers_set_updated_at before update on public.organizers
for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();
create trigger events_sync_location before insert or update of longitude, latitude on public.events
for each row execute function public.sync_event_location();

create index events_organizer_id_idx on public.events (organizer_id);
create index events_organizer_status_idx on public.events (organizer_id, status);
create index events_starts_at_idx on public.events (starts_at);
create index events_discovery_idx on public.events (status, moderation_status, starts_at);
create index events_location_gix on public.events using gist (location);
```

- [x] **Step 4: Verify migration syntax and structural behavior**

Local Docker path:

```bash
pnpm supabase db reset
pnpm supabase test db supabase/tests/database/organizers_events_schema.test.sql
```

No-Docker development path, after environment confirmation:

```bash
pnpm supabase db push --dry-run --linked
pnpm supabase db push --linked
pnpm supabase test db --linked supabase/tests/database/organizers_events_schema.test.sql
```

Expected: dry-run lists only the new migration; migration succeeds; 16 pgTAP assertions pass. Record which path ran.

- [x] **Step 5: Commit schema and structural tests**

```bash
git add supabase/migrations/20260824010000_create_organizers_and_events.sql supabase/tests/database/organizers_events_schema.test.sql
git commit -m "feat: add organizer and event schema"
```

---

### Task 3: Enforce Ownership, Immediate Publishing, and Moderation Visibility

**Files:**
- Create: `supabase/tests/database/organizers_events_rls.test.sql`
- Create: `supabase/tests/database/publish_event.test.sql`
- Create: `supabase/migrations/20260824010100_secure_organizer_event_publishing.sql`

**Interfaces:**
- Consumes: `public.organizers`, `public.events`, `auth.uid()`.
- Produces: operation-specific RLS policies and `public.publish_event(p_event_id uuid) returns public.events` with stable error messages.

- [x] **Step 1: Write RLS tests with two authenticated identities and anon**

Use fixed UUIDs inside a rolled-back test transaction, insert matching `auth.users`, and switch JWT identity with request settings:

```sql
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
```

The test must prove these named cases with pgTAP `lives_ok`, `throws_ok`, `results_eq`, and `is_empty` assertions:

```text
Organizer A can insert/update only id A.
Organizer A cannot insert id B or delete any organizer.
Organizer A can insert/select/update an owned draft.
Organizer B cannot select or mutate Organizer A's draft.
Anonymous cannot see a draft.
Anonymous can see a published clear event.
Anonymous can see a published flagged event.
Anonymous cannot see a published blocked event.
Anonymous cannot see a published removed event.
Organizer A can still see its own blocked/removed event.
The browser roles cannot directly update organizer_id, status, moderation_status, published_at, or location.
```

End with `select * from finish(); rollback;`. Count the exact assertions and make `plan(n)` match before running.

- [x] **Step 2: Write publish-function tests before the security migration**

Build fixtures through privileged test setup, then assume Organizer A for RPC calls. Assert exact messages:

```sql
select throws_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000001') $$,
  'P0001', 'EVENT_INCOMPLETE', 'incomplete event is rejected'
);

select lives_ok(
  $$ select public.publish_event('20000000-0000-0000-0000-000000000002') $$,
  'valid free event publishes'
);

select results_eq(
  $$ select status from public.events where id = '20000000-0000-0000-0000-000000000002' $$,
  $$ values ('published'::text) $$,
  'publish persists status'
);
```

Cover `EVENT_NOT_FOUND`, `EVENT_NOT_OWNED`, `EVENT_INCOMPLETE`, `EVENT_TIME_INVALID`, `EVENT_LOCATION_INVALID`, `EVENT_OUTSIDE_SERVICE_AREA`, `PAID_PUBLISHING_NOT_AVAILABLE`, and `EVENT_MODERATION_BLOCKED`; then prove successful publication, immediate anon visibility, and unchanged `id`/`published_at` on retry.

- [x] **Step 3: Run both tests and observe failure**

Run locally if available, otherwise on the confirmed linked development project after Task 2:

```bash
pnpm supabase test db --linked supabase/tests/database/organizers_events_rls.test.sql supabase/tests/database/publish_event.test.sql
```

Expected: FAIL because grants, policies, and `publish_event` do not exist.

- [x] **Step 4: Add least-privilege grants and RLS policies**

The migration must revoke broad defaults before granting exact access:

```sql
revoke all on public.organizers from anon, authenticated;
revoke all on public.events from anon, authenticated;

grant select on public.organizers to anon, authenticated;
grant insert (id, display_name, organizer_type, bio, website_url, base_city, country_code, onboarding_completed_at)
  on public.organizers to authenticated;
grant update (display_name, organizer_type, bio, website_url, base_city, country_code, onboarding_completed_at)
  on public.organizers to authenticated;

grant select on public.events to anon, authenticated;
grant insert (organizer_id, title, description, category, starts_at, ends_at, timezone, venue_name,
  address_line1, address_line2, city, region, postal_code, country_code, mapbox_feature_id,
  latitude, longitude, admission_type, capacity)
  on public.events to authenticated;
grant update (title, description, category, starts_at, ends_at, timezone, venue_name,
  address_line1, address_line2, city, region, postal_code, country_code, mapbox_feature_id,
  latitude, longitude, admission_type, capacity)
  on public.events to authenticated;

alter table public.organizers enable row level security;
alter table public.events enable row level security;

create policy organizers_public_read on public.organizers for select to anon, authenticated using (true);
create policy organizers_self_insert on public.organizers for insert to authenticated
with check ((select auth.uid()) = id);
create policy organizers_self_update on public.organizers for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy events_owner_read on public.events for select to authenticated
using ((select auth.uid()) = organizer_id);
create policy events_public_read on public.events for select to anon, authenticated
using (status = 'published' and moderation_status in ('clear', 'flagged'));
create policy events_owner_insert_draft on public.events for insert to authenticated
with check ((select auth.uid()) = organizer_id and status = 'draft');
create policy events_owner_update_draft on public.events for update to authenticated
using ((select auth.uid()) = organizer_id and status = 'draft')
with check ((select auth.uid()) = organizer_id and status = 'draft');
```

Do not add delete grants/policies or any client grant for lifecycle/moderation columns.

- [x] **Step 5: Add the idempotent publish function**

Use a locked row and exact stable messages. The implementation must preserve the first timestamp and leave moderation unchanged:

```sql
create or replace function public.publish_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_OWNED';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  if v_event.organizer_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_OWNED';
  end if;
  if v_event.moderation_status in ('blocked', 'removed') then
    raise exception using errcode = 'P0001', message = 'EVENT_MODERATION_BLOCKED';
  end if;
  if v_event.status = 'published' then
    return v_event;
  end if;
  if v_event.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'EVENT_INCOMPLETE';
  end if;
  if v_event.admission_type = 'paid' then
    raise exception using errcode = 'P0001', message = 'PAID_PUBLISHING_NOT_AVAILABLE';
  end if;
  if v_event.title is null or char_length(btrim(v_event.title)) not between 3 and 120
    or v_event.description is null or char_length(btrim(v_event.description)) not between 20 and 5000
    or v_event.category is null or v_event.address_line1 is null or v_event.city is null
    or v_event.region is null or v_event.postal_code is null or v_event.mapbox_feature_id is null then
    raise exception using errcode = 'P0001', message = 'EVENT_INCOMPLETE';
  end if;
  if v_event.starts_at is null or v_event.ends_at is null
    or v_event.starts_at <= now() or v_event.ends_at <= v_event.starts_at then
    raise exception using errcode = 'P0001', message = 'EVENT_TIME_INVALID';
  end if;
  if v_event.country_code <> 'US' or v_event.region <> 'CA'
    or v_event.latitude is null or v_event.longitude is null or v_event.location is null then
    raise exception using errcode = 'P0001', message = 'EVENT_LOCATION_INVALID';
  end if;
  if v_event.latitude not between 36.8 and 38.9
    or v_event.longitude not between -123.6 and -121.0 then
    raise exception using errcode = 'P0001', message = 'EVENT_OUTSIDE_SERVICE_AREA';
  end if;

  update public.events
  set status = 'published', published_at = coalesce(published_at, now())
  where id = p_event_id
  returning * into v_event;
  return v_event;
end;
$$;

revoke all on function public.publish_event(uuid) from public, anon;
grant execute on function public.publish_event(uuid) to authenticated;
```

- [x] **Step 6: Apply and verify the security migration**

```bash
pnpm supabase db push --dry-run --linked
pnpm supabase db push --linked
pnpm supabase test db --linked supabase/tests/database/organizers_events_rls.test.sql supabase/tests/database/publish_event.test.sql
pnpm supabase db lint --linked --level warning
```

Expected: dry-run contains only the security migration; all named RLS/publish assertions pass; lint reports no security or function warnings requiring action. Use the local equivalents when Docker is available.

- [x] **Step 7: Commit security behavior and tests**

```bash
git add supabase/migrations/20260824010100_secure_organizer_event_publishing.sql supabase/tests/database/organizers_events_rls.test.sql supabase/tests/database/publish_event.test.sql
git commit -m "feat: secure immediate event publishing"
```

---

### Task 4: Generate Database Types and Build the Typed Supabase Boundary

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/lib/env.test.ts`
- Create: `src/lib/supabase/database.types.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/client.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: applied development schema and three `VITE_` variables.
- Produces: `readPublicEnv(source): PublicEnv`, singleton `supabase`, generated `Database` type, and `pnpm db:types`.

- [x] **Step 1: Write failing environment tests**

```ts
import { describe, expect, it } from 'vitest'
import { readPublicEnv } from './env'

describe('readPublicEnv', () => {
  it('returns the three public values', () => {
    expect(readPublicEnv({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable',
      VITE_MAPBOX_ACCESS_TOKEN: 'pk.mapbox',
    })).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'publishable',
      mapboxAccessToken: 'pk.mapbox',
    })
  })

  it('fails with the missing variable name', () => {
    expect(() => readPublicEnv({})).toThrow('Missing VITE_SUPABASE_URL')
  })
})
```

- [x] **Step 2: Observe failure, then implement the parser**

Run: `pnpm test -- src/lib/env.test.ts`

Expected: FAIL because `readPublicEnv` is absent.

```ts
export type PublicEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
  mapboxAccessToken: string
}

export function readPublicEnv(source: Record<string, unknown>): PublicEnv {
  const requireString = (name: string) => {
    const value = source[name]
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing ${name}`)
    return value
  }
  return {
    supabaseUrl: requireString('VITE_SUPABASE_URL'),
    supabasePublishableKey: requireString('VITE_SUPABASE_PUBLISHABLE_KEY'),
    mapboxAccessToken: requireString('VITE_MAPBOX_ACCESS_TOKEN'),
  }
}

export const publicEnv = readPublicEnv(import.meta.env)
```

- [x] **Step 3: Generate, do not hand-author, database types**

Add:

```json
"db:types": "supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts"
```

Run `pnpm db:types`. Expected: generated types include `organizers`, `events`, and `publish_event` with argument `p_event_id`.

- [x] **Step 4: Write and implement the client contract**

Test `createWheretoClient(env)` separately from its singleton so configuration is observable without network calls. Implement:

```ts
import { createClient } from '@supabase/supabase-js'
import { publicEnv, type PublicEnv } from '../env'
import type { Database } from './database.types'

export function createWheretoClient(env: PublicEnv) {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
}

export const supabase = createWheretoClient(publicEnv)
```

- [x] **Step 5: Verify and commit the boundary**

```bash
pnpm test -- src/lib/env.test.ts src/lib/supabase/client.test.ts
pnpm typecheck
pnpm lint
git diff --check
git add package.json pnpm-lock.yaml src/lib/env.ts src/lib/env.test.ts src/lib/supabase/database.types.ts src/lib/supabase/client.ts src/lib/supabase/client.test.ts
git commit -m "feat: add typed Supabase client"
```

Expected: boundary tests pass and generated types compile without `any`.

---

### Task 5: Establish the Organizer Console Design System and App Providers

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Field.tsx`
- Create: `src/components/ui/FormErrorSummary.tsx`
- Create: `src/components/ui/AsyncState.tsx`
- Create: `src/components/ui/StepRail.tsx`
- Create: `src/components/ui/ui.test.tsx`
- Create: `src/components/layout/AuthLayout.tsx`
- Create: `src/components/layout/OrganizerLayout.tsx`
- Create: `src/app/providers/AppProviders.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: React children and `SessionProvider` from Task 6 (temporarily omit it until Task 6, then add it there).
- Produces: accessible UI primitives, two layout shells, a stable `QueryClient`, and global Whereto visual tokens.

- [x] **Step 1: Write failing accessibility tests for controls**

```tsx
it('links a field error to its input', () => {
  render(<Field label="Event title" name="title" error="Enter a title"><input id="title" /></Field>)
  expect(screen.getByLabelText('Event title')).toHaveAttribute('aria-describedby', 'title-error')
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a title')
})

it('marks the current real workflow step', () => {
  render(<StepRail current={2} labels={['Details', 'Schedule & location', 'Review']} />)
  expect(screen.getByText('Schedule & location')).toHaveAttribute('aria-current', 'step')
})
```

- [x] **Step 2: Observe failure, then implement focused primitives**

Run: `pnpm test -- src/components/ui/ui.test.tsx`

Expected: FAIL because the components do not exist.

Implement semantic buttons, labels, alerts, loading/empty/error blocks, and an ordered-list `StepRail`. Do not create an application-wide component barrel.

- [x] **Step 3: Implement the approved visual tokens**

Use exactly these CSS custom properties as the initial visual contract:

```css
:root {
  --color-canvas: #f7f7fb;
  --color-surface: #ffffff;
  --color-ink: #19162c;
  --color-muted: #6f6a7d;
  --color-violet: #6d4aff;
  --color-violet-deep: #4d2fd4;
  --color-border: #dedce8;
  --color-success: #117a56;
  --color-danger: #b42318;
  --font-display: 'Space Grotesk Variable', sans-serif;
  --font-body: 'Manrope Variable', sans-serif;
  --radius-control: 0.75rem;
  --radius-surface: 1.125rem;
  --shadow-focus: 0 0 0 3px rgb(109 74 255 / 24%);
}
```

The signature element is a compact violet waypoint rail whose nodes correspond only to the three real editor stages. Keep other surfaces quiet, light, and structurally useful. Include `:focus-visible`, 44px minimum interactive targets, a mobile-first content width, and `@media (prefers-reduced-motion: reduce)`.

- [x] **Step 4: Add layouts and a stable query provider**

`AppProviders` must create its `QueryClient` once with lazy state:

```tsx
export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
```

`AuthLayout` contains the product mark and centered auth content. `OrganizerLayout` contains product mark, `Events`, and `Sign out`; it must not contain analytics, ticketing, payouts, or map navigation.

- [x] **Step 5: Verify and commit the design foundation**

```bash
pnpm test -- src/components/ui/ui.test.tsx
pnpm typecheck
pnpm lint
pnpm build
git add src/styles src/components/ui src/components/layout src/app/providers/AppProviders.tsx src/main.tsx
git commit -m "feat: add organizer console foundation"
```

Expected: accessibility tests and build pass; keyboard focus is visible in a browser smoke check at 390px and 1440px widths.

---

### Task 6: Implement Session State, Route Guards, Signup, and Sign-In

**Files:**
- Create: `src/features/auth/auth.schemas.ts`
- Create: `src/features/auth/auth.schemas.test.ts`
- Create: `src/features/auth/auth.api.ts`
- Create: `src/features/auth/auth.api.test.ts`
- Create: `src/features/auth/SessionProvider.tsx`
- Create: `src/features/auth/SessionProvider.test.tsx`
- Create: `src/features/auth/SignUpPage.tsx`
- Create: `src/features/auth/SignInPage.tsx`
- Create: `src/features/auth/CheckEmailPage.tsx`
- Create: `src/features/auth/auth.pages.test.tsx`
- Create: `src/app/router/RequireSession.tsx`
- Create: `src/app/router/RequireSession.test.tsx`
- Create: `src/app/router/router.tsx`
- Modify: `src/app/providers/AppProviders.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: typed `supabase`, UI primitives, React Router.
- Produces: `signUpOrganizer(input): Promise<{ needsEmailConfirmation: boolean }>`, `signInOrganizer(input): Promise<void>`, `signOut(): Promise<void>`, `useSession(): SessionState`, and `RequireSession`.

- [x] **Step 1: Write failing schema tests and implement exact validation**

```ts
export const signUpSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
})

export const signInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})
```

Tests must reject a one-character name, invalid email, and seven-character signup password, while allowing a valid submission. Run red then green.

- [x] **Step 2: Write failing Auth API tests**

Mock only `supabase.auth`. Assert signup sends:

```ts
{
  email: 'organizer@example.com',
  password: 'safe-password',
  options: {
    data: { full_name: 'Avery Stone' },
    emailRedirectTo: `${window.location.origin}/organizer/setup`,
  },
}
```

Assert `needsEmailConfirmation` is `true` when the returned session is null and `false` when a session exists. Assert Supabase errors are thrown for the page to render.

- [x] **Step 3: Implement Auth API functions and observe green tests**

Use direct event-handler calls to these functions; do not represent submit as state watched by an effect.

- [x] **Step 4: Write failing initial-session and subscription tests**

Test `loading -> authenticated` and `loading -> anonymous`, and verify the auth-state subscription is unsubscribed on unmount. The state contract is:

```ts
type SessionState =
  | { status: 'loading'; session: null; user: null }
  | { status: 'anonymous'; session: null; user: null }
  | { status: 'authenticated'; session: Session; user: User }
```

- [x] **Step 5: Implement `SessionProvider` and `RequireSession`**

`RequireSession` renders a deterministic loading state, redirects anonymous users to `/auth/sign-in`, and renders `<Outlet />` only for authenticated state. Preserve the attempted location in router state.

- [x] **Step 6: Write failing page journey tests**

Cover invalid fields, server error retention, disabled submit while pending, signup with immediate session -> `/organizer/setup`, signup without session -> `/auth/check-email`, and sign-in -> `/organizer/events`.

- [x] **Step 7: Implement auth pages and routes**

Use these exact routes and action copy:

```text
/auth/sign-up       Create organizer account
/auth/check-email   Check your email
/auth/sign-in       Sign in
```

No OAuth, password reset, social auth, or consumer account UI belongs in this task.

- [x] **Step 8: Verify and commit authentication**

```bash
pnpm test -- src/features/auth src/app/router/RequireSession.test.tsx
pnpm typecheck
pnpm lint
pnpm build
git add src/features/auth src/app/router/RequireSession.tsx src/app/router/RequireSession.test.tsx src/app/router/router.tsx src/app/providers/AppProviders.tsx src/app/App.tsx
git commit -m "feat: add organizer authentication"
```

Expected: all auth branches pass and initial auth loading never flashes protected content.

---

### Task 7: Create and Guard the Organizer Profile

**Files:**
- Create: `src/features/organizers/organizer.schemas.ts`
- Create: `src/features/organizers/organizer.schemas.test.ts`
- Create: `src/features/organizers/organizer.api.ts`
- Create: `src/features/organizers/organizer.api.test.ts`
- Create: `src/features/organizers/organizer.queries.ts`
- Create: `src/features/organizers/OrganizerSetupPage.tsx`
- Create: `src/features/organizers/OrganizerSetupPage.test.tsx`
- Create: `src/app/router/RequireOrganizer.tsx`
- Create: `src/app/router/RequireOrganizer.test.tsx`
- Modify: `src/app/router/router.tsx`

**Interfaces:**
- Consumes: authenticated user ID, generated `organizers` row types, query client.
- Produces: `OrganizerInput`, `getOrganizer(userId): Promise<Organizer | null>`, `saveOrganizer(userId, input): Promise<Organizer>`, `organizerKeys`, and `RequireOrganizer`.

- [x] **Step 1: Write failing organizer schema tests**

Implement after red:

```ts
export const organizerInputSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  organizerType: z.string().trim().max(80).optional().or(z.literal('')),
  bio: z.string().max(500).optional().or(z.literal('')),
  websiteUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  baseCity: z.string().trim().max(120).optional().or(z.literal('')),
})
```

Tests cover valid empty optionals, invalid website, too-short display name, and maximum lengths.

- [x] **Step 2: Write failing profile API tests**

Assert `getOrganizer` maps PostgREST `PGRST116`/empty result to `null` but throws other errors. Assert `saveOrganizer` upserts exactly the authenticated ID, normalized nullable values, `country_code: 'US'`, and a non-null `onboarding_completed_at`; never accept an ID from form input.

- [x] **Step 3: Implement API and query contracts**

```ts
export type Organizer = Database['public']['Tables']['organizers']['Row']
export type OrganizerInput = z.infer<typeof organizerInputSchema>

export const organizerKeys = {
  all: ['organizer'] as const,
  detail: (userId: string) => ['organizer', userId] as const,
}
```

Keep query/mutation hooks in `organizer.queries.ts`; components must not import the Supabase client.

- [x] **Step 4: Write failing organizer guard tests**

Cover loading state, no row -> `/organizer/setup`, incomplete row -> `/organizer/setup`, completed row -> protected outlet, and setup route remaining accessible during incomplete onboarding without a redirect loop.

- [x] **Step 5: Implement `RequireOrganizer` and setup screen**

Initialize public organizer name from `user.user_metadata.full_name` only as a convenience. Authorization and persisted ownership continue to use `user.id`. On success, update/invalidate `organizerKeys.detail(user.id)` and navigate to `/organizer/events`.

- [x] **Step 6: Verify and commit organizer onboarding**

```bash
pnpm test -- src/features/organizers src/app/router/RequireOrganizer.test.tsx
pnpm typecheck
pnpm lint
git add src/features/organizers src/app/router/RequireOrganizer.tsx src/app/router/RequireOrganizer.test.tsx src/app/router/router.tsx
git commit -m "feat: add organizer profile onboarding"
```

Expected: profile ownership payload and every guard branch pass.

---

### Task 8: Define Event Form Contracts and Owned Draft Persistence

**Files:**
- Create: `src/features/events/event.types.ts`
- Create: `src/features/events/event.schemas.ts`
- Create: `src/features/events/event.schemas.test.ts`
- Create: `src/features/events/event.api.ts`
- Create: `src/features/events/event.api.test.ts`
- Create: `src/features/events/event.queries.ts`

**Interfaces:**
- Consumes: generated `events` row/insert/update types and typed Supabase client.
- Produces: `EventCategory`, `PublishEventErrorCode`, `EventFormValues`, `NormalizedLocation`, `EventRow`, `eventDraftSchema`, `eventPublishSchema`, `eventRowToFormValues`, `listOwnedEvents`, `getOwnedEvent`, `saveEventDraft`, `publishEvent`, and `eventKeys`.

- [x] **Step 1: Write failing draft/publish schema tests**

Define category/error unions and form values once:

```ts
export type EventCategory =
  | 'food_drink'
  | 'music'
  | 'fitness'
  | 'art_culture'
  | 'shopping'
  | 'community'
  | 'nightlife'
  | 'other'

export type PublishEventErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_OWNED'
  | 'EVENT_INCOMPLETE'
  | 'EVENT_TIME_INVALID'
  | 'EVENT_LOCATION_INVALID'
  | 'EVENT_OUTSIDE_SERVICE_AREA'
  | 'PAID_PUBLISHING_NOT_AVAILABLE'
  | 'EVENT_MODERATION_BLOCKED'

export type EventRow = Database['public']['Tables']['events']['Row']

export type NormalizedLocation = {
  mapboxFeatureId: string
  addressLine1: string
  addressLine2: string
  city: string
  region: 'CA'
  postalCode: string
  countryCode: 'US'
  latitude: number
  longitude: number
}

export type EventFormValues = {
  title: string
  description: string
  category: EventCategory | ''
  startsAt: string
  endsAt: string
  timezone: 'America/Los_Angeles'
  venueName: string
  location: NormalizedLocation | null
  admissionType: 'free' | 'paid'
  capacity: number | null
}
```

`eventDraftSchema` enforces safe maxima and positive optional capacity while allowing incomplete fields. `eventPublishSchema` additionally requires title 3-120, description 20-5000, category, future start, later end, verified location, CA/US, Bay Area bounds, and free admission. Tests freeze time with Vitest and cover every stable publish error category.

- [x] **Step 2: Observe schema failure and implement minimal schemas**

Run: `pnpm test -- src/features/events/event.schemas.test.ts`

Expected before implementation: FAIL. After implementation: all boundary cases pass. Keep server validation authoritative even though equivalent client feedback exists.

- [x] **Step 3: Write failing owned-event API tests**

Use a mocked typed query builder to assert:

```text
listOwnedEvents filters organizer_id and orders created_at descending.
getOwnedEvent filters both id and organizer_id and returns null for an RLS-empty result.
saveEventDraft inserts organizer_id only on first save.
saveEventDraft updates only the supplied owned event ID on later saves.
empty strings normalize to null; location fields flatten to database columns.
no API payload includes status, moderation_status, published_at, location, artwork_path, or animation_preset.
publishEvent calls rpc('publish_event', { p_event_id: eventId }).
```

- [x] **Step 4: Implement APIs with exact signatures**

```ts
export async function listOwnedEvents(organizerId: string): Promise<EventRow[]>
export async function getOwnedEvent(eventId: string, organizerId: string): Promise<EventRow | null>
export function eventRowToFormValues(event: EventRow): EventFormValues
export async function saveEventDraft(input: {
  eventId: string | null
  organizerId: string
  values: EventFormValues
}): Promise<EventRow>
export async function publishEvent(eventId: string): Promise<EventRow>
```

Use `.select().single()` after insert/update and throw typed feature errors. `eventRowToFormValues` is the only database-row-to-form mapper used by the editor and preview validation. Never broaden a mutation query beyond both event ID and organizer ID.

- [x] **Step 5: Add stable query keys and mutation invalidation contract**

```ts
export const eventKeys = {
  all: ['events'] as const,
  ownedList: (organizerId: string) => ['events', 'owned', organizerId] as const,
  detail: (eventId: string) => ['events', 'detail', eventId] as const,
}
```

Saving invalidates the owned list and seeds the detail cache. Publishing invalidates the owned list and exact detail. Do not invalidate unrelated query families.

- [x] **Step 6: Verify and commit the event data layer**

```bash
pnpm test -- src/features/events/event.schemas.test.ts src/features/events/event.api.test.ts
pnpm typecheck
pnpm lint
git add src/features/events/event.types.ts src/features/events/event.schemas.ts src/features/events/event.schemas.test.ts src/features/events/event.api.ts src/features/events/event.api.test.ts src/features/events/event.queries.ts
git commit -m "feat: add owned event draft data layer"
```

Expected: mapping, ownership filters, and schema boundary tests pass.

---

### Task 9: Normalize Mapbox Search Results Behind an Address Adapter

**Files:**
- Create: `src/lib/mapbox/normalizeSearchResult.ts`
- Create: `src/lib/mapbox/normalizeSearchResult.test.ts`
- Create: `src/features/events/LocationSearchField.tsx`
- Create: `src/features/events/LocationSearchField.test.tsx`

**Interfaces:**
- Consumes: Mapbox `SearchBoxRetrieveResponse`, `publicEnv.mapboxAccessToken`.
- Produces: `normalizeSearchResult(response): NormalizedLocation | null` and `LocationSearchField({ value, onChange, error })`.

- [x] **Step 1: Write failing normalization tests from realistic fixtures**

Include fixtures for a valid San Francisco address, missing coordinates, non-US result, non-CA result, and a result without full postal context. The valid expected result is:

```ts
{
  mapboxFeatureId: 'dXJuOm1ieGFkcjo...',
  addressLine1: '1 Dr Carlton B Goodlett Place',
  addressLine2: '',
  city: 'San Francisco',
  region: 'CA',
  postalCode: '94102',
  countryCode: 'US',
  latitude: 37.7793,
  longitude: -122.4193,
}
```

- [x] **Step 2: Observe failure and implement the pure adapter**

Run: `pnpm test -- src/lib/mapbox/normalizeSearchResult.test.ts`

Expected: FAIL before the function exists. Implement it without React or form dependencies, return `null` for unverifiable results, and never accept typed freeform text as a verified location.

- [x] **Step 3: Write failing field behavior tests**

Mock `SearchBox`; assert `onRetrieve` calls `onChange(normalized)`, clear calls `onChange(null)`, invalid retrieval renders `Choose a verified California address`, and the current verified address is visible outside the third-party input.

- [x] **Step 4: Implement a controlled, lazy-loadable location field**

Use the official `SearchBox` component with `accessToken`, proximity centered near San Francisco, and `options` constrained to US address/POI results. The event editor will import this file with `lazy(() => import(...))` so Mapbox Search JS is fetched only when the location stage renders.

- [x] **Step 5: Verify and commit the adapter**

```bash
pnpm test -- src/lib/mapbox/normalizeSearchResult.test.ts src/features/events/LocationSearchField.test.tsx
pnpm typecheck
pnpm lint
git add src/lib/mapbox src/features/events/LocationSearchField.tsx src/features/events/LocationSearchField.test.tsx
git commit -m "feat: add verified event address search"
```

Expected: valid results normalize exactly and freeform/unsupported results cannot become publishable locations.

---

### Task 10: Build the Owned Event List and Three-Stage Saved-Draft Editor

**Files:**
- Create: `src/features/events/OrganizerEventsPage.tsx`
- Create: `src/features/events/OrganizerEventsPage.test.tsx`
- Create: `src/features/events/EventEditorPage.tsx`
- Create: `src/features/events/EventEditorPage.test.tsx`
- Create: `src/features/events/EventDetailsStep.tsx`
- Create: `src/features/events/EventScheduleLocationStep.tsx`
- Create: `src/features/events/EventReviewStep.tsx`
- Modify: `src/app/router/router.tsx`

**Interfaces:**
- Consumes: `useSession`, organizer guard, event query/mutation hooks, schemas, `LocationSearchField`, UI primitives.
- Produces: owned-event list, `/organizer/events/new`, `/organizer/events/:eventId/edit`, and the persisted draft lifecycle.

- [x] **Step 1: Write failing event-list state tests**

Cover loading, retryable error, empty state with `Create event`, draft/published status labels, and navigation to new/edit/detail routes. The list displays only title or `Untitled event`, status, start time when present, and last-updated time; no analytics or ticket counts.

- [x] **Step 2: Implement the smallest event list**

Read the organizer ID from authenticated session, invoke `useOwnedEvents`, and render `AsyncState` branches. Do not fetch organizer and events sequentially inside the page; the guard already owns organizer readiness.

- [x] **Step 3: Write failing editor tests for persistence semantics**

Cover:

```text
Details, Schedule & location, and Review are the only steps.
Step changes do not call saveEventDraft.
First Save draft inserts and replaces /new with /:eventId/edit.
Later Save draft updates the same ID.
Save errors retain all field values and expose Try saving again.
Reloaded edit route resets the form from the persisted row.
An unknown/RLS-hidden event renders Not found without ownership details.
Unsaved changes block internal navigation and beforeunload.
Paid may be selected as a visible foundation but Review says paid publishing is unavailable.
```

- [x] **Step 4: Implement one form owner and three presentational steps**

`EventEditorPage` owns `useForm<EventFormValues>`, active-step UI state, dirty navigation protection, load/reset, and save handler. Step components receive `register`, exact field errors, and controlled values/callbacks; they do not call APIs.

Derive current step validity and saved/unsaved labels during render. Do not mirror them into effect-managed state. Keep mutation calls in `handleSaveDraft`.

- [x] **Step 5: Lazy-load Mapbox only on the location step**

```tsx
const LocationSearchField = lazy(() => import('./LocationSearchField'))

<Suspense fallback={<p role="status">Loading address search…</p>}>
  <LocationSearchField value={location} onChange={setLocation} error={locationError} />
</Suspense>
```

Export `LocationSearchField` as default from its file for the analyzable dynamic import.

- [x] **Step 6: Implement route-safe first-save navigation**

After a successful first insert, call:

```ts
navigate(`/organizer/events/${saved.id}/edit`, { replace: true })
```

Then reset the form to saved values so `isDirty` becomes false. Later saves remain on the same URL. `Preview` first saves when dirty, then navigates only after persistence succeeds.

- [x] **Step 7: Verify and commit the draft workflow**

```bash
pnpm test -- src/features/events/OrganizerEventsPage.test.tsx src/features/events/EventEditorPage.test.tsx
pnpm typecheck
pnpm lint
pnpm build
git add src/features/events/OrganizerEventsPage.tsx src/features/events/OrganizerEventsPage.test.tsx src/features/events/EventEditorPage.tsx src/features/events/EventEditorPage.test.tsx src/features/events/EventDetailsStep.tsx src/features/events/EventScheduleLocationStep.tsx src/features/events/EventReviewStep.tsx src/app/router/router.tsx
git commit -m "feat: add saved event draft workflow"
```

Expected: tests prove persistence is explicit and reloading uses the stored row.

---

### Task 11: Add Persisted Preview, Immediate Publish, and Published Confirmation

**Files:**
- Create: `src/features/events/publishErrors.ts`
- Create: `src/features/events/publishErrors.test.ts`
- Create: `src/features/events/EventSummary.tsx`
- Create: `src/features/events/EventPreviewPage.tsx`
- Create: `src/features/events/EventPreviewPage.test.tsx`
- Create: `src/features/events/PublishedEventPage.tsx`
- Create: `src/features/events/PublishedEventPage.test.tsx`
- Modify: `src/app/router/router.tsx`

**Interfaces:**
- Consumes: persisted event query, organizer query, `eventPublishSchema`, `publishEvent`, event query keys.
- Produces: `/organizer/events/:eventId/preview`, `/organizer/events/:eventId`, consistent `EventSummary`, `getPublishErrorMessage(error): string`, and domain recovery copy.

- [x] **Step 1: Write failing stable error-copy tests**

Implement an exhaustive record:

```ts
export const publishErrorCopy: Record<PublishEventErrorCode, string> = {
  EVENT_NOT_FOUND: 'This event could not be found.',
  EVENT_NOT_OWNED: 'This event is not available to this organizer.',
  EVENT_INCOMPLETE: 'Complete every required event detail before publishing.',
  EVENT_TIME_INVALID: 'Choose a future start time and an end time after it.',
  EVENT_LOCATION_INVALID: 'Choose a verified California address.',
  EVENT_OUTSIDE_SERVICE_AREA: 'Choose a location inside the current Bay Area service area.',
  PAID_PUBLISHING_NOT_AVAILABLE: 'Paid event publishing is not available in this milestone. Choose Free to publish.',
  EVENT_MODERATION_BLOCKED: 'This event cannot be published in its current moderation state.',
}
```

Unknown infrastructure errors map to `Publishing failed. Try again.` and preserve the draft.

Implement `getPublishErrorMessage(error: unknown)` by checking whether a Supabase error's `message` is one of the eight `PublishEventErrorCode` values, then indexing `publishErrorCopy`; never cast an arbitrary message directly to the union.

- [x] **Step 2: Write failing persisted-preview tests**

Assert preview queries by route ID, displays title/organizer/date/time/timezone/category/free status/venue/exact address/description, renders the deliberate artwork placeholder, and does not use editor form context. Assert no map, ticket selector, RSVP, AI artwork, or animation picker exists.

- [x] **Step 3: Implement `EventSummary` and preview state handling**

`EventSummary` receives typed `event` and `organizer` props only. Fetch independent persisted event and organizer data concurrently through enabled TanStack queries when both IDs are known; do not issue duplicate Supabase calls from presentational components.

- [x] **Step 4: Write failing publish interaction tests**

Cover client-invalid draft disables Publish with field guidance, click calls RPC exactly once while pending, RPC error displays mapped recovery copy, success invalidates owned-list/detail queries and navigates to `/organizer/events/:eventId`, and a rapid double click does not create a second call.

- [x] **Step 5: Implement immediate publish in the click handler**

The handler must parse the persisted row with `eventPublishSchema`, call `publishEvent(event.id)`, update caches, and navigate only after the returned persisted row has `status === 'published'`. Do not add pending-review copy or an approval state.

- [x] **Step 6: Write and implement published confirmation states**

The page shows `Published`, the persisted `published_at`, and `This event is publicly available.` for a published event. Draft IDs redirect to edit; missing/RLS-hidden IDs show authorization-safe not found; blocked/removed owned events remain readable to the organizer and display their operational status without exposing an admin action.

- [x] **Step 7: Verify and commit preview/publish behavior**

```bash
pnpm test -- src/features/events/publishErrors.test.ts src/features/events/EventPreviewPage.test.tsx src/features/events/PublishedEventPage.test.tsx
pnpm typecheck
pnpm lint
pnpm build
git add src/features/events/publishErrors.ts src/features/events/publishErrors.test.ts src/features/events/EventSummary.tsx src/features/events/EventPreviewPage.tsx src/features/events/EventPreviewPage.test.tsx src/features/events/PublishedEventPage.tsx src/features/events/PublishedEventPage.test.tsx src/app/router/router.tsx
git commit -m "feat: preview and publish organizer events"
```

Expected: persisted preview and immediate-publish tests pass, with no queue language or out-of-scope controls.

---

### Task 12: Prove Public Visibility and Cross-Organizer Isolation Against Development Supabase

**Files:**
- Create: `tests/integration/public-event-visibility.test.ts`
- Create: `tests/integration/testEnv.ts`
- Modify: `package.json`
- Create: `Docs/testing/day1-organizer-event-verification.md`

**Interfaces:**
- Consumes: confirmed development URL/publishable key, disposable Organizer A/B credentials supplied through non-`VITE_` test-process variables, applied migrations.
- Produces: `pnpm test:integration` proof that the browser-accessible API enforces the milestone contract.

- [x] **Step 1: Define non-browser integration environment variables**

Use only the Node test process:

```text
TEST_SUPABASE_URL
TEST_SUPABASE_PUBLISHABLE_KEY
TEST_ORGANIZER_A_EMAIL
TEST_ORGANIZER_A_PASSWORD
TEST_ORGANIZER_B_EMAIL
TEST_ORGANIZER_B_PASSWORD
```

Add them to the runbook, never `.env.example`, because they are verification credentials rather than frontend configuration. Ensure `.env.test.local` remains ignored.

- [x] **Step 2: Write the failing anonymous visibility test**

Create three clients with `persistSession: false`: Organizer A, Organizer B, and anonymous. The test must:

```text
sign in A and B;
upsert each organizer's own profile;
insert A's valid unique future draft;
prove B cannot select or update A's draft;
prove anonymous cannot select A's draft;
publish through A's publish_event RPC;
prove anonymous immediately selects that exact ID;
retry publish and compare identical ID and published_at;
```

Use a title prefix containing a generated UUID for cleanup identification. Never use a service-role key in this test.

- [x] **Step 3: Observe failure, implement the test harness, and run against development**

Add `"test:integration": "vitest run tests/integration"` to scripts. Run:

```bash
pnpm test:integration
```

Expected: PASS only when migrations and RLS are correctly active in the confirmed development project. If signup confirmation prevents programmatic creation, provision the two disposable identities manually in the development Auth dashboard and keep their credentials outside Git.

- [x] **Step 4: Verify moderation with transactional linked pgTAP**

The runbook must use the already-authored database tests, not add an organizer-facing moderation feature:

```bash
pnpm supabase test db --linked supabase/tests/database/organizers_events_rls.test.sql supabase/tests/database/publish_event.test.sql
```

Expected: `flagged` is anonymously readable; `blocked` and `removed` are not; owner access remains. pgTAP rolls back its fixtures.

- [x] **Step 5: Document local Docker parity without blocking completion**

The runbook includes:

```bash
pnpm supabase start
pnpm supabase db reset
pnpm supabase test db
pnpm supabase stop
```

Mark these as pending with the observed Docker error if Docker remains unavailable; do not mark the authored tests as passing locally.

- [x] **Step 6: Verify and commit integration proof**

```bash
pnpm test:integration
pnpm typecheck
pnpm lint
git diff --check
git add package.json pnpm-lock.yaml tests/integration Docs/testing/day1-organizer-event-verification.md
git commit -m "test: verify public event visibility"
```

Expected: development integration proof passes without elevated browser credentials; the runbook states exactly which remote and local checks ran.

---

### Task 13: Verify the Full Organizer Journey and Visual Contract

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/organizer-publish.spec.ts`
- Create: `tests/e2e/organizer-publish.visual.spec.ts`
- Modify: `package.json`
- Modify: `Docs/testing/day1-organizer-event-verification.md`

**Interfaces:**
- Consumes: completed SPA, disposable development organizer credentials, Vite port 3000, approved visual references.
- Produces: repeatable functional/visual browser proof for mobile and desktop.

- [x] **Step 1: Configure Playwright for deterministic local execution**

```ts
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm dev', url: 'http://127.0.0.1:3000', reuseExistingServer: true },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
```

Install Chromium with `pnpm exec playwright install chromium`.

- [x] **Step 2: Write the functional E2E journey before fixing uncovered behavior**

The test signs in a disposable organizer, completes setup when absent, creates a unique event, saves, reloads the page, verifies values survived, previews, publishes, and sees `This event is publicly available.`. It also intercepts/observes the anonymous REST request or runs the integration assertion from Task 12 for the same event ID.

Use accessible role/label locators. Do not select by generated CSS classes.

- [ ] **Step 3: Run E2E and make only milestone-scoped corrections**

Run: `pnpm test:e2e -- tests/e2e/organizer-publish.spec.ts`

Expected: both mobile and desktop projects pass. If a failure reveals a product conflict, stop and surface it; do not expand scope.

- [ ] **Step 4: Add visual assertions for the approved organizer family**

Capture signup, organizer setup, event details, schedule/location, review, preview, and published confirmation. Inspect screenshots for typography, wrapping, overlap, horizontal overflow, focus visibility, step-rail accuracy, error placement, and one dominant CTA. Compare visual hierarchy to `Visual Reference /` without implementing map, ticket, flyer, analytics, or moderation features visible in references.

Run the installed `frontend-visual-qa` skill after the UI is rendered. Test 390x844 and 1440x1000 viewports plus reduced motion.

- [ ] **Step 5: Run the complete evidence gate**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:integration
pnpm test:e2e
pnpm supabase db lint --linked --level warning
pnpm supabase test db --linked
git diff --check
git status --short
```

Expected: all environment-available checks exit 0. Explicitly list local `supabase start/reset/test` as unrun if Docker is unavailable; that gap does not erase successful linked-development verification.

- [x] **Step 6: Scan scope and secrets before the final commit**

```bash
rg -n "sk_live_|sk_test_|service_role|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET|OPENAI_API_KEY|RESEND_API_KEY|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" . --hidden -g '!node_modules/**' -g '!.git/**'
rg -n "checkout|ticket tier|QR|AI flyer|analytics|approval queue|pending approval" src supabase/migrations
```

Expected: secret scan returns no credential values; scope scan returns no implemented out-of-scope feature or approval-queue state. Legitimate explanatory copy such as paid publishing unavailable is reviewed manually.

- [x] **Step 7: Commit final browser verification**

```bash
git add playwright.config.ts tests/e2e package.json pnpm-lock.yaml Docs/testing/day1-organizer-event-verification.md
git commit -m "test: prove organizer publish journey"
```

- [x] **Step 8: Prepare the completion report without pushing unless authorized**

Report:

```text
What changed
Files and migrations added
Exact checks run and pass/fail counts
Linked development project verification performed
Local Docker verification run or explicitly pending
Immediate anonymous visibility evidence
Remaining risks or manual setup
Git status and commit hashes
```

Do not claim the milestone complete unless the database/RLS, functional browser journey, anonymous visibility, build, typecheck, lint, unit/component tests, and available visual checks have fresh passing evidence.
