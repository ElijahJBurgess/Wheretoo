import { z } from 'zod'
import { requirementsFromRpc, requirementsRpcRowSchema } from '../moderation/moderation.api'
import { eventNoticeFactsSchema } from './eventStatus.schemas'
import type { EventRow } from '../events/event.types'
const count = z.number().int().nonnegative().safe()
const nullableText = z.string().nullable()
const eventSchema = z.object({
 id: z.string().min(1), organizer_id: z.string().min(1), status: z.enum(['draft', 'published', 'cancelled']),
 title: nullableText, description: nullableText, category: nullableText, starts_at: nullableText, ends_at: nullableText,
 timezone: z.string(), venue_name: nullableText, address_line1: nullableText, address_line2: nullableText,
 city: nullableText, region: nullableText, postal_code: nullableText, country_code: z.string(), mapbox_feature_id: nullableText,
 latitude: z.number().nullable(), longitude: z.number().nullable(), admission_type: z.enum(['free', 'paid']), capacity: count.nullable(),
 moderation_status: z.enum(['not_evaluated', 'clear', 'flagged', 'under_review', 'blocked', 'removed']),
 content_revision: count, moderated_revision: count.nullable(), moderation_version: count,
 moderation_updated_at: nullableText, public_history_status: z.enum(['never_public', 'previously_public', 'unknown']),
 first_publicly_eligible_at: nullableText, public_eligibility_version: count,
 publicly_authorized_revision: count.nullable(), publicly_authorized_action_id: nullableText,
 location: z.unknown(), artwork_path: nullableText, animation_preset: z.string(),
 published_at: nullableText, created_at: z.string(), updated_at: z.string(),
}).passthrough().transform(row => row as EventRow)
export const snapshotSchema = z.strictObject({ snapshot_id: z.string().uuid(), snapshot_version: count, content_revision: count, captured_at: z.string(), facts: eventNoticeFactsSchema })
export const eventChangeContextSchema = z.strictObject({
 event_id: z.string().min(1), context_token: z.string().min(1), event: eventSchema,
 requirements: requirementsRpcRowSchema.transform(requirementsFromRpc), currently_publicly_eligible: z.boolean(),
 previous_saved: snapshotSchema.nullable(), current_saved: snapshotSchema,
 previous_publicly_eligible: snapshotSchema.nullable(), current_publicly_eligible: snapshotSchema.nullable(),
 notice_required: z.boolean(), required_snapshot_id: z.string().uuid().nullable(), required_fields: z.array(z.string()),
}).refine(c => c.event_id === c.event.id)
export type EventChangeContext = z.infer<typeof eventChangeContextSchema>
export type EventSnapshot = z.infer<typeof snapshotSchema>
export const noticePurposeSchema = z.enum(['event_change', 'event_cancellation'])
export type NoticePurpose = z.infer<typeof noticePurposeSchema>
export const noticePreviewSchema = z.strictObject({ eventId: z.string().uuid(), purpose: noticePurposeSchema, snapshotId: z.string().uuid().nullable(), previewToken: z.string().regex(/^[a-f0-9]{64}$/), complete: z.boolean(), canSend: z.boolean(), sourceCount: count, eligibleMessages: count.nullable(), alreadySubmitted: count.nullable(), excludedMessages: count.nullable(), distinctRecipients: count.nullable(), invalidRecipients: count.nullable(), blockedRecipients: count.nullable() })
export type NoticePreview = z.infer<typeof noticePreviewSchema>
export const noticeReceiptSchema = z.strictObject({ noticeId: z.string().uuid(), queuedMessages: count })
export const noticeStatusSchema = z.strictObject({ eventId: z.string().uuid(), purpose: noticePurposeSchema, total: count, queued: count, sending: count, accepted: count, failed: count, unknown: count, suppressed: count, observations: z.strictObject({ sent: count, delivered: count, delayed: count, bounced: count, complained: count, failed: count }) })
export const cancellationSummarySchema = z.strictObject({
 eventId: z.string().uuid(), eventStatus: z.enum(['draft', 'published', 'cancelled']), admissionType: z.enum(['paid', 'free']), complete: z.boolean(), asOf: z.string(),
 tickets: z.strictObject({ issued: count, cancelledUnused: count, used: count, refunded: count, other: count }).nullable(),
 paid: z.strictObject({ currency: z.literal('usd'), receivedOrders: count, unpaidAttempts: count, completedOrders: count, notConfirmedRefundedOrders: count, eligibleOrders: count, eligibleAmountMinor: count, processingOrders: count, actionRequiredOrders: count, unknownOrders: count, failedOrders: count, reviewOrders: count }).nullable(),
 free: z.strictObject({ registrations: count, admissions: count, cancelledRegistrations: count }).nullable(),
})
