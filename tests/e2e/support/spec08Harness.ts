import { expect, type Page, type Route } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
export const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
export const tierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
export const publicEvent = {
  event: {
    id: eventId,
    title: 'Night Market',
    description: 'Food, music, and neighborhood makers.',
    category: 'community',
    starts_at: '2026-09-01T02:00:00+00:00',
    ends_at: '2026-09-01T05:00:00+00:00',
    timezone: 'America/Los_Angeles',
    venue_name: 'Civic Center Plaza',
    address_line1: '1 Dr Carlton B Goodlett Place',
    address_line2: null,
    city: 'San Francisco',
    region: 'CA',
    postal_code: '94102',
    country_code: 'US',
    latitude: 37.7793,
    longitude: -122.4193,
    artwork_path: null,
    animation_preset: 'generic',
    admission_type: 'paid',
    minimum_age: 'all_ages',
    advisories: [],
    organizer: { id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', display_name: 'Bay City Arts' },
  },
  tiers: [{
    id: tierId,
    name: 'General admission',
    description: 'Entry to the market.',
    unit_amount_minor: 2_500,
    currency: 'usd',
    availability_status: 'available',
  }, {
    id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe',
    name: 'VIP',
    description: 'Early access and a reserved lounge.',
    unit_amount_minor: 7_500,
    currency: 'usd',
    availability_status: 'available',
  }],
}

export const token = 'A'.repeat(43)
export const checkoutPath = `/events/${eventId}/checkout?item=${tierId}%3A1`
export const storageKey = `whereto.checkout-attempt.v1:${eventId}`
export const order = {
  event: { title: 'Night Market', startsAt: '2026-09-30T02:00:00Z', endsAt: '2026-09-30T05:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Civic Center Plaza' },
  items: [{ tierName: 'General admission', quantity: 1, unitAmountMinor: 2500, subtotalMinor: 2500, currency: 'usd' }],
  orderNumber: 'WT-FIXTURE-08', status: 'processing', quantity: 1, currency: 'usd', subtotalMinor: 2500, taxAmountMinor: 0, totalMinor: 2500,
}
export type Fixture = {
  event: typeof publicEvent; free: boolean; full: boolean; remaining: number | null;
  payment: string; createCode: string | null; createLost: boolean; cancelCode: string | null; cancelGate?: Promise<void>;
  creates: Array<{ body: Record<string, unknown>; bearer: string | undefined }>; checks: string[]; cancels: string[]; deliveryChecks: number; collectionReads: string[];
}
export async function fixture(page: Page): Promise<Fixture> {
  const state: Fixture = { event: structuredClone(publicEvent), free: false, full: false, remaining: 4, payment: 'processing', createCode: null, createLost: false, cancelCode: null, creates: [], checks: [], cancels: [], deliveryChecks: 0, collectionReads: [] }
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'))
  await page.route('https://spec10-local.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON() as Record<string, unknown> | null
    if (path.endsWith('/get_public_event_ticketing')) return json(route, state.free ? [] : [state.event])
    if (path.endsWith('/get_public_event')) return json(route, [{ ...state.event.event, admission_type: 'free' }])
    if (path.endsWith('/get_public_free_rsvp')) return json(route, { event: { ...state.event.event, admission_type: 'free' }, availability: { status: state.full ? 'full' : 'available', remaining: state.full ? 0 : state.remaining, maxQuantity: 10 } })
    if (path.endsWith('/stripe-create-checkout')) {
      state.creates.push({ body: body!, bearer: route.request().headers()['x-whereto-confirmation-bearer'] })
      if (state.createLost) return route.abort('timedout')
      if (state.createCode) return json(route, { error: { code: state.createCode } }, 409)
      return json(route, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_Spec08Hosted' })
    }
    if (path.endsWith('/order-confirmation')) {
      state.checks.push(String(body?.confirmationToken))
      if (state.payment === 'unknown') return json(route, { error: { code: 'ORDER_UNAVAILABLE' } }, 503)
      if (state.payment === 'missing') return json(route, { error: { code: 'ORDER_NOT_FOUND' } }, 404)
      return json(route, { ...order, status: state.payment })
    }
    if (path.endsWith('/stripe-cancel-checkout')) {
      state.cancels.push(String(body?.confirmationToken)); await state.cancelGate
      if (state.cancelCode) return json(route, { error: { code: state.cancelCode } }, 409)
      state.payment = 'cancelled'; return json(route, { cancelled: true })
    }
    if (path.endsWith('/ticket-collection')) {
      state.collectionReads.push(String(body?.collectionBearer))
      return json(route, { kind: 'ready', collection: { collectionLabel: 'Night Market tickets', eventId, tickets: [{
        selector: 'c9300000-0000-4000-8000-000000000003', eventId, eventName: 'Night Market',
        startsAt: order.event.startsAt, endsAt: order.event.endsAt, venueName: 'Civic Center Plaza',
        admissionLabel: 'General admission', position: 1, totalInCollection: 1, status: 'valid',
        admissionCredential: 'wta1_' + 'b'.repeat(42) + 'A',
      }] } })
    }
    if (path.endsWith('/ticket-email-status')) { state.deliveryChecks++; return json(route, { state: 'failed', observation: null }) }
    if (path.endsWith('/free-rsvp')) return json(route, { kind: 'rejected', reason: 'full', remaining: 1 })
    if (path.endsWith('/free-rsvp-status')) return json(route, { kind: 'not_found' })
    return json(route, { error: { code: 'FIXTURE_UNEXPECTED_ENDPOINT' } }, 500)
  })
  // This is only a navigation boundary fixture, never Stripe TEST evidence.
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Hosted Checkout navigation fixture</h1>' }))
  return state
}
export async function submit(page: Page) {
  await page.getByLabel('Your name', { exact: true }).fill('Fixture Buyer')
  await page.getByLabel('Email address', { exact: true }).fill('fixture@example.invalid')
  await page.getByRole('button', { name: 'Continue to secure payment', exact: true }).click()
}
export async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  const geometry = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth }))
  expect(geometry.overflow).toBeLessThanOrEqual(1)
  await expect(page.locator('input[autocomplete="cc-number"]')).toHaveCount(0)
  await mkdir('.superpowers/spec08/screenshots', { recursive: true })
  await page.screenshot({ path: `.superpowers/spec08/screenshots/${name}.png`, fullPage: true })
}
