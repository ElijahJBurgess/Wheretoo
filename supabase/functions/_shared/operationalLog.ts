export const CHECKOUT_OPERATIONAL_CONTRACT_VERSION =
  "checkout_integrity_v1" as const;

const OPERATION_OUTCOMES = {
  "checkout.create": ["created", "reused", "failed", "uncertain"],
  "checkout.cancel": ["cancelled", "no_transition", "blocked", "ambiguous"],
  "webhook.delivery": ["signature_failed", "duplicate", "retry"],
  "webhook.reconciliation": ["mismatch", "review"],
  "webhook.lifecycle": ["processing", "failed"],
  "webhook.fulfillment": ["fulfilled"],
  "refund.reconcile": ["applied", "review"],
} as const;

type OperationalOperation = keyof typeof OPERATION_OUTCOMES;

interface OperationalBase {
  contractVersion: typeof CHECKOUT_OPERATIONAL_CONTRACT_VERSION;
}

interface CheckoutSummaryFields {
  orderId?: string;
  eventId?: string;
  providerObjectId?: string;
  itemCount?: number;
  aggregateQuantity?: number;
  currency?: "usd";
  subtotalMinor?: number;
  totalMinor?: number;
  applicationFeeAmountMinor?: number;
}

type CheckoutCreateOperationalErrorCode =
  | "CHECKOUT_ALREADY_EXISTS"
  | "CHECKOUT_DISABLED"
  | "CHECKOUT_EXPIRED"
  | "CHECKOUT_NOT_FOUND"
  | "CHECKOUT_UNAVAILABLE"
  | "CONNECT_ACTION_REQUIRED"
  | "CONNECT_NOT_READY"
  | "CORS_ORIGIN_DENIED"
  | "EVENT_NOT_SELLABLE"
  | "INTERNAL_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_REQUEST"
  | "INVALID_STRIPE_SESSION"
  | "METHOD_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "STRIPE_REQUEST_FAILED"
  | "TIER_NOT_ACTIVE"
  | "TIER_NOT_FOUND"
  | "TIER_SOLD_OUT";

type CheckoutUncertainOperationalErrorCode =
  | "INTERNAL_ERROR"
  | "INVALID_STRIPE_SESSION"
  | "STRIPE_REQUEST_FAILED";

export type CancellationBlockedOperationalErrorCode =
  | "CHECKOUT_UNAVAILABLE"
  | "INVALID_STRIPE_SESSION";

export type CancellationAmbiguousOperationalErrorCode =
  | "INTERNAL_ERROR"
  | "INVALID_STRIPE_SESSION"
  | "STRIPE_REQUEST_FAILED";

export type WebhookMismatchOperationalErrorCode =
  | "CHECKOUT_AGGREGATE_MISMATCH"
  | "CHECKOUT_ITEM_BINDING_DUPLICATE"
  | "CHECKOUT_ITEM_BINDING_MISSING"
  | "CHECKOUT_ITEM_BINDING_UNKNOWN"
  | "CHECKOUT_LINE_AMOUNT_MISMATCH"
  | "CHECKOUT_LINE_COUNT_MISMATCH"
  | "CHECKOUT_LINE_CURRENCY_MISMATCH"
  | "CHECKOUT_LINE_QUANTITY_MISMATCH"
  | "CHECKOUT_LINE_TIER_MISMATCH"
  | "CHECKOUT_RECONCILIATION_REVIEW_MISMATCH"
  | "DISPUTE_RECOVERY_MISMATCH"
  | "DISPUTE_SNAPSHOT_MISMATCH"
  | "INTERNAL_ERROR"
  | "INVALID_EVENT_ENVELOPE"
  | "INVALID_STRIPE_ACCOUNT"
  | "LIVE_MODE_FORBIDDEN"
  | "ORDER_NOT_FOUND"
  | "PAYMENT_BINDING_MISMATCH"
  | "PAYMENT_NOT_PAID"
  | "PAYMENT_OBJECT_ALREADY_USED"
  | "PAYMENT_SNAPSHOT_MISMATCH"
  | "REFUND_POLICY_MISMATCH"
  | "REFUND_SNAPSHOT_MISMATCH"
  | "REFUND_TOTAL_INVALID"
  | "STRIPE_OBJECT_INVALID"
  | "WEBHOOK_EVENT_MISMATCH"
  | "WEBHOOK_RECEIPT_INVALID"
  | "WEBHOOK_RECEIPT_MISMATCH";

type CheckoutCreatedEvent = OperationalBase & CheckoutSummaryFields & {
  operation: "checkout.create";
  outcome: "created";
  resultStatus: "checkout_open";
  priorStatus?: never;
  errorCode?: never;
};

type CheckoutReusedEvent = OperationalBase & CheckoutSummaryFields & {
  operation: "checkout.create";
  outcome: "reused";
  priorStatus: "checkout_open";
  resultStatus: "checkout_open";
  errorCode?: never;
};

type CheckoutFailedEvent = OperationalBase & CheckoutSummaryFields & {
  operation: "checkout.create";
  outcome: "failed";
  errorCode: CheckoutCreateOperationalErrorCode;
  priorStatus?: never;
  resultStatus?: never;
};

type CheckoutUncertainEvent = OperationalBase & CheckoutSummaryFields & {
  operation: "checkout.create";
  outcome: "uncertain";
  errorCode: CheckoutUncertainOperationalErrorCode;
  priorStatus?: never;
  resultStatus?: never;
};

type CancellationTransitionEvent = OperationalBase & {
  operation: "checkout.cancel";
  outcome: "cancelled";
  orderId: string;
  providerObjectId?: string;
  priorStatus: "creating_checkout" | "checkout_open";
  resultStatus: "cancelled";
  errorCode?: never;
};

type CancellationNoTransitionEvent = OperationalBase & {
  operation: "checkout.cancel";
  outcome: "no_transition";
  orderId: string;
  providerObjectId?: string;
  errorCode?: never;
  priorStatus: "cancelled" | "expired" | "payment_failed";
  resultStatus: "cancelled" | "expired" | "payment_failed";
};

type CancellationBlockedEvent = OperationalBase & {
  operation: "checkout.cancel";
  outcome: "blocked";
  orderId: string;
  providerObjectId?: string;
  priorStatus: OrderStatus;
  errorCode: CancellationBlockedOperationalErrorCode;
  resultStatus?: never;
};

type CancellationAmbiguousEvent = OperationalBase & {
  operation: "checkout.cancel";
  outcome: "ambiguous";
  orderId: string;
  providerObjectId?: string;
  priorStatus: OrderStatus;
  errorCode: CancellationAmbiguousOperationalErrorCode;
  resultStatus?: never;
};

type WebhookDeliveryEvent =
  & OperationalBase
  & (
    | {
      operation: "webhook.delivery";
      outcome: "signature_failed";
      errorCode: "INVALID_WEBHOOK";
    }
    | {
      operation: "webhook.delivery";
      outcome: "duplicate";
      stripeEventId: string;
      providerObjectId: string;
      attempt?: number;
      durationMs?: number;
      errorCode?: never;
    }
    | {
      operation: "webhook.delivery";
      outcome: "retry";
      stripeEventId: string;
      providerObjectId: string;
      attempt?: number;
      durationMs?: number;
      errorCode: "TRANSIENT_PROCESSING_FAILURE";
    }
  );

type WebhookReconciliationEvent =
  & OperationalBase
  & CheckoutSummaryFields
  & {
    operation: "webhook.reconciliation";
    stripeEventId?: string;
  }
  & (
    | {
      outcome: "mismatch";
      errorCode: WebhookMismatchOperationalErrorCode;
      resultStatus?: never;
    }
    | {
      outcome: "review";
      orderId: string;
      stripeEventId: string;
      providerObjectId: string;
      resultStatus: "requires_review";
      errorCode: "PAYMENT_CHARGE_DISPUTED" | "PAYMENT_CHARGE_REFUNDED";
    }
  );

type WebhookLifecycleEvent =
  & OperationalBase
  & {
    operation: "webhook.lifecycle";
    orderId: string;
    stripeEventId: string;
    providerObjectId: string;
  }
  & (
    | {
      outcome: "processing";
      priorStatus: "checkout_open";
      resultStatus: "payment_processing";
      errorCode?: never;
    }
    | {
      outcome: "failed";
      resultStatus: "expired" | "payment_failed";
      errorCode: "CHECKOUT_EXPIRED" | "ASYNC_PAYMENT_FAILED";
      priorStatus?: never;
    }
  );

type WebhookFulfillmentEvent = OperationalBase & CheckoutSummaryFields & {
  operation: "webhook.fulfillment";
  outcome: "fulfilled";
  orderId: string;
  stripeEventId: string;
  providerObjectId: string;
  resultStatus: "paid";
  actualTicketCount: number;
  priorStatus?: never;
  errorCode?: never;
};

export type RefundOrderStatus =
  | "creating_checkout"
  | "checkout_open"
  | "payment_processing"
  | "paid"
  | "expired"
  | "payment_failed"
  | "cancelled"
  | "partially_refunded"
  | "refunded"
  | "requires_review";
export type RefundTicketStatus =
  | "valid"
  | "cancelled"
  | "refunded"
  | "mixed"
  | "none";

interface RefundEventFields extends OperationalBase {
  operation: "refund.reconcile";
  orderId: string;
  stripeEventId: string;
  providerObjectId: string;
  currency: "usd";
  amountMinor: number;
  priorStatus?: never;
}

type RefundReconciliationEvent =
  | RefundEventFields & {
    outcome: "applied";
    resultStatus: "checkout_open";
    ticketStatus: "none";
    errorCode?: never;
  }
  | RefundEventFields & {
    outcome: "applied";
    resultStatus: "paid";
    ticketStatus: "valid";
    errorCode?: never;
  }
  | RefundEventFields & {
    outcome: "applied";
    resultStatus: "refunded";
    ticketStatus: "refunded";
    errorCode?: never;
  }
  | RefundEventFields & {
    outcome: "review";
    resultStatus: "requires_review";
    ticketStatus: RefundTicketStatus;
    errorCode: "REFUND_DURABLE_STATE_REVIEW" | "REFUND_POLICY_MISMATCH";
  }
  | RefundEventFields & {
    outcome: "review";
    resultStatus: Exclude<RefundOrderStatus, "requires_review">;
    ticketStatus: RefundTicketStatus;
    errorCode: "REFUND_DURABLE_STATE_REVIEW";
  };

export type CheckoutOperationalEvent =
  | CheckoutCreatedEvent
  | CheckoutReusedEvent
  | CheckoutFailedEvent
  | CheckoutUncertainEvent
  | CancellationTransitionEvent
  | CancellationNoTransitionEvent
  | CancellationBlockedEvent
  | CancellationAmbiguousEvent
  | WebhookDeliveryEvent
  | WebhookReconciliationEvent
  | WebhookLifecycleEvent
  | WebhookFulfillmentEvent
  | RefundReconciliationEvent;

export type OperationalEventSink = (
  serialized: string,
) => unknown;

type OperationalStatus =
  | "creating_checkout"
  | "checkout_open"
  | "payment_processing"
  | "paid"
  | "expired"
  | "payment_failed"
  | "cancelled"
  | "partially_refunded"
  | "refunded"
  | "requires_review"
  | "open"
  | "complete"
  | "unpaid"
  | "processing"
  | "processed"
  | "pending"
  | "succeeded"
  | "failed"
  | "requires_action"
  | "not_applicable"
  | "recovered";

type OrderStatus =
  | "creating_checkout"
  | "checkout_open"
  | "payment_processing"
  | "paid"
  | "expired"
  | "payment_failed"
  | "cancelled"
  | "partially_refunded"
  | "refunded"
  | "requires_review";

type OperationalErrorCode =
  | "ACCOUNT_STATUS_SYNCED"
  | "ASYNC_PAYMENT_FAILED"
  | "CHECKOUT_AGGREGATE_MISMATCH"
  | "CHECKOUT_ALREADY_EXISTS"
  | "CHECKOUT_DISABLED"
  | "CHECKOUT_EXPIRED"
  | "CHECKOUT_ITEM_BINDING_DUPLICATE"
  | "CHECKOUT_ITEM_BINDING_MISSING"
  | "CHECKOUT_ITEM_BINDING_UNKNOWN"
  | "CHECKOUT_LINE_AMOUNT_MISMATCH"
  | "CHECKOUT_LINE_COUNT_MISMATCH"
  | "CHECKOUT_LINE_CURRENCY_MISMATCH"
  | "CHECKOUT_LINE_QUANTITY_MISMATCH"
  | "CHECKOUT_LINE_TIER_MISMATCH"
  | "CHECKOUT_NOT_FOUND"
  | "CHECKOUT_RECONCILIATION_REVIEW_MISMATCH"
  | "CHECKOUT_UNAVAILABLE"
  | "CONNECT_ACTION_REQUIRED"
  | "CONNECT_NOT_READY"
  | "CORS_ORIGIN_DENIED"
  | "DISPUTE_RECOVERY_MISMATCH"
  | "DISPUTE_SNAPSHOT_MISMATCH"
  | "EVENT_NOT_SELLABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "IGNORED_EVENT_TYPE"
  | "INTERNAL_ERROR"
  | "INVALID_EVENT_ENVELOPE"
  | "INVALID_REQUEST"
  | "INVALID_STRIPE_ACCOUNT"
  | "INVALID_STRIPE_SESSION"
  | "INVALID_WEBHOOK"
  | "LIVE_MODE_FORBIDDEN"
  | "METHOD_NOT_ALLOWED"
  | "ORDER_NOT_FOUND"
  | "PAYMENT_BINDING_MISMATCH"
  | "PAYMENT_CHARGE_DISPUTED"
  | "PAYMENT_CHARGE_REFUNDED"
  | "PAYMENT_NOT_PAID"
  | "PAYMENT_OBJECT_ALREADY_USED"
  | "PAYMENT_SNAPSHOT_MISMATCH"
  | "PARTIAL_REFUND_REQUIRES_REVIEW"
  | "RATE_LIMITED"
  | "REFUND_DURABLE_STATE_REVIEW"
  | "REFUND_POLICY_MISMATCH"
  | "REFUND_SNAPSHOT_MISMATCH"
  | "REFUND_TOTAL_INVALID"
  | "STRIPE_OBJECT_INVALID"
  | "STRIPE_REQUEST_FAILED"
  | "TIER_NOT_ACTIVE"
  | "TIER_NOT_FOUND"
  | "TIER_SOLD_OUT"
  | "TRANSIENT_PROCESSING_FAILURE"
  | "WEBHOOK_EVENT_MISMATCH"
  | "WEBHOOK_RECEIPT_INVALID"
  | "WEBHOOK_RECEIPT_MISMATCH"
  | "WEBHOOK_RETRY";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STRIPE_EVENT_PATTERN = /^evt_[A-Za-z0-9]+$/;
const PROVIDER_OBJECT_PATTERN =
  /^(?:acct|ch|cs_test|cus|dp|du|fee|fr|li|obj|pi|price|prod|re|tr|trr|txn)_[A-Za-z0-9]+$/;
const MAX_MONEY_MINOR = 999_999_990;
const MAX_DELIVERY_ATTEMPT = 1_000_000;
const MAX_DURATION_MS = 86_400_000;

const OPERATIONAL_STATUSES = new Set<OperationalStatus>([
  "creating_checkout",
  "checkout_open",
  "payment_processing",
  "paid",
  "expired",
  "payment_failed",
  "cancelled",
  "partially_refunded",
  "refunded",
  "requires_review",
  "open",
  "complete",
  "unpaid",
  "processing",
  "processed",
  "pending",
  "succeeded",
  "failed",
  "requires_action",
  "not_applicable",
  "recovered",
]);

const OPERATIONAL_ERROR_CODES = new Set<OperationalErrorCode>([
  "ACCOUNT_STATUS_SYNCED",
  "ASYNC_PAYMENT_FAILED",
  "CHECKOUT_AGGREGATE_MISMATCH",
  "CHECKOUT_ALREADY_EXISTS",
  "CHECKOUT_DISABLED",
  "CHECKOUT_EXPIRED",
  "CHECKOUT_ITEM_BINDING_DUPLICATE",
  "CHECKOUT_ITEM_BINDING_MISSING",
  "CHECKOUT_ITEM_BINDING_UNKNOWN",
  "CHECKOUT_LINE_AMOUNT_MISMATCH",
  "CHECKOUT_LINE_COUNT_MISMATCH",
  "CHECKOUT_LINE_CURRENCY_MISMATCH",
  "CHECKOUT_LINE_QUANTITY_MISMATCH",
  "CHECKOUT_LINE_TIER_MISMATCH",
  "CHECKOUT_NOT_FOUND",
  "CHECKOUT_RECONCILIATION_REVIEW_MISMATCH",
  "CHECKOUT_UNAVAILABLE",
  "CONNECT_ACTION_REQUIRED",
  "CONNECT_NOT_READY",
  "CORS_ORIGIN_DENIED",
  "DISPUTE_RECOVERY_MISMATCH",
  "DISPUTE_SNAPSHOT_MISMATCH",
  "EVENT_NOT_SELLABLE",
  "IDEMPOTENCY_CONFLICT",
  "IGNORED_EVENT_TYPE",
  "INTERNAL_ERROR",
  "INVALID_EVENT_ENVELOPE",
  "INVALID_REQUEST",
  "INVALID_STRIPE_ACCOUNT",
  "INVALID_STRIPE_SESSION",
  "INVALID_WEBHOOK",
  "LIVE_MODE_FORBIDDEN",
  "METHOD_NOT_ALLOWED",
  "PAYMENT_BINDING_MISMATCH",
  "PAYMENT_CHARGE_DISPUTED",
  "PAYMENT_CHARGE_REFUNDED",
  "PAYMENT_NOT_PAID",
  "PAYMENT_OBJECT_ALREADY_USED",
  "PAYMENT_SNAPSHOT_MISMATCH",
  "PARTIAL_REFUND_REQUIRES_REVIEW",
  "RATE_LIMITED",
  "REFUND_DURABLE_STATE_REVIEW",
  "REFUND_POLICY_MISMATCH",
  "REFUND_SNAPSHOT_MISMATCH",
  "REFUND_TOTAL_INVALID",
  "STRIPE_OBJECT_INVALID",
  "STRIPE_REQUEST_FAILED",
  "TIER_NOT_ACTIVE",
  "TIER_NOT_FOUND",
  "TIER_SOLD_OUT",
  "TRANSIENT_PROCESSING_FAILURE",
  "WEBHOOK_RETRY",
  "WEBHOOK_EVENT_MISMATCH",
  "WEBHOOK_RECEIPT_INVALID",
  "WEBHOOK_RECEIPT_MISMATCH",
  "ORDER_NOT_FOUND",
]);

const ORDER_STATUSES = new Set<OrderStatus>([
  "creating_checkout",
  "checkout_open",
  "payment_processing",
  "paid",
  "expired",
  "payment_failed",
  "cancelled",
  "partially_refunded",
  "refunded",
  "requires_review",
]);

const CHECKOUT_CREATE_ERROR_CODES = new Set<CheckoutCreateOperationalErrorCode>(
  [
    "CHECKOUT_ALREADY_EXISTS",
    "CHECKOUT_DISABLED",
    "CHECKOUT_EXPIRED",
    "CHECKOUT_NOT_FOUND",
    "CHECKOUT_UNAVAILABLE",
    "CONNECT_ACTION_REQUIRED",
    "CONNECT_NOT_READY",
    "CORS_ORIGIN_DENIED",
    "EVENT_NOT_SELLABLE",
    "INTERNAL_ERROR",
    "IDEMPOTENCY_CONFLICT",
    "INVALID_REQUEST",
    "INVALID_STRIPE_SESSION",
    "METHOD_NOT_ALLOWED",
    "RATE_LIMITED",
    "STRIPE_REQUEST_FAILED",
    "TIER_NOT_ACTIVE",
    "TIER_NOT_FOUND",
    "TIER_SOLD_OUT",
  ],
);

const CHECKOUT_UNCERTAIN_ERROR_CODES = new Set<
  CheckoutUncertainOperationalErrorCode
>([
  "INTERNAL_ERROR",
  "INVALID_STRIPE_SESSION",
  "STRIPE_REQUEST_FAILED",
]);

const CANCELLATION_BLOCKED_ERROR_CODES = new Set<
  CancellationBlockedOperationalErrorCode
>([
  "CHECKOUT_UNAVAILABLE",
  "INVALID_STRIPE_SESSION",
]);

const CANCELLATION_AMBIGUOUS_ERROR_CODES = new Set<
  CancellationAmbiguousOperationalErrorCode
>([
  "INTERNAL_ERROR",
  "INVALID_STRIPE_SESSION",
  "STRIPE_REQUEST_FAILED",
]);

const WEBHOOK_MISMATCH_ERROR_CODES = new Set<
  WebhookMismatchOperationalErrorCode
>([
  "CHECKOUT_AGGREGATE_MISMATCH",
  "CHECKOUT_ITEM_BINDING_DUPLICATE",
  "CHECKOUT_ITEM_BINDING_MISSING",
  "CHECKOUT_ITEM_BINDING_UNKNOWN",
  "CHECKOUT_LINE_AMOUNT_MISMATCH",
  "CHECKOUT_LINE_COUNT_MISMATCH",
  "CHECKOUT_LINE_CURRENCY_MISMATCH",
  "CHECKOUT_LINE_QUANTITY_MISMATCH",
  "CHECKOUT_LINE_TIER_MISMATCH",
  "CHECKOUT_RECONCILIATION_REVIEW_MISMATCH",
  "DISPUTE_RECOVERY_MISMATCH",
  "DISPUTE_SNAPSHOT_MISMATCH",
  "INTERNAL_ERROR",
  "INVALID_EVENT_ENVELOPE",
  "INVALID_STRIPE_ACCOUNT",
  "LIVE_MODE_FORBIDDEN",
  "ORDER_NOT_FOUND",
  "PAYMENT_BINDING_MISMATCH",
  "PAYMENT_NOT_PAID",
  "PAYMENT_OBJECT_ALREADY_USED",
  "PAYMENT_SNAPSHOT_MISMATCH",
  "REFUND_POLICY_MISMATCH",
  "REFUND_SNAPSHOT_MISMATCH",
  "REFUND_TOTAL_INVALID",
  "STRIPE_OBJECT_INVALID",
  "WEBHOOK_EVENT_MISMATCH",
  "WEBHOOK_RECEIPT_INVALID",
  "WEBHOOK_RECEIPT_MISMATCH",
]);

const DISCRIMINATOR_FIELDS = ["contractVersion", "operation", "outcome"];
const CHECKOUT_SUMMARY_FIELDS = [
  "orderId",
  "eventId",
  "providerObjectId",
  "itemCount",
  "aggregateQuantity",
  "currency",
  "subtotalMinor",
  "totalMinor",
  "applicationFeeAmountMinor",
];
const KNOWN_FIELDS = new Set([
  ...DISCRIMINATOR_FIELDS,
  ...CHECKOUT_SUMMARY_FIELDS,
  "stripeEventId",
  "amountMinor",
  "actualTicketCount",
  "attempt",
  "durationMs",
  "priorStatus",
  "resultStatus",
  "ticketStatus",
  "errorCode",
]);

function plainOwnRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const source: Record<string, unknown> = {};
  for (const field of KNOWN_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined) continue;
    if (!("value" in descriptor)) return null;
    source[field] = descriptor.value;
  }
  return source;
}

function optionalString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  field: string,
  valid: (value: string) => boolean,
): boolean {
  const value = source[field];
  if (value === undefined) return true;
  if (typeof value !== "string" || !valid(value)) return false;
  target[field] = value;
  return true;
}

function owns(source: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(source, field);
}

function hasAll(
  source: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) =>
    owns(source, field) && source[field] !== undefined
  );
}

function schemaFields(
  operation: string,
  outcome: string,
): readonly string[] | null {
  if (operation === "checkout.create") {
    if (outcome === "created") {
      return [...CHECKOUT_SUMMARY_FIELDS, "resultStatus"];
    }
    if (outcome === "reused") {
      return [...CHECKOUT_SUMMARY_FIELDS, "priorStatus", "resultStatus"];
    }
    if (outcome === "failed" || outcome === "uncertain") {
      return [...CHECKOUT_SUMMARY_FIELDS, "errorCode"];
    }
  }
  if (operation === "checkout.cancel") {
    if (outcome === "cancelled" || outcome === "no_transition") {
      return ["orderId", "providerObjectId", "priorStatus", "resultStatus"];
    }
    if (outcome === "blocked" || outcome === "ambiguous") {
      return ["orderId", "providerObjectId", "priorStatus", "errorCode"];
    }
  }
  if (operation === "webhook.delivery") {
    if (outcome === "signature_failed") return ["errorCode"];
    if (outcome === "duplicate") {
      return ["stripeEventId", "providerObjectId", "attempt", "durationMs"];
    }
    if (outcome === "retry") {
      return [
        "stripeEventId",
        "providerObjectId",
        "attempt",
        "durationMs",
        "errorCode",
      ];
    }
  }
  if (operation === "webhook.reconciliation") {
    if (outcome === "mismatch") {
      return [...CHECKOUT_SUMMARY_FIELDS, "stripeEventId", "errorCode"];
    }
    if (outcome === "review") {
      return [
        ...CHECKOUT_SUMMARY_FIELDS,
        "stripeEventId",
        "resultStatus",
        "errorCode",
      ];
    }
  }
  if (operation === "webhook.lifecycle") {
    if (outcome === "processing") {
      return [
        "orderId",
        "stripeEventId",
        "providerObjectId",
        "priorStatus",
        "resultStatus",
      ];
    }
    if (outcome === "failed") {
      return [
        "orderId",
        "stripeEventId",
        "providerObjectId",
        "resultStatus",
        "errorCode",
      ];
    }
  }
  if (operation === "webhook.fulfillment" && outcome === "fulfilled") {
    return [
      ...CHECKOUT_SUMMARY_FIELDS,
      "stripeEventId",
      "actualTicketCount",
      "resultStatus",
    ];
  }
  if (
    operation === "refund.reconcile" &&
    (outcome === "applied" || outcome === "review")
  ) {
    return [
      "orderId",
      "stripeEventId",
      "providerObjectId",
      "currency",
      "amountMinor",
      "resultStatus",
      "ticketStatus",
      ...(outcome === "review" ? ["errorCode"] : []),
    ];
  }
  return null;
}

function validCombination(
  source: Record<string, unknown>,
  operation: string,
  outcome: string,
): boolean {
  if (operation === "checkout.create") {
    if (outcome === "created") {
      return source.resultStatus === "checkout_open";
    }
    if (outcome === "reused") {
      return source.priorStatus === "checkout_open" &&
        source.resultStatus === "checkout_open";
    }
    if (outcome === "failed") {
      return typeof source.errorCode === "string" &&
        CHECKOUT_CREATE_ERROR_CODES.has(
          source.errorCode as CheckoutCreateOperationalErrorCode,
        );
    }
    return outcome === "uncertain" && typeof source.errorCode === "string" &&
      CHECKOUT_UNCERTAIN_ERROR_CODES.has(
        source.errorCode as CheckoutUncertainOperationalErrorCode,
      );
  }
  if (operation === "checkout.cancel") {
    if (outcome === "cancelled") {
      return hasAll(source, ["orderId", "priorStatus", "resultStatus"]) &&
        (source.priorStatus === "creating_checkout" ||
          source.priorStatus === "checkout_open") &&
        source.resultStatus === "cancelled";
    }
    if (outcome === "no_transition") {
      return hasAll(source, ["orderId", "priorStatus", "resultStatus"]) &&
        (source.priorStatus === "cancelled" ||
          source.priorStatus === "expired" ||
          source.priorStatus === "payment_failed") &&
        source.resultStatus === source.priorStatus;
    }
    if (
      !hasAll(source, ["orderId", "priorStatus", "errorCode"]) ||
      !ORDER_STATUSES.has(source.priorStatus as OrderStatus)
    ) return false;
    if (outcome === "blocked") {
      return CANCELLATION_BLOCKED_ERROR_CODES.has(
        source.errorCode as CancellationBlockedOperationalErrorCode,
      );
    }
    return outcome === "ambiguous" &&
      CANCELLATION_AMBIGUOUS_ERROR_CODES.has(
        source.errorCode as CancellationAmbiguousOperationalErrorCode,
      );
  }
  if (operation === "webhook.delivery") {
    if (outcome === "signature_failed") {
      return source.errorCode === "INVALID_WEBHOOK";
    }
    if (!hasAll(source, ["stripeEventId", "providerObjectId"])) return false;
    if (outcome === "duplicate") return true;
    return outcome === "retry" &&
      source.errorCode === "TRANSIENT_PROCESSING_FAILURE";
  }
  if (operation === "webhook.reconciliation") {
    if (outcome === "mismatch") {
      return typeof source.errorCode === "string" &&
        WEBHOOK_MISMATCH_ERROR_CODES.has(
          source.errorCode as WebhookMismatchOperationalErrorCode,
        );
    }
    return outcome === "review" &&
      hasAll(source, ["orderId", "stripeEventId", "providerObjectId"]) &&
      source.resultStatus === "requires_review" &&
      (source.errorCode === "PAYMENT_CHARGE_DISPUTED" ||
        source.errorCode === "PAYMENT_CHARGE_REFUNDED");
  }
  if (operation === "webhook.lifecycle") {
    if (!hasAll(source, ["orderId", "stripeEventId", "providerObjectId"])) {
      return false;
    }
    if (outcome === "processing") {
      return source.priorStatus === "checkout_open" &&
        source.resultStatus === "payment_processing";
    }
    return outcome === "failed" &&
      ((source.resultStatus === "expired" &&
        source.errorCode === "CHECKOUT_EXPIRED") ||
        (source.resultStatus === "payment_failed" &&
          source.errorCode === "ASYNC_PAYMENT_FAILED"));
  }
  if (operation === "webhook.fulfillment") {
    return outcome === "fulfilled" &&
      hasAll(source, ["orderId", "stripeEventId", "providerObjectId"]) &&
      source.resultStatus === "paid" &&
      typeof source.actualTicketCount === "number";
  }
  if (operation === "refund.reconcile") {
    if (
      !hasAll(source, [
        "orderId",
        "stripeEventId",
        "providerObjectId",
        "currency",
        "amountMinor",
        "resultStatus",
        "ticketStatus",
      ])
    ) return false;
    if (outcome === "review") {
      if (source.resultStatus === "requires_review") {
        return source.errorCode === "REFUND_DURABLE_STATE_REVIEW" ||
          source.errorCode === "REFUND_POLICY_MISMATCH";
      }
      return source.resultStatus !== "requires_review" &&
        ORDER_STATUSES.has(source.resultStatus as OrderStatus) &&
        source.errorCode === "REFUND_DURABLE_STATE_REVIEW";
    }
    if (outcome !== "applied") return false;
    return (source.resultStatus === "checkout_open" &&
      source.ticketStatus === "none") ||
      (source.resultStatus === "paid" && source.ticketStatus === "valid") ||
      (source.resultStatus === "refunded" &&
        source.ticketStatus === "refunded");
  }
  return false;
}

function optionalInteger(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): boolean {
  const value = source[field];
  if (value === undefined) return true;
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < minimum || value > maximum
  ) return false;
  target[field] = value;
  return true;
}

function validatedRecord(value: unknown): Record<string, unknown> | null {
  const source = plainOwnRecord(value);
  if (source === null) return null;
  const operation = source.operation;
  const outcome = source.outcome;
  if (
    source.contractVersion !== CHECKOUT_OPERATIONAL_CONTRACT_VERSION ||
    typeof operation !== "string" || !(operation in OPERATION_OUTCOMES) ||
    typeof outcome !== "string" ||
    !(OPERATION_OUTCOMES[
      operation as OperationalOperation
    ] as readonly string[])
      .includes(outcome)
  ) return null;

  const allowed = schemaFields(operation, outcome);
  if (allowed === null) return null;
  const allowedFields = new Set([...DISCRIMINATOR_FIELDS, ...allowed]);
  if (
    [...KNOWN_FIELDS].some((field) =>
      owns(source, field) && !allowedFields.has(field)
    )
  ) return null;

  const record: Record<string, unknown> = {
    contractVersion: CHECKOUT_OPERATIONAL_CONTRACT_VERSION,
    operation,
    outcome,
  };
  if (
    !optionalString(source, record, "orderId", (id) => UUID_PATTERN.test(id)) ||
    !optionalString(source, record, "eventId", (id) => UUID_PATTERN.test(id)) ||
    !optionalString(
      source,
      record,
      "stripeEventId",
      (id) => STRIPE_EVENT_PATTERN.test(id) && id.length <= 160,
    ) ||
    !optionalString(
      source,
      record,
      "providerObjectId",
      (id) => PROVIDER_OBJECT_PATTERN.test(id) && id.length <= 160,
    ) ||
    !optionalInteger(source, record, "itemCount", 0, 10) ||
    !optionalInteger(source, record, "aggregateQuantity", 0, 10) ||
    !optionalString(
      source,
      record,
      "currency",
      (currency) => currency === "usd",
    ) ||
    !optionalInteger(source, record, "subtotalMinor", 0, MAX_MONEY_MINOR) ||
    !optionalInteger(source, record, "totalMinor", 0, MAX_MONEY_MINOR) ||
    !optionalInteger(source, record, "amountMinor", 0, MAX_MONEY_MINOR) ||
    !optionalInteger(
      source,
      record,
      "applicationFeeAmountMinor",
      0,
      MAX_MONEY_MINOR,
    ) ||
    !optionalInteger(source, record, "actualTicketCount", 0, 10) ||
    !optionalInteger(source, record, "attempt", 1, MAX_DELIVERY_ATTEMPT) ||
    !optionalInteger(source, record, "durationMs", 0, MAX_DURATION_MS) ||
    !optionalString(
      source,
      record,
      "priorStatus",
      (status) => OPERATIONAL_STATUSES.has(status as OperationalStatus),
    ) ||
    !optionalString(
      source,
      record,
      "resultStatus",
      (status) => OPERATIONAL_STATUSES.has(status as OperationalStatus),
    ) ||
    !optionalString(
      source,
      record,
      "errorCode",
      (code) => OPERATIONAL_ERROR_CODES.has(code as OperationalErrorCode),
    ) ||
    !optionalString(
      source,
      record,
      "ticketStatus",
      (status) =>
        status === "valid" || status === "cancelled" ||
        status === "refunded" || status === "mixed" || status === "none",
    )
  ) return null;
  return validCombination(source, operation, outcome) ? record : null;
}

export function emitOperationalEvent(
  event: CheckoutOperationalEvent,
  sink: OperationalEventSink = console.log,
): void {
  try {
    const record = validatedRecord(event);
    if (record !== null) {
      void Promise.resolve(sink(JSON.stringify(record))).catch(() => {});
    }
  } catch {
    // Observability is best-effort and must never change a payment outcome.
  }
}
