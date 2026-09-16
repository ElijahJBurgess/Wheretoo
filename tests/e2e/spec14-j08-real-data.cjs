#!/usr/bin/env node
/* Bounded real-UI data for pagination and full-capacity J08 checks. No app
 * response or row is fabricated; fixture writes occur only through real UI. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
require('tsx/cjs')
const { chromium, expect: baseExpect } = require('@playwright/test')
const expect = baseExpect.configure({ timeout: 40_000 })
const {
  control, dbJson, origin, providerBoundaries, quote, realContext, ticketFacts,
  wallMinute,
} = require('./support/spec14Harness.ts')
const { validateFixture } = require('./spec14-b2-payments.cjs')
const { businessWriter, readControl } = require('./spec14-j08-read-recovery.cjs')
const { verifiedIdentity, verificationSourceHashes } = require('./spec14-visual.cjs')
const { sanitizeSpec14Evidence } = require('./spec14-reporter.ts')

const root = path.resolve(__dirname, '../..')
const state = path.join(root, '.superpowers/spec14')
const b2File = path.join(state, 'b2-payments-fixture.json')
const ledgerFile = path.join(state, 'j08-real-data-fixture.json')
const scenarioFile = path.join(state, 'scenario.json')
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const importedVerificationSources = [
  'tests/e2e/spec14-j08-read-recovery.cjs',
  'tests/e2e/spec14-b2-payments.cjs',
]

function executionPlan(args) {
  if (args.length === 0) return { mode: 'setup', allowFixtureWrites: true, allowProviderControls: true }
  if (args.length === 1 && args[0] === '--read-only') return { mode: 'read-only', allowFixtureWrites: false, allowProviderControls: false }
  throw new Error('Invalid execution mode; use --read-only or no argument')
}

async function runFixturePhase(execution, action) {
  if (!execution.allowFixtureWrites) return false
  await action()
  return true
}

function datasetPlan() {
  return {
    pagination: { capacity: 30, quantities: [10, 10, 10], expectedAdmissions: 30 },
    full: { capacity: 1, quantities: [1], expectedAdmissions: 1 },
  }
}

function approvedDisclosureValues() {
  return {
    minimumAge: 'all_ages',
    alcoholPresent: false,
    cannabisPresent: false,
    explicitAdultContent: false,
    gamblingPresent: false,
    weaponsPresent: false,
    highRiskActivity: false,
  }
}

function boundedFailureMessage(error) {
  const message = error instanceof Error ? error.message : 'Unknown runner failure'
  return sanitizeSpec14Evidence(message).slice(0, 600)
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
}

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const datasetDefinitions = {
  pagination: { titlePattern: /^Spec14 pagination [a-f0-9]{8}$/, name: 'Pagination Guest', quantities: [10, 10, 10] },
  full: { titlePattern: /^Spec14 full [a-f0-9]{8}$/, name: 'Full Guest', quantities: [1] },
}

function registrationEmail(name, index, eventId) {
  return `j08-${name.toLowerCase().replaceAll(' ', '-')}-${index}-${eventId.slice(0, 8)}@spec14.test`
}

function validPrivateCollectionUrl(value) {
  try {
    const url = new URL(value)
    const bearer = url.pathname.slice('/tickets/'.length)
    return url.origin === origin && url.username === '' && url.password === ''
      && url.search === '' && url.hash === '' && url.pathname.startsWith('/tickets/')
      && bearer.length > 0 && !bearer.includes('/') && url.href === value
  } catch { return false }
}

function validateDatasetLedger(value) {
  if (!exactKeys(value, ['version', 'pagination', 'full']) || value.version !== 1) throw new Error('Dataset ledger is invalid')
  for (const name of ['pagination', 'full']) {
    const definition = datasetDefinitions[name]
    const item = value[name]
    if (!exactKeys(item, ['eventId', 'title', 'registrations']) || typeof item.title !== 'string'
      || !definition.titlePattern.test(item.title)
      || (item.eventId !== null && (typeof item.eventId !== 'string' || !uuidPattern.test(item.eventId)))
      || !Array.isArray(item.registrations) || item.registrations.length > definition.quantities.length
      || (item.eventId === null && item.registrations.length !== 0)) throw new Error('Dataset ledger is invalid')
    for (const [index, registration] of item.registrations.entries()) {
      if (!exactKeys(registration, ['name', 'email', 'quantity', 'registrationId', 'collectionUrl'])
        || registration.name !== definition.name
        || registration.email !== registrationEmail(definition.name, index, item.eventId)
        || registration.quantity !== definition.quantities[index]
        || typeof registration.registrationId !== 'string' || !uuidPattern.test(registration.registrationId)
        || typeof registration.collectionUrl !== 'string' || !validPrivateCollectionUrl(registration.collectionUrl)) {
        throw new Error('Dataset ledger is invalid')
      }
    }
  }
  return value
}

function assertReadOnlyLedgerComplete(value) {
  validateDatasetLedger(value)
  if (!value.pagination.eventId || value.pagination.registrations.length !== 3
    || !value.full.eventId || value.full.registrations.length !== 1) {
    throw new Error('Read-only execution requires both exact completed retained datasets')
  }
  return true
}

function assertDatasetEvent(row, expected, options = {}) {
  const valid = exactKeys(row, ['id', 'organizerId', 'title', 'admissionType', 'capacity', 'status', 'moderationStatus', 'publishedAt'])
    && uuidPattern.test(row.id) && uuidPattern.test(row.organizerId)
    && row.id === expected.eventId && row.organizerId === expected.organizerId
    && row.title === expected.title && row.admissionType === 'free' && row.capacity === expected.capacity
    && ['draft', 'published'].includes(row.status)
    && ['not_evaluated', 'under_review', 'clear'].includes(row.moderationStatus)
    && ((row.status === 'draft' && row.publishedAt === null)
      || (row.status === 'published' && typeof row.publishedAt === 'string' && Number.isFinite(Date.parse(row.publishedAt))))
    && (!options.requirePublic || (row.status === 'published' && row.moderationStatus === 'clear'))
  if (!valid) throw new Error('Dataset event identity or lifecycle is invalid')
  return true
}

function assertDatasetRegistration(row, expected) {
  const valid = exactKeys(row, ['id', 'eventId', 'organizerId', 'name', 'email', 'quantity', 'status', 'cancelledAt', 'ticketCount'])
    && uuidPattern.test(row.id) && uuidPattern.test(row.eventId) && uuidPattern.test(row.organizerId)
    && row.id === expected.registrationId && row.eventId === expected.eventId
    && row.organizerId === expected.organizerId && row.name === expected.name
    && row.email === expected.email && row.quantity === expected.quantity
    && row.status === 'confirmed' && row.cancelledAt === null && row.ticketCount === expected.quantity
  if (!valid) throw new Error('Dataset registration identity or tickets are invalid')
  return true
}

function assertUnusedTickets(tickets, expectedQuantity) {
  if (!Array.isArray(tickets) || tickets.length !== expectedQuantity
    || tickets.some((ticket, index) => ticket.status !== 'valid' || ticket.usedAt !== null || ticket.position !== index + 1)) {
    throw new Error('Retained dataset ticket facts differ from the private ledger')
  }
  return true
}

function assertModerationClaimTarget(row, expected) {
  const valid = exactKeys(row, ['evaluationId', 'eventId', 'status', 'attemptCount'])
    && uuidPattern.test(row.evaluationId) && uuidPattern.test(row.eventId)
    && row.evaluationId === expected.evaluationId && row.eventId === expected.eventId
    && row.status === 'queued' && row.attemptCount === 0
  if (!valid) throw new Error('Moderation claim does not target the fresh dataset evaluation')
  return true
}

function assertModerationWorkerPreflight(rows, expected) {
  const validRows = Array.isArray(rows) && rows.every(row =>
    exactKeys(row, ['evaluationId', 'eventId', 'status', 'attemptCount', 'createdAt'])
    && uuidPattern.test(row.evaluationId) && uuidPattern.test(row.eventId)
    && ['queued', 'processing'].includes(row.status)
    && Number.isInteger(row.attemptCount) && row.attemptCount >= 0
    && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)))
  const terminalLeaseRisk = validRows && rows.some(row => row.status === 'processing' && row.attemptCount >= 3)
  const candidates = validRows ? rows.filter(row => row.attemptCount < 3) : []
  const first = candidates[0]
  const exactTarget = first && first.evaluationId === expected.evaluationId && first.eventId === expected.eventId
    && first.status === 'queued' && first.attemptCount === 0
  if (!validRows || terminalLeaseRisk || !exactTarget) {
    throw new Error('Moderation preflight cannot isolate the fresh dataset evaluation')
  }
  return true
}

function assertModerationWorkerResult(value, evaluationId) {
  const valid = exactKeys(value, ['outcome', 'name', 'handlerStatus', 'body'])
    && value.outcome === 'invoked' && value.name === 'moderate-event-queue' && value.handlerStatus === 200
    && exactKeys(value.body, ['status', 'evaluationId', 'disposition'])
    && value.body.status === 'processed' && value.body.evaluationId === evaluationId && value.body.disposition === 'applied'
  if (!valid) throw new Error('Moderation worker did not apply the exact dataset evaluation')
  return true
}

function saveLedger(value) {
  validateDatasetLedger(value)
  fs.writeFileSync(ledgerFile, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(ledgerFile, 0o600)
}

function loadLedger(readOnly = false) {
  if (fs.existsSync(ledgerFile)) return validateDatasetLedger(JSON.parse(fs.readFileSync(ledgerFile, 'utf8')))
  if (readOnly) throw new Error('Read-only execution requires the retained dataset ledger')
  const run = randomUUID().slice(0, 8)
  const value = {
    version: 1,
    pagination: { eventId: null, title: `Spec14 pagination ${run}`, registrations: [] },
    full: { eventId: null, title: `Spec14 full ${run}`, registrations: [] },
  }
  saveLedger(value)
  return value
}

async function login(page, fixture) {
  await page.goto(origin + '/organizer/events')
  if (new URL(page.url()).pathname === '/auth/sign-in') {
    await page.getByLabel('Email', { exact: true }).fill(fixture.email)
    await page.getByLabel('Password', { exact: true }).fill(fixture.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname.startsWith('/organizer/'))
  }
}

function datasetEventFacts(eventId) {
  return dbJson(`select jsonb_build_object('id',id,'organizerId',organizer_id,'title',title,'admissionType',admission_type,'capacity',capacity,'status',status,'moderationStatus',moderation_status,'publishedAt',published_at) from public.events where id=${quote(eventId)};`)
}

function datasetRegistrationFacts(registrationId) {
  return dbJson(`select jsonb_build_object('id',r.id,'eventId',r.event_id,'organizerId',r.organizer_id,'name',r.name,'email',r.email,'quantity',r.quantity,'status',r.status,'cancelledAt',r.cancelled_at,'ticketCount',(select count(*) from public.tickets t where t.registration_id=r.id)) from public.free_registrations r where r.id=${quote(registrationId)};`)
}

function moderationQueueSnapshot() {
  return dbJson(`select coalesce(jsonb_agg(jsonb_build_object('evaluationId',evaluations.id,'eventId',evaluations.event_id,'status',evaluations.status,'attemptCount',evaluations.attempt_count,'createdAt',evaluations.created_at) order by evaluations.created_at,evaluations.id),'[]'::jsonb) from private.event_moderation_evaluations as evaluations where evaluations.source in ('contextual','report') and evaluations.status in ('queued','processing');`)
}

function outsideEvaluationFacts(evaluationId) {
  return dbJson(`select coalesce(jsonb_agg(to_jsonb(evaluations) order by evaluations.id),'[]'::jsonb) from private.event_moderation_evaluations as evaluations where evaluations.id<>${quote(evaluationId)};`)
}

async function ensureFreeEvent(page, fixture, entry, capacity, reportStage) {
  reportStage('identity')
  if (!entry.eventId) {
    const rows = dbJson(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'organizerId',organizer_id,'title',title,'admissionType',admission_type,'capacity',capacity,'status',status,'moderationStatus',moderation_status,'publishedAt',published_at)), '[]'::jsonb) from public.events where organizer_id=${quote(fixture.organizerId)} and title=${quote(entry.title)};`)
    if (rows.length > 1) throw new Error('Free dataset event is ambiguous or terminal')
    if (rows[0]) entry.eventId = rows[0].id
  }
  if (!entry.eventId) {
    reportStage('create-event')
    await page.goto(origin + '/organizer/events/new')
    await page.getByLabel('Event name', { exact: true }).fill(entry.title)
    await page.getByLabel('Description', { exact: true }).fill('Task-only real UI event for bounded pagination and capacity verification.')
    await page.getByLabel('Category', { exact: true }).selectOption('community')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    const start = new Date(Date.now() + 6 * 86_400_000)
    await page.getByLabel('Starts', { exact: true }).fill(wallMinute(start))
    await page.getByLabel('Ends', { exact: true }).fill(wallMinute(new Date(start.getTime() + 2 * 3_600_000)))
    await page.getByLabel('Venue name', { exact: true }).fill('Spec14 Dataset Hall')
    await page.getByPlaceholder('Search for a California address').fill('1 Market Street')
    await page.getByRole('option').filter({ hasText: /1 Market Street/ }).first().click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('radio', { name: /Free RSVP/ }).check()
    await page.getByLabel('Capacity (optional)', { exact: true }).fill(String(capacity))
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    reportStage('wait-for-saved-details')
    await page.waitForURL(url => /\/organizer\/events\/[0-9a-f-]{36}\/edit/.test(url.pathname)
      && url.searchParams.get('step') === 'details')
    await expect(page.getByRole('heading', { name: 'Organizer agreement', exact: true })).toBeVisible()
    entry.eventId = new URL(page.url()).pathname.split('/')[3]
    saveLedger(ledger)
  } else await page.goto(origin + `/organizer/events/${entry.eventId}/edit?step=details`)
  const expected = { eventId: entry.eventId, organizerId: fixture.organizerId, title: entry.title, capacity }
  let event = datasetEventFacts(entry.eventId)
  assertDatasetEvent(event, expected)
  if (event.status === 'draft') {
    reportStage('requirements-and-agreement')
    await expect(page.getByRole('heading', { name: 'Organizer agreement', exact: true })).toBeVisible()
    const { minimumAge, ...disclosures } = approvedDisclosureValues()
    await page.getByLabel('Minimum age', { exact: true }).selectOption(minimumAge)
    for (const [name, value] of Object.entries(disclosures)) {
      await page.locator(`input[name="${name}"][value="${value}"]`).check()
    }
    await page.getByRole('checkbox', { name: /I confirm that this event information/ }).check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForURL(url => url.pathname.endsWith('/preview'))
    reportStage('publish')
    await page.getByRole('button', { name: 'Publish event', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm and publish', exact: true }).click()
    await expect.poll(() => dbJson(`select jsonb_build_object('status',status) from public.events where id=${quote(entry.eventId)};`).status).toBe('published')
    event = datasetEventFacts(entry.eventId)
  }
  if (event.status === 'published' && event.moderationStatus !== 'clear') {
    reportStage('moderation-preflight')
    const own = dbJson(`select coalesce((select jsonb_build_object('evaluationId',id,'eventId',event_id,'status',status,'attemptCount',attempt_count,'createdAt',created_at) from private.event_moderation_evaluations where event_id=${quote(entry.eventId)} and source in ('contextual','report') and status='queued' and attempt_count=0 order by created_at desc,id desc limit 1),'null'::jsonb);`)
    if (!own) throw new Error('Dataset event has no fresh moderation evaluation')
    assertModerationWorkerPreflight(moderationQueueSnapshot(), own)
    const outsideBefore = outsideEvaluationFacts(own.evaluationId)
    reportStage('moderation-worker')
    const result = await control({ action: 'run-worker', name: 'moderate-event-queue' })
    assertModerationWorkerResult(result, own.evaluationId)
    if (JSON.stringify(outsideEvaluationFacts(own.evaluationId)) !== JSON.stringify(outsideBefore)) {
      throw new Error('Moderation worker changed an evaluation outside the dataset target')
    }
  }
  reportStage('public-event-verification')
  assertDatasetEvent(datasetEventFacts(entry.eventId), expected, { requirePublic: true })
}

async function rsvp(browser, fixture, entry, quantity, index, commonName) {
  if (entry.registrations[index]) {
    assertDatasetRegistration(datasetRegistrationFacts(entry.registrations[index].registrationId), {
      ...entry.registrations[index], eventId: entry.eventId, organizerId: fixture.organizerId,
    })
    return { blocked: 0, pageErrors: 0 }
  }
  const email = `j08-${commonName.toLowerCase().replaceAll(' ', '-')}-${index}-${entry.eventId.slice(0, 8)}@spec14.test`
  const existing = dbJson(`select coalesce(jsonb_agg(id), '[]'::jsonb) from public.free_registrations where event_id=${quote(entry.eventId)} and email=${quote(email)};`)
  if (existing.length) throw new Error('RSVP committed without its private ledger URL; no replacement allowed')
  const buyer = await realContext(browser, `j08-${commonName.toLowerCase().replaceAll(' ', '-')}-${index}`)
  let pageErrors = 0
  buyer.page.on('pageerror', () => { pageErrors += 1 })
  try {
    await buyer.page.goto(origin + `/events/${entry.eventId}/rsvp`)
    await expect(buyer.page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
    if (quantity > 1) await buyer.page.getByRole('button', { name: 'Increase quantity', exact: true }).click({ clickCount: quantity - 1 })
    await buyer.page.getByRole('button', { name: 'Continue', exact: true }).click()
    await buyer.page.getByLabel('Full name', { exact: true }).fill(commonName)
    await buyer.page.getByLabel('Email address', { exact: true }).fill(email)
    await buyer.page.getByRole('button', { name: 'Confirm RSVP', exact: true }).click()
    const link = buyer.page.getByRole('link', { name: /^View tickets?$/, exact: true })
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    if (!href) throw new Error('Real RSVP did not expose its private collection')
    const rows = dbJson(`select coalesce(jsonb_agg(id), '[]'::jsonb) from public.free_registrations where event_id=${quote(entry.eventId)} and email=${quote(email)};`)
    if (rows.length !== 1) throw new Error('Real RSVP identity is ambiguous')
    const retained = { name: commonName, email, quantity, registrationId: rows[0], collectionUrl: new URL(href, origin).href }
    entry.registrations.push(retained)
    saveLedger(ledger)
    assertDatasetRegistration(datasetRegistrationFacts(retained.registrationId), {
      ...retained, eventId: entry.eventId, organizerId: fixture.organizerId,
    })
  } finally { await buyer.close() }
  return { blocked: buyer.blocked.length, pageErrors }
}

function datasetFacts(value) {
  return Object.fromEntries(['pagination', 'full'].map(name => [name, {
    event: dbJson(`select to_jsonb(e) from public.events e where id=${quote(value[name].eventId)};`),
    registrations: dbJson(`select coalesce(jsonb_agg(to_jsonb(r) order by created_at,id),'[]'::jsonb) from public.free_registrations r where event_id=${quote(value[name].eventId)};`),
    tickets: value[name].registrations.map(item => ticketFacts(item.registrationId, true)),
  }]))
}

function assertRetainedDatasetFacts(value, organizerId, plan) {
  assertReadOnlyLedgerComplete(value)
  for (const name of ['pagination', 'full']) {
    const entry = value[name]
    assertDatasetEvent(datasetEventFacts(entry.eventId), {
      eventId: entry.eventId, organizerId, title: entry.title, capacity: plan[name].capacity,
    }, { requirePublic: true })
    const actualRegistrationIds = dbJson(`select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from public.free_registrations where event_id=${quote(entry.eventId)};`)
    const expectedRegistrationIds = entry.registrations.map(item => item.registrationId).sort()
    if (JSON.stringify(actualRegistrationIds) !== JSON.stringify(expectedRegistrationIds)) throw new Error('Retained dataset registrations differ from the private ledger')
    for (const registration of entry.registrations) {
      assertDatasetRegistration(datasetRegistrationFacts(registration.registrationId), {
        ...registration, eventId: entry.eventId, organizerId,
      })
      const tickets = ticketFacts(registration.registrationId, true)
      assertUnusedTickets(tickets, registration.quantity)
    }
  }
  return true
}

async function readOnlyOwnerContext(browser, role, writers) {
  const storagePath = path.join(state, 'browser-' + role + '.json')
  const context = await browser.newContext({
    ...(fs.existsSync(storagePath) ? { storageState: storagePath } : {}),
    viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce',
  })
  context.setDefaultTimeout(40_000)
  context.setDefaultNavigationTimeout(40_000)
  const blocked = await providerBoundaries(context, { allowProviderActions: false })
  await context.route('**/*', route => {
    const label = businessWriter(route.request())
    if (!label) return route.fallback()
    writers.push(label); return route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  return { context, page, blocked, async close() { await context.close() } }
}

let ledger
async function main() {
  const runner = 'tests/e2e/spec14-j08-real-data.cjs'
  const execution = executionPlan(process.argv.slice(2))
  const startedAt = new Date().toISOString()
  const sourceHashes = verificationSourceHashes(runner, ...importedVerificationSources)
  const identity = await verifiedIdentity()
  const scenarioHash = hashFile(scenarioFile)
  const fixture = validateFixture(JSON.parse(fs.readFileSync(b2File, 'utf8')))
  ledger = loadLedger(execution.mode === 'read-only')
  if (execution.mode === 'read-only') assertReadOnlyLedgerComplete(ledger)
  const plan = datasetPlan()
  const out = path.join(state, 'j08-real-data-' + Date.now())
  fs.mkdirSync(out, { mode: 0o700 })
  const reportFile = path.join(out, 'report.json')
  const results = []
  let browser = null, outcome = 'partial', failure = null, stage = 'fixtures', writers = [], blockedRequests = 0, pageErrors = 0, datasetsPreserved = null, scenarioPreserved = null, moderationRestored = execution.mode === 'read-only' ? true : null
  const save = () => fs.writeFileSync(reportFile, JSON.stringify({
    startedAt, finishedAt: new Date().toISOString(), identity, sourceHashes, outcome, failure,
    writerRequests: writers.length,
    executionMode: execution.mode,
    writerRequestsScope: execution.mode === 'read-only'
      ? 'All browser work in this execution; fixture and provider setup phases are disabled.'
      : 'Post-fixture read-only checks only. Authorized source creation uses real UI before this fence and is recorded separately below.',
    authorizedFixtureWrites: {
      eventIds: { pagination: ledger.pagination.eventId, full: ledger.full.eventId },
      registrationIds: {
        pagination: ledger.pagination.registrations.map(item => item.registrationId),
        full: ledger.full.registrations.map(item => item.registrationId),
      },
    },
    blockedRequests, pageErrors, datasetsPreserved, scenarioPreserved, moderationRestored, results, plan,
    scope: execution.mode === 'read-only'
      ? 'Exact retained task-only free datasets are read and rendered with browser writers fenced before page work. No fixture, provider-mode, worker, publication or RSVP action is permitted.'
      : 'Two task-only secondary-organizer free events created/published through real UI: capacity30 with exactly three 10-admission RSVPs, and capacity1 with exactly one RSVP. Post-fixture checks fence all business writers. Local provider/moderation and Auth evidence only; no hosted claim.',
  }, null, 2), { mode: 0o600 })
  save()
  let frozen
  let priorModeration = null
  try {
    browser = await chromium.launch({ args: ['--no-proxy-server'] })
    const ranFixturePhase = await runFixturePhase(execution, async () => {
      priorModeration = (await control({ action: 'state' })).moderation.mode
      await control({ action: 'moderation-mode', mode: 'approve' })
      const owner = await realContext(browser, 'b2-secondary-organizer')
      try {
        await login(owner.page, fixture)
        await ensureFreeEvent(owner.page, fixture, ledger.pagination, plan.pagination.capacity, substage => { stage = `fixture-pagination:${substage}` })
        await ensureFreeEvent(owner.page, fixture, ledger.full, plan.full.capacity, substage => { stage = `fixture-full:${substage}` })
      } finally { blockedRequests += owner.blocked.length; await owner.close() }
      for (let index = 0; index < 3; index++) {
        stage = `fixture-pagination:rsvp-${index + 1}`
        const observed = await rsvp(browser, fixture, ledger.pagination, 10, index, 'Pagination Guest')
        blockedRequests += observed.blocked; pageErrors += observed.pageErrors
      }
      stage = 'fixture-full:rsvp-1'
      const fullObserved = await rsvp(browser, fixture, ledger.full, 1, 0, 'Full Guest')
      blockedRequests += fullObserved.blocked; pageErrors += fullObserved.pageErrors
    })
    if (!ranFixturePhase) {
      stage = 'read-only-retained-dataset-preflight'
      assertRetainedDatasetFacts(ledger, fixture.organizerId, plan)
    }
    const counts = {
      pagination: ledger.pagination.registrations.reduce((sum, item) => sum + ticketFacts(item.registrationId, true).length, 0),
      full: ledger.full.registrations.reduce((sum, item) => sum + ticketFacts(item.registrationId, true).length, 0),
    }
    if (counts.pagination !== 30 || counts.full !== 1) throw new Error('Real UI dataset count differs from bounded plan')
    frozen = datasetFacts(ledger)

    stage = 'pagination-failure-recovery'
    const check = execution.mode === 'read-only'
      ? await readOnlyOwnerContext(browser, 'b2-secondary-organizer', writers)
      : await realContext(browser, 'b2-secondary-organizer')
    const pageControl = readControl({ path: '/rest/v1/rpc/get_organizer_free_admissions', body: { p_event_id: ledger.pagination.eventId, p_search: 'Pagination Guest' } })
    if (execution.mode !== 'read-only') await check.context.route('**/*', route => {
      const label = businessWriter(route.request())
      if (!label) return route.fallback()
      writers.push(label); return route.abort('blockedbyclient')
    })
    await check.context.route('**/*', route => pageControl.matches(route.request()) ? route.abort('failed') : route.fallback())
    check.page.on('pageerror', () => { pageErrors += 1 })
    try {
      await login(check.page, fixture)
      await check.page.goto(origin + `/organizer/events/${ledger.pagination.eventId}/check-in/find`, { waitUntil: 'networkidle' })
      await check.page.getByLabel('Search guest name or email', { exact: true }).fill('Pagination Guest')
      await check.page.getByRole('button', { name: 'Search', exact: true }).click()
      const rows = check.page.locator('.find-guest__results > li')
      await expect(rows).toHaveCount(25)
      pageControl.arm()
      await check.page.getByRole('button', { name: 'Load more guests', exact: true }).click()
      await expect(check.page.getByRole('heading', { name: 'More guests could not load', exact: true })).toBeVisible()
      await expect(rows).toHaveCount(25)
      await check.page.getByRole('button', { name: 'Retry loading guests', exact: true }).click()
      await expect(rows).toHaveCount(30)
      results.push({ check: 'real free admissions pagination failure and recovery', outcome: 'passed', firstPage: 25, recovered: 30, ...pageControl.summary() })
    } finally { blockedRequests += check.blocked.length; await check.close() }

    stage = 'public-full'
    const publicContext = await browser.newContext({ viewport: { width: 390, height: 960 }, reducedMotion: 'reduce' })
    const blocked = await providerBoundaries(publicContext, { allowProviderActions: false })
    await publicContext.route('**/*', route => {
      const label = businessWriter(route.request())
      if (!label) return route.fallback()
      writers.push(label); return route.abort('blockedbyclient')
    })
    const page = await publicContext.newPage()
    page.on('pageerror', () => { pageErrors += 1 })
    try {
      await page.goto(origin + `/events/${ledger.full.eventId}/rsvp`, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'RSVP capacity reached', exact: true })).toBeVisible()
      results.push({ check: 'real public free capacity full', outcome: 'passed', capacity: 1, admissions: 1 })
    } finally { blockedRequests += blocked.length; await publicContext.close() }

    stage = 'preservation'
    datasetsPreserved = JSON.stringify(datasetFacts(ledger)) === JSON.stringify(frozen)
    scenarioPreserved = hashFile(scenarioFile) === scenarioHash
    if (!datasetsPreserved || !scenarioPreserved || writers.length || blockedRequests || pageErrors) throw new Error('Dataset preservation or boundary check failed')
    if (execution.allowProviderControls) {
      stage = 'moderation-mode-restoration'
      await control({ action: 'moderation-mode', mode: priorModeration })
      moderationRestored = true
    }
    stage = 'verification-source-binding'
    if (JSON.stringify(verificationSourceHashes(runner, ...importedVerificationSources)) !== JSON.stringify(sourceHashes)) throw new Error('Verification source changed during execution')
    outcome = 'passed'
  } catch (error) {
    failure = { name: error instanceof Error ? error.name : 'Error', stage, message: boundedFailureMessage(error) }; throw error
  } finally {
    await browser?.close()
    if (execution.allowProviderControls && moderationRestored !== true && priorModeration && ['approve', 'review', 'failed'].includes(priorModeration)) {
      try { await control({ action: 'moderation-mode', mode: priorModeration }); moderationRestored = true } catch { moderationRestored = false }
    }
    try { if (frozen) datasetsPreserved = JSON.stringify(datasetFacts(ledger)) === JSON.stringify(frozen) } catch { datasetsPreserved = null }
    try { scenarioPreserved = hashFile(scenarioFile) === scenarioHash } catch { scenarioPreserved = null }
    if (datasetsPreserved === false || scenarioPreserved !== true || moderationRestored !== true) { outcome = 'partial'; failure ??= { name: 'PreservationError', stage: 'final-preservation-read' } }
    save()
  }
  console.log(JSON.stringify({ directory: path.basename(out), checks: results.length, writerRequests: writers.length, blockedRequests, pageErrors, outcome }))
}

module.exports = {
  approvedDisclosureValues, assertDatasetEvent, assertDatasetRegistration, assertModerationClaimTarget,
  assertModerationWorkerPreflight, assertModerationWorkerResult, assertReadOnlyLedgerComplete, assertUnusedTickets, datasetPlan, executionPlan,
  boundedFailureMessage, registrationEmail, runFixturePhase, validateDatasetLedger,
}
if (require.main === module) main().catch(() => {
  console.error('J08 real-data supplement failed; inspect the private report.')
  process.exitCode = 1
})
