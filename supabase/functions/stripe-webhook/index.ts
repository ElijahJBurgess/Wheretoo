import Stripe from "stripe";
import type { ConnectStatusProjection } from "../_shared/contracts.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getStripeWebhookSecrets } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import { getStripe } from "../_shared/stripeClient.ts";
import {
  ACCOUNT_INCLUDE,
  validateApprovedConnectAccount,
} from "../stripe-connect-session/connect.ts";

const MAX_WEBHOOK_BYTES = 1_048_576;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_PATTERN = /^evt_[A-Za-z0-9]+$/;
const OBJECT_PATTERN = /^[a-z][a-z0-9_]*_[A-Za-z0-9]+$/;
const SESSION_PATTERN = /^cs_test_[A-Za-z0-9]+$/;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9]+$/;
const CHARGE_PATTERN = /^ch_[A-Za-z0-9]+$/;
const TRANSFER_PATTERN = /^tr_[A-Za-z0-9]+$/;
const APPLICATION_FEE_PATTERN = /^fee_[A-Za-z0-9]+$/;
const BALANCE_TRANSACTION_PATTERN = /^txn_[A-Za-z0-9]+$/;
const CUSTOMER_PATTERN = /^cus_[A-Za-z0-9]+$/;
const REFUND_PATTERN = /^re_[A-Za-z0-9]+$/;
const DISPUTE_PATTERN = /^(du|dp)_[A-Za-z0-9]+$/;
const ACCOUNT_PATTERN = /^acct_[A-Za-z0-9]+$/;

const CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const REFUND_EVENT_TYPES = new Set([
  "refund.created",
  "refund.updated",
  "refund.failed",
]);
const DISPUTE_EVENT_TYPES = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_reinstated",
  "charge.dispute.funds_withdrawn",
]);
const ACCOUNT_EVENT_TYPES = new Set([
  "v2.core.account.created",
  "v2.core.account.updated",
  "v2.core.account.closed",
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[defaults].updated",
  "v2.core.account[future_requirements].updated",
  "v2.core.account[requirements].updated",
]);

type ReceiptOutcome = "processed" | "failed";

export interface ReceiptInput {
  stripeEventId: string;
  eventType: string;
  livemode: false;
  stripeObjectId: string;
  apiVersion: string | null;
  stripeCreatedAt: string;
  payloadSha256: string;
}

export interface OrderSnapshot {
  orderId: string;
  eventId: string;
  tierId: string;
  currency: "usd";
  subtotalMinor: number;
  totalMinor: number;
  applicationFeeAmountMinor: number;
  destinationAccountId: string;
}

export interface PaymentSnapshot {
  stripeEventId: string;
  orderId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  mode: "payment";
  paymentStatus: "paid" | "unpaid";
  currency: "usd";
  subtotalMinor: number;
  totalMinor: number;
  applicationFeeAmountMinor: number;
  destinationAccountId: string;
}

export interface FulfillmentSnapshot extends PaymentSnapshot {
  paymentIntentId: string;
  chargeId: string;
  transferId: string;
  applicationFeeId: string;
  balanceTransactionId: string;
  customerId: string | null;
}

export interface PaymentFailureSnapshot extends PaymentSnapshot {
  failureCode: "ASYNC_PAYMENT_FAILED" | "CHECKOUT_EXPIRED";
}

export interface RefundSnapshot {
  stripeEventId: string;
  orderId: string;
  stripeRefundId: string;
  paymentIntentId: string;
  chargeId: string;
  amountMinor: number;
  currency: "usd";
  status: string;
  reason: string | null;
  reverseTransfer: boolean;
  refundApplicationFee: boolean;
}

export interface DisputeSnapshot {
  stripeEventId: string;
  orderId: string;
  stripeDisputeId: string;
  chargeId: string;
  status: string;
  amountMinor: number;
  currency: "usd";
  recoveryStatus: "not_attempted";
}

export interface StripeWebhookDependencies {
  verifyEvent(raw: string, signature: string): Promise<unknown>;
  recordReceipt(input: ReceiptInput): Promise<{ shouldProcess: boolean }>;
  finalizeReceipt(
    eventId: string,
    outcome: ReceiptOutcome,
    errorCode: string,
  ): Promise<void>;
  getOrderSnapshot(
    orderId: string,
    checkoutSessionId: string,
  ): Promise<OrderSnapshot | null>;
  retrieveSession(
    id: string,
    params: Stripe.Checkout.SessionRetrieveParams,
  ): Promise<unknown>;
  retrievePaymentIntent(id: string): Promise<unknown>;
  retrieveCharge(id: string): Promise<unknown>;
  retrieveRefund(id: string): Promise<unknown>;
  retrieveDispute(id: string): Promise<unknown>;
  retrieveAccount(
    id: string,
    params: Stripe.V2.Core.AccountRetrieveParams,
  ): Promise<unknown>;
  persistAccountStatus(
    accountId: string,
    projection: ConnectStatusProjection,
    syncedAt: string,
  ): Promise<boolean>;
  fulfillPaidOrder(snapshot: FulfillmentSnapshot): Promise<void>;
  markPaymentProcessing(snapshot: PaymentSnapshot): Promise<void>;
  markPaymentFailed(snapshot: PaymentFailureSnapshot): Promise<void>;
  applyRefund(snapshot: RefundSnapshot): Promise<void>;
  applyDispute(snapshot: DisputeSnapshot): Promise<void>;
  now(): string;
}

interface NormalizedEvent {
  id: string;
  type: string;
  livemode: false;
  objectId: string;
  apiVersion: string | null;
  createdAt: string;
}

class PermanentWebhookError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PermanentWebhookError";
  }
}

function permanent(code: string): never {
  throw new PermanentWebhookError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function requireId(
  value: unknown,
  pattern: RegExp,
  code = "STRIPE_OBJECT_INVALID",
): string {
  if (typeof value !== "string" || !pattern.test(value)) permanent(code);
  return value;
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    permanent("PAYMENT_SNAPSHOT_MISMATCH");
  }
  return value as number;
}

function requireUsd(value: unknown): "usd" {
  if (value !== "usd") permanent("PAYMENT_SNAPSHOT_MISMATCH");
  return "usd";
}

function expandedId(
  value: unknown,
  pattern: RegExp,
  expectedObject?: string,
): string {
  if (typeof value === "string") return requireId(value, pattern);
  if (
    !isRecord(value) ||
    (expectedObject !== undefined && value.object !== expectedObject)
  ) {
    permanent("STRIPE_OBJECT_INVALID");
  }
  return requireId(value.id, pattern);
}

function metadataOrderId(value: unknown): string {
  if (!isRecord(value)) permanent("PAYMENT_SNAPSHOT_MISMATCH");
  return requireId(value.order_id, UUID_PATTERN, "PAYMENT_SNAPSHOT_MISMATCH");
}

function validateMetadata(
  value: unknown,
  order: OrderSnapshot,
): void {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["order_id", "event_id", "tier_id"]) ||
    value.order_id !== order.orderId ||
    value.event_id !== order.eventId ||
    value.tier_id !== order.tierId
  ) {
    permanent("PAYMENT_SNAPSHOT_MISMATCH");
  }
}

function normalizeEvent(value: unknown): NormalizedEvent {
  if (!isRecord(value)) permanent("INVALID_EVENT_ENVELOPE");
  const id = requireId(value.id, EVENT_PATTERN, "INVALID_EVENT_ENVELOPE");
  if (
    typeof value.type !== "string" || value.type !== value.type.trim() ||
    value.type !== value.type.toLowerCase() || value.type.length < 3 ||
    value.type.length > 160
  ) permanent("INVALID_EVENT_ENVELOPE");
  if (value.livemode !== false) permanent("LIVE_MODE_FORBIDDEN");

  let objectId: string;
  let createdAt: string;
  let apiVersion: string | null;
  if (value.object === "event") {
    if (!Number.isSafeInteger(value.created)) {
      permanent("INVALID_EVENT_ENVELOPE");
    }
    const data = isRecord(value.data)
      ? value.data
      : permanent("INVALID_EVENT_ENVELOPE");
    const object = isRecord(data.object)
      ? data.object
      : permanent("INVALID_EVENT_ENVELOPE");
    objectId = requireId(object.id, OBJECT_PATTERN, "INVALID_EVENT_ENVELOPE");
    createdAt = new Date((value.created as number) * 1_000).toISOString();
    apiVersion = value.api_version === null
      ? null
      : typeof value.api_version === "string" && value.api_version.length > 0
      ? value.api_version
      : permanent("INVALID_EVENT_ENVELOPE");
  } else if (value.object === "v2.core.event") {
    const related = isRecord(value.related_object)
      ? value.related_object
      : permanent("INVALID_EVENT_ENVELOPE");
    objectId = requireId(related.id, OBJECT_PATTERN, "INVALID_EVENT_ENVELOPE");
    if (
      typeof value.created !== "string" ||
      !Number.isFinite(Date.parse(value.created))
    ) {
      permanent("INVALID_EVENT_ENVELOPE");
    }
    createdAt = new Date(value.created).toISOString();
    apiVersion = null;
  } else {
    permanent("INVALID_EVENT_ENVELOPE");
  }
  return {
    id,
    type: value.type,
    livemode: false,
    objectId,
    apiVersion,
    createdAt,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function verifyStripeSignature(
  stripe: Stripe,
  raw: string,
  signature: string,
  secret: string,
  receivedAt?: number,
): Promise<void> {
  if (stripe.webhooks.signature === null) {
    throw new Error("signature unavailable");
  }
  await stripe.webhooks.signature.verifyHeaderAsync(
    raw,
    signature,
    secret,
    stripe.webhooks.DEFAULT_TOLERANCE,
    undefined,
    receivedAt === undefined ? undefined : receivedAt * 1_000,
  );
}

export async function verifyStripeSignatureAgainstSecrets(
  stripe: Stripe,
  raw: string,
  signature: string,
  secrets: readonly string[],
  receivedAt?: number,
): Promise<void> {
  let rejected: unknown;
  for (const secret of secrets) {
    try {
      await verifyStripeSignature(
        stripe,
        raw,
        signature,
        secret,
        receivedAt,
      );
      return;
    } catch (error) {
      rejected = error;
    }
  }
  throw rejected ?? new Error("webhook signature unavailable");
}

function parseRpcSingle(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error("invalid database response");
  }
  return value[0];
}

function rpcPermanentCode(error: { message?: string } | null): string | null {
  const code = error?.message;
  if (
    code === "WEBHOOK_EVENT_MISMATCH" ||
    code === "WEBHOOK_RECEIPT_INVALID" ||
    code === "LIVE_MODE_FORBIDDEN" ||
    code === "PAYMENT_SNAPSHOT_MISMATCH" ||
    code === "WEBHOOK_RECEIPT_MISMATCH" ||
    code === "PAYMENT_OBJECT_ALREADY_USED" ||
    code === "PAYMENT_NOT_PAID" ||
    code === "REFUND_SNAPSHOT_MISMATCH" ||
    code === "REFUND_TOTAL_INVALID" ||
    code === "DISPUTE_SNAPSHOT_MISMATCH" ||
    code === "ORDER_NOT_FOUND"
  ) return code;
  return null;
}

function throwRpc(error: { message?: string } | null): never {
  const code = rpcPermanentCode(error);
  if (code !== null) permanent(code);
  throw new Error("database request failed");
}

async function defaultRecordReceipt(input: ReceiptInput) {
  const { data, error } = await getServiceClient().rpc(
    "server_record_webhook_receipt",
    {
      p_stripe_event_id: input.stripeEventId,
      p_event_type: input.eventType,
      p_livemode: input.livemode,
      p_stripe_object_id: input.stripeObjectId,
      p_api_version: input.apiVersion,
      p_stripe_created_at: input.stripeCreatedAt,
      p_payload_sha256: input.payloadSha256,
    },
  );
  if (error !== null) throwRpc(error);
  const row = parseRpcSingle(data);
  if (typeof row.should_process !== "boolean") {
    throw new Error("invalid receipt");
  }
  return { shouldProcess: row.should_process };
}

async function defaultFinalizeReceipt(
  eventId: string,
  outcome: ReceiptOutcome,
  errorCode: string,
): Promise<void> {
  const { data, error } = await getServiceClient().rpc(
    "server_finalize_webhook_receipt",
    {
      p_stripe_event_id: eventId,
      p_processing_status: outcome,
      p_error_code: errorCode,
    },
  );
  if (error !== null || data !== eventId) {
    throw new Error("receipt finalization failed");
  }
}

function orderSnapshotFromRpc(value: unknown): OrderSnapshot | null {
  if (!Array.isArray(value)) throw new Error("invalid database response");
  if (value.length === 0) return null;
  const row = parseRpcSingle(value);
  if (
    typeof row.order_id !== "string" || !UUID_PATTERN.test(row.order_id) ||
    typeof row.event_id !== "string" || !UUID_PATTERN.test(row.event_id) ||
    typeof row.tier_id !== "string" || !UUID_PATTERN.test(row.tier_id) ||
    row.currency !== "usd" || !Number.isSafeInteger(row.subtotal_minor) ||
    !Number.isSafeInteger(row.total_minor) ||
    !Number.isSafeInteger(row.application_fee_amount_minor) ||
    typeof row.destination_account_id !== "string" ||
    !ACCOUNT_PATTERN.test(row.destination_account_id)
  ) throw new Error("invalid database response");
  return {
    orderId: row.order_id,
    eventId: row.event_id,
    tierId: row.tier_id,
    currency: "usd",
    subtotalMinor: row.subtotal_minor as number,
    totalMinor: row.total_minor as number,
    applicationFeeAmountMinor: row.application_fee_amount_minor as number,
    destinationAccountId: row.destination_account_id,
  };
}

async function defaultGetOrderSnapshot(orderId: string, sessionId: string) {
  const { data, error } = await getServiceClient().rpc(
    "server_get_webhook_order_snapshot",
    { p_order_id: orderId, p_checkout_session_id: sessionId },
  );
  if (error !== null) throwRpc(error);
  return orderSnapshotFromRpc(data);
}

async function domainRpc(name: string, params: Record<string, unknown>) {
  const { error } = await getServiceClient().rpc(name, params);
  if (error !== null) throwRpc(error);
}

async function defaultPersistAccountStatus(
  accountId: string,
  projection: ConnectStatusProjection,
  syncedAt: string,
): Promise<boolean> {
  const client = getServiceClient();
  const { data: owner, error: findError } = await client
    .from("organizer_stripe_accounts")
    .select("organizer_id")
    .eq("stripe_account_id", accountId)
    .eq("livemode", false)
    .maybeSingle();
  if (findError !== null) throw new Error("account lookup failed");
  if (owner === null) return false;
  const { data, error } = await client
    .from("organizer_stripe_accounts")
    .update({
      transfers_status: projection.transfersStatus,
      payouts_status: projection.payoutsStatus,
      requirements_status: projection.requirementsStatus,
      requirements_currently_due_count:
        projection.requirementsCurrentlyDueCount,
      requirements_past_due_count: projection.requirementsPastDueCount,
      last_status_code: projection.lastStatusCode,
      last_synced_at: syncedAt,
    })
    .eq("organizer_id", owner.organizer_id)
    .eq("stripe_account_id", accountId)
    .eq("livemode", false)
    .select("organizer_id")
    .maybeSingle();
  if (error !== null) throw new Error("account persistence failed");
  return data !== null;
}

function defaultDependencies(): StripeWebhookDependencies {
  const stripe = getStripe();
  return {
    verifyEvent: async (raw, signature) => {
      await verifyStripeSignatureAgainstSecrets(
        stripe,
        raw,
        signature,
        getStripeWebhookSecrets(),
      );
      return JSON.parse(raw) as unknown;
    },
    recordReceipt: defaultRecordReceipt,
    finalizeReceipt: defaultFinalizeReceipt,
    getOrderSnapshot: defaultGetOrderSnapshot,
    retrieveSession: (id, params) =>
      stripe.checkout.sessions.retrieve(id, params),
    retrievePaymentIntent: (id) => stripe.paymentIntents.retrieve(id),
    retrieveCharge: (id) => stripe.charges.retrieve(id),
    retrieveRefund: (id) => stripe.refunds.retrieve(id),
    retrieveDispute: (id) => stripe.disputes.retrieve(id),
    retrieveAccount: (id, params) =>
      stripe.v2.core.accounts.retrieve(id, params),
    persistAccountStatus: defaultPersistAccountStatus,
    fulfillPaidOrder: (value) =>
      domainRpc("server_fulfill_paid_order", {
        p_stripe_event_id: value.stripeEventId,
        p_order_id: value.orderId,
        p_checkout_session_id: value.checkoutSessionId,
        p_payment_intent_id: value.paymentIntentId,
        p_charge_id: value.chargeId,
        p_transfer_id: value.transferId,
        p_application_fee_id: value.applicationFeeId,
        p_balance_transaction_id: value.balanceTransactionId,
        p_customer_id: value.customerId,
        p_mode: value.mode,
        p_payment_status: value.paymentStatus,
        p_currency: value.currency,
        p_subtotal_minor: value.subtotalMinor,
        p_total_minor: value.totalMinor,
        p_application_fee_amount_minor: value.applicationFeeAmountMinor,
        p_destination_account_id: value.destinationAccountId,
      }),
    markPaymentProcessing: (value) =>
      domainRpc("server_mark_payment_processing", paymentRpcParams(value)),
    markPaymentFailed: (value) =>
      domainRpc("server_mark_payment_failed", {
        ...paymentRpcParams(value),
        p_failure_code: value.failureCode,
      }),
    applyRefund: (value) =>
      domainRpc("server_apply_refund", {
        p_stripe_event_id: value.stripeEventId,
        p_order_id: value.orderId,
        p_stripe_refund_id: value.stripeRefundId,
        p_payment_intent_id: value.paymentIntentId,
        p_charge_id: value.chargeId,
        p_amount_minor: value.amountMinor,
        p_currency: value.currency,
        p_status: value.status,
        p_reason: value.reason,
        p_reverse_transfer: value.reverseTransfer,
        p_refund_application_fee: value.refundApplicationFee,
      }),
    applyDispute: (value) =>
      domainRpc("server_apply_dispute", {
        p_stripe_event_id: value.stripeEventId,
        p_order_id: value.orderId,
        p_stripe_dispute_id: value.stripeDisputeId,
        p_charge_id: value.chargeId,
        p_status: value.status,
        p_amount_minor: value.amountMinor,
        p_currency: value.currency,
        p_recovery_status: value.recoveryStatus,
      }),
    now: () => new Date().toISOString(),
  };
}

function paymentRpcParams(value: PaymentSnapshot): Record<string, unknown> {
  return {
    p_stripe_event_id: value.stripeEventId,
    p_order_id: value.orderId,
    p_checkout_session_id: value.checkoutSessionId,
    p_payment_intent_id: value.paymentIntentId,
    p_mode: value.mode,
    p_payment_status: value.paymentStatus,
    p_currency: value.currency,
    p_subtotal_minor: value.subtotalMinor,
    p_total_minor: value.totalMinor,
    p_application_fee_amount_minor: value.applicationFeeAmountMinor,
    p_destination_account_id: value.destinationAccountId,
  };
}

function validatePaymentIntent(
  value: unknown,
  order: OrderSnapshot,
): { id: string; charge: Record<string, unknown> | null } {
  if (
    !isRecord(value) || value.object !== "payment_intent" ||
    value.livemode !== false
  ) {
    permanent("PAYMENT_SNAPSHOT_MISMATCH");
  }
  const id = requireId(
    value.id,
    PAYMENT_INTENT_PATTERN,
    "PAYMENT_SNAPSHOT_MISMATCH",
  );
  const transferData = isRecord(value.transfer_data)
    ? value.transfer_data
    : permanent("PAYMENT_SNAPSHOT_MISMATCH");
  if (
    value.amount !== order.totalMinor || value.currency !== order.currency ||
    value.application_fee_amount !== order.applicationFeeAmountMinor ||
    transferData.destination !== order.destinationAccountId
  ) permanent("PAYMENT_SNAPSHOT_MISMATCH");
  validateMetadata(value.metadata, order);
  if (value.latest_charge === null || value.latest_charge === undefined) {
    return { id, charge: null };
  }
  if (!isRecord(value.latest_charge)) permanent("PAYMENT_SNAPSHOT_MISMATCH");
  return { id, charge: value.latest_charge };
}

function validateCharge(
  value: unknown,
  order: OrderSnapshot,
  paymentIntentId: string,
): {
  id: string;
  transferId: string;
  applicationFeeId: string;
  balanceTransactionId: string;
  customerId: string | null;
} {
  if (
    !isRecord(value) || value.object !== "charge" || value.livemode !== false ||
    value.paid !== true || value.amount !== order.totalMinor ||
    value.currency !== order.currency ||
    expandedId(
        value.payment_intent,
        PAYMENT_INTENT_PATTERN,
        "payment_intent",
      ) !==
      paymentIntentId
  ) permanent("PAYMENT_SNAPSHOT_MISMATCH");
  validateMetadata(value.metadata, order);
  const customerId = value.customer === null || value.customer === undefined
    ? null
    : expandedId(value.customer, CUSTOMER_PATTERN, "customer");
  return {
    id: requireId(value.id, CHARGE_PATTERN, "PAYMENT_SNAPSHOT_MISMATCH"),
    transferId: expandedId(value.transfer, TRANSFER_PATTERN, "transfer"),
    applicationFeeId: expandedId(
      value.application_fee,
      APPLICATION_FEE_PATTERN,
      "application_fee",
    ),
    balanceTransactionId: expandedId(
      value.balance_transaction,
      BALANCE_TRANSACTION_PATTERN,
      "balance_transaction",
    ),
    customerId,
  };
}

async function currentSessionSnapshot(
  event: NormalizedEvent,
  dependencies: StripeWebhookDependencies,
): Promise<{
  payment: PaymentSnapshot;
  paymentIntent: { id: string; charge: Record<string, unknown> | null } | null;
  order: OrderSnapshot;
  raw: Record<string, unknown>;
}> {
  const sessionId = requireId(
    event.objectId,
    SESSION_PATTERN,
    "PAYMENT_SNAPSHOT_MISMATCH",
  );
  const value = await dependencies.retrieveSession(sessionId, {
    expand: ["line_items", "payment_intent.latest_charge"],
  });
  if (
    !isRecord(value) || value.object !== "checkout.session" ||
    value.id !== sessionId || value.livemode !== false ||
    value.mode !== "payment" ||
    (value.payment_status !== "paid" && value.payment_status !== "unpaid")
  ) permanent("PAYMENT_SNAPSHOT_MISMATCH");
  const orderId = metadataOrderId(value.metadata);
  const order = await dependencies.getOrderSnapshot(orderId, sessionId);
  if (order === null) permanent("PAYMENT_SNAPSHOT_MISMATCH");
  validateMetadata(value.metadata, order);
  const lineItems = isRecord(value.line_items)
    ? value.line_items
    : permanent("PAYMENT_SNAPSHOT_MISMATCH");
  const rows = Array.isArray(lineItems.data)
    ? lineItems.data
    : permanent("PAYMENT_SNAPSHOT_MISMATCH");
  const item = rows[0];
  const price = isRecord(item) && isRecord(item.price)
    ? item.price
    : permanent("PAYMENT_SNAPSHOT_MISMATCH");
  if (
    rows.length !== 1 || lineItems.has_more !== false || !isRecord(item) ||
    item.quantity !== 1 || item.currency !== order.currency ||
    item.amount_subtotal !== order.subtotalMinor ||
    item.amount_total !== order.totalMinor ||
    price.currency !== order.currency ||
    price.unit_amount !== order.subtotalMinor ||
    value.currency !== order.currency ||
    value.amount_subtotal !== order.subtotalMinor ||
    value.amount_total !== order.totalMinor ||
    value.client_reference_id !== order.orderId
  ) permanent("PAYMENT_SNAPSHOT_MISMATCH");
  let paymentIntent = null;
  if (value.payment_intent !== null && value.payment_intent !== undefined) {
    paymentIntent = validatePaymentIntent(value.payment_intent, order);
  }
  return {
    payment: {
      stripeEventId: event.id,
      orderId: order.orderId,
      checkoutSessionId: sessionId,
      paymentIntentId: paymentIntent?.id ?? null,
      mode: "payment",
      paymentStatus: value.payment_status,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      totalMinor: order.totalMinor,
      applicationFeeAmountMinor: order.applicationFeeAmountMinor,
      destinationAccountId: order.destinationAccountId,
    },
    paymentIntent,
    order,
    raw: value,
  };
}

async function dispatchCheckout(
  event: NormalizedEvent,
  dependencies: StripeWebhookDependencies,
): Promise<void> {
  const current = await currentSessionSnapshot(event, dependencies);
  if (event.type === "checkout.session.completed") {
    if (current.raw.status !== "complete") {
      permanent("PAYMENT_SNAPSHOT_MISMATCH");
    }
    if (current.payment.paymentStatus === "unpaid") {
      if (current.paymentIntent === null) {
        permanent("PAYMENT_SNAPSHOT_MISMATCH");
      }
      await dependencies.markPaymentProcessing(current.payment);
      return;
    }
  } else if (event.type === "checkout.session.async_payment_succeeded") {
    if (
      current.raw.status !== "complete" ||
      current.payment.paymentStatus !== "paid"
    ) permanent("PAYMENT_SNAPSHOT_MISMATCH");
  } else {
    if (current.payment.paymentStatus !== "unpaid") {
      permanent("PAYMENT_SNAPSHOT_MISMATCH");
    }
    const expectedStatus = event.type === "checkout.session.expired"
      ? "expired"
      : "complete";
    if (current.raw.status !== expectedStatus) {
      permanent("PAYMENT_SNAPSHOT_MISMATCH");
    }
    await dependencies.markPaymentFailed({
      ...current.payment,
      failureCode: event.type === "checkout.session.expired"
        ? "CHECKOUT_EXPIRED"
        : "ASYNC_PAYMENT_FAILED",
    });
    return;
  }
  if (current.paymentIntent === null || current.paymentIntent.charge === null) {
    permanent("PAYMENT_SNAPSHOT_MISMATCH");
  }
  const charge = validateCharge(
    current.paymentIntent.charge,
    current.order,
    current.paymentIntent.id,
  );
  await dependencies.fulfillPaidOrder({
    ...current.payment,
    paymentIntentId: current.paymentIntent.id,
    chargeId: charge.id,
    transferId: charge.transferId,
    applicationFeeId: charge.applicationFeeId,
    balanceTransactionId: charge.balanceTransactionId,
    customerId: charge.customerId,
  });
}

function validatePaymentBinding(
  chargeValue: unknown,
  intentValue: unknown,
  expectedChargeId: string,
  expectedIntentId: string,
): {
  orderId: string;
  charge: Record<string, unknown>;
  intent: Record<string, unknown>;
} {
  if (
    !isRecord(chargeValue) || chargeValue.object !== "charge" ||
    chargeValue.livemode !== false || chargeValue.id !== expectedChargeId ||
    expandedId(
        chargeValue.payment_intent,
        PAYMENT_INTENT_PATTERN,
        "payment_intent",
      ) !==
      expectedIntentId ||
    !isRecord(intentValue) ||
    intentValue.object !== "payment_intent" || intentValue.livemode !== false ||
    intentValue.id !== expectedIntentId
  ) permanent("PAYMENT_BINDING_MISMATCH");
  const orderId = metadataOrderId(intentValue.metadata);
  if (metadataOrderId(chargeValue.metadata) !== orderId) {
    permanent("PAYMENT_BINDING_MISMATCH");
  }
  return { orderId, charge: chargeValue, intent: intentValue };
}

async function dispatchRefund(
  event: NormalizedEvent,
  dependencies: StripeWebhookDependencies,
): Promise<void> {
  const refundId = requireId(
    event.objectId,
    REFUND_PATTERN,
    "REFUND_SNAPSHOT_MISMATCH",
  );
  const refund = await dependencies.retrieveRefund(refundId);
  if (
    !isRecord(refund) || refund.object !== "refund" || refund.id !== refundId
  ) {
    permanent("REFUND_SNAPSHOT_MISMATCH");
  }
  const chargeId = expandedId(refund.charge, CHARGE_PATTERN, "charge");
  const paymentIntentId = expandedId(
    refund.payment_intent,
    PAYMENT_INTENT_PATTERN,
    "payment_intent",
  );
  const charge = await dependencies.retrieveCharge(chargeId);
  const intent = await dependencies.retrievePaymentIntent(paymentIntentId);
  const binding = validatePaymentBinding(
    charge,
    intent,
    chargeId,
    paymentIntentId,
  );
  const amount = requirePositiveInteger(refund.amount);
  const currency = requireUsd(refund.currency);
  const status = refund.status;
  if (
    typeof status !== "string" ||
    ![
      "pending",
      "requires_action",
      "succeeded",
      "failed",
      "canceled",
      "cancelled",
    ]
      .includes(status) ||
    binding.charge.currency !== currency ||
    !Number.isSafeInteger(binding.charge.amount) ||
    (binding.charge.amount as number) < amount
  ) permanent("REFUND_SNAPSHOT_MISMATCH");
  const metadata = isRecord(refund.metadata) ? refund.metadata : {};
  const refundApplicationFee =
    metadata.whereto_refund_application_fee === "true";
  await dependencies.applyRefund({
    stripeEventId: event.id,
    orderId: binding.orderId,
    stripeRefundId: refundId,
    paymentIntentId,
    chargeId,
    amountMinor: amount,
    currency,
    status,
    reason: typeof refund.reason === "string" ? refund.reason : null,
    reverseTransfer: refund.transfer_reversal !== null &&
        refund.transfer_reversal !== undefined ||
      refund.source_transfer_reversal !== null &&
        refund.source_transfer_reversal !== undefined,
    refundApplicationFee,
  });
}

async function dispatchDispute(
  event: NormalizedEvent,
  dependencies: StripeWebhookDependencies,
): Promise<void> {
  const disputeId = requireId(
    event.objectId,
    DISPUTE_PATTERN,
    "DISPUTE_SNAPSHOT_MISMATCH",
  );
  const dispute = await dependencies.retrieveDispute(disputeId);
  if (
    !isRecord(dispute) || dispute.object !== "dispute" ||
    dispute.id !== disputeId || dispute.livemode !== false
  ) permanent("DISPUTE_SNAPSHOT_MISMATCH");
  const chargeId = expandedId(dispute.charge, CHARGE_PATTERN, "charge");
  const paymentIntentId = expandedId(
    dispute.payment_intent,
    PAYMENT_INTENT_PATTERN,
    "payment_intent",
  );
  const charge = await dependencies.retrieveCharge(chargeId);
  const intent = await dependencies.retrievePaymentIntent(paymentIntentId);
  const binding = validatePaymentBinding(
    charge,
    intent,
    chargeId,
    paymentIntentId,
  );
  const amount = requirePositiveInteger(dispute.amount);
  const currency = requireUsd(dispute.currency);
  const status = dispute.status;
  if (
    typeof status !== "string" ||
    ![
      "warning_needs_response",
      "warning_under_review",
      "warning_closed",
      "needs_response",
      "under_review",
      "won",
      "lost",
      "prevented",
    ].includes(status) || binding.charge.currency !== currency ||
    !Number.isSafeInteger(binding.charge.amount) ||
    (binding.charge.amount as number) < amount
  ) permanent("DISPUTE_SNAPSHOT_MISMATCH");
  await dependencies.applyDispute({
    stripeEventId: event.id,
    orderId: binding.orderId,
    stripeDisputeId: disputeId,
    chargeId,
    status,
    amountMinor: amount,
    currency,
    recoveryStatus: "not_attempted",
  });
}

async function dispatchAccount(
  event: NormalizedEvent,
  dependencies: StripeWebhookDependencies,
): Promise<void> {
  const accountId = requireId(
    event.objectId,
    ACCOUNT_PATTERN,
    "INVALID_STRIPE_ACCOUNT",
  );
  const account = await dependencies.retrieveAccount(accountId, {
    include: ACCOUNT_INCLUDE,
  });
  let projection: ConnectStatusProjection;
  try {
    projection = validateApprovedConnectAccount(
      account as Stripe.V2.Core.Account,
    );
  } catch {
    permanent("INVALID_STRIPE_ACCOUNT");
  }
  if (
    !await dependencies.persistAccountStatus(
      accountId,
      projection,
      dependencies.now(),
    )
  ) {
    throw new Error("account persistence pending");
  }
}

async function dispatchEvent(
  event: NormalizedEvent,
  dependencies: StripeWebhookDependencies,
): Promise<"domain" | "handler"> {
  if (CHECKOUT_EVENT_TYPES.has(event.type)) {
    await dispatchCheckout(event, dependencies);
    return "domain";
  }
  if (REFUND_EVENT_TYPES.has(event.type)) {
    await dispatchRefund(event, dependencies);
    return "domain";
  }
  if (DISPUTE_EVENT_TYPES.has(event.type)) {
    await dispatchDispute(event, dependencies);
    return "domain";
  }
  if (ACCOUNT_EVENT_TYPES.has(event.type)) {
    await dispatchAccount(event, dependencies);
    return "handler";
  }
  return "handler";
}

function webhookResponse(status = 200): Response {
  return jsonResponse(
    status === 200 ? { received: true } : {
      error: { code: status === 400 ? "INVALID_WEBHOOK" : "WEBHOOK_RETRY" },
    },
    status,
  );
}

export function createStripeWebhookHandler(
  dependencies: StripeWebhookDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return webhookResponse(405);
    const signature = request.headers.get("stripe-signature");
    if (signature === null || signature.length === 0) {
      return webhookResponse(400);
    }

    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return webhookResponse(400);
    }
    if (
      raw.length === 0 ||
      new TextEncoder().encode(raw).length > MAX_WEBHOOK_BYTES
    ) return webhookResponse(400);

    let eventValue: unknown;
    try {
      eventValue = await dependencies.verifyEvent(raw, signature);
    } catch {
      return webhookResponse(400);
    }

    let event: NormalizedEvent;
    try {
      event = normalizeEvent(eventValue);
    } catch {
      return webhookResponse(400);
    }

    try {
      const receipt = await dependencies.recordReceipt({
        stripeEventId: event.id,
        eventType: event.type,
        livemode: false,
        stripeObjectId: event.objectId,
        apiVersion: event.apiVersion,
        stripeCreatedAt: event.createdAt,
        payloadSha256: await sha256Hex(raw),
      });
      if (!receipt.shouldProcess) return webhookResponse();
    } catch (error) {
      if (error instanceof PermanentWebhookError) return webhookResponse();
      return webhookResponse(503);
    }

    try {
      const ownership = await dispatchEvent(event, dependencies);
      if (ownership === "handler") {
        await dependencies.finalizeReceipt(
          event.id,
          "processed",
          ACCOUNT_EVENT_TYPES.has(event.type)
            ? "ACCOUNT_STATUS_SYNCED"
            : "IGNORED_EVENT_TYPE",
        );
      }
      return webhookResponse();
    } catch (error) {
      if (error instanceof PermanentWebhookError) {
        try {
          await dependencies.finalizeReceipt(event.id, "processed", error.code);
          return webhookResponse();
        } catch {
          return webhookResponse(503);
        }
      }
      try {
        await dependencies.finalizeReceipt(
          event.id,
          "failed",
          "TRANSIENT_PROCESSING_FAILURE",
        );
      } catch {
        // A non-2xx response keeps Stripe's delivery retryable even if the
        // receipt update itself is temporarily unavailable.
      }
      return webhookResponse(503);
    }
  };
}

export function handler(request: Request): Promise<Response> {
  return createStripeWebhookHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
