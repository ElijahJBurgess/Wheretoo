import { act, render, screen, waitFor } from '@testing-library/react'
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
const tier = { id: '900a9142-9111-4f87-84d5-b8545a94c7fb', event_id: 'event-1', name: 'General admission', description: null, unit_amount_minor: 2_500, currency: 'usd', quantity_total: 80, sort_order: 1, status: 'draft', version: 1, created_at: '2026-08-25T12:00:00.000Z', updated_at: '2026-08-25T12:00:00.000Z' }
const vipTier = { ...tier, id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', name: 'VIP', sort_order: 2 }
function renderPage() {
  const router = createMemoryRouter([
    { path: '/organizer/events/:eventId/tickets', element: <OrganizerTicketTiersPage /> },
    { path: '/organizer/settings/payments', element: <p>payments destination</p> },
    { path: '/organizer/events/:eventId', element: <p>published destination</p> },
    { path: '/away', element: <p>away destination</p> },
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
    expect(saveMutate).toHaveBeenCalledOnce()
    expect(await screen.findByText('Ticket setup could not be updated. Try again.')).toBeInTheDocument()
    expect(price).toHaveValue('19.99')
    expect(saveMutate).toHaveBeenCalledWith([expect.objectContaining({ unitAmountMinor: 1_999 })])
    expect(screen.queryByText(/private table detail/)).not.toBeInTheDocument()
  })

  it('keeps a locked tier capacity, suppresses the raw failure, and allows a retry', async () => {
    const user = userEvent.setup()
    saveMutate
      .mockRejectedValueOnce({ message: 'TIER_LOCKED_AFTER_SALE', details: 'private order count' })
      .mockResolvedValueOnce([tier])
    renderPage()
    const capacity = screen.getByLabelText('Capacity')
    await user.clear(capacity)
    await user.type(capacity, '79')
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))
    expect(await screen.findByText('This tier already has ticket activity, so its capacity cannot be reduced.')).toBeInTheDocument()
    expect(capacity).toHaveValue(79)
    expect(screen.queryByText(/private order count|TIER_LOCKED_AFTER_SALE/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(2))
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

  it('omits a removed first slot while retaining a persisted later slot identity', async () => {
    const user = userEvent.setup()
    useOwnedTicketTiers.mockReturnValue({ data: [tier, vipTier], isPending: false, isError: false, refetch: vi.fn() })
    saveMutate.mockResolvedValue([vipTier])
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Remove tier General admission' }))
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))
    expect(saveMutate).toHaveBeenCalledWith([expect.objectContaining({ id: vipTier.id, sortOrder: 2 })])
  })

  it('allocates a removed slot only to a newly added tier', async () => {
    const user = userEvent.setup()
    useOwnedTicketTiers.mockReturnValue({ data: [tier, vipTier], isPending: false, isError: false, refetch: vi.fn() })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Remove tier General admission' }))
    await user.click(screen.getByRole('button', { name: 'Add ticket tier' }))
    const names = screen.getAllByLabelText('Name')
    const prices = screen.getAllByLabelText(/Price for/)
    const capacities = screen.getAllByLabelText('Capacity')
    await user.type(names[1], 'Late entry')
    await user.type(prices[1], '12.50')
    await user.clear(capacities[1])
    await user.type(capacities[1], '20')
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))
    expect(saveMutate).toHaveBeenCalledWith([
      expect.objectContaining({ id: vipTier.id, sortOrder: 2 }),
      expect.objectContaining({ name: 'Late entry', sortOrder: 1, unitAmountMinor: 1_250 }),
    ])
    expect(saveMutate.mock.calls[0]?.[0]?.[1]).not.toHaveProperty('id')
  })

  it('navigates only after the returned published-free conversion row retains its ID and first publication time', async () => {
    const user = userEvent.setup()
    const publishedAt = '2026-08-25T08:00:00.000Z'
    const publishedFree = { ...event, status: 'published', admission_type: 'free', published_at: publishedAt } as const
    const converted = { ...publishedFree, admission_type: 'paid', published_at: publishedAt }
    let resolveActivation!: (value: typeof converted) => void
    useOwnedEvent.mockReturnValue({ data: publishedFree, isPending: false, isError: false, refetch: vi.fn() })
    activateMutate.mockReturnValue(new Promise<typeof converted>((resolve) => { resolveActivation = resolve }))
    const { router } = renderPage()
    expect(screen.getByRole('heading', { name: 'Ticket tiers' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activate paid sales' }))
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets')
    await act(async () => { resolveActivation(converted) })
    await waitFor(() => expect(activateMutate).toHaveBeenCalledWith(converted.id))
    expect(router.state.location.pathname).toBe('/organizer/events/event-1')
    expect(converted).toMatchObject({ id: publishedFree.id, published_at: publishedAt })
  })

  it('normalizes an owned-tier RPC EVENT_NOT_FOUND response to the safe missing state', () => {
    useOwnedTicketTiers.mockReturnValue({ data: undefined, isPending: false, isError: true, error: { message: 'EVENT_NOT_FOUND' }, refetch: vi.fn() })
    renderPage()
    expect(screen.getByText('Event not found')).toBeInTheDocument()
    expect(screen.queryByText(/EVENT_NOT_FOUND|permission|owner/i)).not.toBeInTheDocument()
  })

  it.each([
    ['Name', '', 'Enter a ticket tier name.'],
    ['Capacity', '0', 'Enter a whole-number capacity for every ticket tier'],
  ])('validates %s before mutating and retains the local value', async (label, value, message) => {
    const user = userEvent.setup()
    renderPage()
    const field = screen.getByLabelText(label)
    await user.clear(field)
    if (value) await user.type(field, value)
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(field).toHaveValue(value === '0' ? 0 : value)
    expect(saveMutate).not.toHaveBeenCalled()
  })

  it('validates duplicate tier names before mutating and retains both values', async () => {
    const user = userEvent.setup()
    useOwnedTicketTiers.mockReturnValue({ data: [tier, vipTier], isPending: false, isError: false, refetch: vi.fn() })
    renderPage()
    const names = screen.getAllByLabelText('Name')
    await user.clear(names[1])
    await user.type(names[1], ' general admission ')
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))
    expect(await screen.findAllByText('Ticket tier names must be unique.')).toHaveLength(2)
    expect(names[0]).toHaveValue('General admission')
    expect(names[1]).toHaveValue(' general admission ')
    expect(saveMutate).not.toHaveBeenCalled()
  })

  it('keeps dirty tiers on Stay and only leaves after explicit Leave', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()
    await user.clear(screen.getByLabelText('Price for General admission'))
    await user.type(screen.getByLabelText('Price for General admission'), '19.99')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await act(async () => { await router.navigate('/away') })
    await user.click(screen.getByRole('button', { name: 'Stay' }))
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets')
    await act(async () => { await router.navigate('/away') })
    await user.click(screen.getByRole('button', { name: 'Leave' }))
    expect(await screen.findByText('away destination')).toBeInTheDocument()
  })

  it('does not navigate when a deferred activation resolves after organizer identity changes', async () => {
    const user = userEvent.setup()
    let resolveActivation!: (value: typeof event) => void
    activateMutate.mockReturnValue(new Promise<typeof event>((resolve) => { resolveActivation = resolve }))
    const { router } = renderPage()
    await user.click(screen.getByRole('button', { name: 'Activate paid sales' }))
    useSession.mockReturnValue({ status: 'authenticated', user: { id: 'organizer-2' } })
    await act(async () => { await router.navigate('/organizer/events/event-1/tickets?organizer=organizer-2') })
    await act(async () => { resolveActivation({ ...event, status: 'published', published_at: '2026-08-25T14:00:00.000Z' }) })
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets')
  })

  it('does not navigate when a deferred activation resolves after unmount', async () => {
    const user = userEvent.setup()
    let resolveActivation!: (value: typeof event) => void
    activateMutate.mockReturnValue(new Promise<typeof event>((resolve) => { resolveActivation = resolve }))
    const { router, unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: 'Activate paid sales' }))
    unmount()
    await act(async () => { resolveActivation({ ...event, status: 'published', published_at: '2026-08-25T14:00:00.000Z' }) })
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets')
  })
})
