import type { Database } from '../../lib/supabase/database.types'

type OrderRow = Database['public']['Tables']['orders']['Row']
type EventRow = Database['public']['Tables']['events']['Row']
type OrderItemRow = Database['public']['Tables']['order_items']['Row']

type ConfirmationEvent = {
  title: NonNullable<EventRow['title']>
  startsAt: NonNullable<EventRow['starts_at']>
  endsAt: NonNullable<EventRow['ends_at']>
  timezone: EventRow['timezone']
  venueName: EventRow['venue_name']
}

type ConfirmationTier = { name: OrderItemRow['tier_name'] }
type ConfirmationBase = {
  orderNumber: OrderRow['order_number']
  event: ConfirmationEvent
  tier: ConfirmationTier
}

export type OrderConfirmation =
  | (ConfirmationBase & { status: 'processing' })
  | (ConfirmationBase & { status: 'paid' })
  | (ConfirmationBase & { status: 'failed' })
  | (ConfirmationBase & { status: 'expired' })
  | (ConfirmationBase & { status: 'refunded' })
