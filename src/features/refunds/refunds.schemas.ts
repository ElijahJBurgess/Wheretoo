import { z } from 'zod'
const text = z.string().trim().min(1).max(500)
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const quantity = z.number().int().min(1).max(10000)
const timestamp = z.iso.datetime({ offset: true })
const item = z.strictObject({ tierName: text, quantity, subtotalMinor: minor })
const ticket = z.strictObject({ id: z.uuid(), admissionLabel: text, status: z.enum(['valid', 'used', 'refunded', 'cancelled']), usedAt: timestamp.nullable() })
export const refundStatusSchema = z.strictObject({
 orderId: z.uuid(), eventId: z.uuid(), orderNumber: text, eventName: text, buyerName: text, buyerEmail: z.email(),
 currency: z.literal('usd'), totalMinor: minor, quantity, items: z.array(item).max(10), tickets: z.array(ticket).max(10000),
 state: z.enum(['eligible', 'submitting', 'processing', 'failed', 'unknown', 'review', 'completed', 'ineligible']),
 action: z.enum(['submit', 'reconcile', 'none']), requestedAt: timestamp.nullable(), completedAt: timestamp.nullable(),
}).refine(value => value.action !== 'submit' || value.state === 'eligible')
 .refine(value => value.action !== 'reconcile' || ['submitting', 'processing', 'unknown', 'review'].includes(value.state))
export type RefundStatus = z.infer<typeof refundStatusSchema>
export const refundOutcomeSchema = z.strictObject({ outcome: z.enum(['processing', 'unknown', 'review', 'failed', 'completed', 'already_refunded', 'ineligible', 'unauthorized']) })
export type RefundOutcome = z.infer<typeof refundOutcomeSchema>['outcome']
export const refundNoticeSchema = z.strictObject({ state: z.enum(['not_requested', 'queued', 'sending', 'accepted', 'failed', 'unknown', 'suppressed']), observation: z.enum(['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed']).nullable() })
export const refundDetailSchema = z.strictObject({ kind: z.literal('ready'), expiresAt: timestamp, order: z.strictObject({
 orderNumber: text, eventName: text, startsAt: timestamp, endsAt: timestamp, timezone: text, venueName: text,
 currency: z.literal('usd'), totalMinor: minor, subtotalMinor: minor, quantity, items: z.array(item).min(1).max(10), refundAmountMinor: minor, completedAt: timestamp,
 tickets: z.array(ticket.extend({ status: z.enum(['used', 'refunded']) })).min(1).max(10000),
}) }).refine(({ order }) => order.totalMinor > 0 && order.refundAmountMinor === order.totalMinor && order.subtotalMinor <= order.totalMinor && order.tickets.length === order.quantity && order.items.reduce((sum, row) => sum + row.quantity, 0) === order.quantity && order.items.reduce((sum, row) => sum + row.subtotalMinor, 0) === order.subtotalMinor && new Set(order.tickets.map(row => row.id)).size === order.quantity && order.tickets.every(row => (row.status === 'used') === (row.usedAt !== null)))
export type RefundDetail = z.infer<typeof refundDetailSchema>
