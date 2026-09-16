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
  it('renders one public landmark, the three category shortcuts, and only working navigation', async () => {
    const onFiltersChange = vi.fn()
    renderView(props({ onFiltersChange }))

    expect(screen.getByRole('heading', { level: 1, name: 'Somewhere to go?' })).toBeVisible()
    expect(screen.getByText('SF Bay Area')).toBeVisible()
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Upcoming', pressed: true })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Fitness' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/discover')
    expect(screen.getByRole('link', { name: 'Organize' })).toHaveAttribute('href', '/organizer/events')
    expect(screen.queryByRole('link', { name: 'Tickets' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Music' }))
    expect(onFiltersChange).toHaveBeenCalledWith({ when: 'upcoming', category: 'music', price: null })
  })

  it('surfaces an active non-shortcut category and always offers Clear filters for nondefault state', async () => {
    const onFiltersChange = vi.fn()
    renderView(props({ filters: { when: 'upcoming', category: 'fitness', price: null }, onFiltersChange }))
    expect(screen.getByRole('button', { name: 'Fitness', pressed: true })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onFiltersChange).toHaveBeenCalledWith(filters)
  })

  it('uses one open artwork event as the hero, removes it from rows, and carries public return state', async () => {
    const hero = item({ artworkReference: '/hero.jpg', admission: { state: 'open', minimumBuyerAmountMinor: 1500, currency: 'usd' } })
    const row = item({ id: '00000000-0000-4000-8000-000000000002', title: 'Night Garden', category: 'art_culture' })
    const { router } = renderView(props({ items: [hero, row], publicSearch: '?when=today&category=music' }))

    expect(screen.getByText('Coming up')).toBeVisible()
    expect(screen.getAllByText('Sunset Rooftop Sessions')).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Events' })).toHaveTextContent('Night Garden')
    expect(screen.getByRole('list', { name: 'Events' })).not.toHaveTextContent('Sunset Rooftop Sessions')

    await userEvent.click(screen.getByRole('link', { name: 'View Sunset Rooftop Sessions' }))
    expect(router.state.location.pathname).toBe('/events/00000000-0000-4000-8000-000000000001')
    expect(router.state.location.state).toEqual({ discoverySearch: '?when=today&category=music' })
  })

  it('renders branded category art when production items have no photo', () => {
    renderView(props({ items: [item({ title: 'A very long event title designed to wrap safely without hiding its date, place, or honest price information' })] }))
    expect(screen.queryByText('Coming up')).toBeNull()
    expect(screen.getByLabelText('Music event artwork')).toBeVisible()
    const mobileAdmission = screen.getByTestId('mobile-admission')
    expect(mobileAdmission).toHaveTextContent('View prices')
    expect(mobileAdmission.closest('.discovery-event-row__copy')).not.toBeNull()
    expect(mobileAdmission).not.toHaveAttribute('aria-hidden')
    expect(mobileAdmission.closest('.discovery-event-row')?.querySelector('.discovery-event-row__end .discovery-admission')).not.toHaveAttribute('aria-hidden')
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
      id: '00000000-0000-4000-8000-000000000002', artworkReference: '/later.jpg',
      admission: { state: 'open', minimumBuyerAmountMinor: 2000, currency: 'usd' },
    })
    renderView(props({ items: [firstPage, laterArtwork], highlightItems: [firstPage] }))
    expect(screen.queryByText('Coming up')).toBeNull()
    expect(screen.getByRole('list', { name: 'Events' })).toHaveTextContent('Sunset Rooftop Sessions')
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
