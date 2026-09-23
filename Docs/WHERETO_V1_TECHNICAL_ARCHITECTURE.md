# WHERETO V1 TECHNICAL ARCHITECTURE

Status: V1 architecture direction. Some implementation choices are intentionally soft-locked and may change when validated in the repository.

## 1. Target Stack
- Frontend: React + TypeScript + Vite
- Backend platform: Supabase
- Database: PostgreSQL
- Geospatial: PostGIS
- Auth: Supabase Auth
- Storage: Supabase Storage
- Map: Mapbox GL JS
- Payments: Stripe + Stripe Connect
- AI event cover generation: server-side image provider (OpenAI candidate)
- Transactional email: Resend
- Hosting/deployment: Vercel
- Source control: GitHub
- Primary coding agent: Codex

## 2. Architecture Principles
1. V1 first; no speculative platform architecture.
2. Database changes are migration-driven.
3. Public/user-owned data receives appropriate RLS.
4. Payment truth is server/webhook-derived, not trusted from the client.
5. Map rendering is isolated from business/domain logic.
6. Point-based events only in V1.
7. Keep integrations behind small adapters/modules.
8. Capture useful analytics events now without building a huge analytics product.
9. Prefer idempotent server operations for money, publishing, and check-in.
10. Test the load-bearing paths: payment, ticket issuance, check-in, RLS.

## 3. Suggested Repository Shape

src/
  app/
    router/
    providers/

  map/
    core/
      WheretoMap.ts
      mapConfig.ts
      mapStyle.ts

    data/
      useVisibleEvents.ts
      eventGeoJson.ts

    layers/
      EventLayer.ts
      ClusterLayer.ts
      ActivityLayer.ts

    markers/
      AnimatedMarkerHost.ts
      MarkerPool.ts

    animations/
      registry.ts
      runners/
      ribbon-cutting/
      celebration/
      generic/

    ambient/
      cars/
      pedestrians/

    interactions/
      eventSelection.ts

    filters/

  features/
    events/
    organizers/
    rsvp/
    ticketing/
    check-in/
    event-images/
    analytics/

  components/

  lib/
    supabase/
    stripe/
    mapbox/
    openai/
    resend/

supabase/
  migrations/
  functions/
  seed.sql

tests/

WHERETO_V1_PRODUCT_DEFINITION.md
WHERETO_V1_USER_FLOWS.md
WHERETO_V1_TECHNICAL_ARCHITECTURE.md
AGENTS.md

The exact file names may adapt to the existing repo. Preserve the separation of concerns even if structure changes.

## 4. Core Domain Model
Exact schema must be designed against the existing database before migration.

Likely V1 entities:
- profiles/users
- organizers
- events
- ticket_tiers
- registrations/orders
- tickets/admissions
- check_ins
- payment/Stripe references
- private event-cover generations/candidates
- analytics events where useful

### Event
At minimum needs concepts for:
- id
- organizer_id
- title/description
- category
- start_at/end_at
- timezone
- location/address
- geographic point
- artwork
- animation_preset
- status (draft/published/cancelled/ended or derived equivalent)
- capacity/configuration
- timestamps

One organizer owns an event. No transfer in V1.

## 5. Geospatial
Enable/use PostGIS.

Preferred location representation:
- geography(Point, 4326) or an equivalent PostGIS point appropriate to Supabase implementation
- spatial index (GiST)

Avoid loading every Bay Area event and filtering only in the browser.

Visible-event queries should consider:
- viewport bounds
- published status
- current time through next 7 days
- filters/category
- cancellation/end state

Return a client-friendly event projection suitable for GeoJSON conversion.

## 6. Map Engine
The map should be treated as an internal subsystem.

### Data Flow
Supabase/PostGIS
-> visible event query
-> frontend event projection
-> GeoJSON source
-> Mapbox layers / animated marker host
-> selection
-> event experience

### Hybrid Rendering Direction
Soft lock:
- Dense/far map: Mapbox/WebGL style layers and clustering.
- Close/active map: selected visible events may use richer HTML/SVG/Rive-style animated objects.
- Do not create an unbounded DOM marker for every database event.
- Cache/pool animated marker instances where useful.
- Render only what the viewport/zoom actually needs.

This should be validated with real performance testing.

## 7. Living City / Ambient Layer
Ambient life is separate from event truth.

Ambient objects may include:
- cars
- pedestrians

Rules:
- decorative/procedural, not represented as real tracked people or traffic
- limited by zoom
- limited by viewport/performance budget
- should not compete with real event objects
- can be disabled/reduced on low-power/reduced-motion contexts

V1 requires only proof-level ambient behavior if schedule permits.

## 8. Animation Registry
Avoid event-specific conditionals scattered through the map.

Concept:
animation_preset -> registered renderer/config

Example:
generic
runners
ribbon_cutting
celebration

The registry can define:
- asset/component
- supported zoom
- scale
- motion intensity
- selected state
- happening-now treatment
- reduced-motion fallback

The exact animation technology is not hard-locked. SVG/CSS, Rive, Lottie, Canvas/WebGL, or a hybrid may be evaluated. V1 should prioritize quality + performance + maintainability.

## 9. Authentication and Authorization
Consumer browsing does not require auth.

Organizer operations require authenticated organizer identity.

Use RLS and server-side authorization so:
- organizers can mutate only their own organizer/event resources
- consumers cannot mutate organizer-only data
- check-in operations validate organizer/event access
- privileged Stripe/webhook operations use server-side secrets only

Never expose service-role or Stripe secret keys to the client.

## 10. Payments
### Stripe Connect
Preferred direction:
- Stripe-hosted/embedded onboarding rather than custom KYC
- one connected organizer account associated with organizer
- paid events require appropriate payment capability

### Charges
Destination-charge style architecture is a candidate because each V1 event has one organizer. Confirm exact Stripe model before implementation.

Whereto fee:
- percentage + fixed fee
- exact values configurable/not yet locked

### Payment Truth
Client success redirect is UX only.

Authoritative flow:
1. create server-side payment/session intent
2. Stripe processes
3. webhook verifies signature
4. webhook/event handler performs idempotent state transition
5. order/ticket issuance occurs from verified state
6. retries do not create duplicate tickets/orders

Store Stripe identifiers needed for reconciliation; do not store raw card data.

## 11. Free RSVP
Free RSVP shares as much admission infrastructure as practical with paid tickets.

Both should produce an admission credential that can be validated at check-in.

Use database constraints/idempotency to avoid unintended duplicate registrations.

## 12. QR Credentials
Do not encode a guessable sequential ticket ID as the only credential.

Use an opaque, sufficiently random token or signed credential.

Check-in:
- validate token server-side
- validate event/admission state
- atomically record first successful check-in
- reject duplicate check-in
- reject cancelled/refunded/invalid credentials

## 13. Event Capacity and Inventory
Paid/free inventory must not rely solely on stale client state.

When issuing limited tickets/RSVPs:
- enforce capacity in server/database transaction logic
- handle concurrent purchase/registration attempts
- avoid overselling where practical

Exact reservation/hold behavior should match the Stripe checkout approach selected.

## 14. Refunds and Cancellation
Refund behavior must be explicitly implemented and tested.

State should reconcile from Stripe/webhook truth.

Event cancellation must:
- stop new discovery/transactions
- invalidate admission where appropriate
- update consumer/organizer states
- trigger approved refund logic for paid orders

Do not assume one webhook event name covers every Stripe refund scenario; test against Stripe test mode.

## 15. AI Event Cover Architecture
Keep generation behind a server-side provider adapter. Use existing saved event data, one creative preference and optional short direction; generate three private 4:5 candidates. No reference-image or typography-composition system in V1.

Durable generation/candidate records preserve progress and selection across refresh/navigation. Explicit selection promotes validated bytes into the existing private event-images bucket and canonical position-1 attachment. Candidates have no public delivery path. Shared revision checks serialize manual cover changes and AI selections; duplicate selections return receipts without restoring old covers.

Phase 1 implements persistence, private storage and safe selection with local fixtures only. Provider integration, generation UI and execution/cleanup infrastructure are later work. Generation failure must preserve the event draft and current cover. AI Flyer Generator is deferred to V3/V4.

## 16. Email
Resend can send:
- RSVP confirmation
- paid ticket confirmation
- event cancellation/update messages as approved

Email sending should not be the only persistence of a ticket. Ticket/order state lives in the database.

## 17. Analytics
Capture a small, stable event vocabulary from Day 1, such as:
- event_viewed
- event_selected_from_map
- rsvp_started/completed
- checkout_started
- purchase_completed
- check_in_completed

Avoid collecting unnecessary personal data.

Organizer analytics should be derived from authoritative domain data wherever possible.

## 18. Moderation/Safety
Publishing pipeline should support:
- server-side validation
- moderation status/reason where needed
- ability to block/remove event
- admin intervention path
- auditability for meaningful moderation actions

Do not hard-code only a handful of prohibited phrases as the safety system.

## 19. Testing Strategy
### Required V1 Verification
- TypeScript/build/lint as configured
- RLS/authorization tests for organizer ownership
- event publish flow
- free RSVP flow
- Stripe test-mode paid purchase
- webhook retry/idempotency
- QR validation
- duplicate check-in rejection
- cancelled/refunded admission rejection
- map visible-event query
- mobile/responsive smoke test

Use real Stripe test mode for at least the critical happy path rather than mocking the entire payment lifecycle.

## 20. Deployment and Secrets
- local/dev/prod environment separation
- secrets only in secure server/deployment configuration
- Supabase migrations committed
- no production secret values committed
- Stripe webhook endpoints configured per environment
- Mapbox public token restricted appropriately where supported

## 21. V1 Performance Priorities
- query only relevant map data
- cluster/simplify at distance
- cap rich animated DOM objects
- lazy-load heavy event art where possible
- respect reduced-motion
- avoid animation work when offscreen
- keep initial consumer map load fast

## 22. Deferred Architecture
Do not build now:
- route/path event engine
- complex recommendation engine
- social graph
- messaging
- subscription billing
- multi-organizer event ownership
- enterprise rollups
- real-time people/traffic simulation
- custom 3D city renderer

Design seams may allow these later, but V1 code should not be burdened by speculative implementations.
