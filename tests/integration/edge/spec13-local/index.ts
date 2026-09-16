// Disposable, loopback-only transport. Every RPC re-verifies its exact DB and REST containers.
import { createHmac } from "node:crypto";
import {
  createPublicDiscoveryHandler,
  fingerprintIdentity,
} from "../../../../supabase/functions/public-discovery/index.ts";
import { createFreeRsvpHandler } from "../../../../supabase/functions/_shared/freeRsvpHandler.ts";
import { createTicketCollectionHandler } from "../../../../supabase/functions/ticket-collection/index.ts";
const origin = Deno.args[0] ?? "http://127.0.0.1:3033";
const originUrl = new URL(origin);
if (
  originUrl.hostname !== "127.0.0.1" || originUrl.protocol !== "http:" ||
  originUrl.origin !== origin
) throw new Error("Only an explicit loopback app origin is allowed");
const rest = "http://127.0.0.1:55566";
const key = new Uint8Array(32).fill(13);
function token(role: string) {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = encode({ alg: "HS256", typ: "JWT" }) + "." +
    encode({ role, exp: 1893456000 });
  return body + "." +
    createHmac("sha256", "spec13-local-only-jwt-secret-disposable-2026").update(
      body,
    ).digest("base64url");
}
async function verifyDisposable() {
  for (
    const [name, port, internal] of [["database", "55565", "5432/tcp"], [
      "rest",
      "55566",
      "3000/tcp",
    ]]
  ) {
    const known = JSON.parse(
      await Deno.readTextFile(`.superpowers/spec13/${name}-identity.json`),
    );
    const result = await new Deno.Command("docker", {
      args: ["inspect", known.id],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!result.success) throw new Error("Disposable unavailable");
    const live = JSON.parse(new TextDecoder().decode(result.stdout))[0];
    if (
      live.Id !== known.id ||
      live.Name !==
        "/whereto-spec13-" + (name === "database" ? "db" : "rest") ||
      live.Config.Labels["wheretoo.task"] !== "spec13-discovery-home" ||
      JSON.stringify(live.NetworkSettings.Ports[internal]) !==
        JSON.stringify([{ HostIp: "127.0.0.1", HostPort: port }])
    ) throw new Error("Disposable mismatch");
    if (
      name === "database" &&
      !live.Config.Cmd.includes("cron.launch_active_jobs=off")
    ) throw new Error("Cron must be disabled");
  }
}
async function rpc(
  name: string,
  args: Record<string, unknown>,
  role = "service_role",
): Promise<unknown> {
  await verifyDisposable();
  const response = await fetch(rest + "/rpc/" + name, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token(role),
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const value = await response.json();
  if (!response.ok) {
    const message = typeof value?.message === "string" ? value.message : "";
    throw new Error(
      [
          "DISCOVERY_CURSOR_INVALID",
          "DISCOVERY_CURSOR_EXPIRED",
          "DISCOVERY_QUERY_INVALID",
        ].includes(message)
        ? message
        : "Local RPC unavailable",
    );
  }
  return value;
}
const discovery = createPublicDiscoveryHandler({
  appOrigin: origin,
  fingerprintSecret: key,
  getTrustedIp: () => "127.0.0.1",
  rpc,
});
const freeDependencies = {
  appOrigin: origin,
  getSecret: () => key,
  rpc,
  rateLimit: async (_req: Request, operation: "create" | "status") => {
    const value = await rpc("server_consume_free_rsvp_rate_limit", {
      p_identity_hash: await fingerprintIdentity(key, "127.0.0.1"),
      p_operation: operation,
    });
    if (
      !value || typeof value !== "object" || !("allowed" in value) ||
      !("retryAfterSeconds" in value)
    ) throw new Error("Invalid limiter response");
    return value as { allowed: boolean; retryAfterSeconds: number };
  },
};
const free = createFreeRsvpHandler("create", freeDependencies);
const freeStatus = createFreeRsvpHandler("status", freeDependencies);
const collection = createTicketCollectionHandler({
  appOrigin: origin,
  getCredentialSecret: () => key,
  findCollection: async () => null,
  findFreeCollection: (hash) =>
    rpc("server_lookup_free_ticket_collection", { p_access_hash: hash }),
});
const publicRpcs = new Set([
  "get_public_event",
  "get_public_event_ticketing",
  "get_public_free_rsvp",
]);
await verifyDisposable();
Deno.serve({ hostname: "127.0.0.1", port: 55567 }, async (request) => {
  const path = new URL(request.url).pathname;
  if (path === "/functions/v1/public-discovery") return discovery(request);
  if (path === "/functions/v1/free-rsvp") return free(request);
  if (path === "/functions/v1/free-rsvp-status") return freeStatus(request);
  if (path === "/functions/v1/ticket-collection") return collection(request);
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
    "vary": "Origin",
  });
  if (request.headers.get("origin") === origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set(
      "access-control-allow-headers",
      "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
    );
    headers.set("access-control-allow-methods", "POST,OPTIONS");
  }
  if (!headers.has("access-control-allow-origin")) {
    return new Response("{}", { status: 403, headers });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  const name = path.replace("/rest/v1/rpc/", "");
  if (
    request.method !== "POST" || !path.startsWith("/rest/v1/rpc/") ||
    !publicRpcs.has(name)
  ) return new Response("{}", { status: 404, headers });
  try {
    return new Response(
      JSON.stringify(await rpc(name, await request.json(), "anon")),
      { headers },
    );
  } catch {
    return new Response("{}", { status: 503, headers });
  }
});
