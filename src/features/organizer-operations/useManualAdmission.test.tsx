import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  redeemTicket: vi.fn(),
  getOrderDetails: vi.fn(),
  getFreeRegistration: vi.fn(),
  getOwnedEvent: vi.fn(),
}))
vi.mock('./operations.api', () => ({ redeemTicket: api.redeemTicket, getOrderDetails: api.getOrderDetails }))
vi.mock('./freeOperations.api', () => ({ getFreeRegistration: api.getFreeRegistration }))
vi.mock('../events/event.api', () => ({ getOwnedEvent: api.getOwnedEvent }))
vi.mock('./operations.queries', () => ({ operationsKeys: { event: (ownerId: string, eventId: string) => ['organizer-operations', ownerId, eventId] } }))

import { useManualAdmission } from './useManualAdmission'

const selection = {
  sourceKind: 'free_registration' as const,
  sourceId: 'a6300000-0000-4000-8000-000000000001',
  eventId: 'a6200000-0000-4000-8000-000000000001',
  ticketId: 'a6400000-0000-4000-8000-000000000002',
}

function setup(identityVersion = 4, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, ...renderHook(() => useManualAdmission('owner', identityVersion, selection), { wrapper }) }
}

beforeEach(() => vi.resetAllMocks())

it('rechecks an uncertain free ticket through fresh registration and owned-event reads', async () => {
  api.redeemTicket.mockRejectedValue(new Error('lost response'))
  api.getFreeRegistration.mockResolvedValue({
    registrationId: selection.sourceId,
    eventId: selection.eventId,
    registrantName: 'Alex Chen',
    status: 'confirmed',
    tickets: [{ ticketId: selection.ticketId, position: 2, admissionLabel: 'General Admission', status: 'used', usedAt: '2026-09-14T13:00:00Z' }],
  })
  api.getOwnedEvent.mockResolvedValue({
    id: selection.eventId, organizer_id: 'owner', admission_type: 'free', status: 'published',
    starts_at: '2026-09-14T12:00:00Z', ends_at: '2126-09-14T15:00:00Z',
  })
  const { result } = setup()
  act(() => result.current.submit())
  await waitFor(() => expect(result.current.phase).toBe('uncertain'))
  act(() => result.current.recheck())
  await waitFor(() => expect(result.current.result).toMatchObject({ outcome: 'already_used', usedAt: '2026-09-14T13:00:00Z' }))
  expect(api.getFreeRegistration).toHaveBeenCalledWith(selection.eventId, selection.sourceId, expect.any(AbortSignal))
  expect(api.getOwnedEvent).toHaveBeenCalledWith(selection.eventId, 'owner')
  expect(api.getOrderDetails).not.toHaveBeenCalled()
  expect(api.redeemTicket).toHaveBeenCalledTimes(1)
})

it('scopes unresolved state by source, ticket, and identity generation', async () => {
  api.redeemTicket.mockRejectedValue(new Error('lost response'))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const first = setup(4, client)
  act(() => first.result.current.submit())
  await waitFor(() => expect(first.result.current.phase).toBe('uncertain'))
  first.unmount()

  const nextGeneration = setup(5, client)
  expect(nextGeneration.result.current.phase).toBe('confirm')
  nextGeneration.unmount()

  const sameGeneration = setup(4, client)
  expect(sameGeneration.result.current.phase).toBe('uncertain')
})

it('invalidates only the selected event operations after the existing writer resolves', async () => {
  api.redeemTicket.mockResolvedValue({ outcome: 'admitted', buyerName: 'Alex Chen', admissionLabel: 'General Admission', usedAt: '2026-09-14T13:00:00Z' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const sameEventKey = ['organizer-operations', 'owner', selection.eventId, 'source', 'free_registration', 4, 'metrics']
  const otherEventKey = ['organizer-operations', 'owner', 'a6200000-0000-4000-8000-000000000009', 'source', 'free_registration', 4, 'metrics']
  client.setQueryData(sameEventKey, { checkedIn: 0 })
  client.setQueryData(otherEventKey, { checkedIn: 0 })
  const { result } = setup(4, client)
  act(() => result.current.submit())
  await waitFor(() => expect(result.current.result?.outcome).toBe('admitted'))
  expect(client.getQueryState(sameEventKey)?.isInvalidated).toBe(true)
  expect(client.getQueryState(otherEventKey)?.isInvalidated).toBe(false)
})
