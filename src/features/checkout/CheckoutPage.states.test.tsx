import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, useCheckoutPublicEvent } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useCheckoutPublicEvent: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))
vi.mock('../event-images/publicEventImages', () => ({ usePublicEventImages: () => ({ data: [] }) }))
vi.mock('./checkout.queries', () => ({ useCheckoutPublicEvent }))
vi.mock('./checkout.api', () => ({
  cancelCheckout: vi.fn(),
  createCheckout: vi.fn(),
  isStripeCheckoutUrl: vi.fn(),
}))

import { CheckoutPage, CheckoutState } from './CheckoutPage'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const availableTierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const soldOutTierId = '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe'

describe('CheckoutState', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['Cancelling checkout', 'loading', 'status'],
    ['Loading checkout', 'loading', 'status'],
    ['Checkout could not load', 'error', 'alert'],
    ['This cart is unavailable', 'empty', 'status'],
  ] as const)('gives %s exactly one h1, a %s state role, and a safe return control', (title, status, role) => {
    render(
      <CheckoutState
        action={<a href="/events/eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f">Return to event</a>}
        status={status}
        title={title}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole(role)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Return to event' })).toHaveAttribute('href', '/events/eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')
  })

  it('identifies the whole multi-tier cart as unavailable when one selected tier is sold out', () => {
    useCheckoutPublicEvent.mockReturnValue({
      data: {
        event: { id: eventId, title: 'Night Market' },
        tiers: [
          { id: availableTierId, name: 'General admission', unit_amount_minor: 2_500, availability_status: 'available' },
          { id: soldOutTierId, name: 'VIP', unit_amount_minor: 7_500, availability_status: 'sold_out' },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter initialEntries={[`/events/${eventId}/checkout?item=${availableTierId}%3A1&item=${soldOutTierId}%3A1`]}>
        <Routes>
          <Route element={<CheckoutPage />} path="/events/:eventId/checkout" />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Review your selection' })).toBeInTheDocument()
    expect(screen.getByText(/Your full selection is kept here/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit selection' })).toHaveAttribute('href', `/events/${eventId}/tickets?item=${soldOutTierId}%3A1&item=${availableTierId}%3A1`)
  })
})
