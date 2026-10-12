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
export function usePublicMapEvents(viewport: MapViewportSnapshot | null, filters: readonly EventCategory[] | null, enabled: boolean) {
  const [result, setResult] = useState<Result>({ events: [], generation: 0, pending: false, error: null })
  const generation = useRef(0)
  const refresh = useRef<() => void>(() => {})
  const key = JSON.stringify({ viewport, filters })
  useLayoutEffect(() => {
    // Cleanup invalidates immediately on a new viewport, not after debounce.
    ++generation.current
    if (!enabled) return
    const input = JSON.parse(key) as { viewport: MapViewportSnapshot | null; filters: EventCategory[] | null }
    if (!input.viewport) return
    let controller: AbortController | null = null
    const run = () => {
      controller?.abort()
      controller = new AbortController()
      const request = ++generation.current
      const signal = controller.signal
      setResult(previous => ({ ...previous, pending: true, error: null }))
      void (async () => {
        try {
          const now = Date.now()
          const events = await getPublicMapEvents({ bounds: publicMapBounds(input.viewport!.bounds), startsAt: new Date(now).toISOString(), endsAt: new Date(now + 7 * 86400000).toISOString(), categories: input.filters }, signal)
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
