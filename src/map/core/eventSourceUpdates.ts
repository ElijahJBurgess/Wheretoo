import type { toEventFeatureCollection } from '../data/eventGeoJson'

type Collection = ReturnType<typeof toEventFeatureCollection>
type Source = { setData(data: Collection): unknown }
type Renderer = {
  getSource(id: string): unknown
  isSourceLoaded(id: string): boolean
  on(type: 'render', listener: () => void): unknown
  off(type: 'render', listener: () => void): unknown
  triggerRepaint(): unknown
}
export type EventSourceWriter = (id: string, data: Collection) => void

/** Serialize source replacement after icon/filter tile reloads, without waiting for camera idle. */
export function createEventSourceUpdates(map: Renderer, onError: () => void) {
  const pending = new Map<string, { source: Source; data: Collection }>()
  let listening = false, disposed = false
  const detach = () => {
    if (listening) map.off('render', flush)
    listening = false
  }
  const flush = () => {
    for (const [id, update] of pending) {
      try {
        if (map.getSource(id) !== update.source) { pending.delete(id); continue }
        if (!map.isSourceLoaded(id)) continue
        pending.delete(id)
        // An icon-driven reload can finish parsing old tiles after setData has
        // cleared the worker index. Drain that work before replacing the data.
        update.source.setData(update.data)
      } catch { pending.delete(id); onError() }
    }
    if (!pending.size) detach()
  }
  const write: EventSourceWriter = (id, data) => {
    if (disposed) return
    const source = map.getSource(id) as Source | undefined
    if (!source) return
    pending.set(id, { source, data })
    if (!listening) { listening = true; map.on('render', flush) }
    map.triggerRepaint()
  }
  return { write, dispose() { disposed = true; pending.clear(); detach() } }
}
