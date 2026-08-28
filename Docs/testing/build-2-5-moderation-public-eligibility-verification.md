# Build 2.5 Moderation and Public Eligibility Verification

## Scope and safety boundary

This runbook verifies the completed Build 2.5 organizer, public, staff, reporting,
eligibility, and Build 3 map-dependency contracts. It does not start Build 3 and
does not exercise Stripe APIs, Stripe CLI, Stripe credentials, Stripe Edge
Functions, Stripe fixtures, or Stripe integration paths.

Run hosted commands only from the linked development worktree. Stop unless exactly
one linked project is `ACTIVE_HEALTHY`, local and remote migration history is fully
aligned, and `private.organizer_policy_release_settings.environment` is
`development`. Never reset the hosted database and never read `.env.local`.

## Browser harness contract

The canonical command is:

```bash
pnpm test:e2e:moderation
```

The enclosing shell harness confirms the development target, creates exact
disposable organizer, staff, event, report, review, evaluation, moderation-action,
eligibility, acceptance, disclosure, rate-bucket, and Auth fixtures, and starts the
committed `report-event` source locally with a one-run HMAC key. Playwright receives
only a Supabase publishable key and disposable user credentials. The exit trap
removes only the recorded fixture identities in foreign-key-safe order and fails the
run unless the exact post-cleanup residue count is zero.

The browser loader requires these names and never prints their values:

```text
TEST_SUPABASE_URL
TEST_SUPABASE_PUBLISHABLE_KEY
TEST_ORGANIZER_A_EMAIL
TEST_ORGANIZER_A_PASSWORD
TEST_ORGANIZER_B_EMAIL
TEST_ORGANIZER_B_PASSWORD
TEST_STAFF_EMAIL
TEST_STAFF_PASSWORD
TEST_MODERATION_FIXTURE_PREFIX
TEST_MODERATION_REPORT_FUNCTION_URL
TEST_MODERATION_REPORT_CLIENT_MOBILE
TEST_MODERATION_REPORT_CLIENT_DESKTOP
TEST_MODERATION_REPORT_EVENT_MOBILE_ID
TEST_MODERATION_REPORT_EVENT_DESKTOP_ID
TEST_MODERATION_STAFF_EVENT_MOBILE_ID
TEST_MODERATION_STAFF_EVENT_DESKTOP_ID
TEST_MODERATION_VISUAL_EVENT_MOBILE_ID
TEST_MODERATION_VISUAL_EVENT_DESKTOP_ID
TEST_MODERATION_MAP_ELIGIBLE_MOBILE_ID
TEST_MODERATION_MAP_ELIGIBLE_DESKTOP_ID
TEST_MODERATION_MAP_EXCLUDED_MOBILE_IDS
TEST_MODERATION_MAP_EXCLUDED_DESKTOP_IDS
```

Do not supply these through `.env.local`. The canonical runner generates and passes
them only to its child process. A missing or malformed value fails before browser
collection with names/bounded validation only; it never skips or reports a false
pass.

## Required journeys and evidence

The runner executes 14 tests serially at mobile `390x844` and desktop `1440x900`,
with explicit `320x844` reflow captures for dense screens. It proves:

- low-risk requirements, current-policy agreement, preview, immediate clear,
  public availability, material edit invalidation, reacceptance, and republication;
- high-risk hold, staff block, owner edit/republish preservation, public absence,
  and review request;
- anonymous keyboard reporting, bounded success, focus restoration, three-actor
  prioritization without auto-hide, and no reporter/provider detail in staff UI;
- exact-version staff conflict, focused recovery, current-fact reload, action, and
  restore;
- active-client removal in under 30 seconds; and
- pre-browser map-safe exclusion of draft, cancelled, held, blocked, removed,
  stale-revision, invalid-location, and ended rows.

The public route checks both the canonical paid projection and the free-event base
projection. Paid projection data retains precedence; free events render a public
shell without ticket tiers or checkout; absence from both projections renders not
found.

The visual inventory includes organizer requirements/agreement/preview/published
status, free public event/report dialog, both policy placeholders, staff
queue/case/conflict/feedback, and 320 reflow. Each captured route checks one visible
`main` and `h1`, no horizontal overflow, 44px non-link controls, reduced motion,
approved fonts/canvas, and keyboard focus indication on desktop. Touch emulation
verifies focus ownership without requiring desktop-only `:focus-visible` matching.
The repository has no compatible Axe dependency, so the run uses semantic
landmark/dialog/status/alert, keyboard, focus, target-size, contrast, and geometry
smoke without installing one.

The exact non-staff response from `get_my_staff_role` is an intentional authorization
diagnostic. Browser evidence allows only status 400 on that exact RPC path, correlates
every generic 400 console line to one observed denial, and asserts that ordinary
organizers do not receive the Moderation navigation link. Every other console error,
failed request, unapproved 400, or 401 remains fatal and is correlated to its exact
request path. The disposable sign-in helper primes the committed JWT-acceptance
probe before UI sign-in so a newly created account cannot race its first protected
RPC. The single staff conflict test also allows exactly one 400 on `moderate_event`
and proves the visible conflict recovery.

Screenshots and reports live only under ignored `test-results/`. Traces, video, and
automatic screenshots are disabled. Do not commit screenshot output. Staff identity
text is masked, and fixture labels contain no personal data.

## Database and application verification

Run the closed non-Stripe gates:

```bash
pnpm test:build25
pnpm test:functions:moderation
pnpm typecheck
pnpm lint
pnpm build
pnpm test:integration:moderation
pnpm test:e2e:moderation
git diff --check
```

`test:build25` is an exact unit/component file allowlist for the moderation feature
and directly affected event, public-event, router, and layout surfaces. It injects
only inert public configuration strings needed by import-time environment guards.
`test:functions:moderation` executes exactly
`report-event/index.test.ts` and `moderate-event-queue/index.test.ts`.

The moderation database runner uses the Build 2.5 pgTAP and moderation concurrency
allowlists plus the approved Task 15 database-compatibility allowlist. It excludes
checkout, Connect, webhook, refund/dispute, payment-concurrency, Stripe Function,
and Stripe integration paths. When the official linked pgTAP command is blocked by
the CLI Docker prerequisite, it uses the documented sequential linked-query
fallback, validates each test plan/result, and verifies no pgTAP or fixture residue.
It also checks public/private lint, ACL inventory, aligned history, and an empty
migration dry run.

The closed Task 15 compatibility children may create rollback-only or exactly
cleaned database rows for their existing contracts. They do not create external
payment objects, invoke a payment network, or use Stripe credentials.

The Build 2.5 publication regression proof follows the real UI order: an initial
complete requirements save moves the draft to `under_review`, a current exact-policy
acceptance is recorded, and low-risk publish may clear the current revision and open
eligibility version one only when the current revision/version is still proven to be
the organizer-edit invalidation. A later staff/system hold, a provenance-free hold,
high-risk hold, and blocked/removed enforcement remain in force and non-public.

## Pre-launch production policy gate

This checklist is a separate pre-launch gate. It is **not** a Build 2.5 completion
gate and is **not** a Build 3 planning or build gate. Real organizer/public launch
must remain blocked until all nine items are true:

1. Production Organizer Terms exist.
2. A production Event Policy exists.
3. Each document has a stable canonical HTTPS URL whose host uses valid DNS labels.
4. Each document has an approved immutable version identifier.
5. Each document has an effective date.
6. Each document has an exact content digest.
7. Neither required version is a `development_placeholder`.
8. `organizer_policy_requirements` references that approved pair and the authorized
   service/admin operation successfully changes the environment to `production`.
9. Real organizers accept the required production versions for the exact current
   event revision as appropriate.

The production configuration operation must reject the transition before items 1–8
are complete, leaving publication and public projections fail closed. Database proof
may exercise a synthetic valid production pair only inside a rollback transaction;
it must then prove either placeholder makes readiness false again.

## Recorded result — 2026-08-27

- Static browser inventory: 14 intended tests discovered; empty configuration listed
  exactly the 22 required names.
- Linked browser proof: 14/14 passed; exact cleanup verification passed.
- Build 2.5 unit allowlist: 27 files, 303 tests passed.
- Moderation Edge Function allowlist: 16 tests passed.
- UI-first publication pgTAP: RED at 1 failed of 75 before the first forward
  migration, then 75/75 passed. Independent review added the human/system-hold
  provenance regression, which was RED at 3 failed of 81 before its follow-up
  migration and then passed 81/81. The final lifecycle round passed 87/87 through
  migration head `20260826011475`, including active-event republication and paid
  tier preservation/activation boundaries.
- Production-policy URL proof passed 87/87, including canonical HTTPS, malformed
  DNS-host rejection, plain/encoded dot-path rejection, and the helper's exact
  private ACL/search-path contract. The owned daily
  retention scheduler proof passed 6/6.
- Published-edit proof passed 73/73. Both locked owner persistence boundaries reject
  payment conversion for a started published-free event before mutation and prove
  exact event/tier/authorization/moderation/eligibility state preservation, while
  future conversion, active-free nonpayment edits, and already-paid edits remain.
  The tier boundary also rejects non-owners before acquiring advisory or tier locks,
  then rechecks ownership after acquiring the established locks.
- Public eligibility, published-edit, all three moderation concurrency, and live
  public projection proofs passed.
- Canonical database/integration proof passed all 24 closed children through the
  documented linked-query fallback after the approved Task 15 `publish_event`
  compatibility expectations were updated for the low-risk clear path. Its exact
  pgTAP/fixture residue, ACL, lint, migration-history, and no-op dry-run checks
  passed.
- Post-review linked browser proof passed 14/14 with every secondary page observed;
  independent partial-setup cleanup contracts passed after both the first and second
  Auth identity, and the real run again reported exact cleanup success.
- The linked policy environment remained `development`, and production readiness
  remained false after verification.
- Bundled visual sweep: zero errors and zero horizontal overflow at `320x844`,
  `390x844`, and `1440x900`; only intentional centered whitespace/static-placeholder
  warnings remained. All 27 unique journey screenshots and six sweep screenshots
  were opened and inspected.
- Final canonical browser proof passed 14/14 in 2.2 minutes with the JWT readiness
  probe, every secondary-page observer, navigation-based published edit journey,
  active edit/reaccept/republish journey, and exact zero-residue cleanup.
- The active owned retention job and its service-role-only target were verified;
  the monitored rotation/failure runbook names `REPORT_FINGERPRINT_SECRET` without
  reading or recording its value.
- The prior final-fix independent review was clean before the authoritative
  persistence and dot-path corrections; the current final verdict is recorded only
  after fresh scoped and original global re-review.
- Exact fixture cleanup passed after every completed, failed, and interrupted browser
  run. No screenshot/report fixture residue is tracked.

The final independent review result is recorded in the Task 16 implementation
report and commit evidence.
