/** Add only the configured asset/API origin; never interpolate arbitrary CSP text. */
export function withMapIconOrigin(html: string, configuredUrl?: string): string {
  if (!configuredUrl) return html
  const url = new URL(configuredUrl)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid Supabase origin for map icon delivery')
  }
  return html.replace(/(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]+)(")/i,
    (_, start: string, policy: string, end: string) => start + policy.split(';').map(directive => {
      const [name, ...sources] = directive.trim().split(/\s+/)
      if (!['img-src', 'connect-src'].includes(name) || sources.includes(url.origin)) return directive
      return `${directive.trimEnd()} ${url.origin}`
    }).join(';') + end)
}
