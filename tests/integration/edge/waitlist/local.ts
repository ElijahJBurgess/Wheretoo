// Local-only real HTTP/PostgREST/crypto proof. --allow-net is restricted to loopback.
import { assert, assertEquals } from "@std/assert";
import { createWaitlistHttpHandler } from "../../../../supabase/functions/_shared/waitlistHttp.ts";
import { processWaitlistDelivery } from "../../../../supabase/functions/_shared/waitlistWorker.ts";
import { createTicketEmailWebhookHandler } from "../../../../supabase/functions/ticket-email-webhook/index.ts";
import { verifyProviderObservation } from "../../../../supabase/functions/_shared/ticketEmailProvider.ts";
import type { ProviderEmailPayload } from "../../../../supabase/functions/_shared/ticketEmailAccess.ts";
const f = JSON.parse(
  await Deno.readTextFile(".superpowers/waitlist-proof/browser.json"),
) as {
  api: string;
  anon: string;
  service: string;
  token: string;
  otherToken: string;
  origin: string;
  edge: string;
  event: string;
  tier: string;
  owner: string;
};
assertEquals(f.api, "http://127.0.0.1:63321");
assertEquals(f.edge, "http://127.0.0.1:63330");
async function rpc(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const r = await fetch(`${f.api}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: f.anon,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const body = await r.json();
  if (!r.ok) {
    throw Error(
      `Local RPC ${name}: ${String(body.code)} ${String(body.message)}`,
    );
  }
  return body;
}
const service = (name: string, args: Record<string, unknown> = {}) =>
  rpc(f.service, name, args);
const deps = {
  appOrigin: f.origin,
  enabled: true,
  fingerprintSecret: new Uint8Array(32).fill(11),
  getTrustedIp: () => "127.0.0.1",
  rpc: service,
};
const join = createWaitlistHttpHandler("join", deps),
  leave = createWaitlistHttpHandler("leave", deps);
if (Deno.args.includes("--serve")) {
  Deno.serve({ hostname: "127.0.0.1", port: 63330 }, async (request) => {
    const u = new URL(request.url);
    if (u.pathname === "/health") return new Response("Local proof");
    if (u.pathname === "/functions/v1/waitlist-join") return join(request);
    if (u.pathname === "/functions/v1/waitlist-leave") return leave(request);
    if (
      u.pathname.startsWith("/rest/v1/") ||
      u.pathname.startsWith("/auth/v1/") ||
      u.pathname.startsWith("/storage/v1/")
    ) return fetch(new Request(f.api + u.pathname + u.search, request));
    return new Response(null, { status: 404 });
  });
} else {
  const config = {
    keyId: "local-proof",
    keys: new Map([["local-proof", new Uint8Array(32).fill(17)]]),
  };
  const deliveries: {
    payload: ProviderEmailPayload;
    key: string;
    provider: string;
  }[] = [];
  let attempts = 0;
  const results: Record<string, number> = {};
  await Promise.all(Array.from({ length: 1 }, async () => {
    while (attempts++ < 6500) {
      const state = await processWaitlistDelivery({
        config,
        rpc: service,
        now: Date.now,
        send: async (payload, key) => {
          const provider = "local-" + crypto.randomUUID();
          deliveries.push({ payload, key, provider });
          return { outcome: "accepted", providerId: provider };
        },
      });
      results[state] = (results[state] ?? 0) + 1;
      if (state === "empty") {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        if (
          deliveries.filter((x) =>
            x.payload.subject.includes("tickets are available again") &&
            x.payload.text.includes(f.event)
          ).length === 1000
        ) break;
      }
    }
  }));
  const restock = deliveries.filter((x) =>
    x.payload.subject.includes("tickets are available again") &&
    x.payload.text.includes(f.event)
  );
  assertEquals(restock.length, 1000);
  assertEquals(new Set(restock.map((x) => x.payload.to)).size, 1000);
  assertEquals(new Set(restock.map((x) => x.key)).size, 1000);
  assert(
    restock.every((x) =>
      x.key === "waitlist/" + x.payload.tags[0].value &&
      x.payload.text.includes("Availability is not guaranteed") &&
      !x.payload.html.includes("/ticket-access")
    ),
  );
  const first = restock[0];
  const token = first.payload.html.match(/wl1_[A-Za-z0-9_-]{43}/)?.[0];
  assert(token);
  const bytes = new Uint8Array(32).fill(29);
  const secret = "whsec_" + btoa(String.fromCharCode(...bytes));
  const webhook = createTicketEmailWebhookHandler({
    readEnv: () => secret,
    rpc: service,
    verify: verifyProviderObservation,
  });
  async function observe(tamper: boolean, wrongProvider = false) {
    const provider = wrongProvider
      ? "local-wrong-" + crypto.randomUUID()
      : first.provider;
    // Exercise signature rejection before routing; matching provider is read from the real accepted ledger below.
    const raw = JSON.stringify({
      type: "email.complained",
      created_at: new Date().toISOString(),
      data: {
        email_id: provider,
        tags: { attempt_id: first.payload.tags[0].value },
      },
    });
    const id = crypto.randomUUID(),
      timestamp = String(Math.floor(Date.now() / 1000));
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
    return webhook(
      new Request(f.edge, {
        method: "POST",
        headers: {
          "svix-id": id,
          "svix-timestamp": timestamp,
          "svix-signature": "v1," +
            btoa(String.fromCharCode(...new Uint8Array(signature))),
        },
        body: raw + (tamper ? " " : ""),
      }),
    );
  }
  assertEquals((await observe(true)).status, 400);
  assertEquals((await observe(false, true)).status, 400);
  assertEquals((await observe(false)).status, 200);
  const req = () =>
    new Request(f.edge, {
      method: "POST",
      headers: { origin: f.origin, "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  assertEquals(await (await leave(req())).json(), { kind: "removed" });
  assertEquals(await (await leave(req())).json(), { kind: "removed" });
  const owner = await rpc(f.token, "get_owned_waitlist", {
    p_event_id: f.event,
    p_tier_id: f.tier,
  });
  assertEquals(owner.entries.length, 50);
  assert(owner.nextCursor);
  let foreignDenied = false;
  try {
    await rpc(f.otherToken, "get_owned_waitlist", { p_event_id: f.event });
  } catch {
    foreignDenied = true;
  }
  assert(foreignDenied);
  await Deno.writeTextFile(
    ".superpowers/waitlist-proof/provider-capture.json",
    JSON.stringify(deliveries),
  );
  await Deno.writeTextFile(
    ".superpowers/waitlist-proof/leave-token.txt",
    token,
  );
  await Deno.writeTextFile(
    ".superpowers/waitlist-proof/delivery-flow.json",
    JSON.stringify({
      results,
      restock: restock.length,
      unique: new Set(restock.map((x) => x.payload.to)).size,
      repeatLeave: true,
      ownerPage: owner.entries.length,
      foreignDenied,
    }),
  );
  console.log(
    "PASS 1000 real encrypted/rendered restock deliveries, stable keys, local transport only; leave/idempotence, owner pagination/foreign denial and signature/provider rejection",
  );
  Deno.exit(0); // React Email runtime handles must not keep the completed CLI proof alive.
}
