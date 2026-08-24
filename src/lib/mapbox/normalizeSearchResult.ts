import type { ComponentProps } from 'react'
import type { SearchBox } from '@mapbox/search-js-react'
import type { NormalizedLocation } from '../../features/events/event.types'

type OfficialSearchBoxProps = ComponentProps<typeof SearchBox>

export type SearchBoxRetrieveResponse = Parameters<
  NonNullable<OfficialSearchBoxProps['onRetrieve']>
>[0]

const supportedFeatureTypes = new Set(['address', 'poi'])

function nonBlank(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function validCoordinates(longitude: number, latitude: number): boolean {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  )
}

export function normalizeSearchResult(
  response: SearchBoxRetrieveResponse,
): NormalizedLocation | null {
  if (response.features.length !== 1) {
    return null
  }

  const feature = response.features[0]
  const { context, coordinates, feature_type: featureType } = feature.properties
  const [geometryLongitude, geometryLatitude] = feature.geometry.coordinates
  const mapboxFeatureId = nonBlank(feature.properties.mapbox_id)
  const addressLine1 = nonBlank(feature.properties.address) ?? nonBlank(context.address?.name)
  const city = nonBlank(context.place?.name) ?? nonBlank(context.locality?.name)
  const postalCode = nonBlank(context.postcode?.name)

  if (
    !supportedFeatureTypes.has(featureType) ||
    mapboxFeatureId === null ||
    addressLine1 === null ||
    city === null ||
    postalCode === null ||
    context.country?.country_code !== 'US' ||
    context.country.country_code_alpha_3 !== 'USA' ||
    context.region?.region_code !== 'CA' ||
    context.region.region_code_full !== 'US-CA' ||
    geometryLongitude === undefined ||
    geometryLatitude === undefined ||
    !validCoordinates(geometryLongitude, geometryLatitude) ||
    !validCoordinates(coordinates.longitude, coordinates.latitude) ||
    geometryLongitude !== coordinates.longitude ||
    geometryLatitude !== coordinates.latitude
  ) {
    return null
  }

  return {
    mapboxFeatureId,
    addressLine1,
    addressLine2: '',
    city,
    region: 'CA',
    postalCode,
    countryCode: 'US',
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  }
}
