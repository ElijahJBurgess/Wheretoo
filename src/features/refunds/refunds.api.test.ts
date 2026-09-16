import { beforeEach, expect, it, vi } from 'vitest'
import { getRefundStatus, requestRefund } from './refunds.api'
import { createRefundDetailsApi } from './refunds.public-api'
import { detailFixture, refundFixture } from './refunds.fixtures'
const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc, functions: { invoke } } }))
beforeEach(() => vi.resetAllMocks())
it('binds strict organizer status to both requested event and order', async () => {
 rpc.mockResolvedValue({ data: refundFixture, error: null })
 await expect(getRefundStatus(refundFixture.eventId, refundFixture.orderId)).resolves.toEqual(refundFixture)
 await expect(getRefundStatus('66666666-6666-4666-8666-666666666666', refundFixture.orderId)).rejects.toThrow('Refund status unavailable')
 rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'private' } })
 await expect(getRefundStatus(refundFixture.eventId, refundFixture.orderId)).rejects.toMatchObject({ accessDenied: true, message: 'Refund status unavailable' })
})
it('sends only identifiers and a bounded action, safely parses refusal and authorization', async () => {
 invoke.mockResolvedValue({ data: { outcome: 'already_refunded' }, error: null })
 await expect(requestRefund(refundFixture.eventId, refundFixture.orderId, 'reconcile')).resolves.toEqual({ outcome: 'already_refunded' })
 expect(invoke).toHaveBeenCalledWith('organizer-refund-order', { body: { eventId: refundFixture.eventId, orderId: refundFixture.orderId, action: 'reconcile' } })
 invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ outcome: 'ineligible' }), { status: 409 }) } })
 await expect(requestRefund(refundFixture.eventId, refundFixture.orderId, 'submit')).resolves.toEqual({ outcome: 'ineligible' })
 invoke.mockResolvedValue({ data: null, error: { context: new Response('private', { status: 403 }) } })
 await expect(requestRefund(refundFixture.eventId, refundFixture.orderId, 'submit')).rejects.toMatchObject({ accessDenied: true })
})
it('financial access is no-store POST and rejects leaked fields and expired grants', async () => {
 const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(detailFixture)))
 const api = createRefundDetailsApi({ supabaseUrl: 'https://example.invalid', supabasePublishableKey: 'public-test', fetch: fetcher })
 const token = 'em1_' + 'A'.repeat(43)
 await expect(api(token)).resolves.toEqual(detailFixture)
 expect(fetcher).toHaveBeenCalledWith('https://example.invalid/functions/v1/refund-detail-access', expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', body: JSON.stringify({ token }) }))
 fetcher.mockResolvedValue(new Response(JSON.stringify({ ...detailFixture, expiresAt: '2020-01-01T00:00:00Z' })))
 await expect(api(token)).rejects.toMatchObject({ kind: 'unavailable' })
 fetcher.mockResolvedValue(new Response(JSON.stringify({ ...detailFixture, order: { ...detailFixture.order, buyerEmail: 'private@example.invalid' } })))
 await expect(api(token)).rejects.toMatchObject({ kind: 'unavailable' })
})
