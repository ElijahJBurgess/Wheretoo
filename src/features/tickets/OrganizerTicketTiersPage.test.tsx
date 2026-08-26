import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from '../events/event.types'

const { activateMutate, saveMutate, useActivatePaidSales, useConnectStatus, useOwnedEvent, useOwnedTicketTiers, useSaveTicketTiers, useSession } = vi.hoisted(() => ({
  activateMutate: vi.fn(), saveMutate: vi.fn(), useActivatePaidSales: vi.fn(), useConnectStatus: vi.fn(), useOwnedEvent: vi.fn(), useOwnedTicketTiers: vi.fn(), useSaveTicketTiers: vi.fn(), useSession: vi.fn(),
}))
vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('../events/event.queries', () => ({ useOwnedEvent }))
vi.mock('../payments/payment.queries', () => ({ useConnectStatus }))
vi.mock('./ticket.queries', () => ({ useActivatePaidSales, useOwnedTicketTiers, useSaveTicketTiers }))
import { OrganizerTicketTiersPage } from './OrganizerTicketTiersPage'

const event: EventRow = {
  id: 'event-1', organizer_id: 'organizer-1', status: 'draft', moderation_status: 'clear', title: 'Night Market', description: 'Food, music, and neighborhood makers.', category: 'community', starts_at: '2026-12-02T02:30:00.000Z', ends_at: '2026-12-02T04:00:00.000Z', timezone: 'America/Los_Angeles', venue_name: 'Civic Center Plaza', address_line1: '1 Market St', address_line2: null, city: 'San Francisco', region: 'CA', postal_code: '94105', country_code: 'US', mapbox_feature_id: 'address.saved', latitude: 37.79, longitude: -122.4, location: 'computed geography', admission_type: 'paid', capacity: 100, artwork_path: null, animation_preset: 'generic', published_at: null, created_at: '2026-08-25T12:00:00.000Z', updated_at: '2026-08-25T12:00:00.000Z',
}
const tier = { id: 'tier-1', event_id: 'event-1', name: 'General admission', description: null, unit_amount_minor: 2_500, currency: 'usd', quantity_total: 80, sort_order: 1, status: 'draft', version: 1, created_at: '2026-08-25T12:00:00.000Z', updated_at: '2026-08-25T12:00:00.000Z' }
function renderPage() {
  const router = createMemoryRouter([
    { path: '/organizer/events/:eventId/tickets', element: <OrganizerTicketTiersPage /> },
    { path: '/organizer/settings/payments', element: <p>payments destination</p> },
    { path: '/organizer/events/:eventId', element: <p>published destination</p> },
  ], { initialEntries: ['/organizer/events/event-1/tickets'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('OrganizerTicketTiersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', user: { id: 'organizer-1' } })
    useOwnedEvent.mockReturnValue({ data: event, isPending: false, isError: false, refetch: vi.fn() })
    useOwnedTicketTiers.mockReturnValue({ data: [tier], isPending: false, isError: false, refetch: vi.fn() })
    useSaveTicketTiers.mockReturnValue({ mutateAsync: saveMutate, isPending: false })
    useActivatePaidSales.mockReturnValue({ mutateAsync: activateMutate, isPending: false })
    useConnectStatus.mockReturnValue({ data: { status: 'ready', requirements_currently_due_count: 0, requirements_past_due_count: 0, last_status_code: null, last_synced_at: '2026-08-25T12:00:00.000Z' }, isPending: false })
  })

  it('keeps local tier values on a safe save failure and converts dollars exactly to minor units', async () => {
    const user = userEvent.setup()
    saveMutate.mockRejectedValueOnce(new Error('private table detail'))
    renderPage()
    const price = screen.getByLabelText('Price for General admission')
    await user.clear(price)
    await user.type(price, '19.99')
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))
    expect(await screen.findByText('Ticket setup could not be updated. Try again.')).toBeInTheDocument()
    expect(price).toHaveValue('19.99')
    expect(saveMutate).toHaveBeenCalledWith([expect.objectContaining({ unitAmountMinor: 1_999 })])
    expect(screen.queryByText(/private table detail/)).not.toBeInTheDocument()
  })

  it('guides incomplete Connect setup to payments and never renders a fee editor', () => {
    useConnectStatus.mockReturnValue({ data: { status: 'action_required', requirements_currently_due_count: 1, requirements_past_due_count: 0, last_status_code: 'requirements_due', last_synced_at: '2026-08-25T12:00:00.000Z' }, isPending: false })
    renderPage()
    expect(screen.getByRole('link', { name: 'Finish payment setup' })).toHaveAttribute('href', '/organizer/settings/payments')
    expect(screen.getByRole('button', { name: 'Activate paid sales' })).toBeDisabled()
    expect(screen.queryByText(/platform fee|fee percentage|payout/i)).not.toBeInTheDocument()
  })

  it('activates an owned draft event and keeps the setup route owner-aware', async () => {
    const user = userEvent.setup()
    activateMutate.mockResolvedValue({ ...event, status: 'published', published_at: '2026-08-25T14:00:00.000Z' })
    const { router } = renderPage()
    await user.click(screen.getByRole('button', { name: 'Activate paid sales' }))
    await waitFor(() => expect(activateMutate).toHaveBeenCalledWith('event-1'))
    expect(router.state.location.pathname).toBe('/organizer/events/event-1')
    expect(useOwnedTicketTiers).toHaveBeenCalledWith('organizer-1', 'event-1')
  })

  it('uses the same owner-safe not-found state for a missing or foreign event', () => {
    useOwnedEvent.mockReturnValue({ data: null, isPending: false, isError: false, refetch: vi.fn() })
    renderPage()
    expect(screen.getByText('Event not found')).toBeInTheDocument()
    expect(screen.queryByText(/another organizer|permission|owner/i)).not.toBeInTheDocument()
  })
})
