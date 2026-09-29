# Storefront Reliability + Organizer Navigation V1 — Build + Prove

## Scope and root causes
Baseline fetched main: `aba93a2e1a72e8a226f0b1a94b872970815c291e` (unchanged from supplied expectation).
Branch: `codex/storefront-reliability-nav-v1`.
Worktree: `/Users/exoh/.codex/worktrees/storefront-reliability-nav-v1/WhereTo -  Repository`.
HEAD remains baseline; changes are uncommitted. Original dirty checkout preserved.

| Classification | Finding and evidence |
| --- | --- |
| Already repaired by staging contract repair | Earlier onboarding inspection recorded HTTP 404/PGRST202 for missing Storefront RPCs. The repair closeout records applying existing migrations and deploying organizer-media. Fresh probes now resolve public, editor, identity and preview contracts. Authenticated synthetic owner editor and preview both pass the actual frontend Zod schemas. |
| Current frontend bug, fixed | Cached editor data mounted before refresh; Editor copied initial data once, so later canonical data did not replace stale name/logo/version. Regression reproduced with both stale cache and production 30-second freshness. Loader now always refreshes on initial mount and waits for its result before seeding the form. Existing dirty drafts are not remounted on routine background refresh. |
| Routing/navigation problem, fixed | Storefront was absent beside My Events. Primary OperationsLayout now exposes the existing `/organizer/settings/storefront` route with its own active state. Settings is not simultaneously active. Legacy fallback shell also links to Storefront. No duplicate editor or public URL was created. |
| Organizer-data prerequisite | Synthetic staging organizer has a permanent handle and logo but Storefront status is draft. Public null/not-found is correct under current architecture. |
| Event eligibility prerequisite | Synthetic staging preview has zero eligible events. Current read-only staging inventory has zero published storefronts, so no alternative valid public fixture exists. No staging publication or agreement acceptance performed. |
| Confusing empty-state UX, fixed | Successful empty organizer event choices now say “No eligible public events yet.” Pending reads say “Loading eligible events…”; failures retain a separate retry action. |

No current backend defect was identified. Public request failure remains distinct from null/not-found; diagnostics are not displayed to users. An already-published storefront remains visible with a truthful empty state after eligible events disappear. Initial publication still requires handle, logo and eligible event.

## Files changed
- `src/components/layout/OrganizerLayout.tsx`: fallback navigation link.
- `src/features/organizer-operations/OperationsUi.tsx`: primary Storefront navigation/icon and active-state matching.
- `src/features/organizer-operations/OperationsUi.test.tsx`: primary nav ordering/destination/active state.
- `src/features/storefront/OrganizerStorefrontEditorPage.tsx`: initial canonical refresh and event-choice loading/empty states.
- `src/features/storefront/OrganizerStorefrontEditorPage.test.tsx`: cache, retry, public-link, incomplete handle, empty state and delayed sign-out regressions.
- `src/features/storefront/OrganizerStorefrontPage.test.tsx`: public pending, empty identity, not-found and infrastructure-error retry.
- `src/preview/screens.json`: regenerate five existing shell snapshots to include the new navigation link; no unrelated snapshot redesign.
- `tests/e2e/storefront-reliability.config.ts` and `tests/e2e/storefront-reliability.spec.ts`: isolated browser proof.
- Requested spec, implementation plan, and this report.

No migrations, database/function implementation changes, dependencies or payment configuration changes.

## Browser and visual proof
Target: local Vite production-route application at `http://127.0.0.1:3091`, sourced from this worktree. Actor: completed synthetic organizer, incomplete organizer, anonymous public visitor. Data: intercepted local API fixtures; no hosted fixture mutation. Scope: existing visual style, primary navigation and reliability, at 390×900 and 1440×900 CSS pixels. Public fixture is a synthetic free event; it is not evidence of a real staging publication.

Four Playwright tests pass. Journeys cover My Events → Storefront; active state; saved name/logo; reload; saved-handle public link; public name/logo/event card/event URL; successful empty state; unknown handle; editor and public missing-contract/transient failure with retry; missing-handle Profile link; incomplete organizer → setup; sign-out while editor response is delayed, followed by no private fields/token.

Opened and inspected all four screenshots:
- `test-results/storefront-reliability/storefront-reliability-org-414b1-nd-public-storefront-at-390/organizer-390.png`
- `test-results/storefront-reliability/storefront-reliability-org-c9f31-d-public-storefront-at-1440/organizer-1440.png`
- Corresponding `public-390.png` and `public-1440.png` in those directories.

Navigation wraps into the existing mobile shell. No horizontal overflow, broken fixture images, unexpected requests or page exceptions. Existing Settings layout remains intact, including its existing desktop sections. The development runtime emits a multiple-GoTrueClient warning during the sign-out journey, also recorded by the preceding staging repair; it is not a new runtime exception and was not changed in this scope. Real device testing was not performed.

## Backend and security proof
All repository migrations are present on loopback `supabase_db_wheretoo-organizer-profile-proof2`; only extra ledger entry is the existing local platform bootstrap `00000000000001`. Existing tests ran transactionally and rolled back:
- storefront_identity: 21 assertions.
- storefront_read: 12 assertions.
- storefront_editor: 16 assertions.
- storefront_merch: 7 assertions.

Total: 56 assertions passed. An additional rollback-only expanded read probe passed 16 assertions (12 existing plus 4 focused additions): draft/blocked/cancelled/removed events are absent from both featured/list output; foreign organizer reads own editor; foreign save affects only its own organizer; original owner's entire row remains unchanged. No production/backend SQL was changed, so no migration differential is required.

Tests also prove anonymous editor/preview denial, public projection excludes private fields, immutable/reserved handles, foreign media rejection, canonical profile rename preserving permanent URL, revision conflict, draft hidden publicly, and published empty-state retention. Public events use existing canonical ticketing availability and normal event URLs; no availability calculation changed.

## Staging proof
Environment independently identified from deployed assets: `wheretoo-staging.vercel.app` → `oznjmliqnczotunksafx.supabase.co`. Existing synthetic fixture credentials were used without logging secrets. Expired saved bearer returned PGRST303; ordinary fixture sign-in supplied a fresh session for read-only RPC verification.

- Anonymous unknown-handle public RPC: HTTP 200/null.
- Anonymous editor/identity/preview: HTTP 401/42501, expected denial.
- Authenticated editor and preview: actual frontend schema parse PASS. Real staging browser editor load/reload PASS; saved logo decodes; unpublished status and absent public link are correct; zero runtime exceptions.
- Existing synthetic handle `staging-proof-260925-abf326`: confirmed handle/logo; status draft; zero eligible events; public RPC null.
- Read-only count: zero published storefronts on staging.
- Real browser public fixture URL: clean “Storefront not found”, zero page exceptions.
- Real browser protected Storefront URL while signed out: redirects to sign-in.
- Static hosted `/organizer` and `/event-policy` serve the SPA. Hosted public initial HTML responds 200; client then correctly renders not-found. No server-side 404 status claim is made for staging.

Public successful staging proof is blocked by existing data prerequisites, not missing RPCs. No agreements accepted, events published, settings/profile data changed, deployments, production changes, payment activation, DNS changes or email sends. Only ordinary synthetic authentication sessions and read requests occurred.

## Review and verification notes
Independent review found no blocking regression. Its production-cache-default observation was accepted, reproduced RED and fixed with `refetchOnMount: 'always'`; its sign-out test observation was addressed by retaining the same QueryClient. No deferred code findings. Preserve the existing route rather than introduce a second canonical editor; that ordinary decision is explicitly permitted by the request.

Initial exploratory runs overlapped changes under development and are not claimed as pristine-main baselines. The default high-concurrency run also timed out one unrelated ticket-email runtime test. Final results below supersede those runs. No unrelated baseline debt was modified.

## Final check results
- Frontend: `pnpm test --maxWorkers=4` — 216 suites / 1,777 tests PASS. This executes the full `pnpm test` script with bounded concurrency. Includes Profile/onboarding, CSV import, publishing, RSVP, paid checkout, waitlist and routing regressions.
- Focused Storefront/navigation: 11 suites / 70 tests PASS; stale-cache and nav regressions observed failing before fixes.
- Browser: 4 tests PASS at requested desktop/mobile widths, rerun after browser-test typing corrections.
- `pnpm typecheck`: PASS (application, integration, E2E and scripts).
- `pnpm lint`: PASS.
- `pnpm build`: PASS.
- `pnpm typecheck:functions`: PASS.
- `pnpm test:functions`: 432 tests PASS.
- SQL: 56 existing assertions plus expanded 16-assertion probe PASS (4 additional distinct assertions); all rolled back on loopback.
- `git diff --check`: PASS.

## Founder handoff
**PARTIAL overall:** local implementation/proof passes; successful public staging proof is data-blocked. Ready to commit and review for merge: **yes**, with explicit awareness of this remaining staging validation gap. No commit/push/merge performed.

No known new product regression. No unresolved baseline test failure is claimed. Existing development multiple-client warning remains outside scope. No manual setup is required to build this change. Completing successful public staging proof later requires a founder-approved eligible-event/publication fixture; this task did not perform or request that action.

Public projection, handle permanence, profile/logo authority, organizer ownership, event filtering and sign-out boundaries remain unchanged. The frontend cache fix is additional reliability work, not a claim that caching caused the original historical missing-contract failure.

## Founder-approved closeout — 2026-09-28
Founder approved the implementation and accepted the successful public-staging proof gap as nonblocking for merge. The absence of published storefronts/eligible synthetic events is a data prerequisite, not a code failure. Public success proof is naturally deferred; do not publish an artificial staging event or accept agreements solely to obtain it.

Pre-commit fetch confirms remote main remains `aba93a2e1a72e8a226f0b1a94b872970815c291e`. The scoped branch/worktree is correct; unrelated work is preserved. Scope review confirms the existing editor and public routes, canonical Profile identity, Storefront customization, eligibility and ownership boundaries are unchanged. No migration, backend or payment file is included. The implementation-time verification above remains the governing proof; Git/GitHub closeout is authorized following fresh frontend verification and remote checks.
