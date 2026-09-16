import { expect, it } from 'vitest'
import { discoveryReturnPath, discoveryScrollPosition } from './discovery.navigation'

it('reconstructs only public discovery filters from an event return state', () => {
  expect(discoveryReturnPath({ discoverySearch: '?when=today&category=music&price=free&email=private&returnTo=https://evil.test' })).toBe('/discover?when=today&category=music&price=free')
  for (const value of [null, {}, 'https://evil.test', { discoverySearch: 'https://evil.test' }, { discoverySearch: '/tickets/secret' }]) expect(discoveryReturnPath(value)).toBe('/discover')
})

it('restores only a bounded numeric scroll position, never arbitrary history data', () => {
  expect(discoveryScrollPosition({ discoveryScroll: 1850, ticket: 'ignored' })).toBe(1850)
  for (const value of [null, {}, { discoveryScroll: -1 }, { discoveryScroll: Infinity }, { discoveryScroll: 1000001 }, { discoveryScroll: '300' }]) expect(discoveryScrollPosition(value)).toBe(0)
})
