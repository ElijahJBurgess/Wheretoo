#!/usr/bin/env node
/* Same-event keyboard/camera recovery. Cancels admission; never admits a ticket. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
require('tsx/cjs')
const { chromium, expect: baseExpect } = require('@playwright/test')
const expect = baseExpect.configure({ timeout: 40_000 })
const { providerBoundaries, origin, ticketFacts } = require('./support/spec14Harness.ts')
const { verifiedIdentity, verificationSourceHashes } = require('./spec14-visual.cjs')
const state = path.resolve(__dirname, '../../.superpowers/spec14')

async function tabTo(page, target) {
  await target.waitFor()
  for (let step = 0; step < 80; step++) {
    if (await target.evaluate(node => node === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Required control was not reachable with Tab')
}

async function main() {
  const startedAt = new Date().toISOString()
  const runner = 'tests/e2e/spec14-door-accessibility.cjs'
  const sourceHashes = verificationSourceHashes(runner)
  const identity = await verifiedIdentity()
  const data = JSON.parse(fs.readFileSync(path.join(state, 'scenario.json'), 'utf8'))
  if (!data.freeEventId || !data.freeRegistrationId) throw new Error('Original J03 prerequisite missing')
  const before = ticketFacts(data.freeRegistrationId, true)
  if (before.length !== 3 || before[0].status !== 'valid') throw new Error('Expected original unused first ticket')
  const out = path.join(state, 'visual-door-accessibility-' + Date.now())
  fs.mkdirSync(out, { mode: 0o700 })
  const results = []
  const browser = await chromium.launch()
  let outcome = 'partial', stage = 'setup', failure = null, writerRequests = 0, ticketsPreserved = null
  try {
    for (const mode of ['denied', 'stream']) {
      stage = mode + ':setup'
      const context = await browser.newContext({ storageState: path.join(state, 'browser-organizer.json'), viewport: { width: 390, height: 960 }, reducedMotion: 'reduce' })
      context.setDefaultTimeout(40_000)
      const blocked = await providerBoundaries(context, { allowProviderActions: false })
      for (const writer of ['/rest/v1/rpc/redeem_owned_ticket', '/functions/v1/ticket-admission']) {
        await context.route(origin + writer, route => { writerRequests++; return route.abort('blockedbyclient') })
      }
      await context.addInitScript(cameraMode => {
        window.__spec14Tracks = []
        Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [{ deviceId: 'spec14-blank-camera', kind: 'videoinput', label: 'Local blank camera', groupId: 'spec14', toJSON() { return {} } }] })
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
          if (cameraMode === 'denied') throw new DOMException('Synthetic permission denial', 'NotAllowedError')
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
          const painter = canvas.getContext('2d'); painter.fillStyle = 'white'; painter.fillRect(0, 0, 640, 480)
          const stream = canvas.captureStream(4)
          window.__spec14Tracks.push(...stream.getTracks())
          return stream
        } })
      }, mode)
      const page = await context.newPage()
      let pageErrors = 0
      page.on('pageerror', () => pageErrors++)
      try {
        stage = mode + ':scanner'
        await page.goto(origin + `/organizer/events/${data.freeEventId}/check-in/scan`)
        if (mode === 'denied') await expect(page.getByRole('heading', { name: 'Camera permission denied', exact: true })).toBeVisible()
        else await expect(page.getByRole('heading', { name: 'Scan guest ticket', exact: true })).toBeVisible()
        const screenshot = mode + '-390.png'
        await page.screenshot({ path: path.join(out, screenshot), fullPage: true })
        const find = page.getByRole('link', { name: 'Find guest', exact: true })
        await tabTo(page, find)
        await page.keyboard.press('Enter')
        await expect(page.getByRole('heading', { name: 'Find Guest', exact: true })).toBeVisible()
        await expect.poll(() => new URL(page.url()).pathname).toBe(`/organizer/events/${data.freeEventId}/check-in/find`)
        const tracks = await page.evaluate(() => window.__spec14Tracks.map(track => track.readyState))
        if (mode === 'stream' && (!tracks.length || tracks.some(value => value !== 'ended'))) throw new Error('Manual switch left a camera track active')
        if (mode === 'denied' && tracks.length) throw new Error('Denied camera created a track')
        results.push({ check: 'camera to same-event manual search', mode, tracks: tracks.length, allTracksStopped: tracks.every(value => value === 'ended'), screenshot })

        if (mode === 'stream') {
          stage = 'keyboard:individual-ticket'
          const searchInput = page.getByLabel('Search guest name or email', { exact: true })
          stage = 'keyboard:focus-search'
          await tabTo(page, searchInput)
          await page.keyboard.press('ControlOrMeta+A')
          await page.keyboard.type('Free Guest')
          stage = 'keyboard:typed-query'
          await expect(searchInput).toHaveValue('Free Guest')
          await page.keyboard.press('Enter')
          stage = 'keyboard:wait-original-ticket-link'
          const selected = page.locator(`a[href$="/find/registrations/${data.freeRegistrationId}/${before[0].id}"]`)
          await tabTo(page, selected)
          await page.keyboard.press('Enter')
          stage = 'keyboard:wait-admission-opener'
          const opener = page.getByRole('button', { name: 'Check in guest', exact: true })
          await tabTo(page, opener)
          await page.keyboard.press('Enter')
          stage = 'keyboard:wait-confirm-dialog'
          const dialog = page.getByRole('dialog', { name: 'Confirm check-in', exact: true })
          await expect(dialog).toBeVisible()
          stage = 'keyboard:focus-trap'
          const focusSteps = []
          for (let step = 0; step < 7; step++) {
            await page.keyboard.press('Tab')
            focusSteps.push(await dialog.evaluate(node => ({ inside: node.contains(document.activeElement), tag: document.activeElement?.tagName, body: document.activeElement === document.body, documentFocused: document.hasFocus(), modal: node.matches(':modal') })))
          }
          await page.screenshot({ path: path.join(out, 'manual-confirm-focus-390.png'), fullPage: true })
          stage = 'keyboard:cancel-focus-return'
          await page.keyboard.press('Escape')
          await expect(dialog).toHaveCount(0)
          const focusReturned = await opener.evaluate(node => node === document.activeElement)
          results.push({ check: 'keyboard search/selection/confirm/cancel', focusedTicket: 'original ticket1 of3; deliberately not admitted', focusSteps, focusReturned, screenshot: 'manual-confirm-focus-390.png' })
          if (focusSteps.some(step => !step.inside && !(step.body && !step.documentFocused && step.modal))) { stage = 'keyboard:focus-trap'; throw new Error('Focus entered the background page while the native dialog was modal') }
          await expect(opener).toBeFocused()
        }
        if (blocked.length || pageErrors) throw new Error('Unexpected outbound request or runtime error')
      } finally { await context.close() }
    }
    if (writerRequests) throw new Error('Door check attempted a fenced admission write')
    stage = 'verification-source-binding'
    if (JSON.stringify(verificationSourceHashes(runner)) !== JSON.stringify(sourceHashes)) throw new Error('Verification source changed during execution')
    outcome = 'passed'
  } catch (error) { failure = { name: error.name, stage }; throw error } finally {
    await browser.close()
    try { ticketsPreserved = JSON.stringify(ticketFacts(data.freeRegistrationId, true)) === JSON.stringify(before) } catch { ticketsPreserved = null }
    if (ticketsPreserved !== true) { outcome = 'partial'; failure ??= { name: 'PreservationError', stage: 'final-ticket-read' } }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), sourceHashes, identity, outcome, failure, writerRequests, ticketsPreserved, results, scope: 'Original free event, real UI/reader, simulated camera denial/blank stream, keyboard native-modal cancel (browser chrome traversal allowed, background app focus forbidden); both admission writers fenced before transport; no provider control binding; physical camera unverified; images await inspection' }, null, 2), { mode: 0o600 })
  }
  if (outcome !== 'passed') throw new Error('Original tickets could not be confirmed unchanged')
  console.log(JSON.stringify({ directory: path.basename(out), cases: results.length, writerRequests, outcome }))
}
main().catch(() => { console.error('Door accessibility check failed; private evidence retained.'); process.exitCode = 1 })
