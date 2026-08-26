import { describe, expect, it } from 'vitest'
import { createManagedStripeProofClient } from './stripeWebhookHarness'
import {
  applicationFeeMinor,
  type ConnectProof,
  type EventProof,
  type FixtureProof,
  type ReconciliationProof,
  TASK17_SUBTOTAL_MINOR,
} from './stripeTestObjects'
import { loadStripeIntegrationTestEnv } from './testEnv'

const env = loadStripeIntegrationTestEnv()
const proof = createManagedStripeProofClient(env)

describe('real Stripe test-mode ticket transaction', () => {
  it('uses only the public browser key and managed server proof boundary', () => {
    expect(env.stripePublishableKey).toMatch(/^pk_test_/)
    expect(env.supabasePublishableKey).toMatch(/^sb_publishable_/)
    expect(applicationFeeMinor(TASK17_SUBTOTAL_MINOR)).toBe(200)
    expect(() =>
      loadStripeIntegrationTestEnv({
        TEST_SUPABASE_URL: env.supabaseUrl,
        TEST_SUPABASE_PUBLISHABLE_KEY: env.supabasePublishableKey,
        VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_forbidden',
        TEST_FUNCTION_URL: env.functionUrl,
        TEST_STRIPE_DRIVER_TOKEN: env.driverToken,
        TEST_STRIPE_EVENT_ID: env.eventId,
      }),
    ).toThrow(/VITE_STRIPE_PUBLISHABLE_KEY/)
  })

  it('proves the Accounts v2 recipient is test-mode ready', async () => {
    const connect = await proof.invoke<ConnectProof>('refresh_connect')
    expect(connect).toMatchObject({
      ok: true,
      livemode: false,
      applied_recipient: true,
      dashboard: 'express',
      fees_collector: 'application',
      losses_collector: 'application',
      transfers_status: 'active',
      payouts_status: 'active',
      requirements_status: 'clear',
      currently_due_count: 0,
      past_due_count: 0,
      persistence: 'updated',
    })
  })

  it('reconciles the paid, expired, and refunded transaction exactly once', async () => {
    const fixture = await proof.invoke<FixtureProof>('inspect', { event_id: env.eventId })
    const refundedOrder = fixture.orders.find((order) => order.status === 'refunded')
    const expiredOrder = fixture.orders.find((order) => order.failure_code === 'CHECKOUT_EXPIRED')

    expect(fixture.ok).toBe(true)
    expect(refundedOrder).toMatchObject({
      subtotal_minor: TASK17_SUBTOTAL_MINOR,
      total_minor: TASK17_SUBTOTAL_MINOR,
      application_fee_amount_minor: 200,
      expected_organizer_proceeds_minor: 2_801,
      reconciliation_status: 'reconciled',
      failure_code: null,
    })
    expect(refundedOrder?.stripe_payment_intent_id).toMatch(/^pi_/)
    expect(refundedOrder?.stripe_charge_id).toMatch(/^ch_/)
    expect(refundedOrder?.stripe_transfer_id).toMatch(/^tr_/)
    expect(refundedOrder?.stripe_application_fee_id).toMatch(/^fee_/)
    expect(refundedOrder?.stripe_balance_transaction_id).toMatch(/^txn_/)
    expect(expiredOrder).toMatchObject({
      status: 'payment_failed',
      reconciliation_status: 'reconciled',
    })
    expect(fixture.items).toHaveLength(2)
    expect(fixture.tickets).toEqual([
      expect.objectContaining({ status: 'refunded', refunded_at: expect.any(String) }),
    ])
    expect(fixture.refunds).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        amount_minor: TASK17_SUBTOTAL_MINOR,
        reverse_transfer: true,
        refund_application_fee: true,
        stripe_transfer_reversal_id: expect.stringMatching(/^trr_/),
        stripe_application_fee_refund_id: expect.stringMatching(/^fr_/),
      }),
    ])
    expect(fixture.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'checkout.session.expired', processing_status: 'processed' }),
        expect.objectContaining({ event_type: 'refund.updated', processing_status: 'processed' }),
      ]),
    )

    const reconciliation = await proof.invoke<ReconciliationProof>('reconcile_payment', {
      order_id: refundedOrder?.id,
    })
    expect(reconciliation).toMatchObject({
      ok: true,
      livemode: false,
      total_minor: TASK17_SUBTOTAL_MINOR,
      intent_amount: TASK17_SUBTOTAL_MINOR,
      charge_amount: TASK17_SUBTOTAL_MINOR,
      application_fee_expected: 200,
      application_fee_intent: 200,
      application_fee_actual: 200,
      organizer_proceeds_expected: 2_801,
      transfer_amount: TASK17_SUBTOTAL_MINOR,
      transfer_less_application_fee: 2_801,
      balance_transaction_amount: TASK17_SUBTOTAL_MINOR,
    })

    const events = await proof.invoke<EventProof>('reconcile_events', {
      order_id: refundedOrder?.id,
    })
    expect(events.ok).toBe(true)
    expect(events.livemode).toBe(false)
    expect(events.matching_types).toEqual(
      expect.arrayContaining(['checkout.session.completed', 'refund.created', 'refund.updated']),
    )
  })

  it('rejects an invalid webhook signature without a receipt write', async () => {
    await expect(proof.invoke('invalid_signature')).resolves.toMatchObject({
      ok: true,
      status: 400,
      receipt_delta: 0,
    })
  })
})
