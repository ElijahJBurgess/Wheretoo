import { describe, expect, it } from 'vitest'
import type { DiscoveryDisplayItem } from './discovery.types'
import {
  categoryLabel,
  discoveryAdmissionLabel,
  selectDiscoveryHighlight,
} from './discovery.presentation'

const item = (overrides: Partial<DiscoveryDisplayItem> = {}): DiscoveryDisplayItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Sunset Rooftop Sessions',
  category: 'music',
  admissionType: 'paid',
  startsAt: '2026-09-13T23:00:00Z',
  endsAt: '2026-09-14T03:00:00Z',
  timezone: 'America/Los_Angeles',
  venueName: 'The Courtyard',
  city: 'Oakland',
  artworkReference: null,
  admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null },
  ...overrides,
})

describe('discovery presentation', () => {
  it('labels every canonical category and preserves honest unknown prices', () => {
    expect(([
      'food_drink', 'music', 'fitness', 'art_culture', 'shopping', 'community', 'nightlife', 'other',
    ] as const).map(categoryLabel)).toEqual([
      'Food & Drink', 'Music', 'Fitness', 'Art & Culture', 'Shopping', 'Community', 'Nightlife', 'Other',
    ])
    expect(discoveryAdmissionLabel(item())).toBe('View prices')
    expect(discoveryAdmissionLabel(item({ admissionType: 'free' }))).toBe('Free')
  })

  it('formats only supported USD open prices and maps known availability states', () => {
    expect(discoveryAdmissionLabel(item({ admission: { state: 'open', minimumBuyerAmountMinor: 1500, currency: 'usd' } }))).toBe('From $15.00')
    expect(discoveryAdmissionLabel(item({ admissionType: 'free', admission: { state: 'open', minimumBuyerAmountMinor: null, currency: null } }))).toBe('Free RSVP')
    expect(discoveryAdmissionLabel(item({ admission: { state: 'full', minimumBuyerAmountMinor: null, currency: null } }))).toBe('Full')
    expect(discoveryAdmissionLabel(item({ admission: { state: 'sales_closed', minimumBuyerAmountMinor: null, currency: null } }))).toBe('Sales closed')
    expect(discoveryAdmissionLabel(item({ admission: { state: 'not_yet_on_sale', minimumBuyerAmountMinor: null, currency: null } }))).toBe('Not yet on sale')
  })

  it('selects the earliest open item with artwork and never promotes unknown availability', () => {
    const unknownArtwork = item({ artworkReference: '/unknown.jpg' })
    const openArtwork = item({
      id: '00000000-0000-4000-8000-000000000002',
      artworkReference: '/open.jpg',
      admission: { state: 'open', minimumBuyerAmountMinor: 1500, currency: 'usd' },
    })
    expect(selectDiscoveryHighlight([unknownArtwork, openArtwork])).toBe(openArtwork)
    expect(selectDiscoveryHighlight([item(), unknownArtwork])).toBeNull()
  })
})
