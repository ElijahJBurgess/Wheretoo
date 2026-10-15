import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const styleDocument = (url: URL) => url.origin === 'https://api.mapbox.com' && url.pathname === '/styles/v1/mapbox/standard'
const captures = `.superpowers/map-startup/browser/${process.env.WHERETOO_MAP_STARTUP_BASE_URL ? 'hosted' : 'local'}`
test.beforeAll(() => mkdirSync(captures, { recursive: true }))
async function prepare(page: Page) {
  // This UI proof never signs in or mutates staging; only the two public map reads are allowed.
  await page.route('**/rest/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    return request.method() === 'POST' && !['/rest/v1/rpc/get_public_map_events', '/rest/v1/rpc/get_public_map_icon_versions'].includes(path)
      ? route.abort() : route.continue()
  })
}
async function ready(page: Page) {
  await expect(page.locator('[data-renderer-state]')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60000 })
  await expect(page.locator('.map-startup')).toHaveCount(0)
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('throttled startup, 15-second warning and late success recover without waiting for event requests', async ({ page }, info) => {
  await prepare(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(styleDocument, async route => { await gate; await route.continue() })
  // Leave the event request pending even after the base map becomes usable.
  let releaseEvents!: () => void
  const eventsGate = new Promise<void>(resolve => { releaseEvents = resolve })
  await page.route('**/rest/v1/rpc/get_public_map_events', async route => { await eventsGate; await route.abort() })
  await page.goto('/map', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('status', { name: 'Loading map' })).toBeVisible()
  await page.screenshot({ path: `${captures}/${info.project.name}-loading.png` })
  await expect(page.getByText('The map is taking longer than expected.')).toBeVisible({ timeout: 22000 })
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await page.screenshot({ path: `${captures}/${info.project.name}-slow.png` })
  release()
  await ready(page)
  releaseEvents()
  await expect(page.getByRole('button', { name: 'Retry events' })).toBeVisible({ timeout: 15000 })
  await page.screenshot({ path: `${captures}/${info.project.name}-ready.png` })
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.locator('.map-startup')).toHaveCount(0)
})

test('a genuine style failure offers keyboard retry and creates only one recovered map', async ({ page }, info) => {
  await prepare(page)
  let fail = true
  await page.route(styleDocument, route => fail
    ? route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"Deliberate style failure for startup regression"}' })
    : route.continue())
  await page.goto('/map', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('alert')).toContainText('We couldn’t load the map.')
  await page.screenshot({ path: `${captures}/${info.project.name}-error.png` })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t load the map.')
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)
  fail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).focus()
  await page.keyboard.press('Enter')
  await ready(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: `${captures}/${info.project.name}-retry-ready.png` })
})

test('reduced motion is static and embedded loading leaves site navigation available', async ({ page }) => {
  await prepare(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(styleDocument, async route => { await gate; await route.continue() })
  await page.goto('/discover', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('link', { name: 'Organize', exact: true })).toBeVisible()
  const logo = page.locator('.map-startup__logo')
  await expect(logo).toBeVisible()
  await expect(logo).toHaveCSS('animation-name', 'none')
  const overlay = page.locator('.map-startup')
  await expect(overlay).toHaveCSS('transition-duration', '0s')
  const bounds = await overlay.boundingBox()
  expect(bounds?.height).toBeLessThanOrEqual(360)
  release()
  await ready(page)
})

test('a recoverable glyph request failure during startup does not leave a stale map warning', async ({ page }) => {
  await prepare(page)
  let failedOnce = false
  await page.route(url => url.origin === 'https://api.mapbox.com' && url.pathname.startsWith('/fonts/v1/'), route => {
    if (!failedOnce) { failedOnce = true; return route.abort() }
    return route.continue()
  })
  await page.goto('/map', { waitUntil: 'domcontentloaded' })
  await ready(page)
  expect(failedOnce).toBe(true)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Map unavailable', { exact: true })).toHaveCount(0)
})
