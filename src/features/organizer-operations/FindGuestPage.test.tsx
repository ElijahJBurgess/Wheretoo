import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  useOperationsAdmissions: vi.fn(),
  useOwnedEvent: vi.fn(),
  useSession: vi.fn(),
}))
vi.mock('./operations.queries', () => ({ useOperationsAdmissions: mocks.useOperationsAdmissions }))
vi.mock('../events/event.queries', () => ({ useOwnedEvent: mocks.useOwnedEvent }))
vi.mock('../auth/SessionProvider', () => ({ useSession: mocks.useSession }))
import { FindGuestPage } from './FindGuestPage'
import { CheckInLayout } from './CheckInLayout'
const eventId = 'a6200000-0000-4000-8000-000000000001'
const base = `/organizer/events/${eventId}/check-in`
function show() {
  render(
    <MemoryRouter initialEntries={[`${base}/find`]}>
      <Routes>
        <Route path='/organizer/events/:eventId/check-in' element={<CheckInLayout />}>
          <Route path='find' element={<FindGuestPage />} />
          <Route path='find/:orderId/:ticketId' element={<p>Selected ticket</p>} />
          <Route path='find/registrations/:registrationId/:ticketId' element={<p>Selected free ticket</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner' } })
  mocks.useOwnedEvent.mockReturnValue({
    isPending: false,
    isFetchedAfterMount: true,
    data: { id: eventId, admission_type: 'paid', title: 'Night market' },
  })
  mocks.useOperationsAdmissions.mockReturnValue({
    isPending: false,
    isFetchedAfterMount: true,
    data: { pages: [{ admissions: [], nextCursor: null }] },
  })
})
it('starts focused without reporting an empty search, then displays successful no matches', async () => {
  show()
  expect(screen.queryByText('No guest found')).not.toBeInTheDocument()
  const input = screen.getByRole('searchbox')
  await userEvent.type(input, 'nobody')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getByText('No guest found')).toBeVisible()
})
it('shows individual positions for duplicate buyer names and selects ticket two explicitly', async () => {
  mocks.useOperationsAdmissions.mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      pages: [{
        admissions: [1, 2, 3].map((n) => ({
          ticketId: `ticket-${n}`,
          orderId: 'order',
          orderNumber: 'WT-1',
          buyerName: 'Alex Chen',
          buyerEmail: 'alex@example.invalid',
          admissionLabel: 'GA',
          ticketPosition: n,
          ticketTotal: 3,
          status: 'valid',
          usedAt: null,
        })),
        nextCursor: null,
      }],
    },
  })
  show()
  await userEvent.type(screen.getByRole('searchbox'), 'alex')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getAllByText('Alex Chen')).toHaveLength(3)
  await userEvent.click(screen.getByRole('link', { name: /Ticket 2 of 3/ }))
  expect(screen.getByText('Selected ticket')).toBeVisible()
})
it('never treats an error as no matches', async () => {
  mocks.useOperationsAdmissions.mockReturnValue({
    isError: true,
    isFetchedAfterMount: true,
    refetch: vi.fn(),
  })
  show()
  await userEvent.type(screen.getByRole('searchbox'), 'alex')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Search unavailable')
  expect(screen.queryByText('No guest found')).not.toBeInTheDocument()
})

it('keeps loaded guests on a pagination failure and retries only that next read', async () => {
  const fetchNextPage = vi.fn()
  mocks.useOperationsAdmissions.mockReturnValue({
    isError: true, isFetchNextPageError: true, isFetchedAfterMount: true, hasNextPage: true, fetchNextPage,
    data: { pages: [{ admissions: [{ ticketId: 'ticket-1', orderId: 'order', orderNumber: 'WT-1', buyerName: 'Alex Chen', buyerEmail: 'alex@example.invalid', admissionLabel: 'GA', ticketPosition: 1, ticketTotal: 1, status: 'valid', usedAt: null }], nextCursor: { id: 'cursor' } }] },
  })
  show()
  await userEvent.type(screen.getByRole('searchbox'), 'alex')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getByText('Alex Chen')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('More guests could not load')
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading guests' }))
  expect(fetchNextPage).toHaveBeenCalledTimes(1)
})
it('mounts free guest search and selects ticket two by registration membership', async () => {
  mocks.useOwnedEvent.mockReturnValue({
    isFetchedAfterMount: true,
    isPending: false,
    data: { id: eventId, admission_type: 'free', title: 'Community supper' },
  })
  mocks.useOperationsAdmissions.mockReturnValue({
    isPending: false,
    isFetchedAfterMount: true,
    data: { pages: [{ admissions: [{
      sourceKind: 'free_registration',
      registrationId: 'a6300000-0000-4000-8000-000000000001',
      registrantName: 'Alex Chen',
      registrantEmail: 'alex@example.invalid',
      registrationStatus: 'confirmed',
      createdAt: '2026-09-14T12:00:00Z',
      ticketId: 'a6400000-0000-4000-8000-000000000002',
      ticketPosition: 2,
      ticketTotal: 3,
      admissionLabel: 'General Admission',
      status: 'valid',
      usedAt: null,
      admissionEligible: true,
    }], nextCursor: null }] },
  })
  show()
  await userEvent.type(screen.getByRole('searchbox'), 'alex@example.invalid')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  const ticket = screen.getByRole('link', { name: /Ticket 2 of 3/ })
  expect(ticket).toHaveAttribute('href', `${base}/find/registrations/a6300000-0000-4000-8000-000000000001/a6400000-0000-4000-8000-000000000002`)
  expect(mocks.useOperationsAdmissions).toHaveBeenCalledWith('owner', eventId, 'free_registration', 0, 'alex@example.invalid')
})

it('keeps duplicate free registrant names separated by registration source', async () => {
  mocks.useOwnedEvent.mockReturnValue({ isPending: false, isFetchedAfterMount: true, data: { id: eventId, admission_type: 'free', title: 'Community supper' } })
  mocks.useOperationsAdmissions.mockReturnValue({ isPending: false, isFetchedAfterMount: true, data: { pages: [{ admissions: [1, 2].map(number => ({
    sourceKind: 'free_registration', registrationId: `a6300000-0000-4000-8000-00000000000${number}`, registrantName: 'Alex Chen', registrantEmail: `alex${number}@example.invalid`, registrationStatus: 'confirmed', createdAt: '2026-09-14T12:00:00Z', ticketId: `a6400000-0000-4000-8000-00000000000${number}`, ticketPosition: 1, ticketTotal: 1, admissionLabel: 'General Admission', status: 'valid', usedAt: null, admissionEligible: true,
  })), nextCursor: null }] } })
  show()
  await userEvent.type(screen.getByRole('searchbox'), 'Alex Chen')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getByRole('heading', { name: 'Multiple Results' })).toBeVisible()
  expect(screen.getAllByRole('link', { name: /Alex Chen/ })).toHaveLength(2)
})
