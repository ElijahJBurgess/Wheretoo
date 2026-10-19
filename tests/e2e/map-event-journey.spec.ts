import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { mapReference } from './support/combinedMapObservations'
const id = '3e000000-0000-4000-8000-000000000001'
const second = '3e000000-0000-4000-8000-000000000002'
const tier = '3e000000-0000-4000-8000-000000000003'
const image = '3e000000-0000-4000-8000-000000000004'
const title = 'Community evening gathering'
const description = 'Join local artists, musicians and neighbors for performances, food and conversation. Doors open early, with a relaxed welcome and time to explore. '.repeat(8).trim()
function event(admission: 'paid' | 'free') {
  return { id, title, description, category: 'music', starts_at: new Date(Date.now() + 3600000).toISOString(), ends_at: new Date(Date.now() + 7200000).toISOString(), timezone: 'America/Los_Angeles', venue_name: 'Community hall', address_line1: '123 Broadway', address_line2: null, city: 'Oakland', region: 'CA', postal_code: '94612', country_code: 'US', latitude: 37.804, longitude: -122.263, artwork_path: null, animation_preset: 'generic', minimum_age: 'all_ages', advisories: [], organizer: { id: second, display_name: 'Community organizer' }, admission_type: admission }
}
async function fixtures(page: Page, admission: 'paid' | 'free' = 'paid', previewTitle = title) {
  const state = { available: true, expired: false, brokenImage: false, hasImage: false, soldOut: false, mapReads: 0, ticketReads: 0, overnight: false }
  await page.route('**/rest/v1/rpc/**', async route => {
    const rpc = new URL(route.request().url()).pathname.split('/').pop()
    const e = event(admission)
    if (state.overnight) {
      const start = new Date(); start.setUTCDate(start.getUTCDate() + 1); start.setUTCHours(6, 0, 0, 0)
      e.starts_at = start.toISOString(); e.ends_at = new Date(start.getTime() + 2 * 3600000).toISOString()
    }
    if (rpc === 'get_public_filtered_map_events') {
      state.mapReads++
      const rows = !state.available ? [] : [id, second].map((event_id, i) => ({ event_id, title: i ? 'Second community gathering' : previewTitle, category: e.category, starts_at: state.expired ? new Date(Date.now() - 7200000).toISOString() : e.starts_at, ends_at: state.expired ? new Date(Date.now() - 1000).toISOString() : e.ends_at, timezone: e.timezone, latitude: e.latitude, longitude: e.longitude, animation_preset: e.animation_preset, venue_label: e.venue_name, admission_type: admission, minimum_price_minor: admission === 'paid' ? 1200 : null, minimum_age: e.minimum_age, advisories: [], artwork_reference: null, map_icon_version_id: null }))
      return route.fulfill({ json: rows, headers: { 'access-control-expose-headers': 'content-range, X-Wheretoo-Discovery', 'X-Wheretoo-Discovery': JSON.stringify({ serverNow: new Date().toISOString(), window: { start: new Date().toISOString(), end: new Date(Date.now() + 168 * 3600000).toISOString(), timezone: 'America/Los_Angeles' } }), 'content-range': rows.length ? '0-1/2' : '*/0' } })
    }
    if (rpc === 'get_public_event_ticketing') { state.ticketReads++; return route.fulfill({ json: state.available ? [{ event: e, tiers: admission === 'free' ? [] : [{ id: tier, name: 'General admission', description: null, unit_amount_minor: 1200, currency: 'usd', availability_status: state.soldOut ? 'sold_out' : 'available' }] }] : [] }) }
    if (rpc === 'get_public_event') return route.fulfill({ json: state.available ? [e] : [] })
    if (rpc === 'get_public_free_rsvp') return route.fulfill({ json: { event: e, availability: { status: 'available', remaining: 20, maxQuantity: 10 } } })
    if (rpc === 'list_event_images') return route.fulfill({ json: state.brokenImage || state.hasImage ? [{ id: image, eventId: id, path: id + '/missing.png', position: 1, owned: null }] : [] })
    if (rpc === 'get_public_waitlist_capability') return route.fulfill({ json: { enabled: false, eligible: false } })
    if (rpc === 'get_public_map_icon_versions') return route.fulfill({ json: [] })
    return route.abort()
  })
  // These tests never create an RSVP, checkout or other server mutation.
  await page.route('**/functions/v1/**', route => route.abort())
  return state
}
async function ready(page: Page) {
  await mapReference(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '2')
}
async function camera(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready
    const m = window.__phase4Map
    let previous = '', stableFrames = 0
    // Preview camera fitting starts on an animation frame. A single isMoving()
    // read can precede that frame and capture an intermediate return position.
    for (let frame = 0; frame < 300; frame++) {
      await new Promise(requestAnimationFrame)
      const snapshot = { center: m.getCenter().toArray(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() }
      const key = JSON.stringify(snapshot)
      stableFrames = !m.isMoving() && key === previous ? stableFrames + 1 : 0
      if (stableFrames >= 6) return snapshot
      previous = key
    }
    throw new Error('Camera did not settle')
  })
}
async function select(page: Page) {
  const trigger = page.getByRole('button', { name: 'Choose an event on the map' })
  await expect(trigger).toBeEnabled()
  await trigger.focus(); await page.keyboard.press('Enter')
  const choice = page.getByRole('button', { name: `Open ${title} event preview`, exact: true })
  await choice.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: title, exact: true })).toBeFocused()
}
test('map camera, selection, keyboard focus, browser history and paid ticket landing', async ({ page }, info) => {
  await fixtures(page)
  await page.goto('/map'); await ready(page)
  const originalCanvas = await page.locator('.mapboxgl-canvas').elementHandle()
  await page.evaluate(() => { window.__phase4Map.jumpTo({ center: [-122.264, 37.803], zoom: 16.25, bearing: 12, pitch: 40 }) })
  await select(page)
  await page.getByRole('button', { name: 'Back to events', exact: true }).click()
  await expect(page.getByRole('button', { name: `Open ${title} event preview`, exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Choose an event on the map' })).toBeFocused()
  await select(page)
  await expect.poll(() => page.evaluate(() => window.__phase4Map.isMoving())).toBe(false)
  const before = await camera(page)
  expect(await originalCanvas!.evaluate(n => n === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  await page.getByRole('link', { name: 'View event', exact: true }).click()
  const savedCamera = await page.evaluate(() => window.history.state?.usr?.mapReturn?.camera)
  await expect(page.getByRole('link', { name: 'Return to map', exact: true })).toHaveAttribute('href', '/map')
  const action = page.getByRole('link', { name: 'Get tickets', exact: true })
  await expect(action).toBeInViewport()
  const quantity = page.getByLabel('General admission quantity', { exact: true })
  await quantity.fill('2')
  await action.click()
  await expect(quantity).toHaveValue('2'); await expect(quantity).toBeFocused(); await expect(quantity).toBeInViewport()
  await expect(page.locator('.buyer-event__description')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('ticket-landing.png') })
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`/events/${id}\\?`))
  await page.goBack(); await ready(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', id)
  const after = await camera(page)
  expect(savedCamera).toEqual(before)
  expect(after.zoom).toBeCloseTo(before.zoom, 4); expect(after.pitch).toBeCloseTo(before.pitch, 4); expect(after.bearing).toBeCloseTo(before.bearing, 4)
  expect(after.center[0]).toBeCloseTo(before.center[0], 5); expect(after.center[1]).toBeCloseTo(before.center[1], 5)
  await page.getByRole('button', { name: 'Close event preview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Choose an event on the map' })).toBeFocused()
  await info.attach('camera-continuity', { body: JSON.stringify({ before, after }), contentType: 'application/json' })
})
test('removed and expired events cannot restore selection from history', async ({ page }) => {
  const state = await fixtures(page)
  for (const unavailable of ['expired', 'removed']) {
    state.available = true; state.expired = false
    await page.goto('/map'); await ready(page); await select(page)
    await page.getByRole('link', { name: 'View event', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Get tickets', exact: true })).toBeVisible()
    if (unavailable === 'expired') state.expired = true
    else state.available = false
    await page.goBack(); await mapReference(page)
    await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', '')
    await expect(page.locator('.event-preview h2')).toHaveCount(0)
  }
})
test('free RSVP action precedes long copy and retains map return context', async ({ page }, info) => {
  await fixtures(page, 'free'); await page.goto('/map'); await ready(page); await select(page)
  const before = await camera(page)
  await page.getByRole('link', { name: 'View event', exact: true }).click()
  const action = page.getByRole('link', { name: 'RSVP for free', exact: true })
  await expect(action).toBeInViewport()
  await page.screenshot({ path: info.outputPath('free-event-primary-action.png') })
  await action.click()
  await expect(page.getByRole('button', { name: 'Increase quantity', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('heading', { name: 'Choose your RSVP', exact: true })).toBeFocused()
  await page.screenshot({ path: info.outputPath('rsvp-entry.png') })
  await page.getByRole('link', { name: 'Return to event', exact: true }).click()
  await page.getByRole('link', { name: 'Return to map', exact: true }).click(); await ready(page)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', id)
  expect((await camera(page)).zoom).toBeCloseTo(before.zoom, 4)
})
test('failed covers collapse to no-artwork layout; sold-out and unavailable states stay clear', async ({ page }, info) => {
  const state = await fixtures(page); state.brokenImage = true
  const brokenCover = page.waitForEvent('requestfailed', request => request.url().includes('event-images?id='))
  await page.goto(`/events/${id}`)
  await brokenCover
  await expect(page.getByRole('link', { name: 'Get tickets', exact: true })).toBeInViewport()
  await expect(page.locator('.buyer-event-hero__image')).toHaveCount(0)
  await expect(page.locator('.buyer-event-hero--no-artwork')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('broken-cover.png') })
  state.soldOut = true; await page.reload()
  await expect(page.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled()
  state.available = false; await page.reload()
  await expect(page.getByRole('heading', { name: 'Event not found', exact: true })).toBeVisible()
})

test('embedded discovery preserves canonical filters, scroll and map context', async ({ page }) => {
  await fixtures(page)
  await page.route('**/functions/v1/public-discovery', route => {
    const e = event('paid')
    return route.fulfill({ json: { items: [{ id, title, category: e.category, admissionType: 'paid', startsAt: e.starts_at, endsAt: e.ends_at, timezone: e.timezone, venueName: e.venue_name, city: e.city, artworkReference: null, admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null } }], nextCursor: null, window: { start: new Date().toISOString(), end: e.ends_at, timezone: e.timezone }, serverNow: new Date().toISOString() } })
  })
  const search = '?when=weekend&category=music&price=paid'
  await page.goto('/discover' + search)
  await expect(page.locator('.living-map')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60000 })
  // Existing read-only helper instruments a standalone main; embedded uses the same renderer.
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '2')
  await select(page)
  await page.getByRole('link', { name: 'View event', exact: true }).scrollIntoViewIfNeeded()
  const scrollBefore = await page.evaluate(() => scrollY)
  await page.getByRole('link', { name: 'View event', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Browse events', exact: true })).toHaveAttribute('href', '/discover' + search)
  await page.goBack()
  await expect(page).toHaveURL('/discover' + search)
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-selected-event-id', id)
  await expect(page.getByRole('combobox', { name: 'Date', exact: true })).toHaveValue('weekend')
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(scrollBefore, 0)
})

async function expectTouchHit(page: Page, selector: string) {
  const hit = await page.locator(selector).evaluate(node => {
    const r = node.getBoundingClientRect()
    const owner = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return Boolean(owner && node.contains(owner))
  })
  if (!hit) console.log('touch-hit diagnostic', await page.locator(selector).evaluate(node => {
    const r = node.getBoundingClientRect(), map = node.closest('.living-map')!.getBoundingClientRect()
    const owner = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { control: r.toJSON(), map: map.toJSON(), viewport: [innerWidth, innerHeight], scrollY, owner: owner?.className }
  }))
  expect(hit, `${selector} must receive a touch at its visible center`).toBe(true)
}

test('mobile overlays fit the map, expose chooser rows and keep long titles clear of close controls', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'Mobile touch layout regression')
  const longTitle = 'Oakland community night: live music, local food and an evening by the lake'
  const state = await fixtures(page, 'paid', longTitle)
  for (const route of ['/map', '/discover']) {
    state.available = true
    await page.goto(route); await ready(page)
    await page.locator('.living-map').scrollIntoViewIfNeeded()
    const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
    await page.getByRole('button', { name: 'Choose an event on the map' }).tap()
    const chooser = page.getByRole('region', { name: '2 events here' })
    await expect(chooser).toBeVisible()
    const fits = await chooser.evaluate(node => {
      const panel = node.getBoundingClientRect(), map = node.closest('.living-map')!.getBoundingClientRect()
      return panel.top >= map.top && panel.bottom <= map.bottom && panel.left >= map.left && panel.right <= map.right
    })
    expect(fits, `${route} chooser must stay inside its map container`).toBe(true)
    await expectTouchHit(page, '.event-preview__close')
    await page.getByRole('button', { name: `Open ${longTitle} event preview`, exact: true }).tap()
    await expect(page.locator('.event-preview__artwork-fallback')).toBeVisible()
    const overlap = await page.locator('.event-preview').evaluate(node => {
      const a = node.querySelector('h2')!.getBoundingClientRect(), b = node.querySelector('.event-preview__close')!.getBoundingClientRect()
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    })
    expect(overlap, 'Event title must not intersect its close button').toBe(false)
    await expectTouchHit(page, '.event-preview__close')
    await expectTouchHit(page, '.event-preview__action')
    await expectTouchHit(page, '.mapboxgl-ctrl-zoom-in')
    await expectTouchHit(page, '.mapboxgl-ctrl-zoom-out')
    expect(await page.locator('.event-preview__action').evaluate(node => {
      const r = node.getBoundingClientRect(), panel = node.closest('.event-preview')!.getBoundingClientRect()
      return r.top >= panel.top && r.bottom <= panel.bottom
    })).toBe(true)
    await page.screenshot({ path: info.outputPath(route.slice(1) + '-usable-preview.png') })
    await page.getByRole('button', { name: 'Close event preview', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Choose an event on the map' })).toBeFocused()
    const zoom = await page.locator('.mapboxgl-ctrl-zoom-in').boundingBox()
    expect(zoom!.width).toBeGreaterThanOrEqual(44); expect(zoom!.height).toBeGreaterThanOrEqual(44)
    await expectTouchHit(page, '.mapboxgl-ctrl-zoom-in')
    const masthead = await page.locator('.living-map__masthead').boundingBox()
    expect(masthead!.x + masthead!.width <= zoom!.x || masthead!.y >= zoom!.y + zoom!.height).toBe(true)
    state.available = false
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText('No events found in this area.', { exact: true })).toBeVisible()
    const feedback = await page.locator('.living-map__event-status').boundingBox()
    const controls = await page.locator('.mapboxgl-ctrl-top-right').boundingBox()
    expect(feedback!.x + feedback!.width <= controls!.x || feedback!.y >= controls!.y + controls!.height).toBe(true)
    await expectTouchHit(page, '.mapboxgl-ctrl-zoom-in')
    expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('selected mobile overlays adapt to dynamic height and reduced motion without replacing the map', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'Mobile touch layout regression')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await fixtures(page); await page.goto('/map'); await ready(page)
  const filtered = page.waitForResponse(response => response.url().endsWith('/rpc/get_public_filtered_map_events') && response.request().postDataJSON()?.p_when === 'today')
  await page.getByRole('combobox', { name: 'Date', exact: true }).selectOption('today')
  await filtered
  await expect(page.locator('.living-map__canvas')).toHaveAttribute('data-wheretoo-event-count', '2')
  await select(page)
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: viewport.width, height: Math.max(280, viewport.height - 80) })
  // Container query sizes and Mapbox's ResizeObserver settle on the next frame.
  await expect.poll(() => page.locator('.event-preview').evaluate(node => {
    const p = node.getBoundingClientRect(), m = node.closest('.living-map')!.getBoundingClientRect()
    return p.top >= m.top && p.bottom <= m.bottom
  }), { timeout: 1000, intervals: [16, 32, 64] }).toBe(true)
  const mapBox = (await page.locator('.living-map').boundingBox())!
  if (mapBox.height >= 124) {
    const scrollPane = await page.locator('.event-preview__scroll').boundingBox()
    expect(scrollPane!.height, 'The scrolling event pane must leave readable space below its close header').toBeGreaterThanOrEqual(100)
  }
  // A full-height header is impossible in the smallest map. Verify actual readable
  // text through internal scrolling instead of merely accepting a clipped pane.
  const readable = await page.locator('.event-preview h2').evaluate(async node => {
    node.scrollIntoView({ block: 'start', behavior: 'instant' })
    const scroll = node.closest('.event-preview__scroll')!
    // Close now has a dedicated fixed corner; title reserves its horizontal
    // space, so scrolling no longer needs to subtract an eyebrow header.
    scroll.scrollTop = Math.max(0, scroll.scrollTop - 8)
    await new Promise(requestAnimationFrame)
    const text = node.firstChild!
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 5)
    const r = range.getBoundingClientRect(), pane = node.closest('.event-preview__scroll')!.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return r.top >= pane.top && r.bottom <= pane.bottom && Boolean(hit && node.contains(hit))
  })
  expect(readable, 'An event title line must be readable after deliberate internal scrolling').toBe(true)
  await page.locator('.event-preview__scroll').evaluate(node => { node.scrollTop = 0 })
  await expectTouchHit(page, '.event-preview__close')
  await expectTouchHit(page, '.event-preview__action')
  await expectTouchHit(page, '.mapboxgl-ctrl-zoom-in')
  await expectTouchHit(page, '.mapboxgl-ctrl-zoom-out')
  expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Choose an event on the map' })).toBeFocused()
})

test('short landscape event artwork keeps RSVP entry and quantity controls reachable', async ({ page }, info) => {
  const size = page.viewportSize()!
  test.skip(!info.project.use.hasTouch || size.width <= size.height, 'Touch landscape regression')
  const state = await fixtures(page, 'free'); state.hasImage = true
  await page.route('**/functions/v1/event-images?*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#30264f"/></svg>' }))
  await page.goto(`/events/${id}`)
  await expect(page.locator('.buyer-event-hero__image')).toBeVisible()
  const action = page.getByRole('link', { name: 'RSVP for free', exact: true })
  await expect(action).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: info.outputPath('landscape-rsvp-with-artwork.png') })
  await action.tap()
  await expect(page.getByRole('button', { name: 'Increase quantity', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('heading', { name: 'Choose your RSVP', exact: true })).toBeFocused()
})

test('compact preview exposes essential facts, contains artwork and leaves landscape map context', async ({ page }, info) => {
  const state = await fixtures(page, 'paid', 'Rooftop Jazz at Golden Hour')
  state.hasImage = true; state.overnight = true
  await page.route('**/functions/v1/event-images?*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#30264f"/><rect width="400" height="24" fill="#c5b5ff"/><rect y="476" width="400" height="24" fill="#6d4aff"/></svg>' }))
  for (const path of ['/map', '/discover']) {
    await page.goto(path); await ready(page)
    await page.locator('.living-map').scrollIntoViewIfNeeded()
    const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
    const ticketReads = state.ticketReads
    await page.getByRole('button', { name: 'Choose an event on the map' }).click()
    await page.getByRole('button', { name: 'Open Rooftop Jazz at Golden Hour event preview', exact: true }).click()
    await expect(page.getByText('From $12', { exact: true })).toBeVisible()
    const panel = page.locator('.event-preview')
    const geometry = await panel.evaluate(node => {
      const bounds = (el: Element) => el.getBoundingClientRect()
      const scroll = node.querySelector('.event-preview__scroll')!, pane = bounds(scroll)
      const facts = [node.querySelector('h2')!, ...node.querySelectorAll('.event-preview__details, .event-preview__admission')]
      const map = bounds(node.closest('.living-map')!), card = bounds(node)
      return {
        factsVisible: facts.every(el => { const r = bounds(el); return r.top >= pane.top && r.bottom <= pane.bottom }),
        contained: card.top >= map.top && card.bottom <= map.bottom && card.left >= map.left && card.right <= map.right,
        covered: card.width * card.height / (map.width * map.height),
        viewport: [innerWidth, innerHeight],
        fit: getComputedStyle(node.querySelector('img')!).objectFit,
      }
    })
    if (geometry.viewport[1] >= 568) expect(geometry.factsVisible, `${path}: normal portrait must expose title/date/venue/admission`).toBe(true)
    expect(geometry.contained).toBe(true)
    expect(state.ticketReads - ticketReads, 'only the selected paid event requests authoritative tiers').toBe(1)
    expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
    await info.attach(`preview-geometry-${path.slice(1)}`, { body: JSON.stringify({ ...geometry, ticketReads: state.ticketReads - ticketReads }), contentType: 'application/json' })
    expect(geometry.fit).toBe('contain')
    if (geometry.viewport[0] > geometry.viewport[1]) expect(geometry.covered, 'short landscape retains most of its map').toBeLessThan(0.55)
    await expectTouchHit(page, '.event-preview__close')
    await expectTouchHit(page, '.event-preview__action')
    await expectTouchHit(page, '.event-preview__back')
    for (const selector of ['.mapboxgl-ctrl-zoom-in', '.mapboxgl-ctrl-zoom-out']) {
      const control = await page.locator(selector).evaluate(node => {
        const r = node.getBoundingClientRect(), card = node.closest('.living-map')!.querySelector('.event-preview')!.getBoundingClientRect()
        const x = r.x + r.width / 2, y = r.y + r.height / 2
        const barBottom = document.querySelector('.discovery-mode-bar')?.getBoundingClientRect().bottom ?? 0
        return { covered: x >= card.left && x <= card.right && y >= card.top && y <= card.bottom, onScreen: r.top >= barBottom && r.bottom <= innerHeight }
      })
      expect(control.covered, 'The preview must leave zoom controls clear').toBe(false)
      // Short landscape maps extend behind the sticky mode bar. Their offscreen
      // controls become reachable by scrolling, not by shrinking the preview.
      if (control.onScreen) await expectTouchHit(page, selector)
    }
    await page.screenshot({ path: info.outputPath(`compact-${path.slice(1)}.png`) })
  }
})

test('landscape artwork remains uncropped in the portrait-aware preview', async ({ page }, info) => {
  const state = await fixtures(page); state.hasImage = true
  await page.route('**/functions/v1/event-images?*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#30264f"/><rect width="24" height="400" fill="#c5b5ff"/><rect x="776" width="24" height="400" fill="#6d4aff"/></svg>' }))
  await page.goto('/map'); await ready(page); await select(page)
  const image = page.getByRole('img', { name: title + ' artwork' })
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(800)
  expect(await image.evaluate(node => getComputedStyle(node).objectFit)).toBe('contain')
  await expectTouchHit(page, '.event-preview__close')
  await expectTouchHit(page, '.event-preview__action')
  await page.screenshot({ path: info.outputPath('landscape-artwork-contained.png') })
})

test('tiny demo preview keeps disabled actions and explanation readable', async ({ page, baseURL }, info) => {
  test.skip(baseURL !== 'http://127.0.0.1:3114', 'Development-only fixture is intentionally absent from hosted builds')
  await fixtures(page)
  await page.setViewportSize({ width: 844, height: 224 })
  await page.goto('/map?mapFixture=standard'); await mapReference(page)
  await page.getByRole('button', { name: 'Choose an event on the map' }).click()
  await page.getByRole('button', { name: 'Open Outdoor Cinema event preview', exact: true }).click()
  const action = page.getByRole('button', { name: 'View event', exact: true })
  await expect(action).toBeDisabled()
  const back = page.getByRole('button', { name: 'Back to events', exact: true })
  for (const control of [action, back]) {
    const size = await control.boundingBox()
    expect(size!.width, 'Explanation must not squeeze controls').toBeGreaterThanOrEqual(44)
    expect(size!.height).toBeGreaterThanOrEqual(44)
  }
  const explanation = page.getByText('Demo event — full event page not connected yet.', { exact: true })
  await explanation.scrollIntoViewIfNeeded()
  expect(await explanation.evaluate(node => {
    const r = node.getBoundingClientRect(), panel = node.closest('.event-preview')!.getBoundingClientRect()
    return r.top >= panel.top && r.bottom <= panel.bottom
  })).toBe(true)
  await page.screenshot({ path: info.outputPath('tiny-demo-explanation.png') })
  await back.click()
  await expect(page.getByRole('region', { name: /events? here$/ })).toBeVisible()
})

test('preview availability checks, recovers and never promotes a cached tier price', async ({ page }) => {
  const state = await fixtures(page); state.brokenImage = true
  const brokenCover = page.waitForEvent('requestfailed', request => request.url().includes('event-images?id='))
  let mode: 'checking' | 'available' | 'mixed' | 'sold_out' | 'unknown' | 'unavailable' = 'checking'
  let release!: () => void
  const initialRead = new Promise<void>(resolve => { release = resolve })
  let reads = 0
  await page.route('**/rest/v1/rpc/get_public_event_ticketing', async route => {
    reads++
    if (mode === 'checking') await initialRead
    if (mode === 'unknown') return route.abort()
    if (mode === 'unavailable') return route.fulfill({ json: [] })
    const tiers = [{ id: tier, name: 'Early bird', description: null, unit_amount_minor: 1200, currency: 'usd', availability_status: mode === 'mixed' || mode === 'sold_out' ? 'sold_out' : 'available' }]
    if (mode === 'mixed') tiers.push({ ...tiers[0], id: second, name: 'General admission', unit_amount_minor: 2800, availability_status: 'available' })
    return route.fulfill({ json: [{ event: event('paid'), tiers }] })
  })
  await page.route('**/rest/v1/rpc/get_public_event', route => route.fulfill({ json: mode === 'unavailable' ? [] : [event('paid')] }))
  await page.goto('/map'); await ready(page)
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
  await select(page)
  await expect(page.getByRole('group', { name: 'Admission', exact: true })).toHaveText('Checking availability…')
  await brokenCover
  await expect(page.locator('.event-preview__artwork-fallback')).toBeVisible()
  mode = 'available'; release()
  const admission = page.getByRole('group', { name: 'Admission', exact: true })
  await expect(admission).toHaveText('From $12')
  for (const [next, label] of [['mixed', 'From $28'], ['sold_out', 'Sold out'], ['unknown', 'Availability unknown'], ['unavailable', 'Currently unavailable'], ['available', 'From $12']] as const) {
    mode = next
    await page.getByRole('button', { name: 'Back to events', exact: true }).click()
    await page.getByRole('button', { name: `Open ${title} event preview`, exact: true }).click()
    await expect(admission).toHaveText(label)
    expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  }
  expect(reads, 'one bounded read per explicit selection; no per-marker reads').toBe(6)
})


test('photo previews stay compact across embedded and standalone maps', async ({ page }, info) => {
  const state = await fixtures(page, 'paid', 'Rooftop Jazz at Golden Hour'); state.hasImage = true
  await page.route('**/functions/v1/event-images?*', route => route.fulfill({ contentType: 'image/png', body: readFileSync('src/preview/assets/rooftop-reference.png') }))
  for (const path of ['/map', '/discover']) {
    await page.goto(path); await ready(page)
    await page.locator('.living-map').scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: 'Choose an event on the map' }).click()
    await page.getByRole('button', { name: 'Open Rooftop Jazz at Golden Hour event preview', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Admission', exact: true })).toHaveText('From $12')
    const image = page.locator('.event-preview__artwork')
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect(await image.evaluate(node => getComputedStyle(node).objectFit)).toBe('contain')
    const geometry = await page.locator('.event-preview').evaluate(node => {
      const pane = node.querySelector('.event-preview__scroll')!.getBoundingClientRect()
      const facts = [node.querySelector('h2')!, ...node.querySelectorAll('.event-preview__details')]
      return {
        factsVisible: facts.every(el => { const r = el.getBoundingClientRect(); return r.top >= pane.top && r.bottom <= pane.bottom }),
        mapHeight: node.closest('.living-map')!.getBoundingClientRect().height,
        artworkHeight: node.querySelector('img')!.getBoundingClientRect().height,
      }
    })
    if (page.viewportSize()!.height >= 568) expect(geometry.factsVisible, `${path}: photo must not push essential facts below the first scroll view`).toBe(true)
    if (geometry.mapHeight > 608) expect(geometry.artworkHeight, 'taller maps retain the artwork-led opening').toBeGreaterThan(120)
    await expectTouchHit(page, '.event-preview__close')
    await expectTouchHit(page, '.event-preview__action')
    await page.screenshot({ path: info.outputPath(`photo-${path.slice(1)}.png`) })
  }
})
