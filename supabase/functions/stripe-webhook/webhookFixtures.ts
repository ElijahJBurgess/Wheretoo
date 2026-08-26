export const WEBHOOK_SECRET = ["whsec", "task14fixtureboundary"].join("_");
export const THIN_WEBHOOK_SECRET = ["whsec", "task14thinfixtureboundary"].join(
  "_",
);
export const NOW_EPOCH_SECONDS = 1_788_000_000;
export const NOW_ISO = new Date(NOW_EPOCH_SECONDS * 1_000).toISOString();

export const ORDER_ID = "11111111-2222-4333-8444-555555555555";
export const EVENT_ID = "22222222-3333-4444-8555-666666666666";
export const TIER_ID = "33333333-4444-4555-8666-777777777777";
export const ORGANIZER_ID = "44444444-5555-4666-8777-888888888888";
export const SESSION_ID = "cs_test_Task14Checkout";
export const PAYMENT_INTENT_ID = "pi_Task14Payment";
export const CHARGE_ID = "ch_Task14Charge";
export const TRANSFER_ID = "tr_Task14Transfer";
export const APPLICATION_FEE_ID = "fee_Task14ApplicationFee";
export const BALANCE_TRANSACTION_ID = "txn_Task14Balance";
export const CUSTOMER_ID = "cus_Task14Buyer";
export const ACCOUNT_ID = "acct_Task14Recipient";
export const REFUND_ID = "re_Task14Refund";
export const DISPUTE_ID = "du_Task14Dispute";
export const REFUND_REVERSAL_ID = "trr_Task14RefundReversal";
export const DISPUTE_REVERSAL_ID = "trr_Task14DisputeRecovery";
export const FEE_REFUND_ID = "fr_Task14ApplicationFeeRefund";

export function paymentIntentFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PAYMENT_INTENT_ID,
    object: "payment_intent",
    livemode: false,
    amount: 2_000,
    currency: "usd",
    status: "succeeded",
    application_fee_amount: 150,
    transfer_data: { destination: ACCOUNT_ID },
    metadata: { order_id: ORDER_ID, event_id: EVENT_ID, tier_id: TIER_ID },
    latest_charge: chargeFixture(),
    ...overrides,
  };
}

export function chargeFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: CHARGE_ID,
    object: "charge",
    livemode: false,
    paid: true,
    amount: 2_000,
    currency: "usd",
    payment_intent: PAYMENT_INTENT_ID,
    transfer: TRANSFER_ID,
    application_fee: APPLICATION_FEE_ID,
    balance_transaction: BALANCE_TRANSACTION_ID,
    customer: CUSTOMER_ID,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
    metadata: { order_id: ORDER_ID, event_id: EVENT_ID, tier_id: TIER_ID },
    ...overrides,
  };
}

export function checkoutSessionFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    livemode: false,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "usd",
    amount_subtotal: 2_000,
    amount_total: 2_000,
    client_reference_id: ORDER_ID,
    metadata: { order_id: ORDER_ID, event_id: EVENT_ID, tier_id: TIER_ID },
    payment_intent: paymentIntentFixture(),
    line_items: {
      data: [{
        quantity: 1,
        currency: "usd",
        amount_subtotal: 2_000,
        amount_total: 2_000,
        price: { currency: "usd", unit_amount: 2_000, type: "one_time" },
      }],
      has_more: false,
    },
    ...overrides,
  };
}

export function refundFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: REFUND_ID,
    object: "refund",
    amount: 2_000,
    currency: "usd",
    status: "succeeded",
    reason: "requested_by_customer",
    charge: CHARGE_ID,
    payment_intent: PAYMENT_INTENT_ID,
    transfer_reversal: REFUND_REVERSAL_ID,
    source_transfer_reversal: null,
    metadata: {
      order_id: ORDER_ID,
      whereto_refund_policy: "destination_v1",
      whereto_reverse_transfer: "true",
      whereto_refund_application_fee: "true",
      whereto_transfer_reversal_amount: "1850",
      whereto_application_fee_refund_id: FEE_REFUND_ID,
      whereto_application_fee_refund_amount: "150",
    },
    ...overrides,
  };
}

export function transferFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: TRANSFER_ID,
    object: "transfer",
    amount: 1_850,
    amount_reversed: 0,
    currency: "usd",
    destination: ACCOUNT_ID,
    livemode: false,
    reversed: false,
    source_transaction: CHARGE_ID,
    ...overrides,
  };
}

export function transferReversalFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: REFUND_REVERSAL_ID,
    object: "transfer_reversal",
    amount: 1_850,
    currency: "usd",
    source_refund: REFUND_ID,
    transfer: TRANSFER_ID,
    ...overrides,
  };
}

export function applicationFeeFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: APPLICATION_FEE_ID,
    object: "application_fee",
    amount: 150,
    amount_refunded: 150,
    charge: "py_Task14PaymentRecord",
    currency: "usd",
    livemode: false,
    originating_transaction: CHARGE_ID,
    refunded: true,
    ...overrides,
  };
}

export function feeRefundFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: FEE_REFUND_ID,
    object: "fee_refund",
    amount: 150,
    currency: "usd",
    fee: APPLICATION_FEE_ID,
    ...overrides,
  };
}

export function disputeFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: DISPUTE_ID,
    object: "dispute",
    livemode: false,
    amount: 2_000,
    currency: "usd",
    status: "needs_response",
    charge: CHARGE_ID,
    payment_intent: PAYMENT_INTENT_ID,
    ...overrides,
  };
}

export function accountFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: ACCOUNT_ID,
    object: "v2.core.account",
    applied_configurations: ["recipient"],
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "active", status_details: [] },
            payouts: { status: "active", status_details: [] },
          },
        },
      },
    },
    created: NOW_ISO,
    dashboard: "express",
    defaults: {
      currency: "usd",
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
        requirements_collector: "stripe",
      },
    },
    livemode: false,
    requirements: { entries: [] },
    ...overrides,
  };
}

export function snapshotEvent(
  type: string,
  object: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `evt_${type.replaceAll(/[^A-Za-z0-9]/g, "")}Task14`,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: NOW_EPOCH_SECONDS,
    livemode: false,
    type,
    data: { object },
    ...overrides,
  };
}

export function thinAccountEvent(
  type = "v2.core.account[requirements].updated",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "evt_Task14Account",
    object: "v2.core.event",
    created: NOW_ISO,
    livemode: false,
    type,
    related_object: {
      id: ACCOUNT_ID,
      type: "v2.core.account",
      url: "/v2/core/accounts/x",
    },
    ...overrides,
  };
}
