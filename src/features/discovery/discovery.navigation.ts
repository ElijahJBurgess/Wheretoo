import { readMapReturn } from '../../map/navigation/mapNavigation'
import { parseDiscoverySearch, serializeDiscoveryFilters } from './discovery.filters'

export function discoveryReturnPath(state: unknown): string {
  const search = typeof state === 'object' && state !== null && 'discoverySearch' in state ? state.discoverySearch : null
  return '/discover' + (typeof search === 'string' && search.startsWith('?') && search.length <= 2048
    ? serializeDiscoveryFilters(parseDiscoverySearch(search)) : '')
}

export function discoveryScrollPosition(state: unknown): number {
  const scroll = typeof state === 'object' && state !== null && 'discoveryScroll' in state ? state.discoveryScroll : null
  return typeof scroll === 'number' && Number.isFinite(scroll) && scroll >= 0 && scroll <= 1_000_000 ? scroll : 0
}

export function discoveryCardScrollPosition(state: unknown): number {
  const scroll = typeof state === 'object' && state !== null && 'discoveryCardScroll' in state ? state.discoveryCardScroll : null
  return typeof scroll === 'number' && Number.isFinite(scroll) && scroll >= 0 && scroll <= 1_000_000 ? scroll : 0
}

// Carry only public, bounded return hints through event and quantity routes.
export function publicReturnState(state: unknown) {
  const mapReturn = readMapReturn(state)
  return {
    discoverySearch: discoveryReturnPath(state).slice('/discover'.length),
    discoveryScroll: discoveryScrollPosition(state),
    discoveryCardScroll: discoveryCardScrollPosition(state),
    ...(mapReturn ? { mapReturn } : {}),
  }
}
export function publicReturnPath(state: unknown): string {
  return readMapReturn(state)?.path ?? discoveryReturnPath(state)
}

// Take this at navigation time: map previews own their links and bypass list capture.
export function captureDiscoveryScroll(state: unknown) {
  return {
    ...publicReturnState(state),
    discoveryScroll: Math.min(1_000_000, Math.max(0, window.scrollY)),
    discoveryCardScroll: Math.min(1_000_000, Math.max(0, document.querySelector('.discovery-event-list')?.scrollLeft ?? 0)),
  }
}
