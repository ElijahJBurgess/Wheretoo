import { expect, it } from 'vitest'
import { discoveryMode, discoverySearch } from './discovery.location'
import { parseDiscoverySearch } from './discovery.filters'
import { discoveryReturnPath, publicReturnState } from './discovery.navigation'
import { readMapReturn } from '../../map/navigation/mapNavigation'

it('keeps display mode separate from canonical shared filters and legacy dates', () => {
  const search = '?when=upcoming&category=music&price=paid&view=list&secret=ignored'
  expect(discoveryMode(search)).toBe('list')
  expect(discoverySearch(parseDiscoverySearch(search), discoveryMode(search))).toBe('?when=upcoming&category=music&price=paid&view=list')
  for (const value of ['', '?view=map', '?view=other']) expect(discoveryMode(value)).toBe('map')
  expect(discoverySearch(parseDiscoverySearch(''), 'map')).toBe('')
  expect(discoveryReturnPath({ discoverySearch: search })).toBe('/discover?when=upcoming&category=music&price=paid&view=list')
})
it('allows List return paths while retaining strict map path and public state validation', () => {
  const context = { version: 1, path: '/discover?price=free&view=list', camera: { center: [-122.264, 37.803], zoom: 14.6, pitch: 25, bearing: 0 }, selectedEventId: null, chooser: null }
  expect(readMapReturn({ mapReturn: context })).toEqual(context)
  expect(readMapReturn({ mapReturn: { ...context, path: '/map?view=list' } })).toBeNull()
  expect(readMapReturn({ mapReturn: { ...context, path: '/discover?view=list&secret=bad' } })).toBeNull()
  expect(publicReturnState({ discoveryViewScroll: { map: 100, list: 900 }, token: 'private' })).toMatchObject({ discoveryViewScroll: { map: 100, list: 900 } })
  expect(publicReturnState({ discoveryFocusEventId: 'private-or-invalid' })).not.toHaveProperty('discoveryFocusEventId')
  expect(publicReturnState({ discoveryFocusEventId: '4f000000-0000-4000-8000-000000000023' })).toHaveProperty('discoveryFocusEventId', '4f000000-0000-4000-8000-000000000023')
  expect(publicReturnState({ discoveryViewScroll: { map: Infinity, list: -1 } })).toMatchObject({ discoveryViewScroll: { map: 0, list: 0 } })
})
