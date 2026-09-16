import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import { draftPayload } from '../events/event.api'
import type { EventFormValues } from '../events/event.types'
import { eventRequirementsInputSchema } from '../moderation/moderation.schemas'
import type { EventRequirementsInput } from '../moderation/moderation.types'
import { cancellationSummarySchema, eventChangeContextSchema, noticePreviewSchema, noticeReceiptSchema, noticeStatusSchema, type EventChangeContext, type NoticePurpose } from './eventChanges.schemas'
export class EventChangeError extends Error {
 constructor(readonly kind: 'conflict' | 'unknown' | 'no_audience' | 'unavailable' | 'not_found') { super(kind) }
}
function fail(error: { message?: string } | null) {
 if (error?.message === 'EVENT_NOT_FOUND') throw new EventChangeError('not_found')
 if (error) throw new EventChangeError(error.message?.endsWith('CONTEXT_CONFLICT') ? 'conflict' : error.message === 'NOTICE_NO_AUDIENCE' ? 'no_audience' : 'unknown')
}
export function parseEventContext(data: unknown, eventId: string, ownerId: string): EventChangeContext {
 const parsed = eventChangeContextSchema.safeParse(data)
 if (!parsed.success || parsed.data.event_id !== eventId || parsed.data.event.organizer_id !== ownerId) throw new EventChangeError('unknown')
 return parsed.data
}
function envelope(data: unknown, eventId: string, ownerId: string) {
 const value = z.object({ result: z.unknown(), context: z.unknown() }).safeParse(data)
 if (!value.success) throw new EventChangeError('unknown')
 return parseEventContext(value.data.context, eventId, ownerId)
}
export async function getEventChangeContext(eventId: string, ownerId: string, signal?: AbortSignal) {
 const request = supabase.rpc('get_owned_event_change_context', { p_event_id: eventId })
 const { data, error } = await (signal ? request.abortSignal(signal) : request)
 fail(error); return parseEventContext(data, eventId, ownerId)
}
export async function saveEventIfCurrent(eventId: string, ownerId: string, token: string, values: EventFormValues) {
 const { data, error } = await supabase.rpc('save_owned_event_revision_if_current', { p_event_id: eventId, p_expected_context: token, p_event: draftPayload(values) })
 fail(error); return envelope(data, eventId, ownerId)
}
export async function saveRequirementsIfCurrent(eventId: string, ownerId: string, token: string, input: EventRequirementsInput) {
 const v = eventRequirementsInputSchema.parse(input)
 const { data, error } = await supabase.rpc('save_owned_event_requirements_if_current', { p_event_id: eventId, p_expected_context: token, p_requirements: { minimum_age: v.minimumAge, alcohol_present: v.alcoholPresent, cannabis_present: v.cannabisPresent, explicit_adult_content: v.explicitAdultContent, gambling_present: v.gamblingPresent, weapons_present: v.weaponsPresent, high_risk_activity: v.highRiskActivity } })
 fail(error); return envelope(data, eventId, ownerId)
}
export async function acceptPoliciesIfCurrent(eventId: string, ownerId: string, token: string) {
 const { data, error } = await supabase.rpc('accept_current_event_policies_if_current', { p_event_id: eventId, p_expected_context: token })
 fail(error); return envelope(data, eventId, ownerId)
}
export async function publishIfCurrent(eventId: string, ownerId: string, token: string) {
 const { data, error } = await supabase.rpc('publish_event_if_current', { p_event_id: eventId, p_expected_context: token })
 fail(error); return envelope(data, eventId, ownerId)
}
export async function previewEventNotice(eventId: string, purpose: NoticePurpose) {
 const { data, error } = await supabase.rpc('preview_owned_event_notice', { p_event_id: eventId, p_purpose: purpose })
 fail(error); const value = noticePreviewSchema.parse(data)
 if (value.eventId !== eventId || value.purpose !== purpose) throw new EventChangeError('unavailable')
 return value
}
export async function submitEventNotice(eventId: string, purpose: NoticePurpose, previewToken: string, requestId: string) {
 const { data, error } = await supabase.rpc('submit_owned_event_notice', { p_event_id: eventId, p_purpose: purpose, p_preview_token: previewToken, p_request_id: requestId })
 fail(error); return noticeReceiptSchema.parse(data)
}
export async function getEventNoticeStatus(eventId: string, purpose: NoticePurpose, signal?: AbortSignal) {
 const request = supabase.rpc('get_owned_event_notice_status', { p_event_id: eventId, p_purpose: purpose })
 const { data, error } = await (signal ? request.abortSignal(signal) : request)
 fail(error); const value = noticeStatusSchema.parse(data)
 if (value.eventId !== eventId || value.purpose !== purpose) throw new EventChangeError('unavailable')
 return value
}
export async function getCancellationSummary(eventId: string, signal?: AbortSignal) {
 const request = supabase.rpc('get_owned_event_cancellation_summary', { p_event_id: eventId })
 const { data, error } = await (signal ? request.abortSignal(signal) : request)
 fail(error); const value = cancellationSummarySchema.parse(data)
 if (value.eventId !== eventId) throw new EventChangeError('unavailable')
 return value
}
