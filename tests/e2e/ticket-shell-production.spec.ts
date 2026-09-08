import { expect, test } from '@playwright/test'

const productionOrigin = 'http://127.0.0.1:3001'
const sentinelBearer = 'a'.repeat(42) + 'A'
const edgeUrl = 'https://ticket-shells-disabled.supabase.co/functions/v1/ticket-collection'

const developmentOnlyRoutes = [
  '/tickets/wh_test_collection_paid',
  '/__dev/ticket-shells/events/event-a/dashboard',
  '/__dev/ticket-shells/events/event-a/check-in',
  '/__dev/ticket-shells/emails/tickets-ready/free-rsvp',
  '/__dev/ticket-shells/qr/32-11',
] as const

const developmentBodySentinels = [
  'Mission Night Market',
  'Development only',
  'Demo data',
  'Email shell',
  'wh_test_collection_',
  'wh_test_admit_',
] as const

test('production preview fails closed without exposing ticket shell development tooling', async ({ browser }, testInfo) => {
  const context = await browser.newContext()
  await context.route('https://ticket-shells-disabled.supabase.co/**', async (route) => {
    if (route.request().url() === edgeUrl) {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({ collectionBearer: sentinelBearer })
      expect(route.request().headers().authorization).toBeUndefined()
      expect(route.request().headers().referer).toBeUndefined()
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"kind":"unavailable"}' })
    } else await route.abort()
  })
  // If Auth is accidentally initialized it will try to refresh this synthetic
  // expired session. All external requests are intercepted above.
  await context.addInitScript(() => localStorage.setItem('sb-ticket-shells-disabled-auth-token', JSON.stringify({
    access_token: 'synthetic-expired-token', refresh_token: 'synthetic-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: 1,
    user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated' },
  })))
  const requestedUrls: string[] = []
  context.on('request', (request) => requestedUrls.push(request.url()))
  const page = await context.newPage()

  await page.goto(`/tickets/${sentinelBearer}`)

  await expect(page.getByText('Tickets unavailable', { exact: true })).toBeVisible()
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  await page.waitForTimeout(500)
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width: width!, height: height! })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`production-unavailable-${width}.png`), fullPage: true, mask: [page.locator('[data-testid="admission-qr"], .development-scanner-controls')] })
  }

  const storageValues = await page.evaluate(() => [
    ...Object.values(window.localStorage),
    ...Object.values(window.sessionStorage),
  ])
  expect(storageValues.every((value) => !value.includes(sentinelBearer))).toBe(true)

  for (const route of developmentOnlyRoutes) {
    await page.goto(route)
    const body = await page.locator('body').innerText()

    for (const sentinel of developmentBodySentinels) {
      expect(body).not.toContain(sentinel)
    }

    if (route.startsWith('/tickets/')) {
      await expect(page.getByText('Tickets unavailable', { exact: true })).toBeVisible()
    } else {
      expect(body).toMatch(/404|not found/i)
    }
  }

  expect(requestedUrls.length).toBeGreaterThan(0)
  for (const requestedUrl of requestedUrls) {
    expect(new URL(requestedUrl).origin === productionOrigin || requestedUrl === edgeUrl).toBe(true)
  }
  expect(requestedUrls.some((url) => url === edgeUrl)).toBe(true)
  expect(requestedUrls.some((url) => url.includes('/auth/v1/'))).toBe(false)

  await context.close()
})
