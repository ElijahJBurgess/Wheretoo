import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchBoxCore, useSearchSession } from '@mapbox/search-js-react'
import { Button } from '../../components/ui/Button'
import { publicEnv } from '../../lib/env'
import { normalizeSearchResult } from '../../lib/mapbox/normalizeSearchResult'
import type { NormalizedLocation } from './event.types'
import './locationSearch.css'

const invalidLocationMessage = 'Choose a verified California address'
const unavailableLocationMessage =
  'Address search is unavailable. Check your connection and try again.'
const searchListId = 'event-location-suggestions'

const searchOptions = {
  accessToken: publicEnv.mapboxAccessToken,
  country: 'US',
  language: 'en',
  limit: 5,
  proximity: { lat: 37.7749, lng: -122.4194 },
  types: 'address,poi',
}

type SearchSuggestion = Awaited<
  ReturnType<ReturnType<typeof useSearchBoxCore>['suggest']>
>['suggestions'][number]

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
  const search = useSearchBoxCore(searchOptions)
  const searchSession = useSearchSession(search)
  const valueKey = locationKey(value)
  const [searchState, setSearchState] = useState(() => ({
    ownerKey: valueKey,
    text: value === null ? '' : formatLocation(value),
  }))
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [showAttribution, setShowAttribution] = useState(false)
  const [retrievalError, setRetrievalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLLIElement | null>>([])
  const requestIdRef = useRef(0)
  const mountedRef = useRef(true)
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
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      searchSession.abort()
    }
  }, [searchSession])

  useEffect(() => {
    if (valueKey === null) return
    requestIdRef.current += 1
    searchSession.abort()
  }, [searchSession, valueKey])

  useEffect(() => {
    if (value !== null || !focusSearchOnMountRef.current) return
    const frame = requestAnimationFrame(() => {
      focusSearchOnMountRef.current = false
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [value])

  function clearSuggestions() {
    setSuggestions([])
    setShowAttribution(false)
  }

  function requestSuggestions(nextText: string) {
    const requestId = ++requestIdRef.current
    setRetrievalError(null)
    clearSuggestions()

    if (nextText.trim().length < 2) {
      searchSession.abort()
      return
    }

    void searchSession.suggest(nextText).then((response) => {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setSuggestions(response.suggestions)
      setShowAttribution(response.suggestions.length > 0 || Boolean(response.attribution))
    }).catch(() => {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      clearSuggestions()
      setRetrievalError(unavailableLocationMessage)
    })
  }

  function handleSearchChange(nextText: string) {
    setSearchState({ ownerKey: valueKey, text: nextText })
    requestSuggestions(nextText)
  }

  function finishSelection(response: Awaited<ReturnType<typeof searchSession.retrieve>>) {
    const location = normalizeSearchResult(response)
    if (location === null) {
      setRetrievalError(invalidLocationMessage)
      onChange(null)
      return
    }

    const nextKey = locationKey(location)
    setSearchState({ ownerKey: nextKey, text: formatLocation(location) })
    setRetrievalError(null)
    clearSuggestions()
    searchSession.incrementSession()
    onChange(location)
  }

  function selectSuggestion(suggestion: SearchSuggestion) {
    if (searchSession.canSuggest(suggestion) && !searchSession.canRetrieve(suggestion)) {
      setSearchState({ ownerKey: valueKey, text: suggestion.name })
      requestSuggestions(suggestion.name)
      inputRef.current?.focus()
      return
    }

    if (!searchSession.canRetrieve(suggestion)) {
      clearSuggestions()
      setRetrievalError(invalidLocationMessage)
      onChange(null)
      return
    }

    const requestId = ++requestIdRef.current
    setRetrievalError(null)
    void searchSession.retrieve(suggestion).then((response) => {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      finishSelection(response)
    }).catch(() => {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setRetrievalError(unavailableLocationMessage)
    })
  }

  function clearField() {
    requestIdRef.current += 1
    searchSession.abort()
    searchSession.incrementSession()
    setSearchState({ ownerKey: null, text: '' })
    setRetrievalError(null)
    clearSuggestions()
  }

  function handleExternalClear() {
    focusSearchOnMountRef.current = true
    clearField()
    onChange(null)
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      optionRefs.current[0]?.focus()
    } else if (event.key === 'Escape') {
      clearSuggestions()
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLLIElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      optionRefs.current[Math.min(index + 1, suggestions.length - 1)]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (index === 0) inputRef.current?.focus()
      else optionRefs.current[index - 1]?.focus()
    } else if (event.key === 'Escape') {
      clearSuggestions()
      inputRef.current?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectSuggestion(suggestions[index])
    }
  }

  return (
    <div
      aria-describedby={errorId}
      aria-invalid={displayedError ? true : undefined}
      aria-labelledby="event-location-label"
      className="ui-field location-search-field"
      role="group"
    >
      <span className="ui-field__label" id="event-location-label">Event address</span>
      {value === null ? (
        <div className="location-search-field__search">
          <input
            aria-autocomplete="list"
            aria-controls={searchListId}
            aria-expanded={suggestions.length > 0}
            aria-label="Search for a California address"
            autoComplete="off"
            onChange={(event) => handleSearchChange(event.currentTarget.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search for a California address"
            ref={inputRef}
            role="combobox"
            value={searchText}
          />
          {suggestions.length > 0 ? (
            <ul className="location-search-field__suggestions" id={searchListId} role="listbox">
              {suggestions.map((suggestion, index) => (
                <li
                  aria-label={`${suggestion.name}, ${suggestion.place_formatted}`}
                  className="location-search-field__suggestion"
                  key={`${suggestion.mapbox_id}-${index}`}
                  onClick={() => selectSuggestion(suggestion)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  ref={(element) => { optionRefs.current[index] = element }}
                  role="option"
                  tabIndex={-1}
                >
                  <strong>{suggestion.name}</strong>
                  <span>{suggestion.place_formatted}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {showAttribution ? (
            <a className="location-search-field__attribution" href="https://www.mapbox.com/about/maps/">
              Powered by Mapbox
            </a>
          ) : null}
        </div>
      ) : (
        <input aria-label="Search for a California address" readOnly value={searchText} />
      )}

      {value !== null ? (
        <div className="location-search-field__verified" role="status">
          <p className="location-search-field__verified-label">Verified address</p>
          <p>{value.addressLine1}</p>
          <p>{value.city}, {value.region} {value.postalCode}</p>
        </div>
      ) : null}

      {searchText || value !== null ? (
        <Button onClick={handleExternalClear} variant="secondary">Clear address</Button>
      ) : null}

      {displayedError ? (
        <p aria-live="assertive" className="ui-field__error" id={errorId} role="alert">{displayedError}</p>
      ) : null}
    </div>
  )
}

export default LocationSearchField
