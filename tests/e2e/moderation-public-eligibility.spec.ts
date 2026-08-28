import { expect, test } from '@playwright/test'
import {
  acceptAgreementAndPreview,
  advanceExistingEditorToAgreement,
  anonymousPublicEvent,
  applyStaffAction,
  assertResponsiveAccessibility,
  createOrganizerEvent,
  directStaffAction,
  installLocalReportProxy,
  moderationFixture,
  newActorContext,
  newObservedPage,
  observeModerationBrowserFailures,
  publicMapFixtureRows,
  publishFromPreview,
  signInStaff,
  staffClient,
} from './support/moderationJourney'

test.describe('Build 2.5 moderation and public eligibility', () => {
  test('low-risk organizer agrees, publishes immediately, re-accepts a material edit, and returns publicly', async ({ page }, testInfo) => {
    const fixture = moderationFixture(testInfo)
    const assertNoBrowserFailures = observeModerationBrowserFailures(page)
    const event = await createOrganizerEvent(
      page,
      fixture,
      `TASK16_LOW_RISK_${testInfo.project.name}_${crypto.randomUUID().slice(0, 8)}`,
      false,
    )

    await acceptAgreementAndPreview(page, event)
    await publishFromPreview(page, event.eventId)
    await expect(page.getByRole('heading', { name: 'Published', level: 1 })).toBeVisible()
    await expect(page.getByText('This event is publicly available.', { exact: true })).toBeVisible()
    expect(await anonymousPublicEvent(event.eventId)).toMatchObject({ id: event.eventId, title: event.title })

    await page.goto(`/organizer/events/${event.eventId}/edit`)
    await page.getByLabel('Description').fill(
      'A materially revised Task 16 event that must receive a new server-bound agreement.',
    )
    await advanceExistingEditorToAgreement(page)
    await expect(page.getByRole('checkbox', { name: /I confirm that this event information/ })).not.toBeChecked()
    await expect(page.getByText('Agreement required for these changes.')).toBeVisible()
    await acceptAgreementAndPreview(page, event)
    await publishFromPreview(page, event.eventId)
    await expect(page.getByText('This event is publicly available.', { exact: true })).toBeVisible()
    expect(await anonymousPublicEvent(event.eventId)).toMatchObject({ id: event.eventId })
    await assertResponsiveAccessibility(page)
    await expect(page.getByRole('link', { name: 'Moderation' })).toHaveCount(0)
    assertNoBrowserFailures()
  })

  test('high-risk organizer is held, preserves blocked edits, and requests review', async ({ browser, page }, testInfo) => {
    const fixture = moderationFixture(testInfo)
    const assertNoBrowserFailures = observeModerationBrowserFailures(page)
    const event = await createOrganizerEvent(
      page,
      fixture,
      `TASK16_HIGH_RISK_${testInfo.project.name}_${crypto.randomUUID().slice(0, 8)}`,
      true,
    )
    await acceptAgreementAndPreview(page, event)
    await publishFromPreview(page, event.eventId)
    await expect(page.getByRole('heading', { name: 'Under review', level: 1 })).toBeVisible()
    expect(await anonymousPublicEvent(event.eventId)).toBeNull()

    const staffContext = await newActorContext(browser, testInfo)
    const staffActor = await newObservedPage(staffContext)
    const staffPage = staffActor.page
    await signInStaff(staffPage)
    await applyStaffAction(staffPage, event.eventId, 'Block')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Blocked', level: 1 })).toBeVisible()
    await page.goto(`/organizer/events/${event.eventId}/edit`)
    await page.getByLabel('Description').fill(
      'A blocked Task 16 event whose owner edit must not weaken human enforcement.',
    )
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await expect(page.getByText('Blocked', { exact: true })).toBeVisible()
    await advanceExistingEditorToAgreement(page)
    await acceptAgreementAndPreview(page, event)
    await page.getByRole('button', { name: 'Publish changes' }).click()
    await expect(page).toHaveURL(new RegExp(`/organizer/events/${event.eventId}$`))
    await expect(page.getByRole('heading', { name: 'Blocked', level: 1 })).toBeVisible()
    expect(await anonymousPublicEvent(event.eventId)).toBeNull()

    await page.goto(`/organizer/events/${event.eventId}`)
    await page.getByLabel('Optional note').fill('Please review the current saved revision.')
    await page.getByRole('button', { name: 'Request review' }).click()
    await expect(page.getByRole('status')).toHaveText('Review requested.')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Withdraw request' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Moderation' })).toHaveCount(0)
    staffActor.assertNoBrowserFailures()
    await staffContext.close()
    assertNoBrowserFailures()
  })

  test('anonymous report becomes the third actor priority signal without hiding the event', async ({ browser, page }, testInfo) => {
    const fixture = moderationFixture(testInfo)
    const assertNoBrowserFailures = observeModerationBrowserFailures(page)
    await installLocalReportProxy(page, fixture)
    await page.goto(`/events/${fixture.reportEventId}`)
    const trigger = page.getByRole('button', { name: 'Report this event' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Report this event' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio').first()).toBeFocused()
    await dialog.getByRole('radio', { name: 'Unsafe' }).check()
    await dialog.getByRole('button', { name: 'Send report' }).click()
    await expect(page.getByRole('status')).toHaveText('Report received. Thank you for letting us know.')
    await expect(trigger).toBeFocused()
    expect(await anonymousPublicEvent(fixture.reportEventId)).not.toBeNull()

    const staffContext = await newActorContext(browser, testInfo)
    const staffActor = await newObservedPage(staffContext)
    const staffPage = staffActor.page
    await signInStaff(staffPage)
    await staffPage.goto(`/moderation/events/${fixture.reportEventId}`)
    await expect(staffPage.getByText('3 reports', { exact: true })).toBeVisible()
    await expect(staffPage.getByText('Under review', { exact: true })).toHaveCount(0)
    await expect(staffPage.getByText(/reporter|fingerprint|provider reasoning/i)).toHaveCount(0)
    staffActor.assertNoBrowserFailures()
    await staffContext.close()
    await assertResponsiveAccessibility(page)
    assertNoBrowserFailures()
  })

  test('staff action conflicts fail closed, reload current facts, and apply the current decision', async ({ page }, testInfo) => {
    const fixture = moderationFixture(testInfo)
    const assertNoBrowserFailures = observeModerationBrowserFailures(page)
    await signInStaff(page)
    await page.goto(`/moderation/events/${fixture.staffEventId}`)
    await expect(page.getByRole('heading', { name: 'Moderation action', level: 2 })).toBeVisible()

    const secondStaff = await staffClient()
    await directStaffAction(secondStaff, fixture.staffEventId, 'hold')
    assertNoBrowserFailures.expectModerationConflict()
    await page.getByRole('radio', { name: 'Clear', exact: true }).check()
    await page.getByLabel('Reason').selectOption('no_violation')
    await page.getByRole('button', { name: 'Apply Clear' }).click()
    await expect(page.getByRole('alert')).toContainText('Case changed while you were reviewing it.')
    const reload = page.getByRole('button', { name: 'Reload case' })
    await expect(reload).toBeFocused()
    await reload.click()
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    await applyStaffAction(page, fixture.staffEventId, 'Clear')
    expect(await anonymousPublicEvent(fixture.staffEventId)).not.toBeNull()
    await secondStaff.auth.signOut({ scope: 'local' })
    assertNoBrowserFailures()
  })

  test('active public clients remove enforced content within 30 seconds and map RPC excludes every unsafe row', async ({ browser, page }, testInfo) => {
    test.setTimeout(150_000)
    const fixture = moderationFixture(testInfo)
    const assertNoBrowserFailures = observeModerationBrowserFailures(page)
    await page.goto(`/events/${fixture.reportEventId}`)
    await expect(page.getByRole('button', { name: 'Report this event' })).toBeVisible()

    const staffContext = await newActorContext(browser, testInfo)
    const staffActor = await newObservedPage(staffContext)
    const staffPage = staffActor.page
    await signInStaff(staffPage)
    await applyStaffAction(staffPage, fixture.reportEventId, 'Remove')
    const removalStartedAt = Date.now()
    await expect(page.getByRole('heading', { name: 'Event not found', level: 1 })).toBeVisible({ timeout: 29_000 })
    expect(Date.now() - removalStartedAt).toBeLessThan(30_000)
    await expect(page.getByRole('button', { name: 'Report this event' })).toHaveCount(0)

    await applyStaffAction(staffPage, fixture.reportEventId, 'Restore')
    await expect.poll(() => anonymousPublicEvent(fixture.reportEventId), { timeout: 15_000 }).not.toBeNull()

    const mapRows = await publicMapFixtureRows()
    const fixtureRows = mapRows.filter((row) => row.title.startsWith('task16_'))
    const fixtureIds = fixtureRows.map((row) => row.event_id)
    expect(fixtureIds).toContain(fixture.mapEligibleEventId)
    expect(fixture.mapExcludedEventIds.some((id) => fixtureIds.includes(id))).toBe(false)
    for (const row of fixtureRows) {
      expect(Object.keys(row).sort()).toEqual([
        'admission_type', 'advisories', 'animation_preset', 'artwork_reference', 'category',
        'ends_at', 'event_id', 'latitude', 'longitude', 'minimum_age', 'minimum_price_minor',
        'starts_at', 'timezone', 'title', 'venue_label',
      ])
    }
    staffActor.assertNoBrowserFailures()
    await staffContext.close()
    assertNoBrowserFailures()
  })
})
