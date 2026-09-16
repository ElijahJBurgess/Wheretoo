import type Stripe from "stripe";
import { deriveConnectStatus } from "../_shared/connectState.ts";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import {
  type CheckoutCreateFailureStage,
  type CheckoutCreateProviderResult,
  emitOperationalEvent,
  type OperationalEventSink,
} from "../_shared/operationalLog.ts";
import {
  getStripe,
  STRIPE_REQUEST_ATTEMPT_ENVELOPE_SECONDS,
} from "../_shared/stripeClient.ts";
import {
  ACCOUNT_INCLUDE,
  type AccountRepository,
  createAccountRepository,
  validateApprovedConnectAccount,
} from "../stripe-connect-session/connect.ts";

const MAX_REQUEST_BYTES = 2_048;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT_PATTERN = /^acct_[A-Za-z0-9]+$/;
const SESSION_PATTERN = /^cs_test_[A-Za-z0-9]+$/;
const INTEGRATION_IDENTIFIER_PATTERN = /^whereto_checkout_[a-z]{8}$/;
const TERMINAL_SESSION_STATUSES = new Set(["complete", "expired"]);
const STRIPE_MINIMUM_CHECKOUT_LIFETIME_SECONDS = 30 * 60;

export type CheckoutErrorCode =
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

export class CheckoutHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: CheckoutErrorCode,
  ) {
    super(code);
    this.name = "CheckoutHttpError";
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface CreateCheckoutInput {
  eventId: string;
  buyerName: string;
  buyerEmail: string;
  clientRequestId: string;
  items: CheckoutItemInput[];
}

export interface CheckoutItemInput {
  tierId: string;
  quantity: number;
}

export interface ReservationItemSnapshot {
  orderItemId: string;
  ticketTierId: string;
  tierName: string;
  unitAmountMinor: number;
  quantity: number;
  subtotalMinor: number;
  currency: "usd";
}

export interface ReservationSnapshot {
  orderId: string;
  organizerId: string;
  quantity: number;
  subtotalMinor: number;
  currency: "usd";
  applicationFeeAmountMinor: number;
  totalMinor: number;
  stripeAccountId: string;
  checkoutExpiresAt: string;
  existingCheckoutSessionId: string | null;
  integrationIdentifier: string;
  createRequestDigest: string;
  items: ReservationItemSnapshot[];
}

export interface StripeCreateCheckoutDependencies {
  appOrigin: string;
  appBaseUrl: string;
  rateLimit(request: Request): Promise<RateLimitResult>;
  refreshConnect(eventId: string, tierIds: string[]): Promise<void>;
  reserveCheckout(
    input: CreateCheckoutInput,
    tokenHash: string,
  ): Promise<ReservationSnapshot | null>;
  createSession(
    params: Stripe.Checkout.SessionCreateParams,
    options: Stripe.RequestOptions,
  ): Promise<unknown>;
  retrieveSession(
    sessionId: string,
    params: Stripe.Checkout.SessionRetrieveParams,
  ): Promise<unknown>;
  expireSession(sessionId: string): Promise<unknown>;
  attachSession(
    orderId: string,
    sessionId: string,
    expiresAt: string,
  ): Promise<void>;
  releaseReservation(orderId: string, reason: string): Promise<void>;
  nowEpochSeconds(): number;
  operationalSink?: OperationalEventSink;
}

type FailureReleaseOrigin =
  | "attached-session"
  | "created-session"
  | "definitive-create-noncreation";

interface ExpectedSession {
  reservation: ReservationSnapshot;
  input: CreateCheckoutInput;
  successUrl: string;
  cancelUrl: string;
  stripeExpiresAt: number;
}

interface ValidatedSession {
  id: string;
  expiresAt: number;
  status: "open" | "complete" | "expired";
  url: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkoutError(
  error: unknown,
): CheckoutHttpError {
  if (error instanceof CheckoutHttpError) return error;
  return new CheckoutHttpError(500, "INTERNAL_ERROR");
}

export function checkoutErrorResponse(
  error: unknown,
  headers: Headers,
): Response {
  const safe = checkoutError(error);
  return jsonResponse({ error: { code: safe.code } }, safe.status, headers);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
}

export async function hashConfirmationBearer(
  confirmationToken: string,
): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(confirmationToken)) {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }

  const standard = confirmationToken.replaceAll("-", "+").replaceAll(
    "_",
    "/",
  ) + "=";
  let binary: string;
  try {
    binary = atob(standard);
  } catch {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== 32 || encodeBase64Url(bytes) !== confirmationToken) {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }
  return hex(await sha256(bytes));
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  if (request.method !== "POST") {
    throw new CheckoutHttpError(405, "METHOD_NOT_ALLOWED");
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    contentType !== "application/json" ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_REQUEST_BYTES
  ) {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }

  const raw = await request.text();
  if (
    raw.length === 0 || new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES
  ) {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index]);
}

function parseCreateInput(value: Record<string, unknown>): CreateCheckoutInput {
  if (
    !exactKeys(value, [
      "eventId",
      "buyerName",
      "buyerEmail",
      "clientRequestId",
      "items",
    ]) ||
    typeof value.eventId !== "string" ||
    typeof value.buyerName !== "string" ||
    typeof value.buyerEmail !== "string" ||
    typeof value.clientRequestId !== "string" ||
    !Array.isArray(value.items) || value.items.length < 1 ||
    value.items.length > 10
  ) {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }

  const eventId = value.eventId.toLowerCase();
  const clientRequestId = value.clientRequestId.toLowerCase();
  const buyerName = value.buyerName.trim();
  const buyerEmail = value.buyerEmail.trim().toLowerCase();
  if (
    !UUID_PATTERN.test(eventId) || !UUID_V4_PATTERN.test(clientRequestId) ||
    buyerName.length < 1 || buyerName.length > 120 ||
    buyerEmail.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)
  ) {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }

  let aggregateQuantity = 0;
  const seenTierIds = new Set<string>();
  const items = value.items.map((item): CheckoutItemInput => {
    const quantity = isRecord(item) ? item.quantity : undefined;
    if (
      !isRecord(item) || !exactKeys(item, ["tierId", "quantity"]) ||
      typeof item.tierId !== "string" ||
      typeof quantity !== "number" || !Number.isSafeInteger(quantity) ||
      quantity < 1 || quantity > 10
    ) {
      throw new CheckoutHttpError(400, "INVALID_REQUEST");
    }
    const tierId = item.tierId.toLowerCase();
    if (!UUID_PATTERN.test(tierId) || seenTierIds.has(tierId)) {
      throw new CheckoutHttpError(400, "INVALID_REQUEST");
    }
    seenTierIds.add(tierId);
    aggregateQuantity += quantity;
    if (aggregateQuantity > 10) {
      throw new CheckoutHttpError(400, "INVALID_REQUEST");
    }
    return { tierId, quantity };
  });
  items.sort((left, right) => left.tierId.localeCompare(right.tierId));

  return { eventId, buyerName, buyerEmail, clientRequestId, items };
}

function requireInteger(value: unknown, allowZero = false): number {
  if (
    !Number.isSafeInteger(value) ||
    (allowZero ? (value as number) < 0 : (value as number) <= 0)
  ) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  return value as number;
}

function reservationItemFromRpc(value: unknown): ReservationItemSnapshot {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "order_item_id",
      "ticket_tier_id",
      "tier_name",
      "unit_amount_minor",
      "quantity",
      "subtotal_minor",
      "currency",
    ])
  ) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  const unitAmountMinor = requireInteger(value.unit_amount_minor);
  const quantity = requireInteger(value.quantity);
  const subtotalMinor = requireInteger(value.subtotal_minor);
  if (
    typeof value.order_item_id !== "string" ||
    !UUID_PATTERN.test(value.order_item_id) ||
    typeof value.ticket_tier_id !== "string" ||
    !UUID_PATTERN.test(value.ticket_tier_id) ||
    typeof value.tier_name !== "string" || value.tier_name.length < 1 ||
    value.tier_name.length > 120 ||
    value.tier_name.trim() !== value.tier_name ||
    value.currency !== "usd" || quantity > 10 ||
    unitAmountMinor * quantity !== subtotalMinor ||
    !Number.isSafeInteger(unitAmountMinor * quantity)
  ) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  return {
    orderItemId: value.order_item_id,
    ticketTierId: value.ticket_tier_id,
    tierName: value.tier_name,
    unitAmountMinor,
    quantity,
    subtotalMinor,
    currency: "usd",
  };
}

function reservationFromRpc(value: unknown): ReservationSnapshot {
  if (!isRecord(value)) throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  const orderId = value.order_id;
  const organizerId = value.organizer_id;
  const quantity = requireInteger(value.quantity);
  const subtotalMinor = requireInteger(value.subtotal_minor);
  const applicationFeeAmountMinor = requireInteger(
    value.application_fee_amount_minor,
    true,
  );
  const platformProductFeeMinor = requireInteger(
    value.platform_product_fee_minor,
    true,
  );
  const stripeFeeEstimateMinor = requireInteger(
    value.stripe_fee_estimate_minor,
    true,
  );
  const expectedOrganizerProceedsMinor = requireInteger(
    value.expected_organizer_proceeds_minor,
  );
  const totalMinor = requireInteger(value.total_minor);
  const stripeAccountId = value.stripe_account_id;
  const checkoutExpiresAt = value.checkout_expires_at;
  const existingCheckoutSessionId = value.existing_checkout_session_id;
  const integrationIdentifier = value.integration_identifier;
  const createRequestDigest = value.create_request_digest;
  if (
    !Array.isArray(value.order_items) || value.order_items.length < 1 ||
    value.order_items.length > 10
  ) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  const items = value.order_items.map(reservationItemFromRpc);
  const itemIds = new Set(items.map((item) => item.orderItemId));
  const tierIds = new Set(items.map((item) => item.ticketTierId));
  const summedQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const summedSubtotal = items.reduce(
    (sum, item) => sum + item.subtotalMinor,
    0,
  );
  if (
    typeof orderId !== "string" || !UUID_PATTERN.test(orderId) ||
    typeof organizerId !== "string" || !UUID_PATTERN.test(organizerId) ||
    value.currency !== "usd" || applicationFeeAmountMinor >= subtotalMinor ||
    platformProductFeeMinor + stripeFeeEstimateMinor !==
      applicationFeeAmountMinor ||
    !Number.isSafeInteger(platformProductFeeMinor + stripeFeeEstimateMinor) ||
    expectedOrganizerProceedsMinor !==
      subtotalMinor - applicationFeeAmountMinor ||
    totalMinor !== subtotalMinor || quantity > 10 ||
    !Number.isSafeInteger(summedQuantity) || summedQuantity !== quantity ||
    !Number.isSafeInteger(summedSubtotal) || summedSubtotal !== subtotalMinor ||
    itemIds.size !== items.length || tierIds.size !== items.length ||
    items.some((item, index) =>
      index > 0 && items[index - 1].ticketTierId >= item.ticketTierId
    ) ||
    typeof stripeAccountId !== "string" ||
    !ACCOUNT_PATTERN.test(stripeAccountId) ||
    typeof checkoutExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(checkoutExpiresAt)) ||
    (existingCheckoutSessionId !== null &&
      (typeof existingCheckoutSessionId !== "string" ||
        !SESSION_PATTERN.test(existingCheckoutSessionId))) ||
    typeof integrationIdentifier !== "string" ||
    !INTEGRATION_IDENTIFIER_PATTERN.test(integrationIdentifier) ||
    typeof createRequestDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(createRequestDigest)
  ) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  return {
    orderId,
    organizerId,
    quantity,
    subtotalMinor,
    currency: "usd",
    applicationFeeAmountMinor,
    totalMinor,
    stripeAccountId,
    checkoutExpiresAt,
    existingCheckoutSessionId,
    integrationIdentifier,
    createRequestDigest,
    items,
  };
}

function validatedReservationSnapshot(value: unknown): ReservationSnapshot {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  return reservationFromRpc({
    order_id: value.orderId,
    organizer_id: value.organizerId,
    quantity: value.quantity,
    subtotal_minor: value.subtotalMinor,
    currency: value.currency,
    application_fee_amount_minor: value.applicationFeeAmountMinor,
    platform_product_fee_minor: value.applicationFeeAmountMinor,
    stripe_fee_estimate_minor: 0,
    expected_organizer_proceeds_minor: (value.subtotalMinor as number) -
      (value.applicationFeeAmountMinor as number),
    total_minor: value.totalMinor,
    stripe_account_id: value.stripeAccountId,
    checkout_expires_at: value.checkoutExpiresAt,
    existing_checkout_session_id: value.existingCheckoutSessionId,
    integration_identifier: value.integrationIdentifier,
    create_request_digest: value.createRequestDigest,
    order_items: value.items.map((item) => {
      if (!isRecord(item)) {
        throw new CheckoutHttpError(500, "INTERNAL_ERROR");
      }
      return {
        order_item_id: item.orderItemId,
        ticket_tier_id: item.ticketTierId,
        tier_name: item.tierName,
        unit_amount_minor: item.unitAmountMinor,
        quantity: item.quantity,
        subtotal_minor: item.subtotalMinor,
        currency: item.currency,
      };
    }),
  });
}

function rpcFailure(error: { message?: string } | null): never {
  const code = error?.message;
  if (code === "CHECKOUT_INPUT_INVALID") {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }
  if (code === "TIER_SOLD_OUT") {
    throw new CheckoutHttpError(409, "TIER_SOLD_OUT");
  }
  if (code === "CHECKOUT_EXPIRED") {
    throw new CheckoutHttpError(410, "CHECKOUT_EXPIRED");
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    throw new CheckoutHttpError(409, "IDEMPOTENCY_CONFLICT");
  }
  if (code === "CHECKOUT_DISABLED") {
    throw new CheckoutHttpError(503, "CHECKOUT_DISABLED");
  }
  if (code === "CONNECT_NOT_READY") {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
  if (code === "CONNECT_ACTION_REQUIRED") {
    throw new CheckoutHttpError(409, "CONNECT_ACTION_REQUIRED");
  }
  if (code === "EVENT_NOT_SELLABLE" || code === "EVENT_NOT_FOUND") {
    throw new CheckoutHttpError(409, "EVENT_NOT_SELLABLE");
  }
  if (code === "TIER_NOT_ACTIVE") {
    throw new CheckoutHttpError(409, "TIER_NOT_ACTIVE");
  }
  if (code === "TIER_NOT_FOUND") {
    throw new CheckoutHttpError(409, "TIER_NOT_FOUND");
  }
  if (code === "CHECKOUT_ALREADY_EXISTS") {
    throw new CheckoutHttpError(409, "CHECKOUT_ALREADY_EXISTS");
  }
  if (
    code === "FEE_RULE_NOT_CONFIGURED" ||
    code === "CHECKOUT_CREATION_FAILED" || code === "ORDER_REQUIRES_REVIEW"
  ) {
    throw new CheckoutHttpError(503, "CHECKOUT_UNAVAILABLE");
  }
  throw new CheckoutHttpError(500, "INTERNAL_ERROR");
}

function expectedMetadata(expected: ExpectedSession): Record<string, string> {
  return {
    contract_version: "checkout_integrity_v1",
    event_id: expected.input.eventId,
    order_id: expected.reservation.orderId,
  };
}

function isExactMetadata(
  value: unknown,
  expected: Record<string, string>,
): boolean {
  if (!isRecord(value) || !exactKeys(value, Object.keys(expected))) {
    return false;
  }
  return Object.entries(expected).every(([key, expectedValue]) =>
    value[key] === expectedValue
  );
}

function validStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.hostname === "checkout.stripe.com";
  } catch {
    return false;
  }
}

function validatePaymentIntent(
  value: unknown,
  expected: ExpectedSession,
): boolean {
  // Stripe may not create the PaymentIntent until the hosted payment flow starts.
  // If it is already present, its destination and money must still match exactly.
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const transferData = value.transfer_data;
  return value.livemode === false &&
    value.currency === expected.reservation.currency &&
    value.amount === expected.reservation.totalMinor &&
    value.application_fee_amount ===
      expected.reservation.applicationFeeAmountMinor &&
    isRecord(transferData) &&
    transferData.destination === expected.reservation.stripeAccountId &&
    isExactMetadata(value.metadata, expectedMetadata(expected));
}

function validateBoundLineItems(
  lineItems: Record<string, unknown>,
  expected: ExpectedSession,
): boolean {
  if (!Array.isArray(lineItems.data) || lineItems.has_more !== false) {
    return false;
  }
  const expectedByOrderItemId = new Map(
    expected.reservation.items.map((item) => [item.orderItemId, item]),
  );
  if (lineItems.data.length !== expectedByOrderItemId.size) return false;
  const seen = new Set<string>();
  for (const value of lineItems.data) {
    if (!isRecord(value) || !isRecord(value.price)) return false;
    const price = value.price;
    if (!isRecord(price.product) || !isRecord(price.product.metadata)) {
      return false;
    }
    const productMetadata = price.product.metadata;
    if (!exactKeys(productMetadata, ["whereto_order_item_id"])) return false;
    const orderItemId = productMetadata.whereto_order_item_id;
    if (typeof orderItemId !== "string" || seen.has(orderItemId)) return false;
    const item = expectedByOrderItemId.get(orderItemId);
    if (item === undefined) return false;
    seen.add(orderItemId);
    if (
      price.livemode !== false || price.product.livemode !== false ||
      value.quantity !== item.quantity || value.currency !== item.currency ||
      value.amount_subtotal !== item.subtotalMinor ||
      value.amount_total !== item.subtotalMinor ||
      price.currency !== item.currency || price.type !== "one_time" ||
      price.unit_amount !== item.unitAmountMinor
    ) {
      return false;
    }
  }
  return seen.size === expectedByOrderItemId.size;
}

function validateSession(
  value: unknown,
  expected: ExpectedSession,
): ValidatedSession {
  if (!isRecord(value)) {
    throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
  }
  const lineItems = value.line_items;
  const automaticTax = value.automatic_tax;
  if (!isRecord(lineItems) || !Array.isArray(lineItems.data)) {
    throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
  }
  const expectedExpiry = expected.stripeExpiresAt;
  const metadata = expectedMetadata(expected);

  if (
    typeof value.id !== "string" || !SESSION_PATTERN.test(value.id) ||
    value.object !== "checkout.session" || value.livemode !== false ||
    value.mode !== "payment" ||
    (value.status !== "open" &&
      !TERMINAL_SESSION_STATUSES.has(String(value.status))) ||
    value.payment_status !== "unpaid" ||
    value.currency !== expected.reservation.currency ||
    value.amount_subtotal !== expected.reservation.subtotalMinor ||
    value.amount_total !== expected.reservation.totalMinor ||
    value.customer_email !== expected.input.buyerEmail ||
    value.expires_at !== expectedExpiry ||
    value.client_reference_id !== expected.reservation.orderId ||
    value.success_url !== expected.successUrl ||
    value.cancel_url !== expected.cancelUrl ||
    typeof value.integration_identifier !== "string" ||
    value.integration_identifier !==
      expected.reservation.integrationIdentifier ||
    !isExactMetadata(value.metadata, metadata) ||
    !isRecord(automaticTax) || automaticTax.enabled !== false ||
    !validStripeCheckoutUrl(value.url) ||
    !validateBoundLineItems(lineItems, expected) ||
    !validatePaymentIntent(value.payment_intent, expected)
  ) {
    throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
  }

  return {
    id: value.id,
    expiresAt: expectedExpiry,
    status: value.status as ValidatedSession["status"],
    url: value.url,
  };
}

function createParams(
  expected: ExpectedSession,
): Stripe.Checkout.SessionCreateParams {
  const metadata = expectedMetadata(expected);
  return {
    mode: "payment",
    customer_email: expected.input.buyerEmail,
    expires_at: expected.stripeExpiresAt,
    success_url: expected.successUrl,
    cancel_url: expected.cancelUrl,
    client_reference_id: expected.reservation.orderId,
    integration_identifier: expected.reservation.integrationIdentifier,
    metadata,
    payment_intent_data: {
      application_fee_amount: expected.reservation.applicationFeeAmountMinor,
      transfer_data: { destination: expected.reservation.stripeAccountId },
      metadata,
    },
    line_items: expected.reservation.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: item.currency,
        unit_amount: item.unitAmountMinor,
        product_data: {
          name: item.tierName,
          metadata: { whereto_order_item_id: item.orderItemId },
        },
      },
    })),
    expand: ["line_items.data.price.product", "payment_intent"],
  };
}

export async function defaultAnonymousRateLimit(
  request: Request,
  client = getServiceClient(),
): Promise<RateLimitResult> {
  const rawIdentity = request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ??
    "unknown";
  const identity = hex(await sha256(new TextEncoder().encode(rawIdentity)));
  const { data, error } = await client.rpc(
    "server_consume_checkout_rate_limit",
    { p_identity_hash: identity },
  );
  if (
    error !== null || !Array.isArray(data) || data.length !== 1 ||
    !isRecord(data[0]) || typeof data[0].allowed !== "boolean" ||
    !Number.isInteger(data[0].retry_after_seconds)
  ) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  return data[0].allowed ? { allowed: true } : {
    allowed: false,
    retryAfterSeconds: Math.max(1, data[0].retry_after_seconds as number),
  };
}

export async function defaultRefreshConnect(
  eventId: string,
  tierIds: string[],
  client = getServiceClient(),
  runtime?: {
    repository: Pick<
      AccountRepository,
      "findAccount" | "beginRefresh" | "persistStatus"
    >;
    retrieveAccount(
      accountId: string,
      params: Stripe.V2.Core.AccountRetrieveParams,
    ): Promise<Stripe.V2.Core.Account>;
  },
): Promise<void> {
  const { data, error } = await client.rpc("server_get_checkout_preflight", {
    p_event_id: eventId,
    p_tier_ids: tierIds,
  });
  if (error !== null) rpcFailure(error);
  if (
    !Array.isArray(data) || data.length !== 1 || !isRecord(data[0]) ||
    typeof data[0].organizer_id !== "string" ||
    !UUID_PATTERN.test(data[0].organizer_id) ||
    typeof data[0].stripe_account_id !== "string" ||
    !ACCOUNT_PATTERN.test(data[0].stripe_account_id)
  ) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  const organizerId = data[0].organizer_id;
  const repository = runtime?.repository ?? createAccountRepository();
  const accountId = await repository.findAccount(organizerId);
  if (accountId === null) {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
  const refreshSequence = await repository.beginRefresh(accountId);
  let account: Stripe.V2.Core.Account;
  try {
    account = await (runtime?.retrieveAccount(accountId, {
      include: ACCOUNT_INCLUDE,
    }) ?? getStripe().v2.core.accounts.retrieve(accountId, {
      include: ACCOUNT_INCLUDE,
    }));
  } catch {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
  let projection;
  try {
    projection = validateApprovedConnectAccount(account);
  } catch {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
  const persistence = await repository.persistStatus(
    accountId,
    refreshSequence,
    projection,
  );
  if (persistence.outcome === "stale") {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
  const current = deriveConnectStatus(account);
  if (
    current.transfersStatus !== "active" ||
    current.payoutsStatus !== "active" ||
    current.requirementsStatus !== "clear" ||
    current.requirementsCurrentlyDueCount !== 0 ||
    current.requirementsPastDueCount !== 0
  ) {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
}

export async function defaultReserveCheckout(
  input: CreateCheckoutInput,
  tokenHash: string,
  client = getServiceClient(),
): Promise<ReservationSnapshot | null> {
  const { data, error } = await client.rpc(
    "server_reserve_checkout",
    {
      p_event_id: input.eventId,
      p_items: input.items.map((item) => ({
        tier_id: item.tierId,
        quantity: item.quantity,
      })),
      p_name: input.buyerName,
      p_email: input.buyerEmail,
      p_client_request_id: input.clientRequestId,
      p_confirmation_token_hash: tokenHash,
    },
  );
  if (error !== null) rpcFailure(error);
  if (!Array.isArray(data)) throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  if (data.length === 0) return null;
  if (data.length !== 1) throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  return reservationFromRpc(data[0]);
}

async function defaultAttachSession(
  orderId: string,
  sessionId: string,
  expiresAt: string,
): Promise<void> {
  const { data, error } = await getServiceClient().rpc(
    "server_attach_checkout_session",
    { p_order_id: orderId, p_session_id: sessionId, p_expires_at: expiresAt },
  );
  if (error !== null || data !== orderId) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
}

export async function defaultReleaseReservation(
  orderId: string,
  reason: string,
): Promise<void> {
  const { data, error } = await getServiceClient().rpc(
    "server_cancel_checkout_reservation",
    { p_order_id: orderId, p_reason: reason },
  );
  if (error !== null || data !== orderId) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
}

function defaultDependencies(): StripeCreateCheckoutDependencies {
  const stripe = getStripe();
  const appBaseUrl = getAppBaseUrl();
  return {
    appOrigin: appBaseUrl,
    appBaseUrl,
    rateLimit: defaultAnonymousRateLimit,
    refreshConnect: defaultRefreshConnect,
    reserveCheckout: defaultReserveCheckout,
    createSession: (params, options) =>
      stripe.checkout.sessions.create(params, options),
    retrieveSession: (sessionId, params) =>
      stripe.checkout.sessions.retrieve(sessionId, params),
    expireSession: (sessionId) => stripe.checkout.sessions.expire(sessionId),
    attachSession: defaultAttachSession,
    releaseReservation: defaultReleaseReservation,
    nowEpochSeconds: () => Math.floor(Date.now() / 1_000),
  };
}

async function canonicalRequestDigest(
  reservation: ReservationSnapshot,
  input: CreateCheckoutInput,
  tokenHash: string,
): Promise<string> {
  const epoch = Date.parse(reservation.checkoutExpiresAt) / 1_000;
  if (!Number.isSafeInteger(epoch)) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  const orderItemsJsonb = `[${
    reservation.items.map((item) =>
      `{"currency": ${
        JSON.stringify(item.currency)
      }, "quantity": ${item.quantity}, "tier_name": ${
        JSON.stringify(item.tierName)
      }, "order_item_id": ${
        JSON.stringify(item.orderItemId)
      }, "subtotal_minor": ${item.subtotalMinor}, "ticket_tier_id": ${
        JSON.stringify(item.ticketTierId)
      }, "unit_amount_minor": ${item.unitAmountMinor}}`
    ).join(", ")
  }]`;
  const canonical = [
    "whereto-checkout-cart-v1",
    reservation.orderId,
    input.eventId,
    input.clientRequestId,
    tokenHash,
    input.buyerEmail,
    reservation.currency,
    String(reservation.subtotalMinor),
    String(reservation.applicationFeeAmountMinor),
    reservation.stripeAccountId,
    String(epoch),
    reservation.integrationIdentifier,
    orderItemsJsonb,
  ].join(String.fromCharCode(31));
  return hex(await sha256(new TextEncoder().encode(canonical)));
}

function isDefinitiveStripeNonCreation(error: unknown): boolean {
  return isRecord(error) &&
    (error.type === "StripeInvalidRequestError" ||
      error.rawType === "invalid_request_error");
}

function providerResultForStripeFailure(
  error: unknown,
): CheckoutCreateProviderResult {
  if (!isRecord(error) || typeof error.type !== "string") {
    return "runtime_failure";
  }
  if (
    error.type === "StripeConnectionError" ||
    error.type === "StripeConnectionClosedError"
  ) return "network_failure";
  if (
    [
      "StripeAPIError",
      "StripeAuthenticationError",
      "StripeCardError",
      "StripeIdempotencyError",
      "StripeInvalidGrantError",
      "StripeInvalidRequestError",
      "StripePermissionError",
      "StripeRateLimitError",
    ].includes(error.type)
  ) return "provider_error_response";
  return "runtime_failure";
}

async function releaseAfterFailure(
  dependencies: StripeCreateCheckoutDependencies,
  reservation: ReservationSnapshot,
  origin: FailureReleaseOrigin,
  sessionValue?: unknown,
): Promise<boolean> {
  if (sessionValue === undefined) {
    if (origin !== "definitive-create-noncreation") return false;
    await dependencies.releaseReservation(
      reservation.orderId,
      "CHECKOUT_CREATION_FAILED",
    );
    return true;
  }
  if (
    !isRecord(sessionValue) || sessionValue.object !== "checkout.session" ||
    sessionValue.livemode !== false || typeof sessionValue.id !== "string" ||
    !SESSION_PATTERN.test(sessionValue.id) ||
    (reservation.existingCheckoutSessionId !== null &&
      sessionValue.id !== reservation.existingCheckoutSessionId)
  ) {
    return false;
  }
  if (sessionValue.status === "complete") {
    // Completion truth belongs to the webhook. A retry must not downgrade the
    // still-open database order during the interval before fulfillment lands.
    return false;
  }
  if (sessionValue.status === "open") {
    let expired: unknown;
    try {
      expired = await dependencies.expireSession(sessionValue.id);
    } catch {
      return false;
    }
    if (
      !isRecord(expired) || expired.object !== "checkout.session" ||
      expired.livemode !== false || expired.id !== sessionValue.id ||
      expired.status !== "expired"
    ) {
      return false;
    }
  } else if (sessionValue.status !== "expired") {
    return false;
  }
  await dependencies.releaseReservation(
    reservation.orderId,
    "CHECKOUT_CREATION_FAILED",
  );
  return true;
}

function operationalSessionId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" &&
      SESSION_PATTERN.test(value.id)
    ? value.id
    : undefined;
}

export function createStripeCreateCheckoutHandler(
  dependencies: StripeCreateCheckoutDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const preflight = handleCorsPreflight(request, dependencies.appOrigin);
    if (preflight !== null) return preflight;
    const headers = getCorsHeaders(request, dependencies.appOrigin);
    let reservation: ReservationSnapshot | undefined;
    let sessionValue: unknown;
    let failureReleaseOrigin: FailureReleaseOrigin | undefined;
    let eventId: string | undefined;
    let stripeCreateOutcomeUnknown = false;
    let failureStage: CheckoutCreateFailureStage = "request_validation";
    let providerResult: CheckoutCreateProviderResult = "not_attempted";
    try {
      if (!headers.has("access-control-allow-origin")) {
        throw new CheckoutHttpError(403, "CORS_ORIGIN_DENIED");
      }
      const rate = await dependencies.rateLimit(request);
      if (!rate.allowed) {
        headers.set("retry-after", String(rate.retryAfterSeconds ?? 60));
        throw new CheckoutHttpError(429, "RATE_LIMITED");
      }
      const input = parseCreateInput(await readJsonObject(request));
      const confirmationBearer = request.headers.get(
        "X-Whereto-Confirmation-Bearer",
      );
      if (confirmationBearer === null) {
        throw new CheckoutHttpError(400, "INVALID_REQUEST");
      }
      const confirmationTokenHash = await hashConfirmationBearer(
        confirmationBearer,
      );
      failureStage = "connect_validation";
      try {
        await dependencies.refreshConnect(
          input.eventId,
          input.items.map((item) => item.tierId),
        );
      } catch (error) {
        if (error instanceof CheckoutHttpError) throw error;
        throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
      }
      failureStage = "reservation";
      try {
        const reserved = await dependencies.reserveCheckout(
          input,
          confirmationTokenHash,
        );
        reservation = reserved === null
          ? undefined
          : validatedReservationSnapshot(reserved);
      } catch (error) {
        if (error instanceof CheckoutHttpError) throw error;
        if (error instanceof Error) rpcFailure({ message: error.message });
        throw error;
      }
      if (reservation === undefined) {
        throw new CheckoutHttpError(410, "CHECKOUT_EXPIRED");
      }
      eventId = input.eventId;

      failureStage = "request_integrity";
      if (
        await canonicalRequestDigest(
          reservation,
          input,
          confirmationTokenHash,
        ) !== reservation.createRequestDigest
      ) {
        throw new CheckoutHttpError(500, "INTERNAL_ERROR");
      }

      const expected: ExpectedSession = {
        reservation,
        input,
        successUrl: `${dependencies.appBaseUrl}/orders/${confirmationBearer}`,
        cancelUrl:
          `${dependencies.appBaseUrl}/events/${input.eventId}/checkout?cancel=${confirmationBearer}`,
        stripeExpiresAt: Date.parse(reservation.checkoutExpiresAt) / 1_000,
      };
      let validated: ValidatedSession;
      if (reservation.existingCheckoutSessionId !== null) {
        failureStage = "stripe_session_retrieval";
        try {
          sessionValue = await dependencies.retrieveSession(
            reservation.existingCheckoutSessionId,
            {
              expand: [
                "line_items.data.price.product",
                "payment_intent",
              ],
            },
          );
          providerResult = "session_returned";
        } catch (error) {
          providerResult = providerResultForStripeFailure(error);
          throw new CheckoutHttpError(502, "STRIPE_REQUEST_FAILED");
        }
        failureStage = "stripe_session_response";
        try {
          validated = validateSession(sessionValue, expected);
          if (
            validated.id !== reservation.existingCheckoutSessionId ||
            validated.status !== "open"
          ) {
            throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
          }
        } catch (error) {
          failureReleaseOrigin = "attached-session";
          throw error;
        }
        emitOperationalEvent({
          contractVersion: "checkout_integrity_v1",
          operation: "checkout.create",
          outcome: "reused",
          orderId: reservation.orderId,
          eventId: input.eventId,
          providerObjectId: validated.id,
          itemCount: reservation.items.length,
          aggregateQuantity: reservation.quantity,
          currency: reservation.currency,
          subtotalMinor: reservation.subtotalMinor,
          totalMinor: reservation.totalMinor,
          applicationFeeAmountMinor: reservation.applicationFeeAmountMinor,
          priorStatus: "checkout_open",
          resultStatus: "checkout_open",
        }, dependencies.operationalSink);
        return jsonResponse({ checkoutUrl: validated.url }, 200, headers);
      }

      if (
        expected.stripeExpiresAt - dependencies.nowEpochSeconds() <
          STRIPE_MINIMUM_CHECKOUT_LIFETIME_SECONDS +
            STRIPE_REQUEST_ATTEMPT_ENVELOPE_SECONDS
      ) {
        throw new CheckoutHttpError(410, "CHECKOUT_EXPIRED");
      }

      const params = createParams(expected);
      failureStage = "stripe_session_creation";
      try {
        sessionValue = await dependencies.createSession(params, {
          idempotencyKey:
            `whereto-checkout-integrity-v1:${reservation.orderId}`,
        });
        providerResult = "session_returned";
      } catch (error) {
        providerResult = providerResultForStripeFailure(error);
        if (isDefinitiveStripeNonCreation(error)) {
          failureReleaseOrigin = "definitive-create-noncreation";
        } else {
          stripeCreateOutcomeUnknown = true;
        }
        throw new CheckoutHttpError(502, "STRIPE_REQUEST_FAILED");
      }
      failureStage = "stripe_session_response";
      try {
        validated = validateSession(sessionValue, expected);
      } catch (error) {
        failureReleaseOrigin = "created-session";
        throw error;
      }
      if (validated.status !== "open") {
        failureReleaseOrigin = "created-session";
        throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
      }
      failureStage = "session_attachment";
      try {
        await dependencies.attachSession(
          reservation.orderId,
          validated.id,
          new Date(validated.expiresAt * 1_000).toISOString(),
        );
      } catch (error) {
        failureReleaseOrigin = "created-session";
        throw error;
      }
      emitOperationalEvent({
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "created",
        orderId: reservation.orderId,
        eventId: input.eventId,
        providerObjectId: validated.id,
        itemCount: reservation.items.length,
        aggregateQuantity: reservation.quantity,
        currency: reservation.currency,
        subtotalMinor: reservation.subtotalMinor,
        totalMinor: reservation.totalMinor,
        applicationFeeAmountMinor: reservation.applicationFeeAmountMinor,
        resultStatus: "checkout_open",
      }, dependencies.operationalSink);
      return jsonResponse({ checkoutUrl: validated.url }, 200, headers);
    } catch (error) {
      let responseError = checkoutError(error);
      if (reservation !== undefined && failureReleaseOrigin !== undefined) {
        let cleanupComplete = false;
        try {
          cleanupComplete = await releaseAfterFailure(
            dependencies,
            reservation,
            failureReleaseOrigin,
            sessionValue,
          );
        } catch {
          responseError = new CheckoutHttpError(500, "INTERNAL_ERROR");
        }
        if (
          failureReleaseOrigin !== "definitive-create-noncreation" &&
          !cleanupComplete
        ) stripeCreateOutcomeUnknown = true;
      }
      if (stripeCreateOutcomeUnknown) {
        const uncertainErrorCode =
          responseError.code === "STRIPE_REQUEST_FAILED" ||
            responseError.code === "INVALID_STRIPE_SESSION"
            ? responseError.code
            : "INTERNAL_ERROR";
        emitOperationalEvent({
          contractVersion: "checkout_integrity_v1",
          operation: "checkout.create",
          outcome: "uncertain",
          orderId: reservation?.orderId,
          eventId,
          providerObjectId: operationalSessionId(sessionValue),
          itemCount: reservation?.items.length,
          aggregateQuantity: reservation?.quantity,
          currency: reservation?.currency,
          subtotalMinor: reservation?.subtotalMinor,
          totalMinor: reservation?.totalMinor,
          applicationFeeAmountMinor: reservation?.applicationFeeAmountMinor,
          errorCode: uncertainErrorCode,
          failureStage,
          providerResult,
        }, dependencies.operationalSink);
      } else {
        emitOperationalEvent({
          contractVersion: "checkout_integrity_v1",
          operation: "checkout.create",
          outcome: "failed",
          orderId: reservation?.orderId,
          eventId,
          providerObjectId: operationalSessionId(sessionValue),
          itemCount: reservation?.items.length,
          aggregateQuantity: reservation?.quantity,
          currency: reservation?.currency,
          subtotalMinor: reservation?.subtotalMinor,
          totalMinor: reservation?.totalMinor,
          applicationFeeAmountMinor: reservation?.applicationFeeAmountMinor,
          errorCode: responseError.code,
          failureStage,
          providerResult,
        }, dependencies.operationalSink);
      }
      return checkoutErrorResponse(responseError, headers);
    }
  };
}

export async function handler(request: Request): Promise<Response> {
  try {
    return await createStripeCreateCheckoutHandler(defaultDependencies())(
      request,
    );
  } catch {
    emitOperationalEvent({
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "failed",
      errorCode: "INTERNAL_ERROR",
      failureStage: "runtime_bootstrap",
      providerResult: "not_attempted",
    });
    return checkoutErrorResponse(
      new CheckoutHttpError(500, "INTERNAL_ERROR"),
      new Headers({ "cache-control": "no-store" }),
    );
  }
}

if (import.meta.main) Deno.serve(handler);
