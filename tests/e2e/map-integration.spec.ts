import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import type { Database, Json } from '../../src/lib/supabase/database.types'
import { combinedMapEnvironment, APP_URL } from './support/combinedMapEnvironment.mjs'
import { mapReference, iconReady, darkReady, shot, measureTip, selectedIconReady, reloadSelectedStyle, openTappedPreview } from './support/combinedMapObservations'

test('combined main lifecycle, both curated icons, public cover, and desktop/mobile map', async ({ page, browser }, info) => {
  const local = await combinedMapEnvironment()
  const client = createClient<Database>(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `combined-map-${crypto.randomUUID()}@example.test`, password = `Proof-${crypto.randomUUID()}!`
  const signup = await client.auth.signUp({ email, password })
  expect(signup.error).toBeNull(); const owner = signup.data.user!.id
  expect((await client.from('organizers').insert({ id: owner, display_name: 'Oakland Community Host', organizer_type: 'Community group', base_city: 'Oakland', country_code: 'US', onboarding_completed_at: new Date().toISOString() })).error).toBeNull()
  const catalog = await client.rpc('list_selectable_map_icons', {})
  expect(catalog.error).toBeNull()
  const icons = (catalog.data as { icons: { name: string; versionId: string }[] }).icons
  const flag = icons.find(icon => icon.name === 'Wheretoo Flag')!.versionId
  const grand = icons.find(icon => icon.name === 'Grand Opening')!.versionId
  const coordinate: [number, number] = [-122.263, 37.804]
  const starts = new Date(Date.now() + 86400000).toISOString(), ends = new Date(Date.now() + 93600000).toISOString()
  const label = crypto.randomUUID().slice(0, 6)
  async function draft(title: string, longitude: number, version: string | null) {
    const payload: Json = { title, description: 'A friendly neighborhood gathering to meet local community members.', category: 'community', starts_at: starts, ends_at: ends, timezone: 'America/Los_Angeles', venue_name: 'Oakland Community Courtyard', address_line1: '150 Frank H Ogawa Plaza', address_line2: null, city: 'Oakland', region: 'CA', postal_code: '94612', country_code: 'US', mapbox_feature_id: 'combined-local-oakland', latitude: coordinate[1], longitude, admission_type: 'free', capacity: 40, map_icon_version_id: version }
    const result = await client.rpc('save_owned_event_draft', { p_event_id: null, p_expected_updated_at: null, p_request_id: crypto.randomUUID(), p_event: payload })
    expect(result.error).toBeNull(); return result.data!
  }
  async function publish(id: string) {
    expect((await client.rpc('save_owned_event_requirements', { p_event_id: id, p_requirements: { minimum_age: 'all_ages', alcohol_present: false, cannabis_present: false, explicit_adult_content: false, gambling_present: false, weapons_present: false, high_risk_activity: false } })).error).toBeNull()
    expect((await client.rpc('accept_current_event_policies', { p_event_id: id })).error).toBeNull()
    const result = await client.rpc('publish_event', { p_event_id: id })
    expect(result.error).toBeNull(); expect(result.data?.moderation_status).toBe('clear')
  }
  const event = await draft(`Oakland Flag Gathering ${label}`, coordinate[0], null)
  const second = await draft(`Oakland Grand Opening ${label}`, -122.267, grand); await publish(second.id)
  const generic = await draft(`Oakland Default Gathering ${label}`, -122.270, null); await publish(generic.id)
  async function signIn(target: Page) {
    await target.goto('/auth/sign-in')
    await target.getByLabel('Email').fill(email); await target.getByLabel('Password').fill(password)
    await target.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(target).toHaveURL(/\/organizer\/events$/)
  }
  await signIn(page)
  await page.goto(`/organizer/events/${event.id}/edit?step=basics`)
  await page.getByRole('radio', { name: 'Wheretoo Flag', exact: true }).check()
  await page.locator('.map-icon-picker').scrollIntoViewIfNeeded()
  await shot(page, info, 'desktop-picker')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Draft saved' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue Editing' }).click()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Wheretoo Flag', exact: true })).toBeChecked()
  expect(process.env.APPROVED_GRAND_OPENING_PNG).toBeTruthy()
  await page.getByLabel('Upload image').setInputFiles(process.env.APPROVED_GRAND_OPENING_PNG!)
  await expect.poll(async () => (await client.rpc('get_event_cover_state', { p_event_id: event.id })).data as { revision: number }).toMatchObject({ revision: 1 })
  await page.goto(`/organizer/events/${event.id}/edit?step=requirements`)
  await page.getByLabel('Minimum age').selectOption('all_ages')
  for (const input of await page.getByRole('radio', { name: 'No', exact: true }).all()) await input.check()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/events/${event.id}/preview$`))
  await page.getByRole('button', { name: 'Publish event', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm and publish', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/organizer/events/${event.id}(\\?created=1)?$`))
  const now = Date.now()
  const publicEvents = await client.rpc('get_public_map_events', { p_west: -122.4, p_east: -122.1, p_south: 37.7, p_north: 37.9, p_starts_at: new Date(now).toISOString(), p_ends_at: new Date(now + 7 * 86400000).toISOString() })
  expect(publicEvents.data?.find(row => row.event_id === event.id)?.map_icon_version_id).toBe(flag)
  const group = await draft(`Courtyard Meetup ${label}`, coordinate[0], null)
  // Keep the first direct flag tap unambiguous; add the colocated event later.
  const publicImages: string[] = []
  page.on('response', response => { if (new URL(response.url()).pathname === '/rest/v1/rpc/list_event_images') publicImages.push(String(response.status())) })
  await page.goto('/map'); await mapReference(page); await darkReady(page)
  await iconReady(page); await shot(page, info, 'desktop-live-map')
  await page.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, coordinate)
  await iconReady(page); await shot(page, info, 'desktop-flag')
  await measureTip(page, info, 'desktop', coordinate)
  const target = await page.evaluate(center => { const p = window.__phase4Map.project(center); return { x: p.x + 18, y: p.y - 29 } }, coordinate)
  await page.mouse.click(target.x, target.y); await openTappedPreview(page, event.title!)
  await selectedIconReady(page, event.id)
  await expect(page.getByAltText(`${event.title} artwork`)).toHaveAttribute('src', /\/functions\/v1\/event-images\?id=/)
  await shot(page, info, 'desktop-selected-cover')
  expect(publicImages).toContain('200')
  await reloadSelectedStyle(page, event.id); await shot(page, info, 'desktop-reloaded-style')
  await page.getByRole('button', { name: 'Close event preview' }).click()
  await page.evaluate(() => { window.__phase4Map.jumpTo({ center: [-122.267, 37.804], zoom: 16.25 }) })
  await iconReady(page); await shot(page, info, 'desktop-grand-opening')
  await page.mouse.click(720, 415); await openTappedPreview(page, second.title!)
  await page.getByRole('button', { name: 'Close event preview' }).click()
  await publish(group.id)
  await page.reload(); await mapReference(page)
  await page.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 14 }) }, coordinate)
  await page.waitForFunction(() => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] }).length > 0)
  await shot(page, info, 'desktop-cluster')
  await page.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, coordinate)
  await iconReady(page); await page.mouse.click(720, 450)
  await expect(page.getByRole('button', { name: `Open ${group.title} event preview`, exact: true })).toBeVisible()
  await shot(page, info, 'desktop-chooser')
  await page.getByRole('button', { name: `Open ${group.title} event preview`, exact: true }).click()
  await expect(page.getByRole('region', { name: group.title!, exact: true })).toBeVisible()
  await shot(page, info, 'desktop-generic-preview')
  const mobile = await browser.newContext({ baseURL: APP_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const phone = await mobile.newPage(); await signIn(phone)
  await phone.goto(`/organizer/events/${event.id}/edit?step=basics`)
  await expect(phone.getByRole('radio', { name: 'Wheretoo Flag', exact: true })).toBeChecked()
  await phone.locator('.map-icon-picker').scrollIntoViewIfNeeded(); await shot(phone, info, 'mobile-persisted-picker')
  await phone.goto('/map'); await mapReference(phone); await darkReady(phone); await iconReady(phone)
  await shot(phone, info, 'mobile-live-map')
  await phone.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, coordinate)
  await iconReady(phone); await shot(phone, info, 'mobile-flag'); await measureTip(phone, info, 'mobile', coordinate)
  await phone.touchscreen.tap(213, 393); await openTappedPreview(phone, event.title!)
  await selectedIconReady(phone, event.id); await shot(phone, info, 'mobile-selected-cover'); await reloadSelectedStyle(phone, event.id)
  await phone.getByRole('button', { name: 'Close event preview' }).click()
  await phone.evaluate(() => { window.__phase4Map.jumpTo({ center: [-122.270, 37.804], zoom: 16.25 }) })
  await phone.waitForFunction(id => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-event-circle'] }).some(f => f.properties?.eventId === id), generic.id)
  await phone.touchscreen.tap(195, 422); await openTappedPreview(phone, generic.title!); await shot(phone, info, 'mobile-generic-preview')
  await expect(phone.locator('.mapboxgl-ctrl-attrib')).toBeVisible(); await mobile.close()
  const fail = await browser.newContext({ baseURL: APP_URL, viewport: { width: 1440, height: 900 } })
  await fail.route('**/storage/v1/object/public/map-icon-published/**', route => route.abort())
  const fallback = await fail.newPage(); await fallback.goto('/map'); await mapReference(fallback)
  await fallback.evaluate(center => { window.__phase4Map.jumpTo({ center, zoom: 16.25 }) }, coordinate)
  await fallback.waitForFunction(id => window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-event-circle'] }).some(f => f.properties?.eventId === id), event.id)
  await shot(fallback, info, 'desktop-image-failure-fallback'); await fail.close()
  await info.attach('combined-proof-identities', { body: JSON.stringify({ event: event.id, generic: generic.id, grandEvent: second.id, flag, grand }), contentType: 'application/json' })
})

test('anonymous cluster expansion preserves the mounted map', async ({ page }, info) => {
  await combinedMapEnvironment()
  await page.goto('/map')
  await mapReference(page)
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
  const viewportResponse = page.waitForResponse(response => {
    if (!response.url().endsWith('/rest/v1/rpc/get_public_map_events') || response.status() !== 200) return false
    const bounds = response.request().postDataJSON() as { p_east: number; p_west: number }
    return bounds.p_east - bounds.p_west > 0.2
  })
  await page.evaluate(() => { window.__phase4Map.jumpTo({ center: [-122.266, 37.804], zoom: 11 }) })
  const rows = await (await viewportResponse).json() as { event_id: string }[]
  expect(rows.length).toBeGreaterThan(0)
  // loaded() alone can describe the previous viewport while its RPC is in flight.
  await page.waitForFunction(ids => {
    const source = window.__phase4Map.getSource('wheretoo-events') as unknown as { _data: { features: { properties: { eventId: string } }[] } }
    const available = source._data.features.map(feature => feature.properties.eventId)
    return available.length === ids.length && ids.every(id => available.includes(id)) && window.__phase4Map.loaded()
  }, rows.map(row => row.event_id))
  await page.waitForFunction(() => window.__phase4Map.loaded()
    && window.__phase4Map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] }).length > 0)
  const point = await page.evaluate(() => {
    const map = window.__phase4Map
    const cluster = map.queryRenderedFeatures({ layers: ['wheretoo-cluster-circle'] })[0]
    const projected = map.project(cluster.geometry.coordinates as [number, number])
    return { x: projected.x, y: projected.y }
  })
  await page.mouse.click(point.x, point.y)
  await expect.poll(() => page.evaluate(() => window.__phase4Map.getZoom())).toBeGreaterThan(11)
  expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  await page.evaluate(() => { window.__phase4Map.jumpTo({ center: [-122.266, 37.804], zoom: 14 }) })
  await page.waitForFunction(() => window.__phase4Map.loaded() && !window.__phase4Map.isMoving())
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Map did not reach a settled frame')), 15000)
    window.__phase4Map.once('idle', () => { clearTimeout(timer); resolve() })
    window.__phase4Map.triggerRepaint()
  }))
  await shot(page, info, 'desktop-cluster-settled')
})
