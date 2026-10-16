import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicMapEvents } from './mapEvents.api'

const row = { event_id: '29000000-0000-4000-8000-000000000001', title: 'Local Gathering', category: 'community', starts_at: '2026-09-30T19:00:00Z', ends_at: '2026-09-30T21:00:00Z', timezone: 'America/Los_Angeles', latitude: 37.804, longitude: -122.263, animation_preset: 'generic', venue_label: null, admission_type: 'free', minimum_price_minor: null, minimum_age: 'all_ages', advisories: [], artwork_reference: null, map_icon_version_id: null }
const query = { bounds: { west: -123, south: 37, east: -122, north: 38 }, startsAt: '2026-09-29T00:00:00Z', endsAt: '2026-10-06T00:00:00Z', categories: null }
const transport = vi.fn()
beforeEach(() => { vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:56321'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test'); vi.stubGlobal('fetch', transport); transport.mockResolvedValue({ ok: true, json: async () => [row] }) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('canonical public map event adapter', () => {
  it('uses only the anonymous RPC and maps nullable domain fields', async () => {
    const { events: [event] } = await getPublicMapEvents(query)
    expect(event).toMatchObject({ id: row.event_id, mapIconVersionId: null, minimumPriceMinor: null, artworkReference: null, venueLabel: '', startsAt: row.starts_at })
    expect(transport).toHaveBeenCalledOnce()
    const [url, options] = transport.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:56321/rest/v1/rpc/get_public_map_events')
    expect(options.credentials).toBe('omit')
    expect(options.headers).toEqual({ apikey: 'public-test', 'Content-Type': 'application/json', Prefer: 'count=exact' })
    expect(JSON.parse(options.body)).toEqual({ p_west: -123, p_south: 37, p_east: -122, p_north: 38, p_starts_at: query.startsAt, p_ends_at: query.endsAt, p_categories: null })
  })
  it('keeps an otherwise valid event when its icon reference is malformed', async () => {
    transport.mockResolvedValue({ ok: true, json: async () => [{ ...row, map_icon_version_id: 'bad' }] })
    expect((await getPublicMapEvents(query)).events[0].mapIconVersionId).toBeNull()
  })
  it.each([{ latitude: 91 }, { longitude: Infinity }, { category: 'unknown' }, { ends_at: 'not-date' }, { starts_at: '2026-10-01T00:00:00Z' }, { minimum_price_minor: -1 }])('rejects invalid event data %j', async bad => {
    transport.mockResolvedValue({ ok: true, json: async () => [{ ...row, ...bad }] })
    await expect(getPublicMapEvents(query)).rejects.toThrow()
  })
  it('reports transport failure instead of inventing fixtures', async () => {
    transport.mockResolvedValue({ ok: false, status: 503 })
    await expect(getPublicMapEvents(query)).rejects.toThrow('Public map events could not load')
  })
})

it.each([['0-0/1', true], ['0-0/10', false], ['0-0/*', false], [null, false], ['bad', false]])('requires exact complete response range %s', async (range, complete) => {
  transport.mockResolvedValue(new Response(JSON.stringify([row]), { headers: range ? { 'content-range': range } : {} }))
  expect((await getPublicMapEvents(query)).complete).toBe(complete)
})
it('recognizes an exact empty response as complete', async () => {
  transport.mockResolvedValue(new Response('[]', { headers: { 'content-range': '*/0' } }))
  expect(await getPublicMapEvents(query)).toEqual({ events: [], complete: true })
})

it('uses server presets and authoritative timing even for an empty filtered map', async () => {
  const { getFilteredPublicMapEvents } = await import('./mapEvents.api')
  const metadata = { window: { start: '2026-11-01T07:00:00Z', end: '2026-11-02T08:00:00Z', timezone: 'America/Los_Angeles' }, serverNow: '2026-11-01T12:00:00Z' }
  transport.mockResolvedValue(new Response('[]', { headers: { 'content-range': '*/0', 'X-Wheretoo-Discovery': JSON.stringify(metadata) } }))
  expect(await getFilteredPublicMapEvents(query.bounds, { when: 'today', category: 'music', price: 'free' })).toEqual({ events: [], complete: true, ...metadata })
  expect(transport.mock.calls[0][0]).toContain('/get_public_filtered_map_events')
  expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({ p_when: 'today', p_categories: ['music'], p_admission_type: 'free' })
})
