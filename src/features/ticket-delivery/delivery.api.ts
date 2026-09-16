import { supabase } from '../../lib/supabase/client'
import { OperationsReadError } from '../organizer-operations/operations.errors'
import { attemptSchema, deliverySchema, registrationPageSchema, registrationSchema, resendSchema, type DeliverySource, type RegistrationCursor } from './delivery.schemas'
function args(source: DeliverySource) { return { p_event_id: source.eventId, p_source_kind: source.sourceKind, p_source_id: source.sourceId } }
export async function getDelivery(source: DeliverySource, signal?: AbortSignal) {
  const request = supabase.rpc('get_ticket_email_delivery', args(source))
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  const parsed = deliverySchema.safeParse(data)
  if (error || !parsed.success || parsed.data.sourceId !== source.sourceId || parsed.data.eventId !== source.eventId || parsed.data.sourceKind !== source.sourceKind) throw new OperationsReadError('Ticket email unavailable', error?.code === '42501')
  return parsed.data
}
export async function requestResend(source: DeliverySource, requestId: string) {
  const { data, error } = await supabase.rpc('request_ticket_email_resend', { ...args(source), p_request_id: requestId })
  const parsed = resendSchema.safeParse(data)
  if (error || !parsed.success) throw new OperationsReadError('Resend not confirmed', error?.code === '42501')
  return parsed.data
}
export async function getResendStatus(source: DeliverySource, requestId: string, signal?: AbortSignal) {
  const request = supabase.rpc('get_ticket_email_resend_status', { ...args(source), p_request_id: requestId })
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  const parsed = attemptSchema.nullable().safeParse(data)
  if (error || !parsed.success) throw new OperationsReadError('Resend status unavailable', error?.code === '42501')
  return parsed.data
}
export async function getRegistration(eventId: string, registrationId: string, signal?: AbortSignal) {
  const request = supabase.rpc('get_organizer_free_registration_detail', { p_event_id: eventId, p_registration_id: registrationId })
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  const parsed = registrationSchema.safeParse(data)
  if (error || !parsed.success || parsed.data.eventId !== eventId || parsed.data.registrationId !== registrationId) throw new OperationsReadError('Registration unavailable', error?.code === '42501')
  return parsed.data
}
export async function findRegistrations(eventId: string, search: string, cursor: RegistrationCursor | null, signal?: AbortSignal) {
  const request = supabase.rpc('get_organizer_free_admissions', { p_event_id: eventId, p_search: search, p_limit: 25, ...(cursor ? { p_cursor: cursor } : {}) })
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  const parsed = registrationPageSchema.safeParse(data)
  if (error || !parsed.success) throw new OperationsReadError('Registrations unavailable', error?.code === '42501')
  return parsed.data
}
