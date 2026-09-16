import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from '../events/event.types'

const { activateMutate, saveMutate, saveRevisionMutate, useActivatePaidSales, useConnectStatus, useOwnedEvent, useOwnedTicketTiers, useSaveEventRevision, useSaveTicketTiers, useSession } = vi.hoisted(() => ({
  activateMutate: vi.fn(), saveMutate: vi.fn(), saveRevisionMutate: vi.fn(), useActivatePaidSales: vi.fn(), useConnectStatus: vi.fn(), useOwnedEvent: vi.fn(), useOwnedTicketTiers: vi.fn(), useSaveEventRevision: vi.fn(), useSaveTicketTiers: vi.fn(), useSession: vi.fn(),
}))
vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('../events/event.queries', () => ({ useOwnedEvent, useSaveEventRevision }))
vi.mock('../payments/payment.queries', () => ({ useConnectStatus }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
vi.mock('./ticket.queries', () => ({ useActivatePaidSales, useOwnedTicketTiers, useSaveTicketTiers }))
import { OrganizerTicketTiersPage } from './OrganizerTicketTiersPage'

const event: EventRow = {
  id: 'event-1', organizer_id: 'organizer-1', status: 'draft', moderation_status: 'clear', content_revision: 1, moderated_revision: null, moderation_version: 0, moderation_updated_at: null, public_history_status: 'never_public', first_publicly_eligible_at: null, public_eligibility_version: 0, publicly_authorized_revision: null, publicly_authorized_action_id: null, title: 'Night Market', description: 'Food, music, and neighborhood makers.', category: 'community', starts_at: '2026-12-02T02:30:00.000Z', ends_at: '2026-12-02T04:00:00.000Z', timezone: 'America/Los_Angeles', venue_name: 'Civic Center Plaza', address_line1: '1 Market St', address_line2: null, city: 'San Francisco', region: 'CA', postal_code: '94105', country_code: 'US', mapbox_feature_id: 'address.saved', latitude: 37.79, longitude: -122.4, location: 'computed geography', admission_type: 'paid', capacity: 100, artwork_path: null, animation_preset: 'generic', published_at: null, created_at: '2026-08-25T12:00:00.000Z', updated_at: '2026-08-25T12:00:00.000Z',
}
const tier = { id: '900a9142-9111-4f87-84d5-b8545a94c7fb', event_id: 'event-1', name: 'General admission', description: null, unit_amount_minor: 2_500, currency: 'usd', quantity_total: 80, sort_order: 1, status: 'draft', version: 1, created_at: '2026-08-25T12:00:00.000Z', updated_at: '2026-08-25T12:00:00.000Z' }
const vipTier = { ...tier, id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', name: 'VIP', sort_order: 2 }
function renderPage() {
  const router = createMemoryRouter([
    { path: '/organizer/events/:eventId/tickets', element: <OrganizerTicketTiersPage /> },
    { path: '/organizer/settings/payments', element: <p>payments destination</p> },
    { path: '/organizer/events/:eventId', element: <p>published destination</p> },
    { path: '/organizer/events/:eventId/edit', element: <p>event requirements destination</p> },
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
    useSaveEventRevision.mockReturnValue({ mutateAsync: saveRevisionMutate, isPending: false })
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

  it('guides an incomplete published conversion to payments and never renders a fee editor', () => {
    useOwnedEvent.mockReturnValue({ data: { ...event, status: 'published', admission_type: 'free' }, isPending: false, isError: false, refetch: vi.fn() })
    useConnectStatus.mockReturnValue({ data: { status: 'action_required', requirements_currently_due_count: 1, requirements_past_due_count: 0, last_status_code: 'requirements_due', last_synced_at: '2026-08-25T12:00:00.000Z' }, isPending: false })
    renderPage()
    expect(useConnectStatus).toHaveBeenCalledWith('organizer-1')
    expect(screen.getByRole('link', { name: 'Finish payment setup' })).toHaveAttribute('href', '/organizer/settings/payments?eventId=event-1')
    expect(screen.getByRole('button', { name: 'Save and continue to event requirements' })).toBeDisabled()
    expect(screen.queryByText(/platform fee|fee percentage|payout/i)).not.toBeInTheDocument()
  })

  it('frames draft tier setup and continues composition while Stripe is incomplete', async () => {
    const user = userEvent.setup()
    useConnectStatus.mockReturnValue({ data: { status: 'not_started' }, isPending: false })
    saveMutate.mockResolvedValue([tier])
    const { router } = renderPage()

    expect(screen.getByRole('region', { name: 'Create Event' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to my events' })).toHaveAttribute('href', '/organizer/events/event-1/edit?step=ticket-type')
    expect(useConnectStatus).toHaveBeenCalledWith('')
    expect(screen.queryByRole('link', { name: 'Finish payment setup' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(saveMutate).toHaveBeenCalledOnce()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit')
    expect(router.state.location.search).toBe('?step=details')
  })

  it('routes an owned paid draft through requirements and publish without direct activation', async () => {
    const user = userEvent.setup()
    saveMutate.mockResolvedValue([tier])
    const { router } = renderPage()
    await user.click(screen.getByRole('button', { name: /^(Continue|Save and continue to event requirements)$/ }))
    await waitFor(() => expect(saveMutate).toHaveBeenCalledOnce())
    expect(activateMutate).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit')
    expect(router.state.location.search).toBe('?step=details')
    expect(useOwnedTicketTiers).toHaveBeenCalledWith('organizer-1', 'event-1')
  })

  it('uses the same owner-safe not-found state for a missing or foreign event', () => {
    useOwnedEvent.mockReturnValue({ data: null, isPending: false, isError: false, refetch: vi.fn() })
    renderPage()
    expect(screen.getByText('Event unavailable')).toBeInTheDocument()
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

  it('retains both persisted tier IDs when two saved tiers are edited', async () => {
    const user = userEvent.setup()
    useOwnedTicketTiers.mockReturnValue({ data: [tier, vipTier], isPending: false, isError: false, refetch: vi.fn() })
    saveMutate.mockResolvedValue([tier, vipTier])
    renderPage()

    const names = screen.getAllByLabelText('Name')
    await user.type(names[0], ' updated')
    await user.type(names[1], ' updated')
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))

    expect(saveMutate).toHaveBeenCalledWith([
      expect.objectContaining({ id: tier.id, name: 'General admission updated', sortOrder: 1 }),
      expect.objectContaining({ id: vipTier.id, name: 'VIP updated', sortOrder: 2 }),
    ])
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

  it('routes a published free-to-paid conversion through tier save, owned revision, and event requirements', async () => {
    const user = userEvent.setup()
    const publishedFree = {
      ...event,
      status: 'published',
      moderation_status: 'clear',
      moderated_revision: 1,
      admission_type: 'free',
      published_at: '2026-08-25T08:00:00.000Z',
    } as EventRow
    const converted = { ...publishedFree, admission_type: 'paid', content_revision: 2 }
    useOwnedEvent.mockReturnValue({ data: publishedFree, isPending: false, isError: false, refetch: vi.fn() })
    saveMutate.mockResolvedValue([tier])
    saveRevisionMutate.mockResolvedValue(converted)
    const { router } = renderPage()

    expect(useConnectStatus).toHaveBeenCalledWith('organizer-1')
    await user.click(screen.getByRole('button', { name: /^(Continue|Save and continue to event requirements)$/ }))

    expect(saveMutate).toHaveBeenCalledOnce()
    expect(saveRevisionMutate).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.id,
      organizerId: event.organizer_id,
      values: expect.objectContaining({ admissionType: 'paid' }),
    }))
    expect(saveMutate.mock.invocationCallOrder[0]).toBeLessThan(saveRevisionMutate.mock.invocationCallOrder[0]!)
    expect(activateMutate).not.toHaveBeenCalled()
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
    expect(router.state.location.search).toBe('?step=requirements')
  })

  it('routes a paid public-tier text edit back through current agreement and publish without reactivating sales', async () => {
    const user = userEvent.setup()
    const publishedPaid = {
      ...event,
      status: 'published',
      moderation_status: 'clear',
      moderated_revision: 1,
      admission_type: 'paid',
      published_at: '2026-08-25T08:00:00.000Z',
    } as EventRow
    const activeTier = { ...tier, status: 'active' }
    useOwnedEvent.mockReturnValue({ data: publishedPaid, isPending: false, isError: false, refetch: vi.fn() })
    useOwnedTicketTiers.mockReturnValue({ data: [activeTier], isPending: false, isError: false, refetch: vi.fn() })
    saveMutate.mockResolvedValue([{ ...activeTier, name: 'Evening admission' }])
    const { router } = renderPage()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Evening admission')
    await user.click(screen.getByRole('button', { name: /^(Continue|Save and continue to event requirements)$/ }))

    expect(saveMutate).toHaveBeenCalledWith([expect.objectContaining({ name: 'Evening admission' })])
    expect(saveRevisionMutate).not.toHaveBeenCalled()
    expect(activateMutate).not.toHaveBeenCalled()
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
    expect(router.state.location.search).toBe('?step=requirements')
  })

  it('reauthorizes already-active paid tiers without querying or requiring Connect readiness', async () => {
    const user = userEvent.setup()
    const publishedPaid = {
      ...event,
      status: 'published',
      moderation_status: 'clear',
      moderated_revision: 1,
      admission_type: 'paid',
      published_at: '2026-08-25T08:00:00.000Z',
    } as EventRow
    const activeTier = { ...tier, status: 'active' }
    useOwnedEvent.mockReturnValue({ data: publishedPaid, isPending: false, isError: false, refetch: vi.fn() })
    useOwnedTicketTiers.mockReturnValue({ data: [activeTier], isPending: false, isError: false, refetch: vi.fn() })
    useConnectStatus.mockReturnValue({ data: { status: 'action_required' }, isPending: false })
    saveMutate.mockResolvedValue([{ ...activeTier, name: 'Current admission' }])
    const { router } = renderPage()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Current admission')
    const continueButton = screen.getByRole('button', { name: 'Save and continue to event requirements' })
    expect(continueButton).toBeEnabled()
    expect(useConnectStatus).toHaveBeenCalledWith('')
    expect(screen.queryByRole('link', { name: 'Finish payment setup' })).not.toBeInTheDocument()
    await user.click(continueButton)

    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
  })

  it.each([
    ['past start', new Date(Date.now() - 15 * 60 * 1_000).toISOString()],
    ['missing start', null],
    ['malformed start', 'not-a-date'],
  ] as const)('blocks every tier-persistence path for a published free event with a %s', async (_case, startsAt) => {
    const user = userEvent.setup()
    const activeFree = {
      ...event,
      status: 'published',
      admission_type: 'free',
      starts_at: startsAt,
      ends_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      published_at: '2026-08-25T08:00:00.000Z',
    } as EventRow
    useOwnedEvent.mockReturnValue({ data: activeFree, isPending: false, isError: false, refetch: vi.fn() })

    const { router } = renderPage()

    expect(screen.getByText(/Paid conversion must be completed before the event starts/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save ticket tiers' }))
    expect(await screen.findByText('Paid conversion must be completed before the event starts.', { selector: '[role="alert"] *' })).toBeInTheDocument()
    expect(saveMutate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /^(Continue|Save and continue to event requirements)$/ }))
    expect(await screen.findByText('Paid conversion must be completed before the event starts.', { selector: '[role="alert"] *' })).toBeInTheDocument()
    expect(useConnectStatus).toHaveBeenCalledWith('')
    expect(saveMutate).not.toHaveBeenCalled()
    expect(saveRevisionMutate).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets')
  })

  it('normalizes an owned-tier RPC EVENT_NOT_FOUND response to the safe missing state', () => {
    useOwnedTicketTiers.mockReturnValue({ data: undefined, isPending: false, isError: true, error: { message: 'EVENT_NOT_FOUND' }, refetch: vi.fn() })
    renderPage()
    expect(screen.getByText('Event unavailable')).toBeInTheDocument()
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

  it('does not navigate when a deferred continue save resolves after organizer identity changes', async () => {
    const user = userEvent.setup()
    let resolveSave!: (value: (typeof tier)[]) => void
    saveMutate.mockReturnValue(new Promise<(typeof tier)[]>((resolve) => { resolveSave = resolve }))
    const { router } = renderPage()
    await user.click(screen.getByRole('button', { name: /^(Continue|Save and continue to event requirements)$/ }))
    useSession.mockReturnValue({ status: 'authenticated', user: { id: 'organizer-2' } })
    await act(async () => { await router.navigate('/organizer/events/event-1/tickets?organizer=organizer-2') })
    await act(async () => { resolveSave([tier]) })
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets')
  })

  it('does not navigate when a deferred continue save resolves after unmount', async () => {
    const user = userEvent.setup()
    let resolveSave!: (value: (typeof tier)[]) => void
    saveMutate.mockReturnValue(new Promise<(typeof tier)[]>((resolve) => { resolveSave = resolve }))
    const { router, unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: /^(Continue|Save and continue to event requirements)$/ }))
    unmount()
    await act(async () => { resolveSave([tier]) })
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets')
  })
})
