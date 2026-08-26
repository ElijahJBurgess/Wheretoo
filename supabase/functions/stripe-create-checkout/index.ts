import type Stripe from "stripe";
import { deriveConnectStatus } from "../_shared/connectState.ts";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import { getStripe } from "../_shared/stripeClient.ts";
import {
  ACCOUNT_INCLUDE,
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

export type CheckoutErrorCode =
  | "CHECKOUT_ALREADY_EXISTS"
  | "CHECKOUT_EXPIRED"
  | "CHECKOUT_NOT_FOUND"
  | "CHECKOUT_UNAVAILABLE"
  | "CONNECT_ACTION_REQUIRED"
  | "CONNECT_NOT_READY"
  | "CORS_ORIGIN_DENIED"
  | "EVENT_NOT_SELLABLE"
  | "INTERNAL_ERROR"
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
  tierId: string;
  guestName: string;
  guestEmail: string;
  clientRequestId: string;
}

export interface ReservationSnapshot {
  orderId: string;
  organizerId: string;
  subtotalMinor: number;
  currency: "usd";
  applicationFeeAmountMinor: number;
  stripeAccountId: string;
  checkoutExpiresAt: string;
  existingCheckoutSessionId: string | null;
  integrationIdentifier: string;
  createRequestDigest: string;
}

export interface StripeCreateCheckoutDependencies {
  appOrigin: string;
  appBaseUrl: string;
  rateLimit(request: Request): Promise<RateLimitResult>;
  refreshConnect(eventId: string, tierId: string): Promise<void>;
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
}

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

export async function deriveConfirmationToken(
  canonicalClientRequestId: string,
): Promise<{ clearToken: string; tokenHash: string }> {
  const clearBytes = await sha256(
    new TextEncoder().encode(canonicalClientRequestId),
  );
  return {
    clearToken: encodeBase64Url(clearBytes),
    tokenHash: hex(await sha256(clearBytes)),
  };
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
      "tierId",
      "guestName",
      "guestEmail",
      "clientRequestId",
    ]) ||
    typeof value.eventId !== "string" ||
    typeof value.tierId !== "string" ||
    typeof value.guestName !== "string" ||
    typeof value.guestEmail !== "string" ||
    typeof value.clientRequestId !== "string"
  ) {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }

  const eventId = value.eventId.toLowerCase();
  const tierId = value.tierId.toLowerCase();
  const clientRequestId = value.clientRequestId.toLowerCase();
  const guestName = value.guestName.trim();
  const guestEmail = value.guestEmail.trim().toLowerCase();
  if (
    !UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(tierId) ||
    !UUID_V4_PATTERN.test(clientRequestId) || guestName.length < 1 ||
    guestName.length > 120 || guestEmail.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)
  ) {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }

  return { eventId, tierId, guestName, guestEmail, clientRequestId };
}

function requireInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  return value as number;
}

function reservationFromRpc(value: unknown): ReservationSnapshot {
  if (!isRecord(value)) throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  const orderId = value.order_id;
  const organizerId = value.organizer_id;
  const subtotalMinor = requireInteger(value.subtotal_minor);
  const applicationFeeAmountMinor = requireInteger(
    value.application_fee_amount_minor,
  );
  const stripeAccountId = value.stripe_account_id;
  const checkoutExpiresAt = value.checkout_expires_at;
  const existingCheckoutSessionId = value.existing_checkout_session_id;
  const integrationIdentifier = value.integration_identifier;
  const createRequestDigest = value.create_request_digest;
  if (
    typeof orderId !== "string" || !UUID_PATTERN.test(orderId) ||
    typeof organizerId !== "string" || !UUID_PATTERN.test(organizerId) ||
    value.currency !== "usd" || applicationFeeAmountMinor >= subtotalMinor ||
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
    subtotalMinor,
    currency: "usd",
    applicationFeeAmountMinor,
    stripeAccountId,
    checkoutExpiresAt,
    existingCheckoutSessionId,
    integrationIdentifier,
    createRequestDigest,
  };
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
    order_id: expected.reservation.orderId,
    event_id: expected.input.eventId,
    tier_id: expected.input.tierId,
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

function validateOptionalPaymentIntent(
  value: unknown,
  expected: ExpectedSession,
): boolean {
  if (value === null || value === undefined) return true;
  if (!isRecord(value)) return false;
  const transferData = value.transfer_data;
  return value.livemode === false &&
    value.currency === expected.reservation.currency &&
    value.amount === expected.reservation.subtotalMinor &&
    value.application_fee_amount ===
      expected.reservation.applicationFeeAmountMinor &&
    isRecord(transferData) &&
    transferData.destination === expected.reservation.stripeAccountId &&
    isExactMetadata(value.metadata, expectedMetadata(expected));
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
  const items = lineItems.data;
  const item = items[0];
  const price = isRecord(item) ? item.price : null;
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
    value.amount_total !== expected.reservation.subtotalMinor ||
    value.customer_email !== expected.input.guestEmail ||
    value.expires_at !== expectedExpiry ||
    value.client_reference_id !== expected.reservation.orderId ||
    value.success_url !== expected.successUrl ||
    value.cancel_url !== expected.cancelUrl ||
    typeof value.integration_identifier !== "string" ||
    value.integration_identifier !==
      expected.reservation.integrationIdentifier ||
    !isExactMetadata(value.metadata, metadata) ||
    !isRecord(automaticTax) || automaticTax.enabled !== false ||
    !validStripeCheckoutUrl(value.url) || items.length !== 1 ||
    lineItems.has_more !== false || !isRecord(item) || item.quantity !== 1 ||
    item.currency !== expected.reservation.currency ||
    item.amount_subtotal !== expected.reservation.subtotalMinor ||
    item.amount_total !== expected.reservation.subtotalMinor ||
    !isRecord(price) || price.currency !== expected.reservation.currency ||
    price.type !== "one_time" ||
    price.unit_amount !== expected.reservation.subtotalMinor ||
    !validateOptionalPaymentIntent(value.payment_intent, expected)
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
    customer_email: expected.input.guestEmail,
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
    line_items: [{
      quantity: 1,
      price_data: {
        currency: expected.reservation.currency,
        unit_amount: expected.reservation.subtotalMinor,
        product_data: { name: "Whereto event ticket" },
      },
    }],
    expand: ["line_items"],
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
  tierId: string,
  client = getServiceClient(),
): Promise<void> {
  const { data, error } = await client.rpc("server_get_checkout_preflight", {
    p_event_id: eventId,
    p_tier_id: tierId,
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
  const repository = createAccountRepository();
  const accountId = await repository.findAccount(organizerId);
  if (accountId === null) {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
  let account: Stripe.V2.Core.Account;
  try {
    account = await getStripe().v2.core.accounts.retrieve(accountId, {
      include: ACCOUNT_INCLUDE,
    });
  } catch {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
  let projection;
  try {
    projection = validateApprovedConnectAccount(account);
  } catch {
    throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
  }
  await repository.persistStatus(
    organizerId,
    accountId,
    projection,
    new Date().toISOString(),
  );
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

async function defaultReserveCheckout(
  input: CreateCheckoutInput,
  tokenHash: string,
): Promise<ReservationSnapshot | null> {
  const { data, error } = await getServiceClient().rpc(
    "server_reserve_checkout",
    {
      p_event_id: input.eventId,
      p_tier_id: input.tierId,
      p_name: input.guestName,
      p_email: input.guestEmail,
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
  const canonical = [
    "whereto-checkout-v2",
    reservation.orderId,
    input.eventId,
    input.tierId,
    input.clientRequestId,
    tokenHash,
    input.guestEmail,
    reservation.currency,
    String(reservation.subtotalMinor),
    String(reservation.applicationFeeAmountMinor),
    reservation.stripeAccountId,
    String(epoch),
    reservation.integrationIdentifier,
  ].join(String.fromCharCode(31));
  return hex(await sha256(new TextEncoder().encode(canonical)));
}

function isDefinitiveStripeNonCreation(error: unknown): boolean {
  return isRecord(error) &&
    (error.type === "StripeInvalidRequestError" ||
      error.rawType === "invalid_request_error");
}

async function releaseAfterFailure(
  dependencies: StripeCreateCheckoutDependencies,
  reservation: ReservationSnapshot,
  sessionValue?: unknown,
): Promise<void> {
  if (sessionValue === undefined) {
    await dependencies.releaseReservation(
      reservation.orderId,
      "CHECKOUT_CREATION_FAILED",
    );
    return;
  }
  if (
    !isRecord(sessionValue) || sessionValue.object !== "checkout.session" ||
    sessionValue.livemode !== false || typeof sessionValue.id !== "string" ||
    !SESSION_PATTERN.test(sessionValue.id) ||
    (reservation.existingCheckoutSessionId !== null &&
      sessionValue.id !== reservation.existingCheckoutSessionId)
  ) {
    return;
  }
  if (sessionValue.status === "complete") {
    // Completion truth belongs to the webhook. A retry must not downgrade the
    // still-open database order during the interval before fulfillment lands.
    return;
  }
  if (sessionValue.status === "open") {
    let expired: unknown;
    try {
      expired = await dependencies.expireSession(sessionValue.id);
    } catch {
      return;
    }
    if (
      !isRecord(expired) || expired.object !== "checkout.session" ||
      expired.livemode !== false || expired.id !== sessionValue.id ||
      expired.status !== "expired"
    ) {
      return;
    }
  } else if (sessionValue.status !== "expired") {
    return;
  }
  await dependencies.releaseReservation(
    reservation.orderId,
    "CHECKOUT_CREATION_FAILED",
  );
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
    let shouldRelease = false;
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
      try {
        await dependencies.refreshConnect(input.eventId, input.tierId);
      } catch (error) {
        if (error instanceof CheckoutHttpError) throw error;
        throw new CheckoutHttpError(409, "CONNECT_NOT_READY");
      }
      const confirmation = await deriveConfirmationToken(input.clientRequestId);
      try {
        reservation = await dependencies.reserveCheckout(
          input,
          confirmation.tokenHash,
        ) ?? undefined;
      } catch (error) {
        if (error instanceof CheckoutHttpError) throw error;
        if (error instanceof Error) rpcFailure({ message: error.message });
        throw error;
      }
      if (reservation === undefined) {
        throw new CheckoutHttpError(410, "CHECKOUT_EXPIRED");
      }

      if (
        await canonicalRequestDigest(
          reservation,
          input,
          confirmation.tokenHash,
        ) !== reservation.createRequestDigest
      ) {
        throw new CheckoutHttpError(500, "INTERNAL_ERROR");
      }

      const expected: ExpectedSession = {
        reservation,
        input,
        successUrl:
          `${dependencies.appBaseUrl}/orders/${confirmation.clearToken}`,
        cancelUrl:
          `${dependencies.appBaseUrl}/events/${input.eventId}/checkout?cancel=${confirmation.clearToken}`,
        stripeExpiresAt: Date.parse(reservation.checkoutExpiresAt) / 1_000,
      };
      let validated: ValidatedSession;
      if (reservation.existingCheckoutSessionId !== null) {
        try {
          sessionValue = await dependencies.retrieveSession(
            reservation.existingCheckoutSessionId,
            { expand: ["line_items", "payment_intent"] },
          );
        } catch {
          throw new CheckoutHttpError(502, "STRIPE_REQUEST_FAILED");
        }
        try {
          validated = validateSession(sessionValue, expected);
        } catch (error) {
          shouldRelease = true;
          throw error;
        }
        return jsonResponse({ checkoutUrl: validated.url }, 200, headers);
      }

      const params = createParams(expected);
      try {
        sessionValue = await dependencies.createSession(params, {
          idempotencyKey: `whereto-checkout-v1:${reservation.orderId}`,
        });
      } catch (error) {
        shouldRelease = isDefinitiveStripeNonCreation(error);
        throw new CheckoutHttpError(502, "STRIPE_REQUEST_FAILED");
      }
      try {
        validated = validateSession(sessionValue, expected);
      } catch (error) {
        shouldRelease = true;
        throw error;
      }
      if (validated.status !== "open") {
        shouldRelease = true;
        throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
      }
      try {
        await dependencies.attachSession(
          reservation.orderId,
          validated.id,
          new Date(validated.expiresAt * 1_000).toISOString(),
        );
      } catch (error) {
        shouldRelease = true;
        throw error;
      }
      return jsonResponse({ checkoutUrl: validated.url }, 200, headers);
    } catch (error) {
      if (reservation !== undefined && shouldRelease) {
        try {
          await releaseAfterFailure(dependencies, reservation, sessionValue);
        } catch {
          return checkoutErrorResponse(
            new CheckoutHttpError(500, "INTERNAL_ERROR"),
            headers,
          );
        }
      }
      return checkoutErrorResponse(error, headers);
    }
  };
}

export function handler(request: Request): Promise<Response> {
  return createStripeCreateCheckoutHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
