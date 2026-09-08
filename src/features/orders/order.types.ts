export type ConfirmationStatus =
  | 'processing'
  | 'paid'
  | 'payment_failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'requires_review'

export type OrderConfirmation = {
  orderNumber: string
  status: ConfirmationStatus
  event: {
    title: string
    startsAt: string
    endsAt: string
    timezone: string
    venueName: string | null
  }
  items: Array<{
    tierName: string
    quantity: number
    unitAmountMinor: number
    subtotalMinor: number
    currency: 'usd'
  }>
  quantity: number
  currency: 'usd'
  subtotalMinor: number
  taxAmountMinor: 0
  totalMinor: number
}
