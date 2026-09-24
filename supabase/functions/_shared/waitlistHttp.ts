import { z } from "zod";
import { isIP } from "node:net";
import { canonicalEmail, emailRateFingerprint } from "./ticketEmailAccess.ts";
import { hashWaitlistToken } from "./waitlistEmail.ts";
import { getCorsHeaders } from "./cors.ts";
import { getServiceClient } from "./database.ts";
import { getAppBaseUrl } from "./env.ts";
import type { EmailRpc } from "./ticketEmailWorker.ts";
type Operation = "join" | "leave";
export type WaitlistHttpDependencies = {
  appOrigin: string;
  enabled: boolean;
  fingerprintSecret: Uint8Array;
  getTrustedIp: (req: Request) => string | null;
  rpc: EmailRpc;
};
const join = z.object({
  eventId: z.uuid(),
  tierId: z.uuid(),
  name: z.string().trim().min(1).refine((v) =>
    Array.from(v).length <= 120 &&
    !Array.from(v).some((c) =>
      c.codePointAt(0)! < 32 || c.codePointAt(0) === 127
    )
  ),
  email: z.string().trim().toLowerCase().refine(canonicalEmail),
  requestId: z.uuid(),
}).strict();
const leave = z.object({ token: z.string().max(100) }).strict();
async function boundedBody(request: Request) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) throw Error();
  const reader = request.body?.getReader();
  if (!reader) throw Error();
  let bytes = new Uint8Array(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes.length + value.length > 2048) {
        await reader.cancel();
        throw Error();
      }
      const next = new Uint8Array(bytes.length + value.length);
      next.set(bytes);
      next.set(value, bytes.length);
      bytes = next;
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function createWaitlistHttpHandler(
  operation: Operation,
  deps: WaitlistHttpDependencies,
) {
  return async (request: Request) => {
    const headers = getCorsHeaders(request, deps.appOrigin);
    headers.set("cache-control", "private, no-store");
    headers.set("referrer-policy", "no-referrer");
    const reply = (kind: string, status = 200) =>
      Response.json({ kind }, { status, headers });
    const unavailable = operation === "join"
      ? "WAITLIST_UNAVAILABLE"
      : "unavailable";
    if (!headers.has("access-control-allow-origin")) {
      return reply(unavailable, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return reply(unavailable, 405);
    let input: unknown;
    try {
      input = await boundedBody(request);
    } catch {
      return reply(operation === "join" ? "INVALID_INPUT" : "unavailable", 400);
    }
    try {
      const ip = deps.getTrustedIp(request);
      if (!ip || !isIP(ip) || deps.fingerprintSecret.length !== 32) {
        return reply(unavailable, 503);
      }
      const ipHash = await emailRateFingerprint(
        deps.fingerprintSecret,
        "waitlist_ip",
        ip,
      );
      if (operation === "join") {
        const parsed = join.safeParse(input);
        if (!parsed.success) return reply("INVALID_INPUT", 400);
        if (!deps.enabled) return reply(unavailable, 503);
        const p = parsed.data;
        const raw = await deps.rpc("server_join_waitlist", {
          p_event_id: p.eventId,
          p_tier_id: p.tierId,
          p_name: p.name,
          p_email: p.email,
          p_request_id: p.requestId,
          p_ip_hash: ipHash,
        });
        const result = z.object({
          kind: z.enum([
            "joined",
            "TICKETS_AVAILABLE",
            "WAITLIST_UNAVAILABLE",
            "INVALID_INPUT",
            "RATE_LIMITED",
          ]),
        }).strict().parse(raw);
        return reply(
          result.kind,
          ({
            joined: 202,
            TICKETS_AVAILABLE: 409,
            WAITLIST_UNAVAILABLE: 503,
            INVALID_INPUT: 400,
            RATE_LIMITED: 429,
          })[result.kind],
        );
      }
      const p = leave.safeParse(input);
      if (!p.success) return reply("unavailable", 400);
      let hash: string | null = null;
      try {
        hash = await hashWaitlistToken(p.data.token);
      } catch { /* Invalid tokens still consume the leave abuse budget. */ }
      const raw = await deps.rpc("server_leave_waitlist", {
        p_token_hash: hash,
        p_ip_hash: ipHash,
      });
      const result = z.object({
        kind: z.enum(["removed", "unavailable", "rate_limited"]),
      }).strict().parse(raw);
      return reply(
        result.kind,
        result.kind === "removed"
          ? 200
          : result.kind === "rate_limited"
          ? 429
          : 404,
      );
    } catch {
      return reply(unavailable, 503);
    }
  };
}
export async function waitlistHttpHandler(
  operation: Operation,
  request: Request,
): Promise<Response> {
  try {
    const secret = Uint8Array.from(
      atob(Deno.env.get("WAITLIST_RATE_SECRET") ?? ""),
      (c) => c.charCodeAt(0),
    );
    const ipHeader = Deno.env.get("WAITLIST_TRUSTED_IP_HEADER") ?? "";
    if (secret.length !== 32 || !/^[a-z][a-z0-9-]{0,63}$/.test(ipHeader)) {
      throw Error();
    }
    return await createWaitlistHttpHandler(operation, {
      appOrigin: getAppBaseUrl(),
      enabled: Deno.env.get("WAITLIST_PUBLIC_ENABLED") === "true",
      fingerprintSecret: secret,
      getTrustedIp: (req) => req.headers.get(ipHeader),
      rpc: async (name, args = {}) => {
        const { data, error } = await getServiceClient().rpc(name, args);
        if (error) throw Error("Unavailable");
        return data;
      },
    })(request);
  } catch {
    return Response.json({
      kind: operation === "join" ? "WAITLIST_UNAVAILABLE" : "unavailable",
    }, {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }
}
