import { beforeEach, expect, it, vi } from 'vitest'
import {
  freezeStorefrontAttribution,
  rememberStorefrontVisit,
} from './storefront.attribution'
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
})
const token = 'a'.repeat(64), event = '24000000-0000-4000-8000-000000000001'
it('freezes latest valid event context per attempt including absent attribution', () => {
  expect(freezeStorefrontAttribution(event, 'before')).toEqual({})
  rememberStorefrontVisit('one', token, [event], Date.now())
  expect(freezeStorefrontAttribution(event, 'first')).toEqual({
    'X-Wheretoo-Storefront': token,
  })
  rememberStorefrontVisit('one', 'b'.repeat(64), [event], Date.now())
  expect(freezeStorefrontAttribution(event, 'first')).toEqual({
    'X-Wheretoo-Storefront': token,
  })
  expect(freezeStorefrontAttribution(event, 'before')).toEqual({})
  expect(freezeStorefrontAttribution(event, 'second')).toEqual({
    'X-Wheretoo-Storefront': 'b'.repeat(64),
  })
})
it('ignores expired and foreign event visits', () => {
  rememberStorefrontVisit('one', token, [event], Date.now() - 31 * 86400000)
  expect(freezeStorefrontAttribution(event, 'expired')).toEqual({})
  rememberStorefrontVisit('one', token, [event], Date.now())
  expect(freezeStorefrontAttribution('foreign', 'other')).toEqual({})
})
it('fails open when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  expect(() => rememberStorefrontVisit('one', token, [event], Date.now())).not
    .toThrow()
  expect(freezeStorefrontAttribution(event, 'test')).toEqual({})
})
it('a later revisit to an earlier ref creates a fresh latest visit', async () => {
  const { visitStorefront } = await import('./storefront.attribution')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  )
  visitStorefront('review-ref', 'first', [event])
  const first = freezeStorefrontAttribution(event, 'ref1')
  visitStorefront('review-ref', 'second', [event])
  const second = freezeStorefrontAttribution(event, 'ref2')
  visitStorefront('review-ref', 'first', [event])
  const third = freezeStorefrontAttribution(event, 'ref3')
  expect(third).not.toEqual(first)
  expect(third).not.toEqual(second)
  vi.unstubAllGlobals()
})
