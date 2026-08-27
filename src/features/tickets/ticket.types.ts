import type { z } from 'zod'
import type { Database } from '../../lib/supabase/database.types'
import type {
  publicTicketingEventSchema,
  PublicTicketTier,
  PublicTicketTierTuple,
  ticketTiersInputSchema,
} from './ticket.schemas'

export type TicketTierRow = Database['public']['Tables']['ticket_tiers']['Row']

export type TicketTierInput = z.output<typeof ticketTiersInputSchema>[number]
export type TicketTiersInput = z.output<typeof ticketTiersInputSchema>
export type { PublicTicketTier, PublicTicketTierTuple }
export type CanonicalPublicTicketingEvent = z.output<typeof publicTicketingEventSchema>

type CanonicalPublicEvent = CanonicalPublicTicketingEvent['event']
export type PublicTicketingEvent = Omit<CanonicalPublicTicketingEvent, 'event'> & {
  event: Omit<CanonicalPublicEvent, 'minimum_age' | 'advisories'>
    & Partial<Pick<CanonicalPublicEvent, 'minimum_age' | 'advisories'>>
}
