import { supabase } from '../../lib/supabase/client'
import { EXPORT_MAX_BYTES, exportSchema, type ExportKind } from './export.schemas'
import { ExportError } from './export.csv'

export async function getEventExport(eventId: string, kind: ExportKind, signal: AbortSignal) {
  try {
    const { data, error } = await supabase.rpc('get_organizer_event_export', { p_event_id: eventId, p_kind: kind }).abortSignal(signal)
    if (error) throw new ExportError(error.code === 'PT413' ? 'limit' : error.code === '42501' ? 'denied' : 'unavailable')
    if (signal.aborted) throw new ExportError('unavailable')
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > EXPORT_MAX_BYTES) throw new ExportError('limit')
    const parsed = exportSchema.safeParse(data)
    if (!parsed.success || parsed.data.event.id !== eventId || parsed.data.kind !== kind) throw new ExportError('unavailable')
    return parsed.data
  } catch (error) {
    // Never propagate provider messages, customer data or validation input.
    throw error instanceof ExportError ? error : new ExportError('unavailable')
  }
}
