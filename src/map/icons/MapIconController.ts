import type { FilterSpecification, LayerSpecification } from 'mapbox-gl/esm'
import type { IconDescriptor } from '../../features/map-icons/icon.api'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import { createIconLayers, iconResourceIds } from '../style/eventIconLayers'
import { EVENT_LAYER_IDS, createUnselectedFilter, individualFilter } from '../style/eventLayers'
import { loadIconImage, type IconImageRequest } from './iconImageRequest'

type Image = ImageBitmap | HTMLImageElement | ImageData
type Renderer = {
  getLayer(id: string): unknown; hasImage(id: string): boolean
  addLayer(layer: LayerSpecification, before?: string): unknown; removeLayer(id: string): unknown
  addImage(id: string, image: Image, options: { pixelRatio: number; sdf: boolean }): unknown; removeImage(id: string): unknown
  setFilter(id: string, filter: FilterSpecification): unknown; setLayoutProperty(id: string, property: string, value: unknown): unknown
}
type Viewport = { mobile: boolean; zoom: number; longitude: number; latitude: number; visibleIds: ReadonlySet<string> }
type Entry = { descriptor: IconDescriptor; state: 'queued' | 'loading' | 'decoded' | 'installed' | 'failed'; image?: Image; attempts: number; retryAt: number }

/** Owns only images/layers. Application selection and both event sources remain external. */
export class MapIconController {
  private events: readonly WheretooMapEvent[] = []
  private descriptors = new Map<string, IconDescriptor>()
  private entries = new Map<string, Entry>()
  private selected: string | null = null
  private viewport: Viewport = { mobile: false, zoom: 0, longitude: 0, latitude: 0, visibleIds: new Set() }
  private epoch = 0
  private active = 0
  private reservedBytes = 0
  private styleReady = false
  private disposed = false
  private enabled = true
  private lease = 0
  private ready: string[] = []
  private rankedIds: string[] | null = null
  private applied = ''
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private leaseTimer?: ReturnType<typeof setTimeout>
  private pending = new Set<() => void>()
  constructor(private map: Renderer, private requestImage: IconImageRequest = loadIconImage) {}

  setActive(active: boolean) { if (this.enabled === active) return; this.enabled = active; if (active) this.reconcile() }

  setEvents(events: readonly WheretooMapEvent[]) { if (events === this.events) return; this.events = events; this.rankedIds = null; this.applied = ''; this.reconcile() }
  setSelection(id: string | null) { if (id === this.selected) return; this.selected = id; this.rankedIds = null; this.reconcile() }
  setViewport(viewport: Viewport) {
    if (viewport.mobile !== this.viewport.mobile) {
      this.hideFallbackFirst()
      for (const entry of this.entries.values()) { this.removeLayers(entry); if (entry.image) entry.state = 'decoded' }
    }
    if (viewport.mobile !== this.viewport.mobile || viewport.longitude !== this.viewport.longitude || viewport.latitude !== this.viewport.latitude
      || viewport.visibleIds.size !== this.viewport.visibleIds.size || [...viewport.visibleIds].some(id => !this.viewport.visibleIds.has(id))) this.rankedIds = null
    this.viewport = viewport; this.reconcile()
  }
  setDescriptors(descriptors: readonly IconDescriptor[], expiresAt: number) {
    if (expiresAt === this.lease && Date.now() < expiresAt && descriptors.length === this.descriptors.size
      && descriptors.every(descriptor => this.descriptors.get(descriptor.versionId) === descriptor)) return
    if (expiresAt > this.lease) {
      for (const entry of this.entries.values()) {
        if (entry.state === 'failed' && descriptors.some(d => d.versionId === entry.descriptor.versionId && d.packageHash === entry.descriptor.packageHash)) {
          entry.attempts = 0; entry.retryAt = 0; entry.state = 'queued'
        }
      }
    }
    this.rankedIds = null
    this.descriptors = new Map(descriptors.map(d => [d.versionId, d])); this.lease = expiresAt
    if (this.leaseTimer) { clearTimeout(this.leaseTimer); this.timers.delete(this.leaseTimer) }
    this.leaseTimer = this.schedule(() => this.reconcile(), Math.max(0, expiresAt - Date.now()))
    this.reconcile()
  }
  onStyleLoad() {
    this.epoch++; this.styleReady = true; this.applied = ''; this.ready = []
    for (const entry of this.entries.values()) entry.state = entry.image ? 'decoded' : 'queued'
    this.reconcile()
  }
  readyVersionIds() { return [...this.ready] }
  interactiveLayers(selected: boolean) {
    return this.ready.flatMap(id => {
      const d = this.entries.get(id)?.descriptor
      if (!d) return []
      const ids = iconResourceIds(d)
      return selected ? [ids.selected, ids.selectedBody] : [ids.canonical, ids.body]
    }).filter(id => Boolean(this.map.getLayer(id)))
  }
  private schedule(fn: () => void, ms: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.disposed) fn() }, ms)
    this.timers.add(timer); return timer
  }
  private eligible(d: IconDescriptor) {
    const p = this.viewport.mobile ? d.metadata.mobile : d.metadata.desktop
    return this.viewport.zoom >= p.minZoom && this.viewport.zoom < p.maxZoom
  }
  private desired() {
    if (Date.now() >= this.lease) return []
    if (this.rankedIds) return this.rankedIds
    const { longitude, latitude, visibleIds } = this.viewport
    type Candidate = { id: string; version: string; selected: number; visible: number; resident: number; distance: number }
    const compare = (a: Candidate, b: Candidate) => a.selected - b.selected || a.visible - b.visible
      || a.resident - b.resident || a.distance - b.distance || a.id.localeCompare(b.id)
    const best = new Map<string, Candidate>()
    for (const event of this.events) {
      const version = event.mapIconVersionId
      if (!version || !this.descriptors.has(version)) continue
      const visible = visibleIds.has(event.id), resident = this.entries.has(version), selected = event.id === this.selected
      if (!selected && !visible && !resident) continue
      const candidate = { id: event.id, version, selected: selected ? 0 : 1, visible: visible ? 0 : 1,
        // Keep visible residents stable under small pans; selection and newly visible icons still take priority.
        resident: resident ? 0 : 1, distance: (event.longitude - longitude) ** 2 + (event.latitude - latitude) ** 2 }
      const previous = best.get(version)
      if (!previous || compare(candidate, previous) < 0) best.set(version, candidate)
    }
    this.rankedIds = [...best.values()].sort(compare).slice(0, this.viewport.mobile ? 8 : 16).map(candidate => candidate.version)
    return this.rankedIds
  }

  reconcile() {
    if (this.disposed || !this.styleReady) return
    const desired = new Set(this.desired())
    for (const [id, entry] of this.entries) {
      if (!desired.has(id) || this.descriptors.get(id)?.packageHash !== entry.descriptor.packageHash) {
        this.hideFallbackFirst(); this.remove(entry); this.entries.delete(id)
      }
    }
    for (const id of desired) {
      const d = this.descriptors.get(id)!
      if (!this.entries.has(id)) this.entries.set(id, { descriptor: d, state: 'queued', attempts: 0, retryAt: 0 })
    }
    for (const entry of this.entries.values()) {
      const ids = iconResourceIds(entry.descriptor)
      if (entry.state === 'installed' && (!this.map.hasImage(ids.image)
        || ![ids.canonical, ids.body, ids.selected, ids.selectedBody].every(id => this.map.getLayer(id)))) {
        this.hideFallbackFirst(); entry.state = 'decoded'
      }
      if (this.enabled && entry.state === 'decoded' && entry.image) this.install(entry)
      const bytes = entry.descriptor.metadata.widthPx * entry.descriptor.metadata.heightPx * 4
      const decodedBytes = [...this.entries.values()].reduce((sum, e) => sum + (e.image ? e.descriptor.metadata.widthPx * e.descriptor.metadata.heightPx * 4 : 0), 0)
      if (this.enabled && (entry.state === 'queued' || (entry.state === 'failed' && entry.attempts < 3 && Date.now() >= entry.retryAt))
        && this.eligible(entry.descriptor) && this.active < 4
        && decodedBytes + this.reservedBytes + bytes <= (this.viewport.mobile ? 32 : 64) * 1048576) this.load(entry)
    }
    const ready = [...this.entries].filter(([, e]) => {
      const ids = iconResourceIds(e.descriptor)
      return e.state === 'installed' && this.eligible(e.descriptor) && this.map.hasImage(ids.image)
        && [ids.canonical, ids.body, ids.selected, ids.selectedBody].every(id => this.map.getLayer(id))
    }).map(([id]) => id)
    this.apply(ready)
  }
  private load(entry: Entry) {
    entry.state = 'loading'; entry.attempts++; this.active++
    const bytes = entry.descriptor.metadata.widthPx * entry.descriptor.metadata.heightPx * 4
    this.reservedBytes += bytes
    const epoch = this.epoch
    let settled = false
    let abort = () => {}
    const cancel = () => { abort(); complete(new Error('Icon image request cancelled')) }
    const timeout = this.schedule(() => {
      cancel()
    }, 10000)
    const complete = (error: Error | null | undefined, image?: Image | null) => {
      if (settled) { this.release(image); return }
      settled = true; clearTimeout(timeout); this.timers.delete(timeout); this.pending.delete(cancel); this.active--; this.reservedBytes -= bytes
      if (this.disposed) { this.release(image); return }
      if (epoch !== this.epoch || this.entries.get(entry.descriptor.versionId) !== entry) {
        this.release(image); this.reconcile(); return
      }
      const m = entry.descriptor.metadata
      if (error || !image || image.width !== m.widthPx || image.height !== m.heightPx) { this.release(image); this.fail(entry) }
      else { this.release(entry.image); entry.image = image; entry.state = 'decoded' }
      this.reconcile()
    }
    this.pending.add(cancel)
    try { abort = this.requestImage(entry.descriptor.url, complete) } catch (error) { complete(error instanceof Error ? error : new Error('Image request failed')) }
  }
  private fail(entry: Entry) {
    entry.state = 'failed'; entry.retryAt = Date.now() + (entry.attempts === 1 ? 1000 : 4000)
    if (entry.attempts < 3) this.schedule(() => this.reconcile(), entry.retryAt - Date.now())
  }
  private install(entry: Entry) {
    try {
      const ids = iconResourceIds(entry.descriptor)
      if (!this.map.hasImage(ids.image)) this.map.addImage(ids.image, entry.image!, { pixelRatio: entry.descriptor.metadata.pixelRatio, sdf: false })
      for (const layer of createIconLayers(entry.descriptor, this.viewport.mobile, this.selected)) {
        if (!this.map.getLayer(layer.id)) this.map.addLayer(layer, layer.source === 'wheretoo-events' ? EVENT_LAYER_IDS.selectedHit : EVENT_LAYER_IDS.selectedTitle)
      }
      entry.state = 'installed'; this.applied = ''
    } catch { this.hideFallbackFirst(); this.removeLayers(entry); this.fail(entry) }
  }
  private apply(ready: string[]) {
    const signature = JSON.stringify([ready, this.selected])
    if (signature === this.applied) return
    this.ready = ready; this.applied = signature
    const complement: FilterSpecification = ['!', ['in', ['get', 'mapIconVersionId'], ['literal', ready]]]
    for (const id of [EVENT_LAYER_IDS.unselectedTail, EVENT_LAYER_IDS.unselectedCircle, EVENT_LAYER_IDS.unselectedGlyph]) {
      if (this.map.getLayer(id)) this.map.setFilter(id, ['all', createUnselectedFilter(this.selected), complement])
    }
    for (const id of [EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedCircle, EVENT_LAYER_IDS.selectedGlyph]) {
      if (this.map.getLayer(id)) this.map.setFilter(id, ['all', individualFilter, complement])
    }
    for (const [id, entry] of this.entries) {
      for (const layer of createIconLayers(entry.descriptor, this.viewport.mobile, this.selected)) {
        if (!this.map.getLayer(layer.id)) continue
        this.map.setFilter(layer.id, layer.filter!)
        this.map.setLayoutProperty(layer.id, 'visibility', ready.includes(id) ? 'visible' : 'none')
      }
    }
  }
  private hideFallbackFirst() { this.applied = ''; this.apply([]) }
  private removeLayers(entry: Entry) {
    const ids = iconResourceIds(entry.descriptor)
    for (const id of [ids.canonical, ids.body, ids.selected, ids.selectedBody]) if (this.map.getLayer(id)) this.map.removeLayer(id)
  }
  private release(image?: Image | null) { if (image && 'close' in image) image.close() }
  private remove(entry: Entry) {
    this.removeLayers(entry)
    const id = iconResourceIds(entry.descriptor).image
    if (this.map.hasImage(id)) this.map.removeImage(id)
    this.release(entry.image)
  }
  dispose() {
    this.hideFallbackFirst()
    this.disposed = true; this.epoch++
    for (const cancel of this.pending) cancel()
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    for (const entry of this.entries.values()) this.remove(entry)
    this.entries.clear()
  }
}
