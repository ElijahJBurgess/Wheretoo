// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import {
  type CancellationOrder,
  type CancellationOrderStatus,
  createStripeCancelCheckoutHandler,
  defaultFindOrder,
  type StripeCancelCheckoutDependencies,
} from "./index.ts";

const APP_ORIGIN = "https://whereto.example";
const TOKEN = "tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng";
const TOKEN_HASH =
  "e09ec484378583aa52cadee9787fdee4dc67a764ab98c0883c9413f7c2cc53e1";
const ORDER_ID = "11111111-2222-4333-8444-555555555555";
const SESSION_ID = "cs_test_Task12Checkout";

function request(body: unknown = { confirmationToken: TOKEN }): Request {
  return new Request("https://functions.example/stripe-cancel-checkout", {
    method: "POST",
    headers: { origin: APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function order(
  status: CancellationOrderStatus = "checkout_open",
  sessionId: string | null = SESSION_ID,
): CancellationOrder {
  return { orderId: ORDER_ID, status, stripeCheckoutSessionId: sessionId };
}

function session(
  status: string,
  livemode = false,
  paymentStatus: string = "unpaid",
): Record<string, unknown> {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    livemode,
    status,
    payment_status: paymentStatus,
    metadata: { order_id: ORDER_ID },
  };
}

function dependencies(
  overrides: Partial<StripeCancelCheckoutDependencies> = {},
): StripeCancelCheckoutDependencies {
  return {
    appOrigin: APP_ORIGIN,
    rateLimit: async () => ({ allowed: true }),
    findOrder: async () => order(),
    retrieveSession: async () => session("open"),
    expireSession: async () => session("expired"),
    releaseReservation: async () => undefined,
    operationalSink: () => undefined,
    ...overrides,
  } as StripeCancelCheckoutDependencies;
}

Deno.test("cancellation hashes the bearer token, verifies an open test Session, expires it, then releases inventory", async () => {
  const calls: string[] = [];
  const response = await createStripeCancelCheckoutHandler(dependencies({
    findOrder: async (tokenHash) => {
      calls.push("find");
      assertEquals(tokenHash, TOKEN_HASH);
      return order();
    },
    retrieveSession: async (sessionId) => {
      calls.push("retrieve");
      assertEquals(sessionId, SESSION_ID);
      return session("open");
    },
    expireSession: async (sessionId) => {
      calls.push("expire");
      assertEquals(sessionId, SESSION_ID);
      return session("expired");
    },
    releaseReservation: async (orderId, reason) => {
      calls.push("release");
      assertEquals([orderId, reason], [ORDER_ID, "CHECKOUT_CANCELLED"]);
    },
  }))(request());

  assertEquals(calls, ["find", "retrieve", "expire", "release"]);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { cancelled: true });
});

Deno.test("cancellation rejects malformed, noncanonical, or unknown bearer tokens without Stripe disclosure", async () => {
  for (
    const confirmationToken of ["short", `${TOKEN}=`, `${TOKEN.slice(0, -1)}!`]
  ) {
    let found = false;
    const response = await createStripeCancelCheckoutHandler(dependencies({
      findOrder: async () => {
        found = true;
        return order();
      },
    }))(request({ confirmationToken }));
    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: { code: "INVALID_REQUEST" },
    });
    assertEquals(found, false);
  }

  const missing = await createStripeCancelCheckoutHandler(dependencies({
    findOrder: async () => null,
  }))(request());
  assertEquals(missing.status, 404);
  assertEquals(await missing.json(), {
    error: { code: "CHECKOUT_NOT_FOUND" },
  });
});

Deno.test("cancellation rejects a live or wrong-order Stripe Session and never releases inventory", async () => {
  for (
    const invalid of [
      session("open", true),
      { ...session("open"), metadata: { order_id: "wrong" } },
      { ...session("open"), id: "cs_test_wrong" },
    ]
  ) {
    let released = false;
    const response = await createStripeCancelCheckoutHandler(dependencies({
      retrieveSession: async () => invalid,
      releaseReservation: async () => {
        released = true;
      },
    }))(request());
    assertEquals(response.status, 502);
    assertEquals(await response.json(), {
      error: { code: "INVALID_STRIPE_SESSION" },
    });
    assertEquals(released, false);
  }
});

Deno.test("cancellation never downgrades a complete Session while its webhook may still be pending", async () => {
  let expired = false;
  let released = false;
  const response = await createStripeCancelCheckoutHandler(dependencies({
    retrieveSession: async () => session("complete"),
    expireSession: async () => {
      expired = true;
      return session("expired");
    },
    releaseReservation: async () => {
      released = true;
    },
  }))(request());

  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: { code: "CHECKOUT_UNAVAILABLE" },
  });
  assertEquals(expired, false);
  assertEquals(released, false);
});

Deno.test("cancellation idempotently releases an already-expired Session without expiring it twice", async () => {
  let expired = false;
  let released = false;
  const response = await createStripeCancelCheckoutHandler(dependencies({
    retrieveSession: async () => session("expired"),
    expireSession: async () => {
      expired = true;
      return session("expired");
    },
    releaseReservation: async () => {
      released = true;
    },
  }))(request());

  assertEquals(response.status, 200);
  assertEquals(expired, false);
  assertEquals(released, true);
});

Deno.test("cancellation refuses terminal database retries without an attached Session", async () => {
  for (
    const status of [
      "cancelled",
      "expired",
      "payment_failed",
    ] as const
  ) {
    let stripeTouched = false;
    const response = await createStripeCancelCheckoutHandler(dependencies({
      findOrder: async () => order(status, null),
      retrieveSession: async () => {
        stripeTouched = true;
        return session("open");
      },
      releaseReservation: async () => {
        stripeTouched = true;
      },
    }))(request());
    assertEquals(response.status, 409);
    assertEquals(await response.json(), {
      error: { code: "CHECKOUT_UNAVAILABLE" },
    });
    assertEquals(stripeTouched, false);
  }
});

for (const status of ["cancelled", "expired", "payment_failed"] as const) {
  Deno.test(`cancellation rejects ambiguous complete Session states for ${status}`, async () => {
    for (
      const paymentStatus of status === "payment_failed"
        ? ["paid"]
        : ["paid", "unpaid"]
    ) {
      const calls: string[] = [];
      const response = await createStripeCancelCheckoutHandler(dependencies({
        findOrder: async () => order(status),
        retrieveSession: async (sessionId) => {
          calls.push("retrieve");
          assertEquals(sessionId, SESSION_ID);
          return session("complete", false, paymentStatus);
        },
        expireSession: async () => {
          calls.push("expire");
          return session("expired");
        },
        releaseReservation: async () => {
          calls.push("release");
        },
      }))(request());

      assertEquals(response.status, 409);
      assertEquals(await response.json(), {
        error: { code: "CHECKOUT_UNAVAILABLE" },
      });
      assertEquals(calls, ["retrieve"]);
    }
  });

  Deno.test(`cancellation acknowledges ${status} with exact expired unpaid provider evidence`, async () => {
    const calls: string[] = [];
    const records: Array<Record<string, unknown>> = [];
    const response = await createStripeCancelCheckoutHandler(dependencies({
      findOrder: async () => order(status),
      retrieveSession: async (sessionId) => {
        calls.push("retrieve");
        assertEquals(sessionId, SESSION_ID);
        return session("expired");
      },
      expireSession: async () => {
        calls.push("expire");
        return session("expired");
      },
      releaseReservation: async () => {
        calls.push("release");
      },
      operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    }))(request());

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { cancelled: true });
    assertEquals(calls, ["retrieve"]);
    assertEquals(records, [{
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.cancel",
      outcome: "no_transition",
      orderId: ORDER_ID,
      providerObjectId: SESSION_ID,
      priorStatus: status,
      resultStatus: status,
    }]);
  });
}

Deno.test("cancellation acknowledges confirmed async payment failure with a complete unpaid Session without mutation", async () => {
  const calls: string[] = [];
  const records: Array<Record<string, unknown>> = [];
  const response = await createStripeCancelCheckoutHandler(dependencies({
    findOrder: async (tokenHash) => {
      assertEquals(tokenHash, TOKEN_HASH);
      return order("payment_failed");
    },
    retrieveSession: async (sessionId) => {
      calls.push("retrieve");
      assertEquals(sessionId, SESSION_ID);
      return session("complete", false, "unpaid");
    },
    expireSession: async () => {
      calls.push("expire");
      return session("expired");
    },
    releaseReservation: async () => {
      calls.push("release");
    },
    operationalSink: (serialized) => records.push(JSON.parse(serialized)),
  }))(request());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { cancelled: true });
  assertEquals(calls, ["retrieve"]);
  assertEquals(records, [{
    contractVersion: "checkout_integrity_v1",
    operation: "checkout.cancel",
    outcome: "no_transition",
    orderId: ORDER_ID,
    providerObjectId: SESSION_ID,
    priorStatus: "payment_failed",
    resultStatus: "payment_failed",
  }]);
});

Deno.test("terminal database cancellation fails closed on open, paid, unbound, live, malformed, or unavailable provider evidence", async () => {
  const cases = [
    { evidence: session("open"), status: 409, code: "CHECKOUT_UNAVAILABLE" },
    {
      evidence: session("complete", true),
      status: 502,
      code: "INVALID_STRIPE_SESSION",
    },
    {
      evidence: { ...session("complete"), metadata: { order_id: "wrong" } },
      status: 502,
      code: "INVALID_STRIPE_SESSION",
    },
    {
      evidence: { ...session("complete"), payment_status: undefined },
      status: 502,
      code: "INVALID_STRIPE_SESSION",
    },
    {
      evidence: session("expired", false, "paid"),
      status: 502,
      code: "INVALID_STRIPE_SESSION",
    },
    {
      evidence: session("expired", true),
      status: 502,
      code: "INVALID_STRIPE_SESSION",
    },
    {
      evidence: { ...session("expired"), metadata: { order_id: "wrong" } },
      status: 502,
      code: "INVALID_STRIPE_SESSION",
    },
    {
      evidence: { ...session("expired"), id: "cs_test_wrong" },
      status: 502,
      code: "INVALID_STRIPE_SESSION",
    },
    {
      evidence: { ...session("expired"), payment_status: undefined },
      status: 502,
      code: "INVALID_STRIPE_SESSION",
    },
    { evidence: null, status: 502, code: "INVALID_STRIPE_SESSION" },
    {
      evidence: new Error("unsafe provider transport detail"),
      status: 502,
      code: "STRIPE_REQUEST_FAILED",
    },
  ];
  for (
    const terminalStatus of ["cancelled", "expired", "payment_failed"] as const
  ) {
    for (const scenario of cases) {
      const calls: string[] = [];
      const response = await createStripeCancelCheckoutHandler(dependencies({
        findOrder: async () => order(terminalStatus),
        retrieveSession: async () => {
          calls.push("retrieve");
          if (scenario.evidence instanceof Error) throw scenario.evidence;
          return scenario.evidence;
        },
        expireSession: async () => {
          calls.push("expire");
          return session("expired");
        },
        releaseReservation: async () => {
          calls.push("release");
        },
      }))(request());
      assertEquals(response.status, scenario.status);
      assertEquals(await response.json(), { error: { code: scenario.code } });
      assertEquals(calls, ["retrieve"]);
    }
  }
});

Deno.test("cancellation refuses paid, processing, refund, and review orders without contacting Stripe or releasing inventory", async () => {
  for (
    const status of [
      "payment_processing",
      "paid",
      "partially_refunded",
      "refunded",
      "requires_review",
    ] as const
  ) {
    let touched = false;
    const response = await createStripeCancelCheckoutHandler(dependencies({
      findOrder: async () => order(status),
      retrieveSession: async () => {
        touched = true;
        return session("open");
      },
      releaseReservation: async () => {
        touched = true;
      },
    }))(request());
    assertEquals(response.status, 409, status);
    assertEquals(await response.json(), {
      error: { code: "CHECKOUT_UNAVAILABLE" },
    }, status);
    assertEquals(touched, false, status);
  }
});

Deno.test("cancellation requires authoritative unpaid state before expiring and releasing the whole order", async () => {
  for (
    const unsafe of [
      session("open", false, "paid"),
      session("expired", false, "paid"),
      { ...session("open"), payment_status: "no_payment_required" },
      (() => {
        const value = session("open");
        delete value.payment_status;
        return value;
      })(),
    ]
  ) {
    let mutated = false;
    const response = await createStripeCancelCheckoutHandler(dependencies({
      retrieveSession: async () => unsafe,
      expireSession: async () => {
        mutated = true;
        return session("expired");
      },
      releaseReservation: async () => {
        mutated = true;
      },
    }))(request());
    assertEquals(response.status, 502);
    assertEquals(mutated, false);
  }
});

Deno.test("cancellation releases one multi-item order boundary only after open unpaid becomes expired unpaid", async () => {
  const released: Array<[string, string]> = [];
  const response = await createStripeCancelCheckoutHandler(dependencies({
    retrieveSession: async () => session("open", false, "unpaid"),
    expireSession: async () => session("expired", false, "unpaid"),
    releaseReservation: async (orderId, reason) => {
      released.push([orderId, reason]);
    },
  }))(request());

  assertEquals(response.status, 200);
  assertEquals(released, [[ORDER_ID, "CHECKOUT_CANCELLED"]]);
});

Deno.test("cancellation retains a token-bound creating order when no exact Stripe Session is attached", async () => {
  let released = false;
  const response = await createStripeCancelCheckoutHandler(dependencies({
    findOrder: async () => order("creating_checkout", null),
    retrieveSession: async () => {
      throw new Error("must not retrieve a missing Session");
    },
    releaseReservation: async () => {
      released = true;
    },
  }))(request());
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: { code: "CHECKOUT_UNAVAILABLE" },
  });
  assertEquals(released, false);
});

Deno.test("cancellation enforces strict input, rate limiting, and exact-origin CORS", async () => {
  const strict = await createStripeCancelCheckoutHandler(dependencies())(
    request({ confirmationToken: TOKEN, orderId: ORDER_ID }),
  );
  assertEquals(strict.status, 400);

  const limited = await createStripeCancelCheckoutHandler(dependencies({
    rateLimit: async () => ({ allowed: false, retryAfterSeconds: 12 }),
  }))(request());
  assertEquals(limited.status, 429);
  assertEquals(limited.headers.get("retry-after"), "12");
  assertEquals(await limited.json(), { error: { code: "RATE_LIMITED" } });

  const denied = await createStripeCancelCheckoutHandler(dependencies())(
    new Request("https://functions.example/stripe-cancel-checkout", {
      method: "POST",
      headers: {
        origin: `${APP_ORIGIN}.attacker.test`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmationToken: TOKEN }),
    }),
  );
  assertEquals(denied.status, 403);
  assertEquals(await denied.json(), {
    error: { code: "CORS_ORIGIN_DENIED" },
  });
});

Deno.test("default cancellation resolves its bearer through the narrow service-only RPC", async () => {
  let capturedName = "";
  let capturedArgs: Record<string, unknown> | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capturedName = name;
      capturedArgs = args;
      return {
        data: [{
          order_id: ORDER_ID,
          status: "checkout_open",
          stripe_checkout_session_id: SESSION_ID,
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof defaultFindOrder>[1];
  assertEquals(await defaultFindOrder(TOKEN_HASH, client), order());
  assertEquals(capturedName, "server_lookup_checkout_cancellation");
  assertEquals(capturedArgs, { p_token_hash: TOKEN_HASH });
});

Deno.test("cancellation emits truthful transition, no-transition, blocked, and ambiguous outcomes", async () => {
  const records: Array<Record<string, unknown>> = [];
  const operationalSink = (serialized: string) => {
    records.push(JSON.parse(serialized));
  };

  const cancelled = await createStripeCancelCheckoutHandler(dependencies({
    operationalSink,
  }))(request());
  const noTransition = await createStripeCancelCheckoutHandler(dependencies({
    operationalSink,
    findOrder: async () => order("expired"),
    retrieveSession: async () => session("expired"),
  }))(request());
  const blocked = await createStripeCancelCheckoutHandler(dependencies({
    operationalSink,
    findOrder: async () => order("paid"),
  }))(request());
  const ambiguous = await createStripeCancelCheckoutHandler(dependencies({
    operationalSink,
    retrieveSession: async () => {
      throw new Error("fixture provider error with unsafe detail");
    },
  }))(request());

  assertEquals(
    [cancelled.status, noTransition.status, blocked.status, ambiguous.status],
    [200, 200, 409, 502],
  );
  assertEquals(records, [
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.cancel",
      outcome: "cancelled",
      orderId: ORDER_ID,
      providerObjectId: SESSION_ID,
      priorStatus: "checkout_open",
      resultStatus: "cancelled",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.cancel",
      outcome: "no_transition",
      orderId: ORDER_ID,
      providerObjectId: SESSION_ID,
      priorStatus: "expired",
      resultStatus: "expired",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.cancel",
      outcome: "blocked",
      orderId: ORDER_ID,
      providerObjectId: SESSION_ID,
      priorStatus: "paid",
      errorCode: "CHECKOUT_UNAVAILABLE",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.cancel",
      outcome: "ambiguous",
      orderId: ORDER_ID,
      providerObjectId: SESSION_ID,
      priorStatus: "checkout_open",
      errorCode: "STRIPE_REQUEST_FAILED",
    },
  ]);
});
