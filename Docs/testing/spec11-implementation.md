# Spec 11 — Organizer Settings implementation

Local implementation and verification handoff, 12 September 2026. No commit, merge, push, deployment, real email, Stripe/provider mutation or shared-database mutation was performed.

## 1. Worktree and branch

`codex/spec11-organizer-settings` at `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings`. Implementation is isolated from main and the concurrent Spec 10 worktree.

## 2. Starting frozen baseline

The frozen working state from `.worktrees/spec08-spec09-integration`, branch `codex/spec08-spec09-integration`, at commit `94c546bd0961f501584f8a3437298b2331cafd5c`. This includes its approved uncommitted integrated work: Git HEAD alone is not the implementation baseline. All 797 copied source files were hashed, and the frozen source still matches all 797 hashes.

The incremental file list and diff compare against the captured frozen working state: [Spec 11 diff](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/incremental.diff>), [source preservation evidence](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/source-preservation.json>).

## 3. Files changed

56 implementation/test/config files, plus this handoff and the visual proof note. Full paths below; inherited baseline changes are excluded.

- [.env.example](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.env.example>)
- [playwright.spec11.config.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/playwright.spec11.config.ts>)
- [src/app/providers/AppProviders.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/app/providers/AppProviders.test.tsx>)
- [src/app/providers/AppProviders.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/app/providers/AppProviders.tsx>)
- [src/app/router/OrganizerShell.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/app/router/OrganizerShell.tsx>)
- [src/app/router/router.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/app/router/router.tsx>)
- [src/components/layout/OrganizerLayout.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/components/layout/OrganizerLayout.tsx>)
- [src/config/browserEnv.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/config/browserEnv.ts>)
- [src/features/auth/SessionProvider.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/SessionProvider.test.tsx>)
- [src/features/auth/SessionProvider.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/SessionProvider.tsx>)
- [src/features/auth/SignInPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/SignInPage.tsx>)
- [src/features/auth/SignOutProvider.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/SignOutProvider.test.tsx>)
- [src/features/auth/SignOutProvider.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/SignOutProvider.tsx>)
- [src/features/auth/account.api.test.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/account.api.test.ts>)
- [src/features/auth/account.api.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/account.api.ts>)
- [src/features/auth/account.lifecycle.test.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/account.lifecycle.test.ts>)
- [src/features/auth/identityLifetime.test.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/identityLifetime.test.ts>)
- [src/features/auth/identityLifetime.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/identityLifetime.ts>)
- [src/features/auth/isolatedAccountClient.test.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/isolatedAccountClient.test.ts>)
- [src/features/auth/isolatedAccountClient.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/isolatedAccountClient.ts>)
- [src/features/auth/privateMutationLifetime.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/privateMutationLifetime.test.tsx>)
- [src/features/auth/privateQueryCache.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/auth/privateQueryCache.ts>)
- [src/features/organizer-operations/OperationsUi.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-operations/OperationsUi.tsx>)
- [src/features/organizer-settings/AccountActionsPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/AccountActionsPage.tsx>)
- [src/features/organizer-settings/AccountSecurityPage.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/AccountSecurityPage.test.tsx>)
- [src/features/organizer-settings/AccountSecurityPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/AccountSecurityPage.tsx>)
- [src/features/organizer-settings/HelpAndActions.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/HelpAndActions.test.tsx>)
- [src/features/organizer-settings/HelpLegalPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/HelpLegalPage.tsx>)
- [src/features/organizer-settings/OrganizerProfilePage.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/OrganizerProfilePage.test.tsx>)
- [src/features/organizer-settings/OrganizerProfilePage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/OrganizerProfilePage.tsx>)
- [src/features/organizer-settings/SettingsLayout.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/SettingsLayout.tsx>)
- [src/features/organizer-settings/UnsavedSettingsGuard.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/UnsavedSettingsGuard.tsx>)
- [src/features/organizer-settings/organizer-settings.css](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/organizer-settings.css>)
- [src/features/organizer-settings/settings.config.test.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/settings.config.test.ts>)
- [src/features/organizer-settings/settings.config.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/settings.config.ts>)
- [src/features/organizer-settings/settings.profile.api.test.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/settings.profile.api.test.ts>)
- [src/features/organizer-settings/settings.profile.api.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizer-settings/settings.profile.api.ts>)
- [src/features/organizers/organizer.api.test.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizers/organizer.api.test.ts>)
- [src/features/organizers/organizer.api.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizers/organizer.api.ts>)
- [src/features/organizers/organizer.queries.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/organizers/organizer.queries.ts>)
- [src/features/payments/OrganizerPaymentsPage.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/payments/OrganizerPaymentsPage.test.tsx>)
- [src/features/payments/OrganizerPaymentsPage.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/payments/OrganizerPaymentsPage.tsx>)
- [src/features/payments/payment.api.test.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/payments/payment.api.test.ts>)
- [src/features/payments/payment.api.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/payments/payment.api.ts>)
- [src/features/payments/payment.queries.test.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/payments/payment.queries.test.tsx>)
- [src/features/payments/payment.queries.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/features/payments/payment.queries.ts>)
- [src/lib/supabase/database.types.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/src/lib/supabase/database.types.ts>)
- [supabase/migrations/20260916010000_add_owned_organizer_settings.sql](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/supabase/migrations/20260916010000_add_owned_organizer_settings.sql>)
- [supabase/tests/database/spec11_profile_revision.test.sql](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/supabase/tests/database/spec11_profile_revision.test.sql>)
- [supabase/tests/database/spec11_settings.test.sql](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/supabase/tests/database/spec11_settings.test.sql>)
- [tests/e2e/spec11-configured.spec.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/tests/e2e/spec11-configured.spec.ts>)
- [tests/e2e/spec11.spec.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/tests/e2e/spec11.spec.ts>)
- [tests/e2e/support/spec11Harness.ts](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/tests/e2e/support/spec11Harness.ts>)
- [tests/integration/spec11-database.py](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/tests/integration/spec11-database.py>)
- [tests/integration/spec11-profile-concurrency.py](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/tests/integration/spec11-profile-concurrency.py>)
- [tsconfig.e2e.json](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/tsconfig.e2e.json>)

## 4. Migration

[20260916010000_add_owned_organizer_settings.sql](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/supabase/migrations/20260916010000_add_owned_organizer_settings.sql>) adds only `save_owned_organizer_settings(text,text,timestamptz)`. It derives the owner from Auth, validates bounded name/bio and expected version, follows the existing operation/tier/event/organizer lock order, compares the version atomically, and delegates to the existing revision-aware profile writer. Hidden profile fields and onboarding completion come from the locked server row. The response allows only name, bio and updated version. Anonymous and service-role execution are denied; authenticated owner execution is granted.

No new profile table, logo field, storage bucket, public-contact field, or account deletion mechanism was added. Generated database types include the function.

## 5. Account & Security

Fresh provider reads supply the private account name (`full_name`), current email, verification state and pending email. Public organizer identity is separate. Name edits, authenticated email changes and authenticated password changes use the existing Supabase Auth SDK. Reauthentication codes, refusal, rate-limit and expired-session states are supported. Nonsecret failed drafts remain editable; password inputs clear on success, unmount and identity change. Passwords never enter Query mutation state, logs, storage or screenshots.

An Auth-only disposable SDK client prevents delayed A reads/writes from altering the main B session. Initialization and every operation dispose listeners. A transport allowlist and expiry guard prevent isolated refresh-token rotation; normal provider reads/updates/reauthentication remain SDK-owned. Real installed-SDK tests cover delayed missing-session errors, delayed writes, disposal and clock advancement. The root signout context loads the Auth client only on action, preserving lazy Auth initialization on guest routes.

## 6. Organizer Profile

Settings edits only the display name and bio; onboarding and hidden fields are preserved. The private preview is explicitly labeled “Profile preview — not a public page” and contains only name, initials and bio. Public contact and logo upload remain deferred.

A stale save returns an explicit conflict. The draft survives, the user reviews the latest saved values, then explicitly elects to keep and save their draft against that version. Name-change review/public-eligibility consequences are explained before save. SQL tests prove event revision/review effects while existing tickets and orders remain unchanged. The browser saves and reloads profiles through the real isolated database function.

## 7. Payments & Payouts

All five canonical Connect states are supported; ready says “Stripe setup ready for paid ticket sales”. Only supported requirement counts are shown. Status refreshes on entry, focus/page return and embedded exit. A failed read is distinct from `not_started`. Mounting Settings never creates an account; existing embedded setup and Express actions remain user initiated. Account Session secrets stay in the embedded lifecycle rather than the mutation cache. API requests pin the initiating session, and late results/identity cycles cannot restore an old embedded session.

The frozen baseline has `/organizer/settings/payments` and its existing links. It contains no `/organizer/payments` alias or event-specific `eventId` Stripe return behavior. The existing canonical route and links were retained; no absent return flow was invented or imported from another worktree.

## 8. Help & Legal

Validated optional organizer support falls back to existing ticket support. Configured support/problem-report links say “Open email app”; configured legal links use approved HTTPS destinations. Missing or invalid configuration displays honest unavailable states. No address, policy, SLA, acknowledgment or case number was fabricated.

## 9. Account Actions and sign-out

Manual closure requires confirmation, optional reason and fresh private account email before opening a configured mail draft. Only organizer name/current email/reason enter the draft. Cancel resets it. The UI states that Wheretoo has not submitted the request; there are no deletion/disconnect calls.

Organizer Shell and Settings share one synchronous pending latch. Local session removal and remote revocation outcome are reported separately. Private Settings/profile/payment state is evicted without clearing unrelated guest ticket/refund-link state. Existing scanner lifecycle and admission uncertainty logic were preserved and regression-tested.

## 10. Spec 10 overlaps and integration instructions

No Spec 10 worktree changes or dependency waits. No implementation attachment is deferred. At integration, merge these small additions into the combined versions:

- Router: retain Spec 10 event-change/cancellation routes; add the nested six-route Settings subtree under the existing organizer guard.
- Organizer shell/navigation: retain Spec 10 controls; attach Settings to `OperationsLayout`, preserve its new Settings link, and wire the shared pending signout prop.
- AppProviders: retain QueryClient configuration and lazy SessionShell; wrap children in SignOutProvider.
- Browser environment: union the four optional Settings destination keys with Spec 10 configuration; retain the existing ticket-support key.
- Generated types: regenerate against the combined migration set; do not overwrite Spec 10 types with this whole file.

## 11. Tests and checks

- Full application suite: **1,176 tests / 129 files passed** (baseline: 1,111 / 118).
- Function suite: **321 passed**; function typecheck passed.
- Dedicated database: **553 pgTAP assertions / 18 suites passed**, including 27 Spec 11 assertions and relevant Specs 04–09 regressions.
- Concurrent profile writes: **8 simultaneous requests → 1 commit, 7 explicit conflicts**; hidden/onboarding fields preserved.
- Production-browser scenarios: **6 core + 2 configured-destination/password scenarios passed**.
- Independent final Auth review: **26 tests / 3 files passed**, all three introduced SDK findings resolved. [Review and disposition](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/review.md>).
- Project typecheck, lint, build, function typecheck and `git diff --check` passed. Follow-up checks cover final spacing/handoff/lazy-Auth changes.

Logs: [application tests](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/tests-full-final.log>), [functions](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/functions.log>), [database regressions](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/database-regressions.log>), [concurrency](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/profile-concurrency.log>), [browser](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/browser-final.log>), [configured browser](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/browser-configured.log>), [build](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/build-final.log>).

The database is a separately recorded/labelled disposable container `whereto-spec11-db`, loopback port 55535, cron execution disabled. It replayed 113 frozen migrations plus the one Spec 11 migration. The helper verifies container identity, label and loopback binding before each SQL operation. Browser HTTP fixtures invoke that database for profile reads/saves; Auth and Connect responses are mocked. This is not real Supabase Auth/PostgREST or Stripe TEST proof.

## 12. Browser and visual results

All six routes were inspected at **320 / 390 / 768 / 1440 CSS pixels**: 24 screenshots, plus configured Help, closure confirmation and empty password editor. Deep links, refresh, explicit mobile Back, unsaved-change confirmation, profile conflict/retry, provider read failure, no mount-created Stripe account, configured/unavailable destinations, closure cancel/mail handoff, and signout were exercised. No horizontal overflow or clipped essential controls was observed. Small adjacent-button spacing was corrected.

[Visual proof and screenshots](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/Docs/testing/spec11-visual-proof.md>) records the local production-build target and inspection limits.

## 13. Provider/device proofs deliberately skipped

Real Auth email delivery/change confirmation, live provider password/reauthentication policy, real Stripe TEST account management, support/closure mail receipt and physical-camera permission/scanning remain later authorized provider/device gates. No external provider was contacted by browser fixtures, and no real email app was launched.

## 14. Release/configuration gates and remaining risks

- Apply the tracked migration through the normal release process and regenerate types after merging Spec 10.
- Supply approved monitored support/closure recipients and real Terms/Privacy URLs using the documented optional environment keys. Missing values intentionally keep the unavailable UI.
- Add the deployed `/organizer/settings/account` return destination to Supabase Auth's approved redirect configuration; verify real email confirmation and reauthentication behavior.
- Complete the provider/device proofs above before a release claim.
- **Inherited cross-tab signout race:** the installed main Auth SDK may clear a replacement session when another tab signs into B while A's remote signout is pending. The shared latch protects same-page duplicate actions and local sign-in is disabled while pending; it does not solve cross-tab SDK serialization. This was reproduced/reviewed as inherited behavior and remains an explicit Auth release risk. No SDK private-state manipulation or broad Auth rewrite was introduced.

No other introduced blocker remained in the bounded final review. This report establishes local implementation/test completion, not production deployment or provider readiness.
