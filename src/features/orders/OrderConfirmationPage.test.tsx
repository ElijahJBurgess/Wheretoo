import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clearCheckoutAttemptForConfirmation, retry, useOrderConfirmation } = vi.hoisted(() => ({
  clearCheckoutAttemptForConfirmation: vi.fn(), retry: vi.fn(), useOrderConfirmation: vi.fn(),
}))
vi.mock('./order.queries', () => ({ useOrderConfirmation }))
vi.mock('../checkout/checkout.attempt', () => ({ clearCheckoutAttemptForConfirmation }))

import { OrderConfirmationPage } from './OrderConfirmationPage'

const token = 'tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng'
const confirmation = {
  event: { title: 'Night Market', startsAt: '2026-09-01T02:00:00Z', endsAt: '2026-09-01T05:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Civic Center Plaza' },
  items: [
    { tierName: 'General admission', quantity: 2, unitAmountMinor: 2500, subtotalMinor: 5000, currency: 'usd' as const },
    { tierName: 'VIP', quantity: 1, unitAmountMinor: 5000, subtotalMinor: 5000, currency: 'usd' as const },
  ],
  orderNumber: 'WT-260901-0042', status: 'processing' as const, quantity: 3, currency: 'usd' as const,
  subtotalMinor: 10000, taxAmountMinor: 0 as const, totalMinor: 10000,
}

function renderPage(bearer = token) {
  const router = createMemoryRouter([{ path: '/orders/:confirmationToken', element: <OrderConfirmationPage /> }], {
    initialEntries: [`/orders/${bearer}`],
  })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('OrderConfirmationPage', () => {
  it.each(['paid', 'processing', 'requires_review', 'payment_failed', 'cancelled', 'expired', 'refunded'] as const)(
    'offers collection access only for paid confirmation, current status %s',
    (status) => {
      useOrderConfirmation.mockReturnValue({ data: { ...confirmation, status }, isPending: false, isError: false, isTimedOut: false, retry })
      renderPage()
      const link = screen.queryByRole('link', { name: 'View tickets' })
      if (status === 'paid') expect(link).toHaveAttribute('href', `/tickets/${encodeURIComponent(token)}`)
      else expect(link).not.toBeInTheDocument()
    },
  )

  beforeEach(() => {
    vi.clearAllMocks()
    useOrderConfirmation.mockReturnValue({ data: confirmation, isPending: false, isError: false, isTimedOut: false, retry })
  })

  it('leaves paid ticket navigation to the browser so confirmation Auth cannot survive the transition', () => {
    useOrderConfirmation.mockReturnValue({ data: { ...confirmation, status: 'paid' }, isPending: false, isError: false, isTimedOut: false, retry })
    const router = createMemoryRouter([
      { path: '/orders/:confirmationToken', element: <OrderConfirmationPage /> },
      { path: '/tickets/:collectionBearer', element: <h1>Ticket route</h1> },
    ], { initialEntries: [`/orders/${token}`] })
    render(<RouterProvider router={router} />)
    let interceptedByRouter: boolean | undefined
    document.addEventListener('click', (event) => {
      interceptedByRouter = event.defaultPrevented
      // Observe native navigation without asking jsdom to load a document.
      event.preventDefault()
    }, { once: true })
    fireEvent.click(screen.getByRole('link', { name: 'View tickets' }))
    expect(interceptedByRouter).toBe(false)
    expect(router.state.location.pathname).toBe(`/orders/${token}`)
  })

  it('shows persisted processing truth without claiming payment success or exposing the bearer', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Confirming your payment' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for secure payment confirmation')
    expect(screen.queryByText(/paid|confirmed|ticket ready/i)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(token)
  })

  it.each([
    ['paid', "You're all set", 'Payment confirmed'],
    ['payment_failed', 'Payment could not be confirmed', 'No ticket was issued'],
    ['cancelled', 'Checkout cancelled', 'No payment was completed'],
    ['expired', 'Checkout expired', 'Choose a ticket again'],
    ['refunded', 'This order was refunded', 'This ticket is no longer valid'],
    ['requires_review', 'Order needs review', 'reviewing this order'],
  ] as const)('renders persisted %s truth with one semantic heading', (status, heading, copy) => {
    useOrderConfirmation.mockReturnValue({ data: { ...confirmation, status }, isPending: false, isError: false, isTimedOut: false, retry })
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText(new RegExp(copy, 'i'))).toBeInTheDocument()
  })

  it('renders approved item quantities and aggregate totals without internal identities', () => {
    useOrderConfirmation.mockReturnValue({ data: { ...confirmation, status: 'paid' }, isPending: false, isError: false, isTimedOut: false, retry })
    renderPage()
    expect(screen.getByText('Night Market')).toBeInTheDocument()
    expect(screen.getByText('General admission × 2')).toBeInTheDocument()
    expect(screen.getByText('VIP × 1')).toBeInTheDocument()
    expect(screen.getByText('3 admissions')).toBeInTheDocument()
    expect(screen.getByText('$100.00', { selector: '.confirmation-card__total' })).toBeInTheDocument()
    expect(screen.getByText('Civic Center Plaza')).toBeInTheDocument()
    expect(screen.getByText('WT-260901-0042')).toBeInTheDocument()
    expect(screen.queryByText(/email|buyer|fee|stripe|destination|ticket id|order item|unit sequence/i)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('c9300000-0000-4000-8000-000000000001')
  })

  it.each(['processing', 'requires_review'] as const)('retains the matching tab attempt while status is %s', (status) => {
    useOrderConfirmation.mockReturnValue({ data: { ...confirmation, status }, isPending: false, isError: false, isTimedOut: false, retry })
    renderPage()
    expect(clearCheckoutAttemptForConfirmation).not.toHaveBeenCalled()
  })

  it.each(['paid', 'payment_failed', 'cancelled', 'expired', 'refunded'] as const)(
    'clears the matching tab attempt after persisted %s truth',
    (status) => {
      useOrderConfirmation.mockReturnValue({ data: { ...confirmation, status }, isPending: false, isError: false, isTimedOut: false, retry })
      renderPage()
      expect(clearCheckoutAttemptForConfirmation).toHaveBeenCalledWith(token)
    },
  )

  it('formats a same-day schedule once in the event timezone', () => {
    renderPage()
    expect(screen.getByText('Monday, August 31, 2026, 7:00 PM PDT–10:00 PM PDT')).toBeInTheDocument()
  })

  it.each([
    ['overnight', '2026-09-01T09:00:00Z', 'Tuesday, September 1, 2026, 2:00 AM PDT'],
    ['multiday', '2026-09-04T05:00:00Z', 'Thursday, September 3, 2026, 10:00 PM PDT'],
  ] as const)('includes both local dates for a %s event', (_kind, endsAt, expectedEnd) => {
    useOrderConfirmation.mockReturnValue({
      data: { ...confirmation, event: { ...confirmation.event, endsAt } },
      isPending: false,
      isError: false,
      isTimedOut: false,
      retry,
    })
    renderPage()
    expect(screen.getByText(`Monday, August 31, 2026, 7:00 PM PDT–${expectedEnd}`)).toBeInTheDocument()
  })

  it('moves delayed processing to manual retry after the bounded window', async () => {
    const user = userEvent.setup()
    useOrderConfirmation.mockReturnValue({ data: confirmation, isPending: false, isError: false, isTimedOut: true, retry })
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Confirmation is taking longer' })).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Check again' })
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('creates a fresh confirmation lifecycle when the route bearer changes without a page unmount', async () => {
    let nextInstance = 0
    useOrderConfirmation.mockImplementation(() => {
      const [instance] = useState(() => ++nextInstance)
      return {
        data: { ...confirmation, event: { ...confirmation.event, title: `Night Market ${instance}` } },
        isPending: false,
        isError: false,
        isTimedOut: false,
        retry,
      }
    })
    const { router } = renderPage()
    expect(screen.getByText('Night Market 1')).toBeInTheDocument()

    await router.navigate('/orders/uzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng')
    expect(await screen.findByText('Night Market 2')).toBeInTheDocument()
  })

  it.each([
    [{ data: undefined, isPending: true, isError: false, isTimedOut: false }, 'Loading order', 'status'],
    [{ data: undefined, isPending: false, isError: true, isTimedOut: false }, 'Order could not load', 'alert'],
    [{ data: null, isPending: false, isError: false, isTimedOut: false }, 'Order not found', 'alert'],
  ] as const)('gives every standalone state one h1 and safe recovery', (state, heading, role) => {
    useOrderConfirmation.mockReturnValue({ ...state, retry })
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole(role)).toBeInTheDocument()
  })
})
