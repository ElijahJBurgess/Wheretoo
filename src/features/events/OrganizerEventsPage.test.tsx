import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from './event.types'

const { refetch, useOwnedEvents, useSession } = vi.hoisted(() => ({
  refetch: vi.fn(),
  useOwnedEvents: vi.fn(),
  useSession: vi.fn(),
}))

vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('./event.queries', () => ({ useOwnedEvents }))

import { OrganizerEventsPage } from './OrganizerEventsPage'

const baseEvent: EventRow = {
  id: 'event-1', organizer_id: 'organizer-1', status: 'draft', moderation_status: 'clear',
  title: 'Night Market', description: null, category: null, starts_at: '2026-08-25T02:00:00.000Z',
  ends_at: null, timezone: 'America/Los_Angeles', venue_name: null, address_line1: null,
  address_line2: null, city: null, region: null, postal_code: null, country_code: 'US',
  mapbox_feature_id: null, latitude: null, longitude: null, location: null, admission_type: 'free',
  capacity: null, artwork_path: null, animation_preset: 'generic', published_at: null,
  created_at: '2026-08-24T12:00:00.000Z', updated_at: '2026-08-24T13:00:00.000Z',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/organizer/events']}>
      <Routes>
        <Route path="/organizer/events" element={<OrganizerEventsPage />} />
        <Route path="/organizer/events/new" element={<p>new destination</p>} />
        <Route path="/organizer/events/:eventId/edit" element={<p>edit destination</p>} />
        <Route path="/organizer/events/:eventId" element={<p>detail destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OrganizerEventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    useOwnedEvents.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
  })

  it('loads events for the authenticated organizer', () => {
    renderPage()
    expect(useOwnedEvents).toHaveBeenCalledWith('organizer-1')
    expect(screen.getByText('Loading your events')).toBeInTheDocument()
  })

  it('renders a retryable error', async () => {
    const user = userEvent.setup()
    useOwnedEvents.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Your events could not load')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('invites an empty organizer to create an event', async () => {
    const user = userEvent.setup()
    useOwnedEvents.mockReturnValue({ data: [], isPending: false, isError: false, refetch })
    renderPage()
    expect(screen.getByText('No events yet')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Create event' }))
    expect(await screen.findByText('new destination')).toBeInTheDocument()
  })

  it('shows only approved event metadata and routes drafts to edit and published events to detail', async () => {
    const user = userEvent.setup()
    useOwnedEvents.mockReturnValue({
      data: [
        baseEvent,
        { ...baseEvent, id: 'event-2', title: null, status: 'published', starts_at: null },
      ],
      isPending: false,
      isError: false,
      refetch,
    })
    renderPage()
    expect(screen.getByText('Night Market')).toBeInTheDocument()
    expect(screen.getByText('Untitled event')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText(/Starts/)).toBeInTheDocument()
    expect(screen.getAllByText(/Updated/)).toHaveLength(2)
    expect(screen.queryByText(/tickets|analytics|views|revenue/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Night Market/ }))
    expect(await screen.findByText('edit destination')).toBeInTheDocument()
  })

  it('routes a published event to its detail page', async () => {
    const user = userEvent.setup()
    useOwnedEvents.mockReturnValue({ data: [{ ...baseEvent, status: 'published' }], isPending: false, isError: false, refetch })
    renderPage()
    await user.click(screen.getByRole('link', { name: /Night Market/ }))
    expect(await screen.findByText('detail destination')).toBeInTheDocument()
  })
})
