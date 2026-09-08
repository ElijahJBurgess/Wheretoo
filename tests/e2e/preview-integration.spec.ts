import { expect, test } from '@playwright/test'

for (const width of [320, 390, 768, 1440]) {
  test(`offline multi-tier preview survives direct routes and keyboard changes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const external: string[] = []
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:3012') return route.continue()
      external.push(route.request().url())
      return route.abort()
    })
    await page.goto('/preview/ticket-selection')
    const ga = page.getByRole('spinbutton', { name: 'General Admission quantity' })
    const vip = page.getByRole('spinbutton', { name: 'VIP quantity' })
    await expect(ga).toBeVisible()
    await expect(vip).toBeEnabled()
    await ga.fill('1')
    await ga.press('ArrowUp')
    await vip.fill('1')
    await expect(ga).toHaveValue('2')
    await expect(page.getByRole('status')).toHaveText('3 of 10 tickets selected')
    await expect(page.getByRole('button', { name: 'Get tickets' })).toBeEnabled()
    for (const input of [ga, vip]) {
      await expect(input).toHaveCSS('opacity', '1')
      await expect(input).not.toHaveCSS('position', 'absolute')
    }
    await expect(page.getByRole('status')).toHaveCSS('color', 'rgb(185, 180, 204)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.public-event').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`multi-tier-${width}.png`), fullPage: true })
    await vip.fill('9')
    await expect(page.getByRole('status')).toHaveText('11 tickets selected. Maximum 10.')
    await expect(page.getByRole('button', { name: 'Get tickets' })).toBeDisabled()
    await expect(page.getByRole('status')).toHaveCSS('color', 'rgb(255, 180, 171)')
    await page.getByRole('link', { name: '← Screen hub' }).click()
    await expect(page.getByRole('heading', { name: 'Wheretoo screen hub' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Wheretoo screen hub' })).toBeVisible()
    await page.goBack()
    await expect(ga).toBeVisible()
    expect(external).toEqual([])
  })
}

test('direct React Router policy and auth routes survive the production SPA fallback', async ({ page }) => {
  await page.route('https://**/*', route => route.abort())
  for (const route of ['/event-policy', '/organizer-terms', '/auth/sign-in']) {
    const response = await page.goto(route)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Page not found')
    await page.reload()
    await expect(page.locator('h1')).toBeVisible()
  }
})
