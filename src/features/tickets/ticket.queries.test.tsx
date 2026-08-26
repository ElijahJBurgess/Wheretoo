import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { activatePaidSales, listOwnedTicketTiers, saveTicketTiers } = vi.hoisted(() => ({
  activatePaidSales: vi.fn(), listOwnedTicketTiers: vi.fn(), saveTicketTiers: vi.fn(),
}))
vi.mock('./ticket.api', () => ({ activatePaidSales, listOwnedTicketTiers, saveTicketTiers }))
import { ticketKeys, useActivatePaidSales, useOwnedTicketTiers, useSaveTicketTiers } from './ticket.queries'

const event = { id: 'event-1', organizer_id: 'organizer-1', status: 'published', published_at: '2026-08-25T12:00:00.000Z' }
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('ticket query contracts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses a two-identity owned key and does not load tiers without both IDs', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useOwnedTicketTiers('', 'event-1'), { wrapper: wrapper(client) })
    expect(ticketKeys.owned('organizer-1', 'event-1')).toEqual(['tickets', 'owned', 'organizer-1', 'event-1'])
    expect(result.current.fetchStatus).toBe('idle')
    expect(listOwnedTicketTiers).not.toHaveBeenCalled()
  })

  it('invalidates only the initiating organizer and exact event contracts after activation', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(ticketKeys.owned('organizer-2', 'event-1'), 'other organizer tiers')
    activatePaidSales.mockResolvedValue(event)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useActivatePaidSales('organizer-1'), { wrapper: wrapper(client) })
    await act(async () => { await result.current.mutateAsync('event-1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ticketKeys.owned('organizer-1', 'event-1'), exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ticketKeys.public('event-1'), exact: true })
    expect(client.getQueryData(ticketKeys.owned('organizer-2', 'event-1'))).toBe('other organizer tiers')
  })

  it('does not seed or invalidate data when activation returns a different owner', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    activatePaidSales.mockResolvedValue({ ...event, organizer_id: 'organizer-2' })
    const { result } = renderHook(() => useActivatePaidSales('organizer-1'), { wrapper: wrapper(client) })
    await expect(result.current.mutateAsync('event-1')).rejects.toThrow('Organizer identity changed')
    expect(client.getQueryData(ticketKeys.owned('organizer-2', 'event-1'))).toBeUndefined()
  })

  it('invalidates only this event public projection after tiers are saved', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    saveTicketTiers.mockResolvedValue([{ id: 'tier-1', event_id: 'event-1' }])
    const { result } = renderHook(() => useSaveTicketTiers('organizer-1', 'event-1'), { wrapper: wrapper(client) })

    await act(async () => {
      await result.current.mutateAsync([{ name: 'General', description: null, unitAmountMinor: 2_500, currency: 'usd', quantityTotal: 80, sortOrder: 1 }])
    })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ticketKeys.public('event-1'), exact: true })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ticketKeys.public('event-2'), exact: true })
  })
})
