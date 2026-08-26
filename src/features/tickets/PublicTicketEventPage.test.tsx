import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicTicketingEvent } from './ticket.types'

const { usePublicTicketingEvent } = vi.hoisted(() => ({ usePublicTicketingEvent: vi.fn() }))
vi.mock('./publicTicketing.queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./publicTicketing.queries')>()),
  usePublicTicketingEvent,
}))

import { PublicTicketEventPage } from './PublicTicketEventPage'

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
    usePublicTicketingEvent.mockReturnValue({ data: publicEvent, isPending: false, isError: false, refetch: vi.fn() })
  })

  it('presents persisted published event facts and price without organizer or financial internals', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Night Market' })).toBeInTheDocument()
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

  it('keeps a selection only while the exact selected tier remains available', async () => {
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
  })

  it.each([
    ['loading', { data: undefined, isPending: true, isError: false }, 'Loading event'],
    ['not found', { data: null, isPending: false, isError: false }, 'Event not found'],
    ['unavailable', { data: undefined, isPending: false, isError: true }, 'Event could not load'],
  ])('renders the safe %s state', (_name, query, title) => {
    usePublicTicketingEvent.mockReturnValue({ ...query, refetch: vi.fn() })
    renderPage()
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.queryByText(/PGRST|postgres|private/i)).not.toBeInTheDocument()
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
