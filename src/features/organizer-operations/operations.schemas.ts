import { z } from 'zod'
const count = z.number().int().nonnegative().safe()
export const operationEventSchema = z.strictObject({
  id: z.uuid(), title: z.string().nullable(), startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(), venueName: z.string().nullable(),
  city: z.string().nullable(), status: z.enum(['draft', 'published', 'cancelled']), artworkPath: z.string().nullable(),
})
export const metricsSchema = z.strictObject({
  event: operationEventSchema, grossSalesMinor: count, sold: count, orderCount: count,
  issued: count, checkedIn: count, capacity: count.nullable(), admissionEligible: z.boolean(),
  tiers: z.array(z.strictObject({
    id: z.uuid(), name: z.string(), status: z.enum(['active', 'draft', 'archived']),
    capacity: count, sold: count, remaining: count, grossSalesMinor: count,
  })),
}).refine((value) => value.checkedIn <= value.issued)
export type EventMetrics = z.infer<typeof metricsSchema>
export const orderStatusSchema = z.enum(['creating_checkout','checkout_open','payment_processing','payment_failed','expired','cancelled','paid','refunded','requires_review','partially_refunded'])
export const orderSummarySchema = z.strictObject({
 id: z.uuid(), orderNumber: z.string().min(1), buyerName: z.string(), buyerEmail: z.string(),
 createdAt: z.iso.datetime({ offset: true }), paidAt: z.iso.datetime({ offset: true }).nullable(),
 status: orderStatusSchema, quantity: count, totalMinor: count, currency: z.literal('usd'),
 items: z.array(z.strictObject({ tierName: z.string(), quantity: count, subtotalMinor: count })),
})
export const orderCursorSchema = z.strictObject({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
export const ordersPageSchema = z.strictObject({ orders: z.array(orderSummarySchema).max(50), nextCursor: orderCursorSchema.nullable() })
export type OrderCursor = z.infer<typeof orderCursorSchema>
export type OrderSummary = z.infer<typeof orderSummarySchema>
export const orderDetailSchema = orderSummarySchema.extend({
 tickets: z.array(z.strictObject({ id: z.uuid(), admissionLabel: z.string(), status: z.enum(['valid','used','refunded','cancelled']), usedAt: z.iso.datetime({ offset: true }).nullable(), issuedAt: z.iso.datetime({ offset: true }) }).refine(ticket => (ticket.status === 'used') === (ticket.usedAt !== null))),
 refundState: z.enum(['available','pending','refunded','unavailable']), admissionEligible: z.boolean(),
}).refine(order => order.tickets.length === (order.paidAt ? order.quantity : 0))
export type OrderDetail = z.infer<typeof orderDetailSchema>
export const manualAdmissionSchema = z.union([
 z.strictObject({ outcome: z.enum(['admitted','already_used']), admissionLabel: z.string().min(1).max(80), buyerName: z.string(), usedAt: z.iso.datetime({ offset: true }) }),
 z.strictObject({ outcome: z.enum(['refunded','cancelled']), admissionLabel: z.string().min(1).max(80), buyerName: z.string() }),
 z.strictObject({ outcome: z.enum(['invalid','wrong_event']) }),
])
