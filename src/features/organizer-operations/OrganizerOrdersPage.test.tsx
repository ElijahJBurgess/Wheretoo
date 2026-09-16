vi.mock('../events/event.queries', async importOriginal => ({
  ...await importOriginal<typeof import('../events/event.queries')>(),
  useOwnedEvent: () => ({
    data: { title: 'Sunset', timezone: 'America/Los_Angeles' },
    isPending: false,
    isFetchedAfterMount: true,
    isError: false,
  }),
}))
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { listEventOrders, getEventMetrics } = vi.hoisted(() => ({
  listEventOrders: vi.fn(),
  getEventMetrics: vi.fn(),
}))
vi.mock('./operations.api', () => ({ listEventOrders, getEventMetrics }))
vi.mock(
  '../auth/SessionProvider',
  () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'owner' } }) }),
)
import { OrganizerOrdersPage } from './OrganizerOrdersPage'
const order = {
  id: 'order',
  orderNumber: 'WT-123',
  buyerName: 'Alex Chen',
  buyerEmail: 'alex@example.invalid',
  createdAt: '2026-01-01T00:00:00Z',
  paidAt: '2026-01-01T00:00:00Z',
  status: 'paid',
  quantity: 3,
  totalMinor: 3001,
  currency: 'usd',
  items: [{ tierName: 'General Admission', quantity: 2, subtotalMinor: 2002 }, { tierName: 'VIP', quantity: 1, subtotalMinor: 999 }],
}
function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/organizer/events/event/orders']}>
        <Routes>
          <Route path='/organizer/events/:eventId/orders' element={<OrganizerOrdersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  getEventMetrics.mockResolvedValue({ event: { title: 'Sunset' } })
})
it('clears a status-filter no-match without claiming the event has no orders', async () => {
  listEventOrders.mockImplementation((_event, _search, _cursor, filter) => Promise.resolve({ orders: filter === 'all' ? [order] : [], nextCursor: null }))
  show()
  await screen.findByText('Alex Chen')
  await userEvent.click(screen.getByRole('button', { name: 'Refunded' }))
  expect(await screen.findByRole('heading', { name: 'No matching orders' })).toBeInTheDocument()
  expect(screen.queryByText('No orders yet')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
  expect(await screen.findByText('Alex Chen')).toBeVisible()
})
it('searches within the selected event and keeps one row per order', async () => {
  listEventOrders.mockResolvedValue({ orders: [order], nextCursor: null })
  show()
  expect(await screen.findByRole('link', { name: /Alex Chen/ })).toHaveAttribute(
    'href',
    '/organizer/events/event/orders/order',
  )
  expect(screen.getAllByText('Alex Chen')).toHaveLength(1)
  expect(screen.getByText('General Admission ×2 · VIP ×1')).toBeVisible()
  await userEvent.type(screen.getByRole('searchbox'), 'alex')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(listEventOrders).toHaveBeenLastCalledWith('event', 'alex', null, 'all')
})
it('keeps current rows and exposes retry when the next page fails', async () => {
  listEventOrders.mockResolvedValueOnce({
    orders: [order],
    nextCursor: { createdAt: order.createdAt, id: order.id },
  }).mockRejectedValue(new Error('failed'))
  show()
  await screen.findByText('Alex Chen')
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('More orders could not load')
  expect(screen.getByText('Alex Chen')).toBeVisible()
})
it('retains the last successful rows when a new search fails', async () => {
  listEventOrders.mockResolvedValueOnce({ orders: [order], nextCursor: null }).mockRejectedValue(
    new Error('failed'),
  )
  show()
  await screen.findByText('Alex Chen')
  await userEvent.type(screen.getByRole('searchbox'), 'absent')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Showing previous results')
  expect(screen.getByText('Alex Chen')).toBeVisible()
})

it('applies status chips at the server boundary and clears an empty search', async () => {
  listEventOrders.mockResolvedValue({ orders: [], nextCursor: null })
  show()
  await screen.findByText('No orders yet')
  await userEvent.click(screen.getByRole('button', { name: 'Refunded' }))
  expect(listEventOrders).toHaveBeenLastCalledWith('event', '', null, 'refunded')
  await userEvent.type(screen.getByRole('searchbox'), 'absent')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByText('No matching orders')
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByRole('searchbox')).toHaveValue('')
  expect(listEventOrders).toHaveBeenLastCalledWith('event', '', null, 'refunded')
})

it('removes prior buyer rows when a refreshed search denies access', async () => {
  const { OperationsReadError } = await import('./operations.errors')
  listEventOrders.mockResolvedValueOnce({ orders: [order], nextCursor: null })
    .mockRejectedValue(new OperationsReadError('Orders unavailable', true))
  show()
  await screen.findByText('Alex Chen')
  await userEvent.type(screen.getByRole('searchbox'), 'alex')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('heading', { name: 'Orders unavailable' })
  expect(screen.queryByText('Alex Chen')).not.toBeInTheDocument()
  expect(screen.queryByText('alex@example.invalid')).not.toBeInTheDocument()
})
