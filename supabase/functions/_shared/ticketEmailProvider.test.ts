import { assertEquals, assertRejects } from "@std/assert";
import {
  sendProviderEmail,
  verifyProviderObservation,
} from "./ticketEmailProvider.ts";
import type { ProviderEmailPayload } from "./ticketEmailAccess.ts";
const attemptId = "550e8400-e29b-41d4-a716-446655440000";
const payload: ProviderEmailPayload = {
  from: "tickets@example.invalid",
  to: "guest@example.invalid",
  replyTo: "support@example.invalid",
  subject: "Tickets",
  html: "<p>Tickets</p>",
  text: "Tickets",
  tags: [{ name: "attempt_id", value: attemptId }],
};
Deno.test("provider sends the exact stable wire payload and key with an abort signal", async () => {
  let first = "";
  for (let i = 0; i < 2; i++) {
    const result = await sendProviderEmail(
      payload,
      "ticket-email/" + attemptId,
      {
        apiKey: "test",
        fetch: async (_url, init) => {
          assertEquals(
            new Headers(init?.headers).get("idempotency-key"),
            "ticket-email/" + attemptId,
          );
          assertEquals(Boolean(init?.signal), true);
          const wire = String(init?.body);
          if (first) assertEquals(wire, first);
          first = wire;
          assertEquals(JSON.parse(wire), {
            from: payload.from,
            to: payload.to,
            reply_to: payload.replyTo,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
            tags: payload.tags,
          });
          return Response.json({ id: "provider-id" });
        },
      },
    );
    assertEquals(result, { outcome: "accepted", providerId: "provider-id" });
  }
});
Deno.test("provider preserves uncertainty on lost response, timeout, conflict and throttling", async () => {
  for (const status of [409, 429, 500, 503, 408, 302]) {
    assertEquals(
      await sendProviderEmail(payload, "key", {
        apiKey: "test",
        fetch: async () => new Response(null, { status }),
      }),
      { outcome: "unknown" },
    );
  }
  assertEquals(
    await sendProviderEmail(payload, "key", {
      apiKey: "test",
      fetch: () => Promise.reject(new Error("lost accepted response")),
    }),
    { outcome: "unknown" },
  );
  assertEquals(
    await sendProviderEmail(payload, "key", {
      apiKey: "test",
      fetch: async () => Response.json({}),
    }),
    { outcome: "unknown" },
  );
  assertEquals(
    await sendProviderEmail(payload, "key", {
      apiKey: "test",
      fetch: async () => new Response(null, { status: 422 }),
    }),
    { outcome: "failed" },
  );
});
const secretBytes = new Uint8Array(32).fill(9);
const secret = "whsec_" + btoa(String.fromCharCode(...secretBytes));
async function signed(body: string) {
  const id = "msg_fixture";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return new Headers({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": "v1," +
      btoa(String.fromCharCode(...new Uint8Array(signature))),
  });
}
function event() {
  return {
    type: "email.delivered",
    created_at: "2026-09-11T10:00:00.123Z",
    data: { email_id: "provider-id", tags: { attempt_id: attemptId } },
  };
}
Deno.test("verified raw-body observation maps exact tag, message id and event timestamp", async () => {
  const raw = JSON.stringify(event(), null, 2);
  assertEquals(
    await verifyProviderObservation(raw, await signed(raw), secret),
    {
      p_webhook_id: "msg_fixture",
      p_attempt_id: attemptId,
      p_provider_id: "provider-id",
      p_kind: "delivered",
      p_observed_at: "2026-09-11T10:00:00.123Z",
    },
  );
  await assertRejects(async () =>
    await verifyProviderObservation(raw + " ", await signed(raw), secret)
  );
});
Deno.test("signed malformed observations never fall back to recipient or timestamp matching", async () => {
  for (
    const value of [
      { ...event(), data: { email_id: "provider-id", tags: {} } },
      { ...event(), data: { tags: { attempt_id: attemptId } } },
      { ...event(), type: "email.opened" },
      { ...event(), created_at: "2026-02-30T10:00:00Z" },
      {
        ...event(),
        data: {
          email_id: "provider-id",
          tags: [{ name: "attempt_id", value: attemptId }],
        },
      },
    ]
  ) {
    const raw = JSON.stringify(value);
    await assertRejects(async () =>
      await verifyProviderObservation(raw, await signed(raw), secret)
    );
  }
});
