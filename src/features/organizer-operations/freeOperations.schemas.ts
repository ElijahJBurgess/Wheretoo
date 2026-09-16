import { z } from 'zod'
import type { EventRow } from '../events/event.types'

const count = z.number().int().nonnegative().safe()
const timestamp = z.iso.datetime({ offset: true })
const uuid = z.uuid()

export const freeRegistrationMetricsSchema = z.strictObject({
  eventId: uuid,
  registrationCount: count,
  confirmedRegistrations: count,
  reservedAdmissions: count,
  issued: count,
  checkedIn: count,
  capacity: count.nullable(),
  remaining: count.nullable(),
}).superRefine((value, context) => {
  if (value.confirmedRegistrations > value.registrationCount) {
    context.addIssue({ code: 'custom', message: 'Confirmed registrations exceed registrations' })
  }
  if (value.checkedIn > value.issued || value.reservedAdmissions > value.issued) {
    context.addIssue({ code: 'custom', message: 'Admission totals are inconsistent' })
  }
  if ((value.capacity === null) !== (value.remaining === null)) {
    context.addIssue({ code: 'custom', message: 'Unlimited capacity must keep remaining unavailable' })
  }
  if (value.capacity !== null && value.remaining !== value.capacity - value.reservedAdmissions) {
    context.addIssue({ code: 'custom', message: 'Remaining capacity is inconsistent' })
  }
})

export type FreeRegistrationMetrics = z.infer<typeof freeRegistrationMetricsSchema>

export const freeAdmissionCursorSchema = z.strictObject({
  createdAt: timestamp,
  ticketId: uuid,
})

const freeAdmissionStatusSchema = z.enum(['valid', 'used', 'cancelled'])

export const freeAdmissionRowSchema = z.strictObject({
  sourceKind: z.literal('free_registration'),
  registrationId: uuid,
  registrantName: z.string().min(1).max(200),
  registrantEmail: z.string().max(320),
  registrationStatus: z.enum(['confirmed', 'cancelled']),
  createdAt: timestamp,
  ticketId: uuid,
  ticketPosition: z.number().int().min(1).max(10),
  ticketTotal: z.number().int().min(1).max(10),
  admissionLabel: z.string().min(1).max(80),
  status: freeAdmissionStatusSchema,
  usedAt: timestamp.nullable(),
  admissionEligible: z.boolean(),
}).superRefine((value, context) => {
  if (value.ticketPosition > value.ticketTotal || (value.status === 'used') !== (value.usedAt !== null)) {
    context.addIssue({ code: 'custom', message: 'Free admission ticket is inconsistent' })
  }
  if (value.admissionEligible && (value.status !== 'valid' || value.registrationStatus !== 'confirmed')) {
    context.addIssue({ code: 'custom', message: 'Ineligible ticket marked eligible' })
  }
})

export const freeAdmissionsPageSchema = z.strictObject({
  admissions: z.array(freeAdmissionRowSchema).max(25),
  nextCursor: freeAdmissionCursorSchema.nullable(),
})

export const freeRegistrationDetailSchema = z.strictObject({
  registrationId: uuid,
  eventId: uuid,
  eventName: z.string().min(1).max(120),
  registrantName: z.string().min(1).max(200),
  registrantEmail: z.string().max(320),
  status: z.enum(['confirmed', 'cancelled']),
  quantity: z.number().int().min(1).max(10),
  createdAt: timestamp,
  tickets: z.array(z.strictObject({
    ticketId: uuid,
    position: z.number().int().min(1).max(10),
    admissionLabel: z.string().min(1).max(80),
    status: freeAdmissionStatusSchema,
    usedAt: timestamp.nullable(),
  })).min(1).max(10),
}).superRefine((value, context) => {
  if (value.tickets.length !== value.quantity || new Set(value.tickets.map(ticket => ticket.ticketId)).size !== value.quantity) {
    context.addIssue({ code: 'custom', message: 'Free registration ticket set is inconsistent' })
  }
  value.tickets.forEach((ticket, index) => {
    if (ticket.position !== index + 1 || (ticket.status === 'used') !== (ticket.usedAt !== null)) {
      context.addIssue({ code: 'custom', message: 'Free registration ticket is inconsistent' })
    }
  })
})

export type FreeAdmissionCursor = z.infer<typeof freeAdmissionCursorSchema>
export type FreeAdmissionRow = z.infer<typeof freeAdmissionRowSchema>
export type FreeAdmissionsPage = z.infer<typeof freeAdmissionsPageSchema>
export type FreeRegistrationDetail = z.infer<typeof freeRegistrationDetailSchema>

export type AdmissionSourceKind = 'paid_order' | 'free_registration'
export type AdmissionSelection = {
  sourceKind: AdmissionSourceKind
  sourceId: string
  eventId: string
  ticketId: string
}

export function isFreeEventAdmissionOpen(event: Pick<EventRow, 'admission_type' | 'status' | 'starts_at' | 'ends_at'>, now = Date.now()) {
  const startsAt = event.starts_at ? Date.parse(event.starts_at) : Number.NaN
  const endsAt = event.ends_at ? Date.parse(event.ends_at) : Number.NaN
  return event.admission_type === 'free' && event.status === 'published' && Number.isFinite(startsAt) &&
    Number.isFinite(endsAt) && endsAt > startsAt && endsAt > now
}
