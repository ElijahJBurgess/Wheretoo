import { describe, expect, it } from 'vitest'
import type { SearchBoxRetrieveResponse } from './normalizeSearchResult'
import { normalizeSearchResult } from './normalizeSearchResult'

function makeResponse(
  overrides: {
    featureCount?: number
    featureType?: string
    mapboxId?: string
    address?: string
    addressContext?: string
    city?: string
    regionCode?: string
    regionCodeFull?: string
    countryCode?: string
    countryCodeAlpha3?: string
    postalCode?: string
    latitude?: number
    longitude?: number
    geometryCoordinates?: number[]
  } = {},
): SearchBoxRetrieveResponse {
  const longitude = overrides.longitude ?? -122.4193
  const latitude = overrides.latitude ?? 37.7793
  const feature = {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: overrides.geometryCoordinates ?? [longitude, latitude],
    },
    properties: {
      name: overrides.featureType === 'poi' ? 'San Francisco City Hall' : '1 Dr Carlton B Goodlett Place',
      name_preferred: '',
      mapbox_id: overrides.mapboxId ?? 'dXJuOm1ieGFkcjo...',
      feature_type: overrides.featureType ?? 'address',
      address: overrides.address ?? '1 Dr Carlton B Goodlett Place',
      full_address: '1 Dr Carlton B Goodlett Place, San Francisco, California 94102, United States',
      place_formatted: 'San Francisco, California 94102, United States',
      context: {
        country: {
          id: 'dXJuOm1ieGN0cnk6VVM',
          name: 'United States',
          country_code: overrides.countryCode ?? 'US',
          country_code_alpha_3: overrides.countryCodeAlpha3 ?? 'USA',
        },
        region: {
          id: 'dXJuOm1ieHJnbjpDQQ',
          name: 'California',
          region_code: overrides.regionCode ?? 'CA',
          region_code_full: overrides.regionCodeFull ?? 'US-CA',
        },
        postcode: {
          id: 'dXJuOm1ieHBvc3Q6OTQxMDI',
          name: overrides.postalCode ?? '94102',
        },
        place: {
          id: 'dXJuOm1ieHBsYzpTYW5GcmFuY2lzY28',
          name: overrides.city ?? 'San Francisco',
        },
        address: overrides.addressContext
          ? {
              id: 'dXJuOm1ieGFkcjo6Y29udGV4dA',
              name: overrides.addressContext,
            }
          : undefined,
      },
      language: 'en',
      maki: overrides.featureType === 'poi' ? 'town-hall' : 'marker',
      poi_category: overrides.featureType === 'poi' ? ['government'] : [],
      brand: '',
      brand_id: '',
      external_ids: {},
      metadata: {},
      coordinates: {
        longitude,
        latitude,
        accuracy: 'rooftop',
      },
    },
  }

  return {
    type: 'FeatureCollection',
    features: Array.from({ length: overrides.featureCount ?? 1 }, () => feature),
    attribution: '© 2026 Mapbox and its suppliers',
  }
}

describe('normalizeSearchResult', () => {
  it('normalizes one verified San Francisco address exactly', () => {
    expect(normalizeSearchResult(makeResponse())).toEqual({
      mapboxFeatureId: 'dXJuOm1ieGFkcjo...',
      addressLine1: '1 Dr Carlton B Goodlett Place',
      addressLine2: '',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94102',
      countryCode: 'US',
      latitude: 37.7793,
      longitude: -122.4193,
    })
  })

  it('uses structured address context for a POI result', () => {
    const response = makeResponse({
      featureType: 'poi',
      address: ' ',
      addressContext: '1 Dr Carlton B Goodlett Place',
    })

    expect(normalizeSearchResult(response)?.addressLine1).toBe('1 Dr Carlton B Goodlett Place')
  })

  it.each([
    [makeResponse({ featureCount: 0 }), 'no result'],
    [makeResponse({ featureCount: 2 }), 'ambiguous results'],
    [makeResponse({ mapboxId: ' ' }), 'missing stable feature ID'],
    [makeResponse({ address: ' ' }), 'missing structured address'],
    [makeResponse({ city: ' ' }), 'missing city'],
    [makeResponse({ postalCode: ' ' }), 'missing postal context'],
    [makeResponse({ geometryCoordinates: [] }), 'missing geometry coordinates'],
    [makeResponse({ countryCode: 'CA', countryCodeAlpha3: 'CAN' }), 'non-US result'],
    [makeResponse({ regionCode: 'NV', regionCodeFull: 'US-NV' }), 'non-CA result'],
    [makeResponse({ longitude: Number.NaN }), 'non-finite coordinates'],
    [makeResponse({ longitude: -181 }), 'out-of-range longitude'],
    [makeResponse({ latitude: 91 }), 'out-of-range latitude'],
  ])('rejects %s (%s)', (response) => {
    expect(normalizeSearchResult(response)).toBeNull()
  })
})
