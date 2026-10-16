import { afterEach, describe, expect, it, vi } from 'vitest'
import { MapIconController } from './MapIconController'
import { parseIconResponse } from '../../features/map-icons/icon.api'
import { flagDescriptor } from '../../features/map-icons/icon.test-fixtures'
import { getDevelopmentMapEvents } from '../data/developmentMapEvents'
import type { LayerSpecification } from 'mapbox-gl/esm'

const a = parseIconResponse({ catalogRevision: 1, renderingEnabled: true, versions: [flagDescriptor] }, [flagDescriptor.versionId], 'http://127.0.0.1:56321')[0]
const b = { ...a, versionId: '00000000-0000-4000-8000-000000000002', packageHash: 'b'.repeat(64) }
const event = { ...getDevelopmentMapEvents()[0], mapIconVersionId: a.versionId }
function setup() {
  const layers = new Map<string, LayerSpecification>(), images = new Set<string>()
  const loads: Array<(error: Error | null, image?: ImageData) => void> = []
  const map = {
    getLayer: (id: string) => layers.get(id), hasImage: (id: string) => images.has(id),
    addLayer: vi.fn((l: LayerSpecification) => layers.set(l.id, l)), removeLayer: vi.fn((id: string) => layers.delete(id)),
    addImage: vi.fn((id: string) => images.add(id)), removeImage: vi.fn((id: string) => images.delete(id)),
    setFilter: vi.fn(), setLayoutProperty: vi.fn(),
    loadImage: vi.fn((_url: string, cb: (error: Error | null, image?: ImageData) => void) => loads.push(cb)),
  }
  const aborts: Array<ReturnType<typeof vi.fn>> = []
  const controller = new MapIconController(map, (url, callback) => {
    map.loadImage(url, callback)
    const abort = vi.fn(); aborts.push(abort); return abort
  })
  controller.setViewport({ mobile: false, zoom: 14.6, longitude: -122.263, latitude: 37.804, visibleIds: new Set([event.id]) })
  const resolve = (i = 0) => loads[i](null, { width: 600, height: 922 } as ImageData)
  return { controller, map, layers, images, loads, aborts, resolve }
}
afterEach(() => vi.useRealTimers())
describe('MapIconController', () => {
  it('releases timed-out requests so a later selected icon can load', () => {
    vi.useFakeTimers()
    const f = setup()
    const descriptors = Array.from({ length: 5 }, (_, i) => ({ ...a, versionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))
    const events = descriptors.map((d, i) => ({ ...event, id: `e${i}`, mapIconVersionId: d.versionId }))
    f.controller.setViewport({ mobile: false, zoom: 15, longitude: 0, latitude: 0, visibleIds: new Set(events.map(e => e.id)) })
    f.controller.setEvents(events); f.controller.setDescriptors(descriptors, Date.now() + 60000); f.controller.onStyleLoad()
    expect(f.loads).toHaveLength(4)
    f.controller.setSelection('e4')
    vi.advanceTimersByTime(10000)
    expect(f.aborts.slice(0, 4).every(abort => abort.mock.calls.length === 1)).toBe(true)
    expect(f.loads.length).toBeGreaterThan(4)
    f.resolve(4)
    expect(f.controller.readyVersionIds()).toContain(descriptors[4].versionId)
    const lateImage = { width: 600, height: 922, close: vi.fn() }
    f.loads[0](null, lateImage as unknown as ImageData)
    expect(lateImage.close).toHaveBeenCalledOnce()
    expect(f.controller.readyVersionIds()).not.toContain(descriptors[0].versionId)
    f.controller.dispose()
  })
  it('rearms exhausted transient failures only after fresh descriptor availability', () => {
    vi.useFakeTimers(); const f = setup(); f.controller.setEvents([event]); f.controller.setDescriptors([a], Date.now() + 60000); f.controller.onStyleLoad()
    f.loads[0](new Error('offline')); vi.advanceTimersByTime(1000)
    f.loads[1](new Error('offline')); vi.advanceTimersByTime(4000)
    f.loads[2](new Error('offline')); vi.advanceTimersByTime(4000)
    f.controller.reconcile(); expect(f.loads).toHaveLength(3)
    f.controller.setDescriptors([a], Date.now() + 60000)
    expect(f.loads).toHaveLength(4); f.resolve(3)
    expect(f.controller.readyVersionIds()).toEqual([a.versionId]); f.controller.dispose()
  })
  it('repairs a removed registered image without another network request', () => {
    const f = setup(); f.controller.setEvents([event]); f.controller.setDescriptors([a], Date.now() + 60000); f.controller.onStyleLoad(); f.resolve()
    f.images.clear(); f.controller.reconcile()
    expect(f.controller.readyVersionIds()).toEqual([a.versionId])
    expect(f.map.loadImage).toHaveBeenCalledOnce(); expect(f.map.addImage).toHaveBeenCalledTimes(2); f.controller.dispose()
  })
  it('does not let an old style timeout disable a new successful installation', () => {
    vi.useFakeTimers(); const f = setup(); f.controller.setEvents([event]); f.controller.setDescriptors([a], Date.now() + 60000); f.controller.onStyleLoad()
    vi.advanceTimersByTime(5000); f.controller.onStyleLoad(); f.resolve(1)
    vi.advanceTimersByTime(5001)
    expect(f.controller.readyVersionIds()).toEqual([a.versionId]); f.controller.dispose()
  })
  it('keeps fallback after partial layer installation fails', () => {
    const f = setup(); f.controller.setEvents([event]); f.controller.setDescriptors([a], Date.now() + 60000); f.controller.onStyleLoad()
    f.map.addLayer.mockImplementationOnce(l => { f.layers.set(l.id, l); return f.layers }).mockImplementationOnce(() => { throw new Error('install failure') })
    f.resolve(); expect(f.controller.readyVersionIds()).toEqual([]); expect(f.controller.interactiveLayers(false)).toEqual([])
    expect(f.layers.size).toBe(0); f.controller.dispose()
  })
  it('loads late events and descriptors after style readiness without a new style', () => {
    const f = setup(); f.controller.onStyleLoad(); f.controller.setEvents([event])
    expect(f.map.loadImage).not.toHaveBeenCalled()
    f.controller.setDescriptors([a], Date.now() + 60000); expect(f.map.loadImage).toHaveBeenCalledTimes(1)
    expect(f.controller.readyVersionIds()).toEqual([])
    f.resolve(); expect(f.controller.readyVersionIds()).toEqual([a.versionId])
    expect(f.map.addImage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ width: 600 }), { pixelRatio: 3, sdf: false })
    expect(f.layers.size).toBe(4); f.controller.dispose()
  })
  it('deduplicates one version across events and keeps A failure independent of B', () => {
    const f = setup(); f.controller.setViewport({ mobile: false, zoom: 15, longitude: 0, latitude: 0, visibleIds: new Set([event.id, 'b']) })
    f.controller.setEvents([event, { ...event, id: 'other' }, { ...event, id: 'b', mapIconVersionId: b.versionId }])
    f.controller.setSelection(event.id); f.controller.setDescriptors([a, b], Date.now() + 60000); f.controller.onStyleLoad()
    expect(f.map.loadImage).toHaveBeenCalledTimes(2)
    f.loads[0](new Error('CORS')); f.resolve(1)
    expect(f.controller.readyVersionIds()).toEqual([b.versionId]); f.controller.dispose()
  })
  it('reassigns A to B and Default to A without leaving stale layers or hits', () => {
    const f = setup(); f.controller.setDescriptors([a, b], Date.now() + 60000); f.controller.onStyleLoad()
    f.controller.setEvents([{ ...event, mapIconVersionId: null }]); expect(f.loads).toHaveLength(0)
    f.controller.setEvents([event]); f.resolve()
    f.controller.setEvents([{ ...event, mapIconVersionId: b.versionId }]); expect(f.controller.readyVersionIds()).toEqual([])
    expect(f.controller.interactiveLayers(false)).toEqual([])
    f.resolve(1); expect(f.controller.readyVersionIds()).toEqual([b.versionId]); f.controller.dispose()
  })
  it('rejects stale callbacks after a style reset and reinstalls once', () => {
    const f = setup(); f.controller.setEvents([event]); f.controller.setDescriptors([a], Date.now() + 60000); f.controller.onStyleLoad()
    f.layers.clear(); f.images.clear(); f.controller.onStyleLoad(); f.resolve()
    expect(f.map.addImage).not.toHaveBeenCalled()
    f.resolve(1); expect(f.map.addImage).toHaveBeenCalledTimes(1)
    f.controller.reconcile(); expect(f.map.addLayer).toHaveBeenCalledTimes(4); f.controller.dispose()
  })
  it('switches fallback and hit visibility together across minimum zoom both ways', () => {
    const f = setup(); f.controller.setEvents([event]); f.controller.setDescriptors([a], Date.now() + 60000); f.controller.onStyleLoad(); f.resolve()
    for (const zoom of [14.4, 14.5, 14.49, 15]) {
      f.controller.setViewport({ mobile: false, zoom, longitude: -122.263, latitude: 37.804, visibleIds: new Set([event.id]) })
      expect(f.controller.readyVersionIds()).toEqual(zoom >= 14.5 ? [a.versionId] : [])
      expect(f.controller.interactiveLayers(false)).toHaveLength(zoom >= 14.5 ? 2 : 0)
    }
    f.controller.setSelection(event.id)
    expect(f.map.setFilter).toHaveBeenCalledWith(expect.stringContaining('canonical'), expect.arrayContaining([['!=', ['get', 'eventId'], event.id]]))
    f.controller.dispose()
  })
  it('disables unavailable descriptors and expires leases without an idle loop', () => {
    vi.useFakeTimers(); const f = setup(); f.controller.setEvents([event]); f.controller.setDescriptors([a], Date.now() + 50); f.controller.onStyleLoad(); f.resolve()
    vi.advanceTimersByTime(51); expect(f.controller.readyVersionIds()).toEqual([])
    expect(f.controller.interactiveLayers(false)).toEqual([]); f.controller.dispose()
  })
  it('does not call the map after disposal with pending loads', () => {
    const f = setup(); f.controller.setEvents([event]); f.controller.setDescriptors([a], Date.now() + 60000); f.controller.onStyleLoad(); f.controller.dispose()
    f.resolve(); expect(f.map.addImage).not.toHaveBeenCalled()
  })
  it('bounds requests at four and mobile residents at eight with selected priority', () => {
    const f = setup()
    const descriptors = Array.from({ length: 20 }, (_, i) => ({ ...a, versionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))
    const events = descriptors.map((d, i) => ({ ...event, id: `e${i}`, mapIconVersionId: d.versionId }))
    f.controller.setViewport({ mobile: true, zoom: 15, longitude: 0, latitude: 0, visibleIds: new Set(events.map(e => e.id)) })
    f.controller.setSelection('e19'); f.controller.setEvents(events); f.controller.setDescriptors(descriptors, Date.now() + 60000); f.controller.onStyleLoad()
    expect(f.loads).toHaveLength(4)
    for (let i = 0; i < 8; i++) f.resolve(i)
    expect(f.loads).toHaveLength(8); expect(f.layers.size).toBe(32)
    expect(f.controller.readyVersionIds()).toContain(descriptors[19].versionId); f.controller.dispose()
  })
})

it('retains eight visible mobile versions through camera movement and admits selected ninth', () => {
  const f = setup()
  const descriptors = Array.from({ length: 9 }, (_, i) => ({ ...a, versionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))
  const events = descriptors.map((d, i) => ({ ...event, id: `e${i}`, longitude: i * 0.001, latitude: 0, mapIconVersionId: d.versionId }))
  const viewport = { mobile: true, zoom: 15, longitude: 0, latitude: 0, visibleIds: new Set(events.map(e => e.id)) }
  f.controller.setViewport(viewport); f.controller.setEvents(events); f.controller.setDescriptors(descriptors, Date.now() + 60000); f.controller.onStyleLoad()
  for (let i = 0; i < 8; i++) f.resolve(i)
  const resident = f.controller.readyVersionIds()
  f.controller.setViewport({ ...viewport, longitude: 0.008 })
  expect(f.controller.readyVersionIds()).toEqual(resident)
  expect(f.map.removeImage).not.toHaveBeenCalled()
  expect(f.loads).toHaveLength(8)
  f.controller.setSelection('e8'); f.resolve(8)
  expect(f.controller.readyVersionIds()).toContain(descriptors[8].versionId)
  expect(f.controller.readyVersionIds()).toHaveLength(8)
  f.controller.dispose()
})
it('keeps decoded plus in-flight mobile bytes within the existing budget', () => {
  const f = setup()
  const descriptors = Array.from({ length: 3 }, (_, i) => ({ ...a, versionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, metadata: { ...a.metadata, widthPx: 2048, heightPx: 2048 } }))
  const events = descriptors.map((d, i) => ({ ...event, id: `e${i}`, mapIconVersionId: d.versionId }))
  f.controller.setViewport({ mobile: true, zoom: 15, longitude: 0, latitude: 0, visibleIds: new Set(events.map(e => e.id)) })
  f.controller.setEvents(events); f.controller.setDescriptors(descriptors, Date.now() + 60000); f.controller.onStyleLoad()
  expect(f.loads).toHaveLength(2)
  f.loads[0](null, { width: 2048, height: 2048 } as ImageData)
  f.loads[1](null, { width: 2048, height: 2048 } as ImageData)
  expect(f.loads).toHaveLength(2)
  expect(f.controller.readyVersionIds()).toHaveLength(2)
  f.controller.dispose()
})
