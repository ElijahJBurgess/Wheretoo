import { expect, it } from 'vitest'
import { refundStatusSchema, refundDetailSchema } from './refunds.schemas'
import { detailFixture, refundFixture } from './refunds.fixtures'
it('rejects provider fields, impossible actions and incomplete full-refund history', () => {
  expect(refundStatusSchema.safeParse(refundFixture).success).toBe(true)
  expect(refundStatusSchema.safeParse({ ...refundFixture, providerId: 'private' }).success).toBe(false)
  expect(refundStatusSchema.safeParse({ ...refundFixture, state: 'unknown', action: 'submit' }).success).toBe(false)
  expect(refundDetailSchema.safeParse(detailFixture).success).toBe(true)
  expect(refundDetailSchema.safeParse({ ...detailFixture, order: { ...detailFixture.order, refundAmountMinor: 2000 } }).success).toBe(false)
  expect(refundDetailSchema.safeParse({ ...detailFixture, order: { ...detailFixture.order, tickets: [{ ...detailFixture.order.tickets[0], usedAt: null }] } }).success).toBe(false)
})
it('accepts coherent historical four-item snapshots allowed by the server contract', () => {
 const items = [{ tierName: 'GA early', quantity: 1, subtotalMinor: 1000 }, { tierName: 'GA', quantity: 1, subtotalMinor: 2000 }, { tierName: 'VIP early', quantity: 1, subtotalMinor: 2000 }, { tierName: 'VIP', quantity: 1, subtotalMinor: 2000 }]
 const tickets = [...detailFixture.order.tickets, { id: '66666666-6666-4666-8666-666666666666', admissionLabel: 'VIP', status: 'refunded', usedAt: null }]
 expect(refundStatusSchema.safeParse({ ...refundFixture, quantity: 4, items, tickets }).success).toBe(true)
 expect(refundDetailSchema.safeParse({ ...detailFixture, order: { ...detailFixture.order, quantity: 4, items, tickets } }).success).toBe(true)
})
