# Storefront Reliability + Organizer Navigation V1

Baseline: origin/main aba93a2e1a72e8a226f0b1a94b872970815c291e, fetched September 25. Work is isolated and remains uncommitted.

## Intent and scope
Make the existing organizer Storefront reachable beside My Events and reliable to load; prove public/private boundaries without redesign, publication-rule changes, payment changes or hosted mutations.

## Investigation
The previous onboarding spec recorded PGRST202 on staging's public and identity storefront RPCs. Fresh anonymous probes against the API discovered from staging's deployed assets now return 200/null for an unknown public handle and 401/42501 for private editor, identity and preview functions. The missing-contract cause is already repaired; anonymous denial is correct authorization, not a load bug.

Current frontend defect: EditorLoader renders stale cached query.data during the initial background refresh. Editor copies initial into saved/draft once and ignores later query results. A refreshed canonical name/logo/version can therefore leave the visible editor stale. Always refresh on mount (including the production 30-second fresh-cache window) and gate initial editor mounting on refresh completion, without remounting a dirty form on subsequent background refreshes.

Navigation problem: OperationsLayout has My Events and Settings but no Storefront. Preserve /organizer/settings/storefront as the single editor route, explicitly allowed by the request. Add a primary NavLink beside My Events; avoid simultaneous Settings active state on that route. Retain existing Settings access and preview route. Legacy fallback shell gets the same destination.

## Product and security truth
RequireOrganizer redirects incomplete onboarding to existing setup. Completed legacy organizers lacking a handle get the existing Profile completion link. Permanent confirmed handle and canonical organizer fields remain authoritative. Public storefront requires published status, confirmed handle and logo; initial publication also requires an eligible event. An already-published storefront with no remaining eligible events remains a public empty storefront. Do not weaken eligibility or change private/public projections.

Keep the saved-handle public link (published only), owner RPCs, revision conflict protection, media boundaries, query identity fences and sign-out purge. Show an explicit empty event-choice state after a successful empty preview; show loading while waiting and retry on failures. Do not infer empty events from an error.

## Verification
Focused failing tests for stale initial cache and primary nav, then editor load/retry/identity/sign-out/public-link tests and public route response tests. Browser fixture journeys at 390 and 1440 include actual shell navigation, public link, logo/cards, empty/not-found, reload, transient error and delayed sign-out. Fixtures are local intercepted responses, clearly distinct from backend proof. Existing SQL tests prove owner and event boundaries on loopback only. All six requested pnpm checks run. Staging proof is read-only and separately reported; no legal acceptance or event publication to manufacture hosted fixtures.

## Risks
A public staging success requires an existing published organizer with valid prerequisites; no such fixture is assumed. Existing SQL fixture debt is reported rather than repaired. Initial refresh errors must remain retryable, with private data hidden after identity changes.

Self-review: scope, canonical routing, publication truth, authentication boundaries and verification responsibilities agree with the request. No product contradiction; no migration planned.
