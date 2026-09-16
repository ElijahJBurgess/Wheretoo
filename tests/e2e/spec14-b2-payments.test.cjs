const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const payments = require('./spec14-b2-payments.cjs')
const { connectScript } = require('./support/spec14Harness.ts')

function request(url, method = 'POST') {
  return { url: () => url, method: () => method }
}

test('fences event, tier and publish writers after fixture freeze', () => {
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:3040/rest/v1/events', 'PATCH')), 'rest:events')
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:3040/rest/v1/rpc/save_ticket_tiers')), 'rpc:save_ticket_tiers')
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:3040/functions/v1/organizer-refund-order')), 'function:organizer-refund-order')
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:3040/functions/v1/stripe-connect-status')), null)
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/rest/v1/events', 'PATCH')), 'rest:events')
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/rest/v1/rpc/save_ticket_tiers')), 'rpc:save_ticket_tiers')
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/rest/v1/rpc/publish_event_if_current')), 'rpc:publish_event_if_current')
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/rest/v1/rpc/cancel_owned_event')), 'rpc:cancel_owned_event')
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/functions/v1/stripe-connect-status')), null)
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/functions/v1/stripe-connect-session')), null)
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/functions/v1/organizer-refund-order')), 'function:organizer-refund-order')
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/rest/v1/rpc/get_owned_event_change_context')), null)
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/rest/v1/rpc/get_organizer_event_metrics')), null)
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/rest/v1/rpc/get_organizer_free_registration_metrics')), null)
  assert.equal(payments.fixtureWriter(request('http://127.0.0.1:55647/rest/v1/rpc/list_organizer_event_orders_filtered')), 'rpc:list_organizer_event_orders_filtered')
})

test('uses the browser same-origin Connect status boundary', () => {
  assert.equal(payments.connectStatusRequestUrl, 'http://127.0.0.1:3040/functions/v1/stripe-connect-status')
  const boundary = payments.oneShotBoundary(payments.connectStatusRequestUrl, 'POST')
  boundary.arm()
  assert.equal(boundary.matches(request(payments.connectStatusRequestUrl, 'OPTIONS')), false)
  assert.equal(boundary.matches(request('http://127.0.0.1:55647/functions/v1/stripe-connect-status')), false)
  assert.equal(boundary.matches(request('http://127.0.0.1:3040/functions/v1/stripe-connect-status')), true)
  assert.deepEqual(boundary.summary(), { attempts: 1, intercepted: 1 })
})

test('one-shot boundary consumes only the armed exact provider request', () => {
  const boundary = payments.oneShotBoundary('https://connect-js.stripe.com/v1.0/connect.js')
  assert.equal(boundary.matches(request('https://connect-js.stripe.com/v1.0/connect.js', 'OPTIONS')), false)
  assert.equal(boundary.matches(request('https://connect-js.stripe.com/v1.0/connect.js', 'GET')), false)
  boundary.arm()
  assert.equal(boundary.matches(request('https://connect-js.stripe.com/v1.0/other.js', 'GET')), false)
  assert.equal(boundary.matches(request('https://connect-js.stripe.com/v1.0/connect.js', 'GET')), true)
  assert.equal(boundary.matches(request('https://connect-js.stripe.com/v1.0/connect.js', 'GET')), false)
  assert.deepEqual(boundary.summary(), { attempts: 3, intercepted: 1 })
})

test('requires one Account Session across provider script failure and retry plus a fresh exit status', () => {
  const before = { statusReads: 4, sessionReads: 2, script: { attempts: 0, intercepted: 0 } }
  const failed = { statusReads: 5, sessionReads: 3, script: { attempts: 1, intercepted: 1 } }
  const retried = { statusReads: 5, sessionReads: 3, script: { attempts: 2, intercepted: 1 } }
  const beforeExit = { statusReads: 5, sessionReads: 3, script: { attempts: 2, intercepted: 1 } }
  const exited = { statusReads: 6, sessionReads: 3, script: { attempts: 2, intercepted: 1 } }
  assert.equal(payments.assertProviderRecoveryCounters({ before, failed, retried, beforeExit, exited }), true)
  assert.throws(() => payments.assertProviderRecoveryCounters({ before, failed, retried: { ...retried, sessionReads: 4 }, beforeExit, exited }), /provider recovery counters/i)
  assert.throws(() => payments.assertProviderRecoveryCounters({ before, failed, retried, beforeExit, exited: { ...exited, statusReads: 5 } }), /provider recovery counters/i)
  assert.throws(() => payments.assertProviderRecoveryCounters({ before, failed, retried, beforeExit: { ...beforeExit, statusReads: 6 }, exited }), /provider recovery counters/i)
  assert.throws(() => payments.assertProviderRecoveryCounters({ before, failed: { ...failed, script: { attempts: 1, intercepted: 0 } }, retried, beforeExit, exited }), /provider recovery counters/i)
})

test('installed Connect SDK delegates the public section-open setter to the local provider element', async () => {
  const definitions = new Map()
  class HTMLElement {
    constructor() {
      this.isConnected = true
      this.style = {}
      this.button = {}
    }

    querySelector() {
      return this.button
    }
  }
  const context = {
    window: {},
    HTMLElement,
    customElements: {
      define(name, constructor) { definitions.set(name, constructor) },
      get(name) { return definitions.get(name) },
    },
    document: {
      createElement(name) {
        const Element = definitions.get(name)
        assert.ok(Element, `provider element ${name} must be registered`)
        return new Element()
      },
    },
    console: { warn() {} },
    exports: {},
  }
  vm.runInNewContext(connectScript, context)
  const pureEntry = require.resolve('@stripe/connect-js/pure')
  const pureBundle = pureEntry.replace(/\/pure\.js$/, '/dist/pure.js')
  vm.runInNewContext(fs.readFileSync(pureBundle, 'utf8'), context)
  const connect = context.exports.loadConnectAndInitialize({
    publishableKey: 'pk_test_synthetic',
    fetchClientSecret: () => Promise.resolve('synthetic'),
  })
  await new Promise((resolve) => setImmediate(resolve))
  const element = connect.create('account-management')
  assert.equal(typeof element.setOnSectionOpenInternalOnly, 'function')
  const originalSetter = element.setOnSectionOpenInternalOnly
  const observed = []
  element.setOnSectionOpenInternalOnly = (listener) => {
    observed.push(listener)
    originalSetter.call(element, listener)
  }
  const listener = () => {}
  element.setOnSectionOpen(undefined)
  element.setOnSectionOpen(listener)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(observed, [undefined, listener])
})

test('binds owner-read counters to detail IDs and ignores My Events list traffic', () => {
  const eventId = '20000000-0000-4000-8000-000000000002'
  assert.equal(payments.ownedEventReadId(request('http://127.0.0.1:55647/rest/v1/events?select=*', 'GET')), null)
  assert.equal(payments.ownedEventReadId(request(`http://127.0.0.1:55647/rest/v1/events?select=*&id=eq.${eventId}`, 'GET')), eventId)
  assert.equal(payments.ownedEventReadId(request(`http://127.0.0.1:55647/rest/v1/organizers?id=eq.${eventId}`, 'GET')), null)
})

test('accepts only the private versioned secondary fixture ledger shape', () => {
  const value = {
    version: 1,
    email: 'secondary@example.test',
    password: 'private-password',
    organizerId: '10000000-0000-4000-8000-000000000001',
    paidDraft: {
      eventId: '20000000-0000-4000-8000-000000000002',
      title: 'Task-only draft',
      tierIds: ['30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004'],
    },
  }
  assert.deepEqual(payments.validateFixture(value), value)
  assert.throws(() => payments.validateFixture({ ...value, extra: true }), /fixture ledger/i)
  assert.throws(() => payments.validateFixture({ ...value, paidDraft: { ...value.paidDraft, tierIds: [] } }), /fixture ledger/i)
})

test('creates only when no prior draft exists and rejects ambiguous or terminal matches', () => {
  assert.equal(payments.existingDraftIdentity([]), null)
  assert.equal(payments.existingDraftIdentity([{ id: 'draft-1', status: 'draft' }]), 'draft-1')
  assert.throws(() => payments.existingDraftIdentity([{ id: 'published-1', status: 'published' }]), /terminal/)
  assert.throws(() => payments.existingDraftIdentity([{ id: 'one', status: 'draft' }, { id: 'two', status: 'draft' }]), /ambiguous/)
})

test('reuses only the exact completed unpublished two-tier fixture', () => {
  const fixture = {
    organizerId: '10000000-0000-4000-8000-000000000001',
    paidDraft: {
      eventId: '20000000-0000-4000-8000-000000000002',
      tierIds: ['30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004'],
    },
  }
  const source = {
    event: { id: fixture.paidDraft.eventId, organizer_id: fixture.organizerId, admission_type: 'paid', status: 'draft', published_at: null },
    tiers: [
      { id: fixture.paidDraft.tierIds[0], event_id: fixture.paidDraft.eventId, name: 'B2 General', unit_amount_minor: 1200, quantity_total: 12, currency: 'usd', sort_order: 1 },
      { id: fixture.paidDraft.tierIds[1], event_id: fixture.paidDraft.eventId, name: 'B2 Reserved', unit_amount_minor: 1800, quantity_total: 8, currency: 'usd', sort_order: 2 },
    ],
  }
  assert.equal(payments.assertCompletedPaidDraft(source, fixture), true)
  assert.throws(() => payments.assertCompletedPaidDraft({ ...source, event: { ...source.event, status: 'published' } }, fixture), /completed fixture/i)
  assert.throws(() => payments.assertCompletedPaidDraft({ ...source, tiers: source.tiers.map((tier, index) => index ? tier : { ...tier, quantity_total: 13 }) }, fixture), /completed fixture/i)
  assert.throws(() => payments.assertCompletedPaidDraft({ ...source, tiers: source.tiers.map((tier, index) => ({ ...tier, sort_order: index })) }, fixture), /completed fixture/i)
})

test('accepts only one complete new moderation revision while preserving earlier job identities', () => {
  const fixture = { organizerId: '10000000-0000-4000-8000-000000000001', paidDraft: { eventId: '20000000-0000-4000-8000-000000000002' } }
  const previous = { id: '30000000-0000-4000-8000-000000000003', eventId: fixture.paidDraft.eventId, contentRevision: 4, inputSha256: 'a'.repeat(64), queuedModerationVersion: 4, source: 'contextual', status: 'processing', attemptCount: 1, failureCode: null }
  const before = { event: { id: fixture.paidDraft.eventId, organizerId: fixture.organizerId, status: 'draft', publishedAt: null, contentRevision: 4, moderationVersion: 4 }, currentInputSha256: 'a'.repeat(64), disclosures: null, evaluations: [previous] }
  const after = {
    event: { ...before.event, contentRevision: 5, moderationVersion: 5 },
    currentInputSha256: 'b'.repeat(64),
    disclosures: { minimumAge: 'all_ages', alcoholPresent: false, cannabisPresent: false, explicitAdultContent: false, gamblingPresent: false, weaponsPresent: false, highRiskActivity: false },
    evaluations: [
      { ...previous, status: 'superseded', failureCode: 'CONTENT_REVISION_CHANGED' },
      { ...previous, id: '40000000-0000-4000-8000-000000000004', contentRevision: 5, inputSha256: 'b'.repeat(64), queuedModerationVersion: 5, status: 'queued', attemptCount: 0 },
    ],
  }
  assert.equal(payments.assertDraftSetupTransition(before, after, fixture), true)
  assert.throws(() => payments.assertDraftSetupTransition(before, { ...after, evaluations: after.evaluations.slice(1) }, fixture), /setup transition/i)
  assert.throws(() => payments.assertDraftSetupTransition(before, { ...after, event: { ...after.event, status: 'published' } }, fixture), /setup transition/i)
})
