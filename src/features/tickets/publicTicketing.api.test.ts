import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createClient, rpc } = vi.hoisted(() => {
  const rpc = vi.fn()
  return { createClient: vi.fn(() => ({ rpc })), rpc }
})

vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('../../lib/env', () => ({
  publicEnv: {
    supabaseUrl: 'https://whereto.example.supabase.co',
    supabasePublishableKey: 'public-anon-key',
    mapboxAccessToken: 'pk.mapbox',
    stripePublishableKey: 'pk_test_public',
  },
}))

import { getPublicEventTicketing } from './publicTicketing.api'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const projection = {
  event: {
    id: eventId,
    title: 'Night Market',
    description: 'Food, music, and neighborhood makers.',
    category: 'community',
    starts_at: '2026-09-01T02:00:00+00:00',
    ends_at: '2026-09-01T05:00:00+00:00',
    timezone: 'America/Los_Angeles',
    venue_name: 'Civic Center Plaza',
    address_line1: '1 Dr Carlton B Goodlett Place',
    address_line2: null,
    city: 'San Francisco',
    region: 'CA',
    postal_code: '94102',
    country_code: 'US',
    latitude: 37.7793,
    longitude: -122.4193,
    artwork_path: null,
    animation_preset: 'generic',
    admission_type: 'paid',
    organizer: { id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', display_name: 'Bay City Arts' },
  },
  tiers: [{
    id: '900a9142-9111-4f87-84d5-b8545a94c7fb',
    name: 'General admission',
    description: 'Entry to the market.',
    unit_amount_minor: 2_500,
    currency: 'usd',
    availability_status: 'available',
  }],
}

describe('public ticketing API', () => {
  beforeEach(() => rpc.mockClear())

  it('uses an isolated nonpersistent anonymous auth client to avoid sharing GoTrue storage', () => {
    expect(createClient).toHaveBeenCalledWith(
      'https://whereto.example.supabase.co',
      'public-anon-key',
      {
        auth: {
          storageKey: 'whereto-public-ticketing-anon',
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    )
  })

  it('reads the one public projection through only the anonymous ticketing RPC', async () => {
    rpc.mockResolvedValue({ data: [projection], error: null })

    await expect(getPublicEventTicketing(eventId)).resolves.toEqual(projection)
    expect(rpc).toHaveBeenCalledWith('get_public_event_ticketing', { p_event_id: eventId })
  })

  it('turns an absent public row into the same safe not-found result', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await expect(getPublicEventTicketing(eventId)).resolves.toBeNull()
  })

  it('does not cache or expose a malformed server projection', async () => {
    rpc.mockResolvedValue({ data: [{ ...projection, tiers: [{ ...projection.tiers[0], currency: 'cad' }] }], error: null })

    await expect(getPublicEventTicketing(eventId)).rejects.toThrow('Public event details are unavailable')
  })
})
