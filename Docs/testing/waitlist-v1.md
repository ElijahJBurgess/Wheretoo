# Waitlist V1 — Build + Prove

## 1. Result

**PASS — implementation and local proof complete; activation is not authorized.** Approved scope: paid, sold-out ticket-tier waitlists; observed availability cycles; accountless identity; normal checkout remains the only reservation authority. No feature-only regression identified. Known baseline failures are retained and listed below.

## 2. Branch and worktree

`codex/waitlist-v1`, `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/waitlist-v1`. The user-owned recovery checkout is preserved. The separate clean-main checkout is `/Users/exoh/Desktop/WhereTo-main-final`.

## 3. Baseline

Fetched and rechecked `origin/main`: `dd33333c4f9f17079559be62ffa1ad2762b4061b`. This matches the approved inspection baseline; no intervening main delta required reconciliation.

## 4. Final HEAD / commit state

HEAD remains `dd33333c4f9f17079559be62ffa1ad2762b4061b`. All implementation and documentation changes are uncommitted. No push, PR, merge, or deployment was performed. The worktree is retained for commit/review.

## 5. Files changed

The complete path inventory is in Appendix A. Main additions are the Waitlist feature UI, private domain migration, four Edge entrypoints, shared email/HTTP/worker modules, two migrations, and local database/concurrency/scale/browser proof runners. Existing edits are limited to buyer and organizer entry points, secure-link bootstrap/router, static handle reservation, generated database types, function/environment configuration, and affected tests. The approved inspection was preserved at `Docs/specs/waitlist-v1-inspect-spec.md`; the implementation plan is `Docs/superpowers/plans/2026-09-23-waitlist-v1.md`.

## 6. Migrations

- `20260924010700_share_ticket_inventory_read.sql`: extract the private read-only inventory helper and reuse it inside the existing public ticket projection.
- `20260924010800_add_waitlist_v1.sql`: private Waitlist lifecycle, mail ledger, bounded observer, owner/public/service contracts, suppression integration, retention, and static route reservation.

Both passed a fresh complete local migration chain. Defaults are OFF; no scheduler is installed. There are no new payment/order/ticket columns. An existing permanent storefront handle named `waitlist` deliberately blocks migration with `WAITLIST_ROUTE_HANDLE_CONFLICT`; it is never silently renamed.

## 7. Inventory equivalence

**2,080 combinations / four pgTAP assertions passed** against the pre-change public projection and authoritative checkout capacity math. Coverage includes exact quantity/expiry boundaries, all protected order states, inactive/expired reservations, partial/full refunds, capacity changes, multiple tiers and overcommitment. Public JSON shape and statement timestamp semantics remain intact. Protected quantity comes from order-item quantities, never tickets, check-ins, orders counted as units, or memberships. Checkout, expiry, fulfillment and refund writers were not changed.

## 8. Data model

Nine private, RLS-enabled tables: `waitlist_settings`, `waitlist_enrollments`, `waitlist_tier_state`, `waitlist_availability_cycles`, `waitlist_deliveries`, `waitlist_leave_tokens`, `waitlist_delivery_observations`, `waitlist_join_requests`, `waitlist_rate_events`. Narrow security-definer contracts use empty search paths and explicit grants; browser roles cannot directly access private state. Immutable enrollment/delivery facts preserve historical and possible-dispatch truth. A durable tier closure cutoff prevents resurrection even if eligibility is restored between bounded cleanup pages.

## 9. Join and dedupe

Strict 2,048-byte JSON façade accepts only eventId, tierId, name, email and requestId. Server checks policy, paid admission, event/tier relationship, active tier, event start, current sold-out inventory, limits and gates. Inventory is sampled after acquiring the existing ticketing boundary, using fresh time. Available inventory returns `TICKETS_AVAILABLE` and creates nothing. Trim/lowercase normalization preserves plus aliases and dots. Duplicate active joins return generic success without renaming, resetting history, rotating authorization or creating another confirmation. Durable request UUID replay and simultaneous duplicate joins are covered. New lifecycle after removal/purchase/closure gets a new UUID. Joins reserve zero tickets.

## 10. Availability cycles

Initial sold-out join establishes cycle zero. One observed sold-out→available transition creates one durable cycle; continued availability creates none. Sold-out observation arms the next transition. Unique enrollment/cycle delivery identity, interrupted fanout/resume and concurrent observers prevent duplication. Members joining after an already-open cycle do not receive it. Notify-all is independent of remaining ticket quantity. Current availability and lifecycle are checked before first possible dispatch; stale unsent mail is suppressed while accepted/unknown history remains truthful.

## 11. Accepted polling limitation

A sold-out→available→sold-out pulse entirely between observer runs may be missed. Proof confirms no invented cycle for an unobserved pulse. No payment/refund/reservation writer hooks were added. Recommended eventual cadence remains 60 seconds, with multiple invocations needed for large backlogs; this is not a delivery-time guarantee.

## 12. Purchase reconciliation

Twelve purchase SQL assertions plus real fulfillment and separate-connection races passed. Only coherent, paid, reconciled, refund-eligible purchases with same event, normalized buyer email and tier, and paid_at strictly after joined_at qualify. Pending/review/failed/expired financial states, wrong email/tier, and pre-join purchases do not qualify. Used tickets still qualify. Later refund does not resurrect Purchased membership. Purchase is rechecked before cycle membership and before dispatch. Reconciliation observes existing truth without changing fulfillment.

## 13. Leave authorization

Random 32-byte `wl1_` bearer, domain-separated hash authorization, no email/enrollment in URL. Fragment is captured and scrubbed before ordinary app routing; tab-local fallback expires after 24 hours. A second same-tab fragment is handled without retaining stale authorization. Navigation/GET does not mutate; explicit POST removes. Valid repeat is harmless, invalid/expired is generic, and old authorization cannot remove a later enrollment. Leave remains usable with join/delivery gates OFF. Browser, SQL and HTTP proof passed.

## 14. Organizer UX

Owner-authorized event route, paid Dashboard and Tickets links, tier demand counts, 50-row newest-first stable pagination, Waiting/Notified/Purchased/Removed status, closed history, loading/error/empty states and confirmed removal. Notified explicitly means provider acceptance, not inbox delivery. Foreign owner access is denied by the server, including a fully onboarded foreign browser session. Mobile table scroll stays inside the page; removal dialog and focus were verified.

## 15. Buyer UX and visual proof

Eight production-build Playwright journeys passed at 390px mobile and 1440px desktop: mixed/all/single sold-out tiers, join and duplicate success, inventory reopening, refresh failure, unchanged cart quantities, no automatic selection/checkout, start/closure, owner pagination/removal/authorization, and leave fragment/confirmation/repeat/invalid-link behavior. Keyboard focus returns to ordinary quantity controls after refreshed inventory commits. Inline form and table overflow defects found during visual QA were fixed, as were label wrapping and same-tab secure-link handling.

Visual QA used the approved spec and existing buyer/organizer patterns, local synthetic accounts, actual browser journeys and inspected screenshots (Level B). This proves local built UI, not hosted freshness. Screenshots live in ignored `.superpowers/waitlist-proof/screens/`: buyer-mobile-form, buyer-desktop-reopened, buyer-all-sold-out, buyer-refresh-failed, owner-mobile-confirm, owner-desktop, owner-closed and leave-mobile-complete.

## 16. Email and worker

Dedicated confirmation/restock ledger and worker; no ticket grants, recovery membership, campaigns or issued tickets. Reuses low-level encrypted envelopes, provider adapter, signature verification and React Email primitives. Confirmation contains no purchase CTA; restock links only to normal ticket selection, with no selected quantity and explicit no-reservation/availability disclaimers. Stable `waitlist/<delivery UUID>` provider key and immutable encrypted bytes survive retries and lost save responses. Prepared facts digest is verified again when saving payload, preventing stale event/price facts from being accepted. Two-minute lease, six-call/23-hour boundary, truthful queued/sending/accepted/failed/unknown/suppressed outcomes. Transient policy uncertainty defers rather than permanently suppressing.

Real local PostgREST→render→encrypt→save→dispatch proof accepted **1,000 unique restock recipients with 1,000 stable unique keys** through injected transport. Signed webhook, owner pagination, foreign denial and repeated leave passed. The CLI explicitly exits only after assertions and evidence writes because React Email runtime handles otherwise keep it alive. No real provider request was made. Repeated scale runs now use per-event synthetic addresses: an earlier repeat correctly suppressed an address retained from the preceding complaint test; the harness was isolated without deleting suppression evidence.

## 17. Suppression and webhook

Shared suppression has exactly one authoritative provenance among ticket, organizer message and Waitlist. All writers clear alternate provenance; all observers reject cross-ledger webhook ID collisions. Signed verification precedes routing; routing demands exactly one ledger. Ticket/organizer suppression affects Waitlist and Waitlist complaint/bounce affects existing mail. SQL replay/collision/suppression tests and real signed complaint passed; tampered signature and wrong-provider observation returned 400.

## 18. Anti-spam

Independent configurable limits: normalized email+tier 3/hour and 10/rolling day; trusted-IP join/leave 60/hour and 300/rolling day; restock one/cycle and maximum three/enrollment/rolling day. Unknown possible dispatch counts toward the cap; retry of the same delivery does not consume another notification. Concurrent third/fourth attempts are tested. Skipped old cycles are not later burst. Independent HMAC fingerprints avoid raw IP storage.

## 19. Capacity isolation

Separate settings, health acknowledgement, observer/delivery gates and provider budget. Concurrent workers cannot double-debit the last Waitlist capacity slot. Ticket transactional and Organizer Email quotas remain unchanged. Missing encryption configuration fails before worker health acknowledgement. Actual shared-provider headroom allocation remains a separate activation prerequisite; local proof capacity is synthetic.

## 20. Concurrency and locks

Real separate database connections/barriers cover expiry, capacity increase, refund, duplicate join, two observers, fanout resume, purchase before membership/dispatch, leave versus dispatch, event start/cancellation/moderation, per-enrollment cap and global capacity races. Dispatch race suite has 13 checks and capacity suite five. Waitlist uses the existing ticketing advisory boundary nonblockingly; event/tier/enrollment rows use NOWAIT where contention could extend it. No Waitlist claim lock is held while waiting for checkout. Provider network calls occur outside transactions. A red race exposed observer blocking on leave; NOWAIT plus cursor preservation fixed it.

Observer transactions handle at most 100 rows and an additional 5ms work budget after policy validation; each handler performs at most 25 round-robin continuation transactions. This trades faster backlog drain for shorter checkout lock impact. Direct timezone validation replaced a roughly 49ms catalog enumeration inside the critical section.

## 21. Scale proof

The final local run created 1,000 active memberships, one observed cycle, and exactly 1,000 unique restock rows. First page processed one member; interruption/resume completed in **63 bounded transactions**, without truncation or duplicate recipients. Fanout transaction median **9.818ms**, p95 **11.311ms**, max **29.278ms**. At 25 continuation transactions per invocation, that backlog needs at least three invocations in this fixture. Subsequent injected transport accepted all 1,000. These timings include policy/transaction work and are not a production SLA.

## 22. Checkout latency / reconciliation lookup

Matched dedicated local pristine-main and feature databases, symmetric warmed persistent connections, 40 normal checkout reservations each: baseline median **5.379ms**, p95 **9.266ms**; concurrent observer median **6.261ms**, p95 **18.514ms**, max **23.719ms**. The measured increase is about 0.88ms median / 9.25ms p95. Observer under checkout: median **1.183ms**, p95 **11.464ms**, max **12.135ms**. This shows bounded local impact, not zero impact or a production guarantee. Purchase lookup EXPLAIN ANALYZE/BUFFERS used the existing `ticket_email_paid_recipient` index (one shared buffer hit, 0.063ms execution); this small fixture did not justify changing order indexes. Production-scale order cardinality/load still requires activation testing.

## 23. Regression results

All 110 legacy SQL suites ran on fresh feature and pristine-main databases: **59 passed / 51 failed on both, identical result objects, zero differential failures**. Inventory public/storefront math, Checkout Integrity, expiry, fulfillment/refunds/tickets, QR/check-in, ticket email/recovery, Email Attendees, CSV and Duplicate Event are covered by the differential and dedicated assertions. Duplicate Event creates no copied Waitlist membership; waitlist-only identities are excluded from Email Attendees. Full frontend: **209 files / 1,756 tests passed** (baseline 207 / 1,750). Full integration comparison matched: 15 files / 257 tests passed, five failed files / two failed assertions, one skipped file / five skipped tests on both.

## 24. Known baseline failures

The 51 unchanged SQL failure names and exact diagnostic strings are in Appendix B. Full integration failures are three suites missing required TEST_* environment (`public-event-visibility`, `ticketing-database`, `ticketing-concurrency`), the legacy moderation projection runner refusing an unlinked query with `LegacyProjectNotLinkedError`, and the existing CSP expected img-src contract missing the current blob allowance. Neither checkout is linked; the refused command executed no hosted query. These are not reported as passing. No unrelated baseline debt was repaired.

## 25. New regressions / review closure

**None found.** A fresh independent whole-branch review identified durable closure across restoration/pages, transient-policy deferral, stale prepared facts at save, and explicit Edge import-map packaging. All were corrected; ten fresh review SQL assertions passed. No actionable reviewer item remains deferred. UI and race failures discovered during proof were fixed and rerun. The public-projection static test now checks the extracted helper and statement_timestamp call; independent 2,080-case behavioral comparison prevents a self-referential equivalence claim.

## 26. Checks

| Check | Result |
|---|---|
| Fresh local full migration chain | Pass |
| Six Waitlist SQL suites | 97 assertions pass |
| Inventory comparison | 4 assertions / 2,080 combinations pass |
| Frontend tests | 1,756 pass |
| Full Deno function tests | 417 pass |
| Frontend/integration/E2E/scripts typecheck | Pass |
| Edge function typecheck | Pass |
| ESLint | Pass |
| Production build | Pass, also used by browser proof |
| Playwright Waitlist journeys | 8 pass |
| Real concurrency / capacity / scale / injected delivery | Pass |
| Legacy SQL / integration differential | Identical baseline failures, as above |
| Diff whitespace / artifact review | Pass |

## 27. Security and privacy

Private RLS/ACL boundaries, owner authorization, strict public input, origin checks, trusted-IP configuration, independent hashed abuse identity, secure bearer lifetime/replay, encrypted immutable payloads, signature-first routing and cross-ledger ambiguity denial were reviewed/tested. No privileged secrets belong in browser configuration. Retention removes eligible terminal sensitive data after 90 days, preserving unknown/retry/suppression/authorization/replay/anti-spam evidence. Synthetic tokens, local credentials and provider captures are ignored proof artifacts, not source files. No new production placeholders, TODOs or fake production data were introduced.

## 28. Remaining risks and limits

No implementation blocker identified. Accepted polling can miss brief openings; notify-all can outlast inventory; accepted does not mean delivered; local capacity and timing are not production provider/load certification. Known baseline SQL/CSP/environment failures remain. Activation must handle static-route conflicts and validate larger-order-cardinality reconciliation performance. The durable closure cutoff and payload-facts binding are correctness protections, not new product scope.

## 29. Activation / manual setup still required

A separately authorized activation task must: preflight permanent `waitlist` handle conflicts; apply reviewed migrations; deploy four functions and shared webhook changes with import maps; configure sender/reply-to/support/origin and existing encryption keyring; provision distinct observer/delivery/rate secrets; verify a gateway-controlled trusted IP header cannot be spoofed; allocate real provider capacity with transactional headroom; run staging smoke/load/retry/suppression/leave proof; install authorized observer/worker and retention scheduling (recommended observer cadence 60 seconds); then enable gates deliberately with rollback and monitoring. Provider capacity defaults are unset. No DNS/provider setup was performed here.

## 30. Activation boundary respected

No real email, hosted migration, function/frontend deployment, DNS change, hosted scheduler or hosted gate activation occurred. Dedicated local synthetic proof temporarily enabled gates only in `wheretoo-waitlist` (API 63321 / DB 63322); baseline is `wheretoo-waitlist-baseline` (64321 / 64322). Local gates were returned OFF for handoff and no local cron remains active. Source defaults remain OFF. Future automatic staging deployment on merge is outside this task.

## 31. Recommendation

**Yes — ready to commit and review for merge.** Keep activation OFF. Do not treat this recommendation as authorization to commit, push, merge or activate. Stop after this Build + Prove handoff.

## Reproduction and evidence

Ignored evidence is retained under `.superpowers/waitlist-proof/`, including final logs, baseline/feature results, regression-diff.json, database-results.json, scale.json, concurrency/dispatch/capacity outputs, purchase-explain.txt, delivery-flow.json and screenshots. Do not commit captured credentials/tokens/provider payloads.

Use the dedicated `run-waitlist-local.py start/reset` commands (and `--baseline` for baseline), then `waitlist-inventory.py`, `waitlist-database.py`, and `waitlist-regressions.py` before persistent fixtures. The reset runner hardcodes and guards dedicated local project identities and disables local cron. Next run concurrency, dispatch-races, capacity and scale Python runners. Prepare only the chosen scale fixture's due restock deliveries, acknowledge local health, and run `pnpm exec deno run --allow-env --allow-read --allow-write --allow-net=127.0.0.1:63321 tests/integration/edge/waitlist/local.ts`; transport is injected. Run `pnpm exec playwright test --config playwright.waitlist.config.ts` after delivery proof, then return local gates OFF. Reset only these dedicated proof stacks before rerunning rollback suites; do not reset user or hosted databases. Do not blindly run environment-dependent linked legacy runners.

Planning rulings: preserve uncommitted handoff instead of per-task commits; separate inventory runner; bound observer by both row count and elapsed work; persist closure cutoff before materialization; fail static handle conflicts rather than rename; preserve unrelated baseline debt. All are within approved scope. No further founder decision was required.

## Appendix A — file inventory

```text
.env.example
src/app/router/router.tsx
src/features/organizer-operations/OrganizerDashboardPage.tsx
src/features/storefront/storefront.handle.ts
src/features/tickets/OrganizerTicketTiersPage.tsx
src/features/tickets/PublicTicketEventPage.test.tsx
src/features/tickets/PublicTicketEventPage.tsx
src/features/tickets/TicketTierList.tsx
src/lib/supabase/database.types.ts
src/main.tsx
src/preview/screens.json
src/preview/screens.render.test.tsx
supabase/config.toml
supabase/tests/database/public_eligibility_projections.test.sql
Docs/specs/waitlist-v1-build-approval.md
Docs/specs/waitlist-v1-inspect-spec.md
Docs/superpowers/plans/2026-09-23-waitlist-v1.md
Docs/testing/waitlist-v1.md
playwright.waitlist.config.ts
src/features/waitlist/OrganizerWaitlistPage.tsx
src/features/waitlist/WaitlistJoinForm.test.tsx
src/features/waitlist/WaitlistJoinForm.tsx
src/features/waitlist/WaitlistLeavePage.tsx
src/features/waitlist/waitlist.api.ts
src/features/waitlist/waitlist.css
src/features/waitlist/waitlist.queries.ts
src/features/waitlist/waitlist.session.test.ts
src/features/waitlist/waitlist.session.ts
supabase/functions/_shared/emails/WaitlistEmail.tsx
supabase/functions/_shared/waitlistEmail.ts
supabase/functions/_shared/waitlistHttp.test.ts
supabase/functions/_shared/waitlistHttp.ts
supabase/functions/_shared/waitlistWorker.test.ts
supabase/functions/_shared/waitlistWorker.ts
supabase/functions/_shared/waitlistWorkerHttp.test.ts
supabase/functions/_shared/waitlistWorkerHttp.ts
supabase/functions/waitlist-email-worker/index.ts
supabase/functions/waitlist-join/index.ts
supabase/functions/waitlist-leave/index.ts
supabase/functions/waitlist-observer/index.ts
supabase/migrations/20260924010700_share_ticket_inventory_read.sql
supabase/migrations/20260924010800_add_waitlist_v1.sql
tests/e2e/support/waitlist.ts
tests/e2e/waitlist.spec.ts
tests/integration/edge/waitlist/local.ts
tests/integration/run-waitlist-local.py
tests/integration/waitlist-budget.sql
tests/integration/waitlist-capacity.py
tests/integration/waitlist-concurrency.py
tests/integration/waitlist-database.py
tests/integration/waitlist-dispatch-races.py
tests/integration/waitlist-inventory.py
tests/integration/waitlist-inventory.sql
tests/integration/waitlist-mail.sql
tests/integration/waitlist-proof.py
tests/integration/waitlist-purchase.sql
tests/integration/waitlist-regressions.py
tests/integration/waitlist-review.sql
tests/integration/waitlist-safety.sql
tests/integration/waitlist-scale.py
tests/integration/waitlist-v1.sql
```

## Appendix B — identical legacy SQL failures

### checkout_integrity_confirmation.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/checkout_integrity_confirmation.test.sql:233: ERROR:  permission denied for table orders
```

### checkout_integrity_contract_cleanup.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/checkout_integrity_contract_cleanup.test.sql:197: ERROR:  permission denied for table order_items
```

### checkout_integrity_fixture_lifecycle.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/checkout_integrity_fixture_lifecycle.test.sql:115: ERROR:  permission denied for table ticket_tiers
```

### checkout_integrity_fulfillment.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/checkout_integrity_fulfillment.test.sql:276: ERROR:  permission denied for table orders
```

### checkout_integrity_refunds.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/checkout_integrity_refunds.test.sql:150: ERROR:  permission denied for table orders
```

### checkout_integrity_reservation.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/checkout_integrity_reservation.test.sql:416: ERROR:  permission denied for table ticket_tiers
```

### connect_refresh_sequence.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/connect_refresh_sequence.test.sql:156: ERROR:  permission denied for table organizer_stripe_accounts
```

### core_ticket_truth_lite_collection.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### core_ticket_truth_lite_fulfillment.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### core_ticket_truth_lite_lifecycle.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### core_ticket_truth_lite_redemption.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### core_ticket_truth_lite_schema.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### moderation_evaluations.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/moderation_evaluations.test.sql:180: ERROR:  permission denied for table events
```

### moderation_policy_acceptance.test.sql

```text
not ok 27 - the acceptance boundary has no client authority beyond event identity
```

### order_confirmation.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/order_confirmation.test.sql:201: ERROR:  permission denied for table orders
```

### organizer_csv_export.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### organizer_csv_export_equivalence.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### organizer_csv_export_lifecycle.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### organizer_event_metrics.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### organizer_manual_admission.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### organizer_order_reads.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### organizer_refund_context.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### payment_fulfillment.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/payment_fulfillment.test.sql:221: ERROR:  permission denied for table stripe_webhook_events
```

### publish_event.test.sql

```text
not ok 3 - another organizer event is rejected
```

### refunds_disputes.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/refunds_disputes.test.sql:192: ERROR:  permission denied for table orders
```

### spec04_organizer_reads.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### spec05_admission_search.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### spec07_email_initial_status.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### spec07_email_preparation_resume.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### spec07_email_recipient_policy.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### spec08_checkout_expiry.test.sql

```text
not ok 2 - one exact database-owned expiry job remains inaccessible to browser and service roles
```

### spec08_spec09_integration.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec08_spec09_notice_failure.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### spec09_refund_lifecycle.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec09_refund_notice_access.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### spec09_refund_operations.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec10_cancellation_summary.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec10_event_notices.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec10_late_payment_read.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec10_notice_access_and_lifecycle.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec10_private_collection_facts.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec10_refund_summary_states.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec10_used_notice_audience.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec11_profile_revision.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/spec09_refund_setup.inc:126: ERROR:  permission denied for table orders
```

### spec14_assembly_contracts.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/spec14_assembly_contracts.test.sql:4: ERROR:  function plan(integer) does not exist
```

### storefront_attribution.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### storefront_transactions.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/helpers/core_ticket_truth_lite_setup.inc:182: ERROR:  permission denied for table orders
```

### ticketing_schema.test.sql

```text
not ok 14 - ticket columns are exact
not ok 22 - ticket column types are exact
not ok 34 - financial foreign keys are exact
not ok 57 - Stripe IDs and Day 2 domain keys are uniquely constrained
not ok 59 - all financial foreign keys use ON DELETE RESTRICT
```

### unattached_checkout_forward.test.sql

```text
not ok 19 - existing fulfillment enqueues initial email exactly once
```

### webhook_reconciliation.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/webhook_reconciliation.test.sql:91: ERROR:  permission denied for table stripe_webhook_events
```

### webhook_review_safety.test.sql

```text
psql:/tmp/waitlist-regressions/tests/database/webhook_review_safety.test.sql:306: ERROR:  permission denied for table orders
```
