import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMapboxMap, createNavigationControl, isMapboxSupported } from './mapbox.factory'
import { WheretooMap } from './WheretooMap'
import { getDevelopmentMapEvents } from '../data/developmentMapEvents'
import { EVENT_LAYER_IDS, EVENT_SOURCE_ID } from '../style/eventLayers'
import { flagDescriptor } from '../../features/map-icons/icon.test-fixtures'
import { parseIconResponse } from '../../features/map-icons/icon.api'
import { iconResourceIds } from '../style/eventIconLayers'
import { fetchMapIconDescriptors } from '../../features/map-icons/icon.loader'
import { loadIconImage } from '../icons/iconImageRequest'
vi.mock('../icons/iconImageRequest', () => ({ loadIconImage: vi.fn() }))
const descriptor = parseIconResponse({ catalogRevision: 1, renderingEnabled: true, versions: [flagDescriptor] }, [flagDescriptor.versionId], 'http://127.0.0.1:56321')[0]
const ids = iconResourceIds(descriptor)
vi.mock('../../features/map-icons/icon.loader', () => ({ fetchMapIconDescriptors: vi.fn(async () => [descriptor]) }))

const requirePublicMapboxAccessToken = vi.hoisted(() => vi.fn(() => 'pk.test'))

vi.mock('../../config/browserEnv', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../config/browserEnv')>(),
  requirePublicMapboxAccessToken,
}))

vi.mock('./mapbox.factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mapbox.factory')>()
  return { ...actual, createMapboxMap: vi.fn(), createNavigationControl: vi.fn(), isMapboxSupported: vi.fn() }
})

type Listener = (event?: unknown) => void
let resizeCallback: ResizeObserverCallback

class FakeResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
}

function fakeMap({ initialZoom = 14.6 } = {}) {
  const listeners = new Map<string, Set<Listener>>()
  const sources = new Map<string, unknown>()
  const layers = new Set<string>()
  const images = new Set<string>()
  const imageLoads: Array<{
    url: string
    callback: (error?: Error | null, image?: ImageBitmap | HTMLImageElement | ImageData | null) => void
  }> = []
  let zoom = initialZoom
  const canvas = document.createElement('canvas')
  const clusterSource = {
    setData: vi.fn(),
    getClusterExpansionZoom: vi.fn((_id: number, callback: (error: Error | null, zoom: number) => void) => { callback(null, 15); return clusterSource }),
    getClusterLeaves: vi.fn((_id: number, _limit: number, _offset: number, callback: (error: Error | null, features: unknown[]) => void) => { callback(null, []); return clusterSource }),
  }
  const listenerKey = (name: string, layerOrListener: string | Listener) => typeof layerOrListener === 'string' ? `${name}:${layerOrListener}` : name
  const map = {
    on: vi.fn((name: string, layerOrListener: string | Listener, maybeListener?: Listener) => {
      const key = listenerKey(name, layerOrListener)
      const listener = maybeListener ?? layerOrListener as Listener
      const set = listeners.get(key) ?? new Set(); set.add(listener); listeners.set(key, set); return map
    }),
    off: vi.fn((name: string, layerOrListener: string | Listener, maybeListener?: Listener) => {
      listeners.get(listenerKey(name, layerOrListener))?.delete(maybeListener ?? layerOrListener as Listener); return map
    }),
    jumpTo: vi.fn(), zoomOut: vi.fn(), remove: vi.fn(), addControl: vi.fn(), removeControl: vi.fn(), resize: vi.fn(), stop: vi.fn(), easeTo: vi.fn(),
    project: vi.fn(() => ({ x: 720, y: 450 })), panBy: vi.fn(),
    addSource: vi.fn((id: string) => { sources.set(id, id === EVENT_SOURCE_ID ? clusterSource : { setData: vi.fn() }) }),
    getSource: vi.fn((id: string) => sources.get(id)),
    addLayer: vi.fn((layer: { id: string }) => { layers.add(layer.id) }),
    getLayer: vi.fn((id: string) => layers.has(id) ? { id } : undefined),
    loadImage: vi.fn((url: string, callback: (error?: Error | null, image?: ImageBitmap | HTMLImageElement | ImageData | null) => void) => {
      imageLoads.push({ url, callback })
    }),
    removeLayer: vi.fn((id: string) => layers.delete(id)), removeImage: vi.fn((id: string) => images.delete(id)),
    addImage: vi.fn((id: string) => { images.add(id) }),
    hasImage: vi.fn((id: string) => images.has(id)),
    setFilter: vi.fn(), setPaintProperty: vi.fn(), setLayoutProperty: vi.fn(),
    queryRenderedFeatures: vi.fn((): unknown[] => []), getCanvas: vi.fn(() => canvas),
    setConfigProperty: vi.fn(),
    getConfigProperty: vi.fn((_namespace: string, key: string) => ({
      lightPreset: 'night', theme: 'monochrome', font: 'Manrope', showPointOfInterestLabels: true,
      showRoadLabels: true, showPedestrianRoads: true, showPlaceLabels: true,
      densityPointOfInterestLabels: 3, colorModePointOfInterestLabels: 'single',
      colorPointOfInterestLabels: '#848e94', backgroundPointOfInterestLabels: 'none',
      showTransitLabels: false, showLandmarkIcons: false, showLandmarkIconLabels: false,
      showIndoor: false, showIndoorLabels: false, show3dObjects: true, show3dBuildings: true,
      show3dFacades: false, show3dLandmarks: false, show3dTrees: false,
    })[key as 'theme']),
    getBounds: vi.fn(() => ({ getWest: () => -122.5, getSouth: () => 37.7, getEast: () => -122.2, getNorth: () => 37.9 })),
    getCenter: vi.fn(() => ({ lng: -122.263, lat: 37.804 })), getZoom: vi.fn(() => zoom),
    getPitch: vi.fn(() => 25), getBearing: vi.fn(() => 0),
    dragRotate: { disableRotation: vi.fn() }, touchZoomRotate: { disableRotation: vi.fn() },
    keyboard: { disableBearing: vi.fn(), disablePitch: vi.fn() },
  }
  vi.mocked(loadIconImage).mockImplementation((url, callback) => {
    map.loadImage(url, (error, image) => callback(error ?? null, image ?? undefined))
    return () => {}
  })
  return {
    map, clusterSource,
    resolveImageLoad(index = 0, image = { width: 600, height: 922 } as HTMLImageElement) { imageLoads[index]?.callback(null, image) },
    rejectImageLoad(index = 0, error = new Error('PNG unavailable')) { imageLoads[index]?.callback(error, null) },
    resetStyleResources() { sources.clear(); layers.clear(); images.clear() },
    setZoom(nextZoom: number) { zoom = nextZoom },
    emit(name: string, payload?: unknown) { listeners.get(name)?.forEach((listener) => listener(payload)) },
    emitLayer(name: string, layerId: string, payload?: unknown) { listeners.get(`${name}:${layerId}`)?.forEach((listener) => listener(payload)) },
  }
}

describe('WheretooMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requirePublicMapboxAccessToken.mockReturnValue('pk.test')
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.mocked(isMapboxSupported).mockReturnValue(true)
    vi.mocked(createNavigationControl).mockReturnValue({} as never)
  })

  it('broadens through the existing camera and releases the control without recreating the map', async () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const broadener = vi.fn()
    const view = render(<WheretooMap visualScene={null} onBroadenReady={broadener} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    await waitFor(() => expect(broadener).toHaveBeenCalled())
    broadener.mock.calls[0][0]()
    expect(fake.map.zoomOut).toHaveBeenCalledOnce()
    expect(createMapboxMap).toHaveBeenCalledOnce()
    view.unmount(); expect(broadener).toHaveBeenLastCalledWith(null)
  })

  it('initializes the saved camera once and releases its read-only navigation snapshot on cleanup', async () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const snapshot = vi.fn()
    const camera = { center: [-122.264, 37.803] as [number, number], zoom: 16.25, pitch: 12, bearing: 0 }
    const props = { visualScene: null, initialCamera: camera, onSnapshotReady: snapshot, onReady: vi.fn(), onMoveEnd: vi.fn(), onRendererError: vi.fn() }
    const view = render(<WheretooMap {...props} />)
    await waitFor(() => expect(createMapboxMap).toHaveBeenCalledOnce())
    expect(vi.mocked(createMapboxMap).mock.calls[0][0]).toEqual(expect.objectContaining(camera))
    expect(snapshot.mock.calls[0][0]()).toEqual(expect.objectContaining({ camera: expect.objectContaining({ zoom: 14.6 }) }))
    view.rerender(<WheretooMap {...props} initialCamera={{ ...camera, zoom: 15 }} />)
    expect(createMapboxMap).toHaveBeenCalledOnce()
    view.unmount()
    expect(snapshot).toHaveBeenLastCalledWith(null)
  })

  it('renews availability before lease expiry without flashing fallback or reloading images', async () => {
    vi.useFakeTimers()
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    vi.mocked(fetchMapIconDescriptors).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return [descriptor]
    })
    const view = render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    try {
      fake.emit('style.load')
      await act(async () => { await vi.advanceTimersByTimeAsync(101) })
      fake.resolveImageLoad()
      await act(async () => { await vi.advanceTimersByTimeAsync(59950) })
      expect(fake.map.removeImage).not.toHaveBeenCalled()
      expect(fake.map.loadImage).toHaveBeenCalledOnce()
    } finally {
      view.unmount(); vi.useRealTimers(); vi.mocked(fetchMapIconDescriptors).mockResolvedValue([descriptor])
    }
  })

  it('coalesces paired foreground descriptor refreshes', async () => {
    vi.useFakeTimers()
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    vi.mocked(fetchMapIconDescriptors).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return [descriptor]
    })
    const view = render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    try {
      act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
      expect(fetchMapIconDescriptors).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(101) })
      act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
      expect(fetchMapIconDescriptors).toHaveBeenCalledTimes(2)
    } finally {
      view.unmount(); vi.useRealTimers(); vi.mocked(fetchMapIconDescriptors).mockResolvedValue([descriptor])
    }
  })

  it('does not let a hidden notification suppress renewal on return to visibility', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const view = render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(101) })
      visibility.mockReturnValue('hidden')
      act(() => document.dispatchEvent(new Event('visibilitychange')))
      visibility.mockReturnValue('visible')
      act(() => document.dispatchEvent(new Event('visibilitychange')))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(fetchMapIconDescriptors).toHaveBeenCalledTimes(2)
    } finally { view.unmount(); visibility.mockRestore(); vi.useRealTimers() }
  })

  it('reports a missing or malformed public token through the renderer error boundary', () => {
    requirePublicMapboxAccessToken.mockImplementation(() => { throw new Error('Missing token') })
    const onRendererError = vi.fn()

    render(<WheretooMap visualScene={null} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={onRendererError} />)

    expect(onRendererError).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INVALID' }))
    expect(createMapboxMap).not.toHaveBeenCalled()
  })

  it('owns one renderer across rerenders and responsive updates, then cleans up once', () => {
    const fake = fakeMap()
    vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const firstMove = vi.fn()
    const latestMove = vi.fn()
    const view = render(<WheretooMap visualScene={null} onReady={vi.fn()} onMoveEnd={firstMove} onRendererError={vi.fn()} />)
    view.rerender(<WheretooMap visualScene={null} onReady={vi.fn()} onMoveEnd={latestMove} onRendererError={vi.fn()} />)

    act(() => resizeCallback([{ contentRect: { width: 1440 } } as ResizeObserverEntry], {} as ResizeObserver))
    act(() => resizeCallback([{ contentRect: { width: 390 } } as ResizeObserverEntry], {} as ResizeObserver))

    expect(createMapboxMap).toHaveBeenCalledTimes(1)
    expect(fake.map.resize).toHaveBeenCalledTimes(2)
    expect(fake.map.setConfigProperty).toHaveBeenCalledWith('basemap', 'densityPointOfInterestLabels', 2)
    expect(fake.map.setConfigProperty).toHaveBeenCalledWith('basemap', 'densityPointOfInterestLabels', 3)
    expect(fake.map.addControl).toHaveBeenCalledWith(expect.anything(), 'top-right')
    expect(fake.map.dragRotate.disableRotation).toHaveBeenCalledOnce()
    expect(fake.map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce()
    expect(fake.map.keyboard.disableBearing).toHaveBeenCalledOnce()
    fake.emit('moveend')
    expect(firstMove).not.toHaveBeenCalled()
    expect(latestMove).toHaveBeenCalledOnce()

    view.unmount()
    expect(fake.map.removeControl).toHaveBeenCalledOnce()
    expect(fake.map.remove).toHaveBeenCalledOnce()
  })

  it('reports usable after the first rendered base map without waiting for idle or icon downloads', () => {
    const fake = fakeMap()
    vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const onReady = vi.fn()
    const view = render(<WheretooMap visualScene={null} onReady={onReady} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')
    expect(onReady).not.toHaveBeenCalled()
    fake.emit('load')
    expect(onReady).toHaveBeenCalledOnce()
    expect(view.container.querySelector('.living-map__canvas')).toHaveAttribute('data-standard-config')
    fake.emit('idle')
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('allows a recoverable resource error before load and ignores resource errors after readiness', () => {
    const fake = fakeMap()
    vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const onReady = vi.fn(), onRendererError = vi.fn()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<WheretooMap visualScene={null} onReady={onReady} onMoveEnd={vi.fn()} onRendererError={onRendererError} />)
    fake.emit('error', { sourceId: 'basemap', error: Object.assign(new Error('tile failed ?access_token=PRIVATE'), { status: 503 }) })
    expect(onRendererError).not.toHaveBeenCalled()
    fake.emit('load')
    expect(onReady).toHaveBeenCalledOnce()
    fake.emit('error', { error: new Error('icon unavailable') })
    expect(onRendererError).not.toHaveBeenCalled()
    expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE')
    warning.mockRestore()
  })

  it('reports a confirmed style failure but still permits a later successful load to recover', () => {
    const fake = fakeMap()
    vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const onReady = vi.fn(), onRendererError = vi.fn()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = render(<WheretooMap visualScene={null} onReady={onReady} onMoveEnd={vi.fn()} onRendererError={onRendererError} />)
    fake.emit('error', { error: { status: 404, url: 'https://api.mapbox.com/styles/v1/mapbox/standard?access_token=PRIVATE' } })
    expect(onRendererError).toHaveBeenCalledWith(expect.objectContaining({ code: 'STYLE_LOAD_FAILED' }))
    fake.emit('load')
    expect(onReady).toHaveBeenCalledOnce()
    const staleLoad = fake.map.on.mock.calls.find(([name]) => name === 'load')?.[1] as Listener
    view.unmount()
    staleLoad?.()
    expect(onReady).toHaveBeenCalledOnce()
    expect(fake.map.off).toHaveBeenCalledWith('load', expect.any(Function))
    warning.mockRestore()
  })

  it('becomes ready while a custom image is still downloading', async () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const onReady = vi.fn()
    render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onReady={onReady} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')
    await waitFor(() => expect(fake.map.loadImage).toHaveBeenCalledOnce())
    // Deliberately leave the image callback unresolved.
    fake.emit('load')
    expect(onReady).toHaveBeenCalledOnce()
  })

  it.each(['before', 'after'])('loads an explicit assignment arriving %s style readiness without recreating the map', async (timing) => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const props = { visualScene: null, onReady: vi.fn(), onMoveEnd: vi.fn(), onRendererError: vi.fn() }
    const view = render(<WheretooMap {...props} events={[]} />)
    if (timing === 'after') fake.emit('style.load')
    expect(fake.map.loadImage).not.toHaveBeenCalled()
    view.rerender(<WheretooMap {...props} events={getDevelopmentMapEvents()} />)
    if (timing === 'before') fake.emit('style.load')
    await waitFor(() => expect(fake.map.loadImage).toHaveBeenCalledOnce())
    fake.resolveImageLoad()
    expect(fake.map.getLayer(ids.canonical)).toBeDefined()
    expect(fake.map.addSource).toHaveBeenCalledTimes(2)
    expect(createMapboxMap).toHaveBeenCalledTimes(1)
  })

  it.each(['png', 'generic'])('unions overlapping PNG and %s hits into the existing chooser', async (kind) => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const onChooseEvents = vi.fn(), onSelectEvent = vi.fn()
    const events = getDevelopmentMapEvents().slice(0, 2).map((e, i) => ({ ...e, mapIconVersionId: i === 0 || kind === 'png' ? descriptor.versionId : null }))
    render(<WheretooMap visualScene={null} events={events} onChooseEvents={onChooseEvents} onSelectEvent={onSelectEvent} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')
    await waitFor(() => expect(fake.map.loadImage).toHaveBeenCalledOnce())
    fake.resolveImageLoad()
    fake.map.queryRenderedFeatures.mockImplementation((_point?: unknown, options?: { layers: string[] }) => {
      if (options?.layers.includes(ids.canonical) && options.layers.includes(EVENT_LAYER_IDS.hit))
        return events.flatMap(e => [{ properties: { eventId: e.id } }, { properties: { eventId: e.id } }])
      return []
    })
    fake.emit('click', { point: { x: 100, y: 100 } })
    expect(onChooseEvents).toHaveBeenCalledOnce()
    expect(onChooseEvents).toHaveBeenCalledWith(events.map(e => e.id), expect.anything())
    expect(onSelectEvent).not.toHaveBeenCalled()
  })

  it('keeps failure fallback and coordinate targeting without an invisible PNG body target', async () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const error = vi.fn(), select = vi.fn()
    render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onSelectEvent={select} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={error} />)
    fake.emit('style.load')
    await waitFor(() => expect(fake.map.loadImage).toHaveBeenCalledOnce())
    fake.rejectImageLoad()
    fake.map.queryRenderedFeatures.mockReturnValueOnce([]).mockReturnValueOnce([{ properties: { eventId: 'oakland-day-party' } }])
    fake.emit('click', { point: { x: 100, y: 100 } })
    expect(select).toHaveBeenCalledWith('oakland-day-party')
    expect(fake.map.getLayer(ids.body)).toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })

  it('repairs a partial event installation on style load', () => {
    const fake = fakeMap()
    vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    fake.map.addSource(EVENT_SOURCE_ID)
    fake.map.addLayer({ id: EVENT_LAYER_IDS.clusterHit })
    fake.map.addLayer({ id: EVENT_LAYER_IDS.clusterCount })
    fake.map.addSource.mockClear()
    fake.map.addLayer.mockClear()

    render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} selectedEventId="oakland-day-party" onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')

    expect(fake.map.addSource).toHaveBeenCalledTimes(1)
    expect(fake.map.addLayer).toHaveBeenCalledTimes(Object.keys(EVENT_LAYER_IDS).length - 2)
    expect(fake.map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: EVENT_LAYER_IDS.clusterCircle }),
      EVENT_LAYER_IDS.clusterCount,
    )
    expect(fake.map.getSource(EVENT_SOURCE_ID)).toBeDefined()
    for (const layerId of Object.values(EVENT_LAYER_IDS)) expect(fake.map.getLayer(layerId)).toBeDefined()
  })

  it('deduplicates overlapping hits into one chooser action', () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const onChooseEvents = vi.fn()
    render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onChooseEvents={onChooseEvents} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')
    fake.map.queryRenderedFeatures.mockReturnValueOnce([]).mockReturnValueOnce([
      { properties: { eventId: 'oakland-day-party' } }, { properties: { eventId: 'oakland-vinyl-night' } }, { properties: { eventId: 'oakland-day-party' } },
    ])
    fake.emit('click', { point: { x: 100, y: 100 } })
    expect(onChooseEvents).toHaveBeenCalledWith(['oakland-day-party', 'oakland-vinyl-night'], expect.objectContaining({ longitude: -122.259 }))
  })

  it('gives the actual selected presentation priority across the tap tolerance', async () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const onSelectEvent = vi.fn()
    render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} selectedEventId="oakland-day-party" onSelectEvent={onSelectEvent} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')
    await waitFor(() => expect(fake.map.loadImage).toHaveBeenCalledOnce())
    fake.resolveImageLoad()
    fake.map.queryRenderedFeatures.mockReturnValueOnce([{ properties: { eventId: 'oakland-day-party' } }])
    fake.emit('click', { point: { x: 100, y: 100 } })
    expect(fake.map.queryRenderedFeatures).toHaveBeenCalledWith(
      [[92, 92], [108, 108]],
      { layers: [
        EVENT_LAYER_IDS.selectedHit, EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedTitle,
        ids.selected, ids.selectedBody,
      ] },
    )
    expect(onSelectEvent).toHaveBeenCalledWith('oakland-day-party')
  })

  it('uses callback expansion zoom and eases a clicked live cluster', async () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')
    fake.map.queryRenderedFeatures.mockReturnValueOnce([]).mockReturnValueOnce([]).mockReturnValueOnce([{
      properties: { cluster_id: 7, point_count: 3 }, geometry: { type: 'Point', coordinates: [-122.26, 37.8] },
    }])
    fake.emit('click', { point: { x: 100, y: 100 } })
    await waitFor(() => expect(fake.map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-122.26, 37.8], zoom: 15, duration: 250 })))
    expect(fake.clusterSource.getClusterExpansionZoom).toHaveBeenCalledWith(7, expect.any(Function))
  })

  it('opens a complete chooser when a live cluster cannot expand usefully', async () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    fake.clusterSource.getClusterExpansionZoom.mockImplementation((_id, callback) => { callback(null, 14.6); return fake.clusterSource })
    fake.clusterSource.getClusterLeaves.mockImplementation((_id, _limit, _offset, callback) => {
      callback(null, [
        { properties: { eventId: 'oakland-day-party' } }, { properties: { eventId: 'oakland-vinyl-night' } },
      ]); return fake.clusterSource
    })
    const onChooseEvents = vi.fn()
    render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onChooseEvents={onChooseEvents} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')
    fake.map.queryRenderedFeatures.mockReturnValueOnce([]).mockReturnValueOnce([]).mockReturnValueOnce([{
      properties: { cluster_id: 8, point_count: 2 }, geometry: { type: 'Point', coordinates: [-122.259, 37.807] },
    }])
    fake.emit('click', { point: { x: 100, y: 100 } })
    await waitFor(() => expect(onChooseEvents).toHaveBeenCalledWith(
      ['oakland-day-party', 'oakland-vinyl-night'], { longitude: -122.259, latitude: 37.807 },
    ))
  })

  it('ignores a late expansion callback after a style/source revision', async () => {
    const fake = fakeMap(); vi.mocked(createMapboxMap).mockReturnValue(fake.map as never)
    const deferred: { callback?: (error: Error | null, zoom: number) => void } = {}
    fake.clusterSource.getClusterExpansionZoom.mockImplementation((_id, callback) => { deferred.callback = callback; return fake.clusterSource })
    render(<WheretooMap visualScene={null} events={getDevelopmentMapEvents()} onReady={vi.fn()} onMoveEnd={vi.fn()} onRendererError={vi.fn()} />)
    fake.emit('style.load')
    fake.map.queryRenderedFeatures.mockReturnValueOnce([]).mockReturnValueOnce([]).mockReturnValueOnce([{
      properties: { cluster_id: 9, point_count: 2 }, geometry: { type: 'Point', coordinates: [-122.259, 37.807] },
    }])
    fake.emit('click', { point: { x: 100, y: 100 } })
    fake.emit('style.load')
    deferred.callback?.(null, 15)
    await act(async () => undefined)
    expect(fake.map.easeTo).not.toHaveBeenCalled()
  })
})
