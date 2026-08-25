import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organizer } from '../organizers/organizer.api'
import type { EventRow } from './event.types'

const { eventRefetch, organizerRefetch, useOrganizer, useOwnedEvent, useSession } = vi.hoisted(() => ({
  eventRefetch: vi.fn(), organizerRefetch: vi.fn(), useOrganizer: vi.fn(), useOwnedEvent: vi.fn(), useSession: vi.fn(),
}))
vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('../organizers/organizer.queries', () => ({ useOrganizer }))
vi.mock('./event.queries', () => ({ useOwnedEvent }))

import { PublishedEventPage } from './PublishedEventPage'

const organizer = { id: 'organizer-1', display_name: 'Bay City Arts' } as Organizer
const event = {
  id: 'event-1', organizer_id: 'organizer-1', status: 'published', moderation_status: 'clear', title: 'Friday Night Makers',
  description: 'Meet neighborhood artists and makers for an open studio evening.', category: 'art_culture',
  starts_at: '2027-01-15T20:30:00.000Z', ends_at: '2027-01-15T22:00:00.000Z', timezone: 'America/Los_Angeles',
  venue_name: 'The Workshop', address_line1: '123 Valencia St', address_line2: null, city: 'San Francisco', region: 'CA',
  postal_code: '94103', country_code: 'US', mapbox_feature_id: 'address.verified', latitude: 37.76, longitude: -122.42,
  location: 'computed geography', admission_type: 'free', capacity: 100, artwork_path: null, animation_preset: 'generic',
  published_at: '2026-08-24T16:00:00.000Z', created_at: '2026-08-24T12:00:00.000Z', updated_at: '2026-08-24T16:00:00.000Z',
} as EventRow

function renderPage(
  row: EventRow | null = event,
  queryState?: { data: EventRow | null | undefined; isPending: boolean; isError: boolean; refetch: typeof eventRefetch },
) {
  useOwnedEvent.mockReturnValue(queryState ?? { data: row, isPending: false, isError: false, refetch: eventRefetch })
  const router = createMemoryRouter([
    { path: '/organizer/events/:eventId', element: <PublishedEventPage /> },
    { path: '/organizer/events/:eventId/edit', element: <p>edit destination</p> },
    { path: '/organizer/events', element: <p>events destination</p> },
  ], { initialEntries: ['/organizer/events/event-1'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('PublishedEventPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    useOrganizer.mockReturnValue({ data: organizer, isPending: false, isError: false, refetch: organizerRefetch })
  })

  it('queries by authenticated owner and route ID, then confirms clear and flagged publication', () => {
    renderPage()
    expect(useOwnedEvent).toHaveBeenCalledWith('event-1', 'organizer-1')
    expect(useOrganizer).toHaveBeenCalledWith('organizer-1')
    expect(screen.getByRole('heading', { name: 'Published' })).toBeInTheDocument()
    expect(screen.getByText('Published August 24, 2026 at 9:00 AM')).toBeInTheDocument()
    expect(screen.getByText('This event is publicly available.')).toBeInTheDocument()
    expect(screen.queryByText(/map|tickets|checkout/i)).not.toBeInTheDocument()
  })

  it.each(['flagged'] as const)('keeps %s events publicly available without adding an approval state', (moderationStatus) => {
    renderPage({ ...event, moderation_status: moderationStatus })
    expect(screen.getByText('This event is publicly available.')).toBeInTheDocument()
    expect(screen.queryByText(/pending review|awaiting approval/i)).not.toBeInTheDocument()
  })

  it.each([
    ['blocked', 'Blocked', 'This event is blocked from public discovery.'],
    ['removed', 'Removed', 'This event has been removed from public discovery.'],
  ] as const)('keeps an owned %s event readable without claiming visibility or admin controls', (moderationStatus, label, copy) => {
    renderPage({ ...event, moderation_status: moderationStatus })
    expect(screen.getByText(label, { selector: '.event-operational-state' })).toBeInTheDocument()
    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Friday Night Makers' })).toBeInTheDocument()
    expect(screen.queryByText('This event is publicly available.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /moderate|appeal|restore|remove|unblock/i })).not.toBeInTheDocument()
  })

  it('redirects drafts with replace semantics', async () => {
    const { router } = renderPage({ ...event, status: 'draft', published_at: null })
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('handles cancelled lifecycle conservatively without public or cancellation actions', () => {
    renderPage({ ...event, status: 'cancelled' })
    expect(screen.getByRole('heading', { name: 'Cancelled' })).toBeInTheDocument()
    expect(screen.getByText('This event is not publicly available.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel|refund/i })).not.toBeInTheDocument()
  })

  it('renders deterministic loading, retryable query failure, and safe not found', async () => {
    const loading = renderPage(event, { data: undefined, isPending: true, isError: false, refetch: eventRefetch })
    expect(screen.getByText('Loading published event')).toBeInTheDocument()
    expect(useOrganizer).toHaveBeenCalledWith('')
    loading.unmount()

    const user = userEvent.setup()
    const failed = renderPage(event, { data: undefined, isPending: false, isError: true, refetch: eventRefetch })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(eventRefetch).toHaveBeenCalledOnce()
    failed.unmount()

    renderPage(null)
    expect(screen.getByText('Event not found')).toBeInTheDocument()
    expect(screen.queryByText(/owner|permission|another organizer/i)).not.toBeInTheDocument()
  })
})
