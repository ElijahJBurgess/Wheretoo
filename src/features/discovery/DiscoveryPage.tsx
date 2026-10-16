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
import { publicReturnPath, publicReturnState, discoveryScrollPosition, discoveryCardScrollPosition } from './discovery.navigation'
import { useDiscovery } from './discovery.queries'
import type { DiscoveryFilters } from './discovery.types'

export function DiscoveryPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const navigationType = useNavigationType()
  const filters = parseDiscoverySearch(location.search)
  const submittedFilters = useRef(filters)
  const { when, category, price } = filters
  useLayoutEffect(() => { if (navigationType === 'POP') submittedFilters.current = { when, category, price } }, [navigationType, when, category, price])
  const search = serializeDiscoveryFilters(filters)
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
  const discovery = useDiscovery(filters, scope.bounds)
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
    if (discovery.status === 'loading' || restored.current === location.key) return
    restored.current = location.key
    if (navigationType === 'POP' || (mountedEntry.current === location.key && location.state?.mapReturn && publicReturnPath(location.state) === '/discover' + search)) {
      window.scrollTo({ top: discoveryScrollPosition(location.state), behavior: 'instant' })
      document.querySelector('.discovery-event-list')?.scrollTo({ left: discoveryCardScrollPosition(location.state), behavior: 'instant' })
    }
  }, [discovery.status, location.key, location.state, navigationType, search])

  function captureState() {
    const saved = mapHandle.current?.state() ?? publicReturnState(window.history.state?.usr ?? location.state)
    return { ...saved, discoverySearch: search, discoveryScroll: Math.min(1_000_000, Math.max(0, window.scrollY)), discoveryCardScroll: Math.min(1_000_000, Math.max(0, document.querySelector('.discovery-event-list')?.scrollLeft ?? 0)) }
  }
  function changeFilters(requested: DiscoveryFilters, field?: keyof DiscoveryFilters) {
    const next = field ? { ...submittedFilters.current, [field]: requested[field] } : requested
    submittedFilters.current = next
    const nextSearch = serializeDiscoveryFilters(next)
    if (search === nextSearch) return
    const previous = captureState()
    window.history.replaceState({ ...window.history.state, usr: previous }, '')
    client.removeQueries({ queryKey: ['public-discovery', 'v1', nextSearch] })
    const mapReturn = previous.mapReturn ? { ...previous.mapReturn, path: '/discover' + nextSearch } : undefined
    navigate({ pathname: '/discover', search: nextSearch }, { state: { ...previous, ...(mapReturn ? { mapReturn } : {}) } })
  }

  return <div onClickCapture={event => {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    const href = link?.getAttribute('href')
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (href && (href === '/discover' || href.startsWith('/discover?')) && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const next = parseDiscoverySearch(href.slice('/discover'.length))
      if (serializeDiscoveryFilters(next) !== search) {
        event.preventDefault()
        changeFilters(next)
      }
      return
    }
    if (!href || !(href.startsWith('/events/') || href === '/map' || href.startsWith('/map?'))) return
    if (link?.closest('.living-map')) return // The map owns its preview navigation.
    const previous = captureState()
    window.history.replaceState({ ...window.history.state, usr: previous }, '')
    const state = href.startsWith('/map') && previous.mapReturn ? { ...previous, mapReturn: { ...previous.mapReturn, path: href } } : previous
    event.preventDefault()
    navigate(href, { state })
  }}>
    <DiscoveryView mapPreview={<DiscoveryMapPreview onAreaChange={areaChanged} onContextReady={contextReady} onUnavailable={mapUnavailable} />}
      onBroadenArea={() => mapHandle.current?.broaden()} canBroadenArea={canBroaden} regionFallback={scope.fallback} {...discovery} items={discovery.items.map(withImage)} highlightItems={discovery.highlightItems.map(withImage)} filters={filters} publicSearch={search}
      onFiltersChange={changeFilters} onRefresh={() => void discovery.refresh()}
      onRetry={() => void discovery.refresh()} onLoadMore={() => void discovery.loadMore()} />
  </div>
}
