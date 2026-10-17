import { serializeDiscoveryFilters } from './discovery.filters'
import type { DiscoveryFilters } from './discovery.types'

export type DiscoveryMode = 'map' | 'list'

// Display state belongs to navigation, never to event filters or query keys.
export function discoveryMode(search: string): DiscoveryMode {
  return new URLSearchParams(search).get('view') === 'list' ? 'list' : 'map'
}

export function discoverySearch(filters: DiscoveryFilters, mode: DiscoveryMode): string {
  const search = serializeDiscoveryFilters(filters)
  return mode === 'list' ? `${search}${search ? '&' : '?'}view=list` : search
}
