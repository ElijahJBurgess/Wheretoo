vi.mock('../event-images/publicEventImages', () => ({ usePublicEventImages: () => ({ data: [{position: 2, url: 'https://example.invalid/secondary.png'}, {position: 1, url: 'https://example.invalid/flyer.png'}] }) }))
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicTicketingEvent } from '../tickets/ticket.types'

const { cancelCheckout, createCheckout, invoke, refetch, useCheckoutPublicEvent } = vi.hoisted(() => ({
  cancelCheckout: vi.fn(),
  createCheckout: vi.fn(),
  invoke: vi.fn(),
  refetch: vi.fn(),
  useCheckoutPublicEvent: vi.fn(),
}))
const { clearCheckoutAttemptForConfirmation, getOrCreateCheckoutAttempt } = vi.hoisted(() => ({
  clearCheckoutAttemptForConfirmation: vi.fn(),
  getOrCreateCheckoutAttempt: vi.fn(),
}))

vi.mock('./checkout.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./checkout.api')>()),
  cancelCheckout,
  createCheckout,
}))
// Web Crypto ArrayBuffer realms differ in jsdom; real digest validation has a Node API suite.
vi.mock('../orders/order.api', async (original) => ({
  ...(await original<typeof import('../orders/order.api')>()),
  fingerprintConfirmationToken: async (token: string) => `fingerprint-${token.slice(0, 8)}`,
}))
vi.mock('../ticket-delivery/delivery.public-api', () => ({ publicTicketDeliveryApi: { status: () => new Promise(() => {}) } }))
vi.mock('./checkout.queries', () => ({ useCheckoutPublicEvent }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { functions: { invoke } } }))
vi.mock('./checkout.attempt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./checkout.attempt')>()),
  clearCheckoutAttemptForConfirmation,
  getOrCreateCheckoutAttempt,
}))

import { CheckoutPage } from './CheckoutPage'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const tierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const otherTierId = '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe'
const nextEventId = '10823f25-2860-4b63-968c-749e8047561d'
const nextTierId = '18a23f25-2860-4b63-968c-749e8047561d'
const confirmationBearer = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const attemptStorageKey = `whereto.checkout-attempt.v1:${eventId}`

const originalOrder = {
      event: { title: 'Night Market', startsAt: '2026-09-01T02:00:00Z', endsAt: '2026-09-01T05:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Original venue' },
      items: [{ tierName: 'Original ticket', quantity: 3, unitAmountMinor: 4000, subtotalMinor: 12000, currency: 'usd' }],
      orderNumber: 'WT-ORIGINAL', status: 'processing', quantity: 3, currency: 'usd', subtotalMinor: 12000, totalMinor: 12000, taxAmountMinor: 0,
    }

async function useRealRetryState() {
  const attempts = await vi.importActual<typeof import('./checkout.attempt')>('./checkout.attempt')
  const api = await vi.importActual<typeof import('./checkout.api')>('./checkout.api')
  getOrCreateCheckoutAttempt.mockImplementation(attempts.getOrCreateCheckoutAttempt)
  clearCheckoutAttemptForConfirmation.mockImplementation(attempts.clearCheckoutAttemptForConfirmation)
  cancelCheckout.mockImplementation(api.cancelCheckout)
  const submission = {
    eventId, buyerName: 'Avery Stone', buyerEmail: 'avery@example.com',
    items: [{ tierId, quantity: 2 }, { tierId: otherTierId, quantity: 1 }],
  }
  return { attempts, submission, first: await attempts.getOrCreateCheckoutAttempt(submission) }
}

async function submitBuyer() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
  await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
  await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))
}

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
    organizer: { id: otherTierId, display_name: 'Bay City Arts' },
  },
  tiers: [{
    id: tierId,
    name: 'General admission',
    description: 'Entry to the market.',
    unit_amount_minor: 2_500,
    currency: 'usd',
    availability_status: 'available',
  }, {
    id: otherTierId,
    name: 'VIP',
    description: 'Early entry and lounge access.',
    unit_amount_minor: 7_500,
    currency: 'usd',
    availability_status: 'available',
  }],
}

function renderCheckout(
  initialEntry = `/events/${eventId}/checkout?item=${tierId}%3A2&item=${otherTierId}%3A1`,
  assignCheckout?: (url: string) => void,
  strict = false,
) {
  const router = createMemoryRouter([
    { path: '/events/:eventId/checkout', element: <CheckoutPage assignCheckout={assignCheckout} /> },
    { path: '/events/:eventId/tickets', element: <p>Selection destination</p> },
    { path: '/events/:eventId', element: <p>Public event destination</p> },
  ], { initialEntries: [initialEntry] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
  return {
    router,
    ...render(strict ? <StrictMode>{app}</StrictMode> : app),
  }
}

describe('CheckoutPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    sessionStorage.clear()
    createCheckout.mockReset()
    useCheckoutPublicEvent.mockReturnValue({ data: publicEvent, isPending: false, isError: false, refetch })
    cancelCheckout.mockResolvedValue(undefined)
    const attempts = await vi.importActual<typeof import('./checkout.attempt')>('./checkout.attempt')
    getOrCreateCheckoutAttempt.mockImplementation(attempts.getOrCreateCheckoutAttempt)
    clearCheckoutAttemptForConfirmation.mockImplementation(attempts.clearCheckoutAttemptForConfirmation)
    invoke.mockResolvedValue({ data: null, error: new Error('unknown') })
  })

  it('reviews multiple canonical cart lines and derives one public-data total', () => {
    renderCheckout()
    expect(screen.getByRole('presentation')).toHaveAttribute('src', 'https://example.invalid/flyer.png')

    expect(screen.getByRole('heading', { name: 'Review your tickets' })).toBeInTheDocument()
    expect(screen.getByText('Night Market')).toBeInTheDocument()
    expect(screen.getByText('General admission')).toBeInTheDocument()
    expect(screen.getByText('2 tickets')).toBeInTheDocument()
    expect(screen.getByText('VIP')).toBeInTheDocument()
    expect(screen.getByText('1 ticket')).toBeInTheDocument()
    expect(screen.getByText('$125.00')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByText(/platform fee|destination|stripe account|order id|request id|confirmation bearer/i)).not.toBeInTheDocument()
  })

  it('rejects a malformed checkout route before a cancel return can mutate or touch the saved attempt', async () => {
    sessionStorage.setItem(attemptStorageKey, 'preserve-this-attempt')
    const assign = vi.fn()
    renderCheckout(`/events/invalid/checkout?cancel=${confirmationBearer}`, assign)
    expect(await screen.findByRole('heading', { name: 'Checkout unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Return to event' })).not.toBeInTheDocument()
    expect(cancelCheckout).not.toHaveBeenCalled()
    expect(createCheckout).not.toHaveBeenCalled()
    expect(getOrCreateCheckoutAttempt).not.toHaveBeenCalled()
    expect(clearCheckoutAttemptForConfirmation).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(attemptStorageKey)).toBe('preserve-this-attempt')
    expect(assign).not.toHaveBeenCalled()
  })

  it('treats a missing checkout identifier as unavailable without reading or mutating checkout', () => {
    const router = createMemoryRouter([{ path: '/checkout', element: <CheckoutPage /> }], { initialEntries: ['/checkout'] })
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('heading', { name: 'Checkout unavailable' })).toBeInTheDocument()
    expect(useCheckoutPublicEvent).not.toHaveBeenCalled()
    expect(cancelCheckout).not.toHaveBeenCalled()
  })

  it('gives the standalone loading state one semantic heading and a live loading role', () => {
    useCheckoutPublicEvent.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
    renderCheckout()

    expect(screen.getByRole('heading', { level: 1, name: 'Loading checkout' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('gives the standalone load error one semantic heading, alert role, and return control', () => {
    useCheckoutPublicEvent.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    renderCheckout()

    expect(screen.getByRole('heading', { level: 1, name: 'Checkout could not load' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Return to event' })).not.toBeInTheDocument()
  })

  it('retains a missing tier and the full draft instead of redirecting or silently reducing it', () => {
    const path = `/events/${eventId}/checkout?item=${tierId}%3A2&item=${nextTierId}%3A1`
    const { router } = renderCheckout(path)
    expect(router.state.location.pathname).toBe(`/events/${eventId}/checkout`)
    expect(screen.getByRole('heading', { name: 'Review your selection' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit selection' })).toHaveAttribute('href', `/events/${eventId}/tickets?item=${nextTierId}%3A1&item=${tierId}%3A2`)
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it('validates and focuses missing buyer details before any creation', async () => {
    renderCheckout()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue to secure payment' }))
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Enter your name')
    expect(screen.getByLabelText('Your name')).toHaveFocus()
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it('uses one mutation for rapid clicks and disables the form while checkout is pending', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    let resolveCheckout!: (url: string) => void
    createCheckout.mockReturnValue(new Promise<string>((resolve) => { resolveCheckout = resolve }))
    renderCheckout(undefined, assign)
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')

    const action = screen.getByRole('button', { name: 'Continue to secure payment' })
    fireEvent.click(action)
    fireEvent.click(action)

    await waitFor(() => expect(createCheckout).toHaveBeenCalledOnce())
    expect(action).toBeDisabled()
    expect(screen.getByLabelText('Your name')).toBeDisabled()
    resolveCheckout('https://checkout.stripe.com/c/pay/cs_test_123')
  })

  it('keeps an uncertain attempt and checks its status without creating a replacement', async () => {
    createCheckout.mockRejectedValue(new Error('timeout'))
    renderCheckout()
    await submitBuyer()
    expect(await screen.findByRole('heading', { name: 'Unable to confirm payment' })).toBeInTheDocument()
    const stored = sessionStorage.getItem(attemptStorageKey)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check status' }))
    expect(createCheckout).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(attemptStorageKey)).toBe(stored)
    expect(screen.queryByRole('link', { name: 'Edit selection' })).not.toBeInTheDocument()
  })

  it('permits explicit edit after the first sole definitive stock rejection', async () => {
    createCheckout.mockRejectedValue({ code: 'TIER_SOLD_OUT' })
    renderCheckout()
    await submitBuyer()
    expect(await screen.findByRole('heading', { name: 'Tickets no longer available' })).toBeInTheDocument()
    expect(screen.getByText('General admission × 2')).toBeInTheDocument()
    expect(screen.getByText('VIP × 1')).toBeInTheDocument()
    expect(sessionStorage.getItem(attemptStorageKey)).not.toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit selection' }))
    expect(sessionStorage.getItem(attemptStorageKey)).toBeNull()
    expect(createCheckout).toHaveBeenCalledTimes(1)
  })

  it('awaits cancellation and stays on the recovery page until terminal acknowledgement', async () => {
    let resolve!: () => void
    cancelCheckout.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const { router } = renderCheckout(`/events/${eventId}/checkout?cancel=${confirmationBearer}`)
    await waitFor(() => expect(cancelCheckout).toHaveBeenCalledTimes(1))
    expect(router.state.location.pathname).toBe(`/events/${eventId}/checkout`)
    expect(screen.getByRole('heading', { name: 'Cancelling checkout' })).toBeInTheDocument()
    await act(async () => resolve())
    expect(await screen.findByRole('heading', { name: 'Checkout cancelled' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Return to event' })).toHaveAttribute('href', `/events/${eventId}`)
  })

  it('retains the original attempt and does not navigate away on cancellation failure', async () => {
    const { first } = await useRealRetryState()
    invoke.mockResolvedValue({ data: null, error: new Error('uncertain') })
    const { router } = renderCheckout(`/events/${eventId}/checkout?cancel=${first.confirmationBearer}`)
    expect(await screen.findByRole('heading', { name: 'Unable to confirm payment' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/events/${eventId}/checkout`)
    expect(JSON.parse(sessionStorage.getItem(attemptStorageKey)!)).toEqual(first)
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it('retains original order totals and permits exact replay when current tiers disappeared', async () => {
    const { attempts, submission, first } = await useRealRetryState()
    attempts.markCheckoutSubmitted(eventId, first, submission, eventId)
    useCheckoutPublicEvent.mockReturnValue({ data: { ...publicEvent, tiers: [] }, isPending: false, isError: false, refetch })
    invoke.mockResolvedValue({ data: originalOrder, error: null })
    createCheckout.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_test_original')
    const assign = vi.fn()
    renderCheckout(undefined, assign)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Check status' }))
    await user.click(await screen.findByRole('button', { name: 'Re-enter original details' }))
    expect(screen.getByText('$120.00', { selector: '.buyer-order-summary dd' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review your selection' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Retry same checkout' }))
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(createCheckout).toHaveBeenCalledWith({ ...submission, items: [...submission.items].reverse(), clientRequestId: first.clientRequestId }, first.confirmationBearer)
  })

  it('polls the same recovered order through delayed paid and retains native ticket access', async () => {
    const { attempts, submission, first } = await useRealRetryState()
    attempts.markCheckoutSubmitted(eventId, first, submission, eventId)
    invoke.mockResolvedValueOnce({ data: originalOrder, error: null })
      .mockResolvedValueOnce({ data: originalOrder, error: null })
      .mockResolvedValue({ data: { ...originalOrder, status: 'paid' }, error: null })
    renderCheckout()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check status' }))
    expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: "You're all set" }, { timeout: 2500 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View tickets' })).toHaveAttribute('href', `/tickets/${first.confirmationBearer}`)
    expect(createCheckout).not.toHaveBeenCalled()
    expect(invoke.mock.calls.every((call) => call[1].body.confirmationToken === first.confirmationBearer)).toBe(true)
  })

  it('blocks replay after full storage deletion while original details are being re-entered', async () => {
    const { attempts, submission, first } = await useRealRetryState()
    attempts.markCheckoutSubmitted(eventId, first, submission, eventId)
    invoke.mockResolvedValue({ data: originalOrder, error: null })
    renderCheckout()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Check status' }))
    await user.click(await screen.findByRole('button', { name: 'Re-enter original details' }))
    sessionStorage.clear()
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Retry same checkout' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Checkout retry state is unavailable')
    expect(createCheckout).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('replays the saved original cart on a cancel return when cancellation is unconfirmed and tiers sold out', async () => {
    const { attempts, submission, first } = await useRealRetryState()
    attempts.markCheckoutSubmitted(eventId, first, submission, eventId)
    cancelCheckout.mockRejectedValue(new Error('provider session still open'))
    invoke.mockResolvedValue({ data: originalOrder, error: null })
    useCheckoutPublicEvent.mockReturnValue({ data: { ...publicEvent, tiers: [] }, isPending: false, isError: false, refetch })
    createCheckout.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_test_original')
    const assign = vi.fn()
    renderCheckout(`/events/${eventId}/checkout?cancel=${first.confirmationBearer}`, assign)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Re-enter original details' }))
    expect(screen.getByText('$120.00', { selector: '.buyer-order-summary dd' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Retry same checkout' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_original'))
    expect(createCheckout.mock.calls[0]).toEqual([{ ...submission, items: [...submission.items].reverse(), clientRequestId: first.clientRequestId }, first.confirmationBearer])
  })

  it('cleans a paid recovered attempt for a later intentional purchase without automatically creating one', async () => {
    const { attempts, submission, first } = await useRealRetryState()
    attempts.markCheckoutSubmitted(eventId, first, submission, eventId)
    invoke.mockResolvedValue({ data: { ...originalOrder, status: 'paid' }, error: null })
    renderCheckout()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check status' }))
    await screen.findByRole('heading', { name: "You're all set" })
    await waitFor(() => expect(sessionStorage.getItem(attemptStorageKey)).toBeNull())
    expect(createCheckout).not.toHaveBeenCalled()
    const next = await attempts.getOrCreateCheckoutAttempt({ ...submission, buyerEmail: 'next@example.com' })
    expect(next.confirmationBearer).not.toBe(first.confirmationBearer)
    await expect(attempts.getOrCreateCheckoutAttempt(submission, first.confirmationBearer, true)).rejects.toThrow()
  })

  it('presents a definitive first event rejection as unavailable and does not claim sales closed', async () => {
    createCheckout.mockRejectedValue({ code: 'EVENT_NOT_SELLABLE' })
    renderCheckout()
    await submitBuyer()
    expect(await screen.findByRole('heading', { name: 'Tickets unavailable' })).toBeInTheDocument()
    expect(screen.queryByText(/sales closed/i)).not.toBeInTheDocument()
  })

  it('does not redirect when a deferred Checkout response resolves after the route changes', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    let resolveCheckout!: (url: string) => void
    createCheckout.mockReturnValue(new Promise<string>((resolve) => { resolveCheckout = resolve }))
    const { router } = renderCheckout(undefined, assign)
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))
    await act(async () => { await router.navigate(`/events/${eventId}`) })
    expect(screen.getByText('Public event destination')).toBeInTheDocument()
    resolveCheckout('https://checkout.stripe.com/c/pay/cs_test_123')

    await Promise.resolve()
    expect(assign).not.toHaveBeenCalled()
  })

  it('does not redirect an old request after a committed checkout-to-checkout route change', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    let resolveCheckout!: (url: string) => void
    createCheckout.mockReturnValue(new Promise<string>((resolve) => { resolveCheckout = resolve }))
    useCheckoutPublicEvent.mockImplementation((queriedEventId: string) => ({
      data: {
        ...publicEvent,
        event: { ...publicEvent.event, id: queriedEventId, title: queriedEventId === nextEventId ? 'Later Market' : 'Night Market' },
        tiers: queriedEventId === nextEventId
          ? [{ ...publicEvent.tiers[0], id: nextTierId }]
          : publicEvent.tiers,
      },
      isPending: false,
      isError: false,
      refetch,
    }))
    const { router } = renderCheckout(undefined, assign)
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))

    await act(async () => { await router.navigate(`/events/${nextEventId}/checkout?item=${nextTierId}%3A1`) })
    expect(screen.getByText('Later Market')).toBeInTheDocument()
    resolveCheckout('https://checkout.stripe.com/c/pay/cs_test_123')

    await Promise.resolve()
    expect(assign).not.toHaveBeenCalled()
  })

  it('resets guest values and validation errors after a committed checkout-to-checkout route change', async () => {
    const user = userEvent.setup()
    useCheckoutPublicEvent.mockImplementation((queriedEventId: string) => ({
      data: {
        ...publicEvent,
        event: { ...publicEvent.event, id: queriedEventId, title: queriedEventId === nextEventId ? 'Later Market' : 'Night Market' },
        tiers: queriedEventId === nextEventId
          ? [{ ...publicEvent.tiers[0], id: nextTierId }]
          : publicEvent.tiers,
      },
      isPending: false,
      isError: false,
      refetch,
    }))
    const { router } = renderCheckout()
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))
    expect(screen.getAllByText('Enter your name')).not.toHaveLength(0)
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')

    await act(async () => { await router.navigate(`/events/${nextEventId}/checkout?item=${nextTierId}%3A1`) })

    expect(screen.getByText('Later Market')).toBeInTheDocument()
    expect(screen.getByLabelText('Your name')).toHaveValue('')
    expect(screen.getByLabelText('Email address')).toHaveValue('')
    expect(screen.queryByText('Enter your name')).not.toBeInTheDocument()
    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled()
  })

  it('keeps a newer checkout attempt isolated when an old deferred attempt resolves after a route change', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    let resolveOld!: (url: string) => void
    let resolveNew!: (url: string) => void
    createCheckout
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveNew = resolve }))
    useCheckoutPublicEvent.mockImplementation((queriedEventId: string) => ({
      data: {
        ...publicEvent,
        event: { ...publicEvent.event, id: queriedEventId, title: queriedEventId === nextEventId ? 'Later Market' : 'Night Market' },
        tiers: queriedEventId === nextEventId
          ? [{ ...publicEvent.tiers[0], id: nextTierId }]
          : publicEvent.tiers,
      },
      isPending: false,
      isError: false,
      refetch,
    }))
    const { router } = renderCheckout(undefined, assign)
    await user.type(screen.getByLabelText('Your name'), 'First buyer')
    await user.type(screen.getByLabelText('Email address'), 'first@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))
    expect(screen.getByRole('button', { name: 'Opening secure payment…' })).toBeDisabled()

    await act(async () => { await router.navigate(`/events/${nextEventId}/checkout?item=${nextTierId}%3A1`) })
    expect(screen.getByLabelText('Your name')).toHaveValue('')
    expect(screen.getByLabelText('Email address')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled()
    await user.type(screen.getByLabelText('Your name'), 'Second buyer')
    await user.type(screen.getByLabelText('Email address'), 'second@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))
    expect(createCheckout).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Opening secure payment…' })).toBeDisabled()

    resolveOld('https://checkout.stripe.com/c/pay/cs_test_OLD')
    await Promise.resolve()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Your name')).toHaveValue('Second buyer')
    expect(screen.getByRole('button', { name: 'Opening secure payment…' })).toBeDisabled()

    resolveNew('https://checkout.stripe.com/c/pay/cs_test_NEW')
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_NEW'))
  })

  it('does not consume a cancellation bearer twice under Strict Mode', async () => {
    const token = 'tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng'
    const { router } = renderCheckout(`/events/${eventId}/checkout?cancel=${token}`, undefined, true)

    await screen.findByRole('heading', { name: 'Checkout cancelled' })
    expect(router.state.location.pathname).toBe(`/events/${eventId}/checkout`)
    expect(cancelCheckout).toHaveBeenCalledOnce()
  })
})
