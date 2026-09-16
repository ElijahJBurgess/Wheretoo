import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef, useImperativeHandle, useRef, useState, type ComponentProps } from 'react'
import type { SearchBox as SearchBoxComponent, SearchBoxRefType } from '@mapbox/search-js-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchBoxRetrieveResponse } from '../../lib/mapbox/normalizeSearchResult'
import type { NormalizedLocation } from './event.types'

type MockSearchBoxProps = ComponentProps<typeof SearchBoxComponent>

const mapbox = vi.hoisted(() => {
  const core = {}
  const session = {
    abort: vi.fn(), canRetrieve: vi.fn(() => true), canSuggest: vi.fn(() => false),
    clear: vi.fn(), incrementSession: vi.fn(), retrieve: vi.fn(), suggest: vi.fn(),
  }
  return { core, session, useSearchBoxCore: vi.fn(() => core), useSearchSession: vi.fn(() => session) }
})

vi.mock('../../lib/env', () => ({
  publicEnv: { mapboxAccessToken: 'pk.test-mapbox-token', supabasePublishableKey: 'sb_publishable_test', supabaseUrl: 'https://test.supabase.co' },
}))

vi.mock('@mapbox/search-js-react', () => ({
  // Retained only so the RED run can render the old implementation.
  SearchBox: forwardRef<SearchBoxRefType, MockSearchBoxProps>(function MockSearchBox(props, ref) {
    const inputRef = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), search: () => undefined }))
    return <input aria-label="Search for a California address" ref={inputRef} value={props.value ?? ''} readOnly />
  }),
  useSearchBoxCore: mapbox.useSearchBoxCore,
  useSearchSession: mapbox.useSearchSession,
}))

import LocationSearchField from './LocationSearchField'

const verifiedLocation: NormalizedLocation = {
  mapboxFeatureId: 'dXJuOm1ieGFkcjo...', addressLine1: '1 Dr Carlton B Goodlett Place', addressLine2: '',
  city: 'San Francisco', region: 'CA', postalCode: '94102', countryCode: 'US', latitude: 37.7793, longitude: -122.4193,
}

const cityHallSuggestion = {
  name: 'San Francisco City Hall', mapbox_id: 'city-hall', feature_type: 'poi', address: '1 Dr Carlton B Goodlett Place',
  full_address: '1 Dr Carlton B Goodlett Place, San Francisco, California 94102, United States',
  place_formatted: 'San Francisco, California 94102, United States',
}

const marketSuggestion = {
  ...cityHallSuggestion, name: 'Ferry Building', mapbox_id: 'ferry-building', address: '1 Ferry Building',
  full_address: '1 Ferry Building, San Francisco, California 94111, United States',
}

function makeResponse(featureCount = 1): SearchBoxRetrieveResponse {
  const feature = {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [-122.4193, 37.7793] },
    properties: {
      name: '1 Dr Carlton B Goodlett Place', name_preferred: '', mapbox_id: 'dXJuOm1ieGFkcjo...', feature_type: 'address',
      address: '1 Dr Carlton B Goodlett Place', full_address: '1 Dr Carlton B Goodlett Place, San Francisco, California 94102, United States',
      place_formatted: 'San Francisco, California 94102, United States',
      context: {
        country: { id: 'country-us', name: 'United States', country_code: 'US', country_code_alpha_3: 'USA' },
        region: { id: 'region-ca', name: 'California', region_code: 'CA', region_code_full: 'US-CA' },
        postcode: { id: 'postcode-94102', name: '94102' }, place: { id: 'place-sf', name: 'San Francisco' },
      },
      language: 'en', maki: 'marker', poi_category: [], brand: '', brand_id: '', external_ids: {}, metadata: {},
      coordinates: { longitude: -122.4193, latitude: 37.7793, accuracy: 'rooftop' },
    },
  }
  return { type: 'FeatureCollection', features: Array.from({ length: featureCount }, () => feature) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((resolvePromise) => { resolve = resolvePromise }), resolve }
}

function renderHarness(initialLocation: NormalizedLocation | null = null) {
  const onChange = vi.fn()
  function Harness() {
    const [location, setLocation] = useState<NormalizedLocation | null>(initialLocation)
    return <LocationSearchField value={location} onChange={(next) => { onChange(next); setLocation(next) }} />
  }
  return { onChange, ...render(<Harness />) }
}

describe('LocationSearchField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mapbox.session.canRetrieve.mockReturnValue(true)
    mapbox.session.canSuggest.mockReturnValue(false)
    mapbox.session.suggest.mockResolvedValue({ suggestions: [], attribution: '© Mapbox' })
    mapbox.session.retrieve.mockResolvedValue(makeResponse())
  })

  it('uses the public core hooks with the existing bounded search options and app-owned input', () => {
    render(<LocationSearchField value={null} onChange={vi.fn()} />)
    expect(mapbox.useSearchBoxCore).toHaveBeenCalledWith({
      accessToken: 'pk.test-mapbox-token', country: 'US', language: 'en', limit: 5,
      proximity: { lat: 37.7749, lng: -122.4194 }, types: 'address,poi',
    })
    expect(mapbox.useSearchSession).toHaveBeenCalledWith(mapbox.core)
    expect(screen.getByRole('combobox', { name: 'Search for a California address' })).toBeInTheDocument()
    expect(document.querySelector('mapbox-search-box')).not.toBeInTheDocument()
  })

  it('renders suggestions with attribution and retrieves a verified selection', async () => {
    const user = userEvent.setup()
    const { onChange } = renderHarness()
    mapbox.session.suggest.mockResolvedValue({ suggestions: [cityHallSuggestion], attribution: '© 2026 Mapbox and its suppliers' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'City Hall' } })
    expect(await screen.findByRole('option', { name: /San Francisco City Hall/ })).toBeInTheDocument()
    expect(screen.getByText('Powered by Mapbox')).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /San Francisco City Hall/ }))
    expect(mapbox.session.retrieve).toHaveBeenCalledWith(cityHallSuggestion)
    expect(mapbox.session.incrementSession).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(verifiedLocation)
    expect(await screen.findByText('Verified address')).toBeInTheDocument()
    expect(screen.getByText('San Francisco, CA 94102')).toBeInTheDocument()
  })

  it('keeps only the latest suggestion response', async () => {
    const first = deferred<{ suggestions: typeof cityHallSuggestion[]; attribution: string }>()
    const second = deferred<{ suggestions: typeof marketSuggestion[]; attribution: string }>()
    mapbox.session.suggest.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<LocationSearchField value={null} onChange={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'City' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ferry' } })
    await act(async () => second.resolve({ suggestions: [marketSuggestion], attribution: '© Mapbox' }))
    expect(screen.getByRole('option', { name: /Ferry Building/ })).toBeInTheDocument()
    await act(async () => first.resolve({ suggestions: [cityHallSuggestion], attribution: '© Mapbox' }))
    expect(screen.getByRole('option', { name: /Ferry Building/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /City Hall/ })).not.toBeInTheDocument()
  })

  it('ignores suggestion completion after unmount and aborts pending work', async () => {
    const pending = deferred<{ suggestions: typeof cityHallSuggestion[]; attribution: string }>()
    mapbox.session.suggest.mockReturnValue(pending.promise)
    const view = render(<LocationSearchField value={null} onChange={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'City' } })
    view.unmount()
    await act(async () => pending.resolve({ suggestions: [cityHallSuggestion], attribution: '© Mapbox' }))
    expect(mapbox.session.abort).toHaveBeenCalled()
  })

  it('shows a recoverable suggest error and clears it on retry', async () => {
    mapbox.session.suggest.mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ suggestions: [cityHallSuggestion], attribution: '© Mapbox' })
    render(<LocationSearchField value={null} onChange={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'City' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Address search is unavailable. Check your connection and try again.')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'City Hall' } })
    expect(await screen.findByRole('option', { name: /City Hall/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('continues a suggestion-only result without retrieving it', async () => {
    const user = userEvent.setup()
    mapbox.session.suggest.mockResolvedValue({ suggestions: [cityHallSuggestion], attribution: '© Mapbox' })
    mapbox.session.canRetrieve.mockReturnValue(false)
    mapbox.session.canSuggest.mockReturnValue(true)
    render(<LocationSearchField value={null} onChange={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'City' } })
    await user.click(await screen.findByRole('option', { name: /City Hall/ }))
    expect(mapbox.session.suggest).toHaveBeenLastCalledWith(cityHallSuggestion.name)
    expect(mapbox.session.retrieve).not.toHaveBeenCalled()
  })

  it('rejects an invalid retrieval without accepting freeform location data', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    mapbox.session.suggest.mockResolvedValue({ suggestions: [cityHallSuggestion], attribution: '© Mapbox' })
    mapbox.session.retrieve.mockResolvedValue(makeResponse(0))
    render(<LocationSearchField value={null} onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'City' } })
    await user.click(await screen.findByRole('option', { name: /City Hall/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a verified California address')
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('moves through app-rendered options with the keyboard and selects with Enter', async () => {
    mapbox.session.suggest.mockResolvedValue({ suggestions: [cityHallSuggestion, marketSuggestion], attribution: '© Mapbox' })
    render(<LocationSearchField value={null} onChange={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'San Francisco' } })
    const options = await screen.findAllByRole('option')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[0]).toHaveFocus()
    fireEvent.keyDown(options[0], { key: 'ArrowDown' })
    expect(options[1]).toHaveFocus()
    fireEvent.keyDown(options[1], { key: 'ArrowUp' })
    expect(options[0]).toHaveFocus()
    fireEvent.keyDown(options[0], { key: 'Enter' })
    await waitFor(() => expect(mapbox.session.retrieve).toHaveBeenCalledWith(cityHallSuggestion))
  })

  it('clears a verified location once, starts a new session, and returns focus to search', async () => {
    const user = userEvent.setup()
    const { onChange } = renderHarness(verifiedLocation)
    await user.click(screen.getByRole('button', { name: 'Clear address' }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
    expect(mapbox.session.abort).toHaveBeenCalled()
    expect(mapbox.session.incrementSession).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
  })

  it('keeps an externally supplied verified location outside the search lifecycle', () => {
    const onChange = vi.fn()
    render(<LocationSearchField value={verifiedLocation} onChange={onChange} />)
    expect(screen.getByLabelText('Search for a California address')).toHaveAttribute('readonly')
    expect(screen.getByText('Verified address')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(mapbox.session.suggest).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('associates external errors without firing callbacks', () => {
    const onChange = vi.fn()
    render(<LocationSearchField error="Add a verified event address" value={verifiedLocation} onChange={onChange} />)
    expect(screen.getByRole('group', { name: 'Event address' })).toHaveAttribute('aria-describedby', 'event-location-error')
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    expect(onChange).not.toHaveBeenCalled()
  })
})
