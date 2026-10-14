import { describe, expect, it } from 'vitest'
import { getDevelopmentMapEvents } from './developmentMapEvents'
import { DuplicateMapEventIdError, toEventFeatureCollection } from './eventGeoJson'

describe('toEventFeatureCollection', () => {
  it('uses only the explicit version reference, never the legacy preset, as icon authority', () => {
    const event = getDevelopmentMapEvents()[0]
    expect(toEventFeatureCollection([{ ...event, mapIconVersionId: null }]).features[0].properties.mapIconVersionId).toBeNull()
    expect(toEventFeatureCollection([{ ...event, animationPreset: 'generic', mapIconVersionId: '8d94a4cf-e61b-480a-9f1f-8b5497620dfa' }]).features[0].properties.mapIconVersionId).toBe('8d94a4cf-e61b-480a-9f1f-8b5497620dfa')
  })
  it('creates point features with longitude first, stable ids, and presentation-only properties', () => {
    const event = getDevelopmentMapEvents()[0]
    const collection = toEventFeatureCollection([event])

    expect(collection).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'oakland-day-party',
        geometry: { type: 'Point', coordinates: [-122.259, 37.807] },
        properties: {
          eventId: 'oakland-day-party', title: 'Day Party', category: 'nightlife', markerGlyph: 'N', markerAssetKey: 'event-generic', mapIconVersionId: null,
        },
      }],
    })
    expect(collection.features[0].properties).not.toHaveProperty('minimumPriceMinor')
    expect(collection.features[0].properties).not.toHaveProperty('advisories')
  })

  it('rejects duplicate domain IDs before they can inflate cluster counts', () => {
    const event = getDevelopmentMapEvents()[0]
    expect(() => toEventFeatureCollection([event, { ...event }])).toThrow(DuplicateMapEventIdError)
  })

  it('exposes only allowlisted marker asset keys to the map style', () => {
    const [dayParty, vinylNight] = getDevelopmentMapEvents()
    const collection = toEventFeatureCollection([
      { ...dayParty, animationPreset: 'wheretoo-flag-image' },
      vinylNight,
    ])

    expect(collection.features.map(({ properties }) => properties.markerAssetKey)).toEqual([
      'wheretoo-event-flag',
      'event-generic',
    ])
  })
})
