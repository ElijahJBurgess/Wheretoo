import { expect, test, type Page } from '@playwright/test'

const organizerId = '12000000-0000-4000-8000-000000000091'
const user = { id: organizerId, aud: 'authenticated', role: 'authenticated', email: 'onboarding@example.invalid', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: 'Avery Stone' }, created_at: '2026-09-10T00:00:00Z' }
const profile = { id: organizerId, display_name: 'Night Assembly', organizer_type: 'Community group', bio: '', website_url: null, base_city: null, country_code: 'US', onboarding_completed_at: '2026-09-10T00:00:00Z', created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z' }
const session = () => ({ access_token: `${btoa('{}')}.${btoa(JSON.stringify({ sub: organizerId, exp: Math.floor(Date.now() / 1000) + 3600 }))}.fixture`, refresh_token: 'fixture-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user })
type Status = 'not_started' | 'pending' | 'action_required' | 'restricted' | 'ready'

async function fixtures(page: Page, options: { authenticated?: boolean; completed?: boolean; confirmEmail?: boolean } = {}) {
  const state = { profile: options.completed ? { ...profile } : null as null | typeof profile, status: 'not_started' as Status, failStatus: false, sessionCalls: 0, saves: 0 }
  const unexpected: string[] = []
  if (options.authenticated) await page.addInitScript(value => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), session())
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:3000') return route.continue()
    const respond = (json: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) })
    if (url.origin !== 'http://127.0.0.1:54321') { unexpected.push(url.origin); return route.abort() }
    if (url.pathname.endsWith('/auth/v1/signup')) return respond(options.confirmEmail ? { user, session: null } : session())
    if (url.pathname.endsWith('/auth/v1/token')) return respond(session())
    if (url.pathname.endsWith('/auth/v1/user')) return respond(user)
    if (url.pathname.endsWith('/rpc/get_my_staff_role')) return respond(null)
    if (url.pathname.endsWith('/organizers')) {
      if (request.method() !== 'GET') { state.profile = { ...profile, ...request.postDataJSON() }; state.saves += 1; return respond(state.profile) }
      return respond(state.profile ? [state.profile] : [])
    }
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/rpc/list_owned_events')) return respond([])
    if (url.pathname.endsWith('/stripe-connect-status')) return state.failStatus ? respond({ error: 'fixture error' }, 503) : respond(state.status === 'not_started' ? { status: state.status } : { status: state.status, requirements_currently_due_count: 0, requirements_past_due_count: 0, last_status_code: null, last_synced_at: '2026-09-10T00:00:00Z' })
    if (url.pathname.endsWith('/stripe-connect-session')) { state.sessionCalls++; return respond({ error: 'fixture account session failure' }, 503) }
    unexpected.push(url.pathname)
    return respond({ error: 'Unexpected fixture request' }, 500)
  })
  return { state, unexpected }
}
async function signup(page: Page) {
  await page.getByLabel('Full name').fill('Avery Stone')
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('test-only-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
}
async function layout(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('main').count()).toBe(1)
  for (const box of await page.locator('input,select,button,.onboarding .ui-button').all()) {
    if (!await box.isVisible()) continue
    const rect = await box.boundingBox()
    expect(rect?.height).toBeGreaterThanOrEqual(40)
  }
}

for (const width of [320, 390, 768, 1440]) {
  test(`signup to profile to payouts, skip, resume and status recovery at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
    const { state, unexpected } = await fixtures(page)
    await page.goto('/auth/sign-up')
    await expect(page.getByRole('heading', { name: 'Create your organizer account' })).toBeVisible()
    await layout(page)
    await page.screenshot({ path: testInfo.outputPath(`signup-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page.getByLabel('Full name')).toBeFocused()
    await signup(page)
    await expect(page).toHaveURL(/\/organizer\/setup$/)
    await expect(page.getByLabel('Organizer / business name')).toBeVisible()
    await expect(page.locator('[aria-current="step"]')).toContainText('Profile')
    await page.getByLabel('Organizer / business name').fill(profile.display_name)
    await page.getByLabel('Organizer type').selectOption('Community group')
    await layout(page)
    await page.screenshot({ path: testInfo.outputPath(`profile-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page).toHaveURL(/\/organizer\/settings\/payments$/)
    await expect(page.getByRole('heading', { name: 'Secure payouts with Stripe' })).toBeVisible()
    expect(state.saves).toBe(1)
    await layout(page)
    await page.screenshot({ path: testInfo.outputPath(`payouts-${width}.png`), fullPage: true })
    await page.getByRole('link', { name: 'Do this later' }).click()
    await expect(page).toHaveURL(/\/organizer\/events$/)
    expect(state.sessionCalls).toBe(0)
    await page.getByRole('link', { name: 'Payments', exact: true }).click()
    await page.getByRole('button', { name: 'Set up payouts' }).click()
    await expect(page.getByRole('heading', { name: 'You’re almost there' })).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Secure payouts with Stripe' })).toBeVisible()
    await page.getByRole('button', { name: 'Set up payouts' }).click()
    await layout(page)
    await page.screenshot({ path: testInfo.outputPath(`transition-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Continue with Stripe' }).click()
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(state.sessionCalls).toBe(2)
    await layout(page)
    await page.screenshot({ path: testInfo.outputPath(`error-${width}.png`), fullPage: true })
    for (const [status, heading] of [['pending', 'Stripe is reviewing your details'], ['action_required', 'Action required in Stripe'], ['restricted', 'Payment setup needs an update'], ['ready', 'You’re all set!']] as const) {
      state.status = status
      await page.reload()
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      await layout(page)
      await page.screenshot({ path: testInfo.outputPath(`${status}-${width}.png`), fullPage: true })
    }
    await expect(page.getByRole('link', { name: 'Create your first event' })).toHaveAttribute('href', '/organizer/events/new')
    await expect(page.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/organizer/events')
    expect(unexpected).toEqual([])
  })
}

test('confirmation, returning organizer and profile guards use the existing session contracts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { state, unexpected } = await fixtures(page, { confirmEmail: true })
  await page.goto('/auth/sign-up')
  await signup(page)
  await expect(page).toHaveURL(/\/auth\/check-email$/)
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('check-email-390.png'), fullPage: true })
  await page.goto('/organizer/settings/payments')
  await expect(page).toHaveURL(/\/auth\/sign-in$/)
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('test-only-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/organizer\/setup$/)
  state.profile = { ...profile }
  await page.reload()
  await expect(page).toHaveURL(/\/organizer\/events$/)
  await page.goto('/auth/check-email')
  await expect(page).toHaveURL(/\/organizer\/events$/)
  expect(unexpected).toEqual([])
})
