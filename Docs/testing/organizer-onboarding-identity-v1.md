# Organizer onboarding + identity V1 — Build + Prove

## Current proof closure (2026-09-24 local / 2026-09-25 UTC)

The founder-approved implementation is unchanged during infrastructure recovery. The four previously blocked local integration gates have passed. All requested app checks and the fresh independent whole-branch review also passed. Ready to commit/review for merge; no commit or release action was performed.

1. **Status:** **PASS**, with the verified inherited SQL exceptions documented below. No feature-only regression was found.
2. **Fresh local projects:** `wheretoo-organizer-profile-proof2` (API 59321, DB 59322, shadow 59320, reserved Studio/mail/analytics/pooler 59323/59324/59327/59329) and `wheretoo-organizer-profile-main2` (59421, 59422, 59420, 59423/59424/59427/59429). Both ranges were checked unused before creation. Both stacks initialized successfully after Docker recovered externally. Proof2 serves existing media functions with local APP_BASE_URL `http://127.0.0.1:3085`; real-browser proof uses Vite 3085. The ordinary browser fixture suite uses Vite 3084. Optional services were excluded/disabled where supported. Cron jobs are inactive and server-level `cron.launch_active_jobs=off` on both new databases.
3. **Old unhealthy stack touched:** no mutations in the fresh-isolation/resume attempts. Its status appeared only in read-only container inventories. No reset/restart/stop/use of its API or DB. No unrelated project/worktree mutation and no global Docker restart/prune.
4. **Migration forward/replay: PASS.** Pristine current main is `b45b83e17793b9069d4f35d04dadd561e17c9594`, checked against remote main again. Proof2 first initialized that schema, loaded eight synthetic organizer cases, then applied `20260924010900_consolidate_organizer_setup.sql`. Full JSON snapshots of organizer rows, private media, Storage objects and buckets were identical before/after. Fixtures cover incomplete/partial/complete profiles, complete without handle, permanent claimed handles, logo/no-logo, and existing storefront cover/accent/links/merch/store URL. Then only proof2 was reset and the full feature migration chain replayed from empty successfully. Migration ledgers differ from main2 by exactly `20260924010900`. No down migration. The existing local platform-default-grant bootstrap was applied identically to both stacks.
5. **Real Storage: PASS.** Actual local Auth, media Edge function, Storage, PostgREST and database were used. The combined live harness passed 43 checks: owner upload/attachment/download; foreign attachment/preview denial; anonymous/origin denial; MIME/forged bytes/5 MiB limit; rejected nonexistent references without partial saves; same-owner failed replacement then successful retry; replacement persistence; unchanged handle/completion; unused/replaced cleanup preserving attached and foreign-owned media; unchanged bucket definitions and owner-prefixed paths. A real Chromium test forwarded an upload to actual Storage, delayed only delivery of its successful response, invoked the application's actual Supabase client sign-out against local Auth, and verified zero subsequent profile-save requests and an unchanged database profile. This is additional to, not a substitution by, the mocked browser suite.
6. **Handle concurrency: PASS.** Two distinct authenticated users issue barrier-synchronized HTTP requests with measured overlapping request windows. Exactly one returns success and one returns `HANDLE_TAKEN`; the database contains one durable owner. Loser's full profile is unchanged; winner changes only handle/confirmation/completion/version fields. Two winning retries return identical durable results without writes. Reserved/invalid/foreign-logo/immutable cases pass. Replaying a claim after a logo replacement does not restore the old logo. The existing SQL suite also verifies the privileged permanent-handle trigger.
7. **Full SQL differential: PASS with verified inherited exceptions.** The same 112 pristine-main `.test.sql` files, verified byte-identical to the recorded main commit and expanded with existing includes, ran on both databases. Each produced 3,079 assertions: 3,068 pass, 11 fail; 105 suites pass and the same seven fail. All TAP plan totals are complete. Normalized result objects have **zero differences**. Only TAP ordinal/order is ignored (the Event Import ACL test enumerates pg_proc without ORDER BY); assertion labels, outcomes, multiplicity, plans, source hashes, exit codes and SQL errors remain compared. Feature-only organizer setup adds **18/18** pass; storefront identity **21/21** passes on both and in the focused rerun. See inherited-exception table below.
8. **Frontend/function/browser:** fresh post-proof frontend **215 files / 1,765 tests passed**; functions **432 passed**; onboarding Chromium suite **10 passed** (1.0 minute), plus the live Storage sign-out browser test **1 passed**. All results are from this successful proof-resumption run.
9. **Typecheck/lint/build:** fresh `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm typecheck:functions` all passed. Build used inert local public configuration. Python proof scripts compile and `git diff --check` passes. The browser harness startup initially returned 404 because Vite inherited the test directory; setting explicit repository-root `webServer.cwd` fixed that harness defect. E2E typecheck/lint and all ten browser journeys passed after that config-only fix.
10. **Independent final review:** **PASS.** A fresh read-only whole-branch review ran after all integration/app checks passed, including tracked and untracked source, migration, tests and harnesses. No actionable feature regressions found; reviewer recommends merge review. Reviewed session/privacy fences, profile conflicts, permanent handle authority, media/RLS ownership, completion, old-route redirect, Storefront compatibility, and unchanged payment behavior. No review-driven application edit was needed.
11. **New regressions:** **No new regressions found** in completed proof or independent review. An inherited reconnect-refetch draft-loss risk is recorded below; it was not introduced by this branch.
12. **Staging mismatch still unresolved: YES.** The supplied staging frontend targets `https://oznjmliqnczotunksafx.supabase.co`; prior read-only requests returned 404/PGRST202 for `get_owned_storefront_identity`, `storefront_handle_available`, and `get_public_organizer_storefront`; media function OPTIONS returned 404/NOT_FOUND. Exposed-contract mismatch is confirmed; missing migration execution versus stale schema cache is not distinguished without the hosted ledger. The UI continues to fail visibly and offer retry. No hosted repair.
13. **Hosted changes performed: NO.** No staging/production writes, linked DB action, deployment, commit, push, PR, merge, or global Docker restart. Stripe/payment implementation unchanged.
14. **Ready to commit/review for merge:** **YES.** At Build + Prove completion, changes were uncommitted on `codex/organizer-onboarding-identity-v1` at the baseline above. Git/GitHub closeout is separately authorized; hosted backend repair remains excluded.

## Verified inherited SQL exceptions

These failures reproduced on pristine current main and feature with identical assertion outcomes; no application code was changed to repair unrelated debt.

| Suite | Matching failure | Additional evidence |
| --- | --- | --- |
| `checkout_integrity_expiry` | Test expects cron active=true; safe local harness uses false | Entire suite passes on both stacks with active=true set only inside rollback, while server scheduler remains off; inactive state verified afterward |
| `moderation_retention_schedule` | Same active-flag expectation | Same rollback-only proof passes on both stacks |
| `moderation_policy_acceptance` | Old function-argument authority expectation | Identical assertion 27 failure on pristine main and feature |
| `publish_event` | Expects EVENT_NOT_OWNED; actual EVENT_NOT_FOUND | Identical assertion 3 failure on both |
| `spec08_checkout_expiry` | Old cron table/function ACL expectation | Same role ACL values on both; do not conflate this with active-flag discrepancy |
| `ticketing_schema` | Five older exact-column/type/FK/uniqueness expectations | Same five failed assertions on both |
| `unattached_checkout_forward` | Initial-email enqueue expectation | Identical assertion 19 failure on both |

The harness initially omitted persistent pgTAP, causing `spec14_assembly_contracts` to stop before its assertions. Installing pgTAP on both disposable databases and setting the required scheduler-off state resolved that harness prerequisite; the full 112-suite inventory was rerun afterward. No SQL test was edited or skipped. The inventory covers organizer/profile/RLS, storefront/public reads, event creation/publishing/ownership, moderation, CSV import ownership, Free RSVP, paid checkout/refunds/fulfillment/tickets/check-in, Waitlist, Email Attendees, Duplicate Event and CSV Export. Shell concurrency suites outside the SQL inventory were not represented as run; this task's permanent-handle contention was proved with real concurrent authenticated HTTP requests.

## Independent review observation

A failed background reconnect refetch can replace the Profile form with its load-error state and discard an unsaved draft (`OrganizerProfileEditor.tsx:48`). The reviewer reproduced QueryObserver’s retained-data/error state read-only and confirmed both prior Setup and Settings loaders already had the same behavior. This is inherited, nonblocking for this recovery scope, and was not repaired here. No other actionable findings; no behaviors were declined for review.

## Accepted implementation and remaining release work

Account → shared Profile → existing Payouts, with a presentation-only contextual Step 3 wrapper. The old Identity route redirects with replace to Profile. Optional logo and explicit permanent URL confirmation live in the shared setup/Settings editor. Draft save never claims a handle or completes onboarding. Claimed handles stay read-only. Incomplete exit goes to discovery; completed exit goes to My Events. Settings version-conflict handling adopts complete canonical snapshots and protects concurrent logo changes. Auth lifetime fences prevent late reads/attachments/saves from applying to a different session. The new owner-derived, version-checked RPC reuses the existing profile-name/revision authority; public Storefront publication requirements remain unchanged.

Only migration `20260924010900_consolidate_organizer_setup.sql` is added. No new bucket/table/provider/dependency, no Stripe or payment-function behavior changes. Production/staging release remains a separate authorized task: deploy the frontend and migration with existing required storefront/media contracts, reconcile the accepted staging mismatch, and verify the authenticated hosted journey. Nothing hosted is fixed by this local proof.

## Git/GitHub closeout preflight

Fetched `origin/main` again: `b45b83e17793b9069d4f35d04dadd561e17c9594`, unchanged from proof. The intended diff contains 37 source/test/document files; no generated fixtures, credentials, screenshots, logs, local stack state, payment implementation, or hosted configuration are included. An extra pre-commit test invocation without public environment variables failed with `Missing VITE_SUPABASE_URL`; the configured rerun passed all **215 files / 1,765 tests**, using the same inert values as Build + Prove:

```sh
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture VITE_MAPBOX_ACCESS_TOKEN=disabled VITE_STRIPE_PUBLISHABLE_KEY=pk_test_fixture pnpm test --maxWorkers=4
```

## Reproducible evidence

Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-onboarding-identity-v1`.

- Fresh stack setup/control: `tests/integration/organizer-profile-proof2.py`; allowlisted IDs only. Main migrations are materialized directly from the baseline git commit.
- Forward fixtures: `tests/integration/organizer-profile-forward-proof.py` (run only against proof2 initialized at baseline).
- Full-chain replay: copy the feature migration into proof2's prepared migration folder and run `organizer-profile-proof2.py reset feature`; never use linked/hosted reset.
- Real Storage/concurrency: `tests/integration/organizer-profile-storage-proof2.py`, after serving existing functions on proof2. Writes one ignored 0600 synthetic local session fixture for the live-browser test; no credentials in tracked files or report.
- Live sign-out: `pnpm exec playwright test --config tests/e2e/organizer-profile-live.config.ts`, with Vite 3085 pointing at proof2 and the existing media function's local origin matching.
- Differential: `organizer-profile-sql-differential.py main`, then `feature`, then `compare`. Raw logs/result objects: `.superpowers/organizer-onboarding-identity-v1/sql-differential/`; `comparison.json` is the summary.
- Focused/cron/ledger: `organizer-profile-focused-proof2.py`.
- Other evidence: `.superpowers/organizer-onboarding-identity-v1/resume-*.log`, `resume-replay-ledgers.json`, and prior recovery diagnostic logs (all ignored). Synthetic screenshots remain in ignored `test-results/`.

## Changed file inventory

- `Docs/specs/2026-09-24-organizer-onboarding-identity-v1.md`
- `Docs/superpowers/plans/2026-09-24-organizer-onboarding-identity-v1.md`
- `src/app/router/router.tsx`
- `src/features/organizer-onboarding/onboarding.css`
- `src/features/organizer-settings/OrganizerProfilePage.test.tsx`
- `src/features/organizer-settings/OrganizerProfilePage.tsx`
- `src/features/organizers/OrganizerPayoutsRoute.test.tsx`
- `src/features/organizers/OrganizerPayoutsRoute.tsx`
- `src/features/organizers/OrganizerProfileEditor.test.tsx`
- `src/features/organizers/OrganizerProfileEditor.tsx`
- `src/features/organizers/OrganizerSetupPage.presentation.test.tsx`
- `src/features/organizers/OrganizerSetupPage.test.tsx`
- `src/features/organizers/OrganizerSetupPage.tsx`
- `src/features/organizers/profile.api.test.ts`
- `src/features/organizers/profile.api.ts`
- `src/features/storefront/OrganizerStorefrontEditorPage.tsx`
- `src/features/storefront/StorefrontIdentityPage.test.tsx`
- `src/features/storefront/StorefrontIdentityPage.tsx`
- `src/features/storefront/storefront.identity.api.test.ts`
- `src/features/storefront/storefront.identity.api.ts`
- `src/lib/supabase/database.types.ts`
- `src/preview/screens.json`
- `src/preview/screens.render.test.tsx`
- `supabase/migrations/20260924010900_consolidate_organizer_setup.sql`
- `supabase/tests/database/organizer_setup.test.sql`
- `tests/e2e/organizer-onboarding.config.ts`
- `tests/e2e/organizer-onboarding.spec.ts`
- `tests/integration/organizer-profile-identity-proof.py`
- `tests/integration/organizer-profile-local.py`
- `Docs/testing/organizer-onboarding-identity-v1.md` (this report)

- `tests/integration/organizer-profile-proof2.py`
- `tests/integration/organizer-profile-forward-proof.py`
- `tests/integration/organizer-profile-storage-proof2.py`
- `tests/integration/organizer-profile-sql-differential.py`
- `tests/integration/organizer-profile-focused-proof2.py`
- `tests/e2e/organizer-profile-live.config.ts`
- `tests/e2e/organizer-profile-live.spec.ts`
