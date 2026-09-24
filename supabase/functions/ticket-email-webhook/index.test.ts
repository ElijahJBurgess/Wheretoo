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
      assertEquals(name, "server_observe_email");
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
Deno.test("real signed fixture verifies before dispatcher; body tampering never reaches either ledger", async () => {
  const { verifyProviderObservation } = await import(
    "../_shared/ticketEmailProvider.ts"
  );
  const bytes = new Uint8Array(32).fill(11);
  const secret = "whsec_" + btoa(String.fromCharCode(...bytes));
  const raw = JSON.stringify({
    type: "email.complained",
    created_at: observation.p_observed_at,
    data: {
      email_id: observation.p_provider_id,
      tags: { attempt_id: observation.p_attempt_id },
    },
  });
  const id = "msg_fixture", timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${raw}`),
  );
  const headers = {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": "v1," +
      btoa(String.fromCharCode(...new Uint8Array(signature))),
  };
  let calls = 0;
  const handler = createTicketEmailWebhookHandler({
    readEnv: () => secret,
    verify: verifyProviderObservation,
    rpc: async (name, args) => {
      calls++;
      assertEquals(name, "server_observe_email");
      assertEquals(args?.p_kind, "complained");
      return true;
    },
  });
  assertEquals(
    (await handler(
      new Request("https://webhook.example", {
        method: "POST",
        headers,
        body: raw,
      }),
    )).status,
    200,
  );
  assertEquals(
    (await handler(
      new Request("https://webhook.example", {
        method: "POST",
        headers,
        body: raw + " ",
      }),
    )).status,
    400,
  );
  assertEquals(calls, 1);
});
