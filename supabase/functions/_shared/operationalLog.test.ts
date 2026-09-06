import { assertEquals } from "@std/assert";
import {
  type CheckoutOperationalEvent,
  emitOperationalEvent,
} from "./operationalLog.ts";

const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe";
const STRIPE_EVENT_ID = "evt_Task10Delivery";
const SESSION_ID = "cs_test_Task10Checkout";
const REFUND_ID = "re_Task10Refund";

const invalidCheckoutSuccess: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "checkout.create",
  outcome: "created",
  resultStatus: "checkout_open",
  orderId: ORDER_ID,
  eventId: EVENT_ID,
  providerObjectId: SESSION_ID,
  itemCount: 1,
  aggregateQuantity: 1,
  currency: "usd",
  subtotalMinor: 100,
  totalMinor: 100,
  applicationFeeAmountMinor: 10,
  // @ts-expect-error A successful checkout must not carry a failure code.
  errorCode: "INTERNAL_ERROR",
};

const invalidTerminalCancellation: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "checkout.cancel",
  outcome: "cancelled",
  orderId: ORDER_ID,
  // @ts-expect-error A terminal order retry is not a cancellation transition.
  priorStatus: "expired",
  resultStatus: "cancelled",
};

const invalidRefundOutcome: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "refund.reconcile",
  outcome: "applied",
  orderId: ORDER_ID,
  stripeEventId: STRIPE_EVENT_ID,
  providerObjectId: REFUND_ID,
  currency: "usd",
  amountMinor: 100,
  // @ts-expect-error An applied refund cannot have a review status.
  resultStatus: "requires_review",
  ticketStatus: "refunded",
};

// @ts-expect-error INVALID_REQUEST is a definitive checkout failure, not uncertainty.
const invalidCheckoutUncertainty: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "checkout.create",
  outcome: "uncertain",
  errorCode: "INVALID_REQUEST",
  failureStage: "request_validation",
  providerResult: "not_attempted",
};

// @ts-expect-error A Stripe request failure makes cancellation state ambiguous, not blocked.
const invalidBlockedCancellation: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "checkout.cancel",
  outcome: "blocked",
  orderId: ORDER_ID,
  priorStatus: "checkout_open",
  errorCode: "STRIPE_REQUEST_FAILED",
};

// @ts-expect-error A known cancellation block is not an ambiguous provider outcome.
const invalidAmbiguousCancellation: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "checkout.cancel",
  outcome: "ambiguous",
  orderId: ORDER_ID,
  priorStatus: "checkout_open",
  errorCode: "CHECKOUT_UNAVAILABLE",
};

const invalidAppliedRefundState: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "refund.reconcile",
  outcome: "applied",
  orderId: ORDER_ID,
  stripeEventId: STRIPE_EVENT_ID,
  providerObjectId: REFUND_ID,
  currency: "usd",
  amountMinor: 100,
  resultStatus: "refunded",
  // @ts-expect-error A durably refunded order is applied only with refunded tickets.
  ticketStatus: "none",
};

const invalidAppliedPaymentProcessingTickets = {
  contractVersion: "checkout_integrity_v1",
  operation: "refund.reconcile",
  outcome: "applied",
  orderId: ORDER_ID,
  stripeEventId: STRIPE_EVENT_ID,
  providerObjectId: REFUND_ID,
  currency: "usd",
  amountMinor: 100,
  resultStatus: "payment_processing",
  ticketStatus: "valid",
} as const;
// @ts-expect-error Payment processing is coherent only before any ticket exists.
const invalidAppliedPaymentProcessingEvent: CheckoutOperationalEvent =
  invalidAppliedPaymentProcessingTickets;

const invalidReviewPaymentProcessingState = {
  contractVersion: "checkout_integrity_v1",
  operation: "refund.reconcile",
  outcome: "review",
  orderId: ORDER_ID,
  stripeEventId: STRIPE_EVENT_ID,
  providerObjectId: REFUND_ID,
  currency: "usd",
  amountMinor: 100,
  resultStatus: "payment_processing",
  ticketStatus: "none",
  errorCode: "REFUND_DURABLE_STATE_REVIEW",
} as const;
// @ts-expect-error Payment processing without tickets is coherent, not a review.
const invalidReviewPaymentProcessingEvent: CheckoutOperationalEvent =
  invalidReviewPaymentProcessingState;

const invalidAppliedPaymentProcessingError = {
  contractVersion: "checkout_integrity_v1",
  operation: "refund.reconcile",
  outcome: "applied",
  orderId: ORDER_ID,
  stripeEventId: STRIPE_EVENT_ID,
  providerObjectId: REFUND_ID,
  currency: "usd",
  amountMinor: 100,
  resultStatus: "payment_processing",
  ticketStatus: "none",
  errorCode: "REFUND_DURABLE_STATE_REVIEW",
} as const;
// @ts-expect-error An applied coherent refund state cannot carry a review reason.
const invalidAppliedPaymentProcessingErrorEvent: CheckoutOperationalEvent =
  invalidAppliedPaymentProcessingError;

// @ts-expect-error A refund held for review must include a specific safe reason.
const invalidReasonlessRefundReview: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "refund.reconcile",
  outcome: "review",
  orderId: ORDER_ID,
  stripeEventId: STRIPE_EVENT_ID,
  providerObjectId: REFUND_ID,
  currency: "usd",
  amountMinor: 100,
  resultStatus: "requires_review",
  ticketStatus: "cancelled",
};

// @ts-expect-error Webhook validation is not a checkout-create error.
const invalidCheckoutError: CheckoutOperationalEvent = {
  contractVersion: "checkout_integrity_v1",
  operation: "checkout.create",
  outcome: "failed",
  errorCode: "INVALID_WEBHOOK",
  failureStage: "request_validation",
  providerResult: "not_attempted",
};

void invalidCheckoutSuccess;
void invalidTerminalCancellation;
void invalidRefundOutcome;
void invalidCheckoutUncertainty;
void invalidBlockedCancellation;
void invalidAmbiguousCancellation;
void invalidAppliedRefundState;
void invalidAppliedPaymentProcessingTickets;
void invalidAppliedPaymentProcessingEvent;
void invalidReviewPaymentProcessingState;
void invalidReviewPaymentProcessingEvent;
void invalidAppliedPaymentProcessingError;
void invalidAppliedPaymentProcessingErrorEvent;
void invalidReasonlessRefundReview;
void invalidCheckoutError;

function capture(event: CheckoutOperationalEvent): Record<string, unknown> {
  let serialized = "";
  emitOperationalEvent(event, (value) => serialized = value);
  return JSON.parse(serialized);
}

Deno.test("operational events serialize only the bounded fields for each discriminated transition", () => {
  const cases: Array<{
    event: CheckoutOperationalEvent;
    expected: Record<string, unknown>;
  }> = [
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "created",
        eventId: EVENT_ID,
        orderId: ORDER_ID,
        providerObjectId: SESSION_ID,
        itemCount: 2,
        aggregateQuantity: 3,
        currency: "usd",
        subtotalMinor: 5_500,
        totalMinor: 5_500,
        applicationFeeAmountMinor: 450,
        resultStatus: "checkout_open",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "created",
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        providerObjectId: SESSION_ID,
        itemCount: 2,
        aggregateQuantity: 3,
        currency: "usd",
        subtotalMinor: 5_500,
        totalMinor: 5_500,
        applicationFeeAmountMinor: 450,
        resultStatus: "checkout_open",
      },
    },
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "reused",
        orderId: ORDER_ID,
        providerObjectId: SESSION_ID,
        priorStatus: "checkout_open",
        resultStatus: "checkout_open",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "reused",
        orderId: ORDER_ID,
        providerObjectId: SESSION_ID,
        priorStatus: "checkout_open",
        resultStatus: "checkout_open",
      },
    },
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "failed",
        orderId: ORDER_ID,
        errorCode: "STRIPE_REQUEST_FAILED",
        failureStage: "stripe_session_creation",
        providerResult: "provider_error_response",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "failed",
        orderId: ORDER_ID,
        errorCode: "STRIPE_REQUEST_FAILED",
        failureStage: "stripe_session_creation",
        providerResult: "provider_error_response",
      },
    },
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "webhook.delivery",
        outcome: "duplicate",
        stripeEventId: STRIPE_EVENT_ID,
        providerObjectId: SESSION_ID,
        attempt: 2,
        durationMs: 250,
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "webhook.delivery",
        outcome: "duplicate",
        stripeEventId: STRIPE_EVENT_ID,
        providerObjectId: SESSION_ID,
        attempt: 2,
        durationMs: 250,
      },
    },
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "webhook.reconciliation",
        outcome: "mismatch",
        stripeEventId: STRIPE_EVENT_ID,
        orderId: ORDER_ID,
        providerObjectId: SESSION_ID,
        errorCode: "CHECKOUT_LINE_COUNT_MISMATCH",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "webhook.reconciliation",
        outcome: "mismatch",
        orderId: ORDER_ID,
        stripeEventId: STRIPE_EVENT_ID,
        providerObjectId: SESSION_ID,
        errorCode: "CHECKOUT_LINE_COUNT_MISMATCH",
      },
    },
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.cancel",
        outcome: "ambiguous",
        orderId: ORDER_ID,
        providerObjectId: SESSION_ID,
        priorStatus: "checkout_open",
        errorCode: "STRIPE_REQUEST_FAILED",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.cancel",
        outcome: "ambiguous",
        orderId: ORDER_ID,
        providerObjectId: SESSION_ID,
        priorStatus: "checkout_open",
        errorCode: "STRIPE_REQUEST_FAILED",
      },
    },
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "refund.reconcile",
        outcome: "applied",
        stripeEventId: STRIPE_EVENT_ID,
        orderId: ORDER_ID,
        providerObjectId: REFUND_ID,
        currency: "usd",
        amountMinor: 1_000,
        resultStatus: "payment_processing",
        ticketStatus: "none",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "refund.reconcile",
        outcome: "applied",
        orderId: ORDER_ID,
        stripeEventId: STRIPE_EVENT_ID,
        providerObjectId: REFUND_ID,
        currency: "usd",
        amountMinor: 1_000,
        resultStatus: "payment_processing",
        ticketStatus: "none",
      },
    },
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "refund.reconcile",
        outcome: "review",
        stripeEventId: STRIPE_EVENT_ID,
        orderId: ORDER_ID,
        providerObjectId: REFUND_ID,
        currency: "usd",
        amountMinor: 1_000,
        resultStatus: "requires_review",
        ticketStatus: "cancelled",
        errorCode: "REFUND_POLICY_MISMATCH",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "refund.reconcile",
        outcome: "review",
        orderId: ORDER_ID,
        stripeEventId: STRIPE_EVENT_ID,
        providerObjectId: REFUND_ID,
        currency: "usd",
        amountMinor: 1_000,
        resultStatus: "requires_review",
        ticketStatus: "cancelled",
        errorCode: "REFUND_POLICY_MISMATCH",
      },
    },
    {
      event: {
        contractVersion: "checkout_integrity_v1",
        operation: "refund.reconcile",
        outcome: "review",
        stripeEventId: STRIPE_EVENT_ID,
        orderId: ORDER_ID,
        providerObjectId: REFUND_ID,
        currency: "usd",
        amountMinor: 1_000,
        resultStatus: "refunded",
        ticketStatus: "none",
        errorCode: "REFUND_DURABLE_STATE_REVIEW",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "refund.reconcile",
        outcome: "review",
        orderId: ORDER_ID,
        stripeEventId: STRIPE_EVENT_ID,
        providerObjectId: REFUND_ID,
        currency: "usd",
        amountMinor: 1_000,
        resultStatus: "refunded",
        ticketStatus: "none",
        errorCode: "REFUND_DURABLE_STATE_REVIEW",
      },
    },
  ];

  for (const testCase of cases) {
    assertEquals(capture(testCase.event), testCase.expected);
  }
});

Deno.test("checkout failure diagnostics allow only fixed stage and provider-result labels", () => {
  const records: string[] = [];
  const base = {
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "failed",
    errorCode: "INVALID_STRIPE_SESSION",
    failureStage: "stripe_session_response",
    providerResult: "session_returned",
  };

  emitOperationalEvent(base as never, (serialized) => records.push(serialized));
  emitOperationalEvent(
    { ...base, failureStage: "buyer@example.invalid" } as never,
    (serialized) => records.push(serialized),
  );
  emitOperationalEvent(
    { ...base, providerResult: "raw Stripe payload" } as never,
    (serialized) => records.push(serialized),
  );
  const bare = {
    contractVersion: base.contractVersion,
    operation: base.operation,
    outcome: base.outcome,
    errorCode: base.errorCode,
  };
  emitOperationalEvent(
    bare as never,
    (serialized) => records.push(serialized),
  );

  assertEquals(records, [JSON.stringify(base)]);
});

Deno.test("runtime rebuilding drops request, buyer, bearer, provider, payment, URL, IP, and secret-shaped extras", () => {
  const unsafe = {
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "created",
    orderId: ORDER_ID,
    resultStatus: "checkout_open",
    buyerName: "Avery Stone",
    buyerEmail: "avery@example.com",
    clientRequestId: "900a9142-9111-4f87-84d5-b8545a94c7fb",
    confirmationBearer: "fixture-bearer",
    headers: { authorization: "fixture-authorization" },
    authorization: "fixture-authorization",
    rawBody: "fixture-body",
    rawIp: "192.0.2.10",
    userAgent: "fixture-agent",
    checkoutUrl: "https://checkout.example/fixture",
    providerError: { message: "declined fixture" },
    paymentDetails: { last4: "4242" },
    secretKey: "fixture-secret",
  } as unknown as CheckoutOperationalEvent;

  assertEquals(capture(unsafe), {
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "created",
    orderId: ORDER_ID,
    resultStatus: "checkout_open",
  });
});

Deno.test("invalid bounded identifiers, enums, counters, money, duration, attempts, and error codes emit nothing", () => {
  const checkoutFailure = {
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "failed",
    errorCode: "INTERNAL_ERROR",
    failureStage: "runtime_bootstrap",
    providerResult: "not_attempted",
  };
  const invalid: unknown[] = [
    { ...checkoutFailure, orderId: "not-an-order" },
    { ...checkoutFailure, providerObjectId: "sk_fixture_secret" },
    { ...checkoutFailure, currency: "eur" },
    { ...checkoutFailure, itemCount: 11 },
    { ...checkoutFailure, aggregateQuantity: -1 },
    { ...checkoutFailure, totalMinor: Number.MAX_SAFE_INTEGER + 1 },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "refund.reconcile",
      outcome: "applied",
      orderId: ORDER_ID,
      stripeEventId: STRIPE_EVENT_ID,
      providerObjectId: REFUND_ID,
      currency: "usd",
      amountMinor: 1.5,
      resultStatus: "refunded",
      ticketStatus: "refunded",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "webhook.delivery",
      outcome: "retry",
      stripeEventId: STRIPE_EVENT_ID,
      providerObjectId: SESSION_ID,
      errorCode: "TRANSIENT_PROCESSING_FAILURE",
      durationMs: 86_400_001,
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "webhook.delivery",
      outcome: "duplicate",
      stripeEventId: STRIPE_EVENT_ID,
      providerObjectId: SESSION_ID,
      attempt: 0,
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.cancel",
      outcome: "blocked",
      orderId: ORDER_ID,
      priorStatus: "arbitrary-provider-status",
      errorCode: "CHECKOUT_UNAVAILABLE",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "created",
      resultStatus: "arbitrary-provider-status",
    },
    { ...checkoutFailure, errorCode: "card declined because fixture buyer" },
  ];
  for (const event of invalid) {
    const output: string[] = [];
    emitOperationalEvent(
      event as CheckoutOperationalEvent,
      (value) => output.push(value),
    );
    assertEquals(output, []);
  }
});

Deno.test("a failing operational sink cannot change the caller outcome", () => {
  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "failed",
    errorCode: "INTERNAL_ERROR",
    failureStage: "runtime_bootstrap",
    providerResult: "not_attempted",
  }, () => {
    throw new Error("fixture sink unavailable");
  });
});

Deno.test("a rejected async operational sink cannot change the caller outcome", async () => {
  let unhandled = false;
  const onUnhandled = (event: PromiseRejectionEvent) => {
    unhandled = true;
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);

  try {
    emitOperationalEvent({
      contractVersion: "checkout_integrity_v1",
      operation: "webhook.delivery",
      outcome: "signature_failed",
      errorCode: "INVALID_WEBHOOK",
    }, async () => {
      await Promise.resolve();
      throw new Error("fixture async sink unavailable");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(unhandled, false);
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
});

Deno.test("operational logger rejects inherited and accessor-backed contract fields", () => {
  const serialized: string[] = [];
  const sink = (value: string) => serialized.push(value);

  emitOperationalEvent(
    Object.create({
      contractVersion: "checkout_integrity_v1",
      operation: "webhook.delivery",
      outcome: "signature_failed",
      errorCode: "INVALID_WEBHOOK",
    }) as CheckoutOperationalEvent,
    sink,
  );

  emitOperationalEvent(
    Object.assign(
      Object.create({ orderId: ORDER_ID }),
      {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "failed",
        errorCode: "INTERNAL_ERROR",
        failureStage: "runtime_bootstrap",
        providerResult: "not_attempted",
      },
    ) as CheckoutOperationalEvent,
    sink,
  );

  const accessorBacked = {
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "failed",
    errorCode: "INTERNAL_ERROR",
    failureStage: "runtime_bootstrap",
    providerResult: "not_attempted",
  } as Record<string, unknown>;
  Object.defineProperty(accessorBacked, "orderId", {
    enumerable: true,
    get: () => ORDER_ID,
  });
  emitOperationalEvent(
    accessorBacked as unknown as CheckoutOperationalEvent,
    sink,
  );

  assertEquals(serialized, []);
});

Deno.test("operational logger rejects misleading discriminator combinations at runtime", () => {
  const serialized: string[] = [];
  const sink = (value: string) => serialized.push(value);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "created",
    resultStatus: "checkout_open",
    orderId: ORDER_ID,
    actualTicketCount: 1,
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "created",
    resultStatus: "checkout_open",
    orderId: ORDER_ID,
    eventId: EVENT_ID,
    providerObjectId: SESSION_ID,
    itemCount: 1,
    aggregateQuantity: 1,
    currency: "usd",
    subtotalMinor: 100,
    totalMinor: 100,
    applicationFeeAmountMinor: 10,
    errorCode: "INTERNAL_ERROR",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.cancel",
    outcome: "ambiguous",
    orderId: ORDER_ID,
    priorStatus: "checkout_open",
    errorCode: "CHECKOUT_UNAVAILABLE",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.cancel",
    outcome: "cancelled",
    orderId: ORDER_ID,
    priorStatus: "expired",
    resultStatus: "expired",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "failed",
    errorCode: "INVALID_WEBHOOK",
    failureStage: "request_validation",
    providerResult: "not_attempted",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.cancel",
    outcome: "blocked",
    orderId: ORDER_ID,
    priorStatus: "open",
    errorCode: "CHECKOUT_UNAVAILABLE",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "uncertain",
    errorCode: "INVALID_REQUEST",
    failureStage: "request_validation",
    providerResult: "not_attempted",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.cancel",
    outcome: "blocked",
    orderId: ORDER_ID,
    priorStatus: "checkout_open",
    errorCode: "STRIPE_REQUEST_FAILED",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "applied",
    orderId: ORDER_ID,
    stripeEventId: STRIPE_EVENT_ID,
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 100,
    resultStatus: "refunded",
    ticketStatus: "none",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "applied",
    orderId: ORDER_ID,
    stripeEventId: STRIPE_EVENT_ID,
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 100,
    resultStatus: "payment_processing",
    ticketStatus: "valid",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "review",
    orderId: ORDER_ID,
    stripeEventId: STRIPE_EVENT_ID,
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 100,
    resultStatus: "payment_processing",
    ticketStatus: "none",
    errorCode: "REFUND_DURABLE_STATE_REVIEW",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "applied",
    orderId: ORDER_ID,
    stripeEventId: STRIPE_EVENT_ID,
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 100,
    resultStatus: "payment_processing",
    ticketStatus: "none",
    errorCode: "REFUND_DURABLE_STATE_REVIEW",
  } as unknown as CheckoutOperationalEvent, sink);

  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "review",
    orderId: ORDER_ID,
    stripeEventId: STRIPE_EVENT_ID,
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 100,
    resultStatus: "succeeded",
    ticketStatus: "none",
    errorCode: "REFUND_DURABLE_STATE_REVIEW",
  } as unknown as CheckoutOperationalEvent, sink);

  assertEquals(serialized, []);
});

if (import.meta.main) {
  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "failed",
    errorCode: "INTERNAL_ERROR",
    failureStage: "request_validation",
    providerResult: "not_attempted",
    // @ts-expect-error buyer identity is not an operational event field.
    buyerEmail: "avery@example.com",
  });
  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "review",
    // @ts-expect-error raw provider errors are not operational event fields.
    providerError: new Error("fixture provider text"),
  });
}
