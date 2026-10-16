import { z } from 'zod'
import { eventCategories, type EventCategory } from '../../features/events/event.types'
import type { MapBounds } from '../core/map.types'
import type { WheretooMapEvent } from './wheretooMapEvents'

export type PublicMapQuery = { bounds: MapBounds; startsAt: string; endsAt: string; categories: readonly EventCategory[] | null }
const instant = z.iso.datetime({ offset: true })
const eventSchema = z.object({
  event_id: z.uuid(), title: z.string().min(1), category: z.enum(eventCategories),
  starts_at: instant, ends_at: instant, timezone: z.literal('America/Los_Angeles'),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  animation_preset: z.string(), venue_label: z.string().nullable(),
  admission_type: z.enum(['free', 'paid']), minimum_price_minor: z.number().int().nonnegative().nullable(),
  minimum_age: z.string(), advisories: z.array(z.string()), artwork_reference: z.string().nullable(),
  map_icon_version_id: z.unknown().optional(),
}).refine(row => Date.parse(row.starts_at) < Date.parse(row.ends_at))

export async function getPublicMapEvents(query: PublicMapQuery, signal?: AbortSignal): Promise<{ events: WheretooMapEvent[]; complete: boolean }> {
  const origin = new URL(import.meta.env.VITE_SUPABASE_URL)
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!key || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) throw new Error('Public map configuration is invalid')
  const { west, south, east, north } = query.bounds
  const response = await fetch(`${origin.origin}/rest/v1/rpc/get_public_map_events`, {
    method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: { apikey: key, 'Content-Type': 'application/json', Prefer: 'count=exact' },
    body: JSON.stringify({ p_west: west, p_south: south, p_east: east, p_north: north, p_starts_at: query.startsAt, p_ends_at: query.endsAt, p_categories: query.categories }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Public map events could not load')
  const rows = z.array(eventSchema).parse(await response.json())
  if (new Set(rows.map(row => row.event_id)).size !== rows.length) throw new Error('Duplicate public map event')
  const events = rows.map(row => {
    const icon = z.uuid().safeParse(row.map_icon_version_id)
    return {
      id: row.event_id, title: row.title, category: row.category,
      startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone,
      latitude: row.latitude, longitude: row.longitude, animationPreset: row.animation_preset,
      mapIconVersionId: icon.success ? icon.data : null, venueLabel: row.venue_label ?? '',
      admissionType: row.admission_type, minimumPriceMinor: row.minimum_price_minor,
      minimumAge: row.minimum_age, advisories: row.advisories, artworkReference: row.artwork_reference,
    }
  })
  // Coverage is reusable only when PostgREST proves that no rows were truncated.
  const range = response.headers?.get('content-range') ?? ''
  const match = /^0-(\d+)\/(\d+)$/.exec(range)
  const complete = rows.length === 0 ? range === '*/0'
    : Boolean(match && Number(match[1]) === rows.length - 1 && Number(match[2]) === rows.length)
  return { events, complete }
}
