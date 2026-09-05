import { randomUUID } from 'node:crypto'
import { chromium, type Locator, type Page } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import {
  createStripeProofCheckoutAttempt,
  TASK17_ADMISSION_QUANTITY,
  TASK17_APPLICATION_FEE_MINOR,
  TASK17_CART,
  TASK17_ORGANIZER_PROCEEDS_MINOR,
  TASK17_SUBTOTAL_MINOR,
  toSafeHostedCheckoutBrowserError,
} from './stripeTestObjects'
import { createManagedStripeProofClient } from './stripeWebhookHarness'
import { loadStripeIntegrationTestEnv } from './testEnv'

const env = loadStripeIntegrationTestEnv()
const proof = createManagedStripeProofClient(env)

type OrderRow = {
  order_handle: 'paid' | 'declined'
  status: string
  failure_code: string | null
  reconciliation_status: string
  subtotal_minor: number
  total_minor: number
  application_fee_amount_minor: number
  expected_organizer_proceeds_minor: number
}

type OrderItemRow = {
  order_handle: 'paid' | 'declined'
  tier_label: 'ga' | 'vip'
  tier_name: string
  unit_amount_minor: number
  quantity: number
  subtotal_minor: number
  currency: string
}

type TicketSet = {
  order_handle: 'paid' | 'declined'
  ticket_count: number
  unique_ticket_count: number
  valid_count: number
  refunded_count: number
  bindings_valid: boolean
  sequences_valid: boolean
  refunded_timestamps_valid: boolean
}

type Inspection = {
  ok: boolean
  orders: OrderRow[]
  items: OrderItemRow[]
  tickets: TicketSet[]
  refunds: Array<{
    order_handle: 'paid' | 'declined'
    status: string
    amount_minor: number
    reverse_transfer: boolean
    refund_application_fee: boolean
    transfer_reversal_amount_minor: number
    application_fee_refund_amount_minor: number
    policy_verified: boolean
    policy_failure_code: string | null
  }>
  receipts: Array<{
    event_type: string
    processing_status: string
    delivery_attempt_count: number
    error_code: string | null
  }>
  inventory: Array<{
    tier_label: 'ga' | 'vip'
    quantity_total: number
    reserved_quantity: number
    available_quantity: number
  }>
}

type Setup = {
  ok: boolean
  event_id: string
  ga_tier_id: string
  vip_tier_id: string
  items: Array<{
    label: 'ga' | 'vip'
    tier_id: string
    name: string
    unit_amount_minor: number
    quantity: number
    subtotal_minor: number
    currency: 'usd'
  }>
  quantity: number
  subtotal_minor: number
  total_minor: number
  application_fee_minor: number
  organizer_proceeds_minor: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function eventDescriptor(
  type: 'checkout.session.completed' | 'checkout.session.expired' | 'refund.updated',
  object: 'checkout.session' | 'refund',
  orderHandle: 'paid' | 'declined',
) {
  return {
    event_handle: randomUUID(),
    type,
    object,
    order_handle: orderHandle,
    created: Math.floor(Date.now() / 1_000),
  }
}

function isHostedTestCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' &&
      url.username === '' && url.password === '' && url.search === '' &&
      /^\/c\/pay\/cs_test_[A-Za-z0-9]+$/.test(url.pathname)
  } catch {
    return false
  }
}

async function createCheckout(
  fixture: Setup,
  orderHandle: 'paid' | 'declined',
): Promise<{ checkoutUrl: string; confirmationBearer: string }> {
  const attempt = createStripeProofCheckoutAttempt()
  const response = await fetch(`${env.supabaseUrl}/functions/v1/stripe-create-checkout`, {
    method: 'POST',
    headers: {
      apikey: env.supabasePublishableKey,
      authorization: `Bearer ${env.supabasePublishableKey}`,
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3000',
      'X-Whereto-Confirmation-Bearer': attempt.confirmationBearer,
    },
    body: JSON.stringify({
      eventId: fixture.event_id,
      buyerName: 'Task 17 Buyer',
      buyerEmail: `${env.fixturePrefix}-${orderHandle}@example.invalid`,
      clientRequestId: attempt.clientRequestId,
      items: [
        { tierId: fixture.ga_tier_id, quantity: 2 },
        { tierId: fixture.vip_tier_id, quantity: 1 },
      ],
    }),
  })
  expect(response.status).toBe(200)
  const value: unknown = await response.json()
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isHostedTestCheckoutUrl(value.checkoutUrl)) {
    throw new Error('Checkout creation returned an unsafe response')
  }
  return { checkoutUrl: value.checkoutUrl, confirmationBearer: attempt.confirmationBearer }
}

async function visibleTextbox(page: Page, name: string): Promise<Locator> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const frame of page.frames()) {
      const candidate = frame.getByRole('textbox', { name }).filter({ visible: true }).first()
      if (await candidate.isVisible()) return candidate
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Timed out waiting for hosted Checkout field: ${name}`)
}

async function exerciseHostedCheckout(url: string, cardNumber: string, outcome: 'paid' | 'declined') {
  try {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(url)
      const card = page.getByRole('radio', { name: 'Card' })
      if (!(await card.isChecked())) await card.check({ force: true })
      const cardNumberInput = await visibleTextbox(page, 'Card number')
      await cardNumberInput.fill(cardNumber)
      await (await visibleTextbox(page, 'Expiration')).fill('1234')
      await (await visibleTextbox(page, 'CVC')).fill('123')
      await (await visibleTextbox(page, 'Cardholder name')).fill('Task Seventeen')
      await (await visibleTextbox(page, 'ZIP')).fill('94103')
      const save = page.getByRole('checkbox', { name: 'Save my information for faster checkout' }).filter({ visible: true }).first()
      if (await save.isChecked()) await save.uncheck()
      const disclosure = page.getByRole('checkbox', { name: 'I am an AI agent acting on behalf of someone else' }).filter({ visible: true }).first()
      await disclosure.evaluate((element: HTMLInputElement) => element.click())
      expect(await disclosure.isChecked()).toBe(true)
      await page.getByRole('button', { name: 'Pay', exact: true }).filter({ visible: true }).first().click()
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
  } catch (error) {
    throw toSafeHostedCheckoutBrowserError(error)
  }
}

async function inspect(eventId: string): Promise<Inspection> {
  return await proof.invoke<Inspection>('inspect', { event_id: eventId })
}

async function waitForOrder(eventId: string, orderHandle: 'paid' | 'declined'): Promise<OrderRow> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const orders = (await inspect(eventId)).orders.filter((order) => order.order_handle === orderHandle)
    if (orders.length === 1) return orders[0]
    if (orders.length > 1) throw new Error('Checkout created multiple orders for one proof handle')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for Task 17 order')
}

async function confirmation(confirmationBearer: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${env.supabaseUrl}/functions/v1/order-confirmation`, {
    method: 'POST',
    headers: {
      apikey: env.supabasePublishableKey,
      authorization: `Bearer ${env.supabasePublishableKey}`,
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3000',
    },
    body: JSON.stringify({ confirmationToken: confirmationBearer }),
  })
  expect(response.status).toBe(200)
  const value: unknown = await response.json()
  if (!isRecord(value)) throw new Error('Confirmation returned an unsafe response')
  return value
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

    const fixture = await proof.invoke<Setup>('setup')
    expect(fixture).toMatchObject({
      ok: true,
      quantity: TASK17_ADMISSION_QUANTITY,
      subtotal_minor: TASK17_SUBTOTAL_MINOR,
      total_minor: TASK17_SUBTOTAL_MINOR,
      application_fee_minor: TASK17_APPLICATION_FEE_MINOR,
      organizer_proceeds_minor: TASK17_ORGANIZER_PROCEEDS_MINOR,
      items: TASK17_CART.map((item) => ({
        label: item.label,
        name: item.name,
        unit_amount_minor: item.unitAmountMinor,
        quantity: item.quantity,
        subtotal_minor: item.subtotalMinor,
        currency: 'usd',
      })),
    })
    expect(Object.keys(fixture).some((key) => /secret|bearer|url/i.test(key))).toBe(false)
    expect(new Set([fixture.ga_tier_id, fixture.vip_tier_id]).size).toBe(2)

    expect((await inspect(fixture.event_id)).orders).not.toContainEqual(
      expect.objectContaining({ order_handle: 'paid' }),
    )
    const paidCheckout = await createCheckout(fixture, 'paid')
    await waitForOrder(fixture.event_id, 'paid')
    await exerciseHostedCheckout(paidCheckout.checkoutUrl, '4242424242424242', 'paid')
    await expect(proof.invoke('checkout_status', {
      order_handle: 'paid',
    })).resolves.toMatchObject({
      ok: true,
      livemode: false,
      status: 'complete',
      payment_status: 'paid',
      amount_total: TASK17_SUBTOTAL_MINOR,
      application_fee_amount: TASK17_APPLICATION_FEE_MINOR,
      charge_paid: true,
      line_bindings_valid: true,
      line_count: 2,
      admission_count: 3,
      lines: TASK17_CART.map((item) => ({
        tier_name: item.name,
        unit_amount_minor: item.unitAmountMinor,
        quantity: item.quantity,
        subtotal_minor: item.subtotalMinor,
        currency: 'usd',
        binding: 'order_item',
      })),
    })

    const paidEvent = eventDescriptor(
      'checkout.session.completed',
      'checkout.session',
      'paid',
    )
    const paidFirst = await proof.invoke<{ status: number }>('deliver', { event: paidEvent })
    let state = await inspect(fixture.event_id)
    const paidItems = state.items.filter((item) => item.order_handle === 'paid')
    const paidTickets = state.tickets.find((tickets) => tickets.order_handle === 'paid')
    expect(paidFirst.status).toBe(200)
    expect(state.orders.find((order) => order.order_handle === 'paid')?.status).toBe('paid')
    expect(paidItems).toHaveLength(2)
    expect(paidItems.map((item) => item.quantity).sort()).toEqual([1, 2])
    expect(paidTickets).toMatchObject({
      ticket_count: 3,
      unique_ticket_count: 3,
      valid_count: 3,
      refunded_count: 0,
      bindings_valid: true,
      sequences_valid: true,
      refunded_timestamps_valid: true,
    })

    const paidDuplicate = await proof.invoke<{
      status: number
      receipt: { delivery_attempt_count: number; processing_status: string }
    }>('deliver', { event: paidEvent })
    state = await inspect(fixture.event_id)
    const duplicateTickets = state.tickets.find((tickets) => tickets.order_handle === 'paid')
    expect(paidDuplicate).toMatchObject({
      status: 200,
      receipt: { delivery_attempt_count: 2, processing_status: 'processed' },
    })
    expect(duplicateTickets).toMatchObject({
      ticket_count: 3,
      unique_ticket_count: 3,
      valid_count: 3,
      bindings_valid: true,
      sequences_valid: true,
    })

    const safeConfirmation = await confirmation(paidCheckout.confirmationBearer)
    expect(safeConfirmation).not.toHaveProperty('ticket_id')
    expect(safeConfirmation).not.toHaveProperty('ticketIds')
    expect(safeConfirmation).toMatchObject({
      status: 'paid',
      quantity: 3,
      currency: 'usd',
      subtotalMinor: TASK17_SUBTOTAL_MINOR,
      taxAmountMinor: 0,
      totalMinor: TASK17_SUBTOTAL_MINOR,
      items: TASK17_CART.map((item) => ({
        tierName: item.name,
        unitAmountMinor: item.unitAmountMinor,
        quantity: item.quantity,
        subtotalMinor: item.subtotalMinor,
        currency: 'usd',
      })),
    })
    expect((safeConfirmation.items as unknown[]).every((item) =>
      isRecord(item) && !Object.keys(item).some((key) => /(^|_)(id|token|bearer)$/i.test(key))
    )).toBe(true)

    expect(state.orders).not.toContainEqual(expect.objectContaining({ order_handle: 'declined' }))
    const declinedCheckout = await createCheckout(fixture, 'declined')
    await waitForOrder(fixture.event_id, 'declined')
    await exerciseHostedCheckout(declinedCheckout.checkoutUrl, '4000000000000002', 'declined')
    await expect(proof.invoke('checkout_status', {
      order_handle: 'declined',
    })).resolves.toMatchObject({
      ok: true,
      livemode: false,
      status: 'open',
      payment_status: 'unpaid',
      charge_paid: false,
      line_bindings_valid: true,
      line_count: 2,
      admission_count: 3,
    })
    state = await inspect(fixture.event_id)
    expect(state.orders.find((order) => order.order_handle === 'declined')?.status).toBe('checkout_open')
    expect(state.items.filter((item) => item.order_handle === 'declined')).toHaveLength(2)
    expect(state.tickets.find((tickets) => tickets.order_handle === 'declined')?.ticket_count).toBe(0)

    await expect(proof.invoke('expire_checkout', {
      order_handle: 'declined',
    })).resolves.toMatchObject({ ok: true, livemode: false, status: 'expired' })
    const expiredEvent = eventDescriptor(
      'checkout.session.expired',
      'checkout.session',
      'declined',
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
    expect(state.orders.find((order) => order.order_handle === 'declined')).toMatchObject({
      status: 'payment_failed',
      failure_code: 'CHECKOUT_EXPIRED',
    })
    expect(state.tickets.find((tickets) => tickets.order_handle === 'declined')?.ticket_count).toBe(0)
    expect(state.inventory.find((tier) => tier.tier_label === 'ga')).toMatchObject({
      quantity_total: 10,
      reserved_quantity: 2,
      available_quantity: 8,
    })
    expect(state.inventory.find((tier) => tier.tier_label === 'vip')).toMatchObject({
      quantity_total: 10,
      reserved_quantity: 1,
      available_quantity: 9,
    })

    await expect(proof.invoke('invalid_signature')).resolves.toMatchObject({
      ok: true,
      status: 400,
      receipt_delta: 0,
    })

    const refund = await proof.invoke<{
      ok: boolean
      livemode: boolean
      status: string
      amount: number
      reverse_transfer: boolean
      refund_application_fee: boolean
      reversal_amount: number
      application_fee_refund_amount: number
      expected_application_fee_amount: number
    }>('create_refund', { order_handle: 'paid' })
    expect(refund).toMatchObject({
      ok: true,
      livemode: false,
      status: 'succeeded',
      amount: TASK17_SUBTOTAL_MINOR,
      reverse_transfer: true,
      refund_application_fee: true,
      reversal_amount: TASK17_SUBTOTAL_MINOR,
      application_fee_refund_amount: TASK17_APPLICATION_FEE_MINOR,
      expected_application_fee_amount: TASK17_APPLICATION_FEE_MINOR,
    })
    const refundEvent = eventDescriptor('refund.updated', 'refund', 'paid')
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
    expect(state.orders.find((order) => order.order_handle === 'paid')?.status).toBe('refunded')
    expect(state.tickets.find((tickets) => tickets.order_handle === 'paid')).toMatchObject({
      ticket_count: 3,
      unique_ticket_count: 3,
      valid_count: 0,
      refunded_count: 3,
      bindings_valid: true,
      sequences_valid: true,
      refunded_timestamps_valid: true,
    })
    expect(state.refunds.filter((candidate) => candidate.order_handle === 'paid')).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        amount_minor: TASK17_SUBTOTAL_MINOR,
        reverse_transfer: true,
        refund_application_fee: true,
        transfer_reversal_amount_minor: TASK17_SUBTOTAL_MINOR,
        application_fee_refund_amount_minor: TASK17_APPLICATION_FEE_MINOR,
        policy_verified: true,
        policy_failure_code: null,
      }),
    ])

    await expect(proof.invoke('reconcile_payment', { order_handle: 'paid' })).resolves.toMatchObject({
      ok: true,
      livemode: false,
      connected_account_matches: true,
      persisted_ids_match: true,
      cross_object_relations_match: true,
      destination_charge: true,
      line_bindings_valid: true,
      line_count: 2,
      admission_count: 3,
      total_minor: TASK17_SUBTOTAL_MINOR,
      application_fee_actual: TASK17_APPLICATION_FEE_MINOR,
      transfer_less_application_fee: TASK17_ORGANIZER_PROCEEDS_MINOR,
      balance_transaction_amount: TASK17_SUBTOTAL_MINOR,
    })
    await expect(proof.invoke('reconcile_events', { order_handle: 'paid' })).resolves.toMatchObject({
      ok: true,
      livemode: false,
      has_more: false,
      matching_types: expect.arrayContaining([
        'checkout.session.completed',
        'refund.created',
        'refund.updated',
      ]),
    })

    await expect(proof.invoke('cleanup', {
      close_connected_account: true,
    })).resolves.toMatchObject({
      ok: true,
      stable_fixture: true,
      fixture_reusable: true,
      event_count: 1,
      organizer_count: 1,
      auth_user_inert: true,
      event_sellable: false,
      public_projection_count: 0,
      active_tier_count: 0,
      connect_count: 0,
      order_count: 0,
      tier_count: 0,
      receipt_count: 0,
      ticket_count: 0,
      dispute_count: 0,
      refund_count: 0,
      item_count: 0,
      deleted_order_count: 2,
      deleted_tier_count: 2,
      deleted_ticket_count: 3,
      deleted_refund_count: 1,
      deleted_item_count: 4,
      archived_price_count: 4,
      archived_product_count: 4,
      connected_account_closed: true,
      connected_account_preserved: false,
    })
  }, 180_000)
})
