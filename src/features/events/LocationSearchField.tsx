import { useState } from 'react'
import { SearchBox } from '@mapbox/search-js-react'
import { Button } from '../../components/ui/Button'
import { publicEnv } from '../../lib/env'
import {
  normalizeSearchResult,
  type SearchBoxRetrieveResponse,
} from '../../lib/mapbox/normalizeSearchResult'
import type { NormalizedLocation } from './event.types'

const invalidLocationMessage = 'Choose a verified California address'

type LocationSearchFieldProps = {
  error?: string
  onChange: (location: NormalizedLocation | null) => void
  value: NormalizedLocation | null
}

function formatLocation(location: NormalizedLocation): string {
  return `${location.addressLine1}, ${location.city}, ${location.region} ${location.postalCode}`
}

export function LocationSearchField({ error, onChange, value }: LocationSearchFieldProps) {
  const valueId = value?.mapboxFeatureId ?? null
  const [searchState, setSearchState] = useState(() => ({
    ownerId: valueId,
    text: value === null ? '' : formatLocation(value),
  }))
  const [retrievalError, setRetrievalError] = useState<string | null>(null)
  const searchText =
    searchState.ownerId === valueId
      ? searchState.text
      : value === null
        ? ''
        : formatLocation(value)
  const displayedError = retrievalError ?? error
  const errorId = displayedError ? 'event-location-error' : undefined

  function handleSearchChange(nextText: string) {
    if (value !== null && nextText !== formatLocation(value)) {
      setSearchState({ ownerId: null, text: nextText })
      setRetrievalError(invalidLocationMessage)
      onChange(null)
      return
    }

    setSearchState({ ownerId: valueId, text: nextText })
  }

  function handleRetrieve(response: SearchBoxRetrieveResponse) {
    const location = normalizeSearchResult(response)

    if (location === null) {
      setRetrievalError(invalidLocationMessage)
      onChange(null)
      return
    }

    setSearchState({ ownerId: location.mapboxFeatureId, text: formatLocation(location) })
    setRetrievalError(null)
    onChange(location)
  }

  function handleClear() {
    setSearchState({ ownerId: null, text: '' })
    setRetrievalError(null)
    onChange(null)
  }

  return (
    <div
      aria-describedby={errorId}
      aria-invalid={displayedError ? true : undefined}
      aria-labelledby="event-location-label"
      className="ui-field location-search-field"
      role="group"
    >
      <span className="ui-field__label" id="event-location-label">
        Event address
      </span>
      <SearchBox
        accessToken={publicEnv.mapboxAccessToken}
        componentOptions={{ allowReverse: false }}
        onChange={handleSearchChange}
        onClear={handleClear}
        onRetrieve={handleRetrieve}
        options={{
          country: 'US',
          language: 'en',
          limit: 5,
          proximity: { lat: 37.7749, lng: -122.4194 },
          types: 'address,poi',
        }}
        placeholder="Search for a California address"
        value={searchText}
      />

      {value !== null ? (
        <div className="location-search-field__verified" role="status">
          <p className="location-search-field__verified-label">Verified address</p>
          <p>{value.addressLine1}</p>
          <p>
            {value.city}, {value.region} {value.postalCode}
          </p>
        </div>
      ) : null}

      {searchText || value !== null ? (
        <Button onClick={handleClear} variant="secondary">
          Clear address
        </Button>
      ) : null}

      {displayedError ? (
        <p aria-live="assertive" className="ui-field__error" id={errorId} role="alert">
          {displayedError}
        </p>
      ) : null}
    </div>
  )
}

export default LocationSearchField
