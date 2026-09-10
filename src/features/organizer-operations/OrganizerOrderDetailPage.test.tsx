import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { getOrder, getEventMetrics } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  getEventMetrics: vi.fn(),
}))
vi.mock('./operations.api', () => ({ getOrder, getEventMetrics }))
vi.mock(
  '../auth/SessionProvider',
  () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'owner' } }) }),
)
import { OrganizerOrderDetailPage } from './OrganizerOrderDetailPage'
const data = {
  id: 'order',
  orderNumber: 'WT-123',
  buyerName: 'Alex Chen',
  buyerEmail: 'alex@example.invalid',
  createdAt: '2026-01-01T00:00:00Z',
  paidAt: null,
  status: 'checkout_open',
  quantity: 3,
  totalMinor: 3001,
  currency: 'usd',
  items: [{ tierName: 'General Admission', quantity: 3, subtotalMinor: 3001 }],
  tickets: [],
  refundState: 'unavailable',
  admissionEligible: false,
}
function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/organizer/events/event/orders/order']}>
        <Routes>
          <Route
            path='/organizer/events/:eventId/orders/:orderId'
            element={<OrganizerOrderDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  getEventMetrics.mockResolvedValue({ event: { title: 'Sunset' } })
})
it('does not turn an unpaid cart into admissions or paid money', async () => {
  getOrder.mockResolvedValue(data)
  show()
  expect(await screen.findByText('No tickets issued.')).toBeVisible()
  expect(screen.getByText('Total due')).toBeVisible()
  expect(screen.queryByText('Total paid')).not.toBeInTheDocument()
})
it('shows distinct ticket states and preserved use time on a refunded order', async () => {
  getOrder.mockResolvedValue({
    ...data,
    paidAt: data.createdAt,
    status: 'refunded',
    refundState: 'refunded',
    tickets: [{
      id: 'one',
      admissionLabel: 'General Admission',
      status: 'used',
      usedAt: data.createdAt,
      issuedAt: data.createdAt,
    }, {
      id: 'two',
      admissionLabel: 'General Admission',
      status: 'refunded',
      usedAt: null,
      issuedAt: data.createdAt,
    }],
  })
  show()
  expect(await screen.findByText('Ticket 1')).toBeVisible()
  expect(screen.getByText('Ticket 2')).toBeVisible()
  expect(screen.getByText(/Checked in/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Refund order' })).not.toBeInTheDocument()
})
