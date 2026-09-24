import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import { publicEnv } from '../../lib/env'

export const duplicateMessages = {
  EVENT_NOT_FOUND: 'This event is no longer available to duplicate.',
  SIGN_IN_REQUIRED: 'Sign in again before duplicating this event.',
  DUPLICATE_MODERATION_BLOCKED: 'Blocked or removed events cannot be duplicated.',
  DUPLICATE_SOURCE_CHANGED: 'This event changed while it was being copied. Refresh My Events, review it, and try again.',
  DUPLICATE_SOURCE_UNSUPPORTED: 'This event has an unsupported timezone or legacy flyer. Update the source event before duplicating it.',
  DUPLICATE_FLYER_UNAVAILABLE: 'The selected flyer could not be copied. No draft was created. Check the source flyer and try again.',
  DUPLICATE_STAGE_INVALID: 'The flyer copy could not be completed. Refresh My Events and try again.',
  DUPLICATE_FAILED: 'The draft could not be created. Please try again.',
  DUPLICATE_UNAVAILABLE: 'Duplication is temporarily unavailable. Please try again.',
  DUPLICATE_TARGET_EXISTS: 'The copy could not be completed. Check My Events before trying again.',
  DUPLICATE_OUTCOME_UNKNOWN: 'The result could not be confirmed. Check My Events for a new draft before duplicating again.',
} as const
export type DuplicateErrorCode = keyof typeof duplicateMessages
export class DuplicateEventError extends Error {
  constructor(readonly code: DuplicateErrorCode) { super(duplicateMessages[code]) }
}
const success = z.strictObject({ eventId: z.string().uuid() })
export async function duplicateEvent(sourceEventId: string, isCurrent: () => boolean): Promise<{ eventId: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !isCurrent()) throw new DuplicateEventError('SIGN_IN_REQUIRED')
  let response: Response
  let data: unknown
  try {
    response = await fetch(`${publicEnv.supabaseUrl}/functions/v1/duplicate-event`, {
      method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, apikey: publicEnv.supabasePublishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ sourceEventId }),
    })
    data = await response.json()
  } catch { throw new DuplicateEventError('DUPLICATE_OUTCOME_UNKNOWN') }
  if (!response.ok) {
    const parsed = z.strictObject({ error: z.string() }).safeParse(data)
    if (parsed.success && Object.hasOwn(duplicateMessages, parsed.data.error)) throw new DuplicateEventError(parsed.data.error as DuplicateErrorCode)
    throw new DuplicateEventError('DUPLICATE_OUTCOME_UNKNOWN')
  }
  const result = success.safeParse(data)
  if (!result.success || result.data.eventId === sourceEventId) throw new DuplicateEventError('DUPLICATE_OUTCOME_UNKNOWN')
  return result.data
}
