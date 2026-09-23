# AI Event Cover hosted rollout evidence

## Pre-integration verification

Baseline: remote `main` at `dcb39e6c9f1a155782352ac1f79bd3617fff5472`. The feature starts at this exact commit; a fresh fetch found no incoming commits or conflicts. Work is isolated in `/Users/exoh/Desktop/WhereTo-ai-event-cover`, branch `codex/ai-event-cover`.

The user explicitly accepted the following two baseline failures for this rollout on 2026-09-22. No unrelated product logic, assertion or snapshot is changed to make them pass:

- `src/preview/screens.render.test.tsx`: `public-event` serialized markup mismatch. The expected and received snapshot lines are byte-identical between untouched main and the feature.
- `src/features/organizer-operations/OrganizerDashboardPage.test.tsx:94`: missing `View event` link for a fixture that has ended relative to the current clock. The same assertion fails on untouched main.

Untouched main was materialized with `git archive origin/main` into an isolated temporary directory and used the same installed dependencies, environment and targeted Vitest command. The disposable source was removed after comparison to keep it outside normal test discovery. Original evidence remains in the ignored `.supabase/ai-cover/` directory:

| Evidence | SHA-256 |
| --- | --- |
| `baseline-check.log` | `83ee81d91a35d69feb1c182a6fdcef449ac780141ce5c56b5fed08dd17527aef` |
| `rollout-recheck.log` | `23d25e90b86a061133d4f8d5ab62ee2b63d46ed98f8922e4f083b785a9afd31d` |

The preview mock has one feature-required addition: `useEventCoverState`, needed by the existing EventImageManager. Its snapshot assertion and stored snapshots are unchanged.

Phase 1 and Phase 2 verification details are recorded in their sibling reports. Hosted rollout authorization is limited to the two AI-cover migrations, `event-images`, `event-cover-generation`, and main's normal Vercel deployment. The one live generation set must belong to an unpublished, clearly labeled smoke-test draft. No retry or second set is authorized by this smoke test.

## Final local gate

- Full frontend suite: 1,610 pass, exactly the two accepted baseline failures; no new failures. Final snapshot Expected/Received lines again match the untouched-main evidence.
- SQL: 49 assertions pass (15 foundation, 17 canonical compatibility, 17 generation).
- API/Storage: 91 checks pass (58 foundation/compatibility, 33 generation/recovery).
- Edge: 17 tests pass; both function entrypoints typecheck.
- Application typecheck, lint, and production build pass (693 modules).
- Changed-file credential-pattern scan and whitespace check pass.
- Hosted secrets list confirms both required secret names; their values were not read or printed.
