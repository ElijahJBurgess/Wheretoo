import { test, expect, type Page, type Download } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const owner = 'a6100000-0000-4000-8000-000000000001'
const paid = 'a6200000-0000-4000-8000-000000000001'
const freeOwner = 'b6100000-0000-4000-8000-000000000001'
const free = 'b6200000-0000-4000-8000-000000000002'
const origin = 'http://127.0.0.1:3036'
const service = 'https://csv-local.supabase.co'
const visual = '.superpowers/csv-export/visual'
function jwt(id: string) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ role: 'authenticated', sub: id, exp: 1893456000 })
  return body + '.' + createHmac('sha256', 'csv-export-local-only-jwt-secret-disposable-2026').update(body).digest('base64url')
}
async function connect(page: Page, id = owner) {
  const calls: unknown[] = []
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === service) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } })
      if (!url.pathname.startsWith('/rest/v1/')) return route.abort('blockedbyclient')
      if (url.pathname.endsWith('/get_organizer_event_export')) calls.push(request.postDataJSON())
      const response = await route.fetch({ url: 'http://127.0.0.1:55626' + url.pathname.slice('/rest/v1'.length) + url.search })
      return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': origin } })
    }
    if (url.origin !== origin) return route.abort('blockedbyclient')
    return route.continue()
  })
  await page.addInitScript(({ id, access }) => localStorage.setItem('sb-csv-local-auth-token', JSON.stringify({ access_token: access, refresh_token: 'local-only', expires_at: 1893456000, expires_in: 9999999, token_type: 'bearer', user: { id, email: 'owner@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } })), { id, access: jwt(id) })
  return calls
}
async function parseDownload(download: Download, width: number, count: number) {
  expect(download.suggestedFilename()).toMatch(/-\d{4}-\d{2}-\d{2}-(orders|admissions|registrations)\.csv$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const bytes = readFileSync(path!)
  expect(bytes.subarray(0, 3).toString('hex')).toBe('efbbbf')
  const rows = JSON.parse(execFileSync('python3', ['-c', 'import csv,json,sys;print(json.dumps(list(csv.reader(open(sys.argv[1],encoding="utf-8-sig",newline=""),strict=True))))', path!], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })) as string[][]
  expect(rows).toHaveLength(count + 1)
  expect(rows.every(row => row.length === width)).toBe(true)
  return rows
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${visual}/${name}.png`, fullPage: false })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}
test.beforeAll(() => { execFileSync('python3', ['tests/integration/csv-export-services.py'], { stdio: 'pipe' }); mkdirSync(visual, { recursive: true }) })
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }) })
test('real authenticated Orders download ignores page/search/filter; keyboard and responsive presentation', async ({ page }) => {
  const calls = await connect(page)
  await page.goto(`/organizer/events/${paid}/orders`)
  await expect(page.locator('.ops-orders > li')).toHaveCount(25)
  const trigger = page.getByRole('button', { name: 'Export', exact: true })
  await trigger.focus(); await page.keyboard.press('Enter')
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Orders CSV', exact: true })).toBeFocused()
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await trigger.click(); await shot(page, `orders-${width}`); await trigger.click()
  }
  await page.getByRole('button', { name: 'Paid', exact: true }).click()
  await page.getByRole('searchbox').fill('does-not-match')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.locator('.ops-orders > li')).toHaveCount(0)
  await trigger.click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Orders CSV', exact: true }).click()
  const rows = await parseDownload(await pending, 19, 2000)
  expect(new Set(rows.slice(1).map(row => row[6])).size).toBe(2000)
  expect(calls).toEqual([{ p_event_id: paid, p_kind: 'orders' }])
  await expect(page.getByText('Download started.')).toBeVisible()
  await expect(trigger).toBeFocused()
  await page.goto(`/organizer/events/${paid}/dashboard`)
  await trigger.click()
  const admissions = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Admissions CSV', exact: true }).click()
  await parseDownload(await admissions, 17, 3)
})
test('free registration lookup and dashboard use real complete export', async ({ page }) => {
  await connect(page, freeOwner)
  for (const route of ['registrations', 'dashboard']) {
    await page.goto(`/organizer/events/${free}/${route}`)
    const button = page.getByRole('button', { name: 'Export Registrations CSV', exact: true })
    await expect(button).toBeVisible()
    await shot(page, `free-${route}-390`)
    const pending = page.waitForEvent('download'); await button.click()
    const rows = await parseDownload(await pending, 18, 55)
    expect(new Set(rows.slice(1).map(row => row[6])).size).toBe(55)
  }
})
test('visible limit failure downloads nothing; retry succeeds; navigation discards delayed response', async ({ page }) => {
  await connect(page)
  await page.goto(`/organizer/events/${paid}/orders`)
  const downloads: Download[] = []; page.on('download', value => downloads.push(value))
  await page.route('**/rpc/get_organizer_event_export', route => route.fulfill({ status: 413, json: { code: 'PT413', message: 'EXPORT_LIMIT_EXCEEDED' }, headers: { 'access-control-allow-origin': origin } }), { times: 1 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'Orders CSV', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('download limit')
  expect(downloads).toHaveLength(0)
  await shot(page, 'limit-390')
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await parseDownload(await pending, 19, 2000)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/rpc/get_organizer_event_export', async route => { await gate; await route.fallback() }, { times: 1 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'Orders CSV', exact: true }).click()
  await expect(page.getByText('Preparing CSV…')).toBeVisible()
  await page.getByRole('link', { name: '← Event dashboard', exact: true }).click()
  release()
  await page.waitForLoadState('networkidle')
  expect(downloads).toHaveLength(1)
})
