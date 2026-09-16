#!/usr/bin/env node
/* Read-only J08 recovery supplement. It drops one real read response at a time,
 * fences domain writers before transport, and never invokes provider controls. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
require('tsx/cjs')
const { chromium, expect: baseExpect } = require('@playwright/test')
const expect = baseExpect.configure({ timeout: 40_000 })
const { origin, providerBoundaries, ticketFacts } = require('./support/spec14Harness.ts')
const { verifiedIdentity, verificationSourceHashes } = require('./spec14-visual.cjs')

const root = path.resolve(__dirname, '../..')
const state = path.join(root, '.superpowers/spec14')
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

const readRpcs = new Set([
  'get_current_event_review_request', 'get_moderation_case', 'get_my_staff_role',
  'get_organizer_event_metrics', 'get_organizer_free_admissions',
  'get_organizer_free_registration_detail', 'get_organizer_free_registration_metrics',
  'get_organizer_order', 'get_organizer_order_v2', 'get_organizer_refund_notice_status',
  'get_organizer_refund_status', 'get_owned_event_cancellation_summary',
  'get_owned_event_change_context', 'get_owned_event_notice_status',
  'get_owned_event_requirements', 'get_public_event', 'get_public_event_ticketing',
  'get_public_free_rsvp', 'get_required_event_policies', 'get_ticket_email_delivery',
  'get_ticket_email_resend_status', 'list_moderation_queue',
  'list_organizer_event_admissions', 'list_organizer_event_orders_filtered',
  'list_owned_ticket_tiers', 'preview_owned_event_notice',
])
const readFunctions = new Set([
  'event-status-access', 'free-rsvp-status', 'order-confirmation', 'public-discovery',
  'refund-detail-access', 'stripe-connect-status', 'ticket-collection',
  'ticket-email-access', 'ticket-email-status',
])

function requestBody(request) {
  try { return request.postDataJSON() ?? {} } catch { return {} }
}

function readControl({ path: pathname, body = {} }) {
  let armed = false
  let attempts = 0
  let intercepted = 0
  return {
    arm() {
      if (armed) throw new Error('Read control is already armed')
      armed = true
    },
    matches(request) {
      const url = new URL(request.url())
      if (request.method() !== 'POST' || url.pathname !== pathname) return false
      const actual = requestBody(request)
      if (Object.entries(body).some(([key, value]) => actual[key] !== value)) return false
      attempts += 1
      if (!armed) return false
      armed = false
      intercepted += 1
      return true
    },
    summary: () => ({ attempts, intercepted }),
  }
}

function businessWriter(request) {
  const url = new URL(request.url())
  if (url.hostname !== '127.0.0.1' || !['3040', '55647'].includes(url.port)) return null
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.slice('/rest/v1/rpc/'.length)
    return readRpcs.has(name) ? null : `rpc:${name || 'unknown'}`
  }
  if (url.pathname.startsWith('/functions/v1/')) {
    const name = url.pathname.slice('/functions/v1/'.length)
    return readFunctions.has(name) ? null : `function:${name || 'unknown'}`
  }
  if (url.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
    return `rest:${url.pathname.slice('/rest/v1/'.length).split('/')[0] || 'unknown'}`
  }
  return null
}

function rsvpConfirmationPath(collectionUrl) {
  let url
  try { url = new URL(collectionUrl) } catch { throw new Error('Original free collection URL unavailable') }
  const prefix = origin + '/tickets/'
  if (!url.href.startsWith(prefix) || url.origin !== origin || url.search || url.hash) throw new Error('Original free collection URL unavailable')
  const bearer = url.pathname.slice('/tickets/'.length)
  if (!bearer || bearer.includes('/')) throw new Error('Original free collection URL unavailable')
  return '/rsvp/' + bearer
}

async function readOnlyContext(browser, storageState) {
  const context = await browser.newContext({
    ...(storageState ? { storageState } : {}),
    viewport: { width: 390, height: 960 },
    reducedMotion: 'reduce',
  })
  context.setDefaultTimeout(40_000)
  const blocked = await providerBoundaries(context, { allowProviderActions: false })
  const writers = []
  await context.route('**/*', route => {
    const label = businessWriter(route.request())
    if (!label) return route.fallback()
    writers.push(label)
    return route.abort('blockedbyclient')
  })
  return { context, blocked, writers }
}

async function installReadControl(context, control) {
  await context.route('**/*', route => control.matches(route.request()) ? route.abort('failed') : route.fallback())
}

async function main() {
  const startedAt = new Date().toISOString()
  const runner = 'tests/e2e/spec14-j08-read-recovery.cjs'
  const sourceHashes = verificationSourceHashes(runner)
  const identity = await verifiedIdentity()
  const scenarioFile = path.join(state, 'scenario.json')
  const providerFile = path.join(state, 'provider-state.json')
  const scenarioHash = hashFile(scenarioFile)
  const providerHash = hashFile(providerFile)
  const data = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'))
  if (!data.freeEventId || !data.freeRegistrationId || !data.freeBuyerUrl || !data.results?.J04) {
    throw new Error('Original J03/J04 free source prerequisite unavailable')
  }
  const before = ticketFacts(data.freeRegistrationId, true)
  const selected = before.find(ticket => ticket.status === 'valid')
  if (!selected || before.length !== 3) throw new Error('Original free ticket facts unavailable')

  const out = path.join(state, 'j08-read-recovery-' + Date.now())
  fs.mkdirSync(out, { mode: 0o700 })
  const reportFile = path.join(out, 'report.json')
  const results = []
  const limitations = []
  let browser = null
  let outcome = 'partial'
  let failure = null
  let stage = 'setup'
  let writerRequests = 0
  let blockedRequests = 0
  let pageErrors = 0
  let ticketsPreserved = null
  let scenarioPreserved = null
  let providerPreserved = null
  const save = () => fs.writeFileSync(reportFile, JSON.stringify({
    startedAt, finishedAt: new Date().toISOString(), identity, sourceHashes, outcome,
    failure, writerRequests, blockedRequests, pageErrors, ticketsPreserved,
    scenarioPreserved, providerPreserved, results, limitations,
    scope: 'Original J03 free source and J04 accepted delivery; real application readers; one-shot browser response loss only; all domain writers fenced before transport; provider actions disabled; no seed/reset/provider control. Pagination failure runs only when the actual original search exposes a next page.',
  }, null, 2), { mode: 0o600 })
  save()

  try {
    browser = await chromium.launch({ args: ['--no-proxy-server'] })

    stage = 'email-status:setup'
    const email = await readOnlyContext(browser)
    const emailControl = readControl({
      path: '/functions/v1/ticket-email-status',
      body: { collectionBearer: new URL(data.freeBuyerUrl).pathname.slice('/tickets/'.length) },
    })
    await installReadControl(email.context, emailControl)
    emailControl.arm()
    const emailPage = await email.context.newPage()
    emailPage.on('pageerror', () => { pageErrors += 1 })
    try {
      stage = 'email-status:dropped-read'
      await emailPage.goto(origin + rsvpConfirmationPath(data.freeBuyerUrl), { waitUntil: 'networkidle' })
      await expect(emailPage.locator('.buyer-confirmation__success h1')).toBeVisible()
      await expect(emailPage.getByText('Email status unavailable', { exact: true })).toBeVisible()
      await expect(emailPage.getByRole('link', { name: /^View tickets?$/, exact: true })).toBeVisible()
      stage = 'email-status:recovery'
      await emailPage.getByRole('button', { name: 'Check email status', exact: true }).click()
      await expect(emailPage.getByText('Email accepted', { exact: true })).toBeVisible()
      if (emailControl.summary().intercepted !== 1 || emailControl.summary().attempts < 2) throw new Error('Email status did not use one dropped read followed by a real retry')
      results.push({ check: 'original free collection email status', outcome: 'passed', ...emailControl.summary(), ticketsRemainedAvailable: true })
    } finally {
      writerRequests += email.writers.length; blockedRequests += email.blocked.length
      await email.context.close()
    }

    stage = 'free-detail:setup'
    const organizer = await readOnlyContext(browser, path.join(state, 'browser-organizer.json'))
    const detailControl = readControl({
      path: '/rest/v1/rpc/get_organizer_free_registration_detail',
      body: { p_event_id: data.freeEventId, p_registration_id: data.freeRegistrationId },
    })
    await installReadControl(organizer.context, detailControl)
    const detailPage = await organizer.context.newPage()
    detailPage.on('pageerror', () => { pageErrors += 1 })
    try {
      const detailPath = `/organizer/events/${data.freeEventId}/check-in/find/registrations/${data.freeRegistrationId}/${selected.id}`
      await detailPage.goto(origin + detailPath, { waitUntil: 'networkidle' })
      await expect(detailPage.getByRole('heading', { name: 'Guest Details', exact: true })).toBeVisible()
      await expect(detailPage.getByRole('button', { name: 'Check in guest', exact: true })).toBeVisible()

      stage = 'free-detail:dropped-stale-refresh'
      detailControl.arm()
      await detailPage.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
      const refreshAlert = detailPage.locator('p[role="alert"]').filter({ hasText: 'Ticket status could not refresh' })
      await expect(refreshAlert).toBeVisible()
      await expect(detailPage.getByRole('heading', { name: 'Guest Details', exact: true })).toBeVisible()
      await expect(detailPage.getByRole('button', { name: 'Check in guest', exact: true })).toHaveCount(0)
      stage = 'free-detail:recovery'
      await detailPage.getByRole('button', { name: 'Refresh ticket', exact: true }).click()
      await expect(refreshAlert).toHaveCount(0)
      await expect(detailPage.getByRole('button', { name: 'Check in guest', exact: true })).toBeVisible()
      if (detailControl.summary().intercepted !== 1 || detailControl.summary().attempts < 3) throw new Error('Selected detail did not warm, fail once, and recover from the real reader')
      results.push({ check: 'cached selected free detail refresh', outcome: 'passed', ...detailControl.summary(), cachedFactsVisibleDuringFailure: true, admissionUnavailableDuringFailure: true })

      stage = 'pagination:actual-original-search'
      await detailPage.goto(origin + `/organizer/events/${data.freeEventId}/check-in/find`, { waitUntil: 'networkidle' })
      const search = detailPage.getByLabel('Search guest name or email', { exact: true })
      await search.fill('Free Guest')
      await detailPage.getByRole('button', { name: 'Search', exact: true }).click()
      const rows = detailPage.locator('.find-guest__results > li')
      await expect(rows.first()).toBeVisible()
      const firstPageCount = await rows.count()
      const loadMore = detailPage.getByRole('button', { name: 'Load more guests', exact: true })
      if (await loadMore.isVisible().catch(() => false)) {
        const pageControl = readControl({
          path: '/rest/v1/rpc/get_organizer_free_admissions',
          body: { p_event_id: data.freeEventId, p_search: 'Free Guest' },
        })
        await installReadControl(organizer.context, pageControl)
        pageControl.arm()
        await loadMore.click()
        await expect(detailPage.getByRole('heading', { name: 'More guests could not load', exact: true })).toBeVisible()
        await expect(rows).toHaveCount(firstPageCount)
        await detailPage.getByRole('button', { name: 'Retry loading guests', exact: true }).click()
        await expect.poll(() => rows.count()).toBeGreaterThan(firstPageCount)
        results.push({ check: 'actual free search pagination failure', outcome: 'passed', firstPageCount, recoveredCount: await rows.count(), ...pageControl.summary() })
      } else {
        limitations.push({ check: 'free search pagination failure', disposition: 'not exercised', actualMatchingAdmissions: firstPageCount, reason: 'The real original search exposed no next page; no registrations were fabricated.' })
      }
    } finally {
      writerRequests += organizer.writers.length; blockedRequests += organizer.blocked.length
      await organizer.context.close()
    }

    stage = 'public-ticketing:setup'
    const publicRead = await readOnlyContext(browser)
    const publicControl = readControl({
      path: '/rest/v1/rpc/get_public_event_ticketing',
      body: { p_event_id: data.freeEventId },
    })
    await installReadControl(publicRead.context, publicControl)
    publicControl.arm()
    const publicPage = await publicRead.context.newPage()
    publicPage.on('pageerror', () => { pageErrors += 1 })
    try {
      stage = 'public-ticketing:dropped-read'
      await publicPage.goto(origin + `/events/${data.freeEventId}`, { waitUntil: 'networkidle' })
      await expect(publicPage.getByRole('heading', { name: 'Event could not load', exact: true })).toBeVisible()
      stage = 'public-ticketing:recovery'
      await publicPage.getByRole('button', { name: 'Try again', exact: true }).click()
      await expect(publicPage.getByRole('heading', { name: 'Free RSVP', exact: true, level: 2 })).toBeVisible()
      await expect(publicPage.getByText('No payment required.', { exact: true })).toBeVisible()
      if (publicControl.summary().intercepted !== 1 || publicControl.summary().attempts < 2) throw new Error('Public ticketing did not use one dropped read followed by a real retry')
      results.push({ check: 'public ticketing unavailable and recovery', outcome: 'passed', ...publicControl.summary(), freeEventRecovered: true })
      limitations.push({ check: 'sold-out public presentation', disposition: 'not exercised', reason: 'The preserved original public sources are not sold out; no ticket inventory or public response was fabricated.' })
    } finally {
      writerRequests += publicRead.writers.length; blockedRequests += publicRead.blocked.length
      await publicRead.context.close()
    }

    if (writerRequests || blockedRequests || pageErrors) throw new Error('Unexpected writer, outbound boundary, or page error')
    stage = 'verification-source-binding'
    if (JSON.stringify(verificationSourceHashes(runner)) !== JSON.stringify(sourceHashes)) throw new Error('Verification source changed during execution')
    scenarioPreserved = hashFile(scenarioFile) === scenarioHash
    providerPreserved = hashFile(providerFile) === providerHash
    ticketsPreserved = JSON.stringify(ticketFacts(data.freeRegistrationId, true)) === JSON.stringify(before)
    if (!scenarioPreserved || !providerPreserved || !ticketsPreserved) throw new Error('Read-only preservation check failed')
    outcome = 'passed'
  } catch (error) {
    failure = { name: error.name, stage }
    throw error
  } finally {
    await browser?.close()
    try { ticketsPreserved = JSON.stringify(ticketFacts(data.freeRegistrationId, true)) === JSON.stringify(before) } catch { ticketsPreserved = null }
    try { scenarioPreserved = hashFile(scenarioFile) === scenarioHash } catch { scenarioPreserved = null }
    try { providerPreserved = hashFile(providerFile) === providerHash } catch { providerPreserved = null }
    if (ticketsPreserved !== true || scenarioPreserved !== true || providerPreserved !== true) {
      outcome = 'partial'
      failure ??= { name: 'PreservationError', stage: 'final-preservation-read' }
    }
    save()
  }
  console.log(JSON.stringify({ directory: path.basename(out), checks: results.length, limitations: limitations.length, writerRequests, blockedRequests, pageErrors, outcome }))
}

module.exports = { businessWriter, readControl, rsvpConfirmationPath }
if (require.main === module) main().catch(() => {
  console.error('J08 read recovery check failed; inspect the private report.')
  process.exitCode = 1
})
