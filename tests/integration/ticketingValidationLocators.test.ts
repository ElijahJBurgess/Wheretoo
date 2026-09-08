import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { chromium, expect as browserExpect } from '@playwright/test'
import { expect, it } from 'vitest'

it('buyer total assertions identify Total when Subtotal has the same amount', async () => {
  const journey = readFileSync(new URL('../e2e/ticket-purchase.spec.ts', import.meta.url), 'utf8')
  const assertions = journey.split('\n').filter((line) => line.includes('await expect(') && line.includes('$55.00'))
  expect(assertions.length).toBe(2)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', (route) => route.abort())
    await page.setContent('<dl><div><dt>Subtotal</dt><dd>$55.00</dd></div><div><dt>Total</dt><dd>$55.00</dd></div></dl>')
    await runInNewContext(`(async () => { ${assertions.join('\n')} })()`, { page, expect: browserExpect.configure({ timeout: 500 }) })
  } finally { await browser.close() }
})

it('buyer journey validates both field errors with the summary alert also present', async () => {
  const journey = readFileSync(new URL('../e2e/ticket-purchase.spec.ts', import.meta.url), 'utf8')
  const start = journey.indexOf("    await expect(page.getByLabel('Your name')).toBeFocused()")
  const end = journey.indexOf('    await submitAfterOneAmbiguousResponse', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    // This is a local DOM-only locator contract. Never load the app or an external URL.
    await page.route('**/*', (route) => route.abort())
    await page.setContent(`
      <div role="alert">Check your details
        <ul><li>Enter your name</li><li>Enter a valid email address</li></ul>
      </div>
      <label for="buyer-name">Your name</label>
      <input id="buyer-name" aria-invalid="true" aria-describedby="buyer-name-error">
      <p id="buyer-name-error" role="alert">Enter your name</p>
      <label for="buyer-email">Email address</label>
      <input id="buyer-email" aria-invalid="true" aria-describedby="buyer-email-error">
      <p id="buyer-email-error" role="alert">Enter a valid email address</p>
    `)
    await page.getByLabel('Your name').focus()
    await browserExpect(page.getByRole('alert')).toHaveCount(3)

    // Execute the buyer spec's actual focus/error assertions, so broad alert locators fail here.
    await runInNewContext(`(async () => { ${journey.slice(start, end)} })()`, {
      page,
      expect: browserExpect.configure({ timeout: 500 }),
    })
  } finally {
    await browser.close()
  }
})
