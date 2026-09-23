import { expect, it, vi } from 'vitest'
import { shareStorefront } from './storefront.share'
it('prefers native share with only canonical URL', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  const copy = vi.fn()
  expect(
    await shareStorefront('https://wheretoo.co/host', 'Host', { share, copy }),
  ).toBe('shared')
  expect(share).toHaveBeenCalledWith({
    title: 'Host · Wheretoo',
    url: 'https://wheretoo.co/host',
  })
  expect(copy).not.toHaveBeenCalled()
})
it('treats native cancellation as cancellation', async () => {
  const copy = vi.fn()
  expect(
    await shareStorefront('https://wheretoo.co/host', 'Host', {
      share: vi.fn().mockRejectedValue(
        new DOMException('cancelled', 'AbortError'),
      ),
      copy,
    }),
  ).toBe('cancelled')
  expect(copy).not.toHaveBeenCalled()
})
it('uses copy then manual fallback honestly', async () => {
  expect(
    await shareStorefront('https://wheretoo.co/host', 'Host', {
      copy: vi.fn().mockResolvedValue(undefined),
    }),
  ).toBe('copied')
  expect(
    await shareStorefront('https://wheretoo.co/host', 'Host', {
      copy: vi.fn().mockRejectedValue(new Error()),
    }),
  ).toBe('manual')
})
