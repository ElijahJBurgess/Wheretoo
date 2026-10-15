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

type ChooserContext = { eventIds: string[]; anchor: { longitude: number; latitude: number }; scrollTop: number; visibleCount: number }

export function Component({ embedded = false }: { embedded?: boolean } = {}) {
  const Container = embedded ? 'section' : 'main'
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
      return eventIds.length > 1 ? { ...current, eventIds } : null
    })
  }, [])
  useEffect(() => {
    if (fixtureMode || live.error || live.pending || live.generation <= appliedGeneration.current) return
    appliedGeneration.current = live.generation
    commitEvents(live.events)
  }, [fixtureMode, live.events, live.generation, live.error, live.pending, commitEvents])
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
    setSelectedEventId(null)
    setChooser(null)
    setInteractionError(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.mapboxgl-canvas')?.focus())
  }, [])
  const handleSelectEvent = useCallback((eventId: string | null) => {
    setSelectedEventId(reconcileSelectedEventId(eventId, events ?? []))
    setChooser(null)
    setInteractionError(null)
  }, [events])
  const handleChooseEvents = useCallback((eventIds: string[], anchor: { longitude: number; latitude: number }) => {
    const available = new Set((events ?? []).map(({ id }) => id))
    const valid = [...new Set(eventIds)].filter((id) => available.has(id))
    setSelectedEventId(null)
    setInteractionError(null)
    setChooser(valid.length > 1 ? { eventIds: valid, anchor, scrollTop: 0, visibleCount: 20 } : null)
    if (valid.length === 1) setSelectedEventId(valid[0])
  }, [events])
  const handleChooserSelect = useCallback((eventId: string) => {
    setSelectedEventId(reconcileSelectedEventId(eventId, events ?? []))
  }, [events])
  const handleBack = useCallback(() => setSelectedEventId(null), [])
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || (!selectedEventId && !chooser && !interactionError)) return
    event.preventDefault()
    closePreview()
  }, [chooser, closePreview, interactionError, selectedEventId])

  return (
    <Container className={`living-map${embedded ? ' living-map--embedded' : ''}`} aria-label="Explore the Bay Area" data-renderer-state={state} onKeyDown={handleKeyDown}>
      <div className="living-map__surface" inert={state !== 'ready' || undefined}>
      {events ? <WheretooMap
        key={`map-${attempt}`}
        visualScene={scene}
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
      <header className="living-map__masthead"><span className="living-map__wordmark">wheretoo</span></header>
      {!fixtureMode && live.error ? <div className="living-map__interaction-error" role="status"><span>{live.error.message}</span><button type="button" onClick={live.retry}>Retry events</button></div> : null}
      {selectedEvent ? (
        <div className="living-map__preview-layer">
          <EventPreviewCard
            publicArtworkUrl={fixtureMode ? undefined : publicArtworkUrl}
            ref={preview}
            event={selectedEvent}
            navigation={developmentNavigation ?? resolveEventPreviewNavigation(selectedEvent.id)}
            onClose={closePreview}
            onBack={chooser ? handleBack : undefined}
          />
        </div>
      ) : chooser && chooserEvents.length > 1 ? (
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
