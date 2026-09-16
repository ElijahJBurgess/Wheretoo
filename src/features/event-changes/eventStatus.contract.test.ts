import './testEnvMock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventStatusAccessSchema } from './eventStatus.schemas'
import { clearEventStatusGrant, readEventStatusGrant, shortenEventStatusGrant } from './eventStatus.session'
import { createEventStatusApi } from './eventStatus.public-api'
const token = 'em1_' + 'a'.repeat(42) + 'A'
const valid = () => ({ kind: 'ready', purpose: 'event_cancellation', expiresAt: new Date(Date.now() + 3600000).toISOString(), detail: { sourceKind: 'paid_order', eventStatus: 'cancelled', facts: null, quantity: 1, orderNumber: 'A1', financialState: 'review', totalMinor: 3000, tickets: [], canViewTickets: false } })
beforeEach(() => { clearEventStatusGrant(); sessionStorage.clear(); history.replaceState(null, '', '/') })
describe('private event status contract', () => {
 it('scrubs em1 fragments before use and bounds local session to server expiry', () => {
  history.replaceState(null, '', `/event-status#${token}`); const grant = readEventStatusGrant()!
  expect(location.hash).toBe(''); expect(grant.token).toBe(token)
  const expiry = new Date(Date.now() + 1000).toISOString(); shortenEventStatusGrant(grant, expiry)
  expect(readEventStatusGrant()?.expiresAt).toBe(Date.parse(expiry))
 })
 it('rejects and scrubs invalid grants rather than reusing an earlier session', () => {
  history.replaceState(null, '', `/event-status#${token}`); readEventStatusGrant()
  history.replaceState(null, '', '/event-status#bad-token'); expect(readEventStatusGrant()).toBeNull(); expect(location.hash).toBe('')
 })
 it('rejects extra sensitive fields, cancellation entry and forged free financial state', () => {
  expect(eventStatusAccessSchema.safeParse(valid()).success).toBe(true)
  expect(eventStatusAccessSchema.safeParse({ ...valid(), email: 'private@example.test' }).success).toBe(false)
  const response = valid(); response.detail.canViewTickets = true; expect(eventStatusAccessSchema.safeParse(response).success).toBe(false)
  response.detail.canViewTickets = false; response.detail.sourceKind = 'free_registration'; expect(eventStatusAccessSchema.safeParse(response).success).toBe(false)
 })
 it('POSTs the grant privately without URL, credential, referrer or cache leakage', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(valid()), { status: 200 }))
  await createEventStatusApi({ supabaseUrl: 'https://unit.invalid', supabasePublishableKey: 'public-test', fetch })(token)
  expect(fetch).toHaveBeenCalledWith('https://unit.invalid/functions/v1/event-status-access', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token }), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }))
 })
})
