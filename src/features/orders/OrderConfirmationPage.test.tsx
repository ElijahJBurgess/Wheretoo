import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { retry, useOrderConfirmation } = vi.hoisted(() => ({ retry: vi.fn(), useOrderConfirmation: vi.fn() }))
vi.mock('./order.queries', () => ({ useOrderConfirmation }))

import { OrderConfirmationPage } from './OrderConfirmationPage'

const token = 'tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng'
const confirmation = {
  event: { title: 'Night Market', startsAt: '2026-09-01T02:00:00Z', endsAt: '2026-09-01T05:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Civic Center Plaza' },
  tier: { name: 'General admission' }, orderNumber: 'WT-260901-0042', status: 'processing' as const,
}

function renderPage(bearer = token) {
  const router = createMemoryRouter([{ path: '/orders/:confirmationToken', element: <OrderConfirmationPage /> }], {
    initialEntries: [`/orders/${bearer}`],
  })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('OrderConfirmationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useOrderConfirmation.mockReturnValue({ data: confirmation, isPending: false, isError: false, isTimedOut: false, retry })
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
    ['failed', 'Payment could not be confirmed', 'No ticket was issued'],
    ['expired', 'Checkout expired', 'Choose a ticket again'],
    ['refunded', 'This order was refunded', 'This ticket is no longer valid'],
  ] as const)('renders persisted %s truth with one semantic heading', (status, heading, copy) => {
    useOrderConfirmation.mockReturnValue({ data: { ...confirmation, status }, isPending: false, isError: false, isTimedOut: false, retry })
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText(new RegExp(copy, 'i'))).toBeInTheDocument()
  })

  it('renders only approved event, tier, and order details after confirmation', () => {
    useOrderConfirmation.mockReturnValue({ data: { ...confirmation, status: 'paid' }, isPending: false, isError: false, isTimedOut: false, retry })
    renderPage()
    expect(screen.getByText('Night Market')).toBeInTheDocument()
    expect(screen.getByText('General admission')).toBeInTheDocument()
    expect(screen.getByText('Civic Center Plaza')).toBeInTheDocument()
    expect(screen.getByText('WT-260901-0042')).toBeInTheDocument()
    expect(screen.queryByText(/email|buyer|amount|fee|stripe|destination|ticket id/i)).not.toBeInTheDocument()
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
