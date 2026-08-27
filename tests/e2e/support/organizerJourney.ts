import { createClient } from '@supabase/supabase-js'
import { expect, type Page, type TestInfo } from '@playwright/test'
import type { Database } from '../../../src/lib/supabase/database.types'
import { waitForApiJwtAcceptance } from '../../shared/waitForApiJwtAcceptance'
import { isIgnorableBrowserRequestFailure, redactBrowserUrl } from '../../shared/browserEvidence'
import { loadE2EEnv } from './e2eEnv'

const env = loadE2EEnv()

export type OrganizerFixture = {
  email: string
  password: string
  displayName: string
}

export function observeBrowserFailures(page: Page) {
  const failures: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      failures.push(`console: ${message.text().replace(/https?:\/\/[^\s"'<>]+/g, '<redacted-url>')}`)
    }
  })
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'unknown'
    if (!isIgnorableBrowserRequestFailure(request.url(), errorText)) {
      failures.push(`request: ${errorText} ${redactBrowserUrl(request.url())}`)
    }
  })
  return () => expect(failures).toEqual([])
}

function browserClient() {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export function fixtureForProject(projectName: string): OrganizerFixture {
  if (projectName === 'mobile-chromium') {
    return {
      email: env.organizerAEmail,
      password: env.organizerAPassword,
      displayName: 'Whereto Mobile Test Organizer',
    }
  }
  if (projectName === 'desktop-chromium') {
    return {
      email: env.organizerBEmail,
      password: env.organizerBPassword,
      displayName: 'Whereto Desktop Test Organizer',
    }
  }
  throw new Error(`No disposable organizer mapping exists for Playwright project: ${projectName}`)
}

export async function resetOrganizerForJourney(fixture: OrganizerFixture) {
  const client = browserClient()
  const signIn = await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password })
  if (signIn.error || !signIn.data.user) throw new Error('Disposable organizer reset sign-in failed.')
  await waitForApiJwtAcceptance(() => client.from('organizers').select('id').limit(0))

  const existing = await client.from('organizers').select('id').eq('id', signIn.data.user.id).maybeSingle()
  if (existing.error) throw new Error('Disposable organizer reset lookup failed.')
  if (existing.data) {
    const reset = await client
      .from('organizers')
      .update({ onboarding_completed_at: null })
      .eq('id', signIn.data.user.id)
    if (reset.error) throw new Error('Disposable organizer onboarding reset failed.')
  }
  await client.auth.signOut()
}

export async function signInThroughUi(page: Page, fixture: OrganizerFixture) {
  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(fixture.email)
  await page.getByLabel('Password').fill(fixture.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'))
}

export async function completeOrganizerSetup(page: Page, fixture: OrganizerFixture) {
  await expect(page.getByRole('heading', { name: 'Tell us about your organization', level: 1 })).toBeVisible()
  await page.getByLabel('Public organizer name').fill(fixture.displayName)
  await page.getByLabel('Organizer type').selectOption('Community group')
  await page.getByLabel('Short description').fill('A disposable organizer used for the Day 1 browser journey.')
  await page.getByLabel('Base city').fill('San Francisco')
  await page.getByRole('button', { name: 'Save organizer profile' }).click()
  await expect(page).toHaveURL(/\/organizer\/events$/)
}

export async function fillEventDetails(page: Page, title: string) {
  await page.getByLabel('Event title').fill(title)
  await page
    .getByLabel('Description')
    .fill('A real Bay Area gathering created by the Whereto Day 1 browser journey.')
  await page.getByLabel('Category').selectOption('community')
  await page.getByLabel('Free').check()
  await page.getByLabel('Capacity (optional)').fill('40')
}

function losAngelesWallMinute(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`
}

export async function fillEventScheduleAndLocation(page: Page) {
  const starts = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000)
  const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1_000)
  await page.getByLabel('Starts').fill(losAngelesWallMinute(starts))
  await page.getByLabel('Ends').fill(losAngelesWallMinute(ends))
  await page.getByLabel('Venue name').fill('Whereto Day 1 Venue')

  const address = page.getByLabel('Search for a California address')
  await address.fill('1 Market Street, San Francisco, CA')
  const suggestion = page.getByRole('option').filter({ hasText: /1 Market/i }).first()
  await expect(suggestion).toBeVisible({ timeout: 20_000 })
  await suggestion.click()
  await expect(page.getByText('Verified address', { exact: true })).toBeVisible()
  await expect(page.locator('.location-search-field__verified').getByText(/San Francisco, CA/i)).toBeVisible()
}

export async function anonymousEventById(eventId: string) {
  const client = browserClient()
  const result = await client.from('events').select('id, status, title').eq('id', eventId).single()
  if (result.error) throw new Error('Anonymous exact-event visibility check failed.')
  return result.data
}

const forbiddenControlCopy = /checkout|ticket|QR|AI flyer|analytics|payout|moderation/i

export async function assertPageContract(
  page: Page,
  h1: string,
  currentStep?: string,
  requirePrimary = true,
  allowedControlCopy?: RegExp,
) {
  await expect(page.getByRole('heading', { name: h1, level: 1 })).toBeVisible()
  if (currentStep) {
    await expect(page.locator('[aria-current="step"]')).toHaveText(currentStep)
  }

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    metaViewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
  }))
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
  expect(geometry.metaViewport).toContain('width=device-width')

  const primary = page.locator('.ui-button--primary:visible')
  await expect(primary).toHaveCount(requirePrimary ? 1 : 0)
  if (requirePrimary) {
    const primaryBox = await primary.boundingBox()
    expect(primaryBox?.height).toBeGreaterThanOrEqual(44)
    if (await primary.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press('Shift+Tab')
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await primary.evaluate((element) => element === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(primary).toBeFocused()
    const focus = await primary.evaluate((element) => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) }
    })
    expect(focus.outlineStyle).not.toBe('none')
    expect(focus.outlineWidth).toBeGreaterThan(0)
  }

  const keyTargets = page.locator(
    '.ui-button:visible, .ui-field input:visible, .ui-field select:visible, .ui-field textarea:visible',
  )
  const targetBoxes = await keyTargets.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  )
  expect(targetBoxes.length).toBeGreaterThan(0)
  expect(targetBoxes.every((height) => height >= 44)).toBe(true)

  const excludedControls = await page.getByRole('button').allTextContents()
  const excludedLinks = await page.getByRole('link').allTextContents()
  expect(
    [...excludedControls, ...excludedLinks].filter(
      (copy) => forbiddenControlCopy.test(copy) && !allowedControlCopy?.test(copy),
    ),
  ).toEqual([])
}

export async function captureState(page: Page, testInfo: TestInfo, state: string, h1: string) {
  await assertPageContract(
    page,
    h1,
    state === 'details' ? 'Details' : state === 'schedule' ? 'Schedule & location' : state === 'review' ? 'Review' : undefined,
    true,
    state === 'published' ? /ticket/i : undefined,
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => document.fonts.ready)
  const screenshotPath = testInfo.outputPath(`${state}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach(`${state}-${testInfo.project.name}`, { path: screenshotPath, contentType: 'image/png' })
}
