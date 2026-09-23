import { expect, it } from 'vitest'
import {
  editorInputSchema,
  safeExternalUrl,
  validSocialUrl,
} from './storefront.editor'
it('accepts only safe HTTP links', () => {
  expect(safeExternalUrl('https://example.org/store')).toBe(true)
  for (
    const url of [
      'javascript:alert(1)',
      'data:text/html,a',
      '//example.org',
      'https://user:pass@example.org',
      'https://a.org\\evil',
      'https://a.org\n',
    ]
  ) expect(safeExternalUrl(url)).toBe(false)
})
it('limits supported social destinations', () => {
  expect(validSocialUrl('instagram', 'https://instagram.com/host')).toBe(true)
  expect(validSocialUrl('instagram', 'https://instagram.com.evil.org/host'))
    .toBe(false)
  expect(validSocialUrl('facebook', 'https://facebook.com/host')).toBe(false)
})
it('rejects excess or dangerous editor state', () => {
  expect(
    editorInputSchema.safeParse({
      name: 'X',
      bio: null,
      city: null,
      websiteUrl: null,
      logoId: null,
      coverId: null,
      accent: null,
      links: {},
      featuredEventId: null,
    }).success,
  ).toBe(false)
})
it('preserves the existing 500-character website limit', () => {
  expect(
    editorInputSchema.shape.websiteUrl.safeParse(
      'https://example.org/' + 'a'.repeat(500),
    ).success,
  ).toBe(false)
})
