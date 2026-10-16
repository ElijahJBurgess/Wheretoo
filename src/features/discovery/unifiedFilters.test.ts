import { expect, it } from 'vitest'
import { parseDiscoverySearch, serializeDiscoveryFilters, discoveryRequest } from './discovery.filters'
import { publicReturnPath } from './discovery.navigation'
it('uses next7 by default without silently rewriting legacy30 links', () => {
  expect(parseDiscoverySearch('').when).toBe('next7')
  expect(parseDiscoverySearch('?when=upcoming').when).toBe('upcoming')
  expect(serializeDiscoveryFilters({ when: 'upcoming', category: null, price: null })).toBe('?when=upcoming')
})
it('preserves the same filters on standalone map return', () => {
  expect(publicReturnPath({ mapReturn: { version: 1, path: '/map?when=today&category=music&price=free', camera: { center: [-122.263, 37.804], zoom: 14.6, pitch: 25, bearing: 0 }, selectedEventId: null, chooser: null } })).toBe('/map?when=today&category=music&price=free')
})
it('keeps viewport scope in the list request', () => {
  const bounds = { west: -122.4, south: 37.7, east: -122.1, north: 37.9 }
  expect(discoveryRequest(parseDiscoverySearch(''), undefined, bounds)).toMatchObject({ when: 'next7', bounds })
})
