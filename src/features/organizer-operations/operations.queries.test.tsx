import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ getEventMetrics: vi.fn(), getFreeRegistrationMetrics: vi.fn(), getOrder: vi.fn(), getOrderDetails: vi.fn(), listEventOrders: vi.fn(), listEventAdmissions: vi.fn(), listFreeAdmissions: vi.fn() }))
vi.mock('./operations.api', () => api)
vi.mock('./freeOperations.api', () => ({ getFreeRegistrationMetrics: api.getFreeRegistrationMetrics, listFreeAdmissions: api.listFreeAdmissions }))
vi.mock('../events/event.queries', () => ({ eventKeys: { ownedList: (ownerId: string) => ['events', 'owned', ownerId] } }))
import { operationsKeys, useOperationsAdmissions, useOperationsMetrics, useOrder, useEventOrders } from './operations.queries'
const order = { id: 'order', status: 'paid', refundState: 'pending', tickets: [{ id: 'ticket', status: 'valid', usedAt: null }] }
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}
beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.useRealTimers())
it('refreshes dependent reads when a pending refund completes without an open dialog', async () => {
  const { client, wrapper } = setup()
  const key = operationsKeys.event('owner', 'event')
  client.setQueryData([...key, 'metrics'], { remaining: 0 })
  client.setQueryData([...key, 'orders', '', 'all'], { pages: [] })
  api.getOrderDetails.mockResolvedValueOnce(order).mockResolvedValue({ ...order, status: 'refunded', refundState: 'refunded', tickets: [{ id: 'ticket', status: 'refunded', usedAt: null }] })
  const { result } = renderHook(() => useOrder('owner', 'event', 'order'), { wrapper })
  await waitFor(() => expect(result.current.data?.refundState).toBe('pending'))
  client.setQueryData([...key, 'metrics'], { remaining: 0 })
  client.setQueryData([...key, 'orders', '', 'all'], { pages: [] })
  await waitFor(() => expect(result.current.data?.refundState).toBe('refunded'), { timeout: 7000 })
  expect(client.getQueryState([...key, 'metrics'])?.isInvalidated).toBe(true)
  expect(client.getQueryState([...key, 'orders', '', 'all'])?.isInvalidated).toBe(true)
  client.clear()
}, 10000)
it('ignores a late previous-account detail response', async () => {
  const { client, wrapper } = setup()
  let complete!: (value: typeof order) => void
  api.getOrderDetails.mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValue({ ...order, id: 'other' })
  const { result, rerender } = renderHook(({ owner }) => useOrder(owner, 'event', 'order'), { wrapper, initialProps: { owner: 'a' } })
  rerender({ owner: 'b' })
  await waitFor(() => expect(result.current.data?.id).toBe('other'))
  await act(async () => complete(order))
  expect(result.current.data?.id).toBe('other')
  client.clear()
})
it('resets cursor pagination and ignores late results after status changes', async () => {
  const { client, wrapper } = setup()
  let complete!: (value: { orders: { id: string }[]; nextCursor: null }) => void
  api.listEventOrders.mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValue({ orders: [{ id: 'refunded' }], nextCursor: null })
  const { result, rerender } = renderHook(({ status }: { status: 'all' | 'refunded' }) => useEventOrders('owner', 'event', '', status), { wrapper, initialProps: { status: 'all' as 'all' | 'refunded' } })
  rerender({ status: 'refunded' })
  await waitFor(() => expect(result.current.data?.pages[0]?.orders[0]?.id).toBe('refunded'))
  await act(async () => complete({ orders: [{ id: 'all' }], nextCursor: null }))
  expect(result.current.data?.pages[0]?.orders[0]?.id).toBe('refunded')
  expect(api.listEventOrders).toHaveBeenLastCalledWith('event', '', null, 'refunded')
  client.clear()
})

it('revalidates a cached filter when returning while application defaults consider it fresh', async () => {
  const { client, wrapper } = setup()
  client.setDefaultOptions({ queries: { retry: false, staleTime: 60_000 } })
  api.listEventOrders.mockResolvedValue({ orders: [{ id: 'paid' }], nextCursor: null })
  const { result, rerender } = renderHook(({ search }) => useEventOrders('owner', 'event', search), { wrapper, initialProps: { search: '' } })
  await waitFor(() => expect(result.current.isFetchedAfterMount).toBe(true))
  rerender({ search: 'none' })
  await waitFor(() => expect(result.current.isFetchedAfterMount).toBe(true))
  rerender({ search: '' })
  await waitFor(() => expect(result.current.isFetchedAfterMount).toBe(true))
  expect(api.listEventOrders).toHaveBeenCalledTimes(3)
  client.clear()
})

it('dispatches free source reads without invoking paid metrics or admission search', async () => {
  const { client, wrapper } = setup()
  api.getFreeRegistrationMetrics.mockResolvedValue({ eventId: 'event', registrationCount: 1, confirmedRegistrations: 1, reservedAdmissions: 3, issued: 3, checkedIn: 0, capacity: null, remaining: null })
  api.listFreeAdmissions.mockResolvedValue({ admissions: [], nextCursor: null })
  const metrics = renderHook(() => useOperationsMetrics('owner', 'event', 'free_registration', 4), { wrapper })
  const admissions = renderHook(() => useOperationsAdmissions('owner', 'event', 'free_registration', 4, 'alex@example.invalid'), { wrapper })
  await waitFor(() => expect(metrics.result.current.isSuccess).toBe(true))
  await waitFor(() => expect(admissions.result.current.isSuccess).toBe(true))
  expect(api.getEventMetrics).not.toHaveBeenCalled()
  expect(api.listEventAdmissions).not.toHaveBeenCalled()
  expect(api.getFreeRegistrationMetrics).toHaveBeenCalledWith('event', expect.any(AbortSignal))
  expect(api.listFreeAdmissions).toHaveBeenCalledWith('event', 'alex@example.invalid', null, expect.any(AbortSignal))
  expect(client.getQueryState(['organizer-operations', 'owner', 'event', 'source', 'free_registration', 4, 'metrics'])).toBeDefined()
  client.clear()
})

it('uses a new query generation after an owner A-B-A transition', async () => {
  const { client, wrapper } = setup()
  api.getFreeRegistrationMetrics.mockResolvedValue({ eventId: 'event', registrationCount: 1, confirmedRegistrations: 1, reservedAdmissions: 1, issued: 1, checkedIn: 0, capacity: 10, remaining: 9 })
  const { result, rerender } = renderHook(({ owner, generation }) => useOperationsMetrics(owner, 'event', 'free_registration', generation), { wrapper, initialProps: { owner: 'a', generation: 1 } })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  rerender({ owner: 'b', generation: 2 })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  rerender({ owner: 'a', generation: 3 })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(api.getFreeRegistrationMetrics).toHaveBeenCalledTimes(3)
  expect(client.getQueryState(['organizer-operations', 'a', 'event', 'source', 'free_registration', 3, 'metrics'])).toBeDefined()
  client.clear()
})
