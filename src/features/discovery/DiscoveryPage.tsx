import { usePublicEventImages } from '../event-images/publicEventImages'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { readMapReturn } from '../../map/navigation/mapNavigation'
import type { DiscoveryMapHandle } from '../../map/LivingMapPage'
import type { MapBounds } from '../../map/core/map.types'
import { MAP_MIN_ZOOM } from '../../map/core/map.constants'
import { BAY_AREA_BOUNDS, discoveryBounds } from './discovery.scope'
import { DiscoveryMapPreview } from './DiscoveryMapPreview'
import { DiscoveryView } from './DiscoveryView'
import { parseDiscoverySearch, serializeDiscoveryFilters } from './discovery.filters'
import { discoveryMode, discoverySearch, type DiscoveryMode } from './discovery.location'
import { discoveryFocusEventId, discoveryViewScroll, publicReturnPath, publicReturnState, captureDiscoveryScroll, discoveryScrollPosition, discoveryCardScrollPosition } from './discovery.navigation'
import { useDiscovery } from './discovery.queries'
import type { DiscoveryFilters } from './discovery.types'

export function DiscoveryPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const navigationType = useNavigationType()
  const mode = discoveryMode(location.search)
  const filters = parseDiscoverySearch(location.search)
  const submittedFilters = useRef(filters)
  const { when, category, price } = filters
  useLayoutEffect(() => { if (navigationType === 'POP') submittedFilters.current = { when, category, price } }, [navigationType, when, category, price])
  const filterSearch = serializeDiscoveryFilters(filters)
  const search = discoverySearch(filters, mode)
  const viewScroll = useRef(discoveryViewScroll(location.state))
  const lastMode = useRef(mode)
  const visitedModes = useRef(new Set<DiscoveryMode>(location.state?.discoveryViewScroll ? ['map', 'list'] : [mode]))
  const mapHandle = useRef<DiscoveryMapHandle | null>(null)
  const [scope, setScope] = useState(() => ({ bounds: readMapReturn(location.state)?.area ?? null as MapBounds | null, fallback: false }))
  const [canBroaden, setCanBroaden] = useState(false)
  const [scopeEntry, setScopeEntry] = useState(location.key)
  if (scopeEntry !== location.key) {
    setScopeEntry(location.key)
    const area = readMapReturn(location.state)?.area
    if (navigationType === 'POP' && area) setScope({ bounds: area, fallback: false })
  }
  const contextReady = useCallback((handle: DiscoveryMapHandle | null) => { mapHandle.current = handle }, [])
  const areaChanged = useCallback((next: MapBounds) => {
    const bounds = discoveryBounds(next)
    setScope(previous => JSON.stringify(previous.bounds) === JSON.stringify(bounds) && !previous.fallback ? previous : { bounds, fallback: false })
    setCanBroaden((mapHandle.current?.state().mapReturn?.camera.zoom ?? MAP_MIN_ZOOM) > MAP_MIN_ZOOM + 0.01)
  }, [])
  const mapUnavailable = useCallback(() => setScope(previous => previous.bounds ? previous : { bounds: BAY_AREA_BOUNDS, fallback: true }), [])
  const discovery = useDiscovery(filters, scope.bounds, { activeList: mode === 'list', onAuthoritativeListRefresh: () => mapHandle.current?.invalidateEvents?.() })
  const firstPageIds = new Set(discovery.highlightItems.map(item => item.id))
  // Keep first-page artwork independent of appended IDs: a new image query must
  // not temporarily replace the feature with the first no-artwork fallback.
  const firstPageImages = usePublicEventImages([...firstPageIds])
  const appendedImages = usePublicEventImages(discovery.items.filter(item => !firstPageIds.has(item.id)).map(item => item.id))
  const withImage = (item: (typeof discovery.items)[number]) => {
    const images = firstPageIds.has(item.id) ? firstPageImages.data : appendedImages.data
    return { ...item, artworkReference: images?.find(image => image.eventId === item.id && image.position === 1)?.url ?? null }
  }
  const restored = useRef<string | null>(null)
  const mountedEntry = useRef(location.key)

  useEffect(() => {
    document.title = 'Discover events · Wheretoo'
    if (location.search !== search || location.hash) {
      navigate({ pathname: '/discover', search }, { replace: true, state: { ...publicReturnState(location.state), discoverySearch: search, ...(readMapReturn(location.state) ? { mapReturn: { ...readMapReturn(location.state)!, path: '/discover' + search } } : {}) } })
    }
  }, [location.search, location.hash, location.state, navigate, search])

  useLayoutEffect(() => {
    // A delayed return read must not undo the buyer's next gesture or key press.
    const cancelRestore = () => { restored.current = location.key }
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const input of inputs) window.addEventListener(input, cancelRestore, { passive: true })
    return () => { for (const input of inputs) window.removeEventListener(input, cancelRestore) }
  }, [location.key])

  useLayoutEffect(() => {
    if (discovery.status === 'loading' || restored.current === location.key) return
    restored.current = location.key
    if (lastMode.current !== mode || navigationType === 'POP' || (mountedEntry.current === location.key && location.state?.mapReturn && publicReturnPath(location.state) === '/discover' + search)) {
      viewScroll.current = discoveryViewScroll(location.state)
      window.scrollTo({ top: discoveryScrollPosition(location.state), behavior: 'instant' })
      const cards = document.querySelector('.discovery-event-list')
      if (cards) cards.scrollLeft = discoveryCardScrollPosition(location.state)
      const focusedEvent = discoveryFocusEventId(location.state)
      if (mode === 'list' && mountedEntry.current === location.key && focusedEvent) {
        const link = document.querySelector<HTMLAnchorElement>(`#discovery-list-panel a[href="/events/${focusedEvent}"]`)
        const target = link ?? document.querySelector<HTMLButtonElement>('.discovery-mode-toggle button[aria-pressed="true"]')
        target?.focus({ preventScroll: true })
      }
    }
    lastMode.current = mode
  }, [discovery.status, location.key, location.state, navigationType, search, mode])

  function captureState() {
    const saved = mapHandle.current?.state() ?? publicReturnState(window.history.state?.usr ?? location.state)
    viewScroll.current = { ...viewScroll.current, [mode]: Math.min(1_000_000, Math.max(0, window.scrollY)) }
    return { ...captureDiscoveryScroll(saved), discoverySearch: search, discoveryViewScroll: viewScroll.current }
  }
  function changeFilters(requested: DiscoveryFilters, field?: keyof DiscoveryFilters) {
    const next = field ? { ...submittedFilters.current, [field]: requested[field] } : requested
    submittedFilters.current = next
    const nextSearch = discoverySearch(next, mode)
    if (search === nextSearch) return
    const previous = captureState()
    window.history.replaceState({ ...window.history.state, usr: previous }, '')
    client.removeQueries({ queryKey: ['public-discovery', 'v1', serializeDiscoveryFilters(next)] })
    const mapReturn = previous.mapReturn ? { ...previous.mapReturn, path: '/discover' + nextSearch } : undefined
    navigate({ pathname: '/discover', search: nextSearch }, { state: { ...previous, ...(mapReturn ? { mapReturn } : {}) } })
  }

  function changeMode(next: DiscoveryMode) {
    if (next === mode) return
    const previous = captureState()
    window.history.replaceState({ ...window.history.state, usr: previous }, '')
    if (!visitedModes.current.has(next)) viewScroll.current[next] = viewScroll.current[mode]
    visitedModes.current.add(next)
    const nextSearch = discoverySearch(filters, next)
    const mapReturn = previous.mapReturn ? { ...previous.mapReturn, path: '/discover' + nextSearch } : undefined
    navigate({ pathname: '/discover', search: nextSearch }, { state: { ...previous, discoveryViewScroll: viewScroll.current, discoverySearch: nextSearch, discoveryScroll: viewScroll.current[next], ...(mapReturn ? { mapReturn } : {}) } })
  }

  return <div onClickCapture={event => {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    const href = link?.getAttribute('href')
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (href && (href === '/discover' || href.startsWith('/discover?')) && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const next = parseDiscoverySearch(href.slice('/discover'.length))
      event.preventDefault()
      if (serializeDiscoveryFilters(next) !== filterSearch) changeFilters(next)
      return
    }
    if (!href || !(href.startsWith('/events/') || href === '/map' || href.startsWith('/map?'))) return
    if (link?.closest('.living-map')) return // The map owns its preview navigation.
    const saved = captureState()
    const previous = href.startsWith('/events/') ? publicReturnState({ ...saved, discoveryFocusEventId: href.slice('/events/'.length) }) : saved
    window.history.replaceState({ ...window.history.state, usr: previous }, '')
    const state = href.startsWith('/map') && previous.mapReturn ? { ...previous, mapReturn: { ...previous.mapReturn, path: href } } : previous
    event.preventDefault()
    navigate(href, { state })
  }}>
    <DiscoveryView mode={mode} onModeChange={changeMode} mapPreview={<DiscoveryMapPreview active={mode === 'map'} onAuthoritativeRefresh={refresh => void discovery.refreshAfterMap(refresh)} onAreaChange={areaChanged} onContextReady={contextReady} onUnavailable={mapUnavailable} />}
      onBroadenArea={() => mapHandle.current?.broaden()} canBroadenArea={canBroaden} regionFallback={scope.fallback} {...discovery} items={discovery.items.map(withImage)} highlightItems={[]} filters={filters} publicSearch={filterSearch}
      onFiltersChange={changeFilters} onRefresh={() => void discovery.refresh()}
      onRetry={() => void discovery.refresh()} onLoadMore={() => void discovery.loadMore()} />
  </div>
}
