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
