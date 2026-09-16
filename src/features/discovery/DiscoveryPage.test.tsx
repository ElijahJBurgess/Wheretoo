vi.mock('../event-images/publicEventImages', () => ({ usePublicEventImages: () => ({ data: [], isError: false, isPending: false }) }))
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { DiscoveryPage } from './DiscoveryPage'
import type { DiscoveryPageData } from './discovery.types'
const read = vi.hoisted(() => vi.fn())
vi.mock('./discovery.api', async importOriginal => ({ ...await importOriginal<typeof import('./discovery.api')>(), getDiscoveryPage: read }))
function page(id: string, nextCursor: string | null = null): DiscoveryPageData {
  return { items: [{ id, title: `Event ${id}`, category: 'music', admissionType: 'paid', startsAt: '2026-09-14T03:00:00Z', endsAt: '2026-09-14T06:00:00Z', timezone: 'America/Los_Angeles', venueName: null, city: 'Oakland', artworkReference: null, admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null } }], nextCursor, serverNow: '2026-09-13T12:00:00Z', window: { start: '2026-09-13T12:00:00Z', end: '2026-10-13T07:00:00Z', timezone: 'America/Los_Angeles' }, invalidItemCount: 0 }
}
afterEach(() => { vi.restoreAllMocks(); read.mockReset() })
it.each(['Clear filters', 'Wheretoo discovery home'])('starts a new first page on explicit filter return via %s, retaining cached pages only for POP', async control => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
  read.mockResolvedValueOnce(page('first', 'cursor')).mockResolvedValueOnce(page('second')).mockResolvedValueOnce(page('music')).mockResolvedValueOnce(page('new-first', 'cursor'))
  const client = new QueryClient()
  const router = createMemoryRouter([{ path: '/discover', element: <DiscoveryPage /> }], { initialEntries: ['/discover'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByText('Event first')
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
  await screen.findByText('Event second')
  await userEvent.click(screen.getByRole('button', { name: 'Music' }))
  await screen.findByText('Event music')
  await userEvent.click(control === 'Clear filters' ? screen.getByRole('button', { name: control }) : screen.getByRole('link', { name: control }))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(4))
  await screen.findByText('Event new-first')
  expect(screen.queryByText('Event second')).not.toBeInTheDocument()
  expect(read.mock.calls[3][1].cursor).toBeUndefined()
  await act(() => router.navigate(-1))
  await screen.findByText('Event music')
  expect(read).toHaveBeenCalledTimes(4)
})
