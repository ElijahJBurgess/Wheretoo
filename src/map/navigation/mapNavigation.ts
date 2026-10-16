import { z } from 'zod'
import { parseDiscoverySearch, serializeDiscoveryFilters } from '../../features/discovery/discovery.filters'
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, SERVICE_BOUNDS } from '../core/map.constants'

const longitude = z.number().finite().min(SERVICE_BOUNDS[0][0]).max(SERVICE_BOUNDS[1][0])
const latitude = z.number().finite().min(SERVICE_BOUNDS[0][1]).max(SERVICE_BOUNDS[1][1])
const chooser = z.object({
  eventIds: z.array(z.uuid()).max(1000),
  anchor: z.object({ longitude, latitude }),
  scrollTop: z.number().finite().min(0).max(1_000_000),
  visibleCount: z.number().int().min(20).max(1000),
  trigger: z.enum(['map', 'viewport']),
  focusedId: z.uuid().nullable(),
})
const schema = z.object({
  version: z.literal(1),
  path: z.string().max(2048).refine(path => ['/map', '/discover'].some(base => path.startsWith(base) && path === base + serializeDiscoveryFilters(parseDiscoverySearch(path.slice(base.length))))),
  camera: z.object({ center: z.tuple([longitude, latitude]), zoom: z.number().finite().min(MAP_MIN_ZOOM).max(MAP_MAX_ZOOM), pitch: z.number().finite().min(0).max(85), bearing: z.number().finite().min(-180).max(180) }),
  area: z.object({ west: longitude, south: latitude, east: longitude, north: latitude }).refine(b => b.west < b.east && b.south < b.north).optional(),
  selectedEventId: z.uuid().nullable(),
  chooser: chooser.nullable(),
})
export type MapReturnContext = z.infer<typeof schema>
export type MapChooserContext = z.infer<typeof chooser>

// Navigation hints contain no event records and confer no eligibility or permissions.
export function readMapReturn(state: unknown): MapReturnContext | null {
  const value = typeof state === 'object' && state !== null && 'mapReturn' in state ? state.mapReturn : null
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : null
}
