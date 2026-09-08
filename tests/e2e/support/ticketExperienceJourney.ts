import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { expect, type Page, type TestInfo } from '@playwright/test'
import type * as QrArtifactDecoderModule from './qrArtifactDecoder'

export async function decoderBundle() {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false,
    lib: { entry: fileURLToPath(new URL('./qrArtifactDecoder.ts', import.meta.url)), name: 'LiteQrDecoder', formats: ['iife'] }, minify: true,
  } })
  const output = Array.isArray(result) ? result[0] : result
  if (!output || !('output' in output)) throw new Error('QR_DECODER_BUNDLE')
  const chunk = output.output.find(item => item.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('QR_DECODER_BUNDLE')
  return chunk.code
}

export async function decodeMountedQr(page: Page, bundle: string): Promise<string> {
  const canvas = page.getByTestId('admission-qr').locator('canvas')
  await expect(canvas).toHaveCount(1)
  await expect(canvas).toHaveAttribute('data-qr-ready', 'true')
  // Test helper exists only in memory. No served production test route is needed.
  await page.evaluate(`${bundle};globalThis.__liteDecodeQr = LiteQrDecoder.decodeQrArtifact;`)
  const value = await page.evaluate(async () => {
    const image = document.querySelector<HTMLCanvasElement>('[data-testid="admission-qr"] canvas')
    const decode = (globalThis as unknown as { __liteDecodeQr(value: string): Promise<string | null> }).__liteDecodeQr
    return image ? await decode(image.toDataURL('image/png')) : null
  })
  if (typeof value !== 'string' || !/^wta1_[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('QR_DECODE_FAILED')
  return value
}

const sensitivePrefixes = ['wh_test_admit_', 'wh_test_collection_', 'WH-TEST-ADMIT-QR-'] as const

export type DiagnosticWatch = {
  assertSafe(): void
}

export function watchTicketExperienceDiagnostics(page: Page): DiagnosticWatch {
  const errors: string[] = []
  const consoleMessages: string[] = []
  page.on('console', (message) => {
    consoleMessages.push(message.text())
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  return {
    assertSafe() {
      expect(errors, 'ticket shell emitted browser errors').toEqual([])
      expect([...consoleMessages, ...errors].join('\n')).not.toMatch(/wh_test_(?:admit|collection)_|WH-TEST-ADMIT-QR-/)
    },
  }
}

export async function gotoReadyScanner(page: Page, eventId = 'event-a') {
  await page.goto(`/__dev/ticket-shells/events/${eventId}/check-in/ready`)
  await expect(page.getByRole('heading', { name: 'Ready to scan' })).toBeVisible()
}

export async function submitDevelopmentCredential(page: Page, credential: string) {
  await page.getByLabel('Fake admission credential').fill(credential)
  await page.getByRole('button', { name: 'Submit fake credential' }).click()
}

export async function assertNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
}

export async function assertVisibleKeyboardFocus(page: Page) {
  const focusable = page.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
  const count = await focusable.evaluateAll((elements) => {
    const visible = elements.filter((element) => {
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0
    })
    visible.forEach((element, index) => element.setAttribute('data-task8-tab-order', String(index)))
    return visible.length
  })

  expect(count).toBeGreaterThan(0)
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Tab')
    const focused = page.locator(':focus')
    await expect(focused).toHaveAttribute('data-task8-tab-order', String(index))
    const focusStyle = await focused.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      }
    })
    expect(focusStyle.outlineStyle).not.toBe('none')
    expect(focusStyle.outlineWidth).toBeGreaterThan(0)
  }
  await focusable.evaluateAll((elements) => elements.forEach((element) => element.removeAttribute('data-task8-tab-order')))
}

export async function assertMinimumTouchTargets(page: Page, selector = 'button, a[href], input') {
  const undersized = await page.locator(selector).evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      const bounds = element.getBoundingClientRect()
      return bounds.width > 0 && bounds.height > 0 && (bounds.width < 24 || bounds.height < 24)
    })
    .map((element) => ({
      name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? element.tagName,
      rect: element.getBoundingClientRect().toJSON(),
    })))
  expect(undersized).toEqual([])
}

async function decodeInsideBrowser(page: Page, dataUrl: string): Promise<string | null> {
  return page.evaluate(async (value) => {
    const modulePath = '/tests/e2e/support/qrArtifactDecoder.ts'
    const module = await import(/* @vite-ignore */ modulePath) as typeof QrArtifactDecoderModule
    return module.decodeQrArtifact(value)
  }, dataUrl)
}

export async function captureSafeScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.evaluate(() => document.fonts.ready)
  const qr = page.locator('[data-testid="admission-qr"] canvas')
  if (await qr.count()) await expect(qr).toHaveAttribute('data-qr-ready', 'true')
  await page.screenshot({
    path,
    fullPage: true,
    mask: [page.getByTestId('admission-qr'), page.locator('[data-development-control]')],
    maskColor: '#171425',
  })

  const png = await readFile(path)
  const decoded = await decodeInsideBrowser(page, `data:image/png;base64,${png.toString('base64')}`)
  expect(sensitivePrefixes.some((prefix) => decoded?.startsWith(prefix))).toBe(false)
  await testInfo.attach(`${name}-${testInfo.project.name}`, { path, contentType: 'image/png' })
}

export async function decodeDataUrlInBrowser(page: Page, dataUrl: string) {
  return decodeInsideBrowser(page, dataUrl)
}
