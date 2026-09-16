import { assert, assertEquals } from "@std/assert";
import {
  createTicketEmailHttpHandler,
  type TicketEmailHttpDependencies,
} from "./ticketEmailHttp.ts";
import {
  createEmailGrant,
  decryptEmailPayload,
  type EncryptedEmailPayload,
} from "./ticketEmailAccess.ts";
const key = new Uint8Array(32).fill(7);
const origin = "https://fixture.invalid";
function fixture(overrides: Partial<TicketEmailHttpDependencies> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const dependencies: TicketEmailHttpDependencies = {
    appOrigin: origin,
    recoveryEnabled: true,
    keyId: "local",
    keys: new Map([["local", key]]),
    fingerprintSecret: key,
    getTrustedIp: () => "127.0.0.1",
    getCredentialSecret: () => key,
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve(null);
    },
    ...overrides,
  };
  return { calls, dependencies };
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(origin, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
Deno.test("recovery queues encrypted normalized recipient without matching or disclosure", async () => {
  const { dependencies, calls } = fixture();
  const response = await createTicketEmailHttpHandler("recovery", dependencies)(
    request({
      email: " Pat+tag@Example.Invalid ",
      requestId: "c6700000-0000-4000-8000-000000000001",
    }),
  );
  assertEquals(response.status, 202);
  assertEquals(await response.json(), { kind: "requested" });
  assertEquals(calls.map((c) => c.name), ["server_request_ticket_recovery"]);
  const args = calls[0].args;
  assert(!JSON.stringify(args).includes("pat+tag"));
  assertEquals(
    await decryptEmailPayload(args.p_payload as EncryptedEmailPayload, {
      kind: "recovery_request",
      requestId: args.p_request_id as string,
    }, dependencies.keys),
    { kind: "recovery_request", email: "pat+tag@example.invalid" },
  );
  assertEquals(response.headers.get("cache-control"), "private, no-store");
});
Deno.test("recovery transport failure is retryable and never reports an email sent", async () => {
  const { dependencies } = fixture({
    rpc: () => Promise.reject(new Error("secret recipient and bearer")),
  });
  const response = await createTicketEmailHttpHandler("recovery", dependencies)(
    request({
      email: "pat@example.invalid",
      requestId: "c6700000-0000-4000-8000-000000000001",
    }),
  );
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { kind: "unavailable" });
});
Deno.test("recovery refuses unconfigured identity, disabled sending, unknown fields and overlarge bodies", async () => {
  for (
    const override of [{ recoveryEnabled: false }, { getTrustedIp: () => null }]
  ) {
    const { dependencies, calls } = fixture(override);
    assertEquals(
      (await createTicketEmailHttpHandler("recovery", dependencies)(
        request({
          email: "pat@example.invalid",
          requestId: "c6700000-0000-4000-8000-000000000001",
        }),
      )).status,
      503,
    );
    assertEquals(calls.length, 0);
  }
  for (
    const body of [{ email: "invalid", requestId: "x" }, {
      email: "pat@example.invalid",
      requestId: "c6700000-0000-4000-8000-000000000001",
      destination: "attacker@example.invalid",
    }, { email: "a".repeat(5000) }]
  ) {
    const { dependencies, calls } = fixture();
    assertEquals(
      (await createTicketEmailHttpHandler("recovery", dependencies)(
        request(body),
      )).status,
      400,
    );
    assertEquals(calls.length, 0);
  }
});
Deno.test("access hashes its own namespace, never accepts a paid/free locator, and does not expose projection internals", async () => {
  const grant = await createEmailGrant();
  const { dependencies, calls } = fixture({
    rpc: () =>
      Promise.resolve({
        kind: "index",
        expiresAt: "2026-12-01T00:00:00Z",
        total: 1,
        page: 0,
        nextPage: null,
        collections: [{
          selector: 1,
          sourceKind: "paid_order",
          eventName: "Night Market",
          startsAt: "2026-11-01T00:00:00Z",
          quantity: 2,
          createdAt: "2026-09-01T00:00:00Z",
        }],
      }),
  });
  const access = createTicketEmailHttpHandler("access", dependencies);
  const response = await access(request({ token: grant.token, page: 0 }));
  assertEquals(response.status, 200);
  assert(!(await response.text()).includes(grant.token));
  const invalid = fixture();
  for (
    const token of [
      "rsvp_" + "a".repeat(42) + "A",
      "a".repeat(42) + "A",
      "wta1_" + "a".repeat(42) + "A",
    ]
  ) {
    assertEquals(
      (await createTicketEmailHttpHandler("access", invalid.dependencies)(
        request({ token, page: 0 }),
      )).status,
      404,
    );
  }
  assertEquals(calls.length, 0);
});
Deno.test("all public delivery endpoints enforce exact origin and POST with bounded JSON", async () => {
  for (const operation of ["recovery", "access", "status"] as const) {
    const { dependencies, calls } = fixture();
    const handler = createTicketEmailHttpHandler(operation, dependencies);
    assertEquals(
      (await handler(request({}, { origin: "https://attacker.invalid" })))
        .status,
      403,
    );
    assertEquals(
      (await handler(new Request(origin, { headers: { origin } }))).status,
      405,
    );
    assertEquals(calls.length, 0);
  }
});

Deno.test("delivery status keeps namespaced free and paid prefix collisions in their existing domains", async () => {
  const { calls, dependencies } = fixture({
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ state: "queued", observation: null });
    },
  });
  const handler = createTicketEmailHttpHandler("status", dependencies);
  const paid = "rsvp_" + "a".repeat(37) + "A";
  const free = "rsvp_" + "a".repeat(42) + "A";
  assertEquals(
    (await handler(request({ collectionBearer: paid }))).status,
    200,
  );
  assertEquals(
    (await handler(request({ collectionBearer: free }))).status,
    200,
  );
  assertEquals(calls.map((c) => c.args.p_kind), [
    "paid_order",
    "free_registration",
  ]);
  assert(
    calls.every((c) =>
      typeof c.args.p_ip_hash === "string" &&
      !JSON.stringify(c.args).includes("rsvp_")
    ),
  );
});
Deno.test("missing or malformed canonical projection never reaches public ticket access", async () => {
  const { token } = await createEmailGrant();
  for (
    const result of [null, {
      kind: "member",
      sourceKind: "paid_order",
      expiresAt: "2026-12-01T00:00:00Z",
      projection: {
        buyer_email: "secret@example.invalid",
        credential_hash: "not-a-ticket",
      },
    }, {
      kind: "index",
      total: 201,
      page: 0,
      nextPage: 1,
      expiresAt: "2026-12-01T00:00:00Z",
      collections: [],
    }]
  ) {
    const { dependencies } = fixture({ rpc: () => Promise.resolve(result) });
    const response = await createTicketEmailHttpHandler("access", dependencies)(
      request({ token, member: 1 }),
    );
    assertEquals(response.status, 404);
    assertEquals(await response.json(), { kind: "unavailable" });
  }
});
Deno.test("access and buyer status map aggregate or invalid-lane denial to the same 429", async () => {
  for (const operation of ["access", "status"] as const) {
    const { dependencies } = fixture({
      rpc: () => Promise.resolve({ kind: "rate_limited" }),
    });
    const body = operation === "access"
      ? { token: (await createEmailGrant()).token, page: 0 }
      : { collectionBearer: "a".repeat(42) + "A" };
    const response = await createTicketEmailHttpHandler(
      operation,
      dependencies,
    )(request(body));
    assertEquals(response.status, 429);
    assertEquals(await response.json(), { kind: "rate_limited" });
  }
});
Deno.test("malformed bearer strings share RPC aggregate and invalid budgets without a source hash", async () => {
  for (const operation of ["access", "status"] as const) {
    const { dependencies, calls } = fixture();
    dependencies.rpc = (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ kind: "rate_limited" });
    };
    const handler = createTicketEmailHttpHandler(operation, dependencies);
    for (const token of ["malformed", "", "wta1_" + "a".repeat(43)]) {
      const body = operation === "access"
        ? { token, page: 0 }
        : { collectionBearer: token };
      assertEquals((await handler(request(body))).status, 429);
    }
    assertEquals(calls.length, 3);
    assert(
      calls.every((c) =>
        (operation === "access"
          ? c.args.p_token_hash
          : c.args.p_access_hash) === null
      ),
    );
    assert(calls.every((c) => typeof c.args.p_ip_hash === "string"));
    assertEquals(new Set(calls.map((c) => c.args.p_ip_hash)).size, 1);
  }
});
Deno.test("canonical unknown paid and free status tokens are hashed for the same aggregate IP gate", async () => {
  const { dependencies, calls } = fixture();
  const handler = createTicketEmailHttpHandler("status", dependencies);
  for (const token of ["a".repeat(42) + "A", "rsvp_" + "a".repeat(42) + "A"]) {
    const response = await handler(request({ collectionBearer: token }));
    assertEquals(response.status, 404);
    assertEquals(await response.json(), { kind: "unavailable" });
  }
  assertEquals(calls.map((c) => c.args.p_kind), [
    "paid_order",
    "free_registration",
  ]);
  assert(
    calls.every((c) =>
      typeof c.args.p_access_hash === "string" &&
      String(c.args.p_access_hash).length === 64
    ),
  );
  assertEquals(calls[0].args.p_ip_hash, calls[1].args.p_ip_hash);
});
Deno.test("protocol-invalid public access floods are rejected cheaply before any RPC or protected source work", async () => {
  for (const operation of ["access", "status"] as const) {
    const { dependencies, calls } = fixture();
    const handler = createTicketEmailHttpHandler(operation, dependencies);
    for (let n = 0; n < 50; n++) {
      const response = await handler(
        request(
          operation === "access"
            ? { token: "bad", page: -1 }
            : { collectionBearer: 123 },
        ),
      );
      assertEquals(response.status, 404);
    }
    assertEquals(
      (await handler(request({ token: "a".repeat(3000) }))).status,
      400,
    );
    assertEquals(calls.length, 0);
  }
});

Deno.test("access and status dependency exceptions stay temporary and private", async () => {
  for (const operation of ["access", "status"] as const) {
    const { dependencies } = fixture({
      rpc: () => Promise.reject(new Error("private RPC credential details")),
    });
    const input = operation === "access"
      ? { token: (await createEmailGrant()).token, page: 0 }
      : { collectionBearer: "A".repeat(43) };
    const response = await createTicketEmailHttpHandler(
      operation,
      dependencies,
    )(request(input));
    assertEquals(response.status, 503);
    assertEquals(await response.json(), { kind: "unavailable" });
    assertEquals(response.headers.get("cache-control"), "private, no-store");
    assertEquals(response.headers.get("referrer-policy"), "no-referrer");
    assertEquals(response.headers.get("access-control-allow-origin"), origin);
  }
});
Deno.test("credential infrastructure failures remain temporary while malformed projections remain unavailable", async () => {
  const token = (await createEmailGrant()).token;
  const id = "c6700000-0000-4000-8000-000000000001";
  const paid = {
    event_id: id,
    event_title: "Night",
    event_starts_at: "2099-01-01T12:00:00Z",
    event_ends_at: "2099-01-02T12:00:00Z",
    event_venue_name: "Hall",
    event_status: "published",
    order_status: "paid",
    quantity: 1,
    items: [{ order_item_id: id, quantity: 1, admission_label: "GA" }],
    tickets: [{
      id,
      order_item_id: id,
      unit_sequence: 1,
      admission_label: "GA",
      status: "valid",
      credential_hash: "a".repeat(64),
    }],
  };
  const free = {
    registration_id: id,
    request_id: id,
    event_id: id,
    organizer_id: id,
    registration_status: "confirmed",
    event_status: "published",
    quantity: 1,
    name: "Alex",
    event_title: "Night",
    event_starts_at: "2099-01-01T12:00:00Z",
    event_ends_at: "2099-01-02T12:00:00Z",
    event_timezone: "UTC",
    event_venue_name: "Hall",
    tickets: [{
      id,
      unit_sequence: 1,
      admission_label: "RSVP",
      status: "valid",
      used_at: null,
      credential_hash: "a".repeat(64),
    }],
  };
  for (
    const [sourceKind, projection] of [["paid_order", paid], [
      "free_registration",
      free,
    ]] as const
  ) {
    const result = {
      kind: "member",
      sourceKind,
      expiresAt: "2099-01-03T12:00:00Z",
      projection,
    };
    const { dependencies } = fixture({
      rpc: () => Promise.resolve(result),
      getCredentialSecret: () => {
        throw new Error("key infrastructure unavailable");
      },
    });
    const response = await createTicketEmailHttpHandler("access", dependencies)(
      request({ token, member: 1 }),
    );
    assertEquals(response.status, 503);
    assertEquals(await response.json(), { kind: "unavailable" });
    dependencies.rpc = () => Promise.resolve({ ...result, projection: {} });
    assertEquals(
      (await createTicketEmailHttpHandler("access", dependencies)(
        request({ token, member: 1 }),
      )).status,
      404,
    );
  }
});
Deno.test("explicit null, expired, and invalid grants remain indistinguishable at 404", async () => {
  const token = (await createEmailGrant()).token;
  for (
    const result of [null, { kind: "unavailable" }, {
      kind: "index",
      expiresAt: "2000-01-01T00:00:00Z",
      total: 1,
      page: 0,
      nextPage: null,
      collections: [{
        selector: 1,
        sourceKind: "paid_order",
        eventName: "Night",
        startsAt: "1999-01-01T00:00:00Z",
        quantity: 1,
        createdAt: "1998-01-01T00:00:00Z",
      }],
    }]
  ) {
    const { dependencies } = fixture({ rpc: () => Promise.resolve(result) });
    const response = await createTicketEmailHttpHandler("access", dependencies)(
      request({ token, page: 0 }),
    );
    assertEquals(response.status, 404);
    assertEquals(await response.json(), { kind: "unavailable" });
  }
});
