import { createClient } from "@supabase/supabase-js";
import { createTicketCollectionHandler } from "../../../../supabase/functions/ticket-collection/index.ts";
import { createOrderConfirmationHandler, defaultFindConfirmation } from "../../../../supabase/functions/order-confirmation/index.ts";
// Disposable transport only. Real production handlers, real local SQL, injected provider.
import { createHmac } from "node:crypto";
import { createTicketEmailHttpHandler } from "../../../../supabase/functions/_shared/ticketEmailHttp.ts";
import { createTicketEmailWorkerHandler } from "../../../../supabase/functions/ticket-email-worker/index.ts";
import { createTicketEmailWebhookHandler } from "../../../../supabase/functions/ticket-email-webhook/index.ts";
import { verifyProviderObservation } from "../../../../supabase/functions/_shared/ticketEmailProvider.ts";

const origin = "http://127.0.0.1:3030";
const rest = "http://127.0.0.1:55546";
const jwtSecret = "spec10-local-only-jwt-secret-disposable-2026";
const key = new Uint8Array(32).fill(7);
const workerSecret = "spec10-local-worker-invocation-only-2026";
const webhookSecret = "whsec_" + btoa("spec10-local-webhook-signature-key");
function token(role: string, sub?: string) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = encode({ alg: "HS256", typ: "JWT" }) + "." +
    encode({ role, ...(sub ? { sub } : {}), exp: 1893456000 });
  return body + "." +
    createHmac("sha256", jwtSecret).update(body).digest("base64url");
}
async function verifyDisposable() {
  const ids = await Promise.all(
    ["database", "rest"].map(async (name) =>
      JSON.parse(
        await Deno.readTextFile(`.superpowers/spec10-spec11/${name}-identity.json`),
      ).id as string
    ),
  );
  const result = await new Deno.Command("docker", {
    args: ["inspect", ...ids],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!result.success) throw new Error("Disposable identity unavailable");
  const containers = JSON.parse(new TextDecoder().decode(result.stdout));
  for (const [index, container] of containers.entries()) {
    const port = index === 0 ? "5432/tcp" : "3000/tcp";
    const binding = container.NetworkSettings.Ports[port];
    if (
      container.Id !== ids[index] ||
      container.Config.Labels["wheretoo.task"] !== "spec10-spec11-integration" ||
      binding.length !== 1 || binding[0].HostIp !== "127.0.0.1" ||
      binding[0].HostPort !== String(index === 0 ? 55545 : 55546)
    ) throw new Error("Disposable identity mismatch");
    if (
      index === 0 &&
      !container.Config.Cmd.includes("cron.launch_active_jobs=off")
    ) throw new Error("Scheduler must remain disabled");
  }
}
async function rpc(name: string, args: Record<string, unknown> = {}) {
  await verifyDisposable();
  const response = await fetch(rest + "/rpc/" + name, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token("service_role"),
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error("Local RPC failed: " + name + " " + response.status);
  }
  return response.json();
}
const httpDependencies = {
  appOrigin: origin,
  recoveryEnabled: true,
  keyId: "local",
  keys: new Map([["local", key]]),
  fingerprintSecret: key,
  getTrustedIp: () => "127.0.0.1",
  getCredentialSecret: () => key,
  rpc,
};
const refundAccess = createTicketEmailHttpHandler(
  "refund_access",
  httpDependencies,
);
const access = createTicketEmailHttpHandler("access", httpDependencies);
const eventStatus = createTicketEmailHttpHandler("event_status", httpDependencies);
const status = createTicketEmailHttpHandler("status", httpDependencies);
const webhook = createTicketEmailWebhookHandler({
  readEnv: (name) =>
    name === "RESEND_WEBHOOK_SECRET" ? webhookSecret : undefined,
  rpc,
  verify: verifyProviderObservation,
});
type Captured = {
  id: string;
  key: string;
  wire: string;
  attemptId: string;
  to: string;
  html: string;
  text: string;
};
const messages = new Map<string, Captured>();
let mode: "accepted" | "lost" | "webhook_before_response" | "failed" =
  "accepted";
async function observation(message: Captured, kind = "delivered") {
  const id = "local-" + crypto.randomUUID(),
    timestamp = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify({
    type: "email." + kind,
    created_at: new Date().toISOString(),
    data: { email_id: message.id, tags: { attempt_id: message.attemptId } },
  });
  const signature = createHmac(
    "sha256",
    Buffer.from(webhookSecret.slice(6), "base64"),
  ).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return webhook(
    new Request("http://127.0.0.1:55547/functions/v1/ticket-email-webhook", {
      method: "POST",
      headers: {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": "v1," + signature,
      },
      body: raw,
    }),
  );
}
const config: Record<string, string> = {
  TICKET_EMAIL_WORKER_ENABLED: "true",
  TICKET_EMAIL_WORKER_SECRET: workerSecret,
  TICKET_EMAIL_FROM: "Wheretoo <tickets@example.invalid>",
  TICKET_EMAIL_SUPPORT_EMAIL: "support@example.invalid",
  RESEND_API_KEY: "re_spec10_never_real",
  APP_BASE_URL: origin,
  TICKET_EMAIL_PAYLOAD_KEY_ID: "local",
  TICKET_EMAIL_PAYLOAD_KEYS_JSON: JSON.stringify({
    local: Buffer.from(key).toString("base64"),
  }),
};
const worker = createTicketEmailWorkerHandler({
  readEnv: (name) => config[name],
  rpc,
  now: Date.now,
  fetch: async (url, init) => {
    if (url !== "https://api.resend.com/emails") {
      throw new Error("Unexpected provider target");
    }
    const currentMode = mode;
    mode = "accepted";
    if (currentMode === "failed") return new Response("{}", { status: 422 });
    const wire = String(init?.body), body = JSON.parse(wire);
    const idempotency = new Headers(init?.headers).get("Idempotency-Key")!;
    let message = messages.get(idempotency);
    if (message && message.wire !== wire) {
      throw new Error("Immutable provider payload changed");
    }
    if (!message) {
      message = {
        id: crypto.randomUUID(),
        key: idempotency,
        wire,
        attemptId: body.tags[0].value,
        to: body.to,
        html: body.html,
        text: body.text,
      };
      messages.set(idempotency, message);
    }
    if (currentMode === "webhook_before_response") {
      if ((await observation(message)).status !== 200) {
        throw new Error("Fixture signature failed");
      }
      throw new Error("Synthetic accepted response lost");
    }
    if (currentMode === "lost") {
      throw new Error("Synthetic accepted response lost");
    }
    return Response.json({ id: message.id });
  },
});
const collection = createTicketCollectionHandler({
  appOrigin: origin, getCredentialSecret: () => key,
  findCollection: async hash => (await rpc("server_lookup_paid_ticket_collection", {p_confirmation_token_hash: hash}))[0] ?? null,
  findFreeCollection: hash => rpc("server_lookup_free_ticket_collection", {p_access_hash: hash}),
});
const confirmationClient = createClient("http://127.0.0.1:55547", token("service_role"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const confirmation = createOrderConfirmationHandler({appOrigin: origin, findConfirmation: async hash => {
  await verifyDisposable(); return defaultFindConfirmation(hash, confirmationClient);
}});
await verifyDisposable();
Deno.serve({ hostname: "127.0.0.1", port: 55547 }, async (request) => {
  const url = new URL(request.url), path = url.pathname;
  if (path === "/functions/v1/event-status-access") return eventStatus(request);
  if (path === "/functions/v1/ticket-collection") return collection(request);
  if (path === "/functions/v1/order-confirmation") return confirmation(request);
  if (path === "/health") return new Response("spec10-disposable");
  if (path === "/functions/v1/refund-detail-access") {
    return refundAccess(request);
  }
  if (path === "/functions/v1/ticket-email-worker") return worker(request);
  if (path === "/functions/v1/ticket-email-access") return access(request);
  if (path === "/functions/v1/ticket-email-status") return status(request);
  if (path === "/functions/v1/ticket-email-webhook") return webhook(request);
  if (path === "/__spec10/messages") {
    return Response.json([...messages.values()]);
  }
  if (path === "/__spec10/work" && request.method === "POST") {
    const input = await request.json();
    if (
      ["accepted", "lost", "webhook_before_response", "failed"].includes(
        input.mode,
      )
    ) mode = input.mode;
    return worker(
      new Request("http://127.0.0.1:55547/functions/v1/ticket-email-worker", {
        method: "POST",
        headers: { authorization: "Bearer " + workerSecret },
      }),
    );
  }
  if (path === "/__spec10/observe" && request.method === "POST") {
    const input = await request.json(),
      message = [...messages.values()].find((m) =>
        m.attemptId === input.attemptId
      );
    return message
      ? observation(message, input.kind ?? "delivered")
      : new Response(null, { status: 404 });
  }
  if (path.startsWith("/rest/v1/")) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-headers":
            "authorization, apikey, content-type, x-client-info",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "cache-control": "no-store",
        },
      });
    }
    await verifyDisposable();
    const supplied = request.headers.get("authorization");
    const response = await fetch(
      rest + path.slice("/rest/v1".length) + url.search,
      {
        method: request.method,
        headers: {
          "content-type": "application/json",
          authorization: supplied?.startsWith("Bearer ey")
            ? supplied
            : "Bearer " + token("anon"),
        },
        body: request.method === "POST" ? await request.text() : undefined,
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": origin,
        "cache-control": "no-store",
      },
    });
  }
  return new Response("Outside disposable Spec 09 proof", { status: 404 });
});
