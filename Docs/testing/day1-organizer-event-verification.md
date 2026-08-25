# Day 1 Organizer Event Publishing Verification

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

Disposable users may be created through public `signUp` using generated passwords held only
in the shell process. If project signup limits prevent that path, create exactly two confirmed
disposable users through the dashboard-equivalent official Admin API outside the test process.
An elevated credential may exist only in that provisioning/cleanup shell; never pass it to
Vitest, store it, print it, or commit it. Do not change project Auth settings.

Before cleanup, resolve the exact generated identities. Then, through the elevated linked
management/database path, delete only their events, their organizer rows, and finally those
exact Auth users. Never use a wildcard or service-role key in the test.

### Current hosted result

`pnpm test:integration` passed against the confirmed development project: 1 file / 1 test. The
project's public email signup limit blocked creation of the pair, so the final run provisioned
exactly two confirmed disposable users through the official Admin API outside Vitest. The
admin key was fetched into an unprinted shell variable and was never passed to the test; the
test received only the publishable key and disposable user credentials.

The first real attempt exposed a brief hosted clock skew: one newly issued token was rejected
as `JWT issued at future`. After confirming the database/API/local clocks differed by only a
few seconds, the harness added a five-second post-sign-in buffer. The next run passed the full
flow in 7.49 seconds.

Before cleanup, the trap resolved only the two exact user IDs. It removed 1 event, 2 organizer
rows, and 2 Auth users. A post-clean query returned zero remaining Auth, organizer, and event
rows for those IDs. No Auth setting changed and no credential or disposable identifier was
stored, printed, or committed.

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
