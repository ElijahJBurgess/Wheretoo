vi.mock('../event-images/publicEventImages', () => ({ usePublicEventImages: () => ({ data: [{position: 1, url: 'https://example.invalid/flyer.png'}] }) }))
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { FreeRsvpEntry } from './FreeRsvpEntry'
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
function renderPage(entry = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}><MemoryRouter initialEntries={['/events/' + id + '/rsvp']}>
      {entry && <FreeRsvpEntry eventId={id} />}
      <Routes>
        <Route path='/events/:eventId/rsvp' element={<RsvpPage />} />
        <Route path='/rsvp/:collectionBearer' element={<h1>Private confirmation</h1>} />
      </Routes>
    </MemoryRouter></QueryClientProvider>,
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
  expect(screen.getByRole('presentation')).toHaveAttribute('src', 'https://example.invalid/flyer.png')
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
  vi.mocked(rsvpApi.event).mockResolvedValue(null)
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

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
async function tick(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
}
it('refreshes shared free availability full to available to full without duplicate reads or refocusing', async () => {
  vi.useFakeTimers()
  vi.mocked(rsvpApi.event).mockResolvedValue({ event, availability: { status: 'full', remaining: 0, maxQuantity: 10 } } as never)
  renderPage(true)
  await tick()
  expect(screen.getAllByRole('button', { name: 'RSVP full' })).toHaveLength(2)
  expect(rsvpApi.event).toHaveBeenCalledTimes(1)
  vi.mocked(rsvpApi.event).mockResolvedValue({ event, availability: { status: 'available', remaining: 2, maxQuantity: 10 } } as never)
  await tick(15_000)
  expect(screen.getByRole('link', { name: 'RSVP for free' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Choose your RSVP' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  screen.getByLabelText('Full name').focus()
  vi.mocked(rsvpApi.event).mockResolvedValue({ event, availability: { status: 'available', remaining: 3, maxQuantity: 10 } } as never)
  await tick(15_000)
  expect(screen.getByLabelText('Full name')).toHaveFocus()
  vi.mocked(rsvpApi.event).mockResolvedValue({ event, availability: { status: 'full', remaining: 0, maxQuantity: 10 } } as never)
  await tick(15_000)
  expect(screen.queryByRole('button', { name: 'Confirm RSVP' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'RSVP for free' })).toBeNull()
  expect(screen.getAllByRole('button', { name: 'RSVP full' })).toHaveLength(2)
  expect(rsvpApi.event).toHaveBeenCalledTimes(4)
})
it('discards stale available controls after refresh failure and retries then removes them when eligibility ends', async () => {
  vi.useFakeTimers()
  renderPage(true)
  await tick()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alex Chen' } })
  vi.mocked(rsvpApi.event).mockRejectedValue(new Error('offline'))
  await tick(15_000)
  expect(screen.getByRole('heading', { name: 'Availability could not be checked' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Confirm RSVP' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'RSVP for free' })).toBeNull()
  expect(screen.queryByText('RSVP capacity reached')).toBeNull()
  vi.mocked(rsvpApi.event).mockResolvedValue({ event, availability: { status: 'available', remaining: null, maxQuantity: 10 } } as never)
  fireEvent.click(screen.getAllByRole('button', { name: 'Check availability' })[0])
  await tick()
  expect(screen.getByLabelText('Full name')).toHaveValue('Alex Chen')
  expect(screen.getByRole('button', { name: 'Confirm RSVP' })).toBeEnabled()
  vi.mocked(rsvpApi.event).mockResolvedValue(null)
  await tick(15_000)
  expect(screen.getByRole('heading', { name: 'RSVP unavailable' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Confirm RSVP' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'RSVP for free' })).toBeNull()
})
it('blocks a details quantity that exceeds newly refreshed remaining capacity', async () => {
  vi.useFakeTimers()
  renderPage()
  await tick()
  fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  vi.mocked(rsvpApi.event).mockResolvedValue({ event, availability: { status: 'available', remaining: 1, maxQuantity: 10 } } as never)
  await tick(15_000)
  expect(screen.getByRole('button', { name: 'Confirm RSVP' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Edit quantity' }))
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }))
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
})

it('reports unknown rather than full after a failed capacity refresh', async () => {
  vi.useFakeTimers()
  vi.mocked(rsvpApi.event).mockResolvedValue({ event, availability: { status: 'full', remaining: 0, maxQuantity: 10 } } as never)
  renderPage(true)
  await tick()
  vi.mocked(rsvpApi.event).mockRejectedValue(new Error('offline'))
  await tick(15_000)
  expect(screen.queryByText('RSVP capacity reached')).toBeNull()
  expect(screen.getByText('Current RSVP availability could not be checked.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Availability could not be checked' })).toBeInTheDocument()
})
it('pauses hidden-page polling and refreshes on return and reconnect without writing request storage', async () => {
  vi.useFakeTimers()
  let visibility: DocumentVisibilityState = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  const write = vi.spyOn(Storage.prototype, 'setItem')
  renderPage()
  await tick()
  visibility = 'hidden'
  window.dispatchEvent(new Event('visibilitychange'))
  await tick(30_000)
  expect(rsvpApi.event).toHaveBeenCalledTimes(1)
  vi.mocked(rsvpApi.event).mockResolvedValue(null)
  visibility = 'visible'
  window.dispatchEvent(new Event('visibilitychange'))
  await tick()
  expect(screen.getByRole('heading', { name: 'RSVP unavailable' })).toBeInTheDocument()
  expect(rsvpApi.event).toHaveBeenCalledTimes(2)
  vi.mocked(rsvpApi.event).mockResolvedValue({ event, availability: { status: 'available', remaining: null, maxQuantity: 10 } } as never)
  onlineManager.setOnline(false)
  onlineManager.setOnline(true)
  await tick()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  expect(rsvpApi.event).toHaveBeenCalledTimes(3)
  expect(write).not.toHaveBeenCalled()
})
