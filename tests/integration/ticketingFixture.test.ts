import { describe, expect, it } from 'vitest'
import * as fixtureHarness from '../e2e/support/ticketingFixture'
import {
  checkoutAttemptMatches,
} from '../e2e/support/ticketingFixture'

describe('Task 14 stable buyer fixture and failure cleanup', () => {
  it('reuses managed setup and rejects a stale cart without creating organizer browser rows', async () => {
    const prepare = fixtureHarness.prepareStableBuyerFixture
    const calls: string[] = []
    const setup = {
      ok: true, event_id: '11111111-1111-4111-8111-111111111111',
      quantity: 3, subtotal_minor: 5500, total_minor: 5500,
      items: [
        { label: 'ga', name: 'Task 17 General Admission', quantity: 2, unit_amount_minor: 1500, subtotal_minor: 3000, currency: 'usd' },
        { label: 'vip', name: 'Task 17 VIP', quantity: 1, unit_amount_minor: 2500, subtotal_minor: 2500, currency: 'usd' },
      ],
    }
    const result = await prepare(async (action: string) => { calls.push(action); return setup }, 'task17_checkout0001')
    expect(calls).toEqual(['setup'])
    expect(result).toMatchObject({ publicEventPath: '/events/11111111-1111-4111-8111-111111111111', buyerEmail: 'task17_checkout0001-paid@example.invalid', orderHandle: 'paid' })
    await expect(prepare(async () => ({ ...setup, total_minor: 6701 }), 'task17_checkout0001')).rejects.toThrow('TASK14_FIXTURE_CONTRACT')
  })

  it.each(['open', 'paid', 'expired'])('settles a failed browser %s session before deleting runtime', async (state) => {
    const settle = fixtureHarness.settleBrowserCheckout
    const actions: string[] = []
    const response = async (action: string, input: Record<string, unknown> = {}) => {
      actions.push(action)
      if (action === 'inspect') return { orders: [{ order_handle: 'paid' }] }
      expect(input.order_handle ?? (input.event as Record<string, unknown>)?.order_handle).toBe('paid')
      if (action === 'checkout_status') return { ok: true, livemode: false, status: state === 'paid' ? 'complete' : state, payment_status: state === 'paid' ? 'paid' : 'unpaid', charge_paid: state === 'paid' }
      if (action === 'expire_checkout') return { ok: true, livemode: false, status: 'expired' }
      if (action === 'deliver') return { status: 200, receipt: { processing_status: 'processed' } }
      if (action === 'create_refund') return { ok: true, livemode: false, status: 'succeeded', amount: 5500, reversal_amount: 5500, application_fee_refund_amount: 425 }
      throw new Error('unexpected action')
    }
    await settle(response, '11111111-1111-4111-8111-111111111111')
    expect(actions).toEqual(state === 'paid'
      ? ['inspect', 'checkout_status', 'deliver', 'create_refund']
      : state === 'open' ? ['inspect', 'checkout_status', 'expire_checkout', 'deliver'] : ['inspect', 'checkout_status', 'deliver'])
  })

  it('refuses live, ambiguous, duplicate-order and failed-refund cleanup evidence', async () => {
    const settle = fixtureHarness.settleBrowserCheckout
    for (const status of [
      { ok: true, livemode: true, status: 'open', payment_status: 'unpaid' },
      { ok: true, livemode: false, status: 'complete', payment_status: 'unpaid' },
    ]) {
      await expect(settle(async (action: string) => action === 'inspect' ? { orders: [{ order_handle: 'paid' }] } : status, 'event')).rejects.toThrow('TASK14_CLEANUP_UNSAFE')
    }
    await expect(settle(async () => ({ orders: [{ order_handle: 'paid' }, { order_handle: 'paid' }] }), 'event')).rejects.toThrow('TASK14_CLEANUP_UNSAFE')
    await expect(settle(async (action: string) => {
      if (action === 'inspect') return { orders: [{ order_handle: 'paid' }] }
      if (action === 'checkout_status') return { ok: true, livemode: false, status: 'complete', payment_status: 'paid', charge_paid: true }
      if (action === 'deliver') return { status: 200, receipt: { processing_status: 'processed' } }
      return { ok: true, livemode: false, amount: 5500, reversal_amount: 0, application_fee_refund_amount: 0 }
    }, 'event')).rejects.toThrow('TASK14_CLEANUP_UNSAFE')
  })

  it('does not certify a pending refund even when its money projection matches', async () => {
    await expect(fixtureHarness.settleBrowserCheckout(async (action) => {
      if (action === 'inspect') return { orders: [{ order_handle: 'paid' }] }
      if (action === 'checkout_status') return { ok: true, livemode: false, status: 'complete', payment_status: 'paid', charge_paid: true }
      if (action === 'deliver') return { status: 200, receipt: { processing_status: 'processed' } }
      return { ok: true, livemode: false, status: 'pending', amount: 5500, reversal_amount: 5500, application_fee_refund_amount: 425 }
    }, 'event')).rejects.toThrow('TASK14_CLEANUP_UNSAFE')
  })
  it('compares retry identities without putting either value in assertion output', () => {
    const first = { clientRequestId: 'request-a', confirmationBearer: 'bearer-a' }

    expect(checkoutAttemptMatches(first, { ...first })).toBe(true)
    expect(checkoutAttemptMatches(first, { ...first, confirmationBearer: 'bearer-b' })).toBe(false)
  })
})
