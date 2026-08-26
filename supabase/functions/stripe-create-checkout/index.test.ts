// deno-lint-ignore-file require-await
import { assertEquals, assertStringIncludes } from "@std/assert";
import type Stripe from "stripe";
import {
  createStripeCreateCheckoutHandler,
  deriveConfirmationToken,
  type ReservationSnapshot,
  type StripeCreateCheckoutDependencies,
} from "./index.ts";

const APP_ORIGIN = "https://whereto.example";
const EVENT_ID = "6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe";
const TIER_ID = "eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f";
const REQUEST_ID = "900a9142-9111-4f87-84d5-b8545a94c7fb";
const ORDER_ID = "11111111-2222-4333-8444-555555555555";
const ORGANIZER_ID = "22222222-3333-4444-8555-666666666666";
const ACCOUNT_ID = "acct_Task12Destination";
const SESSION_ID = "cs_test_Task12Checkout";
const EXPIRES_AT = "2026-08-26T20:30:00.000Z";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/task12";

const validBody = {
  eventId: EVENT_ID,
  tierId: TIER_ID,
  guestName: "Avery Stone",
  guestEmail: "avery@example.com",
  clientRequestId: REQUEST_ID,
};

function request(body: unknown = validBody, origin = APP_ORIGIN): Request {
  return new Request("https://functions.example/stripe-create-checkout", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function reservation(
  existingCheckoutSessionId: string | null = null,
): ReservationSnapshot {
  return {
    orderId: ORDER_ID,
    organizerId: ORGANIZER_ID,
    subtotalMinor: 2_000,
    currency: "usd",
    applicationFeeAmountMinor: 150,
    stripeAccountId: ACCOUNT_ID,
    checkoutExpiresAt: EXPIRES_AT,
    existingCheckoutSessionId,
  };
}

function sessionFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const token = "tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng";
  return {
    id: SESSION_ID,
    object: "checkout.session",
    livemode: false,
    mode: "payment",
    status: "open",
    payment_status: "unpaid",
    currency: "usd",
    amount_subtotal: 2_000,
    amount_total: 2_000,
    customer_email: "avery@example.com",
    expires_at: 1_787_776_200,
    client_reference_id: ORDER_ID,
    success_url: `${APP_ORIGIN}/orders/${token}`,
    cancel_url: `${APP_ORIGIN}/events/${EVENT_ID}/checkout?cancel=${token}`,
    integration_identifier: "whereto_checkout_abcdefgh",
    metadata: { order_id: ORDER_ID, event_id: EVENT_ID, tier_id: TIER_ID },
    automatic_tax: { enabled: false },
    url: CHECKOUT_URL,
    line_items: {
      data: [{
        quantity: 1,
        currency: "usd",
        amount_subtotal: 2_000,
        amount_total: 2_000,
        price: {
          currency: "usd",
          type: "one_time",
          unit_amount: 2_000,
        },
      }],
      has_more: false,
    },
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<StripeCreateCheckoutDependencies> = {},
): StripeCreateCheckoutDependencies {
  return {
    appOrigin: APP_ORIGIN,
    appBaseUrl: APP_ORIGIN,
    rateLimit: async () => ({ allowed: true }),
    refreshConnect: async () => undefined,
    reserveCheckout: async () => reservation(),
    createSession: async () => sessionFixture(),
    retrieveSession: async () => sessionFixture(),
    expireSession: async () => sessionFixture({ status: "expired" }),
    attachSession: async () => undefined,
    releaseReservation: async () => undefined,
    integrationSuffix: () => "abcdefgh",
    nowEpochSeconds: () => 1_787_774_395,
    ...overrides,
  };
}

Deno.test("checkout derives the approved deterministic URL token and stored hash from the canonical request UUID", async () => {
  assertEquals(await deriveConfirmationToken(REQUEST_ID), {
    clearToken: "tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng",
    tokenHash:
      "e09ec484378583aa52cadee9787fdee4dc67a764ab98c0883c9413f7c2cc53e1",
  });
});

Deno.test("checkout refreshes Connect, reserves authoritative inventory, creates one exact destination Session, then attaches it", async () => {
  const calls: string[] = [];
  let capturedParams: Stripe.Checkout.SessionCreateParams | undefined;
  let capturedOptions: Stripe.RequestOptions | undefined;
  const deps = dependencies({
    refreshConnect: async (eventId, tierId) => {
      calls.push("refresh");
      assertEquals([eventId, tierId], [EVENT_ID, TIER_ID]);
    },
    reserveCheckout: async (input, tokenHash) => {
      calls.push("reserve");
      assertEquals(input, validBody);
      assertEquals(
        tokenHash,
        "e09ec484378583aa52cadee9787fdee4dc67a764ab98c0883c9413f7c2cc53e1",
      );
      return reservation();
    },
    createSession: async (params, options) => {
      calls.push("create");
      capturedParams = params;
      capturedOptions = options;
      return sessionFixture();
    },
    attachSession: async (orderId, sessionId, expiresAt) => {
      calls.push("attach");
      assertEquals([orderId, sessionId, expiresAt], [
        ORDER_ID,
        SESSION_ID,
        new Date(1_787_776_200_000).toISOString(),
      ]);
    },
  });

  const response = await createStripeCreateCheckoutHandler(deps)(
    request({
      ...validBody,
      guestName: "  Avery Stone  ",
      guestEmail: "  AVERY@EXAMPLE.COM  ",
    }),
  );

  assertEquals(calls, ["refresh", "reserve", "create", "attach"]);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { checkoutUrl: CHECKOUT_URL });
  assertEquals(capturedOptions, {
    idempotencyKey: `whereto-checkout-v1:${ORDER_ID}`,
  });
  assertEquals(capturedParams, {
    mode: "payment",
    customer_email: "avery@example.com",
    expires_at: 1_787_776_200,
    success_url:
      `${APP_ORIGIN}/orders/tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng`,
    cancel_url:
      `${APP_ORIGIN}/events/${EVENT_ID}/checkout?cancel=tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng`,
    client_reference_id: ORDER_ID,
    integration_identifier: "whereto_checkout_abcdefgh",
    metadata: { order_id: ORDER_ID, event_id: EVENT_ID, tier_id: TIER_ID },
    payment_intent_data: {
      application_fee_amount: 150,
      transfer_data: { destination: ACCOUNT_ID },
      metadata: { order_id: ORDER_ID, event_id: EVENT_ID, tier_id: TIER_ID },
    },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: 2_000,
        product_data: { name: "Whereto event ticket" },
      },
    }],
    expand: ["line_items"],
  });
  assertEquals(
    Object.hasOwn(capturedParams ?? {}, "payment_method_types"),
    false,
  );
  assertEquals(Object.hasOwn(capturedParams ?? {}, "automatic_tax"), false);
});

Deno.test("checkout retry retrieves and validates the one attached Session without creating or attaching another", async () => {
  const calls: string[] = [];
  const response = await createStripeCreateCheckoutHandler(dependencies({
    refreshConnect: async () => {
      calls.push("refresh");
    },
    reserveCheckout: async () => {
      calls.push("reserve");
      return reservation(SESSION_ID);
    },
    createSession: async () => {
      throw new Error("must not create a second Session");
    },
    retrieveSession: async (sessionId, params) => {
      calls.push("retrieve");
      assertEquals(sessionId, SESSION_ID);
      assertEquals(params, { expand: ["line_items", "payment_intent"] });
      return sessionFixture();
    },
    attachSession: async () => {
      throw new Error("must not reattach an existing Session");
    },
  }))(request());

  assertEquals(calls, ["refresh", "reserve", "retrieve"]);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { checkoutUrl: CHECKOUT_URL });
});

Deno.test("new Checkout gives Stripe at least its full 30-minute minimum after reservation latency", async () => {
  let expiresAt: number | undefined;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    nowEpochSeconds: () => 1_787_774_410,
    createSession: async (params) => {
      expiresAt = params.expires_at;
      return sessionFixture({ expires_at: 1_787_776_210 });
    },
  }))(request());

  assertEquals(response.status, 200);
  assertEquals(expiresAt, 1_787_776_210);
});

Deno.test("checkout rejects unknown browser money, destination, quantity, token, and Session fields before side effects", async () => {
  for (
    const [field, value] of Object.entries({
      subtotalMinor: 2_000,
      currency: "usd",
      applicationFeeAmountMinor: 150,
      stripeAccountId: ACCOUNT_ID,
      quantity: 1,
      confirmationToken: "not-accepted",
      checkoutSessionId: SESSION_ID,
    })
  ) {
    let touched = false;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      refreshConnect: async () => {
        touched = true;
      },
    }))(request({ ...validBody, [field]: value }));
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: { code: "INVALID_REQUEST" } });
    assertEquals(touched, false);
  }
});

Deno.test("checkout rejects malformed identifiers and guest fields before refreshing Connect", async () => {
  for (
    const body of [
      { ...validBody, eventId: "not-a-uuid" },
      {
        ...validBody,
        clientRequestId: "6b849fa0-4d5e-1faa-bf31-b169cb1bd7fe",
      },
      { ...validBody, guestName: " " },
      { ...validBody, guestName: "x".repeat(121) },
      { ...validBody, guestEmail: "not-an-email" },
    ]
  ) {
    let touched = false;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      refreshConnect: async () => {
        touched = true;
      },
    }))(request(body));
    assertEquals(response.status, 400);
    assertEquals(touched, false);
  }
});

Deno.test("checkout fails closed on current Connect readiness before reserving", async () => {
  let reserved = false;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    refreshConnect: async () => {
      throw new Error("current account is not ready");
    },
    reserveCheckout: async () => {
      reserved = true;
      return reservation();
    },
  }))(request());

  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: { code: "CONNECT_NOT_READY" } });
  assertEquals(reserved, false);
});

Deno.test("checkout maps sold out and stale same-request reservations to stable safe outcomes without Stripe", async () => {
  for (
    const [error, status, code] of [
      [new Error("TIER_SOLD_OUT"), 409, "TIER_SOLD_OUT"],
      [null, 410, "CHECKOUT_EXPIRED"],
    ] as const
  ) {
    let stripeTouched = false;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      reserveCheckout: async () => {
        if (error !== null) throw error;
        return null;
      },
      createSession: async () => {
        stripeTouched = true;
        return sessionFixture();
      },
    }))(request());
    assertEquals(response.status, status);
    assertEquals(await response.json(), { error: { code } });
    assertEquals(stripeTouched, false);
  }
});

Deno.test("checkout preserves distinct safe event, tier, and Connect availability codes", async () => {
  for (
    const [databaseCode, status, responseCode] of [
      ["EVENT_NOT_SELLABLE", 409, "EVENT_NOT_SELLABLE"],
      ["TIER_NOT_ACTIVE", 409, "TIER_NOT_ACTIVE"],
      ["TIER_NOT_FOUND", 409, "TIER_NOT_FOUND"],
      ["CONNECT_ACTION_REQUIRED", 409, "CONNECT_ACTION_REQUIRED"],
      ["FEE_RULE_NOT_CONFIGURED", 503, "CHECKOUT_UNAVAILABLE"],
    ] as const
  ) {
    const response = await createStripeCreateCheckoutHandler(dependencies({
      reserveCheckout: async () => {
        throw new Error(databaseCode);
      },
    }))(request());
    assertEquals(response.status, status);
    assertEquals(await response.json(), { error: { code: responseCode } });
  }
});

Deno.test("checkout releases inventory when Stripe creation fails", async () => {
  const released: Array<[string, string]> = [];
  const response = await createStripeCreateCheckoutHandler(dependencies({
    createSession: async () => {
      throw new Error("sensitive upstream detail");
    },
    releaseReservation: async (orderId, reason) => {
      released.push([orderId, reason]);
    },
  }))(request());

  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: { code: "STRIPE_REQUEST_FAILED" },
  });
  assertEquals(released, [[ORDER_ID, "CHECKOUT_CREATION_FAILED"]]);
});

Deno.test("checkout rejects and releases a live or mismatched Stripe Session snapshot", async () => {
  for (
    const invalid of [
      sessionFixture({ livemode: true }),
      sessionFixture({ amount_total: 1_999 }),
      sessionFixture({ metadata: { order_id: "wrong" } }),
      sessionFixture({ url: "https://attacker.example/checkout" }),
    ]
  ) {
    let releases = 0;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      createSession: async () => invalid,
      releaseReservation: async () => {
        releases += 1;
      },
    }))(request());
    assertEquals(response.status, 502);
    assertEquals(await response.json(), {
      error: { code: "INVALID_STRIPE_SESSION" },
    });
    assertEquals(releases, 1);
  }
});

Deno.test("checkout never releases a complete Session while authoritative webhook fulfillment may still be pending", async () => {
  let released = false;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    reserveCheckout: async () => reservation(SESSION_ID),
    retrieveSession: async () =>
      sessionFixture({
        status: "complete",
        payment_status: "paid",
        url: null,
      }),
    releaseReservation: async () => {
      released = true;
    },
  }))(request());

  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: { code: "INVALID_STRIPE_SESSION" },
  });
  assertEquals(released, false);
});

Deno.test("checkout returns an explicit bounded rate response before parsing buyer data", async () => {
  let refreshed = false;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    rateLimit: async () => ({ allowed: false, retryAfterSeconds: 37 }),
    refreshConnect: async () => {
      refreshed = true;
    },
  }))(request({ secretBuyerField: "must-not-be-read" }));

  assertEquals(response.status, 429);
  assertEquals(response.headers.get("retry-after"), "37");
  assertEquals(await response.json(), { error: { code: "RATE_LIMITED" } });
  assertEquals(refreshed, false);
});

Deno.test("checkout permits exact-origin preflight and denies sibling origins without side effects", async () => {
  const handler = createStripeCreateCheckoutHandler(dependencies());
  const preflight = await handler(
    new Request(
      "https://functions.example/stripe-create-checkout",
      { method: "OPTIONS", headers: { origin: APP_ORIGIN } },
    ),
  );
  assertEquals(preflight.status, 204);
  assertEquals(
    preflight.headers.get("access-control-allow-origin"),
    APP_ORIGIN,
  );

  const denied = await handler(
    request(validBody, `${APP_ORIGIN}.attacker.test`),
  );
  assertEquals(denied.status, 403);
  assertEquals(await denied.json(), {
    error: { code: "CORS_ORIGIN_DENIED" },
  });
});

Deno.test("checkout suppresses upstream and database details from its response", async () => {
  const response = await createStripeCreateCheckoutHandler(dependencies({
    reserveCheckout: async () => {
      throw new Error("password=buyer-secret database detail");
    },
  }))(request());
  const raw = await response.text();
  assertEquals(response.status, 500);
  assertEquals(raw, '{"error":{"code":"INTERNAL_ERROR"}}');
  assertEquals(raw.includes("buyer-secret"), false);
  assertStringIncludes(response.headers.get("cache-control") ?? "", "no-store");
});
