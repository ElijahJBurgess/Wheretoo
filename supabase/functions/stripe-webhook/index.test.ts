// deno-lint-ignore-file require-await
import { assertEquals, assertRejects } from "@std/assert";
import Stripe from "stripe";
import {
  createStripeWebhookHandler,
  type ReceiptInput,
  type StripeWebhookDependencies,
  verifyStripeSignature,
  verifyStripeSignatureAgainstSecrets,
} from "./index.ts";
import {
  ACCOUNT_ID,
  accountFixture,
  APPLICATION_FEE_ID,
  BALANCE_TRANSACTION_ID,
  CHARGE_ID,
  chargeFixture,
  checkoutSessionFixture,
  CUSTOMER_ID,
  DISPUTE_ID,
  disputeFixture,
  NOW_EPOCH_SECONDS,
  NOW_ISO,
  ORDER_ID,
  PAYMENT_INTENT_ID,
  paymentIntentFixture,
  REFUND_ID,
  refundFixture,
  SESSION_ID,
  snapshotEvent,
  thinAccountEvent,
  TRANSFER_ID,
  WEBHOOK_SECRET,
} from "./webhookFixtures.ts";

function dependencies(
  overrides: Partial<StripeWebhookDependencies> = {},
): StripeWebhookDependencies {
  return {
    verifyEvent: async (raw) => JSON.parse(raw),
    recordReceipt: async () => ({ shouldProcess: true }),
    finalizeReceipt: async () => undefined,
    getOrderSnapshot: async () => ({
      orderId: ORDER_ID,
      eventId: "22222222-3333-4444-8555-666666666666",
      tierId: "33333333-4444-4555-8666-777777777777",
      currency: "usd",
      subtotalMinor: 2_000,
      totalMinor: 2_000,
      applicationFeeAmountMinor: 150,
      destinationAccountId: ACCOUNT_ID,
    }),
    retrieveSession: async () => checkoutSessionFixture(),
    retrievePaymentIntent: async () => paymentIntentFixture(),
    retrieveCharge: async () => chargeFixture(),
    retrieveRefund: async () => refundFixture(),
    retrieveDispute: async () => disputeFixture(),
    retrieveAccount: async () => accountFixture(),
    persistAccountStatus: async () => true,
    fulfillPaidOrder: async () => undefined,
    markPaymentProcessing: async () => undefined,
    markPaymentFailed: async () => undefined,
    applyRefund: async () => undefined,
    applyDispute: async () => undefined,
    now: () => NOW_ISO,
    ...overrides,
  };
}

function request(
  event: Record<string, unknown>,
  signature = "signed",
): Request {
  return new Request("https://functions.example/stripe-webhook", {
    method: "POST",
    headers: {
      "stripe-signature": signature,
      "content-type": "application/json",
    },
    body: JSON.stringify(event),
  });
}

Deno.test("official Stripe verification accepts an unmodified signed body and rejects tampering or an expired timestamp", async () => {
  const stripe = new Stripe(["rk", "test", "task14fixture"].join("_"), {
    apiVersion: "2026-07-29.dahlia",
  });
  const raw = JSON.stringify(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID, object: "checkout.session" },
  ));
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload: raw,
    secret: WEBHOOK_SECRET,
    timestamp: NOW_EPOCH_SECONDS,
  });

  await verifyStripeSignature(
    stripe,
    raw,
    signature,
    WEBHOOK_SECRET,
    NOW_EPOCH_SECONDS,
  );
  await assertRejects(() =>
    verifyStripeSignature(
      stripe,
      `${raw} `,
      signature,
      WEBHOOK_SECRET,
      NOW_EPOCH_SECONDS,
    )
  );
  await assertRejects(() =>
    verifyStripeSignature(
      stripe,
      raw,
      signature,
      WEBHOOK_SECRET,
      NOW_EPOCH_SECONDS + 301,
    )
  );
});

Deno.test("official Stripe verification accepts the separately managed thin-event destination secret", async () => {
  const stripe = new Stripe(["rk", "test", "task14fixture"].join("_"), {
    apiVersion: "2026-07-29.dahlia",
  });
  const raw = JSON.stringify(thinAccountEvent());
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload: raw,
    secret: WEBHOOK_SECRET,
    timestamp: NOW_EPOCH_SECONDS,
  });

  await verifyStripeSignatureAgainstSecrets(
    stripe,
    raw,
    signature,
    [["whsec", "wrongdestination"].join("_"), WEBHOOK_SECRET],
    NOW_EPOCH_SECONDS,
  );
  await assertRejects(() =>
    verifyStripeSignatureAgainstSecrets(
      stripe,
      raw,
      signature,
      [["whsec", "wrongdestination"].join("_")],
      NOW_EPOCH_SECONDS,
    )
  );
});

Deno.test("missing or invalid signatures return 400 before any receipt or domain write", async () => {
  let writes = 0;
  const handler = createStripeWebhookHandler(dependencies({
    verifyEvent: async () => {
      throw new Error("invalid signature");
    },
    recordReceipt: async () => {
      writes += 1;
      return { shouldProcess: true };
    },
  }));
  const event = snapshotEvent("checkout.session.completed", { id: SESSION_ID });

  const missing = await handler(request(event, ""));
  const invalid = await handler(request(event, "invalid"));

  assertEquals([missing.status, invalid.status, writes], [400, 400, 0]);
});

Deno.test("the handler reads the request body once, then records only the event identity and digest", async () => {
  const event = snapshotEvent("unhandled.test", { id: "obj_Task14Unknown" });
  const raw = JSON.stringify(event);
  let reads = 0;
  let receipt: ReceiptInput | undefined;
  const fakeRequest = {
    method: "POST",
    headers: new Headers({ "stripe-signature": "signed" }),
    text: async () => {
      reads += 1;
      if (reads > 1) throw new Error("body consumed twice");
      return raw;
    },
  } as Request;
  const response = await createStripeWebhookHandler(dependencies({
    recordReceipt: async (value) => {
      receipt = value;
      return { shouldProcess: true };
    },
  }))(fakeRequest);

  assertEquals(response.status, 200);
  assertEquals(reads, 1);
  assertEquals(receipt?.stripeEventId, event.id);
  assertEquals(receipt?.stripeObjectId, "obj_Task14Unknown");
  assertEquals(receipt?.payloadSha256.length, 64);
  assertEquals(Object.hasOwn(receipt ?? {}, "payload"), false);
});

Deno.test("live events are rejected before a durable receipt and live retrieved objects are permanently acknowledged without mutation", async () => {
  let receipts = 0;
  let fulfilled = 0;
  const liveEvent = snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { livemode: true },
  );
  const handler = createStripeWebhookHandler(dependencies({
    recordReceipt: async () => {
      receipts += 1;
      return { shouldProcess: true };
    },
    retrieveSession: async () => checkoutSessionFixture({ livemode: true }),
    fulfillPaidOrder: async () => {
      fulfilled += 1;
    },
  }));

  assertEquals((await handler(request(liveEvent))).status, 400);
  assertEquals(receipts, 0);
  assertEquals(
    (await handler(request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
    )))).status,
    200,
  );
  assertEquals([receipts, fulfilled], [1, 0]);
});

Deno.test("a processed duplicate is acknowledged without retrieval or another domain transition", async () => {
  let retrieved = 0;
  const response = await createStripeWebhookHandler(dependencies({
    recordReceipt: async () => ({ shouldProcess: false }),
    retrieveSession: async () => {
      retrieved += 1;
      return checkoutSessionFixture();
    },
  }))(request(snapshotEvent("checkout.session.completed", { id: SESSION_ID })));

  assertEquals([response.status, retrieved], [200, 0]);
});

Deno.test("paid completion re-retrieves current Session truth and fulfills one exact historical order snapshot", async () => {
  const calls: string[] = [];
  let fulfillment: unknown;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveSession: async (id, params) => {
      calls.push("retrieve");
      assertEquals(id, SESSION_ID);
      assertEquals(params, {
        expand: ["line_items", "payment_intent.latest_charge"],
      });
      return checkoutSessionFixture();
    },
    fulfillPaidOrder: async (snapshot) => {
      calls.push("fulfill");
      fulfillment = snapshot;
    },
  }))(request(snapshotEvent("checkout.session.completed", { id: SESSION_ID })));

  assertEquals(response.status, 200);
  assertEquals(calls, ["retrieve", "fulfill"]);
  assertEquals(fulfillment, {
    stripeEventId: "evt_checkoutsessioncompletedTask14",
    orderId: ORDER_ID,
    checkoutSessionId: SESSION_ID,
    paymentIntentId: PAYMENT_INTENT_ID,
    chargeId: CHARGE_ID,
    transferId: TRANSFER_ID,
    applicationFeeId: APPLICATION_FEE_ID,
    balanceTransactionId: BALANCE_TRANSACTION_ID,
    customerId: CUSTOMER_ID,
    mode: "payment",
    paymentStatus: "paid",
    currency: "usd",
    subtotalMinor: 2_000,
    totalMinor: 2_000,
    applicationFeeAmountMinor: 150,
    destinationAccountId: ACCOUNT_ID,
  });
});

Deno.test("unpaid completion marks processing and an out-of-order async success fulfills from current paid Session truth", async () => {
  const transitions: string[] = [];
  const handler = createStripeWebhookHandler(dependencies({
    retrieveSession: async () =>
      checkoutSessionFixture({
        payment_status: transitions.length === 0 ? "unpaid" : "paid",
        payment_intent: paymentIntentFixture({
          status: transitions.length === 0 ? "processing" : "succeeded",
        }),
      }),
    markPaymentProcessing: async () => {
      transitions.push("processing");
    },
    fulfillPaidOrder: async () => {
      transitions.push("paid");
    },
  }));

  const completed = await handler(request(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
  )));
  const succeeded = await handler(request(snapshotEvent(
    "checkout.session.async_payment_succeeded",
    { id: SESSION_ID },
    { id: "evt_Task14AsyncSuccess" },
  )));

  assertEquals([completed.status, succeeded.status], [200, 200]);
  assertEquals(transitions, ["processing", "paid"]);
});

Deno.test("async failure and expiration produce safe idempotent failed transitions", async () => {
  const failures: string[] = [];
  let retrieval = 0;
  const handler = createStripeWebhookHandler(dependencies({
    retrieveSession: async () => {
      retrieval += 1;
      return retrieval === 1
        ? checkoutSessionFixture({
          status: "complete",
          payment_status: "unpaid",
          payment_intent: paymentIntentFixture({
            status: "requires_payment_method",
            latest_charge: null,
          }),
        })
        : checkoutSessionFixture({
          status: "expired",
          payment_status: "unpaid",
          payment_intent: null,
        });
    },
    markPaymentFailed: async (snapshot) => {
      failures.push(snapshot.failureCode);
    },
  }));

  await handler(request(snapshotEvent(
    "checkout.session.async_payment_failed",
    { id: SESSION_ID },
  )));
  await handler(request(snapshotEvent(
    "checkout.session.expired",
    { id: SESSION_ID },
    { id: "evt_Task14Expired" },
  )));

  assertEquals(failures, ["ASYNC_PAYMENT_FAILED", "CHECKOUT_EXPIRED"]);
});

Deno.test("a permanent Checkout snapshot mismatch is durably acknowledged and never reaches a domain RPC", async () => {
  const finalizations: unknown[] = [];
  let fulfilled = false;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveSession: async () =>
      checkoutSessionFixture({ amount_total: 2_001 }),
    finalizeReceipt: async (...args) => {
      finalizations.push(args);
    },
    fulfillPaidOrder: async () => {
      fulfilled = true;
    },
  }))(request(snapshotEvent("checkout.session.completed", { id: SESSION_ID })));

  assertEquals(response.status, 200);
  assertEquals(fulfilled, false);
  assertEquals(finalizations, [[
    "evt_checkoutsessioncompletedTask14",
    "processed",
    "PAYMENT_SNAPSHOT_MISMATCH",
  ]]);
});

Deno.test("transient Stripe retrieval failures remain retryable and return non-2xx", async () => {
  const finalizations: unknown[] = [];
  const response = await createStripeWebhookHandler(dependencies({
    retrieveSession: async () => {
      throw new Error("network unavailable");
    },
    finalizeReceipt: async (...args) => {
      finalizations.push(args);
    },
  }))(request(snapshotEvent("checkout.session.completed", { id: SESSION_ID })));

  assertEquals(response.status, 503);
  assertEquals(finalizations, [[
    "evt_checkoutsessioncompletedTask14",
    "failed",
    "TRANSIENT_PROCESSING_FAILURE",
  ]]);
});

Deno.test("recipient-account events retrieve current Accounts v2 state and persist only the safe projection", async () => {
  let persisted: unknown;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveAccount: async (accountId, params) => {
      assertEquals(accountId, ACCOUNT_ID);
      assertEquals(params, {
        include: ["configuration.recipient", "defaults", "requirements"],
      });
      return accountFixture();
    },
    persistAccountStatus: async (accountId, projection, syncedAt) => {
      persisted = { accountId, projection, syncedAt };
      return true;
    },
  }))(request(thinAccountEvent()));

  assertEquals(response.status, 200);
  assertEquals(persisted, {
    accountId: ACCOUNT_ID,
    projection: {
      transfersStatus: "active",
      payoutsStatus: "active",
      requirementsStatus: "clear",
      requirementsCurrentlyDueCount: 0,
      requirementsPastDueCount: 0,
      lastStatusCode: null,
    },
    syncedAt: NOW_ISO,
  });
});

Deno.test("a live or malformed retrieved Accounts v2 object is permanently acknowledged without persisting status", async () => {
  const finalizations: unknown[] = [];
  let persisted = false;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveAccount: async () => accountFixture({ livemode: true }),
    persistAccountStatus: async () => {
      persisted = true;
      return true;
    },
    finalizeReceipt: async (...args) => {
      finalizations.push(args);
    },
  }))(request(thinAccountEvent()));

  assertEquals([response.status, persisted], [200, false]);
  assertEquals(finalizations, [[
    "evt_Task14Account",
    "processed",
    "INVALID_STRIPE_ACCOUNT",
  ]]);
});

Deno.test("refund reconciliation retrieves authoritative refund, charge, and PaymentIntent bindings with explicit policy", async () => {
  let applied: unknown;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveRefund: async (id) => {
      assertEquals(id, REFUND_ID);
      return refundFixture();
    },
    retrieveCharge: async (id) => {
      assertEquals(id, CHARGE_ID);
      return chargeFixture();
    },
    retrievePaymentIntent: async (id) => {
      assertEquals(id, PAYMENT_INTENT_ID);
      return paymentIntentFixture();
    },
    applyRefund: async (snapshot) => {
      applied = snapshot;
    },
  }))(request(snapshotEvent("refund.updated", { id: REFUND_ID })));

  assertEquals(response.status, 200);
  assertEquals(applied, {
    stripeEventId: "evt_refundupdatedTask14",
    orderId: ORDER_ID,
    stripeRefundId: REFUND_ID,
    paymentIntentId: PAYMENT_INTENT_ID,
    chargeId: CHARGE_ID,
    amountMinor: 2_000,
    currency: "usd",
    status: "succeeded",
    reason: "requested_by_customer",
    reverseTransfer: true,
    refundApplicationFee: false,
  });
});

Deno.test("a failed refund event reconciles the current authoritative failed refund state", async () => {
  let status: string | undefined;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveRefund: async () => refundFixture({ status: "failed" }),
    applyRefund: async (snapshot) => {
      status = snapshot.status;
    },
  }))(request(snapshotEvent(
    "refund.failed",
    { id: REFUND_ID },
    { id: "evt_Task14RefundFailed" },
  )));

  assertEquals([response.status, status], [200, "failed"]);
});

Deno.test("dispute reconciliation retrieves current authoritative binding and applies a monotonic foundation state", async () => {
  let applied: unknown;
  const response = await createStripeWebhookHandler(dependencies({
    applyDispute: async (snapshot) => {
      applied = snapshot;
    },
  }))(request(snapshotEvent("charge.dispute.updated", { id: DISPUTE_ID })));

  assertEquals(response.status, 200);
  assertEquals(applied, {
    stripeEventId: "evt_chargedisputeupdatedTask14",
    orderId: ORDER_ID,
    stripeDisputeId: DISPUTE_ID,
    chargeId: CHARGE_ID,
    status: "needs_response",
    amountMinor: 2_000,
    currency: "usd",
    recoveryStatus: "not_attempted",
  });
});

Deno.test("unknown signed event types are durably acknowledged without Stripe retrieval or domain mutation", async () => {
  const finalizations: unknown[] = [];
  let retrieved = false;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveSession: async () => {
      retrieved = true;
      return checkoutSessionFixture();
    },
    finalizeReceipt: async (...args) => {
      finalizations.push(args);
    },
  }))(request(snapshotEvent("customer.created", { id: "cus_Task14Unknown" })));

  assertEquals([response.status, retrieved], [200, false]);
  assertEquals(finalizations, [[
    "evt_customercreatedTask14",
    "processed",
    "IGNORED_EVENT_TYPE",
  ]]);
});
