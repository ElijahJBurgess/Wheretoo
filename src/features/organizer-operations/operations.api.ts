import { supabase } from '../../lib/supabase/client'
import {
  type EventMetrics,
  manualAdmissionSchema,
  metricsSchema,
  type OrderCursor,
  orderDetailSchema,
  ordersPageSchema,
  refundResponseSchema,
} from './operations.schemas'

export async function getEventMetrics(eventId: string): Promise<EventMetrics> {
  const { data, error } = await supabase.rpc('get_organizer_event_metrics', { p_event_id: eventId })
  const parsed = metricsSchema.safeParse(data)
  if (error || !parsed.success || parsed.data.event.id !== eventId) {
    throw new Error('Event metrics unavailable')
  }
  return parsed.data
}

export async function listEventOrders(eventId: string, search: string, cursor: OrderCursor | null) {
  try {
    const { data, error } = await supabase.rpc('list_organizer_event_orders', {
      p_event_id: eventId,
      p_search: search,
      p_limit: 25,
      ...(cursor ? { p_cursor_created_at: cursor.createdAt, p_cursor_id: cursor.id } : {}),
    })
    const parsed = ordersPageSchema.safeParse(data)
    if (error || !parsed.success) throw new Error()
    return parsed.data
  } catch {
    throw new Error('Orders unavailable')
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
export async function redeemTicket(eventId: string, ticketId: string) {
  try {
    const { data, error } = await supabase.rpc('redeem_owned_ticket', {
      p_event_id: eventId,
      p_ticket_id: ticketId,
    })
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
