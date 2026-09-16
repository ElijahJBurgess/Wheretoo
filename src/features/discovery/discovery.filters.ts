import { eventCategories } from '../events/event.types'
import type { DiscoveryFilters, DiscoveryRequest } from './discovery.types'

export const defaultDiscoveryFilters: DiscoveryFilters = { when: 'upcoming', category: null, price: null }

export function parseDiscoverySearch(search: string): DiscoveryFilters {
  const params = new URLSearchParams(search)
  const when = params.get('when'), category = params.get('category'), price = params.get('price')
  return {
    when: when === 'today' || when === 'weekend' ? when : 'upcoming',
    category: eventCategories.find(value => value === category) ?? null,
    price: price === 'free' || price === 'paid' ? price : null,
  }
}

export function serializeDiscoveryFilters(filters: DiscoveryFilters): string {
  const params = new URLSearchParams()
  if (filters.when !== 'upcoming') params.set('when', filters.when)
  if (filters.category) params.set('category', filters.category)
  if (filters.price) params.set('price', filters.price)
  const value = params.toString()
  return value ? `?${value}` : ''
}

export function toggleDiscoveryFilter<K extends 'category' | 'price'>(filters: DiscoveryFilters, key: K, value: NonNullable<DiscoveryFilters[K]>): DiscoveryFilters {
  return { ...filters, [key]: filters[key] === value ? null : value }
}

export function discoveryRequest(filters: DiscoveryFilters, cursor?: string): DiscoveryRequest {
  return { region: 'sf_bay_area', when: filters.when, ...(filters.category ? { category: filters.category } : {}),
    ...(filters.price ? { admissionType: filters.price } : {}), limit: 20, ...(cursor ? { cursor } : {}) }
}
