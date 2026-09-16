import { isIP } from "node:net";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import {
  discoveryEnvelopeSchema,
  discoveryRequestSchema,
  discoveryRowSchema,
} from "./contracts.ts";

export interface DiscoveryDependencies {
  appOrigin: string;
  fingerprintSecret: Uint8Array;
  getTrustedIp(request: Request): string | null;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
}
const safeQueryErrors = new Set([
  "DISCOVERY_QUERY_INVALID",
  "DISCOVERY_CURSOR_INVALID",
  "DISCOVERY_CURSOR_EXPIRED",
]);
export async function fingerprintIdentity(
  key: Uint8Array,
  identity: string,
): Promise<string> {
  const version = isIP(identity);
  if (key.length !== 32 || !version) throw new Error("DISCOVERY_UNAVAILABLE");
  const normalized = version === 6
    ? new URL(`http://[${identity}]/`).hostname
    : identity;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hash = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(`whereto:discovery:ip:v1:${normalized}`),
    ),
  );
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function readBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json" || !request.body
  ) throw new Error("Invalid request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2048) {
        await reader.cancel();
        throw new Error("Oversized request");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function isRateResult(
  value: unknown,
): value is { allowed: boolean; retryAfterSeconds: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && typeof v.allowed === "boolean" &&
    Number.isInteger(v.retryAfterSeconds) &&
    Number(v.retryAfterSeconds) >= (v.allowed ? 0 : 1) &&
    Number(v.retryAfterSeconds) <= 60 &&
    (!v.allowed || v.retryAfterSeconds === 0);
}
export function createPublicDiscoveryHandler(
  dependencies: DiscoveryDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const headers = getCorsHeaders(request, dependencies.appOrigin);
    headers.set("access-control-expose-headers", "Retry-After");
    const fail = (code: string, status: number, retryAfterSeconds?: number) =>
      jsonResponse(
        {
          error: {
            code,
            ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          },
        },
        status,
        headers,
      );
    if (!headers.has("access-control-allow-origin")) {
      return fail("CORS_ORIGIN_DENIED", 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);
    let query;
    try {
      query = discoveryRequestSchema.parse(await readBody(request));
    } catch {
      return fail("DISCOVERY_QUERY_INVALID", 400);
    }
    try {
      const ip = dependencies.getTrustedIp(request);
      if (!ip) return fail("DISCOVERY_UNAVAILABLE", 503);
      const identityHash = await fingerprintIdentity(
        dependencies.fingerprintSecret,
        ip,
      );
      const rate = await dependencies.rpc(
        "server_consume_discovery_read_rate_limit",
        { p_identity_hash: identityHash },
      );
      if (!isRateResult(rate)) return fail("DISCOVERY_UNAVAILABLE", 503);
      if (!rate.allowed) {
        headers.set("retry-after", String(rate.retryAfterSeconds));
        return fail("DISCOVERY_RATE_LIMITED", 429, rate.retryAfterSeconds);
      }
      const result = discoveryEnvelopeSchema.safeParse(
        await dependencies.rpc("server_get_public_discovery_events", {
          p_query: query,
        }),
      );
      if (!result.success || result.data.items.length > (query.limit ?? 20)) {
        return fail("DISCOVERY_UNAVAILABLE", 503);
      }
      const items = result.data.items.map((row) => {
        const parsed = discoveryRowSchema.safeParse(row);
        return parsed.success ? parsed.data : null;
      });
      if (items.length > 0 && items.every((row) => row === null)) {
        return fail("DISCOVERY_UNAVAILABLE", 503);
      }
      return jsonResponse({ ...result.data, items }, 200, headers);
    } catch (error) {
      // Only owned query codes may cross this boundary; never serialize database/provider errors.
      const code = error instanceof Error ? error.message : "";
      return safeQueryErrors.has(code)
        ? fail(code, 400)
        : fail("DISCOVERY_UNAVAILABLE", 503);
    }
  };
}
export async function handler(request: Request): Promise<Response> {
  try {
    const ipHeader = Deno.env.get("DISCOVERY_TRUSTED_IP_HEADER") ?? "";
    const secret = Uint8Array.from(
      atob(Deno.env.get("DISCOVERY_RATE_SECRET") ?? ""),
      (c) => c.charCodeAt(0),
    );
    // Deployment must attest that its gateway overwrites this header; no forwarded-header fallback.
    if (
      Deno.env.get("DISCOVERY_TRUSTED_IP_HEADER_VERIFIED") !== "true" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(ipHeader) || secret.length !== 32
    ) throw new Error("Unavailable");
    return await createPublicDiscoveryHandler({
      appOrigin: getAppBaseUrl(),
      fingerprintSecret: secret,
      getTrustedIp: (req) => req.headers.get(ipHeader),
      rpc: async (name, args) => {
        const { data, error } = await getServiceClient().rpc(name, args);
        if (error) {
          throw new Error(
            safeQueryErrors.has(error.message)
              ? error.message
              : "DISCOVERY_UNAVAILABLE",
          );
        }
        return data;
      },
    })(request);
  } catch {
    let headers: Headers | undefined;
    try {
      headers = getCorsHeaders(request, getAppBaseUrl());
    } catch { /* Fail closed if even app-origin configuration is absent. */ }
    return jsonResponse(
      { error: { code: "DISCOVERY_UNAVAILABLE" } },
      503,
      headers,
    );
  }
}
if (import.meta.main) Deno.serve(handler);
