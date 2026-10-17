import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { GeoJSONSource } from 'mapbox-gl/esm'
import { discoveryBounds } from '../../src/features/discovery/discovery.scope'
import { discoveryMetadata, discoveryRows, fulfillMap } from './support/discoveryFixtures'
import { iconReady, mapReference, shot } from './support/combinedMapObservations'

type Counts = { map: number; list: number; icons: number; tickets: number; source: number; addImage: number; removeImage: number; render: number }
declare global { interface Window { __task9: Counts } }

async function fixtures(page: Page, count: number) {
  page.on('pageerror', error => console.info('Browser error:', error.message))
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.info('Browser diagnostic:', message.text()) })
  page.on('response', response => { if (response.status() >= 400) { const url = new URL(response.url()); console.info('HTTP error:', response.status(), url.hostname, url.pathname) } })
  page.on('requestfailed', request => { const url = new URL(request.url()); console.info('Resource failed:', url.hostname, url.pathname, request.failure()?.errorText) })
  let lastListBounds: unknown
  const counts = { map: 0, list: 0, icons: 0, tickets: 0, png: 0 }
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/icons/') && path.endsWith('.png')) counts.png++ })
  const state = { failMap: false, failList: false, empty: false, slowMusic: false }
  const rows = discoveryRows(count).map((row, i) => ({ ...row, title: `Task 9 event ${i + 1}`, category: 'music', admission_type: 'paid', minimum_price_minor: 1200, venue_label: 'Isolated browser fixture', longitude: -122.263 + (i % 5 - 2) * .0007, latitude: 37.804 + (Math.floor(i / 5) % 5 - 2) * .0006 }))
  const event = { id: rows[0].event_id, title: rows[0].title, description: 'Isolated browser fixture; no transactions.', category: 'music', starts_at: rows[0].starts_at, ends_at: rows[0].ends_at, timezone: rows[0].timezone, venue_name: 'Isolated browser fixture', address_line1: '123 Broadway', address_line2: null, city: 'Oakland', region: 'CA', postal_code: '94612', country_code: 'US', latitude: 37.804, longitude: -122.263, artwork_path: null, animation_preset: 'generic', minimum_age: 'all_ages', advisories: [], organizer: { id: '6a000000-0000-4000-8000-000000000001', display_name: 'Fixture organizer' }, admission_type: 'paid' }
  await page.route('**/rest/v1/**', async route => {
    const rpc = new URL(route.request().url()).pathname.split('/').pop()
    const q = route.request().postDataJSON() as Record<string, unknown>
    if (rpc === 'get_public_map_icon_versions') { counts.icons++; return route.continue() }
    if (rpc === 'list_event_images') return route.fulfill({ json: [] })
    if (rpc === 'get_public_filtered_map_events') {
      counts.map++
      if (state.failMap) return route.fulfill({ status: 503, json: {} })
      const empty = state.empty || q.p_admission_type === 'free' || Array.isArray(q.p_categories) && q.p_categories.includes('fitness')
      if (state.slowMusic && Array.isArray(q.p_categories) && q.p_categories.includes('music')) await new Promise(resolve => setTimeout(resolve, 700))
      return fulfillMap(route, empty ? [] : rows.slice(0, 1000), empty ? 0 : count)
    }
    if (rpc === 'get_public_event_ticketing') {
      counts.tickets++
      return route.fulfill({ json: [{ event: { ...event, id: q.p_event_id }, tiers: [{ id: '6b000000-0000-4000-8000-000000000001', name: 'General admission', description: null, unit_amount_minor: 1200, currency: 'usd', availability_status: 'available' }] }] })
    }
    if (rpc === 'get_public_waitlist_capability') return route.fulfill({ json: { enabled: false, eligible: false } })
    return route.abort()
  })
  await page.route('**/functions/v1/**', async route => {
    if (!route.request().url().endsWith('/public-discovery')) return route.abort()
    counts.list++
    if (state.failList) return route.fulfill({ status: 503, json: {} })
    const q = route.request().postDataJSON() as { cursor?: string; category?: string; admissionType?: string; bounds?: unknown }
    lastListBounds = q.bounds
    const offset = q.cursor ? Number(q.cursor.slice(5)) : 0
    const matches = state.empty || q.category === 'fitness' || q.admissionType === 'free' ? [] : rows
    if (state.slowMusic && q.category === 'music') await new Promise(resolve => setTimeout(resolve, 700))
    const items = matches.slice(offset, offset + 20).map(row => ({ id: row.event_id, title: row.title, category: row.category, admissionType: row.admission_type, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone, venueName: row.venue_label, city: 'Oakland', artworkReference: null, admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null } }))
    return route.fulfill({ json: { items, nextCursor: offset + 20 < matches.length ? `audit${offset + 20}` : null, ...discoveryMetadata() } })
  })
  return { counts, state, rows, get listBounds() { return lastListBounds } }
}

async function ready(page: Page, count: number) {
  await mapReference(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', String(Math.min(count, 1000)))
  await expect(page.locator('#discovery-results')).toContainText('Task 9 event 1')
  await iconReady(page)
  await expect.poll(() => page.evaluate(() => window.__phase4Map.listImages().filter(id => id.startsWith('wheretoo-icon-')).length)).toBe(page.viewportSize()!.width < 768 ? 8 : 9)
}
async function observe(page: Page) {
  await page.evaluate(() => {
    const map = window.__phase4Map
    window.__task9 = { map: 0, list: 0, icons: 0, tickets: 0, source: 0, addImage: 0, removeImage: 0, render: 0 }
    for (const id of Object.keys(map.getStyle().sources)) {
      const source = map.getSource(id) as GeoJSONSource | undefined
      if (typeof source?.setData !== 'function') continue
      const write = source.setData.bind(source)
      source.setData = (...args: Parameters<GeoJSONSource['setData']>) => { window.__task9.source++; return write(...args) }
    }
    const add = map.addImage.bind(map), remove = map.removeImage.bind(map)
    map.addImage = (...args: Parameters<typeof map.addImage>) => { window.__task9.addImage++; return add(...args) }
    map.removeImage = (...args: Parameters<typeof map.removeImage>) => { window.__task9.removeImage++; return remove(...args) }
    map.on('render', () => window.__task9.render++)
  })
}
const camera = (page: Page) => page.evaluate(() => { const m = window.__phase4Map; return [m.getCenter().lng, m.getCenter().lat, m.getZoom(), m.getPitch(), m.getBearing()] })

for (const count of [9, 500, 2000]) test(`${count} events: Map/List keeps one renderer and fresh data without source or icon churn`, async ({ page, isMobile }, info) => {
  const f = await fixtures(page, count)
  await page.goto('/discover?category=music&price=paid')
  await ready(page, count)
  expect(f.counts.map).toBe(1); expect(f.counts.list).toBe(1)
  await page.getByRole('button', { name: 'Choose an event on the map', exact: true }).click()
  await page.getByRole('button', { name: 'Open Task 9 event 1 event preview', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Task 9 event 1', exact: true })).toBeVisible()
  await page.waitForFunction(() => !window.__phase4Map.isMoving())
  const settledBounds = await page.evaluate(() => { const b = window.__phase4Map.getBounds()!; return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() } })
  await expect.poll(() => f.listBounds).toEqual(discoveryBounds(settledBounds))
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
  const beforeCamera = await camera(page), before = { ...f.counts }
  const dimensions = await page.locator('.living-map__canvas').boundingBox()
  await observe(page)
  const mapScroll = await page.evaluate(() => scrollY)
  const listStart = Date.now()
  const listButton = page.getByRole('button', { name: 'List', exact: true })
  if (isMobile) await listButton.tap(); else await listButton.click()
  await expect(page).toHaveURL('/discover?category=music&price=paid&view=list')
  await expect(listButton).toHaveAttribute('aria-pressed', 'true')
  await expect(listButton).toBeFocused()
  await expect(page.getByRole('region', { name: 'Explore the Bay Area', exact: true })).toHaveCount(0)
  await expect(page.locator('#discovery-map-panel')).toHaveAttribute('inert', '')
  await expect(page.getByRole('heading', { name: 'Events in this area', exact: true })).toBeVisible()
  await expect(page.locator('.discovery-event-list')).toHaveCSS('display', 'grid')
  const listSwitchMs = Date.now() - listStart
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(mapScroll, 0)
  if (isMobile) {
    const cards = await page.locator('.discovery-event-row').evaluateAll(nodes => nodes.slice(0, 2).map(node => node.getBoundingClientRect().toJSON()))
    expect(cards[1].top).toBeGreaterThanOrEqual(cards[0].bottom)
  }
  // A selected paid preview normally polls every 15s. Hidden mode must detach it.
  await page.waitForTimeout(count === 9 ? 16000 : 800)
  expect(f.counts).toEqual(before)
  const hiddenDimensions = await page.locator('.living-map__canvas').boundingBox()
  expect(hiddenDimensions?.width).toBe(dimensions?.width); expect(hiddenDimensions?.height).toBe(dimensions?.height)
  await shot(page, info, `list-${count}`)
  const mapStart = Date.now()
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page).toHaveURL('/discover?category=music&price=paid')
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeFocused()
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', f.rows[0].event_id)
  await expect(page.getByRole('region', { name: 'Task 9 event 1', exact: true })).toBeVisible()
  const mapSwitchMs = Date.now() - mapStart
  expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  expect(await camera(page)).toEqual(beforeCamera)
  await expect.poll(() => f.counts.map).toBe(before.map + (count > 1000 ? 1 : 0)); expect(f.counts.list).toBe(before.list); expect(f.counts.icons).toBe(before.icons); expect(f.counts.png).toBe(before.png)
  const measures = await page.evaluate(() => window.__task9)
  expect(measures.source).toBe(0); expect(measures.addImage).toBe(0); expect(measures.removeImage).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await shot(page, info, `map-${count}`)
  const path = info.outputPath('switch-measurements.json')
  writeFileSync(path, JSON.stringify({ count, before, after: f.counts, listSwitchMs, mapSwitchMs, measures, camera: beforeCamera }, null, 2))
  await info.attach('switch-measurements', { path, contentType: 'application/json' })
})

test('List pagination, per-view scroll, event return and browser history preserve context', async ({ page }, info) => {
  const f = await fixtures(page, 500)
  await page.goto('/discover?when=upcoming&category=music&view=list')
  await mapReference(page)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('20 events')
  expect(f.counts.map).toBe(0); expect(f.counts.icons).toBe(0)
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('40 events')
  expect(f.counts.list).toBe(2)
  await page.getByRole('link', { name: 'View Task 9 event 23', exact: true }).scrollIntoViewIfNeeded()
  const scroll = await page.evaluate(() => scrollY)
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await ready(page, 500)
  await page.goBack()
  await expect(page).toHaveURL('/discover?when=upcoming&category=music&view=list')
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('40 events')
  await page.getByRole('link', { name: 'View Task 9 event 23', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Get tickets', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse events', exact: true })).toHaveAttribute('href', '/discover?when=upcoming&category=music&view=list')
  const mapReads = f.counts.map
  await page.goBack()
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('40 events')
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0)
  expect(f.counts.map).toBe(mapReads)
  await expect(page.getByRole('link', { name: 'View Task 9 event 23', exact: true })).toBeFocused()
  await shot(page, info, 'list-history-return')
})

test('active List refresh invalidates map coverage; empty/error/retry and rapid filters stay accurate', async ({ page }) => {
  const f = await fixtures(page, 9)
  await page.goto('/discover')
  await ready(page, 9)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  f.state.empty = true
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('No events in this map area yet.', { exact: true })).toBeVisible()
  const beforeMap = f.counts.map
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '0')
  expect(f.counts.map).toBe(beforeMap + 1)
  await expect(page.getByText('No events found in this area.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  f.state.failList = true
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t load events.')
  await expect(page.getByText('No events in this map area yet.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Couldn’t refresh events. Showing the last results we received.', { exact: true })).toHaveCount(0)
  f.state.failList = false; f.state.empty = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('9 events')
  f.state.slowMusic = true
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('music')
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('fitness')
  await expect(page.getByText('No events match these filters in this area.', { exact: true })).toBeVisible()
  await page.waitForTimeout(900)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('0 events')
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '0')
})

test('hidden resize preserves List geography and pagination until Map resumes', async ({ page, isMobile }) => {
  const f = await fixtures(page, 500)
  await page.goto('/discover')
  await ready(page, 500)
  const beforeCamera = await camera(page)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('40 events')
  const before = { ...f.counts }, area = await page.evaluate(() => window.__phase4Map.getBounds()?.toArray())
  await page.setViewportSize(isMobile ? { width: 844, height: 390 } : { width: 1000, height: 700 })
  await page.waitForTimeout(700)
  expect(f.counts).toEqual(before)
  expect(await page.evaluate(() => window.__phase4Map.getBounds()?.toArray())).toEqual(area)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('40 events')
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  expect(await camera(page)).toEqual(beforeCamera)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const unavailable of [false, true]) test(`selection after List event return keeps toggle focus; unavailable=${unavailable}`, async ({ page }) => {
  const f = await fixtures(page, 9)
  await page.goto('/discover?category=music')
  await ready(page, 9)
  await page.getByRole('button', { name: 'Choose an event on the map', exact: true }).click()
  await page.getByRole('button', { name: 'Open Task 9 event 1 event preview', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Task 9 event 1', exact: true })).toBeVisible()
  await page.waitForFunction(() => !window.__phase4Map.isMoving())
  const beforeCamera = await camera(page)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('link', { name: 'View Task 9 event 2', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Get tickets', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true')
  f.state.empty = unavailable
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await mapReference(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', unavailable ? '' : f.rows[0].event_id)
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeFocused()
  expect(await camera(page)).toEqual(beforeCamera)
  if (unavailable) await expect(page.getByRole('region', { name: 'Task 9 event 1', exact: true })).toHaveCount(0)
})

test('List owns bounded periodic refresh; expired map coverage revalidates once on resume', async ({ page }) => {
  test.setTimeout(120000)
  const f = await fixtures(page, 9)
  await page.goto('/discover')
  await ready(page, 9)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  const before = { ...f.counts }
  await page.waitForTimeout(65000)
  expect(f.counts.map).toBe(before.map)
  expect(f.counts.icons).toBe(before.icons)
  expect(f.counts.tickets).toBe(before.tickets)
  expect(f.counts.list).toBe(before.list + 1)
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect.poll(() => f.counts.map).toBe(before.map + 1)
  await expect.poll(() => f.counts.icons).toBe(before.icons + 1)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '9')
  await page.waitForTimeout(700)
  expect(f.counts.map).toBe(before.map + 1)
})

test('direct List broadens through the retained camera and supports keyboard switching', async ({ page }) => {
  const f = await fixtures(page, 500)
  await page.goto('/discover?category=music&view=list')
  await mapReference(page)
  await expect(page.getByRole('status', { name: 'Discovery results', exact: true })).toHaveText('20 events')
  expect(f.counts.map).toBe(0); expect(f.counts.icons).toBe(0)
  const before = await camera(page), bounds = f.listBounds
  await page.getByRole('button', { name: 'Zoom out to search a wider area', exact: true }).click()
  await expect.poll(async () => (await camera(page))[2]).toBeLessThan(before[2])
  await expect.poll(() => f.counts.list).toBe(2)
  expect(f.listBounds).not.toEqual(bounds)
  expect(f.counts.map).toBe(0); expect(f.counts.icons).toBe(0)
  await page.getByRole('button', { name: 'List', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeFocused()
  await expect(page).toHaveURL('/discover?category=music')
  await expect.poll(() => f.counts.map).toBe(1)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'List', exact: true })).toBeFocused()
  await expect(page).toHaveURL('/discover?category=music&view=list')
  expect(f.counts.list).toBe(2)
})

test('the bounded event chooser retains its page, scroll and camera across view switches', async ({ page }) => {
  const f = await fixtures(page, 500)
  await page.goto('/discover')
  await ready(page, 500)
  await page.getByRole('button', { name: 'Choose an event on the map', exact: true }).click()
  await page.getByRole('button', { name: 'Show more events', exact: true }).click()
  await expect(page.locator('.event-chooser__row')).toHaveCount(40)
  await page.waitForFunction(() => !window.__phase4Map.isMoving())
  const b = await page.evaluate(() => { const b = window.__phase4Map.getBounds()!; return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() } })
  await expect.poll(() => f.listBounds).toEqual(discoveryBounds(b))
  const scroll = await page.locator('.event-chooser__scroll').evaluate(node => node.scrollTop)
  const savedCamera = await camera(page), reads = f.counts.map
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.locator('.event-chooser')).toHaveCount(0)
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.locator('.event-chooser__row')).toHaveCount(40)
  expect(await page.locator('.event-chooser__scroll').evaluate(node => node.scrollTop)).toBeCloseTo(scroll, 0)
  expect(await camera(page)).toEqual(savedCamera)
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeFocused()
  expect(f.counts.map).toBe(reads)
})

test('native Back and Forward restore the exact browsing position of each view', async ({ page }) => {
  await fixtures(page, 9)
  await page.goto('/discover')
  await ready(page, 9)
  const mapScroll = await page.evaluate(() => scrollY)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('link', { name: 'View Task 9 event 7', exact: true }).scrollIntoViewIfNeeded()
  const listScroll = await page.evaluate(() => scrollY)
  expect(listScroll).toBeGreaterThan(mapScroll + 100)
  await page.goBack()
  await expect(page).toHaveURL('/discover')
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(mapScroll, 0)
  await page.goForward()
  await expect(page).toHaveURL('/discover?view=list')
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(listScroll, 0)
})
