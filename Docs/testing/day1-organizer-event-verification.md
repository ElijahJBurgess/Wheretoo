# Day 1 Organizer Event Publishing Verification

## Current integration runner

Run `pnpm test:integration:ticketing-db` against the confirmed linked development
project to provision disposable organizer credentials and run this API proof alongside
the ticketing boundary/concurrency suites. Its guarded cleanup captures exact fixture IDs
and restores the checkout switch. The standalone suite still requires the variables below.

The current proof expects a new draft to be `not_evaluated`, submits the approved
requirements/policy acceptance before publishing, and reads the anonymous
`get_public_event` projection. Anonymous base-table access is denied. The historical
Day 1 results below predate that moderation/public-projection contract.

## Verification target

The linked development target was positively identified on 2026-08-24 before test-data
creation. Reconfirm it read-only before every future hosted run:

```bash
pnpm supabase projects list --output json
pnpm supabase migration list --linked
```

Stop unless exactly the intended development project is marked `linked: true`, its status is
`ACTIVE_HEALTHY`, the operator has independently confirmed it is not production, and local
and remote migration versions are fully aligned. At the recorded run, the three expected Day
1 migrations through `20260824010200` were aligned.

No hosted reset was run. This runbook is for the confirmed development project, not a
production project.

## Browser-API integration proof

The integration suite uses exactly three `createClient<Database>` instances: Organizer A,
Organizer B, and anonymous. All disable session persistence and token refresh. They use only
the project's `sb_publishable_` key; the harness rejects any other key shape, and a secret or
service-role key must never be supplied.

Provide these values only to the Node test process:

```text
TEST_SUPABASE_URL
TEST_SUPABASE_PUBLISHABLE_KEY
TEST_ORGANIZER_A_EMAIL
TEST_ORGANIZER_A_PASSWORD
TEST_ORGANIZER_B_EMAIL
TEST_ORGANIZER_B_PASSWORD
```

Do not add these variables to `.env.example`. If a local environment file is needed,
`.env.test.local` is already covered by the repository's `.env.*` ignore rule, but the test
runner does not load it automatically. A shell with externally supplied disposable
credentials can rerun the proof with:

```bash
TEST_SUPABASE_URL="$TEST_SUPABASE_URL" \
TEST_SUPABASE_PUBLISHABLE_KEY="$TEST_SUPABASE_PUBLISHABLE_KEY" \
TEST_ORGANIZER_A_EMAIL="$TEST_ORGANIZER_A_EMAIL" \
TEST_ORGANIZER_A_PASSWORD="$TEST_ORGANIZER_A_PASSWORD" \
TEST_ORGANIZER_B_EMAIL="$TEST_ORGANIZER_B_EMAIL" \
TEST_ORGANIZER_B_PASSWORD="$TEST_ORGANIZER_B_PASSWORD" \
pnpm test:integration
```

When any required variable is absent, `pnpm test:integration` fails before collection and
lists the missing names. It never skips or reports a false pass. Normal `pnpm test` excludes
`tests/integration`, so unit/component verification does not require hosted credentials.

The test signs in two disposable users, creates or updates each user's own organizer profile
with privilege-compatible insert/update operations, and inserts Organizer A's draft through
the browser grants. It then proves:

- Organizer B receives an RLS-empty select and an empty update result for A's draft;
- a follow-up A read proves B did not mutate the row;
- anonymous cannot read the draft;
- A publishes through `publish_event`;
- anonymous immediately reads the exact persisted public row; and
- a retry returns the same event ID and the exact first `published_at` value.

Each event title begins with `WHERETO_DAY1_INTEGRATION_` and contains a UUID. Future event
times are derived as UTC instants seven days from execution, avoiding process-zone and DST
wall-clock ambiguity. The product form still follows the separate binding contract that
`datetime-local` values are Los Angeles wall-clock minutes converted through the shared UTC
adapter.

The test uses independent clients and does not share TanStack Query state. In the application,
private detail cache keys remain owner-aware as `eventKeys.detail(organizerId, eventId)`; this
integration proof does not weaken or substitute for that account-switch isolation rule.

Fresh Auth sessions are probed against the Data API before fixture writes. The harness retries
only the hosted `JWT issued at future` response for at most 20 seconds and fails immediately for
every other response. This replaces a fixed five-second delay, which a later verification run
proved could still race temporary hosted clock skew.

Disposable users may be created through public `signUp` using generated passwords held only
in the shell process. If project signup limits prevent that path, create exactly two confirmed
disposable users through the dashboard-equivalent official Admin API outside the test process.
An elevated credential may exist only in that provisioning/cleanup shell; never pass it to
Vitest, store it, print it, or commit it. Do not change project Auth settings.

Before cleanup, resolve the exact generated identities. Then, through the elevated linked
management/database path, delete only their events, their organizer rows, and finally those
exact Auth users. Never use a wildcard or service-role key in the test.

### Current hosted result

The latest review-fix rerun passed against the confirmed development project: 3 files / 7 tests.
The project's public email signup limit blocked creation of the pair, so the run provisioned
exactly two confirmed disposable users through the official Admin API outside Vitest. The
admin key was fetched into an unprinted shell variable and was never passed to the tests; the
tests received only the publishable key and disposable user credentials.

An earlier real attempt exposed a brief hosted clock skew: one newly issued token was rejected
as `JWT issued at future`. A fixed five-second post-sign-in delay was subsequently proven
insufficient. The current harness instead uses the bounded exact-match readiness probe described
above; the application organizer query independently applies the same narrow retry to the actual
browser session.

Before cleanup, the trap resolved only the two exact user IDs. A post-clean query returned zero
remaining Auth, organizer, and event rows for those IDs. No Auth setting changed and no
credential or disposable identifier was stored, printed, or committed.

## Linked database authorization and moderation proof

The exact linked pgTAP command was attempted:

```bash
pnpm supabase test db --linked \
  supabase/tests/database/organizers_events_rls.test.sql \
  supabase/tests/database/publish_event.test.sql
```

Supabase CLI `2.115.0` connected to the linked project but failed before pg-prove because its
linked runner still requires Docker:

```text
LegacyDockerRunError: failed to run docker. Docker Desktop is a prerequisite for local development.
```

The two unchanged SQL files were therefore executed sequentially through the authenticated
linked database query path. The RLS file reached `ok 31`; the publish file reached `ok 23`;
neither `finish()` emitted a failure row. Their transactions rolled back. A follow-up query
confirmed both `pgtap_persisted = false` and `fixture_user_persisted = false`.

These assertions include moderation behavior: anonymous can read `flagged`, cannot read
`blocked` or `removed`, and the owner retains visibility. This is database verification only;
it does not add organizer-facing moderation controls.

Additional linked checks:

```bash
pnpm supabase db lint --linked --schema public --level warning --fail-on error
pnpm supabase migration list --linked
```

The lint completed with no schema errors, and migration history remained aligned through
`20260824010200`.

## Local Docker parity

Run the full local sequence when Docker or Podman is installed:

```bash
pnpm supabase start
pnpm supabase db reset
pnpm supabase test db
pnpm supabase stop
```

Local parity is pending. On 2026-08-24, `docker` and `podman` were absent from `PATH`, and
`pnpm supabase start` failed with `LegacyDockerLifecycleInspectError` stating that Docker was
not found (Podman also not found). The linked CLI pgTAP attempt independently failed with the
Docker prerequisite error above. Do not record the database tests as locally passing until
this sequence succeeds.

## Application verification commands

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

`pnpm typecheck` checks both the application build graph and the Node integration test source.

## Playwright organizer journey

The browser harness uses the same six `TEST_*` variables as the integration suite plus one
client-safe map search value:

```text
VITE_MAPBOX_ACCESS_TOKEN
```

`playwright.config.ts` maps Organizer A to `mobile-chromium` (Pixel 7 emulation at 390×844)
and Organizer B to `desktop-chromium` (1440×1000). Both projects emulate reduced motion, run
serially against a fresh local Vite server at `http://127.0.0.1:3000`, and pass only the
publishable Supabase key and public Mapbox token to Vite. Chromium may be installed with:

```bash
pnpm exec playwright install chromium
```

Then run:

```bash
pnpm test:e2e
```

The functional spec signs in, completes organizer setup, saves a uniquely titled draft,
verifies route replacement and reload persistence, retrieves a real address through Mapbox
SearchBox, reviews, previews persisted data, sends exactly one publish request, confirms the
public-copy result, and reads the exact published event anonymously. The visual spec captures
signup, setup, details, schedule, review, preview, and published states into Playwright's ignored
test output for both viewports; raw screenshots and credentials must never be committed.

The per-test timeout is 90 seconds so the browser journey remains above its bounded hosted
readiness work. The organizer query itself retries only an exact `JWT issued at future` error,
once per second for at most 20 failures; this retry runs through the actual browser Supabase
session, while all other organizer-query failures remain immediately actionable. Playwright
traces, video, and automatic failure screenshots are disabled so entered auth values cannot be
retained. Explicit visual screenshots are written only by the visual spec to ignored test output.
Recorded request failures replace hosted origins with an opaque SHA-256-derived label and redact
query values/fragments before they enter an assertion message.

If any required value is absent, configuration fails before browser launch and lists the missing
variable names. Do not use a dummy Mapbox token, bypass verified location selection, or pass a
service-role/secret key to Playwright or Vite. Provisioning and cleanup of exactly two disposable
Auth users, their organizer rows, and their events remains an out-of-band administrator action.

### Current browser-verification status

On 2026-08-24, the canonical credentialed Playwright run passed all four cases in 27 seconds:
the functional and visual specs both passed under mobile Chromium at 390×844 and desktop
Chromium at 1440×1000. The journey used the real Mapbox SearchBox suggestion and retrieval flow,
saved and reloaded a persisted draft, previewed the stored row, published exactly once, and read
the published event anonymously. Exact disposable cleanup returned zero events, organizers, and
Auth users.

The run captured and manually inspected 14 ignored screenshots covering signup, organizer setup,
event details, schedule/location, review, persisted preview, and published confirmation in both
viewports with reduced motion. No horizontal overflow, clipped content, overlapping controls,
missing focus indication, undersized tested form/button targets, or unresolved accessibility-smoke
failure remained. The approved organizer-reference relationships were present: light contained
surfaces, deep-ink hierarchy, violet progress/actions, clear three-stage progression, compact form
rhythm, and one dominant action. Consumer map, ticketing, flyer, analytics, and moderation features
visible in future-facing references remained deliberately absent.

The real run exposed and closed only milestone-scoped issues: keyboard focus evidence now uses
actual tab navigation, mobile editor actions stack without overlap, long organizer-entered titles
wrap without expanding or clipping preview columns, and the request-failure collector ignores only
Mapbox's exact aborted `/events/v2` telemetry request while retaining all product/search failures.
No raw screenshot, disposable credential, environment value, or hosted identifier is tracked.
