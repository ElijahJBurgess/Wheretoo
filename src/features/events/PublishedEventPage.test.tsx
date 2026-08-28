import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organizer } from '../organizers/organizer.api'
import type { EventRow } from './event.types'

const { eventRefetch, organizerRefetch, publicEventRefetch, requestMutateAsync, reviewRefetch, useCurrentEventReviewRequest, useOrganizer, useOwnedEvent, usePublicEvent, useRequestEventReview, useSession, useWithdrawEventReview, withdrawMutateAsync } = vi.hoisted(() => ({
  eventRefetch: vi.fn(), organizerRefetch: vi.fn(), publicEventRefetch: vi.fn(), requestMutateAsync: vi.fn(), reviewRefetch: vi.fn(), useCurrentEventReviewRequest: vi.fn(), useOrganizer: vi.fn(), useOwnedEvent: vi.fn(), usePublicEvent: vi.fn(), useRequestEventReview: vi.fn(), useSession: vi.fn(), useWithdrawEventReview: vi.fn(), withdrawMutateAsync: vi.fn(),
}))
vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('../organizers/organizer.queries', () => ({ useOrganizer }))
vi.mock('./event.queries', () => ({ useOwnedEvent }))
vi.mock('../moderation/moderation.queries', () => ({
  useCurrentEventReviewRequest, usePublicEvent, useRequestEventReview, useWithdrawEventReview,
}))

import { PublishedEventPage } from './PublishedEventPage'

const organizer = { id: 'organizer-1', display_name: 'Bay City Arts' } as Organizer
const event = {
  id: 'event-1', organizer_id: 'organizer-1', status: 'published', moderation_status: 'clear', title: 'Friday Night Makers',
  content_revision: 1, moderated_revision: 1,
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
    { path: '/organizer/events/:eventId/tickets', element: <p>ticket setup destination</p> },
    { path: '/organizer/events', element: <p>events destination</p> },
  ], { initialEntries: ['/organizer/events/event-1'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('PublishedEventPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    useOrganizer.mockReturnValue({ data: organizer, isPending: false, isError: false, refetch: organizerRefetch })
    usePublicEvent.mockReturnValue({ data: { id: 'event-1' }, isPending: false, isError: false, refetch: publicEventRefetch })
    useCurrentEventReviewRequest.mockReturnValue({ data: null, isPending: false, isError: false, refetch: reviewRefetch })
    useRequestEventReview.mockReturnValue({ isPending: false, mutateAsync: requestMutateAsync })
    useWithdrawEventReview.mockReturnValue({ isPending: false, mutateAsync: withdrawMutateAsync })
  })

  it('queries owner and canonical public projection before confirming publication', () => {
    renderPage()
    expect(useOwnedEvent).toHaveBeenCalledWith('event-1', 'organizer-1')
    expect(useOrganizer).toHaveBeenCalledWith('organizer-1')
    expect(usePublicEvent).toHaveBeenCalledWith('event-1')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Published' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Friday Night Makers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'About this event' })).toBeInTheDocument()
    expect(screen.getByText('Published August 24, 2026 at 9:00 AM')).toBeInTheDocument()
    expect(screen.getByText('This event is publicly available.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up paid tickets' })).toHaveAttribute('href', '/organizer/events/event-1/tickets')
    expect(screen.queryByText(/map|checkout/i)).not.toBeInTheDocument()
  })

  it('exposes the owner edit route from the published status surface', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()

    const edit = screen.getByRole('link', { name: 'Edit event' })
    expect(edit).toHaveAttribute('href', '/organizer/events/event-1/edit')
    await user.click(edit)

    expect(await screen.findByText('edit destination')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit')
  })

  it('shows an under-review event as held without inferring public eligibility', () => {
    usePublicEvent.mockReturnValue({ data: null, isPending: false, isError: false, refetch: publicEventRefetch })
    renderPage({ ...event, moderation_status: 'under_review' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Under review' })).toBeInTheDocument()
    expect(screen.getByText('This event is not currently available in public discovery.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Set up paid tickets' })).not.toBeInTheDocument()
  })

  it('shows clear but non-current content as under review', () => {
    usePublicEvent.mockReturnValue({ data: null, isPending: false, isError: false, isFetching: false, refetch: publicEventRefetch })
    renderPage({ ...event, moderation_status: 'clear', moderated_revision: null })
    expect(screen.getByRole('heading', { level: 1, name: 'Under review' })).toBeInTheDocument()
    expect(screen.getByText('This event is not currently available in public discovery.')).toBeInTheDocument()
  })

  it('does not trust cached public data while the canonical projection refreshes', () => {
    usePublicEvent.mockReturnValue({ data: { id: 'event-1' }, isPending: false, isError: false, isFetching: true, refetch: publicEventRefetch })
    renderPage()
    expect(screen.getByText('Checking public availability…')).toBeInTheDocument()
    expect(screen.queryByText('This event is publicly available.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Set up paid tickets' })).not.toBeInTheDocument()
  })

  it('does not claim public availability while the canonical projection is unavailable or failed', async () => {
    const user = userEvent.setup()
    usePublicEvent.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: publicEventRefetch })
    renderPage()
    expect(screen.queryByText('This event is publicly available.')).not.toBeInTheDocument()
    expect(screen.getByText('Public availability could not be confirmed.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check public availability again' }))
    expect(publicEventRefetch).toHaveBeenCalledOnce()
  })

  it('takes an owned published-free event to paid ticket setup without exposing an action to public viewers', async () => {
    const user = userEvent.setup()
    const { router } = renderPage({ ...event, admission_type: 'free' })

    const setup = screen.getByRole('link', { name: 'Set up paid tickets' })
    expect(setup).toHaveAttribute('href', '/organizer/events/event-1/tickets')
    await user.click(setup)

    expect(await screen.findByText('ticket setup destination')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets')
  })

  it.each([
    ['blocked', 'Blocked', 'This event is blocked from public discovery.'],
    ['removed', 'Removed', 'This event has been removed from public discovery.'],
  ] as const)('keeps an owned %s event readable without claiming visibility or admin controls', (moderationStatus, label, copy) => {
    usePublicEvent.mockReturnValue({ data: null, isPending: false, isError: false, refetch: publicEventRefetch })
    renderPage({ ...event, moderation_status: moderationStatus })
    expect(screen.getByText(label, { selector: '.event-operational-state' })).toBeInTheDocument()
    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Set up paid tickets' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: label })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Friday Night Makers' })).toBeInTheDocument()
    expect(screen.queryByText('This event is publicly available.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /moderate|appeal|restore|remove|unblock/i })).not.toBeInTheDocument()
  })

  it('reloads an existing open review request and withdraws it exactly once without leaking internal data', async () => {
    const user = userEvent.setup()
    usePublicEvent.mockReturnValue({ data: null, isPending: false, isError: false, refetch: publicEventRefetch })
    useCurrentEventReviewRequest.mockReturnValue({
      data: { id: '37beaa67-b2a2-4b56-9c6c-e91208925c45', status: 'open', createdAt: '2026-08-26T16:00:00Z', resolvedAt: null },
      isPending: false, isError: false, refetch: reviewRefetch,
    })
    let resolve!: (id: string) => void
    withdrawMutateAsync.mockReturnValue(new Promise<string>((done) => { resolve = done }))
    renderPage({ ...event, moderation_status: 'blocked' })

    expect(screen.getByRole('status')).toHaveTextContent('Review requested')
    expect(screen.queryByText(/score|reason|reviewer|report|private|internal/i)).not.toBeInTheDocument()
    await user.dblClick(screen.getByRole('button', { name: 'Withdraw request' }))
    expect(withdrawMutateAsync).toHaveBeenCalledOnce()
    await act(async () => resolve('37beaa67-b2a2-4b56-9c6c-e91208925c45'))
  })

  it('shows a retryable current-review failure instead of an indefinite loading state', async () => {
    const user = userEvent.setup()
    usePublicEvent.mockReturnValue({ data: null, isPending: false, isError: false, isFetching: false, refetch: publicEventRefetch })
    useCurrentEventReviewRequest.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: reviewRefetch })
    renderPage({ ...event, moderation_status: 'blocked' })

    expect(screen.getByRole('alert')).toHaveTextContent('Review request status could not load.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reviewRefetch).toHaveBeenCalledOnce()
  })

  it('submits a bounded optional review note once and offers a safe retry on failure', async () => {
    const user = userEvent.setup()
    usePublicEvent.mockReturnValue({ data: null, isPending: false, isError: false, refetch: publicEventRefetch })
    requestMutateAsync.mockRejectedValueOnce(new Error('private moderation detail')).mockResolvedValueOnce('37beaa67-b2a2-4b56-9c6c-e91208925c45')
    renderPage({ ...event, moderation_status: 'removed' })

    const note = screen.getByRole('textbox', { name: 'Optional note' })
    expect(note).toHaveAttribute('maxLength', '1000')
    await user.type(note, ' Please review the updated context. ')
    await user.click(screen.getByRole('button', { name: 'Request review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Review request could not be sent. Try again.')
    expect(screen.queryByText(/private moderation detail/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try requesting review again' }))
    expect(requestMutateAsync).toHaveBeenLastCalledWith('Please review the updated context.')
    expect(requestMutateAsync).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
  })

  it('redirects drafts with replace semantics', async () => {
    const { router } = renderPage({ ...event, status: 'draft', published_at: null })
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('handles cancelled lifecycle conservatively without public or cancellation actions', () => {
    renderPage({ ...event, status: 'cancelled' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Cancelled' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Friday Night Makers' })).toBeInTheDocument()
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
