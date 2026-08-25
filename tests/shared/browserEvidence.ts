import { createHash } from 'node:crypto'

const canonicalLocalOrigin = 'http://127.0.0.1:3000'

export function redactBrowserUrl(raw: string): string {
  const url = new URL(raw)
  const originLabel = url.origin === canonicalLocalOrigin
    ? '<local-app>'
    : `<external-origin:${createHash('sha256').update(url.origin).digest('hex').slice(0, 12)}>`
  const queryKeys = [...new Set(url.searchParams.keys())]
  const query = queryKeys.length > 0 ? `?${queryKeys.map((key) => `${key}=<redacted>`).join('&')}` : ''
  return `${originLabel}${url.pathname}${query}${url.hash ? '#<redacted>' : ''}`
}
