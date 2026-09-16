const assert = require('node:assert/strict')
const test = require('node:test')

const datasets = require('./spec14-j08-real-data.cjs')

test('read-only mode forbids every fixture and provider setup phase', async () => {
  assert.deepEqual(datasets.executionPlan(['--read-only']), {
    mode: 'read-only', allowFixtureWrites: false, allowProviderControls: false,
  })
  assert.deepEqual(datasets.executionPlan([]), {
    mode: 'setup', allowFixtureWrites: true, allowProviderControls: true,
  })
  assert.throws(() => datasets.executionPlan(['--unexpected']), /execution mode/i)
  let calls = 0
  assert.equal(await datasets.runFixturePhase(datasets.executionPlan(['--read-only']), async () => { calls += 1 }), false)
  assert.equal(calls, 0)
  assert.equal(await datasets.runFixturePhase(datasets.executionPlan([]), async () => { calls += 1 }), true)
  assert.equal(calls, 1)
})

test('keeps the approved pagination and full datasets strictly bounded', () => {
  assert.deepEqual(datasets.datasetPlan(), {
    pagination: { capacity: 30, quantities: [10, 10, 10], expectedAdmissions: 30 },
    full: { capacity: 1, quantities: [1], expectedAdmissions: 1 },
  })
})

test('supplies the complete safe disclosure set before accepting the organizer agreement', () => {
  assert.deepEqual(datasets.approvedDisclosureValues(), {
    minimumAge: 'all_ages',
    alcoholPresent: false,
    cannabisPresent: false,
    explicitAdultContent: false,
    gamblingPresent: false,
    weaponsPresent: false,
    highRiskActivity: false,
  })
})

test('retains a bounded sanitized failure message for a precise retry', () => {
  const message = datasets.boundedFailureMessage(new Error(`Timed out at http://127.0.0.1:3040/tickets/${'A'.repeat(60)}`))
  assert.match(message, /Timed out/)
  assert.doesNotMatch(message, /127\.0\.0\.1|A{20}/)
  assert.ok(message.length <= 600)
})

test('rejects ledger shapes that could silently expand the approved dataset', () => {
  const valid = {
    version: 1,
    pagination: { eventId: null, title: 'Spec14 pagination deadbeef', registrations: [] },
    full: { eventId: null, title: 'Spec14 full deadbeef', registrations: [] },
  }
  assert.deepEqual(datasets.validateDatasetLedger(valid), valid)
  assert.throws(() => datasets.validateDatasetLedger({ ...valid, extra: [] }), /dataset ledger/i)
  assert.throws(() => datasets.validateDatasetLedger({ ...valid, pagination: { ...valid.pagination, registrations: new Array(4).fill({}) } }), /dataset ledger/i)
  assert.throws(() => datasets.validateDatasetLedger({ ...valid, full: { ...valid.full, registrations: [{}, {}] } }), /dataset ledger/i)
})

test('read-only mode requires both exact completed retained datasets', () => {
  const complete = {
    version: 1,
    pagination: {
      eventId: '20000000-0000-4000-8000-000000000002', title: 'Spec14 pagination deadbeef',
      registrations: [0, 1, 2].map(index => ({ name: 'Pagination Guest', email: `j08-pagination-guest-${index}-20000000@spec14.test`, quantity: 10, registrationId: `40000000-0000-4000-8000-00000000000${index + 4}`, collectionUrl: `http://127.0.0.1:3040/tickets/rsvp_${'A'.repeat(42)}${index}` })),
    },
    full: {
      eventId: '30000000-0000-4000-8000-000000000003', title: 'Spec14 full deadbeef',
      registrations: [{ name: 'Full Guest', email: 'j08-full-guest-0-30000000@spec14.test', quantity: 1, registrationId: '50000000-0000-4000-8000-000000000005', collectionUrl: `http://127.0.0.1:3040/tickets/rsvp_${'B'.repeat(42)}` }],
    },
  }
  assert.equal(datasets.assertReadOnlyLedgerComplete(complete), true)
  assert.throws(() => datasets.assertReadOnlyLedgerComplete({ ...complete, pagination: { ...complete.pagination, registrations: complete.pagination.registrations.slice(0, 2) } }), /retained datasets/i)
  assert.throws(() => datasets.assertReadOnlyLedgerComplete({ ...complete, full: { ...complete.full, eventId: null, registrations: [] } }), /retained datasets/i)
})

test('read-only preflight accepts only canonical unused valid tickets', () => {
  const tickets = [1, 2].map(position => ({ id: `40000000-0000-4000-8000-00000000000${position}`, status: 'valid', usedAt: null, credentialHash: 'a'.repeat(64), position }))
  assert.equal(datasets.assertUnusedTickets(tickets, 2), true)
  assert.throws(() => datasets.assertUnusedTickets(tickets.map(ticket => ({ ...ticket, status: 'active' })), 2), /ticket facts/i)
  assert.throws(() => datasets.assertUnusedTickets(tickets.slice(0, 1), 2), /ticket facts/i)
  assert.throws(() => datasets.assertUnusedTickets(tickets.map((ticket, index) => index ? ticket : { ...ticket, usedAt: '2026-09-15T00:00:00Z' }), 2), /ticket facts/i)
})

test('binds every retained registration to the approved event, quantity and private collection', () => {
  const paginationId = '20000000-0000-4000-8000-000000000002'
  const fullId = '30000000-0000-4000-8000-000000000003'
  const registration = (eventId, index, quantity, name) => ({
    name,
    email: datasets.registrationEmail(name, index, eventId),
    quantity,
    registrationId: `40000000-0000-4000-8000-00000000000${index + 4}`,
    collectionUrl: `http://127.0.0.1:3040/tickets/rsvp_${'A'.repeat(42)}${index}`,
  })
  const valid = {
    version: 1,
    pagination: {
      eventId: paginationId,
      title: 'Spec14 pagination deadbeef',
      registrations: [
        registration(paginationId, 0, 10, 'Pagination Guest'),
        registration(paginationId, 1, 10, 'Pagination Guest'),
        registration(paginationId, 2, 10, 'Pagination Guest'),
      ],
    },
    full: {
      eventId: fullId,
      title: 'Spec14 full deadbeef',
      registrations: [registration(fullId, 0, 1, 'Full Guest')],
    },
  }
  assert.deepEqual(datasets.validateDatasetLedger(valid), valid)
  assert.throws(() => datasets.validateDatasetLedger({ ...valid, pagination: { ...valid.pagination, eventId: 'not-a-uuid' } }), /dataset ledger/i)
  assert.throws(() => datasets.validateDatasetLedger({ ...valid, pagination: { ...valid.pagination, registrations: valid.pagination.registrations.map((item, index) => index ? item : { ...item, quantity: 9 }) } }), /dataset ledger/i)
  assert.throws(() => datasets.validateDatasetLedger({ ...valid, pagination: { ...valid.pagination, registrations: valid.pagination.registrations.map((item, index) => index ? item : { ...item, email: 'another@example.test' }) } }), /dataset ledger/i)
  assert.throws(() => datasets.validateDatasetLedger({ ...valid, full: { ...valid.full, registrations: [{ ...valid.full.registrations[0], collectionUrl: 'https://example.test/tickets/private' }] } }), /dataset ledger/i)
  assert.throws(() => datasets.validateDatasetLedger({ ...valid, full: { ...valid.full, registrations: [{ ...valid.full.registrations[0], extra: true }] } }), /dataset ledger/i)
})

test('accepts only the exact owned free event identity and lifecycle', () => {
  const expected = {
    eventId: '20000000-0000-4000-8000-000000000002',
    organizerId: '10000000-0000-4000-8000-000000000001',
    title: 'Spec14 pagination deadbeef',
    capacity: 30,
  }
  const draft = {
    id: expected.eventId,
    organizerId: expected.organizerId,
    title: expected.title,
    admissionType: 'free',
    capacity: 30,
    status: 'draft',
    moderationStatus: 'not_evaluated',
    publishedAt: null,
  }
  assert.equal(datasets.assertDatasetEvent(draft, expected), true)
  const published = { ...draft, status: 'published', moderationStatus: 'clear', publishedAt: '2026-09-14T12:00:00Z' }
  assert.equal(datasets.assertDatasetEvent(published, expected, { requirePublic: true }), true)
  assert.throws(() => datasets.assertDatasetEvent({ ...draft, organizerId: '90000000-0000-4000-8000-000000000009' }, expected), /dataset event/i)
  assert.throws(() => datasets.assertDatasetEvent({ ...draft, admissionType: 'paid' }, expected), /dataset event/i)
  assert.throws(() => datasets.assertDatasetEvent({ ...draft, capacity: 31 }, expected), /dataset event/i)
  assert.throws(() => datasets.assertDatasetEvent({ ...published, moderationStatus: 'under_review' }, expected, { requirePublic: true }), /dataset event/i)
})

test('binds a retained RSVP to its immutable registration and ticket count', () => {
  const expected = {
    eventId: '20000000-0000-4000-8000-000000000002',
    organizerId: '10000000-0000-4000-8000-000000000001',
    name: 'Pagination Guest',
    email: 'j08-pagination-guest-0-20000000@spec14.test',
    quantity: 10,
    registrationId: '30000000-0000-4000-8000-000000000003',
  }
  const row = {
    id: expected.registrationId,
    eventId: expected.eventId,
    organizerId: expected.organizerId,
    name: expected.name,
    email: expected.email,
    quantity: 10,
    status: 'confirmed',
    cancelledAt: null,
    ticketCount: 10,
  }
  assert.equal(datasets.assertDatasetRegistration(row, expected), true)
  assert.throws(() => datasets.assertDatasetRegistration({ ...row, eventId: '90000000-0000-4000-8000-000000000009' }, expected), /dataset registration/i)
  assert.throws(() => datasets.assertDatasetRegistration({ ...row, status: 'cancelled', cancelledAt: '2026-09-14T12:00:00Z' }, expected), /dataset registration/i)
  assert.throws(() => datasets.assertDatasetRegistration({ ...row, ticketCount: 9 }, expected), /dataset registration/i)
})

test('permits a global moderation worker only for the exact fresh dataset evaluation', () => {
  const expected = {
    evaluationId: '30000000-0000-4000-8000-000000000003',
    eventId: '20000000-0000-4000-8000-000000000002',
  }
  const claim = { evaluationId: expected.evaluationId, eventId: expected.eventId, status: 'queued', attemptCount: 0 }
  assert.equal(datasets.assertModerationClaimTarget(claim, expected), true)
  assert.throws(() => datasets.assertModerationClaimTarget({ ...claim, eventId: '90000000-0000-4000-8000-000000000009' }, expected), /moderation claim/i)
  assert.throws(() => datasets.assertModerationClaimTarget({ ...claim, status: 'processing', attemptCount: 1 }, expected), /moderation claim/i)

  const response = {
    outcome: 'invoked',
    name: 'moderate-event-queue',
    handlerStatus: 200,
    body: { status: 'processed', evaluationId: expected.evaluationId, disposition: 'applied' },
  }
  assert.equal(datasets.assertModerationWorkerResult(response, expected.evaluationId), true)
  assert.throws(() => datasets.assertModerationWorkerResult({ ...response, body: { ...response.body, evaluationId: '90000000-0000-4000-8000-000000000009' } }, expected.evaluationId), /moderation worker/i)
  assert.throws(() => datasets.assertModerationWorkerResult({ ...response, handlerStatus: 204, body: null }, expected.evaluationId), /moderation worker/i)
})

test('treats every potentially aging moderation lease as ordered work and refuses attempt-three processing', () => {
  const target = {
    evaluationId: '30000000-0000-4000-8000-000000000003',
    eventId: '20000000-0000-4000-8000-000000000002',
    status: 'queued',
    attemptCount: 0,
    createdAt: '2026-09-14T12:00:02Z',
  }
  assert.equal(datasets.assertModerationWorkerPreflight([target], target), true)
  assert.throws(() => datasets.assertModerationWorkerPreflight([
    { ...target, evaluationId: '40000000-0000-4000-8000-000000000004', eventId: '50000000-0000-4000-8000-000000000005', status: 'processing', attemptCount: 1, createdAt: '2026-09-14T12:00:01Z' },
    target,
  ], target), /moderation preflight/i)
  assert.throws(() => datasets.assertModerationWorkerPreflight([
    target,
    { ...target, evaluationId: '40000000-0000-4000-8000-000000000004', eventId: '50000000-0000-4000-8000-000000000005', status: 'processing', attemptCount: 3, createdAt: '2026-09-14T12:00:03Z' },
  ], target), /moderation preflight/i)
  assert.throws(() => datasets.assertModerationWorkerPreflight([
    { ...target, evaluationId: '40000000-0000-4000-8000-000000000004', eventId: '50000000-0000-4000-8000-000000000005', status: 'queued', attemptCount: 0, createdAt: '2026-09-14T12:00:01Z' },
    target,
  ], target), /moderation preflight/i)
})
