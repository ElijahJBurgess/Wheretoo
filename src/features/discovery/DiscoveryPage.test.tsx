vi.mock('../event-images/publicEventImages', () => ({ usePublicEventImages: () => ({ data: [{eventId: 'first', position: 2, url: 'https://example.invalid/secondary.png'}, {eventId: 'first', position: 1, url: 'https://example.invalid/flyer.png'}], isError: false, isPending: false }) }))
import { useEffect } from 'react'
import type { DiscoveryMapProps } from '../../map/LivingMapPage'
const mockContext = vi.hoisted(() => ({ value: null as unknown, refreshed: undefined as DiscoveryMapProps['onAuthoritativeRefresh'] }))
vi.mock('./DiscoveryMapPreview', () => ({ DiscoveryMapPreview: ({ onAreaChange, onContextReady, onAuthoritativeRefresh }: DiscoveryMapProps) => {
  useEffect(() => { onAreaChange?.({ west: -122.5, south: 37.7, east: -122.1, north: 37.9 }) }, [onAreaChange])
  useEffect(() => { if (mockContext.value) onContextReady?.({ state: () => mockContext.value as ReturnType<import('../../map/LivingMapPage').DiscoveryMapHandle['state']>, broaden: () => {} }) }, [onContextReady])
  mockContext.refreshed = onAuthoritativeRefresh
  return <section aria-label="Test map" />
} }))
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
afterEach(() => { vi.restoreAllMocks(); read.mockReset(); mockContext.value = null })
it.each(['Clear filters', 'Wheretoo discovery home'])('starts a new first page on explicit filter return via %s, retaining cached pages only for POP', async control => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
  read.mockResolvedValueOnce(page('first', 'cursor')).mockResolvedValueOnce(page('second')).mockResolvedValueOnce(page('music')).mockResolvedValueOnce(page('new-first', 'cursor'))
  const client = new QueryClient()
  const router = createMemoryRouter([{ path: '/discover', element: <DiscoveryPage /> }], { initialEntries: ['/discover'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByText('Event first')
  await userEvent.click(screen.getByRole('button', { name: 'List' }))
  expect(document.querySelector('img[src="https://example.invalid/flyer.png"]')).toBeInTheDocument()
  expect(document.querySelector('img[src="https://example.invalid/secondary.png"]')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
  await screen.findByText('Event second')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'music')
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
it('does not restore captured scroll when a same-page filter read finishes', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollTo = vi.fn()
  const mapReturn = { version: 1, path: '/discover', camera: { center: [-122.263, 37.804], zoom: 14.8, pitch: 12, bearing: 0 }, area: { west: -122.5, south: 37.7, east: -122.1, north: 37.9 }, selectedEventId: null, chooser: null }
  mockContext.value = { mapReturn, discoverySearch: '', discoveryScroll: 0, discoveryCardScroll: 0 }
  let finish!: (data: DiscoveryPageData) => void
  read.mockResolvedValueOnce(page('first')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const router = createMemoryRouter([{ path: '/discover', element: <DiscoveryPage /> }], { initialEntries: [{ pathname: '/discover', state: { mapReturn } }] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByText('Event first'); scroll.mockClear()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'music')
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  await act(async () => finish(page('music')))
  await screen.findByText('Event music')
  expect(scroll).not.toHaveBeenCalled()
})

it('does not pull the buyer back to saved scroll after interaction during a pending return read', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollTo = vi.fn()
  let finish!: (data: DiscoveryPageData) => void
  read.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const mapReturn = { version: 1, path: '/discover', camera: { center: [-122.263, 37.804], zoom: 14.8, pitch: 12, bearing: 0 }, selectedEventId: null, chooser: null }
  const router = createMemoryRouter([{ path: '/discover', element: <DiscoveryPage /> }], { initialEntries: [{ pathname: '/discover', state: { mapReturn, discoveryScroll: 800 } }] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  fireEvent.wheel(window, { deltaY: 120 })
  await act(async () => finish(page('returned')))
  await screen.findByText('Event returned')
  expect(scroll).not.toHaveBeenCalled()
})

it('replaces a stale paginated list after an accepted map refresh without an extra initial read', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  read.mockResolvedValueOnce(page('first', 'cursor')).mockResolvedValueOnce(page('second')).mockResolvedValueOnce(page('changed'))
  const router = createMemoryRouter([{ path: '/discover', element: <DiscoveryPage /> }], { initialEntries: ['/discover'] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByText('Event first')
  await userEvent.click(screen.getByRole('button', { name: 'List' }))
  await userEvent.click(screen.getByRole('button', { name: 'List' }))
  expect(read).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
  await screen.findByText('Event second')
  await act(async () => mockContext.refreshed?.({ filters: { when: 'next7', category: null, price: null }, bounds: { west: -122.5, south: 37.7, east: -122.1, north: 37.9 }, startedAt: Date.now() + 1 }))
  await screen.findByText('Event changed')
  expect(screen.queryByText('Event first')).not.toBeInTheDocument()
  expect(screen.queryByText('Event second')).not.toBeInTheDocument()
  expect(read).toHaveBeenCalledTimes(3)
  expect(read.mock.calls[2][1].cursor).toBeUndefined()
})

it('switches modes without remounting the map, refetching fresh list data, or changing filters', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  read.mockResolvedValue(page('first', 'cursor'))
  const router = createMemoryRouter([{ path: '/discover', element: <DiscoveryPage /> }], { initialEntries: ['/discover?category=music'] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByText('Event first')
  const map = screen.getByRole('region', { name: 'Test map' })
  const list = screen.getByRole('button', { name: 'List' })
  expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(list)
  expect(router.state.location.search).toBe('?category=music&view=list')
  await userEvent.click(screen.getByRole('link', { name: /^Music/ }))
  expect(router.state.location.search).toBe('?category=music&view=list')
  expect(map).toBeInTheDocument()
  expect(map.closest('[inert]')).not.toBeNull()
  expect(map.closest('[aria-hidden="true"]')).not.toBeNull()
  expect(screen.queryByRole('region', { name: 'Test map' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Events in this area' })).toBeVisible()
  expect(document.querySelector('.discovery-hero')).toBeNull()
  expect(document.querySelectorAll('.discovery-event-row')).toHaveLength(1)
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Admission' }), 'free')
  await waitFor(() => expect(router.state.location.search).toBe('?category=music&price=free&view=list'))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  await userEvent.click(screen.getByRole('button', { name: 'Map' }))
  expect(router.state.location.search).toBe('?category=music&price=free')
  expect(screen.getByRole('region', { name: 'Test map' })).toBe(map)
  expect(screen.queryByRole('heading', { name: 'Events in this area' })).not.toBeInTheDocument()
  await act(() => router.navigate(-1))
  expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
  expect(read).toHaveBeenCalledTimes(2)
})
