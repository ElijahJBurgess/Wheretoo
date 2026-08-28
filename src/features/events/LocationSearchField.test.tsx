import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps } from 'react'
import type {
  SearchBox as SearchBoxComponent,
  SearchBoxRefType,
} from '@mapbox/search-js-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchBoxRetrieveResponse } from '../../lib/mapbox/normalizeSearchResult'
import type { NormalizedLocation } from './event.types'

type MockSearchBoxProps = ComponentProps<typeof SearchBoxComponent>

let latestSearchBoxProps: MockSearchBoxProps | null = null

vi.mock('../../lib/env', () => ({
  publicEnv: {
    mapboxAccessToken: 'pk.test-mapbox-token',
    supabasePublishableKey: 'sb_publishable_test',
    supabaseUrl: 'https://test.supabase.co',
  },
}))

vi.mock('@mapbox/search-js-react', async () => {
  const { forwardRef, useImperativeHandle, useRef } = await import('react')

  return {
    SearchBox: forwardRef<SearchBoxRefType, MockSearchBoxProps>(function MockSearchBox(props, ref) {
      const inputRef = useRef<HTMLInputElement>(null)
      latestSearchBoxProps = props

      useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
        search: () => undefined,
      }))

      return (
        <input
          aria-label="Search for a California address"
          onChange={(event) => props.onChange?.(event.currentTarget.value)}
          placeholder={props.placeholder}
          ref={inputRef}
          value={props.value ?? ''}
        />
      )
    }),
  }
})

import LocationSearchField from './LocationSearchField'

const verifiedLocation: NormalizedLocation = {
  mapboxFeatureId: 'dXJuOm1ieGFkcjo...',
  addressLine1: '1 Dr Carlton B Goodlett Place',
  addressLine2: '',
  city: 'San Francisco',
  region: 'CA',
  postalCode: '94102',
  countryCode: 'US',
  latitude: 37.7793,
  longitude: -122.4193,
}

function makeResponse(featureCount = 1): SearchBoxRetrieveResponse {
  const feature = {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [-122.4193, 37.7793],
    },
    properties: {
      name: '1 Dr Carlton B Goodlett Place',
      name_preferred: '',
      mapbox_id: 'dXJuOm1ieGFkcjo...',
      feature_type: 'address',
      address: '1 Dr Carlton B Goodlett Place',
      full_address: '1 Dr Carlton B Goodlett Place, San Francisco, California 94102, United States',
      place_formatted: 'San Francisco, California 94102, United States',
      context: {
        country: {
          id: 'country-us',
          name: 'United States',
          country_code: 'US',
          country_code_alpha_3: 'USA',
        },
        region: {
          id: 'region-ca',
          name: 'California',
          region_code: 'CA',
          region_code_full: 'US-CA',
        },
        postcode: { id: 'postcode-94102', name: '94102' },
        place: { id: 'place-sf', name: 'San Francisco' },
      },
      language: 'en',
      maki: 'marker',
      poi_category: [],
      brand: '',
      brand_id: '',
      external_ids: {},
      metadata: {},
      coordinates: {
        longitude: -122.4193,
        latitude: 37.7793,
        accuracy: 'rooftop',
      },
    },
  }

  return {
    type: 'FeatureCollection',
    features: Array.from({ length: featureCount }, () => feature),
  }
}

function searchBoxProps(): MockSearchBoxProps {
  if (latestSearchBoxProps === null) {
    throw new Error('SearchBox did not render')
  }

  return latestSearchBoxProps
}

describe('LocationSearchField', () => {
  beforeEach(() => {
    latestSearchBoxProps = null
  })

  it('configures official search for US address and POI results near San Francisco', () => {
    render(<LocationSearchField value={null} onChange={vi.fn()} />)

    expect(searchBoxProps()).toMatchObject({
      accessToken: 'pk.test-mapbox-token',
      componentOptions: { allowReverse: false },
      options: {
        country: 'US',
        language: 'en',
        limit: 5,
        proximity: { lat: 37.7749, lng: -122.4194 },
        types: 'address,poi',
      },
      placeholder: 'Search for a California address',
    })
    expect(searchBoxProps().theme).toMatchObject({
      variables: {
        borderRadius: '0.75rem',
        colorPrimary: '#4d2fd4',
        fontFamily: "'Manrope Variable', sans-serif",
        unit: '1rem',
      },
    })
    expect(searchBoxProps().theme?.cssText).toContain('.ActionIcon')
    expect(searchBoxProps().theme?.cssText).toContain('min-height: 44px')
    expect(searchBoxProps().theme?.cssText).toContain('min-width: 44px')
  })

  it('returns a normalized verified location and shows its address outside the vendor input', () => {
    const onChange = vi.fn()
    function Harness() {
      const [location, setLocation] = useState<NormalizedLocation | null>(null)
      return (
        <LocationSearchField
          value={location}
          onChange={(nextLocation) => {
            onChange(nextLocation)
            setLocation(nextLocation)
          }}
        />
      )
    }

    render(<Harness />)
    act(() => searchBoxProps().onRetrieve?.(makeResponse()))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(verifiedLocation)
    expect(screen.getByText('Verified address')).toBeInTheDocument()
    expect(screen.getByText('1 Dr Carlton B Goodlett Place')).toBeInTheDocument()
    expect(screen.getByText('San Francisco, CA 94102')).toBeInTheDocument()
  })

  it('rejects an invalid retrieval with exact actionable copy', () => {
    const onChange = vi.fn()
    render(<LocationSearchField value={null} onChange={onChange} />)

    act(() => searchBoxProps().onRetrieve?.(makeResponse(0)))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a verified California address')
  })

  it('requires an explicit clear before accepting replacement freeform text', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Harness() {
      const [location, setLocation] = useState<NormalizedLocation | null>(verifiedLocation)

      return (
        <LocationSearchField
          value={location}
          onChange={(nextLocation) => {
            onChange(nextLocation)
            setLocation(nextLocation)
          }}
        />
      )
    }

    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Clear address' }))
    act(() => searchBoxProps().onChange?.('An edited but unverified address'))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
    await waitFor(() => {
      expect(screen.getByLabelText('Search for a California address')).toHaveValue(
        'An edited but unverified address',
      )
    })
    expect(screen.queryByText('Verified address')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deduplicates the vendor input and clear events when the final character is deleted', () => {
    const onChange = vi.fn()
    render(<LocationSearchField value={null} onChange={onChange} />)

    act(() => {
      const props = searchBoxProps()
      props.onChange?.('x')
      props.onChange?.('')
      props.onClear?.()
    })

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
    expect(screen.getByLabelText('Search for a California address')).toHaveValue('')
    expect(screen.queryByText('Verified address')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear address' })).not.toBeInTheDocument()
  })

  it('does not suppress an independent vendor clear after external verified hydration', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <LocationSearchField value={null} onChange={onChange} />,
    )

    act(() => searchBoxProps().onClear?.())
    expect(onChange).toHaveBeenCalledTimes(1)

    rerender(<LocationSearchField value={verifiedLocation} onChange={onChange} />)
    rerender(<LocationSearchField value={null} onChange={onChange} />)
    act(() => searchBoxProps().onClear?.())

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls).toEqual([[null], [null]])
  })

  it('shows a recoverable search-service error and clears it on retry and successful retrieval', () => {
    const onChange = vi.fn()
    function Harness() {
      const [location, setLocation] = useState<NormalizedLocation | null>(null)
      return (
        <LocationSearchField
          value={location}
          onChange={(nextLocation) => {
            onChange(nextLocation)
            setLocation(nextLocation)
          }}
        />
      )
    }

    render(<Harness />)

    act(() => searchBoxProps().onSuggestError?.(new Error('network unavailable')))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Address search is unavailable. Check your connection and try again.',
    )

    act(() => searchBoxProps().onChange?.('1 Dr Carlton'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => searchBoxProps().onSuggestError?.(new Error('network unavailable')))
    act(() => searchBoxProps().onRetrieve?.(makeResponse()))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Verified address')).toBeInTheDocument()
  })

  it('keeps an existing verified location outside the vendor search lifecycle', () => {
    const onChange = vi.fn()
    render(<LocationSearchField value={verifiedLocation} onChange={onChange} />)

    expect(latestSearchBoxProps).toBeNull()
    expect(screen.getByLabelText('Search for a California address')).toHaveAttribute('readonly')
    expect(screen.getByText('Verified address')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reflects a verified value supplied after the field first renders', async () => {
    const { rerender } = render(<LocationSearchField value={null} onChange={vi.fn()} />)

    rerender(<LocationSearchField value={verifiedLocation} onChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Search for a California address')).toHaveValue(
        '1 Dr Carlton B Goodlett Place, San Francisco, CA 94102',
      )
    })
  })

  it('does not mount the unsafe vendor control for an initial verified address', () => {
    render(<LocationSearchField value={verifiedLocation} onChange={vi.fn()} />)

    expect(latestSearchBoxProps).toBeNull()
    expect(screen.getByLabelText('Search for a California address')).toHaveAttribute('readonly')
  })

  it('reflects an externally updated address even when its Mapbox ID is unchanged', async () => {
    const { rerender } = render(
      <LocationSearchField value={verifiedLocation} onChange={vi.fn()} />,
    )
    const updatedLocation = {
      ...verifiedLocation,
      addressLine1: '2 Dr Carlton B Goodlett Place',
      postalCode: '94103',
    }

    rerender(<LocationSearchField value={updatedLocation} onChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Search for a California address')).toHaveValue(
        '2 Dr Carlton B Goodlett Place, San Francisco, CA 94103',
      )
    })
    expect(screen.getByText('2 Dr Carlton B Goodlett Place')).toBeInTheDocument()
    expect(screen.getByText('San Francisco, CA 94103')).toBeInTheDocument()
  })

  it('clears the verified value from its accessible clear control', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Harness() {
      const [location, setLocation] = useState<NormalizedLocation | null>(verifiedLocation)

      return (
        <LocationSearchField
          value={location}
          onChange={(nextLocation) => {
            onChange(nextLocation)
            setLocation(nextLocation)
          }}
        />
      )
    }

    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Clear address' }))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
    expect(screen.queryByText('Verified address')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Search for a California address')).toHaveFocus()
    })
  })

  it('clears through the vendor clear callback without a duplicate loop', () => {
    const onChange = vi.fn()
    render(<LocationSearchField value={null} onChange={onChange} />)

    act(() => searchBoxProps().onClear?.())

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('associates external errors without firing duplicate callbacks', () => {
    const onChange = vi.fn()
    render(
      <LocationSearchField
        error="Add a verified event address"
        value={verifiedLocation}
        onChange={onChange}
      />,
    )

    const group = screen.getByRole('group', { name: 'Event address' })
    expect(group).toHaveAttribute('aria-describedby', 'event-location-error')
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByLabelText('Search for a California address')).toHaveAttribute('readonly')
    expect(onChange).not.toHaveBeenCalled()
  })
})
