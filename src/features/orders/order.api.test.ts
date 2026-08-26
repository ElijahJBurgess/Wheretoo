// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { functions: { invoke } } }))

import { fingerprintConfirmationToken, getOrderConfirmation, OrderApiError } from './order.api'

const token = 'tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng'
const confirmation = {
  event: {
    title: 'Night Market',
    startsAt: '2026-09-01T02:00:00+00:00',
    endsAt: '2026-09-01T05:00:00+00:00',
    timezone: 'America/Los_Angeles',
    venueName: 'Civic Center Plaza',
  },
  tier: { name: 'General admission' },
  orderNumber: 'WT-260901-0042',
  status: 'paid',
} as const

describe('order confirmation API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a constant-form Web Crypto fingerprint without retaining the clear bearer', async () => {
    await expect(fingerprintConfirmationToken(token)).resolves.toBe(
      '59c3bb1da17d73b082ec3cda686cf96a0df6f352b91d227a64cf9084daa51282',
    )
    await expect(fingerprintConfirmationToken(`${token}=`)).rejects.toEqual(new OrderApiError('ORDER_NOT_FOUND'))
  })

  it('posts only the bearer and accepts the exact minimal confirmation projection', async () => {
    invoke.mockResolvedValue({ data: confirmation, error: null })

    await expect(getOrderConfirmation(token)).resolves.toEqual(confirmation)
    expect(invoke).toHaveBeenCalledWith('order-confirmation', {
      body: { confirmationToken: token },
      method: 'POST',
    })
  })

  it('rejects response disclosure or impossible status with a safe error', async () => {
    for (const data of [
      { ...confirmation, buyerEmail: 'buyer@example.invalid' },
      { ...confirmation, status: 'requires_review' },
      { ...confirmation, event: { ...confirmation.event, stripeChargeId: 'ch_private' } },
    ]) {
      invoke.mockResolvedValueOnce({ data, error: null })
      await expect(getOrderConfirmation(token)).rejects.toEqual(new OrderApiError('ORDER_UNAVAILABLE'))
    }
  })

  it('maps only not-found and suppresses unknown function details', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify({ error: { code: 'ORDER_NOT_FOUND' } })) } })
    await expect(getOrderConfirmation(token)).rejects.toEqual(new OrderApiError('ORDER_NOT_FOUND'))

    invoke.mockResolvedValueOnce({ data: null, error: new Error(`server echoed ${token}`) })
    await expect(getOrderConfirmation(token)).rejects.toEqual(new OrderApiError('ORDER_UNAVAILABLE'))
  })
})
