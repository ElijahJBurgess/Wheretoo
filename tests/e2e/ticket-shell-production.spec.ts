import { expect, test } from '@playwright/test'
import { decoderBundle, decodeMountedQr } from './support/ticketExperienceJourney'

const productionOrigin = 'http://127.0.0.1:3001'
const sentinelBearer = 'a'.repeat(42) + 'A'
const edgeUrl = 'https://ticket-shells-disabled.supabase.co/functions/v1/ticket-collection'

const developmentOnlyRoutes = [
  '/preview',
  '/preview/ticket-selection',
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

test('local production collection renders one individually decoded QR at a time', async ({ page }) => {
  const eventId = '10000000-0000-4000-8000-000000000001'
  const credentials = ['a', 'b', 'c'].map(character => `wta1_${character.repeat(42)}A`)
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin === productionOrigin) return route.continue()
    if (route.request().url() !== edgeUrl) return route.abort()
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ kind: 'ready', collection: {
      collectionLabel: 'Local synthetic collection', eventId,
      tickets: credentials.map((admissionCredential, index) => ({
        selector: `20000000-0000-4000-8000-00000000000${index + 1}`, eventId,
        eventName: 'Local synthetic event', startsAt: '2099-01-01T01:00:00Z', endsAt: '2099-01-01T04:00:00Z',
        venueName: 'Local synthetic venue', admissionLabel: index < 2 ? 'GA' : 'VIP',
        position: index + 1, totalInCollection: 3, status: 'valid', admissionCredential,
      })),
    } }) })
  })
  const bundle = await decoderBundle()
  await page.goto(`/tickets/${sentinelBearer}`)
  await expect(page.locator('.ticket-collection__list a')).toHaveCount(3)
  await expect(page.getByTestId('admission-qr')).toHaveCount(0)
  const paths = await page.locator('.ticket-collection__list a').evaluateAll(links => links.map(link => link.getAttribute('href')!))
  for (const [index, path] of paths.entries()) {
    await page.goto(path)
    expect(await decodeMountedQr(page, bundle) === credentials[index]).toBe(true)
  }
})

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
    await expect(page.locator('body')).toContainText(route.startsWith('/tickets/') ? 'Tickets unavailable' : /404|not found/i)
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

test('paid confirmation opens an accountless ticket document without inherited Auth activity', async ({ browser }, testInfo) => {
  const context = await browser.newContext()
  const authRequests = { confirmation: 0, ticket: 0 }
  const page = await context.newPage()
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === productionOrigin) return route.continue()
    // Every external request is handled locally, including the positive Auth control.
    if (url.origin !== 'https://ticket-shells-disabled.supabase.co') return route.abort()
    if (url.pathname === '/functions/v1/order-confirmation') {
      expect(request.postDataJSON()).toEqual({ confirmationToken: sentinelBearer })
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        event: { title: 'Synthetic transition event', startsAt: '2026-10-01T01:00:00Z', endsAt: '2026-10-01T04:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Synthetic venue' },
        items: [{ tierName: 'General admission', quantity: 1, unitAmountMinor: 2500, subtotalMinor: 2500, currency: 'usd' }],
        orderNumber: 'WT-SYNTHETIC-TRANSITION', status: 'paid', quantity: 1, currency: 'usd',
        subtotalMinor: 2500, taxAmountMinor: 0, totalMinor: 2500,
      }) })
    }
    if (request.url() === edgeUrl) {
      expect(request.postDataJSON()).toEqual({ collectionBearer: sentinelBearer })
      expect(request.headers().authorization).toBeUndefined()
      expect(request.headers().referer).toBeUndefined()
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"kind":"unavailable"}' })
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      authRequests[page.url().includes('/tickets/') ? 'ticket' : 'confirmation'] += 1
      return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant","error_description":"Synthetic expired session","code":"refresh_token_not_found"}' })
    }
    return route.abort()
  })
  await context.addInitScript(() => {
    const probe = { documentId: crypto.randomUUID(), confirmationReads: 0, ticketReads: 0 }
    Object.assign(window, { transitionPrivacyProbe: probe })
    const originalGet = Storage.prototype.getItem
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith('sb-ticket-shells-disabled-auth-token')) {
        if (location.pathname.startsWith('/tickets/')) probe.ticketReads += 1
        else if (location.pathname.startsWith('/orders/')) probe.confirmationReads += 1
      }
      return originalGet.call(this, key)
    }
  })
  const triggerExpiredSession = (stage: 'confirmation' | 'ticket') => page.evaluate((stage) => {
    localStorage.setItem('sb-ticket-shells-disabled-auth-token', JSON.stringify({
      access_token: 'synthetic-expired-token', refresh_token: `synthetic-refresh-${stage}`,
      token_type: 'bearer', expires_in: 3600, expires_at: 1,
      user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated' },
    }))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    window.dispatchEvent(new Event('visibilitychange'))
  }, stage)
  const readProbe = () => page.evaluate(() => (window as unknown as {
    transitionPrivacyProbe: { documentId: string; confirmationReads: number; ticketReads: number }
  }).transitionPrivacyProbe)

  await page.goto(`/orders/${sentinelBearer}`)
  await expect(page.getByRole('link', { name: 'View tickets' })).toHaveAttribute('href', `/tickets/${sentinelBearer}`)
  await triggerExpiredSession('confirmation')
  await expect.poll(() => authRequests.confirmation).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sb-ticket-shells-disabled-auth-token'))).toBe(null)
  const confirmationProbe = await readProbe()
  expect(confirmationProbe.confirmationReads).toBeGreaterThan(0)

  await page.getByRole('link', { name: 'View tickets' }).click()
  await expect(page).toHaveURL(`/tickets/${sentinelBearer}`)
  await expect(page.getByText('Tickets unavailable', { exact: true })).toBeVisible()
  // Use a distinct synthetic token so Auth's failed-refresh cooldown cannot
  // suppress a leaked listener and make the transition check falsely pass.
  await triggerExpiredSession('ticket')
  await page.waitForTimeout(500)
  const ticketProbe = await readProbe()
  await testInfo.attach('transition-privacy-counts', {
    body: JSON.stringify({ confirmationReads: confirmationProbe.confirmationReads, ticketReads: ticketProbe.ticketReads, authRequests, newDocument: ticketProbe.documentId !== confirmationProbe.documentId }),
    contentType: 'application/json',
  })
  expect.soft(ticketProbe.documentId).not.toBe(confirmationProbe.documentId)
  expect.soft(ticketProbe.ticketReads).toBe(0)
  expect(authRequests.ticket).toBe(0)
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]
    .some((value) => value.includes('a'.repeat(42) + 'A')))).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('confirmation-to-ticket-unavailable.png'), fullPage: true, mask: [page.locator('[data-testid="admission-qr"], .development-scanner-controls')] })
  await context.close()
})
