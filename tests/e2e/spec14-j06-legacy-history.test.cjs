const assert = require('node:assert/strict')
const test = require('node:test')

const legacy = require('./spec14-j06-legacy-history.cjs')

const sourceEvent = '11111111-1111-4111-8111-111111111111'
const organizer = '22222222-2222-4222-8222-222222222222'
const instance = '33333333-3333-4333-8333-333333333333'

function request(url, method = 'POST') {
  return { url: () => url, method: () => method }
}

test('setup is fixture-only, identity guarded, and models pre-history without weakening production policy', () => {
  const sql = legacy.setupSql({ sourceEvent, organizer, instance })
  assert.match(sql, /^begin;/)
  assert.match(sql, /spec14_control\.identity/)
  assert.match(sql, /cron\.launch_active_jobs/)
  assert.match(sql, /private\.event_is_publicly_eligible/)
  assert.doesNotMatch(sql, /i\.started_action_id=a\.id/)
  assert.match(sql, /set local session_replication_role=replica/)
  assert.match(sql, /set local session_replication_role=origin/)
  assert.match(sql, /private\.event_change_facts\([^)]*\) is distinct from private\.event_change_facts/)
  assert.match(sql, /private\.event_change_state/)
  assert.match(sql, /private\.event_change_snapshots/)
  assert.match(sql, /public\.orders/)
  assert.match(sql, /public\.free_registrations/)
  assert.match(sql, /public\.tickets/)
  assert.match(sql, /private\.event_notices/)
  assert.match(sql, /commit;\s*$/)
  assert.doesNotMatch(sql, /truncate|drop\s+(table|schema)|alter\s+(table|function)|create\s+(table|function)/i)
})

test('cleanup enumerates only fixture identities, suppresses immutable cleanup triggers locally, and proves zero residue', () => {
  const sql = legacy.cleanupSql({ sourceEvent, organizer, instance })
  assert.match(sql, /^begin;/)
  assert.match(sql, /spec14_control\.identity/)
  assert.match(sql, /set local session_replication_role=replica/)
  assert.match(sql, /set local session_replication_role=origin/)
  for (const id of Object.values(legacy.fixtureIds)) assert.match(sql, new RegExp(id))
  assert.match(sql, /delete from private\.event_change_state/)
  assert.match(sql, /delete from private\.event_change_snapshots/)
  assert.match(sql, /delete from private\.event_public_eligibility_intervals/)
  assert.match(sql, /delete from private\.event_moderation_actions/)
  assert.match(sql, /delete from private\.event_policy_acceptances/)
  assert.match(sql, /delete from private\.event_risk_disclosures/)
  assert.match(sql, /delete from public\.events/)
  assert.match(sql, /LEGACY_FIXTURE_RESIDUE/)
  assert.match(sql, /commit;\s*$/)
  assert.doesNotMatch(sql, /truncate|drop\s+(table|schema)|alter\s+(table|function)|create\s+(table|function)/i)
})

test('fixture SQL rejects malformed caller identities before interpolation', () => {
  for (const field of ['sourceEvent', 'organizer', 'instance']) {
    const input = { sourceEvent, organizer, instance, [field]: "' ; delete from public.events; --" }
    assert.throws(() => legacy.setupSql(input), /Invalid UUID/)
    assert.throws(() => legacy.cleanupSql(input), /Invalid UUID/)
  }
})

test('browser fence permits the two page readers and rejects application writers', () => {
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:3040/rest/v1/rpc/get_my_staff_role')), null)
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:3040/rest/v1/rpc/get_owned_event_change_context')), null)
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:3040/rest/v1/rpc/submit_owned_event_notice')), 'rpc:submit_owned_event_notice')
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:3040/rest/v1/events', 'PATCH')), 'rest:events')
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:55647/rest/v1/rpc/get_owned_event_change_context')), null)
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:55647/rest/v1/rpc/get_my_staff_role')), null)
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:55647/rest/v1/rpc/get_owned_event_notice_status')), null)
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:55647/rest/v1/rpc/submit_owned_event_notice')), 'rpc:submit_owned_event_notice')
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:55647/rest/v1/events', 'PATCH')), 'rest:events')
  assert.equal(legacy.businessWriter(request('http://127.0.0.1:55647/rest/v1/rpc/unknown_reader')), 'rpc:unknown_reader')
})

test('fixture fact report requires exactly one current snapshot and no invented predecessor', () => {
  const snapshot = '44444444-4444-4444-8444-444444444444'
  assert.deepEqual(legacy.validateObservedState({
    eventCount: 1, stateCount: 1, snapshotCount: 1,
    currentSaved: snapshot, previousSaved: null,
    currentPublic: snapshot, previousPublic: null,
    currentlyEligible: true, sourceFactsPreserved: true,
    orders: 0, registrations: 0, tickets: 0, notices: 0,
  }), { snapshot })
  assert.throws(() => legacy.validateObservedState({
    eventCount: 1, stateCount: 1, snapshotCount: 2,
    currentSaved: snapshot, previousSaved: snapshot,
    currentPublic: snapshot, previousPublic: null,
    currentlyEligible: true, sourceFactsPreserved: true,
    orders: 0, registrations: 0, tickets: 0, notices: 0,
  }), /unexpected history/)
})

test('selects the named original free event instead of a later top-level journey pointer', () => {
  assert.equal(legacy.sourceEventFromScenario({
    freeEventId: '55555555-5555-4555-8555-555555555555',
    events: { free: { id: sourceEvent, admission: 'free' } },
  }), sourceEvent)
  assert.throws(() => legacy.sourceEventFromScenario({ events: { free: { id: sourceEvent, admission: 'paid' } } }), /Original free event unavailable/)
})
