# Spec 10 + Spec 11 frozen local integration

Verified 12 September 2026. This is a local integration baseline for Spec 12. No commit, main merge, push, deployment, linked/shared database mutation, real email, hosted Auth mutation or Stripe transaction was performed. Both source worktrees, the previous integration worktree and main retain their recorded file maps, Git status, branches and HEADs.

## 1. Checkout and baseline

- Worktree: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec10-spec11-integration`
- Branch: `codex/spec10-spec11-integration`
- Starting and final Git HEAD: `94c546bd0961f501584f8a3437298b2331cafd5c`
- Actual dependency baseline: the **797-file uncommitted frozen 08+09 snapshot**, SHA-256 `c95633378ef74606d9e5d683438a1258020d609caef776a7588e0002debe85cf`. Both sources' dependency manifests matched this map, and the previous integration's current bytes matched it. Git HEAD alone does not contain this baseline.

The final map is `.superpowers/spec10-spec11/frozen-baseline.json`, with the digest in `frozen-baseline.sha256`. Copy those exact mapped bytes for Spec 12; checking out the branch's HEAD would omit the uncommitted implementation. The manifest includes tracked and nonignored untracked source/document files. It excludes ignored dependencies, local environment, build output, screenshots and test evidence. All such local evidence remains available in this checkout.

## 2. Exact source snapshots

| Source | Worktree suffix / branch | HEAD | Mapped files | Increment from frozen 08+09 |
|---|---|---|---:|---:|
| Spec 10 | `.worktrees/spec10-event-changes` / `codex/spec10-event-changes` | `94c546bd0961f501584f8a3437298b2331cafd5c` | 861 | 102 |
| Spec 11 | `.worktrees/spec11-organizer-settings` / `codex/spec11-organizer-settings` | `94c546bd0961f501584f8a3437298b2331cafd5c` | 832 | 58 |

Spec 10 map SHA-256: `63e397749d6b7499ee2965c50cc4af435f641cb31553abf058ccea48cb12dd8d`.

Spec 11 map SHA-256: `2c7c186e5e252941fdfcb5ce90c58ed3f0d7ab176a11173b974ab5358011cc7f`.

Pre-edit records in `.superpowers/spec10-spec11/spec10-event-changes.json` and `spec11-organizer-settings.json` contain absolute worktree, branch, HEAD, complete tracked/untracked status and every file digest. `main.json` and `spec08-spec09-integration.json` capture the protected dependencies. `source-preservation-final.json` verifies all four protected trees after integration. Hash convention: SHA-256 of UTF-8 `json.dumps(files, sort_keys=True)`, where `files` maps sorted relative paths to content SHA-256.

Read before implementation: product definition, user flows, technical architecture, Spec 10 implementation verification, and Spec 11 implementation/visual proof. Exact changed paths and classifications are in `Docs/testing/spec10-spec11-integration-files.md`; machine-readable source deltas are the two `*-changes.json` evidence files.

## 3. Overlap classification

| Shared file | Classification | Result |
|---|---|---|
| `src/app/router/router.tsx` | Automatically compatible | Three-way union of Spec 10 routes and Spec 11's six-route Settings subtree. |
| `src/features/auth/privateQueryCache.ts` | Narrow reconciliation | All private scopes retained, with Spec 11 identity-generation invalidation and event mutation cleanup. |
| `src/lib/supabase/database.types.ts` | Narrow reconciliation | Regenerated from the fully replayed combined local schema. |
| `tsconfig.e2e.json` | Narrow reconciliation | Both browser configurations included. |

There were exactly four overlapping incremental paths and no incompatible data contract or migration collision. Router tests flatten the resulting tree and assert route presence and uniqueness. Buyer checkout, confirmation, ticket collection, Free RSVP, recovery/access, refund details, event status and organizer operations/check-in routes remain present.

## 4. Reconciliation patches

The inventory lists every file that differs from its authoritative attached source, plus new integration files. `.superpowers/spec10-spec11/reconciliation.diff` is the actual reviewable patch against those source bytes, rather than a misleading diff against old Git HEAD.

1. **Identity lifetime:** Spec 11 invalidates private identity synchronously when sign-out begins. Spec 10's editor, publish completion, notice review/submission and cancellation/reconciliation continuations now use that same lifetime. Invalidated late responses cannot repopulate the private cache or continue stale navigation. Draft/revision/cancellation hooks use event mutation keys, zero inactive retention and guarded success callbacks. Server writers, notice intent identity, version checks and cancellation semantics are unchanged.
2. **Validated return:** sign-in restores known internal organizer paths, including event changes/cancellation, from the existing route-guard state. Unknown/hostile destinations fall back to `/organizer/events`; query strings and fragments are not restored.
3. **Shared shell:** the legacy editor/preview organizer shell now includes Settings alongside Events and Payments. This was exposed by the real browser roundtrip. Nine HTML preview fixtures changed only by that Settings anchor; each remaining snapshot byte was compared with the Spec 10 version. Existing CSS and screen hierarchy were retained.
4. **Disposable infrastructure:** copied database entrypoints delegate to a single combined guard. Local REST/Edge/browser transports use new container identities and loopback ports. The configured Settings build gets a separate temporary output directory. No source runner or source container was repurposed.
5. **Explicit integration tests:** added identity/return/SQL scenarios and extended editor, notice, scanner, session, route, support-config and canonical browser journeys. The support coexistence test renders the actual buyer support component under the same environment as Settings, checking distinct destinations.

An independent bounded code review reproduced late private writes in the remaining draft/revision hooks. That finding was fixed and independently rechecked in six cases: both hooks under normal completion, sign-out invalidation and A→B→A. Normal writes succeeded; invalidated cases retained neither the detail cache nor private mutation entries. The reviewer found no remaining material integration blocker. Full review: `.superpowers/spec10-spec11/independent-review.md`.

## 5. Migration order and isolation

All **113 inherited migrations remain byte-identical**. The following six source migrations are also copied byte-for-byte, in this order:

1. `20260915010000_add_event_change_history.sql`
2. `20260915010100_add_cancellation_summary.sql`
3. `20260915010150_add_owned_event_cancellation_summary.sql`
4. `20260915010200_add_event_notices.sql`
5. `20260915010300_add_approved_private_event_facts.sql`
6. `20260916010000_add_owned_organizer_settings.sql`

The complete **119-migration** set replayed successfully twice from a new empty application schema. There are 119 unique timestamps; no historical migration was edited and no reconciliation migration was needed. SQL suites exercise replacement function contracts, grants, owner boundaries, immutable facts and profile revision protection after the final replacement order.

The only database target was `whereto-spec10-spec11-db`, labelled `wheretoo.task=spec10-spec11-integration`, bound to `127.0.0.1:55545`. The runner checks its recorded Docker ID, name, label, loopback mapping and `cron.launch_active_jobs=off` before every SQL command. REST is separately recorded at `127.0.0.1:55546`; test Edge transports use 55547 and 55567. IDs are recorded in `database-identity.json` and `rest-identity.json`.

Existing test-only Auth compatibility/bootstrap SQL was applied after replay. Cron execution stayed disabled throughout. Tests briefly enable the guarded email worker setting only for explicit local claims; the final setting is false, with zero active cron jobs. No linked database command was used. Local server process cleanup and final inert-state evidence are recorded in `final-isolation.log` and `local-process-cleanup.json`.

## 6. Generated types

Generated public types only after successful replay with:

```sh
pnpm exec supabase gen types typescript --db-url postgresql://supabase_admin:spec10-spec11-disposable-only@127.0.0.1:55545/postgres --schema public
```

The password above is deliberately synthetic and specific to this disposable container. The repository's linked `db:types` script was not used. A second generation from the final schema matched the checked-in-path output after normalizing the generator's extra blank EOF line. Result SHA-256: `22113ae5e713093f591a56059dc56f662ab750cb8f1cd645ecf236b893d33181`. Against Spec 10, the substantive addition is the Spec 11 owned Settings RPC type. Evidence: `final-generated.types.ts` and `final-type-generation.log`.

## 7. Spec 10 regression result

All selected Spec 10 SQL, concurrency, frontend/function and browser checks passed. They retain published edits and authoritative Previous → New facts; stale save/publish/acceptance protection; canonical same-event cancellation and ambiguous-result reconciliation; Used admission timestamps; cancellation of unused admissions; separate free/paid behavior; revision-bound change notices and suppression of stale unsent notices; purpose-distinct cancellation/refund notices; no automatic refunds; and readable late-payment/zero-ticket review state.

Spec 10 contributes **216 SQL assertions across 12 suites**, **34 concurrency scenarios**, and **2 browser scenarios** containing the owner/buyer lifecycle and ambiguous-cancellation journeys. The complete shared frontend/function runs include its tests. Browser checks compare canonical local rows and retain original paid, `rsvp_`, event-status and notice access links.

## 8. Spec 11 regression result

Spec 11 contributes **27 SQL assertions across 2 suites**, **1 profile concurrency scenario** (8 simultaneous requests, 1 winner, 7 explicit conflicts), **6 primary browser scenarios** and **2 configured browser scenarios**. All passed.

Coverage includes six Settings routes; independent private account/public organizer names; fresh Auth reads; current/pending email and authenticated password/reauthentication states; profile conflict/reload/retry; hidden/onboarding field preservation; public-name moderation consequences; all five canonical Connect states; no account creation on mount; return refresh/provider-read failure; configured/unavailable support/legal; manual closure confirmation/cancel/mail handoff without claiming submission; and sign-out cleanup preserving guest access.

**Source discrepancy retained explicitly:** the frozen 08+09 baseline and both sources have `/organizer/settings/payments` and existing links, but no `/organizer/payments` alias or event-ID-specific Stripe return flow. Canonical Payments navigation/return refresh is verified. An absent event-specific flow cannot be claimed preserved or tested; no new one was invented.

## 9. Required cross-spec scenarios

| # | Scenario | Concrete evidence |
|---:|---|---|
| 1 | Edit event → Settings → return | Expanded Spec 10 browser persists venue/review state; SQL retains authoritative history and stale protection. |
| 2 | Public name change preserves review consequences | Combined SQL event/edit/profile sequence plus Spec 11 Settings/revision suites retain eligibility and public-name review rules. |
| 3 | Change notice → Settings | Browser submits canonical notice, roundtrips Settings/Payments and compares event/order/ticket/notice source rows. |
| 4 | Cancel → Settings | Browser roundtrip preserves canonical cancelled event; later profile bio save cannot reopen it. |
| 5 | Cancelled event with refund follow-up → Settings | Extended Spec 09 canonical refund journey cancels the event, visits Settings and returns to the owner order; the full order row and refund state remain unchanged. |
| 6 | Stripe Settings → owned event | Spec 10 Settings/Payments roundtrips compare canonical event and transaction/notice rows before and after. Connect itself is a local provider fixture. |
| 7 | Expired management session returns safely | Seven sign-in destination tests cover changes/cancellation and hostile/unknown paths; router/Auth tests cover protected redirects. This is component proof, not hosted-session expiry. |
| 8 | Sign-out during pending management/notice work | Combined cancellation/new-draft tests, editor context test and notice test reject late private effects. Independent six-case hook check also covers revision and A→B→A. |
| 9 | Sign-out with scanner active | OperationalScanner test aborts the active request, stops the camera adapter, unmounts for anonymous state and ignores late admission. Hardware is simulated. |
| 10 | A→B private isolation | SessionProvider and cache union tests evict history, notice, cancellation, account/settings, profile and Connect scopes; identity lifetime rejects ABA completions. |
| 11 | Purpose-specific support coexistence | Actual buyer DeliverySupport rendering uses ticket support while Settings Help and closure use their explicit distinct values. Invalid/missing values remain unavailable. Existing function tests cover notification support requirements. |
| 12 | No duplicated transactional authority | Router uniqueness tests, unchanged migration bytes, canonical SQL/concurrency and browser row comparisons retain payment/refund/email/free/admission writers and distinct state domains. |

These scenarios intentionally combine local SQL, component tests and browser journeys according to their boundary. They are not twelve additional browser test declarations.

## 10. Verification totals

| Check | Result | Evidence under `.superpowers/spec10-spec11/` |
|---|---|---|
| Offline frozen dependency install | Passed | `install.log` |
| `pnpm typecheck` | Passed, all configured projects | `typecheck-final.log` |
| `pnpm lint` | Passed | `lint-final.log` |
| `pnpm test --maxWorkers=3` | **1,242 passed / 141 files** | `frontend-final.log` |
| `pnpm test:functions` | **327 passed, 0 failed** | `functions.log` |
| `pnpm typecheck:functions` | **85 files checked** | `functions-typecheck.log` |
| Offline integration tests | **258 passed, 5 skipped / 16 passed files, 1 skipped** | `offline-integration.log` |
| Spec 10 + 11 SQL | **243 assertions / 14 suites** | `sql-spec10-spec11.log` |
| Specs 04–09/moderation selected SQL | **931 assertions / 36 suites** | `sql-dependencies-final.log` |
| New combined SQL | **16 assertions / 1 suite** | `cross-sql.log` |
| SQL total | **1,190 assertions / 51 suites, 0 failures** | The three logs above |
| Real local parallel-session concurrency | **35 scenarios / 8 runners** | `concurrency-final.log` |
| Spec 10 browser | **2 passed** | `browser10-final.log` |
| Spec 11 browser + configured | **6 + 2 passed** | `browser11-final.log`, `browser11-configured.log` |
| Spec 08 browser | **23 passed** | `browser08.log` |
| Spec 09 browser | **1 passed** | `browser09.log` |
| Browser total | **34 passed** | The browser logs above |
| `pnpm build` | Passed | `build-final.log` |
| Production ticket-shell/email boundary checks | Both passed | `production-boundaries.log` |
| Final migration-generated type comparison | Matched | `final-type-generation.log` |
| `git diff --check` | Passed | `diff-check-final.log` |
| Source/main preservation + served build identity | Matched | `source-preservation-final.json`, `served-artifact-verification.json` |

Counts refer to each suite's final successful run, without double-counting earlier reruns. SQL includes selected current dependency suites, not every historical SQL file. Browser evidence uses the production build with guarded local canonical database/Edge behavior where specified; Auth/Stripe/email transports are deterministic fixtures. `artifact-identity.json` maps source inputs and output bytes; all 138 served files on local port 3030 were byte-compared with `dist`.

## 11. Diagnostic failures and resolutions

- Red integration tests exposed the validated-return gap and late editor/notice/cancellation/draft writes. Narrow lifetime/return patches turned them green; no stale-write assertion was removed.
- The first real Settings roundtrip exposed the missing Settings entry in the legacy editor shell. The link was added and all final browser journeys passed. Preview render tests then correctly required nine expected-anchor updates; the snapshot remainder was verified unchanged.
- A broad exploratory SQL glob included historical `checkout_integrity_expiry.test.sql`, whose active-cron/older role-grant expectations conflict with the current frozen schema and deliberately disabled local jobs. It was left unchanged. The current `spec08_checkout_expiry.test.sql` and selected source-verification dependency suites pass. This historical diagnostic is not counted as a passing suite or concealed as full historical coverage.
- Running email concurrency after browser seeding initially violated its empty pending-queue precondition. Only the guarded combined database was rebuilt; all 119 migrations replayed again and all concurrency scenarios passed before browser seeding.
- Local harness corrections included output-directory creation, consistent synthetic hostname/storage key, exact Connect response DTO, safe browser route teardown during hard navigation, and guarded REST restart after database rebuild. Final runs passed with the assertions retained. The Settings profile conflict browser case intentionally produces a rejected SQL write/stack trace in its passing log.
- Offline integration deliberately excludes provider/externally configured database runners. Five optional cleanup tests skip without their DB URL. Required canonical database coverage instead runs through the recorded disposable guard.

## 12. Responsive and visual result

Inspected production screenshots at **320, 390, 768 and 1440 CSS pixels**, covering event change history, paid/free cancellation and Unknown reconciliation, Settings index, Account & Security, Profile, Payments, Help and Account Actions. Also inspected configured Help, the closure dialog and an empty password editor.

No horizontal overflow, duplicated header, missing navigation or lost primary action was observed. At 320px, the editor shell's extra navigation wraps naturally; history facts stack and cancellation summaries reflow. Canonical navigation tests separately verify retained private/event state, because screenshots alone cannot establish data isolation. No screen redesign or unrelated CSS change was made.

Original screenshots: `.superpowers/spec10/browser-visual/` and `.superpowers/spec11/visual/`. Contact sheets and native-pixel mobile sections inspected for full-page readability: `.superpowers/spec10-spec11/visual-review/`. Local production views use populated canonical fixtures, not preview-only HTML.

## 13. Provider/device proofs intentionally skipped

No actual Stripe TEST transaction/account mutation, real email send, hosted Auth mutation/email confirmation, real password-policy/reauthentication interaction, shared/production database write, live support/closure mailbox receipt or physical-camera proof was performed. Browser provider boundaries use synthetic fixtures. These remain separately authorized release proofs; local passing tests do not establish provider readiness.

## 14. Remaining risks and blockers

No introduced contract, migration, authorization or reconciliation blocker remains for this local freeze. Two inherited limitations remain explicit:

- **Auth release risk:** the installed main Auth SDK may clear replacement session B if another tab signs into B while A's remote sign-out is pending. Spec 11's same-page latch and isolated account operations are retained; they do not solve cross-tab SDK serialization. No broad Auth rewrite or SDK private-state manipulation was introduced.
- **Absent Stripe flow:** event-specific return behavior was absent from the provided baseline; canonical Settings Payments and existing return refresh are preserved, as described above.

Historical SQL expectations and skipped optional/provider tests are scoped in sections 11–13. They must not be represented as production proof.

## 15. Handoff and manual setup

The combined source remains uncommitted on its isolated branch. Full changed-file inventory, exact source maps, reconciliation diff, final freeze map, logs and screenshots are local and reviewable. Ignored evidence/build directories are deliberately not added to Git.

For Spec 12, start from the final manifest's file bytes and verify its digest, including the untracked files. Run `pnpm install --offline --frozen-lockfile` where the dependency cache is available. Recreate only synthetic local environment values for browser fixtures; no real credentials are included in the frozen map. Disposable DB/REST containers are retained for inspection with cron and workers disabled; owned preview/Edge processes are stopped. Reuse only the guarded combined runner and its recorded identities, or create a new isolated task-specific runner for the next task. No production/manual provider setup is required for this local baseline; provider credentials, verified legal/support configuration and the excluded proofs are later release work.
