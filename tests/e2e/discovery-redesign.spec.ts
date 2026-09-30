import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const service = 'https://discovery-local.supabase.co'
const captures = '.superpowers/discovery-redesign/refinement-visual'
const titles = ['Sunset Rooftop Sessions', 'Taco Social', 'Night Garden', 'Lake Merritt Morning Miles', 'Community Supper', 'Oakland Art Walk', 'Late Night Sessions']
const categories = ['music', 'food_drink', 'art_culture', 'fitness', 'community', 'art_culture', 'nightlife']
const id = (index: number) => `d1590000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
const items = Array.from({ length: 14 }, (_, index) => ({
  id: id(index), title: `${titles[index % 7]}${index >= 7 ? ' · October' : ''}`, category: categories[index % 7], admissionType: index % 2 ? 'free' : 'paid',
  startsAt: '2026-10-03T02:00:00Z', endsAt: '2026-10-03T06:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Local proof venue', city: 'Oakland',
  artworkReference: null, admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null },
}))

test.beforeAll(() => mkdirSync(captures, { recursive: true }))
async function setup(page: Page, options: { empty?: boolean; error?: boolean; noImages?: boolean; brokenImages?: boolean; delay?: number; secondFeature?: boolean; appendImageFailure?: boolean } = {}) {
  let error = options.error ?? false
  const requests: Record<string, unknown>[] = []
  const unexpected: string[] = []
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:3042') return route.continue()
    if (url.origin !== service) { unexpected.push(url.origin); return route.abort() }
    if (url.pathname.endsWith('/public-discovery')) {
      const body = request.postDataJSON() as Record<string, unknown>
      requests.push(body)
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay))
      if (error) { return route.fulfill({ status: 503, json: { message: 'private internal database error' } }) }
      const filtered = items.filter(item => (!body.category || body.category === item.category) && (!body.admissionType || body.admissionType === item.admissionType))
      const start = body.cursor ? 7 : 0
      return route.fulfill({ json: { items: options.empty ? [] : filtered.slice(start, start + 7), nextCursor: !options.empty && !body.cursor && filtered.length > 7 ? 'local_cursor' : null,
        serverNow: '2026-09-29T12:00:00Z', window: { start: '2026-09-29T07:00:00Z', end: '2026-10-29T07:00:00Z', timezone: 'America/Los_Angeles' } } })
    }
    if (url.pathname.endsWith('/list_event_images')) {
      const requested = request.postDataJSON().p_event_ids as string[]
      if (options.secondFeature && !requested.includes(id(0))) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (options.appendImageFailure) return route.fulfill({ status: 503, json: {} })
      }
      if (options.secondFeature && requested.length > 7) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (options.appendImageFailure) return route.fulfill({ status: 503, json: {} })
      }
      return route.fulfill({ json: options.noImages ? [] : requested.filter(eventId => (!options.secondFeature && eventId === id(0)) || eventId === id(1)).map(eventId => ({ id: eventId, eventId, path: 'local-proof.png', position: 1, owned: false })) })
    }
    if (url.pathname.endsWith('/event-images')) {
      return options.brokenImages ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ path: 'src/preview/assets/rooftop-reference.png', contentType: 'image/png' })
    }
    if (url.pathname.endsWith('/get_public_event')) {
      const selected = items.find(item => item.id === request.postDataJSON().p_event_id)!
      return route.fulfill({ json: [{ id: selected.id, title: selected.title, description: 'Local injected discovery navigation proof.', category: selected.category,
        starts_at: selected.startsAt, ends_at: selected.endsAt, timezone: selected.timezone, venue_name: selected.venueName, address_line1: '1 Local Proof Way', address_line2: null,
        city: selected.city, region: 'CA', postal_code: '94612', country_code: 'US', latitude: 37.8, longitude: -122.27, artwork_path: null, animation_preset: 'none',
        admission_type: selected.admissionType, minimum_age: 'all_ages', advisories: [], organizer: { id: id(20), display_name: 'Local organizer' } }] })
    }
    // Ancillary public availability reads can honestly return unavailable in this navigation-only proof.
    if (url.pathname.endsWith('/get_public_waitlist_capability')) return route.fulfill({ json: { enabled: false, eligible: false } })
    if (url.pathname.endsWith('/get_public_event_ticketing') || url.pathname.endsWith('/get_public_free_rsvp')) return route.fulfill({ json: [] })
    unexpected.push(url.pathname)
    return route.abort()
  })
  return { requests, unexpected, recover: () => { error = false } }
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  if (await page.locator('.discovery-shortcuts').count()) await page.locator('.discovery-shortcuts').scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${captures}/${name}.png`, fullPage: true })
}

test('desktop artwork, supported controls, bounded pagination and truthful price', async ({ page }) => {
  const proof = await setup(page)
  await page.goto('/discover')
  await expect(page.locator('.discovery-hero img')).toBeVisible()
  await expect(page.locator('.discovery-event-row')).toHaveCount(6)
  await expect(page.locator('.discovery-hero')).toContainText('View prices')
  const brand = page.getByRole('link', { name: 'Wheretoo discovery home' })
  await expect(brand).toHaveCSS('font-family', '"Manrope Variable", sans-serif')
  expect(await brand.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none')
  await expect(page.locator('.discovery-hero img')).toHaveCSS('object-fit', 'contain')
  const feature = await page.locator('.discovery-hero').boundingBox()
  const map = await page.getByRole('complementary', { name: 'Map area' }).boundingBox()
  expect(map!.x).toBeGreaterThan(feature!.x + feature!.width)
  expect(map!.y).toBe(feature!.y)
  await capture(page, 'desktop-1440')
  await noOverflow(page)
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.locator('.discovery-event-row')).toHaveCount(13)
  await expect(page.locator('.discovery-hero')).toContainText(titles[0])
  expect(proof.requests.find(request => request.cursor)?.cursor).toBe('local_cursor')
  expect(proof.unexpected).toEqual([])
})

test('mobile filters, shortcuts, event navigation and browser return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const proof = await setup(page)
  await page.goto('/discover')
  await expect(page.locator('.discovery-hero img')).toBeVisible()
  await expect(page.locator('.discovery-hero img')).toHaveCSS('object-fit', 'contain')
  const feature = await page.locator('.discovery-hero').boundingBox()
  const map = await page.getByRole('complementary', { name: 'Map area' }).boundingBox()
  expect(map!.y).toBeGreaterThan(feature!.y + feature!.height)
  await capture(page, 'mobile-390')
  await noOverflow(page)
  await page.getByRole('combobox', { name: 'Admission' }).selectOption('free')
  await expect(page).toHaveURL('/discover?price=free')
  await expect(page.getByRole('status', { name: 'Discovery results' })).toHaveText('7 events')
  await expect.poll(() => proof.requests.at(-1)?.admissionType).toBe('free')
  await page.getByRole('link', { name: /This Weekend/ }).click()
  await expect(page).toHaveURL('/discover?when=weekend')
  await expect.poll(() => proof.requests.at(-1)?.when).toBe('weekend')
  await page.getByRole('combobox', { name: 'Category' }).selectOption('food_drink')
  await expect(page).toHaveURL('/discover?when=weekend&category=food_drink')
  await page.getByRole('link', { name: `View ${titles[1]}`, exact: true }).click()
  await expect(page).toHaveURL(`/events/${id(1)}`)
  await expect(page.getByRole('heading', { level: 1, name: titles[1] })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL('/discover?when=weekend&category=food_drink')
  await expect(page.getByRole('combobox', { name: 'Date' })).toHaveValue('weekend')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('food_drink')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).toHaveURL('/discover')
  await page.getByRole('link', { name: 'Explore events', exact: true }).click()
  await expect(page.locator('.discovery-results')).toBeInViewport()
  await noOverflow(page)
  expect(proof.unexpected).toEqual([])
})

for (const width of [390, 1440]) {
  test(`missing artwork and honest fallback at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await setup(page, { noImages: true })
    await page.goto('/discover')
    await expect(page.locator('.discovery-hero .discovery-artwork__fallback')).toBeVisible()
    await capture(page, `fallback-${width}`)
    await noOverflow(page)
  })
}
test('empty state never substitutes fixture events', async ({ page }) => {
  await setup(page, { empty: true })
  await page.goto('/discover?when=today')
  await expect(page.getByText('No events match these filters.')).toBeVisible()
  await capture(page, 'empty-1440')
  await expect(page.locator('.discovery-hero')).toHaveCount(0)
  await page.getByRole('button', { name: 'See upcoming events' }).click()
  await expect(page).toHaveURL('/discover')
})
test('loading, friendly error and recovery', async ({ page }) => {
  const proof = await setup(page, { error: true, delay: 1000 })
  await page.goto('/discover', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Loading events')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('We couldn’t load events.')
  await expect(page.getByText('private internal database error')).toHaveCount(0)
  await capture(page, 'error-1440')
  proof.recover()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.locator('.discovery-hero img')).toBeVisible()
})
test('broken artwork recovers to category art', async ({ page }) => {
  await setup(page, { brokenImages: true })
  await page.goto('/discover')
  await expect(page.locator('.discovery-hero .discovery-artwork__fallback')).toBeVisible()
  await expect(page.locator('.discovery-hero img')).toHaveCount(0)
})

test('mobile carousel returns to the selected card after browser Back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.goto('/discover')
  const rail = page.locator('.discovery-event-list')
  const target = rail.getByRole('link').last()
  await target.scrollIntoViewIfNeeded()
  const left = await rail.evaluate(element => element.scrollLeft)
  expect(left).toBeGreaterThan(500)
  await target.click()
  await expect(page).toHaveURL(`/events/${id(6)}`)
  await page.goBack()
  await expect(page).toHaveURL('/discover')
  await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(left - 10)
})

test('keyboard, narrow/tablet reflow and enlarged text stay usable', async ({ page }) => {
  const proof = await setup(page)
  await page.goto('/discover')
  await expect(page.locator('.discovery-hero')).toBeVisible()
  const date = page.getByRole('combobox', { name: 'Date' })
  await date.focus()
  expect(await date.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Category' })).toBeFocused()
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await noOverflow(page)
    await capture(page, `responsive-${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll<HTMLElement>('.discovery-page *'), element => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }))
    for (const { element, size } of sizes) element.style.fontSize = `${size * 2}px`
  })
  await capture(page, 'text-200-390')
  await noOverflow(page)
  expect(proof.unexpected).toEqual([])
})

for (const appendImageFailure of [false, true]) {
  test(`first-page feature survives appended image lookup ${appendImageFailure ? 'failure' : 'delay'}`, async ({ page }) => {
    await setup(page, { secondFeature: true, appendImageFailure })
    await page.goto('/discover')
    await expect(page.locator('.discovery-hero h2')).toHaveText(titles[1])
    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(page.locator('.discovery-event-row')).toHaveCount(13)
    await expect(page.locator('.discovery-hero h2')).toHaveText(titles[1], { timeout: 300 })
    await page.waitForTimeout(1200)
    await expect(page.locator('.discovery-hero h2')).toHaveText(titles[1])
    await expect(page.locator('.discovery-hero img')).toBeVisible()
  })
}

test('shared onboarding wordmark preserves desktop and mobile layout', async ({ page }) => {
  await setup(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/auth/sign-up')
    const brand = page.locator('.onboarding__brand')
    await expect(brand).toHaveText('wheretoo')
    await expect(brand).toHaveCSS('font-family', '"Manrope Variable", sans-serif')
    await expect(brand).toHaveCSS('font-size', '30px')
    await expect(brand).toHaveCSS('font-weight', '850')
    await expect(brand).toHaveCSS('letter-spacing', '-2px')
    await expect(brand).toHaveCSS('color', 'rgb(248, 247, 255)')
    await noOverflow(page)
    await capture(page, `onboarding-${width}`)
  }
})
