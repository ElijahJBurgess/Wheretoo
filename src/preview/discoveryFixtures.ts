import type { DiscoveryDisplayItem } from '../features/discovery/discovery.types'
import rooftopReference from './assets/rooftop-reference.png'

const admission = { state: 'unknown', minimumBuyerAmountMinor: null, currency: null } as const

export const discoveryPreviewClock = new Date('2026-09-13T17:00:00Z')

export const discoveryPreviewItems: readonly DiscoveryDisplayItem[] = [
  {
    id: '00000000-0000-4000-8000-000000000101', title: 'Sunset Rooftop Sessions', category: 'music', admissionType: 'paid',
    startsAt: '2026-09-13T23:00:00Z', endsAt: '2026-09-14T03:00:00Z', timezone: 'America/Los_Angeles',
    venueName: 'The Courtyard', city: 'Oakland', artworkReference: rooftopReference,
    admission: { state: 'open', minimumBuyerAmountMinor: 1500, currency: 'usd' },
  },
  {
    id: '00000000-0000-4000-8000-000000000102', title: 'Taco Social', category: 'food_drink', admissionType: 'free',
    startsAt: '2026-09-14T00:00:00Z', endsAt: '2026-09-14T05:00:00Z', timezone: 'America/Los_Angeles',
    venueName: 'Temescal Brewing', city: 'Oakland', artworkReference: rooftopReference, admission,
  },
  {
    id: '00000000-0000-4000-8000-000000000103', title: 'Night Garden', category: 'art_culture', admissionType: 'free',
    startsAt: '2026-09-14T02:30:00Z', endsAt: '2026-09-14T05:30:00Z', timezone: 'America/Los_Angeles',
    venueName: 'Minnesota Street Project', city: 'San Francisco', artworkReference: null,
    admission: { state: 'open', minimumBuyerAmountMinor: null, currency: null },
  },
  {
    id: '00000000-0000-4000-8000-000000000104', title: 'Lake Merritt Morning Miles', category: 'fitness', admissionType: 'free',
    startsAt: '2026-09-19T16:00:00Z', endsAt: '2026-09-19T18:00:00Z', timezone: 'America/Los_Angeles',
    venueName: 'Pergola at Lake Merritt', city: 'Oakland', artworkReference: null, admission,
  },
  {
    id: '00000000-0000-4000-8000-000000000105', title: 'A Community Supper for Neighbors, Newcomers, Night Owls, and Anyone Who Needs a Seat', category: 'community', admissionType: 'paid',
    startsAt: '2026-09-20T01:00:00Z', endsAt: '2026-09-20T04:00:00Z', timezone: 'America/Los_Angeles',
    venueName: null, city: 'Berkeley', artworkReference: null,
    admission: { state: 'sales_closed', minimumBuyerAmountMinor: null, currency: null },
  },
]
