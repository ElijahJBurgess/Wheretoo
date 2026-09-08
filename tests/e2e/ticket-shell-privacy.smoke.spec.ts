import { expect, test, type BrowserContext } from '@playwright/test'

const authStorageKey = 'sb-abcdefghijklmnopqrst-auth-token'
const expiredAuthSession = JSON.stringify({
  access_token: 'eyJhbGciOiJub25lIn0.eyJleHAiOjF9.fixture',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 1,
  refresh_token: 'fixture-refresh-token',
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'expired@example.invalid',
    app_metadata: {},
    user_metadata: {},
    created_at: '1970-01-01T00:00:00.000Z',
  },
})
const supabaseTokenUrl = 'https://abcdefghijklmnopqrst.supabase.co/auth/v1/token'

async function seedExpiredSession(context: BrowserContext) {
  await context.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: authStorageKey, value: expiredAuthSession },
  )
}

test('bearer route does not initialize auth or leak its bearer', async ({ browser }) => {
  const controlContext = await browser.newContext()
  await controlContext.route('https://abcdefghijklmnopqrst.supabase.co/**', (route) => route.abort())
  await seedExpiredSession(controlContext)
  const controlPage = await controlContext.newPage()
  const refreshRequest = controlPage.waitForRequest(
    (request) => request.url().startsWith(supabaseTokenUrl),
    { timeout: 10_000 },
  )

  await controlPage.goto('/')
  await controlPage.evaluate(
    (modulePath) => import(/* @vite-ignore */ modulePath),
    '/src/lib/supabase/client.ts',
  )
  await refreshRequest
  await controlContext.close()

  const bearer = 'wh_test_collection_paid'
  const ticketContext = await browser.newContext()
  await ticketContext.route('https://abcdefghijklmnopqrst.supabase.co/**', (route) => route.abort())
  await seedExpiredSession(ticketContext)
  const requestedUrls: string[] = []
  ticketContext.on('request', (request) => requestedUrls.push(request.url()))
  const ticketPage = await ticketContext.newPage()

  await ticketPage.goto(`/tickets/${bearer}`)
  await expect(ticketPage.getByRole('heading', { name: 'Ticket 1' })).toBeVisible()
  await expect(ticketPage.getByTestId('admission-qr')).toHaveCount(1)
  await expect(ticketPage.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  await ticketPage.waitForTimeout(500)

  expect(requestedUrls.length).toBeGreaterThan(0)
  for (const requestedUrl of requestedUrls) {
    expect(new URL(requestedUrl).origin).toBe('http://127.0.0.1:3000')
  }

  const storageValues = await ticketPage.evaluate(() => [
    ...Object.values(window.localStorage),
    ...Object.values(window.sessionStorage),
  ])
  expect(storageValues.every((value) => !value.includes(bearer))).toBe(true)
  expect(requestedUrls.some((url) => url.startsWith(supabaseTokenUrl))).toBe(false)

  await ticketContext.close()
})
