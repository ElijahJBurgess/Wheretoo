// deno-lint-ignore-file require-await

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import Stripe from "stripe";

import {
  createDefaultStripeWebhookDependencies,
  createStripeWebhookHandler,
  type DisputeSnapshot,
  fulfillmentApplyResultFromRpc,
  type FulfillmentSnapshot,
  type PaymentReviewSnapshot,
  type ReceiptInput,
  refundApplyResultFromRpc,
  type StripeWebhookDependencies,
  verifyStripeSignature,
  verifyStripeSignatureAgainstSecrets,
} from "./index.ts";
import {
  ACCOUNT_ID,
  accountFixture,
  APPLICATION_FEE_ID,
  applicationFeeFixture,
  BALANCE_TRANSACTION_ID,
  CHARGE_ID,
  chargeFixture,
  checkoutLineFixture,
  checkoutLineItemsFixture,
  checkoutMetadata,
  checkoutSessionFixture,
  CUSTOMER_ID,
  DISPUTE_ID,
  DISPUTE_REVERSAL_ID,
  disputeFixture,
  FEE_REFUND_ID,
  feeRefundFixture,
  GA_ORDER_ITEM_ID,
  GA_TIER_ID,
  NOW_EPOCH_SECONDS,
  ORDER_ID,
  ORDER_ITEMS,
  PAYMENT_INTENT_ID,
  paymentIntentFixture,
  REFUND_ID,
  REFUND_REVERSAL_ID,
  refundFixture,
  SESSION_ID,
  snapshotEvent,
  THIN_WEBHOOK_SECRET,
  thinAccountEvent,
  TICKET_MANIFEST,
  TRANSFER_ID,
  transferFixture,
  transferReversalFixture,
  WEBHOOK_SECRET,
} from "./webhookFixtures.ts";
import { getTicketCredentialSecret } from "../_shared/ticketCredentials.ts";

type CheckoutMismatchCode =
  | "CHECKOUT_LINE_COUNT_MISMATCH"
  | "CHECKOUT_ITEM_BINDING_MISSING"
  | "CHECKOUT_ITEM_BINDING_DUPLICATE"
  | "CHECKOUT_ITEM_BINDING_UNKNOWN"
  | "CHECKOUT_LINE_TIER_MISMATCH"
  | "CHECKOUT_LINE_QUANTITY_MISMATCH"
  | "CHECKOUT_LINE_AMOUNT_MISMATCH"
  | "CHECKOUT_LINE_CURRENCY_MISMATCH"
  | "CHECKOUT_AGGREGATE_MISMATCH"
  | "PAYMENT_SNAPSHOT_MISMATCH"
  | "PAYMENT_OBJECT_ALREADY_USED";

interface CheckoutReviewInput {
  stripeEventId: string;
  orderId: string;
  checkoutSessionId: string;
  failureCode: CheckoutMismatchCode;
}

type Task7Dependencies = StripeWebhookDependencies & {
  markCheckoutReconciliationReview(input: CheckoutReviewInput): Promise<void>;
};

const REFUND_APPLY_RESULT = {
  orderId: ORDER_ID,
  orderStatus: "refunded",
  ticketStatus: "refunded",
} as const;

const FULFILLMENT_APPLY_RESULT = {
  orderId: ORDER_ID,
  orderStatus: "paid",
  ticketCount: 3,
} as const;

Deno.test("default RPC boundary parses immutable labels and sends only the hash manifest", async () => {
  const names = [
    "STRIPE_RESTRICTED_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TICKET_CREDENTIAL_SECRET",
  ];
  const prior = names.map((name) => Deno.env.get(name));
  Deno.env.set(names[0], ["rk", "test", "litefixture"].join("_"));
  Deno.env.set(names[1], "https://lite-database.example.invalid");
  Deno.env.set(names[2], "lite-test-service-role");
  const encodedSecret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
    .replace(/=+$/, "");
  Deno.env.set(names[3], encodedSecret);
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let paidSnapshot: FulfillmentSnapshot | undefined;
  let rpcError = false;
  let snapshotRows: unknown = [{
    order_id: ORDER_ID,
    checkout_session_id: SESSION_ID,
    event_id: orderSnapshot().eventId,
    currency: "usd",
    subtotal_minor: 5500,
    total_minor: 5500,
    application_fee_amount_minor: 450,
    destination_account_id: ACCOUNT_ID,
    order_items: ORDER_ITEMS.map((item) => ({
      order_item_id: item.orderItemId,
      ticket_tier_id: item.tierId,
      tier_name: item.tierName,
      currency: item.currency,
      unit_amount_minor: item.unitAmountMinor,
      quantity: item.quantity,
      subtotal_minor: item.subtotalMinor,
    })),
  }];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    if (rpcError) {
      return new Response(
        JSON.stringify({
          message: `untrusted provider error wta1_${
            "x".repeat(43)
          } ${encodedSecret}`,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify(
        url.endsWith("server_fulfill_paid_order")
          ? [{ order_id: ORDER_ID, order_status: "paid", ticket_count: 3 }]
          : snapshotRows,
      ),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const adapter = createDefaultStripeWebhookDependencies();
    assertEquals(
      await adapter.getOrderSnapshot(ORDER_ID, SESSION_ID),
      orderSnapshot(),
    );
    assertEquals(
      await adapter.getPaymentOrderSnapshot(ORDER_ID),
      orderSnapshot(),
    );
    const valid = structuredClone(snapshotRows);
    for (
      const label of [undefined, null, "", " GA", "GA ", "x".repeat(81), 12]
    ) {
      snapshotRows = structuredClone(valid);
      const row =
        (snapshotRows as { order_items: Record<string, unknown>[] }[])[0];
      if (label === undefined) delete row.order_items[0].tier_name;
      else row.order_items[0].tier_name = label;
      await assertRejects(
        () => adapter.getOrderSnapshot(ORDER_ID, SESSION_ID),
        Error,
        "invalid database response",
      );
    }
    snapshotRows = valid;
    const logs: unknown[] = [];
    const response = await createStripeWebhookHandler(dependencies({
      getOrderSnapshot: adapter.getOrderSnapshot,
      getTicketCredentialSecret: adapter.getTicketCredentialSecret,
      fulfillPaidOrder: async (value) => {
        paidSnapshot = value;
        return await adapter.fulfillPaidOrder(value);
      },
      operationalSink: (event) => {
        logs.push(event);
      },
    }))(
      request(snapshotEvent("checkout.session.completed", { id: SESSION_ID })),
    );
    assertEquals(response.status, 200);
    const rpc = calls.find((call) =>
      call.url.endsWith("server_fulfill_paid_order")
    );
    assertEquals(rpc?.body.p_ticket_manifest, TICKET_MANIFEST);
    assertEquals(Object.keys(rpc!.body).length, 17);
    assertEquals(
      JSON.stringify([calls, logs, await response.text()]).includes("wta1_"),
      false,
    );
    assertEquals(JSON.stringify([calls, logs]).includes(encodedSecret), false);
    rpcError = true;
    const error = await assertRejects(
      () => adapter.fulfillPaidOrder(paidSnapshot!),
      Error,
      "database request failed",
    );
    assertEquals(error.message.includes("wta1_"), false);
    assertEquals(error.message.includes(encodedSecret), false);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) =>
      prior[i] === undefined
        ? Deno.env.delete(name)
        : Deno.env.set(name, prior[i]!)
    );
  }
});

Deno.test("credential configuration is lazy and failures remain retryable without secret disclosure", async () => {
  const secretMarker = "external-secret-must-never-escape";
  let reads = 0;
  let fulfillments = 0;
  const logs: unknown[] = [];
  const safe = dependencies({
    getTicketCredentialSecret: () => {
      reads++;
      return getTicketCredentialSecret(() => secretMarker);
    },
    fulfillPaidOrder: async () => {
      fulfillments++;
      return FULFILLMENT_APPLY_RESULT;
    },
    operationalSink: (event) => {
      logs.push(event);
    },
  });
  const unpaid = await createStripeWebhookHandler({
    ...safe,
    retrieveSession: async () =>
      checkoutSessionFixture({ payment_status: "unpaid" }),
  })(request(snapshotEvent("checkout.session.completed", { id: SESSION_ID })));
  assertEquals(unpaid.status, 200);
  assertEquals(reads, 0);
  const paid = await createStripeWebhookHandler(safe)(
    request(snapshotEvent("checkout.session.completed", { id: SESSION_ID })),
  );
  assertEquals(paid.status, 503);
  assertEquals(reads, 1);
  assertEquals(fulfillments, 0);
  assertEquals(
    JSON.stringify([logs, await paid.text()]).includes(secretMarker),
    false,
  );
  assertEquals(JSON.stringify(logs).includes("wta1_"), false);
});

Deno.test("paid fulfillment sends only sorted per-unit hashed credentials", async () => {
  let captured: Record<string, unknown> = {};
  const logs: unknown[] = [];
  const response = await createStripeWebhookHandler(dependencies({
    getOrderSnapshot: async () => ({
      ...orderSnapshot(),
      items: orderSnapshot().items.reverse(),
    }),
    fulfillPaidOrder: async (snapshot) => {
      captured = { ...snapshot };
      return FULFILLMENT_APPLY_RESULT;
    },
    operationalSink: (event) => {
      logs.push(event);
    },
  }))(request(snapshotEvent("checkout.session.completed", { id: SESSION_ID })));
  assertEquals(response.status, 200);
  const manifest = captured.ticketManifest as Record<string, unknown>[];
  assertEquals(Array.isArray(manifest), true);
  assertEquals(manifest, TICKET_MANIFEST);
  assertEquals(
    manifest.map((
      entry,
    ) => [entry.order_item_id, entry.unit_sequence, entry.admission_label]),
    [
      [ORDER_ITEMS[0].orderItemId, 1, "General Admission"],
      [ORDER_ITEMS[0].orderItemId, 2, "General Admission"],
      [ORDER_ITEMS[1].orderItemId, 1, "VIP Entry"],
    ],
  );
  for (const entry of manifest) {
    assertEquals(Object.keys(entry).sort(), [
      "admission_label",
      "credential_hash",
      "order_item_id",
      "unit_sequence",
    ]);
    assertEquals(/^[0-9a-f]{64}$/.test(String(entry.credential_hash)), true);
  }
  assertEquals(new Set(manifest.map((entry) => entry.credential_hash)).size, 3);
  assertEquals(
    JSON.stringify([captured, logs, await response.text()]).includes("wta1_"),
    false,
  );
});

function orderSnapshot(
  items = ORDER_ITEMS.map((item) => ({
    orderItemId: item.orderItemId,
    tierId: item.tierId,
    tierName: item.tierName,
    currency: item.currency,
    unitAmountMinor: item.unitAmountMinor,
    quantity: item.quantity,
    subtotalMinor: item.subtotalMinor,
  })),
) {
  return {
    orderId: ORDER_ID,
    checkoutSessionId: SESSION_ID,
    eventId: "22222222-3333-4444-8555-666666666666",
    currency: "usd" as const,
    subtotalMinor: 5_500,
    totalMinor: 5_500,
    applicationFeeAmountMinor: 450,
    destinationAccountId: ACCOUNT_ID,
    items,
  };
}

function lineFixture(
  item = ORDER_ITEMS[0],
  lineOverrides: Record<string, unknown> = {},
  priceOverrides: Record<string, unknown> = {},
  productOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = checkoutLineFixture(item);
  const price = base.price as Record<string, unknown>;
  const product = price.product as Record<string, unknown>;
  return {
    ...base,
    ...lineOverrides,
    price: {
      ...price,
      ...priceOverrides,
      product: { ...product, ...productOverrides },
    },
  };
}

function withoutField(
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function sessionWithPaymentIntent(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return checkoutSessionFixture({
    payment_intent: paymentIntentFixture(overrides),
  });
}

function sessionWithCharge(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return checkoutSessionFixture({
    payment_intent: paymentIntentFixture({
      latest_charge: chargeFixture(overrides),
    }),
  });
}

function sessionWithoutPaymentIntentField(field: string) {
  return checkoutSessionFixture({
    payment_intent: withoutField(paymentIntentFixture(), field),
  });
}

function sessionWithoutChargeField(field: string) {
  return checkoutSessionFixture({
    payment_intent: paymentIntentFixture({
      latest_charge: withoutField(chargeFixture(), field),
    }),
  });
}

function dependencies(
  overrides: Partial<Task7Dependencies> = {},
): Task7Dependencies {
  return {
    verifyEvent: async (raw) => JSON.parse(raw),
    recordReceipt: async () => ({ shouldProcess: true }),
    finalizeReceipt: async () => undefined,
    getOrderSnapshot: async () => orderSnapshot(),
    getPaymentOrderSnapshot: async () => orderSnapshot(),
    retrieveSession: async () => checkoutSessionFixture(),
    retrievePaymentIntent: async () => paymentIntentFixture(),
    retrieveCharge: async () => chargeFixture(),
    retrieveRefund: async () => refundFixture(),
    retrieveDispute: async () => disputeFixture(),
    retrieveTransfer: async () =>
      transferFixture({ amount_reversed: 5_050, reversed: true }),
    retrieveTransferReversal: async () => transferReversalFixture(),
    retrieveApplicationFee: async () => applicationFeeFixture(),
    retrieveApplicationFeeRefund: async () => feeRefundFixture(),
    createTransferReversal: async () =>
      transferReversalFixture({
        id: DISPUTE_REVERSAL_ID,
        source_refund: null,
        metadata: { dispute_id: DISPUTE_ID, order_id: ORDER_ID },
      }),
    retrieveAccount: async () => accountFixture(),
    beginAccountRefresh: async () => 401,
    persistAccountStatus: async () => true,
    fulfillPaidOrder: async () => FULFILLMENT_APPLY_RESULT,
    getTicketCredentialSecret: () => new Uint8Array(32).fill(7),
    markPaymentProcessing: async () => undefined,
    markPaymentFailed: async () => undefined,
    markPaymentRequiresReview: async () => undefined,
    markCheckoutReconciliationReview: async () => undefined,
    applyRefund: async () => REFUND_APPLY_RESULT,
    applyDispute: async () => undefined,
    operationalSink: () => undefined,
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
    secret: THIN_WEBHOOK_SECRET,
    timestamp: NOW_EPOCH_SECONDS,
  });

  await verifyStripeSignatureAgainstSecrets(
    stripe,
    raw,
    signature,
    [WEBHOOK_SECRET, THIN_WEBHOOK_SECRET],
    NOW_EPOCH_SECONDS,
  );
  await assertRejects(() =>
    verifyStripeSignatureAgainstSecrets(
      stripe,
      raw,
      signature,
      [WEBHOOK_SECRET],
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
      return FULFILLMENT_APPLY_RESULT;
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

// Mutation caught: hashing a parsed/reformatted event or bypassing the receipt
// decision would let a reused event ID apply a second domain transition.
Deno.test("identical delivery is a no-op and conflicting digest reuse cannot mutate the order", async () => {
  const receipts = new Map<string, string>();
  const conflicts: string[] = [];
  let fulfillmentCount = 0;
  const handler = createStripeWebhookHandler(dependencies({
    recordReceipt: async (input) => {
      const prior = receipts.get(input.stripeEventId);
      if (prior === undefined) {
        receipts.set(input.stripeEventId, input.payloadSha256);
        return { shouldProcess: true };
      }
      if (prior !== input.payloadSha256) conflicts.push(input.stripeEventId);
      return { shouldProcess: false };
    },
    fulfillPaidOrder: async () => {
      fulfillmentCount += 1;
      return FULFILLMENT_APPLY_RESULT;
    },
  }));
  const event = snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task7DeliveryDigest" },
  );

  const first = await handler(request(event));
  const duplicate = await handler(request(event));
  const conflict = await handler(request({ ...event, api_version: null }));

  assertEquals(
    [first.status, duplicate.status, conflict.status],
    [200, 200, 200],
  );
  assertEquals(fulfillmentCount, 1);
  assertEquals(conflicts, ["evt_Task7DeliveryDigest"]);
  assertEquals(receipts.size, 1);
});

// Mutation caught: positional/singular line reconciliation or non-authoritative
// webhook payload fulfillment cannot issue the exact 2 GA + 1 VIP ticket set.
Deno.test("paid completion re-retrieves reordered Product-bound lines and fulfills three exact tickets", async () => {
  const calls: string[] = [];
  let fulfillment: unknown;
  let ticketCount = 0;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveSession: async (id, params) => {
      calls.push("retrieve");
      assertEquals(id, SESSION_ID);
      assertEquals(params, {
        expand: [
          "line_items.data.price.product",
          "payment_intent.latest_charge",
        ],
      });
      return checkoutSessionFixture();
    },
    fulfillPaidOrder: async (snapshot) => {
      calls.push("fulfill");
      fulfillment = snapshot;
      ticketCount = ORDER_ITEMS.reduce(
        (total, item) => total + item.quantity,
        0,
      );
      return FULFILLMENT_APPLY_RESULT;
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
    subtotalMinor: 5_500,
    totalMinor: 5_500,
    applicationFeeAmountMinor: 450,
    destinationAccountId: ACCOUNT_ID,
    ticketManifest: TICKET_MANIFEST,
  });
  assertEquals(ticketCount, 3);
});

Deno.test("fulfillment RPC result validation returns the actual committed ticket count", () => {
  assertEquals(
    fulfillmentApplyResultFromRpc([{
      order_id: ORDER_ID,
      order_status: "paid",
      ticket_count: 3,
    }], ORDER_ID),
    FULFILLMENT_APPLY_RESULT,
  );

  for (
    const invalid of [
      [],
      [{ order_id: ORDER_ID, order_status: "paid", ticket_count: 11 }],
      [{ order_id: ORDER_ID, order_status: "paid", ticket_count: 3, raw: {} }],
    ]
  ) {
    assertThrows(
      () => fulfillmentApplyResultFromRpc(invalid, ORDER_ID),
      Error,
      "CHECKOUT_RECONCILIATION_REVIEW_MISMATCH",
    );
  }
});

Deno.test("a paid Session whose current Charge is already refunded or disputed is marked review and never fulfilled", async () => {
  const reviews: PaymentReviewSnapshot[] = [];
  let fulfilled = 0;
  const handler = createStripeWebhookHandler(dependencies({
    retrieveSession: async () =>
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({
          latest_charge: chargeFixture({ amount_refunded: 500 }),
        }),
      }),
    markPaymentRequiresReview: async (snapshot) => {
      reviews.push(snapshot);
    },
    fulfillPaidOrder: async () => {
      fulfilled += 1;
      return FULFILLMENT_APPLY_RESULT;
    },
  }));

  const refunded = await handler(request(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
  )));
  assertEquals([refunded.status, fulfilled], [200, 0]);
  assertEquals(reviews[0], {
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
    subtotalMinor: 5_500,
    totalMinor: 5_500,
    applicationFeeAmountMinor: 450,
    destinationAccountId: ACCOUNT_ID,
    failureCode: "PAYMENT_CHARGE_REFUNDED",
  });

  reviews.length = 0;
  const disputedHandler = createStripeWebhookHandler(dependencies({
    retrieveSession: async () =>
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({
          latest_charge: chargeFixture({ disputed: true }),
        }),
      }),
    markPaymentRequiresReview: async (snapshot) => {
      reviews.push(snapshot);
    },
    fulfillPaidOrder: async () => {
      fulfilled += 1;
      return FULFILLMENT_APPLY_RESULT;
    },
  }));
  await disputedHandler(request(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task14LateDispute" },
  )));
  assertEquals([reviews[0]?.failureCode, fulfilled], [
    "PAYMENT_CHARGE_DISPUTED",
    0,
  ]);
});

Deno.test("unpaid completion marks processing and an out-of-order async success fulfills from current paid Session truth", async () => {
  const transitions: string[] = [];
  const handler = createStripeWebhookHandler(dependencies({
    retrieveSession: async () =>
      checkoutSessionFixture({
        payment_status: transitions.length === 0 ? "unpaid" : "paid",
        payment_intent: paymentIntentFixture({
          status: transitions.length === 0 ? "processing" : "succeeded",
          amount_received: transitions.length === 0 ? 0 : 5_500,
          latest_charge: transitions.length === 0 ? null : chargeFixture(),
        }),
      }),
    markPaymentProcessing: async () => {
      transitions.push("processing");
    },
    fulfillPaidOrder: async () => {
      transitions.push("paid");
      return FULFILLMENT_APPLY_RESULT;
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

// Mutation caught: trusting event order instead of current Session truth can
// duplicate tickets or regress a paid order when completed arrives last.
Deno.test("async success before completed preserves one three-ticket set and stable provider IDs", async () => {
  const tickets = new Set<string>();
  let providerIds: string[] | undefined;
  let fulfillmentAttempts = 0;
  const handler = createStripeWebhookHandler(dependencies({
    fulfillPaidOrder: async (snapshot) => {
      fulfillmentAttempts += 1;
      for (const item of ORDER_ITEMS) {
        for (let sequence = 1; sequence <= item.quantity; sequence += 1) {
          tickets.add(`${item.orderItemId}:${sequence}`);
        }
      }
      const currentIds = [
        snapshot.paymentIntentId,
        snapshot.chargeId,
        snapshot.transferId,
        snapshot.applicationFeeId,
        snapshot.balanceTransactionId,
      ];
      if (providerIds === undefined) providerIds = currentIds;
      assertEquals(currentIds, providerIds);
      return FULFILLMENT_APPLY_RESULT;
    },
  }));

  const asyncSuccess = await handler(request(snapshotEvent(
    "checkout.session.async_payment_succeeded",
    { id: SESSION_ID },
    { id: "evt_Task7SuccessFirst" },
  )));
  const completed = await handler(request(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task7CompletedLast" },
  )));

  assertEquals([asyncSuccess.status, completed.status], [200, 200]);
  assertEquals(fulfillmentAttempts, 2);
  assertEquals(tickets.size, 3);
  assertEquals(providerIds, [
    PAYMENT_INTENT_ID,
    CHARGE_ID,
    TRANSFER_ID,
    APPLICATION_FEE_ID,
    BALANCE_TRANSACTION_ID,
  ]);
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
            amount_received: 0,
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

// Mutation caught: a late failure must not regress or re-fulfill current paid
// state when Stripe's authoritative Session already reports paid.
Deno.test("async failure after paid is durably ignored without a failed transition", async () => {
  const finalizations: unknown[] = [];
  let failures = 0;
  let fulfillments = 0;
  const response = await createStripeWebhookHandler(dependencies({
    markPaymentFailed: async () => {
      failures += 1;
    },
    fulfillPaidOrder: async () => {
      fulfillments += 1;
      return FULFILLMENT_APPLY_RESULT;
    },
    finalizeReceipt: async (...args) => {
      finalizations.push(args);
    },
  }))(request(snapshotEvent(
    "checkout.session.async_payment_failed",
    { id: SESSION_ID },
    { id: "evt_Task7FailureAfterPaid" },
  )));

  assertEquals([response.status, failures, fulfillments], [200, 0, 0]);
  assertEquals(finalizations, [[
    "evt_Task7FailureAfterPaid",
    "processed",
    "PAYMENT_SNAPSHOT_MISMATCH",
  ]]);
});

// Mutation caught: fulfillment must remain the only authority that decides a
// verified late payment cannot revive an invalidated order.
Deno.test("late paid truth reaches atomic fulfillment without issuing tickets for an invalidated order", async () => {
  let status = "expired";
  let ticketCount = 0;
  let persistedPaymentIntent: string | undefined;
  const records: Array<Record<string, unknown>> = [];
  const response = await createStripeWebhookHandler(dependencies({
    operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    fulfillPaidOrder: async (snapshot) => {
      persistedPaymentIntent = snapshot.paymentIntentId;
      if (["cancelled", "expired", "payment_failed"].includes(status)) {
        status = "requires_review";
        return {
          orderId: ORDER_ID,
          orderStatus: "requires_review",
          ticketCount: 0,
        };
      }
      ticketCount = 3;
      return FULFILLMENT_APPLY_RESULT;
    },
  }))(request(snapshotEvent(
    "checkout.session.async_payment_succeeded",
    { id: SESSION_ID },
    { id: "evt_Task7LateInvalidatedPayment" },
  )));

  assertEquals(response.status, 200);
  assertEquals([status, ticketCount, persistedPaymentIntent], [
    "requires_review",
    0,
    PAYMENT_INTENT_ID,
  ]);
  assertEquals(records, [{
    contractVersion: "checkout_integrity_v1",
    operation: "webhook.reconciliation",
    outcome: "mismatch",
    stripeEventId: "evt_Task7LateInvalidatedPayment",
    providerObjectId: SESSION_ID,
    errorCode: "CHECKOUT_RECONCILIATION_REVIEW_MISMATCH",
  }]);
});

// Mutation caught: a provider ID already owned by another order must route the
// known order to review, never be acknowledged as a successful fulfillment.
Deno.test("provider object reuse routes the bound order to review", async () => {
  const reviews: CheckoutReviewInput[] = [];
  const finalizations: unknown[] = [];
  const response = await createStripeWebhookHandler(dependencies({
    fulfillPaidOrder: async () => {
      throw new Error("PAYMENT_OBJECT_ALREADY_USED");
    },
    markCheckoutReconciliationReview: async (review) => {
      reviews.push(review);
    },
    finalizeReceipt: async (...args) => {
      finalizations.push(args);
    },
  }))(request(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task7ReusedProviderObject" },
  )));

  assertEquals(response.status, 200);
  assertEquals(reviews, [{
    stripeEventId: "evt_Task7ReusedProviderObject",
    orderId: ORDER_ID,
    checkoutSessionId: SESSION_ID,
    failureCode: "PAYMENT_OBJECT_ALREADY_USED",
  }]);
  assertEquals(finalizations, []);
});

// Mutations caught: line count/pagination drift, absent/duplicate/unknown Product
// bindings, duplicate persisted tiers, and every per-line money invariant.
Deno.test("every known-order line mismatch enters review with its exact safe code and never fulfills", async () => {
  const ga = () => lineFixture(ORDER_ITEMS[0]);
  const vip = () => lineFixture(ORDER_ITEMS[1]);
  const gaProductId = `prod_Task14${GA_ORDER_ITEM_ID.replaceAll("-", "")}`;
  const cases: Array<{
    name: string;
    code: CheckoutMismatchCode;
    session?: Record<string, unknown>;
    snapshot?: ReturnType<typeof orderSnapshot>;
  }> = [
    {
      name: "missing line",
      code: "CHECKOUT_LINE_COUNT_MISMATCH",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([ga()]),
      }),
    },
    {
      name: "extra line",
      code: "CHECKOUT_LINE_COUNT_MISMATCH",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([ga(), vip(), ga()]),
      }),
    },
    {
      name: "incomplete pagination",
      code: "CHECKOUT_LINE_COUNT_MISMATCH",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([ga(), vip()], {
          has_more: true,
        }),
      }),
    },
    {
      name: "missing Product binding",
      code: "CHECKOUT_ITEM_BINDING_MISSING",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          lineFixture(ORDER_ITEMS[0], {}, {}, { metadata: {} }),
          vip(),
        ]),
      }),
    },
    {
      name: "live Product binding",
      code: "CHECKOUT_ITEM_BINDING_MISSING",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          lineFixture(ORDER_ITEMS[0], {}, {}, { livemode: true }),
          vip(),
        ]),
      }),
    },
    {
      name: "non-exact Product binding metadata",
      code: "CHECKOUT_ITEM_BINDING_MISSING",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          lineFixture(ORDER_ITEMS[0], {}, {}, {
            metadata: {
              whereto_order_item_id: GA_ORDER_ITEM_ID,
              event_id: "22222222-3333-4444-8555-666666666666",
            },
          }),
          vip(),
        ]),
      }),
    },
    {
      name: "duplicate Product binding",
      code: "CHECKOUT_ITEM_BINDING_DUPLICATE",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          ga(),
          lineFixture(ORDER_ITEMS[1], {}, {}, {
            metadata: { whereto_order_item_id: GA_ORDER_ITEM_ID },
          }),
        ]),
      }),
    },
    {
      name: "unknown Product binding",
      code: "CHECKOUT_ITEM_BINDING_UNKNOWN",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          ga(),
          lineFixture(ORDER_ITEMS[1], {}, {}, {
            metadata: {
              whereto_order_item_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
            },
          }),
        ]),
      }),
    },
    {
      name: "duplicate persisted tier binding",
      code: "CHECKOUT_LINE_TIER_MISMATCH",
      snapshot: orderSnapshot([
        orderSnapshot().items[0],
        { ...orderSnapshot().items[1], tierId: GA_TIER_ID },
      ]),
    },
    {
      name: "wrong quantity",
      code: "CHECKOUT_LINE_QUANTITY_MISMATCH",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          lineFixture(ORDER_ITEMS[0], { quantity: 1 }),
          vip(),
        ]),
      }),
    },
    {
      name: "wrong unit amount",
      code: "CHECKOUT_LINE_AMOUNT_MISMATCH",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          lineFixture(ORDER_ITEMS[0], {}, { unit_amount: 1_499 }),
          vip(),
        ]),
      }),
    },
    {
      name: "live Price",
      code: "CHECKOUT_LINE_AMOUNT_MISMATCH",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          lineFixture(ORDER_ITEMS[0], {}, { livemode: true }),
          vip(),
        ]),
      }),
    },
    {
      name: "wrong line subtotal",
      code: "CHECKOUT_LINE_AMOUNT_MISMATCH",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          lineFixture(ORDER_ITEMS[0], {
            amount_subtotal: 2_999,
            amount_total: 2_999,
          }),
          vip(),
        ]),
      }),
    },
    {
      name: "wrong line currency",
      code: "CHECKOUT_LINE_CURRENCY_MISMATCH",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          lineFixture(ORDER_ITEMS[0], { currency: "cad" }, {
            currency: "cad",
          }),
          vip(),
        ]),
      }),
    },
    {
      name: "reused Stripe Product object",
      code: "CHECKOUT_ITEM_BINDING_DUPLICATE",
      session: checkoutSessionFixture({
        line_items: checkoutLineItemsFixture([
          ga(),
          lineFixture(ORDER_ITEMS[1], {}, {}, { id: gaProductId }),
        ]),
      }),
    },
    {
      name: "wrong Session aggregate",
      code: "CHECKOUT_AGGREGATE_MISMATCH",
      session: checkoutSessionFixture({ amount_total: 5_501 }),
    },
  ];

  for (const testCase of cases) {
    const reviews: CheckoutReviewInput[] = [];
    const finalizations: unknown[] = [];
    let fulfilled = 0;
    const response = await createStripeWebhookHandler(dependencies({
      getOrderSnapshot: async () => testCase.snapshot ?? orderSnapshot(),
      retrieveSession: async () => testCase.session ?? checkoutSessionFixture(),
      markCheckoutReconciliationReview: async (review) => {
        reviews.push(review);
      },
      fulfillPaidOrder: async () => {
        fulfilled += 1;
        return FULFILLMENT_APPLY_RESULT;
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    }))(request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
      { id: `evt_Task7${testCase.name.replaceAll(/[^A-Za-z0-9]/g, "")}` },
    )));

    assertEquals(response.status, 200, testCase.name);
    assertEquals(fulfilled, 0, testCase.name);
    assertEquals(reviews, [{
      stripeEventId: `evt_Task7${
        testCase.name.replaceAll(/[^A-Za-z0-9]/g, "")
      }`,
      orderId: ORDER_ID,
      checkoutSessionId: SESSION_ID,
      failureCode: testCase.code,
    }], testCase.name);
    assertEquals(finalizations, [], testCase.name);
  }
});

// Mutations caught: old tier metadata, forged Session references, destination or
// fee drift, invalid PaymentIntent state, and forged current Charge truth.
Deno.test("known-order non-line Stripe snapshot mismatches enter review without fulfillment", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      "Session metadata",
      checkoutSessionFixture({
        metadata: checkoutMetadata({ tier_id: GA_TIER_ID }),
      }),
    ],
    [
      "client reference",
      checkoutSessionFixture({
        client_reference_id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
      }),
    ],
    [
      "PaymentIntent destination",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({
          transfer_data: { destination: "acct_Task7Other" },
        }),
      }),
    ],
    [
      "PaymentIntent fee",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({ application_fee_amount: 451 }),
      }),
    ],
    [
      "PaymentIntent metadata",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({
          metadata: checkoutMetadata({ tier_id: GA_TIER_ID }),
        }),
      }),
    ],
    [
      "PaymentIntent amount",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({ amount: 5_501 }),
      }),
    ],
    [
      "PaymentIntent livemode",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({ livemode: true }),
      }),
    ],
    [
      "PaymentIntent status",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({ status: "requires_capture" }),
      }),
    ],
    [
      "Charge amount",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({
          latest_charge: chargeFixture({ amount: 5_501 }),
        }),
      }),
    ],
    [
      "Charge metadata",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({
          latest_charge: chargeFixture({
            metadata: checkoutMetadata({ tier_id: GA_TIER_ID }),
          }),
        }),
      }),
    ],
    [
      "Charge paid state",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({
          latest_charge: chargeFixture({ paid: false }),
        }),
      }),
    ],
    [
      "Charge livemode",
      checkoutSessionFixture({
        payment_intent: paymentIntentFixture({
          latest_charge: chargeFixture({ livemode: true }),
        }),
      }),
    ],
  ];

  for (const [name, session] of cases) {
    let fulfilled = 0;
    const reviews: CheckoutReviewInput[] = [];
    const finalizations: unknown[] = [];
    const eventId = `evt_Task7${name.replaceAll(/[^A-Za-z0-9]/g, "")}`;
    const response = await createStripeWebhookHandler(dependencies({
      retrieveSession: async () => session,
      fulfillPaidOrder: async () => {
        fulfilled += 1;
        return FULFILLMENT_APPLY_RESULT;
      },
      markCheckoutReconciliationReview: async (review) => {
        reviews.push(review);
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    }))(request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
      { id: eventId },
    )));

    assertEquals([response.status, fulfilled], [200, 0], name);
    assertEquals(reviews, [{
      stripeEventId: eventId,
      orderId: ORDER_ID,
      checkoutSessionId: SESSION_ID,
      failureCode: "PAYMENT_SNAPSHOT_MISMATCH",
    }], name);
    assertEquals(finalizations, [], name);
  }
});

// Mutations caught: treating a temporarily incomplete provider object graph as
// a permanent contradiction would strand a valid paid order in review before
// Stripe can retry the same delivery with fully materialized references.
Deno.test("paid completion with unavailable Stripe graph references stays retryable without review", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      "missing PaymentIntent",
      withoutField(checkoutSessionFixture(), "payment_intent"),
    ],
    [
      "null PaymentIntent",
      checkoutSessionFixture({ payment_intent: null }),
    ],
    [
      "unexpanded PaymentIntent",
      checkoutSessionFixture({ payment_intent: PAYMENT_INTENT_ID }),
    ],
    [
      "missing latest Charge",
      sessionWithoutPaymentIntentField("latest_charge"),
    ],
    [
      "null latest Charge",
      sessionWithPaymentIntent({ latest_charge: null }),
    ],
    [
      "unexpanded latest Charge",
      sessionWithPaymentIntent({ latest_charge: CHARGE_ID }),
    ],
    [
      "missing Charge PaymentIntent binding",
      sessionWithoutChargeField("payment_intent"),
    ],
    [
      "null Charge PaymentIntent binding",
      sessionWithCharge({ payment_intent: null }),
    ],
    ["missing Transfer", sessionWithoutChargeField("transfer")],
    ["null Transfer", sessionWithCharge({ transfer: null })],
    [
      "missing Application Fee",
      sessionWithoutChargeField("application_fee"),
    ],
    ["null Application Fee", sessionWithCharge({ application_fee: null })],
    [
      "missing Balance Transaction",
      sessionWithoutChargeField("balance_transaction"),
    ],
    [
      "null Balance Transaction",
      sessionWithCharge({ balance_transaction: null }),
    ],
  ];

  for (const [name, session] of cases) {
    const reviews: CheckoutReviewInput[] = [];
    const finalizations: unknown[] = [];
    let fulfillments = 0;
    const eventId = `evt_Task13Transient${
      name.replaceAll(/[^A-Za-z0-9]/g, "")
    }`;
    const response = await createStripeWebhookHandler(dependencies({
      retrieveSession: async () => session,
      markCheckoutReconciliationReview: async (review) => {
        reviews.push(review);
      },
      fulfillPaidOrder: async () => {
        fulfillments += 1;
        return FULFILLMENT_APPLY_RESULT;
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    }))(request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
      { id: eventId },
    )));

    assertEquals([response.status, fulfillments], [503, 0], name);
    assertEquals(reviews, [], name);
    assertEquals(finalizations, [[
      eventId,
      "failed",
      "TRANSIENT_PROCESSING_FAILURE",
    ]], name);
  }
});

// Mutations caught: treating a transient graph failure as processed, or
// bypassing receipt/fulfillment idempotency on retry, would either strand the
// paid order or create more than the exact 2 GA + 1 VIP ticket set.
Deno.test("same paid event retries after graph materialization and fulfills exactly three tickets once", async () => {
  let receiptStatus: "new" | "failed" | "processed" = "new";
  let orderStatus: "checkout_open" | "requires_review" | "paid" =
    "checkout_open";
  let retrievals = 0;
  let fulfillmentAttempts = 0;
  let reviews = 0;
  const tickets = new Set<string>();
  const finalizations: unknown[] = [];
  const event = snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task13TransientGraphRecovery" },
  );
  const handler = createStripeWebhookHandler(dependencies({
    recordReceipt: async () => ({
      shouldProcess: receiptStatus !== "processed",
    }),
    retrieveSession: async () => {
      retrievals += 1;
      return retrievals === 1
        ? sessionWithoutChargeField("transfer")
        : checkoutSessionFixture();
    },
    markCheckoutReconciliationReview: async () => {
      reviews += 1;
      orderStatus = "requires_review";
      receiptStatus = "processed";
    },
    fulfillPaidOrder: async () => {
      fulfillmentAttempts += 1;
      for (const item of ORDER_ITEMS) {
        for (let sequence = 1; sequence <= item.quantity; sequence += 1) {
          tickets.add(`${item.orderItemId}:${sequence}`);
        }
      }
      orderStatus = "paid";
      receiptStatus = "processed";
      return FULFILLMENT_APPLY_RESULT;
    },
    finalizeReceipt: async (...args) => {
      finalizations.push(args);
      if (args[1] === "failed") receiptStatus = "failed";
    },
  }));

  const incomplete = await handler(request(event));
  assertEquals([
    incomplete.status,
    orderStatus,
    tickets.size,
    receiptStatus,
  ], [503, "checkout_open", 0, "failed"]);

  const materialized = await handler(request(event));
  const duplicate = await handler(request(event));

  assertEquals([materialized.status, duplicate.status], [200, 200]);
  assertEquals({
    orderStatus,
    ticketCount: tickets.size,
    retrievals,
    fulfillmentAttempts,
    reviews,
  }, {
    orderStatus: "paid",
    ticketCount: 3,
    retrievals: 2,
    fulfillmentAttempts: 1,
    reviews: 0,
  });
  assertEquals(finalizations, [[
    "evt_Task13TransientGraphRecovery",
    "failed",
    "TRANSIENT_PROCESSING_FAILURE",
  ]]);
});

// Mutations caught: completed-unpaid and async-success deliveries must not
// consume the event permanently when their required PaymentIntent has not yet
// materialized; the same event must be able to fulfill from later paid truth.
Deno.test("payment lifecycle events retry an absent PaymentIntent and fulfill after materialization", async () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    [
      "completed unpaid",
      "checkout.session.completed",
      checkoutSessionFixture({
        payment_status: "unpaid",
        payment_intent: null,
      }),
    ],
    [
      "async success",
      "checkout.session.async_payment_succeeded",
      withoutField(checkoutSessionFixture(), "payment_intent"),
    ],
  ];

  for (const [name, eventType, incompleteSession] of cases) {
    let retrievals = 0;
    let fulfillments = 0;
    let processingTransitions = 0;
    let reviews = 0;
    const finalizations: unknown[] = [];
    const eventId = `evt_Task13Lifecycle${
      name.replaceAll(/[^A-Za-z0-9]/g, "")
    }`;
    const event = snapshotEvent(
      eventType,
      { id: SESSION_ID },
      { id: eventId },
    );
    const handler = createStripeWebhookHandler(dependencies({
      retrieveSession: async () => {
        retrievals += 1;
        return retrievals === 1 ? incompleteSession : checkoutSessionFixture();
      },
      markPaymentProcessing: async () => {
        processingTransitions += 1;
      },
      markCheckoutReconciliationReview: async () => {
        reviews += 1;
      },
      fulfillPaidOrder: async () => {
        fulfillments += 1;
        return FULFILLMENT_APPLY_RESULT;
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    }));

    const incomplete = await handler(request(event));
    const materialized = await handler(request(event));

    assertEquals([incomplete.status, materialized.status], [503, 200], name);
    assertEquals(
      { retrievals, fulfillments, processingTransitions, reviews },
      { retrievals: 2, fulfillments: 1, processingTransitions: 0, reviews: 0 },
      name,
    );
    assertEquals(finalizations, [[
      eventId,
      "failed",
      "TRANSIENT_PROCESSING_FAILURE",
    ]], name);
  }
});

// Mutations caught: treating malformed expanded Charge references as an
// anonymous receipt error after the exact Session/order binding is known.
Deno.test("known-order malformed Charge references enter review without fulfillment", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["malformed payment intent", sessionWithCharge({ payment_intent: {} })],
    ["malformed customer", sessionWithCharge({ customer: {} })],
    ["malformed transfer", sessionWithCharge({ transfer: {} })],
    ["malformed application fee", sessionWithCharge({ application_fee: {} })],
    [
      "malformed balance transaction",
      sessionWithCharge({ balance_transaction: {} }),
    ],
  ];

  for (const [name, session] of cases) {
    const reviews: CheckoutReviewInput[] = [];
    const finalizations: unknown[] = [];
    let fulfillments = 0;
    const eventId = `evt_Task13${name.replaceAll(/[^A-Za-z0-9]/g, "")}`;
    const response = await createStripeWebhookHandler(dependencies({
      retrieveSession: async () => session,
      markCheckoutReconciliationReview: async (review) => {
        reviews.push(review);
      },
      fulfillPaidOrder: async () => {
        fulfillments += 1;
        return FULFILLMENT_APPLY_RESULT;
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    }))(request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
      { id: eventId },
    )));

    assertEquals([response.status, fulfillments], [200, 0], name);
    assertEquals(reviews, [{
      stripeEventId: eventId,
      orderId: ORDER_ID,
      checkoutSessionId: SESSION_ID,
      failureCode: "PAYMENT_SNAPSHOT_MISMATCH",
    }], name);
    assertEquals(finalizations, [], name);
  }
});

// Mutation caught: requiring a Customer reference would send valid guest
// payments to reconciliation review instead of fulfilling them.
Deno.test("guest paid completion with an absent Charge customer fulfills with a null customer ID", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["explicit null", sessionWithCharge({ customer: null })],
    ["omitted", sessionWithoutChargeField("customer")],
  ];

  for (const [name, session] of cases) {
    const fulfillments: unknown[] = [];
    let reviews = 0;
    const response = await createStripeWebhookHandler(dependencies({
      retrieveSession: async () => session,
      fulfillPaidOrder: async (snapshot) => {
        fulfillments.push(snapshot);
        return FULFILLMENT_APPLY_RESULT;
      },
      markCheckoutReconciliationReview: async () => {
        reviews += 1;
      },
    }))(request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
      { id: `evt_Task13Guest${name.replaceAll(/[^A-Za-z0-9]/g, "")}` },
    )));

    assertEquals(
      [response.status, reviews, fulfillments.length],
      [200, 0, 1],
      name,
    );
    assertEquals(
      (fulfillments[0] as { customerId: string | null }).customerId,
      null,
      name,
    );
  }
});

// Mutations caught: trusting intended payment amounts or `paid` alone would
// fulfill without proving Stripe actually collected and captured the full total.
const collectedFundsCases: Array<[string, Record<string, unknown>]> = [
  [
    "missing PaymentIntent amount_received",
    sessionWithoutPaymentIntentField("amount_received"),
  ],
  [
    "null PaymentIntent amount_received",
    sessionWithPaymentIntent({ amount_received: null }),
  ],
  [
    "partial PaymentIntent amount_received",
    sessionWithPaymentIntent({ amount_received: 5_499 }),
  ],
  [
    "non-integer PaymentIntent amount_received",
    sessionWithPaymentIntent({ amount_received: 5_499.5 }),
  ],
  [
    "unsafe PaymentIntent amount_received",
    sessionWithPaymentIntent({
      amount_received: Number.MAX_SAFE_INTEGER + 1,
    }),
  ],
  [
    "missing PaymentIntent amount_capturable",
    sessionWithoutPaymentIntentField("amount_capturable"),
  ],
  [
    "null PaymentIntent amount_capturable",
    sessionWithPaymentIntent({ amount_capturable: null }),
  ],
  [
    "nonzero PaymentIntent amount_capturable",
    sessionWithPaymentIntent({ amount_capturable: 1 }),
  ],
  [
    "non-integer PaymentIntent amount_capturable",
    sessionWithPaymentIntent({ amount_capturable: 0.5 }),
  ],
  [
    "unsafe PaymentIntent amount_capturable",
    sessionWithPaymentIntent({
      amount_capturable: Number.MAX_SAFE_INTEGER + 1,
    }),
  ],
  [
    "missing Charge amount_captured",
    sessionWithoutChargeField("amount_captured"),
  ],
  [
    "null Charge amount_captured",
    sessionWithCharge({ amount_captured: null }),
  ],
  [
    "partial Charge amount_captured",
    sessionWithCharge({ amount_captured: 5_499 }),
  ],
  [
    "non-integer Charge amount_captured",
    sessionWithCharge({ amount_captured: 5_499.5 }),
  ],
  [
    "unsafe Charge amount_captured",
    sessionWithCharge({ amount_captured: Number.MAX_SAFE_INTEGER + 1 }),
  ],
  ["missing Charge captured", sessionWithoutChargeField("captured")],
  ["null Charge captured", sessionWithCharge({ captured: null })],
  ["false Charge captured", sessionWithCharge({ captured: false })],
  ["missing Charge status", sessionWithoutChargeField("status")],
  ["null Charge status", sessionWithCharge({ status: null })],
  ["pending Charge status", sessionWithCharge({ status: "pending" })],
  ["failed Charge status", sessionWithCharge({ status: "failed" })],
];

for (const [name, session] of collectedFundsCases) {
  Deno.test(`${name} is a safe permanent mismatch without fulfillment`, async () => {
    const finalizations: unknown[] = [];
    let fulfilled = 0;
    const reviews: CheckoutReviewInput[] = [];
    const eventId = `evt_Task7${name.replaceAll(/[^A-Za-z0-9]/g, "")}`;
    const response = await createStripeWebhookHandler(dependencies({
      retrieveSession: async () => session,
      fulfillPaidOrder: async () => {
        fulfilled += 1;
        return FULFILLMENT_APPLY_RESULT;
      },
      markCheckoutReconciliationReview: async (review) => {
        reviews.push(review);
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    }))(request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
      { id: eventId },
    )));

    assertEquals([response.status, fulfilled], [200, 0]);
    assertEquals(reviews, [{
      stripeEventId: eventId,
      orderId: ORDER_ID,
      checkoutSessionId: SESSION_ID,
      failureCode: "PAYMENT_SNAPSHOT_MISMATCH",
    }]);
    assertEquals(finalizations, []);
  });
}

Deno.test("a signed known-order malformed Charge reference is reviewed once and duplicate delivery is a receipt no-op", async () => {
  const stripe = new Stripe(["rk", "test", "task13review"].join("_"), {
    apiVersion: "2026-07-29.dahlia",
  });
  const event = snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task13KnownOrderReview" },
  );
  const raw = JSON.stringify(event);
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload: raw,
    secret: WEBHOOK_SECRET,
    timestamp: NOW_EPOCH_SECONDS,
  });
  let receiptProcessed = false;
  let retrievals = 0;
  let reviews = 0;
  let fulfillments = 0;
  let finalizations = 0;
  const handler = createStripeWebhookHandler(dependencies({
    verifyEvent: async (body, header) => {
      await verifyStripeSignature(
        stripe,
        body,
        header,
        WEBHOOK_SECRET,
        NOW_EPOCH_SECONDS,
      );
      return JSON.parse(body);
    },
    recordReceipt: async () => ({ shouldProcess: !receiptProcessed }),
    retrieveSession: async () => {
      retrievals += 1;
      return sessionWithCharge({ transfer: {} });
    },
    markCheckoutReconciliationReview: async () => {
      reviews += 1;
      receiptProcessed = true;
    },
    fulfillPaidOrder: async () => {
      fulfillments += 1;
      return FULFILLMENT_APPLY_RESULT;
    },
    finalizeReceipt: async () => {
      finalizations += 1;
      receiptProcessed = true;
    },
  }));

  const first = await handler(request(event, signature));
  const duplicate = await handler(request(event, signature));

  assertEquals([first.status, duplicate.status], [200, 200]);
  assertEquals({ retrievals, reviews, fulfillments, finalizations }, {
    retrievals: 1,
    reviews: 1,
    fulfillments: 0,
    finalizations: 0,
  });
});

// Mutation caught: attempting review from untrusted event payload identity can
// mutate an unrelated order before the Session/order RPC proves the binding.
Deno.test("missing or unknown Session order identity never invokes a domain mutation", async () => {
  for (const knownOrder of [false, true]) {
    let orderLookups = 0;
    let domainWrites = 0;
    const finalizations: unknown[] = [];
    const eventId = knownOrder
      ? "evt_Task7UnknownOrderIdentity"
      : "evt_Task7MissingOrderIdentity";
    const response = await createStripeWebhookHandler(dependencies({
      retrieveSession: async () =>
        checkoutSessionFixture({
          metadata: knownOrder
            ? checkoutMetadata({
              order_id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
            })
            : {
              contract_version: "checkout_integrity_v1",
              event_id: "22222222-3333-4444-8555-666666666666",
            },
        }),
      getOrderSnapshot: async () => {
        orderLookups += 1;
        return null;
      },
      markCheckoutReconciliationReview: async () => {
        domainWrites += 1;
      },
      fulfillPaidOrder: async () => {
        domainWrites += 1;
        return FULFILLMENT_APPLY_RESULT;
      },
      markPaymentProcessing: async () => {
        domainWrites += 1;
      },
      markPaymentFailed: async () => {
        domainWrites += 1;
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    }))(request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
      { id: eventId },
    )));

    assertEquals([response.status, orderLookups, domainWrites], [
      200,
      knownOrder ? 1 : 0,
      0,
    ]);
    assertEquals(finalizations, [[
      eventId,
      "processed",
      "PAYMENT_SNAPSHOT_MISMATCH",
    ]]);
  }
});

Deno.test("transient Stripe retrieval failures remain retryable and return non-2xx", async () => {
  const finalizations: unknown[] = [];
  let attempts = 0;
  let fulfilled = 0;
  const handler = createStripeWebhookHandler(dependencies({
    retrieveSession: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("network unavailable");
      return checkoutSessionFixture();
    },
    finalizeReceipt: async (...args) => {
      finalizations.push(args);
    },
    fulfillPaidOrder: async () => {
      fulfilled += 1;
      return FULFILLMENT_APPLY_RESULT;
    },
  }));
  const event = snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task7TransientRetry" },
  );
  const failed = await handler(request(event));
  const retried = await handler(request(event));

  assertEquals([failed.status, retried.status, attempts, fulfilled], [
    503,
    200,
    2,
    1,
  ]);
  assertEquals(finalizations, [[
    "evt_Task7TransientRetry",
    "failed",
    "TRANSIENT_PROCESSING_FAILURE",
  ]]);
});

Deno.test("recipient-account events retrieve current Accounts v2 state and persist only the safe projection", async () => {
  let persisted: unknown;
  const calls: string[] = [];
  const response = await createStripeWebhookHandler(dependencies({
    beginAccountRefresh: async (accountId) => {
      calls.push("begin");
      assertEquals(accountId, ACCOUNT_ID);
      return 402;
    },
    retrieveAccount: async (accountId, params) => {
      calls.push("retrieve");
      assertEquals(accountId, ACCOUNT_ID);
      assertEquals(params, {
        include: ["configuration.recipient", "defaults", "requirements"],
      });
      return accountFixture();
    },
    persistAccountStatus: async (accountId, refreshSequence, projection) => {
      calls.push("persist");
      persisted = { accountId, refreshSequence, projection };
      return true;
    },
  }))(request(thinAccountEvent()));

  assertEquals(response.status, 200);
  assertEquals(calls, ["begin", "retrieve", "persist"]);
  assertEquals(persisted, {
    accountId: ACCOUNT_ID,
    refreshSequence: 402,
    projection: {
      transfersStatus: "active",
      payoutsStatus: "active",
      requirementsStatus: "clear",
      requirementsCurrentlyDueCount: 0,
      requirementsPastDueCount: 0,
      lastStatusCode: null,
    },
  });
});

Deno.test("account synchronization persists the same DB-issued causal sequence acquired before retrieval", async () => {
  const calls: string[] = [];
  let persistedSequence: number | undefined;
  const response = await createStripeWebhookHandler(dependencies({
    beginAccountRefresh: async () => {
      calls.push("begin");
      return 403;
    },
    retrieveAccount: async () => {
      calls.push("retrieve");
      return accountFixture();
    },
    persistAccountStatus: async (_accountId, refreshSequence) => {
      calls.push("persist");
      persistedSequence = refreshSequence;
      return true;
    },
  }))(request(thinAccountEvent()));

  assertEquals(response.status, 200);
  assertEquals(calls, ["begin", "retrieve", "persist"]);
  assertEquals(persistedSequence, 403);
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
    retrieveTransfer: async (id) => {
      assertEquals(id, TRANSFER_ID);
      return transferFixture({
        amount: 5_500,
        amount_reversed: 5_500,
        reversed: true,
      });
    },
    retrieveTransferReversal: async (transferId, reversalId) => {
      assertEquals([transferId, reversalId], [TRANSFER_ID, REFUND_REVERSAL_ID]);
      return transferReversalFixture({ amount: 5_500 });
    },
    retrieveApplicationFee: async (id) => {
      assertEquals(id, APPLICATION_FEE_ID);
      return applicationFeeFixture();
    },
    retrieveApplicationFeeRefund: async (feeId, refundId) => {
      assertEquals([feeId, refundId], [APPLICATION_FEE_ID, FEE_REFUND_ID]);
      return feeRefundFixture();
    },
    applyRefund: async (snapshot) => {
      applied = snapshot;
      return REFUND_APPLY_RESULT;
    },
  }))(request(snapshotEvent("refund.updated", { id: REFUND_ID })));

  assertEquals(response.status, 200);
  assertEquals(applied, {
    stripeEventId: "evt_refundupdatedTask14",
    orderId: ORDER_ID,
    stripeRefundId: REFUND_ID,
    paymentIntentId: PAYMENT_INTENT_ID,
    chargeId: CHARGE_ID,
    transferReversalId: REFUND_REVERSAL_ID,
    applicationFeeRefundId: FEE_REFUND_ID,
    amountMinor: 5_500,
    currency: "usd",
    status: "succeeded",
    reason: "requested_by_customer",
    reverseTransfer: true,
    refundApplicationFee: true,
    transferReversalAmountMinor: 5_500,
    applicationFeeRefundAmountMinor: 450,
    policyVerified: true,
    policyFailureCode: null,
  });
});

Deno.test("refund reconciliation logs the authoritative cumulative durable result", async () => {
  const records: Array<Record<string, unknown>> = [];
  const response = await createStripeWebhookHandler(dependencies({
    operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    retrieveRefund: async () =>
      refundFixture({
        amount: 1_000,
        metadata: {
          order_id: ORDER_ID,
          whereto_refund_policy: "destination_v1",
          whereto_reverse_transfer: "true",
          whereto_refund_application_fee: "true",
          whereto_transfer_reversal_amount: "1000",
          whereto_application_fee_refund_id: FEE_REFUND_ID,
          whereto_application_fee_refund_amount: "100",
        },
      }),
    retrieveTransfer: async () =>
      transferFixture({
        amount: 5_500,
        amount_reversed: 5_500,
        reversed: true,
      }),
    retrieveTransferReversal: async () =>
      transferReversalFixture({ amount: 1_000 }),
    retrieveApplicationFee: async () =>
      applicationFeeFixture({ amount_refunded: 450 }),
    retrieveApplicationFeeRefund: async () => feeRefundFixture({ amount: 100 }),
    applyRefund: async () => ({
      orderId: ORDER_ID,
      orderStatus: "refunded",
      ticketStatus: "refunded",
    }),
  }))(request(snapshotEvent(
    "refund.updated",
    { id: REFUND_ID },
    { id: "evt_Task10CumulativeRefund" },
  )));

  assertEquals(response.status, 200);
  assertEquals(records, [{
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "applied",
    orderId: ORDER_ID,
    stripeEventId: "evt_Task10CumulativeRefund",
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 1_000,
    resultStatus: "refunded",
    ticketStatus: "refunded",
  }]);
});

Deno.test("refund RPC result validation accepts exactly one authoritative bounded row", () => {
  for (
    const orderStatus of [
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
    ] as const
  ) {
    assertEquals(
      refundApplyResultFromRpc([{
        order_id: ORDER_ID,
        order_status: orderStatus,
        ticket_status: null,
      }], ORDER_ID),
      {
        orderId: ORDER_ID,
        orderStatus,
        ticketStatus: null,
      },
    );
  }

  assertEquals(
    refundApplyResultFromRpc([{
      order_id: ORDER_ID,
      order_status: "requires_review",
      ticket_status: "cancelled",
    }], ORDER_ID),
    {
      orderId: ORDER_ID,
      orderStatus: "requires_review",
      ticketStatus: "cancelled",
    },
  );

  for (
    const invalid of [
      [],
      [{ order_id: ORDER_ID, order_status: "refunded" }],
      [{
        order_id: ORDER_ID,
        order_status: "refunded",
        ticket_status: "refunded",
        raw_provider_result: "unsafe",
      }],
      [{
        order_id: "00000000-0000-4000-8000-000000000099",
        order_status: "refunded",
        ticket_status: "refunded",
      }],
      [{
        order_id: ORDER_ID,
        order_status: "provider_unknown",
        ticket_status: "refunded",
      }],
      [{
        order_id: ORDER_ID,
        order_status: "refunded",
        ticket_status: "provider_unknown",
      }],
    ]
  ) {
    assertThrows(() => refundApplyResultFromRpc(invalid, ORDER_ID));
  }
});

Deno.test("refund RPC preserves all-used and mixed admission outcomes", () => {
  for (const ticketStatus of ["used", "mixed"] as const) {
    assertEquals(refundApplyResultFromRpc([{
      order_id: ORDER_ID, order_status: "refunded", ticket_status: ticketStatus,
    }], ORDER_ID), { orderId: ORDER_ID, orderStatus: "refunded", ticketStatus });
  }
});

Deno.test("valid unchanged out-of-order refund result is acknowledged after commit", async () => {
  let committed = false;
  const records: Array<Record<string, unknown>> = [];
  const response = await createStripeWebhookHandler(dependencies({
    operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    applyRefund: async () => {
      committed = true;
      return refundApplyResultFromRpc([{
        order_id: ORDER_ID,
        order_status: "checkout_open",
        ticket_status: null,
      }], ORDER_ID);
    },
  }))(request(snapshotEvent(
    "refund.updated",
    { id: REFUND_ID },
    { id: "evt_Task10OutOfOrderRefund" },
  )));

  assertEquals([committed, response.status], [true, 200]);
  assertEquals(records, [{
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "applied",
    orderId: ORDER_ID,
    stripeEventId: "evt_Task10OutOfOrderRefund",
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 5_500,
    resultStatus: "checkout_open",
    ticketStatus: "none",
  }]);
});

Deno.test("refund delivery acknowledges used history without a false durable-state review", async () => {
  for (const orderStatus of ["paid", "refunded"] as const) {
    for (const ticketStatus of ["used", "mixed"] as const) {
      const records: Array<Record<string, unknown>> = [];
      const response = await createStripeWebhookHandler(dependencies({
        operationalSink: (serialized) => records.push(JSON.parse(serialized)),
        applyRefund: async () => ({ orderId: ORDER_ID, orderStatus, ticketStatus }),
      }))(request(snapshotEvent("refund.updated", { id: REFUND_ID }, { id: "evt_LiteUsedRefund" })));
      assertEquals(response.status, 200);
      assertEquals(records, [{
        contractVersion: "checkout_integrity_v1", operation: "refund.reconcile", outcome: "applied",
        orderId: ORDER_ID, stripeEventId: "evt_LiteUsedRefund", providerObjectId: REFUND_ID,
        currency: "usd", amountMinor: 5_500, resultStatus: orderStatus, ticketStatus,
      }]);
    }
  }
});

Deno.test("pending refund after owner cancellation keeps paid/cancelled truth and logs applied", async () => {
  const records: Array<Record<string, unknown>> = [];
  const response = await createStripeWebhookHandler(dependencies({
    operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    retrieveRefund: async () => refundFixture({ status: "pending" }),
    applyRefund: async (input) => {
      assertEquals(input.status, "pending");
      return refundApplyResultFromRpc([{
        order_id: ORDER_ID, order_status: "paid", ticket_status: "cancelled",
      }], ORDER_ID);
    },
  }))(request(snapshotEvent("refund.updated", { id: REFUND_ID }, { id: "evt_LiteCancelledPendingRefund" })));
  assertEquals(response.status, 200);
  assertEquals(records, [{
    contractVersion: "checkout_integrity_v1", operation: "refund.reconcile", outcome: "applied",
    orderId: ORDER_ID, stripeEventId: "evt_LiteCancelledPendingRefund", providerObjectId: REFUND_ID,
    currency: "usd", amountMinor: 5_500, resultStatus: "paid", ticketStatus: "cancelled",
  }]);
});

Deno.test("pending refund with unchanged payment processing state is applied without review", async () => {
  const records: Array<Record<string, unknown>> = [];
  const response = await createStripeWebhookHandler(dependencies({
    operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    retrieveRefund: async () => refundFixture({ status: "pending" }),
    applyRefund: async () => ({
      orderId: ORDER_ID,
      orderStatus: "payment_processing",
      ticketStatus: null,
    }),
  }))(request(snapshotEvent(
    "refund.updated",
    { id: REFUND_ID },
    { id: "evt_Task10PendingRefundProcessing" },
  )));

  assertEquals(response.status, 200);
  assertEquals(records, [{
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "applied",
    orderId: ORDER_ID,
    stripeEventId: "evt_Task10PendingRefundProcessing",
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 5_500,
    resultStatus: "payment_processing",
    ticketStatus: "none",
  }]);
});

Deno.test("full refund before payment reconciliation emits conservative durable review", async () => {
  const records: Array<Record<string, unknown>> = [];
  const response = await createStripeWebhookHandler(dependencies({
    operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    retrieveRefund: async () =>
      refundFixture({
        amount: 1_000,
        metadata: {
          order_id: ORDER_ID,
          whereto_refund_policy: "destination_v1",
          whereto_reverse_transfer: "true",
          whereto_refund_application_fee: "true",
          whereto_transfer_reversal_amount: "1000",
          whereto_application_fee_refund_id: FEE_REFUND_ID,
          whereto_application_fee_refund_amount: "100",
        },
      }),
    retrieveTransfer: async () =>
      transferFixture({
        amount: 5_500,
        amount_reversed: 5_500,
        reversed: true,
      }),
    retrieveTransferReversal: async () =>
      transferReversalFixture({ amount: 1_000 }),
    retrieveApplicationFee: async () =>
      applicationFeeFixture({ amount_refunded: 450 }),
    retrieveApplicationFeeRefund: async () => feeRefundFixture({ amount: 100 }),
    applyRefund: async () => ({
      orderId: ORDER_ID,
      orderStatus: "refunded",
      ticketStatus: null,
    }),
  }))(request(snapshotEvent(
    "refund.updated",
    { id: REFUND_ID },
    { id: "evt_Task10PrePaymentRefund" },
  )));

  assertEquals(response.status, 200);
  assertEquals(records, [{
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "review",
    orderId: ORDER_ID,
    stripeEventId: "evt_Task10PrePaymentRefund",
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 1_000,
    resultStatus: "refunded",
    ticketStatus: "none",
    errorCode: "REFUND_DURABLE_STATE_REVIEW",
  }]);
});

Deno.test("policy-valid aggregate refund review emits a truthful durable-state reason", async () => {
  const records: Array<Record<string, unknown>> = [];
  const response = await createStripeWebhookHandler(dependencies({
    operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    retrieveRefund: async () =>
      refundFixture({
        amount: 1_000,
        metadata: {
          order_id: ORDER_ID,
          whereto_refund_policy: "destination_v1",
          whereto_reverse_transfer: "true",
          whereto_refund_application_fee: "true",
          whereto_transfer_reversal_amount: "1000",
          whereto_application_fee_refund_id: FEE_REFUND_ID,
          whereto_application_fee_refund_amount: "100",
        },
      }),
    retrieveTransfer: async () =>
      transferFixture({
        amount: 5_500,
        amount_reversed: 5_500,
        reversed: true,
      }),
    retrieveTransferReversal: async () =>
      transferReversalFixture({ amount: 1_000 }),
    retrieveApplicationFee: async () =>
      applicationFeeFixture({ amount_refunded: 450 }),
    retrieveApplicationFeeRefund: async () => feeRefundFixture({ amount: 100 }),
    applyRefund: async () => ({
      orderId: ORDER_ID,
      orderStatus: "requires_review",
      ticketStatus: "cancelled",
    }),
  }))(request(snapshotEvent(
    "refund.updated",
    { id: REFUND_ID },
    { id: "evt_Task10PartialRefundReview" },
  )));

  assertEquals(response.status, 200);
  assertEquals(records, [{
    contractVersion: "checkout_integrity_v1",
    operation: "refund.reconcile",
    outcome: "review",
    orderId: ORDER_ID,
    stripeEventId: "evt_Task10PartialRefundReview",
    providerObjectId: REFUND_ID,
    currency: "usd",
    amountMinor: 1_000,
    resultStatus: "requires_review",
    ticketStatus: "cancelled",
    errorCode: "REFUND_DURABLE_STATE_REVIEW",
  }]);
});

Deno.test("missing automatic-refund policy persists authoritative mismatch evidence for review", async () => {
  let applied: unknown;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveRefund: async () => refundFixture({ metadata: {} }),
    retrieveTransfer: async () =>
      transferFixture({
        amount: 5_500,
        amount_reversed: 5_500,
        reversed: true,
      }),
    retrieveTransferReversal: async () =>
      transferReversalFixture({ amount: 5_500 }),
    applyRefund: async (snapshot) => {
      applied = snapshot;
      return REFUND_APPLY_RESULT;
    },
  }))(request(snapshotEvent("refund.updated", { id: REFUND_ID })));

  assertEquals(response.status, 200);
  assertEquals((applied as Record<string, unknown>)?.policyVerified, false);
  assertEquals(
    (applied as Record<string, unknown>)?.policyFailureCode,
    "REFUND_POLICY_MISMATCH",
  );
  assertEquals(
    (applied as Record<string, unknown>)?.transferReversalAmountMinor,
    5_500,
  );
});

Deno.test("permanent refund evidence lookup mismatches persist succeeded money for bounded review", async () => {
  for (const failedLookup of ["reversal", "fee_refund"] as const) {
    let applied: Record<string, unknown> | undefined;
    const response = await createStripeWebhookHandler(dependencies({
      retrieveTransfer: async () =>
        transferFixture({
          amount: 5_500,
          amount_reversed: 5_500,
          reversed: true,
        }),
      retrieveTransferReversal: async () => {
        if (failedLookup === "reversal") {
          throw { type: "StripeInvalidRequestError" };
        }
        return transferReversalFixture({ amount: 5_500 });
      },
      retrieveApplicationFeeRefund: async () => {
        if (failedLookup === "fee_refund") {
          throw { type: "StripeInvalidRequestError" };
        }
        return feeRefundFixture();
      },
      applyRefund: async (snapshot) => {
        applied = snapshot as unknown as Record<string, unknown>;
        return REFUND_APPLY_RESULT;
      },
    }))(request(snapshotEvent(
      "refund.updated",
      { id: REFUND_ID },
      {
        id: `evt_Task8PermanentEvidence${
          failedLookup === "reversal" ? "Reversal" : "FeeRefund"
        }`,
      },
    )));

    assertEquals(response.status, 200);
    assertEquals(applied?.policyVerified, false);
    assertEquals(applied?.policyFailureCode, "REFUND_POLICY_MISMATCH");
    assertEquals(applied?.transferReversalId, REFUND_REVERSAL_ID);
    assertEquals(applied?.applicationFeeRefundId, FEE_REFUND_ID);
    assertEquals(
      applied?.transferReversalAmountMinor,
      failedLookup === "reversal" ? 0 : 5_500,
    );
    assertEquals(
      applied?.applicationFeeRefundAmountMinor,
      failedLookup === "fee_refund" ? 0 : 450,
    );
  }
});

Deno.test("refund evidence network, authentication, and permission failures remain retryable", async () => {
  const errors = [
    { type: "StripeConnectionError" },
    new Stripe.errors.StripeAuthenticationError({
      message: "test authentication failure",
      type: "invalid_request_error",
      statusCode: 401,
    }),
    new Stripe.errors.StripePermissionError({
      message: "test permission failure",
      type: "invalid_request_error",
      statusCode: 403,
    }),
  ];

  for (const [index, stripeError] of errors.entries()) {
    let applied = false;
    const finalizations: unknown[] = [];
    const response = await createStripeWebhookHandler(dependencies({
      retrieveTransfer: async () =>
        transferFixture({
          amount: 5_500,
          amount_reversed: 5_500,
          reversed: true,
        }),
      retrieveTransferReversal: async () => {
        throw stripeError;
      },
      applyRefund: async () => {
        applied = true;
        return REFUND_APPLY_RESULT;
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    }))(request(snapshotEvent(
      "refund.updated",
      { id: REFUND_ID },
      { id: `evt_Task8RetryableEvidence${index}` },
    )));

    assertEquals([response.status, applied], [503, false]);
    assertEquals(finalizations, [[
      `evt_Task8RetryableEvidence${index}`,
      "failed",
      "TRANSIENT_PROCESSING_FAILURE",
    ]]);
  }
});

Deno.test("refund metadata enrichment advances the same succeeded refund from bounded mismatch to exact evidence", async () => {
  const applied: Array<Record<string, unknown>> = [];
  let retrieval = 0;
  const testDependencies = dependencies({
    retrieveRefund: async () => {
      retrieval += 1;
      if (retrieval === 1) {
        return refundFixture({
          metadata: {
            order_id: ORDER_ID,
            whereto_refund_policy: "destination_v1",
            whereto_reverse_transfer: "true",
            whereto_refund_application_fee: "true",
          },
        });
      }
      return refundFixture();
    },
    retrieveTransfer: async () =>
      transferFixture({
        amount: 5_500,
        amount_reversed: 5_500,
        reversed: true,
      }),
    retrieveTransferReversal: async () =>
      transferReversalFixture({ amount: 5_500 }),
    applyRefund: async (snapshot) => {
      applied.push(snapshot as unknown as Record<string, unknown>);
      return REFUND_APPLY_RESULT;
    },
  });

  const raced = await createStripeWebhookHandler(testDependencies)(request(
    snapshotEvent(
      "refund.updated",
      { id: REFUND_ID },
      { id: "evt_Task8RefundMetadataRace" },
    ),
  ));
  const enriched = await createStripeWebhookHandler(testDependencies)(request(
    snapshotEvent(
      "refund.updated",
      { id: REFUND_ID },
      { id: "evt_Task8RefundMetadataEnriched" },
    ),
  ));

  assertEquals([raced.status, enriched.status], [200, 200]);
  assertEquals(
    applied.map((snapshot) => ({
      policyVerified: snapshot.policyVerified,
      policyFailureCode: snapshot.policyFailureCode,
      reversalAmount: snapshot.transferReversalAmountMinor,
      feeRefundAmount: snapshot.applicationFeeRefundAmountMinor,
    })),
    [
      {
        policyVerified: false,
        policyFailureCode: "REFUND_POLICY_MISMATCH",
        reversalAmount: 5_500,
        feeRefundAmount: 0,
      },
      {
        policyVerified: true,
        policyFailureCode: null,
        reversalAmount: 5_500,
        feeRefundAmount: 450,
      },
    ],
  );
});

Deno.test("a failed refund event reconciles the current authoritative failed refund state", async () => {
  let status: string | undefined;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveRefund: async () => refundFixture({ status: "failed" }),
    applyRefund: async (snapshot) => {
      status = snapshot.status;
      return REFUND_APPLY_RESULT;
    },
  }))(request(snapshotEvent(
    "refund.failed",
    { id: REFUND_ID },
    { id: "evt_Task14RefundFailed" },
  )));

  assertEquals([response.status, status], [200, "failed"]);
});

Deno.test("dispute reconciliation recovers the destination transfer once with deterministic idempotency and persists validated truth", async () => {
  let applied: DisputeSnapshot | undefined;
  let reversalCall: unknown;
  const response = await createStripeWebhookHandler(dependencies({
    createTransferReversal: async (transferId, params, options) => {
      reversalCall = { transferId, params, options };
      return transferReversalFixture({
        id: DISPUTE_REVERSAL_ID,
        source_refund: null,
        metadata: { dispute_id: DISPUTE_ID, order_id: ORDER_ID },
      });
    },
    applyDispute: async (snapshot) => {
      applied = snapshot;
    },
  }))(request(snapshotEvent("charge.dispute.updated", { id: DISPUTE_ID })));

  assertEquals(response.status, 200);
  assertEquals(reversalCall, {
    transferId: TRANSFER_ID,
    params: {
      amount: 5_050,
      metadata: { dispute_id: DISPUTE_ID, order_id: ORDER_ID },
    },
    options: { idempotencyKey: `whereto-dispute-recovery-${DISPUTE_ID}` },
  });
  assertEquals(applied, {
    stripeEventId: "evt_chargedisputeupdatedTask14",
    orderId: ORDER_ID,
    stripeDisputeId: DISPUTE_ID,
    paymentIntentId: PAYMENT_INTENT_ID,
    chargeId: CHARGE_ID,
    status: "needs_response",
    amountMinor: 5_500,
    currency: "usd",
    recoveryStatus: "recovered",
    transferReversalId: DISPUTE_REVERSAL_ID,
  });
});

Deno.test("a dispute without withdrawn funds records not-applicable recovery and never calls Stripe reversal", async () => {
  let reversalCalls = 0;
  let applied: DisputeSnapshot | undefined;
  const response = await createStripeWebhookHandler(dependencies({
    retrieveDispute: async () => disputeFixture({ status: "won" }),
    createTransferReversal: async () => {
      reversalCalls += 1;
      return transferReversalFixture();
    },
    applyDispute: async (snapshot) => {
      applied = snapshot;
    },
  }))(request(snapshotEvent("charge.dispute.closed", { id: DISPUTE_ID })));

  assertEquals([response.status, reversalCalls, applied?.recoveryStatus], [
    200,
    0,
    "not_applicable",
  ]);
});

Deno.test("dispute reversal transport failures retry, while invalid reversal requests persist failed recovery", async () => {
  const failedRecoveries: string[] = [];
  const transientFinalizations: unknown[] = [];
  const permanent = await createStripeWebhookHandler(dependencies({
    createTransferReversal: async () => {
      throw { type: "StripeInvalidRequestError" };
    },
    applyDispute: async (snapshot) => {
      failedRecoveries.push(snapshot.recoveryStatus);
    },
  }))(request(snapshotEvent("charge.dispute.created", { id: DISPUTE_ID })));
  const transient = await createStripeWebhookHandler(dependencies({
    createTransferReversal: async () => {
      throw { type: "StripeConnectionError" };
    },
    applyDispute: async () => {
      throw new Error("must remain retryable before persistence");
    },
    finalizeReceipt: async (...args) => {
      transientFinalizations.push(args);
    },
  }))(request(snapshotEvent(
    "charge.dispute.created",
    { id: DISPUTE_ID },
    { id: "evt_Task14DisputeTransient" },
  )));

  assertEquals([permanent.status, failedRecoveries], [200, ["failed"]]);
  assertEquals([transient.status, transientFinalizations], [503, [[
    "evt_Task14DisputeTransient",
    "failed",
    "TRANSIENT_PROCESSING_FAILURE",
  ]]]);
});

Deno.test("Stripe authentication and permission failures keep dispute recovery retryable until corrected", async () => {
  for (
    const stripeError of [
      new Stripe.errors.StripeAuthenticationError({
        message: "test authentication failure",
        type: "invalid_request_error",
        statusCode: 401,
      }),
      new Stripe.errors.StripePermissionError({
        message: "test permission failure",
        type: "invalid_request_error",
        statusCode: 403,
      }),
    ]
  ) {
    let reversalAttempts = 0;
    const recoveries: string[] = [];
    const finalizations: unknown[] = [];
    const testDependencies = dependencies({
      createTransferReversal: async () => {
        reversalAttempts += 1;
        if (reversalAttempts === 1) throw stripeError;
        return transferReversalFixture({
          id: DISPUTE_REVERSAL_ID,
          amount: 5_050,
          source_refund: null,
          metadata: { dispute_id: DISPUTE_ID, order_id: ORDER_ID },
        });
      },
      applyDispute: async (snapshot) => {
        recoveries.push(snapshot.recoveryStatus);
      },
      finalizeReceipt: async (...args) => {
        finalizations.push(args);
      },
    });
    const event = snapshotEvent(
      "charge.dispute.created",
      { id: DISPUTE_ID },
      { id: `evt_Task14DisputeRetry${stripeError.statusCode}` },
    );

    const failed = await createStripeWebhookHandler(testDependencies)(
      request(event),
    );
    const corrected = await createStripeWebhookHandler(testDependencies)(
      request(event),
    );

    assertEquals(stripeError instanceof Stripe.errors.StripeError, true);
    assertEquals([failed.status, corrected.status], [503, 200]);
    assertEquals(recoveries, ["recovered"]);
    assertEquals(finalizations, [[
      `evt_Task14DisputeRetry${stripeError.statusCode}`,
      "failed",
      "TRANSIENT_PROCESSING_FAILURE",
    ]]);
  }
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

Deno.test("webhook operational events distinguish duplicate, reconciliation mismatch, retry, fulfillment, and refund review", async () => {
  const records: Array<Record<string, unknown>> = [];
  const operationalSink = (serialized: string) => {
    records.push(JSON.parse(serialized));
  };

  await createStripeWebhookHandler(dependencies({
    operationalSink,
    recordReceipt: async () => ({ shouldProcess: false }),
  }))(request(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task10Duplicate" },
  )));

  await createStripeWebhookHandler(dependencies({
    operationalSink,
    retrieveSession: async () =>
      checkoutSessionFixture({
        line_items: {
          ...checkoutLineItemsFixture(),
          data: [checkoutLineFixture(ORDER_ITEMS[0])],
        },
      }),
  }))(request(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task10Mismatch" },
  )));

  await createStripeWebhookHandler(dependencies({
    operationalSink,
    retrieveSession: async () => {
      throw new TypeError("fixture provider unavailable");
    },
  }))(request(snapshotEvent(
    "checkout.session.completed",
    { id: SESSION_ID },
    { id: "evt_Task10Retry" },
  )));

  await createStripeWebhookHandler(dependencies({ operationalSink }))(
    request(snapshotEvent(
      "checkout.session.completed",
      { id: SESSION_ID },
      { id: "evt_Task10Fulfilled" },
    )),
  );

  await createStripeWebhookHandler(dependencies({
    operationalSink,
    retrieveRefund: async () => refundFixture({ metadata: {} }),
    retrieveTransfer: async () =>
      transferFixture({
        amount: 5_500,
        amount_reversed: 5_500,
        reversed: true,
      }),
    retrieveTransferReversal: async () =>
      transferReversalFixture({ amount: 5_500 }),
    applyRefund: async () => ({
      orderId: ORDER_ID,
      orderStatus: "requires_review",
      ticketStatus: "cancelled",
    }),
  }))(request(snapshotEvent(
    "refund.updated",
    { id: REFUND_ID },
    { id: "evt_Task10RefundReview" },
  )));

  assertEquals(records, [
    {
      contractVersion: "checkout_integrity_v1",
      operation: "webhook.delivery",
      outcome: "duplicate",
      stripeEventId: "evt_Task10Duplicate",
      providerObjectId: SESSION_ID,
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "webhook.reconciliation",
      outcome: "mismatch",
      orderId: ORDER_ID,
      stripeEventId: "evt_Task10Mismatch",
      providerObjectId: SESSION_ID,
      itemCount: 2,
      aggregateQuantity: 3,
      currency: "usd",
      subtotalMinor: 5_500,
      totalMinor: 5_500,
      errorCode: "CHECKOUT_LINE_COUNT_MISMATCH",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "webhook.delivery",
      outcome: "retry",
      stripeEventId: "evt_Task10Retry",
      providerObjectId: SESSION_ID,
      errorCode: "TRANSIENT_PROCESSING_FAILURE",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "webhook.fulfillment",
      outcome: "fulfilled",
      orderId: ORDER_ID,
      stripeEventId: "evt_Task10Fulfilled",
      providerObjectId: SESSION_ID,
      itemCount: 2,
      aggregateQuantity: 3,
      currency: "usd",
      subtotalMinor: 5_500,
      totalMinor: 5_500,
      applicationFeeAmountMinor: 450,
      actualTicketCount: 3,
      resultStatus: "paid",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "refund.reconcile",
      outcome: "review",
      orderId: ORDER_ID,
      stripeEventId: "evt_Task10RefundReview",
      providerObjectId: REFUND_ID,
      currency: "usd",
      amountMinor: 5_500,
      resultStatus: "requires_review",
      ticketStatus: "cancelled",
      errorCode: "REFUND_POLICY_MISMATCH",
    },
  ]);
});
