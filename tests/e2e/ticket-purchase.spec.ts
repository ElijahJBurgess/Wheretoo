import { expect, test } from '@playwright/test'
import {
  assertNoHorizontalOverflow,
  captureTicketingState,
  chooseTwoGeneralAdmissionAndOneVip,
  completeHostedStripeTestPayment,
  deliverAndAssertRealPaidOrder,
  expectMatchingCheckoutAttemptCleared,
  prepareTicketingJourney,
  submitAfterOneAmbiguousResponse,
} from './support/ticketingJourney'

test.describe('native ticket purchase journey', () => {
  test('multi-tier cart keeps a guest safe through hosted Checkout and confirmation lifecycle', async ({ page }, testInfo) => {
    const fixture = await prepareTicketingJourney()

    await page.goto(fixture.publicEventPath)
    await expect(page.getByRole('heading', { name: fixture.title, level: 1 })).toBeVisible()
    await chooseTwoGeneralAdmissionAndOneVip(page)
    await page.getByRole('button', { name: 'Continue to checkout' }).click()
    await expect(page.getByRole('heading', { name: 'Review your tickets', level: 1 })).toBeVisible()
    await expect(page.getByText('Task 17 General Admission')).toBeVisible()
    await expect(page.getByText('2 tickets')).toBeVisible()
    await expect(page.getByText('Task 17 VIP')).toBeVisible()
    await expect(page.getByText('1 ticket')).toBeVisible()
    await expect(page.getByText('$55.00')).toBeVisible()

    await page.getByRole('button', { name: 'Continue to secure payment' }).click()
    await expect(page.getByLabel('Your name')).toBeFocused()
    await expect(page.getByRole('alert')).toContainText('Enter your name')
    await expect(page.getByRole('alert')).toContainText('Enter a valid email address')
    await submitAfterOneAmbiguousResponse(page, fixture)
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//)

    await completeHostedStripeTestPayment(page)
    await expect(page.getByRole('heading', { name: 'Confirming your payment', level: 1 })).toBeVisible()
    await captureTicketingState(page, testInfo, 'payment-processing')
    await deliverAndAssertRealPaidOrder(page, fixture)
    await expect(page.getByRole('heading', { name: "You're all set", level: 1 })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('heading', { name: "You're all set", level: 1 })).toBeVisible()
    await expect(page.getByText('Task 17 General Admission × 2')).toBeVisible()
    await expect(page.getByText('Task 17 VIP × 1')).toBeVisible()
    await expect(page.getByText('$55.00')).toBeVisible()
    await expectMatchingCheckoutAttemptCleared(page)
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
  })
})
