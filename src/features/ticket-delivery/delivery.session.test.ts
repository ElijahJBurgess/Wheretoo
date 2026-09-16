import { beforeEach, expect, it, vi } from 'vitest'
import { captureTicketAccess, readTicketAccess, shortenTicketAccess, rememberResend, readResend, clearResend, retireResend } from './delivery.session'
const token = 'em1_' + 'A'.repeat(43)
beforeEach(() => { sessionStorage.clear(); history.replaceState(null, '', '/'); vi.restoreAllMocks() })
it('removes fragments synchronously, stores a single bounded tab grant and only shortens expiry', () => {
  history.replaceState(null, '', '/ticket-access#' + token)
  captureTicketAccess()
  expect(location.hash).toBe('')
  expect(location.pathname + location.search).toBe('/ticket-access')
  const current = readTicketAccess()!
  expect(current.token).toBe(token)
  shortenTicketAccess(new Date(current.expiresAt - 10000).toISOString())
  shortenTicketAccess(new Date(current.expiresAt + 10000).toISOString())
  expect(readTicketAccess()?.expiresAt).toBe(current.expiresAt - 10000)
  shortenTicketAccess('2000-01-01T00:00:00Z')
  expect(readTicketAccess()).toBeNull()
})
it('invalid links clear prior access and storage refusal stays usable only in this tab', () => {
  history.replaceState(null, '', '/ticket-access#' + token)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  captureTicketAccess()
  expect(location.hash).toBe('')
  expect(readTicketAccess()?.token).toBe(token)
  history.replaceState(null, '', '/ticket-access#invalid')
  captureTicketAccess()
  expect(readTicketAccess()).toBeNull()
})
it('retains exact resend identity by owner/event/source before sending', () => {
  const source = { ownerId: 'owner', eventId: 'event', sourceKind: 'paid_order' as const, sourceId: 'order' }
  const id = rememberResend(source)
  expect(readResend(source)).toBe(id)
  expect(rememberResend(source)).toBe(id)
  expect(readResend({ ...source, ownerId: 'other' })).toBeNull()
  clearResend(source)
  expect(rememberResend(source)).not.toBe(id)
})
it('refuses to send if operation identity cannot survive remount', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  expect(() => rememberResend({ ownerId: 'owner', eventId: 'event', sourceKind: 'free_registration', sourceId: 'registration' })).toThrow()
})
it('retires exact verified completed requests without evicting uncertain requests from bounded storage', () => {
  const source = (sourceId: string) => ({ ownerId: 'owner', eventId: 'event', sourceKind: 'paid_order' as const, sourceId })
  const unresolved = Array.from({ length: 50 }, (_, n) => source('unknown-' + n))
  const ids = unresolved.map(rememberResend)
  expect(() => rememberResend(source('more'))).toThrow()
  // A stale status for another request cannot free an unresolved slot.
  retireResend(unresolved[0]!, crypto.randomUUID(), 'accepted')
  expect(() => rememberResend(source('more'))).toThrow()
  retireResend(unresolved[0]!, ids[0]!, 'accepted')
  expect(readResend(unresolved[0]!)).toBe(ids[0])
  const next = rememberResend(source('more'))
  expect(next).toBeTruthy()
  retireResend(source('more'), next, 'failed')
  // Completed history is bounded independently; only completed rows can be retired.
  for (let n = 0; n < 60; n++) {
    const item = source('done-' + n)
    retireResend(item, rememberResend(item), 'accepted')
  }
  for (let n = 1; n < 50; n++) expect(readResend(unresolved[n]!)).toBe(ids[n])
  const stored = JSON.parse(sessionStorage.getItem('wheretoo:ticket-resends:v1')!)
  expect(stored.length).toBeLessThanOrEqual(100)
})
it('releases verified suppressed capacity while preserving every still-unresolved identity', () => {
  const source = (sourceId: string) => ({ ownerId: 'owner', eventId: 'event', sourceKind: 'free_registration' as const, sourceId })
  const items = Array.from({ length: 50 }, (_, n) => source(String(n)))
  const ids = items.map(rememberResend)
  retireResend(items[0]!, ids[0]!, 'suppressed')
  expect(readResend(items[0]!)).toBe(ids[0])
  expect(rememberResend(source('new'))).toBeTruthy()
  for (let n = 1; n < 50; n++) expect(readResend(items[n]!)).toBe(ids[n])
})
