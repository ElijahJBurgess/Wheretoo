import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('application Content Security Policy', () => {
  it('allows only the required application, Stripe Connect, Checkout, Link, Supabase, and Mapbox origins', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const content = html.match(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1]

    expect(content).toBeDefined()
    expect(content).toContain("default-src 'self'")
    expect(content).toContain("script-src 'self' https://connect-js.stripe.com https://js.stripe.com")
    expect(content).toContain("frame-src https://connect-js.stripe.com https://js.stripe.com https://checkout.stripe.com https://link.com https://*.link.com")
    expect(content).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://events.mapbox.com https://api.stripe.com https://connect-js.stripe.com https://link.com https://*.link.com")
    expect(content).toContain("img-src 'self' data: https://*.stripe.com https://*.link.com")
    expect(content).toContain("font-src 'self' data:")
    expect(content).not.toContain("script-src *")
    expect(content).not.toContain("'unsafe-eval'")
    expect(content).not.toContain("'unsafe-inline'")
  })

  it('keeps local Vite CSS usable while Playwright verifies the production policy', () => {
    const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
    const playwrightConfig = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8')

    expect(viteConfig).toContain("apply: 'serve'")
    expect(viteConfig).toContain("name: 'development-csp-bypass'")
    expect(playwrightConfig).toContain(
      "command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3000'",
    )
  })
})
