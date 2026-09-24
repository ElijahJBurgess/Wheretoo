import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useFreeRegistration: vi.fn() }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', identityVersion: 6, user: { id: 'owner' } }) }))
vi.mock('./freeOperations.queries', () => ({ useFreeRegistration: mocks.useFreeRegistration }))
vi.mock('../ticket-delivery/ResendTicketsDialog', () => ({ ResendTicketsDialog: () => <p>Resend</p> }))

import { OrganizerRegistrationDetailPage } from './OrganizerRegistrationDetailPage'

const eventId = 'a6200000-0000-4000-8000-000000000001'
const registrationId = 'a6300000-0000-4000-8000-000000000001'
const tickets = [1, 2, 3].map(position => ({
  ticketId: `a6400000-0000-4000-8000-00000000000${position}`,
  position,
  admissionLabel: 'General Admission',
  status: 'valid',
  usedAt: null,
}))

function show(path = `/organizer/events/${eventId}/registrations/${registrationId}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path='/organizer/events/:eventId/registrations/:registrationId' element={<OrganizerRegistrationDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useFreeRegistration.mockReturnValue({ isPending: false, isFetchedAfterMount: true, isError: false, data: { registrationId, eventId, eventName: 'Community supper', registrantName: 'Alex Chen', registrantEmail: 'alex@example.invalid', status: 'confirmed', quantity: 3, createdAt: '2026-09-14T12:00:00Z', tickets } })
})

it('links every stable ticket identity to free check-in and labels ticket two of three', async () => {
  show()
  const ticketTwo = await screen.findByRole('link', { name: /Ticket 2 of 3/ })
  expect(ticketTwo).toHaveAttribute('href', `/organizer/events/${eventId}/check-in/find/registrations/${registrationId}/${tickets[1].ticketId}`)
})

it('rejects malformed registration IDs before a private read', () => {
  show(`/organizer/events/${eventId}/registrations/not-a-registration`)
  expect(screen.getByRole('heading', { name: 'Registration unavailable' })).toBeVisible()
  expect(mocks.useFreeRegistration).not.toHaveBeenCalled()
})
it('opens the individual email audience by registration ID without an address in the URL', async () => {
  show()
  expect(await screen.findByRole('link', { name: 'Email registrant' })).toHaveAttribute('href', `/organizer/events/${eventId}/email-attendees?registration=${registrationId}`)
})
