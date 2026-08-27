import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicTicketingEvent } from './ticket.types'

const { startTransition } = vi.hoisted(() => ({ startTransition: vi.fn((callback: () => void) => callback()) }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  startTransition,
}))

const { usePublicTicketingEvent } = vi.hoisted(() => ({ usePublicTicketingEvent: vi.fn() }))
vi.mock('./publicTicketing.queries', () => ({ usePublicTicketingEvent }))

const { mutateAsync, resetReport, useReportPublicEvent } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  resetReport: vi.fn(),
  useReportPublicEvent: vi.fn(),
}))
vi.mock('../moderation/moderation.queries', () => ({ useReportPublicEvent }))

import { PublicTicketEventPage } from './PublicTicketEventPage'
import { PublicTicketingError } from './publicTicketing.errors'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const tierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const publicEvent: PublicTicketingEvent = {
  event: {
    id: eventId,
    title: 'Night Market',
    description: 'Food, music, and neighborhood makers.',
    category: 'community',
    starts_at: '2026-09-01T02:00:00+00:00',
    ends_at: '2026-09-01T05:00:00+00:00',
    timezone: 'America/Los_Angeles',
    venue_name: 'Civic Center Plaza',
    address_line1: '1 Dr Carlton B Goodlett Place',
    address_line2: null,
    city: 'San Francisco',
    region: 'CA',
    postal_code: '94102',
    country_code: 'US',
    latitude: 37.7793,
    longitude: -122.4193,
    artwork_path: null,
    animation_preset: 'generic',
    admission_type: 'paid',
    minimum_age: 'all_ages',
    advisories: [],
    organizer: { id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', display_name: 'Bay City Arts' },
  },
  tiers: [{
    id: tierId,
    name: 'General admission',
    description: 'Entry to the market.',
    unit_amount_minor: 2_500,
    currency: 'usd',
    availability_status: 'available',
  }, {
    id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe',
    name: 'VIP',
    description: 'Early access and a reserved lounge.',
    unit_amount_minor: 7_500,
    currency: 'usd',
    availability_status: 'sold_out',
  }],
}

function renderPage() {
  const router = createMemoryRouter([
    { path: '/events/:eventId', element: <PublicTicketEventPage /> },
    { path: '/events/:eventId/checkout', element: <p>Checkout destination</p> },
  ], { initialEntries: [`/events/${eventId}`] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('PublicTicketEventPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startTransition.mockImplementation((callback: () => void) => callback())
    usePublicTicketingEvent.mockReturnValue({ data: publicEvent, isPending: false, isError: false, refetch: vi.fn() })
    useReportPublicEvent.mockReturnValue({ isPending: false, mutateAsync, reset: resetReport })
    mutateAsync.mockResolvedValue({ status: 'received' })
  })

  it('presents persisted published event facts and price without organizer or financial internals', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Night Market' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Hosted by Bay City Arts')).toBeInTheDocument()
    expect(screen.getByText('$25.00')).toBeInTheDocument()
    expect(screen.getByText('Civic Center Plaza')).toBeInTheDocument()
    expect(screen.queryByText(/6b849|platform fee|destination|stripe|reserved_quantity/i)).not.toBeInTheDocument()
  })

  it('requires exactly one available tier and navigates with its exact ID', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()
    const checkout = screen.getByRole('button', { name: 'Continue to checkout' })

    expect(checkout).toBeDisabled()
    expect(screen.getByRole('radio', { name: /General admission/i })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /VIP/i })).toBeDisabled()
    expect(screen.getByText('Sold out')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /General admission/i }))
    await user.click(checkout)

    expect(router.state.location.pathname).toBe(`/events/${eventId}/checkout`)
    expect(router.state.location.search).toBe(`?tier=${tierId}`)
  })

  it('clears a selection after its exact tier becomes unavailable, even if it later returns', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()
    await user.click(screen.getByRole('radio', { name: /General admission/i }))
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled()

    usePublicTicketingEvent.mockReturnValue({
      data: { ...publicEvent, tiers: [{ ...publicEvent.tiers[0], availability_status: 'sold_out' }] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    await act(async () => { await router.navigate(`/events/${eventId}?refresh=availability`) })

    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeDisabled()

    usePublicTicketingEvent.mockReturnValue({
      data: publicEvent,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    await act(async () => { await router.navigate(`/events/${eventId}?refresh=available-again`) })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeDisabled())
    expect(screen.getByRole('radio', { name: /General admission/i })).not.toBeChecked()
  })

  it('preserves a selected available tier when unrelated tiers are added, reordered, or change availability', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()
    await user.click(screen.getByRole('radio', { name: /General admission/i }))

    usePublicTicketingEvent.mockReturnValue({
      data: {
        ...publicEvent,
        tiers: [{
          ...publicEvent.tiers[1],
          availability_status: 'available',
        }, publicEvent.tiers[0], {
          id: '10823f25-2860-4b63-968c-749e8047561d',
          name: 'Late entry',
          description: null,
          unit_amount_minor: 1_500,
          currency: 'usd',
          availability_status: 'sold_out',
        }],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    await act(async () => { await router.navigate(`/events/${eventId}?refresh=unrelated-tier-update`) })

    expect(screen.getByRole('radio', { name: /General admission/i })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled()
  })

  it('clears selected-tier availability urgently before a rapid sold-out to available update', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()
    await user.click(screen.getByRole('radio', { name: /General admission/i }))
    startTransition.mockImplementation(() => undefined)

    usePublicTicketingEvent.mockReturnValue({
      data: { ...publicEvent, tiers: [{ ...publicEvent.tiers[0], availability_status: 'sold_out' }] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    await act(async () => { await router.navigate(`/events/${eventId}?refresh=rapid-sold-out`) })

    usePublicTicketingEvent.mockReturnValue({ data: publicEvent, isPending: false, isError: false, refetch: vi.fn() })
    await act(async () => { await router.navigate(`/events/${eventId}?refresh=rapid-available`) })

    expect(screen.getByRole('radio', { name: /General admission/i })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeDisabled()
  })

  it('uses one local Los Angeles date when the event begins and ends on that date', () => {
    renderPage()

    expect(screen.getByText('Monday, August 31, 2026')).toBeInTheDocument()
    expect(screen.getByText('7:00 PM–10:00 PM PT')).toBeInTheDocument()
  })

  it('uses a local Los Angeles date range when an event crosses midnight', () => {
    usePublicTicketingEvent.mockReturnValue({
      data: {
        ...publicEvent,
        event: {
          ...publicEvent.event,
          starts_at: '2026-09-01T06:30:00+00:00',
          ends_at: '2026-09-01T08:30:00+00:00',
        },
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getByText('Monday, August 31, 2026 – Tuesday, September 1, 2026')).toBeInTheDocument()
    expect(screen.getByText('11:30 PM–1:30 AM PT')).toBeInTheDocument()
  })

  it.each([
    ['loading', { data: undefined, isPending: true, isError: false }, 'Loading event'],
    ['not found', { data: null, isPending: false, isError: false }, 'Event not found'],
    ['unavailable', { data: undefined, isPending: false, isError: true }, 'Event could not load'],
  ])('renders the safe %s state', (_name, query, title) => {
    usePublicTicketingEvent.mockReturnValue({ ...query, refetch: vi.fn() })
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.queryByText(/PGRST|postgres|private/i)).not.toBeInTheDocument()
  })

  it('offers reporting only while the canonical public projection returns the event', async () => {
    const { router } = renderPage()
    expect(screen.getByRole('button', { name: 'Report this event' })).toBeInTheDocument()

    usePublicTicketingEvent.mockReturnValue({ data: null, isPending: false, isError: false, refetch: vi.fn() })
    await act(async () => { await router.navigate(`/events/${eventId}?refresh=removed`) })

    expect(screen.queryByRole('button', { name: 'Report this event' })).not.toBeInTheDocument()
  })

  it('keeps last-known details with retry status on a transient refresh failure', async () => {
    const refetch = vi.fn()
    usePublicTicketingEvent.mockReturnValue({
      data: publicEvent,
      isPending: false,
      isError: true,
      error: new PublicTicketingError('RETRYABLE'),
      refetch,
    })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('heading', { name: 'Night Market' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Showing the last event details we received')
    expect(screen.queryByRole('heading', { name: 'Event could not load' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report this event' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('fails closed instead of displaying cached content after an invalid public projection', () => {
    usePublicTicketingEvent.mockReturnValue({
      data: publicEvent,
      isPending: false,
      isError: true,
      error: new PublicTicketingError('INVALID_RESPONSE'),
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Event could not load' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Night Market' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report this event' })).not.toBeInTheDocument()
  })

  it('labels an event with no purchasable tiers as unavailable instead of enabling checkout', () => {
    usePublicTicketingEvent.mockReturnValue({
      data: { ...publicEvent, tiers: [{ ...publicEvent.tiers[0], availability_status: 'sold_out' }] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getByText('Tickets are currently unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeDisabled()
  })
})
