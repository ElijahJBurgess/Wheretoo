import { usePublicEventImages } from '../event-images/publicEventImages'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { DiscoveryView } from './DiscoveryView'
import { parseDiscoverySearch, serializeDiscoveryFilters } from './discovery.filters'
import { discoveryScrollPosition } from './discovery.navigation'
import { discoveryKeys, useDiscovery } from './discovery.queries'
import type { DiscoveryFilters } from './discovery.types'

export function DiscoveryPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const navigationType = useNavigationType()
  const filters = parseDiscoverySearch(location.search)
  const search = serializeDiscoveryFilters(filters)
  const discovery = useDiscovery(filters)
  const images = usePublicEventImages(discovery.items.map(item => item.id))
  const withImage = (item: (typeof discovery.items)[number]) => ({ ...item, artworkReference: images.data?.find(image => image.eventId === item.id)?.url ?? null })
  const restored = useRef<string | null>(null)

  useEffect(() => {
    document.title = 'Discover events · Wheretoo'
    if (location.search !== search || location.hash) {
      navigate({ pathname: '/discover', search }, { replace: true, state: { discoveryScroll: discoveryScrollPosition(location.state) } })
    }
  }, [location.search, location.hash, location.state, navigate, search])

  useLayoutEffect(() => {
    if (discovery.status === 'loading' || restored.current === location.key) return
    restored.current = location.key
    if (navigationType === 'POP') window.scrollTo({ top: discoveryScrollPosition(location.state), behavior: 'instant' })
  }, [discovery.status, location.key, location.state, navigationType])

  function changeFilters(next: DiscoveryFilters) {
    const nextSearch = serializeDiscoveryFilters(next)
    if (search === nextSearch) return
    // A deliberate filter change starts over. POP navigation never runs this,
    // so Back can retain its cached page chain and public scroll position.
    client.removeQueries({ queryKey: discoveryKeys.list(nextSearch), exact: true })
    navigate({ pathname: '/discover', search: nextSearch }, { state: { discoveryScroll: 0 } })
    document.getElementById('discovery-results')?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }

  return <div onClickCapture={event => {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    const href = link?.getAttribute('href')
    if (href && (href === '/discover' || href.startsWith('/discover?')) && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const next = parseDiscoverySearch(href.slice('/discover'.length))
      if (serializeDiscoveryFilters(next) !== search) {
        event.preventDefault()
        changeFilters(next)
      }
      return
    }
    if (!link || !link.getAttribute('href')?.startsWith('/events/')) return
    // Only public scroll state belongs to this history entry. The destination
    // link carries the normalized public search, never a private return URL.
    window.history.replaceState({ ...window.history.state, usr: { discoveryScroll: Math.min(1_000_000, Math.max(0, window.scrollY)) } }, '')
  }}>
    <DiscoveryView {...discovery} items={discovery.items.map(withImage)} highlightItems={discovery.highlightItems.map(withImage)} filters={filters} publicSearch={search}
      onFiltersChange={changeFilters} onRefresh={() => void discovery.refresh()}
      onRetry={() => void discovery.refresh()} onLoadMore={() => void discovery.loadMore()} />
  </div>
}
