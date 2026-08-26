import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { createManagedStripeProofClient } from './stripeWebhookHarness'
import { loadStripeIntegrationTestEnv } from './testEnv'

const env = loadStripeIntegrationTestEnv()
const proof = createManagedStripeProofClient(env)

type OrderRow = {
  id: string
  buyer_email: string
  status: string
  failure_code: string | null
  stripe_checkout_session_id: string | null
}

type Inspection = {
  ok: boolean
  orders: OrderRow[]
  items: Array<{ order_id: string }>
  tickets: Array<{ order_id: string; status: string }>
  refunds: Array<{ order_id: string; status: string }>
  receipts: Array<{
    stripe_event_id: string
    processing_status: string
    delivery_attempt_count: number
    error_code: string | null
  }>
  inventory: Array<{
    ticket_tier_id: string
    quantity_total: number
    reserved_quantity: number
    available_quantity: number
  }>
}

function eventDescriptor(type: string, object: string, objectId: string) {
  return {
    event_id: `evt_task17${randomUUID().replaceAll('-', '')}`,
    type,
    object,
    object_id: objectId,
    created: Math.floor(Date.now() / 1_000),
  }
}

async function createCheckout(
  eventId: string,
  tierId: string,
  email: string,
): Promise<{ checkoutUrl: string }> {
  const response = await fetch(`${env.supabaseUrl}/functions/v1/stripe-create-checkout`, {
    method: 'POST',
    headers: {
      apikey: env.supabasePublishableKey,
      authorization: `Bearer ${env.supabasePublishableKey}`,
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3000',
    },
    body: JSON.stringify({
      eventId,
      tierId,
      guestName: 'Task 17 Buyer',
      guestEmail: email,
      clientRequestId: randomUUID(),
    }),
  })
  expect(response.status).toBe(200)
  const value = await response.json() as { checkoutUrl?: unknown }
  expect(value.checkoutUrl).toEqual(expect.stringMatching(/^https:\/\/checkout\.stripe\.com\//))
  return { checkoutUrl: value.checkoutUrl as string }
}

async function exerciseHostedCheckout(url: string, cardNumber: string, outcome: 'paid' | 'declined') {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(url)
    const card = page.getByRole('radio', { name: 'Card' })
    if (!(await card.isChecked())) await card.click()
    await page.getByRole('textbox', { name: 'Card number' }).fill(cardNumber)
    await page.getByRole('textbox', { name: 'Expiration' }).fill('1234')
    await page.getByRole('textbox', { name: 'CVC' }).fill('123')
    await page.getByRole('textbox', { name: 'Cardholder name' }).fill('Task Seventeen')
    await page.getByRole('textbox', { name: 'ZIP' }).fill('94103')
    const save = page.getByRole('checkbox', { name: 'Save my information for faster checkout' })
    if (await save.isChecked()) await save.uncheck()
    await page.getByRole('checkbox', { name: 'I am an AI agent acting on behalf of someone else' }).check()
    await page.getByRole('button', { name: 'Pay', exact: true }).click()
    if (outcome === 'paid') {
      await page.waitForURL((value) => value.origin === 'http://127.0.0.1:3000', { timeout: 30_000 })
    } else {
      const alert = page.getByRole('alert')
      await alert.waitFor({ timeout: 30_000 })
      expect((await alert.textContent())?.toLowerCase()).toContain('declined')
    }
  } finally {
    await browser.close()
  }
}

async function inspect(eventId: string): Promise<Inspection> {
  return await proof.invoke<Inspection>('inspect', { event_id: eventId })
}

async function waitForOrder(eventId: string, email: string): Promise<OrderRow> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const order = (await inspect(eventId)).orders.find((candidate) => candidate.buyer_email === email)
    if (order?.stripe_checkout_session_id) return order
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for Task 17 order: ${email}`)
}

describe('real Stripe test-mode ticket transaction', () => {
  it('drives every signed delivery and reconciles exact Stripe and Supabase truth', async () => {
    const server = await proof.invoke<Record<string, unknown>>('server_proof')
    expect(server).toMatchObject({
      ok: true,
      restricted_key_authenticated: true,
      webhook_signature_verified: true,
      livemode: false,
      connected_account_matches: true,
      transfers_status: 'active',
      payouts_status: 'active',
      requirements_status: 'clear',
    })

    const fixture = await proof.invoke<{
      ok: boolean
      event_id: string
      tier_id: string
      subtotal_minor: number
      application_fee_minor: number
    }>('setup')
    expect(fixture).toMatchObject({
      ok: true,
      subtotal_minor: 3_001,
      application_fee_minor: 200,
    })

    const paidEmail = `${env.fixturePrefix}-paid@example.invalid`
    const paidCheckout = await createCheckout(fixture.event_id, fixture.tier_id, paidEmail)
    const paidOrder = await waitForOrder(fixture.event_id, paidEmail)
    await exerciseHostedCheckout(paidCheckout.checkoutUrl, '4242424242424242', 'paid')
    await expect(proof.invoke('checkout_status', {
      session_id: paidOrder.stripe_checkout_session_id,
    })).resolves.toMatchObject({
      ok: true,
      livemode: false,
      status: 'complete',
      payment_status: 'paid',
      amount_total: 3_001,
      application_fee_amount: 200,
      charge_paid: true,
    })

    const paidEvent = eventDescriptor(
      'checkout.session.completed',
      'checkout.session',
      paidOrder.stripe_checkout_session_id!,
    )
    const paidFirst = await proof.invoke<{ status: number }>('deliver', { event: paidEvent })
    const paidDuplicate = await proof.invoke<{
      status: number
      receipt: { delivery_attempt_count: number; processing_status: string }
    }>('deliver', { event: paidEvent })
    expect([paidFirst.status, paidDuplicate.status]).toEqual([200, 200])
    expect(paidDuplicate.receipt).toMatchObject({
      delivery_attempt_count: 2,
      processing_status: 'processed',
    })
    let state = await inspect(fixture.event_id)
    expect(state.orders.find((order) => order.id === paidOrder.id)?.status).toBe('paid')
    expect(state.items.filter((item) => item.order_id === paidOrder.id)).toHaveLength(1)
    expect(state.tickets.filter((ticket) => ticket.order_id === paidOrder.id)).toHaveLength(1)

    const declinedEmail = `${env.fixturePrefix}-declined@example.invalid`
    const declinedCheckout = await createCheckout(fixture.event_id, fixture.tier_id, declinedEmail)
    const declinedOrder = await waitForOrder(fixture.event_id, declinedEmail)
    await exerciseHostedCheckout(declinedCheckout.checkoutUrl, '4000000000000002', 'declined')
    await expect(proof.invoke('checkout_status', {
      session_id: declinedOrder.stripe_checkout_session_id,
    })).resolves.toMatchObject({
      ok: true,
      livemode: false,
      status: 'open',
      payment_status: 'unpaid',
      charge_paid: false,
    })
    state = await inspect(fixture.event_id)
    expect(state.orders.find((order) => order.id === declinedOrder.id)?.status).toBe('checkout_open')
    expect(state.tickets.filter((ticket) => ticket.order_id === declinedOrder.id)).toHaveLength(0)

    await expect(proof.invoke('expire_checkout', {
      session_id: declinedOrder.stripe_checkout_session_id,
    })).resolves.toMatchObject({ ok: true, livemode: false, status: 'expired' })
    const expiredEvent = eventDescriptor(
      'checkout.session.expired',
      'checkout.session',
      declinedOrder.stripe_checkout_session_id!,
    )
    const retry = await proof.invoke<{
      statuses: number[]
      receipt: { delivery_attempt_count: number; processing_status: string }
    }>('deliver_transient_retry', { event: expiredEvent })
    expect(retry.statuses).toEqual([503, 200])
    expect(retry.receipt).toMatchObject({
      delivery_attempt_count: 2,
      processing_status: 'processed',
    })
    state = await inspect(fixture.event_id)
    expect(state.orders.find((order) => order.id === declinedOrder.id)).toMatchObject({
      status: 'payment_failed',
      failure_code: 'CHECKOUT_EXPIRED',
    })
    expect(state.tickets.filter((ticket) => ticket.order_id === declinedOrder.id)).toHaveLength(0)
    expect(state.inventory).toEqual([
      expect.objectContaining({
        ticket_tier_id: fixture.tier_id,
        quantity_total: 10,
        reserved_quantity: 1,
        available_quantity: 9,
      }),
    ])

    await expect(proof.invoke('invalid_signature')).resolves.toMatchObject({
      ok: true,
      status: 400,
      receipt_delta: 0,
    })

    const refund = await proof.invoke<{
      ok: boolean
      livemode: boolean
      refund_id: string
      amount: number
      reversal_amount: number
      application_fee_refund_amount: number
    }>('create_refund', { order_id: paidOrder.id })
    expect(refund).toMatchObject({
      ok: true,
      livemode: false,
      amount: 3_001,
      reversal_amount: 3_001,
      application_fee_refund_amount: 200,
    })
    const refundEvent = eventDescriptor('refund.updated', 'refund', refund.refund_id)
    const refundFirst = await proof.invoke<{ status: number }>('deliver', { event: refundEvent })
    const refundDuplicate = await proof.invoke<{
      status: number
      receipt: { delivery_attempt_count: number; processing_status: string }
    }>('deliver', { event: refundEvent })
    expect([refundFirst.status, refundDuplicate.status]).toEqual([200, 200])
    expect(refundDuplicate.receipt).toMatchObject({
      delivery_attempt_count: 2,
      processing_status: 'processed',
    })
    state = await inspect(fixture.event_id)
    expect(state.orders.find((order) => order.id === paidOrder.id)?.status).toBe('refunded')
    expect(state.tickets.filter((ticket) => ticket.order_id === paidOrder.id)).toEqual([
      expect.objectContaining({ status: 'refunded' }),
    ])
    expect(state.refunds.filter((candidate) => candidate.order_id === paidOrder.id)).toEqual([
      expect.objectContaining({ status: 'succeeded' }),
    ])

    await expect(proof.invoke('reconcile_payment', { order_id: paidOrder.id })).resolves.toMatchObject({
      ok: true,
      livemode: false,
      connected_account_matches: true,
      persisted_ids_match: true,
      total_minor: 3_001,
      application_fee_actual: 200,
      transfer_less_application_fee: 2_801,
    })
    await expect(proof.invoke('reconcile_events', { order_id: paidOrder.id })).resolves.toMatchObject({
      ok: true,
      livemode: false,
      matching_types: expect.arrayContaining([
        'checkout.session.completed',
        'refund.created',
        'refund.updated',
      ]),
    })

    await expect(proof.invoke('cleanup')).resolves.toMatchObject({
      ok: true,
      event_count: 0,
      organizer_count: 0,
      connect_count: 0,
      order_count: 0,
      tier_count: 0,
      receipt_count: 0,
      ticket_count: 0,
      dispute_count: 0,
      refund_count: 0,
      item_count: 0,
      connected_account_closed: true,
    })
  }, 180_000)
})
