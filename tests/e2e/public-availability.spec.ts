import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
const fixture = JSON.parse(readFileSync(new URL('../../.superpowers/public-availability/browser-fixtures.json', import.meta.url), 'utf8')) as { api: string; session: unknown; events: Record<string, string> }

async function localSession(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), fixture.session)
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    // Only readiness presentation is stubbed; actual paid publication uses the
    // real local database account/tier gates. Never invoke a Stripe provider.
    if (url.origin === fixture.api && url.pathname === '/functions/v1/stripe-connect-status') {
      return route.fulfill({ json: { status: 'ready', requirements_currently_due_count: 0, requirements_past_due_count: 0, last_status_code: null, last_synced_at: new Date().toISOString() } })
    }
    if (url.origin === fixture.api || url.origin === 'http://127.0.0.1:3093') return route.continue()
    errors.push(`Unexpected external request: ${url.origin}`)
    return route.abort()
  })
  return errors
}

async function layout(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
}

for (const width of [390, 1440]) {
  for (const kind of ['free', 'paid', 'risk'] as const) {
    test(`real local ${kind} publication and reload at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      const errors = await localSession(page)
      const id = fixture.events[`${kind}-${width}`]
      let publications = 0
      page.on('request', request => { if (request.url().endsWith('/rpc/publish_event_if_current')) publications++ })
      await page.goto(`/organizer/events/${id}/edit?step=requirements`)
      await expect(page.getByRole('heading', { name: 'Event Details', exact: true })).toBeVisible()
      await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Event requirements' }).getByText('Choose Yes or No.')).toHaveCount(6)
      await page.getByLabel('Minimum age').selectOption('all_ages')
      for (const radio of await page.getByRole('radio', { name: 'No', exact: true }).all()) await radio.check()
      if (kind === 'risk') await page.getByRole('group', { name: 'High-risk physical activity' }).getByRole('radio', { name: 'Yes', exact: true }).check()
      // These are development-placeholder agreements for synthetic local data.
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(page).toHaveURL(/\/preview$/)
      await page.getByRole('button', { name: 'Publish event', exact: true }).click()
      await expect(page.getByText(/Events that pass all checks go live immediately/)).toBeVisible()
      await layout(page)
      await page.screenshot({ path: info.outputPath(`confirm-${width}.png`), fullPage: true })
      // Two DOM clicks in the same task exercise the synchronous submit guard.
      await page.getByRole('button', { name: 'Confirm and publish' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await expect(page.getByRole('heading', { name: kind === 'risk' ? 'Your event is under review' : 'Your event is live!' })).toBeVisible()
      expect(publications).toBe(1)
      await layout(page)
      await page.screenshot({ path: info.outputPath(`outcome-${width}.png`), fullPage: true })
      await page.getByRole('button', { name: 'Check public availability again' }).click()
      await expect(page.getByRole('heading', { name: kind === 'risk' ? 'Your event is under review' : 'Your event is live!' })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('heading', { name: kind === 'risk' ? 'Your event is under review' : 'Your event is live!' })).toBeVisible()
      if (kind !== 'risk') {
        await page.getByRole('link', { name: 'View event', exact: true }).click()
        await expect(page).toHaveURL(`/events/${id}`)
        await expect(page.getByRole('heading', { name: 'Local community gathering', exact: true })).toBeVisible()
        await layout(page)
        await page.screenshot({ path: info.outputPath(`public-${width}.png`), fullPage: true })
      } else await expect(page.getByRole('link', { name: 'View event', exact: true })).toHaveCount(0)
      expect(errors).toEqual([])
    })
  }

  test(`missing disclosures and missing/stale agreement at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    const errors = await localSession(page)
    await page.goto(`/organizer/events/${fixture.events[`missing-${width}`]}/preview`)
    await expect(page.getByRole('heading', { name: 'Finish event requirements' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish event', exact: true })).toHaveCount(0)
    await layout(page)
    await page.screenshot({ path: info.outputPath(`missing-${width}.png`), fullPage: true })
    for (const kind of ['policy', 'stale']) {
      await page.goto(`/organizer/events/${fixture.events[`${kind}-${width}`]}/preview`)
      await expect(page.getByText('Agreement required before publishing.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Publish event', exact: true })).toBeDisabled()
      await layout(page)
      await page.screenshot({ path: info.outputPath(`${kind}-${width}.png`), fullPage: true })
    }
    expect(errors).toEqual([])
  })
}
