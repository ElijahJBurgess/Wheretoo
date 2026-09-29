# Public Availability + Publish Flow Cleanup V1 — Build + Prove

2026-09-29. Local proof only. Changes intentionally uncommitted for founder review.

## Result and state machine

Outcome B: a narrow backend transition bug plus frontend state defects. Baseline was fetched and verified as `1ef179e210b6d22d721f17a28fc9c26a80a49288`. Isolated branch `codex/public-availability-publish-v1`; HEAD remains that baseline. Unrelated worktrees/files were preserved. No commit, push or merge.

The active path is draft → explicit saved requirements → current revision/hash-bound policy acceptance → `publish_event_if_current` → locked context validation → `publish_event` → `publish_event_without_change_history`. The publisher retains owner, policy, disclosure, completeness, schedule, location, risk and paid-setup checks. Valid publication sets published; eligible low-risk input synchronously clears moderation, advances moderated revision, records audit actions and opens the canonical public interval. `private.event_is_publicly_eligible` and `get_public_event` remain authoritative. A successful public read plus current clear owner revision permits Live UI. Published alone does not imply clear, public, discoverable or purchasable.

Repeated owner edits previously produced hold then record_revision actions. The original guard recognized only an exact current organizer hold; therefore normal repeated editing could leave clean free and paid events published/under_review. Real local browser publication reproduced this. The new private helper follows only an uninterrupted owner-edit revision/version chain to its original hold; human/system holds and missing provenance fail closed. All original risk and eligibility checks still run. Async history/queue work is preserved; stale worker results cannot reverse a newer synchronous clear.

All-No is not sufficient by itself. Text, category, venue, organizer/tier text, age coherence and legacy artwork can still cause review; missing facts, invalid geography/time, blocked states, stale context or policies remain authoritative. Existing alcohol/coherent cannabis rules are unchanged.

## Changes

- Nullable disclosure reads stay unanswered; strict writes and field validation require explicit answers. Imported drafts share the same editor and publisher.
- Owner/public reads revalidate on entry, manual retry and a 15-second foreground interval. Cached draft redirects wait for revalidation. Pending, failed and paused/offline refresh cannot display stale Live actions.
- Confirmation and live/review/blocked/removed/unconfirmed states are truthful; known publish errors use allowlisted friendly copy, unknown diagnostics remain sanitized.
- One migration: `20260929010000_preserve_organizer_edit_hold_provenance.sql`. Adds the private helper and augments only the existing publisher guard. No backend function deployment or payment implementation changes.
- Focused unit, real-query, SQL, concurrency and local browser harnesses; regenerated preview artifact; spec/plan/report.

## Verification evidence

Logs retained locally under `.superpowers/public-availability/` (ignored). Browser screenshots are in `test-results/public-availability/` (ignored). Credentials are ignored, mode 0600, and must never be committed.

| Check | Result |
|---|---|
| Baseline frontend | 216 suites, 1,777 tests PASS |
| Final frontend | 217 suites, 1,790 tests PASS (`frontend-final-rerun.log`) |
| Functions | 432 PASS (`functions-test.log`) |
| Typecheck / function typecheck | PASS |
| Lint / production build | PASS, final command chain exit 0 |
| Concurrency | 16 real competing-session scenarios PASS (`concurrency.log`) |
| SQL | 570 assertions across 16 suites: 569 PASS, one identical inherited assertion failure |
| New SQL regression | 20 assertions PASS; pristine main fails 11 of the expanded regression assertions |
| Migration differential | Exactly two function changes: private helper and publisher guard; expected migration ledger delta only |
| Browser | 8 cases PASS, at 390px and 1440px (`browser-feature.log`) |
| Offline regression | Failed before fix; real TanStack Query paused refresh/reconnect test now PASS |

The inherited SQL failure is `moderation_policy_acceptance`, assertion 27: “the acceptance boundary has no client authority beyond event identity”. It introspects a function now wrapped by existing change-history code. The same failure occurs on pristine main. No unrelated repair was made. The first full frontend run had one expected generated-preview mismatch; regeneration through the existing harness resolved it, and the final complete suite passes.

SQL suites: moderation publish eligibility, public projections, incomplete evaluation contract/enqueue, policy acceptance, published edits, evaluations, event history/contracts/review, paid sales, discovery read/security, import authorization/schema and the new publication regression. Published local fixtures are hidden only inside rollback transactions for global map assertions. No unrelated durable fixture cleanup occurs.

The dedicated local stack `wheretoo-public-availability` at `127.0.0.1:59521` replays baseline migrations plus the new migration, with development policies and scheduled workers disabled. Differential target is the pristine local `wheretoo-organizer-profile-proof2` stack. No hosted migration was applied.

## Browser and security scope

Real local DB/API journeys cover clean free and paid publication, elevated-risk review, unanswered disclosures, missing/stale policy acceptance, refresh/reload and duplicate publish clicks. The public route opens for free and paid fixtures. Inspected mobile/desktop screenshots show legible content and actions with no observed overlap or horizontal overflow.

Only the Stripe-readiness presentation endpoint is stubbed. Publication, policies, revisions and public reads use real local APIs/SQL. Paid SQL still requires a non-live account refreshed within five minutes, active transfers/payouts, clear requirements with no due items, valid tiers and a current test-mode USD fee rule. No checkout transaction, live provider call or payment activation was performed.

Ownership and server-only authority remain intact. SQL proves a foreign organizer cannot publish; helper execution is revoked from browser/service roles. Human/system holds, elevated text/disclosures, blocked/removed and incomplete contracts stay protected. Discovery and import regression suites pass without a CSV-specific path. Policies are not auto-checked; synthetic local development acceptance is the only acceptance used.

Independent whole-diff review identified paused/offline refresh retaining stale Live and obsolete frontend-only scope wording. Both were addressed in one fix pass. The offline regression was demonstrated failing, then passing; the full frontend suite was rerun. No additional actionable security finding was reported. No second independent review is claimed.

## Release boundary

Final review: PASS for the feature, with the inherited SQL debt disclosed above. `git diff --check` passes; index remains empty and HEAD unchanged. Ready to commit and review for merge after founder approval, not merged. Concurrency includes edit/disclosure/policy versus publish, duplicate publication, old worker, cancellation, and a waiting moderator whose fresh hold immediately closes public eligibility after publication. Existing capacity/context races also pass.

No staging proof performed. No staging events/data/legal agreements changed. No hosted migrations, backend deployments, Stripe changes, real email, production actions or unrelated feature work. The migration needs a separately authorized release process; this task leaves code uncommitted for review. Foreground refresh is periodic, not a realtime guarantee; public authorization remains enforced server-side between reads. Live provider behavior and hosted deployment are outside this local proof.
