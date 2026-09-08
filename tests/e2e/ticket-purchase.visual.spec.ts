import { expect, test } from '@playwright/test'
import {
  assertNoHorizontalOverflow,
  assertTicketingAccessibilitySmoke,
  captureTicketingState,
  chooseTwoGeneralAdmissionAndOneVip,
  prepareTicketingJourney,
} from './support/ticketingJourney'

test('captures deliberate application-only ticketing states', async ({ page }, testInfo) => {
  const fixture = await prepareTicketingJourney()

  await page.goto(fixture.publicEventPath)
  await expect(page.getByRole('heading', { name: fixture.title, level: 1 })).toBeVisible()
  await assertTicketingAccessibilitySmoke(page)
  await captureTicketingState(page, testInfo, 'public-ticket-selection')
  await chooseTwoGeneralAdmissionAndOneVip(page)
  await page.getByRole('button', { name: 'Continue to checkout' }).click()
  await expect(page.getByRole('heading', { name: 'Review your tickets', level: 1 })).toBeVisible()
  await assertTicketingAccessibilitySmoke(page)
  await captureTicketingState(page, testInfo, 'guest-checkout')

  await assertNoHorizontalOverflow(page)
})
