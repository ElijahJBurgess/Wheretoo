export type ScreenRect = { left: number; top: number; right: number; bottom: number }
export type ScreenPoint = { x: number; y: number }

type CameraFitInput = {
  map: ScreenRect
  point: ScreenPoint
  obstacles: readonly ScreenRect[]
  margin: number
}

// The selected title layer permits a 10em line at 14px plus its text halo.
const markerExtent = { left: 76, right: 76, top: 34, bottom: 58 }

function movedMarker(point: ScreenPoint, x: number, y: number): ScreenRect {
  return {
    left: point.x + x - markerExtent.left,
    right: point.x + x + markerExtent.right,
    top: point.y + y - markerExtent.top,
    bottom: point.y + y + markerExtent.bottom,
  }
}

function overlaps(a: ScreenRect, b: ScreenRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function calculateMarkerRevealOffset({ map, point, obstacles, margin }: CameraFitInput): ScreenPoint | null {
  const safe = { left: map.left + margin, top: map.top + margin, right: map.right - margin, bottom: map.bottom - margin }
  let x = 0
  let y = 0
  let marker = movedMarker(point, x, y)

  if (marker.left < safe.left) x += safe.left - marker.left
  if (marker.right > safe.right) x -= marker.right - safe.right
  if (marker.top < safe.top) y += safe.top - marker.top
  if (marker.bottom > safe.bottom) y -= marker.bottom - safe.bottom

  for (const obstacle of obstacles) {
    marker = movedMarker(point, x, y)
    const expanded = {
      left: obstacle.left - margin, top: obstacle.top - margin,
      right: obstacle.right + margin, bottom: obstacle.bottom + margin,
    }
    if (!overlaps(marker, expanded)) continue

    const candidates = [
      { x: x + expanded.left - marker.right, y },
      { x: x + expanded.right - marker.left, y },
      { x, y: y + expanded.top - marker.bottom },
      { x, y: y + expanded.bottom - marker.top },
    ].filter((candidate) => {
      const next = movedMarker(point, candidate.x, candidate.y)
      return next.left >= safe.left && next.right <= safe.right && next.top >= safe.top && next.bottom <= safe.bottom
    })
    candidates.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
    if (candidates[0]) ({ x, y } = candidates[0])
  }

  return Math.abs(x) < 0.5 && Math.abs(y) < 0.5 ? null : { x: Math.round(x), y: Math.round(y) }
}

type ProjectedPoint = { x: number; y: number }
type CameraMap = {
  project(coordinates: [number, number]): ProjectedPoint
  panBy(offset: [number, number], options: { duration: number; essential: boolean }): unknown
  stop(): unknown
}

export type SelectionCameraController = {
  reveal(event: { longitude: number; latitude: number }, panel: HTMLElement): void
  remeasure(): void
  interrupt(): void
  settle(): void
  cancel(): void
}

function rectFromDom(rect: DOMRect): ScreenRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

export function createSelectionCameraController(map: CameraMap, container: HTMLElement): SelectionCameraController {
  let generation = 0
  let firstFrame = 0
  let secondFrame = 0
  let current: { longitude: number; latitude: number; panel: HTMLElement } | null = null
  let transitionActive = false

  const cancelFrames = () => {
    cancelAnimationFrame(firstFrame)
    cancelAnimationFrame(secondFrame)
  }
  const schedule = () => {
    const requestGeneration = ++generation
    cancelFrames()
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (requestGeneration !== generation || !current?.panel.isConnected) return
        const mapRect = container.getBoundingClientRect()
        const projected = map.project([current.longitude, current.latitude])
        const selectors = [
          '.living-map__masthead', '.mapboxgl-ctrl-top-right',
          '.mapboxgl-ctrl-bottom-left', '.mapboxgl-ctrl-bottom-right',
        ]
        const obstacles = [current.panel, ...selectors.flatMap((selector) => Array.from(container.parentElement?.querySelectorAll<HTMLElement>(selector) ?? []))]
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map(rectFromDom)
        const offset = calculateMarkerRevealOffset({
          map: rectFromDom(mapRect),
          point: { x: mapRect.left + projected.x, y: mapRect.top + projected.y },
          obstacles,
          margin: 16,
        })
        if (!offset) return
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
        transitionActive = true
        map.panBy([
          offset.x === 0 ? 0 : -offset.x,
          offset.y === 0 ? 0 : -offset.y,
        ], { duration: reducedMotion ? 0 : 250, essential: false })
      })
    })
  }

  return {
    reveal(event, panel) {
      if (transitionActive) map.stop()
      transitionActive = false
      current = { longitude: event.longitude, latitude: event.latitude, panel }
      schedule()
    },
    remeasure() { if (current) schedule() },
    interrupt() {
      generation += 1
      cancelFrames()
      if (transitionActive) map.stop()
      transitionActive = false
    },
    settle() { transitionActive = false },
    cancel() {
      current = null
      generation += 1
      cancelFrames()
      if (transitionActive) map.stop()
      transitionActive = false
    },
  }
}
