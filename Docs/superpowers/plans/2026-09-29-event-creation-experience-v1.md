# Event Creation Experience V1 implementation plan

Use executing-plans inline; one fresh whole-diff review at the end. Founder explicitly overrides intermediate approvals and commits.

Goal: four coherent organizer stages with compact optional images and clear schedule/location, retaining existing contracts.
Spec: `Docs/specs/2026-09-29-event-creation-experience-v1.md`.
Stack: React/RHF/TanStack Query/TypeScript/Vitest/Playwright; existing local transports.

## Global constraints

No database migration, backend/provider/payment changes, hosted writes, legal acceptance, commits or push. Preserve existing routes, conditional context tokens, publication, strict disclosures, image revision fences, Mapbox normalization and Pacific time semantics. Retain proof artifacts locally.

## Review focus

- Partial date or time cannot disappear during back navigation or serialize as valid.
- Untouched seconds/later ambiguous instant and canonical location stay exact.
- First image/AI action creates one draft and retains entered basics across failure.
- Existing generated images do not automatically reopen/generate or disappear.
- Replaced/cleared verified address cannot retain stale authority or late results.

## Task 1: Schedule and location

Files: EventScheduleLocationStep, new EventDateTimeField, LocationSearchField/CSS; event.api and eventChanges.api serializers; focused tests.
Interface: controlled date/time adapter consumes RHF Control<EventFormValues>, names startsAt/endsAt, emits existing wall strings. draftPayload optionally consumes baseline EventRow; saveEventIfCurrent passes baseline for unchanged instant preservation, no RPC signature change.
- [x] Red tests for split inputs, incomplete halves/back/reset, exact instants and location, changed Pacific input; verified state/change/no result.
- [x] Implement adapter and baseline preservation; keep converter and publication validation unchanged.
- [x] Compact verified location and actionable search status with existing normalization/abort fences.
- [x] Run focused tests and typecheck.

## Task 2: Four-stage and image composition

Files: EventCreationLayout/CSS, EventEditorPage, EventDetailsStep, EventCompositionSummary, EventImageManager/AiCoverChooser/CSS, tests.
Interface: existing layout numeric internal step maps to four visible stages; image manager gains compact editing/preparation props, existing transport contracts unchanged.
- [x] Red tests for four visible steps, optional image, normal edit collapsed image actions, no duplicate manager in review, AI opening/selection/failure and first draft safety.
- [x] Implement progress and responsive width/spacing; Details/When & Where/Admission/Review headings.
- [x] Compact image upload/placeholder and explicit AI panel; preserve recoverable generation and close after selection.
- [x] Prepare saved current draft before AI; retain route identity fences. Read-only review image and summary.
- [x] Run editor/image/tier/preview/publication regression suites and regenerate official preview artifact if needed.

## Task 3: Build + Prove

Files: focused browser harness and `Docs/testing/2026-09-29-event-creation-experience-v1.md`.
- [x] Local/injected browser journeys: new free/paid, tiers, image upload/AI, reload/back, schedule/location replacement, existing edit; both 390 and 1440, inspect screenshots and errors.
- [x] Full frontend and function tests, both typechecks, lint, build. Existing duplicate/import/publication/discovery/storefront/RSVP/paid/waitlist/email/export suites remain in full inventory.
- [x] Independent final review; address material findings with regressions, inspect actual diff and diff-check.
- [x] Record all 34 report fields and remaining limits accurately. Leave uncommitted and STOP.

Self-review: covers spec; no competing save authority or second image store. Task 1 control prop is wired by Task 2 editor. Existing publication/tier routes remain, only visible composition changes. Incomplete input and ambiguous timestamps require focused tests rather than broad schema changes.
