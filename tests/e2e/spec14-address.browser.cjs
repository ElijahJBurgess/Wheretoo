/** Local UI proof with NO Playwright provider simulation. The ordinary browser worker supplies addresses. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
require('tsx/cjs')
const { chromium, expect } = require('@playwright/test')
const { wallMinute, dbJson, quote } = require('./support/spec14Harness.ts')
const origin = 'http://127.0.0.1:3040'
const state = path.resolve('.superpowers/spec14')
const run = async () => {
  const scenario = JSON.parse(fs.readFileSync(path.join(state, 'scenario.json'), 'utf8'))
  const title = 'Spec14 local address transport check 2026-09-15'
  const prior = dbJson(`select coalesce(jsonb_agg(jsonb_build_object('id',id)), '[]'::jsonb) from public.events where organizer_id=${quote(scenario.organizerId)} and title=${quote(title)};`)
  assert.ok(prior.length <= 1, 'Retain and inspect duplicate test identities')
  let eventId = prior[0]?.id
  let creates = 0
  let revisions = 0
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
  const context = await browser.newContext()
  context.setDefaultTimeout(20000)
  const remote = []
  const businessWrites = []
  // Guard only: never fulfill a provider response from Playwright.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { remote.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method()) && !url.pathname.startsWith('/auth/v1/')) {
      const body = route.request().postDataJSON()
      if (route.request().method() === 'POST' && ['/rest/v1/rpc/get_my_staff_role', '/rest/v1/rpc/get_required_event_policies', '/rest/v1/rpc/get_owned_event_change_context'].includes(url.pathname)) return route.continue()
      if (route.request().method() === 'POST' && url.pathname === '/rest/v1/events' && !eventId && creates === 0 && body.organizer_id === scenario.organizerId && body.title === title) { creates++; return route.continue() }
      if (route.request().method() === 'POST' && url.pathname === '/rest/v1/rpc/save_owned_event_revision_if_current' && eventId && body.p_event_id === eventId && body.p_event.title === title && revisions < 2) { revisions++; return route.continue() }
      businessWrites.push(url.pathname); return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  const page = await context.newPage()
  const result = { startedAt: new Date().toISOString(), status: 'running', providerRouteFulfillments: 0 }
  try {
    result.stage = 'setup'
    await page.goto(origin + '/__spec14/address-testing')
    await page.getByRole('button', { name: 'Enable local address simulator', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Local address simulator ready')
    result.stage = 'sign-in'
    await page.goto(origin + '/auth/sign-in')
    await page.getByLabel('Email', { exact: true }).fill(scenario.organizerEmail)
    await page.getByLabel('Password', { exact: true }).fill(scenario.organizerPassword)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname.startsWith('/organizer/'))
    result.stage = 'basics'
    await page.goto(origin + (eventId ? `/organizer/events/${eventId}/edit?step=basics` : '/organizer/events/new'))
    await page.getByLabel('Event name', { exact: true }).fill(title)
    await page.getByLabel('Description', { exact: true }).fill('Local-only address transport verification. Retain this test draft; do not publish.')
    await page.getByLabel('Category', { exact: true }).selectOption('community')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForURL(url => /\/organizer\/events\/[0-9a-f-]{36}\/edit/.test(url.pathname))
    eventId = new URL(page.url()).pathname.split('/')[3]
    result.eventId = eventId
    result.stage = 'location'
    const start = new Date(Date.now() + 2 * 86400000)
    await page.getByLabel('Starts', { exact: true }).fill(wallMinute(start))
    await page.getByLabel('Ends', { exact: true }).fill(wallMinute(new Date(start.getTime() + 3600000)))
    await page.getByLabel('Venue name', { exact: true }).fill('Local test venue')
    if (await page.getByText('Verified address', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Clear address', exact: true }).click()
    const address = page.getByRole('combobox', { name: 'Search for a California address' })
    await address.fill('123 Main Street')
    const suggestion = page.getByRole('option').filter({ hasText: '1 Market Street' })
    await expect(suggestion).toBeVisible()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.locator('#event-location-error')).toHaveText('Choose a verified California address.')
    result.typedOnlyRemainsUnverified = true
    // A second keystroke models the user correcting an already failed location field.
    await address.fill('123 Main Street California')
    await expect(suggestion).toBeVisible()
    result.stage = 'select'
    await suggestion.click()
    await expect(page.getByText('Verified address', { exact: true })).toBeVisible()
    await expect(page.locator('#event-location-error')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Search for a California address' })).toHaveValue('1 Market Street, San Francisco, CA 94105')
    const retrieved = await page.evaluate(async () => (await fetch('https://api.mapbox.com/search/searchbox/v1/retrieve/spec14.address.1?session_token=verification')).json())
    const properties = retrieved.features[0].properties
    assert.deepEqual(retrieved.features[0].geometry.coordinates, [-122.3958, 37.7936])
    assert.equal(properties.context.region.region_code, 'CA')
    assert.equal(properties.context.country.country_code, 'US')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('radio', { name: /Free RSVP/ })).toBeVisible()
    const saved = dbJson(`select jsonb_build_object('id',id,'status',status,'address',address_line1,'region',region,'city',city,'postalCode',postal_code,'country',country_code,'latitude',latitude,'longitude',longitude,'featureId',mapbox_feature_id,'publishedAt',published_at) from public.events where id=${quote(eventId)} and organizer_id=${quote(scenario.organizerId)};`)
    assert.equal(saved.status, 'draft')
    assert.equal(saved.publishedAt, null)
    assert.equal(saved.address, '1 Market Street')
    assert.equal(saved.region, 'CA')
    assert.equal(saved.country, 'US')
    assert.equal(saved.latitude, 37.7936)
    assert.equal(saved.longitude, -122.3958)
    assert.equal(saved.featureId, 'spec14.address.1')
    result.savedLocation = saved
    result.draftCreates = creates
    result.draftRevisions = revisions
    assert.deepEqual(remote, [])
    assert.deepEqual(businessWrites, [])
    result.status = 'passed'
    result.suggestionSelected = true
    result.normalizedAddress = '1 Market Street, San Francisco, CA 94105'
    result.latitude = properties.coordinates.latitude
    result.longitude = properties.coordinates.longitude
    result.continueReachedAdmission = true
    result.remoteRequests = remote.length
    result.businessWrites = businessWrites.length
    await page.screenshot({ path: path.join(state, 'address-testing-fix/admission.png') })
  } catch (error) { result.status = 'failed'; result.error = error.name; result.detail = error.message.slice(0, 1500); result.blockedRemote = remote; result.blockedBusinessWrites = businessWrites; throw error }
  finally {
    result.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(state, 'address-testing-fix/browser-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
    await context.close(); await browser.close()
  }
}
run().catch(error => { console.error('Address flow verification failed: ' + error.name); process.exitCode = 1 })
