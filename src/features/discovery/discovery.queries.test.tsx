import { usePublicMapEvents } from '../../map/data/mapEvents.query'
import type { MapViewportSnapshot } from '../../map/core/map.types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DiscoveryReadError } from './discovery.api'
import { useDiscovery } from './discovery.queries'
import type { DiscoveryFilters, DiscoveryPageData } from './discovery.types'

const { read, readMap } = vi.hoisted(() => ({ read: vi.fn(), readMap: vi.fn() }))
vi.mock('../../map/data/mapEvents.api', () => ({ getFilteredPublicMapEvents: readMap }))
vi.mock('./discovery.api', async importOriginal => ({ ...await importOriginal<typeof import('./discovery.api')>(), getDiscoveryPage: read }))
const filters: DiscoveryFilters = { when: 'upcoming', category: null, price: null }
function page(ids: string[], cursor: string | null = null): DiscoveryPageData {
  return { items: ids.map(id => ({ id, title: `Event ${id}`, category: 'music', admissionType: 'paid', startsAt: '2026-09-14T03:00:00Z', endsAt: '2026-09-14T06:00:00Z', timezone: 'America/Los_Angeles', venueName: 'The venue', city: 'San Francisco', artworkReference: null, admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null } })), nextCursor: cursor, serverNow: '2026-09-13T12:00:00Z', window: { start: '2026-09-13T12:00:00Z', end: '2026-10-13T07:00:00Z', timezone: 'America/Los_Angeles' }, invalidItemCount: 0 }
}
function setup(initial = filters) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
  return { client, wrapper: Wrapper, ...renderHook(({ value }) => useDiscovery(value), { initialProps: { value: initial }, wrapper: Wrapper }) }
}
beforeEach(() => { read.mockReset() })
afterEach(() => vi.useRealTimers())

it('fetches one first page, appends a bounded page, and deduplicates live ordering changes', async () => {
  read.mockResolvedValueOnce(page(['a', 'b'], 'next')).mockResolvedValueOnce(page(['b', 'c']))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(2))
  await act(() => view.result.current.loadMore())
  expect(view.result.current.items.map(item => item.id)).toEqual(['a', 'b', 'c'])
  expect(read.mock.calls[1][1]).toMatchObject({ cursor: 'next' })
  expect(view.result.current.hasMore).toBe(false)
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not display an old filter or append response after filters change', async () => {
  let finish!: (data: DiscoveryPageData) => void
  read.mockResolvedValueOnce(page(['old'], 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(page(['new']))
  const view = setup()
  await waitFor(() => expect(view.result.current.items[0]?.id).toBe('old'))
  let append!: Promise<void>
  act(() => { append = view.result.current.loadMore() })
  const signal = read.mock.calls[1][1].signal as AbortSignal
  view.rerender({ value: { ...filters, price: 'free' } })
  expect(view.result.current.items).toEqual([])
  await waitFor(() => expect(view.result.current.items[0]?.id).toBe('new'))
  await act(async () => { finish(page(['obsolete'])); await append })
  expect(signal.aborted).toBe(true)
  expect(view.result.current.items.map(item => item.id)).toEqual(['new'])
})

it('refresh replaces the page chain and an older append cannot restore it', async () => {
  let finish!: (data: DiscoveryPageData) => void
  read.mockResolvedValueOnce(page(['old'], 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(page(['fresh']))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(1))
  let append!: Promise<void>
  act(() => { append = view.result.current.loadMore() })
  await act(() => view.result.current.refresh())
  await act(async () => { finish(page(['obsolete'])); await append })
  expect(view.result.current.items.map(item => item.id)).toEqual(['fresh'])
})

it('keeps same-query rows with a stale notice when refresh fails', async () => {
  read.mockResolvedValueOnce(page(['old'])).mockRejectedValueOnce(new DiscoveryReadError('unavailable'))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(1))
  await act(() => view.result.current.refresh())
  await waitFor(() => expect(view.result.current.notice).toContain('refresh'))
  expect(view.result.current.items[0].id).toBe('old')
  expect(view.result.current.status).toBe('ready')
})

it('restarts once from page one on an expired append cursor', async () => {
  read.mockResolvedValueOnce(page(['old'], 'expired')).mockRejectedValueOnce(new DiscoveryReadError('cursor')).mockResolvedValueOnce(page(['fresh']))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(1))
  await act(() => view.result.current.loadMore())
  await waitFor(() => expect(view.result.current.items[0].id).toBe('fresh'))
  expect(read).toHaveBeenCalledTimes(3)
  expect(read.mock.calls[2][1].cursor).toBeUndefined()
  expect(view.result.current.notice).toContain('updated')
})

it('retains cached loaded rows on a fresh return but starts a new client at page one', async () => {
  read.mockResolvedValueOnce(page(['a'], 'next')).mockResolvedValueOnce(page(['b']))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(1))
  await act(() => view.result.current.loadMore())
  view.unmount()
  const returned = renderHook(() => useDiscovery(filters), { wrapper: view.wrapper })
  expect(returned.result.current.items.map(item => item.id)).toEqual(['a', 'b'])
  expect(read).toHaveBeenCalledTimes(2)
  read.mockResolvedValueOnce(page(['new-first'], 'next'))
  const reloaded = setup()
  await waitFor(() => expect(reloaded.result.current.items[0]?.id).toBe('new-first'))
  expect(read).toHaveBeenCalledTimes(3)
})

it('prevents a retry storm during the server rate-limit delay', async () => {
  read.mockRejectedValueOnce(new DiscoveryReadError('rate_limited', 30))
  const view = setup()
  await waitFor(() => expect(view.result.current.retryAfterSeconds).toBeGreaterThan(0))
  await act(() => view.result.current.refresh())
  expect(read).toHaveBeenCalledTimes(1)
  expect(view.result.current.errorKind).toBe('rate_limited')
})

it('discards an aborted append state when returning to its filter', async () => {
  let finish!: (data: DiscoveryPageData) => void
  read.mockResolvedValueOnce(page(['first'], 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(page(['music']))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(1))
  let append!: Promise<void>
  act(() => { append = view.result.current.loadMore() })
  expect(view.result.current.isLoadingMore).toBe(true)
  view.rerender({ value: { ...filters, category: 'music' } })
  await waitFor(() => expect(view.result.current.items[0]?.id).toBe('music'))
  await act(async () => { finish(page(['obsolete'])); await append })
  view.rerender({ value: filters })
  expect(view.result.current.items[0]?.id).toBe('first')
  expect(view.result.current.isLoadingMore).toBe(false)
  expect(view.result.current.moreError).toBeNull()
})

it('discards an old append failure after a successful automatic first-page refresh', async () => {
  read.mockResolvedValueOnce(page(['first'], 'next')).mockRejectedValueOnce(new DiscoveryReadError('unavailable')).mockResolvedValueOnce(page(['fresh'], 'new-next'))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(1))
  await act(() => view.result.current.loadMore())
  expect(view.result.current.moreError).not.toBeNull()
  await act(() => view.client.invalidateQueries({ queryKey: ['public-discovery'] }))
  await waitFor(() => expect(view.result.current.items[0]?.id).toBe('fresh'))
  expect(view.result.current.moreError).toBeNull()
})

it('rejects an old append even when a focus refresh returns an identical first page', async () => {
  let finish!: (data: DiscoveryPageData) => void
  read.mockResolvedValueOnce(page(['first'], 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(page(['first'], 'next'))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(1))
  let append!: Promise<void>
  act(() => { append = view.result.current.loadMore() })
  await act(() => view.client.invalidateQueries({ queryKey: ['public-discovery'] }))
  await act(async () => { finish(page(['obsolete'])); await append })
  expect(view.result.current.items.map(item => item.id)).toEqual(['first'])
  expect(view.result.current.isLoadingMore).toBe(false)
})

it('can load more after an automatic refresh before the obsolete append settles', async () => {
  let finishOld!: (data: DiscoveryPageData) => void
  let finishNew!: (data: DiscoveryPageData) => void
  read.mockResolvedValueOnce(page(['first'], 'next'))
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValueOnce(page(['first'], 'next'))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
  const view = setup()
  await waitFor(() => expect(view.result.current.items).toHaveLength(1))
  let oldAppend!: Promise<void>
  act(() => { oldAppend = view.result.current.loadMore() })
  const oldSignal = read.mock.calls[1][1].signal as AbortSignal

  await act(() => view.client.invalidateQueries({ queryKey: ['public-discovery'] }))
  let newAppend!: Promise<void>
  act(() => { newAppend = view.result.current.loadMore() })
  expect(read).toHaveBeenCalledTimes(4)
  expect(oldSignal.aborted).toBe(true)
  expect(read.mock.calls[3][1]).toMatchObject({ cursor: 'next' })

  await act(async () => { finishOld(page(['obsolete'])); await oldAppend })
  expect(view.result.current.items.map(item => item.id)).toEqual(['first'])
  expect(view.result.current.isLoadingMore).toBe(true)
  expect((read.mock.calls[3][1].signal as AbortSignal).aborted).toBe(false)

  await act(async () => { finishNew(page(['current'])); await newAppend })
  expect(view.result.current.items.map(item => item.id)).toEqual(['first', 'current'])
  expect(view.result.current.isLoadingMore).toBe(false)
})

it('waits for the map area and isolates pagination/cache when the viewport changes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
  read.mockResolvedValueOnce(page(['a'], 'next')).mockResolvedValueOnce(page(['b']))
  const area = { west: -122.4, south: 37.7, east: -122.1, north: 37.9 }
  const view = renderHook(({ bounds }) => useDiscovery(filters, bounds), { initialProps: { bounds: null as import('../../map/core/map.types').MapBounds | null }, wrapper: Wrapper })
  expect(read).not.toHaveBeenCalled()
  view.rerender({ bounds: area }); await waitFor(() => expect(view.result.current.items[0]?.id).toBe('a'))
  expect(read.mock.calls[0][1].bounds).toEqual(area)
  view.rerender({ bounds: { ...area, west: -122.3 } }); await waitFor(() => expect(view.result.current.items[0]?.id).toBe('b'))
  expect(view.result.current.hasMore).toBe(false)
})
it('does not present an ongoing prior-weekend event as next-weekend after a failed midnight read', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T07:59:50Z'))
  const first = page(['weekend'])
  first.items[0] = { ...first.items[0], startsAt: '2026-11-02T07:00:00Z', endsAt: '2026-11-02T10:00:00Z' }
  first.serverNow = new Date().toISOString(); first.window = { start: '2026-10-30T07:00:00Z', end: '2026-11-02T08:00:00Z', timezone: 'America/Los_Angeles' }
  read.mockResolvedValueOnce(first).mockRejectedValue(new DiscoveryReadError('unavailable'))
  const view = setup({ when: 'weekend', category: null, price: null })
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(view.result.current.items).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(10025) })
  expect(read).toHaveBeenCalledTimes(2)
  expect(view.result.current.items).toEqual([])
})

const refreshArea = { west: -122.3, south: 37.7, east: -122.2, north: 37.9 }
function scopedSetup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
  return { client, ...renderHook(() => useDiscovery(filters, refreshArea), { wrapper: Wrapper }) }
}
const mapRefresh = () => ({ filters, bounds: refreshArea, startedAt: Date.now() + 1 })

it('refreshes edited/cancelled list rows through 122 seconds of accepted map revalidation, including partial maps', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13T12:00:00Z'))
  readMap.mockReset(); readMap.mockResolvedValue({ events: [], complete: false })
  const updated = page(['still-listed'])
  updated.items[0].title = 'Edited authoritative title'
  read.mockResolvedValueOnce(page(['cancelled', 'still-listed'])).mockResolvedValue(updated)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
  const viewport: MapViewportSnapshot = { bounds: refreshArea, center: { longitude: -122.25, latitude: 37.8 }, zoom: 14 }
  const view = renderHook(() => {
    const list = useDiscovery(filters, refreshArea)
    usePublicMapEvents(viewport, null, true, { discovery: filters, onAuthoritativeRefresh: refresh => { void list.refreshAfterMap(refresh) } })
    return list
  }, { wrapper: Wrapper })
  await act(async () => { await vi.advanceTimersByTimeAsync(301) })
  expect(read).toHaveBeenCalledTimes(1); expect(readMap).toHaveBeenCalledTimes(1)
  // Omission from the initial capped map cannot remove a valid list row.
  expect(view.result.current.items.map(item => item.id)).toEqual(['cancelled', 'still-listed'])
  await act(async () => { await vi.advanceTimersByTimeAsync(122000) })
  expect(view.result.current.items.map(item => item.id)).toEqual(['still-listed'])
  expect(view.result.current.items[0].title).toBe('Edited authoritative title')
  expect(readMap).toHaveBeenCalledTimes(3); expect(read).toHaveBeenCalledTimes(3)
  expect(read.mock.calls.every(call => !call[1].cursor && JSON.stringify(call[1].bounds) === JSON.stringify(refreshArea))).toBe(true)
  await act(async () => {
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(readMap).toHaveBeenCalledTimes(4); expect(read).toHaveBeenCalledTimes(4)
})

it('coalesces accepted map notifications with a pending/fresher list refresh and rejects other areas/filters', async () => {
  let finish!: (data: DiscoveryPageData) => void
  read.mockResolvedValueOnce(page(['first'])).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = scopedSetup()
  await waitFor(() => expect(view.result.current.items[0]?.id).toBe('first'))
  const refresh = mapRefresh()
  await act(() => view.result.current.refreshAfterMap({ ...refresh, bounds: { ...refreshArea, west: -122.4 } }))
  await act(() => view.result.current.refreshAfterMap({ ...refresh, filters: { ...filters, price: 'free' } }))
  expect(read).toHaveBeenCalledTimes(1)
  let pending!: Promise<void>
  act(() => { pending = view.result.current.refreshAfterMap(refresh) })
  await act(() => view.result.current.refreshAfterMap(refresh))
  expect(read).toHaveBeenCalledTimes(2)
  await act(async () => { finish(page(['new'])); await pending })
  await act(() => view.result.current.refreshAfterMap({ ...refresh, startedAt: refresh.startedAt - 1 }))
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not resurrect a pending append after map refresh and honors the list rate-limit cooldown', async () => {
  let finish!: (data: DiscoveryPageData) => void
  read.mockResolvedValueOnce(page(['first'], 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(page(['fresh'])).mockRejectedValueOnce(new DiscoveryReadError('rate_limited', 30))
  const view = scopedSetup()
  await waitFor(() => expect(view.result.current.items[0]?.id).toBe('first'))
  let pending!: Promise<void>
  act(() => { pending = view.result.current.loadMore() })
  const signal = read.mock.calls[1][1].signal as AbortSignal
  await act(() => view.result.current.refreshAfterMap(mapRefresh()))
  await act(async () => { finish(page(['obsolete'])); await pending })
  expect(signal.aborted).toBe(true)
  expect(view.result.current.items.map(item => item.id)).toEqual(['fresh'])
  await act(() => view.result.current.refreshAfterMap(mapRefresh()))
  await waitFor(() => expect(view.result.current.retryAfterSeconds).toBeGreaterThan(0))
  await act(() => view.result.current.refreshAfterMap(mapRefresh()))
  expect(read).toHaveBeenCalledTimes(4)
})
