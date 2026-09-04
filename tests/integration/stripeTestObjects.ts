import { randomBytes, randomUUID } from 'node:crypto'

export const TASK17_PERCENT_BPS = 500
export const TASK17_FIXED_MINOR = 50

export const TASK17_CART = [
  {
    label: 'ga',
    name: 'Task 17 General Admission',
    unitAmountMinor: 1_500,
    quantity: 2,
    subtotalMinor: 3_000,
  },
  {
    label: 'vip',
    name: 'Task 17 VIP',
    unitAmountMinor: 2_500,
    quantity: 1,
    subtotalMinor: 2_500,
  },
] as const

export const TASK17_ADMISSION_QUANTITY = 3
export const TASK17_SUBTOTAL_MINOR = 5_500

export function applicationFeeMinor(subtotalMinor: number, quantity: number): number {
  return Math.floor((subtotalMinor * TASK17_PERCENT_BPS) / 10_000) + TASK17_FIXED_MINOR * quantity
}

export const TASK17_APPLICATION_FEE_MINOR = applicationFeeMinor(
  TASK17_SUBTOTAL_MINOR,
  TASK17_ADMISSION_QUANTITY,
)
export const TASK17_ORGANIZER_PROCEEDS_MINOR = TASK17_SUBTOTAL_MINOR - TASK17_APPLICATION_FEE_MINOR

export function createStripeProofCheckoutAttempt(): {
  clientRequestId: string
  confirmationBearer: string
} {
  return {
    clientRequestId: randomUUID(),
    confirmationBearer: randomBytes(32).toString('base64url'),
  }
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
  items: Array<{
    id: string
    order_id: string
    ticket_tier_id: string
    tier_name: string
    unit_amount_minor: number
    quantity: number
    subtotal_minor: number
    currency: string
  }>
  tickets: Array<{
    id: string
    order_id: string
    order_item_id: string
    ticket_tier_id: string
    unit_sequence: number
    status: string
    refunded_at: string | null
  }>
  refunds: Array<{
    order_id: string
    status: string
    amount_minor: number
    reverse_transfer: boolean
    refund_application_fee: boolean
    transfer_reversal_amount_minor: number
    application_fee_refund_amount_minor: number
    policy_verified: boolean
    policy_failure_code: string | null
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
  destination_charge: boolean
  line_bindings_valid: boolean
  line_count: number
  admission_count: number
}

export type EventProof = {
  ok: boolean
  livemode: boolean
  matching_types: string[]
  has_more: boolean
}
