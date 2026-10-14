import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const routes = [
  { path: '/auth/sign-in', content: /^Sign in$/ },
  { path: '/auth/sign-up', content: /^Create your organizer account$/ },
  { path: '/auth/check-email', content: /^Check your email$/ },
  { path: '/events/not-valid', content: /^Event (not found|could not load)$/ },
  { path: '/events/not-valid/checkout', content: /^(Checkout unavailable|Checkout could not load|This cart is unavailable)$/ },
  { path: '/orders/invalid', content: /^Order (not found|could not load)$/ },
  { path: '/tickets/invalid', content: /^(Tickets unavailable|No tickets available)$/ },
  { path: '/organizer/events', content: /^Sign in$/, redirect: '/auth/sign-in' },
  { path: '/organizer/setup', content: /^Sign in$/, redirect: '/auth/sign-in' },
  { path: '/organizer-terms', content: /Whereto Organizer Terms will be finalized before public launch/ },
  { path: '/event-policy', content: /Whereto Event Policy will be finalized before public launch/ },
  { path: '/missing', content: /^Page not found$/ },
] as const

function safeUrl(value: string): string {
  const url = new URL(value)
  const pathname = url.pathname.replace(/\/(tickets|orders)\/[^/]+/g, '/$1/[redacted]')
  return `${url.origin}${pathname}`
}

function safeError(message: string): string {
  return message.replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
    try { return safeUrl(value) } catch { return '[url]' }
  }).replace(/\b(?:sb_secret_|sk_(?:live|test)_|eyJ)[A-Za-z0-9._-]+/g, '[redacted]')
}

for (const route of routes) {
  test(`${route.path} reaches a usable public state`, async ({ page }, testInfo) => {
    const errors: string[] = []
    const failedRequests: { url: string; reason: string }[] = []
    const failedResponses: { url: string; status: number }[] = []
    page.on('pageerror', (error) => errors.push(safeError(error.message)))
    page.on('requestfailed', (request) => failedRequests.push({
      url: safeUrl(request.url()), reason: safeError(request.failure()?.errorText ?? 'Unknown failure'),
    }))
    page.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push({ url: safeUrl(response.url()), status: response.status() })
    })

    try {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(route.content).first()).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
      await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0)
      if ('redirect' in route) expect(new URL(page.url()).pathname).toBe(route.redirect)
      expect(errors).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    } finally {
      const diagnosticsPath = testInfo.outputPath('route-diagnostics.json')
      await writeFile(diagnosticsPath, JSON.stringify({
        route: route.path, finalPath: new URL(page.url()).pathname, errors, failedRequests, failedResponses,
      }, null, 2))
      await testInfo.attach('route-diagnostics', {
        path: diagnosticsPath,
        contentType: 'application/json',
      })
    }
  })
}

async function inspectMapJourney(page: Page, testInfo: TestInfo, journey: () => Promise<void>) {
  const errors: string[] = []
  const consoleErrors: string[] = []
  const failedRequests: { url: string; reason: string }[] = []
  const failedResponses: { url: string; status: number }[] = []
  page.on('pageerror', error => errors.push(safeError(error.message)))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(safeError(message.text())) })
  page.on('requestfailed', request => failedRequests.push({
    url: safeUrl(request.url()), reason: safeError(request.failure()?.errorText ?? 'Unknown failure'),
  }))
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push({ url: safeUrl(response.url()), status: response.status() })
  })
  try {
    await journey()
    expect(errors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    await page.screenshot({ path: testInfo.outputPath('final-map-state.png'), fullPage: true, scale: 'css' })
    const diagnosticsPath = testInfo.outputPath('map-diagnostics.json')
    await writeFile(diagnosticsPath, JSON.stringify({ finalPath: new URL(page.url()).pathname, errors, consoleErrors, failedRequests, failedResponses }, null, 2))
    await testInfo.attach('map-diagnostics', { path: diagnosticsPath, contentType: 'application/json' })
  }
}

async function mapReady(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.living-map')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60_000 })
  await expect(page.locator('.mapboxgl-canvas')).toBeVisible()
  await expect.poll(async () => (
    Number(await page.locator('.living-map__canvas').getAttribute('data-wheretoo-event-count')) > 0
      || await page.getByText('No events in this area yet', { exact: true }).isVisible()
  )).toBe(true)
  await expect(page.getByText('Updating events…', { exact: true })).toHaveCount(0)
  await expect(page.locator('.living-map__interaction-error')).toHaveCount(0)
}

test('@map home opens the live map and its filters', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await inspectMapJourney(page, testInfo, async () => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /Your city\.\s*Your next plan\./ })).toBeVisible()
    await mapReady(page)
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true, scale: 'css' })
    await page.getByRole('link', { name: /Explore the map/ }).last().click()
    await expect(page).toHaveURL(/\/map$/)
    await mapReady(page)
    await page.screenshot({ path: testInfo.outputPath('live-map.png'), scale: 'css' })
    await page.getByRole('combobox', { name: 'When', exact: true }).selectOption('today')
    await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('music')
    await mapReady(page)
    await page.getByRole('button', { name: /Events in view/ }).click()
    await expect(page.getByRole('region', { name: 'Events in view' })).toBeVisible()
    await page.getByRole('button', { name: 'Close event list' }).click()
    await expect(page.getByRole('region', { name: 'Events in view' })).toHaveCount(0)
  })
})

test('@map development fixture selection remains visibly a demo', async ({ page }, testInfo) => {
  test.skip(process.env.WHERETO_SMOKE_PRODUCTION === '1', 'Development fixtures are excluded from production.')
  test.setTimeout(90_000)
  await inspectMapJourney(page, testInfo, async () => {
    await page.goto('/map?mapFixture=standard', { waitUntil: 'domcontentloaded' })
    await mapReady(page)
    await page.getByRole('button', { name: /Events in view/ }).click()
    await page.getByRole('button', { name: 'Day Party Lake Merritt Patio' }).click()
    await expect(page.getByRole('region', { name: 'Day Party' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'View event', exact: true })).toBeDisabled()
    await expect(page.getByText('Demo event', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('fixture-map-selected.png'), scale: 'css' })
    await page.getByRole('button', { name: 'Close event preview' }).click()
    await expect(page.getByRole('region', { name: 'Day Party' })).toHaveCount(0)
  })
})

test('@map a public event selection opens its event route', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const eventId = '11111111-1111-4111-8111-111111111111'
  await page.route('**/rest/v1/rpc/get_public_map_events?*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([{
      event_id: eventId, title: 'Map navigation smoke event', category: 'community',
      starts_at: new Date(Date.now() + 60_000).toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      timezone: 'America/Los_Angeles', latitude: 37.807, longitude: -122.259,
      animation_preset: 'generic', venue_label: 'Lake Merritt', admission_type: 'free', minimum_price_minor: null,
      minimum_age: 'all_ages', advisories: [], artwork_reference: null,
    }]),
  }))
  await page.route('**/rest/v1/rpc/get_public_event_ticketing', route => route.fulfill({ contentType: 'application/json', body: 'null' }))
  await inspectMapJourney(page, testInfo, async () => {
    await page.goto('/map', { waitUntil: 'domcontentloaded' })
    await mapReady(page)
    await expect(page.getByRole('button', { name: 'Events in view (1)' })).toBeVisible()
    await page.getByRole('button', { name: 'Events in view (1)' }).click()
    await page.getByRole('button', { name: 'Map navigation smoke event Lake Merritt' }).click()
    await expect(page.getByRole('region', { name: 'Map navigation smoke event' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('public-map-selected.png'), scale: 'css' })
    await page.getByRole('link', { name: 'View event', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`))
    await expect(page.getByRole('heading', { name: 'Event not found', exact: true })).toBeVisible()
  })
})
