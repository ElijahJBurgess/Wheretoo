import { z } from 'zod'
import { orderStatusSchema } from './operations.schemas'

export const EXPORT_MAX_ROWS = 10_000
export const EXPORT_MAX_BYTES = 8 * 1024 * 1024
export type ExportKind = 'orders' | 'admissions' | 'registrations'
const time = z.iso.datetime({ offset: true })
const money = z.number().int().nonnegative().safe()
const quantity = z.number().int().min(1).max(10)
// PostgreSQL char_length counts codepoints; preserve the original string.
const text = (min: number, max: number) => z.string().refine(value => {
  const length = Array.from(value).length
  return length >= min && length <= max
})
const name = text(1, 200)
const email = text(3, 320)
const orderNumber = z.string().min(1).max(64)
const label = text(1, 80)
const ticketStatus = z.enum(['valid', 'used', 'refunded', 'cancelled'])
const refundState = z.enum(['eligible', 'submitting', 'processing', 'failed', 'unknown', 'review', 'completed', 'ineligible'])
const item = z.strictObject({ tierName: label, quantity, unitAmountMinor: money.positive(), subtotalMinor: money.positive(), currency: z.literal('usd') })
const order = z.strictObject({
  orderNumber, buyerName: name, buyerEmail: email, createdAt: time, paidAt: time.nullable(), status: orderStatusSchema,
  refundWorkflowState: refundState, quantity, items: z.array(item).min(1).max(10), currency: z.literal('usd'),
  subtotalMinor: money, taxMinor: money, totalMinor: money,
}).refine(row => row.subtotalMinor + row.taxMinor === row.totalMinor && Number.isSafeInteger(row.totalMinor)
  && row.items.reduce((sum, entry) => sum + entry.quantity, 0) === row.quantity
  && row.items.reduce((sum, entry) => sum + entry.subtotalMinor, 0) === row.subtotalMinor
  && row.items.every(entry => Number.isSafeInteger(entry.unitAmountMinor * entry.quantity) && entry.unitAmountMinor * entry.quantity === entry.subtotalMinor))
const admission = z.strictObject({
  orderNumber, ticketPosition: quantity, ticketsInOrder: quantity, buyerName: name, buyerEmail: email,
  ticketTier: label, orderStatus: orderStatusSchema, ticketStatus, issuedAt: time, usedAt: time.nullable(),
}).refine(row => row.ticketPosition <= row.ticketsInOrder && (row.ticketStatus === 'used') === (row.usedAt !== null))
const registration = z.strictObject({
  registrationReference: z.string().regex(/^RSVP-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
  registrantName: name, registrantEmail: email, registeredAt: time, registrationStatus: z.enum(['confirmed', 'cancelled']),
  registrationQuantity: quantity, admissionPosition: quantity, admissionLabel: label,
  admissionStatus: z.enum(['valid', 'used', 'cancelled']), issuedAt: time, usedAt: time.nullable(),
}).refine(row => row.admissionPosition <= row.registrationQuantity && (row.admissionStatus === 'used') === (row.usedAt !== null)
  && (row.registrationStatus !== 'cancelled' || row.admissionStatus !== 'valid'))
const base = {
  schemaVersion: z.literal(1),
  event: z.strictObject({ id: z.uuid(), title: z.string().refine(value => Array.from(value.replace(/^ +| +$/gu, '')).length <= 120).nullable(), status: z.enum(['draft', 'published', 'cancelled']), startsAt: time.nullable(), endsAt: time.nullable(), timezone: z.string().max(100) }),
  exportedAt: time, rowCount: z.number().int().min(0).max(EXPORT_MAX_ROWS),
}
export const exportSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('orders'), rows: z.array(order).max(EXPORT_MAX_ROWS) }),
  z.strictObject({ ...base, kind: z.literal('admissions'), rows: z.array(admission).max(EXPORT_MAX_ROWS) }),
  z.strictObject({ ...base, kind: z.literal('registrations'), rows: z.array(registration).max(EXPORT_MAX_ROWS) }),
]).superRefine((data, context) => {
  if (data.rowCount !== data.rows.length) context.addIssue({ code: 'custom', message: 'Incomplete export' })
  const seen = new Set<string>()
  const groups = new Map<string, { positions: Set<number>; total: number }>()
  for (const row of data.rows) {
    const key = 'registrationReference' in row ? row.registrationReference : row.orderNumber
    const position = 'admissionPosition' in row ? row.admissionPosition : 'ticketPosition' in row ? row.ticketPosition : 0
    const identity = JSON.stringify([key, position])
    if (seen.has(identity)) context.addIssue({ code: 'custom', message: 'Duplicate export row' })
    seen.add(identity)
    if (position) {
      const total = 'registrationQuantity' in row ? row.registrationQuantity : 'ticketsInOrder' in row ? row.ticketsInOrder : 0
      const group = groups.get(key) ?? { positions: new Set<number>(), total }
      if (group.total !== total) context.addIssue({ code: 'custom', message: 'Inconsistent group' })
      group.positions.add(position)
      groups.set(key, group)
    }
  }
  for (const group of groups.values()) {
    if (group.positions.size !== group.total) context.addIssue({ code: 'custom', message: 'Incomplete admission group' })
  }
})
export type EventExport = z.infer<typeof exportSchema>
