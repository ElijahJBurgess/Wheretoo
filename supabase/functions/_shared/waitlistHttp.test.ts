import { assertEquals } from "@std/assert";
import { createWaitlistHttpHandler } from "./waitlistHttp.ts";
const body = {
  eventId: "a6200000-0000-4000-8000-000000000001",
  tierId: "a6300000-0000-4000-8000-000000000001",
  name: "Buyer",
  email: " BUYER@example.invalid ",
  requestId: "a6400000-0000-4000-8000-000000000001",
};
const req = (value: unknown) =>
  new Request("https://edge.example.invalid", {
    method: "POST",
    headers: {
      origin: "https://example.invalid",
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
Deno.test("join normalizes identity but never exposes membership or token", async () => {
  let email: unknown;
  const h = createWaitlistHttpHandler("join", {
    appOrigin: "https://example.invalid",
    enabled: true,
    fingerprintSecret: new Uint8Array(32),
    getTrustedIp: () => "127.0.0.1",
    rpc: (_n, a) => {
      email = a?.p_email;
      return Promise.resolve({ kind: "joined" });
    },
  });
  const r = await h(req(body));
  assertEquals(r.status, 202);
  assertEquals(await r.json(), { kind: "joined" });
  assertEquals(email, "buyer@example.invalid");
});
Deno.test("join rejects caller authority and recipient arrays", async () => {
  let calls = 0;
  const h = createWaitlistHttpHandler("join", {
    appOrigin: "https://example.invalid",
    enabled: true,
    fingerprintSecret: new Uint8Array(32),
    getTrustedIp: () => "127.0.0.1",
    rpc: () => {
      calls++;
      return Promise.resolve(null);
    },
  });
  for (
    const extra of [{ organizerId: body.eventId }, { recipients: [] }, {
      cycle: 1,
    }, { from: "bad@example.invalid" }]
  ) assertEquals((await h(req({ ...body, ...extra }))).status, 400);
  assertEquals(calls, 0);
});
Deno.test("leave remains available when joining is off; GET cannot mutate", async () => {
  let calls = 0;
  const h = createWaitlistHttpHandler("leave", {
    appOrigin: "https://example.invalid",
    enabled: false,
    fingerprintSecret: new Uint8Array(32),
    getTrustedIp: () => "127.0.0.1",
    rpc: () => {
      calls++;
      return Promise.resolve({ kind: "removed" });
    },
  });
  assertEquals(
    (await h(
      new Request("https://edge.example.invalid", {
        headers: { origin: "https://example.invalid" },
      }),
    )).status,
    405,
  );
  assertEquals(calls, 0);
  const r = await h(req({ token: "wl1_" + "A".repeat(43) }));
  assertEquals(r.status, 200);
  assertEquals(calls, 1);
});
