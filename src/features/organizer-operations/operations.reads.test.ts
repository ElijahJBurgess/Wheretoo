import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))
import { getOrder, getOrderDetails, listEventOrders } from './operations.api'
import { isOperationsAccessDenied } from './operations.errors'
const eventId = 'a6200000-0000-4000-8000-000000000001'
const orderId = 'a6500000-0000-4000-8000-000000000001'
const legacy = {
  id: orderId, orderNumber: 'WT-SYNTHETIC', buyerName: 'Synthetic Buyer', buyerEmail: 'buyer@example.invalid',
  createdAt: '2026-09-11T12:00:00Z', paidAt: null, status: 'checkout_open', quantity: 3, totalMinor: 9350, currency: 'usd',
  items: [{ tierName: 'GA', quantity: 2, subtotalMinor: 4000 }, { tierName: 'VIP', quantity: 1, subtotalMinor: 4500 }],
  tickets: [], refundState: 'unavailable', admissionEligible: false,
}
const detail = { ...legacy, subtotalMinor: 8500, taxMinor: 850,
  items: [{ ...legacy.items[0], unitAmountMinor: 2000 }, { ...legacy.items[1], unitAmountMinor: 4500 }] }
beforeEach(() => rpc.mockReset())
it('keeps the old detail reader intact while validating V2 snapshots', async () => {
  rpc.mockResolvedValueOnce({ data: legacy, error: null }).mockResolvedValueOnce({ data: detail, error: null })
  expect(await getOrder(eventId, orderId)).toEqual(legacy)
  expect(await getOrderDetails(eventId, orderId)).toEqual(detail)
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['get_organizer_order', 'get_organizer_order_v2'])
})
it.each([
  { ...detail, taxMinor: 1 },
  { ...detail, items: [{ ...detail.items[0], unitAmountMinor: 2500 }, detail.items[1]] },
  { ...detail, credential_hash: 'must-not-leak' },
  { ...detail, id: eventId },
])('rejects contradictory money or unexpected detail fields', async invalid => {
  rpc.mockResolvedValue({ data: invalid, error: null })
  await expect(getOrderDetails(eventId, orderId)).rejects.toThrow('Order unavailable')
})
it('passes literal search and status to bounded server pagination', async () => {
  rpc.mockResolvedValue({ data: { orders: [], nextCursor: null }, error: null })
  await listEventOrders(eventId, '%_\\', null, 'refunded')
  expect(rpc).toHaveBeenCalledWith('list_organizer_event_orders_filtered', {
    p_event_id: eventId, p_search: '%_\\', p_status: 'refunded', p_limit: 25,
  })
})
it('retains a safe access-denied category without exposing database messages', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'private provider details' } })
  const error = await listEventOrders(eventId, '', null).catch(value => value)
  expect(isOperationsAccessDenied(error)).toBe(true)
  expect(error.message).toBe('Orders unavailable')
})
