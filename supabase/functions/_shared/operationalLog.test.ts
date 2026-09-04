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
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.create",
        outcome: "failed",
        orderId: ORDER_ID,
        errorCode: "STRIPE_REQUEST_FAILED",
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
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "webhook.delivery",
        outcome: "duplicate",
        stripeEventId: STRIPE_EVENT_ID,
        providerObjectId: SESSION_ID,
        attempt: 2,
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
        errorCode: "STRIPE_REQUEST_FAILED",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "checkout.cancel",
        outcome: "ambiguous",
        orderId: ORDER_ID,
        providerObjectId: SESSION_ID,
        errorCode: "STRIPE_REQUEST_FAILED",
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
        totalMinor: 5_500,
        errorCode: "PARTIAL_REFUND_REQUIRES_REVIEW",
      },
      expected: {
        contractVersion: "checkout_integrity_v1",
        operation: "refund.reconcile",
        outcome: "review",
        orderId: ORDER_ID,
        stripeEventId: STRIPE_EVENT_ID,
        providerObjectId: REFUND_ID,
        currency: "usd",
        totalMinor: 5_500,
        amountMinor: 1_000,
        errorCode: "PARTIAL_REFUND_REQUIRES_REVIEW",
      },
    },
  ];

  for (const testCase of cases) {
    assertEquals(capture(testCase.event), testCase.expected);
  }
});

Deno.test("runtime rebuilding drops request, buyer, bearer, provider, payment, URL, IP, and secret-shaped extras", () => {
  const unsafe = {
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "created",
    orderId: ORDER_ID,
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
  });
});

Deno.test("invalid bounded identifiers, enums, counters, money, duration, attempts, and error codes emit nothing", () => {
  const invalid: unknown[] = [
    { orderId: "not-an-order" },
    { providerObjectId: "sk_fixture_secret" },
    { currency: "eur" },
    { itemCount: 11 },
    { aggregateQuantity: -1 },
    { totalMinor: Number.MAX_SAFE_INTEGER + 1 },
    { amountMinor: 1.5 },
    { durationMs: 86_400_001 },
    { attempt: 0 },
    { priorStatus: "arbitrary-provider-status" },
    { errorCode: "card declined because fixture buyer" },
  ];
  for (const fields of invalid) {
    const output: string[] = [];
    emitOperationalEvent({
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "failed",
      ...(fields as Record<string, unknown>),
    } as CheckoutOperationalEvent, (value) => output.push(value));
    assertEquals(output, []);
  }
});

Deno.test("a failing operational sink cannot change the caller outcome", () => {
  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "failed",
    errorCode: "INTERNAL_ERROR",
  }, () => {
    throw new Error("fixture sink unavailable");
  });
});

if (import.meta.main) {
  emitOperationalEvent({
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.create",
    outcome: "failed",
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
