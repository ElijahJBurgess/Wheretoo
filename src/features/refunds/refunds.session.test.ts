import { beforeEach, expect, it, vi } from 'vitest'
import { clearRefundGrant, readRefundGrant, shortenRefundGrant } from './refunds.session'
const token = 'em1_' + 'A'.repeat(43)
beforeEach(() => { sessionStorage.clear(); clearRefundGrant(); window.history.replaceState(null, '', '/refund-details'); vi.useRealTimers() })
it('consumes the fragment, survives reload only in its separate session and can only shorten expiry', () => {
 window.history.replaceState(null, '', '/refund-details#' + token)
 const grant = readRefundGrant()!
 expect(window.location.hash).toBe('')
 expect(readRefundGrant()).toEqual(grant)
 const earlier = new Date(Date.now() + 60000).toISOString()
 const shortened = shortenRefundGrant(grant, earlier)
 expect(shortened.expiresAt).toBe(Date.parse(earlier))
 expect(shortenRefundGrant(shortened, '2099-01-01T00:00:00Z').expiresAt).toBe(Date.parse(earlier))
 clearRefundGrant(); expect(readRefundGrant()).toBeNull()
})
it('rejects malformed fragments instead of falling back to an older financial grant', () => {
 window.history.replaceState(null, '', '/refund-details#' + token); readRefundGrant()
 window.history.replaceState(null, '', '/refund-details#wrong-purpose-or-malformed'); expect(readRefundGrant()).toBeNull()
 expect(readRefundGrant()).toBeNull()
})
it('removes expired session access', () => {
 vi.useFakeTimers(); window.history.replaceState(null, '', '/refund-details#' + token)
 const grant = readRefundGrant()!; shortenRefundGrant(grant, new Date(Date.now() + 1000).toISOString())
 vi.advanceTimersByTime(1001); expect(readRefundGrant()).toBeNull(); vi.useRealTimers()
})
it('cannot extend a previously shortened grant using a stale in-memory snapshot', () => {
 window.history.replaceState(null, '', '/refund-details#' + token)
 const original = readRefundGrant()!
 const earlier = new Date(Date.now() + 1000).toISOString()
 shortenRefundGrant(original, earlier)
 expect(shortenRefundGrant(original, '2099-01-01T00:00:00Z').expiresAt).toBe(Date.parse(earlier))
})
it('retains current-page access when session storage is unavailable and never needs the fragment again', () => {
 const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled') })
 const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled') })
 window.history.replaceState(null, '', '/refund-details#' + token)
 const grant = readRefundGrant()
 expect(grant?.token).toBe(token)
 expect(readRefundGrant()).toEqual(grant)
 get.mockRestore(); set.mockRestore(); clearRefundGrant()
})
