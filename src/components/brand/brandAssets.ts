export const brandAssets = {
  wordmark: {
    purple: { src: '/brand/wheretoo-wordmark-purple.png', width: 600, height: 113 },
    white: { src: '/brand/wheretoo-wordmark-white.png', width: 600, height: 113 },
  },
  mark: {
    purple: { src: '/brand/wheretoo-mark-purple.png', width: 192, height: 114 },
    white: { src: '/brand/wheretoo-mark-white.png', width: 192, height: 113 },
  },
} as const

export type LogoVariant = keyof typeof brandAssets
export type LogoTheme = keyof typeof brandAssets.wordmark

/** Email hosts must serve the same public/brand assets as the application. */
export function emailLogoUrl(origin: string) {
  const base = new URL(origin)
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Brand assets require an HTTP(S) origin')
  return new URL(brandAssets.wordmark.white.src, base.origin).href
}
