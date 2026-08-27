import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { Database } from '../../../src/lib/supabase/database.types'
import { loadTask18E2EEnv } from './e2eEnv'
import {
  task18EventTitle,
  task18MapboxFeatureId,
  type TicketingProjectName,
} from './ticketingFixture'

const env = loadTask18E2EEnv()

export type TicketingJourneyFixture = {
  eventId: string
  organizerEmail: string
  organizerPassword: string
  organizerName: string
  publicEventPath: string
  title: string
  buyerEmail: string
}

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

export async function prepareTicketingJourney(
  projectName: string,
  scenario: 'purchase' | 'visual',
): Promise<TicketingJourneyFixture> {
  if (projectName !== 'mobile-chromium' && projectName !== 'desktop-chromium') {
    throw new Error(`Unsupported Task 18 Playwright project: ${projectName}`)
  }
  const proof = await invokeDriver<Record<string, unknown>>('server_proof')
  expect(proof).toMatchObject({
    ok: true,
    livemode: false,
    connected_account_matches: true,
    transfers_status: 'active',
    payouts_status: 'active',
    requirements_status: 'clear',
  })

  const client = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const signIn = await client.auth.signInWithPassword({
    email: env.organizerAEmail,
    password: env.organizerAPassword,
  })
  if (signIn.error || !signIn.data.user) throw new Error('TASK18_FIXTURE_SIGN_IN_FAILED')
  const typedProjectName = projectName as TicketingProjectName
  const title = task18EventTitle(typedProjectName, scenario)
  const mapboxFeatureId = task18MapboxFeatureId(env.task18FixturePrefix, typedProjectName, scenario)
  const existing = await client.from('events').select('id, mapbox_feature_id')
    .eq('mapbox_feature_id', mapboxFeatureId).maybeSingle()
  if (existing.error) throw new Error('TASK18_FIXTURE_EVENT_LOOKUP_FAILED')
  let eventId = existing.data?.id
  if (!eventId) {
    const startsAt = new Date(Date.now() + 14 * 86_400_000)
    const created = await client.from('events').insert({
      organizer_id: signIn.data.user.id,
      title,
      description: 'A disposable credentialed browser proof for native Whereto tickets.',
      category: 'music',
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      timezone: 'America/Los_Angeles',
      venue_name: 'Task 18 Test Venue',
      address_line1: '1 Market Street',
      city: 'San Francisco',
      region: 'CA',
      postal_code: '94105',
      country_code: 'US',
      mapbox_feature_id: mapboxFeatureId,
      latitude: 37.7936,
      longitude: -122.3958,
      admission_type: 'paid',
      capacity: 9,
    }).select('id').single()
    if (created.error) throw new Error('TASK18_FIXTURE_EVENT_CREATE_FAILED')
    eventId = created.data.id
  }
  await client.auth.signOut()
  return {
    eventId,
    organizerEmail: env.organizerAEmail,
    organizerPassword: env.organizerAPassword,
    organizerName: 'Whereto Task 18 Organizer',
    publicEventPath: `/events/${eventId}`,
    title,
    buyerEmail: `${env.task18FixturePrefix}-${projectName}@example.invalid`,
  }
}

export async function signOutTicketingOrganizer(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/auth\/sign-in$/)
}

export async function signInTicketingOrganizer(page: Page, fixture: TicketingJourneyFixture) {
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(fixture.organizerEmail)
  await page.getByLabel('Password').fill(fixture.organizerPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/organizer\/events$/)
}

export async function signInCrossUser(page: Page) {
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(env.organizerBEmail)
  await page.getByLabel('Password').fill(env.organizerBPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/organizer\/events$/)
}

export async function configureThreeTicketTiers(page: Page) {
  const definitions = [
    { name: 'First release', price: '12.00', capacity: '1', description: 'A limited first-release ticket.' },
    { name: 'General admission', price: '18.50', capacity: '3', description: 'Standard admission to the event.' },
    { name: 'Supporter', price: '30.01', capacity: '5', description: 'Admission with extra support for the organizer.' },
  ]
  for (let index = 0; index < definitions.length; index += 1) {
    if (await page.locator('.ticket-tier-card').count() <= index) {
      await page.getByRole('button', { name: 'Add ticket tier' }).click()
    }
    const tier = page.locator('.ticket-tier-card').nth(index)
    await tier.getByLabel('Name').fill(definitions[index].name)
    await tier.getByLabel(new RegExp(`Price for ${definitions[index].name}`)).fill(definitions[index].price)
    await tier.getByLabel('Capacity').fill(definitions[index].capacity)
    await tier.getByLabel('Description (optional)').fill(definitions[index].description)
  }
  await expect(page.locator('.ticket-tier-card')).toHaveCount(3)
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

export async function deliverCheckoutWebhook(fixture: TicketingJourneyFixture) {
  type Inspection = {
    orders: Array<{
      id: string
      buyer_email: string
      status: string
      stripe_checkout_session_id: string | null
      total_minor: number
      application_fee_amount_minor: number
      expected_organizer_proceeds_minor: number
    }>
    tickets: Array<{ order_id: string }>
  }
  let state = await invokeDriver<Inspection>('inspect', { event_id: fixture.eventId })
  const order = state.orders.filter((candidate) => candidate.buyer_email === fixture.buyerEmail).at(-1)
  expect(order?.stripe_checkout_session_id).toMatch(/^cs_test_/)
  const eventId = `evt_task17${randomUUID().replaceAll('-', '')}`
  const delivered = await invokeDriver<{ status: number }>('deliver', {
    event: {
      event_id: eventId,
      type: 'checkout.session.completed',
      object: 'checkout.session',
      object_id: order!.stripe_checkout_session_id,
      created: Math.floor(Date.now() / 1_000),
    },
  })
  expect(delivered.status).toBe(200)
  state = await invokeDriver<Inspection>('inspect', { event_id: fixture.eventId })
  const paidOrder = state.orders.find((candidate) => candidate.id === order!.id)
  const expectedFee = Math.floor(order!.total_minor * 0.05) + 50
  expect(paidOrder).toMatchObject({
    status: 'paid',
    application_fee_amount_minor: expectedFee,
    expected_organizer_proceeds_minor: order!.total_minor - expectedFee,
  })
  expect(state.tickets.filter((ticket) => ticket.order_id === order!.id)).toHaveLength(1)
  const reconciliation = await invokeDriver<Record<string, unknown>>('reconcile_payment', { order_id: order!.id })
  expect(reconciliation).toMatchObject({
    ok: true,
    livemode: false,
    connected_account_matches: true,
    persisted_ids_match: true,
    total_minor: order!.total_minor,
    application_fee_actual: expectedFee,
    transfer_less_application_fee: order!.total_minor - expectedFee,
  })
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
  await page.evaluate(() => document.fonts.ready)
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(`${name}-${testInfo.project.name}`, { path, contentType: 'image/png' })
}
