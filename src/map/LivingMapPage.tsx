import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { WheretooMap } from './core/WheretooMap'
import type { MapRendererError, MapViewportSnapshot } from './core/map.types'
import { usePublicMapEvents, type MapTimeFilter } from './data/mapEvents.query'
import { WheretooLogo } from '../components/brand/WheretooLogo'
import { eventCategories, type EventCategory } from '../features/events/event.types'
import { resolveVisualScene } from './core/visualScenes'
import type { WheretooMapEvent } from './data/wheretooMapEvents'
import type { SelectionCameraController } from './interactions/cameraFit'
import { reconcileSelectedEventId } from './interactions/mapSelection'
import { EventPreviewCard } from './preview/EventPreviewCard'
import { EventChooser } from './preview/EventChooser'
import { resolveEventPreviewNavigation, type EventPreviewNavigation } from './preview/eventPreviewNavigation'
import './living-map.css'

const categoryLabels: Record<EventCategory, string> = {
  food_drink: 'Food & drink', music: 'Music', fitness: 'Fitness', art_culture: 'Art & culture',
  shopping: 'Shopping', community: 'Community', nightlife: 'Nightlife', other: 'Other',
}

type ChooserContext = { eventIds: string[]; anchor: { longitude: number; latitude: number }; scrollTop: number; visibleCount: number }

export function Component({ embedded = false }: { embedded?: boolean } = {}) {
  const [timeFilter, setTimeFilter] = useState<MapTimeFilter>('next7days')
  const [category, setCategory] = useState<EventCategory | ''>('')
  const [attempt, setAttempt] = useState(0)
  const [showEvents, setShowEvents] = useState(false)
  const Root = embedded ? 'section' : 'main'
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<MapRendererError | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [chooser, setChooser] = useState<ChooserContext | null>(null)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const [events, setEvents] = useState<WheretooMapEvent[]>([])
  const [viewport, setViewport] = useState<MapViewportSnapshot | null>(null)
  const fixtureMode = useMemo(() => import.meta.env.DEV && ['standard', 'dense', 'colocated'].includes(new URLSearchParams(window.location.search).get('mapFixture') ?? ''), [])
  const live = usePublicMapEvents(viewport, category ? [category] : null, !fixtureMode, timeFilter)
  const appliedGeneration = useRef(0)
  const [developmentNavigation, setDevelopmentNavigation] = useState<EventPreviewNavigation | null>(null)
  const fatal = useRef(false)
  const cameraController = useRef<SelectionCameraController | null>(null)
  const preview = useRef<HTMLElement | null>(null)
  const focusPreview = useRef(false)
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
  const chooserAnchor = chooser?.anchor ?? null
  useLayoutEffect(() => {
    if (selectedEvent && preview.current) cameraController.current?.reveal(selectedEvent, preview.current)
    else if (chooserAnchor && preview.current) cameraController.current?.reveal(chooserAnchor, preview.current)
    else cameraController.current?.cancel()
    if (selectedEvent && focusPreview.current) {
      preview.current?.focus({ preventScroll: true })
      focusPreview.current = false
    }
  }, [selectedEvent, chooserAnchor])
  const handleReady = useCallback((initialViewport: MapViewportSnapshot) => {
    setViewport(initialViewport)
    if (!fatal.current) setState('ready')
  }, [])
  const handleError = useCallback((nextError: MapRendererError) => {
    fatal.current = true
    setError(nextError)
    setState('error')
  }, [])
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
    <Root className={`living-map${embedded ? ' living-map--embedded' : ''}`} aria-label="Explore the Bay Area" data-renderer-state={state} onKeyDown={handleKeyDown}>
      {events ? <WheretooMap
        key={attempt}
        cooperativeGestures={embedded}
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
      <header className="living-map__masthead">
        <a href="/" aria-label="Wheretoo home"><WheretooLogo theme="white" width={110} /></a>
        <a className="living-map__exit" href={embedded ? '/map' : '/'}>{embedded ? 'Open full map ↗' : 'Back to home'}</a>
      </header>
      <div className="living-map__filters" aria-label="Map filters">
        <label><span>When</span><select aria-label="When" value={timeFilter} onChange={event => setTimeFilter(event.target.value as MapTimeFilter)}>
          <option value="next7days">Next 7 days</option><option value="today">Today</option><option value="now">Happening now</option>
        </select></label>
        <label><span>Category</span><select aria-label="Category" value={category} onChange={event => setCategory(event.target.value as EventCategory | '')}>
          <option value="">All events</option>{eventCategories.map(value => <option key={value} value={value}>{categoryLabels[value]}</option>)}
        </select></label>
        <button type="button" aria-expanded={showEvents} onClick={() => setShowEvents(value => !value)}>Events in view{events.length ? ` (${events.length})` : ''}</button>
      </div>
      {state === 'ready' && !fixtureMode && live.pending ? <p className="living-map__results-note" role="status">Updating events…</p> : null}
      {state === 'ready' && !fixtureMode && !live.pending && !live.error && live.generation > 0 && events.length === 0 ?
        <div className="living-map__empty" role="status"><strong>No events in this area yet</strong><span>Move the map or change your filters to explore more of the Bay.</span></div> : null}
      {showEvents && !selectedEvent && !chooser ? <section className="living-map__event-list" aria-label="Events in view">
        <div><strong>Events in view</strong><button type="button" aria-label="Close event list" onClick={() => setShowEvents(false)}>×</button></div>
        {events.length ? events.map(event => <button key={event.id} type="button" onClick={() => { focusPreview.current = true; handleSelectEvent(event.id); setShowEvents(false) }}><strong>{event.title}</strong><span>{event.venueLabel}</span></button>) : <p>{live.pending ? 'Loading events…' : live.error ? 'Events could not load. Use Retry events to try again.' : 'No events match this view. Try another area or filter.'}</p>}
      </section> : null}
      {!fixtureMode && live.error ? <div className="living-map__interaction-error" role="status"><span>{live.error.message}</span><button type="button" onClick={live.retry}>Retry events</button></div> : null}
      {selectedEvent ? (
        <div className="living-map__preview-layer">
          <EventPreviewCard
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
      {state === 'loading' ? <p className="living-map__status" role="status">Loading the map…</p> : null}
      {state === 'error' && error ? (
        <section className="living-map__error" role="alert">
          <h2>Map unavailable</h2>
          <p>{error.message} Check your connection and reload this page.</p>
          <button className="ui-button ui-button--primary" onClick={() => {
            fatal.current = false; setError(null); setState('loading'); setAttempt(value => value + 1)
          }}>Try map again</button>
        </section>
      ) : null}
    </Root>
  )
}
