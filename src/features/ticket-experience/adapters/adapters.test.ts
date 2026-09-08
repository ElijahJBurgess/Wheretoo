import { describe, expect, it, vi } from 'vitest'
import { admissionCheckerContract, ticketCollectionReaderContract } from '../contracts/contractTests'
import { createAdmissionChecker } from './admissionChecker'
import { createTicketCollectionReader } from './ticketCollectionReader'

const eventId = 'c9300000-0000-4000-8000-000000000001'
const wrongEventId = 'c9300000-0000-4000-8000-000000000002'
// Synthetic values, never issued by any backend.
const bearer = (letter: string) => letter.repeat(42) + 'A'
const credential = (letter: string) => 'wta1_' + bearer(letter)
const env = { supabaseUrl: 'https://ticket-test.invalid', supabasePublishableKey: 'sb_publishable_test_only' }
const ticket = {
  selector: 'c9300000-0000-4000-8000-000000000003', eventId,
  eventName: 'Night Market', startsAt: '2026-10-01T01:00:00+00:00', endsAt: '2026-10-01T04:00:00+00:00',
  venueName: 'Civic Center', admissionLabel: 'General Admission', position: 1, totalInCollection: 1,
  status: 'valid' as const, admissionCredential: credential('a'),
}
function ready(tickets: unknown[] = [ticket]) {
  return { kind: 'ready', collection: { collectionLabel: 'Night Market tickets', eventId, tickets } }
}
function fetchResponse(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }))
}
function readerFor(body: unknown, status = 200) {
  return createTicketCollectionReader({ ...env, fetch: fetchResponse(body, status) })
}

ticketCollectionReaderContract('strict Edge', () => createTicketCollectionReader({
  ...env,
  fetch: vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const input = JSON.parse(String(init?.body)) as { collectionBearer: string }
    const value = input.collectionBearer
    if (value === bearer('a')) return new Response(JSON.stringify(ready()))
    if (value === bearer('b')) return new Response(JSON.stringify(ready([
      { ...ticket, totalInCollection: 2 },
      { ...ticket, selector: 'c9300000-0000-4000-8000-000000000004', position: 2, totalInCollection: 2, admissionCredential: credential('b') },
    ])))
    for (const [letter, status] of [['c', 'used'], ['d', 'refunded'], ['e', 'cancelled']]) {
      if (value === bearer(letter!)) return new Response(JSON.stringify(ready([{ ...ticket, status, admissionCredential: null }])))
    }
    if (value === bearer('f')) return new Response(JSON.stringify({ kind: 'empty', eventId }))
    return new Response(JSON.stringify({ kind: 'unavailable' }), { status: 404 })
  }),
}), {
  paidSingleBearer: bearer('a'), paidMultiBearer: bearer('b'),
  inactiveBearers: { used: bearer('c'), refunded: bearer('d'), cancelled: bearer('e') },
  emptyBearer: bearer('f'), unavailableBearer: bearer('g'),
  admissionCredentialAsBearer: credential('a'), eventId, optionalTicketFields: [],
})

const outcomes = ['admitted', 'already_used', 'refunded', 'cancelled', 'invalid', 'network_error'] as const
admissionCheckerContract('strict Edge', () => createAdmissionChecker(async (_name, input) => {
  if (input.body.eventId !== eventId) return { data: { outcome: 'wrong_event' }, error: null }
  const index = 'abcdef'.indexOf(input.body.credential.charAt(5))
  const outcome = outcomes[index] ?? 'invalid'
  return {
    data: ['invalid', 'network_error'].includes(outcome) ? { outcome } : { outcome, admissionLabel: 'General Admission' },
    error: null,
  }
}), {
  expected: outcomes.map((outcome, index) => ({ eventId, credential: credential('abcdef'.charAt(index)), outcome })),
  paidValidCredential: credential('a'), collectionBearerAsCredential: bearer('a'),
  checkoutBearerAsCredential: bearer('b'), eventId, wrongEventId, optionalResultFields: [],
  malformedCredentialOutcome: 'network_error',
})

describe('strict ticket collection boundary', () => {
  it.each([
    ['extra top-level field', { ...ready(), secret: 'forbidden' }],
    ['missing collection', { kind: 'ready' }],
    ['extra collection field', { kind: 'ready', collection: { ...ready().collection, orderId: 'forbidden' } }],
    ['bad collection event', { kind: 'ready', collection: { ...ready().collection, eventId: 'not-a-uuid' } }],
    ['zero ready tickets', ready([])],
    ['too many tickets', ready(Array.from({ length: 11 }, () => ticket))],
    ['unknown result', { kind: 'success' }],
    ['unavailable extra field', { kind: 'unavailable', details: 'forbidden' }],
    ['empty bad UUID', { kind: 'empty', eventId: 'bad' }],
  ])('rejects %s', async (_name, value) => {
    await expect(readerFor(value).readCollection({ collectionBearer: bearer('a') })).resolves.toEqual({ kind: 'unavailable' })
  })

  it.each([
    ['extra ticket field', { internalId: 'forbidden' }],
    ['unapproved attendee field', { attendeeLabel: 'Invented' }],
    ['unapproved directions field', { directionsUrl: 'https://example.com' }],
    ['missing credential', { admissionCredential: undefined }],
    ['malformed credential', { admissionCredential: 'not-a-credential' }],
    ['noncanonical credential', { admissionCredential: 'wta1_' + 'a'.repeat(42) + 'B' }],
    ['inactive credential', { status: 'used' }],
    ['valid null credential', { admissionCredential: null }],
    ['wrong event', { eventId: wrongEventId }],
    ['bad selector UUID', { selector: 'bad' }],
    ['missing label', { admissionLabel: undefined }],
    ['blank label', { admissionLabel: ' ' }],
    ['overlong label', { admissionLabel: 'a'.repeat(81) }],
    ['bad date', { startsAt: 'yesterday' }],
    ['invalid calendar date', { startsAt: '2026-02-30T01:00:00Z' }],
    ['reversed dates', { endsAt: ticket.startsAt }],
    ['missing venue', { venueName: undefined }],
    ['wrong total', { totalInCollection: 2 }],
    ['wrong position', { position: 2 }],
    ['fractional position', { position: 1.1 }],
  ])('rejects ticket %s', async (_name, overrides) => {
    await expect(readerFor(ready([{ ...ticket, ...overrides }])).readCollection({ collectionBearer: bearer('a') })).resolves.toEqual({ kind: 'unavailable' })
  })

  it.each([
    ['duplicate selectors', { selector: ticket.selector, position: 2, admissionCredential: credential('b') }],
    ['duplicate positions', { selector: wrongEventId, position: 1, admissionCredential: credential('b') }],
    ['duplicate credentials', { selector: wrongEventId, position: 2 }],
    ['inconsistent event title', { selector: wrongEventId, position: 2, admissionCredential: credential('b'), eventName: 'Another event' }],
  ])('rejects %s', async (_name, overrides) => {
    await expect(readerFor(ready([{ ...ticket, totalInCollection: 2 }, { ...ticket, ...overrides, totalInCollection: 2 }]))
      .readCollection({ collectionBearer: bearer('a') })).resolves.toEqual({ kind: 'unavailable' })
  })

  it('sends the bearer only in the Edge body with the actual abort signal and no auth/storage', async () => {
    const fetch = fetchResponse(ready())
    const signal = new AbortController().signal
    await createTicketCollectionReader({ ...env, fetch }).readCollection({ collectionBearer: bearer('a'), signal })
    expect(fetch).toHaveBeenCalledWith(env.supabaseUrl + '/functions/v1/ticket-collection', {
      method: 'POST', headers: { apikey: env.supabasePublishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ collectionBearer: bearer('a') }), signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    })
  })

  it.each([401, 403, 404, 500])('fails closed on HTTP %s even with a ready body', async (status) => {
    await expect(readerFor(ready(), status).readCollection({ collectionBearer: bearer('a') })).resolves.toEqual({ kind: 'unavailable' })
  })
  it('sanitizes transport errors and never logs private errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('private transport detail'))
    const log = vi.spyOn(console, 'error')
    await expect(createTicketCollectionReader({ ...env, fetch }).readCollection({ collectionBearer: bearer('a') })).resolves.toEqual({ kind: 'unavailable' })
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('strict admission boundary', () => {
  it.each([
    ['extra key', { outcome: 'admitted', admissionLabel: 'GA', attendeeLabel: 'Invented' }],
    ['missing label', { outcome: 'admitted' }],
    ['overlong label', { outcome: 'admitted', admissionLabel: 'a'.repeat(81) }],
    ['blank label', { outcome: 'admitted', admissionLabel: '' }],
    ['wrong-event disclosure', { outcome: 'wrong_event', admissionLabel: 'GA' }],
    ['unknown outcome', { outcome: 'success' }],
    ['null', null],
  ])('returns network_error for %s', async (_name, data) => {
    const checker = createAdmissionChecker(async () => ({ data, error: null }))
    await expect(checker.checkAdmission({ eventId, credential: credential('a') })).resolves.toEqual({ outcome: 'network_error' })
  })
  it('forwards the exact event, credential and abort signal to Edge invocation', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { outcome: 'admitted', admissionLabel: 'GA' }, error: null })
    const signal = new AbortController().signal
    const checker = createAdmissionChecker(invoke)
    await checker.checkAdmission({ eventId, credential: credential('a'), signal })
    expect(invoke).toHaveBeenCalledWith('ticket-admission', { body: { eventId, credential: credential('a') }, signal })
  })
  it.each(['transport', 'auth'])('fails closed on %s errors despite an admitted body', async (kind) => {
    const invoke = vi.fn()
    if (kind === 'transport') invoke.mockRejectedValue(new Error('private transport detail'))
    else invoke.mockResolvedValue({ data: { outcome: 'admitted', admissionLabel: 'GA' }, error: new Error('private auth detail') })
    await expect(createAdmissionChecker(invoke).checkAdmission({ eventId, credential: credential('a') })).resolves.toEqual({ outcome: 'network_error' })
  })
  it('rejects malformed event identity without invoking Edge', async () => {
    const invoke = vi.fn()
    await expect(createAdmissionChecker(invoke).checkAdmission({ eventId: 'bad', credential: credential('a') })).resolves.toEqual({ outcome: 'network_error' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
