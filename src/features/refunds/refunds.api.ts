import { supabase } from '../../lib/supabase/client'
import { refundNoticeSchema, refundOutcomeSchema, refundStatusSchema } from './refunds.schemas'
export class RefundAccessError extends Error {
 constructor(readonly accessDenied = false) { super('Refund status unavailable') }
}
export function isRefundAccessDenied(error: unknown) { return error instanceof RefundAccessError && error.accessDenied }
export async function getRefundStatus(eventId: string, orderId: string, signal?: AbortSignal) {
 try {
  const request = supabase.rpc('get_organizer_refund_status', { p_event_id: eventId, p_order_id: orderId })
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  const parsed = refundStatusSchema.safeParse(data)
  if (error || !parsed.success || parsed.data.eventId !== eventId || parsed.data.orderId !== orderId) throw new RefundAccessError(error?.code === '42501' || error?.code === 'PGRST301')
  return parsed.data
 } catch (error) { throw error instanceof RefundAccessError ? error : new RefundAccessError() }
}
export async function requestRefund(eventId: string, orderId: string, action: 'submit' | 'reconcile') {
 try {
  const { data, error } = await supabase.functions.invoke('organizer-refund-order', { body: { eventId, orderId, action } })
  let body: unknown = data
  if (error && 'context' in error && error.context instanceof Response) {
   if ([401, 403].includes(error.context.status)) throw new RefundAccessError(true)
   if (error.context.status === 409) body = await error.context.clone().json()
   else throw new RefundAccessError()
  } else if (error) throw new RefundAccessError()
  const parsed = refundOutcomeSchema.safeParse(body)
  if (!parsed.success) throw new RefundAccessError()
  if (parsed.data.outcome === 'unauthorized') throw new RefundAccessError(true)
  return parsed.data
 } catch (error) { throw error instanceof RefundAccessError ? error : new RefundAccessError() }
}
export async function getRefundNotice(eventId: string, orderId: string, signal?: AbortSignal) {
 try {
  const request = supabase.rpc('get_organizer_refund_notice_status', { p_event_id: eventId, p_order_id: orderId })
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  const parsed = refundNoticeSchema.safeParse(data)
  if (error || !parsed.success) throw new RefundAccessError(error?.code === '42501')
  return parsed.data
 } catch (error) { throw error instanceof RefundAccessError ? error : new RefundAccessError() }
}
