# Spec 14 — local manual walkthrough

> **Source-freeze checkpoint:** This source document records the pre-terminal verification state. The delivered detached handoff report and `handoff/evidence-index.json` carry subsequent build/export, Payments rerun and terminal-journey results with their actual identities. Those later results supersede pending checkpoint statuses here. Keeping results detached avoids changing the source bytes that those executions verify.

**Working instructions: the final command and J01–J08 runtime verification is still in progress.** Do not treat the walkthrough below as completed evidence. Auth cross-tab readiness remains blocked by the dependency decision recorded in the gap register.

## Local target and boundaries

Application entry: `http://127.0.0.1:3040/discover`.

The task app/edge/bridge servers are running after the approved schedule correction, local verification and guarded restart. Containers, database records and both inbox histories were preserved. The commands below are the verified lifecycle recipe; the connected walkthrough is not yet accepted.

Run all commands from the approved `wheretoo-v1-final` checkout. Do not run inherited database scripts that target a linked project or `pnpm db:types`; the latter uses `--linked`. Before database access, the task runner verifies its recorded root, resource IDs, image, internal network, database marker, and disabled cron state. It refuses resources it does not own instead of replacing them.

- App and real API entry: port 3040.
- Real 22-handler gateway: port 55647.
- Local Auth inbox: `http://127.0.0.1:55649`; it contains only this task's confirmation, email-change, and reauthentication messages.
- Transactional ticket inbox: private provider-state capture and manual-browser controls, separate from Auth SMTP. No real delivery occurs.
- Internal DB/REST/Auth/inbox containers have no exposed host backend ports. Guarded loopback bridges use only recorded task resources.
- Stripe Checkout and Connect, address lookup, transactional email, and contextual moderation use local provider-boundary simulations. Use the task's controlled manual browser to prevent unapproved external requests.

## Local prerequisites

The migration runner now accepts the exact121-file historical inventory plus the two separately approved forward files in `Docs/testing/spec14-approved-forward-migrations.json`. It rejects unlisted or changed files and mismatched applied prefixes. Ordinary start does not run migrations.

The verified runtime uses Node22.15.0, pnpm11.19.0, Python3 and Docker. The lockfile and selected image versions are fixed in the runner and service inventory. This checkout already has its isolated dependencies and recorded task resources. The clean-export check uses a fresh offline frozen install from the reviewed pnpm store; that result remains pending until final source freeze. A new machine needs the same runtime, lockfile packages and container images made available before those offline commands can succeed. No sibling dependency directory or linked Supabase environment is a prerequisite.

## Role-specific manual browsers

The launcher accepts only four named roles. Each role uses its own private task profile and active-process record, while all four use the same preserved local database and provider boundary.

```sh
python3 tests/integration/spec14-local.py verify-running
node tests/e2e/spec14-manual.cjs launch organizer
python3 tests/integration/spec14-local.py verify-running
node tests/e2e/spec14-manual.cjs launch paid-buyer
python3 tests/integration/spec14-local.py verify-running
node tests/e2e/spec14-manual.cjs launch free-buyer
python3 tests/integration/spec14-local.py verify-running
node tests/e2e/spec14-manual.cjs launch staff
```

`organizer` is the default when the role is omitted. The staff application tab starts at the protected `/moderation` route; the other initial routes remain organizer events or discovery. The staff profile supplies no role, account, login or fixture. Sign in manually only with the separately authorized local staff account. Each launcher opens the application, the separate Auth inbox, and the transactional ticket inbox in separate tabs. The ticket inbox keeps provider control and private destination lookup in Node; it does not place the worker secret in a page or log.

Each exact ordinary launch command has now reached ready and exited cleanly after its own browser was closed. The dedicated profile remained; the active record was removed. Provider state was byte-identical before/after all four roles. This is launcher lifecycle proof, not completed J01–J08 walkthrough evidence. Keep a buyer window open while checkout is unresolved. The profile preserves cookies and local storage, but a normal browser exit does not guarantee preservation of session-storage retry proof. Use the original inbox and application recovery paths rather than starting a replacement payment.

The smoke action uses the same headed browser setup and provider fence, but it is deliberately read-only and short-lived:

```sh
node tests/e2e/spec14-manual.cjs smoke organizer
node tests/e2e/spec14-manual.cjs smoke paid-buyer
node tests/e2e/spec14-manual.cjs smoke free-buyer
node tests/e2e/spec14-manual.cjs smoke staff
```

All four guarded headed smoke commands have completed with exit 0 against the recorded build. The post-guard logs are `manual-smoke-postguard-<role>.log`; each corresponding role proof records `applicationIdentityMatches=true`, `providerStateUnchanged=true`, all three tabs present and zero blocked requests. Each smoke verifies the real application, Auth inbox, ticket inbox, and served task identity. It compares provider state before and after, records only redacted facts in the private task evidence directory, and removes its own browser context and smoke profile. A smoke signs in no account and exercises no journey action. It establishes launcher readiness only; it does not establish any J01–J08 outcome or replace the interactive walkthrough.

Ordinary lifecycle evidence: `manual-launch-lifecycle-summary.json` and `manual-launch-lifecycle-<role>.json`, bound to source `2d4edf38…` / assets `e6246e51…`. Earlier organizer transient and external PID-filter failures remain retained separately. The main browser PID was verified against the exact role profile and launcher ancestry before closing it; no unrelated browser was signalled.

## Explicit lifecycle

These commands never stage or commit source. `create` requires the pinned local Docker images documented in `spec14-local.py`; it uses `--pull never`. Dependencies install from the lockfile. Do not substitute another spec's containers or linked configuration if a prerequisite is unavailable.

```sh
pnpm install --offline --frozen-lockfile
python3 tests/integration/spec14-local.py create
python3 tests/integration/spec14-local.py migrate
python3 tests/integration/spec14-local.py prepare-scenarios
python3 tests/integration/spec14-local.py typegen
python3 tests/integration/spec14-local.py build
python3 tests/integration/spec14-local.py start
python3 tests/integration/spec14-local.py verify
python3 tests/integration/spec14-local.py verify-running
curl --fail --silent http://127.0.0.1:3040/__spec14/identity
```

For an already recorded environment, begin with `verify`; ordinary `start`/`stop` preserve database and inbox history. `migrate` also preserves data when all recorded hashes are already applied. `prepare-scenarios` is a separate explicit command: it enables only the approved synthetic local checkout/email profile and development policy pair; it creates no organizer, event, order, registration or ticket.

```sh
python3 tests/integration/spec14-local.py verify
python3 tests/integration/spec14-local.py stop
python3 tests/integration/spec14-local.py start
python3 tests/integration/spec14-local.py verify-running
```

`stop` verifies recorded process commands and refuses completion if any task server port still listens. It retains the containers, database, and inbox. It does not stop another spec's resources. `start` is one attempt; it does not silently replace a running or partial process set. If it fails, do not retry until you have inspected the newest private `.superpowers/spec14/runner-error-*-start.log`, the recorded process file, and listeners on ports 3040, 55647, and 55649. Each failure has its own timestamped mode-0600 record, so a later `verify-running` failure cannot erase the start detail. After confirming there is no partial task process or listener, repeat the exact `start` then `verify-running` pair. The cause of the one observed pre-registry transient remains unproven; no bind retry is built into the runner.

## Task-only provider and worker control

The guarded control CLI runs the task runner's read-only `verify-running` action before it calls the existing local control gateway. That action verifies every recorded container and the database instance/cron marker, matches the live commands for the exact recorded bridge, edge and app PIDs, and compares the served `/__spec14/identity` task, instance, source, assets and index with the local task/build records. Any stale or replaced resource stops before the control call. CLI output contains only allowlisted modes, worker status/disposition and message/request counts. It never prints provider identifiers, email payloads, moderation request bodies or the control secret.

Read the current local moderation/email modes and safe counts:

```sh
node tests/e2e/spec14-control.cjs state
```

The local moderation provider defaults to `review`. Preserve that default when creating the first held event, invoke the worker explicitly, then use the separately authorized staff profile to review the resulting case through the real protected UI:

```sh
node tests/e2e/spec14-control.cjs moderation-mode review
node tests/e2e/spec14-control.cjs run-worker moderation
node tests/e2e/spec14-manual.cjs launch staff
```

The launcher does not seed or authenticate the staff account. The worker command is bounded and executes the real `moderate-event-queue` handler; run it only when the walkthrough calls for processing the current queue.

When a specific local journey requires the synthetic moderator to approve an eligible event automatically, make that change explicit, run the worker, and restore the review default:

```sh
node tests/e2e/spec14-control.cjs moderation-mode approve
node tests/e2e/spec14-control.cjs run-worker moderation
node tests/e2e/spec14-control.cjs moderation-mode review
node tests/e2e/spec14-control.cjs state
```

The remaining moderation failure mode is also explicit:

```sh
node tests/e2e/spec14-control.cjs moderation-mode failed
node tests/e2e/spec14-control.cjs run-worker moderation
node tests/e2e/spec14-control.cjs moderation-mode review
node tests/e2e/spec14-control.cjs state
```

Email transport modes and the bounded email worker use the same closed command surface:

```sh
node tests/e2e/spec14-control.cjs email-mode accepted
node tests/e2e/spec14-control.cjs run-worker email

node tests/e2e/spec14-control.cjs email-mode failed
node tests/e2e/spec14-control.cjs run-worker email

node tests/e2e/spec14-control.cjs email-mode unknown
node tests/e2e/spec14-control.cjs run-worker email
node tests/e2e/spec14-control.cjs email-mode accepted
node tests/e2e/spec14-control.cjs state
```

Set the mode before the source queues its delivery, invoke the worker only at the named J04/J05/J06 step, and return to `accepted` after every failure/unknown control, even when the worker command itself exits nonzero. Use `state` to confirm the restored mode and safe queue counts before transferring runtime ownership. Apply the same restore-and-state pattern to moderation, returning it to the documented `review` default. A mode change updates only the task's local provider simulation. A worker invocation processes real task queues, so neither action occurs automatically on launcher start, page mount, or CLI inspection.

### Destructive task-data reset — explicit, never automatic

Only after deliberately deciding to discard this task's application/Auth dataset:

1. Preserve needed private evidence and note the history boundary.
2. Stop the task's recorded servers.
3. Read `instanceId` using `verify`.
4. Supply that exact ID to the reset command. A wrong ID or active process registry refuses the write.

```sh
python3 tests/integration/spec14-local.py reset --confirm-instance <exact-ID-from-verify>
python3 tests/integration/spec14-local.py migrate
python3 tests/integration/spec14-local.py prepare-scenarios
python3 tests/integration/spec14-local.py build
python3 tests/integration/spec14-local.py start
```

Reset drops only the recorded task application's public/private schemas and local Auth users, replays nothing automatically, and retains the Auth inbox history. Old inbox links may be invalid after a deliberate reset. Never treat a reset as an uncertainty-recovery action.

## Accounts and private data

Create synthetic organizer accounts through the real app using unique addresses under `spec14.test` and a unique test-only password. Confirm through the local Auth inbox. Do not reuse personal passwords or real recipient addresses.

Keep organizer and guest contexts separate. The automated harness records its principal identities and original guest proofs privately in `.superpowers/spec14/scenario.json`; actual passwords, collection links, and grant tokens are not published here. Opening the app or restarting servers must not recreate those identities. To inspect the retained automated accounts locally, open that private file in your editor: the principal login uses `organizerEmail` and `organizerPassword`; the separate staff login uses `results.staffFixture.email` and `results.staffFixture.password`. These are synthetic task accounts. Use only the confirmed current fields; pending Settings markers are not proof of a completed account change. Do not copy this file into an issue, commit or shared handoff. New manual journeys should use a fresh synthetic account/event through the UI, keeping the automated evidence dataset intact.

Use deliberately separate datasets for terminal controls: the main paid order, main free registration, paid event-change/cancellation sources, and free cancellation source. Each event is created and published through its real UI and writers. Never directly mark a principal event public or insert successful ticket rows.

## Ordered walkthrough

### J01 — Organizer to discovery

1. Open **Organize**, create a synthetic account, confirm through the Auth inbox, and save the organizer profile.
2. Defer Stripe setup and compose a paid draft: Basics → Date/Location → Paid → two tiers → Requirements/Agreement → persisted Preview.
3. Use the same-event Payments action. Complete simulated Connect setup, return to the same draft and verify that the event and tier IDs are unchanged.
4. Open the publish confirmation and publish explicitly. Process eligibility through the real moderation worker with its simulated provider.
5. In a separate anonymous context, find the same event in discovery. Compare saved title, schedule, venue, category and admission type. Draft/review-held/rejected/cancelled/ended controls must be absent.

Draft and free composition remain available without payment setup. Paid publication retains canonical readiness checks.

### J02 — Paid buyer to the door

1. Discover the J01 event, select **2 GA + 1 VIP**, enter buyer details and follow the simulated hosted checkout.
2. Complete the provider simulation. The real signed webhook must establish payment and issue exactly three stable tickets for one order with two item rows.
3. Open the original confirmation, collection and focused QR views.
4. In the organizer context, find that order and deliberately select ticket **2 of 3**. Admit it once; then attempt the same QR/manual duplicate.
5. Verify that ticket 2 is Used, tickets 1 and 3 are unchanged, and the duplicate preserves the original Used timestamp.

### J03 — Free RSVP to the door

1. Create and publish a separate free event through the UI. Discover it anonymously and register one name/email for three admissions.
2. Open the original `rsvp_` collection and each focused ticket.
3. Use the free organizer dashboard, guest search and registration detail to select ticket **2 of 3** explicitly.
4. Admit manually, then scan the duplicate. A separate documented registration covers QR-first/manual-duplicate order.
5. Verify one registration, exactly three tickets, unchanged tickets 1 and 3, stable Used time, and no paid reader/order/tier/Stripe/refund behavior.

Capacity checks cover finite/unlimited capacity, last-place contention, group shortage, full capacity, retries and competing tabs. Check-in does not release free capacity.

### J04 — Delivery, resend and recovery

1. Inspect the durable initial intents for the same paid/free sources. Merely opening their pages must not send.
2. Invoke the task email worker explicitly and inspect the separate transactional inbox.
3. Resend to the stored recipient. Exercise accepted, failed and unknown transport states without changing ticket/payment facts.
4. Request public recovery and confirm the neutral response. Open the captured access link in a fresh guest context and verify scoped Used/Valid membership.
5. Exercise separate expired-grant metadata and canonical grant revocation controls, plus wrong-purpose access. These controls create no replacement source or ticket.

### J05 — Whole-order refund with history

1. Open the original paid order after one admission. Cancel the refund dialog and verify zero mutation.
2. Confirm one whole-order refund using the order's actual stored totals. Keep the same operation during processing, unknown and reload/reconciliation states.
3. Accept Refunded only after canonical full reconciliation. Verify **Used / Refunded / Refunded**, unchanged ticket IDs and credential hashes, and the original Used time.
4. Attempt old unused QR admission; it must fail server-side.
5. Open the original buyer collection and refund-purpose financial link. A notice failure must not replay the refund. Separate controls cover failure/anomaly and inventory/history rules.

### J06 — Changes and cancellation

1. Use dedicated UI-created paid/free events and sources so terminal actions do not invalidate other journeys. Create two paid orders for one recipient.
2. Change schedule/venue through the current version-aware writer. Distinguish saved facts from previously/currently public facts.
3. Publish deliberately and submit the permitted exact-revision notice. Two orders remain two source messages despite one recipient.
4. Cancel paid and free events separately. Drop one completed cancellation reply and reconcile the same event before any retry.
5. Verify withdrawal from discovery/new sales, denial of unused admission, and preserved Used history. Refunds and notices remain separate operations.

### J07 — Settings and identity

1. Navigate management → Settings → private profile preview and back. Keep account name separate from public organizer name; preserve hidden fields and revisions.
2. Read fresh Payments status. Ordinary mount must not create a Connect account. Exercise same-event setup/management return.
3. Change synthetic account email through both required Auth inbox confirmations; test password mismatch, real password update and reauthentication where requested.
4. Verify configured/unavailable support, legal and closure actions truthfully. Mail compose is not submission.
5. Sign out while retaining independent guest access. The full shared-origin cross-tab Auth claim remains blocked until B1's approved repair passes.

### J08 — Failure and recovery

1. Exercise controlled response loss, timeout, offline and server-error boundaries for checkout, RSVP, admission, refund, notice and cancellation.
2. Preserve each original identity and use its domain's approved status/recovery action. Do not start a replacement transaction to clear uncertainty.
3. Test malformed or deep links, lazy-load or startup failure, missing or corrupt retained proof, expired grants, pagination failure, and stale refresh.
4. Verify that unrelated metric/email failures do not erase ADMITTED or a successful purchase.
5. Record the complete-proof-loss limit honestly: a fresh browser cannot recover private payment proof that no longer exists.

The automated browser matrix is in `tests/e2e/spec14.spec.ts`. Its retries resume the private ledger and never reset data. J01/J02/J03/J04 connected cores and J02a/J03a/J07a have passed locally; remaining cases are tracked individually in the verification record. Four smokes and four ordinary launch lifecycles were actually run; a launch does not establish the interactive walkthrough.

## Verification commands

```sh
python3 -m unittest discover -s tests/integration -p 'spec14_*test.py'
pnpm typecheck
pnpm lint
VITE_SUPABASE_URL=https://spec14-disabled.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_spec14_disabled VITE_MAPBOX_ACCESS_TOKEN=pk.spec14_disabled VITE_STRIPE_PUBLISHABLE_KEY=pk_test_spec14_disabled pnpm test
pnpm test:functions
pnpm typecheck:functions
```

Browser cases require an explicit selected `--grep` case in the [browser execution sequence](spec14-browser-sequence.md). Its 31 scheduled prefixes were checked against all32 collected cases; each selects exactly one case. Collection is not execution proof. The stopped J08g contract-failure case is excluded from ordinary replay. Do not invoke the entire file without selection: refunds and cancellation are terminal, while later-declared tests still require active sources. The automated principal ledger must be resumed, never reset to make a later test pass.

The [verification record](spec14-final-assembly-verification.md) records actual command results without combining overlapping counts. The full frontend command still exits1 on the unresolved B1 Auth errors. The two original SQL metadata expectation failures and the separate current-contract replacement remain distinct. Database negative fixtures and concurrency tests were performed in the documented pre-principal phase, not by resetting the current walkthrough history.

The SQL/concurrency runner requires explicit selected filenames from `Docs/testing/spec14-regression-selection.json`; no old mutating launcher is safe merely because it is present. The final evidence index records each selected suite, failed/skipped reason and applicable replacement. Do not run negative DB fixtures against the principal walkthrough dataset without the documented phase separation.

### Source freeze and clean export

The actual clean export is still pending. Its prerequisite is a reviewed path catalog and a build bound to those same source bytes. Finish source/docs and close every browser/worker interval before this sequence; changing a source file afterward requires another catalog review and build/export check.

```sh
python3 tests/integration/spec14-local.py verify
python3 tests/integration/spec14-local.py stop
python3 tests/integration/spec14-artifacts.py catalog
python3 tests/integration/spec14-artifacts.py source
```

Review `Docs/testing/spec14-source-paths.json` and the generated private `source-manifest.json` / `source-identity.json` in `.superpowers/spec14/`: present files, intentional deletions, modes, links and changes from resolved Spec13. Check the source allowlist and absence of dependencies, build output, local configuration, private evidence and sibling worktrees. Catalog generation is not review, Git staging or deployment approval.

After that review:

```sh
python3 tests/integration/spec14-local.py build
python3 tests/integration/spec14-artifacts.py export
python3 tests/integration/spec14-local.py start
python3 tests/integration/spec14-local.py verify-running
node tests/e2e/spec14-production.cjs
```

The exporter creates a new directory outside the checkout, verifies copied source identity, performs a fresh offline frozen install with isolated configuration, rebuilds, and compares every output file and mode with the task build. Its latest-attempt result must say passed; a preserved result from an older attempt is insufficient. The final production check then verifies the actual served bytes. These commands preserve task data. If a stage fails, retain its evidence and resolve that stage before proceeding; no reset, dependency upgrade or hosted fallback is implied.
