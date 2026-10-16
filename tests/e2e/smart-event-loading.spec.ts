import { expect, test } from '@playwright/test'
import { discoveryRows, fulfillMap } from './support/discoveryFixtures'
import { mapReference } from './support/combinedMapObservations'

test('loading, initial failure, retained refresh, empty and partial results stay interactive', async ({ page }) => {
  let mode: 'failure' | 'rows' | 'empty' | 'partial' = 'failure'
  let delay = 0
  let seed: Array<Record<string, unknown>> = []
  await page.route('**/rest/v1/rpc/get_public_filtered_map_events', async route => {
    if (!seed.length) seed = discoveryRows()
    const current = mode
    await new Promise(resolve => setTimeout(resolve, delay))
    if (current === 'failure') return route.abort()
    const rows = current === 'empty' ? [] : current === 'partial'
      ? Array.from({ length: 1000 }, (_, i) => ({ ...seed[i % seed.length], event_id: `39000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` })) : seed
    await fulfillMap(route, rows, current === 'partial' ? 2000 : rows.length)
  })
  await page.goto('/map')
  await mapReference(page)
  await expect(page.getByText('Events couldn’t load. Try again.')).toBeVisible()
  mode = 'rows'; delay = 1500
  await page.getByRole('button', { name: 'Retry events', exact: true }).click()
  await expect(page.getByText('Loading events…')).toBeVisible()
  await expect(page.locator('.living-map__surface')).not.toHaveAttribute('inert')
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  await expect(page.getByText('Loading events…')).toHaveCount(0)
  mode = 'empty'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('Updating events…')).toBeVisible()
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  await expect(page.getByText('No events found in this area.')).toBeVisible()
  const emptyCopy = await page.locator('.living-map__event-status > span').boundingBox()
  const broaden = await page.getByRole('button', { name: 'Zoom out to search a wider area', exact: true }).boundingBox()
  expect(emptyCopy && broaden && emptyCopy.width >= 160 && broaden.y >= emptyCopy.y + emptyCopy.height).toBe(true)
  await page.screenshot({ path: test.info().outputPath('empty-results.png') })
  mode = 'partial'; delay = 100
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('Some events may be missing. Zoom in to narrow this area.')).toBeVisible()
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '1000')
  await expect(page.getByRole('button', { name: 'Retry events', exact: true })).toBeVisible()
  const status = await page.locator('.living-map__event-status').boundingBox()
  const controls = await page.locator('.mapboxgl-ctrl-top-right').boundingBox()
  expect(status && controls && (status.x + status.width <= controls.x || status.y >= controls.y + controls.height || status.y + status.height <= controls.y)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('partial-results.png') })
  mode = 'rows'
  await page.getByRole('button', { name: 'Retry events', exact: true }).click()
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  await expect(page.getByText('Some events may be missing. Zoom in to narrow this area.')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)
})

test('A to B to A reuses previous coverage and rapid camera movement stays coalesced', async ({ page }) => {
  let requests = 0
  let seed: Array<Record<string, unknown>> = []
  await page.route('**/rest/v1/rpc/get_public_filtered_map_events', async route => {
    requests++
    if (!seed.length) seed = discoveryRows()
    const rows = seed.map(row => ({ ...row, longitude: -122.263, latitude: 37.804 }))
    await fulfillMap(route, rows)
  })
  await page.goto('/map'); await mapReference(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  const original = await page.evaluate(() => {
    const map = window.__phase4Map
    return { center: [map.getCenter().lng, map.getCenter().lat] as [number, number], width: map.getBounds()!.getEast() - map.getBounds()!.getWest() }
  })
  await page.evaluate(v => { window.__phase4Map.jumpTo({ center: [v.center[0] + v.width * .3, v.center[1]] }) }, original)
  await expect.poll(() => requests).toBe(2)
  await expect(page.getByText('Updating events…')).toHaveCount(0)
  await page.evaluate(v => { window.__phase4Map.jumpTo({ center: v.center }) }, original)
  await page.waitForTimeout(650)
  expect(requests).toBe(2)
  await page.evaluate(async v => {
    for (let i = 0; i < 10; i++) {
      window.__phase4Map.jumpTo({ center: [v.center[0] - v.width * (.3 + (i % 2) * .02), v.center[1]] })
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }, original)
  await expect.poll(() => requests).toBe(3)
  await page.waitForTimeout(350)
  expect(requests).toBe(3)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
})
