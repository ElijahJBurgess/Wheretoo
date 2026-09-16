import { describe, expect, it } from 'vitest'
import { orderDetailV2Schema } from './operations.schemas'
const late = {
 id: 'a6400000-0000-4000-8000-000000000001', orderNumber: 'WT-LATE', buyerName: 'Pat Guest', buyerEmail: 'pat@example.invalid',
 createdAt: '2026-09-10T12:00:00Z', paidAt: '2026-09-10T12:10:00Z', status: 'requires_review', quantity: 3,
 totalMinor: 7000, subtotalMinor: 7000, taxMinor: 0, currency: 'usd',
 items: [{ tierName: 'General', quantity: 2, unitAmountMinor: 2000, subtotalMinor: 4000 }, { tierName: 'VIP', quantity: 1, unitAmountMinor: 3000, subtotalMinor: 3000 }],
 tickets: [], refundState: 'unavailable', admissionEligible: false, paymentAfterInvalidation: true,
}
describe('received payment after invalidation', () => {
 it('allows the explicit canonical no-ticket review DTO', () => expect(orderDetailV2Schema.safeParse(late).success).toBe(true))
 it.each([
  { paymentAfterInvalidation: undefined }, { status: 'paid' }, { paidAt: null },
  { admissionEligible: true }, { refundState: 'available' }, { subtotalMinor: 6999 },
 ])('rejects a widened or incoherent no-ticket exception %j', (change) => expect(orderDetailV2Schema.safeParse({ ...late, ...change }).success).toBe(false))
})
