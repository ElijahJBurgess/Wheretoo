import { expect, test } from '@playwright/test'
import {
  assertNoHorizontalOverflow,
  assertTicketingAccessibilitySmoke,
  captureTicketingState,
  configureThreeTicketTiers,
  prepareTicketingJourney,
  signInTicketingOrganizer,
  signOutTicketingOrganizer,
} from './support/ticketingJourney'

test('captures deliberate application-only ticketing states', async ({ page }, testInfo) => {
  const fixture = await prepareTicketingJourney(testInfo.project.name, 'visual')

  await signInTicketingOrganizer(page, fixture)
  await page.goto('/organizer/settings/payments')
  await expect(page.getByText('Ready for paid sales', { exact: true })).toBeVisible()
  await assertTicketingAccessibilitySmoke(page)
  await captureTicketingState(page, testInfo, 'payments-ready')

  await page.goto(`/organizer/events/${fixture.eventId}/tickets`)
  await configureThreeTicketTiers(page)
  await expect(page.locator('.ticket-tier-card')).toHaveCount(3)
  await expect(page.getByText('Ticket sales will be available as soon as this eligible event is activated.', { exact: true })).toBeVisible()
  await assertTicketingAccessibilitySmoke(page)
  await captureTicketingState(page, testInfo, 'ticket-tiers')
  await page.getByRole('button', { name: 'Activate paid sales' }).click()
  await expect(page).toHaveURL(new RegExp(`/organizer/events/${fixture.eventId}$`))

  await signOutTicketingOrganizer(page)
  await page.goto(fixture.publicEventPath)
  await expect(page.getByRole('heading', { name: fixture.title, level: 1 })).toBeVisible()
  await assertTicketingAccessibilitySmoke(page)
  await captureTicketingState(page, testInfo, 'public-ticket-selection')
  await page.locator('input[type="radio"]:enabled').first().check()
  await page.getByRole('button', { name: 'Continue to checkout' }).click()
  await assertTicketingAccessibilitySmoke(page)
  await captureTicketingState(page, testInfo, 'guest-checkout')

  await assertNoHorizontalOverflow(page)
})
