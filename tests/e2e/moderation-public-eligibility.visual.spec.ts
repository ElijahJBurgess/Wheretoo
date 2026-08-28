import { expect, test } from '@playwright/test'
import {
  acceptAgreementAndPreview,
  applyStaffAction,
  captureModerationState,
  continueRequirementsToAgreement,
  createOrganizerEvent,
  directStaffAction,
  moderationFixture,
  newObservedPage,
  observeModerationBrowserFailures,
  publishFromPreview,
  signInStaff,
  staffClient,
} from './support/moderationJourney'

test.describe('Build 2.5 moderation visual contract', () => {
  test('captures organizer requirements, agreement, preview, public report, and both policy placeholders', async ({ page }, testInfo) => {
    const fixture = moderationFixture(testInfo)
    const assertNoBrowserFailures = observeModerationBrowserFailures(page)
    const event = await createOrganizerEvent(
      page,
      fixture,
      `TASK16_VISUAL_${testInfo.project.name}_${crypto.randomUUID().slice(0, 8)}`,
      false,
      true,
    )
    await captureModerationState(page, testInfo, 'organizer-requirements')
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 844 })
      await captureModerationState(page, testInfo, 'organizer-requirements-320')
      await page.setViewportSize({ width: 390, height: 844 })
    }

    await continueRequirementsToAgreement(page)
    await captureModerationState(page, testInfo, 'organizer-agreement')
    await acceptAgreementAndPreview(page, event)
    await captureModerationState(page, testInfo, 'organizer-preview')
    await publishFromPreview(page, event.eventId)
    await page.goto(`/events/${event.eventId}`)
    await captureModerationState(page, testInfo, 'public-event')
    await page.getByRole('button', { name: 'Report this event' }).click()
    await captureModerationState(page, testInfo, 'public-report-dialog')
    await page.getByRole('button', { name: 'Cancel' }).click()

    const policyActor = await newObservedPage(page.context())
    const policyPage = policyActor.page
    await policyPage.goto('/organizer-terms')
    await expect(policyPage.getByText('Development placeholder', { exact: true })).toBeVisible()
    await captureModerationState(policyPage, testInfo, 'organizer-terms-placeholder')
    await policyPage.goto('/event-policy')
    await expect(policyPage.getByText('Development placeholder', { exact: true })).toBeVisible()
    await captureModerationState(policyPage, testInfo, 'event-policy-placeholder')
    if (testInfo.project.name === 'mobile-chromium') {
      await policyPage.setViewportSize({ width: 320, height: 844 })
      await captureModerationState(policyPage, testInfo, 'event-policy-placeholder-320')
    }
    policyActor.assertNoBrowserFailures()
    await policyPage.close()
    assertNoBrowserFailures()
  })

  test('captures staff queue, current case, conflict recovery, enforcement, and narrow reflow', async ({ page }, testInfo) => {
    const fixture = moderationFixture(testInfo)
    const assertNoBrowserFailures = observeModerationBrowserFailures(page)
    await signInStaff(page)
    await captureModerationState(page, testInfo, 'staff-queue', [page.locator('.moderation-queue__identity code')])
    await page.goto(`/moderation/events/${fixture.visualEventId}`)
    await captureModerationState(page, testInfo, 'staff-case')
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 844 })
      await captureModerationState(page, testInfo, 'staff-case-320')
      await page.setViewportSize({ width: 390, height: 844 })
    }

    const secondStaff = await staffClient()
    await directStaffAction(secondStaff, fixture.visualEventId, 'hold')
    assertNoBrowserFailures.expectModerationConflict()
    await page.getByRole('radio', { name: 'Clear', exact: true }).check()
    await page.getByLabel('Reason').selectOption('no_violation')
    await page.getByRole('button', { name: 'Apply Clear' }).click()
    await expect(page.getByRole('alert')).toContainText('Case changed while you were reviewing it.')
    await captureModerationState(page, testInfo, 'staff-conflict')
    await page.getByRole('button', { name: 'Reload case' }).click()
    await applyStaffAction(page, fixture.visualEventId, 'Clear')
    await captureModerationState(page, testInfo, 'staff-clear-feedback')
    await secondStaff.auth.signOut({ scope: 'local' })
    assertNoBrowserFailures()
  })
})
