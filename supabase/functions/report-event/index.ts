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
import { canonicalizeClientAddress } from "./ip.ts";

const textEncoder = new TextEncoder();

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

export async function deriveReportFingerprints(
  canonicalActorInput: string,
  secret: string,
  canonicalNetworkInput = canonicalActorInput,
): Promise<ReportFingerprints> {
  const [actorFingerprint, networkFingerprint] = await Promise.all([
    hmacHex(secret, `actor:${canonicalActorInput}`),
    hmacHex(secret, `network:${canonicalNetworkInput}`),
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
      request.headers.get("x-forwarded-for")?.split(",", 1)[0] ?? null,
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
      const address = canonicalizeClientAddress(
        dependencies.clientAddress(request),
      );
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
          address.actorInput,
          dependencies.reportFingerprintSecret,
          address.networkInput,
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
