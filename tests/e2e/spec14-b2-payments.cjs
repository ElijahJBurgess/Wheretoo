#!/usr/bin/env node
/* Local B2 supplement: one isolated secondary organizer creates one unpublished
 * paid draft through the real UI. Negative checks then fence all event/tier/
 * publication writers and use only real reads plus one provider-script failure. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
require('tsx/cjs')
const { chromium, expect: baseExpect } = require('@playwright/test')
const expect = baseExpect.configure({ timeout: 40_000 })
const {
  confirmLocalSignup, dbJson, origin, quote, realContext, ticketFacts,
  wallMinute,
} = require('./support/spec14Harness.ts')
const { verifiedIdentity, verificationSourceHashes } = require('./spec14-visual.cjs')

const root = path.resolve(__dirname, '../..')
const state = path.join(root, '.superpowers/spec14')
const fixtureFile = path.join(state, 'b2-payments-fixture.json')
const scenarioFile = path.join(state, 'scenario.json')
const connectStatusRequestUrl = origin + '/functions/v1/stripe-connect-status'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const paidTierDefinitions = [
  { name: 'B2 General', price: '12.00', amount: 1200, capacity: 12 },
  { name: 'B2 Reserved', price: '18.00', amount: 1800, capacity: 8 },
]
const frozenReadRpcs = new Set([
  'get_current_event_review_request', 'get_my_staff_role', 'get_owned_event_change_context',
  'get_owned_event_requirements', 'get_organizer_event_metrics',
  'get_organizer_free_registration_metrics', 'get_public_event',
  'get_required_event_policies', 'list_owned_ticket_tiers',
])

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
}

function validateFixture(value) {
  if (!exactKeys(value, ['version', 'email', 'password', 'organizerId', 'paidDraft'])
    || value.version !== 1 || typeof value.email !== 'string' || typeof value.password !== 'string'
    || !uuid.test(value.organizerId) || !exactKeys(value.paidDraft, ['eventId', 'title', 'tierIds'])
    || !uuid.test(value.paidDraft.eventId) || typeof value.paidDraft.title !== 'string'
    || !Array.isArray(value.paidDraft.tierIds) || value.paidDraft.tierIds.length !== 2
    || value.paidDraft.tierIds.some(id => !uuid.test(id))) throw new Error('Private fixture ledger is invalid')
  return value
}

function saveFixture(value) {
  fs.writeFileSync(fixtureFile, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(fixtureFile, 0o600)
}

function sanitizedError(error) {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4).join(' | ')
    .replaceAll(root, '[root]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+/g, '[email]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[uuid]')
    .slice(0, 800)
}

function loadWorkingFixture() {
  if (fs.existsSync(fixtureFile)) return JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
  const run = randomUUID().slice(0, 8)
  const value = {
    version: 1,
    email: `b2-secondary-${run}@spec14.test`,
    password: 'Local-secondary-' + randomUUID(),
    organizerId: null,
    paidDraft: { eventId: null, title: `Spec14 B2 unpublished ${run}`, tierIds: [] },
  }
  saveFixture(value)
  return value
}

function existingDraftIdentity(rows) {
  if (!Array.isArray(rows) || rows.length > 1 || (rows[0] && rows[0].status !== 'draft')) throw new Error('Secondary paid fixture is ambiguous or terminal')
  return rows[0]?.id ?? null
}

function assertCompletedPaidDraft(source, fixture) {
  const eventId = fixture?.paidDraft?.eventId
  const tierIds = fixture?.paidDraft?.tierIds
  const event = source?.event
  const tiers = source?.tiers
  const eventMatches = event?.id === eventId && event?.organizer_id === fixture?.organizerId
    && event?.admission_type === 'paid' && event?.status === 'draft' && event?.published_at === null
  const tiersMatch = Array.isArray(tierIds) && tierIds.length === 2 && Array.isArray(tiers) && tiers.length === 2
    && tiers.every((tier, index) => tier.id === tierIds[index] && tier.event_id === eventId
      && tier.name === paidTierDefinitions[index].name
      && tier.unit_amount_minor === paidTierDefinitions[index].amount
      && tier.quantity_total === paidTierDefinitions[index].capacity
      && tier.currency === 'usd' && tier.sort_order === index + 1)
  if (!eventMatches || !tiersMatch) throw new Error('Completed fixture differs from its retained unpublished draft identity')
  return true
}

function assertDraftSetupTransition(before, after, fixture) {
  const eventId = fixture?.paidDraft?.eventId
  const ownerId = fixture?.organizerId
  const beforeEvent = before?.event
  const afterEvent = after?.event
  const disclosures = after?.disclosures
  const eventMatches = beforeEvent?.id === eventId && afterEvent?.id === eventId
    && beforeEvent?.organizerId === ownerId && afterEvent?.organizerId === ownerId
    && beforeEvent?.status === 'draft' && afterEvent?.status === 'draft'
    && beforeEvent?.publishedAt === null && afterEvent?.publishedAt === null
    && afterEvent?.contentRevision === beforeEvent?.contentRevision + 1
    && afterEvent?.moderationVersion === beforeEvent?.moderationVersion + 1
  const disclosuresMatch = disclosures?.minimumAge === 'all_ages'
    && ['alcoholPresent', 'cannabisPresent', 'explicitAdultContent', 'gamblingPresent', 'weaponsPresent', 'highRiskActivity']
      .every(name => disclosures[name] === false)
  const beforeEvaluations = Array.isArray(before?.evaluations) ? before.evaluations : []
  const afterEvaluations = Array.isArray(after?.evaluations) ? after.evaluations : []
  const immutableKeys = ['id', 'eventId', 'contentRevision', 'inputSha256', 'queuedModerationVersion', 'source', 'attemptCount']
  const oldRowsPreserved = beforeEvaluations.every(previous => {
    const current = afterEvaluations.find(row => row.id === previous.id)
    return current && immutableKeys.every(key => current[key] === previous[key])
  })
  const oldIds = new Set(beforeEvaluations.map(row => row.id))
  const additions = afterEvaluations.filter(row => !oldIds.has(row.id))
  const next = additions[0]
  const nextMatches = additions.length === 1 && next?.eventId === eventId
    && next?.contentRevision === afterEvent?.contentRevision
    && next?.queuedModerationVersion === afterEvent?.moderationVersion
    && next?.inputSha256 === after?.currentInputSha256
    && /^[a-f0-9]{64}$/.test(String(next?.inputSha256))
    && next?.source === 'contextual' && next?.status === 'queued' && next?.attemptCount === 0
  if (!eventMatches || !disclosuresMatch || !oldRowsPreserved || !nextMatches) {
    throw new Error('Draft setup transition did not preserve old jobs and create one complete new revision')
  }
  return true
}

function draftSetupSnapshot(eventId) {
  return dbJson(`select jsonb_build_object(
    'event', jsonb_build_object(
      'id',e.id,'organizerId',e.organizer_id,'status',e.status,'publishedAt',e.published_at,
      'contentRevision',e.content_revision,'moderationVersion',e.moderation_version,
      'moderationStatus',e.moderation_status
    ),
    'currentInputSha256',private.compute_event_input_sha256(e.id),
    'disclosures',(select jsonb_build_object(
      'minimumAge',d.minimum_age,'alcoholPresent',d.alcohol_present,
      'cannabisPresent',d.cannabis_present,'explicitAdultContent',d.explicit_adult_content,
      'gamblingPresent',d.gambling_present,'weaponsPresent',d.weapons_present,
      'highRiskActivity',d.high_risk_activity
    ) from private.event_risk_disclosures d where d.event_id=e.id),
    'evaluations',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'eventId',m.event_id,'contentRevision',m.content_revision,
      'inputSha256',m.input_sha256,'queuedModerationVersion',m.queued_moderation_version,
      'source',m.source,'status',m.status,'attemptCount',m.attempt_count,
      'failureCode',m.failure_code
    ) order by m.created_at,m.id),'[]'::jsonb) from private.event_moderation_evaluations m where m.event_id=e.id)
  ) from public.events e where e.id=${quote(eventId)};`)
}

async function ensureDraftAgreement(page, fixture) {
  const before = draftSetupSnapshot(fixture.paidDraft.eventId)
  await page.goto(origin + `/organizer/events/${fixture.paidDraft.eventId}/edit?step=details`)
  await expect(page.getByRole('heading', { name: 'Organizer agreement', exact: true })).toBeVisible()
  const current = page.getByText('Agreement current for this saved event.', { exact: true })
  if (!await current.isVisible()) {
    await page.getByLabel('Minimum age', { exact: true }).selectOption('all_ages')
    for (const name of ['alcoholPresent', 'cannabisPresent', 'explicitAdultContent', 'gamblingPresent', 'weaponsPresent', 'highRiskActivity']) {
      await page.locator(`input[name="${name}"][value="false"]`).check()
    }
    await page.getByRole('checkbox', { name: /I confirm that this event information/ }).check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForURL(url => url.pathname === `/organizer/events/${fixture.paidDraft.eventId}/preview`)
  } else {
    await page.goto(origin + `/organizer/events/${fixture.paidDraft.eventId}/preview`)
  }
  await expect(page.getByText('Agreement current for this saved event.', { exact: true })).toBeVisible()
  const after = draftSetupSnapshot(fixture.paidDraft.eventId)
  if (before.disclosures === null) assertDraftSetupTransition(before, after, fixture)
  else if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Completed draft setup changed during reuse')
  assertCompletedPaidDraft(eventAndTiers(fixture.paidDraft.eventId), fixture)
  return { before, after, requirementsWritten: before.disclosures === null }
}

function fixtureWriter(request) {
  const url = new URL(request.url())
  if (url.hostname !== '127.0.0.1' || !['3040', '55647'].includes(url.port)) return null
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.slice('/rest/v1/rpc/'.length)
    return frozenReadRpcs.has(name) ? null : `rpc:${name || 'unknown'}`
  }
  if (url.pathname.startsWith('/functions/v1/')) {
    const name = url.pathname.slice('/functions/v1/'.length)
    return ['stripe-connect-status', 'stripe-connect-session'].includes(name) ? null : `function:${name || 'unknown'}`
  }
  if (url.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
    return `rest:${url.pathname.slice('/rest/v1/'.length).split('/')[0] || 'unknown'}`
  }
  return null
}

function ownedEventReadId(request) {
  const url = new URL(request.url())
  const filter = url.pathname === '/rest/v1/events' ? url.searchParams.get('id') : null
  return filter?.startsWith('eq.') ? filter.slice(3) : null
}

function oneShotBoundary(target, expectedMethod = 'GET') {
  let armed = false
  let attempts = 0
  let intercepted = 0
  return {
    arm() {
      if (armed) throw new Error('Boundary already armed')
      armed = true
    },
    matches(request) {
      if (request.url() !== target || request.method() !== expectedMethod) return false
      attempts += 1
      if (!armed) return false
      armed = false
      intercepted += 1
      return true
    },
    summary: () => ({ attempts, intercepted }),
  }
}

function assertProviderRecoveryCounters({ before, failed, retried, beforeExit, exited }) {
  const valid = before.script.attempts === 0 && before.script.intercepted === 0
    && failed.script.attempts === 1 && failed.script.intercepted === 1
    && retried.script.attempts === 2 && retried.script.intercepted === 1
    && exited.script.attempts === 2 && exited.script.intercepted === 1
    && failed.sessionReads === before.sessionReads + 1
    && retried.sessionReads === failed.sessionReads && beforeExit.sessionReads === retried.sessionReads && exited.sessionReads === beforeExit.sessionReads
    && beforeExit.script.attempts === retried.script.attempts && beforeExit.script.intercepted === retried.script.intercepted
    && exited.statusReads === beforeExit.statusReads + 1
  if (!valid) throw new Error('Provider recovery counters do not prove one dropped script, one script retry, no duplicate Account Session and one fresh exit status')
  return true
}

async function installFence(context, writers) {
  await context.route('**/*', route => {
    const label = fixtureWriter(route.request())
    if (!label) return route.fallback()
    writers.push(label)
    return route.abort('blockedbyclient')
  })
}

async function installBoundary(context, boundary) {
  await context.route('**/*', route => boundary.matches(route.request()) ? route.abort('failed') : route.fallback())
}

async function login(page, email, password) {
  await page.goto(origin + '/organizer/events')
  await expect(page.getByRole('heading', { name: /^(Sign in|My Events|No events yet|Organizer Profile)$/ })).toBeVisible()
  if (new URL(page.url()).pathname === '/auth/sign-in') {
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname.startsWith('/organizer/'))
  }
}

async function ensureSecondaryIdentity(page, fixture) {
  if (!fixture.organizerId) {
    const existing = dbJson(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'confirmed',email_confirmed_at is not null)), '[]'::jsonb) from auth.users where email=${quote(fixture.email)};`)
    if (existing.length > 1) throw new Error('Secondary Auth identity is ambiguous')
    if (!existing.length) {
      await page.goto(origin + '/auth/sign-up')
      await page.getByLabel('Full name', { exact: true }).fill('Spec14 Secondary Organizer')
      await page.getByLabel('Email', { exact: true }).fill(fixture.email)
      await page.getByLabel('Password', { exact: true }).fill(fixture.password)
      await page.getByRole('button', { name: 'Create account', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible()
      await confirmLocalSignup(page, fixture.email)
      fixture.organizerId = dbJson(`select jsonb_build_object('id',id) from auth.users where email=${quote(fixture.email)};`).id
    } else {
      fixture.organizerId = existing[0].id
      if (!existing[0].confirmed) await confirmLocalSignup(page, fixture.email)
      else await login(page, fixture.email, fixture.password)
    }
    saveFixture(fixture)
  } else await login(page, fixture.email, fixture.password)
  if (new URL(page.url()).pathname === '/organizer/setup') {
    await page.getByLabel('Organizer / business name', { exact: true }).fill('Spec14 Secondary ' + fixture.email.slice(13, 21))
    await page.getByLabel('Organizer type', { exact: true }).selectOption('Community group')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('link', { name: 'Do this later', exact: true }).click()
    await expect(page.getByRole('heading', { name: /^(My Events|No events yet)$/ })).toBeVisible()
  }
}

async function ensurePaidDraft(page, fixture) {
  const draft = fixture.paidDraft
  if (draft.eventId && draft.tierIds.length === 2) {
    assertCompletedPaidDraft(eventAndTiers(draft.eventId), fixture)
    return
  }
  if (!draft.eventId) {
    const existing = dbJson(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status)), '[]'::jsonb) from public.events where organizer_id=${quote(fixture.organizerId)} and title=${quote(draft.title)};`)
    draft.eventId = existingDraftIdentity(existing)
  }
  if (!draft.eventId) {
    await page.goto(origin + '/organizer/events/new')
    await page.getByLabel('Event name', { exact: true }).fill(draft.title)
    await page.getByLabel('Description', { exact: true }).fill('Task-only unpublished draft for same-event payment recovery checks.')
    await page.getByLabel('Category', { exact: true }).selectOption('community')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    const start = new Date(Date.now() + 4 * 86_400_000)
    await page.getByLabel('Starts', { exact: true }).fill(wallMinute(start))
    await page.getByLabel('Ends', { exact: true }).fill(wallMinute(new Date(start.getTime() + 2 * 3_600_000)))
    await page.getByLabel('Venue name', { exact: true }).fill('Spec14 Secondary Hall')
    await page.getByPlaceholder('Search for a California address').fill('1 Market Street')
    await page.getByRole('option').filter({ hasText: /1 Market Street/ }).first().click()
    await expect(page.getByText('Verified address', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('radio', { name: /Paid Tickets/ }).check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForURL(url => /\/organizer\/events\/[0-9a-f-]{36}\/tickets$/.test(url.pathname))
    draft.eventId = new URL(page.url()).pathname.split('/')[3]
    saveFixture(fixture)
  } else {
    await page.goto(origin + `/organizer/events/${draft.eventId}/tickets`)
  }
  const cards = page.locator('.ticket-tier-card')
  await expect(page.getByRole('button', { name: 'Add ticket tier', exact: true })).toBeVisible()
  if (await cards.count() > 2) throw new Error('Secondary draft contains unexpected tiers')
  while (await cards.count() < 2) await page.getByRole('button', { name: 'Add ticket tier', exact: true }).click()
  for (const [index, definition] of paidTierDefinitions.entries()) {
    await cards.nth(index).getByLabel('Name', { exact: true }).fill(definition.name)
    await cards.nth(index).getByLabel('Price for ' + definition.name, { exact: true }).fill(definition.price)
    await cards.nth(index).getByLabel('Capacity', { exact: true }).fill(String(definition.capacity))
  }
  await page.getByRole('button', { name: 'Save ticket tiers', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  draft.tierIds = dbJson(`select coalesce(jsonb_agg(id order by sort_order), '[]'::jsonb) from public.ticket_tiers where event_id=${quote(draft.eventId)};`)
  validateFixture(fixture)
  saveFixture(fixture)
}

function eventAndTiers(eventId) {
  return dbJson(`select jsonb_build_object('event',to_jsonb(e),'tiers',(select coalesce(jsonb_agg(to_jsonb(t) order by sort_order,id),'[]'::jsonb) from public.ticket_tiers t where t.event_id=e.id)) from public.events e where e.id=${quote(eventId)};`)
}

async function main() {
  const runner = 'tests/e2e/spec14-b2-payments.cjs'
  const startedAt = new Date().toISOString()
  const sourceHashes = verificationSourceHashes(runner)
  const identity = await verifiedIdentity()
  const scenarioHash = hashFile(scenarioFile)
  const principal = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'))
  if (!principal.paidEventId || !principal.paidOrderId || !principal.organizerEmail || !principal.organizerPassword) throw new Error('Principal J01/J02 source unavailable')
  const fixture = loadWorkingFixture()
  const out = path.join(state, 'b2-payments-' + Date.now())
  fs.mkdirSync(out, { mode: 0o700 })
  const reportFile = path.join(out, 'report.json')
  const results = []
  let browser = null, failure = null, outcome = 'partial', stage = 'fixture', finishedAt = null
  let writers = [], blockedRequests = 0, pageErrors = 0, sourcesPreserved = null, scenarioPreserved = null
  const diagnostics = {}
  let setupSnapshots = null
  let secondaryStatusFailure = null
  let providerScriptFailure = null
  const save = () => fs.writeFileSync(reportFile, JSON.stringify({
    startedAt, finishedAt, currentStage: stage, identity, sourceHashes, outcome, failure,
    writerRequests: writers.length, blockedRequests, pageErrors, sourcesPreserved, scenarioPreserved,
    setupSnapshots, diagnostics, results,
    scope: 'Task-only secondary local Auth organizer and one real UI-created unpublished paid draft with two tiers; negative Payments actions use real owner/Connect reads and one dropped Connect provider script; event/tier/publication writers fenced after fixture freeze; no hosted Auth/Connect or publication claim.',
  }, null, 2), { mode: 0o600 })
  const checkpoint = value => { stage = value; save() }
  save()
  let secondaryBefore, principalBefore, principalTicketsBefore
  try {
    browser = await chromium.launch({ args: ['--no-proxy-server'] })
    const secondary = await realContext(browser, 'b2-secondary-organizer')
    try {
      await ensureSecondaryIdentity(secondary.page, fixture)
      await ensurePaidDraft(secondary.page, fixture)
      checkpoint('fixture-requirements-and-agreement')
      setupSnapshots = await ensureDraftAgreement(secondary.page, fixture)
      save()
    } finally { blockedRequests += secondary.blocked.length; await secondary.close() }
    validateFixture(fixture)
    secondaryBefore = eventAndTiers(fixture.paidDraft.eventId)
    principalBefore = eventAndTiers(principal.paidEventId)
    principalTicketsBefore = ticketFacts(principal.paidOrderId)
    if (secondaryBefore.event.status !== 'draft' || secondaryBefore.event.published_at !== null || secondaryBefore.tiers.length !== 2) throw new Error('Secondary fixture is not an unpublished two-tier draft')
    if (secondaryBefore.tiers.map(row => row.id).join('|') !== fixture.paidDraft.tierIds.join('|')) throw new Error('Secondary tier identity differs from private fixture ledger')

    checkpoint('secondary-incomplete-and-status-failure')
    const secondaryChecks = await realContext(browser, 'b2-secondary-organizer')
    await installFence(secondaryChecks.context, writers)
    const statusFailure = oneShotBoundary(connectStatusRequestUrl, 'POST')
    secondaryStatusFailure = statusFailure
    await installBoundary(secondaryChecks.context, statusFailure)
    secondaryChecks.page.on('pageerror', () => { pageErrors += 1 })
    try {
      checkpoint('secondary-login')
      await login(secondaryChecks.page, fixture.email, fixture.password)
      checkpoint('secondary-preview-initial')
      await secondaryChecks.page.goto(origin + `/organizer/events/${fixture.paidDraft.eventId}/preview`)
      await expect(secondaryChecks.page.getByRole('heading', { name: 'Preview your event', exact: true })).toBeVisible()
      await expect(secondaryChecks.page.getByText('Agreement current for this saved event.', { exact: true })).toBeVisible()
      await secondaryChecks.page.getByRole('button', { name: 'Ticket Selection', exact: true }).click()
      await expect(secondaryChecks.page.getByText('B2 General', { exact: true })).toBeVisible()
      await expect(secondaryChecks.page.getByText('B2 Reserved', { exact: true })).toBeVisible()

      checkpoint('secondary-preview-prompt-back')
      await secondaryChecks.page.getByRole('button', { name: 'Publish event', exact: true }).click()
      await secondaryChecks.page.getByRole('button', { name: 'Confirm and publish', exact: true }).click()
      await expect(secondaryChecks.page.getByRole('heading', { name: 'Set up payments to publish', exact: true })).toBeVisible()
      await secondaryChecks.page.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(secondaryChecks.page.getByRole('heading', { name: 'Preview your event', exact: true })).toBeVisible()
      await expect.poll(() => new URL(secondaryChecks.page.url()).search).toBe('')

      checkpoint('secondary-preview-native-history')
      await secondaryChecks.page.getByRole('button', { name: 'Publish event', exact: true }).click()
      await secondaryChecks.page.getByRole('button', { name: 'Confirm and publish', exact: true }).click()
      await expect(secondaryChecks.page.getByRole('heading', { name: 'Set up payments to publish', exact: true })).toBeVisible()
      await secondaryChecks.page.goBack()
      await expect(secondaryChecks.page.getByRole('heading', { name: 'Preview your event', exact: true })).toBeVisible()

      checkpoint('secondary-preview-reconfirm')
      await secondaryChecks.page.getByRole('button', { name: 'Publish event', exact: true }).click()
      await secondaryChecks.page.getByRole('button', { name: 'Confirm and publish', exact: true }).click()
      await expect(secondaryChecks.page.getByRole('heading', { name: 'Set up payments to publish', exact: true })).toBeVisible()
      const stripeLink = secondaryChecks.page.getByRole('link', { name: 'Set up Stripe', exact: true })
      await expect(stripeLink).toHaveAttribute('href', `/organizer/settings/payments?eventId=${fixture.paidDraft.eventId}`)
      results.push({ check: 'same-draft Stripe-required prompt Back, native history and reconfirm', outcome: 'passed', promptChecks: 3, remainedDraft: true })

      diagnostics.secondaryStatusBeforeArm = statusFailure.summary()
      statusFailure.arm()
      checkpoint('secondary-status-navigation')
      await stripeLink.click()
      checkpoint('secondary-status-error-visible')
      await expect(secondaryChecks.page.getByRole('heading', { name: 'Something went wrong', exact: true })).toBeVisible()
      diagnostics.secondaryStatusFailure = statusFailure.summary()
      if (diagnostics.secondaryStatusFailure.intercepted !== diagnostics.secondaryStatusBeforeArm.intercepted + 1
        || diagnostics.secondaryStatusFailure.attempts !== diagnostics.secondaryStatusBeforeArm.attempts + 1) {
        throw new Error(`Connect status failure boundary mismatch (${JSON.stringify(diagnostics.secondaryStatusFailure)})`)
      }
      checkpoint('secondary-status-retry')
      diagnostics.secondaryStatusBeforeRetry = statusFailure.summary()
      await secondaryChecks.page.getByRole('button', { name: 'Try again', exact: true }).click()
      checkpoint('secondary-incomplete-visible')
      await expect(secondaryChecks.page.getByRole('button', { name: 'Set up payouts', exact: true })).toBeVisible()
      diagnostics.secondaryStatusBoundary = statusFailure.summary()
      save()
      if (diagnostics.secondaryStatusBoundary.intercepted !== diagnostics.secondaryStatusBeforeArm.intercepted + 1
        || diagnostics.secondaryStatusBoundary.attempts !== diagnostics.secondaryStatusBeforeRetry.attempts + 1) {
        throw new Error(`Connect status retry boundary mismatch (${JSON.stringify(diagnostics.secondaryStatusBoundary)})`)
      }
      checkpoint('secondary-exit-click')
      await secondaryChecks.page.getByRole('button', { name: 'Do this later', exact: true }).click()
      checkpoint('secondary-return-url')
      await expect.poll(() => new URL(secondaryChecks.page.url()).pathname).toBe(`/organizer/events/${fixture.paidDraft.eventId}/preview`)
      checkpoint('secondary-preview-visible')
      await expect(secondaryChecks.page.getByRole('heading', { name: 'Preview your event', exact: true })).toBeVisible()
      await expect(secondaryChecks.page.getByText('Agreement current for this saved event.', { exact: true })).toBeVisible()
      await secondaryChecks.page.getByRole('button', { name: 'Ticket Selection', exact: true }).click()
      await expect(secondaryChecks.page.getByText('B2 General', { exact: true })).toBeVisible()
      await expect(secondaryChecks.page.getByText('B2 Reserved', { exact: true })).toBeVisible()
      results.push({ check: 'incomplete same-event Payments and status failure', outcome: 'passed', ...statusFailure.summary(), returnedToSameDraft: true })
    } finally { blockedRequests += secondaryChecks.blocked.length; await secondaryChecks.close() }

    checkpoint('invalid-and-wrong-owner')
    const owner = await realContext(browser, 'b2-primary-organizer')
    await installFence(owner.context, writers)
    owner.page.on('pageerror', () => { pageErrors += 1 })
    const counts = { ownedReads: [], connectReads: 0, connectSessions: 0, tierReads: 0 }
    owner.context.on('request', request => {
      const url = new URL(request.url())
      const pathname = url.pathname
      const eventReadId = ownedEventReadId(request)
      if (eventReadId) counts.ownedReads.push(eventReadId)
      if (pathname === '/functions/v1/stripe-connect-status') counts.connectReads += 1
      if (pathname === '/functions/v1/stripe-connect-session') counts.connectSessions += 1
      if (pathname === '/rest/v1/rpc/list_owned_ticket_tiers') counts.tierReads += 1
    })
    try {
      await login(owner.page, principal.organizerEmail, principal.organizerPassword)
      await owner.page.waitForLoadState('networkidle')
      const beforeInvalid = { ownedReads: counts.ownedReads.length, connectReads: counts.connectReads }
      await owner.page.goto(origin + '/organizer/settings/payments?eventId=not-a-uuid', { waitUntil: 'networkidle' })
      await expect(owner.page.getByText('Event unavailable', { exact: true })).toBeVisible()
      if (counts.ownedReads.length !== beforeInvalid.ownedReads || counts.connectReads !== beforeInvalid.connectReads) throw new Error('Invalid event ID reached a protected reader')
      const beforeWrongOwner = { ownedReads: counts.ownedReads.length, connectReads: counts.connectReads }
      await owner.page.goto(origin + `/organizer/settings/payments?eventId=${fixture.paidDraft.eventId}`, { waitUntil: 'networkidle' })
      await expect(owner.page.getByText('Event unavailable', { exact: true })).toBeVisible()
      if (counts.ownedReads.length !== beforeWrongOwner.ownedReads + 1
        || counts.ownedReads.at(-1) !== fixture.paidDraft.eventId
        || counts.connectReads !== beforeWrongOwner.connectReads) throw new Error('Wrong-owner event did not stop before Connect')
      results.push({ check: 'invalid and wrong-owner event return', outcome: 'passed', invalidReaderCalls: 0, wrongOwnerConnectCalls: 0 })

      checkpoint('principal-published-ticket-selection')
      const beforePublishedPreview = { ...counts }
      await owner.page.goto(origin + `/organizer/events/${principal.paidEventId}/preview`)
      await owner.page.getByRole('button', { name: 'Ticket Selection', exact: true }).click()
      const activeTiers = principalBefore.tiers.filter(tier => tier.status === 'active')
      if (!activeTiers.length) throw new Error('Principal paid source has no active tier for published preview proof')
      for (const tier of activeTiers) {
        const card = owner.page.locator('.creation-preview__tier').filter({ has: owner.page.getByRole('heading', { name: tier.name, exact: true }) })
        await expect(card).toHaveCount(1)
        await expect(card.getByText(new Intl.NumberFormat('en-US', { style: 'currency', currency: tier.currency }).format(tier.unit_amount_minor / 100), { exact: true })).toBeVisible()
        await expect(card.getByText(`${tier.quantity_total} tickets configured`, { exact: true })).toBeVisible()
      }
      if (counts.tierReads !== beforePublishedPreview.tierReads + 1 || counts.connectReads !== beforePublishedPreview.connectReads) {
        throw new Error('Published paid preview did not use one owned-tier read with Connect disabled')
      }
      results.push({ check: 'published paid ticket-selection source', outcome: 'passed', activeTiers: activeTiers.length, ownedTierReads: 1, connectReads: 0 })

      checkpoint('provider-script-failure-and-embedded-exit')
      const providerFailure = oneShotBoundary('https://connect-js.stripe.com/v1.0/connect.js')
      providerScriptFailure = providerFailure
      await installBoundary(owner.context, providerFailure)
      await owner.page.goto(origin + `/organizer/settings/payments?eventId=${principal.paidEventId}`, { waitUntil: 'networkidle' })
      await expect(owner.page.getByRole('heading', { name: 'You’re all set!', exact: true })).toBeVisible()
      const beforeProviderFailureStatusReads = counts.connectReads
      diagnostics.providerStatusBeforeArm = beforeProviderFailureStatusReads
      diagnostics.providerSessionBeforeArm = counts.connectSessions
      diagnostics.providerScriptBeforeArm = providerFailure.summary()
      providerFailure.arm()
      await owner.page.getByRole('button', { name: 'Manage payment details', exact: true }).click()
      const providerPanel = owner.page.locator('[aria-label="Stripe payment setup"]')
      await expect(providerPanel.getByRole('heading', { name: 'Something went wrong', exact: true })).toBeVisible()
      const afterProviderFailureStatusReads = counts.connectReads
      diagnostics.providerStatusAfterFailure = afterProviderFailureStatusReads
      diagnostics.providerSessionAfterFailure = counts.connectSessions
      diagnostics.providerScriptAfterFailure = providerFailure.summary()
      await providerPanel.getByRole('button', { name: 'Try again', exact: true }).click()
      await expect(providerPanel.getByText('Local Stripe setup simulator — no provider connection.', { exact: true })).toBeVisible()
      diagnostics.providerStatusAfterRetry = counts.connectReads
      diagnostics.providerSessionAfterRetry = counts.connectSessions
      diagnostics.providerScriptAfterRetry = providerFailure.summary()
      const exit = providerPanel.getByRole('button', { name: 'Done managing payments', exact: true })
      await expect(exit).toBeVisible()
      const beforeExitStatusReads = counts.connectReads
      diagnostics.providerStatusBeforeExit = beforeExitStatusReads
      diagnostics.providerSessionBeforeExit = counts.connectSessions
      diagnostics.providerScriptBeforeExit = providerFailure.summary()
      await exit.click()
      await expect(owner.page.getByRole('heading', { name: 'You’re all set!', exact: true })).toBeVisible()
      await expect(owner.page.getByRole('button', { name: 'Manage payment details', exact: true })).toBeFocused()
      diagnostics.providerStatusAfterExit = counts.connectReads
      diagnostics.providerSessionAfterExit = counts.connectSessions
      diagnostics.providerScriptAfterExit = providerFailure.summary()
      if (providerFailure.summary().intercepted !== 1) throw new Error('Connect provider boundary was not dropped exactly once')
      assertProviderRecoveryCounters({
        before: { statusReads: beforeProviderFailureStatusReads, sessionReads: diagnostics.providerSessionBeforeArm, script: diagnostics.providerScriptBeforeArm },
        failed: { statusReads: afterProviderFailureStatusReads, sessionReads: diagnostics.providerSessionAfterFailure, script: diagnostics.providerScriptAfterFailure },
        retried: { statusReads: diagnostics.providerStatusAfterRetry, sessionReads: diagnostics.providerSessionAfterRetry, script: diagnostics.providerScriptAfterRetry },
        beforeExit: { statusReads: beforeExitStatusReads, sessionReads: diagnostics.providerSessionBeforeExit, script: diagnostics.providerScriptBeforeExit },
        exited: { statusReads: diagnostics.providerStatusAfterExit, sessionReads: diagnostics.providerSessionAfterExit, script: diagnostics.providerScriptAfterExit },
      })
      results.push({ check: 'Connect provider failure and embedded exit', outcome: 'passed', ...providerFailure.summary(), statusReadsBeforeFailure: beforeProviderFailureStatusReads, statusReadsAfterFailure: afterProviderFailureStatusReads, statusReadsBeforeExit: beforeExitStatusReads, statusReadsAfterExit: counts.connectReads, freshStatusAfterExit: true, focusReturned: true })
    } finally { blockedRequests += owner.blocked.length; await owner.close() }

    checkpoint('preservation')
    sourcesPreserved = JSON.stringify(eventAndTiers(fixture.paidDraft.eventId)) === JSON.stringify(secondaryBefore)
      && JSON.stringify(eventAndTiers(principal.paidEventId)) === JSON.stringify(principalBefore)
      && JSON.stringify(ticketFacts(principal.paidOrderId)) === JSON.stringify(principalTicketsBefore)
    scenarioPreserved = hashFile(scenarioFile) === scenarioHash
    if (!sourcesPreserved || !scenarioPreserved || writers.length || blockedRequests || pageErrors) throw new Error('B2 preservation or boundary check failed')
    checkpoint('verification-source-binding')
    if (JSON.stringify(verificationSourceHashes(runner)) !== JSON.stringify(sourceHashes)) throw new Error('Verification source changed during execution')
    outcome = 'passed'
  } catch (error) {
    failure = { name: error.name, stage, message: sanitizedError(error) }
    throw error
  } finally {
    await browser?.close()
    if (secondaryStatusFailure) diagnostics.secondaryStatusFinal = secondaryStatusFailure.summary()
    if (providerScriptFailure) diagnostics.providerScriptFinal = providerScriptFailure.summary()
    try {
      if (secondaryBefore && principalBefore && principalTicketsBefore) sourcesPreserved = JSON.stringify(eventAndTiers(fixture.paidDraft.eventId)) === JSON.stringify(secondaryBefore)
        && JSON.stringify(eventAndTiers(principal.paidEventId)) === JSON.stringify(principalBefore)
        && JSON.stringify(ticketFacts(principal.paidOrderId)) === JSON.stringify(principalTicketsBefore)
    } catch { sourcesPreserved = null }
    try { scenarioPreserved = hashFile(scenarioFile) === scenarioHash } catch { scenarioPreserved = null }
    if (sourcesPreserved === false || scenarioPreserved !== true) { outcome = 'partial'; failure ??= { name: 'PreservationError', stage: 'final-preservation-read' } }
    finishedAt = new Date().toISOString()
    save()
  }
  console.log(JSON.stringify({ directory: path.basename(out), checks: results.length, writerRequests: writers.length, blockedRequests, pageErrors, outcome }))
}

module.exports = { assertCompletedPaidDraft, assertDraftSetupTransition, assertProviderRecoveryCounters, connectStatusRequestUrl, existingDraftIdentity, fixtureWriter, oneShotBoundary, ownedEventReadId, validateFixture }
if (require.main === module) main().catch(() => {
  console.error('B2 Payments supplement failed; inspect the private report.')
  process.exitCode = 1
})
