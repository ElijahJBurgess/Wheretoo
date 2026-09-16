import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { setAuthenticatedIdentity } from '../auth/identityLifetime'
import { testContext } from './eventChanges.fixtures'

const api = vi.hoisted(() => ({ getOwnedEvent: vi.fn(), cancelOwnedEvent: vi.fn() }))
vi.mock('../events/event.api', () => api)
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'organizer-1' } }) }))
import { EventCancellationPage } from './EventCancellationPage'

const event = { ...testContext().event, status: 'published' as const }
function show(cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setAuthenticatedIdentity(client, 'organizer-1')
  if (cached) client.setQueryData(['events', 'detail', 'organizer-1', 'event-1'], event)
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/organizer/events/event-1/cancellation']}>
    <Routes><Route path='/organizer/events/:eventId/cancellation' element={<EventCancellationPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>)
  return client
}
beforeEach(() => vi.resetAllMocks())

it('withholds cancellation while cached published data awaits its fresh owner read', async () => {
  let resolve!: (value: typeof event) => void
  api.getOwnedEvent.mockReturnValue(new Promise(done => { resolve = done }))
  show(true)
  expect(screen.queryByRole('button', { name: 'Cancel event' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading event status')
  await act(async () => resolve(event))
  expect(await screen.findByRole('button', { name: 'Cancel event' })).toBeEnabled()
  expect(api.cancelOwnedEvent).not.toHaveBeenCalled()
})

it('keeps the original unknown cancellation recovery available after a later read failure', async () => {
  api.getOwnedEvent.mockResolvedValueOnce(event).mockRejectedValue(new Error('unavailable'))
  api.cancelOwnedEvent.mockRejectedValue(new Error('unknown write'))
  const client = show()
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel event' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
  await screen.findByRole('button', { name: 'Check cancellation status' })
  await act(async () => { await client.refetchQueries({ queryKey: ['events', 'detail', 'organizer-1', 'event-1'], exact: true }) })
  await screen.findByRole('heading', { name: 'Cancellation status unavailable' })
  expect(screen.getByRole('button', { name: 'Check cancellation status' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled()
  expect(screen.queryByText(event.title!)).not.toBeInTheDocument()
  expect(api.cancelOwnedEvent).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Close confirmation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review cancellation status' }))
  expect(screen.getByRole('button', { name: 'Check cancellation status' })).toBeEnabled()
  api.getOwnedEvent.mockResolvedValue(event)
  fireEvent.click(screen.getByRole('button', { name: 'Check cancellation status' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Try cancellation again' })).toBeEnabled())
  expect(api.cancelOwnedEvent).toHaveBeenCalledTimes(1)
  api.getOwnedEvent.mockRejectedValue(new Error('newer freshness failure'))
  await act(async () => { await client.refetchQueries({ queryKey: ['events', 'detail', 'organizer-1', 'event-1'], exact: true }) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Try cancellation again' })).toBeDisabled())
  expect(api.cancelOwnedEvent).toHaveBeenCalledTimes(1)
})
