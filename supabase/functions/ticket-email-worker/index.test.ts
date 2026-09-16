import { assertEquals } from "@std/assert";
import { createTicketEmailWorkerHandler } from "./index.ts";
const secret = "worker-secret-fixture-".repeat(3);
const values: Record<string, string> = {
  TICKET_EMAIL_WORKER_ENABLED: "true",
  TICKET_EMAIL_WORKER_SECRET: secret,
  TICKET_EMAIL_FROM: "Whereto <tickets@whereto.example>",
  TICKET_EMAIL_SUPPORT_EMAIL: "support@whereto.example",
  RESEND_API_KEY: "re_fixture",
  APP_BASE_URL: "https://whereto.example",
  TICKET_EMAIL_PAYLOAD_KEY_ID: "current",
  TICKET_EMAIL_PAYLOAD_KEYS_JSON: JSON.stringify({
    current: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  }),
};
Deno.test("worker is inert without explicit flag or secret and fails closed on incomplete config", async () => {
  for (
    const missing of [
      "TICKET_EMAIL_WORKER_ENABLED",
      "TICKET_EMAIL_WORKER_SECRET",
      "RESEND_API_KEY",
      "TICKET_EMAIL_FROM",
      "TICKET_EMAIL_PAYLOAD_KEYS_JSON",
    ]
  ) {
    let calls = 0;
    const handler = createTicketEmailWorkerHandler({
      readEnv: (name) => name === missing ? undefined : values[name],
      rpc: async () => {
        calls++;
        return null;
      },
      fetch: async () => {
        throw new Error("No provider allowed");
      },
      now: Date.now,
    });
    assertEquals(
      (await handler(
        new Request("https://worker.example", {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
        }),
      )).status,
      503,
    );
    assertEquals(calls, 0);
  }
});
Deno.test("worker rejects unauthorized caller and GET without invoking database", async () => {
  let calls = 0;
  const handler = createTicketEmailWorkerHandler({
    readEnv: (name) => values[name],
    rpc: async () => {
      calls++;
      return null;
    },
    fetch: async () => {
      throw new Error("No provider allowed");
    },
    now: Date.now,
  });
  assertEquals(
    (await handler(new Request("https://worker.example", { method: "POST" })))
      .status,
    401,
  );
  assertEquals(
    (await handler(new Request("https://worker.example"))).status,
    405,
  );
  assertEquals(calls, 0);
});
Deno.test("authorized worker stops promptly when no claim is available", async () => {
  let calls = 0;
  const handler = createTicketEmailWorkerHandler({
    readEnv: (name) => values[name],
    rpc: async () => {
      calls++;
      return null;
    },
    fetch: async () => {
      throw new Error("No provider allowed");
    },
    now: Date.now,
  });
  assertEquals(
    (await handler(
      new Request("https://worker.example", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    )).status,
    200,
  );
  assertEquals(calls, 2);
});
Deno.test("a worker invocation processes at most three claims and never sends with missing support", async () => {
  let claims = 0, stops = 0;
  const handler = createTicketEmailWorkerHandler({
    readEnv: (name) =>
      name === "TICKET_EMAIL_SUPPORT_EMAIL" ? undefined : values[name],
    now: Date.now,
    fetch: async () => {
      throw new Error("No provider allowed");
    },
    rpc: async (name) => {
      if (name === "server_enqueue_refund_notices") return 0;
      if (name === "server_claim_ticket_email") {
        claims++;
        return {
          id: "550e8400-e29b-41d4-a716-446655440000",
          lease_id: "550e8400-e29b-41d4-a716-446655440001",
          purpose: "initial",
          recovery_payload: null,
        };
      }
      if (name === "server_stop_ticket_email") {
        stops++;
        return true;
      }
      throw new Error("Unexpected call");
    },
  });
  assertEquals(
    (await handler(
      new Request("https://worker.example", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    )).status,
    200,
  );
  assertEquals(claims, 3);
  assertEquals(stops, 3);
});
Deno.test("authorized worker performs one bounded committed-refund catchup independently of send claims", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const handler = createTicketEmailWorkerHandler({
    readEnv: (name) => values[name],
    now: Date.now,
    fetch: async () => {
      throw new Error("No provider");
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return name === "server_enqueue_refund_notices" ? 0 : null;
    },
  });
  assertEquals(
    (await handler(
      new Request("https://worker.example", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    )).status,
    200,
  );
  assertEquals(calls, [{
    name: "server_enqueue_refund_notices",
    args: { p_limit: 25 },
  }, { name: "server_claim_ticket_email", args: undefined }]);
});
