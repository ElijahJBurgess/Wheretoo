export const CHECKOUT_OPERATIONAL_CONTRACT_VERSION =
  "checkout_integrity_v1" as const;

const OPERATION_OUTCOMES = {
  "checkout.create": ["created", "reused", "failed", "uncertain"],
  "checkout.cancel": ["cancelled", "blocked", "ambiguous"],
  "webhook.delivery": ["signature_failed", "duplicate", "retry"],
  "webhook.reconciliation": ["mismatch", "review"],
  "webhook.lifecycle": ["processing", "failed"],
  "webhook.fulfillment": ["fulfilled"],
  "refund.reconcile": ["applied", "review"],
} as const;

type OperationalOperation = keyof typeof OPERATION_OUTCOMES;

interface SafeOperationalFields {
  contractVersion: typeof CHECKOUT_OPERATIONAL_CONTRACT_VERSION;
  orderId?: string;
  eventId?: string;
  stripeEventId?: string;
  providerObjectId?: string;
  itemCount?: number;
  aggregateQuantity?: number;
  currency?: "usd";
  subtotalMinor?: number;
  totalMinor?: number;
  amountMinor?: number;
  applicationFeeAmountMinor?: number;
  attempt?: number;
  durationMs?: number;
  priorStatus?: OperationalStatus;
  resultStatus?: OperationalStatus;
  errorCode?: OperationalErrorCode;
}

export type CheckoutOperationalEvent = {
  [Operation in OperationalOperation]: SafeOperationalFields & {
    operation: Operation;
    outcome: (typeof OPERATION_OUTCOMES)[Operation][number];
  };
}[OperationalOperation];

export type OperationalEventSink = (serialized: string) => void;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!isRecord(value)) return null;
  const operation = value.operation;
  const outcome = value.outcome;
  if (
    value.contractVersion !== CHECKOUT_OPERATIONAL_CONTRACT_VERSION ||
    typeof operation !== "string" || !(operation in OPERATION_OUTCOMES) ||
    typeof outcome !== "string" ||
    !(OPERATION_OUTCOMES[
      operation as OperationalOperation
    ] as readonly string[])
      .includes(outcome)
  ) return null;

  const record: Record<string, unknown> = {
    contractVersion: CHECKOUT_OPERATIONAL_CONTRACT_VERSION,
    operation,
    outcome,
  };
  if (
    !optionalString(value, record, "orderId", (id) => UUID_PATTERN.test(id)) ||
    !optionalString(value, record, "eventId", (id) => UUID_PATTERN.test(id)) ||
    !optionalString(
      value,
      record,
      "stripeEventId",
      (id) => STRIPE_EVENT_PATTERN.test(id) && id.length <= 160,
    ) ||
    !optionalString(
      value,
      record,
      "providerObjectId",
      (id) => PROVIDER_OBJECT_PATTERN.test(id) && id.length <= 160,
    ) ||
    !optionalInteger(value, record, "itemCount", 0, 10) ||
    !optionalInteger(value, record, "aggregateQuantity", 0, 10) ||
    !optionalString(
      value,
      record,
      "currency",
      (currency) => currency === "usd",
    ) ||
    !optionalInteger(value, record, "subtotalMinor", 0, MAX_MONEY_MINOR) ||
    !optionalInteger(value, record, "totalMinor", 0, MAX_MONEY_MINOR) ||
    !optionalInteger(value, record, "amountMinor", 0, MAX_MONEY_MINOR) ||
    !optionalInteger(
      value,
      record,
      "applicationFeeAmountMinor",
      0,
      MAX_MONEY_MINOR,
    ) ||
    !optionalInteger(value, record, "attempt", 1, MAX_DELIVERY_ATTEMPT) ||
    !optionalInteger(value, record, "durationMs", 0, MAX_DURATION_MS) ||
    !optionalString(
      value,
      record,
      "priorStatus",
      (status) => OPERATIONAL_STATUSES.has(status as OperationalStatus),
    ) ||
    !optionalString(
      value,
      record,
      "resultStatus",
      (status) => OPERATIONAL_STATUSES.has(status as OperationalStatus),
    ) ||
    !optionalString(
      value,
      record,
      "errorCode",
      (code) => OPERATIONAL_ERROR_CODES.has(code as OperationalErrorCode),
    )
  ) return null;
  return record;
}

export function emitOperationalEvent(
  event: CheckoutOperationalEvent,
  sink: OperationalEventSink = console.log,
): void {
  try {
    const record = validatedRecord(event);
    if (record !== null) sink(JSON.stringify(record));
  } catch {
    // Observability is best-effort and must never change a payment outcome.
  }
}
