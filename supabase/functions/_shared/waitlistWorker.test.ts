import { assertEquals } from "@std/assert";
import { processWaitlistDelivery } from "./waitlistWorker.ts";
Deno.test("waitlist worker is unavailable without encryption configuration", async () => {
  let called = false;
  assertEquals(
    await processWaitlistDelivery({
      config: null,
      rpc: async () => {
        called = true;
        return null;
      },
      now: Date.now,
      send: async () => ({ outcome: "unknown" }),
    }),
    "unavailable",
  );
  assertEquals(called, false);
});
import { assert, assertRejects } from "@std/assert";
import {
  decryptEmailPayload,
  type EncryptedEmailPayload,
  type ProviderEmailPayload,
} from "./ticketEmailAccess.ts";
import { createWaitlistToken, hashWaitlistToken } from "./waitlistEmail.ts";
const attempt = "a6400000-0000-4000-8000-000000000011",
  lease = "a6400000-0000-4000-8000-000000000012";
const facts = {
  eventId: "a6200000-0000-4000-8000-000000000001",
  eventName: "Evening <script>alert(1)</script>",
  tierName: "GA",
  amountMinor: 2000,
  currency: "usd",
  startsAt: "2026-12-01T20:00:00Z",
  endsAt: "2026-12-01T22:00:00Z",
  timezone: "America/Los_Angeles",
  venueName: "Hall",
  senderEmail: "notify@example.invalid",
  replyTo: "support@example.invalid",
  eventUrl:
    "https://example.invalid/events/a6200000-0000-4000-8000-000000000001/tickets",
  appOrigin: "https://example.invalid",
};
function fixture() {
  let payload: unknown = null;
  let stopped = false;
  let loseSave = false;
  let outcome = "";
  let count = 0;
  const config = {
    keyId: "local",
    keys: new Map([["local", new Uint8Array(32).fill(7)]]),
  };
  const calls: { payload: ProviderEmailPayload; key: string }[] = [];
  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    switch (name) {
      case "server_claim_waitlist_delivery":
        return Promise.resolve({ attemptId: attempt, leaseId: lease, payload });
      case "server_prepare_waitlist_delivery":
        return Promise.resolve({
          attemptId: attempt,
          recipient: "buyer@example.invalid",
          purpose: "restock",
          facts,
          factsDigest: "a".repeat(64),
          payload,
        });
      case "server_save_waitlist_payload":
        payload = args.p_payload;
        if (loseSave) {
          loseSave = false;
          return Promise.reject(Error("response lost"));
        }
        return Promise.resolve(true);
      case "server_begin_waitlist_dispatch":
        return Promise.resolve({
          attemptId: attempt,
          payload,
          idempotencyKey: "waitlist/" + attempt,
          leaseUntil: new Date(Date.now() + 120000).toISOString(),
          firstPossibleDispatchAt: new Date().toISOString(),
          dispatchCount: ++count,
        });
      case "server_finish_waitlist_dispatch":
        outcome = String(args.p_outcome);
        return Promise.resolve(true);
      case "server_stop_waitlist_delivery":
        stopped = true;
        return Promise.resolve(true);
      default:
        throw Error(name);
    }
  };
  return {
    deps: {
      config,
      rpc,
      now: Date.now,
      send: (p: ProviderEmailPayload, key: string) => {
        calls.push({ payload: p, key });
        return Promise.resolve({ outcome: "unknown" as const });
      },
    },
    calls,
    get payload() {
      return payload;
    },
    get outcome() {
      return outcome;
    },
    get stopped() {
      return stopped;
    },
    lose() {
      loseSave = true;
    },
  };
}
Deno.test("rendered restock retries exact encrypted bytes and stable key without ticket bearer", async () => {
  const f = fixture();
  assertEquals(await processWaitlistDelivery(f.deps), "unknown");
  assertEquals(await processWaitlistDelivery(f.deps), "unknown");
  assertEquals(f.calls.length, 2);
  assertEquals(f.calls[0], f.calls[1]);
  assert(f.calls[0].payload.text.includes("Availability is not guaranteed"));
  assert(f.calls[0].payload.html.includes("wl1_"));
  assert(!f.calls[0].payload.html.includes("<script>"));
  assertEquals(f.calls[0].payload.replyTo, "support@example.invalid");
  const decoded = await decryptEmailPayload(
    f.payload as EncryptedEmailPayload,
    { kind: "provider", attemptId: attempt, grantId: null },
    f.deps.config.keys,
  );
  assertEquals(decoded.kind, "provider");
});
Deno.test("lost save response preserves prepared delivery for same-payload retry", async () => {
  const f = fixture();
  f.lose();
  await assertRejects(() => processWaitlistDelivery(f.deps));
  assertEquals(f.stopped, false);
  assertEquals(f.calls.length, 0);
  assertEquals(await processWaitlistDelivery(f.deps), "unknown");
  assertEquals(f.calls.length, 1);
});
Deno.test("leave token is random 32-byte namespace and domain-separated hash", async () => {
  const a = await createWaitlistToken(), b = await createWaitlistToken();
  assert(a.token !== b.token);
  assertEquals(a.token.length, 47);
  assertEquals(a.hash.length, 64);
  assertEquals(await hashWaitlistToken(a.token), a.hash);
  await assertRejects(() => hashWaitlistToken(a.token.replace("wl1_", "em1_")));
});
Deno.test("ticketing contention releases untouched lease for bounded retry", async () => {
  const f = fixture();
  const released: unknown[] = [];
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    if (name === "server_prepare_waitlist_delivery") return null;
    if (name === "server_defer_waitlist_delivery") {
      released.push(args);
      return true;
    }
    return f.deps.rpc(name, args);
  };
  assertEquals(await processWaitlistDelivery({ ...f.deps, rpc }), "blocked");
  assertEquals(released, [{ p_attempt_id: attempt, p_lease_id: lease }]);
  assertEquals(f.calls.length, 0);
});
