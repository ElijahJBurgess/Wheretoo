# Living Map / Current Main Integration Plan

> Execute the approved reconciliation task inline, using test-first changes and a fresh independent final review. No new map features.

**Goal:** Port the completed Living Map/Icon Library from `612d0168328b6f52bb9733c1897b20a9574874de` onto main base `4e61e616bc29f7000211fc8f3ff7bccfe96bc5c8`, preserving both systems' contracts.

**Architecture:** Preserve main's context-token and change-history wrappers. Adapt their lower-level operations for immutable icon assignment with one strongest invalidation. Keep the persistent map and canonical public inventory RPC; resolve preview artwork through main's existing public event-image contract.

**Migration provenance:** The owner explicitly confirmed that map migrations `20260924010000`, `20260924010100`, and `20260929010000` were applied only to isolated/local environments, never hosted/shared/staging/production. Their integration copies may receive new forward versions. Every existing main migration remains byte-for-byte unchanged; the historical map branch remains unchanged.

## Global constraints

- Main base and original map worktree are preserved; no merge, rebase, reset, cleanup, push, deployment, or hosted database operations.
- One persistent Mapbox instance; canonical `wheretoo-events`; bounded `wheretoo-selected-event`; application-owned selection and existing resource controller.
- Preserve dark Standard theme, PNG geometry, clusters, chooser, fallback, late-arrival handling, timeout fix, and dynamic second-icon support.
- Preserve ownership, context locking/history/notices, started-event/ticket guards, moderation digests, and disabled-by-default selection/rendering.
- No CASCADE or destructive migration-history edits. No unrelated systems changed to force tests green.
- Fresh combined local stack only; stop if Docker becomes unresponsive.

## Tasks and gates

### 1. Baseline and migration chain

- [x] Record clean main base and reproduce the configured application baseline.
- [x] Copy only map-owned additions; renumber map foundation/storage/draft/revision copies to `20261007010000`, `20261007010100`, `20261007010200`, `20261007010300`, in dependency order.
- [x] Use a new isolated project `wheretoo-map-integration-20261007` on verified unused API 64321/DB 64322 ports, never an existing proof database.
- [x] Prove all main plus integration migrations apply from empty state; record migration inventory and verify original main file hashes.

### 2. Lifecycle reconciliation

- [x] Add combined pgTAP regressions for history capture, context conflicts, notice state, icon-only/content-only/mixed edits, policy acceptance, unchanged/null icons and unauthorized assignment.
- [x] Keep main public wrappers and adapt underlying revision/policy operations, preserving all prior guards and exactly one strongest invalidation.
- [x] Preserve current moderation input including image contracts; add nullable immutable icon digest without changing null-icon hashes. Generate public types from combined local schema.
- [x] Run map-icon RLS suites plus main history/image/moderation suites.

### 3. Application reconciliation

- [x] Restore tested map/icon modules including timeout fix without importing stale mainline router/editor/API bodies.
- [x] Extend main event form/contextual save contracts and place the picker in the existing flow; prove retries, ownership, save/reload, unavailable choice and current-main editor behavior.
- [x] Use `usePublicEventImages` / `list_event_images` for selected preview artwork; inventory remains exclusively `get_public_map_events`. Prove missing/revoked/image-error fallback and anonymous access.
- [x] Preserve existing routes, public image handler, CSP directives and main lockfile dependencies; add only required Mapbox dependency/configuration.

### 4. Integrated proof

- [x] Run focused organizer/map/icon/live-query suites, current-main history/image/RLS suites, moderation worker, CSP, typecheck, lint, production build, whitespace checks and configured full suite.
- [x] Only classify failures as baseline when reproduced on the exact untouched main base.
- [x] Use fresh combined local browser fixtures: desktop/mobile map, both icons, generic selection, preview with canonical uploaded cover, cluster/chooser, picker persistence, fallback and style reload without map recreation.

### 5. Review and closeout

- [x] Fresh independent code/security review against the exact main base; test-first fixes only for genuine Critical/Important integration defects.
- [x] Inspect intended staged files for secrets, local state, binaries and unrelated changes; verify original worktree/asset hashes.
- [x] Commit intended integration files only if gates pass. No push/merge/deployment/production enablement.
- [x] Report migration mapping, test counts/baselines, browser evidence, review findings, preserved defaults and final readiness decision.

## Review focus

- Mixed content/icon updates must not double-invalidate or bypass main context/history wrappers.
- Image-only/public eligibility changes must neither leak private images nor turn image lookup into event inventory authority.
- Stale context after policy/image actions must not overwrite unsaved icon/form state.
- Null-icon legacy events must retain moderation compatibility and normal marker fallback.
- Fresh schema proof must not depend on old local fixture state or altered main migration history.
