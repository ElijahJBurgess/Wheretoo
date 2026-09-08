import { expect, test, type Page } from '@playwright/test'
import {
  captureSafeScreenshot,
  type DiagnosticWatch,
  gotoReadyScanner,
  submitDevelopmentCredential,
  watchTicketExperienceDiagnostics,
} from './support/ticketExperienceJourney'

const diagnosticWatches = new WeakMap<Page, DiagnosticWatch>()

test('existing organizer mobile navigation remains contained', async ({ page }, testInfo) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/tickets/wh_test_collection_unavailable')
    await expect(page.getByText('Tickets unavailable', { exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const modulePath = '/tests/e2e/support/organizerLayoutProof.ts'
      const module = await import(/* @vite-ignore */ modulePath)
      module.renderOrganizerLayoutProof()
    })
    await expect(page.getByRole('navigation', { name: 'Organizer' })).toBeVisible()
    const layout = await page.locator('.organizer-layout__nav').evaluate((element) => ({
      justifyContent: getComputedStyle(element).justifyContent,
      right: element.getBoundingClientRect().right,
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }))
    expect(layout.justifyContent).toBe('flex-start')
    expect(layout.right).toBeLessThanOrEqual(layout.width)
    expect(layout.overflow).toBe(false)
    await captureSafeScreenshot(page, testInfo, `organizer-navigation-${width}`)
  }
})

test.beforeEach(async ({ page }) => {
  diagnosticWatches.set(page, watchTicketExperienceDiagnostics(page))
})

test.afterEach(async ({ page }) => {
  diagnosticWatches.get(page)?.assertSafe()
})

test('paid collection supports overview, deep focus, history, and one mounted QR', async ({ page }) => {
  await page.goto('/tickets/wh_test_collection_paid_multi')
  await expect(page.getByRole('heading', { name: 'Your tickets' })).toBeVisible()
  await expect(page.getByTestId('admission-qr')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Ticket 1, General Admission, Valid/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Ticket 2, General Admission, Valid/ })).toBeVisible()

  await page.evaluate(() => {
    const state = { maximum: document.querySelectorAll('[data-testid="admission-qr"]').length }
    Object.assign(window, { __ticketQrMountState: state })
    new MutationObserver(() => {
      state.maximum = Math.max(state.maximum, document.querySelectorAll('[data-testid="admission-qr"]').length)
    }).observe(document.body, { childList: true, subtree: true })
  })

  await page.getByRole('link', { name: /Ticket 1, General Admission, Valid/ }).click()
  await expect(page.getByRole('heading', { name: 'Ticket 1' })).toBeVisible()
  await expect(page.getByTestId('admission-qr')).toHaveCount(1)
  await expect(page.getByRole('status')).toContainText('Ticket 1 of 2')

  await page.getByRole('button', { name: 'Next ticket' }).click()
  await expect(page.getByRole('heading', { name: 'Ticket 2' })).toBeFocused()
  await expect(page.getByTestId('admission-qr')).toHaveCount(1)
  await expect(page.getByRole('status')).toContainText('Ticket 2 of 2')

  await page.getByRole('button', { name: 'Previous ticket' }).click()
  await expect(page.getByRole('heading', { name: 'Ticket 1' })).toBeFocused()
  await expect(page.getByTestId('admission-qr')).toHaveCount(1)
  await page.getByRole('button', { name: 'Next ticket' }).click()
  await expect(page.getByRole('heading', { name: 'Ticket 2' })).toBeFocused()
  expect(await page.evaluate(() => (window as unknown as { __ticketQrMountState: { maximum: number } }).__ticketQrMountState.maximum)).toBe(1)

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Ticket 1' })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { name: 'Ticket 2' })).toBeVisible()
  await page.goto('/tickets/wh_test_collection_paid_multi/not-in-this-collection')
  await expect(page.getByRole('heading', { name: 'Your tickets' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Ticket 1, General Admission, Valid/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Ticket 2, General Admission, Valid/ })).toBeVisible()
  await expect(page.getByTestId('admission-qr')).toHaveCount(0)
})

test('free RSVP opens directly in the same focused ticket UI', async ({ page }) => {
  await page.goto('/tickets/wh_test_collection_rsvp')
  await expect(page.getByRole('heading', { name: 'Ticket 1' })).toBeVisible()
  await expect(page.getByText('Free RSVP', { exact: true })).toBeVisible()
  await expect(page.locator('.ticket-status')).toContainText('Valid')
  await expect(page.getByTestId('admission-qr')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Previous|Next/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Get directions' })).toHaveAttribute('rel', 'noreferrer')
})

for (const [collection, status] of [
  ['wh_test_collection_used', 'Already used'],
  ['wh_test_collection_refunded', 'Refunded'],
  ['wh_test_collection_cancelled', 'Cancelled'],
  ['wh_test_collection_ended', 'Event ended'],
] as const) {
  test(`${collection} is visibly inactive and never mounts a QR`, async ({ page }) => {
    await page.goto(`/tickets/${collection}`)
    await expect(page.getByText(status, { exact: true }).first()).toBeVisible()
    await expect(page.getByTestId('admission-qr')).toHaveCount(0)
  })
}

for (const [collection, title] of [
  ['wh_test_collection_empty', 'No tickets available'],
  ['wh_test_collection_unavailable', 'Tickets unavailable'],
  ['wh_test_collection_not_enabled', 'Ticket experience not enabled'],
  ['wh_test_collection_error', 'Tickets unavailable'],
] as const) {
  test(`${collection} renders deliberate recovery`, async ({ page }) => {
    await page.goto(`/tickets/${collection}`)
    await expect(page.getByText(title, { exact: true })).toBeVisible()
    await expect(page.getByTestId('admission-qr')).toHaveCount(0)
  })
}

test('loading collection remains an explicit loading state', async ({ page }) => {
  await page.goto('/tickets/wh_test_collection_loading')
  await expect(page.getByText('Loading tickets', { exact: true })).toBeVisible()
})

test('development dashboard exposes the event command-center actions', async ({ page }) => {
  await page.goto('/__dev/ticket-shells/events/event-a/dashboard')
  await expect(page.getByText('Demo data', { exact: true })).toBeVisible()
  await expect(page.getByText('Ticket units sold', { exact: true })).toBeVisible()
  await expect(page.getByText('Gross sales', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'View attendees — Coming later' })).toBeDisabled()
  await page.getByRole('link', { name: 'Check in guests' }).click()
  await expect(page).toHaveURL(/\/__dev\/ticket-shells\/events\/event-a\/check-in\/ready$/)
  await expect(page.getByRole('heading', { name: 'Ready to scan' })).toBeVisible()

  await page.goto('/__dev/ticket-shells/events/event-unavailable/dashboard')
  await expect(page.getByText('Event dashboard unavailable', { exact: true })).toBeVisible()
})

for (const [credential, heading] of [
  ['wh_test_admit_paid_valid', 'Admitted'],
  ['wh_test_admit_rsvp_valid', 'Admitted'],
  ['wh_test_admit_already_used', 'Already used'],
  ['wh_test_admit_refunded', 'Refunded'],
  ['wh_test_admit_cancelled', 'Cancelled'],
  ['wh_test_admit_invalid', 'Invalid ticket'],
] as const) {
  test(`scanner shows stable ${credential} outcome and waits for Scan next ticket`, async ({ page }) => {
    await gotoReadyScanner(page)
    await submitDevelopmentCredential(page, credential)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Scan next ticket' })).toBeVisible()
    await page.waitForTimeout(100)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await page.getByRole('button', { name: 'Scan next ticket' }).click()
    await expect(page.getByRole('heading', { name: 'Ready to scan' })).toBeVisible()
  })
}

test('scanner reports wrong event without exposing the credential', async ({ page }) => {
  await gotoReadyScanner(page, 'event-unavailable')
  await submitDevelopmentCredential(page, 'wh_test_admit_paid_valid')
  await expect(page.getByRole('heading', { name: 'Wrong event' })).toBeVisible()
  await expect(page.getByText('wh_test_admit_paid_valid')).toHaveCount(0)
})

test('network retry retains the scan and requires explicit recovery', async ({ page }) => {
  await gotoReadyScanner(page)
  await submitDevelopmentCredential(page, 'wh_test_admit_network_error')
  await expect(page.getByRole('heading', { name: 'Network error' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry check-in' }).click()
  await expect(page.getByRole('heading', { name: 'Network error' })).toBeVisible()
  await page.getByRole('button', { name: 'Return to scanning' }).click()
  await expect(page.getByRole('heading', { name: 'Ready to scan' })).toBeVisible()
})

test('held scanner states advance only through explicit development controls', async ({ page }) => {
  await page.goto('/__dev/ticket-shells/events/event-a/check-in/initializing')
  await expect(page.getByRole('heading', { name: 'Starting camera' })).toBeVisible()
  await page.getByRole('button', { name: 'Release camera state' }).click()
  await expect(page.getByRole('heading', { name: 'Ready to scan' })).toBeVisible()

  await page.goto('/__dev/ticket-shells/events/event-a/check-in/checking')
  await submitDevelopmentCredential(page, 'wh_test_admit_paid_valid')
  await expect(page.getByRole('heading', { name: 'Checking ticket' })).toBeVisible()
  await page.getByRole('button', { name: 'Release check result' }).click()
  await expect(page.getByRole('heading', { name: 'Admitted' })).toBeVisible()
})

for (const [scenario, heading] of [
  ['permission-denied', 'Camera permission denied'],
  ['no-camera', 'No camera available'],
  ['initialization-failed', 'Camera could not start'],
] as const) {
  test(`scanner ${scenario} recovery is explicit and retryable`, async ({ page }) => {
    await page.goto(`/__dev/ticket-shells/events/event-a/check-in/${scenario}`)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await page.getByRole('button', { name: 'Retry camera' }).click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  })
}
