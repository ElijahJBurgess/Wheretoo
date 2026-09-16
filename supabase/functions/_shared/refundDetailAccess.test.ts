import { assertEquals } from "@std/assert";
import { createTicketEmailHttpHandler } from "./ticketEmailHttp.ts";
import { createEmailGrant } from "./ticketEmailAccess.ts";
const order = {
  orderNumber: "WT-123",
  eventName: "Past event",
  startsAt: "2026-08-01T20:00:00Z",
  endsAt: "2026-08-01T22:00:00Z",
  timezone: "UTC",
  venueName: "Hall",
  currency: "usd",
  totalMinor: 7000,
  subtotalMinor: 7000,
  quantity: 1,
  items: [{ tierName: "GA", quantity: 1, subtotalMinor: 7000 }],
  refundAmountMinor: 7000,
  completedAt: "2026-09-01T20:00:00Z",
  tickets: [{
    id: "550e8400-e29b-41d4-a716-446655440000",
    admissionLabel: "GA",
    status: "refunded",
    usedAt: null,
  }],
};
Deno.test("private refund access allows only strict financial projection and never invokes credential minting", async () => {
  const grant = await createEmailGrant();
  const calls: string[] = [];
  const handler = createTicketEmailHttpHandler("refund_access", {
    appOrigin: "https://app.example",
    recoveryEnabled: false,
    keyId: "",
    keys: new Map(),
    fingerprintSecret: new Uint8Array(32).fill(8),
    getTrustedIp: () => "127.0.0.1",
    getCredentialSecret: () => {
      throw new Error("Admission credential forbidden");
    },
    rpc: async (name, args) => {
      calls.push(name);
      assertEquals(args.p_token_hash, grant.tokenHash);
      return { kind: "ready", expiresAt: "2099-01-01T00:00:00Z", order };
    },
  });
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: grant.token }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    kind: "ready",
    expiresAt: "2099-01-01T00:00:00Z",
    order,
  });
  assertEquals(calls, ["server_read_refund_detail_access"]);
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
  assertEquals(response.headers.get("cache-control"), "private, no-store");
});
Deno.test("financial boundary fails closed on PII, QR, wrong-purpose projection, expired grants and extra selectors", async () => {
  const grant = await createEmailGrant();
  for (
    const value of [null, {
      kind: "member",
      projection: order,
      expiresAt: "2099-01-01T00:00:00Z",
    }, {
      kind: "ready",
      order: { ...order, buyerEmail: "private@example.invalid" },
      expiresAt: "2099-01-01T00:00:00Z",
    }, {
      kind: "ready",
      order: {
        ...order,
        tickets: [{ ...order.tickets[0], credential: "secret" }],
      },
      expiresAt: "2099-01-01T00:00:00Z",
    }, { kind: "ready", order, expiresAt: "2001-01-01T00:00:00Z" }]
  ) {
    const handler = createTicketEmailHttpHandler("refund_access", {
      appOrigin: "https://app.example",
      recoveryEnabled: false,
      keyId: "",
      keys: new Map(),
      fingerprintSecret: new Uint8Array(32).fill(8),
      getTrustedIp: () => "127.0.0.1",
      getCredentialSecret: () => {
        throw new Error();
      },
      rpc: async () => value,
    });
    const response = await handler(
      new Request("https://edge.example", {
        method: "POST",
        headers: {
          origin: "https://app.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: grant.token }),
      }),
    );
    assertEquals(response.status, 404);
  }
});
Deno.test("refund access rejects extra selectors, applies invalid-grant budget and preserves dependency retry", async () => {
  const grant = await createEmailGrant();
  for (const scenario of ["selector", "malformed", "limited", "error"]) {
    let calls = 0;
    const handler = createTicketEmailHttpHandler("refund_access", {
      appOrigin: "https://app.example",
      recoveryEnabled: false,
      keyId: "",
      keys: new Map(),
      fingerprintSecret: new Uint8Array(32).fill(8),
      getTrustedIp: () => "127.0.0.1",
      getCredentialSecret: () => {
        throw new Error();
      },
      rpc: async (name, args) => {
        calls++;
        assertEquals(name, "server_read_refund_detail_access");
        if (scenario === "malformed") assertEquals(args.p_token_hash, null);
        if (scenario === "error") throw new Error("private provider token");
        return scenario === "limited" ? { kind: "rate_limited" } : null;
      },
    });
    const response = await handler(
      new Request("https://edge.example", {
        method: "POST",
        headers: {
          origin: "https://app.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          scenario === "selector" ? { token: grant.token, member: 2 } : {
            token: scenario === "malformed" ? "order-number" : grant.token,
          },
        ),
      }),
    );
    assertEquals(
      response.status,
      scenario === "selector"
        ? 400
        : scenario === "limited"
        ? 429
        : scenario === "error"
        ? 503
        : 404,
    );
    assertEquals(calls, scenario === "selector" ? 0 : 1);
    assertEquals((await response.text()).includes("private provider"), false);
  }
});
