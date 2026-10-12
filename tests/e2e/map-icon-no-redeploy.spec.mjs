import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { iconLibraryEnvironment } from './support/iconLibraryEnvironment.mjs'
import { publishGrandOpening, secondIconName } from './support/publishGrandOpeningProof.mjs'
import { buildDirectory, buildIdentity, evidenceRoot, sha256, sourceIdentity } from './support/phase5bIdentity.mjs'

const flag = '8d94a4cf-e61b-480a-9f1f-8b5497620dfa'
const center = [-122.2675, 37.8005], flagCenter = [-122.2667, 37.8005]
async function shot(page, info, name) {
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => page.locator('img').evaluateAll(images => images.filter(image => {
    const r = image.getBoundingClientRect()
    return image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.width && r.height && r.bottom > 0 && r.top < innerHeight
  }).every(image => image.complete && image.naturalWidth > 0)), { timeout: 15000 }).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path }); await info.attach(name, { path, contentType: 'image/png' })
}
async function mapReference(page) {
  await expect(page.locator('main')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60000 })
  await page.evaluate(() => {
    const node = document.querySelector('.living-map__canvas')
    let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber'))]
    while (fiber) {
      let hook = fiber.memoizedState
      while (hook) {
        const value = hook.memoizedState?.current
        if (value && typeof value.getSource === 'function' && typeof value.project === 'function') { window.__phase5bMap = value; return }
        hook = hook.next
      }
      fiber = fiber.return
    }
    throw new Error('Existing map unavailable')
  })
}
async function rendered(page, id, selected = false) {
  await page.waitForFunction(({ id, selected }) => {
    const m = window.__phase5bMap, layers = m.getStyle().layers?.filter(l => l.id.startsWith('wheretoo-icon-') && l.id.endsWith(selected ? '-selected' : '-canonical')).map(l => l.id) ?? []
    return m.loaded() && !m.isMoving() && layers.length && m.queryRenderedFeatures({ layers }).some(f => f.properties?.eventId === id)
  }, { id, selected }, { timeout: 75000 })
}
async function openPreview(page, title) {
  const region = page.getByRole('region', { name: title, exact: true }), choice = page.getByRole('button', { name: `Open ${title} event preview`, exact: true })
  await expect(region.or(choice)).toBeVisible()
  if (await choice.isVisible()) await choice.click()
  await expect(region).toBeVisible()
}
async function bodyPoint(page) {
  return page.evaluate(c => { const p = window.__phase5bMap.project(c); return { x: p.x, y: p.y - 38 } }, center)
}
async function publishEditor(page, id) {
  await page.goto(`/organizer/events/${id}/edit?step=requirements`)
  await page.getByLabel('Minimum age').selectOption('all_ages')
  await page.getByRole('button', { name: 'Continue to organizer agreement' }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save agreement and preview' }).click()
  await expect(page).toHaveURL(new RegExp(`/events/${id}/preview$`))
  await page.getByRole('button', { name: /^(Publish event|Publish changes)$/ }).click()
  await expect(page).toHaveURL(new RegExp(`/events/${id}$`))
  await expect(page.getByText('This event is publicly available.', { exact: true })).toBeVisible()
}

test('second curated PNG crosses the entire product flow without rebuilding or recreating the mounted map', async ({ page, browser }, info) => {
  const baseline = JSON.parse(readFileSync(`${evidenceRoot}/baseline.json`, 'utf8'))
  assert.deepEqual(buildIdentity(), baseline.build); assert.deepEqual(sourceIdentity(), baseline.source)
  const local = await iconLibraryEnvironment()
  const api = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const flagBefore = (await api.rpc('get_public_map_icon_versions', { p_ids: [flag] })).data.versions[0]
  const email = `phase5b-organizer-${randomUUID()}@example.test`, password = `Proof-${randomUUID()}!`
  const signup = await api.auth.signUp({ email, password }); assert.ifError(signup.error); assert(signup.data.session)
  assert.ifError((await api.from('organizers').insert({ id: signup.data.user.id, display_name: 'Oakland Community Host', organizer_type: 'Community group', base_city: 'Oakland', country_code: 'US', onboarding_completed_at: new Date().toISOString() })).error)
  const label = randomUUID().slice(0, 6)
  async function draft(title, coordinate) {
    const r = await api.rpc('save_owned_event_draft', { p_event_id: null, p_expected_updated_at: null, p_request_id: randomUUID(), p_event: {
      title, description: 'A friendly neighborhood gathering to celebrate local community.', category: 'community',
      starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 93600000).toISOString(), timezone: 'America/Los_Angeles',
      venue_name: 'Oakland Community Courtyard', address_line1: '150 Frank H Ogawa Plaza', address_line2: null, city: 'Oakland', region: 'CA', postal_code: '94612', country_code: 'US',
      mapbox_feature_id: 'phase5b-local-oakland', longitude: coordinate[0], latitude: coordinate[1], admission_type: 'free', capacity: 40,
    } }); assert.ifError(r.error); return r.data
  }
  const flagEvent = await draft(`Flag Gathering ${label}`, flagCenter), event = await draft(`Grand Opening ${label}`, center)
  async function signIn(target) {
    await target.goto('/auth/sign-in'); await target.getByLabel('Email').fill(email); await target.getByLabel('Password').fill(password)
    await target.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(target).toHaveURL(/\/organizer\/events$/)
  }
  async function saveChoice(target, id, name) {
    await target.goto(`/organizer/events/${id}/edit`)
    await target.getByRole('radio', { name, exact: true }).check()
    await target.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(target.getByText('Saved', { exact: true })).toBeVisible()
    await target.reload(); await expect(target.getByRole('radio', { name, exact: true })).toBeChecked()
  }
  await signIn(page); await saveChoice(page, flagEvent.id, 'Wheretoo Flag'); await publishEditor(page, flagEvent.id)
  await page.goto(`/organizer/events/${event.id}/edit`)
  await expect(page.getByRole('radio', { name: 'Wheretoo Flag', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: secondIconName, exact: true })).toHaveCount(0)
  await page.locator('.map-icon-picker').scrollIntoViewIfNeeded(); await shot(page, info, 'desktop-picker-before-publication')

  const mapContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3015', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const mapPage = await mapContext.newPage(), servedAssets = [], network = []
  mapPage.on('response', async response => {
    const u = new URL(response.url())
    if (u.origin === 'http://127.0.0.1:3015' && u.pathname.startsWith('/assets/') && response.ok()) {
      const expected = baseline.build.entries.find(([path]) => path === `${buildDirectory}${u.pathname}`)
      if (expected) { const observed = sha256(await response.body()); servedAssets.push({ path: u.pathname, hash: observed, matched: expected[1] === observed }) }
    }
    if (u.pathname.includes('/rpc/get_public_map_') || u.pathname.includes('/map-icon-published/')) network.push({ status: response.status(), path: u.pathname })
  })
  await mapPage.goto('/map'); await mapReference(mapPage)
  await mapPage.evaluate(c => { window.__phase5bMap.jumpTo({ center: c, zoom: 16.25 }); window.__phase5bOriginalMap = window.__phase5bMap }, center)
  await rendered(mapPage, flagEvent.id)
  const canvas = await mapPage.locator('.mapboxgl-canvas').elementHandle()
  await shot(mapPage, info, 'desktop-map-before-publication')
  const newIcon = await publishGrandOpening()
  writeFileSync(`${evidenceRoot}/published-package.json`, JSON.stringify(newIcon, null, 2))
  assert.deepEqual(buildIdentity(), baseline.build); assert.deepEqual(sourceIdentity(), baseline.source)
  // Both consumers were already mounted. Use ordinary visibility/focus/catalog
  // refresh, never inject descriptors, source data, images, layers or selection.
  await page.bringToFront()
  await expect(page.getByRole('radio', { name: secondIconName, exact: true })).toBeVisible({ timeout: 75000 })
  await expect(page.getByRole('radio', { name: 'Default', exact: true })).toBeChecked()
  await page.locator('.map-icon-picker').scrollIntoViewIfNeeded(); await shot(page, info, 'desktop-picker-two-icons')
  await page.getByRole('radio', { name: secondIconName, exact: true }).check()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload(); await expect(page.getByRole('radio', { name: secondIconName, exact: true })).toBeChecked()
  await publishEditor(page, event.id)
  const publicEvents = await api.rpc('get_public_map_events', { p_west: -122.4, p_east: -122.1, p_south: 37.7, p_north: 37.9,
    p_starts_at: new Date().toISOString(), p_ends_at: new Date(Date.now() + 7 * 86400000).toISOString() })
  assert.ifError(publicEvents.error); assert.equal(publicEvents.data.find(e => e.event_id === event.id).map_icon_version_id, newIcon.versionId)
  await mapPage.bringToFront(); await rendered(mapPage, event.id); await rendered(mapPage, flagEvent.id)
  expect(await canvas.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  expect(await mapPage.evaluate(() => window.__phase5bMap === window.__phase5bOriginalMap)).toBe(true)
  await expect(mapPage.locator('.mapboxgl-canvas')).toHaveCount(1)
  await expect(mapPage.locator('.mapboxgl-ctrl-logo')).toBeVisible(); await expect(mapPage.locator('.mapboxgl-ctrl-attrib')).toBeVisible()
  await shot(mapPage, info, 'desktop-two-icons')
  const point = await bodyPoint(mapPage); await mapPage.mouse.click(point.x, point.y); await openPreview(mapPage, event.title)
  await rendered(mapPage, event.id, true); await shot(mapPage, info, 'desktop-selected-preview')
  const representation = await mapPage.evaluate(id => {
    const m = window.__phase5bMap, layers = m.getStyle().layers.filter(l => l.id.startsWith('wheretoo-icon-') && l.id.endsWith('-canonical')).map(l => l.id)
    return { canonical: m.queryRenderedFeatures({ layers }).filter(f => f.properties.eventId === id).length, selected: m.getSource('wheretoo-selected-event')._data.features.length }
  }, event.id)
  expect(representation).toEqual({ canonical: 0, selected: 1 })
  await mapPage.getByRole('button', { name: 'Close event preview' }).click()
  await mapPage.evaluate(c => { window.__phase5bMap.jumpTo({ center: c, zoom: 14.8 }) }, center)
  await rendered(mapPage, event.id); await shot(mapPage, info, 'desktop-neighborhood-scale')
  await mapContext.close()

  const mobile = await browser.newContext({ baseURL: 'http://127.0.0.1:3015', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const phone = await mobile.newPage(); await signIn(phone)
  await phone.goto(`/organizer/events/${event.id}/edit`); await expect(phone.getByRole('radio', { name: secondIconName, exact: true })).toBeChecked()
  await phone.locator('.map-icon-picker').scrollIntoViewIfNeeded(); await shot(phone, info, 'mobile-picker-two-icons')
  await phone.goto('/map'); await mapReference(phone)
  await phone.evaluate(c => { window.__phase5bMap.jumpTo({ center: c, zoom: 16.25 }) }, center)
  await rendered(phone, event.id); await rendered(phone, flagEvent.id); await shot(phone, info, 'mobile-two-icons')
  const tap = await bodyPoint(phone); await phone.touchscreen.tap(tap.x, tap.y); await openPreview(phone, event.title)
  await rendered(phone, event.id, true); await shot(phone, info, 'mobile-selected-preview')
  await expect(phone.getByRole('link', { name: 'View event' })).toHaveAttribute('href', `/events/${event.id}`)
  await expect(phone.locator('.mapboxgl-ctrl-attrib')).toBeVisible(); await mobile.close()

  const failure = await browser.newContext({ baseURL: 'http://127.0.0.1:3015', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await failure.route(`**/map-icon-published/**/${newIcon.pngSha256}.png`, route => route.abort('failed'))
  const fallback = await failure.newPage(); await fallback.goto('/map'); await mapReference(fallback)
  await fallback.evaluate(c => { window.__phase5bMap.jumpTo({ center: c, zoom: 16.25 }) }, center)
  await rendered(fallback, flagEvent.id)
  await fallback.waitForFunction(id => window.__phase5bMap.queryRenderedFeatures({ layers: ['wheretoo-event-circle'] }).some(f => f.properties.eventId === id), event.id)
  await shot(fallback, info, 'desktop-new-icon-failure-old-flag-intact')
  await fallback.mouse.click(720, 450); await openPreview(fallback, event.title); await failure.close()
  const flagAfter = (await api.rpc('get_public_map_icon_versions', { p_ids: [flag] })).data.versions[0]
  assert.deepEqual(flagAfter, flagBefore); assert.deepEqual(buildIdentity(), baseline.build); assert.deepEqual(sourceIdentity(), baseline.source)
  expect(servedAssets.length).toBeGreaterThan(0); expect(servedAssets.every(a => a.matched)).toBe(true)
  expect(network.some(r => r.status === 200 && r.path.endsWith(`/${newIcon.pngSha256}.png`))).toBe(true)
  const result = { newIcon, eventId: event.id, flagEventId: flagEvent.id, baselineBuildHash: baseline.build.hash, finalBuildHash: buildIdentity().hash,
    sourceHash: baseline.source.hash, sourceUnchanged: true, rebuildAfterPublication: false, redeploy: false, mountedPickerDiscovered: true,
    persistence: true, liveMapRendered: true, originalMapIdentityPreserved: true, representation, desktopClick: true, mobileTap: true,
    fallback: true, originalFlagDescriptorUnchanged: true, servedAssets, network, screenshots: info.outputDir, completedAt: new Date().toISOString() }
  writeFileSync(`${evidenceRoot}/proof-result.json`, JSON.stringify(result, null, 2))
  await info.attach('no-redeploy-proof', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})
