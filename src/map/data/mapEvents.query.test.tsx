import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MapViewportSnapshot } from '../core/map.types'
import { getDevelopmentMapEvents } from './developmentMapEvents'
const { fetchEvents } = vi.hoisted(() => ({ fetchEvents: vi.fn() }))
vi.mock('./mapEvents.api', () => ({ getPublicMapEvents: fetchEvents }))
import { publicMapBounds, usePublicMapEvents } from './mapEvents.query'
const viewport: MapViewportSnapshot = { bounds: { west: -122.3, east: -122.2, south: 37.7, north: 37.9 }, center: { longitude: -122.26, latitude: 37.8 }, zoom: 14.6 }
const events = getDevelopmentMapEvents()
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T00:00:00Z')); fetchEvents.mockReset(); fetchEvents.mockResolvedValue({ events, complete: true }) })
afterEach(() => { vi.useRealTimers() })
const settle = async (ms = 300) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
it('debounces the ready viewport, pads bounds and renews the seven-day window', async () => {
  const { result } = renderHook(() => usePublicMapEvents(viewport, null, true))
  await settle(299); expect(fetchEvents).not.toHaveBeenCalled()
  await settle(1); expect(result.current.events).toEqual(events)
  const query = fetchEvents.mock.calls[0][0]
  expect(query.bounds.west).toBeLessThan(viewport.bounds.west)
  expect(query.bounds.east).toBeGreaterThan(viewport.bounds.east)
  expect(Date.parse(query.endsAt) - Date.parse(query.startsAt)).toBe(7 * 86400000)
  expect(query.categories).toBeNull()
  await settle(60000); expect(fetchEvents).toHaveBeenCalledTimes(2)
  expect(fetchEvents.mock.calls[1][0].startsAt).not.toBe(query.startsAt)
})
it('invalidates old success immediately when the viewport changes, before the next request', async () => {
  let finish!: (value: typeof events) => void
  fetchEvents.mockReturnValueOnce(new Promise(resolve => { finish = value => resolve({ events: value, complete: true }) }))
  const { result, rerender } = renderHook(({ v }) => usePublicMapEvents(v, ['community'], true), { initialProps: { v: viewport } })
  await settle()
  rerender({ v: { ...viewport, bounds: { ...viewport.bounds, east: -122.1 } } })
  await act(async () => finish(events))
  expect(result.current.generation).toBe(0)
  fetchEvents.mockResolvedValueOnce({ events: [], complete: true })
  await settle(); expect(result.current.events).toEqual([]); expect(result.current.generation).toBeGreaterThan(0)
  expect(fetchEvents.mock.calls[1][0].categories).toEqual(['community'])
})
it('retains events during failure and replaces them only after authoritative retry success', async () => {
  const { result } = renderHook(() => usePublicMapEvents(viewport, null, true))
  await settle(); const generation = result.current.generation
  fetchEvents.mockRejectedValueOnce(new Error('offline'))
  act(() => result.current.retry()); await settle()
  expect(result.current.error).toBeTruthy(); expect(result.current.events).toEqual(events); expect(result.current.generation).toBe(generation)
  fetchEvents.mockResolvedValueOnce({ events: [], complete: true })
  act(() => result.current.retry()); await settle()
  expect(result.current.error).toBeNull(); expect(result.current.events).toEqual([])
})
it('refreshes on foreground and ignores late failures after a new viewport or unmount', async () => {
  let reject!: (e: Error) => void
  fetchEvents.mockReturnValueOnce(new Promise((_, r) => { reject = r }))
  const { result, rerender, unmount } = renderHook(({ v }) => usePublicMapEvents(v, null, true), { initialProps: { v: viewport } })
  await settle(); rerender({ v: { ...viewport, bounds: { ...viewport.bounds, east: -122.1 } } })
  await act(async () => reject(new Error('old'))); expect(result.current.error).toBeNull()
  await settle(); act(() => window.dispatchEvent(new Event('focus'))); await settle()
  expect(fetchEvents).toHaveBeenCalledTimes(3)
  unmount(); await settle(60000); expect(fetchEvents).toHaveBeenCalledTimes(3)
})
it('normalizes wrapped bounds and never emits an invalid antimeridian envelope', () => {
  const wrapped = publicMapBounds({ west: 237, east: 238, south: 37, north: 38 })
  expect(wrapped.west).toBeCloseTo(-123.1)
  expect(wrapped.east).toBeCloseTo(-121.9)
  const crossing = publicMapBounds({ west: 179, east: 181, south: -100, north: 100 })
  expect(crossing).toEqual({ west: -180, east: 180, south: -90, north: 90 })
  expect(() => publicMapBounds({ west: NaN, east: 0, south: 1, north: 2 })).toThrow()
})

it('does not poll hidden pages and refreshes when visible again', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get')
  visibility.mockReturnValue('visible')
  renderHook(() => usePublicMapEvents(viewport, null, true))
  await settle()
  visibility.mockReturnValue('hidden')
  await settle(60000); expect(fetchEvents).toHaveBeenCalledTimes(1)
  visibility.mockReturnValue('visible')
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await settle(0); expect(fetchEvents).toHaveBeenCalledTimes(2)
  visibility.mockRestore()
})

it('coalesces paired foreground notifications while retaining authoritative changes', async () => {
  const { result } = renderHook(() => usePublicMapEvents(viewport, null, true))
  await settle()
  fetchEvents.mockResolvedValueOnce({ events: [], complete: true })
  act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
  await settle(0)
  expect(fetchEvents).toHaveBeenCalledTimes(2)
  expect(result.current.events).toEqual([])
})
it('reuses fresh complete coverage without extending its expiry', async () => {
  const { rerender } = renderHook(({ v }) => usePublicMapEvents(v, null, true), { initialProps: { v: viewport } })
  await settle()
  await settle(30000)
  rerender({ v: { ...viewport, bounds: { west: -122.29, east: -122.21, south: 37.72, north: 37.88 } } })
  await settle(300)
  expect(fetchEvents).toHaveBeenCalledTimes(1)
  await settle(30000)
  expect(fetchEvents).toHaveBeenCalledTimes(2)
})
it.each([false, undefined])('never reuses coverage without explicit completeness (%s)', async complete => {
  fetchEvents.mockResolvedValue({ events, complete })
  const { rerender } = renderHook(({ v }) => usePublicMapEvents(v, null, true), { initialProps: { v: viewport } })
  await settle()
  rerender({ v: { ...viewport, bounds: { west: -122.29, east: -122.21, south: 37.72, north: 37.88 } } })
  await settle()
  expect(fetchEvents).toHaveBeenCalledTimes(2)
})
it('refreshes filters and keeps identical snapshot identity but applies edits and removals', async () => {
  const { result, rerender } = renderHook(({ filters }) => usePublicMapEvents(viewport, filters, true), { initialProps: { filters: null as null | ['community'] } })
  await settle(); const original = result.current.events
  fetchEvents.mockResolvedValueOnce({ events: events.map(e => ({ ...e, advisories: [...e.advisories] })), complete: true })
  act(() => result.current.retry()); await settle(0)
  expect(result.current.events).toBe(original)
  fetchEvents.mockResolvedValueOnce({ events: [{ ...events[0], title: 'Changed title' }], complete: true })
  rerender({ filters: ['community'] }); await settle()
  expect(result.current.events).toHaveLength(1)
  expect(result.current.events[0].title).toBe('Changed title')
})
it('ignores a late uncovered response after returning to cached coverage', async () => {
  const { result, rerender } = renderHook(({ v }) => usePublicMapEvents(v, null, true), { initialProps: { v: viewport } })
  await settle()
  let finish!: () => void
  fetchEvents.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve({ events: [], complete: true }) }))
  rerender({ v: { ...viewport, bounds: { ...viewport.bounds, east: -122.1 } } }); await settle()
  rerender({ v: viewport }); await settle(0)
  await act(async () => finish())
  expect(result.current.events).toEqual(events)
  expect(result.current.pending).toBe(false)
  expect(fetchEvents).toHaveBeenCalledTimes(2)
})
