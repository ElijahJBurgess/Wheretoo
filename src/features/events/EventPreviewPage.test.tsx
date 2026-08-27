import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organizer } from '../organizers/organizer.api'
import type { EventRow } from './event.types'

const { mutateAsync, organizerRefetch, eventRefetch, requirementsRefetch, useOrganizer, useOwnedEvent, useOwnedEventRequirements, usePublishEvent, useSession } = vi.hoisted(() => ({
  mutateAsync: vi.fn(), organizerRefetch: vi.fn(), eventRefetch: vi.fn(), useOrganizer: vi.fn(),
  requirementsRefetch: vi.fn(), useOwnedEvent: vi.fn(), useOwnedEventRequirements: vi.fn(), usePublishEvent: vi.fn(), useSession: vi.fn(),
}))

vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('../organizers/organizer.queries', () => ({ useOrganizer }))
vi.mock('../moderation/moderation.queries', () => ({ useOwnedEventRequirements }))
vi.mock('./event.queries', () => ({ useOwnedEvent, usePublishEvent }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))

import { EventPreviewPage } from './EventPreviewPage'

const organizer: Organizer = {
  id: 'organizer-1', display_name: 'Bay City Arts', organizer_type: 'Community studio',
  bio: null, website_url: null, base_city: 'Oakland', country_code: 'US',
  onboarding_completed_at: '2026-08-24T12:00:00.000Z', created_at: '2026-08-24T12:00:00.000Z',
  updated_at: '2026-08-24T12:00:00.000Z',
}

const event: EventRow = {
  id: 'event-1', organizer_id: 'organizer-1', status: 'draft', moderation_status: 'clear', content_revision: 1, moderated_revision: null, moderation_version: 0, moderation_updated_at: null, public_history_status: 'never_public', first_publicly_eligible_at: null, public_eligibility_version: 0, publicly_authorized_revision: null, publicly_authorized_action_id: null,
  title: 'Friday Night Makers', description: 'Meet neighborhood artists and makers for an open studio evening.',
  category: 'art_culture', starts_at: '2027-01-15T20:30:00.000Z', ends_at: '2027-01-15T22:00:00.000Z',
  timezone: 'America/Los_Angeles', venue_name: 'The Workshop', address_line1: '123 Valencia St',
  address_line2: 'Suite 4', city: 'San Francisco', region: 'CA', postal_code: '94103', country_code: 'US',
  mapbox_feature_id: 'address.verified', latitude: 37.76, longitude: -122.42, location: 'computed geography',
  admission_type: 'free', capacity: 100, artwork_path: null, animation_preset: 'generic', published_at: null,
  created_at: '2026-08-24T12:00:00.000Z', updated_at: '2026-08-24T13:00:00.000Z',
}

type QueryState<T> = { data: T | null | undefined; isPending: boolean; isError: boolean; refetch: () => unknown }

const eventLoaded: QueryState<EventRow> = { data: event, isPending: false, isError: false, refetch: eventRefetch }
const organizerLoaded: QueryState<Organizer> = { data: organizer, isPending: false, isError: false, refetch: organizerRefetch }
const requirements = {
  minimumAge: 'all_ages', alcoholPresent: false, cannabisPresent: false, explicitAdultContent: false,
  gamblingPresent: false, weaponsPresent: false, highRiskActivity: false, needsAcceptance: false,
  organizerTerms: { policyKind: 'organizer_terms', label: 'Organizer Terms', versionId: 'dev-organizer-terms-v1', stage: 'development_placeholder', publicUrl: '/organizer-terms' },
  eventPolicy: { policyKind: 'event_policy', label: 'Event Policy', versionId: 'dev-event-policy-v1', stage: 'development_placeholder', publicUrl: '/event-policy' },
}

function renderPreview() {
  const router = createMemoryRouter([
    { path: '/organizer/events/:eventId/preview', element: <EventPreviewPage /> },
    { path: '/organizer/events/:eventId/edit', element: <p>edit destination</p> },
    { path: '/organizer/events/:eventId/tickets', element: <p>ticket setup destination</p> },
    { path: '/organizer/events/:eventId', element: <p>published destination</p> },
    { path: '/organizer/events', element: <p>events destination</p> },
  ], { initialEntries: ['/organizer/events/event-1/preview'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('EventPreviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    useOwnedEvent.mockReturnValue(eventLoaded)
    useOrganizer.mockReturnValue(organizerLoaded)
    useOwnedEventRequirements.mockReturnValue({ data: requirements, isPending: false, isError: false, refetch: requirementsRefetch })
    usePublishEvent.mockReturnValue({ isPending: false, mutateAsync })
  })

  it('loads the persisted event before its persisted organizer and renders the complete summary', () => {
    renderPreview()

    expect(useOwnedEvent).toHaveBeenCalledWith('event-1', 'organizer-1')
    expect(useOrganizer).toHaveBeenCalledWith('organizer-1')
    expect(usePublishEvent).toHaveBeenCalledWith('organizer-1')
    expect(useOwnedEventRequirements).toHaveBeenCalledWith('organizer-1', 'event-1')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Preview your event' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Friday Night Makers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'About this event' })).toBeInTheDocument()
    expect(screen.getByText('Hosted by Bay City Arts')).toBeInTheDocument()
    expect(screen.getByText('Friday, January 15, 2027')).toBeInTheDocument()
    expect(screen.getByText('12:30 PM–2:00 PM')).toBeInTheDocument()
    expect(screen.getByText('Pacific time (America/Los_Angeles)')).toBeInTheDocument()
    expect(screen.getByText('Art & culture')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('The Workshop')).toBeInTheDocument()
    expect(screen.getByText('123 Valencia St, Suite 4, San Francisco, CA 94103')).toBeInTheDocument()
    expect(screen.getByText(event.description!)).toBeInTheDocument()
    expect(screen.getByLabelText('Whereto event artwork placeholder')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/ticket selector|rsvp|ai artwork|animation picker|map preview/i)).not.toBeInTheDocument()
  })

  it('renders persisted requirements and policy labels, and gates publish on current acceptance', () => {
    useOwnedEventRequirements.mockReturnValue({
      data: { ...requirements, minimumAge: '21_plus', alcoholPresent: true, needsAcceptance: true },
      isPending: false, isError: false, refetch: requirementsRefetch,
    })
    renderPreview()

    expect(screen.getByRole('heading', { name: 'Event requirements' })).toBeInTheDocument()
    expect(screen.getByText('21+')).toBeInTheDocument()
    expect(screen.getByText('Alcohol present')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Organizer Terms' })).toHaveAttribute('href', '/organizer-terms')
    expect(screen.getByRole('link', { name: 'Event Policy' })).toHaveAttribute('href', '/event-policy')
    expect(screen.getByText('Agreement required before publishing.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish event' })).toBeDisabled()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps publish unavailable while persisted agreement status is loading or failed and offers retry', async () => {
    const user = userEvent.setup()
    useOwnedEventRequirements.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: requirementsRefetch })
    const loading = renderPreview()
    expect(screen.getByText('Loading event requirements')).toBeInTheDocument()
    loading.unmount()

    useOwnedEventRequirements.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: requirementsRefetch })
    renderPreview()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(requirementsRefetch).toHaveBeenCalledOnce()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('waits to enable the organizer query until the event supplies its organizer ID', async () => {
    useOwnedEvent.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: eventRefetch })
    renderPreview()
    expect(screen.getByText('Loading your preview')).toBeInTheDocument()
    expect(useOrganizer).toHaveBeenCalledWith('')
    expect(usePublishEvent).toHaveBeenCalledWith('')
  })

  it('renders retryable event and organizer failures and authorization-safe missing states', async () => {
    const user = userEvent.setup()
    useOwnedEvent.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: eventRefetch })
    const first = renderPreview()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(eventRefetch).toHaveBeenCalledOnce()
    first.unmount()

    useOwnedEvent.mockReturnValue(eventLoaded)
    useOrganizer.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: organizerRefetch })
    const second = renderPreview()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(organizerRefetch).toHaveBeenCalledOnce()
    second.unmount()

    useOwnedEvent.mockReturnValue({ data: null, isPending: false, isError: false, refetch: eventRefetch })
    renderPreview()
    expect(screen.getByText('Event not found')).toBeInTheDocument()
    expect(screen.queryByText(/owner|permission|another organizer/i)).not.toBeInTheDocument()
  })

  it('sends paid drafts to ticket setup and keeps direct preview publication unavailable', () => {
    useOwnedEvent.mockReturnValue({ ...eventLoaded, data: { ...event, admission_type: 'paid' } })
    renderPreview()
    expect(screen.getByRole('link', { name: 'Set up paid tickets' })).toHaveAttribute('href', '/organizer/events/event-1/tickets')
    expect(screen.queryByRole('button', { name: /Publish event|Try publishing again/ })).not.toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('publishes exactly once under rapid clicks and navigates only after a published row returns', async () => {
    const user = userEvent.setup()
    let resolve!: (row: EventRow) => void
    mutateAsync.mockReturnValue(new Promise<EventRow>((done) => { resolve = done }))
    const { router } = renderPreview()
    const publish = screen.getByRole('button', { name: 'Publish event' })
    await user.dblClick(publish)
    expect(mutateAsync).toHaveBeenCalledOnce()
    expect(mutateAsync).toHaveBeenCalledWith('event-1')
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview')
    await act(async () => resolve({ ...event, status: 'published', published_at: '2026-08-24T16:00:00.000Z' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1'))
  })

  it('rejects a mismatched publish response', async () => {
    const user = userEvent.setup()
    useOwnedEvent.mockReturnValue({ ...eventLoaded, data: { ...event, status: 'published', moderation_status: 'blocked' } })
    mutateAsync.mockResolvedValueOnce({ ...event, id: 'event-2', status: 'published', moderation_status: 'clear' })
    const { router } = renderPreview()

    await user.click(screen.getByRole('button', { name: 'Publish changes' }))
    expect(await screen.findByText('Publishing failed. Try again.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview')
  })

  it.each(['blocked', 'removed'] as const)('preserves %s enforcement on re-publish', async (moderationStatus) => {
    const user = userEvent.setup()
    useOwnedEvent.mockReturnValue({
      ...eventLoaded,
      data: { ...event, status: 'published', moderation_status: moderationStatus },
    })
    mutateAsync.mockResolvedValueOnce({ ...event, status: 'published', moderation_status: moderationStatus })
    const { router } = renderPreview()

    await user.click(screen.getByRole('button', { name: 'Publish changes' }))
    expect(mutateAsync).toHaveBeenCalledWith('event-1')
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1'))
  })

  it.each([
    ['EVENT_NOT_FOUND', 'This event could not be found.'],
    ['EVENT_NOT_OWNED', 'This event is not available to this organizer.'],
    ['EVENT_INCOMPLETE', 'Complete every required event detail before publishing.'],
    ['EVENT_TIME_INVALID', 'Choose a future start time and an end time after it.'],
    ['EVENT_LOCATION_INVALID', 'Choose a verified California address.'],
    ['EVENT_OUTSIDE_SERVICE_AREA', 'Choose a location inside the current Bay Area service area.'],
    ['PAID_PUBLISHING_NOT_AVAILABLE', 'Paid event publishing is not available in this milestone. Choose Free to publish.'],
    ['EVENT_MODERATION_BLOCKED', 'This event cannot be published in its current moderation state.'],
  ])('shows recovery copy for %s and preserves preview', async (message, copy) => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValue({ message })
    const { router } = renderPreview()
    await user.click(screen.getByRole('button', { name: 'Publish event' }))
    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview')
  })

  it('suppresses unknown backend details and rejects an unexpected non-published response', async () => {
    const user = userEvent.setup()
    mutateAsync
      .mockRejectedValueOnce(new Error('relation public.secret_table failed'))
      .mockResolvedValueOnce({ ...event, status: 'draft' })
    const { router } = renderPreview()
    await user.click(screen.getByRole('button', { name: 'Publish event' }))
    expect(await screen.findByText('Publishing failed. Try again.')).toBeInTheDocument()
    expect(screen.queryByText(/secret_table/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try publishing again' }))
    expect(await screen.findByText('Publishing failed. Try again.')).toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledTimes(2)
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview')
  })
})
