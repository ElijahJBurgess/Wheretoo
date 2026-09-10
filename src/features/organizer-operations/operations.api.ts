import { supabase } from '../../lib/supabase/client'
import { metricsSchema, ordersPageSchema, type OrderCursor, type EventMetrics } from './operations.schemas'

export async function getEventMetrics(eventId: string): Promise<EventMetrics> {
  const { data, error } = await supabase.rpc('get_organizer_event_metrics', { p_event_id: eventId })
  const parsed = metricsSchema.safeParse(data)
  if (error || !parsed.success || parsed.data.event.id !== eventId) throw new Error('Event metrics unavailable')
  return parsed.data
}

export async function listEventOrders(eventId: string, search: string, cursor: OrderCursor | null) {
 try {
  const { data, error } = await supabase.rpc('list_organizer_event_orders', {
   p_event_id: eventId, p_search: search, p_limit: 25,
   ...(cursor ? { p_cursor_created_at: cursor.createdAt, p_cursor_id: cursor.id } : {}),
  })
  const parsed = ordersPageSchema.safeParse(data)
  if (error || !parsed.success) throw new Error()
  return parsed.data
 } catch { throw new Error('Orders unavailable') }
}
