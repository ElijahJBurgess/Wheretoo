import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { qrCases, type QrCaseId } from '../../src/features/ticket-experience/fixtures/qrCases'
import {
  assertMinimumTouchTargets,
  assertNoHorizontalOverflow,
  assertVisibleKeyboardFocus,
  captureSafeScreenshot,
  decodeDataUrlInBrowser,
  type DiagnosticWatch,
  gotoReadyScanner,
  submitDevelopmentCredential,
  watchTicketExperienceDiagnostics,
} from './support/ticketExperienceJourney'

const diagnosticWatches = new WeakMap<Page, DiagnosticWatch>()

test.beforeEach(async ({ page }) => {
  diagnosticWatches.set(page, watchTicketExperienceDiagnostics(page))
})

test.afterEach(async ({ page }) => {
  diagnosticWatches.get(page)?.assertSafe()
})

type QrTransform = 'baseline' | 'high-density' | 'small' | 'dim' | 'glare' | 'dirty' | 'distance'

const customerCaptures = [
  ['customer-loading', '/tickets/wh_test_collection_loading', 'Loading tickets'],
  ['customer-error', '/tickets/wh_test_collection_error', 'Tickets unavailable'],
  ['customer-empty', '/tickets/wh_test_collection_empty', 'No tickets available'],
  ['customer-unavailable', '/tickets/wh_test_collection_unavailable', 'Tickets unavailable'],
  ['customer-not-enabled', '/tickets/wh_test_collection_not_enabled', 'Ticket experience not enabled'],
  ['paid-overview', '/tickets/wh_test_collection_paid_multi', 'Your tickets'],
  ['paid-multi-focused', '/tickets/wh_test_collection_paid_multi/paid-multi-1', 'Ticket 1'],
  ['paid-valid', '/tickets/wh_test_collection_paid', 'Ticket 1'],
  ['paid-used', '/tickets/wh_test_collection_used', 'Already used'],
  ['paid-refunded', '/tickets/wh_test_collection_refunded', 'Refunded'],
  ['paid-cancelled', '/tickets/wh_test_collection_cancelled', 'Cancelled'],
  ['paid-ended', '/tickets/wh_test_collection_ended', 'Event ended'],
  ['free-rsvp-valid', '/tickets/wh_test_collection_rsvp', 'Ticket 1'],
] as const

const scannerOutcomes = [
  ['scanner-admitted', 'event-a', 'wh_test_admit_paid_valid', 'Admitted'],
  ['scanner-already-used', 'event-a', 'wh_test_admit_already_used', 'Already used'],
  ['scanner-refunded', 'event-a', 'wh_test_admit_refunded', 'Refunded'],
  ['scanner-cancelled', 'event-a', 'wh_test_admit_cancelled', 'Cancelled'],
  ['scanner-wrong-event', 'event-unavailable', 'wh_test_admit_paid_valid', 'Wrong event'],
  ['scanner-invalid', 'event-a', 'wh_test_admit_invalid', 'Invalid ticket'],
  ['scanner-network-error', 'event-a', 'wh_test_admit_network_error', 'Network error'],
] as const

const scannerRecoveries = [
  ['scanner-permission-denied', 'permission-denied', 'Camera permission denied'],
  ['scanner-no-camera', 'no-camera', 'No camera available'],
  ['scanner-initialization-failed', 'initialization-failed', 'Camera could not start'],
] as const

const emailCaptures = [
  ['email-ready-paid', '/__dev/ticket-shells/emails/tickets-ready/paid', 'Email shell'],
  ['email-ready-rsvp', '/__dev/ticket-shells/emails/tickets-ready/free-rsvp', 'Email shell'],
  ['email-cancelled', '/__dev/ticket-shells/emails/event-cancelled/default', 'Email shell'],
  ['email-refunded', '/__dev/ticket-shells/emails/ticket-refunded/default', 'Email shell'],
] as const

async function captureRoute(page: Page, testInfo: TestInfo, name: string, path: string, marker: string) {
  await page.goto(path)
  await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await captureSafeScreenshot(page, testInfo, name)
}

test('captures every stable shell state with credential-bearing regions masked', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const [name, path, marker] of customerCaptures) {
    await captureRoute(page, testInfo, name, path, marker)
  }

  await captureRoute(page, testInfo, 'scanner-initializing', '/__dev/ticket-shells/events/event-a/check-in/initializing', 'Starting camera')
  await gotoReadyScanner(page)
  await assertNoHorizontalOverflow(page)
  await captureSafeScreenshot(page, testInfo, 'scanner-ready')

  await page.goto('/__dev/ticket-shells/events/event-a/check-in/checking')
  await expect(page.getByRole('heading', { name: 'Ready to scan' })).toBeVisible()
  await submitDevelopmentCredential(page, 'wh_test_admit_paid_valid')
  await expect(page.getByRole('heading', { name: 'Checking ticket' })).toBeVisible()
  await captureSafeScreenshot(page, testInfo, 'scanner-checking')

  for (const [name, eventId, credential, heading] of scannerOutcomes) {
    await gotoReadyScanner(page, eventId)
    await submitDevelopmentCredential(page, credential)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await captureSafeScreenshot(page, testInfo, name)
  }

  for (const [name, scenario, heading] of scannerRecoveries) {
    await captureRoute(page, testInfo, name, `/__dev/ticket-shells/events/event-a/check-in/${scenario}`, heading)
  }

  await captureRoute(page, testInfo, 'dashboard-demo', '/__dev/ticket-shells/events/event-a/dashboard', 'Mission Night Market')
  await captureRoute(page, testInfo, 'dashboard-unavailable', '/__dev/ticket-shells/events/event-unavailable/dashboard', 'Event dashboard unavailable')

  for (const [name, path, marker] of emailCaptures) {
    await page.goto(path)
    await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
    const frame = page.frameLocator('iframe[title="Email preview"]')
    await expect(frame.locator('body')).toBeVisible()
    await expect(frame.locator('body')).toContainText('Mission Night Market')
    const emailOverflow = await frame.locator('html').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(emailOverflow.scrollWidth).toBeLessThanOrEqual(emailOverflow.clientWidth)
    await assertNoHorizontalOverflow(page)
    await captureSafeScreenshot(page, testInfo, name)
  }
})

test('keyboard, zoom, touch targets, announcements, and reduced motion remain usable', async ({ page }) => {
  await page.goto('/tickets/wh_test_collection_paid_multi')
  await assertVisibleKeyboardFocus(page)
  await assertMinimumTouchTargets(page)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await assertNoHorizontalOverflow(page)
  await expect(page.getByRole('heading', { name: 'Your tickets' })).toBeVisible()

  await page.goto('/tickets/wh_test_collection_paid_multi/paid-multi-1')
  await expect(page.getByRole('status')).toHaveText('Ticket 1 of 2')
  await assertVisibleKeyboardFocus(page)
  await assertMinimumTouchTargets(page)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await assertNoHorizontalOverflow(page)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/__dev/ticket-shells/events/event-a/check-in/initializing')
  const animationDuration = await page.locator('.organizer-scanner__spinner').evaluate((element) => getComputedStyle(element).animationDuration)
  expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.01)

  await gotoReadyScanner(page)
  await assertVisibleKeyboardFocus(page)
  await assertMinimumTouchTargets(page)
  await submitDevelopmentCredential(page, 'wh_test_admit_refunded')
  await expect(page.getByRole('alert')).toContainText('Refunded')
  await expect(page.getByRole('alert')).toContainText('Do not admit')
  await assertVisibleKeyboardFocus(page)
  await assertMinimumTouchTargets(page)

  await page.goto('/__dev/ticket-shells/events/event-a/dashboard')
  await assertVisibleKeyboardFocus(page)
  await assertMinimumTouchTargets(page)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await assertNoHorizontalOverflow(page)
})

async function transformedQrDataUrl(page: Page, transform: QrTransform, seed: number) {
  return page.locator('[data-testid="admission-qr"] canvas').evaluate((source: HTMLCanvasElement, input) => {
    const { transform: kind, seed: caseSeed } = input
    const sourceRect = source.getBoundingClientRect()
    if (kind === 'baseline' || kind === 'high-density') {
      return {
        backingWidth: source.width,
        cssWidth: sourceRect.width,
        dataUrl: source.toDataURL('image/png'),
      }
    }
    const targetSize = kind === 'small' ? 180 : 240
    const output = document.createElement('canvas')
    output.width = targetSize
    output.height = targetSize
    const context = output.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('QR_MATRIX_CONTEXT_UNAVAILABLE')

    context.imageSmoothingEnabled = kind === 'small' || kind === 'distance'
    if (kind === 'distance') {
      const distant = document.createElement('canvas')
      distant.width = 140
      distant.height = 140
      const distantContext = distant.getContext('2d')
      if (!distantContext) throw new Error('QR_MATRIX_DISTANCE_CONTEXT_UNAVAILABLE')
      distantContext.imageSmoothingEnabled = true
      distantContext.drawImage(source, 0, 0, 140, 140)
      context.drawImage(distant, 0, 0, 240, 240)
    } else {
      context.drawImage(source, 0, 0, targetSize, targetSize)
    }

    if (kind === 'dim') {
      const pixels = context.getImageData(0, 0, output.width, output.height)
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        pixels.data[offset] *= 0.45
        pixels.data[offset + 1] *= 0.45
        pixels.data[offset + 2] *= 0.45
      }
      context.putImageData(pixels, 0, 0)
    }

    if (kind === 'glare') {
      context.save()
      context.globalAlpha = 0.7
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.moveTo(output.width * 0.32, output.height * 0.38)
      context.lineTo(output.width * 0.66, output.height * 0.34)
      context.lineTo(output.width * 0.68, output.height * 0.64)
      context.lineTo(output.width * 0.34, output.height * 0.68)
      context.closePath()
      context.fill()
      context.restore()
    }

    if (kind === 'dirty') {
      let value = caseSeed >>> 0
      const random = () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0
        return value / 0x100000000
      }
      context.lineWidth = 2
      context.lineCap = 'round'
      for (let stroke = 0; stroke < 6; stroke += 1) {
        const x = output.width * (0.32 + random() * 0.2)
        const y = output.height * (0.32 + random() * 0.36)
        const length = output.width * (0.12 + random() * 0.08)
        const angle = (random() - 0.5) * 0.6
        context.strokeStyle = stroke % 2 === 0 ? '#16131f' : '#ffffff'
        context.beginPath()
        context.moveTo(x, y)
        context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
        context.stroke()
      }
    }

    return {
      backingWidth: source.width,
      cssWidth: sourceRect.width,
      dataUrl: output.toDataURL('image/png'),
    }
  }, { transform, seed })
}

const qrRows: ReadonlyArray<{ transform: QrTransform; required: number; project: 'shell-mobile' | 'shell-desktop' }> = [
  { transform: 'baseline', required: 30, project: 'shell-desktop' },
  { transform: 'high-density', required: 30, project: 'shell-mobile' },
  { transform: 'small', required: 30, project: 'shell-desktop' },
  { transform: 'dim', required: 30, project: 'shell-desktop' },
  { transform: 'glare', required: 27, project: 'shell-desktop' },
  { transform: 'dirty', required: 27, project: 'shell-desktop' },
  { transform: 'distance', required: 27, project: 'shell-desktop' },
]

for (const row of qrRows) {
  test(`QR reliability: ${row.transform}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    test.skip(testInfo.project.name !== row.project, `Runs only in ${row.project}`)
    let decoded = 0
    const missed: QrCaseId[] = []
    const mismatched: QrCaseId[] = []
    for (const bytes of [32, 96, 192] as const) {
      for (let seed = 11; seed <= 20; seed += 1) {
        await page.goto(`/__dev/ticket-shells/qr/${bytes}-${seed}`)
        await expect(page.getByTestId('admission-qr')).toHaveCount(1)
        await expect(page.locator('[data-testid="admission-qr"] canvas')).toHaveAttribute('data-qr-ready', 'true')
        const artifact = await transformedQrDataUrl(page, row.transform, seed)
        expect(Math.round(artifact.cssWidth)).toBe(240)
        if (row.transform === 'baseline') expect(artifact.backingWidth).toBe(240)
        if (row.transform === 'high-density') expect(artifact.backingWidth).toBe(480)
        const value = await decodeDataUrlInBrowser(page, artifact.dataUrl)
        const caseId = `${bytes}-${seed}` as QrCaseId
        if (value === qrCases[caseId].credential) decoded += 1
        else if (value === null) missed.push(caseId)
        else mismatched.push(caseId)
      }
    }
    await testInfo.attach('qr-reliability-result', {
      body: JSON.stringify({
        transform: row.transform,
        decoded,
        attempted: 30,
        required: row.required,
        missed,
        mismatched,
      }),
      contentType: 'application/json',
    })
    expect(
      decoded,
      `missed QR cases: ${missed.join(', ')}; mismatched QR cases: ${mismatched.join(', ')}`,
    ).toBeGreaterThanOrEqual(row.required)
  })
}
