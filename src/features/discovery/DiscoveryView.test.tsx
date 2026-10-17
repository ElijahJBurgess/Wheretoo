import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryFilters, DiscoveryDisplayItem } from './discovery.types'
import { DiscoveryView, type DiscoveryViewProps } from './DiscoveryView'

const preview = vi.hoisted(() => ({ fail: false }))
vi.mock('../../map/LivingMapPage', () => ({ Component: () => {
  if (preview.fail) throw new Error('Map chunk could not load')
  return <section aria-label="City map preview" />
} }))

const filters: DiscoveryFilters = { when: 'next7', category: null, price: null }
const item = (overrides: Partial<DiscoveryDisplayItem> = {}): DiscoveryDisplayItem => ({
  id: '00000000-0000-4000-8000-000000000001', title: 'Sunset Rooftop Sessions', category: 'music', admissionType: 'paid',
  startsAt: '2026-09-13T23:00:00Z', endsAt: '2026-09-14T03:00:00Z', timezone: 'America/Los_Angeles',
  venueName: 'The Courtyard', city: 'Oakland', artworkReference: null,
  admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null }, ...overrides,
})

function props(overrides: Partial<DiscoveryViewProps> = {}): DiscoveryViewProps {
  return {
    mode: 'list', filters, items: [item()], status: 'ready', hasMore: false, isLoadingMore: false,
    onFiltersChange: vi.fn(), onRefresh: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn(), publicSearch: '',
    ...overrides,
  }
}

function renderView(input: DiscoveryViewProps) {
  const router = createMemoryRouter([
    { path: '/discover', element: <DiscoveryView {...input} /> },
    { path: '/events/:eventId', element: <h1>Public event</h1> },
    { path: '/map', element: <h1>Full city map</h1> },
    { path: '/organizer/events', element: <h1>Organizer events</h1> },
  ], { initialEntries: ['/discover'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('DiscoveryView', () => {
  it('offers more results instead of claiming an empty area when a cursor remains', async () => {
    const onLoadMore = vi.fn()
    renderView(props({ items: [], hasMore: true, onLoadMore }))
    expect(screen.queryByText(/No events/)).toBeNull()
    expect(screen.getByText('More events may be available.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('checks cached empty results without announcing a confirmed absence', () => {
    renderView(props({ items: [], isRefreshing: true, notice: 'Refreshing events…' }))
    expect(screen.queryByText(/No events/)).toBeNull()
    expect(screen.getByText('Checking for events…')).toBeVisible()
    expect(screen.queryByText('Refreshing events…')).toBeNull()
    expect(screen.queryByRole('status', { name: 'Discovery results' })).toBeNull()
  })

  it('offers retry instead of an empty banner after an empty refresh fails', async () => {
    const onRetry = vi.fn()
    renderView(props({ items: [], isRefreshError: true, notice: 'Couldn’t refresh events. Showing the last results we received.', onRetry }))
    expect(screen.queryByText(/No events/)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load events.')
    expect(screen.queryByText('Couldn’t refresh events. Showing the last results we received.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('retains usable rows on refresh failure without claiming current completeness', () => {
    renderView(props({ isRefreshError: true, notice: 'Couldn’t refresh events. Showing the last results we received.' }))
    expect(screen.getByText('Sunset Rooftop Sessions')).toBeVisible()
    expect(screen.getByText('Couldn’t refresh events. Showing the last results we received.')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('That’s everything coming up.')).toBeNull()
  })

  it.each([true, false])('never claims completeness after excluding malformed results; usable rows=%s', usable => {
    renderView(props({ items: usable ? [item()] : [], invalidItemCount: 1 }))
    expect(screen.getByText(/1 event could not be shown/)).toHaveTextContent('More events may be available.')
    expect(screen.queryByText('That’s everything coming up.')).toBeNull()
    expect(screen.queryByText(/No events/)).toBeNull()
  })

  it('offers inline reset with the established defaults for filtered empty results', async () => {
    const onFiltersChange = vi.fn()
    renderView(props({ items: [], filters: { when: 'weekend', category: 'music', price: 'free' }, onFiltersChange }))
    const feedback = screen.getByText('No events match these filters in this area.').closest('section')!
    await userEvent.click(within(feedback).getByRole('button', { name: 'Clear filters' }))
    expect(onFiltersChange).toHaveBeenCalledWith({ when: 'next7', category: null, price: null })
    expect(screen.getByRole('heading', { name: 'Events in this area' })).toHaveFocus()
  })

  it('does not describe a legacy thirty-day search as a restrictive date filter', () => {
    renderView(props({ items: [], filters: { when: 'upcoming', category: null, price: null } }))
    expect(screen.getByText('No events in this map area yet.')).toBeVisible()
    expect(screen.queryByText(/Clear the filters to see everything/)).toBeNull()
    expect(document.querySelector('.discovery-results__heading')).toHaveTextContent('Next 30 Days')
  })

  it('keeps discovery and organizer navigation usable when the map fails', async () => {
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {})
    preview.fail = true
    try {
      renderView(props({ items: [], mode: 'map' }))
      expect(await screen.findByText('We couldn’t load the map.')).toBeVisible()
      expect(screen.getByText('No events in this map area yet.').closest('[hidden]')).not.toBeNull()
      expect(screen.getByRole('link', { name: 'Organize' })).toHaveAttribute('href', '/organizer/events')
      await userEvent.click(screen.getByRole('link', { name: /Expand map/ }))
      expect(await screen.findByRole('heading', { name: 'Full city map' })).toBeVisible()
    } finally {
      preview.fail = false
      logging.mockRestore()
    }
  })

  it.each(['ready', 'loading', 'error'] as const)('opens the map from discovery when events are %s', async (status) => {
    renderView(props({ status, items: [] }))
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map')
    await userEvent.click(screen.getByRole('link', { name: /Expand map/ }))
    expect(await screen.findByRole('heading', { name: 'Full city map' })).toBeVisible()
  })

  it('renders one public landmark, all supported filters, and only working navigation', async () => {
    const onFiltersChange = vi.fn()
    renderView(props({ onFiltersChange }))

    expect(screen.getByRole('heading', { level: 1, name: 'Find somewhere worth going.' })).toBeVisible()
    expect(screen.getByText('SF Bay Area')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Date' })).toHaveValue('next7')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Fitness' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /This Weekend/ })).toHaveAttribute('href', '/discover?when=weekend')
    expect(screen.getByRole('link', { name: /Free Events/ })).toHaveAttribute('href', '/discover?price=free')
    expect(screen.queryByRole('link', { name: /Calendar|For You|Explore on map/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/discover')
    expect(screen.getByRole('link', { name: 'Organize' })).toHaveAttribute('href', '/organizer/events')
    expect(screen.queryByRole('link', { name: 'Tickets' })).toBeNull()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'music')
    expect(onFiltersChange).toHaveBeenCalledWith({ when: 'next7', category: 'music', price: null }, 'category')
  })

  it('surfaces an active non-shortcut category and always offers Clear filters for nondefault state', async () => {
    const onFiltersChange = vi.fn()
    renderView(props({ filters: { when: 'next7', category: 'fitness', price: null }, onFiltersChange }))
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('fitness')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onFiltersChange).toHaveBeenCalledWith(filters)
  })

  it('uses one artwork event as the hero, removes it from rows, and carries public return state', async () => {
    const hero = item({ artworkReference: '/hero.jpg', admission: { state: 'open', minimumBuyerAmountMinor: 1500, currency: 'usd' } })
    const row = item({ id: '00000000-0000-4000-8000-000000000002', title: 'Night Garden', category: 'art_culture' })
    const { router } = renderView(props({ items: [hero, row], publicSearch: '?when=today&category=music' }))

    expect(screen.getByText('Featured')).toBeVisible()
    expect(screen.getAllByText('Sunset Rooftop Sessions')).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Events' })).toHaveTextContent('Night Garden')
    expect(screen.getByRole('list', { name: 'Events' })).not.toHaveTextContent('Sunset Rooftop Sessions')

    await userEvent.click(screen.getByRole('link', { name: 'View Sunset Rooftop Sessions' }))
    expect(router.state.location.pathname).toBe('/events/00000000-0000-4000-8000-000000000001')
    expect(router.state.location.state).toEqual({ discoverySearch: '?when=today&category=music' })
  })

  it('renders branded category art when production items have no photo', () => {
    renderView(props({ items: [item({ title: 'A very long event title designed to wrap safely without hiding its date, place, or honest price information' })] }))
    expect(screen.getByText('Featured')).toBeVisible()
    expect(screen.getByLabelText('Music event artwork')).toBeVisible()
    expect(screen.getByText('View prices')).toBeVisible()
  })

  it('keeps the shell truthful across loading, filtered empty, and rate-limited states', async () => {
    const onFiltersChange = vi.fn()
    const loading = renderView(props({ status: 'loading', items: [] }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading events')
    expect(screen.queryByText('Sunset Rooftop Sessions')).toBeNull()
    loading.unmount()

    const empty = renderView(props({ filters: { when: 'today', category: 'music', price: 'free' }, items: [], onFiltersChange }))
    expect(screen.getByText('No events match these filters in this area.')).toBeVisible()
    await userEvent.click(within(screen.getByText('No events match these filters in this area.').closest('section')!).getByRole('button', { name: 'Clear filters' }))
    expect(onFiltersChange).toHaveBeenCalledWith(filters)
    empty.unmount()

    renderView(props({ status: 'error', items: [], errorKind: 'rate_limited', retryAfterSeconds: 42 }))
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 42 seconds')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  })

  it('offers a deliberate Upcoming transition for an empty Today filter and announces result count', async () => {
    const onFiltersChange = vi.fn()
    const empty = renderView(props({ filters: { when: 'today', category: null, price: null }, items: [], onFiltersChange }))
    await userEvent.click(screen.getByRole('button', { name: 'See Next 7 Days' }))
    expect(onFiltersChange).toHaveBeenCalledWith(filters)
    empty.unmount()

    renderView(props({ items: [item(), item({ id: '00000000-0000-4000-8000-000000000002' })] }))
    expect(screen.getByRole('status', { name: 'Discovery results' })).toHaveTextContent('2 events')
    expect(document.querySelector('.discovery-results__heading')).toHaveTextContent('Next 7 Days')
  })

  it('selects a hero only from the supplied stable first-page candidates', () => {
    const firstPage = item()
    const laterArtwork = item({
      id: '00000000-0000-4000-8000-000000000002', title: 'Later artwork event', artworkReference: '/later.jpg',
      admission: { state: 'open', minimumBuyerAmountMinor: 2000, currency: 'usd' },
    })
    renderView(props({ items: [firstPage, laterArtwork], highlightItems: [firstPage] }))
    expect(screen.getByText('Featured')).toBeVisible()
    expect(screen.getByRole('list', { name: 'Events' })).not.toHaveTextContent('Sunset Rooftop Sessions')
  })

  it('preserves rows when pagination fails and retries load more independently', async () => {
    const onLoadMore = vi.fn()
    renderView(props({ hasMore: true, moreError: 'Could not load more events.', onLoadMore }))
    expect(screen.getByText('Sunset Rooftop Sessions')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load more events.')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Try loading more' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('disables refresh and append recovery while the retry window is active', () => {
    renderView(props({ hasMore: true, moreError: 'Could not load more events.', retryAfterSeconds: 20 }))
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Try loading more' })).toBeDisabled()
  })
})
