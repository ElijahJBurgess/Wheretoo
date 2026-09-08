import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import {
  type CancellationAmbiguousOperationalErrorCode,
  type CancellationBlockedOperationalErrorCode,
  emitOperationalEvent,
  type OperationalEventSink,
} from "../_shared/operationalLog.ts";
import { getStripe } from "../_shared/stripeClient.ts";
import {
  type CheckoutErrorCode,
  checkoutErrorResponse,
  CheckoutHttpError,
  defaultAnonymousRateLimit,
  defaultReleaseReservation,
  hashConfirmationBearer,
  isRecord,
  type RateLimitResult,
} from "../stripe-create-checkout/index.ts";

function cancellationAmbiguousOperationalErrorCode(
  code: CheckoutErrorCode,
): CancellationAmbiguousOperationalErrorCode {
  switch (code) {
    case "INVALID_STRIPE_SESSION":
    case "STRIPE_REQUEST_FAILED":
      return code;
    default:
      return "INTERNAL_ERROR";
  }
}

function cancellationBlockedOperationalErrorCode(
  code: CheckoutErrorCode,
): CancellationBlockedOperationalErrorCode | null {
  return code === "CHECKOUT_UNAVAILABLE" || code === "INVALID_STRIPE_SESSION"
    ? code
    : null;
}

const MAX_REQUEST_BYTES = 512;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_PATTERN = /^cs_test_[A-Za-z0-9]+$/;
const ORDER_STATUSES = new Set([
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

export type CancellationOrderStatus =
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

export interface CancellationOrder {
  orderId: string;
  status: CancellationOrderStatus;
  stripeCheckoutSessionId: string | null;
}

export interface StripeCancelCheckoutDependencies {
  appOrigin: string;
  rateLimit(request: Request): Promise<RateLimitResult>;
  findOrder(tokenHash: string): Promise<CancellationOrder | null>;
  retrieveSession(sessionId: string): Promise<unknown>;
  expireSession(sessionId: string): Promise<unknown>;
  releaseReservation(orderId: string, reason: string): Promise<void>;
  operationalSink?: OperationalEventSink;
}

interface ValidatedCancellationSession {
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid";
}

async function readConfirmationToken(request: Request): Promise<string> {
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
    if (
      !isRecord(parsed) || Object.keys(parsed).length !== 1 ||
      Object.keys(parsed)[0] !== "confirmationToken" ||
      typeof parsed.confirmationToken !== "string"
    ) {
      throw new Error("invalid body");
    }
    return parsed.confirmationToken;
  } catch {
    throw new CheckoutHttpError(400, "INVALID_REQUEST");
  }
}

function validateSession(
  value: unknown,
  expectedSessionId: string,
  expectedOrderId: string,
): ValidatedCancellationSession {
  if (!isRecord(value)) {
    throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
  }
  if (
    value.id !== expectedSessionId ||
    !SESSION_PATTERN.test(expectedSessionId) ||
    value.object !== "checkout.session" || value.livemode !== false ||
    (value.status !== "open" && value.status !== "complete" &&
      value.status !== "expired") ||
    (value.payment_status !== "paid" && value.payment_status !== "unpaid") ||
    !isRecord(value.metadata) ||
    value.metadata.order_id !== expectedOrderId
  ) {
    throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
  }
  return { status: value.status, paymentStatus: value.payment_status };
}

export async function defaultFindOrder(
  tokenHash: string,
  client = getServiceClient(),
): Promise<CancellationOrder | null> {
  const { data, error } = await client.rpc(
    "server_lookup_checkout_cancellation",
    { p_token_hash: tokenHash },
  );
  if (error !== null) throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  if (!Array.isArray(data)) throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  if (data.length === 0) return null;
  if (data.length !== 1 || !isRecord(data[0])) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  const row = data[0];
  if (
    typeof row.order_id !== "string" || !UUID_PATTERN.test(row.order_id) ||
    typeof row.status !== "string" || !ORDER_STATUSES.has(row.status) ||
    (row.stripe_checkout_session_id !== null &&
      (typeof row.stripe_checkout_session_id !== "string" ||
        !SESSION_PATTERN.test(row.stripe_checkout_session_id)))
  ) {
    throw new CheckoutHttpError(500, "INTERNAL_ERROR");
  }
  return {
    orderId: row.order_id,
    status: row.status as CancellationOrderStatus,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
  };
}

function defaultDependencies(): StripeCancelCheckoutDependencies {
  const stripe = getStripe();
  return {
    appOrigin: getAppBaseUrl(),
    rateLimit: defaultAnonymousRateLimit,
    findOrder: defaultFindOrder,
    retrieveSession: (sessionId) =>
      stripe.checkout.sessions.retrieve(sessionId),
    expireSession: (sessionId) => stripe.checkout.sessions.expire(sessionId),
    releaseReservation: defaultReleaseReservation,
  };
}

export function createStripeCancelCheckoutHandler(
  dependencies: StripeCancelCheckoutDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const preflight = handleCorsPreflight(request, dependencies.appOrigin);
    if (preflight !== null) return preflight;
    const headers = getCorsHeaders(request, dependencies.appOrigin);
    let order: CancellationOrder | null = null;
    let cancellationOutcomeAmbiguous = false;
    try {
      if (!headers.has("access-control-allow-origin")) {
        throw new CheckoutHttpError(403, "CORS_ORIGIN_DENIED");
      }
      const rate = await dependencies.rateLimit(request);
      if (!rate.allowed) {
        headers.set("retry-after", String(rate.retryAfterSeconds ?? 60));
        throw new CheckoutHttpError(429, "RATE_LIMITED");
      }
      const confirmationToken = await readConfirmationToken(request);
      const tokenHash = await hashConfirmationBearer(confirmationToken);
      order = await dependencies.findOrder(tokenHash);
      if (order === null) {
        throw new CheckoutHttpError(404, "CHECKOUT_NOT_FOUND");
      }

      const orderStatus = order.status;
      const alreadyReleased = orderStatus === "cancelled" ||
        orderStatus === "expired" || orderStatus === "payment_failed";
      if (
        orderStatus !== "creating_checkout" &&
        orderStatus !== "checkout_open" &&
        !alreadyReleased
      ) {
        throw new CheckoutHttpError(409, "CHECKOUT_UNAVAILABLE");
      }
      if (order.stripeCheckoutSessionId === null) {
        throw new CheckoutHttpError(409, "CHECKOUT_UNAVAILABLE");
      }

      let retrieved: unknown;
      try {
        retrieved = await dependencies.retrieveSession(
          order.stripeCheckoutSessionId,
        );
      } catch {
        cancellationOutcomeAmbiguous = true;
        throw new CheckoutHttpError(502, "STRIPE_REQUEST_FAILED");
      }
      let session: ValidatedCancellationSession;
      try {
        session = validateSession(
          retrieved,
          order.stripeCheckoutSessionId,
          order.orderId,
        );
      } catch (error) {
        cancellationOutcomeAmbiguous = true;
        throw error;
      }
      if (session.status === "complete") {
        // Webhook persistence may lag Checkout completion; never downgrade it here.
        throw new CheckoutHttpError(409, "CHECKOUT_UNAVAILABLE");
      }
      if (session.paymentStatus !== "unpaid") {
        throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
      }
      if (alreadyReleased) {
        // A database release alone cannot prove an attached provider checkout is terminal.
        if (session.status !== "expired") {
          throw new CheckoutHttpError(409, "CHECKOUT_UNAVAILABLE");
        }
        emitOperationalEvent({
          contractVersion: "checkout_integrity_v1",
          operation: "checkout.cancel",
          outcome: "no_transition",
          orderId: order.orderId,
          providerObjectId: order.stripeCheckoutSessionId,
          priorStatus: orderStatus,
          resultStatus: orderStatus,
        }, dependencies.operationalSink);
        return jsonResponse({ cancelled: true }, 200, headers);
      }
      if (session.status === "open") {
        let expired: unknown;
        try {
          expired = await dependencies.expireSession(
            order.stripeCheckoutSessionId,
          );
        } catch {
          cancellationOutcomeAmbiguous = true;
          throw new CheckoutHttpError(502, "STRIPE_REQUEST_FAILED");
        }
        let result: ValidatedCancellationSession;
        try {
          result = validateSession(
            expired,
            order.stripeCheckoutSessionId,
            order.orderId,
          );
        } catch (error) {
          cancellationOutcomeAmbiguous = true;
          throw error;
        }
        if (result.status !== "expired" || result.paymentStatus !== "unpaid") {
          throw new CheckoutHttpError(502, "INVALID_STRIPE_SESSION");
        }
      }
      try {
        await dependencies.releaseReservation(
          order.orderId,
          "CHECKOUT_CANCELLED",
        );
      } catch (error) {
        cancellationOutcomeAmbiguous = true;
        throw error;
      }
      emitOperationalEvent({
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.cancel",
        outcome: "cancelled",
        orderId: order.orderId,
        providerObjectId: order.stripeCheckoutSessionId,
        priorStatus: orderStatus,
        resultStatus: "cancelled",
      }, dependencies.operationalSink);
      return jsonResponse({ cancelled: true }, 200, headers);
    } catch (error) {
      const safeError = error instanceof CheckoutHttpError
        ? error
        : new CheckoutHttpError(500, "INTERNAL_ERROR");
      if (order !== null) {
        if (cancellationOutcomeAmbiguous) {
          emitOperationalEvent({
            contractVersion: "checkout_integrity_v1",
            operation: "checkout.cancel",
            outcome: "ambiguous",
            orderId: order.orderId,
            providerObjectId: order.stripeCheckoutSessionId ?? undefined,
            priorStatus: order.status,
            errorCode: cancellationAmbiguousOperationalErrorCode(
              safeError.code,
            ),
          }, dependencies.operationalSink);
        } else {
          const blockedErrorCode = cancellationBlockedOperationalErrorCode(
            safeError.code,
          );
          if (blockedErrorCode !== null) {
            emitOperationalEvent({
              contractVersion: "checkout_integrity_v1",
              operation: "checkout.cancel",
              outcome: "blocked",
              orderId: order.orderId,
              providerObjectId: order.stripeCheckoutSessionId ?? undefined,
              priorStatus: order.status,
              errorCode: blockedErrorCode,
            }, dependencies.operationalSink);
          }
        }
      }
      return checkoutErrorResponse(error, headers);
    }
  };
}

export function handler(request: Request): Promise<Response> {
  return createStripeCancelCheckoutHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
