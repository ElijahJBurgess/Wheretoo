Wheretoo

Find somewhere to go. Make something happen.

Wheretoo is a full-stack local event discovery and ticketing platform that connects event discovery with ticketing, checkout, ticket delivery, refunds, and admission. Organizers use the same system to create events, configure tickets, onboard for payments, manage attendees, and run the door.

Built with React, TypeScript, Vite, Supabase, PostgreSQL/PostGIS, Stripe Connect, Mapbox, and Resend.

Status: Active V1 development. The repository currently represents a test-mode, pre-production system. Features on main are not automatically equivalent to production deployment or live-money readiness.

Product · Architecture · Data Model · Engineering · Setup · Testing · Roadmap

Product

Wheretoo is built around one connected event lifecycle:

Discover → Choose an event → Get a ticket → Attend

For organizers:

Create event → Configure tickets → Publish → Sell / RSVP → Manage attendees → Check in guests

The initial product is focused on the San Francisco Bay Area and a web-first experience.

What Wheretoo supports

Experience

Capabilities

Attendees

Public event discovery, event pages, ticket selection, hosted checkout, free RSVP, QR tickets, ticket recovery, refund status, and event updates.

Organizers

Authentication, organizer setup, Stripe onboarding, event creation, ticket tiers, event media, attendee management, order lookup, refunds, QR scanning, manual check-in, and settings.

Operations

Moderation workflows, reporting, transaction records, testing infrastructure, and release verification.

V1 principle

If it doesn’t help someone find somewhere to go, help an organizer put something on, or complete the transaction — it isn’t V1.

Architecture

Wheretoo uses a modular frontend backed by Supabase, PostgreSQL, and server-side Edge Functions.

flowchart LR
    USER[Buyer / Organizer]

    subgraph FRONTEND[Frontend]
        REACT[React + TypeScript]
        ROUTER[React Router]
        QUERY[TanStack Query]
    end

    subgraph SUPABASE[Supabase]
        AUTH[Auth]
        EDGE[Edge Functions]
        DB[(PostgreSQL / PostGIS)]
        STORAGE[Storage]
    end

    subgraph EXTERNAL[External Services]
        STRIPE[Stripe + Connect]
        MAPBOX[Mapbox]
        RESEND[Resend]
    end

    USER --> REACT
    REACT --> ROUTER
    REACT --> QUERY
    QUERY --> AUTH
    QUERY --> EDGE
    QUERY --> DB
    EDGE --> DB
    EDGE --> STORAGE
    EDGE --> STRIPE
    EDGE --> RESEND
    REACT --> MAPBOX

The main architectural idea is simple:

the browser handles interaction, while trusted transaction and admission state is decided by the backend and database.

Technology stack

Layer

Technology

Responsibility

Frontend

React, TypeScript, Vite

Buyer and organizer interfaces

Routing

React Router

Public, organizer, and staff application routes

Server state

TanStack Query

API state, caching, and request lifecycle

Forms / validation

React Hook Form, Zod

Input management and runtime validation

Authentication

Supabase Auth

Organizer identity and sessions

Database

PostgreSQL + PostGIS

Events, tickets, orders, inventory, geographic data

Server logic

Supabase Edge Functions / Deno

Payments, tickets, integrations, privileged workflows

Payments

Stripe Checkout + Stripe Connect

Payment collection and organizer payment onboarding

Media

Supabase Storage

Event artwork and media

Location

Mapbox

Event location search and future map discovery

Email

Resend

Transactional communication infrastructure

Testing

Vitest, Playwright, Deno, SQL harnesses

Unit, integration, browser, and backend verification

Hosting

Vercel + Supabase

Frontend and backend infrastructure

Frontend Architecture

The frontend is organized around product domains, rather than one large application layer.

src/
├── app/
├── components/
├── config/
├── features/
│   ├── auth/
│   ├── checkout/
│   ├── discovery/
│   ├── event-changes/
│   ├── events/
│   ├── moderation/
│   ├── orders/
│   ├── organizer-onboarding/
│   ├── organizer-operations/
│   ├── organizer-settings/
│   ├── payments/
│   ├── refunds/
│   ├── rsvp/
│   ├── ticket-delivery/
│   └── tickets/
├── lib/
├── preview/
└── styles/

Each feature owns its UI and domain-facing behavior, while shared application infrastructure handles routing, providers, configuration, and reusable components.

This keeps business logic separated from presentation and makes individual workflows easier to test and change independently.

Data Model

Paid ticketing separates the transaction itself from the individual admissions created by that transaction.

erDiagram
    ORGANIZERS ||--o{ EVENTS : owns
    EVENTS ||--o{ TICKET_TIERS : offers
    EVENTS ||--o{ ORDERS : receives
    ORDERS ||--|{ ORDER_ITEMS : contains
    TICKET_TIERS ||--o{ ORDER_ITEMS : references
    ORDER_ITEMS ||--o{ TICKETS : fulfills
    ORDERS ||--o{ REFUNDS : records

Core entities

Entity

Purpose

Organizer

Owns and operates events

Event

Public event details, location, schedule, and status

Ticket tier

Ticket type, price, and inventory rules

Order

Checkout-level transaction record

Order item

Snapshot of each purchased tier

Ticket

Individual admission credential

Refund

Financial refund lifecycle

Registration

Free RSVP / attendance record

For example:

Order
├── 2 × General Admission
└── 1 × VIP

→ 3 individual tickets

This allows Wheretoo to reason about transactions, inventory, and admissions independently.

Ticketing and Checkout

Wheretoo uses Stripe-hosted Checkout while keeping order and ticket state inside its own backend.

sequenceDiagram
    actor Buyer
    participant App as Wheretoo
    participant API as Wheretoo Backend
    participant DB as PostgreSQL
    participant Stripe

    Buyer->>App: Select tickets
    App->>API: Start checkout
    API->>DB: Validate and reserve inventory
    API->>Stripe: Create checkout session
    Stripe-->>App: Hosted checkout
    Buyer->>Stripe: Pay
    Stripe-->>API: Payment event
    API->>DB: Confirm transaction
    API->>DB: Issue tickets
    App->>API: Load confirmation
    API-->>App: Order + ticket state

Key principles

payment success is determined server-side

ticket inventory is enforced by backend/database logic

retries should not create duplicate orders or tickets

money is represented in integer minor units

ticket fulfillment happens only after verified payment state

refunds preserve financial and admission history

one purchased admission creates one ticket

Stripe Connect provides the foundation for organizer payment onboarding and connected-account transactions.

Tickets and Admission

A ticket is treated as a durable admission record.

The buyer experience includes:

Confirmation → Ticket collection → Individual ticket → QR credential → Organizer check-in

Admission supports:

successful first check-in

duplicate-scan protection

invalid ticket rejection

refunded / cancelled ticket invalidation

organizer event ownership checks

preservation of previous check-in history

Manual attendee lookup and QR scanning use the same underlying admission rules.

Free RSVP uses a separate registration flow but shares the broader admission system.

Discovery

Wheretoo currently includes a public event discovery experience and event detail handoff.

Discovery is designed to evolve into a richer map-based experience without creating a second source of event or ticket truth.

Public event data → Discovery → Event page → Ticket / RSVP flow

Future map discovery will consume the same canonical event data. Mapbox is already used for location search during event creation.

Organizer Platform

Organizer lifecycle

Create account
      ↓
Organizer setup
      ↓
Payment onboarding
      ↓
Create event
      ↓
Configure tickets
      ↓
Preview + publish
      ↓
Manage attendees
      ↓
Check in guests

Organizer capabilities include event creation and editing, ticket-tier configuration, Stripe onboarding, event artwork, dashboard metrics, order and attendee lookup, QR scanning, manual check-in, refunds, event updates, cancellation, and settings.

Engineering Principles

1. The database owns transaction truth

Critical ticketing state is not inferred from UI state.

2. Payments are asynchronous systems

Provider events and durable records determine final state.

3. Ticket issuance must be idempotent

Retries and duplicate provider messages cannot create duplicate admissions.

4. Authorization is enforced beyond the interface

Frontend route protection improves UX, while sensitive operations still require backend authorization.

5. Financial history is preserved

Refunds and failures transition state rather than deleting transaction history.

6. Features are separated by domain

Discovery, checkout, ticketing, organizer operations, refunds, and authentication remain distinct modules with shared contracts.

7. AI-assisted development still requires evidence

Wheretoo uses AI-assisted development heavily, but changes are backed by specifications, tests, implementation plans, and verification.

Testing

Ticketing systems fail at boundaries, so Wheretoo tests across several layers.

Layer

Purpose

Unit tests

Components, schemas, utilities, domain behavior

Integration tests

Feature and API contracts

Edge Function tests

Server handlers and integration behavior

Database tests

Constraints, inventory, authorization, ticket state

Concurrency tests

Competing transactions and one-time admission

Browser tests

Real route composition and user journeys

Stripe test-mode proofs

Payment and fulfillment behavior

Common commands

pnpm typecheck
pnpm lint
pnpm test
pnpm typecheck:functions
pnpm test:functions
pnpm build

The repository also contains targeted integration and Playwright suites for ticketing, checkout, moderation, organizer operations, and admission.

Repository Structure

.
├── src/
│   ├── app/              # Application composition and routing
│   ├── components/       # Shared UI
│   ├── features/         # Product-domain modules
│   ├── lib/              # Shared utilities and integrations
│   ├── preview/          # Development previews
│   └── styles/
├── supabase/
│   ├── functions/        # Server-side Edge Functions
│   ├── migrations/       # Versioned database migrations
│   ├── tests/            # Database verification
│   └── config.toml
├── tests/
│   ├── integration/
│   └── e2e/
├── scripts/
├── Docs/
├── package.json
├── deno.json
└── vite.config.ts

Local Development

Requirements

Node.js

pnpm

Docker

Supabase CLI

Git

Install

git clone https://github.com/ElijahJBurgess/Wheretoo.git
cd Wheretoo
pnpm install --frozen-lockfile
cp .env.example .env.local

Start local Supabase:

pnpm exec supabase start

Start the frontend:

pnpm dev

The development application runs on http://127.0.0.1:3000.

Required provider credentials and environment configuration are documented through the repository's example environment files.

Never commit real secrets or production credentials.

Deployment

The frontend is designed for Vercel while backend infrastructure runs through Supabase.

GitHub → Vercel → React application

Supabase
├── PostgreSQL
├── Auth
├── Storage
└── Edge Functions

Database schema changes are migration-driven and committed to source control.

Frontend deployment, database migration, backend function deployment, and provider configuration are treated as separate release concerns.

Architectural Tradeoffs

Decision

Benefit

PostgreSQL as transaction authority

Strong relational consistency for orders, inventory, refunds, and tickets

Hosted Stripe Checkout

Keeps payment collection inside Stripe while Wheretoo owns the surrounding experience

Supabase backend

Fast V1 development while retaining PostgreSQL, SQL migrations, Auth, Storage, and server functions

Domain-based frontend

Keeps product areas isolated and easier to test

Accountless buyer tickets

Reduces friction for event attendees

Shared paid/free admission infrastructure

Keeps door operations consistent across ticket types

Separate map/discovery track

Allows discovery UX to evolve without destabilizing ticketing

The architecture is built to support growth, but no fixed scale or throughput claim is made without representative load testing.

Product Direction

Wheretoo is designed around two connected sides of the event market:

DISCOVERY
People need somewhere to go

        ↓

TRANSACTION
Tickets / RSVP

        ↓

OPERATIONS
Organizers need to run the event

The long-term discovery direction is a more visual, location-driven way to understand what is happening around a city.

The business model centers on ticket transactions and organizer relationships rather than charging consumers to browse.

A proposed go-to-market strategy also uses organizer-focused media and content to build relationships with local event creators while creating awareness around events on the platform.

Development Approach

Wheretoo is a 0 → 1 product-led, AI-assisted build created by Elijah Burgess.

The project combines:

product strategy

user journey design

positioning and monetization

system architecture

database design

API contracts

transaction modeling

testing strategy

AI-assisted implementation

Detailed specifications, implementation plans, runbooks, and historical verification reports live under Docs/.

They are intentionally more detailed than this public-facing README.

License

The package currently declares the ISC License.

Wheretoo connects discovery to verified admission — from finding the event to getting through the door.
