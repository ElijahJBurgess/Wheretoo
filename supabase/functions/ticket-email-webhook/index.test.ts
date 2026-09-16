import { assertEquals } from "@std/assert";
import { createTicketEmailWebhookHandler } from "./index.ts";
const observation = {
  p_webhook_id: "msg_fixture",
  p_attempt_id: "550e8400-e29b-41d4-a716-446655440000",
  p_provider_id: "provider-id",
  p_kind: "sent",
  p_observed_at: "2026-09-11T12:00:00Z",
};
Deno.test("webhook hands untouched raw body to verifier and persists exact verified RPC fields", async () => {
  const raw = ' { "signed": true }\n';
  let calls = 0;
  const handler = createTicketEmailWebhookHandler({
    readEnv: () => "secret-fixture",
    verify: async (body, headers, secret) => {
      assertEquals(body, raw);
      assertEquals(headers.get("svix-id"), "msg_fixture");
      assertEquals(secret, "secret-fixture");
      return observation;
    },
    rpc: async (name, args) => {
      calls++;
      assertEquals(name, "server_observe_ticket_email");
      assertEquals(args, observation);
      return true;
    },
  });
  const response = await handler(
    new Request("https://webhook.example", {
      method: "POST",
      body: raw,
      headers: { "svix-id": "msg_fixture" },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(calls, 1);
});
Deno.test("failed verification, missing config, oversized body, and GET never reach storage", async () => {
  for (const mode of ["signature", "config", "size", "method"]) {
    let calls = 0;
    const handler = createTicketEmailWebhookHandler({
      readEnv: () => mode === "config" ? undefined : "secret",
      verify: async () => {
        throw new Error("bad signature");
      },
      rpc: async () => {
        calls++;
        return true;
      },
    });
    const response = await handler(
      new Request(
        "https://webhook.example",
        mode === "method" ? {} : {
          method: "POST",
          body: mode === "size" ? "x".repeat(65537) : "{}",
        },
      ),
    );
    assertEquals(
      response.status,
      mode === "config"
        ? 503
        : mode === "size"
        ? 413
        : mode === "method"
        ? 405
        : 400,
    );
    assertEquals(calls, 0);
  }
});
Deno.test("webhook database failure is retryable and mismatched observation is rejected", async () => {
  for (const fail of [true, false]) {
    const handler = createTicketEmailWebhookHandler({
      readEnv: () => "secret",
      verify: async () => observation,
      rpc: async () => {
        if (fail) throw new Error("storage unavailable");
        return false;
      },
    });
    assertEquals(
      (await handler(
        new Request("https://webhook.example", { method: "POST", body: "{}" }),
      )).status,
      fail ? 503 : 400,
    );
  }
});
