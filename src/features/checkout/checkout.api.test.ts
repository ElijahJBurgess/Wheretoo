import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../lib/supabase/client', () => ({ supabase: { functions: { invoke } } }))

import { CheckoutApiError, cancelCheckout, createCheckout } from './checkout.api'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const tierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const requestId = '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe'
const confirmationToken = 'tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng'

describe('checkout API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends only the strict guest Checkout payload and returns an exact Stripe hosted URL', async () => {
    invoke.mockResolvedValue({ data: { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123' }, error: null })

    await expect(createCheckout({
      eventId,
      tierId,
      buyerName: ' Avery Stone ',
      buyerEmail: ' AVERY@EXAMPLE.COM ',
      clientRequestId: requestId,
      quantity: 1,
    })).resolves.toBe('https://checkout.stripe.com/c/pay/cs_test_123')

    expect(invoke).toHaveBeenCalledWith('stripe-create-checkout', {
      body: {
        eventId,
        tierId,
        guestName: 'Avery Stone',
        guestEmail: 'avery@example.com',
        clientRequestId: requestId,
      },
      method: 'POST',
    })
  })

  it.each([
    'http://checkout.stripe.com/c/pay/cs_test_123',
    'https://checkout.stripe.com:444/c/pay/cs_test_123',
    'https://buyer@checkout.stripe.com/c/pay/cs_test_123',
    'https://checkout.stripe.com/c/pay/cs_test_123?unexpected=query',
    'https://checkout.stripe.com/other/cs_test_123',
    'https://checkout.stripe.com.evil.example/c/pay/cs_test_123',
    'https://connect.stripe.com/c/pay/cs_test_123',
    'https://checkout.stripe.com.evil/c/pay/cs_test_123',
  ])('rejects a non-exact Stripe Checkout URL without exposing it: %s', async (checkoutUrl) => {
    invoke.mockResolvedValue({ data: { checkoutUrl }, error: null })

    await expect(createCheckout({
      eventId,
      tierId,
      buyerName: 'Avery Stone',
      buyerEmail: 'avery@example.com',
      clientRequestId: requestId,
      quantity: 1,
    })).rejects.toEqual(new CheckoutApiError('CHECKOUT_UNAVAILABLE'))
  })

  it('accepts the documented Stripe Checkout URL path with an opaque fragment without inspecting it', async () => {
    const checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_Abc123#fidkdWxOYHwnPyd1blpxYHZxWjA0S0RFVVxMa2pybGRnX2FfYGdqJz9nY2xtY2Bi'
    invoke.mockResolvedValue({ data: { checkoutUrl }, error: null })

    await expect(createCheckout({
      eventId,
      tierId,
      buyerName: 'Avery Stone',
      buyerEmail: 'avery@example.com',
      clientRequestId: requestId,
      quantity: 1,
    })).resolves.toBe(checkoutUrl)
  })

  it('maps only documented server codes and suppresses raw function failures', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ error: { code: 'TIER_SOLD_OUT' } })) },
    })

    await expect(createCheckout({
      eventId,
      tierId,
      buyerName: 'Avery Stone',
      buyerEmail: 'avery@example.com',
      clientRequestId: requestId,
      quantity: 1,
    })).rejects.toEqual(new CheckoutApiError('TIER_SOLD_OUT'))

    invoke.mockResolvedValue({ data: null, error: new Error('raw Stripe account error') })
    await expect(cancelCheckout(confirmationToken)).rejects.toEqual(new CheckoutApiError('CHECKOUT_UNAVAILABLE'))
  })

  it('consumes a cancellation bearer only through the cancellation function', async () => {
    invoke.mockResolvedValue({ data: { cancelled: true }, error: null })

    await expect(cancelCheckout(confirmationToken)).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('stripe-cancel-checkout', {
      body: { confirmationToken },
      method: 'POST',
    })
  })
})
