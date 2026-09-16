vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
vi.mock('../events/event.queries', async importOriginal => ({
  ...await importOriginal<typeof import('../events/event.queries')>(),
  useOwnedEvent: () => ({
    data: { title: 'Sunset', timezone: 'America/Los_Angeles' },
    isPending: false,
    isFetchedAfterMount: true,
    isError: false,
  }),
}))
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { getOrderDetails, getEventMetrics, useSession, redeemTicket } = vi.hoisted(() => ({
  getOrderDetails: vi.fn(),
  getEventMetrics: vi.fn(),
  useSession: vi.fn(),
  redeemTicket: vi.fn(),
}))
vi.mock('./operations.api', () => ({ getOrderDetails, getEventMetrics, redeemTicket }))
vi.mock(
  '../auth/SessionProvider',
  () => ({ useSession }),
)
import { OrganizerOrderDetailPage } from './OrganizerOrderDetailPage'
import { refundFixture } from '../refunds/refunds.fixtures'
const { getRefundStatus } = vi.hoisted(() => ({ getRefundStatus: vi.fn() }))
vi.mock('../refunds/refunds.api', async original => ({ ...await original<typeof import('../refunds/refunds.api')>(), getRefundStatus }))
const data = {
  id: 'order',
  orderNumber: 'WT-123',
  buyerName: 'Alex Chen',
  buyerEmail: 'alex@example.invalid',
  createdAt: '2026-01-01T00:00:00Z',
  paidAt: null,
  status: 'checkout_open',
  quantity: 3,
  totalMinor: 3300,
  subtotalMinor: 3000, taxMinor: 300,
  currency: 'usd',
  items: [{ tierName: 'General Admission', quantity: 3, subtotalMinor: 3000, unitAmountMinor: 1000 }],
  tickets: [],
  refundState: 'unavailable',
  admissionEligible: false,
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider
      client={client}
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
  return client
}
beforeEach(() => {
  vi.resetAllMocks()
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner' }, identityVersion: 4 })
  getRefundStatus.mockResolvedValue({ ...refundFixture, state: 'ineligible', action: 'none' })
  getEventMetrics.mockResolvedValue({ event: { title: 'Sunset' } })
})
it('does not turn an unpaid cart into admissions or paid money', async () => {
  getOrderDetails.mockResolvedValue(data)
  show()
  expect(await screen.findByText('No tickets issued.')).toBeVisible()
  expect(screen.getByText('Total due')).toBeVisible()
  expect(screen.queryByText('Total paid')).not.toBeInTheDocument()
})
it('shows distinct ticket states and preserved use time on a refunded order', async () => {
  getOrderDetails.mockResolvedValue({
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
    }, { id: 'three', admissionLabel: 'VIP', status: 'refunded', usedAt: null, issuedAt: data.createdAt }],
  })
  show()
  expect(await screen.findByText('Ticket 1')).toBeVisible()
  expect(screen.getByText('Ticket 2')).toBeVisible()
  expect(screen.getByText('Ticket 3')).toBeVisible()
  expect(screen.getByText(/Checked in/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Refund order' })).not.toBeInTheDocument()
})

it('shows immutable unit price and authoritative subtotal and tax', async () => {
  getOrderDetails.mockResolvedValue(data)
  show()
  await screen.findByText('No tickets issued.')
  expect(screen.getByText('$10 each')).toBeVisible()
  expect(screen.getByText('Subtotal')).toBeVisible()
  expect(screen.getByText('Tax')).toBeVisible()
  expect(screen.getByText('$3')).toBeVisible()
})

it('disables an open admission confirmation when canonical admission becomes unavailable', async () => {
  const paid = { ...data, status: 'paid', admissionEligible: true, tickets: [{ id: 'one', admissionLabel: 'GA', status: 'valid', usedAt: null, issuedAt: data.createdAt }] }
  getOrderDetails.mockResolvedValue(paid)
  const client = show()
  fireEvent.click(await screen.findByRole('button', { name: 'Check in ticket' }))
  expect(screen.getByRole('button', { name: 'Admit guest' })).toBeEnabled()
  await act(async () => { client.setQueryData(['organizer-operations', 'owner', 'event', 'order-v2', 'order'], { ...paid, tickets: [{ ...paid.tickets[0], status: 'used', usedAt: data.createdAt }] }) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Admit guest' })).toBeDisabled())
  expect(screen.getByText('This ticket is no longer available for check-in.')).toBeVisible()
  client.clear()
})
it('disables an open refund confirmation when canonical refund becomes pending', async () => {
  const paid = { ...data, status: 'paid', refundState: 'available' }
  getRefundStatus.mockResolvedValue(refundFixture)
  getOrderDetails.mockResolvedValue(paid)
  const client = show()
  fireEvent.click(await screen.findByRole('button', { name: 'Refund order' }))
  expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeEnabled()
  await act(async () => { client.setQueryData(['organizer-operations', 'owner', 'event', 'refund-status', 'order'], { ...refundFixture, state: 'processing', action: 'none' }) })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm refund' })).not.toBeInTheDocument())
  expect(screen.getByRole('dialog')).toHaveTextContent('Refund processing')
  client.clear()
})


it('disposes pending admission UI when the same owner returns in a new identity generation', async () => {
  const paid = { ...data, status: 'paid', admissionEligible: true, tickets: [{ id: 'generation-ticket', admissionLabel: 'GA', status: 'valid', usedAt: null, issuedAt: data.createdAt }] }
  getOrderDetails.mockResolvedValue(paid)
  let complete!: (value: unknown) => void
  redeemTicket.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function App() { return <QueryClientProvider client={client}><MemoryRouter initialEntries={['/organizer/events/event/orders/order']}><Routes><Route path='/organizer/events/:eventId/orders/:orderId' element={<OrganizerOrderDetailPage />} /></Routes></MemoryRouter></QueryClientProvider> }
  const view = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Check in ticket' }))
  fireEvent.click(screen.getByRole('button', { name: 'Admit guest' }))
  await waitFor(() => expect(redeemTicket).toHaveBeenCalledTimes(1))
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner' }, identityVersion: 5 })
  view.rerender(<App />)
  await act(async () => complete({ outcome: 'admitted', usedAt: data.createdAt }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(await screen.findByRole('button', { name: 'Check in ticket' }))
  expect(screen.getByRole('dialog')).not.toHaveTextContent('Admitted')
  expect(screen.queryByRole('button', { name: /Admitting/ })).not.toBeInTheDocument()
  client.clear()
})
