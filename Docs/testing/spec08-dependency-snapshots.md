# Spec 08 frozen dependencies

Starting HEAD: 94c546bd0961f501584f8a3437298b2331cafd5c. Branch: codex/spec08-payment-recovery. Worktree: .worktrees/spec08-payment-recovery.

Both source branches have uncommitted implementations; HEAD alone does not identify their source. Frozen manifests list SHA-256 per file in `.superpowers/spec08/spec06-frozen.json` and `spec07-frozen.json`. Digest below hashes canonical sorted compact JSON file map. Baseline archive `.superpowers/spec08/baseline.tar.gz` and `baseline.json` preserve exact Spec07 working snapshot, 716 files, before Spec08 edits. No source worktree was changed or committed.

| Dependency | Branch | HEAD | Files | File-map SHA-256 |
|---|---|---|---:|---|
| spec06 | `codex/spec06-free-rsvp` | `94c546bd0961f501584f8a3437298b2331cafd5c` | 634 | `7e716fa20f88c93c3d0cc9e117b686c3492e4ac09902fe484011ffb2308f50bc` |
| spec07 | `codex/spec07-ticket-email` | `94c546bd0961f501584f8a3437298b2331cafd5c` | 716 | `9306b44aa805738511d3742df5f59e916eab4049695a003dd5fcafc3ca3900e2` |

Spec07 supplies the integrated prerequisites, paid deliveryNotice and static access/recovery routes. Spec06 RSVP source matches except RsvpConfirmationPage.tsx and its test: the Spec07 snapshot adds its delivery notice; registration/capacity/recovery remains Spec06 owned. Those additions are preserved unchanged. All seven Spec07 and four Spec06 migrations are inherited; Spec08 initially added no migration. The subsequent explicit user exception authorizes exactly one additive migration: `20260914010800_restore_checkout_preflight_cardinality.sql`, which follows the frozen set and changes only the preflight tier-ID ceiling from 3 to 10. All inherited migration files remain unchanged.

Shared overlap ownership: Spec08 owns CheckoutPage, checkout attempts, paid availability and payment status actions. PublicTicketEventPage retains Spec06 FreeRsvpEntry. OrderConfirmationPage and OrderConfirmationView retain Spec07 deliveryNotice and original View tickets behavior. Router remains byte-identical to frozen Spec07 unless a proven integration fix is needed. Buyer base CSS and RSVP/email/access implementation are preserved; new recovery styles are scoped separately. Final verification found zero source drift for both snapshots. Incremental edits against baseline.json are enumerated in spec08-verification.md; protected local dependency implementations remain unchanged.
