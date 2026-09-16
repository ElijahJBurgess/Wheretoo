const assert = require('node:assert/strict')
const test = require('node:test')

const recovery = require('./spec14-j08-read-recovery.cjs')

function request(url, method = 'POST', body = {}) {
  return { url: () => url, method: () => method, postDataJSON: () => body }
}

test('matches only the intended original read and only while armed', () => {
  const control = recovery.readControl({
    path: '/rest/v1/rpc/get_organizer_free_registration_detail',
    body: { p_event_id: 'event-1', p_registration_id: 'registration-1' },
  })
  assert.equal(control.matches(request(
    'http://127.0.0.1:55647/rest/v1/rpc/get_organizer_free_registration_detail',
    'POST',
    { p_event_id: 'event-1', p_registration_id: 'registration-1' },
  )), false)
  control.arm()
  assert.equal(control.matches(request(
    'http://127.0.0.1:55647/rest/v1/rpc/get_organizer_free_registration_detail',
    'POST',
    { p_event_id: 'event-1', p_registration_id: 'registration-1' },
  )), true)
  assert.equal(control.matches(request(
    'http://127.0.0.1:55647/rest/v1/rpc/get_organizer_free_registration_detail',
    'POST',
    { p_event_id: 'event-1', p_registration_id: 'another-registration' },
  )), false)
  assert.deepEqual(control.summary(), { attempts: 2, intercepted: 1 })
})

test('classifies domain writers while permitting the closed read set', () => {
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:3040/rest/v1/events', 'PATCH')), 'rest:events')
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:3040/rest/v1/rpc/save_ticket_tiers')), 'rpc:save_ticket_tiers')
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:3040/functions/v1/free-rsvp')), 'function:free-rsvp')
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:3040/functions/v1/ticket-email-status')), null)
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:55647/rest/v1/rpc/get_public_event_ticketing')), null)
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:55647/rest/v1/rpc/get_public_free_rsvp')), null)
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:55647/functions/v1/ticket-email-status')), null)
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:55647/rest/v1/rpc/redeem_owned_ticket')), 'rpc:redeem_owned_ticket')
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:55647/functions/v1/free-rsvp')), 'function:free-rsvp')
  assert.equal(recovery.businessWriter(request('http://127.0.0.1:55647/rest/v1/tickets', 'PATCH')), 'rest:tickets')
})

test('derives the RSVP confirmation from the private collection without exposing a generic redirect', () => {
  assert.equal(
    recovery.rsvpConfirmationPath('http://127.0.0.1:3040/tickets/rsvp_PRIVATE'),
    '/rsvp/rsvp_PRIVATE',
  )
  for (const value of [
    'http://127.0.0.1:3040/discover',
    'http://127.0.0.1:9999/tickets/rsvp_PRIVATE',
    'https://example.test/tickets/rsvp_PRIVATE',
  ]) assert.throws(() => recovery.rsvpConfirmationPath(value), /Original free collection URL unavailable/)
})
