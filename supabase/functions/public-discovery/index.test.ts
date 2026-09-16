import { assertEquals, assertNotEquals } from "@std/assert";
import { createPublicDiscoveryHandler, fingerprintIdentity } from "./index.ts";
const origin = "https://example.invalid";
const query = { region: "sf_bay_area", when: "upcoming" };
const envelope = {
  items: [],
  nextCursor: null,
  window: {
    start: "2026-09-13T12:00:00+00:00",
    end: "2026-10-13T07:00:00+00:00",
    timezone: "America/Los_Angeles",
  },
  serverNow: "2026-09-13T12:00:00+00:00",
};
function setup(
  options: {
    ip?: string | null;
    rate?: unknown;
    data?: unknown;
    fail?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const handler = createPublicDiscoveryHandler({
    appOrigin: origin,
    fingerprintSecret: new Uint8Array(32).fill(1),
    getTrustedIp: () => options.ip === undefined ? "192.0.2.1" : options.ip,
    rpc: async (name, args) => {
      calls.push(name);
      if (options.fail) throw new Error("private provider detail");
      if (name === "server_consume_discovery_read_rate_limit") {
        assertEquals(typeof args.p_identity_hash, "string");
        assertEquals(String(args.p_identity_hash).length, 64);
        return options.rate ?? { allowed: true, retryAfterSeconds: 0 };
      }
      assertEquals(name, "server_get_public_discovery_events");
      return options.data ?? envelope;
    },
  });
  return { handler, calls };
}
function req(body: unknown = query, extra: RequestInit = {}) {
  return new Request(origin + "/functions/v1/public-discovery", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
    ...extra,
  });
}
Deno.test("anonymous discovery reads only after consuming its separate quota", async () => {
  const { handler, calls } = setup();
  const r = await handler(req());
  assertEquals(r.status, 200);
  assertEquals(await r.json(), envelope);
  assertEquals(calls, [
    "server_consume_discovery_read_rate_limit",
    "server_get_public_discovery_events",
  ]);
  assertEquals(r.headers.get("cache-control"), "no-store");
});
Deno.test("invalid requests never invoke database readers", async () => {
  for (
    const body of [
      null,
      [],
      {},
      { ...query, limit: 0 },
      { ...query, limit: 51 },
      { ...query, limit: 1.5 },
      { ...query, category: null },
      { ...query, admissionType: "both" },
      { ...query, category: "search" },
      { ...query, organizerId: "secret" },
      { ...query, region: "nyc" },
    ]
  ) {
    const { handler, calls } = setup();
    const r = await handler(req(body));
    assertEquals(r.status, 400);
    assertEquals(calls.length, 0);
  }
});
Deno.test("default and boundary page sizes are accepted", async () => {
  for (const limit of [undefined, 1, 20, 50]) {
    const { handler } = setup();
    assertEquals(
      (await handler(
        req({ ...query, ...(limit === undefined ? {} : { limit }) }),
      )).status,
      200,
    );
  }
});
Deno.test("bounded body and cursor reject without reaching RPC", async () => {
  for (
    const body of [
      { ...query, cursor: "x".repeat(1025) },
      { ...query, cursor: null },
      { ...query, cursor: "not+canonical" },
      { ...query, extra: "x".repeat(2048) },
    ]
  ) {
    const { handler, calls } = setup();
    assertEquals((await handler(req(body))).status, 400);
    assertEquals(calls.length, 0);
  }
});
Deno.test("CORS and methods enforce the anonymous entry contract", async () => {
  const { handler, calls } = setup();
  assertEquals(
    (await handler(
      req(query, {
        headers: {
          origin: "https://attacker.invalid",
          "content-type": "application/json",
        },
      }),
    )).status,
    403,
  );
  assertEquals(
    (await handler(
      new Request(origin, { method: "OPTIONS", headers: { origin } }),
    )).status,
    204,
  );
  assertEquals(
    (await handler(new Request(origin, { headers: { origin } }))).status,
    405,
  );
  assertEquals(calls.length, 0);
});
Deno.test("missing trusted identity and limiter failure fail closed", async () => {
  for (
    const options of [{ ip: null }, { ip: "192.0.2.1, 192.0.2.2" }, {
      fail: true,
    }, { rate: { allowed: true } }]
  ) {
    const { handler, calls } = setup(options);
    const r = await handler(req());
    assertEquals(r.status, 503);
    assertEquals((await r.text()).includes("private"), false);
    assertEquals(calls.includes("server_get_public_discovery_events"), false);
  }
});
Deno.test("429 supplies an actionable retry delay and does not read inventory", async () => {
  const { handler, calls } = setup({
    rate: { allowed: false, retryAfterSeconds: 17 },
  });
  const r = await handler(req());
  assertEquals(r.status, 429);
  assertEquals(r.headers.get("retry-after"), "17");
  assertEquals(await r.json(), {
    error: { code: "DISCOVERY_RATE_LIMITED", retryAfterSeconds: 17 },
  });
  assertEquals(calls.length, 1);
});
Deno.test("malformed or private-field database responses fail safely", async () => {
  for (
    const data of [{ ...envelope, organizerEmail: "private@example.invalid" }, {
      ...envelope,
      items: [{ id: "private" }],
    }, { ...envelope, nextCursor: 123 }]
  ) {
    const { handler } = setup({ data });
    const r = await handler(req());
    assertEquals(r.status, 503);
    assertEquals(await r.json(), { error: { code: "DISCOVERY_UNAVAILABLE" } });
  }
});
Deno.test("fingerprints are domain-separated and normalize equivalent IPv6 forms", async () => {
  const key = new Uint8Array(32).fill(1);
  assertEquals(
    await fingerprintIdentity(key, "2001:db8::1"),
    await fingerprintIdentity(key, "2001:0db8:0000:0000:0000:0000:0000:0001"),
  );
  assertNotEquals(
    await fingerprintIdentity(key, "192.0.2.1"),
    await fingerprintIdentity(key, "192.0.2.2"),
  );
});

Deno.test("owned cursor errors reach clients without leaking dependency failures", async () => {
  for (
    const code of [
      "DISCOVERY_CURSOR_INVALID",
      "DISCOVERY_CURSOR_EXPIRED",
      "private-secret-detail",
    ]
  ) {
    const handler = createPublicDiscoveryHandler({
      appOrigin: origin,
      fingerprintSecret: new Uint8Array(32).fill(1),
      getTrustedIp: () => "192.0.2.1",
      rpc: async (name) => {
        if (name === "server_consume_discovery_read_rate_limit") {
          return { allowed: true, retryAfterSeconds: 0 };
        }
        throw new Error(code);
      },
    });
    const response = await handler(req());
    assertEquals(response.status, code === "private-secret-detail" ? 503 : 400);
    assertEquals(await response.json(), {
      error: {
        code: code === "private-secret-detail" ? "DISCOVERY_UNAVAILABLE" : code,
      },
    });
  }
});
Deno.test("invalid JSON, UTF-8 and content type fail before any database call", async () => {
  for (
    const request of [
      req(query, { body: "{" }),
      req(query, { body: new Uint8Array([0xff]) }),
      req(query, { headers: { origin, "content-type": "text/plain" } }),
    ]
  ) {
    const { handler, calls } = setup();
    assertEquals((await handler(request)).status, 400);
    assertEquals(calls.length, 0);
  }
});
Deno.test("a short fingerprint secret fails closed before database access", async () => {
  const handler = createPublicDiscoveryHandler({
    appOrigin: origin,
    fingerprintSecret: new Uint8Array(4),
    getTrustedIp: () => "192.0.2.1",
    rpc: () => {
      throw new Error("must not invoke");
    },
  });
  assertEquals((await handler(req())).status, 503);
});

const publicRow = {
  id: "d1310000-0000-4000-8000-000000000001",
  title: "Public event",
  category: "community",
  admissionType: "free",
  startsAt: "2026-09-14T12:00:00+00:00",
  endsAt: "2026-09-14T14:00:00+00:00",
  timezone: "America/Los_Angeles",
  venueName: "Local Hall",
  city: "San Francisco",
  artworkReference: null,
  admission: {
    state: "unknown",
    minimumBuyerAmountMinor: null,
    currency: null,
  },
};
Deno.test("mixed invalid rows become null sentinels without private data or extra reads", async () => {
  const { handler, calls } = setup({
    data: {
      ...envelope,
      items: [publicRow, {
        ...publicRow,
        organizerEmail: "never-expose@example.invalid",
      }],
      nextCursor: "YWJj",
    },
  });
  const response = await handler(req());
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ...envelope,
    items: [publicRow, null],
    nextCursor: "YWJj",
  });
  assertEquals(calls.length, 2);
});
Deno.test("canonical padded and Unicode titles normalize by codepoints", async () => {
  for (const title of ["  A padded event  ", "🎶".repeat(61)]) {
    const { handler } = setup({
      data: {
        ...envelope,
        items: [{
          ...publicRow,
          title,
          venueName: "  Local Hall  ",
          city: "  San Francisco  ",
        }],
      },
    });
    const response = await handler(req());
    assertEquals(response.status, 200);
    assertEquals((await response.json()).items[0], {
      ...publicRow,
      title: title.trim(),
    });
  }
});
Deno.test("all invalid rows fail while one invalid row preserves the valid page", async () => {
  for (
    const items of [[{ ...publicRow, title: "x".repeat(121) }], [null, null]]
  ) {
    const { handler } = setup({ data: { ...envelope, items } });
    assertEquals((await handler(req())).status, 503);
  }
  const { handler } = setup({
    data: {
      ...envelope,
      items: [publicRow, { ...publicRow, title: "x".repeat(121) }],
    },
  });
  const response = await handler(req());
  assertEquals(response.status, 200);
  assertEquals((await response.json()).items, [publicRow, null]);
});
