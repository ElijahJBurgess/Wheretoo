import { createClient } from '@supabase/supabase-js'
import { publicEnv } from '../../lib/env'
import { withReadTimeout } from '../../lib/readTimeout'
import type { Database } from '../../lib/supabase/database.types'
import { PublicTicketingError } from './publicTicketing.errors'
import {
  lowercaseRfcUuidSchema,
  publicFreeEventSchema,
  publicPaidTicketingEventSchema,
} from './ticket.schemas'
import type { CanonicalPublicTicketingEvent } from './ticket.types'

const anonymousTicketingClient = createClient<Database>(
  publicEnv.supabaseUrl,
  publicEnv.supabasePublishableKey,
  {
    auth: {
      storageKey: 'whereto-public-ticketing-anon',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
)

const retryableRpcStatuses = new Set([0, 408, 425, 429, 502, 503, 504])

function throwPublicProjectionError(status: number): never {
  throw new PublicTicketingError(retryableRpcStatuses.has(status) ? 'RETRYABLE' : 'INVALID_RESPONSE')
}

export async function getPublicEventTicketing(eventId: string): Promise<CanonicalPublicTicketingEvent | null> {
  const parsedEventId = lowercaseRfcUuidSchema.safeParse(eventId)
  if (!parsedEventId.success) return null

  try {
    return await withReadTimeout(async (signal) => {
      const { data, error, status } = await anonymousTicketingClient.rpc('get_public_event_ticketing', {
        p_event_id: parsedEventId.data,
      }).abortSignal(signal)

      if (error) throwPublicProjectionError(status)

      if (data !== null && data.length > 0) {
        if (data.length !== 1) throw new PublicTicketingError('INVALID_RESPONSE')
        const parsedProjection = publicPaidTicketingEventSchema.safeParse(data[0])
        if (!parsedProjection.success) throw new PublicTicketingError('INVALID_RESPONSE')
        return parsedProjection.data
      }

      const fallback = await anonymousTicketingClient.rpc('get_public_event', {
        p_event_id: parsedEventId.data,
      }).abortSignal(signal)
      if (fallback.error) throwPublicProjectionError(fallback.status)
      if (fallback.data === null || fallback.data.length === 0) return null
      if (fallback.data.length !== 1) throw new PublicTicketingError('INVALID_RESPONSE')

      const parsedEvent = publicFreeEventSchema.safeParse(fallback.data[0])
      if (!parsedEvent.success) throw new PublicTicketingError('INVALID_RESPONSE')
      return { event: parsedEvent.data, tiers: [] }
    })
  } catch (error) {
    throw error instanceof PublicTicketingError ? error : new PublicTicketingError('RETRYABLE')
  }
}
