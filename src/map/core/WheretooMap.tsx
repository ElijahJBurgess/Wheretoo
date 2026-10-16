import { describeStartupError } from './mapStartupErrors'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoJSONSource, MapMouseEvent } from 'mapbox-gl/esm'
import { requirePublicMapboxAccessToken } from '../../config/browserEnv'
import { MapIconController } from '../icons/MapIconController'
import { fetchMapIconDescriptors } from '../../features/map-icons/icon.loader'
import type { IconDescriptor } from '../../features/map-icons/icon.api'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import { createSelectionCameraController, type SelectionCameraController } from '../interactions/cameraFit'
import { ClusterInteractionGuard, getClusterExpansionZoom, getCompleteClusterEventIds } from '../interactions/clusterOperations'
import { uniqueEventIds } from '../interactions/mapHitTesting'
import { EVENT_LAYER_IDS, EVENT_SOURCE_ID } from '../style/eventLayers'
import { hasCompleteEventLayerInstallation, installEventLayers, updateEventCollection, updateEventMarkerSizing, updateEventSelection } from './eventLayerController'
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, MOBILE_MAP_BREAKPOINT, SERVICE_BOUNDS } from './map.constants'
import { createMapboxMap, createMapOptions, createNavigationControl, isMapboxSupported } from './mapbox.factory'
import type { MapCamera, MapRendererError, MapViewportSnapshot } from './map.types'
import type { VisualScene } from './visualScenes'

export type WheretooMapProps = {
  onBroadenReady?(broaden: (() => void) | null): void
  initialCamera?: MapCamera | null
  onRestoreReady?(restore: ((camera: MapCamera) => void) | null): void
  onSnapshotReady?(read: (() => MapViewportSnapshot | null) | null): void
  visualScene: VisualScene | null
  events?: readonly WheretooMapEvent[]
  selectedEventId?: string | null
  onSelectEvent?(eventId: string | null): void
  onChooseEvents?(eventIds: string[], anchor: { longitude: number; latitude: number }): void
  onClusterError?(): void
  onCameraControllerReady?(controller: SelectionCameraController | null): void
  onReady(viewport: MapViewportSnapshot): void
  onMoveEnd(viewport: MapViewportSnapshot): void
  onRendererError(error: MapRendererError): void
}

const EMPTY_EVENTS: readonly WheretooMapEvent[] = []

const configReadbackKeys = [
  'lightPreset', 'theme', 'font', 'showPointOfInterestLabels', 'showRoadLabels',
  'showPedestrianRoads', 'showPlaceLabels', 'densityPointOfInterestLabels',
  'colorModePointOfInterestLabels', 'colorPointOfInterestLabels',
  'backgroundPointOfInterestLabels', 'showTransitLabels', 'showLandmarkIcons',
  'showLandmarkIconLabels', 'showIndoor', 'showIndoorLabels', 'show3dObjects',
  'show3dBuildings', 'show3dFacades', 'show3dLandmarks', 'show3dTrees',
] as const

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function readViewport(map: ReturnType<typeof createMapboxMap>): MapViewportSnapshot | null {
  const bounds = map.getBounds()
  if (!bounds) return null
  const west = clamp(bounds.getWest(), SERVICE_BOUNDS[0][0], SERVICE_BOUNDS[1][0])
  const south = clamp(bounds.getSouth(), SERVICE_BOUNDS[0][1], SERVICE_BOUNDS[1][1])
  const east = clamp(bounds.getEast(), SERVICE_BOUNDS[0][0], SERVICE_BOUNDS[1][0])
  const north = clamp(bounds.getNorth(), SERVICE_BOUNDS[0][1], SERVICE_BOUNDS[1][1])
  if (west >= east || south >= north) return null
  const center = map.getCenter()
  return {
    bounds: { west, south, east, north },
    center: {
      longitude: clamp(center.lng, SERVICE_BOUNDS[0][0], SERVICE_BOUNDS[1][0]),
      latitude: clamp(center.lat, SERVICE_BOUNDS[0][1], SERVICE_BOUNDS[1][1]),
    },
    zoom: clamp(map.getZoom(), MAP_MIN_ZOOM, MAP_MAX_ZOOM),
    camera: { center: [center.lng, center.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() },
  }
}

function rendererError(code: MapRendererError['code']): MapRendererError {
  const messages = {
    WEBGL_UNSUPPORTED: 'This browser cannot display the Wheretoo map.',
    TOKEN_INVALID: 'The Wheretoo map could not authenticate.',
    STYLE_LOAD_FAILED: 'The map style could not load.',
    RENDERER_FAILED: 'The Wheretoo map could not start.',
    DATA_INVALID: 'The Wheretoo event data is invalid.',
  } as const
  return { code, message: messages[code] }
}

function readClusterFeature(feature: unknown) {
  if (!feature || typeof feature !== 'object' || !('properties' in feature) || !('geometry' in feature)) return null
  const properties = feature.properties
  const geometry = feature.geometry
  if (!properties || typeof properties !== 'object' || !geometry || typeof geometry !== 'object') return null
  if (!('cluster_id' in properties) || !('point_count' in properties) || !('type' in geometry) || !('coordinates' in geometry)) return null
  const clusterId = properties.cluster_id
  const pointCount = properties.point_count
  const coordinates = geometry.coordinates
  if (typeof clusterId !== 'number' || typeof pointCount !== 'number' || geometry.type !== 'Point' || !Array.isArray(coordinates)) return null
  if (typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') return null
  return { clusterId, pointCount, anchor: { longitude: coordinates[0], latitude: coordinates[1] } }
}

export function WheretooMap({
  visualScene, events = EMPTY_EVENTS, selectedEventId = null, onSelectEvent = () => undefined, onCameraControllerReady = () => undefined,
  onChooseEvents = () => undefined, onClusterError = () => undefined,
  onReady, onMoveEnd, onRendererError, initialCamera, onSnapshotReady, onBroadenReady, onRestoreReady,
}: WheretooMapProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const initialScene = useRef(visualScene)
  const navigationCamera = useRef(initialCamera)
  const currentEvents = useRef(events)
  const mapRef = useRef<ReturnType<typeof createMapboxMap> | null>(null)
  const layersInstalled = useRef(false)
  const icons = useRef<MapIconController | null>(null)
  const refreshIconViewport = useRef<(() => void) | null>(null)
  const manifest = useRef<{ descriptors: IconDescriptor[]; expiresAt: number }>({ descriptors: [], expiresAt: 0 })
  const iconIdsKey = JSON.stringify([...new Set(events.flatMap(e => e.mapIconVersionId ? [e.mapIconVersionId] : []))].sort())
  const selection = useRef(selectedEventId)
  const interactionGuard = useRef(new ClusterInteractionGuard())
  const callbacks = useRef({ onReady, onMoveEnd, onRendererError, onSelectEvent, onChooseEvents, onClusterError, onCameraControllerReady, onSnapshotReady, onBroadenReady, onRestoreReady })
  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), [])

  useEffect(() => {
    callbacks.current = { onReady, onMoveEnd, onRendererError, onSelectEvent, onChooseEvents, onClusterError, onCameraControllerReady, onSnapshotReady, onBroadenReady, onRestoreReady }
  }, [onReady, onMoveEnd, onRendererError, onSelectEvent, onChooseEvents, onClusterError, onCameraControllerReady, onSnapshotReady, onBroadenReady, onRestoreReady])

  useEffect(() => {
    let disposed = false, generation = 0, inFlight = false, lastForeground = -Infinity
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || inFlight) return
      inFlight = true
      const token = ++generation
      const started = Date.now()
      const descriptors = await fetchMapIconDescriptors(JSON.parse(iconIdsKey) as string[]).catch(() => []).finally(() => { inFlight = false })
      if (disposed || token !== generation) return
      manifest.current = { descriptors, expiresAt: started + 60000 }
      icons.current?.setDescriptors(descriptors, manifest.current.expiresAt)
    }
    void refresh()
    // Renew ahead of the hard lease deadline; a failed renewal still expires at 60s.
    const timer = setInterval(() => { void refresh() }, 45000)
    const foreground = () => {
      if (document.visibilityState !== 'visible' || inFlight || Date.now() - lastForeground < 250) return
      lastForeground = Date.now(); void refresh()
    }
    window.addEventListener('focus', foreground)
    window.addEventListener('online', foreground)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      disposed = true; clearInterval(timer)
      window.removeEventListener('focus', foreground); window.removeEventListener('online', foreground)
      document.removeEventListener('visibilitychange', foreground)
    }
  }, [iconIdsKey])

  useEffect(() => {
    currentEvents.current = events
    if (mapRef.current && layersInstalled.current) {
      interactionGuard.current.advanceSourceRevision()
      try {
        updateEventCollection(mapRef.current, events)
        updateEventSelection(mapRef.current, events.find(({ id }) => id === selection.current) ?? null)
        icons.current?.setEvents(events)
        refreshIconViewport.current?.()
      } catch { callbacks.current.onRendererError(rendererError('DATA_INVALID')) }
    } else icons.current?.setEvents(events)
  }, [events])

  useEffect(() => {
    selection.current = selectedEventId
    if (mapRef.current && layersInstalled.current) updateEventSelection(
      mapRef.current, currentEvents.current.find(({ id }) => id === selectedEventId) ?? null,
    )
    icons.current?.setSelection(selectedEventId)
  }, [selectedEventId])

  useEffect(() => {
    if (!container) return
    const guard = interactionGuard.current
    if (!isMapboxSupported()) {
      callbacks.current.onRendererError(rendererError('WEBGL_UNSUPPORTED'))
      return
    }

    let accessToken: string
    try {
      accessToken = requirePublicMapboxAccessToken(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN)
    } catch {
      callbacks.current.onRendererError(rendererError('TOKEN_INVALID'))
      return
    }

    const options = createMapOptions({
      container,
      accessToken,
      mobile: container.clientWidth < MOBILE_MAP_BREAKPOINT,
    })
    if (initialScene.current) {
      const scene = initialScene.current
      Object.assign(options, { center: scene.center, zoom: scene.zoom, pitch: scene.pitch, bearing: scene.bearing })
    }

    if (navigationCamera.current) Object.assign(options, navigationCamera.current)

    let map: ReturnType<typeof createMapboxMap>
    try {
      map = createMapboxMap(options)
    } catch (error) {
      callbacks.current.onRendererError(rendererError(
        error instanceof Error && /access token|unauthorized|401/i.test(error.message) ? 'TOKEN_INVALID' : 'RENDERER_FAILED',
      ))
      return
    }
    mapRef.current = map
    callbacks.current.onBroadenReady?.(() => { map.zoomOut({ duration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 300 }) })
    callbacks.current.onSnapshotReady?.(() => readViewport(map))
    callbacks.current.onRestoreReady?.(camera => { map.stop(); map.jumpTo(camera) })
    const cameraController = createSelectionCameraController(map, container)
    callbacks.current.onCameraControllerReady(cameraController)

    let ready = false
    let disposed = false
    let diagnosticCount = 0
    const iconController = new MapIconController(map)
    icons.current = iconController
    iconController.setEvents(currentEvents.current)
    iconController.setSelection(selection.current)
    iconController.setDescriptors(manifest.current.descriptors, manifest.current.expiresAt)
    let density = container.clientWidth < MOBILE_MAP_BREAKPOINT ? 2 : 3
    let mobile = container.clientWidth < MOBILE_MAP_BREAKPOINT
    const navigation = createNavigationControl()
    map.addControl(navigation, 'top-right')
    map.dragRotate.disableRotation()
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableBearing()
    map.keyboard.disablePitch()

    const reconcileIcons = () => {
      if (!layersInstalled.current || !hasCompleteEventLayerInstallation(map)) return
      const bounds = map.getBounds()
      iconController.setViewport({
        mobile, zoom: map.getZoom(), longitude: map.getCenter().lng, latitude: map.getCenter().lat,
        visibleIds: new Set(currentEvents.current.filter(e => bounds && e.longitude >= bounds.getWest()
          && e.longitude <= bounds.getEast() && e.latitude >= bounds.getSouth() && e.latitude <= bounds.getNorth()).map(e => e.id)),
      })
    }
    refreshIconViewport.current = reconcileIcons

    const handleMapClick = (event: MapMouseEvent) => {
      const token = guard.begin()
      const point = event.point
      const tolerance: [[number, number], [number, number]] = [[point.x - 8, point.y - 8], [point.x + 8, point.y + 8]]
      const flagLayers = iconController.interactiveLayers(true)
      const selected = uniqueEventIds(map.queryRenderedFeatures(tolerance, {
        layers: [EVENT_LAYER_IDS.selectedHit, EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedTitle, ...flagLayers],
      }))
      if (selection.current && selected.includes(selection.current) && currentEvents.current.some(e => e.id === selection.current)) {
        callbacks.current.onSelectEvent(selection.current); return
      }
      const candidates = uniqueEventIds(map.queryRenderedFeatures(
        tolerance, { layers: [EVENT_LAYER_IDS.hit, ...iconController.interactiveLayers(false)] },
      ))
      const validIds = currentEvents.current.filter(e => candidates.includes(e.id)).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)).map(e => e.id)
      if (validIds.length === 1) { callbacks.current.onSelectEvent(validIds[0]); return }
      if (validIds.length > 1) {
        const first = currentEvents.current.find(({ id }) => id === validIds[0])
        if (first) callbacks.current.onChooseEvents(validIds, { longitude: first.longitude, latitude: first.latitude })
        return
      }
      const cluster = readClusterFeature(map.queryRenderedFeatures(event.point, { layers: [EVENT_LAYER_IDS.clusterHit] })[0])
      if (!cluster) {
        callbacks.current.onSelectEvent(null); return
      }
      callbacks.current.onSelectEvent(null)
      const { clusterId, pointCount, anchor } = cluster
      const clusterSource = map.getSource(EVENT_SOURCE_ID) as GeoJSONSource | undefined
      if (!clusterSource) return
      void getClusterExpansionZoom(clusterSource, clusterId).then(async (zoom) => {
        if (!guard.isCurrent(token)) return
        const destination = clamp(zoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM)
        if (destination > map.getZoom() + 0.05) {
          const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
          map.easeTo({ center: [anchor.longitude, anchor.latitude], zoom: destination, duration: reducedMotion ? 0 : 250, essential: false })
          return
        }
        const ids = await getCompleteClusterEventIds(
          clusterSource, clusterId, pointCount, currentEvents.current.length, () => guard.isCurrent(token),
        )
        if (guard.isCurrent(token)) callbacks.current.onChooseEvents(ids, anchor)
      }).catch(() => { if (guard.isCurrent(token)) callbacks.current.onClusterError() })
    }
    const handlePointerMove = (event: MapMouseEvent) => {
      if (mobile) return
      const flagLayers = iconController.interactiveLayers(true)
      const features = map.queryRenderedFeatures(event.point, { layers: [
        EVENT_LAYER_IDS.selectedHit, EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedTitle,
        ...flagLayers, ...iconController.interactiveLayers(false), EVENT_LAYER_IDS.hit, EVENT_LAYER_IDS.clusterHit,
      ] })
      map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : ''
    }
    const handleStyleLoad = () => {
      if (disposed) return
      guard.advanceSourceRevision()
      const complete = hasCompleteEventLayerInstallation(map)
      if (!complete) {
        try { installEventLayers(map, currentEvents.current, mobile, currentEvents.current.find(e => e.id === selection.current) ?? null) }
        catch { callbacks.current.onRendererError(rendererError('DATA_INVALID')); return }
      }
      layersInstalled.current = true
      if (!complete) iconController.onStyleLoad()
      else iconController.reconcile()
      reconcileIcons()
    }

    const handleIdle = () => { if (!disposed) reconcileIcons() }
    // Mapbox load follows the first visually complete render; idle also waits
    // for transitions and background work and is not a startup readiness gate.
    const handleLoad = () => {
      if (ready || disposed) return
      const viewport = readViewport(map)
      if (!viewport) return
      const readback = Object.fromEntries(configReadbackKeys.map((key) => [key, map.getConfigProperty('basemap', key)]))
      container.dataset.standardConfig = JSON.stringify(readback)
      container.dataset.camera = JSON.stringify({
        center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
      })
      ready = true
      callbacks.current.onReady(viewport)
    }
    const handleMoveEnd = () => {
      if (disposed) return
      cameraController.settle()
      reconcileIcons()
      const viewport = readViewport(map)
      if (viewport) callbacks.current.onMoveEnd(viewport)
      container.dataset.camera = JSON.stringify({
        center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
      })
    }
    const handleUserGesture = () => { guard.invalidate(); cameraController.interrupt() }
    const handleError = (event: unknown) => {
      if (ready || disposed) return
      const diagnostic = describeStartupError(event)
      if (diagnosticCount++ < 3) console.warn('[Wheretoo map] Startup resource error', diagnostic)
      if (diagnostic.fatal) callbacks.current.onRendererError(rendererError(diagnostic.fatal))
    }
    const observer = new ResizeObserver((entries) => {
      if (disposed) return
      const width = entries[0]?.contentRect.width ?? container.clientWidth
      const nextDensity = width < MOBILE_MAP_BREAKPOINT ? 2 : 3
      const nextMobile = width < MOBILE_MAP_BREAKPOINT
      map.resize()
      if (nextDensity !== density) {
        density = nextDensity
        map.setConfigProperty('basemap', 'densityPointOfInterestLabels', density)
      }
      if (nextMobile !== mobile) {
        mobile = nextMobile
        if (layersInstalled.current) updateEventMarkerSizing(map, mobile, selection.current)
      }
      reconcileIcons()
      cameraController.remeasure()
    })

    map.on('style.load', handleStyleLoad)
    map.on('click', handleMapClick)
    map.on('mousemove', handlePointerMove)
    map.on('idle', handleIdle)
    map.on('load', handleLoad)
    map.on('zoom', reconcileIcons)
    map.on('moveend', handleMoveEnd)
    map.on('error', handleError)
    map.on('dragstart', handleUserGesture)
    map.on('zoomstart', handleUserGesture)
    observer.observe(container)

    return () => {
      disposed = true
      iconController.dispose()
      icons.current = null
      refreshIconViewport.current = null
      observer.disconnect()
      map.off('style.load', handleStyleLoad)
      map.off('click', handleMapClick)
      map.off('mousemove', handlePointerMove)
      map.off('idle', handleIdle)
      map.off('load', handleLoad)
      map.off('zoom', reconcileIcons)
      map.off('moveend', handleMoveEnd)
      map.off('error', handleError)
      map.off('dragstart', handleUserGesture)
      map.off('zoomstart', handleUserGesture)
      cameraController.cancel()
      guard.invalidate()
      callbacks.current.onCameraControllerReady(null)
      map.removeControl(navigation)
      map.remove()
      callbacks.current.onSnapshotReady?.(null)
      callbacks.current.onRestoreReady?.(null)
      callbacks.current.onBroadenReady?.(null)
      mapRef.current = null
      layersInstalled.current = false
    }
  }, [container])

  return (
    <div
      ref={containerRef}
      className="living-map__canvas"
      data-wheretoo-event-count={events.length}
      data-selected-event-id={selectedEventId ?? ''}
    />
  )
}
