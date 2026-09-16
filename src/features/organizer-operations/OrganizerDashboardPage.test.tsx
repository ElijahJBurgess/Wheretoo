import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { getEventMetrics, getFreeRegistrationMetrics, ownedRefetch, publicRefetch, useOwnedEvent, usePublicEvent } = vi.hoisted(() => ({
  getEventMetrics: vi.fn(),
  getFreeRegistrationMetrics: vi.fn(),
  ownedRefetch: vi.fn(),
  publicRefetch: vi.fn(),
  useOwnedEvent: vi.fn(),
  usePublicEvent: vi.fn(),
}))
vi.mock('./operations.api', () => ({ getEventMetrics }))
vi.mock('./freeOperations.api', () => ({ getFreeRegistrationMetrics }))
vi.mock('../events/event.queries', () => ({ useOwnedEvent }))
vi.mock('../moderation/moderation.queries', () => ({ usePublicEvent }))
vi.mock(
  '../auth/SessionProvider',
  () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'owner' } }) }),
)
import { OrganizerDashboardPage } from './OrganizerDashboardPage'
const data = {
  event: {
    id: 'event',
    title: 'Sunset Rooftop Sessions',
    status: 'published',
    startsAt: null,
    endsAt: null,
    venueName: null,
    city: null,
    artworkPath: null,
  },
  grossSalesMinor: 342000,
  sold: 142,
  orderCount: 98,
  checkedIn: 87,
  issued: 142,
  capacity: 200,
  admissionEligible: true,
  tiers: [{
    id: 'ga',
    name: 'General Admission',
    status: 'active',
    sold: 110,
    remaining: 40,
    capacity: 150,
    grossSalesMinor: 220000,
  }],
}
const ownedEvent = {
  id: 'event', organizer_id: 'owner', status: 'published', moderation_status: 'clear', content_revision: 4, moderated_revision: 4, moderation_version: 0, moderation_updated_at: null, public_history_status: 'public', first_publicly_eligible_at: '2026-08-01T00:00:00Z', public_eligibility_version: 1, publicly_authorized_revision: 4, publicly_authorized_action_id: null,
  title: 'Sunset Rooftop Sessions', description: 'An evening above the city.', category: 'music', starts_at: '2026-09-20T02:00:00Z', ends_at: '2026-09-20T05:00:00Z', timezone: 'America/Los_Angeles', venue_name: 'Skyline Terrace', address_line1: '100 Market Street', address_line2: 'Roof', city: 'San Francisco', region: 'CA', postal_code: '94105', country_code: 'US', mapbox_feature_id: 'address.1', latitude: 37.79, longitude: -122.4, location: null, admission_type: 'paid', capacity: null, artwork_path: null, animation_preset: 'generic', published_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
}
function show(seedMetrics?: typeof data) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seedMetrics) client.setQueryData(['organizer-operations', 'owner', 'event', 'metrics'], seedMetrics)
  return render(
    <QueryClientProvider
      client={client}
    >
      <MemoryRouter initialEntries={['/organizer/events/event/dashboard']}>
        <Routes>
          <Route path='/organizer/events/:eventId/dashboard' element={<OrganizerDashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  getEventMetrics.mockReset()
  getFreeRegistrationMetrics.mockReset()
  ownedRefetch.mockReset()
  publicRefetch.mockReset()
  useOwnedEvent.mockReturnValue({ data: ownedEvent, isPending: false, isFetchedAfterMount: true, isError: false, refetch: ownedRefetch })
  usePublicEvent.mockReturnValue({ data: { id: 'event' }, isPending: false, isFetching: false, isError: false, refetch: publicRefetch })
})
it('shows owner event context, four historical metrics, tier snapshots, and eligible actions', async () => {
  getEventMetrics.mockResolvedValue(data)
  show()
  expect(await screen.findByRole('heading', { name: data.event.title })).toBeVisible()
  for (const label of ['Gross ticket sales', 'Tickets sold', 'Orders', 'Checked in']) {
    expect(screen.getByText(label, { selector: 'dt' })).toBeVisible()
  }
  expect(screen.getByText('87 / 142')).toBeVisible()
  expect(screen.getByText('110 sold · 40 remaining')).toBeVisible()
  expect(screen.getByText('100 Market Street, Roof, San Francisco, CA 94105')).toBeVisible()
  expect(screen.getByText(/Pacific Time/)).toBeVisible()
  expect(useOwnedEvent).toHaveBeenCalledWith('event', 'owner', { revalidateOnMount: true })
  expect(usePublicEvent).toHaveBeenCalledWith('event')
  expect(screen.getByRole('link', { name: 'Edit event' })).toHaveAttribute(
    'href',
    '/organizer/events/event/edit',
  )
  expect(screen.getByRole('link', { name: 'View event' })).toHaveAttribute(
    'href',
    '/events/event',
  )
  expect(screen.getByRole('link', { name: 'Check in guests' })).toHaveAttribute(
    'href',
    '/organizer/events/event/check-in',
  )
})
it('does not invent zero metrics on read failure', async () => {
  getEventMetrics.mockRejectedValue(new Error('private'))
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('Event metrics unavailable')
  expect(screen.queryByText('Gross ticket sales')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})
it('does not expose cached owner data before access is revalidated after mount', async () => {
  getEventMetrics.mockResolvedValue(data)
  useOwnedEvent.mockReturnValue({
    data: ownedEvent,
    isPending: false,
    isFetching: true,
    isFetchedAfterMount: false,
    isError: false,
    refetch: ownedRefetch,
  })
  show(data)
  expect(screen.getByRole('status')).toHaveTextContent('Loading event dashboard…')
  expect(screen.queryByText('Gross ticket sales')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'View event' })).not.toBeInTheDocument()
})
it('retains ended history and blocks the check-in action', async () => {
  getEventMetrics.mockResolvedValue({
    ...data,
    admissionEligible: false,
    event: { ...data.event, endsAt: '2020-01-01T00:00:00Z' },
  })
  useOwnedEvent.mockReturnValue({
    data: { ...ownedEvent, ends_at: '2020-01-01T00:00:00Z' },
    isPending: false, isFetchedAfterMount: true, isError: false, refetch: ownedRefetch,
  })
  usePublicEvent.mockReturnValue({ data: null, isPending: false, isFetching: false, isError: false, refetch: publicRefetch })
  show()
  expect(await screen.findByText('Ended')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Check-in closed' })).toBeDisabled()
  expect(screen.getByText(/New admissions are unavailable based on the current event status/i)).toBeVisible()
  expect(screen.getByRole('link', { name: 'View orders' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'View event' })).not.toBeInTheDocument()
})

it('does not label a published event awaiting current moderation as Live', async () => {
  getEventMetrics.mockResolvedValue(data)
  useOwnedEvent.mockReturnValue({
    data: { ...ownedEvent, moderation_status: 'under_review' },
    isPending: false, isFetchedAfterMount: true, isError: false, refetch: ownedRefetch,
  })
  usePublicEvent.mockReturnValue({ data: null, isPending: false, isFetching: false, isError: false, refetch: publicRefetch })
  show()
  expect(await screen.findByText('Under review')).toBeVisible()
  expect(screen.queryByText('Live')).not.toBeInTheDocument()
})

it('rejects cached public eligibility when the owned content revision is not current', async () => {
  getEventMetrics.mockResolvedValue(data)
  useOwnedEvent.mockReturnValue({
    data: { ...ownedEvent, moderated_revision: 3 },
    isPending: false, isFetchedAfterMount: true, isError: false, refetch: ownedRefetch,
  })
  usePublicEvent.mockReturnValue({ data: { id: 'event' }, isPending: false, isFetching: false, isError: false, refetch: publicRefetch })
  show()
  expect(await screen.findByText('Under review')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'View event' })).not.toBeInTheDocument()
})

it('withholds View event while canonical eligibility is refreshing or unavailable', async () => {
  getEventMetrics.mockResolvedValue(data)
  usePublicEvent.mockReturnValue({ data: { id: 'event' }, isPending: false, isFetching: true, isError: false, refetch: publicRefetch })
  const refreshing = show()
  expect(await screen.findByText('Checking public availability…')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'View event' })).not.toBeInTheDocument()
  refreshing.unmount()

  usePublicEvent.mockReturnValue({ data: undefined, isPending: false, isFetching: false, isError: true, refetch: publicRefetch })
  show()
  expect(await screen.findByText('Public availability could not be confirmed.')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'View event' })).not.toBeInTheDocument()
  expect(screen.queryByText(/private|backend|database/i)).not.toBeInTheDocument()
})

it('does not call paid metrics for a free event before mounting free management', async () => {
  getFreeRegistrationMetrics.mockResolvedValue({
    eventId: 'event', registrationCount: 1, confirmedRegistrations: 1,
    reservedAdmissions: 3, issued: 3, checkedIn: 1, capacity: 10, remaining: 7,
  })
  useOwnedEvent.mockReturnValue({
    data: { ...ownedEvent, admission_type: 'free', capacity: 10 },
    isPending: false,
    isFetchedAfterMount: true,
    isError: false,
    refetch: ownedRefetch,
  })

  show()

  await screen.findByRole('heading', { name: ownedEvent.title })
  expect(getEventMetrics).not.toHaveBeenCalled()
  expect(getFreeRegistrationMetrics).toHaveBeenCalledWith('event', expect.any(AbortSignal))
  expect(screen.getByText('Registrations', { selector: 'dt' })).toBeVisible()
  expect(screen.getByText('Reserved admissions', { selector: 'dt' })).toBeVisible()
  expect(screen.queryByText('Gross ticket sales')).not.toBeInTheDocument()
  expect(screen.queryByText('Orders', { selector: 'dt' })).not.toBeInTheDocument()
})
