import { assertEquals } from "@std/assert";
import { createWaitlistWorkerHandler } from "./waitlistWorkerHttp.ts";
const secret = "s".repeat(32), tier = "a6300000-0000-4000-8000-000000000001";
Deno.test("observer default-off gate and secret are checked before any RPC", async () => {
  let calls = 0;
  const handler = createWaitlistWorkerHandler("observer", {
    readEnv: () => undefined,
    rpc: async () => {
      calls++;
      return null;
    },
    now: Date.now,
    fetch,
  });
  assertEquals(
    (await handler(new Request("https://example.invalid", { method: "POST" })))
      .status,
    503,
  );
  assertEquals(calls, 0);
  const enabled = createWaitlistWorkerHandler("observer", {
    readEnv: (n) => n.endsWith("_ENABLED") ? "true" : secret,
    rpc: async () => {
      calls++;
      return null;
    },
    now: Date.now,
    fetch,
  });
  assertEquals(
    (await enabled(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    )).status,
    401,
  );
  assertEquals(calls, 0);
});
Deno.test("observer resumes durable pages but stops after25 short transactions", async () => {
  let calls = 0;
  const handler = createWaitlistWorkerHandler("observer", {
    readEnv: (n) => n.endsWith("_ENABLED") ? "true" : secret,
    rpc: async (name) => {
      if (name === "server_next_waitlist_tiers") return [tier];
      calls++;
      return { kind: "observed", more: true };
    },
    now: Date.now,
    fetch,
  });
  assertEquals(
    (await handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { authorization: "Bearer " + secret },
      }),
    )).status,
    200,
  );
  assertEquals(calls, 25);
});
Deno.test("missing encryption configuration never marks delivery worker healthy", async () => {
  let acknowledged = 0;
  const handler = createWaitlistWorkerHandler("delivery", {
    readEnv: (name) =>
      ({
        WAITLIST_DELIVERY_ENABLED: "true",
        WAITLIST_DELIVERY_SECRET: secret,
        RESEND_API_KEY: "re_localOnly",
      } as Record<string, string>)[name],
    rpc: async () => {
      acknowledged++;
      return true;
    },
    now: Date.now,
    fetch,
  });
  assertEquals(
    (await handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { authorization: "Bearer " + secret },
      }),
    )).status,
    503,
  );
  assertEquals(acknowledged, 0);
});
