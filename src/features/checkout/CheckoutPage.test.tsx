import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicTicketingEvent } from '../tickets/ticket.types'

const { cancelCheckout, createCheckout, refetch, useCheckoutPublicEvent } = vi.hoisted(() => ({
  cancelCheckout: vi.fn(),
  createCheckout: vi.fn(),
  refetch: vi.fn(),
  useCheckoutPublicEvent: vi.fn(),
}))
const { clearCheckoutAttempt, getOrCreateCheckoutAttempt } = vi.hoisted(() => ({
  clearCheckoutAttempt: vi.fn(),
  getOrCreateCheckoutAttempt: vi.fn(),
}))

vi.mock('./checkout.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./checkout.api')>()),
  cancelCheckout,
  createCheckout,
}))
vi.mock('./checkout.queries', () => ({ useCheckoutPublicEvent }))
vi.mock('./checkout.attempt', () => ({ clearCheckoutAttempt, getOrCreateCheckoutAttempt }))

import { CheckoutPage } from './CheckoutPage'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const tierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const otherTierId = '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe'
const nextEventId = '10823f25-2860-4b63-968c-749e8047561d'
const nextTierId = '18a23f25-2860-4b63-968c-749e8047561d'
const confirmationBearer = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const clientRequestId = '10823f25-2860-4b63-968c-749e8047561d'

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
  beforeEach(() => {
    vi.clearAllMocks()
    useCheckoutPublicEvent.mockReturnValue({ data: publicEvent, isPending: false, isError: false, refetch })
    cancelCheckout.mockResolvedValue(undefined)
    getOrCreateCheckoutAttempt.mockResolvedValue({
      contractVersion: 'checkout_integrity_v1',
      submissionFingerprint: confirmationBearer,
      clientRequestId,
      confirmationBearer,
    })
  })

  it('reviews multiple canonical cart lines and derives one public-data total', () => {
    renderCheckout()

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
    expect(screen.getByRole('link', { name: 'Return to event' })).toHaveAttribute('href', `/events/${eventId}`)
  })

  it.each([
    `/events/${eventId}/checkout`,
    `/events/${eventId}/checkout?item=not-a-uuid%3A1`,
    `/events/${eventId}/checkout?item=${tierId}%3A11`,
    `/events/${eventId}/checkout?item=18a23f25-2860-4b63-968c-749e8047561d%3A1`,
  ])('safely returns invalid or missing tier selections to the public event: %s', async (path) => {
    const { router } = renderCheckout(path)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/events/${eventId}`))
  })

  it('shows an accessible validation summary and retains guest input after a safe server rejection', async () => {
    const user = userEvent.setup()
    createCheckout.mockRejectedValueOnce({ code: 'RATE_LIMITED' })
    renderCheckout()

    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Enter your name')
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Enter a valid email address')
    expect(screen.getByLabelText('Your name')).toHaveFocus()

    await user.tab()
    expect(screen.getByLabelText('Email address')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toHaveFocus()

    await user.type(screen.getByLabelText('Your name'), ' Avery Stone ')
    await user.type(screen.getByLabelText('Email address'), 'AVERY@EXAMPLE.COM')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many checkout attempts')
    expect(screen.getByLabelText('Your name')).toHaveValue(' Avery Stone ')
    expect(screen.getByLabelText('Email address')).toHaveValue('AVERY@EXAMPLE.COM')
    expect(refetch).toHaveBeenCalledOnce()
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

  it('refreshes public availability after a sold-out response and shows a safe recovery message', async () => {
    const user = userEvent.setup()
    createCheckout.mockRejectedValue({ code: 'TIER_SOLD_OUT' })
    renderCheckout()
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))

    expect(await screen.findByText('This ticket just sold out. Choose another ticket.')).toBeInTheDocument()
    expect(refetch).toHaveBeenCalledOnce()
    expect(screen.queryByText(/TIER_SOLD_OUT|raw/i)).not.toBeInTheDocument()
  })

  it('reuses the durable attempt after an ambiguous rejection instead of minting submit-local values', async () => {
    const user = userEvent.setup()
    createCheckout
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce('https://checkout.stripe.com/c/pay/cs_test_123')
    renderCheckout(undefined, vi.fn())
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')

    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Secure checkout is unavailable')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))

    await waitFor(() => expect(createCheckout).toHaveBeenCalledTimes(2))
    expect(createCheckout.mock.calls[1]).toEqual(createCheckout.mock.calls[0])
    expect(getOrCreateCheckoutAttempt).toHaveBeenCalledTimes(2)
  })

  it('redirects only after a valid hosted Checkout URL and never creates paid client state', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    createCheckout.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_test_123')
    renderCheckout(undefined, assign)
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))

    expect(createCheckout).toHaveBeenCalledWith({
      eventId,
      buyerName: 'Avery Stone',
      buyerEmail: 'avery@example.com',
      clientRequestId,
      items: [
        { tierId: otherTierId, quantity: 1 },
        { tierId, quantity: 2 },
      ],
    }, confirmationBearer)
    expect(clearCheckoutAttempt).toHaveBeenCalledWith(eventId, expect.objectContaining({ clientRequestId }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_123'))
    expect(screen.queryByText(/payment complete|ticket issued|order confirmed/i)).not.toBeInTheDocument()
  })

  it('consumes a cancel bearer once, strips it by returning to the event, and does not retain a tier', async () => {
    const token = 'tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng'
    const { router } = renderCheckout(`/events/${eventId}/checkout?cancel=${token}`)

    await waitFor(() => expect(cancelCheckout).toHaveBeenCalledWith(token))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/events/${eventId}`))
    expect(router.state.location.search).toBe('')
    expect(cancelCheckout).toHaveBeenCalledOnce()
  })

  it('does not redirect after unmount when a deferred Checkout response resolves', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    let resolveCheckout!: (url: string) => void
    createCheckout.mockReturnValue(new Promise<string>((resolve) => { resolveCheckout = resolve }))
    const view = renderCheckout(undefined, assign)
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))
    view.unmount()
    resolveCheckout('https://checkout.stripe.com/c/pay/cs_test_123')

    await Promise.resolve()
    expect(assign).not.toHaveBeenCalled()
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

    await waitFor(() => expect(router.state.location.pathname).toBe(`/events/${eventId}`))
    expect(cancelCheckout).toHaveBeenCalledOnce()
  })
})
