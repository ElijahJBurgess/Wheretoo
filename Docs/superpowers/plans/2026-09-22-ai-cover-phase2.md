# AI Event Cover Phase 2 implementation plan

**Goal:** Saved event data → three private generated covers → explicit Phase 1 canonical selection.
**Spec:** User BUILD AI EVENT COVER — PHASE 2, 2026-09-22. Execution inline under the explicit build authorization; no commits, push, hosted configuration or real provider spend.
**Architecture:** Extend the existing three slots with immutable saved-event context, bounded attempt claims and expiration. An authenticated Edge endpoint creates/reads generations and executes one candidate per request. Browser sequentially advances unstarted slots; reopening resumes unstarted work, interrupted claimed work becomes a visible failure with one explicit retry. No scheduler or background worker. Selection uses the unchanged Phase 1 transport.

## Decisions

- Pin gpt-image-2.5-flare-2026-09-08, native 1024x1280 PNG, medium quality, n=1. Official API supports custom dimensions in multiples of 16. Provider HTTP timeout 110 seconds, claim lease 140 seconds, set inactivity expiry 15 minutes; per-request work stays below Supabase's 150-second idle limit. No SDK retry or assumed provider idempotency guarantee.
- SQL configuration defaults: 3 sets/event/UTC day, 10 sets/organizer/UTC day, one active set/organizer; serialized organizer lock prevents race bypass. Two attempts maximum per slot, only explicit retries of recoverable failures, minimum 15 seconds between attempts.
- Store prompt context from saved event, never browser event fields. Mood enum plus at most 300 characters direction. Three distinct treatments: cinematic scene, illustration, abstract still life. No typography, dates, addresses, prices or logos.
- Private candidates expire after 7 days. Request-driven bounded cleanup invalidates expired candidates before Storage removal; failed deletion remains retryable. No canonical object cleanup or public selection redesign.
- UI reuses current styles with a compact mood/direction form and three portrait candidates. Generation uses saved events only; unsaved drafts show save-first guidance. Manual controls retain existing behavior.

## Tasks and verification

- [x] Provider/prompt: tests first for three treatments, bounded data, fixed request shape, response bytes/aspect validation, error sanitization and timeout. Implement small adapter without credentials in browser.
- [x] Persistence: SQL tests first for ownership, limits, exactly three slots, snapshot/idempotency, exclusive claims, retry ceiling, expiry and stale revisions. Add one additive migration; preserve Phase 1 selection semantics.
- [x] Edge: start/state/step operations with verified JWT/origin, bounded JSON, claim before provider call, immutable private upload and completion fencing. Add mock-only local runner outside deployed function.
- [x] UI: API schemas and component tests before implementation, durable latest-generation recovery, private signed previews, partial failure/retry/regenerate and explicit Use this cover.
- [x] Local SQL/API/Storage plus provider unit tests, focused frontend consumers, typecheck/lint/build and visual QA; independent final review; document exact rollout and limitations.

## Review focus

Duplicate requests must not incur extra provider calls. Timed-out processes cannot complete a newer claim. Another organizer and anonymous callers cannot generate/read/sign. Generation must not modify canonical cover or defeat manual revisions. Old browser identity and stale generation cannot select or resume. Cleanup cannot delete the selected canonical copy.

## Execution record

Implemented inline. No commits were made under the inherited isolation constraints. No product scope deviations or deferred minor review findings. Independent review found two recovery defects; both were fixed and re-reviewed: Storage 5xx cannot trigger provider spend, and persisted bytes recover after final-attempt interruption without a third attempt. Browser QA found an ambiguous mood accessible name and missing restored input values; both fixed with regression coverage. Empty saved titles now fail before consuming quota. All final verification results are recorded in Docs/testing/ai-event-cover-phase2.md.
