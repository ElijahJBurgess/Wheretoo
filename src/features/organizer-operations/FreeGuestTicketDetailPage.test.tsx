import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCheckInContext: vi.fn(),
  useFreeRegistration: vi.fn(),
}))
vi.mock('./CheckInContext', () => ({ useCheckInContext: mocks.useCheckInContext }))
vi.mock('./freeOperations.queries', () => ({
  useFreeRegistration: mocks.useFreeRegistration,
}))
vi.mock('./ManualAdmissionDialog', async () => {
  const { OperationsDialog } = await import('./OperationsDialog')
  return {
    ManualAdmissionDialog: ({ onClose }: { onClose(): void }) => (
      <OperationsDialog title='Confirm free admission' busy={false} onClose={onClose}>
        <button onClick={onClose}>Cancel</button>
      </OperationsDialog>
    ),
  }
})

import { FreeGuestTicketDetailPage } from './FreeGuestTicketDetailPage'

const eventId = 'a6200000-0000-4000-8000-000000000001'
const registrationId = 'a6300000-0000-4000-8000-000000000001'
const ticketId = 'a6400000-0000-4000-8000-000000000002'
const tickets = [1, 2, 3].map(position => ({
  ticketId: `a6400000-0000-4000-8000-00000000000${position}`,
  position,
  admissionLabel: 'General Admission',
  status: 'valid',
  usedAt: null,
}))

function show(selectedRegistrationId = registrationId, selectedTicketId = ticketId) {
  return render(
    <MemoryRouter initialEntries={[`/organizer/events/${eventId}/check-in/find/registrations/${selectedRegistrationId}/${selectedTicketId}`]}>
      <Routes>
        <Route path='/organizer/events/:eventId/check-in/find/registrations/:registrationId/:ticketId' element={<FreeGuestTicketDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useCheckInContext.mockReturnValue({
    ownerId: 'owner', identityVersion: 4, eventId, sourceKind: 'free_registration',
    event: { id: eventId, admission_type: 'free', status: 'published', starts_at: '2026-09-14T12:00:00Z', ends_at: '2126-09-14T15:00:00Z', timezone: 'America/Los_Angeles', title: 'Community supper' },
  })
  mocks.useFreeRegistration.mockReturnValue({
    isPending: false, isFetchedAfterMount: true, isError: false,
    data: { registrationId, eventId, eventName: 'Community supper', registrantName: 'Alex Chen', registrantEmail: 'alex@example.invalid', status: 'confirmed', quantity: 3, createdAt: '2026-09-14T12:00:00Z', tickets },
  })
})

it('loads a direct free deep link and selects ticket two of three from its registration', () => {
  show()
  expect(screen.getByRole('heading', { name: 'Guest Details' })).toBeVisible()
  expect(screen.getByText(/Free registration/)).toHaveTextContent('Ticket 2 of 3')
  expect(mocks.useFreeRegistration).toHaveBeenCalledWith('owner', eventId, 4, registrationId)
  expect(screen.getByRole('button', { name: 'Check in guest' })).toBeEnabled()
})

it('restores focus to the check-in opener after native dialog cancellation', async () => {
  show()
  const opener = screen.getByRole('button', { name: 'Check in guest' })
  opener.focus()
  fireEvent.click(opener)

  const dialog = screen.getByRole('dialog', { name: 'Confirm free admission' })
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))

  await waitFor(() => expect(opener).toHaveFocus())
})

it('rejects a ticket that does not belong to the selected registration', () => {
  show(registrationId, 'a6400000-0000-4000-8000-000000000009')
  expect(screen.getByRole('heading', { name: 'Invalid ticket' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Check in guest' })).not.toBeInTheDocument()
})

it('rejects malformed IDs without issuing a registration read', () => {
  show('not-a-registration', ticketId)
  expect(screen.getByRole('heading', { name: 'Invalid ticket selection' })).toBeVisible()
  expect(mocks.useFreeRegistration).not.toHaveBeenCalled()
})

it('blocks stale valid status when the event has ended', () => {
  mocks.useCheckInContext.mockReturnValue({
    ...mocks.useCheckInContext(),
    event: { ...mocks.useCheckInContext().event, ends_at: '2020-01-01T00:00:00Z' },
  })
  show()
  expect(screen.getByText('Check-in closed. This ticket cannot currently be admitted.')).toBeVisible()
})

it('keeps stale ticket data visible but blocks admission after a refresh failure', () => {
  mocks.useFreeRegistration.mockReturnValue({
    isPending: false, isFetchedAfterMount: true, isError: true, error: new Error('offline'), refetch: vi.fn(),
    data: { registrationId, eventId, eventName: 'Community supper', registrantName: 'Alex Chen', registrantEmail: 'alex@example.invalid', status: 'confirmed', quantity: 3, createdAt: '2026-09-14T12:00:00Z', tickets },
  })
  show()
  expect(screen.getByText(/Ticket status could not refresh/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Check in guest' })).not.toBeInTheDocument()
})
