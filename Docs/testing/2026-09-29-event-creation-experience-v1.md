# Event Creation Experience Cleanup V1 — Build + Prove

Date: 2026-09-29. The Build + Prove sections below record the pre-approval snapshot. Founder subsequently approved Git/GitHub closeout; see the closeout addendum.

## Result

**PASS — ready for founder review and subsequent commit/merge review.** Final HEAD remains `4a406fcee0098a7ac95b153de99c6039cafd49bc`; all 26 changed/new files remain uncommitted and unstaged. No feature-only regressions remain in the completed proof.

## Safety and architecture

Fetched origin/main before implementation and confirmed expected baseline `4a406fcee0098a7ac95b153de99c6039cafd49bc`. Created isolated native worktree `/Users/exoh/.codex/worktrees/event-creation-experience-v1/WhereTo -  Repository` on `codex/event-creation-experience-v1`. HEAD stays at baseline. Original dirty checkout and canonical main were preserved. No migration, backend function, payment file, dependency, event schema or hosted configuration change.

Creation still uses existing internal route identifiers, save operations, conditional context tokens and ownership fences. Four visible stages group those routes: **Details → When & Where → Admission → Review**. Paid tiers remain an internal Admission step. Normal editing keeps its existing routes/steps.

## Product changes

- Details contains a compact optional image thumbnail/placeholder, Upload image and Generate with AI. Review no longer repeats image editing.
- Normal editing initially shows only a compact image and Change image. Upload/replace/remove and AI are available after that explicit action.
- AI opens a compact inline panel. Existing three-candidate generation/selection contracts remain; successful selection closes the panel. A first AI action creates one saved draft; one-time route state is consumed so reload does not reopen a closed panel. No automatic new generation is added.
- Start/End each have native Date and Time inputs, Pacific Time shown once, and associated validation. Partial halves remain in form state and fail existing schema validation. No end defaults or timezone choice were introduced.
- Unchanged saved timestamps retain exact original seconds/fractions and the later occurrence of an ambiguous wall time. Changed values use the existing Los Angeles converter and its earlier ambiguous-time convention.
- A verified address replaces the search interface. Change invalidates it and returns focus to search. Search/no-result/retry feedback is friendly; normalization and request lifetime guards remain unchanged.
- Summary includes image when available, title, description, category, start/end, venue/address, and free or tier-count admission.

## Verification boundaries

All browser work used the dedicated local Supabase API at `http://127.0.0.1:59521` and Vite on 3094. A private ignored fixture contains only local credentials/session. Existing `tests/integration/public-availability-local.py setup` creates synthetic local organizer/events and development policy fixtures; no hosted legal agreements were accepted. Local conditional save, disclosures, acceptance, tier and publish RPCs were real.

Mapbox suggest/retrieve, image upload/storage, and AI generation/selection transports were injected. UI provider failures and image state persistence across reload were exercised, but no real AI quality, storage service, geocoding service or live payment readiness is claimed. Fake local Connect readiness allows paid prerequisite proof without Stripe calls or charges. Browser interception blocks all other external origins. No real email was sent.

The existing local publication migration was already present from the prior feature. This task adds/applies no migration. No new SQL inventory was run because backend contracts/implementation are unchanged. Prior SQL results are not presented as fresh proof.

## Evidence

Logs live in ignored `.superpowers/event-creation/`; screenshots in ignored `test-results/event-creation-experience/`.

- Initial full frontend baseline: 1,789 pass / one Node/tsx renderer timeout under load. Isolated baseline test passed.
- First feature-wide full run: 1,801 pass / three timing failures (Node/tsx renderer, organizer dashboard waiting for data, ticket email HTTP bridge waiting for data). Those unchanged suites passed together: 27/27 with two workers. No unrelated test timeout or implementation was changed.
- Focused schedule/schema/location: 67 passed; initial red cases established missing split/compact behavior. Compatibility assertions cover four visible stages and exact saved ambiguous/seconds timestamps plus canonical location and changed input conversion.
- First seven browser cases passed at 390/1440: free + paid creation/publication, upload/AI failure recovery/selection/removal, normal draft editing, and AI-first close/reload.
- Browser first exposed transient schedule input during first-save navigation. A deferred-route loader regression failed, then the editor was changed to expose the next stage only on the saved route. Three repeated mobile free journeys passed.
- Browser fixture initially omitted Mapbox strict country/region fields; fixture was corrected without relaxing application validation. Expanded saved-event comparison initially read the write response outside its canonical `context` envelope; test was corrected.
- Functions: **432 passed, zero failed**. Function typecheck passed.
- Independent fresh read-only review found one important issue and no critical/minor findings: AI preparation saved changed details while retaining a stale checked agreement. Regression failed on checked state, then capture-before-save + existing agreement invalidation fixed it. **34 editor tests passed**, including rejection before a fresh checkbox action and acceptance afterward. No second reviewer was dispatched.
- Expanded final browser: **7/7 passed**, including published free/paid no-op canonical time/location comparison at both widths. Log `browser-verified.log`.
- Full frontend before agreement fix: **1,806/1,806 passed** with four workers. Final post-review frontend: **1,807/1,807 passed across 219 suites**, `pnpm test --maxWorkers=6`, 209.63s (`frontend-after-review.log`). **Typecheck, lint and build PASS** (`typecheck-verified.log`, `lint-verified.log`, `build-verified.log`), all command chains exit 0. Both typechecks and functions have been verified in this task.

## Regression coverage

Existing full frontend/function inventories cover duplicate authority/new ID, import parsing/DST/auth/continuation, images/generation/storage authority, Mapbox normalization, publication/moderation, public availability, discovery, storefront lists, free RSVP, paid tiers/ticketing, waitlist, Email Attendees and CSV export. Those implementations were not changed. Duplicate/import are covered by their automated suites and the common editor contracts, not fresh end-to-end duplicate/import browser creation.

Browser new free/paid journeys save/back/reload schedule and verified location, configure paid tiers, answer explicit disclosures, accept local development policies, preview and publish through canonical RPCs. Expanded proof reopens both published variants in the normal editor and compares every canonical time/location field after a no-op save. The normal editor never becomes the creation wizard on an ordinary edit URL.

## Visual/accessibility inspection

Inspected actual 390px Details and When & Where screenshots: date/time controls fit side by side within each Start/End group; verified location is compact; actions remain reachable; no horizontal overflow. Inspected 1440px paired schedule and Review summary: readable 800px composition and existing visual language. Inspected mobile AI panel: three selectable candidates fit without page overflow. Inspected the mobile published-event editor in its collapsed image state and desktop draft editor after Change image: normal fields remain prominent and image controls remain compact. Synthetic red image pixels are provider fixtures, not proposed production artwork.

Native labels, fieldset legends, aria-current progress, address combobox keyboard handling, errors/status announcements, and focus restoration on AI close remain. No viewport-height layout introduced. Desktop/mobile browser geometry checks assert no page overflow and date/time bounds.

## Decisions and limits

- Founder instruction overrides skill default approvals/commits/cleanup; changes and proof logs stay uncommitted. Cost if wrong: founder must decide release separately; no hosted effects.
- Existing normal-edit internal steps retained; four conceptual stages apply to creation/preview/publish. Paid tiers use existing editor. Cost if wrong: further UX composition may be requested; data authority is unchanged.
- No backend work or invented SQL suite. Provider proof is injected/local as requested. Hosted/live browser proof and real provider output quality remain outside this Build + Prove task.
- Skill review-package helper requires commits; founder forbids them. Reviewer received the actual uncommitted diff and untracked source inventory instead. Cost if wrong: an untracked source could be missed; reviewer explicitly checked the inventory.
- Independent review had no declined judgments and no deferred minor findings.

## Files changed

- `src/features/event-changes/eventChanges.api.ts`
- `src/features/event-images/AiCoverChooser.tsx`
- `src/features/event-images/EventImageManager.test.tsx`
- `src/features/event-images/EventImageManager.tsx`
- `src/features/event-images/event-images.css`
- `src/features/events/EventCompositionSummary.tsx`
- `src/features/events/EventCreationLayout.tsx`
- `src/features/events/EventDetailsStep.tsx`
- `src/features/events/EventEditorPage.test.tsx`
- `src/features/events/EventEditorPage.tsx`
- `src/features/events/EventScheduleLocationStep.tsx`
- `src/features/events/LocationSearchField.test.tsx`
- `src/features/events/LocationSearchField.tsx`
- `src/features/events/event.api.ts`
- `src/features/events/eventCreation.css`
- `src/features/events/organizerEventWorkflow.css`
- `src/preview/screens.json`
- `Docs/specs/2026-09-29-event-creation-experience-v1.md`
- `Docs/superpowers/plans/2026-09-29-event-creation-experience-v1.md`
- `src/features/events/EventDateTimeField.test.tsx`
- `src/features/events/EventDateTimeField.tsx`
- `src/features/events/eventCreationCompatibility.test.tsx`
- `src/features/events/eventSchedule.css`
- `tests/e2e/event-creation-experience.config.ts`
- `tests/e2e/event-creation-experience.spec.ts`
- `Docs/testing/2026-09-29-event-creation-experience-v1.md` (this report)

## Final verification summary

| Check | Final result |
|---|---|
| Frontend | 1,807/1,807 PASS; 219 suites |
| Functions | 432/432 PASS |
| Frontend and function typechecks | PASS |
| Lint and production build | PASS |
| Browser | 7/7 PASS; 390px and 1440px |
| Visual screenshots | Inspected Details, schedule/location, Review, AI, normal draft/published editing |
| Independent review | One Important finding fixed RED→GREEN; full final suite green; no deferred findings |
| Diff/secret/scope check | PASS; no payment/backend/migration/dependency changes; local credential files ignored |
| Git | Requested branch, baseline HEAD, no staged files, no commits/push/PR/merge |
| New regressions | None observed in completed local/injected proof |
| Hosted/provider changes | None |

The baseline timing failures do not remain in the final run. A known jsdom navigation diagnostic printed without failing any test; no unrelated repair was made. Provider/service behavior beyond injected contracts remains intentionally unverified. No release blocker identified within this task's authorized scope.

## Release boundary

No commit, push, PR, merge, hosted migration, backend deployment, frontend deployment, Stripe/payment change, real provider activation, production work, or next feature. Founder review is the next step.

## Reproduce local proof

Use the dedicated existing local Supabase stack (59521; publication migration and development fixtures available). Do not point this harness at staging or production.

```sh
python3 tests/integration/public-availability-local.py setup
pnpm exec playwright test --config tests/e2e/event-creation-experience.config.ts
pnpm test --maxWorkers=6
pnpm typecheck
pnpm lint
pnpm build
pnpm test:functions
pnpm typecheck:functions
```

The fixture setup creates an ignored private local session file; the browser config rejects any API other than 59521. The injected paid readiness fixture is short lived, so run setup immediately before browser proof. No manual production setup is required by this UX change.

## Founder-approved closeout — 2026-09-29

Founder approved commit/push/PR/merge after checks. Pre-commit fetch confirmed origin/main remains `4a406fcee0098a7ac95b153de99c6039cafd49bc`, matching the fully verified baseline; no reconciliation or affected-proof rerun was needed. Correct isolated feature branch/worktree verified; status, full scope and diff reviewed; `git diff --check` passed. Canonical local main is clean at the same baseline. Other worktrees/files are preserved.

The existing 1,807 frontend and 432 function passing results, both typechecks, lint/build, seven mobile/desktop browser cases and fixed independent-review finding remain the governing proof. No implementation changed after that verification. No hosted provider proof is claimed.

Final scope contains only UI/state composition, baseline-aware timestamp serialization, focused regression/browser tests, preview artifact and documentation. `public.events` schema, organizer ownership, Mapbox verification, America/Los_Angeles conversion policy, Free RSVP, paid tiers, publication/moderation, Duplicate Event, CSV Import, Waitlist, Email Attendees and CSV Export authorities remain unchanged. No migrations, payment files, backend functions, dependencies or hosted configuration changed.

Commit/PR title: `feat: simplify event creation experience`. Release authorization permits only Git/GitHub closeout and the existing automatic staging frontend deployment; no backend hosting, real provider, Mapbox configuration or Stripe changes. Final commit, PR, merge and resulting-main identifiers will be recorded in the closeout response.
