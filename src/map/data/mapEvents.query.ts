import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EventCategory } from '../../features/events/event.types'
import type { MapBounds, MapViewportSnapshot } from '../core/map.types'
import type { DiscoveryFilters } from '../../features/discovery/discovery.types'
import { discoveryBounds } from '../../features/discovery/discovery.scope'
import { nextDiscoveryMidnight } from '../../features/discovery/discovery.time'
import { getFilteredPublicMapEvents, getPublicMapEvents } from './mapEvents.api'
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

// A successful network revalidation, independent of marker revisions or coverage
// completeness. Consumers must read their own authoritative list endpoint.
export type MapAuthoritativeRefresh = { filters: DiscoveryFilters; bounds: MapBounds; startedAt: number }

type Result = { events: WheretooMapEvent[]; generation: number; pending: boolean; error: Error | null; complete: boolean | null; identity?: string; serverOffset?: number; windowEnd?: number; bounds?: MapBounds }
const FRESH_MS = 60000

function sameEvents(previous: readonly WheretooMapEvent[], next: readonly WheretooMapEvent[]) {
  return previous.length === next.length && previous.every((event, i) => {
    const candidate = next[i]
    return (Object.keys(event) as Array<keyof WheretooMapEvent>).every(key => key === 'advisories'
      ? event.advisories.length === candidate.advisories.length && event.advisories.every((value, j) => value === candidate.advisories[j])
      : event[key] === candidate[key])
  })
}
type Coverage = { bounds: MapBounds; filters: string; expiresAt: number; events: WheretooMapEvent[]; serverOffset?: number; windowEnd?: number }
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
function unexpired(events: WheretooMapEvent[], asOf = Date.now()) {
  const next = events.filter(event => Date.parse(event.endsAt) > asOf)
  return next.length === events.length ? events : next
}
function covers(outer: MapBounds, inner: MapBounds) {
  return outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north
}

export function usePublicMapEvents(viewport: MapViewportSnapshot | null, filters: readonly EventCategory[] | null, enabled: boolean, options?: { discovery: DiscoveryFilters; onSettledBounds?(bounds: MapBounds): void; onAuthoritativeRefresh?(refresh: MapAuthoritativeRefresh): void }) {
  const [result, setResult] = useState<Result>({ events: [], generation: 0, pending: false, error: null, complete: null })
  const observer = useRef(options?.onSettledBounds)
  useLayoutEffect(() => { observer.current = options?.onSettledBounds }, [options?.onSettledBounds])
  const refreshObserver = useRef(options?.onAuthoritativeRefresh)
  useLayoutEffect(() => { refreshObserver.current = options?.onAuthoritativeRefresh }, [options?.onAuthoritativeRefresh])
  const generation = useRef(0)
  const refresh = useRef<() => void>(() => {})
  const cache = useRef<Coverage[]>([])
  useEffect(() => {
    if (!enabled || !result.events.length) return
    const nextEnd = Math.min(result.windowEnd ?? Infinity, ...result.events.map(event => Date.parse(event.endsAt)))
    const timer = setTimeout(() => {
      setResult(previous => {
        const events = previous.windowEnd && Date.now() + (previous.serverOffset ?? 0) >= previous.windowEnd ? [] : unexpired(previous.events, Date.now() + (previous.serverOffset ?? 0))
        return events === previous.events ? previous : { ...previous, events, generation: previous.generation + 1 }
      })
    }, Math.min(2147483647, Math.max(0, nextEnd - Date.now() - (result.serverOffset ?? 0))))
    return () => clearTimeout(timer)
  }, [enabled, result.events, result.serverOffset, result.windowEnd])
  const normalizedFilters = filters?.length ? [...new Set(filters)].sort() : null
  const key = JSON.stringify({ bounds: viewport?.bounds ?? null, filters: normalizedFilters, discovery: options?.discovery ?? null })
  const identity = JSON.stringify({ categories: normalizedFilters, discovery: options?.discovery ?? null })
  if (options?.discovery && result.identity !== identity) setResult({ events: [], generation: result.generation + 1, pending: Boolean(viewport), complete: null, error: null, identity, serverOffset: result.serverOffset })
  useLayoutEffect(() => {
    ++generation.current
    if (!enabled) return
    const input = JSON.parse(key) as { bounds: MapBounds | null; filters: EventCategory[] | null; discovery: DiscoveryFilters | null }
    if (!input.bounds) return
    const bounds = input.bounds, filterKey = JSON.stringify({ categories: input.filters, discovery: input.discovery })
    const areaTimer = setTimeout(() => { observer.current?.(discoveryBounds(bounds)) }, 300)
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
      let nextRefreshAt = now + FRESH_MS
      setResult(previous => ({ ...previous, pending: true, error: null }))
      try {
        const queryBounds = input.discovery ? discoveryBounds(publicMapBounds(bounds)) : publicMapBounds(bounds)
        const snapshot = input.discovery
          ? await getFilteredPublicMapEvents(queryBounds, input.discovery, signal)
          : await getPublicMapEvents({ bounds: queryBounds, startsAt: new Date(now).toISOString(), endsAt: new Date(now + 7 * 86400000).toISOString(), categories: input.filters }, signal)
        if (disposed || signal.aborted || request !== generation.current) return
        const serverNow = 'serverNow' in snapshot ? Date.parse(String(snapshot.serverNow)) : Date.now()
        const serverOffset = serverNow - Date.now()
        const events = unexpired(snapshot.events, serverNow)
        const expiresAt = Math.min(now + FRESH_MS, input.discovery ? Date.now() + nextDiscoveryMidnight(serverNow) - serverNow : Infinity)
        nextRefreshAt = expiresAt
        const windowEnd = input.discovery && ['today', 'weekend'].includes(input.discovery.when) && 'window' in snapshot ? Date.parse((snapshot.window as { end: string }).end) : undefined
        const previousCoverage = cache.current.filter(previous => previous.expiresAt > Date.now() && agrees(previous, queryBounds, events)).slice(0, 1)
        cache.current = snapshot.complete === true
          ? [{ bounds: queryBounds, filters: filterKey, expiresAt, events, serverOffset, windowEnd }, ...previousCoverage]
          : []
        setResult(previous => ({ events: sameEvents(previous.events, events) ? previous.events : events, generation: previous.generation + 1, pending: false, error: null, complete: snapshot.complete === true, identity: filterKey, serverOffset, windowEnd, bounds: queryBounds }))
        // Initial/new-area reads already start the matching list query. Cached
        // coverage and local expiry must never masquerade as network refreshes.
        if (!retainPrevious && input.discovery) refreshObserver.current?.({ filters: input.discovery, bounds: discoveryBounds(bounds), startedAt: now })
      } catch {
        if (!disposed && !signal.aborted && request === generation.current) {
          cache.current = []
          setResult(previous => {
            const events = previous.windowEnd && Date.now() + (previous.serverOffset ?? 0) >= previous.windowEnd ? [] : unexpired(previous.events, Date.now() + (previous.serverOffset ?? 0))
            return { ...previous, events, generation: previous.generation + (events === previous.events ? 0 : 1), pending: false, error: new Error(previous.complete === null ? 'Events couldn’t load. Try again.' : 'Events couldn’t refresh. Try again.') }
          })
        }
      } finally {
        inFlight = false
        if (!disposed) schedule(Math.max(0, nextRefreshAt - Date.now()))
      }
    }
    const foreground = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastForeground < 250) return
      lastForeground = Date.now(); void run()
    }
    const cached = cache.current.find(snapshot => snapshot.filters === filterKey && snapshot.expiresAt > Date.now() && covers(snapshot.bounds, bounds))
    if (cached) {
      cache.current = [cached, ...cache.current.filter(snapshot => snapshot !== cached)]
      const events = unexpired(cached.events, Date.now() + (cached.serverOffset ?? 0))
      setResult(previous => {
        const unchanged = sameEvents(previous.events, events)
        if (unchanged && !previous.pending && !previous.error && previous.complete === true) return previous
        return { ...previous, events: unchanged ? previous.events : events, generation: previous.generation + (unchanged ? 0 : 1), pending: false, error: null, complete: true, identity: filterKey, serverOffset: cached.serverOffset, windowEnd: cached.windowEnd, bounds: cached.bounds }
      })
      schedule(cached.expiresAt - Date.now())
    } else schedule(300, true)
    refresh.current = () => { void run() }
    window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      disposed = true; controller?.abort(); clearTimeout(timer); clearTimeout(areaTimer)
      window.removeEventListener('focus', foreground)
      document.removeEventListener('visibilitychange', foreground)
      refresh.current = () => {}
    }
  }, [key, enabled])
  const retry = useCallback(() => refresh.current(), [])
  const matchesFilters = !options?.discovery || result.identity === identity
  return { ...result, ...(matchesFilters ? {} : { events: [], complete: null, error: null, pending: Boolean(viewport) }), matchesFilters, retry }
}
