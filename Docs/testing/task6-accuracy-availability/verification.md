# Task 6A verification

Baseline: origin/main `7dde84372fa630836b09baba6278b9995b5e1595` (PR #24). Scope: four approved accuracy repairs; no settlement implementation.

## Repairs and measurements

- New paid reservations recheck canonical eligibility with wall-clock time after all lock waits, immediately before insertion. Existing-request recovery is unchanged. Before: a confirmed event-lock waiter created an order ~370 ms after event end. After: event, Connect-account and fee-lock waiters reject with `EVENT_NOT_SELLABLE`, creating zero orders/items/tickets. Exact persisted request replay across event end returns the same frozen order.
- Free RSVP entry/page share the existing TanStack infrastructure and visible-page 15-second freshness policy. Full → available → full, eligibility removal, failed-refresh unknown and retry are verified. Reduced remaining capacity disables an oversized details confirmation without changing server capacity maths or historical request recovery.
- Accepted map revalidations signal a matching, older, idle Discovery query to refresh its first page using existing cursor replacement/fencing. No map omission is treated as cancellation. Initial requests remain one map + one list. Over 122 simulated seconds: three map requests unchanged; list one stale read before, three authoritative reads after. Focus/reconnect work coalesces; filters/viewport/cooldown/stale append fences remain.
- Paid previews reuse the existing one-event public ticketing read/cache, bounded to the selected event and existing tier maximum, rather than adding inventory aggregation to every map marker. The cached bulk minimum is no longer advertised as available. A $10 sold-out / $30 available fixture displays From $30; all tiers exhausted displays Sold out; failed/pending reads display Availability unknown. Bulk map/list response contracts and SQL are unchanged.

Median local SQL milliseconds, mixed free/paid fixtures, warm-up excluded, five measured runs:

| Events | Map next7 | List next7 (first page) | Selected paid event read | Map legacy30 | List legacy30 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 9 | 0.805 | 0.983 | 2.992 | 1.080 | 0.843 |
| 500 | 12.115 | 12.492 | 3.454 | 11.849 | 13.223 |
| 2,000 | 43.433 | 40.897 | 3.326 | 43.509 | 43.845 |

The selected read returns one event/two fixture tiers; it is not a per-marker or per-list-row request. Bulk SQL has zero implementation change, so this is its current optimized baseline plus measured selected-read overhead, not a claim that unchanged SQL became faster. Exact ordered map/list IDs agree after pagination at all three volumes for next7 and legacy30. PostgREST caps remain unchanged; SQL stress fixtures intentionally measure all 2,000 candidates before that transport cap.

## Checks

- Full application suite: 263 files, 2,116 tests passed.
- Edge suite: 433 passed.
- Typecheck, lint, build, diff whitespace check: passed. Existing large bundle warning remains.
- Renderer/cache browser suite: all 8 desktop/mobile cases passed, including nine icons, mobile fallback/selection, cluster expansion, authoritative empty, retry, retained refresh, capped results and A → B → A reuse.
- Desktop/mobile event journey: 12 passed, 4 viewport-inapplicable skips.
- Browser availability fixtures: desktop 1280×800 and touch-mobile 390×844; paid partial/full/failed/recovered reads, free full/reopened/full/ineligible, and accepted map/list removal verified. No registration/checkout was submitted.
- SQL: 17 fully passing relevant suite runs, 655 assertions across the current-main disposable DB and canonical inventory proof DB. Includes 133 unified-filter assertions, adversarial discovery equivalence/permissions/shared callers, public projections, inventory/paid sales/free registration, moderation edits, cancellation, reservation and fulfillment compatibility.
- Separate concurrency proof: five existing paid cases passed (last ticket, exact retries, atomic competing carts, reversed overlapping carts, attached-session replay); eight free last-place competitors produce one confirmation/seven full responses; eight identical free replays produce one registration. All 99 table counts and local runtime control restored; cron remained off; no provider calls.
- Migration: isolated transactional application/rollback and captured-definition rollback/reapplication verified. Only reserve function definition changes; ACL and ownership preserved. All other public/private function hashes, including fulfillment, remain unchanged.
- Independent review: no Important/Critical production defect found. Nonblocking coverage gaps: no separate expired-order UPDATE-lock race or conflicting replay-after-expiry case; existing inventory/idempotency suites pass.

## Explicit inherited/environment limitations

The optional integration command is not wholly green: 258 tests passed, five skipped, one inherited assertion failed, and three suites could not initialize. `moderationRunnerContract.test.ts` expects `VITE_MAPBOX_ACCESS_TOKEN=task16-disabled`, while unchanged main uses `pk.task16-disabled`. Public-event-visibility, ticketing-concurrency and ticketing-database Node suites require absent dedicated integration organizer credentials. No credentials were fabricated or staging data mutated to bypass those guards.

The strict restored DB exposes old SQL fixture assumptions: some fulfillment/cancellation helpers directly SELECT service-restricted tables; these fail identically outside the repair. The canonical inventory proof DB passes the same reserve/fulfillment/cancellation behavioral suites. `order_confirmation.test.sql` uses fixed past dates and fails `EVENT_TIME_INVALID` in both environments. `checkout_integrity_expiry.test.sql` expects an active cron job; isolated verification deliberately does not enable the scheduler. These are reported as failures/limitations, not flaky passes; no tests, grants or operational gates were weakened to make them green.

Docker initially timed out because approximately 100 historical local services occupied its VM. A user-approved restart and temporary pause of 87 unused services restored reliable SQL execution. An interrupted synthetic fixture was removed by exact IDs; all 99 table counts and the local gate were verified restored before rerunning. The exact paused-service manifest is outside Git and must be resumed after verification. No hosted data was involved.

Physical devices and WebKit remain unverified. Availability is a bounded read snapshot, not a promise to reserve inventory; existing atomic checkout/RSVP enforcement remains authoritative. Refreshes use the existing first-page/cursor-chain replacement behavior rather than downloading every previously paginated page. Task 6B remains a proposal in `task6b-settlement-proposal.md`.

Release identity, migration status and hosted verification are recorded separately after deployment.
