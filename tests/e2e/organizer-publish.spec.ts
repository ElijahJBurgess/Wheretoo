import { expect, test } from '@playwright/test'
import {
  anonymousEventById,
  assertPageContract,
  completeOrganizerSetup,
  fillEventDetails,
  fillEventScheduleAndLocation,
  fixtureForProject,
  observeBrowserFailures,
  resetOrganizerForJourney,
  signInThroughUi,
} from './support/organizerJourney'

test.describe('organizer publishing journey', () => {
  test('persists, reloads, previews, and immediately publishes one real event', async ({
    page,
  }, testInfo) => {
    const fixture = fixtureForProject(testInfo.project.name)
    const title = `WHERETO_DAY1_E2E_${testInfo.project.name}_${crypto.randomUUID()}`
    const assertNoBrowserFailures = observeBrowserFailures(page)

    await resetOrganizerForJourney(fixture)
    await signInThroughUi(page, fixture)
    await completeOrganizerSetup(page, fixture)

    await page.getByRole('link', { name: 'Create event' }).click()
    await expect(page).toHaveURL(/\/organizer\/events\/new$/)
    await assertPageContract(page, 'Untitled event', 'Details')

    await fillEventDetails(page, title)
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page).toHaveURL(/\/organizer\/events\/[0-9a-f-]+\/edit$/)
    const editUrl = page.url()

    await page.reload()
    await expect(page).toHaveURL(editUrl)
    await expect(page.getByLabel('Event title')).toHaveValue(title)
    await expect(page.getByLabel('Description')).toHaveValue(
      'A real Bay Area gathering created by the Whereto Day 1 browser journey.',
    )
    await expect(page.getByLabel('Category')).toHaveValue('community')
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Continue to schedule' }).click()
    await assertPageContract(page, title, 'Schedule & location')
    await fillEventScheduleAndLocation(page)
    await page.getByRole('button', { name: 'Continue to review' }).click()
    await assertPageContract(page, title, 'Review')

    await page.getByRole('button', { name: 'Preview event' }).click()
    await expect(page).toHaveURL(/\/organizer\/events\/[0-9a-f-]+\/preview$/)
    await expect(page.getByRole('heading', { name: 'Preview your event', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()
    await expect(page.getByText('Whereto Day 1 Venue')).toBeVisible()
    await expect(page.getByText(/1 Market St/i)).toBeVisible()

    const eventId = new URL(page.url()).pathname.split('/').at(-2)
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/)
    let publishRequestCount = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/rpc/publish_event')) {
        publishRequestCount += 1
      }
    })

    await page.getByRole('button', { name: 'Publish event' }).click()
    await expect(page).toHaveURL(new RegExp(`/organizer/events/${eventId}$`))
    await expect(page.getByRole('heading', { name: 'Published', level: 1 })).toBeVisible()
    await expect(page.getByText('This event is publicly available.', { exact: true })).toBeVisible()
    expect(publishRequestCount).toBe(1)

    const publicEvent = await anonymousEventById(eventId!)
    expect(publicEvent).toMatchObject({ id: eventId, status: 'published', title })

    await page.reload()
    await expect(page.getByText('This event is publicly available.', { exact: true })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/organizer/events/${eventId}$`))
    assertNoBrowserFailures()
  })
})
