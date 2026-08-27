import { createClient } from '@supabase/supabase-js'
import { publicEnv } from '../../lib/env'
import type { Database } from '../../lib/supabase/database.types'
import { PublicTicketingError } from './publicTicketing.errors'
import { lowercaseRfcUuidSchema, publicTicketingEventSchema } from './ticket.schemas'
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

export async function getPublicEventTicketing(eventId: string): Promise<CanonicalPublicTicketingEvent | null> {
  const parsedEventId = lowercaseRfcUuidSchema.safeParse(eventId)
  if (!parsedEventId.success) return null

  const { data, error } = await anonymousTicketingClient.rpc('get_public_event_ticketing', {
    p_event_id: parsedEventId.data,
  })

  if (error) throw new PublicTicketingError('RETRYABLE')
  if (data === null || data.length === 0) return null

  if (data.length !== 1) throw new PublicTicketingError('INVALID_RESPONSE')

  const parsedProjection = publicTicketingEventSchema.safeParse(data[0])
  if (!parsedProjection.success) throw new PublicTicketingError('INVALID_RESPONSE')

  return parsedProjection.data
}
