import { expect, it } from 'vitest'
import { readMapReturn } from './mapNavigation'
import { publicReturnPath, publicReturnState } from '../../features/discovery/discovery.navigation'
const id = '3d000000-0000-4000-8000-000000000001'
const context = { version: 1, path: '/map', camera: { center: [-122.264, 37.803], zoom: 16.25, pitch: 25, bearing: 0 }, selectedEventId: id, chooser: null }
it('retains only bounded public camera and ID state, never event records', () => {
  expect(readMapReturn({ mapReturn: { ...context, events: [{ id, title: 'stale' }] } })).toEqual(context)
  for (const mapReturn of [null, { ...context, path: 'https://evil.test' }, { ...context, path: '/tickets/private' }, { ...context, camera: { ...context.camera, zoom: Infinity } }, { ...context, camera: { ...context.camera, center: [0, 0] } }, { ...context, selectedEventId: 'bad' }]) expect(readMapReturn({ mapReturn })).toBeNull()
})
it('keeps normal direct-event returns and existing discovery filters while carrying map context', () => {
  expect(publicReturnPath(null)).toBe('/discover')
  expect(publicReturnPath({ discoverySearch: '?when=today&price=free' })).toBe('/discover?when=today&price=free')
  expect(publicReturnPath({ mapReturn: context })).toBe('/map')
  const state = publicReturnState({ mapReturn: context, discoverySearch: '?category=music&secret=bad', discoveryScroll: 350, token: 'private' })
  expect(state).toEqual({ mapReturn: context, discoverySearch: '?category=music', discoveryScroll: 350, discoveryCardScroll: 0 })
})
