const assert = require('node:assert/strict')
const test = require('node:test')

const manual = require('./spec14-manual.cjs')

test('accepts only the closed interactive and smoke role commands, including isolated staff', () => {
  assert.deepEqual(manual.parseCommand(['launch']), { action: 'launch', role: 'organizer' })
  assert.deepEqual(manual.parseCommand(['launch', 'paid-buyer']), { action: 'launch', role: 'paid-buyer' })
  assert.deepEqual(manual.parseCommand(['smoke', 'free-buyer']), { action: 'smoke', role: 'free-buyer' })
  assert.deepEqual(manual.parseCommand(['launch', 'staff']), { action: 'launch', role: 'staff' })
  assert.deepEqual(manual.parseCommand(['smoke', 'staff']), { action: 'smoke', role: 'staff' })
  assert.throws(() => manual.parseCommand(['smoke', '../escape']), /role must be/)
  assert.throws(() => manual.parseCommand(['smoke', 'organizer', 'extra']), /Usage:/)
})

test('staff has a separate profile and starts at the protected moderation route', () => {
  assert.equal(manual.startPath('staff'), '/moderation')
  assert.equal(manual.startPath('organizer'), '/organizer/events')
  assert.equal(manual.startPath('paid-buyer'), '/discover')
  assert.match(manual.rolePaths('staff').profile, /manual-browser-staff-profile$/)
  assert.match(manual.rolePaths('staff', 'smoke').active, /manual-browser-smoke-staff-active\.json$/)
})

test('smoke proof contains only redacted tab and boundary facts', () => {
  const proof = manual.smokeProof('paid-buyer', {
    blocked: ['https://private.example/secret'],
    appIdentityMatches: true,
    providerStateUnchanged: true,
    tabs: {
      application: true,
      authInbox: true,
      ticketInbox: true,
    },
  })

  assert.deepEqual(Object.keys(proof).sort(), [
    'applicationIdentityMatches',
    'blockedRequestCount',
    'providerStateUnchanged',
    'role',
    'tabs',
  ])
  assert.equal(proof.role, 'paid-buyer')
  assert.equal(proof.blockedRequestCount, 1)
  assert.doesNotMatch(JSON.stringify(proof), /private\.example|secret|https?:/)
})

test('live proof failure prevents identity reads, profile claims, controls and browser launch', async () => {
  const calls = []
  await assert.rejects(
    manual.withRoleBrowser('staff', 'smoke', async () => {}, {
      verifyRunning: async () => { calls.push('verify'); throw new Error('stale served identity') },
      readIdentity: () => { calls.push('identity') },
      readiness: async () => { calls.push('readiness') },
      claimProfile: () => { calls.push('profile') },
      launchPersistentContext: async () => { calls.push('browser') },
    }),
    /stale served identity/,
  )
  assert.deepEqual(calls, ['verify'])
})
