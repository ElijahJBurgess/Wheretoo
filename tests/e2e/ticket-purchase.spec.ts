import { expect, test } from '@playwright/test'
import {
  assertNoHorizontalOverflow,
  captureTicketingState,
  chooseTwoGeneralAdmissionAndOneVip,
  completeHostedStripeTestPayment,
  configureCheckoutTicketTiers,
  controlConfirmationLifecycle,
  prepareTicketingJourney,
  signInCrossUser,
  signInTicketingOrganizer,
  signOutTicketingOrganizer,
  submitAfterOneAmbiguousResponse,
} from './support/ticketingJourney'

test.describe('native ticket purchase journey', () => {
  test('multi-tier cart keeps a guest safe through hosted Checkout and confirmation lifecycle', async ({ page }, testInfo) => {
    const fixture = await prepareTicketingJourney(testInfo.project.name, 'purchase')

    await signInTicketingOrganizer(page, fixture)
    await page.goto('/organizer/settings/payments')
    await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeVisible()
    await expect(page.getByText('Ready for paid sales', { exact: true })).toBeVisible()

    await page.goto(`/organizer/events/${fixture.eventId}/tickets`)
    await expect(page.getByRole('heading', { name: 'Ticket tiers', level: 1 })).toBeVisible()
    await configureCheckoutTicketTiers(page)
    await expect(page.locator('.ticket-tier-card')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Activate paid sales' })).toBeEnabled()
    await page.getByRole('button', { name: 'Activate paid sales' }).click()
    await expect(page).toHaveURL(new RegExp(`/organizer/events/${fixture.eventId}$`))

    await signOutTicketingOrganizer(page)
    await page.goto(fixture.publicEventPath)
    await expect(page.getByRole('heading', { name: fixture.title, level: 1 })).toBeVisible()
    await chooseTwoGeneralAdmissionAndOneVip(page)
    await page.getByRole('button', { name: 'Continue to checkout' }).click()
    await expect(page.getByRole('heading', { name: 'Review your tickets', level: 1 })).toBeVisible()
    await expect(page.getByText('General admission')).toBeVisible()
    await expect(page.getByText('2 tickets')).toBeVisible()
    await expect(page.getByText('VIP')).toBeVisible()
    await expect(page.getByText('1 ticket')).toBeVisible()
    await expect(page.getByText('$67.01')).toBeVisible()

    await page.getByRole('button', { name: 'Continue to secure payment' }).click()
    await expect(page.getByLabel('Your name')).toBeFocused()
    await expect(page.getByRole('alert')).toContainText('Enter your name')
    await expect(page.getByRole('alert')).toContainText('Enter a valid email address')
    await submitAfterOneAmbiguousResponse(page, fixture)
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//)

    const lifecycle = await controlConfirmationLifecycle(page)
    await completeHostedStripeTestPayment(page)
    await expect(page.getByRole('heading', { name: 'Confirming your payment', level: 1 })).toBeVisible()
    await captureTicketingState(page, testInfo, 'payment-processing')
    lifecycle.showRequiresReview()
    await expect(page.getByRole('heading', { name: 'Order needs review', level: 1 })).toBeVisible({ timeout: 5_000 })
    lifecycle.showPaid()
    await page.reload()
    await expect(page.getByRole('heading', { name: "You're all set", level: 1 })).toBeVisible()
    await expect(page.getByText('General admission × 2')).toBeVisible()
    await expect(page.getByText('VIP × 1')).toBeVisible()
    await expect(page.getByText('$67.01')).toBeVisible()
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
    await signInCrossUser(page)
    await page.goto(`/organizer/events/${fixture.eventId}/tickets`)
    await expect(page.getByText('Event not found', { exact: true })).toBeVisible()
  })
})
