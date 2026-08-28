import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicTicketingEvent } from './ticket.types'
import { PublicTicketingError } from './publicTicketing.errors'

const { getPublicEventTicketing } = vi.hoisted(() => ({ getPublicEventTicketing: vi.fn() }))
vi.mock('./publicTicketing.api', () => ({ getPublicEventTicketing }))
vi.mock('./ticket.queries', () => ({
  ticketKeys: {
    public: (eventId: string) => ['tickets', 'public', eventId] as const,
  },
}))

import { usePublicTicketingEvent } from './publicTicketing.queries'
import { ticketKeys } from './ticket.queries'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const publicEvent: PublicTicketingEvent = {
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
    advisories: [],
    organizer: {
      id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe',
      display_name: 'Bay City Arts',
    },
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

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('public ticketing query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onlineManager.setOnline(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    onlineManager.setOnline(true)
    vi.restoreAllMocks()
  })

  it('uses an identity-free stable public key and requests only the event projection', async () => {
    getPublicEventTicketing.mockResolvedValue(null)
    const { result } = renderHook(() => usePublicTicketingEvent(eventId), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ticketKeys.public(eventId)).toEqual([
      'tickets', 'public', eventId,
    ])
    expect(getPublicEventTicketing).toHaveBeenCalledWith('eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')
  })

  it('normalizes an equivalent route UUID before creating its public cache identity', async () => {
    getPublicEventTicketing.mockResolvedValue(null)
    const { result } = renderHook(
      () => usePublicTicketingEvent('EB0FD9D5-D7D5-45DD-A99F-0C8A191BDC6F'),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(getPublicEventTicketing).toHaveBeenCalledWith('eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')
  })

  it('refreshes a visible mounted event every 15 seconds without writing browser storage', async () => {
    vi.useFakeTimers()
    const localWrite = vi.spyOn(Storage.prototype, 'setItem')
    getPublicEventTicketing.mockResolvedValue(publicEvent)
    renderHook(() => usePublicTicketingEvent(eventId), { wrapper: wrapper() })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(getPublicEventTicketing).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(getPublicEventTicketing).toHaveBeenCalledTimes(2)
    expect(localWrite).not.toHaveBeenCalled()
  })

  it('pauses interval refresh while hidden and refetches when focus returns', async () => {
    vi.useFakeTimers()
    let visibilityState: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState)
    getPublicEventTicketing.mockResolvedValue(publicEvent)
    renderHook(() => usePublicTicketingEvent(eventId), { wrapper: wrapper() })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    visibilityState = 'hidden'
    window.dispatchEvent(new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(getPublicEventTicketing).toHaveBeenCalledTimes(1)

    visibilityState = 'visible'
    window.dispatchEvent(new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(getPublicEventTicketing).toHaveBeenCalledTimes(2)
  })

  it('refetches the current public projection when connectivity returns', async () => {
    getPublicEventTicketing.mockResolvedValue(publicEvent)
    const { result } = renderHook(() => usePublicTicketingEvent(eventId), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
    await waitFor(() => expect(getPublicEventTicketing).toHaveBeenCalledTimes(2))
  })

  it('replaces a previously public cache entry with null after an authoritative absence', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(ticketKeys.public(eventId), publicEvent)
    getPublicEventTicketing.mockResolvedValue(null)
    const { result } = renderHook(() => usePublicTicketingEvent(eventId), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.data).toBeNull())
    expect(client.getQueryData(ticketKeys.public(eventId))).toBeNull()
  })

  it('retains last-known content only when a retryable refresh fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(ticketKeys.public(eventId), publicEvent)
    getPublicEventTicketing.mockRejectedValue(new PublicTicketingError('RETRYABLE'))
    const { result } = renderHook(() => usePublicTicketingEvent(eventId), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toEqual(publicEvent)
  })

  it('fails an invalid projection immediately without query retries', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 0 } },
    })
    getPublicEventTicketing.mockRejectedValue(new PublicTicketingError('INVALID_RESPONSE'))
    const { result } = renderHook(() => usePublicTicketingEvent(eventId), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(getPublicEventTicketing).toHaveBeenCalledTimes(1)
  })
})
