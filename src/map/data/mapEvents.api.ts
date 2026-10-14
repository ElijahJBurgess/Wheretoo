import { z } from 'zod'
import { eventCategories, type EventCategory } from '../../features/events/event.types'
import type { MapBounds } from '../core/map.types'
import type { WheretooMapEvent } from './wheretooMapEvents'

export type PublicMapQuery = {
  bounds: MapBounds
  startsAt: string
  endsAt: string
  categories: readonly EventCategory[] | null
}

const MAX_MAP_EVENTS = 500
const instant = z.iso.datetime({ offset: true })
const querySchema = z.object({
  bounds: z.object({
    west: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
  }).refine(bounds => bounds.west < bounds.east && bounds.south < bounds.north),
  startsAt: instant,
  endsAt: instant,
  categories: z.array(z.enum(eventCategories)).min(1).nullable(),
}).refine(query => {
  const duration = Date.parse(query.endsAt) - Date.parse(query.startsAt)
  return duration > 0 && duration <= 7 * 86400000
})
const eventSchema = z.object({
  event_id: z.uuid(),
  title: z.string().trim().min(3).max(120),
  category: z.enum(eventCategories),
  starts_at: instant,
  ends_at: instant,
  timezone: z.literal('America/Los_Angeles'),
  latitude: z.number().min(36.8).max(38.9),
  longitude: z.number().min(-123.6).max(-121),
  animation_preset: z.string().min(1),
  venue_label: z.string().nullable(),
  admission_type: z.enum(['free', 'paid']),
  minimum_price_minor: z.number().int().positive().max(99_999_999).nullable(),
  minimum_age: z.enum(['all_ages', '18_plus', '21_plus']),
  advisories: z.array(z.enum(['alcohol', 'cannabis', 'mature_content'])),
  artwork_reference: z.string().nullable(),
  map_icon_version_id: z.unknown().optional(),
}).strict().refine(row => Date.parse(row.starts_at) < Date.parse(row.ends_at))
  .refine(row => row.admission_type === 'paid' ? row.minimum_price_minor !== null : row.minimum_price_minor === null)
const responseSchema = z.array(eventSchema).max(MAX_MAP_EVENTS)

export async function getPublicMapEvents(query: PublicMapQuery, signal?: AbortSignal): Promise<WheretooMapEvent[]> {
  if (!querySchema.safeParse(query).success) throw new Error('Public map query is invalid')
  let origin: URL
  try {
    origin = new URL(import.meta.env.VITE_SUPABASE_URL)
  } catch {
    throw new Error('Public map configuration is invalid')
  }
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!key || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new Error('Public map configuration is invalid')
  }
  const { west, south, east, north } = query.bounds
  try {
    // The anonymous projection owns publication, moderation and inventory eligibility.
    // PostgREST applies this limit to the RPC response before it reaches the browser.
    const response = await fetch(`${origin.origin}/rest/v1/rpc/get_public_map_events?limit=${MAX_MAP_EVENTS}`, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_west: west, p_south: south, p_east: east, p_north: north, p_starts_at: query.startsAt, p_ends_at: query.endsAt, p_categories: query.categories }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error()
    const rows = responseSchema.parse(await response.json())
    if (new Set(rows.map(row => row.event_id)).size !== rows.length) throw new Error()
    // The persistent development buyer world explicitly labels synthetic events.
    // It must not become live discovery content when sharing a development backend.
    return rows.filter(row => !/^\[DEV\]/i.test(row.title)).map(row => {
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
  } catch {
    // Never expose backend error bodies, schema diagnostics, or credentials to the UI.
    throw new Error('Public map events could not load')
  }
}
