import type { MapBounds } from '../../map/core/map.types'
import { SERVICE_BOUNDS } from '../../map/core/map.constants'

export const BAY_AREA_BOUNDS: MapBounds = { west: SERVICE_BOUNDS[0][0], south: SERVICE_BOUNDS[0][1], east: SERVICE_BOUNDS[1][0], north: SERVICE_BOUNDS[1][1] }
/** Round outwards so stable public query keys never trim a visible edge. */
export function discoveryBounds(bounds: MapBounds): MapBounds {
  const result = { west: Math.max(BAY_AREA_BOUNDS.west, Math.floor(bounds.west * 1e6) / 1e6), south: Math.max(BAY_AREA_BOUNDS.south, Math.floor(bounds.south * 1e6) / 1e6), east: Math.min(BAY_AREA_BOUNDS.east, Math.ceil(bounds.east * 1e6) / 1e6), north: Math.min(BAY_AREA_BOUNDS.north, Math.ceil(bounds.north * 1e6) / 1e6) }
  if (!Object.values(result).every(Number.isFinite) || result.west >= result.east || result.south >= result.north) throw new Error('Invalid discovery area')
  return result
}
