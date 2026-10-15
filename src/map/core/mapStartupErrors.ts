import type { MapRendererErrorCode } from './map.types'

// Do not retain raw SDK messages or URLs: they can contain access tokens.
export function describeStartupError(event: unknown): {
  resource: 'base-style' | 'resource'; status: number | null; fatal: MapRendererErrorCode | null
} {
  const outer = event !== null && typeof event === 'object' ? event : {}
  const error = 'error' in outer && outer.error !== null && typeof outer.error === 'object' ? outer.error : {}
  const status = 'status' in error && typeof error.status === 'number' && Number.isInteger(error.status)
    && error.status >= 0 && error.status <= 599 ? error.status : null
  let baseStyle = false
  if (!('sourceId' in outer) && 'url' in error && typeof error.url === 'string') {
    try {
      const url = new URL(error.url)
      baseStyle = url.origin === 'https://api.mapbox.com' && /^\/styles\/v1\/[^/]+\/[^/]+\/?$/.test(url.pathname)
    } catch { /* Unknown resources remain recoverable; the slow-start timer provides retry. */ }
  }
  const fatal = baseStyle && (status === 401 || status === 403) ? 'TOKEN_INVALID'
    : baseStyle && (status === 400 || status === 404) ? 'STYLE_LOAD_FAILED' : null
  return { resource: baseStyle ? 'base-style' : 'resource', status, fatal }
}
