import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import type { Database, Json } from '../../../src/lib/supabase/database.types'
import { waitForApiJwtAcceptance } from '../../shared/waitForApiJwtAcceptance'
import { isIgnorableBrowserRequestFailure, redactBrowserUrl } from '../../shared/browserEvidence'
import { loadModerationE2EEnv, type ModerationProjectFixture } from './e2eEnv'

const env = loadModerationE2EEnv()

type BrowserClient = SupabaseClient<Database>

export type CreatedOrganizerEvent = {
  eventId: string
  title: string
}

function client() {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function authenticatedClient(email: string, password: string): Promise<BrowserClient> {
  const browserClient = client()
  const signIn = await browserClient.auth.signInWithPassword({ email, password })
  if (signIn.error || !signIn.data.user) throw new Error('Disposable Task 16 sign-in failed.')
  await waitForApiJwtAcceptance(() => browserClient.from('events').select('id').limit(0))
  return browserClient
}

export function moderationFixture(testInfo: TestInfo): ModerationProjectFixture {
  return env.fixtureForProject(testInfo.project.name)
}

export function observeModerationBrowserFailures(page: Page) {
  const failures: string[] = []
  let conflictExpected = false
  let conflictResponses = 0
  let genericBadRequestConsoleErrors = 0
  let staffRoleDenials = 0
  const unexpectedBadRequestPaths: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text().replace(/https?:\/\/[^\s"'<>]+/g, '<redacted-url>')
      if (text === 'Failed to load resource: the server responded with a status of 400 ()') {
        genericBadRequestConsoleErrors += 1
      } else {
        failures.push(`console: ${text}`)
      }
    }
  })
  page.on('response', (response) => {
    if (response.status() === 400) {
      const url = new URL(response.url())
      if (url.pathname.endsWith('/rest/v1/rpc/get_my_staff_role')) {
        staffRoleDenials += 1
      } else if (!(
        conflictExpected
        && url.pathname.endsWith('/rest/v1/rpc/moderate_event')
      )) {
        unexpectedBadRequestPaths.push(url.pathname)
      }
    }
    if (
      conflictExpected
      && response.status() === 400
      && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/moderate_event')
    ) {
      conflictResponses += 1
    }
  })
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'unknown'
    if (!isIgnorableBrowserRequestFailure(request.url(), errorText)) {
      failures.push(`request: ${errorText} ${redactBrowserUrl(request.url())}`)
    }
  })
  const assertNoFailures = () => {
    expect(genericBadRequestConsoleErrors).toBe(staffRoleDenials + conflictResponses)
    if (unexpectedBadRequestPaths.length > 0) {
      failures.push(`response: unexpected HTTP 400 from ${[...new Set(unexpectedBadRequestPaths)].join(', ')}`)
    }
    if (conflictExpected) {
      expect(conflictResponses).toBe(1)
    }
    expect(failures).toEqual([])
  }
  assertNoFailures.expectModerationConflict = () => { conflictExpected = true }
  return assertNoFailures
}

export async function newObservedPage(context: BrowserContext) {
  const page = await context.newPage()
  return {
    page,
    assertNoBrowserFailures: observeModerationBrowserFailures(page),
  }
}

export async function signInThroughUi(page: Page, email: string, password: string) {
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'))
}

function losAngelesWallMinute(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`
}

async function completeDraftLocation(
  fixture: ModerationProjectFixture,
  eventId: string,
  marker: string,
) {
  const organizerClient = await authenticatedClient(fixture.organizer.email, fixture.organizer.password)
  const startsAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1_000)
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1_000)
  const { data, error } = await organizerClient
    .from('events')
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      venue_name: 'Task 16 Civic Hall',
      address_line1: '1 Market Street',
      address_line2: null,
      city: 'San Francisco',
      region: 'CA',
      postal_code: '94105',
      country_code: 'US',
      mapbox_feature_id: `task16.browser.${marker}`,
      latitude: 37.7936,
      longitude: -122.3958,
    })
    .eq('id', eventId)
    .select('id')
    .single()
  if (error || data?.id !== eventId) throw new Error('Disposable owner location completion failed.')
  await organizerClient.auth.signOut({ scope: 'local' })
}

export async function createOrganizerEvent(
  page: Page,
  fixture: ModerationProjectFixture,
  title: string,
  highRisk: boolean,
  stopAtRequirements = false,
): Promise<CreatedOrganizerEvent> {
  await signInThroughUi(page, fixture.organizer.email, fixture.organizer.password)
  await page.goto('/organizer/events/new')
  await expect(page.getByRole('heading', { name: 'Untitled event', level: 1 })).toBeVisible()
  await page.getByLabel('Event title').fill(title)
  await page.getByLabel('Description').fill(
    'A bounded Bay Area event created by the Task 16 moderation browser journey.',
  )
  await page.getByLabel('Category').selectOption('community')
  await page.getByLabel('Free').check()
  await page.getByLabel('Capacity (optional)').fill('40')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page).toHaveURL(/\/organizer\/events\/[0-9a-f-]+\/edit$/)
  const eventId = new URL(page.url()).pathname.split('/').at(-2) ?? ''
  expect(eventId).toMatch(/^[0-9a-f-]{36}$/)

  await completeDraftLocation(fixture, eventId, crypto.randomUUID())
  await page.reload()
  await expect(page.getByLabel('Event title')).toHaveValue(title)
  await page.getByRole('button', { name: 'Continue to date & location' }).click()
  await expect(page.locator('[aria-current="step"]')).toHaveText('Date/location')
  const expectedStartDate = losAngelesWallMinute(new Date(Date.now() + 6 * 24 * 60 * 60 * 1_000)).slice(0, 10)
  await expect(page.getByLabel('Starts')).toHaveValue(new RegExp(`^${expectedStartDate}`), { timeout: 10_000 })
  await expect(page.getByText('Verified address', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to tickets & admission' }).click()
  await expect(page.locator('[aria-current="step"]')).toHaveText('Tickets/admission')
  await page.getByRole('button', { name: 'Continue to event requirements' }).click()
  await expect(page.getByRole('heading', { name: 'Event details and requirements', level: 2 })).toBeVisible()
  await page.getByLabel('Minimum age').selectOption(highRisk ? '18_plus' : 'all_ages')
  if (highRisk) {
    await page.getByRole('group', { name: 'High-risk physical activity' }).getByLabel('Yes').check()
  }
  if (stopAtRequirements) return { eventId, title }
  await continueRequirementsToAgreement(page)
  return { eventId, title }
}

export async function continueRequirementsToAgreement(page: Page) {
  await page.getByRole('button', { name: 'Continue to organizer agreement' }).click()
  await expect(page.getByRole('heading', { name: 'Organizer agreement', level: 2 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Organizer Terms' })).toHaveAttribute('href', '/organizer-terms')
  await expect(page.getByRole('link', { name: 'Event Policy' })).toHaveAttribute('href', '/event-policy')
  await expect(page.getByText('Agreement required for these changes.')).toBeVisible()
}

export async function advanceExistingEditorToAgreement(page: Page) {
  await page.getByRole('button', { name: 'Continue to date & location' }).click()
  await expect(page.locator('[aria-current="step"]')).toHaveText('Date/location')
  await page.getByRole('button', { name: 'Continue to tickets & admission' }).click()
  await page.getByRole('button', { name: 'Continue to event requirements' }).click()
  await expect(page.getByRole('heading', { name: 'Event details and requirements', level: 2 })).toBeVisible()
  await continueRequirementsToAgreement(page)
}

export async function acceptAgreementAndPreview(page: Page, event: CreatedOrganizerEvent) {
  await page.getByRole('checkbox', { name: /I confirm that this event information/ }).check()
  await page.getByRole('button', { name: 'Save agreement and preview' }).click()
  await expect(page).toHaveURL(new RegExp(`/organizer/events/${event.eventId}/preview$`))
  await expect(page.getByRole('heading', { name: 'Preview your event', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: event.title, level: 2 })).toBeVisible()
  await expect(page.getByText('Agreement current for this saved event.')).toBeVisible()
}

export async function publishFromPreview(page: Page, eventId: string) {
  let requestCount = 0
  const observe = (request: { method(): string; url(): string }) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/rpc/publish_event')) requestCount += 1
  }
  page.on('request', observe)
  await page.getByRole('button', { name: /Publish (event|changes)/ }).click()
  await expect(page).toHaveURL(new RegExp(`/organizer/events/${eventId}$`))
  page.off('request', observe)
  expect(requestCount).toBe(1)
}

export async function anonymousPublicEvent(eventId: string): Promise<Json | null> {
  const { data, error } = await client().rpc('get_public_event', { p_event_id: eventId })
  if (error) throw new Error('Anonymous public event projection failed.')
  if (!Array.isArray(data) || data.length > 1) throw new Error('Anonymous public event projection was not bounded.')
  return data[0] ?? null
}

export async function installLocalReportProxy(page: Page, fixture: ModerationProjectFixture) {
  await page.route('**/functions/v1/report-event', async (route) => {
    const response = await page.request.post(env.reportFunctionUrl, {
      data: route.request().postData() ?? '{}',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:3000',
        'x-forwarded-for': fixture.reportClientAddress,
      },
    })
    await route.fulfill({
      status: response.status(),
      headers: { 'content-type': response.headers()['content-type'] ?? 'application/json' },
      body: await response.body(),
    })
  })
}

export async function staffClient(): Promise<BrowserClient> {
  return authenticatedClient(env.staffEmail, env.staffPassword)
}

export async function staffCase(staff: BrowserClient, eventId: string) {
  const { data, error } = await staff.rpc('get_moderation_case', { p_event_id: eventId })
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error('Staff case projection failed.')
  return data[0]!
}

export async function directStaffAction(
  staff: BrowserClient,
  eventId: string,
  action: 'hold' | 'clear' | 'block' | 'remove' | 'restore',
) {
  const current = await staffCase(staff, eventId)
  const { data, error } = await staff.rpc('moderate_event', {
    p_event_id: eventId,
    p_expected_content_revision: current.content_revision,
    p_expected_input_sha256: current.input_sha256,
    p_expected_moderation_version: current.moderation_version,
    p_action: action,
    p_reason_code: action === 'clear' || action === 'restore' ? 'no_violation' : 'unsafe_activity',
    p_internal_note: '',
  })
  if (error || typeof data !== 'string') throw new Error('Disposable staff action failed.')
}

export async function applyStaffAction(
  page: Page,
  eventId: string,
  action: 'Hold' | 'Clear' | 'Block' | 'Remove' | 'Restore',
) {
  await page.goto(`/moderation/events/${eventId}`)
  await expect(page.getByRole('heading', { name: 'Moderation action', level: 2 })).toBeVisible()
  await page.getByRole('radio', { name: action, exact: true }).check()
  await page.getByLabel('Reason').selectOption(action === 'Clear' || action === 'Restore' ? 'no_violation' : 'unsafe_activity')
  await page.getByRole('button', { name: `Apply ${action}` }).click()
  await expect(page.getByRole('status')).toContainText(`${action} recorded.`)
}

export async function signInStaff(page: Page) {
  await signInThroughUi(page, env.staffEmail, env.staffPassword)
  await page.goto('/moderation')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Moderation queue', level: 1 })).toBeVisible()
}

export async function newActorContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext({
    viewport: testInfo.project.use.viewport ?? { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
}

export async function publicMapFixtureRows() {
  const startsAt = new Date(Date.now() - 5 * 60 * 1_000).toISOString()
  const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000 - 5 * 60 * 1_000).toISOString()
  const { data, error } = await client().rpc('get_public_map_events', {
    p_west: -122.45,
    p_south: 37.70,
    p_east: -122.35,
    p_north: 37.84,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  })
  if (error) throw new Error('Anonymous map-safe projection failed.')
  return data
}

export async function assertResponsiveAccessibility(page: Page) {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('main h1:visible')).toHaveCount(1)
  const result = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const controls = [...document.querySelectorAll<HTMLElement>('button, a, input:not([type="radio"]):not([type="checkbox"]), select, textarea')]
      .filter(visible)
      .map((element) => ({ tag: element.tagName, height: element.getBoundingClientRect().height }))
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainCount: [...document.querySelectorAll('main')].filter(visible).length,
      h1Count: [...document.querySelectorAll('h1')].filter(visible).length,
      controls,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      fonts: {
        body: getComputedStyle(document.body).fontFamily,
        heading: document.querySelector('h1') ? getComputedStyle(document.querySelector('h1')!).fontFamily : '',
      },
      canvas: getComputedStyle(document.body).backgroundColor,
    }
  })
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth)
  expect(result.mainCount).toBe(1)
  expect(result.h1Count).toBe(1)
  expect(result.reducedMotion).toBe(true)
  expect(result.fonts.body).toContain('Manrope')
  expect(result.fonts.heading).toContain('Space Grotesk')
  expect(result.canvas).toBe('rgb(247, 247, 251)')
  expect(result.controls.filter((control) => control.tag !== 'A').every((control) => control.height >= 44)).toBe(true)

  const coarsePointer = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  const inspectFocus = () => page.evaluate(() => {
    const selector = 'a[href], button, input, select, textarea'
    const isFocusable = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement) || !element.matches(selector)) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return !element.closest('[inert]')
        && !element.matches(':disabled')
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
    }
    let element = document.activeElement
    if (matchMedia('(pointer: coarse)').matches && !isFocusable(element)) {
      element = [...document.querySelectorAll(selector)].find(isFocusable) ?? null
      ;(element as HTMLElement | null)?.focus()
    }
    if (!isFocusable(element)) return null
    const style = getComputedStyle(element)
    return {
      active: document.activeElement === element,
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
    }
  })

  let focus = await inspectFocus()
  if (!coarsePointer) {
    for (let attempt = 0; attempt < 4 && !focus?.focusVisible; attempt += 1) {
      await page.keyboard.press('Tab')
      focus = await inspectFocus()
    }
  }
  if (focus) {
    expect(focus.active).toBe(true)
    if (!coarsePointer) {
      expect(focus.focusVisible).toBe(true)
      expect(focus.outlineStyle).not.toBe('none')
      expect(focus.outlineWidth).toBeGreaterThan(0)
    }
  }
}

export async function captureModerationState(
  page: Page,
  testInfo: TestInfo,
  state: string,
  mask: ReturnType<Page['locator']>[] = [],
) {
  await assertResponsiveAccessibility(page)
  await page.evaluate(() => document.fonts.ready)
  const screenshotPath = testInfo.outputPath(`${state}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true, mask, maskColor: '#19162c' })
  await testInfo.attach(`${state}-${testInfo.project.name}`, { path: screenshotPath, contentType: 'image/png' })
}
