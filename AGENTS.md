# AGENTS.md — WHERETO

This file defines how coding agents should work in this repository.

## 1. Source of Truth
Before implementing product work, read:
1. WHERETO_V1_PRODUCT_DEFINITION.md
2. WHERETO_V1_USER_FLOWS.md
3. WHERETO_V1_TECHNICAL_ARCHITECTURE.md

If approved visual references/screen-contract files exist, read those for UI work.

Priority when instructions conflict:
1. Latest explicit user instruction
2. Product definition / user flows
3. Technical architecture
4. Existing implementation conventions

Do not silently resolve meaningful product conflicts. Surface them.

## 2. V1 Discipline
Do not add features merely because they appear useful or appear in concept art.

V1 principle:
If it does not help someone find somewhere to go, help an organizer put something on, or complete the transaction, it is not V1.

Explicitly deferred unless later approved:
- route/path animations
- consumer messaging
- private events
- primary event feed
- search
- subscriptions
- event ownership transfer
- full social graph
- full design editor
- external ticketing integrations
- advanced enterprise functionality

## 3. Before Editing
For every meaningful task:
1. inspect relevant existing code
2. inspect relevant migrations/schema
3. identify existing conventions
4. state a concise implementation plan
5. identify risks or assumptions
6. then implement

Do not rewrite working systems unnecessarily.

## 4. Change Scope
Make the smallest coherent change that completes the requested behavior.

Do not:
- redesign unrelated screens
- rename broad parts of the codebase without need
- introduce a new framework for convenience
- replace existing infrastructure unless justified
- build V1.5/V2 functionality preemptively

If architecture must deviate from the technical document, explain why before making a material deviation.

## 5. Database
- Use Supabase migrations for schema changes.
- Never make an untracked production-only schema change.
- Add appropriate constraints/indexes.
- Use PostGIS for geographic event location/querying.
- Use RLS for public/user-owned data as appropriate.
- Test organizer ownership boundaries.
- Never rely on client-side authorization alone.

## 6. Secrets
Never commit:
- Supabase service-role key
- Stripe secret key
- Stripe webhook secret
- OpenAI secret
- Resend secret
- other private credentials

Client bundles must not contain privileged secrets.

## 7. Payments
Payments are high-risk code.

Rules:
- never trust client-reported payment success
- verify Stripe webhook signatures
- make webhook handling idempotent
- do not issue duplicate tickets from retries
- store Stripe IDs required for reconciliation
- do not store card data
- use Stripe test mode during development
- test failure/retry/refund behavior before declaring complete

Do not invent payment or payout behavior that Stripe does not support.

## 8. QR / Check-In
- use opaque/signed secure admission credentials
- validate server-side
- validate event/admission status
- atomically record check-in
- reject duplicates
- reject invalid/cancelled/refunded credentials
- verify organizer permission for check-in operations

## 9. Map
Map code belongs in the map subsystem, not scattered through unrelated pages.

Keep separate:
- map rendering
- event/domain data
- filtering/querying
- animations
- ambient life
- selection/navigation

V1 events are point-based only.

Do not reintroduce route/path behavior without explicit approval.

Do not render an unbounded number of rich DOM animation markers. Use clustering/layers/viewport-aware rendering and validate performance.

Ambient pedestrians/cars are decorative. Never represent them as real tracked people or real traffic unless a future feature explicitly supplies real data.

## 10. UI / Visual Fidelity
Approved visuals are references; the V1 product documents decide functionality.

For approved BUILD screens:
- match layout/hierarchy/spacing/typography closely
- preserve responsive behavior
- implement loading/error/empty states
- do not add generic AI gradients/cards/extra UI without reason
- do not redesign approved screens unless asked

If a screenshot contains a feature excluded by V1, do not implement it just because it is visible.

## 11. Accessibility and Motion
- support keyboard/focus behavior for standard controls
- use semantic elements
- maintain reasonable contrast
- respect prefers-reduced-motion
- ensure essential information is not communicated only through animation
- map animation must not prevent transaction usability

## 12. Code Quality
- TypeScript should remain type-safe; avoid unnecessary `any`
- prefer small cohesive modules
- keep business rules out of presentation components
- reuse domain logic rather than duplicate it
- handle errors explicitly
- remove dead experimental code after a direction is approved
- comment why, not obvious what

## 13. Testing
Do not say a feature is complete until relevant verification has run.

At minimum after meaningful work:
- typecheck/build
- lint if configured
- relevant unit/integration tests
- targeted manual/E2E verification where appropriate

High-risk paths require stronger proof:
- Stripe
- RLS/authorization
- inventory/capacity
- ticket issuance
- QR/check-in
- refunds/cancellation

If tests cannot run, say exactly why.

## 14. Completion Report
At the end of a task report:
1. what changed
2. files changed
3. migrations added
4. tests/checks run and results
5. remaining risks/blockers
6. any manual setup required

Do not claim success without evidence.

## 15. Git
- keep commits scoped and understandable
- do not force-push/rewrite shared history without explicit instruction
- do not commit secrets
- do not commit large generated artifacts unless required
- preserve the ability to roll back a feature safely

## 16. AI-Generated Code Discipline
AI speed is not permission to lower engineering standards.

Before finalizing:
- inspect the actual diff
- remove placeholders
- remove fake production data
- remove unused imports/dependencies
- confirm errors are handled
- confirm no secret leaked
- confirm product scope
- run verification

## 17. Soft-Locked Technical Directions
These are current preferences, not immutable requirements:
- hybrid Mapbox WebGL layers + richer close-range animated markers
- SVG/Rive/Lottie/other lightweight vector motion may be evaluated
- destination-charge-style Stripe Connect flow may fit the one-organizer model
- ambient cars/pedestrians are proof-level V1 enhancements if schedule/performance allow

If testing shows a better implementation, propose it with evidence rather than silently changing direction.

## 18. Product North Star
Whereto should feel like a living city, not a directory of dead map pins.

But the V1 priority order is:
1. organizer/event foundation
2. transaction reliability
3. discovery/map functionality
4. living-map visual proof
5. polish

Do not let visual experimentation break or delay the transaction foundation.
