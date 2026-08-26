export const TASK17_SUBTOTAL_MINOR = 3_001
export const TASK17_PERCENT_BPS = 500
export const TASK17_FIXED_MINOR = 50

export function applicationFeeMinor(subtotalMinor: number): number {
  return Math.floor((subtotalMinor * TASK17_PERCENT_BPS) / 10_000) + TASK17_FIXED_MINOR
}

export type ConnectProof = {
  ok: boolean
  livemode: boolean
  applied_recipient: boolean
  dashboard: string
  fees_collector: string
  losses_collector: string
  transfers_status: string
  payouts_status: string
  requirements_status: string
  currently_due_count: number
  past_due_count: number
  persistence: string
}

export type OrderProof = {
  id: string
  status: string
  subtotal_minor: number
  total_minor: number
  application_fee_amount_minor: number
  expected_organizer_proceeds_minor: number
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_transfer_id: string | null
  stripe_application_fee_id: string | null
  stripe_balance_transaction_id: string | null
  reconciliation_status: string
  failure_code: string | null
}

export type FixtureProof = {
  ok: boolean
  orders: OrderProof[]
  items: Array<{ id: string; order_id: string }>
  tickets: Array<{ id: string; order_id: string; status: string; refunded_at: string | null }>
  refunds: Array<{
    order_id: string
    status: string
    amount_minor: number
    reverse_transfer: boolean
    refund_application_fee: boolean
    stripe_transfer_reversal_id: string | null
    stripe_application_fee_refund_id: string | null
  }>
  receipts: Array<{
    event_type: string
    processing_status: string
    delivery_attempt_count: number
    error_code: string | null
  }>
}

export type ReconciliationProof = {
  ok: boolean
  livemode: boolean
  order_status: string
  total_minor: number
  intent_amount: number
  charge_amount: number
  application_fee_expected: number
  application_fee_intent: number
  application_fee_actual: number
  organizer_proceeds_expected: number
  transfer_amount: number
  transfer_less_application_fee: number
  balance_transaction_amount: number
  balance_transaction_fee: number
}

export type EventProof = {
  ok: boolean
  livemode: boolean
  matching_types: string[]
  has_more: boolean
}
