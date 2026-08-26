// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import {
  createOrderConfirmationHandler,
  defaultFindConfirmation,
  type OrderConfirmationDependencies,
} from "./index.ts";

const APP_ORIGIN = "https://whereto.example";
const TOKEN = "tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng";
const TOKEN_HASH =
  "e09ec484378583aa52cadee9787fdee4dc67a764ab98c0883c9413f7c2cc53e1";

const projection = {
  event: {
    title: "Night Market",
    startsAt: "2026-09-01T02:00:00+00:00",
    endsAt: "2026-09-01T05:00:00+00:00",
    timezone: "America/Los_Angeles",
    venueName: "Civic Center Plaza",
  },
  tier: { name: "General admission" },
  orderNumber: "WT-260901-0042",
  status: "processing" as const,
};

function request(
  body: unknown = { confirmationToken: TOKEN },
  origin = APP_ORIGIN,
): Request {
  return new Request("https://functions.example/order-confirmation", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<OrderConfirmationDependencies> = {},
): OrderConfirmationDependencies {
  return {
    appOrigin: APP_ORIGIN,
    findConfirmation: async () => projection,
    ...overrides,
  };
}

Deno.test("confirmation hashes the canonical bearer and returns only the minimum persisted projection", async () => {
  let capturedHash = "";
  const response = await createOrderConfirmationHandler(dependencies({
    findConfirmation: async (tokenHash) => {
      capturedHash = tokenHash;
      return projection;
    },
  }))(request());

  assertEquals(capturedHash, TOKEN_HASH);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(await response.json(), projection);
  assertEquals(Object.keys(projection).sort(), [
    "event",
    "orderNumber",
    "status",
    "tier",
  ]);
});

Deno.test("malformed and unknown bearers have the identical authorization-safe not-found response", async () => {
  for (const confirmationToken of ["short", `${TOKEN}=`, TOKEN]) {
    const response = await createOrderConfirmationHandler(dependencies({
      findConfirmation: async () => null,
    }))(request({ confirmationToken }));

    assertEquals(response.status, 404);
    assertEquals(await response.json(), { error: { code: "ORDER_NOT_FOUND" } });
  }
});

Deno.test("confirmation rejects extra input and non-Whereto origins without echoing bearer data", async () => {
  const extra = await createOrderConfirmationHandler(dependencies())(
    request({ confirmationToken: TOKEN, orderId: "private" }),
  );
  assertEquals(extra.status, 404);
  assertEquals(await extra.json(), { error: { code: "ORDER_NOT_FOUND" } });

  const denied = await createOrderConfirmationHandler(dependencies())(
    request({ confirmationToken: TOKEN }, `${APP_ORIGIN}.attacker.test`),
  );
  assertEquals(denied.status, 403);
  assertEquals(await denied.json(), { error: { code: "CORS_ORIGIN_DENIED" } });
});

Deno.test("default confirmation uses only the service projection RPC and validates its exact row", async () => {
  let capturedName = "";
  let capturedArgs: Record<string, unknown> | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capturedName = name;
      capturedArgs = args;
      return {
        data: [{
          event_title: projection.event.title,
          event_starts_at: projection.event.startsAt,
          event_ends_at: projection.event.endsAt,
          event_timezone: projection.event.timezone,
          event_venue_name: projection.event.venueName,
          tier_name: projection.tier.name,
          order_number: projection.orderNumber,
          confirmation_status: projection.status,
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof defaultFindConfirmation>[1];

  assertEquals(await defaultFindConfirmation(TOKEN_HASH, client), projection);
  assertEquals(capturedName, "server_lookup_order_confirmation");
  assertEquals(capturedArgs, { p_token_hash: TOKEN_HASH });
});

Deno.test("default confirmation fails closed on extra, malformed, or duplicate service rows", async () => {
  for (
    const data of [
      [{ unexpected: "row" }],
      [{
        event_title: "Event",
        event_starts_at: "bad-date",
        event_ends_at: "2026-09-01T05:00:00+00:00",
        event_timezone: "America/Los_Angeles",
        event_venue_name: "Venue",
        tier_name: "Tier",
        order_number: "ORDER-1",
        confirmation_status: "paid",
      }],
      [{}, {}],
    ]
  ) {
    const client = {
      rpc: async () => ({ data, error: null }),
    } as unknown as Parameters<typeof defaultFindConfirmation>[1];
    let rejected = false;
    try {
      await defaultFindConfirmation(TOKEN_HASH, client);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }
});
