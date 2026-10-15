import { expect, test } from '@playwright/test'

const scenes = {
  'desktop-chromium': [
    { name: 'oakland-desktop', query: '', center: [-122.263, 37.804], zoom: 14.6, pitch: 25 },
    { name: 'sf-desktop', query: '?visualScene=sf-desktop', center: [-122.4194, 37.7599], zoom: 14.6, pitch: 25 },
  ],
  'mobile-chromium': [
    { name: 'oakland-mobile', query: '', center: [-122.263, 37.804], zoom: 14.8, pitch: 12 },
    { name: 'sf-mobile', query: '?visualScene=sf-mobile', center: [-122.4194, 37.7599], zoom: 14.8, pitch: 12 },
  ],
} as const

for (const [project, projectScenes] of Object.entries(scenes)) {
  test.describe(project, () => {
    for (const scene of projectScenes) {
      test(`${scene.name} renders genuine context and accepted Standard configuration`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== project)
        const errors: string[] = []
        const failedRequests: string[] = []
        page.on('pageerror', (error) => errors.push(error.name))
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().replace(/pk\.[\w.-]+/g, '[redacted]')) })
        page.on('requestfailed', (request) => failedRequests.push(new URL(request.url()).hostname))

        await page.goto(`/map${scene.query}`, { waitUntil: 'domcontentloaded' })
        const main = page.locator('main[data-renderer-state]')
        await expect(main).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60_000 })
        await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '0')
        await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)
        await expect(page.locator('.mapboxgl-ctrl-logo')).toBeVisible()
        await expect(page.locator('.mapboxgl-ctrl-attrib')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible()

        const readback = JSON.parse(await page.locator('.living-map__canvas').getAttribute('data-standard-config') ?? '{}')
        expect(readback).toMatchObject({
          lightPreset: 'night', theme: 'monochrome', font: 'Manrope',
          showPointOfInterestLabels: true, showRoadLabels: true, showPedestrianRoads: true,
          showPlaceLabels: true, colorModePointOfInterestLabels: 'single',
          backgroundPointOfInterestLabels: 'none',
          showTransitLabels: false, showLandmarkIcons: false, showLandmarkIconLabels: false,
          showIndoor: false, showIndoorLabels: false, show3dObjects: true, show3dBuildings: true,
          show3dFacades: false, show3dLandmarks: false, show3dTrees: false,
          densityPointOfInterestLabels: project === 'mobile-chromium' ? 2 : 3,
        })
        const camera = JSON.parse(await page.locator('.living-map__canvas').getAttribute('data-camera') ?? '{}')
        expect(camera.center[0]).toBeCloseTo(scene.center[0], 3)
        expect(camera.center[1]).toBeCloseTo(scene.center[1], 3)
        expect(camera.zoom).toBeCloseTo(scene.zoom, 1)
        expect(camera.pitch).toBeCloseTo(scene.pitch, 1)
        expect(camera.bearing).toBe(0)
        await expect(page.locator('#wheretoo-buildings')).toHaveCount(0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

        await page.waitForTimeout(500)
        await page.screenshot({ path: testInfo.outputPath(`${scene.name}.png`), fullPage: false })
        expect(errors).toEqual([])
        expect(failedRequests).toEqual([])
      })
    }
  })
}

test('the consumer map pans, zooms, resizes without reset, and survives direct refresh', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium')
  await page.goto('/map')
  const canvas = page.locator('.living-map__canvas')
  await expect(page.locator('main')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60_000 })
  const before = JSON.parse(await canvas.getAttribute('data-camera') ?? '{}')

  const box = await page.locator('.mapboxgl-canvas').boundingBox()
  if (!box) throw new Error('Map canvas has no interactive bounds')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-camera') ?? '{}').center)
    .not.toEqual(before.center)
  const panned = JSON.parse(await canvas.getAttribute('data-camera') ?? '{}')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-camera') ?? '{}').zoom)
    .toBeGreaterThan(before.zoom)
  const moved = JSON.parse(await canvas.getAttribute('data-camera') ?? '{}')
  expect(panned.center).not.toEqual(before.center)
  expect(moved.zoom).toBeGreaterThan(before.zoom)

  await page.setViewportSize({ width: 1000, height: 760 })
  await page.waitForTimeout(300)
  const resized = JSON.parse(await canvas.getAttribute('data-camera') ?? '{}')
  expect(resized.center[0]).toBeCloseTo(moved.center[0], 3)
  expect(resized.center[1]).toBeCloseTo(moved.center[1], 3)
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('main')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60_000 })
})

test('Oakland remains usable at the narrow and wider sanity viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium')
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/map')
  await expect(page.locator('main')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60_000 })
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.setViewportSize({ width: 1680, height: 900 })
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.waitForTimeout(700)
  const camera = JSON.parse(await page.locator('.living-map__canvas').getAttribute('data-camera') ?? '{}')
  expect(camera.zoom).toBeCloseTo(12.8, 0)
  await expect(page.locator('.mapboxgl-ctrl-logo')).toBeVisible()
})
