import { OperationsReadError } from './operations.errors'
import { supabase } from '../../lib/supabase/client'
import {
  type EventMetrics,
  admissionPageSchema,
  type AdmissionCursor,
  manualAdmissionSchema,
  metricsSchema,
  type OrderCursor,
  orderDetailSchema,
  orderDetailV2Schema,
  type OrderFilter,
  ordersPageSchema,
  refundResponseSchema,
} from './operations.schemas'

export async function getEventMetrics(eventId: string): Promise<EventMetrics> {
  const { data, error } = await supabase.rpc('get_organizer_event_metrics', { p_event_id: eventId })
  const parsed = metricsSchema.safeParse(data)
  if (error || !parsed.success || parsed.data.event.id !== eventId) {
    throw new OperationsReadError('Event metrics unavailable', error?.code === '42501')
  }
  return parsed.data
}

export async function listEventOrders(eventId: string, search: string, cursor: OrderCursor | null, status: OrderFilter = 'all') {
  try {
    const { data, error } = await supabase.rpc('list_organizer_event_orders_filtered', {
      p_event_id: eventId,
      p_search: search,
      p_status: status,
      p_limit: 25,
      ...(cursor ? { p_cursor_created_at: cursor.createdAt, p_cursor_id: cursor.id } : {}),
    })
    const parsed = ordersPageSchema.safeParse(data)
    if (error || !parsed.success) throw new OperationsReadError('Orders unavailable', error?.code === '42501')
    return parsed.data
  } catch (error) {
    if (error instanceof OperationsReadError) throw error
    throw new OperationsReadError('Orders unavailable')
  }
}
export async function getOrder(eventId: string, orderId: string) {
  try {
    const { data, error } = await supabase.rpc('get_organizer_order', {
      p_event_id: eventId,
      p_order_id: orderId,
    })
    const parsed = orderDetailSchema.safeParse(data)
    if (error || !parsed.success || parsed.data.id !== orderId) throw new Error()
    return parsed.data
  } catch {
    throw new Error('Order unavailable')
  }
}
export async function getOrderDetails(eventId: string, orderId: string, signal?: AbortSignal) {
  try {
    const request = supabase.rpc('get_organizer_order_v2', { p_event_id: eventId, p_order_id: orderId })
    const { data, error } = await (signal ? request.abortSignal(signal) : request)
    const parsed = orderDetailV2Schema.safeParse(data)
    if (error || !parsed.success || parsed.data.id !== orderId) {
      throw new OperationsReadError('Order unavailable', error?.code === '42501')
    }
    return parsed.data
  } catch (error) {
    if (error instanceof OperationsReadError) throw error
    throw new OperationsReadError('Order unavailable')
  }
}
export async function redeemTicket(eventId: string, ticketId: string, signal?: AbortSignal) {
  try {
    const request = supabase.rpc('redeem_owned_ticket', { p_event_id: eventId, p_ticket_id: ticketId })
    const { data, error } = await (signal ? request.abortSignal(signal) : request)
    const parsed = manualAdmissionSchema.safeParse(data)
    if (error || !parsed.success) throw new Error()
    return parsed.data
  } catch {
    throw new Error('Admission not confirmed')
  }
}
export async function refundOrder(eventId: string, orderId: string) {
  try {
    const { data, error } = await supabase.functions.invoke('organizer-refund-order', {
      body: { eventId, orderId },
    })
    const parsed = refundResponseSchema.safeParse(data)
    if (error || !parsed.success) throw new Error()
    return parsed.data
  } catch {
    throw new Error('Refund not confirmed')
  }
}

export async function listEventAdmissions(eventId: string, search: string, cursor: AdmissionCursor | null, signal?: AbortSignal) {
  try {
    const request = supabase.rpc('list_organizer_event_admissions', {
      p_event_id: eventId, p_search: search, p_limit: 25, ...(cursor ? { p_cursor: cursor } : {}),
    })
    const { data, error } = await (signal ? request.abortSignal(signal) : request)
    const parsed = admissionPageSchema.safeParse(data)
    if (error || !parsed.success) throw new OperationsReadError('Guest search unavailable', error?.code === '42501')
    return parsed.data
  } catch (error) {
    if (error instanceof OperationsReadError) throw error
    throw new OperationsReadError('Guest search unavailable')
  }
}
