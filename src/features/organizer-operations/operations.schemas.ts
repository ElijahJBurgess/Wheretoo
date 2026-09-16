import { z } from 'zod'
const count = z.number().int().nonnegative().safe()
export const operationEventSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().nullable(),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  status: z.enum(['draft', 'published', 'cancelled']),
  artworkPath: z.string().nullable(),
})
export const metricsSchema = z.strictObject({
  event: operationEventSchema,
  grossSalesMinor: count,
  sold: count,
  orderCount: count,
  issued: count,
  checkedIn: count,
  capacity: count.nullable(),
  admissionEligible: z.boolean(),
  tiers: z.array(z.strictObject({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(['active', 'draft', 'archived']),
    capacity: count,
    sold: count,
    remaining: count,
    grossSalesMinor: count,
  })),
}).refine((value) => value.checkedIn <= value.issued)
export type EventMetrics = z.infer<typeof metricsSchema>
export const orderStatusSchema = z.enum([
  'creating_checkout',
  'checkout_open',
  'payment_processing',
  'payment_failed',
  'expired',
  'cancelled',
  'paid',
  'refunded',
  'requires_review',
  'partially_refunded',
])
export const orderSummarySchema = z.strictObject({
  id: z.uuid(),
  orderNumber: z.string().min(1),
  buyerName: z.string(),
  buyerEmail: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  paidAt: z.iso.datetime({ offset: true }).nullable(),
  status: orderStatusSchema,
  quantity: count,
  totalMinor: count,
  currency: z.literal('usd'),
  items: z.array(z.strictObject({ tierName: z.string(), quantity: count, subtotalMinor: count })),
})
export const orderCursorSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
})
export const ordersPageSchema = z.strictObject({
  orders: z.array(orderSummarySchema).max(50),
  nextCursor: orderCursorSchema.nullable(),
})
export type OrderCursor = z.infer<typeof orderCursorSchema>
export type OrderSummary = z.infer<typeof orderSummarySchema>
export const orderDetailSchema = orderSummarySchema.extend({
  tickets: z.array(
    z.strictObject({
      id: z.uuid(),
      admissionLabel: z.string(),
      status: z.enum(['valid', 'used', 'refunded', 'cancelled']),
      usedAt: z.iso.datetime({ offset: true }).nullable(),
      issuedAt: z.iso.datetime({ offset: true }),
    }).refine((ticket) => (ticket.status === 'used') === (ticket.usedAt !== null)),
  ),
  paymentAfterInvalidation: z.literal(true).optional(),
  refundState: z.enum(['available', 'pending', 'refunded', 'unavailable', 'recoverable']),
  admissionEligible: z.boolean(),
}).refine((order) => order.paymentAfterInvalidation === true
  ? order.status === 'requires_review' && order.paidAt !== null && order.quantity > 0 && order.totalMinor > 0
    && order.tickets.length === 0 && !order.admissionEligible && order.refundState === 'unavailable'
  : order.tickets.length === (order.paidAt ? order.quantity : 0))
export const orderDetailV2Schema = orderDetailSchema.safeExtend({
  subtotalMinor: count,
  taxMinor: count,
  items: z.array(z.strictObject({ tierName: z.string(), quantity: count.positive(), subtotalMinor: count, unitAmountMinor: count })),
}).refine(order => order.subtotalMinor + order.taxMinor === order.totalMinor
  && order.items.reduce((sum, item) => sum + item.subtotalMinor, 0) === order.subtotalMinor
  && order.items.every(item => item.unitAmountMinor * item.quantity === item.subtotalMinor))
export type OrderDetail = z.infer<typeof orderDetailV2Schema>
export type OrderFilter = 'all' | 'paid' | 'refunded'
export const manualAdmissionSchema = z.union([
  z.strictObject({
    outcome: z.enum(['admitted', 'already_used']),
    admissionLabel: z.string().min(1).max(80),
    buyerName: z.string(),
    usedAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    outcome: z.enum(['refunded', 'cancelled']),
    admissionLabel: z.string().min(1).max(80),
    buyerName: z.string(),
  }),
  z.strictObject({ outcome: z.enum(['invalid', 'wrong_event']) }),
])
export const refundResponseSchema = z.strictObject({ outcome: z.enum(['pending', 'refunded']) })

export const admissionCursorSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }), orderId: z.uuid(), orderItemId: z.uuid(),
  unitSequence: z.number().int().min(1).max(10),
})
export const admissionRowSchema = z.strictObject({
  ticketId: z.uuid(), orderId: z.uuid(), orderNumber: z.string().min(1),
  buyerName: z.string(), buyerEmail: z.string(), admissionLabel: z.string().min(1).max(80),
  ticketPosition: z.number().int().min(1).max(10), ticketTotal: z.number().int().min(1).max(10),
  status: z.enum(['valid', 'used', 'refunded', 'cancelled']), usedAt: z.iso.datetime({ offset: true }).nullable(),
}).refine(row => row.ticketPosition <= row.ticketTotal && (row.status === 'used') === (row.usedAt !== null))
export const admissionPageSchema = z.strictObject({
  admissions: z.array(admissionRowSchema).max(50), nextCursor: admissionCursorSchema.nullable(),
})
export type AdmissionCursor = z.infer<typeof admissionCursorSchema>
export type AdmissionPage = z.infer<typeof admissionPageSchema>
export type ManualAdmissionResult = z.infer<typeof manualAdmissionSchema>
