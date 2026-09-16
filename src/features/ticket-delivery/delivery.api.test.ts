import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))
vi.mock('../../lib/env', () => ({ publicEnv: { supabaseUrl: 'https://public.example', supabasePublishableKey: 'public-key' } }))
import { createPublicTicketDeliveryApi } from './delivery.public-api'
import { getDelivery, getResendStatus, requestResend } from './delivery.api'
const id = '11111111-1111-4111-8111-111111111111'
const source = { eventId: id, sourceId: id, sourceKind: 'paid_order' as const }
const token = 'em1_' + 'A'.repeat(43)
const latest = { id, state: 'queued', observation: null, createdAt: '2026-09-11T12:00:00Z', stoppedReason: null }
beforeEach(() => { vi.resetAllMocks() })
describe('owner delivery boundary', () => {
  it('rejects another source and malformed eligibility rather than showing its recipient', async () => {
    rpc.mockResolvedValue({ data: { ...source, sourceId: '22222222-2222-4222-8222-222222222222', recipientEmail: 'a@example.com', eligible: true, reason: null, configured: true, latest }, error: null })
    await expect(getDelivery(source)).rejects.toThrow('Ticket email unavailable')
    rpc.mockResolvedValue({ data: { ...source, recipientEmail: 'a@example.com', eligible: true, reason: 'ended', configured: true, latest }, error: null })
    await expect(getDelivery(source)).rejects.toThrow()
  })
  it('uses only source and request identity for resend and exact status', async () => {
    rpc.mockResolvedValueOnce({ data: { kind: 'queued', attemptId: id }, error: null }).mockResolvedValueOnce({ data: latest, error: null })
    expect(await requestResend(source, id)).toEqual({ kind: 'queued', attemptId: id })
    expect(await getResendStatus(source, id)).toEqual(latest)
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['request_ticket_email_resend', 'get_ticket_email_resend_status'])
    expect(rpc.mock.calls[0]?.[1]).toEqual({ p_event_id: id, p_source_kind: 'paid_order', p_source_id: id, p_request_id: id })
  })
  it('rejects malformed success', async () => {
    rpc.mockResolvedValue({ data: { kind: 'accepted' }, error: null })
    await expect(requestResend(source, id)).rejects.toThrow()
  })
})
describe('public delivery boundary', () => {
  function setup(body: unknown, status = 200) {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }))
    return { fetch, api: createPublicTicketDeliveryApi({ supabaseUrl: 'https://public.example', supabasePublishableKey: 'public-key', fetch }) }
  }
  it('normalizes email without aliases and uses anonymous no-store requests', async () => {
    const { api, fetch } = setup({ kind: 'requested' }, 202)
    expect(await api.recover(' Alex+night@Example.com ', id)).toEqual({ kind: 'requested' })
    expect(fetch).toHaveBeenCalledWith('https://public.example/functions/v1/ticket-recovery-request', expect.objectContaining({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', body: JSON.stringify({ email: 'alex+night@example.com', requestId: id }), headers: { apikey: 'public-key', 'content-type': 'application/json' } }))
  })
  it('rejects invented recovery success and invalid inputs', async () => {
    const { api, fetch } = setup({ kind: 'requested', matches: 1 }, 202)
    await expect(api.recover('x@example.com', id)).rejects.toThrow()
    await expect(api.recover('invalid', id)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('validates page identity, exact page size, membership order and expiry', async () => {
    const row = (selector: number) => ({ selector, sourceKind: 'paid_order', eventName: 'Night', startsAt: '2027-01-01T12:00:00Z', quantity: 2, createdAt: '2026-09-11T12:00:00Z' })
    const body = { kind: 'index', expiresAt: '2027-01-01T12:00:00Z', total: 21, page: 0, nextPage: 1, collections: Array.from({ length: 20 }, (_, i) => row(i + 1)) }
    const { api, fetch } = setup(body)
    expect((await api.index(token, 0)).collections).toHaveLength(20)
    await expect(api.index(token, 1)).rejects.toThrow()
    fetch.mockResolvedValue(new Response(JSON.stringify({ ...body, collections: [row(21)] })))
    await expect(api.index(token, 0)).rejects.toThrow()
  })
  it('rejects foreign source collections and preserves free used history', async () => {
    const collection = { registrationId: id, registrationStatus: 'confirmed', collectionLabel: 'Your tickets', eventId: id, tickets: [{ selector: id, eventId: id, eventName: 'Night', startsAt: '2027-01-01T12:00:00Z', endsAt: '2027-01-02T12:00:00Z', venueName: 'Hall', admissionLabel: 'GA', attendeeLabel: 'Alex', timezone: 'UTC', position: 1, totalInCollection: 1, status: 'used', usedAt: '2027-01-01T14:00:00Z', admissionCredential: null }] }
    const { api } = setup({ kind: 'ready', expiresAt: '2027-01-03T12:00:00Z', collection })
    await expect(api.member(token, 1, 'paid_order')).rejects.toThrow()
    expect((await api.member(token, 1, 'free_registration')).collection.tickets[0]?.usedAt).toBe('2027-01-01T14:00:00Z')
  })
  it('preserves paid rsvp-prefixed 43-character bearer and free namespace', async () => {
    const { api, fetch } = setup({ state: 'accepted', observation: 'bounced' })
    await api.status('rsvp_' + 'A'.repeat(38))
    await api.status('rsvp_' + 'A'.repeat(43))
    expect(fetch).toHaveBeenCalledTimes(2)
    await expect(api.status('rsvp_short')).rejects.toThrow()
  })
})
it('rejects a contradictory delivery observation instead of claiming acceptance', async () => {
  rpc.mockResolvedValue({ data: { ...latest, state: 'unknown', observation: 'delivered' }, error: null })
  await expect(getResendStatus(source, id)).rejects.toThrow()
})
it.each(['alex!guest@example.com', "alex.!#$%&'*+/=?^_`{|}~-guest@example.com", 'alex.first+night@example.com'])('accepts canonical ASCII recipient %s without rewriting aliases', async email => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ kind: 'requested' }), { status: 202 }))
  const api = createPublicTicketDeliveryApi({ supabaseUrl: 'https://public.example', supabasePublishableKey: 'public-key', fetch })
  await api.recover(' ' + email.toUpperCase() + ' ', id)
  expect(JSON.parse(fetch.mock.calls[0]![1].body).email).toBe(email)
})
it.each(['alex guest@example.com', 'áléx@example.com', 'alex@-example.com', 'alex@example', 'a'.repeat(310) + '@example.com'])('rejects noncanonical recipient %s', async email => {
  const fetch = vi.fn()
  const api = createPublicTicketDeliveryApi({ supabaseUrl: 'https://public.example', supabasePublishableKey: 'public-key', fetch })
  await expect(api.recover(email, id)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
it.each([429, 503])('preserves temporary public HTTP %s failure without labelling the grant invalid', async status => {
  const api = createPublicTicketDeliveryApi({ supabaseUrl: 'https://public.example', supabasePublishableKey: 'public-key', fetch: vi.fn().mockResolvedValue(new Response('{}', { status })) })
  await expect(api.index(token, 0)).rejects.toMatchObject({ kind: status === 429 ? 'rate_limited' : 'temporary' })
})
