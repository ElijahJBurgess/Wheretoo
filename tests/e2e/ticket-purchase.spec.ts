import { expect, test } from '@playwright/test'
import {
  assertNoHorizontalOverflow,
  captureTicketingState,
  completeHostedStripeTestPayment,
  configureThreeTicketTiers,
  deliverCheckoutWebhook,
  prepareTicketingJourney,
  signInCrossUser,
  signInTicketingOrganizer,
  signOutTicketingOrganizer,
} from './support/ticketingJourney'

test.describe('native ticket purchase journey', () => {
  test('organizer activates three paid tiers and a guest receives one persisted ticket', async ({ page }, testInfo) => {
    const fixture = await prepareTicketingJourney(testInfo.project.name, 'purchase')

    await signInTicketingOrganizer(page, fixture)
    await page.goto('/organizer/settings/payments')
    await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeVisible()
    await expect(page.getByText('Ready for paid sales', { exact: true })).toBeVisible()

    await page.goto(`/organizer/events/${fixture.eventId}/tickets`)
    await expect(page.getByRole('heading', { name: 'Ticket tiers', level: 1 })).toBeVisible()
    await configureThreeTicketTiers(page)
    await expect(page.locator('.ticket-tier-card')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Activate paid sales' })).toBeEnabled()
    await page.getByRole('button', { name: 'Activate paid sales' }).click()
    await expect(page).toHaveURL(new RegExp(`/organizer/events/${fixture.eventId}$`))

    await signOutTicketingOrganizer(page)
    await page.goto(fixture.publicEventPath)
    await expect(page.getByRole('heading', { name: fixture.title, level: 1 })).toBeVisible()
    await expect(page.getByRole('radio')).toHaveCount(3)
    await page.locator('input[type="radio"]:enabled').first().check()
    await page.getByRole('button', { name: 'Continue to checkout' }).click()
    await expect(page.getByRole('heading', { name: 'Review your ticket', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Continue to secure payment' }).click()
    await expect(page.getByLabel('Your name')).toBeFocused()
    await page.getByLabel('Your name').fill('Task Eighteen Guest')
    await page.getByLabel('Email address').fill(fixture.buyerEmail)
    await page.getByRole('button', { name: 'Continue to secure payment' }).click()
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//)

    await completeHostedStripeTestPayment(page)
    await expect(page.getByRole('heading', { name: /Confirming your payment|You're all set/, level: 1 })).toBeVisible()
    await captureTicketingState(page, testInfo, 'payment-processing')
    await deliverCheckoutWebhook(fixture)
    await expect(page.getByRole('heading', { name: "You're all set", level: 1 })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: "You're all set", level: 1 })).toBeVisible()
    await captureTicketingState(page, testInfo, 'ticket-confirmation')

    if (testInfo.project.name === 'mobile-chromium') {
      const orderRow = page.locator('.confirmation-card__facts div').filter({ hasText: 'Order' })
      const labelBox = await orderRow.locator('dt').boundingBox()
      const valueBox = await orderRow.locator('dd').boundingBox()
      expect(labelBox).not.toBeNull()
      expect(valueBox).not.toBeNull()
      expect(valueBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height)
      const orderValueLineCount = await orderRow.locator('dd').evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.y))).size
      })
      expect(orderValueLineCount).toBe(1)
    }

    await assertNoHorizontalOverflow(page)
    await page.goto(fixture.publicEventPath)
    await expect(page.getByRole('radio').first()).toBeDisabled()
    await expect(page.getByText('Sold out', { exact: true }).first()).toBeVisible()
    await expect(page.locator('input[type="radio"]:enabled')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeDisabled()
    await assertNoHorizontalOverflow(page)

    await signInCrossUser(page)
    await page.goto(`/organizer/events/${fixture.eventId}/tickets`)
    await expect(page.getByText('Event not found', { exact: true })).toBeVisible()
  })
})
