import { expect, it, vi } from 'vitest'
import { storefrontHtml } from '../../../api/storefront'
const config = {
  origin: 'https://wheretoo.example',
  supabaseUrl: 'https://project.supabase.co',
  publicKey: 'public',
}
const template =
  '<html><head><meta http-equiv="Content-Security-Policy" content="default-src self"><title>Whereto</title></head><body><div id="root"></div><script src="/assets/main.js"></script></body></html>'
const fixture = {
  identity: {
    handle: 'organizer-name',
    name: 'Music <script>alert(1)</script>',
    bio: 'A "live" night & more',
    city: 'Oakland',
    logoId: '24000000-0000-4000-8000-000000000011',
    coverId: null,
    accent: null,
    links: {},
    websiteUrl: null,
  },
  featured: null,
  events: [],
  nextCursor: null,
  serverNow: '2026-09-23',
  merch: [],
  storeUrl: null,
}
it('injects escaped canonical social tags without altering app assets or CSP', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(fixture)),
  )
  const result = await storefrontHtml(
    template,
    'organizer-name',
    config,
    fetcher,
  )
  expect(result.status).toBe(200)
  expect(result.html).toContain('Music &lt;script&gt;')
  expect(result.html).not.toContain('<script>alert')
  expect(result.html).toContain('https://wheretoo.example/organizer-name')
  expect(result.html).toContain('og:image')
  expect(result.html).toContain('/assets/main.js')
  expect(result.html).toContain('Content-Security-Policy')
})
it('matches absent and draft responses and excludes reserved routes', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('null'))
  expect((await storefrontHtml(template, 'unknown', config, fetcher)).status)
    .toBe(404)
  expect((await storefrontHtml(template, 'organizer', config, fetcher)).html)
    .toBe(template)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('metadata outage leaves the canonical SPA intact', async () => {
  expect(
    await storefrontHtml(
      template,
      'organizer-name',
      config,
      vi.fn().mockRejectedValue(new Error('offline')),
    ),
  ).toEqual({ html: template, status: 200 })
})
