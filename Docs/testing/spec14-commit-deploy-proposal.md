# Spec 14 — commit and deployment proposal

> **Source-freeze checkpoint:** This source document records the pre-terminal verification state. The delivered detached handoff report and `handoff/evidence-index.json` carry subsequent build/export, Payments rerun and terminal-journey results with their actual identities. Those later results supersede pending checkpoint statuses here. Keeping results detached avoids changing the source bytes that those executions verify.

**Current moderation verification:** both targeted forward migrations are approved and applied locally. The supplemental correction restores the inherited active-event schedule condition; all eight targeted SQL suites and the independent preservation comparison pass. All previous122 migration files and ledger entries remain unchanged. All four concurrency cases pass with cleanup verified; the updated worker passed the original J06c evaluation and J06d connected notice checks. Final readiness remains incomplete.

**Proposal only. No Git staging, commit, merge, push, or deployment is authorized in Gate B.** The local assembly is still in progress. B1 dependency approval, the confirmed G07/J08g unattached-paid contract gap, the unexecuted J01–J08 branches, the interactive role walkthrough, the final source catalog, and the clean export remain open. J01/J02/J03/J04 cores and J02a/J03a/J07a have passed locally. Four ordinary role-browser launch lifecycles also passed; the remaining walkthrough is separate.

## Reviewed change boundaries

The inherited baseline is the resolved Spec 13 manifest chain, not branch HEAD alone. Keep these categories separately reviewable:

1. Baseline materialization and provenance: unchanged frozen source plus intentional deletions.
2. Auth coordination and validated returns: existing identity lifetime and global signout semantics; a dependency patch only after explicit additional approval and accepted verification.
3. Selective Create recovery: approved wizard, preview, confirmation, and outcome behavior plus the same-event Payments attachment; current version-aware APIs retained.
4. Source-aware free operations: strict existing free readers, ticket selection and manual/QR recheck; paid DTOs and shared admission authority retained.
5. Task-only harness, gallery opt-in, regression adapters, source/build identity and final evidence documents.

The private sidecar builder's `commit-allowlist.json` covers only the Spec14 delta against resolved Spec13. It is not a complete publication allowlist from the current HEAD, which omits substantial inherited working-file content and still tracks the four inherited deletions. A separate final HEAD-to-baseline, baseline-to-final and HEAD-to-final comparison must bind the complete proposed publication paths and explicit exclusions before any later commit approval. That comparison is currently being prepared; no delta-only list may be used as complete publication instructions.

Proposed commit boundaries may be folded only to keep each commit buildable. Final staging must use an explicit reviewed file allowlist, not `git add .`. Review against both HEAD and the resolved baseline to distinguish inherited bytes from new changes.

## Exclude from any future commit

Private scenario ledgers and browser storage, QR credentials, Auth confirmation and ticket-grant URLs, provider inbox payloads, local secrets, synthetic environment files, process and resource registries, database dumps, dependency directories, build output, temporary exports, and raw private screenshots or traces. Historical tracked evidence and approved synthetic test fixtures require their own source classification; do not blindly delete them.

Before requesting commit approval, freeze the source path catalog and manifest, ordered historical and separately approved forward migration hashes, dependency/tool identity, build asset manifest, reviewed incremental changes, and sanitized evidence index. Inspect and secret-scan the exact proposed publication content, including inherited working-file changes that HEAD lacks. Confirm the destination index is unchanged and rehash every protected tree and index. No manifest recursively hashes itself.

Current evidence remains an interim checkpoint. The [verification record](spec14-final-assembly-verification.md) names each executed suite, original failure, replacement and remaining gate. Four guarded headed launcher smokes passed, including staff. The full frontend command still fails because of unresolved Auth coordination errors. Current source/build hashes and visual reports are useful bound evidence, but final documents, source catalog and clean-export comparison must be frozen before proposing a commit.

Additional bounded Spec 14 repairs found during real verification are separately reviewable: CSP-safe existing Mapbox public-core integration, the precise tier-page same-event Payments link, native free-dialog focus return, truthful global-signout copy, route-scoped Stripe prompt Back/reconfirmation, published paid preview tier reads, public Connect-script readiness/error/retry through the existing panel, and responsive containment/reflow in the existing organizer/discovery/buyer/free-search styles. No dependency or CSP relaxation, map integration, artwork upload, payment identity, admission writer, or publication authority was added. The separately approved moderation repair adds the malformed-input forward migration and service-only rejection path; a second separately approved forward migration restores the inherited active-event schedule condition. All121 historical migration files and the first applied forward file remain unchanged.

## Later execution order

Each step requires its own explicit approval:

1. Inspect named Vercel/Supabase/Stripe TEST/email targets and existing Git-trigger side effects.
2. Commit the exact approved allowlist on `codex/wheretoo-v1-final`.
3. Push only the approved nonproduction ref, with any automatic Preview effect explicitly included.
4. Provision/link/configure only named staging resources if required.
5. Apply the exact schema manifest with jobs inert; compare generated types and ACL/RLS.
6. Deploy named Edge functions with existing handler authorization; configure approved server/public/Auth/origin inputs and signed receivers.
7. Deploy the exact gallery-disabled Vercel Preview source/profile. Verify safe reads, deep links, assets, CSP and identity.
8. Run separately authorized TEST checkout/refund, free/admission, event-change, Auth and per-purpose email checks; enable named jobs only within their approved caps.

The detailed operation/target/cap/stop template and independent action table are in [staging readiness](spec14-staging-readiness.md). No main merge, force push, production alias or production promotion is proposed.

## Stop and rollback

Disable new checkout and the relevant worker/public switches while preserving existing status, collection, reconciliation and historical admission/financial records. Restore only a schema-compatible known artifact after review. Frontend rollback is not database rollback. Do not delete history, rotate access keys, repeat unknown refunds or create replacement payments to hide uncertainty.
