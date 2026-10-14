import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MapViewportSnapshot } from '../core/map.types'
import { getDevelopmentMapEvents } from './developmentMapEvents'
const { fetchEvents } = vi.hoisted(() => ({ fetchEvents: vi.fn() }))
vi.mock('./mapEvents.api', () => ({ getPublicMapEvents: fetchEvents }))
import { publicMapBounds, publicMapTimeWindow, usePublicMapEvents } from './mapEvents.query'
const viewport: MapViewportSnapshot = { bounds: { west: -122.3, east: -122.2, south: 37.7, north: 37.9 }, center: { longitude: -122.26, latitude: 37.8 }, zoom: 14.6 }
const events = getDevelopmentMapEvents()
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T00:00:00Z')); fetchEvents.mockReset(); fetchEvents.mockResolvedValue(events) })
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
  fetchEvents.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const { result, rerender } = renderHook(({ v }) => usePublicMapEvents(v, ['community'], true), { initialProps: { v: viewport } })
  await settle()
  rerender({ v: { ...viewport, bounds: { ...viewport.bounds, east: -122.1 } } })
  await act(async () => finish(events))
  expect(result.current.generation).toBe(0)
  fetchEvents.mockResolvedValueOnce([])
  await settle(); expect(result.current.events).toEqual([]); expect(result.current.generation).toBeGreaterThan(0)
  expect(fetchEvents.mock.calls[1][0].categories).toEqual(['community'])
})
it('retains events during failure and replaces them only after authoritative retry success', async () => {
  const { result } = renderHook(() => usePublicMapEvents(viewport, null, true))
  await settle(); const generation = result.current.generation
  fetchEvents.mockRejectedValueOnce(new Error('offline'))
  act(() => result.current.retry()); await settle()
  expect(result.current.error).toBeTruthy(); expect(result.current.events).toEqual(events); expect(result.current.generation).toBe(generation)
  fetchEvents.mockResolvedValueOnce([])
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
  expect(wrapped.west).toBeCloseTo(-123.2)
  expect(wrapped.east).toBeCloseTo(-121.8)
  const entireBay = publicMapBounds({ west: -126, east: -120, south: 35, north: 40 })
  expect(entireBay).toEqual({ west: -123.6, east: -121, south: 36.8, north: 38.9 })
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


it('computes Today in Bay Area time even across a daylight-saving boundary', () => {
  expect(publicMapTimeWindow('today', Date.parse('2026-11-01T07:30:00Z'))).toEqual({ startsAt: '2026-11-01T07:30:00.000Z', endsAt: '2026-11-02T08:00:00.000Z' })
  expect(publicMapTimeWindow('today', Date.parse('2026-03-08T08:30:00Z'))).toEqual({ startsAt: '2026-03-08T08:30:00.000Z', endsAt: '2026-03-09T07:00:00.000Z' })
})

it('queries only the present instant for Happening now', () => {
  expect(publicMapTimeWindow('now', Date.parse('2026-10-14T02:00:00Z'))).toEqual({ startsAt: '2026-10-14T02:00:00.000Z', endsAt: '2026-10-14T02:00:00.001Z' })
})

it('normalizes equivalent category selections and refetches when time filter changes', async () => {
  const { rerender } = renderHook(({ filters, time }) => usePublicMapEvents(viewport, filters, true, time), { initialProps: { filters: ['music', 'community', 'music'] as Array<'music' | 'community'>, time: 'next7days' as 'next7days' | 'today' } })
  await settle()
  expect(fetchEvents.mock.calls[0][0].categories).toEqual(['community', 'music'])
  rerender({ filters: ['community', 'music'], time: 'next7days' })
  await settle()
  expect(fetchEvents).toHaveBeenCalledTimes(1)
  rerender({ filters: ['community', 'music'], time: 'today' })
  await settle()
  expect(fetchEvents.mock.calls[1][0].endsAt).toBe('2026-09-29T07:00:00.000Z')
})
