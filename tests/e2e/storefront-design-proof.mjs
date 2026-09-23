// Presentation edge cases use intercepted DTO copies; real journeys run separately.
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const dir = '.superpowers/storefront/design-proof'
await mkdir(dir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const checks = []
const pass = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
const url = 'http://127.0.0.1:3070/night-sessions'
const response = page.waitForResponse((r) =>
  r.url().endsWith('/rpc/get_public_organizer_storefront')
)
await page.goto(url)
const baseline = await (await response).json()
async function layout() {
  await expect(page.locator('.storefront-tabs')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth + 1
    ),
  ).toBe(true)
  for (const flyer of await page.locator('.storefront-flyer').all()) {
    const box = await flyer.boundingBox()
    expect(Math.abs(box.width / box.height - .8)).toBeLessThan(.02)
    expect(await flyer.evaluate((e) => getComputedStyle(e).objectFit)).toBe(
      'contain',
    )
  }
  const title = await page.locator('.storefront-identity h1').boundingBox()
  const meta = await page.locator('.storefront-identity__meta').boundingBox()
  expect(meta.y).toBeGreaterThanOrEqual(title.y + title.height - 1)
}
for (const width of [320, 390, 430, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 1000 })
  await layout()
  await page.locator('.storefront-footer').scrollIntoViewIfNeeded()
  await expect.poll(() =>
    page.locator('.storefront img').evaluateAll((imgs) =>
      imgs.every((i) => i.complete && i.naturalWidth > 0)
    )
  ).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${dir}/public-${width}.png`, fullPage: true })
  pass(`all flyers 4:5 contain; identity no overlap; ${width}px`)
}
await page.setViewportSize({ width: 390, height: 844 })
const about = page.getByRole('navigation', { name: 'Storefront sections' })
  .getByRole('link', { name: 'About' })
await page.keyboard.press('Tab')
await about.focus()
expect(await about.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe(
  'solid',
)
await page.keyboard.press('Enter')
await expect(page).toHaveURL(/#storefront-about$/)
await expect(about).toHaveAttribute('aria-current', 'location')
expect(
  await page.locator('#storefront-about').evaluate((e) =>
    e.getBoundingClientRect().top < innerHeight
  ),
).toBe(true)
pass('keyboard anchor navigation, active section, visible focus')
await page.setViewportSize({ width: 1440, height: 900 })
await page.locator('#storefront-about').scrollIntoViewIfNeeded()
await page.getByRole('navigation', { name: 'Storefront sections' }).getByRole('link', { name: 'Events', exact: true }).click()
expect(await page.locator('#storefront-events').evaluate(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= -1 && r.top < 100 })).toBe(true)
await page.setViewportSize({ width: 390, height: 844 })

await page.emulateMedia({ reducedMotion: 'reduce' })
expect(
  await page.locator('.storefront-cta').first().evaluate((e) =>
    getComputedStyle(e).transitionDuration
  ),
).toBe('0s')
pass('reduced motion')
await page.goto(url)
await layout()
await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.storefront, .storefront *')]
  const sizes = nodes.map((e) => parseFloat(getComputedStyle(e).fontSize))
  nodes.forEach((e, i) => {
    e.style.fontSize = `${sizes[i] * 2}px`
  })
})
await layout()
await page.screenshot({ path: `${dir}/text-200.png`, fullPage: true })
await page.screenshot({ path: `${dir}/text-200-top.png` })
pass('200% text: reflow, no overflow or identity overlap')
let variant = baseline
await page.route(
  '**/rest/v1/rpc/get_public_organizer_storefront',
  (route) => route.fulfill({ json: variant }),
)
variant = structuredClone(baseline)
variant.identity.coverId = null
variant.identity.links = {}
variant.identity.websiteUrl = null
variant.merch = []
variant.storeUrl = null
variant.featured = null
variant.events = []
variant.nextCursor = null
await page.goto(url)
await layout()
await expect(page.getByText('No upcoming events right now.')).toBeVisible()
await expect(
  page.locator('.storefront-cover, .storefront-merch, .storefront-links'),
).toHaveCount(0)
await expect(
  page.getByRole('navigation', { name: 'Storefront sections' }).getByRole(
    'link',
    { name: 'Merch' },
  ),
).toHaveCount(0)
await page.screenshot({ path: `${dir}/empty-390.png`, fullPage: true })
pass('no cover, no links, no merch, empty published presentation')
variant = structuredClone(baseline)
variant.identity.name =
  'Independent music and cultural gatherings across the Bay Area'
variant.identity.bio =
  'Independent music and cultural gatherings across the Bay Area. '.repeat(7)
variant.featured.flyerId = null
variant.featured.admission = {
  state: 'sold_out',
  minimumAmountMinor: null,
  currency: null,
}
variant.events[0].admission = {
  state: 'unavailable',
  minimumAmountMinor: null,
  currency: null,
}
variant.events = variant.events.slice(0, 2)
variant.nextCursor = null
for (const width of [320, 390, 1440]) {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(url)
  await layout()
  await expect(
    page.locator('.storefront-event--featured').getByRole('link', {
      name: 'Get Tickets',
    }),
  ).toHaveCount(0)
  await expect(
    page.locator('.storefront-event--featured').getByText('Sold Out'),
  ).toBeVisible()
  await page.screenshot({
    path: `${dir}/long-soldout-${width}.png`,
    fullPage: true,
  })
}
pass('long identity/bio, missing flyer, sold out/unavailable; 320/390/1440px')
expect(errors).toEqual([])
await writeFile(
  `${dir}/results.json`,
  JSON.stringify({ checks, errors }, null, 2),
)
await browser.close()
