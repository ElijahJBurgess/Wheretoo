import { expect, test } from '@playwright/test'
import {
  assertPageContract,
  captureState,
  fillEventDetails,
  fillEventScheduleAndLocation,
  fixtureForProject,
  observeBrowserFailures,
  resetOrganizerForJourney,
  signInThroughUi,
} from './support/organizerJourney'

test.describe('organizer visual contract', () => {
  test('captures every populated organizer state without excluded controls', async ({ page }, testInfo) => {
    const fixture = fixtureForProject(testInfo.project.name)
    const title = `WHERETO_VISUAL_${testInfo.project.name}_${crypto.randomUUID()}`
    const assertNoBrowserFailures = observeBrowserFailures(page)

    await page.goto('/auth/sign-up')
    await page.getByRole('button', { name: 'Create organizer account' }).click()
    await expect(page.getByText('Check the highlighted fields')).toBeVisible()
    await expect(page.getByLabel('Full name')).toBeFocused()
    await page.getByLabel('Full name').fill('Avery Rivera')
    await page.getByLabel('Email').fill('avery.visual@example.com')
    await page.getByLabel('Password').fill('not-a-real-credential')
    await captureState(page, testInfo, 'signup', 'Create organizer account')

    await resetOrganizerForJourney(fixture)
    await signInThroughUi(page, fixture)
    await page.getByLabel('Public organizer name').fill(fixture.displayName)
    await page.getByLabel('Organizer type').selectOption('Community group')
    await page.getByLabel('Short description').fill('A neighborhood organizer making room for real plans.')
    await page.getByLabel('Base city').fill('San Francisco')
    await captureState(page, testInfo, 'setup', 'Tell us about your organization')
    await page.getByRole('button', { name: 'Save organizer profile' }).click()
    await expect(page).toHaveURL(/\/organizer\/events$/)

    await page.getByRole('link', { name: 'Create event' }).click()
    await fillEventDetails(page, title)
    await assertPageContract(page, title, 'Details')
    await captureState(page, testInfo, 'details', title)

    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page).toHaveURL(/\/organizer\/events\/[0-9a-f-]+\/edit$/)
    await page.getByRole('button', { name: 'Continue to schedule' }).click()
    await fillEventScheduleAndLocation(page)
    await assertPageContract(page, title, 'Schedule & location')
    await captureState(page, testInfo, 'schedule', title)

    await page.getByRole('button', { name: 'Continue to review' }).click()
    await assertPageContract(page, title, 'Review')
    await captureState(page, testInfo, 'review', title)

    await page.getByRole('button', { name: 'Preview event' }).click()
    await expect(page.getByRole('heading', { name: 'Preview your event', level: 1 })).toBeVisible()
    await captureState(page, testInfo, 'preview', 'Preview your event')

    await page.getByRole('button', { name: 'Publish event' }).click()
    await expect(page.getByText('This event is publicly available.', { exact: true })).toBeVisible()
    await captureState(page, testInfo, 'published', 'Published')
    assertNoBrowserFailures()
  })
})
