import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { EventCategory } from '../../features/events/event.types'
import type { MapBounds, MapViewportSnapshot } from '../core/map.types'
import { getPublicMapEvents } from './mapEvents.api'
import type { WheretooMapEvent } from './wheretooMapEvents'

export function publicMapBounds(bounds: MapBounds): MapBounds {
  if (!Object.values(bounds).every(Number.isFinite) || bounds.south >= bounds.north || bounds.west >= bounds.east) throw new Error('Invalid map bounds')
  const width = bounds.east - bounds.west
  const padX = Math.min(width * 0.1, 0.5)
  const padY = Math.min((bounds.north - bounds.south) * 0.1, 0.25)
  const west = ((bounds.west + 180) % 360 + 360) % 360 - 180 - padX
  const east = west + width + 2 * padX
  const south = Math.max(-90, bounds.south - padY)
  const north = Math.min(90, bounds.north + padY)
  if (south >= north) throw new Error('Invalid map bounds')
  // The RPC accepts a single non-wrapping envelope. A world envelope safely
  // includes both sides of a dateline view rather than dropping one side.
  return { west: west < -180 || east > 180 ? -180 : west, east: west < -180 || east > 180 ? 180 : east, south, north }
}

type Result = { events: WheretooMapEvent[]; generation: number; pending: boolean; error: Error | null }
const FRESH_MS = 60000

function sameEvents(previous: readonly WheretooMapEvent[], next: readonly WheretooMapEvent[]) {
  return previous.length === next.length && previous.every((event, i) => {
    const candidate = next[i]
    return (Object.keys(event) as Array<keyof WheretooMapEvent>).every(key => key === 'advisories'
      ? event.advisories.length === candidate.advisories.length && event.advisories.every((value, j) => value === candidate.advisories[j])
      : event[key] === candidate[key])
  })
}
function covers(outer: MapBounds, inner: MapBounds) {
  return outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north
}

export function usePublicMapEvents(viewport: MapViewportSnapshot | null, filters: readonly EventCategory[] | null, enabled: boolean) {
  const [result, setResult] = useState<Result>({ events: [], generation: 0, pending: false, error: null })
  const generation = useRef(0)
  const refresh = useRef<() => void>(() => {})
  const cache = useRef<{ bounds: MapBounds; filters: string; expiresAt: number; complete: boolean } | null>(null)
  const normalizedFilters = filters?.length ? [...new Set(filters)].sort() : null
  const key = JSON.stringify({ bounds: viewport?.bounds ?? null, filters: normalizedFilters })
  useLayoutEffect(() => {
    ++generation.current
    if (!enabled) return
    const input = JSON.parse(key) as { bounds: MapBounds | null; filters: EventCategory[] | null }
    if (!input.bounds) return
    const bounds = input.bounds, filterKey = JSON.stringify(input.filters)
    let disposed = false, inFlight = false, lastForeground = -Infinity
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout>
    const schedule = (delay: number) => { clearTimeout(timer); timer = setTimeout(() => { void run() }, delay) }
    const run = async () => {
      if (disposed || inFlight) return
      if (document.visibilityState === 'hidden') { schedule(FRESH_MS); return }
      inFlight = true
      controller = new AbortController()
      const request = ++generation.current, signal = controller.signal, now = Date.now()
      setResult(previous => ({ ...previous, pending: true, error: null }))
      try {
        const queryBounds = publicMapBounds(bounds)
        const snapshot = await getPublicMapEvents({ bounds: queryBounds, startsAt: new Date(now).toISOString(), endsAt: new Date(now + 7 * 86400000).toISOString(), categories: input.filters }, signal)
        if (disposed || signal.aborted || request !== generation.current) return
        cache.current = { bounds: queryBounds, filters: filterKey, expiresAt: now + FRESH_MS, complete: snapshot.complete === true }
        setResult(previous => ({ events: sameEvents(previous.events, snapshot.events) ? previous.events : snapshot.events, generation: request, pending: false, error: null }))
      } catch {
        if (!disposed && !signal.aborted && request === generation.current) {
          cache.current = null
          setResult(previous => ({ ...previous, pending: false, error: new Error('Events couldn’t refresh. Your last map results are still shown.') }))
        }
      } finally {
        inFlight = false
        if (!disposed) schedule(Math.max(0, now + FRESH_MS - Date.now()))
      }
    }
    const foreground = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastForeground < 250) return
      lastForeground = Date.now(); void run()
    }
    const cached = cache.current
    if (cached?.complete && cached.filters === filterKey && cached.expiresAt > Date.now() && covers(cached.bounds, bounds)) {
      setResult(previous => previous.pending ? { ...previous, pending: false } : previous)
      schedule(cached.expiresAt - Date.now())
    } else schedule(300)
    refresh.current = () => { void run() }
    window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      disposed = true; controller?.abort(); clearTimeout(timer)
      window.removeEventListener('focus', foreground)
      document.removeEventListener('visibilitychange', foreground)
      refresh.current = () => {}
    }
  }, [key, enabled])
  const retry = useCallback(() => refresh.current(), [])
  return { ...result, retry }
}
