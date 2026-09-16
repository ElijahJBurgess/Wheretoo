# Organizer signup and Stripe onboarding verification

Date: 2026-09-10. Scope: the supplied “Wheretoo V1 Spec — Organizer Signup + Stripe Onboarding” and journey board. Implemented in the current working tree; no commit or deployment performed. Existing unrelated buyer-journey changes were preserved.

## Behavior delivered

- Signup retains full name, email/password validation, Supabase Auth, immediate-session routing, and email confirmation.
- Check Email observes the existing Supabase session and continues to organizer setup once authenticated.
- Profile setup uses the existing organizer API, schema, ownership model, and onboarding timestamp. A successful first save now opens Payments. Completed returning organizers still go to Events.
- Supported profile fields are retained; bio/city sit in an optional disclosure. No logo picker was added because there is no organizer-logo persistence contract.
- Payments presents the payout decision, safe skip to Events, Stripe trust transition, existing embedded onboarding/management, canonical status views, and recovery.
- `not_started` uses the payout introduction on fresh/returning visits. An exit can show the local interrupted view only after a fresh `not_started` response. Canonical `pending`, `action_required`, `restricted`, and `ready` take precedence.
- Only `ready` shows the success checklist and event-creation action. Existing account management and Express Dashboard actions remain available.
- Session initialization, component/chunk failures, and status failures have working retries. A failed resume status check must be retried before another Account Session is requested.
- Local journey state is scoped to the organizer. Late responses after unmount/account switch cannot navigate or display another organizer’s Account Session.

## Files changed by this task

- `src/features/organizer-onboarding/OnboardingLayout.tsx`, `onboarding.css`, and `assets/organizer-night.webp` with provenance/prompt in `assets/README.md`.
- `src/components/layout/AuthLayout.tsx` and `src/app/router/OrganizerShell.tsx`.
- Auth signup, sign-in, and check-email pages; `auth.pages.test.tsx`; new `CheckEmailPage.test.tsx`.
- `src/features/organizers/OrganizerSetupPage.tsx` and its tests.
- `src/features/payments/OrganizerPaymentsPage.tsx`, `ConnectEmbeddedPanel.tsx`, and their tests.
- Existing preview imports, fixture renderer, and generated auth/profile snapshots (`src/preview/PreviewApp.tsx`, `screens.render.test.tsx`, `screens.json`).
- `tests/e2e/organizer-onboarding.config.ts`, `organizer-onboarding.spec.ts`, and the existing organizer journey helpers/visual spec updated for the approved labels and payout decision.
- This verification record.

Migrations added: **none**. No auth API, organizer persistence API, financial schema, checkout, webhook, ticket issuance, or paid-sales authorization changes.

## Verification

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed (application, integration, E2E, and scripts TypeScript projects) |
| `pnpm exec eslint . --ignore-pattern '**/.worktrees/**'` | Passed |
| `pnpm exec vitest run --exclude '**/.worktrees/**'` | 928 tests passed across 89 files |
| `pnpm build` | Passed; Stripe SDK remains a separate lazy-loaded chunk |
| `pnpm exec playwright test --config tests/e2e/organizer-onboarding.config.ts` | 5 browser journeys passed; four widths plus confirmation/returning-guard coverage |
| `deno test --allow-env` on Connect session/status endpoint tests | 11 passed; includes account idempotency, authenticated organizer scope, approved components, safe errors, and stale status handling |
| Local pgTAP organizer/event RLS, onboarding update, and ticketing RLS | 77 assertions passed across 3 suites |
| Local pgTAP `paid_sales.test.sql` | 35 assertions passed, including non-ready Connect rejection and owner-only activation |
| Visual QA sweep | 0 errors across 320×844, 390×844, 768×900, 1440×900; one expected desktop whitespace warning |
| Diff review | Independent review completed; identity-switch and pre-exit background-fetch races reproduced with failing tests, fixed, and rechecked |

The default Vitest/ESLint traversal includes unrelated nested `.worktrees`; the commands above exclude them. The initial paid-sales SQL invocation stopped at `POLICY_ENVIRONMENT_UNCONFIGURED`. It was rerun using a temporary copy with `private.configure_policy_environment('development')` immediately after `BEGIN`; all 35 assertions passed and the transaction rolled back. No persistent policy setting changed.

Browser tests use the real pages, router, Supabase client, React Query, and organizer save/navigation logic with controlled API responses. They never contact Stripe or create remote accounts. They check validation, both signup branches, profile save/cache behavior, skip, transition back, Account Session failure/retry, every canonical status on reload, event/dashboard destinations, session guards, one main landmark, minimum control geometry, and horizontal overflow. Unit tests additionally exercise embedded exits/failures, interrupted/resume precedence, initialization and lazy-chunk failures, focus recovery, duplicate-click protection, and late results after account switches/unmounts.

## Visual evidence

Current-render status: **verified for the local Wheretoo UI using explicit fixtures**. Live Stripe integration status: **not exercised**. Delivery status: **not applicable** (no deployment claim). Fix closure: **verified for changed Wheretoo screens**.

Target: locally launched Vite app in this repository at `http://127.0.0.1:3000`, using production route components with test-only public configuration. Actor: a new/returning organizer using synthetic fixture identity. Screenshot evidence is under `test-results/organizer-onboarding/` (ignored by Git). The signup sweep’s final evidence is in `/tmp/wheretoo-onboarding-layout-final/`.

Inspected captures include signup at 320/390/1440px; profile at 390px; payouts at 320/390/1440px; transition, pending, and error at 390px; ready at 390/768px; and Check Email at 390px. Browser geometry and journey assertions cover all four widths. The first generic sweep captured two SPA routes before lazy rendering; rerunning with `--ready-selector '#signup-title'` resolved those diagnostic failures.

Reference relationships reviewed:

| Relationship in supplied board | Implementation / verdict |
| --- | --- |
| Dark mobile canvas; content approximately 6–7% inset | 24px at 390px (6.2%); matched |
| Branding anchored at upper left; signup hero behind opening copy | Matched; decorative generated night-event image, with original prompt recorded |
| Serif headline about 2.4× body size | 34px/14px on mobile; matched |
| Three-step horizontal progress, completed steps distinguished | Matched; semantic current-step and completed labels |
| Full-width purple primary action and restrained outlined secondary | Matched; visible keyboard focus and reduced-motion handling |
| Large status icon with explicit text; compact readiness checklist | Matched; no timer or animation changes canonical status |
| Centered phone-scale composition on desktop | 448px frame; matched responsive requirement; the sweep’s whitespace warning is intentional |
| Stripe-hosted page pictured in board | Deliberately adapted to existing embedded Stripe components, as required by the supplied spec |
| Profile image/logo and minimal signup fields | Logo omitted due missing contract; required full name retained; optional supported profile details preserved |
| Connected screen event CTA followed by dashboard | Matched; existing management/Express actions retained below those primary actions |

## Remaining integration proof and setup

No new environment variables or database setup are required by the implementation. Normal app operation uses the existing Supabase/Stripe test-mode configuration.

A real Stripe test-mode organizer completing embedded verification end to end was **not** exercised in this run. The integration components and backend contracts were preserved and tested locally, but these results do not establish real Stripe verification completion, email delivery, or live hosted-app readiness.

The repository’s `/organizer-terms` is an existing development placeholder and there is no privacy-policy route. The signup screen uses the existing terms destination and leaves Privacy Policy as plain text. Final legal content/destination remains a pre-launch setup item. No dead support or privacy link was added.
