import { expect, test } from '@playwright/test'
import { discoveryRows, fulfillMap } from './support/discoveryFixtures'
import { mapReference, darkReady } from './support/combinedMapObservations'

test.beforeEach(async ({ page }) => {
  // Anonymous read-only acceptance; no auth, publication or transaction actions.
  await page.route('**/rest/v1/**', route => ['get_public_map_icon_versions', 'list_event_images']
    .some(name => new URL(route.request().url()).pathname.endsWith(`/${name}`)) ? route.continue() : route.abort())
  await page.route('**/rest/v1/rpc/get_public_filtered_map_events', route => fulfillMap(route, discoveryRows()))
})

test('nine approved icons retain dark map, mobile fallback selection and cluster expansion', async ({ page }, info) => {
  await page.goto('/map')
  await mapReference(page)
  const mobile = info.project.name === 'mobile'
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  await page.waitForFunction(expected => window.__phase4Map.listImages().filter(id => id.startsWith('wheretoo-icon-')).length === expected, mobile ? 8 : 9)
  await darkReady(page)
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
  const candidate = await page.evaluate(mobile => {
    const map = window.__phase4Map
    const events = map.querySourceFeatures('wheretoo-events') as unknown as Array<{ properties?: { eventId?: string; mapIconVersionId?: string; title?: string }; geometry: { type: string; coordinates: number[] } }>
    const images = map.listImages()
    const feature = mobile
      ? events.find(event => !images.some(id => id.startsWith(`wheretoo-icon-${event.properties?.mapIconVersionId}-`)))
      : events.find(event => event.properties?.title?.includes('Live Performance')) ?? events[0]
    if (!feature || feature.geometry.type !== 'Point') throw new Error('Expected public staging icon fixture')
    const coordinates = feature.geometry.coordinates as [number, number]
    const point = map.project(coordinates)
    return { id: String(feature.properties?.eventId), version: String(feature.properties?.mapIconVersionId), x: point.x, y: point.y }
  }, mobile)
  await page.screenshot({ path: info.outputPath('ready-nine-icons.png') })
  const canvasBox = (await page.locator('.mapboxgl-canvas').boundingBox())!
  if (mobile) await page.touchscreen.tap(candidate.x + canvasBox.x, candidate.y + canvasBox.y)
  else await page.mouse.click(candidate.x + canvasBox.x, candidate.y + canvasBox.y)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', candidate.id)
  await page.waitForFunction(version => window.__phase4Map.listImages().some(id => id.startsWith(`wheretoo-icon-${version}-`)), candidate.version)
  expect(await page.evaluate(() => window.__phase4Map.listImages().filter(id => id.startsWith('wheretoo-icon-')).length)).toBe(mobile ? 8 : 9)
  await expect(page.getByRole('button', { name: 'Close event preview', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('selected-icon.png') })
  await page.getByRole('button', { name: 'Close event preview', exact: true }).click()
  await page.evaluate(() => window.__phase4Map.jumpTo({ center: [-122.263, 37.804], zoom: 11.5 }))
  await page.waitForFunction(() => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] }).length > 0)
  const cluster = await page.evaluate(() => {
    const map = window.__phase4Map, feature = map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] })[0]
    const point = map.project(feature.geometry.coordinates as [number, number])
    return { x: point.x, y: point.y, zoom: map.getZoom() }
  })
  if (mobile) await page.touchscreen.tap(cluster.x + canvasBox.x, cluster.y + canvasBox.y)
  else await page.mouse.click(cluster.x + canvasBox.x, cluster.y + canvasBox.y)
  await expect.poll(() => page.evaluate(() => window.__phase4Map.getZoom())).toBeGreaterThan(cluster.zoom)
  expect(await canvas?.evaluate(node => node.isConnected)).toBe(true)
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('failed foreground refresh keeps markers and retry restores a complete response', async ({ page }) => {
  await page.goto('/map')
  await mapReference(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  let fail = true, requests = 0
  await page.route('**/rest/v1/rpc/get_public_filtered_map_events', route => { requests++; return fail ? route.abort() : fulfillMap(route, discoveryRows()) })
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(page.getByRole('button', { name: 'Retry events', exact: true })).toBeVisible()
  expect(requests).toBe(1)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)
  fail = false
  await page.getByRole('button', { name: 'Retry events', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry events', exact: true })).toHaveCount(0)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
})
