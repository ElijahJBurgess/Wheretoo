import { useLocation, useNavigate } from 'react-router-dom'
import { publicReturnState } from '../features/discovery/discovery.navigation'
import { parseDiscoverySearch, serializeDiscoveryFilters } from '../features/discovery/discovery.filters'
import { readMapReturn, type MapChooserContext } from './navigation/mapNavigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { WheretooMap } from './core/WheretooMap'
import type { MapViewportSnapshot } from './core/map.types'
import { usePublicMapEvents } from './data/mapEvents.query'
import { resolveVisualScene } from './core/visualScenes'
import type { WheretooMapEvent } from './data/wheretooMapEvents'
import type { SelectionCameraController } from './interactions/cameraFit'
import { reconcileSelectedEventId } from './interactions/mapSelection'
import { EventPreviewCard } from './preview/EventPreviewCard'
import { usePublicEventImages } from '../features/event-images/publicEventImages'
import { EventChooser } from './preview/EventChooser'
import { resolveEventPreviewNavigation, type EventPreviewNavigation } from './preview/eventPreviewNavigation'
import { MapStartupOverlay } from './MapStartupOverlay'
import { useMapStartupState } from './useMapStartupState'
import './living-map.css'

type ChooserContext = MapChooserContext

export function Component({ embedded = false }: { embedded?: boolean } = {}) {
  const Container = embedded ? 'section' : 'main'
  const location = useLocation()
  const navigate = useNavigate()
  const origin = location.pathname === '/discover' ? '/discover' + serializeDiscoveryFilters(parseDiscoverySearch(location.search)) : '/map'
  const [initialReturn] = useState(() => { const saved = readMapReturn(location.state); return saved?.path === origin ? saved : null })
  const pendingReturn = useRef(initialReturn)
  const root = useRef<HTMLElement | null>(null)
  const chooserTrigger = useRef<HTMLButtonElement | null>(null)
  const returnFocus = useRef<'map' | 'viewport' | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const readSnapshot = useRef<(() => MapViewportSnapshot | null) | null>(null)
  const handleSnapshotReady = useCallback((read: (() => MapViewportSnapshot | null) | null) => { readSnapshot.current = read }, [])
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useMapStartupState(attempt)
  const activeAttempt = useRef(0)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [chooser, setChooser] = useState<ChooserContext | null>(null)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const [events, setEvents] = useState<WheretooMapEvent[]>([])
  const [viewport, setViewport] = useState<MapViewportSnapshot | null>(null)
  const fixtureMode = useMemo(() => import.meta.env.DEV && ['standard', 'dense', 'colocated'].includes(new URLSearchParams(window.location.search).get('mapFixture') ?? ''), [])
  const live = usePublicMapEvents(viewport, null, !fixtureMode)
  const appliedGeneration = useRef(0)
  const [developmentNavigation, setDevelopmentNavigation] = useState<EventPreviewNavigation | null>(null)
  const cameraController = useRef<SelectionCameraController | null>(null)
  const preview = useRef<HTMLElement | null>(null)
  const scene = useMemo(() => resolveVisualScene(window.location.search, window.location.hostname), [])
  const commitEvents = useCallback((nextEvents: WheretooMapEvent[]) => {
    setEvents(nextEvents)
    setSelectedEventId((current) => reconcileSelectedEventId(current, nextEvents))
    setChooser((current) => {
      if (!current) return null
      const available = new Set(nextEvents.map(({ id }) => id))
      const eventIds = current.eventIds.filter((id) => available.has(id))
      return eventIds.length > 0 && (current.trigger === 'viewport' || eventIds.length > 1) ? { ...current, eventIds } : null
    })
  }, [])
  useEffect(() => {
    if (fixtureMode || live.generation <= appliedGeneration.current) return
    appliedGeneration.current = live.generation
    commitEvents(live.events)
    if (pendingReturn.current && !live.error && live.complete !== null) {
      const saved = pendingReturn.current
      pendingReturn.current = null
      const eligible = new Set(live.events.filter(event => Date.parse(event.endsAt) > Date.now()).map(event => event.id))
      setSelectedEventId(saved.selectedEventId && eligible.has(saved.selectedEventId) ? saved.selectedEventId : null)
      const ids = saved.chooser?.eventIds.filter(id => eligible.has(id)) ?? []
      setChooser(saved.chooser && ids.length ? { ...saved.chooser, eventIds: ids } : null)
      returnFocus.current = saved.chooser?.trigger ?? 'map'
      setFocusRequest(value => value + 1)
    }
  }, [fixtureMode, live.events, live.generation, live.complete, live.error, commitEvents])
  useEffect(() => {
    if (!import.meta.env.DEV || !fixtureMode) return
    void import('./data/developmentMapEvents').then(({ getDevelopmentMapEvents, getDevelopmentEventPreviewNavigation }) => {
      commitEvents(getDevelopmentMapEvents(window.location.search))
      setDevelopmentNavigation(getDevelopmentEventPreviewNavigation())
    })
  }, [commitEvents, fixtureMode])
  const selectedEvent = useMemo(
    () => events?.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  )
  const chooserEvents = useMemo(() => {
    if (!chooser || !events) return []
    const byId = new Map(events.map((event) => [event.id, event]))
    return chooser.eventIds.flatMap((id) => byId.get(id) ?? [])
  }, [chooser, events])
  // Images enrich this bounded selection; they are never an event-inventory authority.
  const publicImages = usePublicEventImages(!fixtureMode && selectedEvent ? [selectedEvent.id] : [])
  const publicArtworkUrl = publicImages.data?.find(image => image.eventId === selectedEventId && image.position === 1)?.url ?? null
  const chooserAnchor = chooser?.anchor ?? null
  useLayoutEffect(() => {
    if (selectedEvent && preview.current) cameraController.current?.reveal(selectedEvent, preview.current)
    else if (chooserAnchor && preview.current) cameraController.current?.reveal(chooserAnchor, preview.current)
    else cameraController.current?.cancel()
  }, [selectedEvent, chooserAnchor])
  const handleReady = useCallback((initialViewport: MapViewportSnapshot) => {
    if (activeAttempt.current !== attempt) return
    setViewport(initialViewport)
    setState('ready')
  }, [attempt, setState])
  const handleError = useCallback(() => {
    if (activeAttempt.current !== attempt) return
    setState(current => current === 'ready' ? current : 'error')
  }, [attempt, setState])
  const retryMap = useCallback(() => {
    activeAttempt.current += 1
    setAttempt(activeAttempt.current)
    setViewport(null)
    setSelectedEventId(null)
    setChooser(null)
    setInteractionError(null)
    setState('loading')
  }, [setState])
  const handleCameraControllerReady = useCallback((controller: SelectionCameraController | null) => {
    cameraController.current = controller
    if (controller && selectedEvent && preview.current) controller.reveal(selectedEvent, preview.current)
  }, [selectedEvent])
  const closePreview = useCallback(() => {
    pendingReturn.current = null
    returnFocus.current ??= 'map'
    setFocusRequest(value => value + 1)
    setSelectedEventId(null)
    setChooser(null)
    setInteractionError(null)
    // Focus is restored after the preview/chooser has unmounted, below.
  }, [])
  const handleSelectEvent = useCallback((eventId: string | null) => {
    pendingReturn.current = null
    returnFocus.current = 'map'
    setSelectedEventId(reconcileSelectedEventId(eventId, events ?? []))
    setChooser(null)
    setInteractionError(null)
  }, [events])
  const handleChooseEvents = useCallback((eventIds: string[], anchor: { longitude: number; latitude: number }) => {
    pendingReturn.current = null
    returnFocus.current = 'map'
    const available = new Set((events ?? []).map(({ id }) => id))
    const valid = [...new Set(eventIds)].filter((id) => available.has(id))
    setSelectedEventId(null)
    setInteractionError(null)
    setChooser(valid.length > 1 ? { eventIds: valid, anchor, scrollTop: 0, visibleCount: 20, trigger: 'map', focusedId: null } : null)
    if (valid.length === 1) setSelectedEventId(valid[0])
  }, [events])
  const handleChooserSelect = useCallback((eventId: string) => {
    setChooser(current => current ? { ...current, focusedId: eventId } : null)
    setSelectedEventId(reconcileSelectedEventId(eventId, events ?? []))
  }, [events])
  const handleBack = useCallback(() => setSelectedEventId(null), [])
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || (!selectedEventId && !chooser && !interactionError)) return
    event.preventDefault()
    closePreview()
  }, [chooser, closePreview, interactionError, selectedEventId])

  const visibleEvents = useMemo(() => events.filter(event => !viewport?.bounds || (
    event.longitude >= viewport.bounds.west && event.longitude <= viewport.bounds.east
    && event.latitude >= viewport.bounds.south && event.latitude <= viewport.bounds.north
  )), [events, viewport])
  const openViewportChooser = () => {
    pendingReturn.current = null
    returnFocus.current = 'viewport'
    setSelectedEventId(null)
    setInteractionError(null)
    setChooser({ eventIds: visibleEvents.map(event => event.id), anchor: viewport?.center ?? { longitude: -122.263, latitude: 37.804 }, scrollTop: 0, visibleCount: 20, trigger: 'viewport', focusedId: null })
  }
  const chooserKey = chooser?.eventIds.join(',') ?? ''
  const focusSelectionId = selectedEvent?.id ?? null
  useLayoutEffect(() => {
    if (focusSelectionId) preview.current?.focus({ preventScroll: true })
    else if (chooserKey) {
      const row = Array.from(preview.current?.querySelectorAll<HTMLElement>('[data-event-id]') ?? []).find(node => node.dataset.eventId === chooser?.focusedId)
      ;(row ?? preview.current)?.focus({ preventScroll: true })
    } else if (returnFocus.current) {
      const target = returnFocus.current === 'viewport' && chooserTrigger.current && !chooserTrigger.current.disabled
        ? chooserTrigger.current : root.current?.querySelector<HTMLElement>('.mapboxgl-canvas')
      target?.focus({ preventScroll: true })
      returnFocus.current = null
    }
  }, [focusSelectionId, chooserKey, chooser?.focusedId, focusRequest])

  const navigationState = useCallback(() => {
    const camera = (readSnapshot.current?.() ?? viewport)?.camera
    const currentState = publicReturnState(window.location.pathname === location.pathname ? window.history.state?.usr : location.state)
    const mapReturn = camera ? readMapReturn({ mapReturn: { version: 1, path: origin, camera, selectedEventId, chooser } }) : null
    const state = { ...currentState, ...(location.pathname === '/discover' ? { discoverySearch: serializeDiscoveryFilters(parseDiscoverySearch(location.search)) } : {}), ...(mapReturn ? { mapReturn } : {}) }
    return state
  }, [viewport, location.pathname, location.state, location.search, origin, selectedEventId, chooser])
  useEffect(() => {
    if (!viewport || pendingReturn.current || window.location.pathname !== location.pathname) return
    const entryKey: unknown = window.history.state?.key
    // Debounce only history bookkeeping; camera/event request timing is unchanged.
    const timer = setTimeout(() => {
      if (window.location.pathname === location.pathname && window.history.state?.key === entryKey) {
        window.history.replaceState({ ...window.history.state, usr: navigationState() }, '')
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [viewport, location.pathname, navigationState])
  const openEvent = (to: string) => {
    const state = navigationState()
    // Same per-entry history convention as DiscoveryPage; no event inventory is stored.
    window.history.replaceState({ ...window.history.state, usr: state }, '')
    navigate(to, { state })
  }

  const eventFeedback = live.error?.message ?? (live.pending
    ? live.complete === null ? 'Loading events…' : 'Updating events…'
    : live.complete === false ? 'Some events may be missing. Zoom in to narrow this area.'
      : live.complete === true && live.events.length === 0 ? 'No events found in this area.' : null)

  return (
    <Container ref={root} className={`living-map${embedded ? ' living-map--embedded' : ''}`} aria-label="Explore the Bay Area" data-renderer-state={state} onKeyDown={handleKeyDown}>
      <div className="living-map__surface" inert={state !== 'ready' || undefined}>
      {events ? <WheretooMap
        key={`map-${attempt}`}
        visualScene={scene}
        initialCamera={initialReturn?.camera}
        onSnapshotReady={handleSnapshotReady}
        events={events}
        selectedEventId={selectedEvent?.id ?? null}
        onSelectEvent={handleSelectEvent}
        onChooseEvents={handleChooseEvents}
        onClusterError={() => setInteractionError('Couldn’t load every event in this group. Tap the cluster to retry.')}
        onCameraControllerReady={handleCameraControllerReady}
        onReady={handleReady}
        onMoveEnd={setViewport}
        onRendererError={handleError}
      /> : null}
      </div>
      <header className="living-map__masthead"><span className="living-map__wordmark">wheretoo</span>{state === 'ready' ? <button ref={chooserTrigger} className="living-map__choose" type="button" aria-label="Choose an event on the map" disabled={!visibleEvents.length} onClick={openViewportChooser}>Events in view</button> : null}</header>
      {!fixtureMode && (state === 'ready' || live.error) && (eventFeedback || live.complete === null) ? <div className="living-map__event-status" role="status"><span>{eventFeedback ?? 'Loading events…'}</span>{!live.pending && (live.error || live.complete === false) ? <button type="button" onClick={live.retry}>Retry events</button> : null}</div> : null}
      {selectedEvent ? (
        <div className="living-map__preview-layer">
          <EventPreviewCard
            onOpenEvent={openEvent}
            publicArtworkUrl={fixtureMode ? undefined : publicArtworkUrl}
            ref={preview}
            event={selectedEvent}
            navigation={developmentNavigation ?? resolveEventPreviewNavigation(selectedEvent.id)}
            onClose={closePreview}
            onBack={chooser ? handleBack : undefined}
          />
        </div>
      ) : chooser && chooserEvents.length > 0 ? (
        <div className="living-map__preview-layer">
          <EventChooser
            ref={preview}
            events={chooserEvents}
            initialScrollTop={chooser.scrollTop}
            initialVisibleCount={chooser.visibleCount}
            onScrollTop={(scrollTop) => setChooser((current) => current ? { ...current, scrollTop } : null)}
            onVisibleCount={(visibleCount) => setChooser((current) => current ? { ...current, visibleCount } : null)}
            onSelect={handleChooserSelect}
            onClose={closePreview}
          />
        </div>
      ) : null}
      {interactionError ? <div className="living-map__interaction-error" role="status"><span>{interactionError}</span><button type="button" onClick={closePreview}>Dismiss</button></div> : null}
      <MapStartupOverlay key={`startup-${attempt}`} state={state} onRetry={retryMap} />
    </Container>
  )
}
