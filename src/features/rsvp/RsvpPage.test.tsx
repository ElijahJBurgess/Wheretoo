import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RsvpPage } from './RsvpPage'
import { rsvpApi } from './rsvp.api'
vi.mock('./rsvp.api', () => ({ rsvpApi: { event: vi.fn(), confirm: vi.fn(), resolve: vi.fn() } }))
const id = 'd6100000-0000-4000-8000-000000000001'
const event = {
  id,
  title: 'City Picnic',
  organizer: { display_name: 'Local Host' },
  starts_at: '2027-01-01T18:00:00Z',
  ends_at: '2027-01-01T20:00:00Z',
  timezone: 'America/Los_Angeles',
  venue_name: 'Park',
  address_line1: '1 Test Street',
  city: 'San Francisco',
  artwork_path: null,
}
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/events/' + id + '/rsvp']}>
      <Routes>
        <Route path='/events/:eventId/rsvp' element={<RsvpPage />} />
        <Route path='/rsvp/:collectionBearer' element={<h1>Private confirmation</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) =>
        callback(),
    },
  })
  vi.mocked(rsvpApi.event).mockResolvedValue(
    { event, availability: { status: 'available', remaining: null, maxQuantity: 10 } } as never,
  )
})
it('selects three admissions and submits one registrant without payment', async () => {
  vi.mocked(rsvpApi.confirm).mockResolvedValue({
    kind: 'confirmed',
    registrationId: id,
    eventId: id,
    quantity: 3,
  })
  renderPage()
  await screen.findByRole('heading', { name: 'Choose your RSVP' })
  fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
  fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alex Chen' } })
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'alex@example.invalid' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm RSVP' }))
  await screen.findByRole('heading', { name: 'Private confirmation' })
  expect(rsvpApi.confirm).toHaveBeenCalledTimes(1)
  expect(vi.mocked(rsvpApi.confirm).mock.calls[0][0].submission.quantity).toBe(3)
})
it('uncertain result restores the original request on reload and resolves without reissuing', async () => {
  vi.mocked(rsvpApi.confirm).mockRejectedValue(new Error('Network interrupted'))
  vi.mocked(rsvpApi.resolve).mockResolvedValue({
    kind: 'confirmed',
    registrationId: id,
    eventId: id,
    quantity: 1,
  })
  const view = renderPage()
  await screen.findByRole('button', { name: 'Continue' })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alex Chen' } })
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'alex@example.invalid' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm RSVP' }))
  await screen.findByRole('button', { name: 'Check RSVP status' })
  view.unmount()
  renderPage()
  await screen.findByRole('heading', { name: 'Private confirmation' })
  expect(rsvpApi.confirm).toHaveBeenCalledTimes(1)
  expect(rsvpApi.resolve).toHaveBeenCalledTimes(1)
})
it('capacity full is distinct from availability failure', async () => {
  vi.mocked(rsvpApi.event).mockResolvedValue(
    { event, availability: { status: 'full', remaining: 0, maxQuantity: 10 } } as never,
  )
  const view = renderPage()
  await screen.findByText('RSVP capacity reached')
  expect(screen.queryByRole('button', { name: 'Confirm RSVP' })).toBeNull()
  view.unmount()
  vi.mocked(rsvpApi.event).mockRejectedValue(new Error('offline'))
  renderPage()
  await screen.findByText('Availability could not be checked')
  expect(screen.queryByText('RSVP capacity reached')).toBeNull()
})
it('invalid contact never creates a request', async () => {
  renderPage()
  await screen.findByRole('button', { name: 'Continue' })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm RSVP' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  expect(rsvpApi.confirm).not.toHaveBeenCalled()
})

it('cross-tab deletion after uncertainty blocks new issuance', async () => {
  vi.mocked(rsvpApi.confirm).mockRejectedValue(new Error('offline'))
  renderPage()
  await screen.findByRole('button', { name: 'Continue' })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alex Chen' } })
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'alex@example.invalid' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm RSVP' }))
  await screen.findByRole('button', { name: 'Check RSVP status' })
  localStorage.removeItem('wheretoo.rsvp.v1:' + id)
  fireEvent(window, new StorageEvent('storage', { key: 'wheretoo.rsvp.v1:' + id, newValue: null }))
  await screen.findByRole('heading', { name: 'Private RSVP recovery needed' })
  expect(screen.queryByRole('button', { name: 'Confirm RSVP' })).toBeNull()
  expect(rsvpApi.confirm).toHaveBeenCalledTimes(1)
})
