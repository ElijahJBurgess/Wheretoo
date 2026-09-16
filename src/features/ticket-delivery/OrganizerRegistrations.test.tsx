import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ getFreeRegistration: vi.fn(), listFreeAdmissions: vi.fn(), getDelivery: vi.fn(), getResendStatus: vi.fn(), requestResend: vi.fn() }))
vi.mock('../organizer-operations/freeOperations.api', () => ({ getFreeRegistration: api.getFreeRegistration, listFreeAdmissions: api.listFreeAdmissions }))
vi.mock('../organizer-operations/operations.queries', () => ({ operationsKeys: { event: (ownerId: string, eventId: string) => ['organizer-operations', ownerId, eventId] } }))
vi.mock('./delivery.api', () => ({ getDelivery: api.getDelivery, getResendStatus: api.getResendStatus, requestResend: api.requestResend }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'owner' } }) }))
import { OrganizerRegistrationLookup } from '../organizer-operations/OrganizerRegistrationLookup'
import { OrganizerRegistrationDetailPage } from '../organizer-operations/OrganizerRegistrationDetailPage'
const eventId = 'a6200000-0000-4000-8000-000000000001'
const registrationId = 'a6300000-0000-4000-8000-000000000001'
const ticketId = (position: number) => `a6400000-0000-4000-8000-00000000000${position}`
function show(detail = false) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[detail ? `/organizer/events/${eventId}/registrations/${registrationId}` : `/organizer/events/${eventId}/registrations`]}><Routes><Route path='/organizer/events/:eventId/registrations' element={<OrganizerRegistrationLookup />} /><Route path='/organizer/events/:eventId/registrations/:registrationId' element={<OrganizerRegistrationDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>) }
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear() })
it('keeps a blank registration search idle and lets a successful no-match clear the search', async () => {
  api.listFreeAdmissions.mockResolvedValue({ admissions: [], nextCursor: null })
  show()
  expect(api.listFreeAdmissions).not.toHaveBeenCalled()
  expect(screen.queryByText('No matching registrations')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'nobody' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find registration' }))
  expect(await screen.findByRole('heading', { name: 'No matching registrations' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByLabelText('Name or email')).toHaveValue('')
  expect(screen.getByLabelText('Name or email')).toHaveFocus()
  expect(screen.queryByText('No matching registrations')).not.toBeInTheDocument()
})
it('does not turn a failed registration read into no matches or expose send actions', async () => {
  api.listFreeAdmissions.mockRejectedValue(new Error('private raw provider detail'))
  show()
  fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'nobody' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find registration' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Search unavailable')
  expect(screen.queryByText(/No matching registrations|private raw provider detail/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(api.requestResend).not.toHaveBeenCalled()
})
it('deduplicates registration rows from the existing admission search and preserves its cursor', async () => {
  const row = { sourceKind: 'free_registration', registrationId, registrantName: 'Alex', registrantEmail: 'alex@example.com', registrationStatus: 'confirmed', createdAt: '2026-09-11T12:00:00Z', ticketPosition: 1, ticketTotal: 2, admissionLabel: 'RSVP', status: 'valid', usedAt: null, admissionEligible: true }
  const cursor = { ticketId: ticketId(2), createdAt: row.createdAt }
  api.listFreeAdmissions.mockResolvedValueOnce({ admissions: [{ ...row, ticketId: ticketId(1) }, { ...row, ticketId: ticketId(2), ticketPosition: 2 }], nextCursor: cursor }).mockResolvedValueOnce({ admissions: [{ ...row, registrationId: 'a6300000-0000-4000-8000-000000000002', ticketId: ticketId(3), registrantName: 'Alex Other' }], nextCursor: null })
  show()
  fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'Alex' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find registration' }))
  expect(await screen.findAllByText('alex@example.com')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Load more registrations' }))
  await screen.findByText('Alex Other')
  expect(api.listFreeAdmissions).toHaveBeenLastCalledWith(eventId, 'Alex', cursor, expect.anything())
  expect(screen.queryByRole('button', { name: /Check in/ })).not.toBeInTheDocument()
})
it('retains loaded registration pages when the next page fails and retries only that page', async () => {
  const row = { sourceKind: 'free_registration', registrationId, ticketId: ticketId(1), registrantName: 'Alex', registrantEmail: 'alex@example.com', registrationStatus: 'confirmed', createdAt: '2026-09-11T12:00:00Z', ticketPosition: 1, ticketTotal: 1, admissionLabel: 'RSVP', status: 'valid', usedAt: null, admissionEligible: true }
  const cursor = { ticketId: row.ticketId, createdAt: row.createdAt }
  api.listFreeAdmissions.mockResolvedValueOnce({ admissions: [row], nextCursor: cursor }).mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({ admissions: [], nextCursor: null })
  show()
  fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'Alex' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find registration' }))
  await screen.findByText('alex@example.com')
  fireEvent.click(screen.getByRole('button', { name: 'Load more registrations' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('More registrations could not load')
  expect(screen.getByText('alex@example.com')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading registrations' }))
  expect(api.listFreeAdmissions).toHaveBeenLastCalledWith(eventId, 'Alex', cursor, expect.anything())
  expect(api.requestResend).not.toHaveBeenCalled()
})
it('shows registration quantity and original Used timestamp with free check-in links but no payment actions', async () => {
  api.getFreeRegistration.mockResolvedValue({ registrationId, eventId, eventName: 'Picnic', registrantName: 'Alex', registrantEmail: 'alex@example.com', status: 'confirmed', quantity: 2, createdAt: '2026-09-11T12:00:00Z', tickets: [{ ticketId: ticketId(1), position: 1, admissionLabel: 'RSVP', status: 'valid', usedAt: null }, { ticketId: ticketId(2), position: 2, admissionLabel: 'RSVP', status: 'used', usedAt: '2026-09-11T13:00:00Z' }] })
  show(true)
  expect(await screen.findByRole('heading', { name: 'Registration details' })).toBeVisible()
  expect(screen.getByText(/Checked in/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Resend tickets' })).toBeEnabled()
  expect(screen.getAllByRole('link', { name: /Open Ticket/ })).toHaveLength(2)
  expect(screen.getByRole('link', { name: 'Open Ticket 1 of 2' })).toHaveAttribute('href', `/organizer/events/${eventId}/check-in/find/registrations/${registrationId}/${ticketId(1)}`)
  expect(screen.queryByText(/Total paid|Refund order/)).not.toBeInTheDocument()
})
