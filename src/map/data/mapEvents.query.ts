import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { EventCategory } from '../../features/events/event.types'
import type { MapBounds, MapViewportSnapshot } from '../core/map.types'
import { getPublicMapEvents } from './mapEvents.api'
import type { WheretooMapEvent } from './wheretooMapEvents'
import { SERVICE_BOUNDS } from '../core/map.constants'

export type MapTimeFilter = 'next7days' | 'today' | 'now'

export function publicMapBounds(bounds: MapBounds): MapBounds {
  if (!Object.values(bounds).every(Number.isFinite) || bounds.south >= bounds.north || bounds.west >= bounds.east) throw new Error('Invalid map bounds')
  const width = bounds.east - bounds.west
  const padX = width * 0.2
  const padY = (bounds.north - bounds.south) * 0.2
  const normalizedWest = ((bounds.west + 180) % 360 + 360) % 360 - 180
  const west = Math.max(SERVICE_BOUNDS[0][0], normalizedWest - padX)
  const east = Math.min(SERVICE_BOUNDS[1][0], normalizedWest + width + padX)
  const south = Math.max(SERVICE_BOUNDS[0][1], bounds.south - padY)
  const north = Math.min(SERVICE_BOUNDS[1][1], bounds.north + padY)
  if (south >= north || west >= east) throw new Error('Invalid map bounds')
  const round = (value: number) => Math.round(value * 100000) / 100000
  return { west: round(west), east: round(east), south: round(south), north: round(north) }
}

const bayAreaDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
function localParts(instant: number) {
  return Object.fromEntries(bayAreaDate.formatToParts(instant).map(part => [part.type, Number(part.value)]))
}

export function publicMapTimeWindow(filter: MapTimeFilter, now = Date.now()) {
  let end = now + 7 * 86400000
  if (filter === 'now') end = now + 1
  if (filter === 'today') {
    const local = localParts(now)
    const target = Date.UTC(local.year, local.month - 1, local.day + 1)
    end = target
    // Resolve the next Bay Area midnight using its own offset, including DST days.
    for (let pass = 0; pass < 3; pass++) {
      const candidate = localParts(end)
      const wallClock = Date.UTC(candidate.year, candidate.month - 1, candidate.day, candidate.hour, candidate.minute, candidate.second)
      end += target - wallClock
    }
  }
  return { startsAt: new Date(now).toISOString(), endsAt: new Date(end).toISOString() }
}

type Result = { events: WheretooMapEvent[]; generation: number; pending: boolean; error: Error | null }
export function usePublicMapEvents(viewport: MapViewportSnapshot | null, filters: readonly EventCategory[] | null, enabled: boolean, timeFilter: MapTimeFilter = 'next7days') {
  const [result, setResult] = useState<Result>({ events: [], generation: 0, pending: false, error: null })
  const generation = useRef(0)
  const refresh = useRef<() => void>(() => {})
  const normalizedFilters = filters?.length ? [...new Set(filters)].sort() : null
  const key = JSON.stringify({ bounds: viewport?.bounds ?? null, filters: normalizedFilters, timeFilter })
  useLayoutEffect(() => {
    // Cleanup invalidates immediately on a new viewport, not after debounce.
    ++generation.current
    if (!enabled) return
    const input = JSON.parse(key) as { bounds: MapBounds | null; filters: EventCategory[] | null; timeFilter: MapTimeFilter }
    const bounds = input.bounds
    if (!bounds) return
    let controller: AbortController | null = null
    const run = () => {
      controller?.abort()
      controller = new AbortController()
      const request = ++generation.current
      const signal = controller.signal
      setResult(previous => ({ ...previous, pending: true, error: null }))
      void (async () => {
        try {
          const events = await getPublicMapEvents({ bounds: publicMapBounds(bounds), ...publicMapTimeWindow(input.timeFilter), categories: input.filters }, signal)
          if (request === generation.current && !signal.aborted) setResult({ events, generation: request, pending: false, error: null })
        } catch {
          if (request === generation.current && !signal.aborted) setResult(previous => ({ ...previous, pending: false, error: new Error('Events couldn’t refresh. Your last map results are still shown.') }))
        }
      })()
    }
    const foreground = () => { if (document.visibilityState === 'visible') run() }
    const timer = window.setTimeout(run, 300)
    const interval = window.setInterval(foreground, 60000)
    refresh.current = run
    window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      controller?.abort()
      window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('focus', foreground)
      document.removeEventListener('visibilitychange', foreground)
      refresh.current = () => {}
    }
  }, [key, enabled])
  const retry = useCallback(() => refresh.current(), [])
  return { ...result, retry }
}
