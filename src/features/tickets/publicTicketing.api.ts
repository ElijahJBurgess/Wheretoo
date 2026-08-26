import { createClient } from '@supabase/supabase-js'
import { publicEnv } from '../../lib/env'
import type { Database } from '../../lib/supabase/database.types'
import { lowercaseRfcUuidSchema, publicTicketingEventSchema } from './ticket.schemas'
import type { PublicTicketingEvent } from './ticket.types'

const anonymousTicketingClient = createClient<Database>(
  publicEnv.supabaseUrl,
  publicEnv.supabasePublishableKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
)

export async function getPublicEventTicketing(eventId: string): Promise<PublicTicketingEvent | null> {
  const parsedEventId = lowercaseRfcUuidSchema.safeParse(eventId)
  if (!parsedEventId.success) return null

  const { data, error } = await anonymousTicketingClient.rpc('get_public_event_ticketing', {
    p_event_id: parsedEventId.data,
  })

  if (error) throw new Error('Public event details are unavailable')
  if (data === null || data.length === 0) return null

  if (data.length !== 1) throw new Error('Public event details are unavailable')

  const parsedProjection = publicTicketingEventSchema.safeParse(data[0])
  if (!parsedProjection.success) throw new Error('Public event details are unavailable')

  return parsedProjection.data
}
