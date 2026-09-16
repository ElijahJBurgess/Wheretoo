import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const service = 'https://spec13-local.supabase.co'
const freeId = 'e1310000-0000-4000-8000-000000000001'
const paidId = 'e1310000-0000-4000-8000-000000000002'
const captureDir = '.superpowers/spec13/visual'

test.beforeAll(() => {
  // Identity/name/label/loopback ports are checked again inside every SQL RPC.
  execFileSync('python3', ['tests/integration/spec13-services.py'], { stdio: 'pipe' })
  mkdirSync(captureDir, { recursive: true })
})
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }) })

async function connectDisposable(page: Page) {
  const calls: string[] = []
  await page.route(`${service}/**`, async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const allowed = new Set(['/functions/v1/public-discovery', '/rest/v1/rpc/get_public_event', '/rest/v1/rpc/get_public_event_ticketing', '/rest/v1/rpc/get_public_free_rsvp', '/functions/v1/free-rsvp', '/functions/v1/free-rsvp-status', '/functions/v1/ticket-collection'])
    calls.push(path)
    if (!allowed.has(path)) { await route.abort('blockedbyclient'); return }
    const response = await page.request.fetch(`http://127.0.0.1:55567${path}`, {
      method: request.method(), data: request.postData() ?? undefined,
      headers: {
        'content-type': 'application/json', Origin: 'http://127.0.0.1:3033',
        ...(request.headers()['x-whereto-confirmation-bearer'] ? { 'x-whereto-confirmation-bearer': request.headers()['x-whereto-confirmation-bearer'] } : {}),
      },
    })
    // The isolated build is served on 3034; its loopback transport accepts 3033.
    // Map only this test origin while retaining the actual handler body/status.
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': 'http://127.0.0.1:3034' } })
  })
  return calls
}

test('anonymous production entry, bounded paging, Back restoration, reload, AND filters and safe organizer entry', async ({ page }) => {
  const calls = await connectDisposable(page)
  const modules: string[] = []
  page.on('request', request => { if (request.resourceType() === 'script') modules.push(request.url()) })
  await page.goto('/?ticket=discarded#discarded')
  await expect(page).toHaveURL('/discover')
  await expect(page.locator('.discovery-event-row')).toHaveCount(20)
  expect(calls).toEqual(['/functions/v1/public-discovery'])
  expect(modules.filter(url => /TicketCollection|Scanner|cameraDecoder|mapbox|stripe|ConnectEmbedded/i.test(url))).toEqual([])
  await expect(page.locator('.discovery-hero')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Tickets', exact: true })).toHaveCount(0)
  await page.screenshot({ path: `${captureDir}/live-390.png` })
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.locator('.discovery-event-row')).toHaveCount(40)
  const ids = await page.locator('.discovery-event-row a').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(new Set(ids).size).toBe(40)
  const target = page.locator('.discovery-event-row a').nth(23)
  await target.scrollIntoViewIfNeeded()
  const scroll = await page.evaluate(() => scrollY)
  await target.click()
  await expect(page).toHaveURL(/\/events\/[a-f0-9-]+$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Local discovery proof')
  await page.goBack()
  await expect(page.locator('.discovery-event-row')).toHaveCount(40)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll - 10)
  expect(calls.filter(path => path === '/functions/v1/public-discovery')).toHaveLength(2)
  await page.reload()
  await expect(page.locator('.discovery-event-row')).toHaveCount(20)
  expect(calls.filter(path => path === '/functions/v1/public-discovery')).toHaveLength(3)
  await page.getByRole('button', { name: 'Music', exact: true }).click()
  await page.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(page).toHaveURL('/discover?category=music&price=paid')
  await expect(page.locator('.discovery-event-row')).toHaveCount(8)
  await expect(page.locator('.discovery-event-row__category').first()).toHaveText('Music')
  await expect(page.locator('.discovery-admission').first()).toHaveText('View prices')
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page).toHaveURL('/discover')
  await expect(page.locator('.discovery-event-row')).toHaveCount(20)
  await page.getByRole('link', { name: 'Organize', exact: true }).click()
  await expect(page).toHaveURL('/auth/sign-in')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('uses corrected public paid/free readers and the existing real RSVP through private ticket collection', async ({ page }) => {
  const calls = await connectDisposable(page)
  await page.goto('/discover?price=paid')
  await expect(page.locator('.discovery-event-row')).toHaveCount(20)
  await page.locator(`a[href='/events/${paidId}']`).click()
  await expect(page.getByRole('link', { name: 'Get tickets', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Get tickets', exact: true }).click()
  await expect(page).toHaveURL(`/events/${paidId}/tickets`)
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeDisabled()
  await expect(page.getByRole('spinbutton').first()).toBeVisible()
  await page.goto('/discover?price=free')
  await expect(page.locator('.discovery-event-row')).toHaveCount(20)
  await page.locator(`a[href='/events/${freeId}']`).click()
  await expect(page.getByRole('heading', { name: 'Free RSVP', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(0)
  await page.getByRole('link', { name: 'RSVP for free', exact: true }).click()
  await expect(page).toHaveURL(`/events/${freeId}/rsvp`)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Full name').fill('Local Discovery Proof')
  await page.getByLabel('Email address').fill('spec13-browser@example.invalid')
  await page.getByRole('button', { name: 'Confirm RSVP', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You’re on the list' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse events', exact: true })).toHaveAttribute('href', '/discover')
  await page.getByRole('link', { name: 'View ticket', exact: true }).click()
  // The inherited collection opens a single admission directly in focused view.
  await expect(page.getByRole('heading', { name: 'Ticket 1', exact: true })).toBeVisible()
  await expect(page.getByLabel('Admission QR code', { exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Public navigation' })).toHaveCount(0)
  expect(calls.filter(path => path === '/functions/v1/free-rsvp')).toHaveLength(1)
  // The corrected strict paid/free union can accept a canonical free shell
  // directly; the fallback RPC is covered separately when that shell is absent.
  expect(calls).toContain('/rest/v1/rpc/get_public_free_rsvp')
  expect(calls).toContain('/rest/v1/rpc/get_public_event_ticketing')
})

test('renders isolated visual states and responsive layouts with zero service calls', async ({ page }) => {
  const calls = await connectDisposable(page)
  for (const width of [320, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/preview/discovery')
    await expect(page.getByRole('heading', { name: 'Sunset Rooftop Sessions', exact: true })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    const dateRows = await page.getByRole('group', { name: 'Date', exact: true }).locator('button').evaluateAll(buttons => new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size)
    expect(dateRows).toBe(1)
    await page.locator('.discovery-page').screenshot({ path: `${captureDir}/preview-${width}.png` })
    // Admission labels must occupy their own space, including the long-title row.
    const overlaps = await page.locator('.discovery-event-row').evaluateAll(rows => rows.filter(row => {
      const label = row.querySelector('.discovery-admission')?.getBoundingClientRect()
      const title = row.querySelector('strong')?.getBoundingClientRect()
      const schedule = row.querySelector('.discovery-event-schedule')?.getBoundingClientRect()
      return label && [title, schedule].some(rect => rect && label.left < rect.right && label.right > rect.left && label.top < rect.bottom && label.bottom > rect.top)
    }).length)
    expect(overlaps).toBe(0)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [button, text] of [['Loading', 'Loading events'], ['Empty', 'No upcoming events here yet.'], ['Rate limited', 'We couldn’t load events.'], ['Malformed mix', '2 events could not be shown.']] as const) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await expect(page.getByText(text, { exact: true })).toBeVisible()
    await page.locator('.discovery-page').screenshot({ path: `${captureDir}/state-${button.toLowerCase().replaceAll(' ', '-')}.png` })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Loading', exact: true }).click()
  expect(await page.locator('.discovery-skeletons i').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  expect(calls).toEqual([])
})

test('keeps keyboard controls, enlarged text and the last event usable above mobile navigation', async ({ page }) => {
  const calls = await connectDisposable(page)
  await page.goto('/preview/discovery')
  const today = page.getByRole('button', { name: 'Today', exact: true })
  await page.getByRole('button', { name: 'Upcoming', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(today).toBeFocused()
  await page.keyboard.press('Space')
  await expect(today).toHaveAttribute('aria-pressed', 'true')
  await expect(today).toBeFocused()
  expect(await today.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
  await page.getByRole('button', { name: 'Food & Drink', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Free', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Public navigation' })).toHaveCount(1)
  const shortTargets = await page.locator('.discovery-page :is(button,a)').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height < 44).map(element => element.textContent))
  expect(shortTargets).toEqual([])

  await page.evaluate(() => {
    // Text-only resizing: snapshot before changing any inherited font sizes.
    const sizes = Array.from(document.querySelectorAll<HTMLElement>('.discovery-page *'), element => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }))
    for (const { element, size } of sizes) element.style.fontSize = `${size * 2}px`
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.locator('.discovery-page').screenshot({ path: `${captureDir}/text-200.png` })
  await page.locator('.discovery-event-row').last().scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const lastBottom = await page.locator('.discovery-event-row').last().evaluate(element => element.getBoundingClientRect().bottom)
  const navTop = await page.getByRole('navigation', { name: 'Public navigation' }).evaluate(element => element.getBoundingClientRect().top)
  expect(lastBottom).toBeLessThan(navTop)
  await page.screenshot({ path: `${captureDir}/text-200-last-event.png` })
  expect(calls).toEqual([])
})
