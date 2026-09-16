import { afterEach, expect, it, vi } from 'vitest'
import { getDiscoveryPage } from './discovery.api'

afterEach(() => vi.unstubAllGlobals())
const envelope = { items: [], nextCursor: null, window: { start: '2026-09-13T07:00:00Z', end: '2026-10-13T07:00:00Z', timezone: 'America/Los_Angeles' }, serverNow: '2026-09-13T12:00:00Z' }

it('sends one anonymous bounded collection request with no identity or browser session', async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify(envelope)))
  vi.stubGlobal('fetch', transport)
  const controller = new AbortController()
  expect((await getDiscoveryPage({ when: 'today', category: 'music', price: 'free' }, { signal: controller.signal })).items).toEqual([])
  expect(transport).toHaveBeenCalledTimes(1)
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toMatch(/\/functions\/v1\/public-discovery$/)
  expect(JSON.parse(init.body as string)).toEqual({ region: 'sf_bay_area', when: 'today', category: 'music', admissionType: 'free', limit: 20 })
  expect(init.credentials).toBe('omit')
  expect(init.signal).toBe(controller.signal)
  expect(new Headers(init.headers).has('authorization')).toBe(false)
})

it('exposes retry timing and cursor recovery without leaking provider details', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'DISCOVERY_RATE_LIMITED', details: 'private diagnostic' }, retryAfterSeconds: 42 }), { status: 429, headers: { 'retry-after': '42' } })))
  await expect(getDiscoveryPage({ when: 'upcoming', category: null, price: null })).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 42, message: 'Discovery is temporarily unavailable' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'DISCOVERY_CURSOR_EXPIRED' } }), { status: 400 })))
  await expect(getDiscoveryPage({ when: 'upcoming', category: null, price: null }, { cursor: 'expired' })).rejects.toMatchObject({ kind: 'cursor' })
})

it('turns malformed success and transport failures into safe read errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('raw internal payload')))
  await expect(getDiscoveryPage({ when: 'upcoming', category: null, price: null })).rejects.toMatchObject({ kind: 'invalid_response' })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private backend hostname') }))
  await expect(getDiscoveryPage({ when: 'upcoming', category: null, price: null })).rejects.toMatchObject({ kind: 'unavailable', message: 'Discovery is temporarily unavailable' })
})

it('honors throttling even when an intermediary replaces the JSON error body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Please wait', { status: 429, headers: { 'retry-after': '18' } })))
  await expect(getDiscoveryPage({ when: 'upcoming', category: null, price: null })).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 18 })
})

it('propagates cancellation so obsolete requests are not presented as failures', async () => {
  const controller = new AbortController(); controller.abort()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError') }))
  await expect(getDiscoveryPage({ when: 'upcoming', category: null, price: null }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
})
