#!/usr/bin/env node
/* Read-only route composition of the real task principal; no fixture responses. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
require('tsx/cjs')
const { chromium } = require('@playwright/test')
const { providerBoundaries, origin } = require('./support/spec14Harness.ts')
const { capture, verifiedIdentity, verificationSourceHashes } = require('./spec14-visual.cjs')
const root = path.resolve(__dirname, '../..')
const state = path.join(root, '.superpowers/spec14')

async function main() {
  const startedAt = new Date().toISOString()
  const runner = 'tests/e2e/spec14-visual-populated.cjs'
  const sourceHashes = verificationSourceHashes(runner)
  const mode = process.argv[2]
  if (!['settings', 'journeys'].includes(mode)) throw new Error('Select settings or journeys')
  const data = JSON.parse(fs.readFileSync(path.join(state, 'scenario.json'), 'utf8'))
  if (!data.organizerId) throw new Error('Real UI organizer prerequisite missing')
  const allRoutes = mode === 'settings' ? [
    ['settings', '/organizer/settings', 'Settings', true],
    ['profile', '/organizer/settings/profile', 'Organizer Profile', true],
    ['account', '/organizer/settings/account', 'Account & Security', true],
    ['help', '/organizer/settings/help', 'Help & Legal', true],
    ['actions', '/organizer/settings/actions', 'Account Actions', true],
  ] : [
    ['discovery', '/discover', 'Somewhere to go?', false],
    ['events', '/organizer/events', 'My Events', true],
    ['paid-public', `/events/${data.paidEventId}`, data.events?.paid.title, false],
    ['free-public', `/events/${data.freeEventId}`, data.events?.free.title, false],
    ['paid-dashboard', `/organizer/events/${data.paidEventId}/dashboard`, data.events?.paid.title, true],
    ['free-check-in', `/organizer/events/${data.freeEventId}/check-in`, data.events?.free.title, true],
    ['free-guest-search', `/organizer/events/${data.freeEventId}/check-in/find`, 'Find Guest', true],
    ['paid-tickets', data.paidBuyerUrl, 'Ticket wallet', false],
    ['free-tickets', data.freeBuyerUrl, 'Ticket wallet', false],
  ]
  const selectedLabel = process.argv[3]
  if (selectedLabel && !allRoutes.some(row => row[0] === selectedLabel)) throw new Error('Unknown targeted visual route')
  const routes = selectedLabel ? allRoutes.filter(row => row[0] === selectedLabel) : allRoutes
  if (routes.some(row => !row[1] || row[1].includes('undefined'))) throw new Error('Required original journey identity is absent')
  const identity = await verifiedIdentity()
  const out = path.join(state, `visual-${mode}-${Date.now()}`)
  fs.mkdirSync(out, { mode: 0o700 })
  const browser = await chromium.launch({ args: ['--no-proxy-server', '--force-device-scale-factor=1'] })
  const contexts = []
  const results = []
  let failure = null
  let stage = 'setup'
  try {
    for (const [label, route, heading, organizer] of routes) {
      stage = label + ':navigation'
      const context = await browser.newContext({ ...(organizer ? { storageState: path.join(state, 'browser-organizer.json') } : {}), viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      contexts.push(context)
      context.setDefaultTimeout(40_000)
      const blocked = await providerBoundaries(context, { allowProviderActions: false })
      const page = await context.newPage()
      const destination = route.startsWith('http') ? route : origin + route
      await page.goto(destination, { waitUntil: 'networkidle' })
      await page.getByRole('heading', heading ? { name: heading, exact: true } : { level: 1 }).first().waitFor()
      if (new URL(page.url()).pathname.startsWith('/auth/')) throw new Error('Read-only visual context is not authenticated')
      if (label === 'discovery') await page.locator(`a[href="/events/${data.paidEventId}"]`).first().waitFor()
      if (label === 'free-check-in') await page.getByRole('progressbar', { name: 'Guests checked in', exact: true }).waitFor()
      if (label === 'free-guest-search') {
        await page.getByLabel('Search guest name or email', { exact: true }).fill('Free Guest')
        await page.getByRole('button', { name: 'Search', exact: true }).click()
        await page.locator(`a[href*="/find/registrations/${data.freeRegistrationId}/"]`).first().waitFor()
      }
      if (label.endsWith('-tickets')) await page.locator('.buyer-wallet-row').first().waitFor()
      const widths = mode === 'journeys' || label === 'settings' ? [320, 390, 430, 768, 1440] : [320, 1440]
      for (const width of widths) {
        await page.setViewportSize({ width, height: 960 })
        for (const scale of [1, 2]) { stage = label + ':' + width + ':text' + scale; results.push(await capture(page, out, label, scale)) }
      }
      if (blocked.length) throw new Error('Unexpected outbound request was blocked')
      await context.close(); contexts.pop()
    }
    if (JSON.stringify(verificationSourceHashes(runner)) !== JSON.stringify(sourceHashes)) throw new Error('Verification source changed during execution')
  } catch (error) { failure = { name: error.name, stage, fontEvidence: error.message?.startsWith('Text resize was lost') ? error.message : undefined, category: error.message?.startsWith('Text resize was lost') ? 'text-resize-changed-before-capture' : error.message?.startsWith('Unexpected outbound') ? 'outbound-boundary' : 'navigation-or-state' } } finally {
    for (const context of contexts) await context.close()
    await browser.close()
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), sourceHashes, scope: mode + (selectedLabel ? ':' + selectedLabel : '') + ' actual principal routes; no business actions or seeds; Auth and discovery operational bookkeeping allowed; provider control binding disabled', identity, results, failure, inspection: 'pending' }, null, 2), { mode: 0o600 })
  }
  const overflow = results.filter(row => row.geometry.scrollWidth > row.geometry.clientWidth || row.geometry.sidebarBrandOverflow > 0.5 || row.geometry.contentOverflows.length || row.geometry.narrowEventCopy.length || (row.textScale === 1 && row.geometry.viewport.width >= 390 && row.geometry.discoveryFirstWordLines.length > 1) || row.navigationClearance.some(control => !control.visibleAtDocumentEnd || control.overlapsNavigation)).length
  console.log(JSON.stringify({ directory: path.relative(root, out), captures: results.length, layoutViolations: overflow, failure }))
  if (failure || overflow) process.exitCode = 1
}
main().catch(error => { console.error('Visual setup failed: ' + error.name); process.exitCode = 1 })
