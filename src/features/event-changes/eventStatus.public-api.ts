import { publicEnv } from '../../lib/env'
import { grantTokenSchema } from '../ticket-delivery/delivery.schemas'
import { eventStatusAccessSchema } from './eventStatus.schemas'
export class EventStatusError extends Error {
 constructor(readonly kind: 'unavailable' | 'temporary' | 'rate_limited') { super('Event status unavailable') }
}
export function createEventStatusApi(transport: { supabaseUrl: string; supabasePublishableKey: string; fetch: typeof globalThis.fetch } = { ...publicEnv, fetch: (...args) => globalThis.fetch(...args) }) {
 return async (token: string, signal?: AbortSignal) => {
  if (!grantTokenSchema.safeParse(token).success) throw new EventStatusError('unavailable')
  try {
   const response = await transport.fetch(transport.supabaseUrl + '/functions/v1/event-status-access', { method: 'POST', headers: { apikey: transport.supabasePublishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ token }), signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
   if (!response.ok) throw new EventStatusError(response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'temporary' : 'unavailable')
   const result = eventStatusAccessSchema.safeParse(await response.json())
   if (!result.success || Date.parse(result.data.expiresAt) <= Date.now()) throw new EventStatusError('unavailable')
   return result.data
  } catch (error) { signal?.throwIfAborted(); throw error instanceof EventStatusError ? error : new EventStatusError('temporary') }
 }
}
export const getEventStatus = createEventStatusApi()
