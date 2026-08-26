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

vi.mock('./checkout.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./checkout.api')>()),
  cancelCheckout,
  createCheckout,
}))
vi.mock('./checkout.queries', () => ({ useCheckoutPublicEvent }))

import { CheckoutPage } from './CheckoutPage'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const tierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const otherTierId = '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe'

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
  }],
}

function renderCheckout(
  initialEntry = `/events/${eventId}/checkout?tier=${tierId}`,
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
  })

  it('reviews exactly the persisted selected available tier with fixed quantity one', () => {
    renderCheckout()

    expect(screen.getByRole('heading', { name: 'Review your ticket' })).toBeInTheDocument()
    expect(screen.getByText('Night Market')).toBeInTheDocument()
    expect(screen.getByText('General admission')).toBeInTheDocument()
    expect(screen.getByText('$25.00')).toBeInTheDocument()
    expect(screen.getByText('Quantity')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByText(/platform fee|destination|stripe account|order id/i)).not.toBeInTheDocument()
  })

  it.each([
    `/events/${eventId}/checkout`,
    `/events/${eventId}/checkout?tier=not-a-uuid`,
    `/events/${eventId}/checkout?tier=${otherTierId}`,
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

    expect(createCheckout).toHaveBeenCalledOnce()
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

  it('redirects only after a valid hosted Checkout URL and never creates paid client state', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    createCheckout.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_test_123')
    renderCheckout(undefined, assign)
    await user.type(screen.getByLabelText('Your name'), 'Avery Stone')
    await user.type(screen.getByLabelText('Email address'), 'avery@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))

    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      eventId,
      tierId,
      buyerName: 'Avery Stone',
      buyerEmail: 'avery@example.com',
      quantity: 1,
    }))
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

  it('does not consume a cancellation bearer twice under Strict Mode', async () => {
    const token = 'tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng'
    const { router } = renderCheckout(`/events/${eventId}/checkout?cancel=${token}`, undefined, true)

    await waitFor(() => expect(router.state.location.pathname).toBe(`/events/${eventId}`))
    expect(cancelCheckout).toHaveBeenCalledOnce()
  })
})
