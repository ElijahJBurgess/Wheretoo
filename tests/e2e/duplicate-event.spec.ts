import { test, expect, type Page } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('.duplicate-proof/browser-fixture.json', 'utf8')) as { owner: string; token: string; source: string; api: string; anon: string }
const origin = 'http://127.0.0.1:3067'
async function connect(page: Page) {
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === 'https://duplicate-local.supabase.co') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
      const response = await route.fetch({ url: fixture.api + url.pathname + url.search, headers: { ...request.headers(), origin: 'http://127.0.0.1:3050' } })
      return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': origin } })
    }
    if (url.origin !== origin && url.origin !== fixture.api) return route.abort('blockedbyclient')
    return route.continue()
  })
  await page.addInitScript(({ owner, token }) => localStorage.setItem('sb-duplicate-local-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-fixture-only', expires_at: Math.floor(Date.now()/1000)+3000, expires_in: 3000, token_type: 'bearer', user: { id: owner, email: 'owner@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } })), fixture)
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `.duplicate-proof/screens/${name}.png`, fullPage: false })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}
test.beforeAll(() => mkdirSync('.duplicate-proof/screens', { recursive: true }))
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }) })
test('real duplicate action, keyboard, responsive rows, saved editor and reload', async ({ page }) => {
  await connect(page)
  await page.goto('/organizer/events')
  const action = page.getByRole('button', { name: 'Duplicate event: Browser Duplicate Source', exact: true })
  await expect(action).toBeVisible()
  expect(await action.evaluate(e => e.closest('a') === null)).toBe(true)
  for (const width of [390, 1440]) { await page.setViewportSize({ width, height: 900 }); await screenshot(page, `events-${width}`) }
  await action.focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/organizer\/events\/[0-9a-f-]+\/edit\?resume=1/)
  expect(page.url()).not.toContain(fixture.source)
  await expect(page.getByText('Draft created. Choose a new date and time before publishing.')).toBeVisible()
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Ends', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Venue name', { exact: true })).toHaveValue('Fixture Hall')
  await screenshot(page, 'editor-desktop')
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'editor-390')
  const url=page.url(); await page.reload()
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Venue name', { exact: true })).toHaveValue('Fixture Hall')
  await page.goto(url.replace('resume=1','step=details'))
  await expect(page.getByRole('checkbox')).not.toBeChecked()
  await page.goto(url.replace('resume=1','step=basics'))
  await expect(page.getByLabel('Event name', { exact: true })).toHaveValue('Browser Duplicate Source — Copy')
})
test('pending synchronous guard, source conflict, known failure, unknown result and refresh', async ({ page }) => {
  await connect(page); await page.goto('/organizer/events')
  const action=page.getByRole('button',{name:'Duplicate event: Browser Duplicate Source',exact:true})
  let release!: () => void; let calls=0
  let outcome: 'conflict' | 'flyer' | 'unknown' = 'conflict'
  await page.route('**/functions/v1/duplicate-event',async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    calls++
    if (outcome === 'conflict') await new Promise<void>(resolve=>{release=resolve})
    if (outcome === 'unknown') return route.abort('failed')
    await route.fulfill({status:409,json:{error:outcome === 'conflict' ? 'DUPLICATE_SOURCE_CHANGED' : 'DUPLICATE_FLYER_UNAVAILABLE'},headers:{'access-control-allow-origin':origin}})
  })
  await action.scrollIntoViewIfNeeded()
  const position = await action.boundingBox()
  await action.dblclick(); await expect(page).toHaveURL(/\/organizer\/events$/); await expect(action).toBeDisabled();
  expect((await action.boundingBox())?.y).toBe(position?.y);  await expect.poll(()=>calls).toBe(1)
  release(); await expect(page.getByRole('alert')).toContainText('changed while it was being copied')
  await expect(action).toBeEnabled()
  outcome='flyer'
  await action.click();await expect(page.getByRole('alert')).toContainText('No draft was created')
  outcome='unknown'
  await action.click();await expect(page.getByRole('alert')).toContainText('result could not be confirmed')
  await expect(action).toBeDisabled();await page.getByRole('alert').scrollIntoViewIfNeeded();await screenshot(page,'unknown-390')
  await page.getByRole('button',{name:'Check My Events',exact:true}).click();await expect(action).toBeEnabled()
})
test('navigation/unmount discards late successful navigation',async({page})=>{
  await connect(page);await page.goto('/organizer/events')
  let release!:()=>void
  await page.route('**/functions/v1/duplicate-event',async route=>{
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise<void>(resolve=>{release=resolve})
    await route.fulfill({status:201,json:{eventId:'dd000000-0000-4000-8000-000000000099'},headers:{'access-control-allow-origin':origin}})
  })
  await page.getByRole('button',{name:'Duplicate event: Browser Duplicate Source',exact:true}).click()
  await expect.poll(()=>Boolean(release)).toBe(true)
  await page.getByRole('link',{name:'Create event',exact:true}).click()
  await expect(page.getByRole('heading', { name: 'Event Basics' })).toBeVisible()
  await expect(page).toHaveURL(/\/organizer\/events\/new/)
  release();await page.waitForTimeout(250);await expect(page).toHaveURL(/\/organizer\/events\/new/)
})
test('logout discards an in-flight duplicate completion', async ({ page }) => {
  await connect(page); await page.goto('/organizer/events')
  let release!: () => void
  await page.route('**/functions/v1/duplicate-event', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ status: 201, json: { eventId: 'dd000000-0000-4000-8000-000000000099' }, headers: { 'access-control-allow-origin': origin } })
  })
  await page.getByRole('button', { name: 'Duplicate event: Browser Duplicate Source', exact: true }).click()
  await expect.poll(() => Boolean(release)).toBe(true)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in/)
  release()
  await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in/)
})
