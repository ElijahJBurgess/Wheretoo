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

type RelaxedPublicTicketingEvent<T> = T extends CanonicalPublicTicketingEvent
  ? Omit<T, 'event'> & {
      event: Omit<T['event'], 'minimum_age' | 'advisories'>
        & Partial<Pick<T['event'], 'minimum_age' | 'advisories'>>
    }
  : never

export type PublicTicketingEvent = RelaxedPublicTicketingEvent<CanonicalPublicTicketingEvent>
