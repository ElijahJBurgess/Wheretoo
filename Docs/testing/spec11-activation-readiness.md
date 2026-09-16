# Spec 11 Activation / Implementation Readiness Report

Readiness inspection: 11 September 2026. Implementation is not authorized.

The organizer foundation is recoverable. The smallest safe implementation reuses Supabase Auth, the existing organizer row and revision-aware profile writer, the newer organizer operations shell, and existing Stripe Connect components. D09, D10, the implementation baseline, and the sensitive-flow adaptations below require owner approval first.

Source of truth: [Spec 11 PDF](/Users/exoh/Downloads/Wheretoo_Spec_11_Organizer_Settings.pdf), all ten pages, including visual inspection of R09 on page 10. The [pasted request](/Users/exoh/.codex/attachments/4ffd98fc-6b4b-4362-83ce-086bcefe4c33/pasted-text.txt) establishes the activation-only instructions. The three V1 product, flow, and architecture documents were also inspected. Historical handoff claims are distinguished from current source inspection throughout.

## 1. Current branch and HEAD

Actual repository: `/Users/exoh/Desktop/WhereTo -  Repository` (two spaces after the hyphen). The request's single-space path is not the active checkout.

- Current branch: `main`.
- HEAD and local `main`: `1d87c88fbb9da4ea4bf335659de7623af084c92e`.
- Locally recorded `origin/main`: the same commit. No fetch was performed; this is not a claim about GitHub's current state.
- Initial status contained 72 entries, including 40 tracked modifications/deletions and untracked directories/files. These include organizer onboarding, Auth pages, payments UI, buyer journeys, preview assets, a checkout migration, and user-owned visual references. A subsequent status contained an additional entry during the inspection; these workspaces are active, not frozen.

No application files, migrations, provider configuration, Git index, branches, or existing user files were changed by this pass. This report is the sole deliverable file. A final SHA-256 comparison of 1,688 recorded application/function/migration files found no changes in main, Organizer Create, or Spec 05 during report preparation. Ten files in Spec 07 changed independently: ticket-delivery source/tests and its preview screen catalog. This pass did not modify them. Spec 07 is actively moving and must be re-inspected before any later integration; its support component/configuration findings here are a point-in-time contract inspection.

## 2. Relevant worktrees and branches

All 20 registered worktrees were inventoried. Relevant Auth/profile/payment/router/migration files were compared across them; support/legal/Auth-edit capability searches included their source trees.

| Worktree | Branch and HEAD | Relevance |
|---|---|---|
| [Current checkout](</Users/exoh/Desktop/WhereTo -  Repository>) | `main`, `1d87c88` | Newer uncommitted signup/profile/embedded-payment UI and buyer work. Not the newest operations/scanner baseline. |
| [Organizer Create](</Users/exoh/Desktop/WhereTo-organizer-create>) | `codex/organizer-create-flow`, `1d87c88` | 102 initial status entries; inherited onboarding plus event creation changes and owned-event payment return support. |
| [Organizer operations](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-operations-v1>) | `codex/organizer-operations-v1`, `94c546bd0961f501584f8a3437298b2331cafd5c` | Clean at inventory; 15 commits beyond main. Dark shell, owner operations, refund/manual admission, private cache extension. |
| [Spec 04](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec04-integration>) | `codex/spec04-integration`, `94c546b` | 134 initial status entries; inherited onboarding/Create work, newer organizer reads. |
| [Spec 05](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in>) | `codex/spec05-check-in`, `94c546b` | 165 initial status entries; Spec 04 inheritance plus current scanner/manual-admission lifecycle and guest-search work. Critical sign-out dependency. |
| [Spec 06](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp>) | `codex/spec06-free-rsvp`, `94c546b` | 54 initial status entries; free-registration source and shared admission extensions. Preserve this boundary. |
| [Spec 07](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec07-ticket-email>) | `codex/spec07-ticket-email`, `94c546b` | 153 initial status entries; combined local ticket/email changes and optional support configuration. Not an approved organizer-support process. |
| [Final integration](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/final-integration>) | `codex/final-integration`, `1d87c88` | Clean but lacks current uncommitted onboarding/payment UI. |

The remaining worktrees cover older ticket truth, map, and preview work. None supplied a missing organizer-settings/Auth-edit/legal/closure implementation. Their unrelated work should remain untouched.

**Recommended implementation baseline:** a separately isolated, explicitly approved snapshot of the current Spec 05 working tree, including its inherited Spec 04/onboarding/Create dependencies. Preserve later Spec 06/07 integration boundaries and reuse only approved support configuration. Do not start from plain main, reset to the PDF's historical SHA, or copy the entire newest migration directory merely because its timestamps are largest. Re-inventory and fingerprint the selected source immediately before approved implementation; no worktree creation or inheritance copying occurred here.

## 3. Migration baseline

| Source | Files present | Highest local migration |
|---|---:|---|
| Committed main | 90 | `20260907010300_preserve_lite_ticket_invalidation.sql` |
| Current checkout / Organizer Create | 91 | `20260909010100_allow_checkout_preflight_status_refresh.sql` (untracked) |
| Organizer operations | 96 | `20260910010350_add_owned_refund_evidence_recovery.sql` |
| Spec 04 | 98 | `20260911010000_extend_spec04_organizer_reads.sql` |
| Spec 05 | 99 | `20260911020000_add_owned_admission_search.sql` |
| Spec 06 | 100 | `20260912010300_add_free_owner_reads_and_rate_limit.sql` |
| Spec 07 | 110 | `20260913010600_add_email_retention_and_recipient_suppression.sql` |

These are filesystem/commit baselines, not applied database versions. No local or hosted database migration ledger was queried, and no migration was created or applied. The out-of-order inherited checkout migration and parallel Spec 04-07 sets must be reconciled in the approved integration baseline.

Relevant existing contracts are the [organizer schema](</Users/exoh/Desktop/WhereTo -  Repository/supabase/migrations/20260824010000_create_organizers_and_events.sql>), [owner-only read hardening](</Users/exoh/Desktop/WhereTo -  Repository/supabase/migrations/20260826010400_route_public_reads_through_eligibility.sql:276>), [revision-aware profile writer](</Users/exoh/Desktop/WhereTo -  Repository/supabase/migrations/20260826010500_add_published_event_revision_paths.sql:626>), and its [strict payload validation](</Users/exoh/Desktop/WhereTo -  Repository/supabase/migrations/20260826010575_harden_revision_payload_types.sql:92>).

## 4. Current Auth and session implementation

Supabase email/password Auth is implemented through [auth.api.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/auth/auth.api.ts>). Installed Supabase JS/Auth SDK version is `2.112.3`. Signup stores `full_name` metadata, sign-in calls `signInWithPassword`, and sign-out calls `auth.signOut()`.

The [client](</Users/exoh/Desktop/WhereTo -  Repository/src/lib/supabase/client.ts>) persists sessions, refreshes tokens, and detects sessions in callback URLs. [SessionProvider](</Users/exoh/Desktop/WhereTo -  Repository/src/features/auth/SessionProvider.tsx>) uses `getSession()` and `onAuthStateChange`, protects against a late initial lookup replacing newer Auth events, and evicts private queries before changing identity.

Organizer routes nest `SessionShell → RequireSession → OrganizerShell → RequireOrganizer`. The organizer guard requires a persisted `onboarding_completed_at`; server RLS/RPC/Edge authorization remains separate. Edge [requireOrganizer](</Users/exoh/Desktop/WhereTo -  Repository/supabase/functions/_shared/auth.ts>) verifies the bearer with `auth.getUser(token)` and derives the organizer from that user's ID.

The [checked-in local Auth config](</Users/exoh/Desktop/WhereTo -  Repository/supabase/config.toml>) enables email signup, disables signup confirmation locally, enables dual email-change confirmation, disables secure password-change reauthentication locally, sets a 3,600-second JWT lifetime and a six-character provider minimum. The signup form requires 8-128 characters. Redirect configuration lists the local 3000 origins; runtime signup builds an `/organizer/setup` redirect.

**Configuration limitation:** the active checkout's `.env.local` targets a non-loopback Supabase service. Hosted Auth flags, redirect allowlist, password policy, SMTP, and applied schema were not remotely verified. The local TOML is not proof of hosted behavior. No provider mutation or message was attempted.

## 5. Organizer account identity source

Account identity is Supabase Auth `user.id`. Account name is `user.user_metadata.full_name`, persisted by signup in Auth metadata. It is a display value, not authorization evidence. There is no separate account-profile table or implemented account-name update UI.

Settings should read a fresh provider user through `getUser()`, project only the fields it needs, and update the existing metadata field if approved. `getUser()` performs a provider request rather than trusting a local session snapshot. [Supabase getUser documentation](https://supabase.com/docs/reference/javascript/auth-getuser).

## 6. Organizer public-profile source

`public.organizers.id` is a primary key referencing `auth.users.id`. Public organizer naming comes from `organizers.display_name`. Owner profile reads are protected by `organizers_self_read`; anonymous table reads were revoked by the later hardening migration.

Public event projections expose an allowlisted organizer object containing ID and display name. They do not expose the full organizer row. Bio, type, website, and base city are persisted owner fields, but their existence does not establish a public organizer-page contract.

## 7. Account name versus organizer name

Signup stores the account name in Auth metadata. First-time setup seeds an empty organizer name from that metadata. After persistence they are distinct sources; no ongoing synchronization was found.

Changing `full_name` must not update `display_name`. A public-name change has an existing product consequence: `save_owned_organizer_profile(p_profile)` invalidates revisions for non-cancelled owned events using `full_review`, queues review, and recalculates public eligibility. Direct name changes by an authenticated browser are rejected with `ORGANIZER_PROFILE_RPC_REQUIRED` when those events exist.

This is a material behavior to approve and explain before saving: a public-name edit can interrupt public eligibility until the established review/publication requirements are met. Do not bypass or weaken that boundary. Preserve order amounts and immutable purchase snapshots. The current frontend `saveOrganizer()` uses a direct table update and is therefore unsuitable as-is for established-organizer renaming.

## 8. Login email and verification

Login email belongs to Auth `user.email`. The installed Auth user contract includes `email_confirmed_at`, `new_email`, and `email_change_sent_at`; none is currently rendered in an account-settings UI. No second local login-email field exists.

Recommended V04 flow: load provider user → edit email → submit `auth.updateUser({email}, {emailRedirectTo})` → show current email and provider-reported pending email separately → refresh provider user after confirmation/return. Only the current email's provider confirmation can produce its verified badge. Do not infer pending-email expiry from the signup OTP setting or assume sending means delivery. On an expired/failed link, retain current account access and offer a fresh provider-supported verification action; do not claim an unsupported cancellation operation.

The installed SDK documents dual confirmation by default and supports email-change resend. Hosted configuration must determine the exact instructions shown. Supabase supports authenticated email and metadata updates through the existing user endpoint. [Supabase updateUser documentation](https://supabase.com/docs/reference/javascript/auth-updateuser).

`CheckEmailPage` is a signup page that redirects authenticated users to setup; it must not be repurposed as the email-change flow. `SignInPage` currently ignores the guard's saved destination and always navigates to events. Restoring a validated internal Settings destination after session expiry is a small required integration change.

## 9. Password change/reset capabilities

There is no implemented change-password, forgot-password, recovery callback, or reauthentication screen in the inspected worktrees. The SDK supports `updateUser({password})`, `resetPasswordForEmail`, reauthentication OTP, and a password update with a nonce.

**Smallest recommended V04 flow:** a focused Change password form inside Account & Security, using the existing authenticated provider operation, existing signup password validation as the UI baseline, and the actual provider's stronger policy/refusal responses. If reauthentication is required, use its OTP/nonce flow. Show success only after provider acceptance, clear secret inputs on success/unmount/identity change, disable repeat submission, and never store password-bearing mutations in a persistent query cache or preview fixture. [Supabase reauthenticate documentation](https://supabase.com/docs/reference/javascript/auth-reauthenticate).

A reset-by-email alternative requires a dedicated recovery route and session-event handling; sending a link alone is incomplete. It is not necessary to add that separate journey if the approved scope chooses authenticated Change password. If selected, implement the full provider recovery → new-password sequence and an expired-link recovery state. [Supabase resetPasswordForEmail documentation](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## 10. Supported organizer profile fields

| Existing field | Current validation | Spec 11 recommendation |
|---|---|---|
| `display_name` | Trimmed, 2-100 characters | Editable public organizer name through revision-aware writer. |
| `bio` | Optional, at most 500 characters | Editable; describe local preview accurately because no public bio projection exists. |
| `organizer_type` | Optional, at most 80 trimmed characters | Preserve; do not add another Settings control merely because it exists. |
| `website_url` | Optional, at most 500, lowercase HTTP(S) scheme | Preserve unless explicitly editing under an approved expanded form. |
| `base_city` | Optional, at most 120 trimmed characters | Preserve. |
| `country_code` | Two uppercase letters; setup writes US | Preserve; not a new country-switching product. |
| `onboarding_completed_at` | Nullable timestamp | Preserve exactly for Settings edits. |
| `created_at`, `updated_at` | Database timestamps | Read as needed; use `updated_at` for conflict detection if approved. |

Reuse [organizer.schemas.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/organizers/organizer.schemas.ts>) and field primitives. The [current save API](</Users/exoh/Desktop/WhereTo -  Repository/src/features/organizers/organizer.api.ts>) replaces the mutable payload, forces country US, and assigns a new onboarding timestamp. It also uses `select('*')` for reads/write returns. Adapt the underlying contract for Settings instead of mounting `OrganizerSetupPage` or calling that save path unchanged.

## 11. Organizer logo persistence

**D09 / persistence gap.** No organizer logo/avatar field, upload API, bucket/object ownership policy, or persisted logo retrieval contract was found. No logo storage contract appeared in the relevant local worktrees.

Smallest choice: initials or a neutral identity placeholder with no upload control. Adding upload requires separately approved storage, validation, attachment persistence, access policy, and lifecycle work. Event artwork is not compatible evidence.

## 12. Public contact email

**D09 / persistence gap.** No organizer public-contact column, schema property, API, or public read projection exists. The private Auth email used server-side as Stripe account contact is not public profile contact.

Smallest choice: omit the field and its preview row. A later opt-in public address needs approved persistence, validation/verification policy, and a narrow public read contract. Never seed it from `user.email`.

## 13. Public organizer preview

No public organizer-profile route exists in the inspected routers. Existing public organizer identity is embedded in event data.

Smallest choice: a read-only preview within the authenticated Settings shell, labeled “Profile preview — not a public page.” Use only the organizer name and bio from the saved profile, identify bio as proposed presentation rather than already public, and omit account name, login/pending email, IDs, Stripe status, and unsupported fields. An Edit-mode preview may be labeled “Unsaved preview”; it must not imply persistence. No public route or social feature is required.

## 14. Stripe Connect and management implementation

Existing [payment API](</Users/exoh/Desktop/WhereTo -  Repository/src/features/payments/payment.api.ts>) calls three owner-authenticated Edge functions with empty bodies:

- `stripe-connect-status`: looks up the existing TEST account, retrieves canonical provider capabilities, and persists a sequenced refresh. No account returns `not_started`; provider/read failure returns an error.
- `stripe-connect-session`: reuses the bound account. Only explicit setup for an organizer with no account creates one, using an organizer-specific idempotency key and unique binding. Opening a Settings page must call status, not automatically call this creation-capable endpoint.
- `stripe-express-login`: looks up the existing account and asks Stripe for a login link; it does not create an account or use a hard-coded dashboard URL.

The configuration is Accounts v2 recipient, Express dashboard, USD, US creation identity, application fee/loss responsibility, Stripe-collected requirements, and requested transfer capability. Service-side account access and TEST-only guards are retained.

[StripeConnectEmbedded](</Users/exoh/Desktop/WhereTo -  Repository/src/features/payments/StripeConnectEmbedded.tsx>) uses `ConnectAccountOnboarding`, `ConnectAccountManagement`, and `ConnectNotificationBanner`. The lazy panel supports load errors and retry. Exiting it refreshes canonical status; local exit/interrupted state is not financial readiness.

Organizer Create and Spec 04/05 contain a newer [payment return implementation](</Users/exoh/Desktop/WhereTo-organizer-create/src/features/payments/OrganizerPaymentsPage.tsx>) that validates `eventId`, rechecks owned event and Connect state, and returns to the same event preview without saving or publishing. Preserve it. The current main checkout lacks this addition.

Generic payment mounts currently inherit a 30-second query stale window; the newer `fresh` argument is used for event-return context. Settings needs fresh canonical status on mount and Stripe return, including browser history/back-forward restoration, with an explicit unavailable/retry state after refresh failure.

## 15. Exact Connect fields available

[ConnectStatus](</Users/exoh/Desktop/WhereTo -  Repository/src/features/payments/payment.types.ts>) exposes:

| State | Response fields |
|---|---|
| `not_started` | `status` only |
| `pending`, `action_required`, `restricted`, `ready` | `status`, `requirements_currently_due_count`, `requirements_past_due_count`, `last_status_code`, `last_synced_at` |

The [server projection](</Users/exoh/Desktop/WhereTo -  Repository/supabase/functions/stripe-connect-session/connect.ts:174>) maps active transfers + active payouts + clear requirements to `ready`; action-required and restricted have explicit precedence before pending. Internally persisted `transfers_status`, `payouts_status`, and `requirements_status` are not individual browser response fields. Direct browser access to `organizer_stripe_accounts` is revoked.

The account-session response additionally contains a short-lived `client_secret`, for the embedded component only. Express returns a provider-generated URL. Neither belongs in Settings read models, logs, screenshots, or retained mutation history.

## 16. Unsupported payout claims

Omit the reference's separate “Payout status Active,” “Charges Enabled,” and “Payout method Configured” rows. The browser contract does not return those facts, and this is a recipient account rather than a merchant-card-capability projection.

Also omit balances, bank identity, payout schedules, instant payout entitlement, cash-out controls, guaranteed payouts, and payout timing. Recommended `ready` wording: “Stripe setup ready for paid ticket sales,” subject to the existing event/checkout safeguards.

The inherited payments UI currently says “your payouts are ready” and “Payouts configured.” Those lines must be narrowed in the shared presentation when adapting it; reusing code must not preserve unsupported claims. No Stripe read extension is necessary for the recommended V1 display.

## 17. Current support destination

Current main has no configured organizer-support destination or Contact support/Report a problem transport. Its public environment schema contains no support setting.

Spec 07 adds [DeliverySupport](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec07-ticket-email/src/features/ticket-delivery/DeliverySupport.tsx>), an optional validated `VITE_TICKET_SUPPORT_EMAIL` mailto link, and `TICKET_EMAIL_SUPPORT_EMAIL` for ticket emails. Example values are empty and comments require approved, monitored support. That is reusable configuration precedent, not proof of a functioning mailbox or organizer-support authorization. No configured value for those keys was found in the current checkout's inspected local environment file; monitoring cannot be established from source.

The existing `report-event` function is an event-moderation reporting contract, not a settings/support case system. Do not repurpose it. The reference address is not approved.

## 18. Terms and Privacy

`/organizer-terms` and `/event-policy` exist. Their [components](</Users/exoh/Desktop/WhereTo -  Repository/src/features/moderation/OrganizerTermsPage.tsx>) explicitly display development placeholders, not finalized documents. Signup links Organizer Terms and displays Privacy Policy as plain text.

No general Terms of Service or Privacy route/content was found in the inspected worktrees. Existing policy registries for publication consent do not supply those missing documents. Owner-approved document content and correct destinations are required before working Terms/Privacy controls can be exposed. Do not relabel Event Policy as Privacy or Organizer Terms as general Terms.

## 19. Current sign-out behavior

The shell calls `signOut()`, then navigates to sign-in on success; errors are currently surfaced from the exception. No pending latch prevents duplicate sign-out clicks. The SDK default is global sign-out. Its current implementation may remove the local session while still returning an error from remote revocation, so “Sign out failed” cannot safely mean “still signed in.” Report local session state separately from unconfirmed remote outcome.

Main evicts owner event, organizer, owned ticket, Connect, and private moderation queries on identity change. The newer [privateQueryCache](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/auth/privateQueryCache.ts>) adds organizer-operations queries and removes keyed organizer-operations mutations.

Gaps: profile and Connect account-session mutations are unkeyed, and late successful mutations can repopulate an old user's cache after eviction. Connect mutation results may retain client secrets. Cleanup must cover the Settings/auth/profile/payment mutation lifetime and suppress late callbacks using the initiating identity/session generation. Removing a mutation from the cache does not cancel its side effects.

Spec 05 manual admission also has an owner/event/ticket-scoped in-memory uncertainty marker outside React Query. Any cleanup must preserve the rule that an uncertain admission is rechecked before retry; clearing UI state must never manufacture permission to resubmit. A new authenticated lifetime must reload authoritative ticket state before permitting admission.

Guest collection routes and bearer access are outside organizer Auth. Never use `localStorage.clear()`, wipe all queries indiscriminately, or delete guest ticket access/financial history as sign-out cleanup.

## 20. Scanner/camera teardown

Main's scanner controller aborts admission transport and calls decoder stop on unmount, but its scanner component is not explicitly keyed to organizer identity. The newer [OperationalScanner](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/OperationalScanner.tsx>) keys the scanner to owner and event, suppresses aborted results, and preserves the scanner during generic background-metrics failure while removing it on confirmed access denial.

Spec 05's [cameraDecoder](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/ticket-experience/scanner/cameraDecoder.ts>) stops controls and attached media tracks, clears `srcObject`, and handles late initialization/decodes. Its controller aborts on unmount. Leaving the session guard or navigating from scanner to Settings must exercise those existing paths. The newer check-in routes are home, `/scan`, `/find`, and focused guest detail; preserve them.

This is source-backed lifecycle behavior, not a new physical-camera test. Sign-out during camera permission/initialization, active scanning, and an in-flight admission needs explicit later proof.

## 21. Closure-request capability

No organizer closure request page, endpoint, request record, approved recipient, acknowledgment mechanism, or authorized review process was found. Ticket delivery/resend and event reporting are different contracts.

No account deletion should be added. A mail client opening does not prove submission or receipt. Active events, transactions, refunds, tickets, and the Connect account remain intact while an authorized human reviews a request.

## 22. D09 recommendation and smallest V1 option

**D09 — OWNER DECISION REQUIRED**

| Item | Classification today | Recommended choice |
|---|---|---|
| Organizer logo | Persistence/schema/storage change needed | Defer upload; neutral placeholder/initials. |
| Public contact email | Persistence/schema and public read change needed | Omit. Never expose login email. |
| Public profile preview | Supported with existing contract for a private preview; no public route | Authenticated, clearly labeled read-only preview; no new public profile product. |
| Separate payout capability details | Read extension needed | Omit separate rows and keep canonical status. |
| Payout-method/balance/instant payout details | New provider/read capability needed; not needed for V1 | Omit. |

Approval of this option adds no logo/contact storage and no Stripe field extension. Separately approve the profile-save concurrency safeguard described in item 24 and the public-name review consequences in item 7.

## 23. D10 recommendation and smallest V1 option

**D10 — OWNER DECISION REQUIRED**

Approve one actual monitored support destination for both Contact support and Report a problem, plus a named human owner of closure reviews. If using email, the UI says “Open email app,” shows the address for manual use, and never reports submission. Reuse Spec 07's optional configuration pattern only after its recipient is approved for organizer requests.

For closure, show a small request-intent confirmation, explain manual review, and compose a message containing only the account's current login email and organizer name, with an optional reason. No bearer, password, buyer data, provider payload, or financial details belong in the link. Human staff must verify account control before acting; a typed email alone is not authorization. The acknowledgment is a real human reply after receipt, not a UI toast. No SLA, case number, or completion date is promised without a real process.

Provide separately approved general Terms and Privacy documents/URLs. Until supplied, show an honest unavailable state or omit actionable links; these remain launch/content blockers, not completed Help & Legal.

This option requires configuration and an operational process, not a support database or deletion backend. If the owner requires in-app “Request submitted,” a real receiving/acknowledgment endpoint is a separate approved contract and exceeds this smallest option.

## 24. Necessary schema/storage changes

No new organizer table, account table, login-email column, logo bucket, public-contact column, Stripe account model, or closure table is needed for the recommended D09/D10 scope.

**One narrow database-function migration is recommended for safe profile edits.** The existing RPC accepts a complete seven-field payload, including onboarding completion, and has no expected-version input. A client re-read followed by that RPC cannot atomically prevent stale overwrites.

Proposed contract: an authenticated owner Settings save with only bounded `displayName`, `bio`, and `expectedUpdatedAt`; retain other fields and onboarding completion on the server; compare the version inside the transaction; return an explicit conflict rather than overwriting a concurrent edit. Reuse the existing revision-aware writer and its event/tier/organizer locking order. Do not introduce organizer-first locking in a wrapper that would invert that order. Return an allowlisted owner projection and keep existing onboarding callers compatible.

This is a function/contract extension using existing columns, not a new profile model. Its exact SQL must be reviewed and tested after approval. A smaller no-migration alternative is the existing full-profile RPC with explicitly accepted last-write-wins behavior; that is not the recommended safe option because concurrent edits and hidden-field preservation are harder to guarantee. No such migration or behavior change was implemented here.

## 25. Reusable files, services, and components

| Responsibility | Reuse |
|---|---|
| Auth/session | [auth.api.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/auth/auth.api.ts>), [auth.schemas.ts](</Users/exoh/Desktop/WhereTo -  Repository/src/features/auth/auth.schemas.ts>), [SessionProvider.tsx](</Users/exoh/Desktop/WhereTo -  Repository/src/features/auth/SessionProvider.tsx>), existing Supabase client. |
| Guards/routes | [router.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/app/router/router.tsx>), [RequireSession](</Users/exoh/Desktop/WhereTo -  Repository/src/app/router/RequireSession.tsx>), [RequireOrganizer](</Users/exoh/Desktop/WhereTo -  Repository/src/app/router/RequireOrganizer.tsx>). |
| Desktop shell | [OperationsUi.tsx](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/OperationsUi.tsx>) and its existing CSS, via the newer OrganizerShell. |
| Profile | Existing organizer schema, query keys/hooks, owner RLS, strict profile RPC and moderation revision behavior. Reuse form primitives rather than the setup page's completion redirect. |
| Payments | Existing payment API/queries, canonical status type, embedded panel, Stripe component, Express login, sequenced server refresh, and owned-event return flow. |
| Forms/states | [Field](</Users/exoh/Desktop/WhereTo -  Repository/src/components/ui/Field.tsx>), [Button](</Users/exoh/Desktop/WhereTo -  Repository/src/components/ui/Button.tsx>), [FormErrorSummary](</Users/exoh/Desktop/WhereTo -  Repository/src/components/ui/FormErrorSummary.tsx>), [AsyncState](</Users/exoh/Desktop/WhereTo -  Repository/src/components/ui/AsyncState.tsx>), React Hook Form/Zod. |
| Sign-out safety | Newer private-query/mutation cleanup, owner/event component keys, abort/lifetime handling, existing decoder track cleanup. |
| Support precedent | Spec 07 DeliverySupport validation/optional configuration; reuse recipient only after approval. |

## 26. Missing contracts

Missing or needing adaptation: complete Settings routes/shell; authenticated fresh account read; account-name update UI; truthful email-change/current-pending/recovery UI; password-change/reauthentication UI; configured hosted Auth behavior; explicit owner profile projection; atomic conflict-safe Settings save; Settings-specific payment presentation and return refresh; comprehensive identity mutation cleanup; approved support recipient/process; general Terms and Privacy; closure transport/acknowledgment/reviewer.

Logo and public contact persistence are deliberately omitted under the recommended D09 choice. Public preview is a labeled local adaptation. V04 substates use the existing shell rather than inventing backend authority.

## 27. Exact incremental implementation sequence

Each step is conditional on D09, D10, and plan approval. No implementation starts from this report alone.

1. **Freeze the approved baseline.** Record HEAD, tracked/untracked inheritance hashes, migration set, and ownership of shared router/shell/payment/Auth files. Use an isolated copy of the approved Spec 05 working state; reconcile later operations/email changes deliberately. Establish baseline checks with synthetic configuration before edits.
2. **Secure the shared identity lifetime.** Extend private cleanup to keyed Settings/profile/payment mutations; avoid retaining passwords or Connect secrets in query caches; prevent late callbacks from repopulating old identity state. Share one pending/error-aware sign-out action between shell and Settings. Preserve guest access and admission uncertainty recovery.
3. **Add profile read/save contracts.** Replace browser wildcard selections with explicit owner projections. Add the approved function migration with current owner, bounds, preserved hidden/onboarding fields, conflict result, and existing name-change revision behavior. Add API/hook support without replacing first-time setup. Write owner A/B, anonymous, direct-bypass, hidden-field, concurrency, and publication tests before implementation.
4. **Add Settings navigation in the existing shell.** Implement the six routes below, section context, deep-link reload, and explicit mobile return. Reuse the dark operations shell without adding unrelated Orders/Analytics entries. Preserve event-scoped navigation and current payment URLs.
5. **Implement Account & Security.** Fresh provider account read; independent name form; current/pending email and provider confirmation; Change password with provider-required reauthentication; safe errors and expired-session return. Add a recovery route only if the owner selects reset-by-email instead. Verify configured provider behavior before exposing its sensitive flow.
6. **Implement Organizer Profile.** Edit/Save/Cancel for name and bio; saved-state preview; bounded validation; failed-save value retention; duplicate-submit latch; conflict reconciliation. Explain name-change review consequences. Omit deferred logo/contact controls.
7. **Adapt Payments & Payouts.** Reuse existing journey/controller and embedded components, with a Settings presentation mode. Preserve first-time onboarding and `?eventId=` resume behavior. Use canonical status copy, omit unsupported rows, request a fresh status on entry/return, and expose the existing Express management action.
8. **Implement approved Help & Legal and Account Actions.** Wire real approved documents/contact configuration; show unavailable states for unresolved content. Add the approved manual closure-intent/mail handoff, with truthful receipt semantics. Reuse shared sign-out.
9. **Verify the complete Settings journey.** Execute item 29, inspect actual R09 comparisons and diffs, document local/provider evidence separately, and report remaining environment gates. Commit/merge/push/deploy remain separate authorization decisions.

Proposed routes, all under the existing session and organizer guards:

| Route | Purpose |
|---|---|
| `/organizer/settings` | Compact mobile index and desktop section overview. |
| `/organizer/settings/account` | Account & Security; focused edit states remain within it. |
| `/organizer/settings/profile` | Organizer Profile and local preview. |
| `/organizer/settings/payments` | Preserve canonical destination and validated event-return query. |
| `/organizer/settings/help` | Help & Legal. |
| `/organizer/settings/actions` | Sign out and manual closure request intent. |

Mobile sections have a visible “Back to Settings,” independent of browser history. An explicit event-resume action returns to the validated owned event. The payments route is currently excluded from the organizer shell and always uses OnboardingLayout; it needs context-aware presentation, not a second account setup. Initial setup can supply explicit presentation context while preserving its existing redirect contract.

Shared form behavior: load/error/retry → view → edit → pending → confirmed save or failure. Cancel/Back with changes requires a consistent discard choice; navigation must not silently erase drafts. Preserve non-secret values after failed save. Refetches must not overwrite dirty values. A version conflict retains the draft and offers reload/reconcile rather than silent resubmission. Authentication loss clears sensitive state and offers return after sign-in. Use semantic labels, focusable errors, focus restoration, and no animation-only status.

## 28. Expected files/modules to change

Paths below identify the inspected source location; equivalent paths in the approved isolated baseline are the future edit targets.

- [Router](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/app/router/router.tsx>) and route tests; [OrganizerShell](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/app/router/OrganizerShell.tsx>); OperationsUi navigation/CSS for Settings entry and existing shell reuse.
- Auth API/schema extensions, SessionProvider and its tests, privateQueryCache and its tests; SignInPage for a validated return destination. Add one cohesive shared sign-out hook/controller under the existing Auth feature.
- Organizer API/queries/schema types and tests; explicit owner projection; separate Settings save adapter. Preserve OrganizerSetupPage behavior and its tests.
- OrganizerPaymentsPage and tests, payment query freshness tests, and OrganizerPaymentsReturn tests. Reuse ConnectEmbeddedPanel/StripeConnectEmbedded; change them only if the approved session-cleanup/presentation integration requires it.
- New Settings pages and small shared layout/form-state modules under `/Users/exoh/Desktop/WhereTo -  Repository/src/features/organizer-settings/`: SettingsLayout, SettingsIndexPage, AccountSecurityPage, OrganizerProfilePage, HelpLegalPage, AccountActionsPage, and scoped CSS/tests. No generated imagery is required for missing substates.
- One new, approval-dependent function migration under `/Users/exoh/Desktop/WhereTo -  Repository/supabase/migrations/`, generated database types, and focused SQL ownership/concurrency tests. Choose its timestamp only after the integration migration head is frozen.
- Approved support/legal configuration, environment examples and browser allowlist only as needed; actual legal destinations/content supplied by owner. No invented legal pages.
- New Settings E2E suite/config under `/Users/exoh/Desktop/WhereTo -  Repository/tests/e2e/`; extend existing SessionProvider, operations privacy, and scanner lifecycle regression coverage. Decoder/admission business logic should not need rewriting.
- A later verification record in `/Users/exoh/Desktop/WhereTo -  Repository/Docs/testing/`.

## 29. Verification sequence

**During this activation:** Git/worktree/status/history inspection; comparison of relevant source and migration files; PDF text extraction and R09 rendering/inspection; Auth SDK/config and official documentation review; searches for support/legal/storage/closure contracts; inspection of existing tests and handoff evidence. The completed report was checked for all 31 numbered sections, 44 valid local source links, the required ending, and whitespace errors. Source-hash comparison and its concurrent Spec 07 changes are recorded in item 1. No application test, build, provider test, SQL mutation, or browser sign-out was executed. Existing pass counts are not reported as current verification.

**After approval, in order:**

1. Run baseline and post-change `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `git diff --check` in the selected isolated tree. Use explicit synthetic public configuration; the current `.env.local` points at a hosted service. Report exact counts and inherited failures. Run `pnpm test:functions` and `pnpm typecheck:functions` when function/shared contracts are affected; inspect runner permissions before use.
2. Use a new disposable local database for the selected migration set. Test owner A/B/anonymous reads and saves; submitted identity cannot authorize a write; invalid/extra fields and broad grants fail; completion and hidden fields remain unchanged; stale expected version produces conflict; simultaneous saves serialize; name edits preserve revision/moderation protections and purchase snapshots. Do not use a shared reset runner.
3. Frontend fixture/API tests: six sections, completed organizer with no setup restart, direct links/refresh/mobile Back, restored destination after sign-in, all form transitions, failed-save retention, discard, long names/email/bio, account/public-name separation, no private email in preview, absent deferred controls.
4. Auth contract fixtures: fresh verified/unverified/current/pending email, refusal/rate limit, expired confirmation, changed or expired session, reauthentication requirement, password success/failure, and late owner A → B → A results. Assert no credentials in logs/URLs/fixtures/query history. These are fixtures until tested against the approved provider.
5. Connect fixtures and handler tests: all five statuses; lookup failure versus genuinely missing account; failed status refresh with stale cached ready data; embedded load/refresh failure; explicit management; browser/embedded return; no account creation merely from mounting Settings; existing account ID reused; unsupported payout rows absent; owned-event return preserved.
6. Help/actions fixtures: approved support/mailto and manual address fallback; unavailable config/content; exact document labels/destinations; closure intent/cancel/mail handoff with no false acknowledgment; no deletion or provider-disconnection calls.
7. Identity/scanner regression: sign-out success, remote error with local session removed, pending requests, query and mutation eviction, late cache writes blocked, no old identity flash, camera tracks stopped during normal and late initialization, background metrics behavior retained, new owner/session performs authoritative admission reads, unrelated guest collection access remains usable.
8. Real-browser visual/accessibility proof at 320, 390, 768, and 1440 pixels against R09: desktop shell, mobile compact index/detail, long-content wrapping, keyboard order, labels/errors, contrast, focus restoration, reduced motion, unsaved-navigation prompts. Use synthetic identities and no real buyer information or QR/bearer values in evidence.
9. Only with separately approved environment/accounts/recipients: real Supabase Auth email-change confirmation, pending/failure/expiry, password/reauthentication, sign-out/session expiry; Stripe TEST existing-account management and canonical return refresh. Verify actual redirect and SMTP configuration first. Physical-camera proof is a separate device test. Do not execute live financial operations.

## 30. Local/synthetic versus real provider evidence

| Evidence | Status for this report |
|---|---|
| Current on-disk code/migration/config inspection | Performed. |
| R09 visual reference inspection | Performed from rendered PDF page 10. |
| Newly run unit/build/SQL/E2E checks | None; activation-only contract report. |
| Historical onboarding proof | Existing report describes local/fixture verification, explicitly not live Stripe. Inspected as historical evidence. |
| Historical Spec 05 proof | Existing report describes disposable SQL, synthetic camera/decoder-to-SQL and race tests. Auth verification/provider history were synthetic; no physical-camera proof. Not rerun. |
| Hosted Auth configuration and email/password behavior | Unverified. Source/SDK capabilities are not provider acceptance or delivery evidence. |
| Stripe TEST management/return | Existing implementation inspected; not exercised in this pass. |
| Support mailbox receipt/monitoring and closure acknowledgment | Unverified and not owner-approved. No messages sent. |
| Applied local/hosted migration version | Unverified; repository migration sets recorded only. |

No fresh Settings feature-completion claim is made. The report neither certifies deployment nor treats a mock component or prior passing count as provider proof.

## 31. Blockers requiring owner approval

1. **D09 — OWNER DECISION REQUIRED:** approve deferring logo/public contact, the labeled private preview, and omission of unsupported payout detail rows.
2. **D10 — OWNER DECISION REQUIRED:** supply/approve the monitored organizer-support destination, correct general Terms and Privacy content/URLs, and closure-review recipient, identifying information, human verification process, and acknowledgment semantics. Missing documents/contact remain release blockers even if an unavailable UI is approved for development.
3. **Baseline and plan:** approve the isolated Spec 05 working-state baseline with preserved inheritance and explicit coordination of overlapping Spec 06/07/router/payment/Auth work. Approve the incremental sequence before any application edits.
4. **Profile behavior:** approve the public-name moderation/public-eligibility consequence and the one function-only concurrency/preservation migration. No logo/contact schema or storage expansion is included.
5. **V04 Auth presentation:** approve authenticated Change password as the smallest flow, provider-controlled email-change states, and fresh account reads. Confirm the actual target Auth configuration before implementing provider-dependent behavior; approve a full reset-by-email journey separately if preferred.
6. **Later real verification:** approve the exact test environment, disposable accounts, email recipients and existing Stripe TEST account for provider-changing proof. No real provider operation is authorized by this readiness report.

Manual setup after those decisions consists of the approved contact/legal content, verified Auth redirects/password/email policies, the reviewed function migration on the approved environment, and designated provider-test accounts. No setup was performed now.

READY FOR SPEC 11 OWNER DECISIONS
