import { randomUUID } from 'node:crypto'
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { loadTask18E2EEnv } from './e2eEnv'
import {
  prepareStableBuyerFixture,
  task18CheckoutTierNames,
  checkoutAttemptMatches,
} from './ticketingFixture'

const env = loadTask18E2EEnv()
const unsafeVisibleEvidence = /(?:https:\/\/checkout\.stripe\.com\/|\b(?:bearer|authorization)\b|\b(?:acct|cs_(?:test|live)|ch|evt|fee|pi|price|prod|re|tr|trr|txn)_[A-Za-z0-9]+\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)/i

export type TicketingJourneyFixture = Awaited<ReturnType<typeof prepareStableBuyerFixture>>

async function invokeDriver<T>(action: string, input: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(env.task18FunctionUrl, {
    method: 'POST',
    headers: {
      apikey: env.supabasePublishableKey,
      authorization: `Bearer ${env.supabasePublishableKey}`,
      'content-type': 'application/json',
      'x-task17-proof-token': env.task18DriverToken,
    },
    body: JSON.stringify({ action, ...input }),
  })
  if (!response.ok) {
    throw new Error(`TASK18_DRIVER_${action.toUpperCase()}_${response.status}`)
  }
  return await response.json() as T
}

export async function prepareTicketingJourney(): Promise<TicketingJourneyFixture> {
  const proof = await invokeDriver<Record<string, unknown>>('server_proof')
  expect(proof).toMatchObject({
    ok: true, livemode: false, connected_account_matches: true,
    transfers_status: 'active', payouts_status: 'active', requirements_status: 'clear',
  })
  return await prepareStableBuyerFixture(invokeDriver, env.task18FixturePrefix)
}

export async function chooseTwoGeneralAdmissionAndOneVip(page: Page) {
  const generalAdmission = page.getByRole('spinbutton', { name: `${task18CheckoutTierNames[0]} quantity` })
  const vip = page.getByRole('spinbutton', { name: `${task18CheckoutTierNames[1]} quantity` })

  await generalAdmission.focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(generalAdmission).toHaveValue('2')
  await vip.focus()
  await page.keyboard.press('ArrowUp')
  await expect(vip).toHaveValue('1')
  await expect(page.getByRole('status')).toHaveText('3 of 10 tickets selected')

  await generalAdmission.fill('9')
  await vip.focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('status')).toHaveText('11 tickets selected. Maximum 10.')
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeDisabled()

  await generalAdmission.fill('2')
  await vip.fill('1')
  await expect(page.getByRole('status')).toHaveText('3 of 10 tickets selected')
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled()
}

export async function assertNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
}

export async function assertTicketingAccessibilitySmoke(page: Page) {
  const semantics = await page.evaluate(() => ({
    h1Count: document.querySelectorAll('h1').length,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
  }))
  expect(semantics).toMatchObject({ h1Count: 1, reducedMotion: true })
  expect(semantics.viewport).toContain('width=device-width')

  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  await expect(focused).not.toHaveCount(0)
  const focusStyle = await focused.evaluate((element) => {
    const style = getComputedStyle(element)
    return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) }
  })
  expect(focusStyle.outlineStyle).not.toBe('none')
  expect(focusStyle.outlineWidth).toBeGreaterThan(0)
}

async function visibleTextbox(page: Page, name: string): Promise<Locator> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const frame of page.frames()) {
      const candidate = frame.getByRole('textbox', { name }).filter({ visible: true }).first()
      if (await candidate.isVisible()) return candidate
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Hosted Checkout field did not become available: ${name}`)
}

export async function completeHostedStripeTestPayment(page: Page) {
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//)
  const card = page.getByRole('radio', { name: 'Card' })
  if (!(await card.isChecked())) await card.check({ force: true })
  await (await visibleTextbox(page, 'Card number')).fill('4242424242424242')
  await (await visibleTextbox(page, 'Expiration')).fill('1234')
  await (await visibleTextbox(page, 'CVC')).fill('123')
  await (await visibleTextbox(page, 'Cardholder name')).fill('Task Eighteen')
  await (await visibleTextbox(page, 'ZIP')).fill('94103')
  const save = page.getByRole('checkbox', { name: 'Save my information for faster checkout' }).filter({ visible: true }).first()
  if (await save.isChecked()) await save.uncheck()
  const disclosure = page.getByRole('checkbox', { name: 'I am an AI agent acting on behalf of someone else' }).filter({ visible: true }).first()
  if (await disclosure.isVisible()) {
    await disclosure.evaluate((element: HTMLInputElement) => element.click())
    await expect(disclosure).toBeChecked()
  }
  await page.getByRole('button', { name: 'Pay', exact: true }).filter({ visible: true }).first().click()
  await page.waitForURL((url) => url.origin === 'http://127.0.0.1:3000' && /^\/orders\//.test(url.pathname), { timeout: 30_000 })
}

type DriverInspection = {
  orders: Array<{
    order_handle: 'paid' | 'declined'
    status: string
    reconciliation_status: string
    subtotal_minor: number
    total_minor: number
  }>
  items: Array<{
    order_handle: 'paid' | 'declined'
    tier_label: 'ga' | 'vip'
    quantity: number
    subtotal_minor: number
  }>
  tickets: Array<{
    order_handle: 'paid' | 'declined'
    ticket_count: number
    unique_ticket_count: number
    valid_count: number
    bindings_valid: boolean
    sequences_valid: boolean
  }>
}

async function checkoutAttemptExists(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const token = location.pathname.split('/').at(-1)
    if (token === undefined || token.length === 0) return false
    return Array.from({ length: sessionStorage.length }, (_value, index) => sessionStorage.key(index))
      .some((key) => {
        if (key === null || !key.startsWith('whereto.checkout-attempt.v1:')) return false
        try {
          const value = JSON.parse(sessionStorage.getItem(key) ?? '') as Record<string, unknown>
          return value.confirmationBearer === token
        } catch {
          return false
        }
      })
  })
}

export async function deliverAndAssertRealPaidOrder(page: Page, fixture: TicketingJourneyFixture) {
  expect(await checkoutAttemptExists(page)).toBe(true)
  const beforeDelivery = await invokeDriver<DriverInspection>('inspect', { event_id: fixture.eventId })
  expect(beforeDelivery.orders).toHaveLength(1)
  expect(beforeDelivery.orders[0]).toMatchObject({
    order_handle: fixture.orderHandle,
    subtotal_minor: 5500,
    total_minor: 5500,
  })
  expect(beforeDelivery.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ order_handle: fixture.orderHandle, tier_label: 'ga', quantity: 2, subtotal_minor: 3000 }),
    expect.objectContaining({ order_handle: fixture.orderHandle, tier_label: 'vip', quantity: 1, subtotal_minor: 2500 }),
  ]))

  const delivered = await invokeDriver<{
    statuses: [number, number, number]
    receipt: { processing_status: string }
  }>('deliver_paid_materialization_retry', {
    event: {
      event_handle: randomUUID(),
      type: 'checkout.session.completed',
      object: 'checkout.session',
      order_handle: fixture.orderHandle,
      created: Math.floor(Date.now() / 1_000),
    },
  })
  expect(delivered).toMatchObject({ statuses: [503, 200, 200], receipt: { processing_status: 'processed' } })

  const paid = await invokeDriver<DriverInspection>('inspect', { event_id: fixture.eventId })
  expect(paid.orders).toContainEqual(expect.objectContaining({
    order_handle: fixture.orderHandle,
    status: 'paid',
    reconciliation_status: 'reconciled',
    subtotal_minor: 5500,
    total_minor: 5500,
  }))
  expect(paid.tickets).toContainEqual(expect.objectContaining({
    order_handle: fixture.orderHandle,
    ticket_count: 3,
    unique_ticket_count: 3,
    valid_count: 3,
    bindings_valid: true,
    sequences_valid: true,
  }))
}

export async function expectMatchingCheckoutAttemptCleared(page: Page) {
  await expect.poll(async () => await checkoutAttemptExists(page)).toBe(false)
}

export async function submitAfterOneAmbiguousResponse(page: Page, fixture: TicketingJourneyFixture) {
  const attempts: Array<{ clientRequestId: string; confirmationBearer: string }> = []
  let intercepted = false
  await page.route('**/functions/v1/stripe-create-checkout', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return await route.continue()
    const body = request.postDataJSON() as { clientRequestId?: unknown }
    const confirmationBearer = request.headers()['x-whereto-confirmation-bearer']
    if (typeof body.clientRequestId !== 'string' || typeof confirmationBearer !== 'string') {
      throw new Error('Checkout retry request is incomplete')
    }
    attempts.push({ clientRequestId: body.clientRequestId, confirmationBearer })
    if (!intercepted) {
      intercepted = true
      await route.fulfill({ contentType: 'application/json', status: 503, body: '{"error":{"code":"unavailable"}}' })
      return
    }
    await route.continue()
  })

  await page.getByLabel('Your name').fill('Task Eighteen Guest')
  await page.getByLabel('Email address').fill(fixture.buyerEmail)
  await page.getByRole('button', { name: 'Continue to secure payment' }).click()
  await expect(page.getByRole('alert')).toContainText('Secure checkout is unavailable')
  await page.reload()
  await page.getByLabel('Your name').fill('Task Eighteen Guest')
  await page.getByLabel('Email address').fill(fixture.buyerEmail)
  await page.getByRole('button', { name: 'Continue to secure payment' }).click()
  await expect.poll(() => attempts.length).toBe(2)
  expect(checkoutAttemptMatches(attempts[1], attempts[0])).toBe(true)
  await page.unroute('**/functions/v1/stripe-create-checkout')
}

export async function captureTicketingState(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:3000\//)
  await page.evaluate(() => {
    if (location.search || location.hash) history.replaceState(history.state, '', location.pathname)
  })
  expect(page.url()).not.toMatch(/[?#]/)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  const emailFields = page.getByLabel('Email address')
  for (let index = 0; index < await emailFields.count(); index += 1) {
    await expect(emailFields.nth(index)).toHaveValue('')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const visibleText = await page.locator('body').innerText()
  expect(unsafeVisibleEvidence.test(visibleText)).toBe(false)
  await page.evaluate(() => document.fonts.ready)
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(`${name}-${testInfo.project.name}`, { path, contentType: 'image/png' })
}
