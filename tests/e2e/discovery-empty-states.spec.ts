import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import type { GeoJSONSource } from 'mapbox-gl/esm'
import { discoveryRows, discoveryMetadata, fulfillMap } from './support/discoveryFixtures'
import { iconReady, mapReference, shot } from './support/combinedMapObservations'

async function fixtures(page: Page, count = 9) {
  const state = { empty: false, failList: false, failMore: false, delay: 0, expireFirst: false, hasMore: false, invalid: false, lateEmpty: false }
  const counts = { map: 0, list: 0, icons: 0, png: 0 }
  const rows = discoveryRows(count).map((row, i) => ({ ...row, title: `Feedback event ${i + 1}`, category: 'music', admission_type: 'free', minimum_price_minor: null, longitude: -122.263 + (i % 5 - 2) * .0007, latitude: 37.804 + (Math.floor(i / 5) % 5 - 2) * .0006 }))
  let expiresAt = 0
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/icons/') && request.url().endsWith('.png')) counts.png++ })
  await page.route('**/rest/v1/**', async route => {
    const rpc = new URL(route.request().url()).pathname.split('/').pop()
    if (rpc === 'get_public_map_icon_versions') { counts.icons++; return route.continue() }
    if (rpc === 'list_event_images') return route.fulfill({ json: [] })
    if (rpc !== 'get_public_filtered_map_events') return route.abort()
    counts.map++
    return fulfillMap(route, state.empty ? [] : rows.slice(0, 1000), state.empty ? 0 : count)
  })
  await page.route('**/functions/v1/**', async route => {
    if (!route.request().url().endsWith('/public-discovery')) return route.abort()
    const number = ++counts.list
    const query = route.request().postDataJSON() as { cursor?: string }
    const fail = state.failList || query.cursor && state.failMore
    const empty = state.empty || number === 1 && state.lateEmpty
    if (state.expireFirst && !expiresAt) expiresAt = Date.now() + 5000
    const items = (empty ? [] : rows.slice(query.cursor ? 20 : 0, query.cursor ? 40 : 20)).map(row => ({
      id: row.event_id, title: row.title, category: row.category, admissionType: row.admission_type,
      startsAt: state.expireFirst && !query.cursor ? new Date(expiresAt - 3600000).toISOString() : row.starts_at,
      endsAt: state.expireFirst && !query.cursor ? new Date(expiresAt).toISOString() : row.ends_at,
      timezone: row.timezone, venueName: row.venue_label, city: 'Oakland', artworkReference: null,
      admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null },
    }))
    if (state.invalid) items.push({ ...items[0], id: 'invalid-row' })
    const payload = { items, nextCursor: state.hasMore && !query.cursor ? 'audit20' : null, ...discoveryMetadata() }
    if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay))
    return fail ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: payload })
  })
  return { state, counts }
}

test('narrow feedback keeps the broaden action inside its card', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const fixture = await fixtures(page); fixture.state.empty = true
  await page.goto('/discover'); await mapReference(page)
  const action = page.getByRole('button', { name: 'Zoom out to search a wider area', exact: true }).first()
  await expect(page.getByText('No events found in this area.', { exact: true })).toBeVisible()
  const bounds = await action.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node)
    return { textRight: range.getBoundingClientRect().right, parentRight: node.parentElement!.getBoundingClientRect().right, height: node.getBoundingClientRect().height }
  })
  expect(bounds.textRight).toBeLessThanOrEqual(bounds.parentRight)
  expect(bounds.height).toBeGreaterThanOrEqual(44)
})

test('expired loaded events preserve a usable next page instead of claiming an empty area', async ({ page }, info) => {
  const f = await fixtures(page, 29); f.state.expireFirst = true; f.state.hasMore = true
  await page.goto('/discover?view=list'); await mapReference(page)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('20 events')
  await expect(page.getByText('More events may be available.', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/No events/)).toHaveCount(0)
  await page.locator('.discovery-results-state').scrollIntoViewIfNeeded()
  await shot(page, info, 'expired-page-more-available')
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('9 events')
  await expect(page.getByRole('link', { name: 'View Feedback event 21', exact: true })).toBeVisible()
  expect(f.counts.list).toBe(2); expect(f.counts.map).toBe(0)
})

test('initial timeout permits coalesced refresh, a new retry and no late empty overwrite', async ({ page }) => {
  const f = await fixtures(page); f.state.delay = 12000; f.state.lateEmpty = true
  await page.goto('/discover?view=list'); await mapReference(page)
  await expect(page.getByText('Loading events', { exact: true })).toBeVisible()
  await expect.poll(() => f.counts.list).toBe(1)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  expect(f.counts.list).toBe(1)
  await expect(page.getByRole('alert')).toContainText('We couldn’t load events.', { timeout: 12000 })
  f.state.delay = 0
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('9 events')
  await page.waitForTimeout(2500)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('9 events')
  await expect(page.getByText(/No events/)).toHaveCount(0)
  expect(f.counts.list).toBe(2); expect(f.counts.map).toBe(0); expect(f.counts.icons).toBe(0)
})

test('pagination timeout keeps loaded events and retries only the missing page', async ({ page }) => {
  const f = await fixtures(page, 29); f.state.hasMore = true
  await page.goto('/discover?view=list'); await mapReference(page)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('20 events')
  f.state.delay = 12000
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('More events could not load.', { timeout: 12000 })
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('20 events')
  f.state.delay = 0
  await page.getByRole('button', { name: 'Try loading more', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('29 events')
  await page.waitForTimeout(2500)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('29 events')
  expect(f.counts.list).toBe(3); expect(f.counts.map).toBe(0)
})

test('empty refresh checks, fails and recovers without contradictory absence messages', async ({ page }, info) => {
  const f = await fixtures(page); f.state.empty = true
  await page.goto('/discover?view=list'); await mapReference(page)
  await expect(page.getByText('No events in this map area yet.', { exact: true })).toBeVisible()
  f.state.delay = 1200
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('Checking for events…', { exact: true })).toBeVisible()
  await expect(page.getByText(/No events/)).toHaveCount(0)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveCount(0)
  await expect(page.getByText('No events in this map area yet.', { exact: true })).toBeVisible()
  f.state.delay = 0; f.state.failList = true
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t load events.')
  await expect(page.getByText(/No events/)).toHaveCount(0)
  await page.getByRole('alert').scrollIntoViewIfNeeded(); await shot(page, info, 'empty-refresh-error')
  f.state.failList = false; f.state.empty = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('9 events')
  expect(f.counts.list).toBe(4); expect(f.counts.map).toBe(0)
})

test('known partial rows never claim completeness and a complete refresh restores the footer', async ({ page }, info) => {
  const f = await fixtures(page, 1); f.state.invalid = true
  await page.goto('/discover?view=list'); await mapReference(page)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('1 event')
  await expect(page.getByText(/1 event could not be shown/)).toContainText('More events may be available.')
  await expect(page.getByText('That’s everything coming up.', { exact: true })).toHaveCount(0)
  await page.locator('#discovery-results').scrollIntoViewIfNeeded(); await shot(page, info, 'known-partial-list')
  f.state.invalid = false
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('That’s everything coming up.', { exact: true })).toBeVisible()
  await expect(page.getByText(/could not be shown/)).toHaveCount(0)
})

for (const query of ['when=today&category=music&price=free', 'when=weekend&category=music&price=paid', 'when=upcoming']) test(`inline reset preserves List and camera: ${query}`, async ({ page }) => {
  const f = await fixtures(page); f.state.empty = true
  await page.goto(`/discover?${query}&view=list`); await mapReference(page)
  const feedback = page.locator('.discovery-results-state')
  await expect(feedback).toContainText(query === 'when=upcoming' ? 'No events in this map area yet.' : 'No events match these filters in this area.')
  await expect(feedback).not.toContainText('Clear the filters to see everything')
  const before = await camera(page)
  await feedback.getByRole('button', { name: 'Clear filters', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/discover?view=list')
  await expect(page.getByRole('combobox', { name: 'Date', exact: true })).toHaveValue('next7')
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Admission', exact: true })).toHaveValue('')
  await expect(page.getByRole('heading', { name: 'Events in this area', exact: true })).toBeFocused()
  expect(await camera(page)).toEqual(before)
  expect(f.counts.map).toBe(0); expect(f.counts.icons).toBe(0)
})

const camera = (page: Page) => page.evaluate(() => { const m = window.__phase4Map, c = m.getCenter(); return [c.lng, c.lat, m.getZoom(), m.getPitch(), m.getBearing()] })
declare global { interface Window { __emptyStateMetrics: { source: number; addImage: number; removeImage: number } } }

for (const count of [9, 500, 2000]) test(`${count} events: feedback and switching preserve map resources`, async ({ page }, info) => {
  const f = await fixtures(page, count)
  await page.goto('/discover'); await mapReference(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', String(Math.min(count, 1000)))
  await expect(page.locator('#discovery-list-panel [aria-label="Discovery results"]')).toHaveText(`${Math.min(count, 20)} events`)
  await iconReady(page)
  await expect.poll(() => page.evaluate(() => window.__phase4Map.listImages().filter(id => id.startsWith('wheretoo-icon-')).length)).toBe(page.viewportSize()!.width < 768 ? 8 : 9)
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle(), saved = await camera(page), before = { ...f.counts }
  await page.evaluate(() => {
    const m = window.__phase4Map
    window.__emptyStateMetrics = { source: 0, addImage: 0, removeImage: 0 }
    for (const id of Object.keys(m.getStyle().sources)) {
      const source = m.getSource(id) as GeoJSONSource | undefined
      if (!source?.setData) continue
      const write = source.setData.bind(source)
      source.setData = (...args: Parameters<GeoJSONSource['setData']>) => { window.__emptyStateMetrics.source++; return write(...args) }
    }
    const add = m.addImage.bind(m), remove = m.removeImage.bind(m)
    m.addImage = (...args: Parameters<typeof m.addImage>) => { window.__emptyStateMetrics.addImage++; return add(...args) }
    m.removeImage = (...args: Parameters<typeof m.removeImage>) => { window.__emptyStateMetrics.removeImage++; return remove(...args) }
  })
  await page.getByRole('button', { name: 'List', exact: true }).click()
  f.state.failList = true
  const started = Date.now()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('Couldn’t refresh events. Showing the last results we received.', { exact: true })).toBeVisible()
  const feedbackMs = Date.now() - started
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText(`${Math.min(count, 20)} events`)
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect.poll(() => f.counts.map).toBe(before.map + (count > 1000 ? 1 : 0))
  await page.waitForTimeout(500)
  expect(f.counts.list).toBe(before.list + 1); expect(f.counts.icons).toBe(before.icons); expect(f.counts.png).toBe(before.png)
  expect(await camera(page)).toEqual(saved)
  expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  const metrics = await page.evaluate(() => window.__emptyStateMetrics)
  expect(metrics).toEqual({ source: 0, addImage: 0, removeImage: 0 })
  writeFileSync(info.outputPath('measurements.json'), JSON.stringify({ count, before, after: f.counts, feedbackMs, metrics }, null, 2))
})
