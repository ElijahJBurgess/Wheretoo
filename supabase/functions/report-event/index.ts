import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "../_shared/database.ts";
import {
  getCorsHeaders,
  handleCorsPreflight,
  hasExactCorsOrigin,
} from "../_shared/cors.ts";
import { getAppBaseUrl, getReportFingerprintSecret } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import {
  type ReportFingerprints,
  type ReportRequest,
  reportRequestSchema,
  type ReportSubmissionDisposition,
} from "./contracts.ts";

const textEncoder = new TextEncoder();

function normalizeClientAddress(value: string | null): string | null {
  if (value === null) return null;
  const candidate = value.split(",", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[0-9a-f:.]{3,45}$/.test(candidate) ? candidate : null;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)),
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function networkBucket(address: string): string {
  const octets = address.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (octets !== null) return `${octets[1]}.${octets[2]}.${octets[3]}.0/24`;
  return `${address.slice(0, 19)}::/64`;
}

export async function deriveReportFingerprints(
  normalizedAddress: string,
  secret: string,
): Promise<ReportFingerprints> {
  const [actorFingerprint, networkFingerprint] = await Promise.all([
    hmacHex(secret, `actor:${normalizedAddress}`),
    hmacHex(secret, `network:${networkBucket(normalizedAddress)}`),
  ]);
  return { actorFingerprint, networkFingerprint };
}

export interface ReportEventDependencies {
  appOrigin: string;
  reportFingerprintSecret: string;
  clientAddress(request: Request): string | null;
  submit(
    payload: ReportRequest & ReportFingerprints,
  ): Promise<ReportSubmissionDisposition>;
}

export function createDatabaseDependencies(
  client: SupabaseClient,
  appOrigin: string,
  reportFingerprintSecret: string,
): ReportEventDependencies {
  return {
    appOrigin,
    reportFingerprintSecret,
    clientAddress: (request) =>
      normalizeClientAddress(request.headers.get("x-forwarded-for")),
    async submit(payload) {
      const { data, error } = await client.rpc("server_submit_event_report", {
        p_event_id: payload.eventId,
        p_reporter_fingerprint: payload.actorFingerprint,
        p_network_fingerprint: payload.networkFingerprint,
        p_reason: payload.reason,
      });
      if (
        error !== null ||
        !["submitted", "duplicate", "rate_limited", "not_found"].includes(
          String(data),
        )
      ) {
        throw new Error("REPORT_SUBMISSION_FAILED");
      }
      return data as ReportSubmissionDisposition;
    },
  };
}

export function createReportEventHandler(
  dependencies: ReportEventDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const preflight = handleCorsPreflight(request, dependencies.appOrigin);
    if (preflight !== null) return preflight;
    const headers = getCorsHeaders(request, dependencies.appOrigin);
    if (!hasExactCorsOrigin(request, dependencies.appOrigin)) {
      return jsonResponse(
        { error: { code: "CORS_ORIGIN_DENIED" } },
        403,
        headers,
      );
    }
    if (request.method !== "POST") {
      return jsonResponse(
        { error: { code: "METHOD_NOT_ALLOWED" } },
        405,
        headers,
      );
    }
    try {
      const body = reportRequestSchema.safeParse(await request.json());
      const address = dependencies.clientAddress(request);
      if (!body.success || address === null) {
        return jsonResponse(
          { error: { code: "INVALID_REQUEST" } },
          400,
          headers,
        );
      }
      const disposition = await dependencies.submit({
        ...body.data,
        ...await deriveReportFingerprints(
          address,
          dependencies.reportFingerprintSecret,
        ),
      });
      if (disposition === "not_found") {
        return jsonResponse(
          { error: { code: "EVENT_NOT_FOUND" } },
          404,
          headers,
        );
      }
      return jsonResponse({ status: "received" }, 202, headers);
    } catch {
      return jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500, headers);
    }
  };
}

function defaultDependencies(): ReportEventDependencies {
  return createDatabaseDependencies(
    getServiceClient(),
    getAppBaseUrl(),
    getReportFingerprintSecret(),
  );
}

export function handler(request: Request): Promise<Response> {
  return createReportEventHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
