export const WEBHOOK_SECRET = ["whsec", "task14fixtureboundary"].join("_");
export const THIN_WEBHOOK_SECRET = ["whsec", "task14thinfixtureboundary"].join(
  "_",
);
export const NOW_EPOCH_SECONDS = 1_788_000_000;
export const NOW_ISO = new Date(NOW_EPOCH_SECONDS * 1_000).toISOString();

export const ORDER_ID = "11111111-2222-4333-8444-555555555555";
export const EVENT_ID = "22222222-3333-4444-8555-666666666666";
export const GA_TIER_ID = "33333333-4444-4555-8666-777777777777";
export const TIER_ID = GA_TIER_ID;
export const VIP_TIER_ID = "33333333-4444-4555-8666-888888888888";
export const GA_ORDER_ITEM_ID = "55555555-6666-4777-8888-999999999999";
export const VIP_ORDER_ITEM_ID = "66666666-7777-4888-9999-aaaaaaaaaaaa";
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

export const ORDER_ITEMS = [
  {
    orderItemId: GA_ORDER_ITEM_ID,
    tierId: GA_TIER_ID,
    tierName: "General Admission",
    currency: "usd" as const,
    unitAmountMinor: 1_500,
    quantity: 2,
    subtotalMinor: 3_000,
  },
  {
    orderItemId: VIP_ORDER_ITEM_ID,
    tierId: VIP_TIER_ID,
    tierName: "VIP Entry",
    currency: "usd" as const,
    unitAmountMinor: 2_500,
    quantity: 1,
    subtotalMinor: 2_500,
  },
];

export function checkoutMetadata(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contract_version: "checkout_integrity_v1",
    event_id: EVENT_ID,
    order_id: ORDER_ID,
    ...overrides,
  };
}

export function productFixture(
  item = ORDER_ITEMS[0],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `prod_Task14${item.orderItemId.replaceAll("-", "")}`,
    object: "product",
    active: true,
    created: NOW_EPOCH_SECONDS,
    default_price: null,
    description: null,
    images: [],
    livemode: false,
    metadata: { whereto_order_item_id: item.orderItemId },
    name: item.tierName,
    package_dimensions: null,
    shippable: null,
    statement_descriptor: null,
    tax_code: null,
    type: "service",
    unit_label: null,
    updated: NOW_EPOCH_SECONDS,
    url: null,
    ...overrides,
  };
}

export function checkoutLineFixture(
  item = ORDER_ITEMS[0],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `li_Task14${item.orderItemId.replaceAll("-", "")}`,
    object: "item",
    amount_discount: 0,
    amount_subtotal: item.subtotalMinor,
    amount_tax: 0,
    amount_total: item.subtotalMinor,
    currency: item.currency,
    description: item.tierName,
    discounts: [],
    price: {
      id: `price_Task14${item.orderItemId.replaceAll("-", "")}`,
      object: "price",
      active: true,
      billing_scheme: "per_unit",
      currency: item.currency,
      livemode: false,
      product: productFixture(item),
      type: "one_time",
      unit_amount: item.unitAmountMinor,
      unit_amount_decimal: String(item.unitAmountMinor),
    },
    quantity: item.quantity,
    taxes: [],
    ...overrides,
  };
}

export function checkoutLineItemsFixture(
  lines: Record<string, unknown>[] = [
    checkoutLineFixture(ORDER_ITEMS[1]),
    checkoutLineFixture(ORDER_ITEMS[0]),
  ],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    object: "list",
    data: lines,
    has_more: false,
    url: `/v1/checkout/sessions/${SESSION_ID}/line_items`,
    ...overrides,
  };
}

export function paymentIntentFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PAYMENT_INTENT_ID,
    object: "payment_intent",
    livemode: false,
    amount: 5_500,
    amount_capturable: 0,
    amount_received: 5_500,
    currency: "usd",
    status: "succeeded",
    application_fee_amount: 450,
    transfer_data: { destination: ACCOUNT_ID },
    metadata: checkoutMetadata(),
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
    amount: 5_500,
    amount_captured: 5_500,
    captured: true,
    status: "succeeded",
    currency: "usd",
    payment_intent: PAYMENT_INTENT_ID,
    transfer: TRANSFER_ID,
    application_fee: APPLICATION_FEE_ID,
    balance_transaction: BALANCE_TRANSACTION_ID,
    customer: CUSTOMER_ID,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
    metadata: checkoutMetadata(),
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
    amount_subtotal: 5_500,
    amount_total: 5_500,
    client_reference_id: ORDER_ID,
    metadata: checkoutMetadata(),
    payment_intent: paymentIntentFixture(),
    line_items: checkoutLineItemsFixture(),
    ...overrides,
  };
}

export function refundFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: REFUND_ID,
    object: "refund",
    amount: 5_500,
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
      whereto_transfer_reversal_amount: "5500",
      whereto_application_fee_refund_id: FEE_REFUND_ID,
      whereto_application_fee_refund_amount: "450",
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
    amount: 5_050,
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
    amount: 5_050,
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
    amount: 450,
    amount_refunded: 450,
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
    amount: 450,
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
    amount: 5_500,
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
