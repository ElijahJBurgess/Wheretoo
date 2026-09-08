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
  items: [
    { tierName: 'General admission', quantity: 2, unitAmountMinor: 2500, subtotalMinor: 5000, currency: 'usd' },
    { tierName: 'VIP', quantity: 1, unitAmountMinor: 5000, subtotalMinor: 5000, currency: 'usd' },
  ],
  orderNumber: 'WT-260901-0042',
  status: 'paid',
  quantity: 3,
  currency: 'usd',
  subtotalMinor: 10000,
  taxAmountMinor: 0,
  totalMinor: 10000,
} as const

describe('order confirmation API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a constant-form Web Crypto fingerprint without retaining the clear bearer', async () => {
    await expect(fingerprintConfirmationToken(token)).resolves.toBe(
      '59c3bb1da17d73b082ec3cda686cf96a0df6f352b91d227a64cf9084daa51282',
    )
    await expect(fingerprintConfirmationToken(`${token}=`)).rejects.toEqual(new OrderApiError('ORDER_NOT_FOUND'))
  })

  it('posts only the bearer and accepts the exact multi-item confirmation projection', async () => {
    invoke.mockResolvedValue({ data: confirmation, error: null })

    await expect(getOrderConfirmation(token)).resolves.toEqual(confirmation)
    expect(invoke).toHaveBeenCalledWith('order-confirmation', {
      body: { confirmationToken: token },
      method: 'POST',
    })
  })

  it('accepts each exact confirmation lifecycle status', async () => {
    for (const status of ['processing', 'paid', 'payment_failed', 'cancelled', 'expired', 'refunded', 'requires_review'] as const) {
      invoke.mockResolvedValueOnce({ data: { ...confirmation, status }, error: null })
      await expect(getOrderConfirmation(token)).resolves.toMatchObject({ status })
    }
  })

  it('rejects response disclosure, unsafe money, or impossible status with a safe error', async () => {
    for (const data of [
      { ...confirmation, buyerEmail: 'buyer@example.invalid' },
      { ...confirmation, status: 'failed' },
      { ...confirmation, event: { ...confirmation.event, stripeChargeId: 'ch_private' } },
      { ...confirmation, items: [{ ...confirmation.items[0], ticketId: 'private' }] },
      { ...confirmation, items: [{ ...confirmation.items[0], subtotalMinor: 1 }], subtotalMinor: 1, totalMinor: 1, quantity: 2 },
      { ...confirmation, taxAmountMinor: 1, totalMinor: 10001 },
      { ...confirmation, totalMinor: Number.MAX_SAFE_INTEGER + 1 },
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
