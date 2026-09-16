const assert = require('node:assert/strict')
const test = require('node:test')

const control = require('./spec14-control.cjs')

test('accepts only the closed Spec14 provider and worker commands', () => {
  assert.deepEqual(control.parseCommand(['state']), { action: 'state' })
  assert.deepEqual(control.parseCommand(['moderation-mode', 'approve']), { action: 'moderation-mode', mode: 'approve' })
  assert.deepEqual(control.parseCommand(['moderation-mode', 'review']), { action: 'moderation-mode', mode: 'review' })
  assert.deepEqual(control.parseCommand(['moderation-mode', 'failed']), { action: 'moderation-mode', mode: 'failed' })
  assert.deepEqual(control.parseCommand(['email-mode', 'accepted']), { action: 'email-mode', mode: 'accepted' })
  assert.deepEqual(control.parseCommand(['email-mode', 'failed']), { action: 'email-mode', mode: 'failed' })
  assert.deepEqual(control.parseCommand(['email-mode', 'unknown']), { action: 'email-mode', mode: 'unknown' })
  assert.deepEqual(control.parseCommand(['run-worker', 'moderation']), { action: 'run-worker', name: 'moderate-event-queue' })
  assert.deepEqual(control.parseCommand(['run-worker', 'email']), { action: 'run-worker', name: 'ticket-email-worker' })
  for (const args of [[], ['moderation-mode', 'normal'], ['email-mode', 'approve'], ['run-worker', 'refund'], ['state', 'extra'], ['checkout-mode', 'normal']]) {
    assert.throws(() => control.parseCommand(args), /Usage:/)
  }
})

test('accepts only the runner proof for the exact live task build and servers', () => {
  const proof = {
    task: 'spec14-final-assembly',
    application: 'http://127.0.0.1:3040',
    processes: ['app', 'bridge', 'edge'],
    sourceSha256: 'a'.repeat(64),
    assetsSha256: 'b'.repeat(64),
  }
  assert.deepEqual(control.validateRunningProof(proof), { task: 'spec14-final-assembly' })
  assert.throws(() => control.validateRunningProof({ ...proof, task: 'another-task' }), /Wrong live task proof/)
  assert.throws(() => control.validateRunningProof({ ...proof, application: 'http://127.0.0.1:9999' }), /wrong application/)
  assert.throws(() => control.validateRunningProof({ ...proof, processes: ['app', 'gateway', 'edge'] }), /incomplete servers/)
  assert.throws(() => control.validateRunningProof({ ...proof, sourceSha256: 'stale' }), /source identity/)
})

test('summarizes state without provider IDs, email payloads or moderation request bodies', () => {
  const result = control.summarizeResult({ action: 'state' }, {
    version: 1,
    stripe: { accountMode: 'ready', checkoutCreateMode: 'normal', refundMode: 'succeeded', accountIds: ['acct_secret'] },
    email: { mode: 'unknown', messages: [{ payload: { to: 'private@example.test', html: 'secret' }, providerId: 'email-secret' }] },
    moderation: { mode: 'review', requests: [{ title: 'private event', text: 'secret' }] },
  })
  assert.deepEqual(result, {
    action: 'state',
    email: { messageCount: 1, mode: 'unknown' },
    moderation: { mode: 'review', requestCount: 1 },
  })
  assert.doesNotMatch(JSON.stringify(result), /acct_secret|private@example|private event|secret|providerId|payload/)
})

test('summarizes mode and worker results through closed status fields only', () => {
  assert.deepEqual(
    control.summarizeResult({ action: 'email-mode', mode: 'accepted' }, { outcome: 'configured', mode: 'accepted', private: 'secret' }),
    { action: 'email-mode', mode: 'accepted', outcome: 'configured' },
  )
  assert.deepEqual(
    control.summarizeResult({ action: 'run-worker', name: 'moderate-event-queue' }, {
      outcome: 'invoked', name: 'moderate-event-queue', handlerStatus: 200,
      body: { status: 'processed', disposition: 'applied', evaluationId: 'private-id' },
    }),
    { action: 'run-worker', disposition: 'applied', handlerStatus: 200, name: 'moderate-event-queue', workerStatus: 'processed' },
  )
  assert.deepEqual(
    control.summarizeResult({ action: 'run-worker', name: 'ticket-email-worker' }, {
      outcome: 'invoked', name: 'ticket-email-worker', handlerStatus: 200, body: { state: 'idle' }, private: 'secret',
    }),
    { action: 'run-worker', handlerStatus: 200, name: 'ticket-email-worker', workerStatus: 'idle' },
  )
  assert.deepEqual(
    control.summarizeResult({ action: 'run-worker', name: 'moderate-event-queue' }, {
      outcome: 'invoked', name: 'moderate-event-queue', handlerStatus: 204, body: null,
    }),
    { action: 'run-worker', handlerStatus: 204, name: 'moderate-event-queue', workerStatus: 'idle' },
  )
})

test('rejects malformed control replies instead of printing unreviewed fields', () => {
  assert.throws(() => control.summarizeResult({ action: 'state' }, { email: { mode: 'accepted', messages: 'private' }, moderation: { mode: 'review', requests: [] } }), /Control response unavailable/)
  assert.throws(() => control.summarizeResult({ action: 'run-worker', name: 'moderate-event-queue' }, { outcome: 'invoked', handlerStatus: 200, body: { status: 'secret' } }), /Control response unavailable/)
  assert.throws(() => control.summarizeResult({ action: 'moderation-mode', mode: 'review' }, { outcome: 'configured', mode: 'approve' }), /Control response unavailable/)
})

test('never calls control when the live task proof fails', async () => {
  let calls = 0
  await assert.rejects(
    control.execute(
      { action: 'state' },
      {
        verifyRunning: async () => { throw new Error('Recorded server stopped or replaced') },
        invokeControl: async () => { calls += 1; return {} },
      },
    ),
    /stopped or replaced/,
  )
  assert.equal(calls, 0)
})

test('calls control only after an exact live task proof', async () => {
  const order = []
  const result = await control.execute(
    { action: 'state' },
    {
      verifyRunning: async () => { order.push('verify'); return { task: 'spec14-final-assembly' } },
      invokeControl: async () => {
        order.push('control')
        return { email: { mode: 'accepted', messages: [] }, moderation: { mode: 'review', requests: [] } }
      },
    },
  )
  assert.deepEqual(order, ['verify', 'control'])
  assert.deepEqual(result, {
    task: 'spec14-final-assembly',
    action: 'state',
    email: { messageCount: 0, mode: 'accepted' },
    moderation: { mode: 'review', requestCount: 0 },
  })
})
