# Spec 12 Activation / Implementation Readiness Report

11 September 2026. Read-only activation audit; the only repository file created by this pass is this report. No implementation is approved or performed.

The shared presentation work is small, but the complete integration is **blocked on an accepted baseline and several domain classifications**. Main is not the operations/check-in baseline. Newer local RSVP and delivery implementations exist, but they are not a frozen integrated release. The proposal below preserves those implementations and identifies a separately approvable presentation increment.

Authority: the user's pasted activation request and [standalone Spec 12 PDF](/Users/exoh/Downloads/Wheretoo_Spec_12_Error_Empty_Loading_States.pdf). All ten PDF pages were extracted; the original R10 board was extracted and visually inspected. Repository product definition, user flows, architecture, routes, state containers, adapters, relevant migrations, tests and local reports were inspected. Historical handoffs are evidence, not fresh verification or authorization.

## 1. Current branch and HEAD

Actual workspace: `/Users/exoh/Desktop/WhereTo -  Repository` — two spaces before `Repository`, unlike the single-space path in the pasted request.

- Branch: `main`.
- HEAD: `1d87c88fbb9da4ea4bf335659de7623af084c92e`.
- Local `main` and local remote-tracking `origin/main` point to that commit. No fetch was performed; this is not a certification of the live remote.
- Main had 73 existing modified/deleted/untracked status entries at the audit snapshot, including Buyer Journey, Onboarding, previews, reference artwork, the Spec 09 activation report and a checkout migration. None were staged, reset, copied or discarded.
- The clean operations branch is 15 commits ahead of main, with zero main-only commits. A shared branch HEAD does not capture the uncommitted Spec 04–07 implementations.

## 2. Relevant branches and worktrees

All 21 local worktrees were inventoried. Paths below are actual worktrees; dirty counts are observations, not an instruction to absorb their contents.

| Branch / worktree | HEAD | Snapshot and relevance |
|---|---|---|
| `codex/organizer-operations-v1` — [.worktrees/organizer-operations-v1](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/organizer-operations-v1>) | `94c546b` | Clean; committed paid operations, owner reads, manual admission and refund foundation. |
| `codex/spec04-integration` — [.worktrees/spec04-integration](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec04-integration>) | `94c546b` | 134 dirty entries; newer My Events, dashboard, filtered orders, V2 order details, Create/Buyer/Onboarding inheritance. |
| `codex/spec05-check-in` — [.worktrees/spec05-check-in](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in>) | `94c546b` | 165 dirty entries; inherits Spec 04; adds check-in home, guest search/detail and uncertainty preservation. |
| `codex/spec06-free-rsvp` — [.worktrees/spec06-free-rsvp](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp>) | `94c546b` | 54 dirty entries; free-registration source, buyer routes, owner free reads and shared admission dispatch. Does not integrate the complete newer Spec 05 UI. |
| `codex/spec07-ticket-email` — [.worktrees/spec07-ticket-email](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec07-ticket-email>) | `94c546b` | 157 dirty entries; broadest dependency tree, combining newer operations/check-in, free source, delivery/access and narrow registration lookup/detail. Uncommitted; acceptance must identify actual file contents. |
| `codex/organizer-create-flow` — [WhereTo-organizer-create](/Users/exoh/Desktop/WhereTo-organizer-create) | `1d87c88` | 102 dirty entries; newer creation wizard/layout/outcomes plus inherited buyer/onboarding work. |
| `codex/wheretoo-v1-map` — [.worktrees/wheretoo-v1-map](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/wheretoo-v1-map>) | `b80285a` | Clean; `/map`, renderer, event layers, clustering, chooser and preview. Development event fixtures; production event array is empty without an authoritative discovery query. |
| `codex/whereto-v1-context-map-implementation` | `e0da65d` | 26 dirty entries; separate earlier renderer/visual spike. Not an integrated discovery baseline. |
| `codex/build-3a-cartoon-direction`, `codex/build-3a-cartoon-mood-mobile`, `codex/build-3a-living-map-core` | `d2ba50d`, `0d74c5e`, `0123a3c` | Clean visual/rendering branches, preserved. Living-map core is at `/Users/exoh/Desktop/WhereTo-build-3a`. |
| `codex/checkout-integrity-1`, `codex/core-ticket-truth-lite-1`, `codex/ticket-experience-shells-1` | `4814d42`, `f05f907`, `6ec5a51` | Transaction/ticket lineage; first two clean, ticket-shell tree has one dirty entry. |
| `codex/final-integration` | `1d87c88` | Clean; name does not mean newer Specs 04–07 are integrated. |
| `v0/wheretoo-ticket-selection-ed004868` | `bf18e18` | Five dirty entries; preview lineage. |
| Remaining context-map and ticket-truth plan/spec worktrees | `f296109`, `284d628`, `47a45bc`, `957ff0d` | Clean planning/reference history. |

Local `codex/buyer-journey-v1` and `codex/dev-buyer-test-world-1` also point to main's commit; their names do not preserve main's working changes. The backup branch at `8135306` is historical, not a reset target.

Content comparison confirmed Spec 05 and Spec 07 currently share identical operations query hooks, `CheckInLayout` and `OperationalScanner`; their routers differ, and their collection adapters differ. Spec 06's operations hooks/scanner are older. Therefore neither wholesale copying Spec 06 nor treating Spec 07's HEAD as its contents is safe.

## 3. Migration baseline

These are **on-disk migration files**, not verified applied database versions. No database was started, queried, reset or migrated during this pass.

| Tree | SQL files | Highest migration file |
|---|---:|---|
| Main committed files | 90 | `20260907010300_preserve_lite_ticket_invalidation.sql` |
| Main working tree | 91 | Untracked `20260909010100_allow_checkout_preflight_status_refresh.sql` |
| Clean operations | 96 | `20260910010350_add_owned_refund_evidence_recovery.sql` |
| Spec 04 working tree | 98 | `20260911010000_extend_spec04_organizer_reads.sql` |
| Spec 05 working tree | 99 | `20260911020000_add_owned_admission_search.sql` |
| Spec 06 working tree | 100 | `20260912010300_add_free_owner_reads_and_rate_limit.sql` |
| Spec 07 working tree | 110 | `20260913010600_add_email_retention_and_recipient_suppression.sql` |

Spec 04/05 include the untracked checkout refresh migration; Spec 06's count is a different lineage, not a superset of Spec 05. Spec 07 contains both lineages plus seven delivery migrations. Its highest version alone does not certify schema compatibility.

Inspected safeguards include owner-only/RLS event reads; paid-event owner guards; coherent historical metrics; bounded filtered orders and admission searches; separate free registrations; atomic admission authority; existing refund recovery; and scoped delivery/access reads. Existing migrations must remain with their owners. No Spec 12 schema extension is proposed.

## 4. Existing shared async/error/loading components

- [AsyncState](</Users/exoh/Desktop/WhereTo -  Repository/src/components/ui/AsyncState.tsx>): existing presentation-only primitive with `status: loading | empty | error`, title, description and action slot. Already uses `aria-busy`, polite status and assertive error announcements. It does not retry automatically. Its title is a paragraph; it has a spinner rather than content skeletons.
- [FormErrorSummary](</Users/exoh/Desktop/WhereTo -  Repository/src/components/ui/FormErrorSummary.tsx>), `Field`, `Button`: reusable form validation/alert/action primitives. They must not receive arbitrary provider error strings.
- Buyer containers `PublicEventState`, `CheckoutState`, confirmation `StandaloneState`, and `TicketPageState`: preserve buyer shells, but duplicate status composition and heading treatment.
- Spec 04/05 [OperationsUi](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/OperationsUi.tsx>): `OperationsError`, layout, hero and existing operation styles. Its generic connection/access wording loses useful distinctions; the action remains parent-supplied.
- `OperationsDialog`, `UnsavedChangesDialog`, existing admission result views, onboarding status panels and delivery notices/dialogs are domain-specific reusable containers.
- No general toast system, global state registry, reusable route-state component or content skeleton library was found in the inspected production paths. Development preview screens are not runtime authority.

## 5. Existing error boundaries

The only explicit React error boundary found in these app trees is `ConnectChunkErrorBoundary` inside [ConnectEmbeddedPanel](</Users/exoh/Desktop/WhereTo -  Repository/src/features/payments/ConnectEmbeddedPanel.tsx>). Its retry recreates the lazy embedded component; preserve that narrow behavior.

The app router has no explicit `errorElement`, route `ErrorBoundary`, or custom `useRouteError` renderer. `App` simply mounts `RouterProvider`. Main's initial `Promise.all` dynamic imports and the preview import have no rejection presentation. A route render/import exception therefore has no designed safe fallback; an initial import rejection can leave the application without usable UI.

Plan an eager, sanitized route error boundary and a small startup failure rendering path. Preserve parent shells by placing child boundaries below them, with a final shell-free fallback for a shell/startup failure. Never print error objects, stack traces or private route parameters. Do not attach generic remount/reload recovery to transaction pages.

## 6. Current 404 handling

There is no router catch-all. Unmatched production URLs fall through to React Router's default error handling. A disabled `/preview` entry renders a bare `Page not found` heading before routing.

Public event `null` currently renders `Event not found` using `status="empty"`. Owned event `null` similarly means safe absence, including RLS-hidden resources. Confirmation has an explicit `ORDER_NOT_FOUND` path. Private collection `unavailable` is deliberately not a public 404.

Root `/` redirects to `/auth/sign-in`, not a consumer homepage. Use `/organizer/events` for authenticated organizer return, `/auth/sign-in` labeled accurately for organizer sign-in, and a verified parent event URL only when available. Public unknown routes can provide a guarded Back action and an accurately labeled existing destination; do not invent a consumer home.

## 7. Current unauthorized/session-expired handling

[SessionProvider](</Users/exoh/Desktop/WhereTo -  Repository/src/features/auth/SessionProvider.tsx>) exposes loading/anonymous/authenticated, handles Auth events, suppresses late initial lookup results and evicts private query families before changing identity. Initial session lookup rejection currently becomes anonymous; there is no separate session-read-failure state.

`RequireSession` redirects anonymous users to sign-in and stores `state.from`. `SignInPage` does **not** consume that return state: successful sign-in goes to My Events. This is a safe existing destination but not a complete return-to-resource flow. Do not claim such a flow already exists. An allowlisted internal return flow, if wanted, requires Auth-owner agreement and ownership revalidation.

`RequireOrganizer` separates query failure from missing/incomplete onboarding. `RequireStaff` distinguishes failed role read from missing role, but presents the latter as `empty` rather than denied. A resource request failing with an expired JWT is not centrally translated into session recovery.

Paid operations use a safe `OperationsReadError` with only an `accessDenied` boolean. SQL `42501` is overloaded: `private.require_owned_paid_event` emits it for anonymous, missing, foreign **and free** events. Consequently it is suitable for suppressing private data, but insufficient proof for the strict “authenticated + real resource + insufficient permission” state. Do not query foreign metadata to resolve that ambiguity.

## 8. Current offline/connectivity handling

No application `navigator.onLine` hint or online/offline UI listener was found. React Query is already present; public ticketing explicitly sets `refetchOnReconnect: true`, focus refresh and a visible-page 15-second read interval. Other queries mostly inherit defaults. Local-effect readers for ticket collections, RSVP and private email access have no common reconnect mechanism.

Plan a passive browser connectivity hint, composed inside existing shells. Parent adapters handle paused reads and canonical refresh on reconnect. The hint must not declare a failed payment/admission/send, hide an established result, clear drafts, or invoke a mutation. A paused initial read needs an explanation rather than an apparently endless skeleton. Online status is not proof that Supabase, Stripe or email is reachable.

No service worker, private data persistence, offline admission, offline mutation queue or replay is proposed.

## 9. Current map implementation status

Main's router contains no `/map`; main has no integrated map subsystem. Newer Create/Spec 04/05 trees contain inherited map files without integrating an authoritative discovery route. The separate map branch has a real renderer/cluster/chooser prototype and `/map` route.

[LivingMapPage on the map branch](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/wheretoo-v1-map/src/map/LivingMapPage.tsx>) loads development fixture events in development and initializes production events to `[]`. `onMoveEnd` is `ignoreViewport`. There is no current area/filter/date authoritative event-query contract in this page. Renderer status is separate and explicit (`loading`, `ready`, `error`), with structured renderer errors; its failure copy currently asks for reload. No geolocation permission flow was found in this implementation.

This is meaningful map work to preserve, but not accepted integrated discovery. A production empty array here is **not evidence of no events**.

## 10. No Events on Map readiness

**DEFERRED PRESENTATION — MAP OWNER.** Missing accepted query identity and successful authoritative zero result for current viewport/time/category. R10 can be represented in a labeled synthetic preview after approval, but must not be wired to the prototype's default empty array. Adjust filters and Explore another area require existing owner callbacks; no new geography/query feature is included.

## 11. Location Permission Denied readiness

**DEFERRED PRESENTATION — MAP OWNER.** No accepted permission/manual-area controller to attach to. Preserve the board's visual language but replace unsupported Open settings with short browser instructions and an explicit Try location again only when the owner supplies that action. Continue without location must retain the manual area. No automatic prompt loop or guessed-area replacement.

## 12. Map Failed readiness

**DEFERRED PRESENTATION — MAP OWNER.** The separate renderer exposes usable error causes, but no accepted integrated retry/reset callback or discovery query layer. Future presentation can preserve loaded event/address context and retry the failed layer. Do not translate this into full-page reload, fake-map recovery or a map build under Spec 12.

## 13. No Organizer Events query/state boundary

[listOwnedEvents/useOwnedEvents](</Users/exoh/Desktop/WhereTo -  Repository/src/features/events/event.queries.ts>) reads owner-filtered events; key is `['events','owned',ownerId]`. SQL/RLS remain authoritative. UI checks pending and error before empty. Newer Spec 04 additionally has status filters and owner-scoped view/scroll preferences.

Adapt only successful complete list zero to `No events yet` with **Create your first event** → `/organizer/events/new`. A nonempty source list filtered to zero is a separate no-match state with an explicit filter clear. Preserve the newer My Events shell and create flow.

Risks: the adapter uses `data ?? []` after no reported error; verify an array contract instead of accepting a malformed/missing payload as success. Client owner scoping does not substitute for active server authorization. Background error currently replaces the list; background loading has no consistent refresh announcement. No previous-owner list may survive identity switching.

## 14. No Orders query/state boundary

This real route exists in operations trees, **not main**. [useEventOrders](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/operations.queries.ts>) calls `list_organizer_event_orders_filtered(eventId, search, status, cursor, limit=25)` with strict page validation, owner/event/search/status keys, `retry:false`, and revalidation when returning to a cached filter.

[OrganizerOrdersPage](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/OrganizerOrdersPage.tsx>) already distinguishes unfiltered zero from no matching orders. It retains prior rows for a same-owner/event search, labels updating/failed refresh, removes rows on a recognized access denial, and keys the container by owner/event. Pagination failure is separate. Add explicit Clear filter when status alone produces zero; Clear search currently appears only for text search.

Do not add Share/View just to match R10. If approved, require current canonical public eligibility and successful clipboard completion, independently of order emptiness. The dashboard already demonstrates a separate public eligibility query; orders have no need to invent one unless those optional actions are selected.

## 15. No Attendees query/state boundary

Spec 05's [FindGuestPage](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/src/features/organizer-operations/FindGuestPage.tsx>) uses `list_organizer_event_admissions` through `useEventAdmissions`. It is disabled for blank search; SQL also returns no list for blank search. Successful nonblank zero means **No guest found**, never “this event has no attendees.” Failure renders Search unavailable. Search and cursor are bounded; the layout blocks free events before paid operations mount.

Paid home metrics expose an authoritative historical `issued` count after a supported successful owner read. Do not derive “No attendees yet” from a failed/missing metric, remaining inventory, checked-in count, or filtered guest result. If the operations owner accepts the home count as the complete admission set, use precise “No admissions issued yet” context; do not add a second list/query just for the board.

Spec 06 now actually supplies `get_organizer_free_registration_metrics` and `get_organizer_free_admissions`. This is newer than the PDF's historical missing-source note. Spec 07 consumes the free admission read in its narrow registration lookup/detail. However, its inherited Spec 05 `CheckInLayout` still rejects free events, and its paid metrics hooks remain unchanged. Free source existence therefore does not establish completed free check-in UI integration. Keep that boundary explicit.

## 16. Generic Error integration points

Eligible: failed event/profile/policy/metrics/order/guest/registration reads, import/render failures, and read-only delivery notices, after the parent chooses a safe state. Show fixed allowlisted copy and only actual callbacks.

Not eligible for generic replacement: sold-out/full, blocked/under-review/ended/cancelled event, processing/unknown payment, invalid QR, admitted/already-used, unconfirmed admission, refund review/pending/unknown, uncertain cancellation, delivery queued/unknown/ineligible, expired private access, and provider-owned account state.

Existing form code sometimes forwards `Error.message`, including sign-in/profile/sign-out. Sanitize known provider failures at those feature adapters without turning validation into generic failure. No incident/reference number is shown unless a real safe useful reference already exists.

## 17. Loading/Skeleton integration points

Extend the existing primitive with four content shapes: event cards, metrics, rows and detail fields. Use them in the existing buyer/organizer/onboarding shells, with real heading hierarchy and a single readable loading announcement. Retain local button pending states, scanner camera/result UI, and domain processing status.

Do not draw fake financial values, fake ticket statuses or QR-like placeholders. Preserve layout, focus and reduced motion. Announce refresh without replacing safe same-owner content unnecessarily; remove private content on owner/resource change and recognized authorization loss.

Two concrete gaps need explicit tests: malformed `/events/:eventId/checkout` currently reaches a permanent Loading checkout branch with its query disabled; bootstrap chunk failures lack a failure transition. The former needs checkout-owner agreement for a finite invalid-route fallback. It is not permission to change checkout recovery.

## 18. Route-by-route state inventory

The following tables form one inventory. “Main” means the current dirty main checkout. “04/05/06/07” means an additional local owner implementation, not a merged route. Paths in this section are **application URLs**, not filesystem references.

### A. Loading, refetch, empty and failed-read boundaries

| ID / route or surface | Owning read; initial loading | Refetch / retained data | Successful empty versus failure |
|---|---|---|---|
| P1 `/events/:eventId` — Main | `usePublicTicketingEvent`; buyer event loading shell | 15-second visible polling/focus/reconnect; retryable failure retains labeled event details | Canonical absent projection → unavailable/not-found; no tiers/sold-out are domain states; invalid response is failure. |
| P2 `/events/:eventId/tickets` — Main | Same projection and shell, selection mode | Same as P1; cart reacts to unavailable tiers | No available tiers is ticket availability, not generic empty; no fabricated price/inventory. |
| P3 `/events/:eventId/checkout` — Main | Same public projection plus validated cart; Loading checkout | Read failure hides form while React state may retain inputs; route identity clears form; no dedicated read-retry button currently | Null and failed read currently share Checkout could not load; invalid cart redirects/uses cart-unavailable state; malformed ID can load forever. |
| P4 Checkout cancellation return `?cancel=…` — Main | Existing cancellation effect calls `cancelCheckout`; local cancelling shell | Attempts are cleared only after acknowledged cancellation; redirects to public event even when cancellation fails | This is a mutation/uncertainty path, not empty or a generic read retry. |
| P5 `/orders/:confirmationToken` — Main | `useOrderConfirmation`; fingerprint-gated loading | Processing polls every second for a 60-second window; `retry()` restarts same-bearer read window; error hides cached confirmation | `ORDER_NOT_FOUND` → private invalid/unavailable link; paid/failed/processing/expired/refunded/cancelled remain domain statuses. |
| P6 `/tickets/:collectionBearer` — Main | Request-keyed `TicketCollectionReader`; loading shell | Version retry replaces content; abort/request-key suppress stale completion; no periodic/reconnect refresh | Explicit `empty` exists; `unavailable`, `not_enabled`, ready and thrown failure have different containers, but production reader collapses most failures into unavailable. |
| P7 `/tickets/:collectionBearer/:ticketSelector` — Main | Same collection read then selected QR | Same as P6; blank intermediate commit ensures one mounted QR; invalid selector may return overview/first ticket under existing semantics | Do not introduce a guessed 404 for selector/access. QR/inactive status stays collection-owned. |
| P8 `/events/:eventId/rsvp` — 06/07 | `rsvpApi.event`; local loading/read-error states, persisted attempt recovery | `loadEvent` refresh; saved unresolved attempt takes precedence over availability failures | Full is real capacity outcome; null is RSVP unavailable; unresolved/conflict is not rejection. |
| P9 `/rsvp/:collectionBearer` — 06/07 | Private collection reader; Checking your private RSVP | Version refresh and bearer/version guard remove old result | Non-ready gives private unavailable with Check again; confirmed, cancelled and ended remain domain-specific. |
| P10 `/tickets/recover` — 07 | Form, not an initial resource query; sending pending | Same persisted email/request identity on retry; neutral acknowledgment | Never expose “no matching purchases”; failure/uncertain request stays within recovery form. |
| P11 `/ticket-access?page/member/ticket` — 07 | Scoped access index/member reads; loading; local expiration timer | Page/version scoping and abort; member uses existing ticket collection; refresh action for index | Invalid/expired/no member and failed index currently converge on Ticket link unavailable; transport failure must not be represented as proven expiry. |
| P12 Paid/free confirmation delivery notice — 07 | `publicTicketDeliveryApi.status`; independent Checking ticket email | Bearer/version guard and Check email status | Email unavailable/queued/unknown/accepted/observed delivery never changes tickets or payment. |
| O1 `/organizer/events` — Main/04 | Owner list; AsyncState | Error replaces list; 04 retains owner-scoped filter/scroll preference; add refresh notice | Successful source zero → No events; successful filtered zero → no matching event status. |
| O2 `/organizer/events/:eventId/dashboard` — 04 | Owned event + paid metrics; public eligibility separately | Owned event revalidates on entry; metrics error currently replaces dashboard even with cached data; eligibility failure stays inline | Zero metrics valid only after supported read; no tiers is separate; main production route is Not enabled, not this dashboard. |
| O3 `/organizer/events/new` — Main/Create | Session/profile/policies; new draft does not need event-detail read | Draft/navigation blockers and feature state must survive; component-level reads retry separately | New form is not No events; missing policies/requirements cannot be accepted as empty approval. |
| O4 `/organizer/events/:eventId/edit` — Main/Create | Owned event + requirements/policies; loading guards | Scoped event identity and draft hydration; failed read currently full-state; preserve local unsaved changes | Null → safely absent; cancelled → editing unavailable; requirements failure distinct from missing. |
| O5 `/organizer/events/:eventId/tickets` — Main/Create | Owned event + tier read + Connect readiness | Draft identity/dirty guards and navigation blocker; separate tier/event/status retry | Zero editable tiers can mean initial setup; free event → unsupported setup; unavailable tiers not “No orders.” |
| O6 `/organizer/events/:eventId/preview` — Main/Create | Event/profile/tiers then publish requirements | Separate event/tier/profile errors; no generic publish replay | Missing event safely absent; cancelled/edit restrictions and publish outcomes retain owner copy. |
| O7 `/organizer/events/:eventId` — Main/Create | Owned event/profile; public projection and review request separate | Background public/review status inline; event/profile failures replace content | Draft redirects to edit; no review request is valid absence; failed eligibility never means deleted event. |
| O8 `/organizer/events/:eventId/orders` — 04 | Filtered infinite orders + separately verified event header | Retained previous rows labeled; access denial clears; next-page error separate | Unfiltered zero vs filtered zero already distinct; status-only reset action missing. |
| O9 `/organizer/events/:eventId/orders/:orderId` — 04/05/07 | Strict V2 order read + event header; entry revalidation | Canonical 5-second read polling until terminal; generic refresh error may retain order; denial removes it | No issued tickets is a valid order substate, not empty order; request failure not 404. |
| O10 `/organizer/events/:eventId/check-in` — 05 | Owned paid event layout, then metrics | Count failure separate at home; no verified count means count unavailable | Zero checked-in is not zero attendees; free events explicitly unsupported by this UI. |
| O11 `…/check-in/scan` — 05 | Verified context/metrics, lazy scanner/camera | Metrics failure preserves mounted scanner/pending/result/uncertainty; denial removes private context | No read-empty state; malformed credential, camera denial, wrong event and admission outcomes have domain states. |
| O12 `…/check-in/find` — 05 | Blank input is idle; nonblank search starts bounded admission read | Search retained in owner/event layout; failed query removes rows; no automatic blank listing | Successful search zero → No guest found; error → Search unavailable. |
| O13 `…/check-in/find/:orderId/:ticketId` — 05 | Validated selection + V2 order read | Retain same-resource details on generic refresh failure with admission disabled | Missing selected ticket → invalid selection; unavailable order/access stays private; no guest count inference. |
| O14 `/organizer/events/:eventId/registrations` — 07 | Blank input idle; `get_organizer_free_admissions` on search | Owner/event/search key; strict revalidation; rows removed on failure; `gcTime:0` | Successful search zero → No matching registrations, not no attendees. |
| O15 `…/registrations/:registrationId` — 07 | `get_organizer_free_registration_detail`; entry loading | Owner/event/registration key, abort, zero GC; failure removes data | Unavailable/denied/failed currently share safe OperationsError; empty ticket array must not invent financial/order state. |
| O16 Refund dialog in O9 — 04 | Mutation plus separate canonical legacy order read | Canonical status polling after success/error; parent V2 polling continues after close | Pending/unknown/recoverable/refunded not generic success/failure. Existing retry button is not a complete Spec 09 contract. |
| O17 Manual admission dialog in O9/O13 — 05 | Selected ticket; submitting state | Uncertain marker survives dismiss/reopen; recheck reads same ticket before retry | Admitted/used/refunded/cancelled/invalid unchanged; no empty/network mapping for malformed QR. |
| O18 Resend dialog in O9/O15 — 07 | Owner/source delivery eligibility and request status | Canonical status polling; failed read suppresses recipient; scoped request identity persists | Missing attempt status can permit same-request action only under Spec 07 rules; not-enabled/ineligible/unknown not generic empty. |
| O19 `/organizer/setup` — Main | `useOrganizer`; onboarding shell loading | Keyed by user; read retry separate from save/complete | Missing profile opens setup; failure never becomes absent profile. |
| O20 `/organizer/settings/payments` — Main/Create | `useConnectStatus`; dedicated onboarding/payment status panels | `refreshOverview`/`refreshStatus`; embedded chunk recovery distinct from new AccountSession/Express action | Not started, interrupted, requirements, pending and ready retain provider semantics; no account ≠ financial zero. |
| A1 `/auth/sign-in`, `/auth/sign-up`, `/auth/check-email` — Main | Forms/local provider requests; check-email continuation pending | No generic resource refetch; field validation and request pending remain local | No empty list; session/profile/provider outcomes and neutral email guidance remain Auth-owned. |
| A2 Session/organizer/staff guards | Session lookup, owner profile, staff role | Existing cache eviction/Auth subscription; profile JWT-future retry bounded to 20 | Anonymous vs missing profile vs missing role vs read error; session lookup rejection currently becomes anonymous. |
| M1 `/moderation` | Staff-scoped queue read; AsyncState | Read failure currently replaces queue | Successful zero → empty queue; denied staff role is not empty queue. |
| M2 `/moderation/events/:eventId` | Staff/event-scoped case read | Error replaces case; mutation conflict explicitly demands current case reload | Safe absent case vs failed read; review/history action unknown stays moderation-owned. |
| S1 `/organizer-terms`, `/event-policy` | Existing static content; route import is loading boundary | No resource refetch/empty list | Only startup/import/render failure shared treatment. |
| S2 `/`, unmatched URLs, disabled previews | Root redirect; no custom router fallback | No data retention needed; safe navigation only | Root is sign-in redirect; unknown route genuine router not-found; development screens stay gated. |
| X1 `/map` — separate map worktree only | Renderer loading; fixture events in development | No accepted area/filter query or layer retry integration | All three map presentation states deferred; production `[]` is not authoritative empty. |

### B. Not found, forbidden, session expiry and identity/resource changes

Each row below assigns these dimensions to every inventory ID. “Private unavailable” intentionally does not reveal existence.

| IDs | Not found / denied / expired-session behavior | Identity/resource switching and retained-data boundary |
|---|---|---|
| P1–P2 | Public projection absent is safe unavailable; no organizer session required; failure distinct from absence | Public normalized event key; no private owner data. Refetch may retain labeled details but does not authorize current inventory. |
| P3–P4 | Invalid event/cart/checkout are checkout states; no organizer Auth requirement | Current route/search identity resets buyer inputs and ignores late submit completion. Preserve durable payment attempt outside shared rendering. |
| P5 | Explicit private ORDER_NOT_FOUND; service failure separate; no organizer login | Token-keyed component and fingerprint cache; no previous token content on navigation. No raw token in shared error output. |
| P6–P7 | Unavailable intentionally masks bad bearer/access; not-enabled capability distinct; no organizer login | Reader/bearer/version guard + abort; remove prior QR before next. Reconnect must use the existing private read, not a new source. |
| P8 | Public absence/full/unresolved distinct; no organizer login | Attempt scoped to event; local event/state callbacks lack the collection-style request generation guard. Require explicit A→B delayed-response regression and owner fix before widening reuse. |
| P9 | Private unavailable; no organizer login | Bearer/version guard and abort; no prior registration retained. |
| P10 | Enumeration-resistant response regardless of matching email; not-found/denied not exposed | Request identity tied to saved email; explicit different-email action starts a different intent under Spec 07. Shared component must not reset it. |
| P11 | Local invalid/expired grant may show private unavailable; HTTP/network failures currently lose classification | Page/version/abort and local grant expiry; verify grant change/expiry removes all old member data and QR. Do not restore arbitrary URLs or expose grant token. |
| P12 | Failure only means email status unavailable; cannot invalidate payment or ticket | Bearer/version guard; mounted notice may fail without removing confirmation/tickets. |
| O1, O3–O7, O19 | RequireSession → sign-in; owned event/profile read null safely hides absent/foreign resources; errors are separate but not typed finely | Owner keys, private eviction, existing draft identities. Verify late mutation cache writes and A→B→A; do not retain private state merely because pathname component stays mounted. |
| O2, O8–O13, O16–O17 | Session guard; paid owner guard uses overloaded 42501; cannot certify real-resource forbidden versus missing/unsupported | Operations keys owner/event; details/dialogs/scanner keyed to selected IDs. Recognized denial hides data; O9 refund controls currently need fresh-eligibility scrutiny after a failed refetch. |
| O14–O15, O18 | Session guard; owner/source-scoped free/delivery reads; 42501 suppresses private data but UI categories remain coarse | Owner/event/source keys and keyed containers, abortable reads, zero GC on delivery/registration data. No PII from cached previous owner or status. |
| O20 | Session guard; provider/session failures stay payment-setup-owned | User-keyed journey, mounted/in-flight guards; account-session completion can write initiating user's cache, requiring late-completion regression. |
| A1–A2 | Current sign-in returns to My Events; no implemented arbitrary return URL; role absence is not unauthenticated | Auth event eviction before identity update; initial session rejection currently indistinguishable from anonymous. Do not weaken provider authority. |
| M1–M2 | RequireStaff; null role → access required; case null safely absent; session guard unchanged | Staff/event query identity and eviction; retained mutation/form state needs explicit staff/resource switch coverage. |
| S1–S2 | Real unmatched route is 404; static content has no foreign resource/session state | No private retained data; safe known links only. |
| X1 | No accepted data/auth/permission boundary | Manual-area, renderer/data isolation and permission regressions deferred to accepted map owner. |

### C. Offline hints, reconnection, safe callbacks and unsafe retries

Offline UI is currently absent across these routes. The proposed hint is additive for every row; reconnect below always means canonical **read**, never global mutation resumption.

| IDs | Safe callback / reconnect target after approval | Actions excluded from shared retry |
|---|---|---|
| P1–P2 | `eventQuery.refetch()` for same event; existing public reconnect policy | No checkout/RSVP creation or implicit area/filter change. |
| P3 | `eventQuery.refetch()` for failed availability only; keep pending attempt UI separate | Never call `submit`, `getOrCreateCheckoutAttempt`, `createCheckout`, or clear attempt from shared Retry. |
| P4 | Checkout-owner status/cancellation recovery only; no generic callback assumed | Do not replay `cancelCheckout` or clear a bearer because connectivity returns. |
| P5 | `confirmation.retry()` on same bearer; existing polling/cleanup semantics preserved | No purchase creation, replacement bearer or inferred payment success. |
| P6–P7 | Existing request-version read retry; owner-approved reconnect read | No credential issuance, cached offline admission or blanket remount of QR owner. |
| P8 | `loadEvent()` for availability; `resolve(saved, …)` only through owner action | No new request ID, `prepareAttempt`, or `confirm` via generic retry. Same-request replay after canonical absence remains RSVP-owned. |
| P9 | Increment confirmation read version | No repeat registration or replacement tickets. |
| P10 | Recovery form's existing submit with saved request identity, explicitly invoked | No automatic resend/recovery request on online event. |
| P11 | Index version/member read retry after classification agreement | No fresh access grant, automatic recovery email, or assertion that failed read means expired grant. |
| P12 | Existing status version callback | No send; delivery status does not complete any transaction. |
| O1 | `eventsQuery.refetch()` | No creation/publish shortcut from retry. |
| O2 | Retry failed metrics/event/public-eligibility query separately; currently grouped metrics+event callback can be narrowed | No admission/publish changes from refreshed UI. |
| O3–O7 | Refetch only failed event/profile/policy/requirements/tier/public/review read; Back goes through existing draft blocker | No draft insert, revision save, policy acceptance, publish, cancellation, review-request or withdrawal replay. |
| O8 | `query.refetch()`; pagination `fetchNextPage()` only for failed next page | No reset of unrelated search/status; no share claim without actual clipboard success. |
| O9 | V2 `query.refetch()` and existing read polling | No refund/admission/resend; stale eligibility cannot enable destructive actions. |
| O10 | Owned event refetch; metrics `refetch()`/Refresh count | No admission based on offline/stale totals. |
| O11 | Metrics refetch separate from scanner; scanner retry only existing retained-credential controller | No generic remount that erases pending/admitted/already-used/uncertain result. |
| O12 | Same-search `refetch()`; explicit clear focuses search | No guest admission or new global attendee list. |
| O13, O17 | V2 read; `useManualAdmission.recheck()` for uncertain selected ticket | `submit()` only when owning hook permits confirm/retry; no offline write/replay. |
| O14–O15 | Same owner/event/search/registration query refetch | No new registration or resend on read recovery. |
| O16 | Existing canonical status read; Spec 09 must define stronger unknown recovery | Do not expose mutation replay as Generic Try again. |
| O18 | Summary/status `refetch()`; same-request retry only owner-approved null-status path | No new resend identity or `send(true)` from generic/offline action. |
| O19 | `organizerQuery.refetch()` | No profile insert/update/onboarding completion replay. |
| O20 | `refreshStatus`/`refreshOverview`; embedded chunk loader only in its own boundary | No AccountSession/Express URL creation or provider configuration from generic reconnect. |
| A1–A2 | Existing Auth controls/guards; a new session-read retry requires Auth-owner contract | No sign-up/email/password/profile change replay or invented sign-in success. |
| M1–M2 | Queue/case/role read refetch; conflict reload retains existing moderation logic | No moderation/history action replay. |
| S1–S2 | Safe navigation; read-only route import retry only if explicitly supported | No blanket app reset or external return target. |
| X1 | Only future owner-supplied failed-layer callback | No map build, broad filter reset, repeated permission prompt or fake map. |

General account/settings, password-change/reset, a consumer home, a global attendee directory and standalone Spec 08 recovery routes were not found in the inspected routers. They are missing products/contracts, not new routes for Spec 12. Existing event location search and policy/report forms remain feature-local read/validation states within O3–O7/P1; geocoder failure is not map-renderer failure.

## 19. Empty versus failed versus not-found versus denied

| Meaning | Actual evidence required | Current contract limitation / adaptation |
|---|---|---|
| Empty | Supported, authorized, valid response with zero items in the explicit context | Validate successful lists; never default missing metrics to zero. Filtered searches need no-match copy. |
| Safely absent | Canonical null/absence or invalid/unmatched route under an explicit contract | Public/owned event and confirmation already have absence paths. RLS-hidden owned event can stay neutral without disclosing foreign existence. |
| Forbidden | Authenticated user and an explicit trustworthy authorization category | `42501` alone cannot prove the strict real-resource condition. Preserve neutral private unavailable until owner resolves classification. |
| Unauthenticated | Authoritative Auth/session condition | No shared inference from arbitrary read error; current getSession rejection collapses to anonymous and needs owner review. |
| Failed read | Transport/service/schema read could not complete | Public ticketing largely preserves this; collection/access readers lose distinctions and need owner-approved adapter changes. |
| Unsupported | Capability or source not supplied | Free check-in UI and disabled ticket runtime must not look empty; never display zero free attendees from paid metrics. |
| Unknown write | Request may have committed but canonical outcome is unresolved | Never map to failed/empty; preserve payment/admission/refund/cancellation/send identity and owner action. |
| Offline hint | Browser-reported connectivity condition | Orthogonal to all rows above; neither online nor offline flag establishes server truth. |

Private unavailable is an intentional presentation choice, not an internal assertion that missing, forbidden and failed are identical. Preserve those categories where the current owner can establish them; document unavailable distinctions rather than inventing evidence.

## 20. Unsafe mutation retries that remain domain-owned

- **Payment / Spec 08:** `getOrCreateCheckoutAttempt`, `createCheckout`, cancellation and terminal-attempt cleanup. Current code reuses identity for equivalent submission, but Spec 08's fuller recovery interface is not implemented. Preserve confirmation `reloadDocument` View tickets navigation, processing polling and cleanup exactly.
- **Admission / Spec 05:** scanner's retained credential and manual hook's uncertain marker/recheck. Background errors must never replace ADMITTED/ALREADY_USED. Transport abort does not prove a server write did not happen.
- **Free RSVP / Spec 06:** persisted request/payload/bearer, Web Lock and same-request status/read-replay path. Capacity rejection is durable business outcome. No duplicate registration on timeout.
- **Refund / Spec 09:** existing full-order writer and evidence recovery. Current dialog allows another mutation after an error and says “retry safely”; this does not establish reconcile-first safety for every unknown outcome. The local Spec 09 activation report identifies missing durable pre-provider recovery/status contracts. Shared presentation must not certify or extend that retry.
- **Cancellation / Spec 10:** current `PublishedEventPage` says “Could not confirm cancellation. It is safe to try again” and permits replay. Preserve the distinction that this is incomplete domain recovery; propose Check current event status only through the owner, not a new cancellation engine.
- **Delivery / Spec 07:** initial-send outbox, resend/recovery IDs and accepted/failed/unknown distinctions. A status read cannot enqueue a new email. Request acceptance never proves delivery.
- **Auth/account / Spec 11 and onboarding owner:** provider/session authority, password/email/profile changes, new Connect sessions and account setup remain explicit domain actions.
- **Payments copy / Spec 11:** reuse the provider's actual projected status, not unsupported inherited wording such as “Payouts configured.” A ready aggregate does not supply an independent bank/payout-method fact. Coordinate narrower copy with the account/payments owner; no provider-field extension is proposed.
- **Creation/moderation owners:** save/create/publish/policy acceptance/review/report actions must not be wrapped in automatic retry. Existing idempotency or conflict semantics remain authoritative.

## 21. Identity/cache isolation risks

Reusable protection: owner/event/staff query keys; SessionProvider eviction before identity change; newer operations-family eviction including its mutations; keyed orders/detail/scanner/dialog/registration containers; abort and request-key guards for collection/access; fingerprinted confirmation query keys. Public event keys intentionally omit owner identity. Do not evict public details just to clear organizer state.

Main's eviction list lacks operations because those routes are absent there. Integrating operations UI without its newer eviction behavior would be a regression. Delivery keys live under `organizer-operations`, so preserve that family and source-kind/source-id dimensions.

Remaining proof obligations:

1. A request in flight → sign out → B → delayed A response, including A→B→A and a resource change within the same owner. Check PII, artwork, metrics, search rows, dialog state and action eligibility in every rendered frame.
2. Old mutation callbacks can repopulate the initiating owner's cache after eviction in existing event/profile/Connect hooks. Owner keys prevent direct B-key contamination, but do not by themselves prove fresh authorization on A's later return. Test active-identity/generation guards and revalidation with the domain owners.
3. Some event/metric readers do not consume an AbortSignal; correct keys and unmount behavior must still prevent late rendering. Adding cancellation is a narrow owner adapter change, not a query-framework rewrite.
4. O9 retains order state on generic refresh failure and disables admission through `canAdmit`, but refund entry/canRequest is derived from retained `refundState` without the same error gate. Preserve/refine this only with Spec 09; stale authorization/eligibility must not expose an actionable destructive retry.
5. RSVP page effects use local state and no full request-generation guard for event navigation. Test old availability/attempt resolution arriving after a new event route; do not assume query-key protections exist there.
6. A present Auth session plus overloaded denied read does not prove an expired-session flow. Remove private content on known denial while the Auth owner supplies classification/revalidation.
7. No new private caching is authorized. Existing RSVP/recovery persistence is an owning-domain recovery mechanism; Spec 12 must neither duplicate it nor wipe it on connectivity loss.

## 22. Reusable components/services and work classification

| Classification | Pieces |
|---|---|
| Already exists and reusable | AsyncState, Button, Field, form summaries, route layouts, domain dialogs, public/event/operations query hooks, collection request guards, canonical confirmation retry, manual recheck, public eligibility read. |
| Existing but inconsistent | OperationsError, duplicate buyer status wrappers, paragraph titles, zero/no-match copy/actions, raw form error forwarding, no universal refresh labeling, absence/unsupported rendered as empty. |
| Presentation-only addition | Semantic AsyncState variants, R10 icons/treatment, four skeleton shapes, passive connectivity hint, safe route not-found/render-error presentation, accessible refresh labels. |
| Route-specific adaptation | Query-to-view mapping, safe callback wiring, heading placement, preserving selected QR and scanner result, draft blockers, delivery notice independence, pagination errors. |
| Missing behavioral contract owned elsewhere | Safe session/read classification, coarse private collection/access errors, pre-provider refund uncertainty, cancellation reconciliation, free check-in UI integration, final Spec 08 interface. |
| Map-dependent / deferred | R10-1/2/3 runtime attachment and owner callbacks. |

Recommendation: evolve **one existing shared presentation primitive**, not a new global async state framework. Use thin route/domain wrappers only where preserving layout and behavior needs them.

## 23. Proposed shared-state component API

Proposed extension to existing `AsyncState`; this is a reviewable interface sketch, not implemented code:

```tsx
type StateActionSlots = {
  action?: ReactNode; // existing primary slot; parent supplies real Button/Link
  secondaryAction?: ReactNode;
};

type AsyncStateProps = StateActionSlots & {
  title: string;
  description?: string; // safe, preselected feature copy
  icon?: ReactNode; // decorative; never the only status information
  headingAs?: 'h1' | 'h2' | 'h3';
} & (
  | {
      status: 'loading';
      skeleton?: 'event-cards' | 'metrics' | 'order-rows' | 'details';
    }
  | {
      status: 'empty' | 'error' | 'not-found' | 'denied'
        | 'unavailable' | 'offline';
      skeleton?: never;
    }
);
```

Existing callers remain compatible. Use real route h1 when already present and h2 for panel title; remove duplicate visible headings. Domain states such as processing/unknown can keep their existing views and reuse styling without being coerced into this union. `offline` is a displayed hint; it does not replace the domain result.

The component has no query client, route inference, Auth inference, effectful retries, status resolver, operation identity, persistence or mutation logic. It invokes no callback on mount/online. Parent code owns explicit actions. Loading announcements and decorative skeletons are implemented inside this component; route errors/connectivity subscription remain small integration utilities, not alternative state components or a global provider.

## 24. Screens requiring route-specific adaptation

- Buyer event/selection, checkout and confirmation: preserve BuyerHeader and composition, remove duplicated headings, attach only read failures; preserve paid attempt/polling/document navigation.
- Collection/focused QR/private access: preserve document privacy, one-QR transition and neutral private access; classification changes need ticket/access-owner agreement first.
- My Events/orders: differentiate unfiltered empty from no matches and clear exactly the selected search/filter.
- Dashboard: independently represent metrics, event context and public eligibility; missing amount remains unavailable, never zero.
- Check-in home/scanner/find/detail: keep count notices separate from active admission controller/results; never replace malformed QR with network copy.
- Editor/tier/preview/published pages: keep draft/navigation blockers and publish/cancel/moderation substates. Do not unmount the draft or add generic write replay.
- Onboarding/payments/Auth: keep provider-state panels, protected identity and embedded loader boundary. General settings are not implemented.
- Delivery/registration surfaces: preserve recipient authorization, request identity and purpose-specific access; no empty-CRM conversion.
- Moderation and legal routes: use existing shells; role denial differs from empty queue; legal content does not need a fabricated skeleton table.
- App startup/unmatched route: small sanitized fallback, safe real destinations, no private URL echo.

## 25. Map-dependent/deferred states

R10-1 No Events on Map, R10-2 Location Permission Denied and R10-3 Map Failed are each **DEFERRED PRESENTATION — MAP OWNER**. They remain part of the acceptance register. A future approved synthetic gallery can verify their visual treatment without enabling routes, geolocation, discovery or fake runtime data. Runtime acceptance requires the map owner's real state/callback contract and selected integration baseline.

## 26. Missing behavioral contracts owned by other specs

| Owner | Missing or unsettled contract | Smallest safe Spec 12 position |
|---|---|---|
| Integration / Specs 01–07 | One accepted file snapshot combining dirty Create/Buyer/Onboarding/04/05/06/07 work | Approve a manifest or integration revision before shared-file edits. Do not merge or copy by branch name. |
| Auth / Spec 11 | Failed session read versus anonymous; expired resource request; optional safe return-to-resource | Keep existing sign-in/My Events flow; require owner classification before changing session authority. |
| Operations / Spec 04 | 42501 conflates absent, foreign, anonymous and unsupported source | Use safe unavailable wording and suppression; owner must expose or approve a non-leaking distinction for strict denied state. No foreign lookup. |
| Ticket/access / Spec 07 | Reader collapses service/network/malformed responses and denied link into unavailable; access index errors look like expired link | Parent may show neutral unavailable now; classified retry versus invalid link needs owner adapter agreement, potentially client-only if transport already supplies sufficient evidence. |
| Free / Specs 06+05 | Owner free reads exist, but newer check-in UI remains paid-only | Do not report unsupported free operation as zero. Attach only accepted registration lookup/read presentation; defer full free check-in integration. |
| Payment / Spec 08 | Dedicated recovery redesign remains plan-only; invalid checkout-route end state needs clarification | Preserve current durable attempt and canonical read; no new recovery route or payment attempt behavior. |
| Refund / Spec 09 | Complete durable unknown-result recovery, eligibility status and related support/delivery decisions | Read/status styling only; no generic refund retry certification. Refer to existing Spec 09 activation findings. |
| Cancellation / Spec 10 | Reconcile-first unknown cancellation and outcome/message contract | Do not advertise blind retry as a shared safe action; request owner mapping of existing canonical read. |
| Map owner | Authoritative area/filter query, permission/manual-area path, failed-layer retry | Defer three map attachments; no discovery build. |
| Support configuration | Actual monitored organizer/support destination is not established by this audit | Omit Contact support until a real configured destination is verified. Do not use organizer login email as a substitute. |

## 27. Exact incremental implementation sequence for approval

These are sequential approval-plan increments, not authorization to execute them. Each starts with targeted failing regression coverage, preserves prior owner behavior and ends with focused checks plus actual diff review.

1. **Accept and freeze the baseline.** Select the committed operations foundation plus reviewed incremental Create/Buyer/Onboarding/04/05 changes. Accept 06/07 only with their final owner handoffs and explicit overlap reconciliation. Record file hashes/migration set; recheck current on-disk changes. Create an isolated `codex/spec12-shared-states` worktree only after approval. Do not reset main or blanket-copy Spec 07.
2. **Lock domain-to-presentation contracts.** Resolve the table in section 26. Write table-driven tests for zero versus missing/failed/denied/unsupported, private safe absence, and paused initial reads. Do not implement new schema/security/recovery in this step. If a contract stays unresolved, retain its existing safe domain view and mark that route blocked, not complete.
3. **Extend AsyncState and its visual tests.** Preserve existing props/actions; add semantic variants, correct headings, R10 icon/action hierarchy and four skeleton shapes. Test no automatic actions, accessible announcements, reduced motion and long copy. Reuse styles/tokens; no new dependency or generic global framework.
4. **Add route and startup fallbacks.** Add custom sanitized render/import boundary and not-found components, below parent shells where possible; add a minimal initial-import rejection branch. Verify unknown route, lazy-load exception, shell exception, disabled preview and real destinations. No generic refresh/remount on transaction pages. Preserve document privacy and never display private path tokens.
5. **Adapt public and organizer read-only states.** Update public event/selection, My Events, dashboard, orders, guest/registration search and detail loading/errors. Distinguish absent/unsupported/no-match. Wire current-query and failed-page retries explicitly. Add fresh-data gating for destructive controls only in agreement with their owners; do not modify writers.
6. **Adapt form, protected and transactional shells.** Keep draft blockers, field errors, Connect chunk behavior, session guard, canonical payment/RSVP/refund/cancellation/admission/send models. Attach shared presentation only to independently failed reads and agreed invalid-route states. Verify a background failure never erases active or uncertain operations.
7. **Add passive connectivity presentation and read reconciliation.** A small hook exposes browser hints; mounted feature adapters select safe refresh. Reuse existing public-query reconnect behavior and prevent duplicate read triggers. Explicitly exclude all write callbacks and generic provider resets. For effect readers, add owner-approved cancellation/generation checks before reconnect behavior.
8. **Create synthetic state coverage and run acceptance.** Extend development previews for all 11 visual treatments, labeling three map states deferred. Run route cases in section 30, accessibility and screenshot inspection at 320/390/768/1440. Protect against credential/PII capture; no generated live QR in shared-state previews.
9. **Review and deliver implementation evidence.** Run accepted-checkout scripts, inspect diff and production exclusion, document remaining domain/deferred states and evidence boundaries. No commit, merge, push, provider action or deployment is implied by this activation report.

A reduced approval could authorize steps 3–4 and explicitly selected read-only routes on a frozen baseline while leaving domain adapters and map states deferred. It must be called a partial Spec 12 increment, not completion of all coverage.

## 28. Expected files/modules to change

File paths below are relative to the **future accepted checkout**, whose location is not yet created. Links identify inspected existing sources. Proposed files do not currently exist and are clearly marked.

| Change set | Exact modules |
|---|---|
| Shared presentation | Existing `src/components/ui/AsyncState.tsx`, `src/components/ui/ui.test.tsx`, `src/styles/global.css`; proposed `src/components/ui/AsyncState.test.tsx` for expanded state assertions. Reuse Button/Field/FormErrorSummary rather than replace them. |
| Router/startup | Existing `src/app/router/router.tsx`, `src/app/App.tsx`, `src/main.tsx`, matching development entry only if parity requires it; proposed `src/app/router/RouteErrorBoundary.tsx`, `RouteNotFoundPage.tsx` and tests. Eager fallback composition uses AsyncState, not a second visual system. |
| Connectivity | Proposed `src/components/ui/useConnectivityHint.ts` and test; compose in existing buyer/operations/onboarding wrappers without modifying AppProviders or query defaults globally. |
| Buyer reads | Existing `src/features/tickets/PublicTicketEventPage.tsx`, `src/features/checkout/CheckoutPage.tsx`, `src/features/orders/OrderConfirmationPage.tsx`, `src/features/ticket-experience/customer/TicketCollectionPage.tsx`; owner-approved adapter classification only in `adapters/ticketCollectionReader.ts` and contracts/tests. |
| Organizer reads | Existing `src/features/events/OrganizerEventsPage.tsx`; accepted `src/features/organizer-operations/OperationsUi.tsx`, `OrganizerDashboardPage.tsx`, `OrganizerOrdersPage.tsx`, `OrganizerOrderDetailPage.tsx`, `CheckInLayout.tsx`, `CheckInHomePage.tsx`, `FindGuestPage.tsx`, `GuestTicketDetailPage.tsx`, `OperationalScanner.tsx` and styles/tests. |
| Creation/protected forms | Accepted versions of `EventEditorPage.tsx`, `EventPreviewPage.tsx`, `PublishedEventPage.tsx`, `OrganizerTicketTiersPage.tsx`, `OrganizerSetupPage.tsx`, `OrganizerPaymentsPage.tsx`, `ConnectEmbeddedPanel.tsx`; existing `RequireSession.tsx`, `RequireOrganizer.tsx`, `RequireStaff.tsx` only for presentation or explicitly approved classifications. |
| Conditional 06/07 attachments | `src/features/rsvp/RsvpPage.tsx`, `RsvpConfirmationPage.tsx`; `src/features/ticket-delivery/TicketRecoveryPage.tsx`, `TicketEmailAccessPage.tsx`, `TicketDeliveryNotice.tsx`, `ResendTicketsDialog.tsx`; `src/features/organizer-operations/OrganizerRegistrationLookup.tsx`, `OrganizerRegistrationDetailPage.tsx`. Preserve owning hooks; no competing resend/admission code. |
| Classified read seams, only with owners | Existing `event.api.ts`, `operations.api.ts`, `operations.errors.ts`, private collection/delivery transport and scoped query hooks. No blanket API rewrite or new server auth semantics. |
| Other implemented shells | Existing `src/features/moderation/ModerationQueuePage.tsx`, `ModerationCasePage.tsx`, policy/legal fallback presentation, and Auth form safe-copy mapping where needed. |
| Evidence | Existing `src/preview/catalog.ts`, `screens.json` and preview styles; proposed `src/preview/SharedStatesPreview.tsx`, `tests/e2e/spec12-states.spec.ts`, `playwright.spec12.config.ts`, and final verification report. Keep synthetic fixtures development-only. |

No map files, provider configuration, new SQL, server financial/admission writers, delivery worker, Auth settings or generated database types are expected Spec 12 changes. Owner fixes that require those files need a separate domain plan/approval.

## 29. Schema/migration necessity

**No schema or migration change appears necessary for shared presentation.** Existing successful owner/public reads and the current state primitives support the core work. Classifications may require narrow frontend adapter changes; if a server cannot safely expose a distinction, retain neutral unavailable or defer the state. Do not add schema merely to make an Access denied card reachable.

The eventual accepted dependency migrations must be applied through their owners' approved process to a disposable test database before integrated verification. The linked `db:types` script is not an appropriate activation action and was not run.

## 30. Verification matrix

Apply the following to **each ID in section 18**, with explicit “not applicable” only for states a route cannot legitimately produce (for example, empty list on a static policy page). Tests must instantiate real feature adapters or controlled transport boundaries, not test a mirror of presentation conditionals.

| Case | Required assertion |
|---|---|
| Initial loading, slow read, paused/offline read | Stable appropriate skeleton/announcement; no fake values/QR; no blocked focus; finite failure or honest connectivity state. |
| Successful data | Parent shell and real domain values unchanged; actions authorized by current state. |
| Successful empty | Only supported authorized success zero; source zero and search/filter zero distinct. |
| Retrying read | Same owner/resource/filter/cursor; primary action invokes exactly intended read; no mutation/identity creation. |
| Failed read, no retained data | Safe error or unavailable, never empty/not-found by default. |
| Failed read with retained data | Only safe same-owner/resource context remains, labeled stale/refresh failure; no destructive permission inferred. |
| Not found / invalid route | Authoritative absence or invalid/unmatched URL; no service error disguised as deleted resource; malformed checkout exits loading. |
| Expired session | Private content removed; existing sign-in flow; revalidate ownership before restoring a resource. |
| Foreign/unauthorized resource | No owner name, PII, artwork, counts or finances; no existence enumeration; zero unauthorized writes. |
| Identity/resource switch during request | A→B, A→B→A and same-owner event/order/registration switch; no old data, QR, result or action flashes; late responses ignored. |
| Offline hint / reconnect | Connectivity hint is orthogonal; canonical read on reconnect; no automatic financial/admission/cancellation/send/Auth write. |
| Unknown write outcome | Original operation identity preserved through hint/error/remount; domain reconciliation only. |
| Keyboard and focus | Logical heading order, labeled buttons, keyboard reachability, focus restored after dialog/retry, no loading overlay trap. |
| Visual/accessibility | All R10 treatments and contextual variants at 320/390/768/1440; inspect screenshots, wrapping/long copy, contrast, reduced motion and screen-reader announcements. |

Additional route-specific assertions:

- **P1/P2:** failed or schema-invalid public query never becomes no events; cached details cannot certify inventory/price; successful withdrawal of eligibility removes public action.
- **O1/O8/O12/O14:** failed query never becomes zero; idle search is not empty search; Clear search/filter resets only its explicit context; next-page failure never empties successful first page.
- **O2/O10:** missing/null/error metric never renders 0 or $0; preserve historical sold/issued/used totals across refund; unsupported free source never uses paid zero values.
- **P3–P5/P8:** record request/bearer identity before timeout, offline hint and retry; assert unchanged identity and no second order/payment/RSVP. Preserve processing window, terminal cleanup and View tickets document navigation. Full RSVP rejection remains real outcome.
- **O11/O17:** malformed QR produces invalid without network request; lose admission acknowledgment while count refresh also fails; preserve same credential/recheck, original used time and canonical result; offline UI never admits. Explicit denial still removes private data.
- **O16/O7:** unknown refund/cancellation offers only owner-approved reconciliation. Assert no duplicate refund/cancellation. Test stale eligibility after failed detail refresh.
- **O18/P10/P12:** unknown send retains request ID; read retry never sends; accepted is not delivered; email error leaves paid/valid/refunded/admitted truth unchanged. Private link error does not force account creation.
- **P6/P7/P9/P11:** one mounted QR at most; invalid/expired/revoked grant fail closed; network loss is not proof of expiry; bearer/member switch immediately removes previous private contents.
- **X1 deferred runtime gate:** location denial leaves manual area usable and unchanged; renderer failure preserves independently verified event/address context; event-query failure preserves rendered map. Fixture-only previews cannot satisfy these runtime cases.

Eventual command sequence in the accepted checkout: focused `pnpm exec vitest run` for the changed primitive/router/feature tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `git diff --check`. Run `pnpm test:functions` and `pnpm typecheck:functions` for integrated contract regressions when affected. Run new `pnpm exec playwright test --config playwright.spec12.config.ts` against synthetic/loopback fixtures. Reuse existing owner SQL/RLS/race suites on a dedicated disposable database when changes touch classification/eligibility/privacy boundaries. Inspect scripts before invoking broader runners; no linked/shared/provider runner is implicitly approved.

## 31. Local fixture/browser evidence versus real-provider evidence

**Fresh evidence in this pass:** Git branch/HEAD/worktree/history/status inspection; file-content comparisons; all PDF text plus visual inspection of R10; source/router/query/schema/test inspection; `git diff --check` passed on the pre-existing main diff. A 578-path content manifest was captured before report creation for report-only verification.

Final comparison found all 578 pre-existing recorded paths unchanged and HEAD unchanged. The only newly observed paths were this report and an independently created `spec11-activation-readiness.md`; this pass did not create or edit the Spec 11 report. All 32 numbered sections, local links and trailing whitespace were checked. The concurrent [Spec 11 activation report](</Users/exoh/Desktop/WhereTo -  Repository/Docs/testing/spec11-activation-readiness.md>) corroborates the missing settings/password/public-support flows and identifies unsupported inherited payout wording. Its proposed Auth/settings work is not implemented or authorized by Spec 12.

**Not run in this pass:** application typecheck/build/lint, unit/integration/SQL tests, browser journeys, new runtime screenshots, screen-reader tests, real Auth/Supabase/Stripe/Mapbox/email operations, physical camera tests. This is an activation audit, not a feature completion claim. No provider evidence is inferred from code or reports.

Located prior evidence includes [Spec 05 verification](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec05-check-in/Docs/testing/spec05-check-in-verification.md>) reporting synthetic-camera/real-local-SQL races and browser captures, and [Spec 06 verification](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec06-free-rsvp/Docs/testing/spec06-free-rsvp-verification.md>) reporting disposable SQL/production-handler/browser proofs. Their passing counts are historical and were not rerun here. Spec 06 explicitly documents pending integration with the newer Spec 05 UI. Spec 07 contains test code and a plan; no final frozen current verification report was established in this audit. The existing [Spec 09 activation report](</Users/exoh/Desktop/WhereTo -  Repository/Docs/testing/spec09-activation-readiness.md>) is corroborating evidence of refund contract gaps, not permission to implement them.

Future synthetic UI tests prove presentation and callback wiring; local SQL tests prove database behavior in that fixture. Neither proves actual provider delivery, real Stripe webhook processing, deployed RLS, hardware camera behavior or accepted production map data. Spec 12 need not execute external transactions to verify its presentation, and none are authorized by this pass.

## 32. Blockers requiring approval

1. **Accepted baseline:** approve the precise integrated snapshot/manifest and ownership of overlapping router, buyer, creation, query, collection and delivery files. The broadest working tree is not automatically the accepted baseline.
2. **Truthful classifications:** agree with Auth/operations/ticket-access owners on safe absence versus denied versus failed versus expired session. Current overloaded/collapsed responses cannot satisfy every strict requested distinction. Approve neutral private-unavailable fallbacks where disclosure is intentionally withheld.
3. **Transactional limits:** retain Spec 08/09/10 and admission/delivery ownership; explicitly defer unresolved recovery interfaces. Existing refund/cancellation retry wording must not be certified by a shared generic button. Resolve stale destructive eligibility and checkout invalid-route behavior with owners before claiming those routes covered.
4. **Deferred boundaries:** approve the three map states as DEFERRED PRESENTATION — MAP OWNER, preserve unsupported free check-in until its owner integration lands, and omit unconfigured support actions. Core shared presentation can be a separately approved partial increment.

Deliverable: this report only. Application files changed: none. Migrations added/applied: none. Providers/Auth settings changed: none. No payments, admissions, refunds, cancellations, emails, staging, commits, merges, pushes, deployments, resets or worktree creation were performed. Manual setup for the activation report: none. Eventual local verification setup depends on the accepted baseline; provider activation remains outside this plan.

BLOCKED — BASELINE/DOMAIN CONTRACT ISSUE
