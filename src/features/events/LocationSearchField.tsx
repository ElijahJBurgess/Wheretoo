import { useEffect, useRef, useState } from 'react'
import { SearchBox, type SearchBoxRefType } from '@mapbox/search-js-react'
import { Button } from '../../components/ui/Button'
import { publicEnv } from '../../lib/env'
import {
  normalizeSearchResult,
  type SearchBoxRetrieveResponse,
} from '../../lib/mapbox/normalizeSearchResult'
import type { NormalizedLocation } from './event.types'

const invalidLocationMessage = 'Choose a verified California address'
const unavailableLocationMessage =
  'Address search is unavailable. Check your connection and try again.'

const searchBoxTheme = {
  variables: {
    border: '1px solid #dedce8',
    borderRadius: '0.75rem',
    boxShadow: 'none',
    colorBackground: '#ffffff',
    colorPrimary: '#4d2fd4',
    colorText: '#19162c',
    fontFamily: "'Manrope Variable', sans-serif",
    unit: '1rem',
  },
  // Search JS scopes this CSS inside its component, so the 44px target cannot leak globally.
  cssText: `
    .Input {
      height: 44px;
      padding-right: 52px;
    }

    .ActionIcon {
      width: 44px;
      height: 44px;
      right: 0;
    }

    .ActionIcon > button {
      min-width: 44px;
      min-height: 44px;
    }
  `,
}

type LocationSearchFieldProps = {
  error?: string
  onChange: (location: NormalizedLocation | null) => void
  value: NormalizedLocation | null
}

function formatLocation(location: NormalizedLocation): string {
  return `${location.addressLine1}, ${location.city}, ${location.region} ${location.postalCode}`
}

function locationKey(location: NormalizedLocation | null): string | null {
  return location === null
    ? null
    : JSON.stringify([
        location.mapboxFeatureId,
        location.addressLine1,
        location.addressLine2,
        location.city,
        location.region,
        location.postalCode,
        location.countryCode,
        location.latitude,
        location.longitude,
      ])
}

export function LocationSearchField({ error, onChange, value }: LocationSearchFieldProps) {
  const valueKey = locationKey(value)
  const [searchState, setSearchState] = useState(() => ({
    ownerKey: valueKey,
    text: value === null ? '' : formatLocation(value),
  }))
  const [retrievalError, setRetrievalError] = useState<string | null>(null)
  const searchBoxRef = useRef<SearchBoxRefType>(null)
  const suppressNextVendorClearRef = useRef(false)
  const focusSearchOnMountRef = useRef(false)

  const searchText =
    searchState.ownerKey === valueKey
      ? searchState.text
      : value === null
        ? ''
        : formatLocation(value)
  const displayedError = retrievalError ?? error
  const errorId = displayedError ? 'event-location-error' : undefined

  useEffect(() => {
    if (value !== null || !focusSearchOnMountRef.current) return
    const frame = requestAnimationFrame(() => {
      focusSearchOnMountRef.current = false
      searchBoxRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [value])

  function handleSearchChange(nextText: string) {
    setRetrievalError(null)

    if (value !== null && nextText !== formatLocation(value)) {
      setSearchState({ ownerKey: null, text: nextText })
      setRetrievalError(invalidLocationMessage)
      // Search JS emits `input('')` and then `clear` synchronously for the final deletion.
      suppressNextVendorClearRef.current = nextText === ''
      onChange(null)
      return
    }

    suppressNextVendorClearRef.current = false
    setSearchState({ ownerKey: valueKey, text: nextText })
  }

  function handleRetrieve(response: SearchBoxRetrieveResponse) {
    const location = normalizeSearchResult(response)

    if (location === null) {
      suppressNextVendorClearRef.current = false
      setRetrievalError(invalidLocationMessage)
      onChange(null)
      return
    }

    const nextKey = locationKey(location)
    suppressNextVendorClearRef.current = false
    setSearchState({ ownerKey: nextKey, text: formatLocation(location) })
    setRetrievalError(null)
    onChange(location)
  }

  function clearField() {
    setSearchState({ ownerKey: null, text: '' })
    setRetrievalError(null)
    searchBoxRef.current?.focus()
  }

  function handleVendorClear() {
    clearField()

    if (suppressNextVendorClearRef.current) {
      suppressNextVendorClearRef.current = false
      return
    }

    onChange(null)
  }

  function handleExternalClear() {
    suppressNextVendorClearRef.current = false
    focusSearchOnMountRef.current = true
    clearField()
    onChange(null)
  }

  function handleSuggestError() {
    setRetrievalError(unavailableLocationMessage)
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
      {value === null ? (
        <SearchBox
          accessToken={publicEnv.mapboxAccessToken}
          componentOptions={{ allowReverse: false }}
          onChange={handleSearchChange}
          onClear={handleVendorClear}
          onRetrieve={handleRetrieve}
          onSuggestError={handleSuggestError}
          options={{
            country: 'US',
            language: 'en',
            limit: 5,
            proximity: { lat: 37.7749, lng: -122.4194 },
            types: 'address,poi',
          }}
          placeholder="Search for a California address"
          ref={searchBoxRef}
          theme={searchBoxTheme}
          value={searchText}
        />
      ) : (
        <input
          aria-label="Search for a California address"
          readOnly
          value={searchText}
        />
      )}

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
        <Button onClick={handleExternalClear} variant="secondary">
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
