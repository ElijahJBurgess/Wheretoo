import type { EventRow } from '../features/events/event.types'
import type { Organizer } from '../features/organizers/organizer.api'
import type { CanonicalPublicTicketingEvent, TicketTierRow } from '../features/tickets/ticket.types'
import type { OrderConfirmation } from '../features/orders/order.types'

// Local display fixtures only. These IDs and credentials are never sent to an API.
export const eventId = '28000000-0000-4000-8000-000000000006'
export const organizerId = '18000000-0000-4000-8000-000000000005'
export const organizer: Organizer = {
  id: organizerId, display_name: 'Good Company', organizer_type: 'Community group',
  bio: 'Bringing neighbors together.', website_url: null, base_city: 'Oakland', country_code: 'US',
  onboarding_completed_at: null, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
}
export const event: EventRow = {
  id: eventId, organizer_id: organizerId, status: 'draft', moderation_status: 'clear',
  content_revision: 1, moderated_revision: 1, moderation_version: 1, moderation_updated_at: null,
  public_history_status: 'never_public', first_publicly_eligible_at: null, public_eligibility_version: 0,
  publicly_authorized_revision: null, publicly_authorized_action_id: null,
  title: 'Sunset Rooftop Sessions', description: 'Afro house, open-air views, skyline nights.',
  category: 'music', starts_at: '2026-09-20T02:00:00Z', ends_at: '2026-09-20T05:00:00Z',
  timezone: 'America/Los_Angeles', venue_name: 'Lakeview Rooftop', address_line1: '123 Lakeview Avenue',
  address_line2: null, city: 'Oakland', region: 'CA', postal_code: '94612', country_code: 'US',
  mapbox_feature_id: 'preview.address', latitude: 37.8, longitude: -122.26, location: 'preview only',
  admission_type: 'paid', capacity: 100, artwork_path: null, animation_preset: 'generic', published_at: null,
  created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
}
export const tier: TicketTierRow = {
  id: '900a9142-9111-4f87-84d5-b8545a94c7fb', event_id: eventId, name: 'General Admission',
  description: 'Access to event', unit_amount_minor: 2500, currency: 'usd', quantity_total: 100,
  sort_order: 1, status: 'draft', version: 1, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
}
export const publicEvent = {
  event: { ...event, title: event.title!, description: event.description!, category: 'music',
    starts_at: event.starts_at!, ends_at: event.ends_at!, address_line1: event.address_line1!,
    city: event.city!, region: 'CA', postal_code: event.postal_code!, country_code: 'US',
    latitude: event.latitude!, longitude: event.longitude!, admission_type: 'paid',
    minimum_age: 'all_ages', advisories: [], organizer: { id: organizerId, display_name: organizer.display_name } },
  tiers: [{ ...tier, currency: 'usd', availability_status: 'available' }],
} satisfies CanonicalPublicTicketingEvent
export const confirmation: OrderConfirmation = {
  status: 'paid', orderNumber: 'PREVIEW-0001',
  items: [{ tierName: tier.name, quantity: 1, unitAmountMinor: 2500, subtotalMinor: 2500, currency: 'usd' }],
  quantity: 1, currency: 'usd', subtotalMinor: 2500, taxAmountMinor: 0, totalMinor: 2500,
  event: { title: event.title!, startsAt: event.starts_at!, endsAt: event.ends_at!, timezone: event.timezone, venueName: event.venue_name },
}
export const requirements = {
  minimumAge: 'all_ages', alcoholPresent: false, cannabisPresent: false, explicitAdultContent: false,
  gamblingPresent: false, weaponsPresent: false, highRiskActivity: false, needsAcceptance: false,
  organizerTerms: { policyKind: 'organizer_terms', label: 'Organizer Terms', versionId: 'dev-organizer-terms-v1', stage: 'development_placeholder', publicUrl: '/organizer-terms' },
  eventPolicy: { policyKind: 'event_policy', label: 'Event Policy', versionId: 'dev-event-policy-v1', stage: 'development_placeholder', publicUrl: '/event-policy' },
}
export const moderationCase = {
  eventId, organizerId, moderationStatus: 'under_review', contentRevision: 1, inputSha256: 'a'.repeat(64), moderationVersion: 1,
  publicHistoryStatus: 'never_public', firstPubliclyEligibleAt: null, currentOpenReviewRequest: true, currentReportCount: 2,
  title: event.title, description: event.description, category: 'music', startsAt: event.starts_at, endsAt: event.ends_at, timezone: event.timezone,
  venueName: event.venue_name, addressLine1: event.address_line1, addressLine2: null, city: event.city, region: 'CA', postalCode: event.postal_code, countryCode: 'US',
  mapboxFeatureId: 'preview.address', latitude: 37.8, longitude: -122.26,
  disclosures: requirements, legacyResolution: {}, actions: [], evaluations: [],
  queuedEvaluationCount: 1, oldestQueuedAt: '2026-09-01T12:00:00Z',
}
