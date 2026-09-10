import { supabase } from '../../lib/supabase/client'
import { metricsSchema, type EventMetrics } from './operations.schemas'

export async function getEventMetrics(eventId: string): Promise<EventMetrics> {
  const { data, error } = await supabase.rpc('get_organizer_event_metrics', { p_event_id: eventId })
  const parsed = metricsSchema.safeParse(data)
  if (error || !parsed.success || parsed.data.event.id !== eventId) throw new Error('Event metrics unavailable')
  return parsed.data
}
