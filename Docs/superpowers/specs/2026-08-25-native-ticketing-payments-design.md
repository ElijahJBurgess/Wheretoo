# Whereto Day 2 Native Ticketing and Marketplace Payments Design

**Status:** Proposed design awaiting written-spec review
**Date:** 2026-08-25
**Milestone:** Published event -> organizer Connect onboarding -> paid ticket tiers -> guest Stripe test-mode checkout -> verified webhook -> exactly-once order and ticket issuance -> confirmation

## 1. Source of truth and process

This specification extends the completed Day 1 organizer and event subsystem. It is governed, in order, by:

1. `AGENTS.md`;
2. `Docs/WHERETO_V1_PRODUCT_DEFINITION.md`;
3. `Docs/WHERETO_V1_USER_FLOWS.md`;
4. `Docs/WHERETO_V1_TECHNICAL_ARCHITECTURE.md`;
5. `Docs/superpowers/specs/2026-08-24-organizer-event-publishing-design.md`;
6. `Docs/superpowers/plans/2026-08-24-organizer-event-publishing-implementation.md`;
7. the actual Day 1 implementation and linked development database.

The seven files under `Visual Reference /` are visual context only. The transaction-flow reference informs ticket-selection hierarchy, confirmation clarity, compact mobile layout, and the light organizer-console family. It does not add QR, wallet passes, analytics, payouts dashboards, consumer accounts, favorites, messaging, or check-in to Day 2.

### 1.1 Official Stripe tooling used

The official `stripe@openai-curated` plugin is installed and enabled. Its MCP tools, including `stripe_implementation_planner`, were not exposed to this running session, so this design used Stripe's specified official fallback, `https://docs.stripe.com`, installed at user scope. The official fallback supplied:

- `connect-recommend`, used as the Connect implementation planner;
- `stripe-best-practices`, used for Checkout, webhook, security, and Tax decisions;
- `stripe-docs`, used through the official Stripe CLI to verify current documentation.

No third-party Stripe skill or guidance was used. No Stripe credentials were required for planning, no Stripe objects or charges were created, and no repository dependency was added.

### 1.2 Planner business classification

| Dimension | Whereto decision |
|---|---|
| Business model | Event ticketing marketplace |
| Buyer | Consumer purchasing a ticket without a Whereto account |
| Seller | Independent organizer that owns one event |
| Checkout owner | Whereto provides the event page, order flow, support boundary, and confirmation |
| Funds flow | Whereto charges the consumer and automatically routes organizer proceeds |
| Platform revenue | Configurable percentage plus fixed fee; exact values are not chosen in this specification |
| Settlement | One connected organizer account per transaction; no multi-seller split and no delivery-gated transfer |

This classification maps to Stripe's marketplace configuration and destination charges. The compatibility matrix rates the recommended configuration as supported with a caution: Express Dashboard users have limited refund and dispute visibility for destination charges, so Whereto must own webhook-driven recovery and operational handling.

## 2. Goal

Build the smallest secure paid-ticket subsystem that proves, in Stripe test mode, that:

1. an authenticated organizer can establish a Stripe connected account;
2. Whereto displays incomplete, action-required, restricted, and ready Connect states accurately;
3. an organizer with an owned event can define up to three paid ticket tiers;
4. paid sales cannot activate until the event, tiers, fee policy, and current Connect capabilities are valid;
5. an anonymous consumer can select one tier, provide name and email, and enter Stripe-hosted Checkout;
6. all prices, fees, inventory, event state, and connected-account routing are recalculated server-side;
7. Stripe can complete a real test-mode payment;
8. a verified Stripe webhook is the only authority that marks the order paid;
9. duplicate and retried webhook deliveries cannot duplicate orders, inventory consumption, or tickets;
10. Whereto records organizer proceeds and platform-fee attribution in integer minor units; and
11. the consumer reaches a processing or confirmed state based on persisted webhook truth, never redirect truth.

## 3. Current state after Day 1

### 3.1 Repository

The inspected `main` branch is clean at `ac87f7a3a6155eccef9d4b1693cc7d41a4a4b9d2` and matches `origin/main`.

Day 1 currently provides:

- React 19, TypeScript 6, Vite 8, React Router 7, TanStack Query 5, React Hook Form, Zod, and typed Supabase access;
- deterministic Supabase Auth session state;
- explicit organizer profile onboarding;
- organizer-only route guards;
- organizer-owned event draft creation, update, reload, preview, and immediate publication;
- verified Mapbox address selection and fixed Los Angeles wall-time conversion;
- owner-aware event query keys that prevent cross-account cache disclosure;
- responsive organizer-console primitives and layouts;
- three committed Supabase migrations with pgTAP coverage;
- linked-development integration and mobile/desktop Playwright coverage.

The current route tree contains only public organizer-auth routes and protected organizer routes. It has no anonymous consumer event page, ticket selection, checkout, confirmation, Connect, order, or payment route.

### 3.2 Database

The linked development database is healthy and its migration history matches the three committed Day 1 migrations. The actual public schema contains only:

- `public.organizers`;
- `public.events`;
- `public.publish_event(uuid)` plus Day 1 support functions.

The linked schema has one organizer row and one event row at inspection time. No ticket, order, payment, webhook, or Stripe-account table exists.

Existing RLS provides:

- public organizer reads;
- organizer self-insert and self-update;
- owner-only draft event reads and mutations;
- anonymous reads only for published events whose moderation state is `clear` or `flagged`;
- no browser authority over event lifecycle or moderation columns.

`events.admission_type` already supports `free` and `paid`, and `events.capacity` already exists. However, `publish_event` deliberately rejects paid events with `PAID_PUBLISHING_NOT_AVAILABLE`, and the frontend enforces the same Day 1 boundary. Published events are currently read-only to organizers.

### 3.3 Day 2 integration consequences

- The existing `events` ownership and public-read policies remain the event authority.
- Paid-tier inventory becomes authoritative for paid events. `events.capacity` remains the future free-RSVP capacity field and is not a second paid-inventory source.
- Day 2 must replace the paid-publication rejection with a server-enforced paid-readiness rule.
- Day 2 must support adding paid ticket configuration to an owned published event without replacing the event row or changing `published_at`.
- Financial and customer-private tables must not inherit the broad public reads appropriate for organizers and events.
- Supabase Edge Functions are now required because Stripe credentials, signature verification, and service-level database writes cannot run in Vite.

## 4. Stripe recommendation

### 4.1 Recommended Connect configuration

Use Stripe Accounts v2. Do not create legacy `standard`, `express`, or `custom` account types.

| Setting | Value |
|---|---|
| Accounts API | `/v2/core/accounts` |
| Dashboard | Express (`dashboard: "express"`) |
| Fee collection | Whereto manages pricing (`defaults.responsibilities.fees_collector: "application"`) |
| Negative balance liability | Whereto (`defaults.responsibilities.losses_collector: "application"`) |
| Account configuration | Recipient (`configuration.recipient`) |
| Requested capability | `stripe_balance.stripe_transfers` |
| Onboarding | Connect embedded onboarding |

Each organizer connected account receives the recipient configuration with `stripe_transfers` requested on `stripe_balance`. It does not request merchant configuration or `card_payments`, because the organizer receives destination transfers rather than accepting direct charges as merchant of record.

Use the embedded components:

- `account_onboarding`;
- `notification_banner`;
- `account_management`.

After onboarding, Whereto may create a short-lived Express Dashboard login link. Day 2 does not build custom payout, refund, dispute, or analytics dashboards.

The organizer is ready to sell only when a fresh Stripe account retrieval reports:

- `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === 'active'`; and
- the corresponding payouts capability is active;
- no requirement state currently restricts the required functionality.

Returning from or closing onboarding is not proof of readiness. Whereto re-retrieves the Account and also consumes account-requirement events.

### 4.2 Charge model: destination charges

Use destination charges created on Whereto's platform account. The Checkout Session's PaymentIntent includes:

- `transfer_data.destination = organizer Stripe account ID`;
- one computed `application_fee_amount` from the active versioned fee rule;
- opaque Whereto order and event identifiers in metadata;
- no customer email, name, address, or other unnecessary PII in metadata.

Why this is the V1 fit:

- each transaction has exactly one organizer;
- Whereto owns the native event and checkout journey;
- organizer proceeds transfer immediately to the connected Stripe balance;
- the intended weekly organizer payout is a connected-account payout schedule, not a delayed platform transfer;
- there is no multi-seller cart or delivery-completion gate.

Whereto's platform balance pays Stripe processing fees, refunds, and chargebacks for this charge pattern. Whereto must reverse destination transfers during approved refunds and explicitly recover transfers during disputes. Express users have limited dispute/refund visibility, so Whereto owns those operational workflows.

### 4.3 Alternatives considered

#### Direct charges

Rejected for V1. Direct charges make the connected organizer the merchant of record and fit software that enables independent sellers to run their own checkout, branding, refunds, and disputes. Whereto instead owns the event page, native checkout, confirmation, and consumer support boundary.

#### Separate charges and transfers

Rejected for V1. This pattern is appropriate for multi-seller payments or when a platform must hold funds and release them after delivery. Whereto has one organizer per order and no delivery gate. Using it would add transfer timing, recovery, and reconciliation complexity without a product requirement.

#### Destination charges with `on_behalf_of`

Not selected. It changes settlement-merchant and merchant-of-record behavior and can introduce cross-border requirements. Whereto is Bay Area-first and the standard marketplace destination-charge path is sufficient. International or `on_behalf_of` requirements require separate Stripe and legal review.

### 4.4 Merchant and seller roles

The architectural recommendation treats Whereto as the merchant of record for the paid transaction and the organizer as the seller and destination recipient. This matches Whereto-branded native checkout and platform-owned payment operations.

Stripe does not enforce merchant-of-record correctness through the charge API. Before live mode, counsel and Stripe must confirm that Whereto's contracts, receipts, statement descriptor, refund/dispute operations, marketplace-facilitator treatment, and seller relationship match this model. Test-mode implementation may proceed against this explicit architectural assumption; live activation may not.

### 4.5 Checkout architecture

Use Stripe-hosted Checkout with the Checkout Sessions API in `payment` mode.

Stripe-hosted Checkout is preferred over an embedded Payment Element because it:

- is the lowest-complexity PCI boundary;
- handles responsive payment UX and eligible payment methods;
- keeps raw payment details entirely outside Whereto;
- provides clear success and cancellation returns;
- supports destination-charge parameters and application fees.

Do not pass `payment_method_types`. Use a Stripe payment method configuration for this integration. The Day 2 test configuration enables immediate test-mode payment methods so inventory does not remain indefinitely tied to delayed methods. The webhook handler still supports `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` so later Dashboard changes do not silently break fulfillment.

On API versions that support it, each session includes an `integration_identifier` such as `whereto_ticket_checkout_<8 random letters>`.

### 4.6 Fee architecture

Whereto's fee remains percentage plus fixed amount, but this specification does not invent either value.

Store fee policies as versioned database records with:

- platform percentage in basis points;
- platform fixed amount in integer minor units;
- currency;
- whether the application fee includes a configured Stripe processing-fee estimate;
- optional processing-fee estimate percentage and fixed amount;
- test/live mode and effective dates.

Recommended calculation mode: `applicationFeeIncludes = "stripe_fee_estimate"`. Destination charges make Whereto pay Stripe processing fees, so including a configured estimate preserves the intended platform margin more reliably than absorbing unknown processing fees. Rates vary by region and payment method; the estimate is not a guarantee. Reconcile actual Stripe fees from balance transactions and monitor Stripe's margin report.

For every order, snapshot the complete fee rule and calculated values. Changing a later fee rule never rewrites historical orders. The server computes:

```text
subtotal_minor = unit_amount_minor * quantity
platform_product_fee_minor = floor(subtotal_minor * percent_bps / 10_000) + fixed_minor
application_fee_amount_minor = platform_product_fee_minor + configured_processing_fee_estimate_minor
expected_organizer_proceeds_minor = subtotal_minor - application_fee_amount_minor
```

The function must reject negative values, overflow, fees greater than or equal to the subtotal, and a missing active rule. Stripe's Platform Pricing Tool is not combined with explicit `application_fee_amount`; explicit versioned calculation is selected because Whereto requires deterministic in-database attribution and a percentage-plus-fixed product rule.

### 4.7 Stripe Tax recommendation

Do not enable `automatic_tax` during the initial Day 2 implementation.

Stripe Tax can calculate and collect supported sales tax, VAT, or GST, monitor potential nexus thresholds, and produce transactional reporting. It does not decide which party is legally liable, choose the legally correct event-ticket tax code, register Whereto with tax authorities merely because a Stripe registration record exists, or independently file every return.

Before enabling tax, Whereto must obtain and configure:

1. a legal determination of whether Whereto or the organizer is tax-liable for each supported transaction;
2. a head-office address in Stripe Tax settings;
3. active registrations in every jurisdiction where the liable entity has been advised to collect;
4. the canonical Stripe tax code for the applicable event-ticket product;
5. inclusive or exclusive tax behavior;
6. the matching `automatic_tax.liability` value.

Enabling automatic tax without an active registration can silently collect zero tax. Day 2 therefore stores `tax_amount_minor`, tax status, and liable-entity snapshot fields but leaves calculation disabled and asserts zero tax in the test flow. No `txcd_` value is guessed or committed.

## 5. Day 2 scope

### 5.1 Included

- Stripe test-mode configuration and secret boundaries;
- one Stripe Accounts v2 recipient account per organizer per Stripe mode;
- Connect embedded onboarding and actionable readiness status;
- up to three organizer-defined paid ticket tiers per event;
- conversion of an owned draft or published event to paid sales through a server operation;
- anonymous public event and public ticket-tier reads;
- one ticket tier and quantity one per Day 2 checkout;
- guest name and email collection;
- server-created Stripe-hosted Checkout Session;
- transactional inventory reservation and expiry;
- destination charge and configurable application fee;
- verified and idempotent webhook processing;
- exactly-once order, order-item, and ticket persistence;
- processing, confirmed, failed, expired, sold-out, and action-required states;
- persisted Stripe identifiers and fee/proceeds attribution;
- refund and dispute data/reconciliation foundation without organizer refund UI;
- mobile and desktop test-mode E2E proof.

The schema supports quantities greater than one later, but the Day 2 public API and UI enforce quantity one. This keeps the first payment proof, last-ticket race, refund attribution, and exactly-once ticket issuance unambiguous without contradicting the goal that a consumer selects a ticket.

### 5.2 Excluded

- free RSVP;
- QR or check-in credentials and UI;
- consumer accounts, profiles, stored payment methods, or order history;
- ticket transfer, resale, bundles, tables, reserved seating, or promo codes;
- external ticket providers;
- subscriptions;
- organizer orders/attendee UI, analytics, payout history, cash-out, or refund UI;
- automatic event-cancellation refunds;
- map, living-city, search, favorites, messaging, AI flyers, or artwork work;
- live-mode credentials or charges;
- automatic Stripe Tax activation;
- cross-border Connect behavior.

## 6. System architecture

```text
React/Vite public and organizer UI
  -> Supabase Data API for existing RLS-safe reads
  -> Supabase Edge Functions for Stripe operations
       -> official Stripe SDK with restricted test key
       -> PostgreSQL service boundary / private RPCs
  <- Stripe-hosted Checkout redirect
Stripe signed webhook
  -> dedicated Supabase Edge Function using raw request body
  -> one transactional PostgreSQL fulfillment RPC
  -> durable order + ticket truth
React confirmation route
  -> bearer-token-safe confirmation projection
  -> processing or confirmed persisted state
```

### 6.1 Server modules and Edge Functions

Use small functions sharing a pinned server-only Stripe adapter:

| Boundary | Access | Responsibility |
|---|---|---|
| `stripe-connect-session` | Authenticated organizer | Ensure one Accounts v2 recipient account, create an Account Session, return only its ephemeral client secret and safe status |
| `stripe-connect-status` | Authenticated organizer | Retrieve the current Stripe Account, persist a safe capability/requirements projection, return organizer-facing state |
| `stripe-express-login` | Authenticated organizer | Create a short-lived Express Dashboard login link for the organizer's own account |
| `stripe-create-checkout` | Anonymous, rate-limited | Validate guest input and opaque IDs, reserve inventory, create or reuse the Checkout Session, return its hosted URL |
| `stripe-cancel-checkout` | Anonymous with confirmation bearer token | Expire an open Stripe Session, then release the reservation; a closed browser otherwise relies on expiry |
| `stripe-webhook` | Stripe signature only | Verify raw-body signature, deduplicate, reconcile Connect/payment/refund/dispute events, and invoke transactional state changes |
| `order-confirmation` | Anonymous with confirmation bearer token | Return a minimal processing/confirmed/failed projection without exposing financial internals or arbitrary customer records |

The Stripe SDK is pinned to the current approved version at implementation time, instantiated once as a `StripeClient`, and configured with the explicit API version. Secret and restricted keys never enter `src/`, Vite variables, logs, errors, or response payloads.

### 6.2 Environment contract

The browser gains one public value only if required by Connect embedded components:

```text
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Supabase Edge Function secrets include names such as:

```text
STRIPE_RESTRICTED_KEY
STRIPE_WEBHOOK_SECRET
APP_BASE_URL
```

The restricted key must have only the permissions needed for Accounts v2, Account Sessions, Checkout Sessions, PaymentIntents/Charges retrieval, Transfers/Application Fees retrieval, and the explicitly included refund foundation. Use different keys and webhook secrets per environment. The Supabase service-role key remains only in the managed Edge Function environment.

## 7. Data model

All changes are delivered by committed Supabase migrations. Stable value sets use text checks, following Day 1 conventions.

### 7.1 `public.organizer_stripe_accounts`

Private server-managed Connect projection.

| Column | Type | Rules |
|---|---|---|
| `organizer_id` | `uuid` | References `organizers(id)`; composite primary key with `livemode` |
| `livemode` | `boolean` | Day 2 rows are `false` |
| `stripe_account_id` | `text` | Required and unique |
| `dashboard` | `text` | Required `express` for this subsystem |
| `fees_collector` | `text` | Required `application` |
| `losses_collector` | `text` | Required `application` |
| `country_code` | `text` | Required `US` for Day 2 |
| `currency` | `text` | Required `usd` for Day 2 |
| `transfers_status` | `text` | `inactive`, `pending`, `active`, or `restricted` |
| `payouts_status` | `text` | Same stable state set |
| `requirements_status` | `text` | `not_started`, `pending`, `action_required`, `restricted`, or `clear` |
| `requirements_currently_due_count` | `integer` | Non-negative safe summary only |
| `requirements_past_due_count` | `integer` | Non-negative safe summary only |
| `last_status_code` | `text` | Nullable safe Stripe status code; no PII |
| `last_synced_at` | `timestamptz` | Required after a Stripe retrieval |
| `created_at`, `updated_at` | `timestamptz` | Trigger-maintained |

Do not store raw Account identity, persons, bank details, tax IDs, or onboarding payloads.

### 7.2 `public.ticket_tiers`

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | Primary key |
| `event_id` | `uuid` | Required; references `events(id)` with delete restricted |
| `name` | `text` | Trimmed 1-80 characters |
| `description` | `text` | Nullable; at most 240 characters |
| `unit_amount_minor` | `bigint` | Required positive integer within Stripe currency limits |
| `currency` | `text` | Required `usd` for Day 2 |
| `quantity_total` | `integer` | Required positive inventory |
| `status` | `text` | `draft`, `active`, or `archived` |
| `sort_order` | `smallint` | 1 through 3; unique per event |
| `version` | `integer` | Starts at 1; incremented on material edits |
| `created_at`, `updated_at` | `timestamptz` | Trigger-maintained |

An ownership-aware database function locks the event and replaces or updates at most three tiers. Once a tier is referenced by any order attempt, its currency and historical version are immutable; order items retain complete snapshots. Capacity cannot be reduced below paid tickets plus currently active reservations. Archiving stops new checkout without rewriting history.

### 7.3 `public.platform_fee_rules`

Private, server-managed configuration.

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | Primary key |
| `livemode` | `boolean` | Separates test and live policies |
| `currency` | `text` | `usd` for Day 2 |
| `platform_percent_bps` | `integer` | 0-10,000; exact value not set by this spec |
| `platform_fixed_minor` | `bigint` | Non-negative; exact value not set by this spec |
| `processing_fee_treatment` | `text` | `stripe_fee_estimate` or `platform_fee_only` |
| `processing_estimate_percent_bps` | `integer` | Nullable, non-negative |
| `processing_estimate_fixed_minor` | `bigint` | Nullable, non-negative |
| `effective_from`, `effective_until` | `timestamptz` | Non-overlapping effective range per mode/currency |
| `created_at` | `timestamptz` | Required |

No arbitrary fee rule is seeded in a production migration. A deliberate test-mode rule is required before running the real transaction proof.

### 7.4 `public.orders`

Private financial/customer table.

| Column group | Fields |
|---|---|
| Identity | `id`, immutable human-safe `order_number`, `event_id`, `organizer_id`, `livemode` |
| Lifecycle | `status`, `checkout_expires_at`, `reservation_expires_at`, `paid_at`, `failed_at`, `expired_at`, `refunded_at`, `created_at`, `updated_at` |
| Guest | `buyer_name`, normalized `buyer_email` |
| Idempotency | `client_request_id`, unique organizer/event/request constraint, `confirmation_token_hash` unique |
| Money | `currency`, `subtotal_minor`, `tax_amount_minor`, `total_minor`, `platform_product_fee_minor`, `stripe_fee_estimate_minor`, `application_fee_amount_minor`, `expected_organizer_proceeds_minor`, `actual_stripe_fee_minor`, `actual_organizer_proceeds_minor` |
| Fee snapshot | `fee_rule_id`, percentage/fixed/treatment/estimate snapshot columns |
| Stripe | unique nullable Checkout Session and PaymentIntent IDs; nullable Charge, Transfer, Application Fee, Balance Transaction, and Customer IDs |
| Reconciliation | `last_stripe_event_id`, `reconciliation_status`, `failure_code` |

Stable order statuses are:

- `creating_checkout`;
- `checkout_open`;
- `payment_processing`;
- `paid`;
- `expired`;
- `payment_failed`;
- `cancelled`;
- `partially_refunded`;
- `refunded`;
- `requires_review`.

The database checks arithmetic identities and requires money columns to use integer minor units. Customer email and name are never public table fields.

### 7.5 `public.order_items`

Each Day 2 order contains exactly one item with quantity one, while the schema supports positive quantities for a later approved expansion.

Persist:

- `order_id` and `ticket_tier_id`;
- tier version, name, and description snapshots;
- `unit_amount_minor`, `quantity`, `subtotal_minor`, and `currency`;
- created timestamp.

The server rejects mixed-event, mixed-organizer, mixed-currency, multi-tier, or quantity-greater-than-one Day 2 requests.

### 7.6 `public.tickets`

Persist one row per purchased admission:

- `id`;
- `order_id`, `order_item_id`, `event_id`, `organizer_id`, and `ticket_tier_id`;
- `unit_sequence` with a unique `(order_item_id, unit_sequence)` constraint;
- status `valid`, `refunded`, or `cancelled`;
- `issued_at`, `refunded_at`, `cancelled_at`.

Day 2 does not create a QR/check-in credential. The internal UUID is not presented as a secure admission token. A later QR subsystem can add a hashed opaque credential without changing payment or order identity.

### 7.7 `public.stripe_webhook_events`

Persist:

- Stripe event ID as primary key;
- event type, livemode, Stripe object ID, API version, and created timestamp;
- SHA-256 payload digest, not the full PII-bearing payload;
- processing status `processing`, `processed`, or `failed`;
- delivery attempt count, first/last received time, processed time, and safe error code.

Stripe event ID deduplicates repeated delivery. Domain uniqueness on the order, Checkout Session, PaymentIntent, and ticket constraints provides a second exactly-once boundary. Because Stripe does not guarantee delivery order, every handler retrieves or uses the latest authoritative Stripe object when required and applies monotonic state transitions.

### 7.8 `public.refunds`

Add the reconciliation foundation without an organizer UI:

- internal and unique Stripe refund IDs;
- order ID;
- amount and currency;
- status;
- reason;
- `reverse_transfer` and `refund_application_fee` decisions;
- Stripe event ID and timestamps.

Refund events update ticket validity and order refund totals idempotently. A later approved refund action must use server-side Stripe calls with explicit destination-transfer and application-fee behavior.

### 7.9 Indexes and database functions

Required indexes cover:

- organizer/mode Connect lookup;
- event/status/sort order tier reads;
- active tier inventory checks;
- order organizer/event/status and reservation expiry;
- unique Stripe object IDs;
- normalized buyer email for operational lookup;
- order items by tier;
- tickets by order/event/status;
- webhook processing status and receipt time.

Private transactional functions provide:

- ownership-safe tier save and activation;
- paid-sales readiness activation;
- checkout reservation creation;
- Checkout Session attachment;
- reservation cancellation/expiry;
- payment fulfillment;
- async failure and refund reconciliation.

The reservation and fulfillment functions use row locks, stable lock order, constraints, and idempotent return behavior.

## 8. Inventory and overselling prevention

Inventory is derived from durable order items, not trusted counters:

```text
available = tier.quantity_total
          - quantity on paid or payment-processing orders
          - quantity on unexpired checkout-open reservations
```

Checkout reservation creation:

1. locks the ticket-tier row `FOR UPDATE`;
2. revalidates the published event, moderation state, active tier, fresh Connect readiness, fee rule, currency, and price;
3. treats stale `creating_checkout` or `checkout_open` orders past their reservation grace time as unavailable no longer;
4. recomputes available inventory inside the same transaction;
5. inserts one order and order item only if inventory remains.

The Checkout Session expires after Stripe's minimum supported 30-minute window. The database reservation adds a short grace period beyond Stripe expiry so inventory is not reallocated while a boundary-time Stripe completion can still arrive. `checkout.session.expired`, explicit server-side cancellation, and lazy/scheduled cleanup release reservations idempotently.

If a late successful payment arrives after its reservation is no longer valid, Whereto never issues an extra valid ticket. The order moves to `requires_review` and the refund/recovery path handles the payment. This preserves the no-oversell invariant even across external-system timing races.

Two simultaneous requests for the final ticket serialize on the same tier row. Exactly one reservation commits; the other receives `TIER_SOLD_OUT` without creating a Stripe Session.

## 9. Payment lifecycle

### 9.1 Organizer lifecycle

1. Authenticated organizer opens payment setup.
2. Whereto creates or retrieves the organizer's test-mode Accounts v2 recipient account server-side.
3. Whereto creates an Account Session and renders embedded onboarding.
4. Organizer provides KYC and payout details directly to Stripe.
5. Whereto retrieves the Account and stores only safe capability/requirement state.
6. Account-requirement events keep the projection current.
7. Organizer defines one to three draft ticket tiers on an owned event.
8. `activate_paid_sales` requires current Connect readiness, an active fee rule, a valid event, and at least one valid active tier.
9. Activation sets the event's `admission_type` to `paid` through a privileged operation. If the event was already published, its row and original `published_at` remain unchanged.
10. Restricted or newly incomplete Connect state stops new Checkout Sessions immediately and displays an actionable organizer status.

An event cannot expose both free RSVP and paid tiers in Day 2. Because free RSVP records do not exist yet, converting an existing published free event is safe now. A later RSVP subsystem must forbid conversion once free registrations exist.

### 9.2 Consumer and Checkout lifecycle

1. Anonymous consumer opens `/events/:eventId`.
2. Public projection returns only a discoverable published event and its active safe tier projection.
3. Consumer selects one tier and enters name and email.
4. Browser sends only event ID, tier ID, guest fields, and a random client request ID. It sends no trusted amount, currency, fee, destination account, or inventory value.
5. Edge Function retrieves current Stripe Connect status, synchronizes the safe projection, and calls the reservation transaction.
6. Server calculates all money from the persisted tier and fee snapshots.
7. Server creates Stripe Checkout with an idempotency key derived from the order ID, destination account, application fee, 30-minute expiry, customer email, order reference, and opaque metadata.
8. Server attaches the returned Checkout Session ID and URL to the same order.
9. Browser redirects to Stripe's hosted URL.
10. Declines remain inside Checkout and do not mark the order paid. Abandonment eventually expires the Session and reservation.
11. Success redirects to `/orders/:confirmationToken`, which initially may show `Confirming your payment`.
12. The confirmation route polls the safe persisted projection. It never changes order state.

### 9.3 Webhook lifecycle

1. `stripe-webhook` reads the unmodified raw body.
2. Official Stripe SDK verifies `Stripe-Signature` with the environment-specific webhook secret.
3. Invalid signatures return 400 and perform no database write.
4. The handler inserts or observes the webhook event ID.
5. For `checkout.session.completed`, fulfillment runs only when `payment_status` is paid.
6. Unpaid completed sessions move to `payment_processing`; `checkout.session.async_payment_succeeded` later fulfills and `checkout.session.async_payment_failed` releases/fails.
7. The fulfillment transaction locks the order and tier, verifies the exact Session, mode, currency, totals, payment status, destination, application fee, and opaque order metadata.
8. It persists PaymentIntent/Charge/Transfer/Application Fee references, marks the order paid, and inserts exactly one ticket.
9. A duplicate event or retry returns the already persisted result without changing inventory or issuing another ticket.
10. A durable successful transaction returns 2xx. Transient processing failures return non-2xx so Stripe retries.

Stripe can retry live webhook delivery for up to three days and does not guarantee event ordering. The implementation therefore makes every transition idempotent and monotonic, and it never assumes an earlier event has arrived.

### 9.4 Refund and dispute foundation

Refund and dispute webhook handling is included for auditability and ticket invalidation, but Day 2 exposes no organizer refund UI.

- Approved refunds must use `reverse_transfer: true` so organizer proceeds are recovered.
- Whether the platform fee is returned must be an explicit refund policy decision; it is stored on each refund.
- Disputes debit Whereto first. Whereto must explicitly reverse the associated destination transfer and record failures or connected-account negative balances.
- Refunded or cancelled tickets are never valid admissions in the later check-in subsystem.
- A paid order whose event or tier becomes invalid before fulfillment enters `requires_review`; no extra valid ticket is issued.

## 10. Security and RLS

### 10.1 Browser trust boundary

Never trust from the browser:

- price, subtotal, fee, tax, currency, or organizer proceeds;
- organizer Stripe account ID or destination;
- inventory or sold-out state;
- event, tier, or organizer relationships;
- Connect readiness;
- Checkout or payment success;
- Stripe object IDs not re-retrieved and matched server-side.

The browser may provide only user input and opaque identifiers. Server and database boundaries revalidate all relationships and values.

### 10.2 RLS and grants

- Preserve existing `organizers` and `events` policies.
- Organizer Stripe account, fee rule, orders, order items, tickets, refunds, and webhook tables receive no anonymous or ordinary authenticated table grants.
- Organizers manage tiers through ownership-checking functions, not broad table mutation grants.
- Anonymous users read tiers only through a safe public projection that joins a currently public paid event and returns no organizer-private, customer, or financial fields.
- Organizer Connect status is returned only for `auth.uid()` through an authenticated server boundary.
- Order confirmation requires a high-entropy bearer token; only its hash is stored. The response contains the minimum event, tier, order status, and confirmation data.
- Guest checkout creates no Supabase Auth user.
- Service-role writes are limited to Edge Functions and private RPCs.
- Security-definer functions set `search_path = ''`, fully qualify names, revoke `PUBLIC` execution, and grant only the exact intended role.

### 10.3 Stripe and webhook security

- Prefer a least-privilege `rk_test_` restricted key over `sk_test_` where all required APIs are supported.
- Never use `rk_live_`, `sk_live_`, or live webhook secrets during Day 2.
- Store Stripe keys and webhook secrets as Supabase Edge Function secrets, not Vite variables or committed files.
- Verify signatures against the raw request body with Stripe's official SDK and normal timestamp tolerance.
- Keep server clocks synchronized; never set signature tolerance to zero.
- Use exact CORS origins and rate limits for anonymous checkout creation.
- Use Stripe idempotency keys plus database uniqueness.
- Add Stripe CSP directives only to pages that load Connect embedded components; hosted Checkout does not justify a permissive global CSP.
- Never log request headers, secrets, Account Session client secrets, full webhook bodies, buyer email, or Checkout URLs containing bearer data.

## 11. UI and routes

### 11.1 Organizer routes

| Route | Purpose |
|---|---|
| `/organizer/settings/payments` | Connect status, embedded onboarding, notification banner, account management, and Express Dashboard link |
| `/organizer/events/:eventId/tickets` | Create/edit/archive up to three owned-event ticket tiers and activate paid sales |

Existing organizer routes remain. The event editor may link to ticket setup when `Paid` is selected, but it does not embed Stripe or fee logic in form components.

Organizer states:

- `Connect Stripe to sell paid tickets`;
- `Finish Stripe setup`;
- `Action required`;
- `Payments restricted`;
- `Ready to sell`;
- `Ticket setup incomplete`;
- `Paid sales active`.

The console keeps the Day 1 light neutral/violet system, compact hierarchy, visible focus, 44px targets, mobile-first layout, and one dominant action. No analytics, attendee table, payout balance, cash-out, or refund action appears.

### 11.2 Consumer routes

| Route | Purpose |
|---|---|
| `/events/:eventId` | Public persisted event experience and active ticket tiers |
| `/events/:eventId/checkout` | Selected-tier review plus guest name/email before Stripe redirect |
| `/orders/:confirmationToken` | Webhook-backed processing, confirmed, failed, expired, or refunded result |

Consumer event and transaction screens borrow the approved light ticketing reference's clear event art area, tier rows, progress language, secure-Checkout reassurance, and decisive violet CTA. They do not implement the reference's QR, wallet pass, consumer ticket library, nav bar, analytics, or payout panels.

Required public states include:

- loading/error/not found;
- not yet on sale;
- Connect action required, expressed generically without exposing organizer financial details;
- available tiers;
- sold out;
- checkout creation failure with retained name/email;
- payment declined within Stripe;
- checkout cancelled/expired;
- payment processing;
- payment confirmed;
- payment failed;
- refunded or event unavailable.

## 12. Error contracts

Use stable server codes and map them to recovery copy. The initial set includes:

```text
EVENT_NOT_FOUND
EVENT_NOT_PUBLIC
EVENT_NOT_OWNED
EVENT_NOT_PAID
EVENT_NOT_SELLABLE
CONNECT_NOT_READY
CONNECT_ACTION_REQUIRED
FEE_RULE_NOT_CONFIGURED
TIER_NOT_FOUND
TIER_NOT_ACTIVE
TIER_SOLD_OUT
TIER_LIMIT_EXCEEDED
TIER_LOCKED_AFTER_SALE
CHECKOUT_ALREADY_EXISTS
CHECKOUT_CREATION_FAILED
CHECKOUT_EXPIRED
PAYMENT_PROCESSING
PAYMENT_FAILED
ORDER_NOT_FOUND
ORDER_REQUIRES_REVIEW
```

Unknown Supabase or Stripe details are suppressed from browser copy and logs. Failed checkout creation keeps guest input and releases or naturally expires its reservation. Stripe declines stay in Stripe's UI. A delayed webhook produces a processing state, not false failure or false confirmation.

## 13. Test strategy

Day 2 is not complete with mocks alone.

### 13.1 Unit and component tests

Cover:

- tier, guest, and fee validation;
- basis-point/fixed/minor-unit arithmetic and overflow;
- fee snapshot immutability;
- safe Stripe error mapping;
- Connect state derivation from v2 capability paths;
- organizer payment/tier screen states;
- consumer tier selection and retained guest fields;
- confirmation polling and redirect-not-authoritative behavior;
- accessibility names, summaries, status regions, keyboard flow, and focus recovery.

Mock only local adapters at component boundaries. Stripe SDK protocol tests assert exact request shapes, API version, idempotency key, destination, fee, expiry, metadata, and absence of browser-supplied money.

### 13.2 Database and RLS tests

pgTAP proves:

- exact schema, checks, FKs, indexes, grants, and RLS;
- up to three tiers and one owner per event;
- cross-organizer tier isolation;
- public tier visibility only for public paid events;
- no public/customer access to orders, tickets, refunds, fee rules, webhook rows, or Connect IDs;
- server-only financial writes;
- fee arithmetic checks;
- immutable historical snapshots;
- row-locked final-ticket race;
- expired reservation release;
- no paid sales for invalid/unpublished/blocked/removed events;
- no paid sales for stale or invalid Connect state;
- duplicate fulfillment returns the same result;
- unique Checkout/PaymentIntent/event/ticket constraints;
- exact inventory consumption and ticket issuance once;
- refund invalidates the ticket once.

### 13.3 Stripe test-mode integration

Use the official Stripe SDK and Stripe CLI or registered test webhook endpoint to prove:

- Accounts v2 recipient-account creation;
- embedded onboarding and current capability retrieval;
- one real Stripe-hosted Checkout payment using Stripe test data;
- application fee and destination account on the resulting PaymentIntent/Charge;
- declined payment does not mark an order paid;
- explicit Checkout Session expiry releases inventory;
- `checkout.session.completed` fulfillment;
- async success/failure handler behavior with signed Stripe fixtures;
- invalid signature returns 400 and writes nothing;
- the same signed Stripe event delivered twice issues one ticket;
- a forced first processing failure returns non-2xx and a resend completes once;
- Stripe IDs and actual fee/proceeds fields reconcile to retrieved Stripe objects;
- a test refund updates the refund, order, and ticket foundation exactly once.

Test objects use unique metadata and exact-ID cleanup. Tests never call live mode or create a real charge.

### 13.4 Concurrency and manipulation tests

- Start two checkout requests simultaneously against a tier with one remaining ticket; one succeeds and one returns sold out.
- Retry the same client request ID; it returns the same order/Session rather than reserving twice.
- Send fake amount, currency, fee, organizer ID, destination, and event/tier combinations; the server rejects or ignores them and uses persisted truth.
- Attempt another organizer's tier configuration and Connect status access; return authorization-safe not found.
- Change event, moderation, tier, or Connect state between page load and server call; the server blocks checkout.

### 13.5 Browser E2E and visual QA

At mobile and desktop widths:

1. organizer signs in;
2. completes test-mode Connect onboarding;
3. observes ready state;
4. creates up to three paid tiers on an owned event;
5. activates paid sales;
6. anonymous consumer opens the public event;
7. selects one tier and enters name/email;
8. completes Stripe-hosted test Checkout;
9. returns to processing/confirmation;
10. sees confirmation only after webhook persistence;
11. reloads confirmation successfully.

Capture and inspect organizer Connect/tier screens, consumer event/tier selection, guest checkout review, Stripe-hosted Checkout, processing, confirmation, sold-out, and error states. Run responsive, keyboard, focus, semantic-heading, contrast, overflow, and reduced-motion smoke checks against the approved visual references.

## 14. Operational and failure behavior

- **Connect incomplete/restricted:** block activation and new Checkout; retain tiers; provide onboarding remediation.
- **Stripe account changes after activation:** account event updates cached status; every Checkout request refreshes readiness before reserving.
- **Checkout API failure after reservation:** mark safe failure and release; if the function crashes, the grace expiry cleans it.
- **Abandoned Checkout:** session expiry or explicit server cancellation releases reservation.
- **Declined card:** order remains unpaid; no ticket exists.
- **Webhook delayed:** confirmation stays processing.
- **Webhook retry/duplicate:** same durable result and one ticket.
- **Out-of-order event:** retrieve current Stripe object and apply only monotonic transition.
- **Paid after invalidation:** no valid ticket; order enters review/refund handling.
- **Refund/dispute:** persist Stripe truth, reverse or record recovery, invalidate ticket as applicable.
- **Connect payout restriction:** do not imply Whereto can cash out; show Stripe status and remediation.

## 15. Risks and genuine unresolved decisions

### 15.1 Live merchant and tax responsibility

The architecture recommends Whereto as merchant of record, but legal counsel and Stripe must confirm that choice and the tax-liable entity before live mode. Stripe Tax remains disabled until then.

### 15.2 Exact fee policy

The platform percentage, fixed fee, and processing-fee estimate values are intentionally unset. Before the real Day 2 test transaction, Whereto needs a deliberate test-mode fee rule. Before live mode, finance must approve the live rule and whether customer/organizer pricing absorbs actual Stripe fee variation.

### 15.3 Stripe test configuration and credentials

Implementation requires:

- a Stripe test-mode publishable key;
- a least-privilege restricted test key, or a temporary test secret key only where the required API is unsupported by a restricted key;
- an environment-specific webhook signing secret;
- platform Connect profile setup acknowledging Whereto's fee and negative-balance responsibilities;
- a test event destination and test payment method configuration.

If these are not available when implementation begins, Stripe-connected execution stops and reports the missing item. No live credential is an acceptable substitute.

### 15.4 Destination-charge operational responsibility

Whereto bears platform-balance exposure and must build dispute transfer reversal, refund transfer reversal, Radar monitoring, and reconciliation. The Day 2 proof includes the data and handler foundation, but a complete organizer-facing dispute/refund operations product remains later V1 work.

## 16. Recommended implementation sequence

The later detailed implementation plan should use this order:

1. confirm Stripe test project, platform responsibility settings, test keys, webhook destination, and payment-method configuration;
2. add schema, private functions, grants, RLS, and pgTAP for Connect, tiers, fee rules, orders, reservations, tickets, webhooks, and refunds;
3. regenerate Supabase types and establish the pinned server-only Stripe adapter and Edge Function test harness;
4. implement Accounts v2 creation, Account Sessions, embedded onboarding, status synchronization, and Express login;
5. implement owned tier management and atomic paid-sales activation for draft and already-published events;
6. add the anonymous public event/tier projection and consumer routes;
7. implement transactional reservation and idempotent Stripe-hosted Checkout creation;
8. implement raw-body signature verification and idempotent payment/expiry/refund/dispute webhook processing;
9. implement bearer-token-safe processing and confirmation UI;
10. run database/RLS, server, Stripe test-mode, concurrency, manipulation, browser, accessibility, responsive, visual, secret, and cleanup gates;
11. document deployment secrets, Stripe Dashboard setup, webhook replay/recovery, reconciliation, and explicit live-mode blockers.

This is sequencing guidance only. The implementation plan is intentionally not part of this planning run.

## 17. Acceptance criteria

The Day 2 subsystem is complete only when fresh evidence proves:

1. all Stripe operations use test mode;
2. an organizer has one correct Accounts v2 recipient account for test mode;
3. Connect readiness reflects current Stripe capability state;
4. an organizer can save at most three owned-event paid tiers;
5. an owned published event can activate paid sales without replacement or republishing;
6. public consumers can read only safe active tier data for a public event;
7. browser manipulation cannot alter money, routing, inventory, or ownership;
8. two consumers racing for one ticket cannot both reserve it;
9. a real Stripe-hosted test payment succeeds as a destination charge;
10. the recorded application fee follows the configured versioned test rule;
11. redirect alone never marks an order paid;
12. verified webhook handling creates the paid order result and exactly one ticket;
13. duplicate delivery and retry preserve one order, one inventory consumption, and one ticket;
14. expiry, decline, failure, invalid signature, invalid event/tier, restricted Connect, and sold-out cases behave safely;
15. confirmation shows persisted processing/paid/refunded truth without requiring an account;
16. customer PII and financial tables are not anonymously readable;
17. no Stripe or Supabase privileged secret enters Git or the Vite bundle;
18. mobile, desktop, accessibility, visual, database, integration, and real Stripe test-mode gates pass;
19. all disposable Stripe and Supabase test objects are identified and cleaned exactly;
20. no Day 2 work implements Stripe live mode, QR/check-in, free RSVP, analytics, map, AI flyer, or another excluded feature.
