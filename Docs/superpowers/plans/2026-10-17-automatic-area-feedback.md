# Task 8 — Automatic area feedback

Founder-approved scope: retain automatic searching; do not add Search This Area. Latest main at start: `64a8e3d` (PR #26). Task 6B remains untouched.

Small implementation scope:
1. Expose fresh, complete coverage for the settled viewport from the existing two-snapshot cache; withdraw proof on expiry, unmatched area, refresh or failure. Keep debounce, requests, cache limits and marker revisions unchanged.
2. Show the existing empty message and broaden action using visible event membership, with existing error/loading/partial precedence.
3. Keep feedback separate from retained offscreen previews/choosers in compact maps without resizing the map. Preserve selection, focus and internal scrolling.
4. Verify failing-before/passing-after coverage, expiry, precedence, active filters, A→empty→A, request/source counts, desktop/mobile/landscape geometry, and application/typecheck/lint/build regressions. Independently review the diff.
5. Disable branch preview deployments, merge through GitHub after verification, deploy only the existing staging project, and verify hosted behavior and release identity using safe intercepted event fixtures.

Risks: padded cached inventory is not visible membership; incomplete/failed results cannot establish emptiness; identical inventory from different coverage must update coverage metadata without marker churn; retained selections require separate feedback space on short screens. No backend, database, dependency or payment changes.

Verification ledger:
- Baseline regressions reproduced: cached offscreen inventory suppressed empty feedback; retained selection could be obscured by the newly visible feedback.
- Coverage/page regression tests pass, including hidden TTL expiry, failed/partial proof and identical-row coverage changes without marker revisions.
- Full application suite: 263 files / 2,128 tests pass. Existing strict lazy-route CSS scoping test is preserved and rechecked after responsive adjustments.
- Desktop/mobile map suite: 14 cases pass; two additional checked-in compact long-title cases pass. Touch matrix covers 320/375/390/430 portrait and landscape plus height boundaries; affected wider portrait sizes rechecked after the final layout refinement.
- Full typecheck, lint and build pass; changed E2E files also receive scoped type/lint checks. Existing Vite large-chunk advisory remains.
- Independent review resolved coverage/geometry/specificity concerns. No backend, dependency, migration, event writes or payment changes.
- GitHub merge and existing staging deployment are authorized. Hosted checks use anonymous reads and browser-local response fixtures, with no staging data mutations.
