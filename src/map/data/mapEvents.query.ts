import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

type Result = { events: WheretooMapEvent[]; generation: number; pending: boolean; error: Error | null; complete: boolean | null }
const FRESH_MS = 60000

function sameEvents(previous: readonly WheretooMapEvent[], next: readonly WheretooMapEvent[]) {
  return previous.length === next.length && previous.every((event, i) => {
    const candidate = next[i]
    return (Object.keys(event) as Array<keyof WheretooMapEvent>).every(key => key === 'advisories'
      ? event.advisories.length === candidate.advisories.length && event.advisories.every((value, j) => value === candidate.advisories[j])
      : event[key] === candidate[key])
  })
}
type Coverage = { bounds: MapBounds; filters: string; expiresAt: number; events: WheretooMapEvent[] }
function inside(bounds: MapBounds, event: WheretooMapEvent) {
  return event.longitude >= bounds.west && event.longitude <= bounds.east && event.latitude >= bounds.south && event.latitude <= bounds.north
}
// Contradictions invalidate the whole older coverage rather than guessing which
// removals are cancellations, moderation, relocation or changed eligibility.
function agrees(previous: Coverage, bounds: MapBounds, events: WheretooMapEvent[]) {
  const oldById = new Map(previous.events.map(event => [event.id, event]))
  const newById = new Map(events.map(event => [event.id, event]))
  return previous.events.every(event => {
    const next = newById.get(event.id)
    return next ? sameEvents([event], [next]) : !inside(bounds, event)
  }) && events.every(event => !inside(previous.bounds, event) || oldById.has(event.id))
}
function unexpired(events: WheretooMapEvent[]) {
  const next = events.filter(event => Date.parse(event.endsAt) > Date.now())
  return next.length === events.length ? events : next
}
function covers(outer: MapBounds, inner: MapBounds) {
  return outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north
}

export function usePublicMapEvents(viewport: MapViewportSnapshot | null, filters: readonly EventCategory[] | null, enabled: boolean) {
  const [result, setResult] = useState<Result>({ events: [], generation: 0, pending: false, error: null, complete: null })
  const generation = useRef(0)
  const refresh = useRef<() => void>(() => {})
  const cache = useRef<Coverage[]>([])
  useEffect(() => {
    if (!enabled || !result.events.length) return
    const nextEnd = Math.min(...result.events.map(event => Date.parse(event.endsAt)))
    const timer = setTimeout(() => {
      setResult(previous => {
        const events = unexpired(previous.events)
        return events === previous.events ? previous : { ...previous, events, generation: previous.generation + 1 }
      })
    }, Math.min(2147483647, Math.max(0, nextEnd - Date.now())))
    return () => clearTimeout(timer)
  }, [enabled, result.events])
  const normalizedFilters = filters?.length ? [...new Set(filters)].sort() : null
  const key = JSON.stringify({ bounds: viewport?.bounds ?? null, filters: normalizedFilters })
  useLayoutEffect(() => {
    ++generation.current
    if (!enabled) return
    const input = JSON.parse(key) as { bounds: MapBounds | null; filters: EventCategory[] | null }
    if (!input.bounds) return
    const bounds = input.bounds, filterKey = JSON.stringify(input.filters)
    if (cache.current.some(snapshot => snapshot.filters !== filterKey)) cache.current = []
    let disposed = false, inFlight = false, lastForeground = -Infinity
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout>
    const schedule = (delay: number, retainPrevious = false) => { clearTimeout(timer); timer = setTimeout(() => { void run(retainPrevious) }, delay) }
    const run = async (retainPrevious = false) => {
      if (disposed || inFlight) return
      if (document.visibilityState === 'hidden') { schedule(FRESH_MS); return }
      inFlight = true
      if (!retainPrevious) cache.current = []
      controller = new AbortController()
      const request = ++generation.current, signal = controller.signal, now = Date.now()
      setResult(previous => ({ ...previous, pending: true, error: null }))
      try {
        const queryBounds = publicMapBounds(bounds)
        const snapshot = await getPublicMapEvents({ bounds: queryBounds, startsAt: new Date(now).toISOString(), endsAt: new Date(now + 7 * 86400000).toISOString(), categories: input.filters }, signal)
        if (disposed || signal.aborted || request !== generation.current) return
        const events = unexpired(snapshot.events)
        const previousCoverage = cache.current.filter(previous => previous.expiresAt > Date.now() && agrees(previous, queryBounds, events)).slice(0, 1)
        cache.current = snapshot.complete === true
          ? [{ bounds: queryBounds, filters: filterKey, expiresAt: now + FRESH_MS, events }, ...previousCoverage]
          : []
        setResult(previous => ({ events: sameEvents(previous.events, events) ? previous.events : events, generation: previous.generation + 1, pending: false, error: null, complete: snapshot.complete === true }))
      } catch {
        if (!disposed && !signal.aborted && request === generation.current) {
          cache.current = []
          setResult(previous => {
            const events = unexpired(previous.events)
            return { ...previous, events, generation: previous.generation + (events === previous.events ? 0 : 1), pending: false, error: new Error(previous.complete === null ? 'Events couldn’t load. Try again.' : 'Events couldn’t refresh. Try again.') }
          })
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
    const cached = cache.current.find(snapshot => snapshot.filters === filterKey && snapshot.expiresAt > Date.now() && covers(snapshot.bounds, bounds))
    if (cached) {
      cache.current = [cached, ...cache.current.filter(snapshot => snapshot !== cached)]
      const events = unexpired(cached.events)
      setResult(previous => {
        const unchanged = sameEvents(previous.events, events)
        if (unchanged && !previous.pending && !previous.error && previous.complete === true) return previous
        return { ...previous, events: unchanged ? previous.events : events, generation: previous.generation + (unchanged ? 0 : 1), pending: false, error: null, complete: true }
      })
      schedule(cached.expiresAt - Date.now())
    } else schedule(300, true)
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
