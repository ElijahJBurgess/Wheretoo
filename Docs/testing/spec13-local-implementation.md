# Spec 13 — controlled local implementation

Status: completed within the approved local boundaries. Provider-connected journey gaps remain explicitly listed below.

## Completion levels

1. **Visual complete in isolated preview.** `/preview/discovery` contains the full photo hero, event rows, filters, responsive navigation and all eleven fixture states. Fixtures are visibly labeled sample data and use the existing reference asset. Live discovery displays category artwork, `Free` or `View prices`, and `View event`; it does not invent photos, numeric prices or availability.
2. **Integrated discovery complete locally.** Anonymous routing, strict public reads, URL filters, paging, cache/history restoration and existing event handoffs are integrated with M01/M02 in the isolated worktree and disposable database.
3. **Connected V1 journeys: locally verified portions; remaining gaps below.** Actual local paid/free public readers, paid selection, free RSVP registration/confirmation/private QR, and anonymous organizer entry have been exercised. Hosted Stripe payment through confirmation and paid private tickets, live email recovery, and real authenticated provider sessions were not exercised. Existing SQL/handler regressions cover their domain boundaries; those checks are not a claim of provider readiness.

## Exact baseline and ownership

- Destination: `/Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec13-discovery-home`.
- Branch: `codex/spec13-discovery-home`; HEAD: `94c546bd0961f501584f8a3437298b2331cafd5c`. No implementation commit; staging remains empty.
- Candidate: Spec12 worktree, `codex/spec12-shared-states`, same HEAD, including its inherited local work.
- Reconciliation sources: main `main` and organizer-create `codex/organizer-create-flow`, both at `1d87c88fbb9da4ea4bf335659de7623af084c92e`.
- The inherited manifest resolves **966 entries: 962 present files and 4 intentional deletions**. It records 957 candidate entries, 24 overrides, 7 added reconciliation tests, and 2 unchanged base-HEAD reports. All 584 base-HEAD tracked paths are accounted for. This is a per-file selection with hashes, not a directory replacement or reset to the quoted remote baseline.
- Current main/organizer-create auth, onboarding and buyer presentation were reconciled with the candidate's newer identity lifetime, safe-return, freshness and shared-state behavior. Candidate domain migrations and strict paid/free reader correction were preserved. Existing RSVP was reused. The separate organizer-create wizard was not imported wholesale; its further integration remains separate from discovery.
- Reconciled baseline checks fixed stale test clocks, the preview's newer event-change context, inactive Tickets-link focus assumptions, and canonical preview captures. The final existing collection SQL allowlist now matches inherited Spec10 approved event facts and `used_at`; no transaction authority was changed by that test correction.

[Inherited manifest](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec13-discovery-home/.superpowers/spec13/inherited-file-manifest.json>), [baseline report](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec13-discovery-home/.superpowers/spec13/baseline-final-report.md>), [source audit](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec13-discovery-home/.superpowers/spec13/final-source-audit.json>), [incremental file manifest](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec13-discovery-home/.superpowers/spec13/implementation-file-manifest.json>).

The final source audit checked 28 worktrees. All source HEADs, branches and indexes match their initial records. All recorded source files are unchanged. 27 worktrees match exactly; the map worktree acquired one external untracked document, `Docs/testing/map-icon-library-handoff.md` (SHA-256 `b70e099977512d20713faafca3127f64f641d70f4f83c0b44ae11653a8dfc216`). This task did not edit it or any map worktree file.

## Approved defaults retained

Anonymous `/discover`; `/` preserves only valid public filters when redirecting; fixed SF Bay Area; `America/Los_Angeles` calendar boundaries; Upcoming through midnight today+30 calendar days; Today; Friday-through-Monday Weekend (current weekend Friday–Sunday, next weekend Monday–Thursday); one category and one Free/Paid filter combined with AND; 20 results per page; explicit Load more; `View event` handoffs. All eight canonical categories remain supported, with the three specified shortcuts visible. No search, geolocation, new Tickets tab or map changes.

Client freshness remains 60 seconds with 10-minute public cache retention. Back restores cached pages/scroll; hard reload starts at page one. Filter changes reset pagination. Refresh replaces the page chain. Obsolete requests cannot resurrect rows or retain a pagination lock. Invalid cursors restart once with feedback. Rate responses retain a local retry countdown without network polling.

## G01–G06 and contracts

| Gate | Implemented resolution and remaining boundary |
|---|---|
| G01 listing | M01 reuses `private.event_is_publicly_eligible`, canonical paid-tier eligibility, location and event fields. All filters, interval overlap, tuple seek and eligibility apply before the only limit+1. The map RPC is unchanged. |
| G02 price/state | Live admission remains `unknown`, numeric amount/currency null. Paid shows `View prices`; free shows `Free`. P01 remains separately gated; active tiers are not treated as sellable inventory. |
| G03 recovery | Tickets navigation is absent. Existing secure recovery remains inherited, with provider activation and end-to-end delivery unverified. No email-to-order lookup or new access reconstruction. |
| G04 free RSVP | Candidate strict paid/free public-reader correction is integrated. Canonical free shell is accepted directly; absent-shell fallback remains tested. Existing free RSVP creates real disposable registrations and reaches its private admission QR. |
| G05 artwork | Canonical publication still requires null artwork. No rule is bypassed. Live DTO requires null artwork; fallback rows remain usable. Preview alone demonstrates hero/photos. |
| G06 root/auth | Anonymous lazy discovery sits outside session/organizer shells. Organize reaches existing guarded routes. Approved onboarding visuals, safe sign-in return and organizer requirements remain intact. |

The new Edge request accepts only region, preset, optional category/admission type, page limit and opaque cursor. It accepts no buyer identity, coordinates, arbitrary date window or return destination. Responses allow only public event fields, window/server time and next cursor. Invalid rows become null sentinels before transport; the browser quarantines them without extra reads or raw payload logging. All-invalid nonempty data fails safely. Public text validation matches PostgreSQL Unicode code-point limits through the public event handoff.

M01 uses rectangular PostGIS geometry intersection to match existing canonical Bay Area latitude/longitude boundaries. The cursor is untrusted, versioned, bounded to 1 KiB and 15 minutes, bound to normalized filters/window, and ordered by `(starts_at,id)`. It does not freeze a database snapshot.

## Migrations and rate protection

- **M01** `20260917010000_add_public_discovery_read.sql`: required read/window/cursor helpers and service-only RPC; no new event store or widened base-table access.
- **M02** `20260917010100_add_discovery_read_rate_limit.sql`: separate private fixed-minute HMAC identity buckets, atomic 60/minute provisional threshold, counter cap 61, unique identity/window key, expiry index, and at most 100 locked expired tuple deletes per request. One hour is an expiry age threshold, not a guaranteed retention deadline under idle traffic/backlog.
- **M03 omitted.** Measured candidate indexes did not consistently help. An ordered cheap-candidate subquery with no inner limit improved five representative cases from 575–4898 ms to 45–53 ms using existing indexes. The fixture had 2,048 published and 4,096 draft events, plus 64 local browser fixtures. These measurements are comparisons, not production latency guarantees.
- **P01 remains gated.** No numeric/open-state projection, artwork publication change or provider refresh was added.

All 121 migrations (119 inherited + 2 new) replayed in a dedicated identity-guarded loopback database. The harness restores cached Supabase platform service defaults before migration replay, preserving application revokes. Cached pg_cron ownership is handled explicitly and its launcher stays disabled. No linked/shared database or provider was used.

[Backend implementation, commands and evidence](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec13-discovery-home/.superpowers/spec13/backend-report.md>).

## File ownership and reuse

| Owner/scope | Files and reuse |
|---|---|
| Discovery | New `src/features/discovery/` modules own filters, strict schemas, anonymous API, query lifecycle, public navigation state, presentation and scoped CSS. Existing event categories, buyer schedule/money formatting and visual language are reused. |
| Preview | `src/preview/DiscoveryPreview.tsx`, fixtures and styles; narrow catalog/PreviewApp registration. Sample artwork never enters the live discovery adapter. |
| Router/runtime | Root/discover attachment and `ProductionTicketCollectionRoute.tsx` lazy wiring; singleton existing collection reader and private QR implementation retained. |
| Buyer/returns | Narrow Browse events actions in public event/selection, order/RSVP confirmation, ticket overview and event-status views. Public returns carry only normalized filters; private exits use plain `/discover`. |
| Existing reader contract | `ticket.schemas.ts` uses new `publicText.schema.ts` for canonical Unicode limits. Existing strict paid/free reader and RSVP implementations remain authoritative. |
| Backend | New discovery function, M01/M02, SQL proof suites and guarded disposable runners; only two RPC entries added to shared database types and one function registration to config. |
| Verification | New discovery tests, isolated Playwright config/suite and one inherited SQL allowlist reconciliation. No owner transaction logic or source-worktree staging. |

The incremental manifest records each file's baseline/current hash and whether it is added or changed; inherited work is accounted separately.

## Verification

- Full frontend: **169 files, 1,406 tests passed** (`pnpm test --maxWorkers=4`).
- Full TypeScript projects and repository lint: passed.
- Edge: **342 tests passed**, function and local-harness typechecks passed, scoped lint passed.
- Disposable SQL: **27 inherited owner suites / 939 assertions passed**, plus **5 discovery suites / 66 assertions passed**. Includes ownership/RLS, eligibility, inventory, fulfillment, free registration, collection/redemption, cancellation/refunds, recovery/access and event-change/settings integration.
- Rate race: eight requests competing for the final slot yield exactly one allowed and seven denied. Bounded cleanup measured against 10,000 expired rows, with 100 selected/deleted per call.
- Independent backend and integration source reviews: no remaining important findings. Pagination review regression fails before the fix and passes after it.
- Production build with previews disabled: passed. Built assets contain no discovery preview controls or fixtures.
- **Four production-build browser tests passed**: anonymous entry/paging/Back/reload/AND filters/organizer sign-in; corrected paid/free public reads and real RSVP/private QR; five responsive widths and isolated failure states; keyboard focus, 44px targets, 200% text resizing and last-row clearance. The browser timezone is Asia/Tokyo while discovery uses server LA calendar rules.
- Final `git diff --check`, E2E TypeScript and scoped E2E lint: passed.

Screenshots were inspected at 320, 390, 430, 768 and 1440px, plus loading/empty/rate-limited/malformed states, live neutral rows and enlarged text. Date controls stay on one row at normal text size; enlarged text can wrap. The mobile navigation in full-document screenshots appears across its viewport position; scrolled viewport checks prove the last event remains reachable above it.

Tests ran with synthetic process-only environment values. The browser uses a production build with a local fixture-preview flag, an allowlisted loopback proxy, real disposable SQL, and existing owner handlers. Its proxy maps only the test origin; it does not validate a deployed gateway's trusted-IP configuration. No private-ticket screenshots, traces or videos are retained.

## Remaining gates and local review

1. Production endpoint activation requires separately authorized deployment/schema readiness, server-only independent HMAC secret, verified overwritten trusted-IP header and shared-network rate testing. **60/minute remains provisional.**
2. Hosted Stripe payment/fulfillment and live authenticated provider sessions were not exercised in this local browser proof. Existing domain regressions pass; connected provider readiness is still a separate proof.
3. Email recovery/delivery activation remains gated; public Tickets navigation stays absent. Existing private confirmation retains truthful delivery/error fallback behavior.
4. P01 and an approved public artwork resolver/publication contract remain separate. No live hero currently qualifies.
5. The independent organizer-create wizard is not part of this discovery increment; current guarded organizer foundation and approved onboarding presentation are preserved.

Local preview: `http://127.0.0.1:3033/preview/discovery`; local discovery: `http://127.0.0.1:3033/discover`. Dedicated DB/REST/transport use 55565/55566/55567 with recorded identities. Browser fixtures expire naturally after their stored event dates; they are local proof data, not production inventory. Reproduction and process configuration are in the backend report.

No commits, pushes, merges, deployment, shared-database changes, provider activation, source staging or map-worktree edits were performed.

Verification logs and screenshots are stored in `.superpowers/spec13/`: `completion-frontend-tests.log`, `completion-typecheck.log`, `completion-lint.log`, `completion-build.log`, `completion-browser.log`, `backend-owner-regressions-final.log`, `backend-final-sql.log`, `backend-final-functions.log`, and `visual/`. The final source audit was captured at 2026-09-13 12:56 PDT.
