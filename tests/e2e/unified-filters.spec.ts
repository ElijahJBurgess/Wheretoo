import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { mapReference } from './support/combinedMapObservations'
import { discoveryRows, discoveryMetadata, fulfillMap } from './support/discoveryFixtures'

declare global { interface Window { __filterMetrics: { sourceUpdates: number; imageAdds: number; imageRemoves: number } } }

test.describe('unified viewport filters', () => {
  for (const size of [9, 500, 2000]) test(`${size} events: filters, bounded transfers, stale responses, camera and pagination`, async ({ page }, info) => {
    const rows = discoveryRows(size).map((row, i) => ({ ...row, category: i % 2 ? 'music' : 'community', admission_type: i % 2 ? 'paid' : 'free', minimum_price_minor: i % 2 ? 1200 : null,
      longitude: -122.263 + (i % 20) * 0.00005, latitude: 37.804 + Math.floor((i % 400) / 20) * 0.00005 }))
    const reads: Array<{ api: string; filters: Record<string, unknown>; bytes: number }> = []
    let slow = false
    const matching = (category: unknown, admission: unknown) => rows.filter(row => (!category || row.category === category) && (!admission || row.admission_type === admission))
    await page.route('**/rest/v1/rpc/get_public_filtered_map_events', async route => {
      const q = route.request().postDataJSON() as Record<string, unknown>
      const all = matching((q.p_categories as string[] | null)?.[0], q.p_admission_type)
      const data = all.slice(0, 1000)
      reads.push({ api: 'map', filters: q, bytes: JSON.stringify(data).length })
      if (slow && q.p_categories) await new Promise(resolve => setTimeout(resolve, 900))
      await fulfillMap(route, data, all.length)
    })
    await page.route('**/functions/v1/public-discovery', route => {
      const q = route.request().postDataJSON() as Record<string, unknown>
      const all = matching(q.category, q.admissionType), offset = Number(q.cursor ?? 0)
      const data = all.slice(offset, offset + 20).map(row => ({ id: row.event_id, title: row.title, category: row.category, admissionType: row.admission_type, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone, venueName: row.venue_label, city: 'Oakland', artworkReference: null, admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null } }))
      reads.push({ api: 'list', filters: q, bytes: JSON.stringify(data).length })
      return route.fulfill({ json: { items: data, nextCursor: offset + 20 < all.length ? String(offset + 20) : null, ...discoveryMetadata() } })
    })
    await page.route('**/rest/v1/rpc/list_event_images', route => route.fulfill({ json: [] }))
    const started = Date.now()
    await page.goto('/discover?when=upcoming')
    await expect(page.locator('.living-map')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60000 })
    // The existing instrumentation only assumed a main; use the same reference for embedded maps.
    await mapReference(page)
    await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', String(Math.min(size, 1000)))
    await expect(page.getByRole('heading', { name: 'Events in this area', exact: true })).toBeVisible()
    expect(reads.filter(r => r.api === 'map')).toHaveLength(1)
    expect(reads.filter(r => r.api === 'list')).toHaveLength(1)
    expect(reads.find(r => r.api === 'list')?.filters.bounds).toBeTruthy()
    const initialLatency = Date.now() - started
    const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
    await page.evaluate(() => {
      const map = window.__phase4Map
      const stats = { sourceUpdates: 0, imageAdds: 0, imageRemoves: 0 }
      window.__filterMetrics = stats
      const source = map.getSource('wheretoo-events') as unknown as { setData(data: unknown): void }
      const setData = source.setData.bind(source)
      source.setData = data => { stats.sourceUpdates++; setData(data) }
      const add = map.addImage.bind(map), remove = map.removeImage.bind(map)
      map.addImage = (...args) => { stats.imageAdds++; return add(...args) }
      map.removeImage = (...args) => { stats.imageRemoves++; return remove(...args) }
    })
    await page.evaluate(() => { window.scrollTo(0, 0) })
    const before = await page.evaluate(() => ({ center: window.__phase4Map.getCenter().toArray(), zoom: window.__phase4Map.getZoom() }))
    slow = true
    await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('music')
    await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '0')
    await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('community')
    await page.getByRole('combobox', { name: 'Admission', exact: true }).selectOption('free')
    await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', String(Math.min(Math.ceil(size / 2), 1000)))
    await page.waitForTimeout(1000)
    expect(await canvas!.evaluate(n => n.isConnected)).toBe(true)
    await expect(page).toHaveURL(/when=upcoming&category=community&price=free$/)
    await expect(page.getByRole('combobox', { name: 'Date', exact: true })).toHaveValue('upcoming')
    expect(await page.evaluate(() => scrollY)).toBe(0)
    const actualIds = await page.evaluate(() => ((window.__phase4Map.getSource('wheretoo-events') as unknown as { serialize(): { data: { features: Array<{ properties: { eventId: string } }> } } }).serialize().data.features.map(f => f.properties.eventId)))
    expect(actualIds.every(id => rows.find(row => row.event_id === id)?.admission_type === 'free')).toBe(true)
    // Serialized input alone missed the icon-bearing stale-tile defect. Check
    // visible individuals and cluster sizes after the superseded responses settle.
    await expect.poll(() => page.evaluate(({ maximum, allowed }) => {
      const map = window.__phase4Map
      const layers = map.getStyle().layers?.filter(layer => 'source' in layer && ['wheretoo-events', 'wheretoo-selected-event'].includes(String(layer.source))).map(layer => layer.id) ?? []
      return map.queryRenderedFeatures({ layers }).every(feature => feature.properties?.point_count
        ? Number(feature.properties.point_count) <= maximum
        : allowed.includes(String(feature.properties?.eventId)))
    }, { maximum: Math.ceil(size / 2), allowed: rows.filter(row => row.admission_type === 'free').map(row => row.event_id) })).toBe(true)
    const after = await page.evaluate(() => ({ center: window.__phase4Map.getCenter().toArray(), zoom: window.__phase4Map.getZoom() }))
    expect(after).toEqual(before)
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await expect(page).toHaveURL('/discover')
    await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', String(Math.min(size, 1000)))
    await expect(page.getByRole('combobox', { name: 'Date', exact: true })).toHaveValue('next7')
    if (size > 20) {
      await page.getByRole('button', { name: 'Load more', exact: true }).click()
      await expect(page.getByRole('status', { name: 'Discovery results' })).toHaveText('40 events')
      expect(reads.filter(r => r.api === 'list').at(-1)?.filters.cursor).toBe('20')
    }
    const frames = await page.evaluate(async () => {
      const times: number[] = []; let last = performance.now()
      for (let i = 0; i < 60; i++) {
        await new Promise(requestAnimationFrame); const now = performance.now(); times.push(now - last); last = now
        window.__phase4Map.jumpTo({ bearing: i / 10 })
      }
      return times.sort((a, b) => a - b)
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('combobox', { name: 'Date', exact: true }).selectOption('today')
    await expect(page).toHaveURL(/when=today$/)
    await page.getByRole('combobox', { name: 'Date', exact: true }).selectOption('weekend')
    await expect(page).toHaveURL(/when=weekend$/)
    await page.screenshot({ path: info.outputPath('unified-filters.png') })
    const measurements = { size, initialLatency, reads, frameMedianMs: frames[30], frameP95Ms: frames[57], capped: size > 1000, ...await page.evaluate(() => window.__filterMetrics) }
    writeFileSync(info.outputPath('measurements.json'), JSON.stringify(measurements, null, 2))
    await info.attach('measurements', { path: info.outputPath('measurements.json'), contentType: 'application/json' })
  })
})
test('filter-history Back restores camera and eligible selection without remounting', async ({ page }) => {
  const rows = discoveryRows()
  await page.route('**/rest/v1/rpc/get_public_filtered_map_events', route => fulfillMap(route, rows))
  await page.goto('/map'); await mapReference(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
  await page.getByRole('button', { name: 'Choose an event on the map' }).click()
  await page.getByRole('button', { name: `Open ${rows[0].title} event preview`, exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__phase4Map.isMoving())).toBe(false)
  const before = await page.evaluate(() => ({ center: window.__phase4Map.getCenter().toArray(), zoom: window.__phase4Map.getZoom() }))
  await page.getByRole('combobox', { name: 'Date', exact: true }).selectOption('today')
  await expect(page).toHaveURL('/map?when=today')
  await page.evaluate(() => { window.__phase4Map.jumpTo({ center: [-122.30, 37.82], zoom: 15.4 }) })
  await page.waitForTimeout(700)
  await page.goBack()
  await expect(page).toHaveURL('/map')
  await expect.poll(() => page.evaluate(() => window.__phase4Map.getZoom())).toBeCloseTo(before.zoom, 4)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', String(rows[0].event_id))
  expect(await canvas!.evaluate(n => n.isConnected)).toBe(true)
  const after = await page.evaluate(() => window.__phase4Map.getCenter().toArray())
  expect(after[0]).toBeCloseTo(before.center[0], 5); expect(after[1]).toBeCloseTo(before.center[1], 5)
})
