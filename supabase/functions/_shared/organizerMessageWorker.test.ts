import { assertEquals } from "@std/assert";
import { processOrganizerMessage } from "./organizerMessageWorker.ts";
import {
  decryptEmailPayload,
  type EncryptedEmailPayload,
  type ProviderEmailPayload,
} from "./ticketEmailAccess.ts";
import type { ProviderResult } from "./ticketEmailProvider.ts";
const attemptId = "550e8400-e29b-41d4-a716-446655440001",
  leaseId = "550e8400-e29b-41d4-a716-446655440002",
  eventId = "550e8400-e29b-41d4-a716-446655440003";
const now = Date.parse("2026-09-23T12:00:00Z");
const facts = {
  eventId,
  eventName: "Night",
  organizerName: "Hosts",
  startsAt: new Date(now).toISOString(),
  endsAt: new Date(now + 3600000).toISOString(),
  timezone: "UTC",
  venueName: "Hall",
  senderEmail: "events@wheretoo.example",
  replyTo: "support@wheretoo.example",
  templateVersion: "organizer-message-v1",
  eventUrl: null,
  flyerUrl: null,
  organizerLogoUrl: null,
};
const config = {
  keyId: "test",
  keys: new Map([["test", new Uint8Array(32).fill(7)]]),
};
function harness(
  outcome: ProviderResult = { outcome: "accepted", providerId: "provider-1" },
) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [],
    sends: { payload: ProviderEmailPayload; key: string }[] = [];
  let payload: EncryptedEmailPayload | null = null,
    count = 1,
    dispatchOverride: Record<string, unknown> = {},
    prepareOverride: Record<string, unknown> = {};
  return {
    calls,
    sends,
    config,
    now: () => now,
    setCount: (value: number) => {
      count = value;
    },
    setDispatch: (v: Record<string, unknown>) => {
      dispatchOverride = v;
    },
    setPrepare: (v: Record<string, unknown>) => {
      prepareOverride = v;
    },
    rpc: async (
      name: string,
      args?: Record<string, unknown>,
    ): Promise<unknown> => {
      calls.push({ name, args });
      switch (name) {
        case "server_claim_organizer_message_recipient":
          return { attemptId, leaseId, payload };
        case "server_prepare_organizer_message_recipient":
          return {
            attemptId,
            messageId: eventId,
            recipient: "buyer@example.com",
            subject: "Hello",
            body: "Body",
            facts,
            payload,
            ...prepareOverride,
          };
        case "server_save_organizer_message_payload":
          payload = args!.p_payload as EncryptedEmailPayload;
          return true;
        case "server_begin_organizer_message_dispatch":
          return {
            attemptId,
            payload,
            idempotencyKey: `organizer-message/${attemptId}`,
            leaseUntil: new Date(now + 120000).toISOString(),
            firstPossibleDispatchAt: new Date(now).toISOString(),
            dispatchCount: count,
            ...dispatchOverride,
          };
        default:
          return true;
      }
    },
    send: async (p: ProviderEmailPayload, key: string) => {
      sends.push({ payload: p, key });
      return outcome;
    },
  };
}
Deno.test("organizer delivery encrypts null-grant payload before dispatch and never invokes ticket RPC", async () => {
  const h = harness();
  assertEquals(await processOrganizerMessage(h), "accepted");
  assertEquals(h.calls.map((c) => c.name), [
    "server_claim_organizer_message_recipient",
    "server_prepare_organizer_message_recipient",
    "server_save_organizer_message_payload",
    "server_begin_organizer_message_dispatch",
    "server_finish_organizer_message_dispatch",
  ]);
  const saved = h.calls[2].args!.p_payload as EncryptedEmailPayload;
  const decrypted = await decryptEmailPayload(saved, {
    kind: "provider",
    attemptId,
    grantId: null,
  }, config.keys);
  assertEquals(decrypted.kind, "provider");
  assertEquals(h.sends[0].payload.to, "buyer@example.com");
  assertEquals(h.sends[0].key, `organizer-message/${attemptId}`);
  assertEquals(JSON.stringify(h.sends).includes("ticket-access"), false);
});
Deno.test("retry reuses exact encrypted provider bytes and key even if live facts change", async () => {
  const h = harness({ outcome: "unknown" });
  assertEquals(await processOrganizerMessage(h), "unknown");
  h.setCount(2);
  h.setPrepare({
    subject: "Changed",
    body: "Different",
    facts: { ...facts, eventName: "Changed" },
  });
  assertEquals(await processOrganizerMessage(h), "unknown");
  assertEquals(h.sends[0], h.sends[1]);
  assertEquals(
    h.calls.filter((c) => c.name === "server_save_organizer_message_payload")
      .length,
    1,
  );
});
Deno.test("accepted, failed, unknown and thrown transport are persisted truthfully", async () => {
  for (
    const result of [{ outcome: "accepted", providerId: "id" }, {
      outcome: "failed",
    }, { outcome: "unknown" }] as ProviderResult[]
  ) {
    const h = harness(result);
    assertEquals(await processOrganizerMessage(h), result.outcome);
    assertEquals(h.calls.at(-1)!.args!.p_outcome, result.outcome);
  }
  const h = harness();
  h.send = async () => {
    throw Error("timeout");
  };
  assertEquals(await processOrganizerMessage(h), "unknown");
  const retry = harness({ outcome: "failed" });
  retry.setCount(2);
  assertEquals(await processOrganizerMessage(retry), "unknown");
});
Deno.test("bad projection, wrong dispatch key, exhausted window or short lease cannot send", async () => {
  const bad = harness();
  bad.setPrepare({ recipient: "not-email" });
  assertEquals(await processOrganizerMessage(bad), "invalid_projection");
  assertEquals(bad.sends.length, 0);
  for (
    const v of [
      { idempotencyKey: `ticket-email/${attemptId}` },
      { dispatchCount: 7 },
      { leaseUntil: new Date(now + 1000).toISOString() },
      { firstPossibleDispatchAt: new Date(now - 23 * 3600000).toISOString() },
      { grantId: eventId },
    ]
  ) {
    const h = harness();
    h.setDispatch(v);
    assertEquals(await processOrganizerMessage(h), "unknown");
    assertEquals(h.sends.length, 0);
  }
});
Deno.test("lease loss, suppression/capacity stop and storage exceptions never reach provider", async () => {
  for (
    const stopped of [
      "server_prepare_organizer_message_recipient",
      "server_save_organizer_message_payload",
      "server_begin_organizer_message_dispatch",
    ]
  ) {
    const h = harness();
    const original = h.rpc;
    h.rpc = async (name, args) =>
      name === stopped
        ? (name.includes("save") ? false : null)
        : original(name, args);
    assertEquals(
      await processOrganizerMessage(h),
      stopped.includes("begin") ? "dispatch_blocked" : "lease_lost",
    );
    assertEquals(h.sends.length, 0);
  }
  const h = harness();
  const original = h.rpc;
  h.rpc = async (name, args) => {
    if (name === "server_begin_organizer_message_dispatch") {
      throw Error("storage timeout");
    }
    return original(name, args);
  };
  let rejected = false;
  try {
    await processOrganizerMessage(h);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
  assertEquals(h.sends.length, 0);
});
Deno.test("tampered or wrong-key stored envelope stops before dispatch without regeneration", async () => {
  for (const mode of ["tamper", "wrong-key"]) {
    const h = harness({ outcome: "unknown" });
    await processOrganizerMessage(h);
    const original = h.rpc;
    h.rpc = async (name, args) => {
      const result = await original(name, args);
      if (name === "server_prepare_organizer_message_recipient") {
        const c = result as Record<string, unknown>;
        const p = c.payload as EncryptedEmailPayload;
        c.payload = mode === "tamper"
          ? { ...p, ciphertext: "x" + p.ciphertext.slice(1) }
          : { ...p, keyId: "missing" };
      }
      return result;
    };
    assertEquals(await processOrganizerMessage(h), "payload_unreadable");
    assertEquals(h.sends.length, 1);
    assertEquals(
      h.calls.filter((c) => c.name === "server_save_organizer_message_payload")
        .length,
      1,
    );
  }
});
Deno.test("real provider adapter maps injected HTTP failures and preserves organizer wire bytes/key", async () => {
  const { sendProviderEmail } = await import("./ticketEmailProvider.ts");
  for (const mode of [200, 422, 429, 500, "malformed", "timeout"] as const) {
    const h = harness();
    let calls = 0;
    h.send = async (payload, key) =>
      sendProviderEmail(payload, key, {
        apiKey: "re_synthetic",
        fetch: async (_url, init) => {
          calls++;
          assertEquals(
            new Headers(init?.headers).get("Idempotency-Key"),
            `organizer-message/${attemptId}`,
          );
          assertEquals(JSON.parse(String(init?.body)).to, "buyer@example.com");
          if (mode === "timeout") {
            throw new DOMException("Timeout", "AbortError");
          }
          if (mode === "malformed") return Response.json({});
          return mode === 200
            ? Response.json({ id: "provider-id" })
            : new Response(null, { status: mode });
        },
      });
    assertEquals(
      await processOrganizerMessage(h),
      mode === 200 ? "accepted" : mode === 422 ? "failed" : "unknown",
    );
    assertEquals(calls, 1);
  }
});
