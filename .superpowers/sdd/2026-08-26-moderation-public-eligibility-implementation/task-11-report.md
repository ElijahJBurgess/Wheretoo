# Task 11 Report — Organizer Requirements and Agreement

## Outcome

Implemented the approved Build 2.5 Task 11 organizer flow only:

1. Basics
2. Date/location
3. Tickets/admission
4. Event details/requirements
5. Organizer agreement
6. Preview
7. Publish

The editor owns stages 1–5. Preview and Publish remain the existing routed stages and Task 12 retains ownership of publish/status/review-request integration.

## What changed

- Added one minimum-age choice and six compact yes/no event disclosures at the approved late stage.
- Added the exact one-checkbox organizer agreement, exact supporting copy, and server-returned Organizer Terms/Event Policy links.
- Kept React Hook Form authoritative for editable event, disclosure, and checkbox values; owner-scoped TanStack Query data hydrates persisted requirements and agreement status.
- Saved latest event content and requirements before invoking `acceptCurrentEventPolicies(eventId)`; acceptance is never inferred from a save.
- Allowed Preview navigation only after the acceptance RPC returns `needsAcceptance: false`.
- Reset displayed agreement state after revision-changing event or disclosure edits.
- Removed the published read-only milestone branch for owned published events and routed saves through `save_owned_event_revision`.
- Rejected mismatched returned event/organizer identity before reset or navigation.
- Preserved simple `Under review`, `Blocked`, and `Removed` owner status copy; edits never weaken status in the browser.
- Extended the existing route-aware unsaved-change blocker to cover disclosure and agreement form changes.
- Added public `/organizer-terms` and `/event-policy` development-placeholder pages containing only the founder-approved notices and the visible `Development placeholder` label.
- Added scoped responsive, focus-compatible, 44px-target, and existing reduced-motion-compatible styling without a new visual system.

## Files changed

- `.superpowers/sdd/2026-08-26-moderation-public-eligibility-implementation/task-11-report.md`
- `src/app/router/router.tsx`
- `src/app/router/router.test.tsx`
- `src/components/ui/StepRail.tsx`
- `src/components/ui/ui.test.tsx`
- `src/features/events/EventEditorPage.tsx`
- `src/features/events/EventEditorPage.test.tsx`
- `src/features/events/EventReviewStep.tsx`
- `src/features/events/event.api.ts`
- `src/features/events/event.api.test.ts`
- `src/features/events/event.queries.ts`
- `src/features/moderation/EventRequirementsStep.tsx`
- `src/features/moderation/EventRequirementsStep.test.tsx`
- `src/features/moderation/OrganizerAgreementStep.tsx`
- `src/features/moderation/OrganizerAgreementStep.test.tsx`
- `src/features/moderation/OrganizerTermsPage.tsx`
- `src/features/moderation/OrganizerTermsPage.test.tsx`
- `src/features/moderation/EventPolicyPage.tsx`
- `src/features/moderation/EventPolicyPage.test.tsx`
- `src/styles/global.css`

## Migrations

None. No database schema, remote mutation, Stripe, payment, or Build 3 work was performed.

## TDD evidence

RED was observed before production implementation:

- new requirements/agreement/policy modules were missing;
- StepRail/editor still exposed only three stages;
- published events still rendered the read-only milestone state;
- requirements persistence, acceptance gating, and published revision behavior were absent.

GREEN verification:

- Focused editor/steps/router/UI/API suite: 9 files, 60 tests passed.
- Non-Stripe application suite with disposable public environment values: 35 files, 296 tests passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed for application, integration, and E2E TypeScript projects.
- `pnpm build` with disposable public environment values: passed; 278 modules transformed.
- `git diff --check`: passed.

## Security and bundle review

- Acceptance calls send only `eventId`; the browser does not send policy versions, revision, digest, actor, organizer, or acceptance time.
- Published revision payload contains only approved event content fields and the event ID; it does not send organizer ownership or moderation/authorization fields.
- No private moderation table access was added.
- Returned event and organizer identity is checked before cache seeding, form reset, or navigation.
- Diff secret scan: no service-role, Stripe secret/webhook, OpenAI, Resend, private-key, or secret-key patterns found.
- Fresh built-bundle privacy/secret scan: no forbidden secret or private acceptance/disclosure contract patterns found.
- Scope scan: no env, migration, Stripe, or payment files changed. `.env.local` was not accessed.
- Changed UI uses direct static imports; no dependency was added.
- Vite still emits a warning that the main minified chunk exceeds 500 kB (737.03 kB, 211.79 kB gzip). Task 11 added no heavy dependency; route-level splitting was not introduced because this task explicitly requires direct/static imports and a focused change.

## Visual and accessibility verification

Current-render status: **partial**.

Audit contract:

- Artifact: local built Whereto SPA.
- Actor/job: anonymous visitor verifying the two non-production policy placeholders.
- Canonical diagnostic targets: `http://127.0.0.1:4173/organizer-terms` and `http://127.0.0.1:4173/event-policy` from the fresh local build.
- Viewports: 320×720, 375×812, and 1440×900 CSS pixels.
- Reference/SSOT: approved Whereto global tokens/typography/layout plus Task 11 exact-copy contract.
- Authorization: local diagnostic server and read-only navigation only; no credentialed or remote state mutation.

Verified:

- Both placeholder routes render the exact approved notice and visible `Development placeholder` label.
- Both routes had zero page-level horizontal overflow at 320, 375, and 1440 CSS pixels.
- Screenshots were opened and inspected; typography, wrapping, and centered single-notice composition were intact.
- Mechanical sweep found zero errors. Its warnings about no primary interaction, no section screenshot, and intentionally sparse desktop content are expected for these non-interactive single-notice placeholders.
- Component tests verify labels/error association, six semantic disclosure groups, keyboard-operable checkbox and policy links, one checkbox only, and no legal textbox/scroll box. Scoped CSS preserves 2.75rem (44px at the root size) control targets, and the existing global reduced-motion fallback covers the new surfaces.

Not verified:

- The authenticated organizer editor was not browser-smoked because Task 11 had no real credentials or safe authenticated fixture. Task 16 owns credentialed visual proof.
- No production/deployment freshness claim was made; delivery status is not applicable.

## Remaining risks or blockers

- Credentialed browser journey and visual proof for the editor remains for Task 16.
- The existing Vite main-chunk size warning remains visible as described above.
- No blocker prevents Task 12 from consuming the Task 11 contracts.

## Manual setup

None for this task. The existing Supabase migrations and Task 10 contracts must already be present in the target development environment for the authenticated flow to operate.
