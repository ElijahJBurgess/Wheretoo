import type { EventCategory } from '../../features/events/event.types'
import type { WheretooMapEvent } from './wheretooMapEvents'

export type EventFeatureProperties = {
  eventId: string
  title: string
  category: EventCategory
  markerGlyph: string
  markerAssetKey: EventMarkerAssetKey
  mapIconVersionId: string | null
}

export const EVENT_FLAG_MARKER_ASSET_KEY = 'wheretoo-event-flag'
export const GENERIC_EVENT_MARKER_ASSET_KEY = 'event-generic'
export const EVENT_FLAG_ANIMATION_PRESET = 'wheretoo-flag-image'

export type EventMarkerAssetKey =
  | typeof EVENT_FLAG_MARKER_ASSET_KEY
  | typeof GENERIC_EVENT_MARKER_ASSET_KEY

export type EventFeatureCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    id: string
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: EventFeatureProperties
  }>
}

const markerGlyphs: Record<EventCategory, string> = {
  food_drink: 'F',
  music: 'M',
  fitness: 'R',
  art_culture: 'A',
  shopping: 'S',
  community: 'C',
  nightlife: 'N',
  other: '•',
}

export function usesEventFlagMarker(event: Pick<WheretooMapEvent, 'animationPreset'>) {
  return event.animationPreset === EVENT_FLAG_ANIMATION_PRESET
}

function markerAssetKey(animationPreset: string): EventMarkerAssetKey {
  return animationPreset === EVENT_FLAG_ANIMATION_PRESET
    ? EVENT_FLAG_MARKER_ASSET_KEY
    : GENERIC_EVENT_MARKER_ASSET_KEY
}

export class DuplicateMapEventIdError extends Error {
  constructor(eventId: string) {
    super(`Duplicate Wheretoo map event ID: ${eventId}`)
    this.name = 'DuplicateMapEventIdError'
  }
}

export function toEventFeatureCollection(events: readonly WheretooMapEvent[]): EventFeatureCollection {
  const ids = new Set<string>()
  for (const event of events) {
    if (ids.has(event.id)) throw new DuplicateMapEventIdError(event.id)
    ids.add(event.id)
  }
  return {
    type: 'FeatureCollection',
    features: events.map((event) => ({
      type: 'Feature',
      id: event.id,
      geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
      properties: {
        eventId: event.id,
        title: event.title,
        category: event.category,
        markerGlyph: markerGlyphs[event.category],
        markerAssetKey: markerAssetKey(event.animationPreset),
        mapIconVersionId: event.mapIconVersionId ?? null,
      },
    })),
  }
}
