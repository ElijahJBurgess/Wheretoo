import { z } from 'zod'
export const uuid = z.uuid()
export const timestamp = z.iso.datetime({ offset: true })
// Matches the Spec 06 canonical ASCII recipient contract; dots and plus aliases are identity.
export const emailSchema = z.string().trim().toLowerCase().max(320).regex(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/)
export const sourceKindSchema = z.enum(['paid_order', 'free_registration'])
export type SourceKind = z.infer<typeof sourceKindSchema>
export type DeliverySource = { sourceKind: SourceKind; sourceId: string; eventId: string }
export type OwnedDeliverySource = DeliverySource & { ownerId: string }
export const grantTokenSchema = z.string().regex(/^em1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
export const collectionBearerSchema = z.string().regex(/^(?:rsvp_)?[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
export const observationSchema = z.enum(['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed']).nullable()
export const deliveryStateSchema = z.enum(['queued', 'sending', 'accepted', 'failed', 'unknown', 'suppressed'])
export const reasonSchema = z.enum(['unavailable', 'financially_unresolved', 'inactive', 'ended', 'no_valid_tickets', 'invalid_recipient', 'recipient_blocked'])
export const attemptSchema = z.strictObject({ id: uuid, state: deliveryStateSchema, observation: observationSchema, createdAt: timestamp, stoppedReason: z.string().max(100).nullable() }).refine(value => value.observation === null || value.state === 'accepted')
export type DeliveryAttempt = z.infer<typeof attemptSchema>
export const deliverySchema = z.strictObject({
  sourceKind: sourceKindSchema, sourceId: uuid, eventId: uuid,
  recipientEmail: z.string().max(320), eligible: z.boolean(), reason: reasonSchema.nullable(), configured: z.boolean(), latest: attemptSchema.nullable(),
}).refine(value => value.eligible === (value.reason === null))
export type TicketDelivery = z.infer<typeof deliverySchema>
export const resendSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('queued'), attemptId: uuid }),
  z.strictObject({ kind: z.literal('not_enabled') }),
  z.strictObject({ kind: z.literal('ineligible'), reason: reasonSchema }),
  z.strictObject({ kind: z.literal('rate_limited') }),
])
export const publicStatusSchema = z.strictObject({ state: z.enum([...deliveryStateSchema.options, 'not_requested']), observation: observationSchema }).refine(value => value.observation === null || value.state === 'accepted')
export type PublicDeliveryStatus = z.infer<typeof publicStatusSchema>
export const accessIndexSchema = z.strictObject({
  kind: z.literal('index'), expiresAt: timestamp, total: z.number().int().min(1).max(200), page: z.number().int().min(0).max(9), nextPage: z.number().int().min(1).max(9).nullable(),
  collections: z.array(z.strictObject({ selector: z.number().int().min(1).max(200), sourceKind: sourceKindSchema, eventName: z.string().min(1).max(120), startsAt: timestamp.nullable(), eventFactsAvailable: z.boolean().optional(), quantity: z.number().int().min(1).max(10), createdAt: timestamp })).min(1).max(20),
}).superRefine((value, ctx) => {
  if (value.collections.some(row => row.eventFactsAvailable === false ? row.startsAt !== null || row.eventName !== 'Event details unavailable' : row.startsAt === null)) ctx.addIssue({code:'custom',message:'Invalid event facts'})
  const offset = value.page * 20
  const expected = Math.min(20, value.total - offset)
  if (value.collections.length !== expected || value.nextPage !== (offset + expected < value.total ? value.page + 1 : null) || value.collections.some((row, i) => row.selector !== offset + i + 1)) ctx.addIssue({ code: 'custom', message: 'Invalid collection page' })
})
export type AccessIndex = z.infer<typeof accessIndexSchema>
const admissionStatus = z.enum(['valid', 'used', 'cancelled'])
const registrationTicket = z.strictObject({ ticketId: uuid, position: z.number().int().min(1).max(10), admissionLabel: z.string().min(1).max(80), status: admissionStatus, usedAt: timestamp.nullable() })
export const registrationSchema = z.strictObject({ registrationId: uuid, eventId: uuid, eventName: z.string().min(1).max(120), registrantName: z.string().min(1).max(200), registrantEmail: z.string().max(320), status: z.enum(['confirmed', 'cancelled']), quantity: z.number().int().min(1).max(10), createdAt: timestamp, tickets: z.array(registrationTicket).min(1).max(10) }).refine(value => value.tickets.length === value.quantity && new Set(value.tickets.map(t => t.ticketId)).size === value.quantity && value.tickets.every((t, i) => t.position === i + 1 && (t.status === 'used') === (t.usedAt !== null)))
export const registrationCursorSchema = z.strictObject({ createdAt: timestamp, ticketId: uuid })
export type RegistrationCursor = z.infer<typeof registrationCursorSchema>
export const registrationPageSchema = z.strictObject({
  admissions: z.array(z.strictObject({ sourceKind: z.literal('free_registration'), registrationId: uuid, registrantName: z.string().min(1).max(200), registrantEmail: z.string().max(320), registrationStatus: z.enum(['confirmed', 'cancelled']), createdAt: timestamp, ticketId: uuid, ticketPosition: z.number().int().min(1).max(10), ticketTotal: z.number().int().min(1).max(10), admissionLabel: z.string().min(1).max(80), status: admissionStatus, usedAt: timestamp.nullable(), admissionEligible: z.boolean() })).max(25), nextCursor: registrationCursorSchema.nullable(),
})
