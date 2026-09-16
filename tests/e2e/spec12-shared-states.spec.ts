import { expect, test, type Page, type Route } from '@playwright/test'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'

const event = {
  event: {
    id: eventId,
    title: 'Harbor Lights Workshop',
    description: 'Food, music, and neighborhood makers.',
    category: 'community',
    starts_at: '2026-09-01T02:00:00+00:00',
    ends_at: '2026-09-01T05:00:00+00:00',
    timezone: 'America/Los_Angeles',
    venue_name: 'Community Hall',
    address_line1: '100 Example Avenue',
    address_line2: null,
    city: 'Oakland',
    region: 'CA',
    postal_code: '94607',
    country_code: 'US',
    latitude: 37.8044,
    longitude: -122.2712,
    artwork_path: null,
    animation_preset: 'generic',
    minimum_age: 'all_ages',
    advisories: [],
    organizer: { id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', display_name: 'Sample Organizer' },
    admission_type: 'paid',
  },
  tiers: [{
    id: '900a9142-9111-4f87-84d5-b8545a94c7fb', name: 'General admission', description: 'Entry to the event.',
    unit_amount_minor: 2500, currency: 'usd', availability_status: 'available',
  }],
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function interceptPublicRead(page: Page, responses: Array<'slow' | 'error' | 'empty' | 'data' | 'malformed'>) {
  let reads = 0
  let writes = 0
  await page.route('**/rest/v1/rpc/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name !== 'get_public_event_ticketing' && name !== 'get_public_event') {
      writes += 1
      return json(route, { message: 'blocked synthetic mutation' }, 503)
    }
    reads += 1
    const response = responses.shift() ?? 'data'
    if (response === 'slow') {
      await new Promise(resolve => setTimeout(resolve, 2_500))
      return json(route, { message: 'synthetic slow read failure' }, 503)
    }
    if (response === 'error') return json(route, { message: 'synthetic read failure' }, 503)
    if (response === 'malformed') return json(route, { unexpected: true })
    if (response === 'empty') return json(route, [])
    return json(route, [event])
  })
  return { get reads() { return reads }, get writes() { return writes } }
}

test('development gallery covers semantic states, headings, actions, focus, announcements, and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/preview/shared-states')
  await expect(page.getByRole('heading', { level: 1, name: 'Clear moments. Better experiences.' })).toBeVisible()
  for (const title of ['No events yet', 'No orders yet', 'Something went wrong', 'This page isn’t here', 'You don’t have access', 'Tickets unavailable', 'You’re offline']) {
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible()
  }
  await expect(page.getByText('DEFERRED — MAP OWNER')).toHaveCount(3)
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  await expect(focused).toBeVisible()
  await expect(page.locator('[role="alert"]').first()).toHaveAttribute('aria-live', 'assertive')
  await expect(page.locator('[role="status"][aria-busy="true"]').first()).toBeVisible()
  await expect(page.locator('.ui-state-skeleton').first()).toHaveAttribute('aria-hidden', 'true')
  const animation = await page.locator('.ui-state-skeleton i').first().evaluate(node => getComputedStyle(node).animationName)
  expect(animation).toBe('none')
})

for (const width of [320, 390, 768, 1440]) {
  test(`gallery is bounded at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 })
    await page.goto('/preview/shared-states')
    await expect(page.getByRole('heading', { level: 1, name: 'Clear moments. Better experiences.' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `test-results/spec12-shared-states/gallery-${width}.png` })
    await page.getByRole('heading', { name: 'Loading events' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `test-results/spec12-shared-states/gallery-${width}-below.png` })
  })
}

test('production public route uses controlled reads for slow, error, safe retry, success, and authoritative absence', async ({ page }) => {
  const transport = await interceptPublicRead(page, ['slow', 'data'])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/events/${eventId}`)
  await expect(page.getByRole('heading', { name: 'Loading event' })).toBeVisible()
  await page.screenshot({ path: 'test-results/spec12-shared-states/route-loading-390.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: 'test-results/spec12-shared-states/route-loading-1440.png' })
  await expect(page.getByRole('heading', { name: 'Event could not load' })).toBeVisible()
  await page.screenshot({ path: 'test-results/spec12-shared-states/route-error-1440.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/spec12-shared-states/route-error-390.png' })
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: event.event.title })).toBeVisible()
  expect(transport.reads).toBe(2)
  expect(transport.writes).toBe(0)

  await page.unrouteAll({ behavior: 'wait' })
  const absent = await interceptPublicRead(page, ['empty', 'empty'])
  await page.goto(`/events/${eventId}`)
  await expect(page.getByRole('heading', { name: 'Event not found' })).toBeVisible()
  expect(absent.reads).toBe(2)
  expect(absent.writes).toBe(0)
})

test('offline initial read becomes an honest passive connectivity state without retry effects', async ({ page }) => {
  await page.addInitScript(() => {
    let online = true
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
    Object.defineProperty(window, '__spec12SetOnline', { value: (value: boolean) => { online = value } })
  })
  const transport = await interceptPublicRead(page, ['slow', 'data'])
  await page.goto(`/events/${eventId}`)
  await expect(page.getByRole('heading', { name: 'Loading event' })).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { __spec12SetOnline(value: boolean): void }).__spec12SetOnline(false)
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.getByRole('heading', { name: 'Waiting for a connection' })).toBeVisible()
  expect(transport.writes).toBe(0)
})

test('malformed checkout and unmatched route remain sanitized and perform no mutation', async ({ page }) => {
  let requests = 0
  await page.route('http://127.0.0.1:59992/**', route => { requests += 1; return json(route, {}) })
  await page.goto('/events/not-a-valid-id/checkout')
  await expect(page.getByRole('heading', { name: 'Checkout unavailable' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/spec12-shared-states/checkout-malformed-390.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: 'test-results/spec12-shared-states/checkout-malformed-1440.png' })
  expect(requests).toBe(0)
  for (const missing of ['/events/checkout', '/events//checkout']) {
    await page.goto(missing)
    await expect(page.getByRole('heading', { name: 'Checkout unavailable' })).toBeVisible()
    expect(requests).toBe(0)
  }
  await page.goto('/private-looking/secret-value')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('secret-value')
  expect(requests).toBe(0)
})
