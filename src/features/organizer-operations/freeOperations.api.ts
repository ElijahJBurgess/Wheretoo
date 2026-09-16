import { supabase } from '../../lib/supabase/client'
import { OperationsReadError } from './operations.errors'
import {
  type FreeAdmissionCursor,
  freeAdmissionsPageSchema,
  freeRegistrationDetailSchema,
  freeRegistrationMetricsSchema,
} from './freeOperations.schemas'

async function response(
  request: PromiseLike<{ data: unknown; error: { code?: string } | null }> & { abortSignal?(signal: AbortSignal): PromiseLike<{ data: unknown; error: { code?: string } | null }> },
  signal?: AbortSignal,
) {
  return signal && request.abortSignal ? request.abortSignal(signal) : request
}

export async function getFreeRegistrationMetrics(eventId: string, signal?: AbortSignal) {
  try {
    const request = supabase.rpc('get_organizer_free_registration_metrics', { p_event_id: eventId })
    const { data, error } = await response(request, signal)
    const parsed = freeRegistrationMetricsSchema.safeParse(data)
    if (error || !parsed.success || parsed.data.eventId !== eventId) {
      throw new OperationsReadError('Registration metrics unavailable', error?.code === '42501')
    }
    return parsed.data
  } catch (error) {
    if (error instanceof OperationsReadError) throw error
    throw new OperationsReadError('Registration metrics unavailable')
  }
}

export async function listFreeAdmissions(
  eventId: string,
  search: string,
  cursor: FreeAdmissionCursor | null,
  signal?: AbortSignal,
) {
  try {
    const request = supabase.rpc('get_organizer_free_admissions', {
      p_event_id: eventId,
      p_search: search,
      p_limit: 25,
      ...(cursor ? { p_cursor: cursor } : {}),
    })
    const { data, error } = await response(request, signal)
    const parsed = freeAdmissionsPageSchema.safeParse(data)
    if (error || !parsed.success) {
      throw new OperationsReadError('Guest search unavailable', error?.code === '42501')
    }
    return parsed.data
  } catch (error) {
    if (error instanceof OperationsReadError) throw error
    throw new OperationsReadError('Guest search unavailable')
  }
}

export async function getFreeRegistration(
  eventId: string,
  registrationId: string,
  signal?: AbortSignal,
) {
  try {
    const request = supabase.rpc('get_organizer_free_registration_detail', {
      p_event_id: eventId,
      p_registration_id: registrationId,
    })
    const { data, error } = await response(request, signal)
    const parsed = freeRegistrationDetailSchema.safeParse(data)
    if (error || !parsed.success || parsed.data.eventId !== eventId || parsed.data.registrationId !== registrationId) {
      throw new OperationsReadError('Registration unavailable', error?.code === '42501')
    }
    return parsed.data
  } catch (error) {
    if (error instanceof OperationsReadError) throw error
    throw new OperationsReadError('Registration unavailable')
  }
}
