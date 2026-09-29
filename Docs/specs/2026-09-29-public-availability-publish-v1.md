# Public Availability + Publish Flow Cleanup V1

Baseline: `1ef179e210b6d22d721f17a28fc9c26a80a49288`. Branch: `codex/public-availability-publish-v1`.

## Evidence and scope decision

Outcome B, established by real browser proof: correct a narrow organizer-edit hold transition as well as frontend disclosure/refresh behavior. Initial unchanged-main suites passed but their fixtures did not cover multiple draft edits. An existing policy suite introspection assertion fails because acceptance is now wrapped by change-history functions; record baseline debt separately.

The active preview calls `publish_event_if_current`, which checks the locked change-context token, calls `publish_event`, records change-history facts, and returns the new canonical context. The preview already adopts that event into the owner cache. The older `usePublishEvent` hook is not this flow's authority.

Publication locks owner/event, tiers, disclosures, organizer and current policy requirements. Missing disclosures fail; persisted boolean columns are NOT NULL. Current revision/hash-bound acceptance is mandatory. Valid drafts become published (paid drafts must pass `activate_paid_sales_locked`). Deterministic safe input clears synchronously, advances moderated revision, records authorization/clear actions and opens a public eligibility interval. Current human/system holds, blocked/removed states and incomplete evaluation contracts remain authoritative. Organizer-edit holds alone may clear after a clean recheck. Elevated text/disclosure/legacy artwork signals hold and queue contextual evaluation. Publication does not wait for a worker for a genuinely clean event.

All-No is necessary for the requested clean fixture, not a universal sufficient condition. Title, description, category, venue, organizer name and tier text also feed risk checks; age coherence and legacy artwork matter. Alcohol and coherent 21+ cannabis alone do not require a hold under existing rules. Public reads additionally require canonical current authorization/revisions/interval, profile, geography and unexpired schedule. Paid publication and public ticket purchasing are distinct gates; preserve both.

## Defects

1. `requirementsFromRpc` and unavailable-policy context parsing currently convert absent disclosures to false/all ages. Editor defaults also preselect false. This loses explicit-No versus unanswered semantics before saving.
2. Published status uses a 30-second fresh owner cache without mount revalidation, while availability retry refreshes only the public read. External moderation changes can leave owner status stale indefinitely on an open page. A cached draft may redirect before revalidation.
3. Confirmation says availability depends on review for every event; live/review/unavailable outcomes need truthful refresh and blocking status.
4. `publishIfCurrent` reduces known actionable server failures to `unknown` before existing publish-error copy can see them. Preserve only allowlisted public error codes at this boundary; never expose raw diagnostics.

These are reproduced code paths, not a claim to have reproduced a particular founder session.

## Browser-discovered transition gap

Real local free and paid browser publication both remained under review after two owner edits: revision 2 recorded organizer/edit/hold, revision 3 recorded organizer/edit/record_revision, then publication authorized revision 3 but could not clear it. `v_can_clear_organizer_edit_hold` recognizes only an exact current hold, losing the original hold's ownership across successive revisions. Risk and missing-policy browser cases behaved correctly.

Extend only that provenance check with a private helper: follow an uninterrupted revision/version chain of organizer/edit/record_revision actions back to an organizer/edit/hold from clear or not_evaluated. The current action must match canonical input hash. Every link must belong to the event owner, remain under_review, and advance revision and moderation version by one. Any intervening human/system hold, block, remove, restore or clear rejects this additional path. Unknown/missing history fails closed. Preserve original immediate-hold guard and all subsequent risk/policy/eligibility checks. Queue/history remain intact; old evaluations are version-fenced. Add one tracked migration; apply only to a dedicated local feature stack and compare with pristine main.

## Required behavior

- Keep absent read disclosures null. Write schema remains strict booleans plus explicit age. Initial controls are unanswered. No legal box defaults to accepted for missing acceptance.
- Validate all seven answers before requirements persistence or progression, with field-level actionable errors. Existing complete saved answers hydrate unchanged. Imported drafts use the same editor.
- Revalidate owner and public reads on status-page entry; never redirect from an unvalidated cached draft. Refresh both on explicit check and foreground interval (15 seconds), including already-live events so new holds/cancellation appear. Do not poll hidden tabs.
- Live requires a successful public projection plus a published, clear, current owner revision. Failures stay retryable, never claim Live from stale data. Known blocked/removed/review states remain distinct. No raw diagnostics or fake review ETA.
- Confirmation explains immediate availability when checks pass and possible review when required.

## Constraints and proof

One narrow database migration is required by reproduced behavior. No backend function deployment, Stripe changes, hosted writes/deploys, real legal acceptance, staging publication, real email, push or commit. Local synthetic accepted-policy fixtures only. Preserve security, ownership, revision locks, public projection and all payment gates.

Unit/integration regression tests cover missing/null versus false, current saved answers, cached draft, coupled retry, moderation transitions, failure, and late identity responses. SQL covers free/paid, requirements/policies, holds, revisions, workers, ownership, public/discovery and import. Browser proof at 390/1440 covers local publication, risk, missing answers/policy, retry/reload and duplicate clicks, with inspected screenshots. Run all six requested checks. Report any baseline failure without unrelated repair.

Self-review: the browser-reproduced transition gap justifies the narrow provenance migration; null preservation requires read types to differ from strict write types. No shortcut grants publication authority to the browser. Local proof distinguishes stubbed payment-readiness presentation from real SQL/API publication. Paused/offline owner or public refresh is unconfirmed, never Live from retained cache.
