import { expect, test } from '@playwright/test'
import { discoveryRows, fulfillMap } from './support/discoveryFixtures'
import { mapReference } from './support/combinedMapObservations'
declare global { interface Window { __areaSourceUpdates: number } }

test('loading, initial failure, retained refresh, empty and partial results stay interactive', async ({ page }, info) => {
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
  await page.waitForFunction(() => {
    const map = window.__phase4Map
    const layers = map.getStyle().layers?.filter(layer => 'source' in layer && layer.source === 'wheretoo-events' && !layer.id.includes('hit-area')).map(layer => layer.id) ?? []
    return layers.length > 0 && map.queryRenderedFeatures({ layers }).length > 0
  })
  await page.waitForFunction(expected => window.__phase4Map.listImages().filter(id => id.startsWith('wheretoo-icon-')).length === expected, info.project.name === 'mobile' ? 8 : 9)
  await page.getByRole('button', { name: 'Choose an event on the map', exact: true }).click()
  await page.getByRole('button', { name: `Open ${seed[0].title} event preview`, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Close event preview', exact: true })).toBeVisible()
  await page.waitForFunction(() => {
    const map = window.__phase4Map
    const layers = map.getStyle().layers?.filter(layer => 'source' in layer && layer.source === 'wheretoo-selected-event').map(layer => layer.id) ?? []
    return map.queryRenderedFeatures({ layers }).length > 0
  })
  mode = 'empty'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('Updating events…')).toBeVisible()
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  await expect(page.getByText('No events found in this area.')).toBeVisible()
  const emptyCopy = await page.locator('.living-map__event-status > span').boundingBox()
  const broaden = await page.getByRole('button', { name: 'Zoom out to search a wider area', exact: true }).boundingBox()
  expect(emptyCopy && broaden && emptyCopy.width >= 160 && broaden.y >= emptyCopy.y + emptyCopy.height).toBe(true)
  // Read actual rendered event layers, rather than the React inventory count.
  // A cleared source must not leave old event markers visible as matches.
  await expect.poll(() => page.evaluate(() => {
    const map = window.__phase4Map
    const source = map.getSource('wheretoo-events') as unknown as { serialize(): { data: { features: unknown[] } } }
    const layers = map.getStyle().layers?.filter(layer => 'source' in layer && layer.source === 'wheretoo-events' && !layer.id.includes('hit-area')).map(layer => layer.id) ?? []
    if (!layers.length) throw new Error('Event rendering layers are unavailable')
    return { serialized: source.serialize().data.features.length, rendered: map.queryRenderedFeatures({ layers }).length }
  }), { timeout: 5000 }).toEqual({ serialized: 0, rendered: 0 })
  await expect(page.getByRole('button', { name: 'Close event preview', exact: true })).toHaveCount(0)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', '')
  await expect.poll(() => page.evaluate(() => {
    const map = window.__phase4Map
    const layers = map.getStyle().layers?.filter(layer => 'source' in layer && layer.source === 'wheretoo-selected-event').map(layer => layer.id) ?? []
    return map.queryRenderedFeatures({ layers }).length
  })).toBe(0)
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
  // Repeat at cluster zoom, then continue rendering to catch late icon/tile callbacks.
  await page.evaluate(() => { window.__phase4Map.jumpTo({ center: [-122.263, 37.804], zoom: 11.5 }) })
  await page.waitForFunction(() => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] }).length > 0)
  mode = 'empty'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('No events found in this area.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__phase4Map.querySourceFeatures('wheretoo-events').length)).toBe(0)
  await expect.poll(() => page.evaluate(() => {
    const map = window.__phase4Map
    const layers = map.getStyle().layers?.filter(layer => 'source' in layer && ['wheretoo-events', 'wheretoo-selected-event'].includes(String(layer.source))).map(layer => layer.id) ?? []
    return map.queryRenderedFeatures({ layers }).length
  }), { timeout: 5000 }).toBe(0)
  const largestAfterClear = await page.evaluate(async () => {
    const map = window.__phase4Map
    let largest = 0
    for (let i = 0; i < 90; i++) {
      await new Promise(requestAnimationFrame)
      const layers = map.getStyle().layers?.filter(layer => 'source' in layer && ['wheretoo-events', 'wheretoo-selected-event'].includes(String(layer.source))).map(layer => layer.id) ?? []
      largest = Math.max(largest, map.queryRenderedFeatures({ layers }).length)
    }
    return largest
  })
  expect(largestAfterClear).toBe(0)
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

for (const count of [9, 500, 2000]) test(`${count} events: cached empty viewport feedback keeps automatic map and list searching`, async ({ page }, info) => {
  const firstTitle = info.project.metadata.longPreview ? 'Area fixture 1 — Oakland music and community celebration with local artists, performances and neighborhood friends' : 'Area fixture 1'
  const rows = discoveryRows(count).map((row, i) => ({ ...row, title: i === 0 ? firstTitle : `Area fixture ${i + 1}`, category: 'music', admission_type: 'free', minimum_price_minor: null,
    longitude: -122.263 + (i % 5 - 2) * .00005, latitude: 37.804 + (Math.floor(i / 5) % 5 - 2) * .00005 }))
  const requests: Array<{ api: string; query: Record<string, unknown> }> = []
  let slow = false
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'get_public_map_icon_versions') return route.continue()
    if (name === 'list_event_images') return route.fulfill({ json: [] })
    return route.abort()
  })
  await page.route('**/functions/v1/**', route => route.abort())
  const inArea = (bounds: { west: number; east: number; south: number; north: number }) => rows.filter(row => row.longitude >= bounds.west && row.longitude <= bounds.east && row.latitude >= bounds.south && row.latitude <= bounds.north)
  await page.route('**/rest/v1/rpc/get_public_filtered_map_events', async route => {
    const query = route.request().postDataJSON()
    requests.push({ api: 'map', query })
    const matches = inArea({ west: query.p_west, east: query.p_east, south: query.p_south, north: query.p_north })
    if (slow) await new Promise(resolve => setTimeout(resolve, 800))
    await fulfillMap(route, matches.slice(0, 1000), matches.length)
  })
  await page.route('**/functions/v1/public-discovery', route => {
    const query = route.request().postDataJSON()
    requests.push({ api: 'list', query })
    const items = inArea(query.bounds).slice(0, 20).map(row => ({ id: row.event_id, title: row.title, category: 'music', admissionType: 'free', startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone, venueName: row.venue_label, city: 'Oakland', artworkReference: null,
      admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null } }))
    const now = new Date()
    return route.fulfill({ json: { items, nextCursor: null, serverNow: now.toISOString(), window: { start: now.toISOString(), end: new Date(+now + 168 * 3600000).toISOString(), timezone: 'America/Los_Angeles' } } })
  })
  for (const path of ['/map', '/discover']) {
    slow = false; requests.length = 0
    await page.goto(path + '?category=music&price=free'); await mapReference(page)
    await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', String(Math.min(count, 1000)))
    if (path === '/discover') await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText(`${Math.min(count, 20)} events`)
    await page.locator('.living-map').scrollIntoViewIfNeeded()
    const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
    const original = await page.evaluate(() => {
      const map = window.__phase4Map
      return { center: map.getCenter().toArray(), zoom: map.getZoom(), width: map.getBounds()!.getEast() - map.getBounds()!.getWest() }
    })
    expect(requests.filter(r => r.api === 'map')).toHaveLength(1)
    await page.waitForFunction(() => window.__phase4Map.loaded())
    await page.evaluate(() => {
      const source = window.__phase4Map.getSource('wheretoo-events') as unknown as { setData(data: unknown): unknown }
      const setData = source.setData.bind(source)
      window.__areaSourceUpdates = 0
      source.setData = data => { window.__areaSourceUpdates++; return setData(data) }
    })
    slow = true
    await page.evaluate(v => { window.__phase4Map.jumpTo({ center: [v.center[0] + v.width * .35, v.center[1]], zoom: v.zoom + 1 }) }, original)
    if (count === 2000) {
      await expect(page.getByText('Updating events…', { exact: true })).toBeVisible()
      await expect(page.getByText('No events found in this area.', { exact: true })).toHaveCount(0)
      await expect(page.locator('.living-map__broaden')).toHaveCount(0)
    }
    await expect(page.getByText('No events found in this area.', { exact: true })).toBeVisible()
    if (path === '/discover') await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('0 events')
    expect(requests.filter(r => r.api === 'map')).toHaveLength(count === 2000 ? 2 : 1)
    expect(requests.filter(r => r.api === 'list')).toHaveLength(path === '/discover' ? 2 : 0)
    await expect.poll(() => page.evaluate(() => window.__areaSourceUpdates)).toBe(count === 2000 ? 1 : 0)
    await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', String(count === 2000 ? 0 : count))
    const broaden = page.locator('.living-map__broaden')
    await expect(broaden).toBeVisible(); await expect(broaden).toBeEnabled()
    expect(await broaden.evaluate(node => { const r = node.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === node })).toBe(true)
    const status = await page.locator('.living-map__event-status').boundingBox(), controls = await page.locator('.mapboxgl-ctrl-top-right').boundingBox()
    expect(status && controls && (status.x + status.width <= controls.x || status.y >= controls.y + controls.height || status.y + status.height <= controls.y)).toBe(true)
    await expect(page.locator('.living-map__surface')).not.toHaveAttribute('inert')
    await expect(page.getByRole('button', { name: /search this area/i })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`covered-empty-${path.slice(1)}.png`) })
    await page.evaluate(v => { window.__phase4Map.jumpTo({ center: v.center, zoom: v.zoom }) }, original)
    await expect(page.getByRole('button', { name: 'Choose an event on the map', exact: true })).toBeEnabled()
    await expect(page.getByText('No events found in this area.', { exact: true })).toHaveCount(0)
    if (path === '/discover') await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText(`${Math.min(count, 20)} events`)
    expect(requests.filter(r => r.api === 'map')).toHaveLength(count === 2000 ? 3 : 1)
    expect(requests.filter(r => r.api === 'list')).toHaveLength(path === '/discover' ? 2 : 0)
    expect(requests.every(r => r.api === 'map' ? r.query.p_when === 'next7' && r.query.p_admission_type === 'free' && JSON.stringify(r.query.p_categories) === '["music"]' : r.query.when === 'next7' && r.query.admissionType === 'free' && r.query.category === 'music')).toBe(true)
    expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
    if (count === 9) {
      await page.getByRole('button', { name: 'Choose an event on the map', exact: true }).click()
      await page.getByRole('button', { name: `Open ${firstTitle} event preview`, exact: true }).click()
      await page.waitForTimeout(450)
      await page.waitForFunction(() => !window.__phase4Map.isMoving())
      // Selection can legitimately reveal the marker outside prior coverage.
      // Let that existing camera search settle before measuring feedback-only pans.
      await page.waitForTimeout(350)
      await expect(page.getByText('Updating events…', { exact: true })).toHaveCount(0)
      const beforeSelectedPan = requests.filter(r => r.api === 'map').length
      // Revisit the already-proven empty viewport; reveal offsets vary by aspect ratio.
      await page.evaluate(v => { window.__phase4Map.jumpTo({ center: [v.center[0] + v.width * .35, v.center[1]], zoom: v.zoom + 1 }) }, original)
      try { await expect(page.getByText('No events found in this area.', { exact: true })).toBeVisible() }
      catch (error) {
        console.log('empty viewport diagnostics', JSON.stringify({ path, original, requests, current: await page.evaluate(() => { const map = window.__phase4Map; return { center: map.getCenter().toArray(), zoom: map.getZoom(), bounds: map.getBounds(), moving: map.isMoving(), camera: document.querySelector('.living-map__canvas')?.getAttribute('data-camera'), mapClass: document.querySelector('.living-map')?.className, feedback: document.querySelector('.living-map__event-status')?.textContent } }) }))
        throw error
      }
      await expect(page.getByRole('region', { name: firstTitle, exact: true })).toBeVisible()
      const preview = await page.locator('.event-preview').boundingBox(), feedback = await page.locator('.living-map__event-status').boundingBox()
      await info.attach(`selected-empty-geometry-${path.slice(1)}`, { body: JSON.stringify({ map: await page.locator('.living-map').boundingBox(), preview, feedback }), contentType: 'application/json' })
      expect(preview && feedback && (preview.x + preview.width <= feedback.x || feedback.x + feedback.width <= preview.x || preview.y + preview.height <= feedback.y || feedback.y + feedback.height <= preview.y), 'empty feedback must not cover the retained preview').toBe(true)
      for (const selector of ['.event-preview__close', '.event-preview__action', '.living-map__broaden']) {
        expect(await page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })).toBe(true)
      }
      await page.waitForTimeout(350)
      expect(requests.filter(r => r.api === 'map')).toHaveLength(beforeSelectedPan)
      await page.screenshot({ path: info.outputPath(`selected-empty-${path.slice(1)}.png`) })
      await page.getByRole('button', { name: 'Close event preview', exact: true }).click()
      await page.evaluate(v => { window.__phase4Map.jumpTo({ center: v.center, zoom: v.zoom }) }, original)
      await expect(page.getByRole('button', { name: 'Choose an event on the map', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Choose an event on the map', exact: true }).click()
      await page.waitForTimeout(450)
      await page.waitForFunction(() => !window.__phase4Map.isMoving())
      await page.waitForTimeout(350)
      await expect(page.getByText('Updating events…', { exact: true })).toHaveCount(0)
      const beforeChooserPan = requests.filter(r => r.api === 'map').length
      await page.evaluate(v => { window.__phase4Map.jumpTo({ center: [v.center[0] + v.width * .35, v.center[1]], zoom: v.zoom + 1 }) }, original)
      await expect(page.getByText('No events found in this area.', { exact: true })).toBeVisible()
      const chooser = await page.locator('.event-chooser').boundingBox(), chooserFeedback = await page.locator('.living-map__event-status').boundingBox()
      expect(chooser && chooserFeedback && (chooser.x + chooser.width <= chooserFeedback.x || chooserFeedback.x + chooserFeedback.width <= chooser.x || chooser.y + chooser.height <= chooserFeedback.y || chooserFeedback.y + chooserFeedback.height <= chooser.y), 'empty feedback must not cover the retained chooser').toBe(true)
      await page.getByRole('button', { name: `Open ${firstTitle} event preview`, exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('button', { name: `Open ${firstTitle} event preview`, exact: true })).toBeInViewport()
      await page.screenshot({ path: info.outputPath(`chooser-empty-${path.slice(1)}.png`) })
      await page.keyboard.press('Escape')
      await expect(page.locator('.event-chooser')).toHaveCount(0)
      await page.waitForTimeout(350)
      expect(requests.filter(r => r.api === 'map')).toHaveLength(beforeChooserPan)
      expect(await page.evaluate(() => window.__areaSourceUpdates)).toBe(0)
    }
  }
})
