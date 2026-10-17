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
async function fixtures(page: Page, admission: 'paid' | 'free' = 'paid') {
  const state = { available: true, expired: false, brokenImage: false, soldOut: false, mapReads: 0 }
  await page.route('**/rest/v1/rpc/**', async route => {
    const rpc = new URL(route.request().url()).pathname.split('/').pop()
    const e = event(admission)
    if (rpc === 'get_public_filtered_map_events') {
      state.mapReads++
      const rows = !state.available ? [] : [id, second].map((event_id, i) => ({ event_id, title: i ? 'Second community gathering' : title, category: e.category, starts_at: state.expired ? new Date(Date.now() - 7200000).toISOString() : e.starts_at, ends_at: state.expired ? new Date(Date.now() - 1000).toISOString() : e.ends_at, timezone: e.timezone, latitude: e.latitude, longitude: e.longitude, animation_preset: e.animation_preset, venue_label: e.venue_name, admission_type: admission, minimum_price_minor: admission === 'paid' ? 1200 : null, minimum_age: e.minimum_age, advisories: [], artwork_reference: null, map_icon_version_id: null }))
      return route.fulfill({ json: rows, headers: { 'access-control-expose-headers': 'content-range, X-Wheretoo-Discovery', 'X-Wheretoo-Discovery': JSON.stringify({ serverNow: new Date().toISOString(), window: { start: new Date().toISOString(), end: new Date(Date.now() + 168 * 3600000).toISOString(), timezone: 'America/Los_Angeles' } }), 'content-range': rows.length ? '0-1/2' : '*/0' } })
    }
    if (rpc === 'get_public_event_ticketing') return route.fulfill({ json: state.available ? [{ event: e, tiers: admission === 'free' ? [] : [{ id: tier, name: 'General admission', description: null, unit_amount_minor: 1200, currency: 'usd', availability_status: state.soldOut ? 'sold_out' : 'available' }] }] : [] })
    if (rpc === 'get_public_event') return route.fulfill({ json: state.available ? [e] : [] })
    if (rpc === 'get_public_free_rsvp') return route.fulfill({ json: { event: e, availability: { status: 'available', remaining: 20, maxQuantity: 10 } } })
    if (rpc === 'list_event_images') return route.fulfill({ json: state.brokenImage ? [{ id: image, eventId: id, path: id + '/missing.png', position: 1, owned: null }] : [] })
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
  await expect(action).toBeInViewport(); await action.click()
  await expect(page.getByRole('button', { name: 'Increase quantity', exact: true })).toBeVisible()
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
