import { expect, test, type Page } from '@playwright/test'

const owner = '12000000-0000-4000-8000-000000000091'
const logo = '24000000-0000-4000-8000-000000000011'
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'storefront@example.invalid', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-09-10T00:00:00Z' }
const profile = { id: owner, display_name: 'Night Sessions', organizer_type: 'Community group', bio: 'Live music in Oakland.', website_url: null, base_city: 'Oakland', country_code: 'US', onboarding_completed_at: '2026-09-10T00:00:00Z', created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z' }
const editor = { name: profile.display_name, bio: profile.bio, city: 'Oakland', websiteUrl: null, logoId: logo, coverId: null, accent: null, links: {}, featuredEventId: null, handle: 'night-sessions', status: 'published', updatedAt: profile.updated_at, merch: [], storeUrl: null }
const event = { id: '24000000-0000-4000-8000-000000000001', title: 'A night of live music', startsAt: '2026-10-01T19:00:00-07:00', endsAt: '2026-10-01T23:00:00-07:00', timezone: 'America/Los_Angeles', venue: 'The Music Hall', city: 'Oakland', flyerId: logo, admissionType: 'free', admission: { state: 'available', minimumAmountMinor: null, currency: null } }
const storefrontDocument = { identity: { handle: editor.handle, name: editor.name, bio: editor.bio, city: editor.city, logoId: logo, coverId: null, accent: null, links: {}, websiteUrl: null }, featured: event, events: [], nextCursor: null, serverNow: '2026-09-25T12:00:00Z', merch: [], storeUrl: null }
async function fixture(page: Page) {
  const state = { empty: false, failure: false, missingHandle: false, incomplete: false, gate: null as Promise<void> | null }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const session = { access_token: `${btoa('{}')}.${btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 }))}.fixture`, refresh_token: 'fixture-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
  await page.addInitScript(value => { if (!sessionStorage.getItem('fixture-initialized')) { localStorage.setItem('sb-127-auth-token', JSON.stringify(value)); sessionStorage.setItem('fixture-initialized', 'yes') } }, session)
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:3091') return route.continue()
    const respond = (json: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) })
    if (url.origin !== 'http://127.0.0.1:57321') { errors.push(`Unexpected origin ${url.origin}`); return route.abort() }
    if (url.pathname.endsWith('/auth/v1/user')) return respond(user)
    if (url.pathname.endsWith('/auth/v1/logout')) return respond({})
    if (url.pathname.endsWith('/organizers')) return respond([{ ...profile, onboarding_completed_at: state.incomplete ? null : profile.onboarding_completed_at }])
    if (url.pathname.endsWith('/rpc/get_my_staff_role')) return respond(null)
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/rpc/list_owned_events')) return respond([])
    if (url.pathname.endsWith('/rpc/get_owned_storefront_editor')) { if (state.gate) await state.gate; return state.failure ? respond({ code: 'PGRST202', message: 'private diagnostic' }, 404) : respond({ ...editor, handle: state.missingHandle ? null : editor.handle }) }
    if (url.pathname.endsWith('/rpc/get_owned_storefront_identity')) return respond({ handle: state.missingHandle ? null : editor.handle, logoId: logo, name: editor.name })
    if (url.pathname.endsWith('/rpc/get_owned_storefront_preview')) return respond({ ...storefrontDocument, featured: state.empty ? null : event })
    if (url.pathname.endsWith('/rpc/get_public_organizer_storefront')) {
      if (state.failure) return respond({ code: 'PGRST202' }, 404)
      return respond(request.postDataJSON().p_handle === editor.handle ? { ...storefrontDocument, featured: state.empty ? null : event } : null)
    }
    if (url.pathname.endsWith('/rpc/get_owned_storefront_insights')) return respond({ visits: 0, ticketStarts: 0, rsvpStarts: 0, paidOrders: 0, confirmedRsvps: 0, grossByCurrency: [], refLabels: [] })
    if (url.pathname.includes('/functions/v1/organizer-media') || url.pathname.includes('/functions/v1/event-images')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#6551c9"/><circle cx="200" cy="220" r="110" fill="#f2bd73"/></svg>' })
    if (url.pathname.endsWith('/functions/v1/storefront-telemetry')) return respond({})
    errors.push(`Unexpected request ${url.pathname}`); return respond({}, 500)
  })
  return { state, errors }
}
for (const width of [390, 1440]) {
  test(`organizer navigation and public storefront at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const { state, errors } = await fixture(page)
    await page.goto('/organizer/events')
    const nav = page.getByRole('navigation', { name: 'Organizer operations' })
    await nav.getByRole('link', { name: 'Storefront', exact: true }).click()
    await expect(page.getByLabel('Display name')).toHaveValue(editor.name)
    await expect(nav.getByRole('link', { name: 'Storefront', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: /Settings/ })).not.toHaveAttribute('aria-current')
    await expect(page.getByAltText('Saved logo')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`organizer-${width}.png`), fullPage: true })
    await page.reload(); await expect(page.getByLabel('Display name')).toHaveValue(editor.name)
    await page.getByRole('link', { name: 'View public storefront' }).click()
    await expect(page).toHaveURL(/\/night-sessions$/)
    await expect(page.getByRole('heading', { name: editor.name, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: event.title })).toBeVisible()
    const eventLink = page.locator(`a[href*="/events/${event.id}"]`).first()
    await expect(eventLink).toBeVisible()
    expect(await page.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`public-${width}.png`), fullPage: true })
    state.empty = true; await page.reload()
    await expect(page.getByText('No upcoming events right now.')).toBeVisible()
    await page.goto('/unknown-storefront')
    await expect(page.getByRole('heading', { name: 'Storefront not found' })).toBeVisible()
    await page.goto('/organizer/settings/storefront')
    await expect(page.getByText('No eligible public events yet.')).toBeVisible()
    expect(errors).toEqual([])
  })
}
test('retry, missing identity, and delayed sign-out preserve private boundaries', async ({ page }) => {
  const { state, errors } = await fixture(page)
  state.failure = true
  await page.goto('/organizer/settings/storefront')
  await expect(page.getByRole('alert')).toContainText('Storefront settings could not load.')
  state.failure = false; state.missingHandle = true
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Complete your organizer profile' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View public storefront' })).toHaveCount(0)
  let release!: () => void
  state.gate = new Promise<void>(resolve => { release = resolve })
  await page.reload()
  await expect(page.getByText('Loading settings…')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/auth\/sign-in$/)
  release()
  await expect(page.getByLabel('Display name')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('sb-127-auth-token'))).toBeNull()
  expect(errors).toEqual([])
})
test('public infrastructure errors retry and incomplete organizer returns to Profile', async ({ page }) => {
  const { state, errors } = await fixture(page)
  state.failure = true
  await page.goto('/night-sessions')
  await expect(page.getByRole('alert')).toHaveText('Storefront could not load.')
  await expect(page.getByText('Storefront not found')).toHaveCount(0)
  state.failure = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: editor.name, exact: true })).toBeVisible()
  state.incomplete = true
  await page.goto('/organizer/settings/storefront')
  await expect(page).toHaveURL(/\/organizer\/setup$/)
  await expect(page.getByLabel('Organizer / business name')).toBeVisible()
  expect(errors).toEqual([])
})
