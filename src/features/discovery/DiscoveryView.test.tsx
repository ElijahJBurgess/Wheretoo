import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryFilters, DiscoveryDisplayItem } from './discovery.types'
import { DiscoveryView, type DiscoveryViewProps } from './DiscoveryView'

const filters: DiscoveryFilters = { when: 'upcoming', category: null, price: null }
const item = (overrides: Partial<DiscoveryDisplayItem> = {}): DiscoveryDisplayItem => ({
  id: '00000000-0000-4000-8000-000000000001', title: 'Sunset Rooftop Sessions', category: 'music', admissionType: 'paid',
  startsAt: '2026-09-13T23:00:00Z', endsAt: '2026-09-14T03:00:00Z', timezone: 'America/Los_Angeles',
  venueName: 'The Courtyard', city: 'Oakland', artworkReference: null,
  admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null }, ...overrides,
})

function props(overrides: Partial<DiscoveryViewProps> = {}): DiscoveryViewProps {
  return {
    filters, items: [item()], status: 'ready', hasMore: false, isLoadingMore: false,
    onFiltersChange: vi.fn(), onRefresh: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn(), publicSearch: '',
    ...overrides,
  }
}

function renderView(input: DiscoveryViewProps) {
  const router = createMemoryRouter([
    { path: '/discover', element: <DiscoveryView {...input} /> },
    { path: '/events/:eventId', element: <h1>Public event</h1> },
    { path: '/organizer/events', element: <h1>Organizer events</h1> },
  ], { initialEntries: ['/discover'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('DiscoveryView', () => {
  it('reuses platform branding and reserves a noninteractive map slot beside the feature', () => {
    const { container } = renderView(props())
    expect(screen.getByRole('link', { name: 'Wheretoo discovery home' })).toHaveClass('platform-wordmark')
    const map = screen.getByRole('complementary', { name: 'Map area' })
    expect(map).toHaveTextContent('Map coming later')
    expect(map.querySelector('a, button, img')).toBeNull()
    expect(map.parentElement).toBe(container.querySelector('.discovery-hero')?.parentElement)
  })

  it('renders one public landmark, all supported filters, and only working navigation', async () => {
    const onFiltersChange = vi.fn()
    renderView(props({ onFiltersChange }))

    expect(screen.getByRole('heading', { level: 1, name: 'Find somewhere worth going.' })).toBeVisible()
    expect(screen.getByText('SF Bay Area')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Date' })).toHaveValue('upcoming')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Fitness' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /This Weekend/ })).toHaveAttribute('href', '/discover?when=weekend')
    expect(screen.getByRole('link', { name: /Free Events/ })).toHaveAttribute('href', '/discover?price=free')
    expect(screen.queryByRole('link', { name: /Calendar|For You|Explore on map/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/discover')
    expect(screen.getByRole('link', { name: 'Organize' })).toHaveAttribute('href', '/organizer/events')
    expect(screen.queryByRole('link', { name: 'Tickets' })).toBeNull()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'music')
    expect(onFiltersChange).toHaveBeenCalledWith({ when: 'upcoming', category: 'music', price: null })
  })

  it('surfaces an active non-shortcut category and always offers Clear filters for nondefault state', async () => {
    const onFiltersChange = vi.fn()
    renderView(props({ filters: { when: 'upcoming', category: 'fitness', price: null }, onFiltersChange }))
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
    expect(screen.getByText('No events match these filters.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onFiltersChange).toHaveBeenCalledWith(filters)
    empty.unmount()

    renderView(props({ status: 'error', items: [], errorKind: 'rate_limited', retryAfterSeconds: 42 }))
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 42 seconds')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  })

  it('offers a deliberate Upcoming transition for an empty Today filter and announces result count', async () => {
    const onFiltersChange = vi.fn()
    const empty = renderView(props({ filters: { when: 'today', category: null, price: null }, items: [], onFiltersChange }))
    await userEvent.click(screen.getByRole('button', { name: 'See upcoming events' }))
    expect(onFiltersChange).toHaveBeenCalledWith(filters)
    empty.unmount()

    renderView(props({ items: [item(), item({ id: '00000000-0000-4000-8000-000000000002' })] }))
    expect(screen.getByRole('status', { name: 'Discovery results' })).toHaveTextContent('2 events')
    expect(screen.getByText('Next 30 days')).toBeVisible()
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
