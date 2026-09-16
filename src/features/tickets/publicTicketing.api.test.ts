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
    minimum_age: 'all_ages',
    advisories: ['alcohol'],
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
const freeProjection = {
  ...projection.event,
  admission_type: 'free',
}

describe('public ticketing API', () => {
  beforeEach(() => rpc.mockClear())

  it.each([null, {}, 'bad'])('does not turn a malformed public projection into absence or issue a fallback read: %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(getPublicEventTicketing(eventId)).rejects.toThrow()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('rejects a malformed free-event fallback instead of displaying not-found', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: null })
    await expect(getPublicEventTicketing(eventId)).rejects.toThrow()
  })

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
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })

    await expect(getPublicEventTicketing(eventId)).resolves.toBeNull()
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_public_event_ticketing', { p_event_id: eventId })
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_public_event', { p_event_id: eventId })
  })

  it('falls back to the canonical public event for a free event without inventing ticket tiers', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [freeProjection], error: null })

    await expect(getPublicEventTicketing(eventId)).resolves.toEqual({
      event: freeProjection,
      tiers: [],
    })
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_public_event_ticketing', { p_event_id: eventId })
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_public_event', { p_event_id: eventId })
  })

  it('preserves paid projection precedence without calling the fallback RPC', async () => {
    rpc.mockResolvedValue({ data: [projection], error: null })

    await expect(getPublicEventTicketing(eventId)).resolves.toEqual(projection)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('accepts the existing RPC free-event shell with exactly zero paid tiers', async () => {
    rpc.mockResolvedValue({ data: [{ event: freeProjection, tiers: [] }], error: null })
    await expect(getPublicEventTicketing(eventId)).resolves.toEqual({ event: freeProjection, tiers: [] })
    expect(rpc).toHaveBeenCalledTimes(1)
    rpc.mockResolvedValue({ data: [{ event: freeProjection, tiers: projection.tiers }], error: null })
    await expect(getPublicEventTicketing(eventId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('does not hide a paid-projection error behind a free-event fallback', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Failed to fetch' },
      status: 503,
    })

    await expect(getPublicEventTicketing(eventId)).rejects.toMatchObject({ code: 'RETRYABLE' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('uses canonical fallback error precedence after an authoritative paid absence', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'private database detail' },
        status: 500,
      })

    await expect(getPublicEventTicketing(eventId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('does not cache or expose a malformed server projection', async () => {
    rpc.mockResolvedValue({ data: [{ ...projection, tiers: [{ ...projection.tiers[0], currency: 'cad' }] }], error: null })

    await expect(getPublicEventTicketing(eventId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Public event details are unavailable',
    })
  })

  it('requires the complete canonical safe-event projection', async () => {
    const eventWithoutMinimumAge = { ...projection.event }
    Reflect.deleteProperty(eventWithoutMinimumAge, 'minimum_age')
    rpc.mockResolvedValue({
      data: [{ ...projection, event: eventWithoutMinimumAge }],
      error: null,
    })

    await expect(getPublicEventTicketing(eventId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Public event details are unavailable',
    })
  })

  it('rejects moderation fields instead of exposing them through the public projection', async () => {
    rpc.mockResolvedValue({
      data: [{
        ...projection,
        event: { ...projection.event, moderation_status: 'clear', moderation_version: 4 },
      }],
      error: null,
    })

    await expect(getPublicEventTicketing(eventId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Public event details are unavailable',
    })
  })

  it.each([0, 408, 425, 429, 502, 503, 504])('maps retryable status %s to bounded public copy', async (status) => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Failed to fetch' },
      status,
    })

    await expect(getPublicEventTicketing(eventId)).rejects.toMatchObject({
      code: 'RETRYABLE',
      message: 'Public event details are unavailable',
    })
  })

  it.each([
    [403, '42501'],
    [404, 'PGRST202'],
    [500, 'XX000'],
  ])('fails closed for non-network RPC errors (status %s)', async (status, code) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code, message: 'private database detail' },
      status,
    })

    await expect(getPublicEventTicketing(eventId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Public event details are unavailable',
    })
  })
})
