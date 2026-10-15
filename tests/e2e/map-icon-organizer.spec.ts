import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { Map as MapboxMap } from 'mapbox-gl/esm'
import type { Database, Json } from '../../src/lib/supabase/database.types'
import { iconLibraryEnvironment } from './support/iconLibraryEnvironment.mjs'

// Mapbox's bundled feature type references an unbundled GeoJSON namespace.
// Describe only the point-feature fields this read-only harness observes.
type ProofMap = Omit<MapboxMap, 'queryRenderedFeatures'> & {
  queryRenderedFeatures(options: { layers: string[] }): Array<{
    properties?: Record<string, unknown>
    geometry: { type: string; coordinates: number[] }
  }>
}
declare global { interface Window { __phase4Map: ProofMap } }
const flag = '8d94a4cf-e61b-480a-9f1f-8b5497620dfa'
const local = await iconLibraryEnvironment()

async function shot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => page.locator('img').evaluateAll(images => images.filter(image => {
    const box = image.getBoundingClientRect()
    return image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && box.width > 0 && box.height > 0
      && box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0
  }).filter(image => !(image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))
    .map(image => ({ className: image.className, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height }))), { timeout: 15000 }).toEqual([])
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: false })
  await info.attach(name, { path, contentType: 'image/png' })
}

async function mapReference(page: Page) {
  await expect(page.locator('main')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60000 })
  await page.evaluate(() => {
    // Read-only test instrumentation: no production debug globals or map instance.
    type Hook = { memoizedState?: { current?: unknown }; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    const node = document.querySelector('.living-map__canvas') as unknown as Record<string, unknown>
    let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber'))!] as Fiber | undefined
    while (fiber) {
      let hook = fiber.memoizedState
      while (hook) {
        const value = hook.memoizedState?.current as ProofMap | undefined
        if (value && typeof value.getSource === 'function' && typeof value.project === 'function') { window.__phase4Map = value; return }
        hook = hook.next
      }
      fiber = fiber.return
    }
    throw new Error('Existing map reference unavailable')
  })
}

async function iconReady(page: Page) {
  await page.waitForFunction(() => window.__phase4Map.loaded() && window.__phase4Map.getStyle().layers?.some(layer => layer.id.startsWith('wheretoo-icon-') && layer.id.endsWith('-canonical') && window.__phase4Map.getLayoutProperty(layer.id, 'visibility') === 'visible'), null, { timeout: 30000 })
}

async function darkReady(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__phase4Map.loaded()), { timeout: 30000 }).toBe(true)
  expect(await page.evaluate(() => {
    const map = window.__phase4Map
    return ['lightPreset', 'theme', 'showPointOfInterestLabels', 'showPlaceLabels', 'showRoadLabels'].map(key => map.getConfigProperty('basemap', key))
  })).toEqual(['night', 'monochrome', true, true, true])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function verifyArtworkLighting(page: Page, info: TestInfo, center: [number, number]) {
  const point = await page.evaluate(coordinate => { const p = window.__phase4Map.project(coordinate); return { x: p.x, y: p.y } }, center)
  const night = info.outputPath('flag-night-lighting.png'), day = info.outputPath('flag-day-lighting.png')
  await page.screenshot({ path: night })
  await page.evaluate(() => { window.__phase4Map.setConfigProperty('basemap', 'lightPreset', 'day') })
  await page.waitForFunction(() => window.__phase4Map.loaded())
  await page.screenshot({ path: day })
  const crop = `36x57+${Math.round(point.x)}+${Math.round(point.y) - 64}`
  const pixels = (path: string) => execFileSync('magick', [path, '-crop', crop, '-depth', '8', 'rgb:-'])
  const a = pixels(night), b = pixels(day)
  let count = 0, total = 0
  for (let i = 0; i < a.length; i += 3) {
    // Only opaque red/yellow artwork interiors, not antialiased map edges.
    if (a[i] > 180 && a[i] > a[i + 1] * 1.2 && a[i + 2] < 120 && b[i] > 180 && b[i] > b[i + 1] * 1.2 && b[i + 2] < 120) {
      count++; total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    }
  }
  expect(count).toBeGreaterThan(200)
  expect(total / (count * 3)).toBeLessThan(3)
  await info.attach('night-artwork-brightness', { body: JSON.stringify({ comparedPixels: count, meanChannelDifference: total / (count * 3) }), contentType: 'application/json' })
  await page.evaluate(() => { window.__phase4Map.setConfigProperty('basemap', 'lightPreset', 'night') })
  await darkReady(page)
}

async function reloadSelectedStyle(page: Page, eventId: string) {
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
  const camera = await page.evaluate(() => { const m = window.__phase4Map; return [m.getCenter().lng, m.getCenter().lat, m.getZoom(), m.getPitch(), m.getBearing()] })
  await page.evaluate(async () => {
    const map = window.__phase4Map, config = map.getConfig('basemap')
    if (!config) throw new Error('Standard config unavailable before reload')
    await new Promise<void>(resolve => {
      map.once('style.load', () => resolve())
      map.setStyle('mapbox://styles/mapbox/standard', { diff: false, config: { basemap: config }, localFontFamily: undefined, localIdeographFontFamily: 'sans-serif' })
    })
  })
  await selectedIconReady(page, eventId)
  await darkReady(page)
  expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  expect(await page.evaluate(() => { const m = window.__phase4Map; return [m.getCenter().lng, m.getCenter().lat, m.getZoom(), m.getPitch(), m.getBearing()] })).toEqual(camera)
  expect(await page.evaluate(id => {
    const m = window.__phase4Map
    const layers = m.getStyle().layers!.filter(l => l.id.startsWith('wheretoo-icon-') && l.id.endsWith('-canonical')).map(l => l.id)
    const source = m.getSource('wheretoo-selected-event') as unknown as { _data: { features: unknown[] } }
    return { canonical: m.queryRenderedFeatures({ layers }).filter(f => f.properties?.eventId === id).length, selected: source._data.features.length }
  }, eventId)).toEqual({ canonical: 0, selected: 1 })
}

async function selectedIconReady(page: Page, eventId: string) {
  await page.waitForFunction(id => {
    const map = window.__phase4Map
    const layers = map.getStyle().layers?.filter(layer => layer.id.startsWith('wheretoo-icon-') && layer.id.endsWith('-selected')).map(layer => layer.id) ?? []
    return !map.isMoving() && layers.length > 0 && map.queryRenderedFeatures({ layers }).some(feature => feature.properties?.eventId === id)
  }, eventId)
}

async function openTappedPreview(page: Page, title: string) {
  const preview = page.getByRole('region', { name: title, exact: true })
  const choice = page.getByRole('button', { name: `Open ${title} event preview`, exact: true })
  await expect(preview.or(choice)).toBeVisible()
  if (await choice.isVisible()) await choice.click()
  await expect(preview).toBeVisible()
}

async function measureTip(page: Page, info: TestInfo, name: string, coordinate: [number, number]) {
  const point = await page.evaluate(center => { const p = window.__phase4Map.project(center); return { x: p.x, y: p.y } }, coordinate)
  const path = info.outputPath(`${name}-anchor.png`)
  await page.screenshot({ path })
  const left = Math.floor(point.x) - 6, top = Math.floor(point.y) - 5
  const pixels = execFileSync('magick', [path, '-crop', `13x10+${left}+${top}`, '-depth', '8', 'rgb:-'])
  const yellow: { x: number; y: number; weight: number }[] = []
  for (let y = 0; y < 10; y++) for (let x = 0; x < 13; x++) {
    const [r, g, b] = pixels.subarray((y * 13 + x) * 3, (y * 13 + x) * 3 + 3)
    if (r > 150 && g > 60 && r > g * 1.1 && b < 150) yellow.push({ x, y, weight: r - g })
  }
  expect(yellow.length).toBeGreaterThan(0)
  const last = Math.max(...yellow.map(pixel => pixel.y)), row = yellow.filter(pixel => pixel.y === last)
  const tip = { x: left + row.reduce((sum, p) => sum + (p.x + 0.5) * p.weight, 0) / row.reduce((sum, p) => sum + p.weight, 0), y: top + last + 1 }
  const delta = { x: Math.abs(tip.x - point.x), y: Math.abs(tip.y - point.y) }
  expect(delta.x).toBeLessThanOrEqual(1); expect(delta.y).toBeLessThanOrEqual(1)
  await info.attach(`${name}-anchor-measurement`, { body: JSON.stringify({ point, tip, delta }), contentType: 'application/json' })
}

async function publishFromEditor(page: Page, eventId: string) {
  await page.goto(`/organizer/events/${eventId}/edit?step=requirements`)
  await page.getByLabel('Minimum age').selectOption('all_ages')
  await page.getByRole('button', { name: 'Continue to organizer agreement' }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save agreement and preview' }).click()
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}/preview$`))
  await page.getByRole('button', { name: /^(Publish event|Publish changes)$/ }).click()
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`))
  await expect(page.getByText('This event is publicly available.', { exact: true })).toBeVisible()
}

test('isolated organizer selection, real publication, live icon and mobile tapping', async ({ page, browser }, info) => {
  const client = createClient<Database>(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `icon-phase4-${crypto.randomUUID()}@example.test`, password = `Proof-${crypto.randomUUID()}!`
  const signup = await client.auth.signUp({ email, password })
  if (signup.error || !signup.data.user || !signup.data.session) throw new Error(`Local signup unavailable: ${signup.error?.code ?? 'no session'}`)
  const organizerId = signup.data.user.id
  const profile = await client.from('organizers').insert({ id: organizerId, display_name: 'Oakland Community Host', organizer_type: 'Community group', base_city: 'Oakland', country_code: 'US', onboarding_completed_at: new Date().toISOString() })
  if (profile.error) throw new Error(`Local organizer fixture failed: ${profile.error.code}`)
  const starts = new Date(Date.now() + 86400000).toISOString(), ends = new Date(Date.now() + 93600000).toISOString()
  const coordinate: [number, number] = [-122.256 + Math.random() * 0.004, 37.808 + Math.random() * 0.004]
  const payload = (title: string, longitude = coordinate[0]): Json => ({ title, description: 'A friendly neighborhood gathering to meet local community members.', category: 'community', starts_at: starts, ends_at: ends, timezone: 'America/Los_Angeles', venue_name: 'Oakland Community Courtyard', address_line1: '150 Frank H Ogawa Plaza', address_line2: null, city: 'Oakland', region: 'CA', postal_code: '94612', country_code: 'US', mapbox_feature_id: 'phase4-local-oakland', latitude: coordinate[1], longitude, admission_type: 'free', capacity: 40 })
  async function draft(title: string, longitude = coordinate[0]) {
    const result = await client.rpc('save_owned_event_draft', { p_event_id: null!, p_expected_updated_at: null!, p_request_id: crypto.randomUUID(), p_event: payload(title, longitude) })
    if (result.error || !result.data) throw new Error(`Local draft failed: ${result.error?.message}`)
    return result.data
  }
  async function publishFixture(id: string) {
    const requirements = await client.rpc('save_owned_event_requirements', { p_event_id: id, p_requirements: { minimum_age: 'all_ages', alcohol_present: false, cannabis_present: false, explicit_adult_content: false, gambling_present: false, weapons_present: false, high_risk_activity: false } })
    if (requirements.error) throw new Error(requirements.error.message)
    const acceptance = await client.rpc('accept_current_event_policies', { p_event_id: id })
    if (acceptance.error) throw new Error(acceptance.error.message)
    const publication = await client.rpc('publish_event', { p_event_id: id })
    if (publication.error || publication.data.moderation_status !== 'clear') throw new Error('Normal local publication did not clear; no bypass permitted')
  }
  const proofLabel = crypto.randomUUID().slice(0, 6)
  const event = await draft(`Oakland Icon Gathering ${proofLabel}`)
  // Prior isolated proof events are intentionally preserved; identify this
  // generic event even when their nearby hit targets open the normal chooser.
  const generic = await draft(`Oakland Default Gathering ${crypto.randomUUID().slice(0, 6)}`, -122.270)
  await publishFixture(generic.id)
  async function signIn(target: Page) {
    await target.goto('/auth/sign-in')
    await target.getByLabel('Email').fill(email)
    await target.getByLabel('Password').fill(password)
    await target.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(target).toHaveURL(/\/organizer\/events$/)
  }
  await signIn(page)
  await page.goto(`/organizer/events/${event.id}/edit`)
  await expect(page.getByRole('radio', { name: 'Default', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Wheretoo Flag', exact: true })).toBeVisible()
  await page.locator('.map-icon-picker').scrollIntoViewIfNeeded()
  await shot(page, info, 'desktop-default-picker')
  await page.getByRole('radio', { name: 'Default', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Wheretoo Flag', exact: true })).toBeChecked()
  await shot(page, info, 'desktop-flag-picker')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Wheretoo Flag', exact: true })).toBeChecked()
  await page.locator('.map-icon-picker').scrollIntoViewIfNeeded()
  await shot(page, info, 'desktop-reloaded-picker')
  await publishFromEditor(page, event.id)
  const readPublic = () => {
    const now = Date.now()
    return client.rpc('get_public_map_events', { p_west: -122.4, p_east: -122.1, p_south: 37.7, p_north: 37.9, p_starts_at: new Date(now).toISOString(), p_ends_at: new Date(now + 7 * 86400000).toISOString() })
  }
  expect((await readPublic()).data?.find(row => row.event_id === event.id)?.map_icon_version_id).toBe(flag)
  // Exercise the actual published revision path in both directions.
  for (const choice of ['Default', 'Wheretoo Flag']) {
    await page.goto(`/organizer/events/${event.id}/edit`)
    await page.getByRole('radio', { name: choice, exact: true }).check()
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('radio', { name: choice, exact: true })).toBeChecked()
    await publishFromEditor(page, event.id)
    expect((await readPublic()).data?.find(row => row.event_id === event.id)?.map_icon_version_id).toBe(choice === 'Default' ? null : flag)
  }
  const network: string[] = []
  page.on('response', response => { const path = new URL(response.url()).pathname; if (path.includes('/rpc/get_public_map_') || path.includes('/map-icon-published/')) network.push(`${response.status()} ${path}`) })
  await page.goto('/map')
  await mapReference(page)
  await darkReady(page)
  await page.waitForFunction(() => Number(document.querySelector('.living-map__canvas')?.getAttribute('data-wheretoo-event-count')) > 0)
  await shot(page, info, 'desktop-normal-live-map')
  await page.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, coordinate)
  await iconReady(page)
  await expect(page.locator('.mapboxgl-canvas')).toHaveCount(1)
  await expect(page.locator('.mapboxgl-ctrl-logo')).toBeVisible()
  await expect(page.locator('.mapboxgl-ctrl-attrib')).toBeVisible()
  await shot(page, info, 'desktop-live-flag')
  await measureTip(page, info, 'desktop', coordinate)
  await verifyArtworkLighting(page, info, coordinate)
  const target = await page.evaluate(center => { const p = window.__phase4Map.project(center); return { x: p.x + 18, y: p.y - 29 } }, coordinate)
  await page.mouse.click(target.x, target.y)
  await openTappedPreview(page, event.title!)
  await expect(page.getByRole('link', { name: 'View event' })).toHaveAttribute('href', `/events/${event.id}`)
  await selectedIconReady(page, event.id)
  await shot(page, info, 'desktop-selected-preview')
  await reloadSelectedStyle(page, event.id)
  await shot(page, info, 'desktop-selected-after-style-reload')
  const selectedRepresentation = await page.evaluate(id => {
    const map = window.__phase4Map
    const canonical = map.getStyle().layers!.filter(layer => layer.id.startsWith('wheretoo-icon-') && layer.id.endsWith('-canonical')).flatMap(layer => map.queryRenderedFeatures({ layers: [layer.id] })).filter(feature => feature.properties?.eventId === id)
    const selected = map.getSource('wheretoo-selected-event') as unknown as { _data: { features: unknown[] } }
    return { canonical: canonical.length, selected: selected._data.features.length, sameCanvas: map.getCanvas() === document.querySelector('.mapboxgl-canvas') }
  }, event.id)
  expect(selectedRepresentation).toEqual({ canonical: 0, selected: 1, sameCanvas: true })
  expect(network.some(path => path.startsWith('200') && path.includes('/rpc/get_public_map_events'))).toBe(true)
  expect(network.some(path => path.startsWith('200') && path.includes('/rpc/get_public_map_icon_versions'))).toBe(true)
  expect(network.some(path => path.startsWith('200') && path.includes('/map-icon-published/'))).toBe(true)
  await page.close()

  const mobile = await browser.newContext({ baseURL: 'http://127.0.0.1:3014', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const phone = await mobile.newPage()
  await signIn(phone)
  await phone.goto(`/organizer/events/${event.id}/edit`)
  await expect(phone.getByRole('radio', { name: 'Wheretoo Flag', exact: true })).toBeChecked()
  await phone.locator('.map-icon-picker').scrollIntoViewIfNeeded()
  expect(await phone.locator('.map-icon-picker label').evaluateAll(labels => labels.every(label => label.getBoundingClientRect().height >= 44))).toBe(true)
  await shot(phone, info, 'mobile-persisted-picker')
  await phone.goto('/map'); await mapReference(phone)
  await darkReady(phone)
  await phone.waitForFunction(() => Number(document.querySelector('.living-map__canvas')?.getAttribute('data-wheretoo-event-count')) > 0)
  await shot(phone, info, 'mobile-normal-live-map')
  await phone.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, coordinate)
  await iconReady(phone)
  await shot(phone, info, 'mobile-live-flag')
  await measureTip(phone, info, 'mobile', coordinate)
  const touch = await phone.evaluate(center => { const p = window.__phase4Map.project(center); return { x: p.x + 18, y: p.y - 29 } }, coordinate)
  await phone.touchscreen.tap(touch.x, touch.y)
  await openTappedPreview(phone, event.title!)
  await selectedIconReady(phone, event.id)
  await shot(phone, info, 'mobile-selected-preview')
  await reloadSelectedStyle(phone, event.id)
  await expect(phone.locator('.mapboxgl-ctrl-attrib')).toBeVisible()
  await phone.getByRole('button', { name: 'Close event preview' }).click()
  await phone.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expect.poll(() => phone.evaluate(() => window.__phase4Map.getZoom())).toBeLessThan(16.25)
  await phone.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(() => phone.evaluate(() => window.__phase4Map.getZoom())).toBe(16.25)
  await phone.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, [-122.270, coordinate[1]] as [number, number])
  await phone.waitForFunction(id => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-event-circle'] }).some(f => f.properties?.eventId === id), generic.id)
  await shot(phone, info, 'mobile-generic-event')
  await phone.touchscreen.tap(195, 422)
  await openTappedPreview(phone, generic.title!)
  await shot(phone, info, 'mobile-generic-preview')
  await mobile.close()

  const failure = await browser.newContext({ baseURL: 'http://127.0.0.1:3014', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await failure.route('**/storage/v1/object/public/map-icon-published/**', route => route.abort('failed'))
  const fallback = await failure.newPage()
  await fallback.goto('/map'); await mapReference(fallback)
  await fallback.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, coordinate)
  await fallback.waitForFunction(id => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-event-circle'] }).some(feature => feature.properties?.eventId === id), event.id)
  await shot(fallback, info, 'desktop-png-failure-fallback')
  const fallbackPoint = await fallback.evaluate(center => { const p = window.__phase4Map.project(center); return { x: p.x, y: p.y } }, coordinate)
  await fallback.mouse.click(fallbackPoint.x, fallbackPoint.y)
  await openTappedPreview(fallback, event.title!)
  await failure.close()

  const group = await draft(`Oakland Courtyard Meetup ${proofLabel}`)
  await publishFixture(group.id)
  const grouped = await browser.newContext({ baseURL: 'http://127.0.0.1:3014', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const mapPage = await grouped.newPage()
  await mapPage.goto('/map'); await mapReference(mapPage)
  await mapPage.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 14 }) }, coordinate)
  await mapPage.waitForFunction(() => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] }).length > 0)
  await shot(mapPage, info, 'desktop-cluster')
  const clusterPoint = await mapPage.evaluate(() => {
    const map = window.__phase4Map
    const feature = map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] }).find(feature => feature.geometry.type === 'Point')!
    if (feature.geometry.type !== 'Point') throw new Error('Missing point cluster')
    const p = map.project(feature.geometry.coordinates as [number, number]); return { x: p.x, y: p.y }
  })
  await mapPage.mouse.click(clusterPoint.x, clusterPoint.y)
  await expect.poll(() => mapPage.evaluate(() => window.__phase4Map.getZoom())).toBeGreaterThan(14)
  await mapPage.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, coordinate)
  await iconReady(mapPage)
  const groupPoint = await mapPage.evaluate(center => { const p = window.__phase4Map.project(center); return { x: p.x, y: p.y } }, coordinate)
  await mapPage.mouse.click(groupPoint.x, groupPoint.y)
  await expect(mapPage.getByRole('button', { name: `Open ${group.title} event preview`, exact: true })).toBeVisible()
  await shot(mapPage, info, 'desktop-live-chooser')
  await mapPage.getByRole('button', { name: `Open ${group.title} event preview`, exact: true }).click()
  await expect(mapPage.getByRole('region', { name: group.title!, exact: true })).toBeVisible()
  await shot(mapPage, info, 'desktop-generic-preview')
  await mapPage.getByRole('button', { name: 'Back to events' }).click()
  await expect(mapPage.getByRole('button', { name: `Open ${event.title} event preview`, exact: true })).toBeVisible()
  expect(await mapPage.evaluate(() => window.__phase4Map.getCanvas() === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  await grouped.close()
  const small = await browser.newContext({ baseURL: 'http://127.0.0.1:3014', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const clusterPhone = await small.newPage()
  await clusterPhone.goto('/map'); await mapReference(clusterPhone)
  await clusterPhone.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 14 }) }, coordinate)
  await clusterPhone.waitForFunction(() => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] }).length > 0)
  await shot(clusterPhone, info, 'mobile-cluster')
  await small.close()
  await info.attach('local-proof-identities', { body: JSON.stringify({ eventId: event.id, genericEventId: generic.id, versionId: flag, network }, null, 2), contentType: 'application/json' })
  console.log(JSON.stringify({ eventId: event.id, genericEventId: generic.id, versionId: flag }))
})
