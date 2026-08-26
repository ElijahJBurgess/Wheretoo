import type { Database } from '../../lib/supabase/database.types'

type EventRow = Database['public']['Tables']['events']['Row']
type OrderRow = Database['public']['Tables']['orders']['Row']
type OrderItemRow = Database['public']['Tables']['order_items']['Row']
type TicketRow = Database['public']['Tables']['tickets']['Row']

type ConfirmationEvent = Pick<
  EventRow,
  | 'id'
  | 'title'
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
>

type ConfirmationTier = Pick<OrderItemRow, 'tier_name' | 'tier_description' | 'quantity'>
type ConfirmationOrder = Pick<OrderRow, 'id' | 'order_number'>

type ConfirmationBase = ConfirmationOrder & {
  event: ConfirmationEvent
  tier: ConfirmationTier
}

export type OrderConfirmation =
  | (ConfirmationBase & { status: 'processing' })
  | (ConfirmationBase & {
      status: 'confirmed'
      ticket: Pick<TicketRow, 'id' | 'status' | 'issued_at'>
    })
  | (ConfirmationBase & { status: 'failed'; failureCode: string | null })
  | (ConfirmationBase & { status: 'expired' })
  | (ConfirmationBase & { status: 'refunded'; ticket: Pick<TicketRow, 'id' | 'status' | 'refunded_at'> })
