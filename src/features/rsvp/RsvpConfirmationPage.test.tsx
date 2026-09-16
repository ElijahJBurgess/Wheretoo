import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom'
import { RsvpConfirmationPage } from './RsvpConfirmationPage'
vi.mock('../ticket-delivery/delivery.public-api', () => ({ publicTicketDeliveryApi: { status: () => new Promise(() => {}) } }))
const read = vi.hoisted(() => vi.fn())
vi.mock(
  '../ticket-experience/adapters/ticketCollectionReader',
  () => ({ createTicketCollectionReader: () => ({ readCollection: read }) }),
)
it('confirms only a canonical private collection with exact quantity and no email claim', async () => {
  read.mockResolvedValue({
    kind: 'ready',
    collection: {
      registrationId: 'reg',
      eventId: 'event',
      collectionLabel: 'Picnic tickets',
      tickets: [1, 2, 3].map((n) => ({
        selector: String(n),
        eventName: 'Free Picnic',
        eventId: 'event',
        startsAt: '2027-01-01T18:00:00Z',
        endsAt: '2027-01-01T20:00:00Z',
        venueName: 'Park',
        admissionLabel: 'Free RSVP',
        position: n,
        totalInCollection: 3,
        status: 'valid',
        admissionCredential: 'test',
      })),
    },
  })
  render(
    <MemoryRouter initialEntries={['/rsvp/rsvp_' + 'A'.repeat(43)]}>
      <Routes>
        <Route path='/rsvp/:collectionBearer' element={<RsvpConfirmationPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'You’re on the list' })
  expect(screen.getByText('3 admissions confirmed')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View tickets' })).toHaveAttribute(
    'href',
    '/tickets/rsvp_' + 'A'.repeat(43),
  )
  expect(screen.queryByText(/emailed|sent to your email/i)).toBeNull()
  expect(screen.queryByRole('img', { name: /qr/i })).toBeNull()
})
it('never claims success for an unavailable collection', async () => {
  read.mockResolvedValue({ kind: 'unavailable' })
  render(
    <MemoryRouter initialEntries={['/rsvp/rsvp_' + 'A'.repeat(43)]}>
      <Routes>
        <Route path='/rsvp/:collectionBearer' element={<RsvpConfirmationPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Tickets unavailable' })
  expect(screen.queryByText('You’re on the list')).toBeNull()
})
it('removes the old private RSVP on A to B to A until the new read finishes', async () => {
  read.mockReset()
  read.mockResolvedValueOnce({ kind: 'ready', collection: {
    registrationId: 'reg-a', registrationStatus: 'confirmed', eventId: 'event-a', collectionLabel: 'Collection A',
    tickets: [{ selector: 'one', eventName: 'Private event A', eventId: 'event-a', startsAt: '2027-01-01T18:00:00Z', endsAt: '2027-01-01T20:00:00Z', timezone: 'UTC', venueName: 'Park', admissionLabel: 'RSVP', position: 1, totalInCollection: 1, status: 'valid', admissionCredential: 'synthetic-unused' }],
  } }).mockImplementation(() => new Promise(() => {}))
  const a = '/rsvp/rsvp_' + 'A'.repeat(43)
  const b = '/rsvp/rsvp_' + 'B'.repeat(42) + 'A'
  const router = createMemoryRouter([{ path: '/rsvp/:collectionBearer', element: <RsvpConfirmationPage /> }], { initialEntries: [a] })
  render(<RouterProvider router={router} />)
  await screen.findByText('Private event A')
  await act(() => router.navigate(b))
  expect(screen.queryByText('Private event A')).not.toBeInTheDocument()
  await act(() => router.navigate(a))
  expect(screen.queryByText('Private event A')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Checking your private RSVP')
  expect(screen.queryByRole('link', { name: 'View tickets' })).not.toBeInTheDocument()
})
it('shows event cancellation even when every admission has already been used', async () => {
  read.mockResolvedValue({
    kind: 'ready',
    collection: {
      registrationId: 'reg',
      registrationStatus: 'cancelled',
      eventId: 'event',
      collectionLabel: 'Picnic tickets',
      tickets: [{
        selector: 'one',
        eventName: 'Free Picnic',
        eventId: 'event',
        startsAt: '2027-01-01T18:00:00Z',
        endsAt: '2027-01-01T20:00:00Z',
        timezone: 'America/New_York',
        venueName: 'Park',
        admissionLabel: 'Free RSVP',
        position: 1,
        totalInCollection: 1,
        status: 'used',
        usedAt: '2027-01-01T18:05:00Z',
        admissionCredential: null,
      }],
    },
  })
  render(
    <MemoryRouter initialEntries={['/rsvp/rsvp_' + 'A'.repeat(43)]}>
      <Routes>
        <Route path='/rsvp/:collectionBearer' element={<RsvpConfirmationPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Event cancelled' })
  expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull()
  expect(screen.getByText(/1:00.*3:00.*EST/)).toBeInTheDocument()
})
