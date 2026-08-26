import type { z } from 'zod'
import type { Database } from '../../lib/supabase/database.types'
import type { ticketTiersInputSchema } from './ticket.schemas'

type EventRow = Database['public']['Tables']['events']['Row']
export type TicketTierRow = Database['public']['Tables']['ticket_tiers']['Row']

export type TicketTierInput = z.output<typeof ticketTiersInputSchema>[number]
export type TicketTiersInput = z.output<typeof ticketTiersInputSchema>

export type PublicTicketTier = Pick<
  TicketTierRow,
  'id' | 'name' | 'description' | 'unit_amount_minor' | 'currency'
> & {
  availability_status: 'available' | 'sold_out'
}

export type PublicTicketingEvent = {
  event: Pick<
    EventRow,
    | 'id'
    | 'title'
    | 'description'
    | 'category'
    | 'starts_at'
    | 'ends_at'
    | 'timezone'
    | 'venue_name'
    | 'address_line1'
    | 'address_line2'
    | 'city'
    | 'region'
    | 'postal_code'
    | 'country_code'
    | 'latitude'
    | 'longitude'
    | 'artwork_path'
    | 'animation_preset'
    | 'admission_type'
  > & {
    organizer: Pick<Database['public']['Tables']['organizers']['Row'], 'id' | 'display_name'>
  }
  tiers: PublicTicketTier[]
}
