# Spec 10 + Spec 11 Integration Plan

Goal: reconcile the two verified local snapshots without redesign, commits, or provider activity.
Architecture: preserve frozen Specs 04–09, union additive spec files, reconcile only shared attachment points. Regenerate public types from a fresh guarded combined schema.
Spec: Docs/testing/spec10-spec11-integration-request.md

- [x] Record source HEAD, branch, tracked/untracked status and SHA-256 file maps before edits; verify identical 797-file dependency baseline.
- [x] Read implementation reports, source contracts, shared code and migration runners.
- [x] Attach 102 Spec 10 changes and 58 Spec 11 changes. Router: automatic compatible three-way merge. Private cache: retain all scopes and identity invalidation. E2E config: union entries. Database types: regenerate only after replay.
- [x] Adapt local test runners to a new recorded container/label/loopback ports; preserve original worktrees and containers.
- [x] Replay 119 immutable migrations, check grants/RLS and generate public types.
- [x] Run frontend, functions, typechecks, lint, build, SQL, concurrency, browser and explicit cross-spec regressions.
- [x] Inspect responsive screenshots at 320/390/768/1440; report limitations without redesign.
- [x] Inspect reconciliation diff, verify source/main preservation, record final file map and hash for Spec 12.

Risks: source HEAD is not the uncommitted baseline; copied test runners must not address source containers; private query eviction must cover both specs. The absent event-specific Stripe return flow is documented, not invented. Inherited cross-tab SDK sign-out race remains a release limitation.
