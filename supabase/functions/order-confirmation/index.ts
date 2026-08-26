import type { SupabaseClient } from "@supabase/supabase-js";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import {
  hashConfirmationBearer,
  isRecord,
} from "../stripe-create-checkout/index.ts";

const MAX_REQUEST_BYTES = 512;
const SAFE_STATUSES = new Set([
  "processing",
  "paid",
  "failed",
  "expired",
  "refunded",
]);

type ConfirmationStatus =
  | "processing"
  | "paid"
  | "failed"
  | "expired"
  | "refunded";

export interface OrderConfirmationProjection {
  event: {
    title: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    venueName: string | null;
  };
  tier: { name: string };
  orderNumber: string;
  status: ConfirmationStatus;
}

export interface OrderConfirmationDependencies {
  appOrigin: string;
  findConfirmation(
    tokenHash: string,
  ): Promise<OrderConfirmationProjection | null>;
}

class ConfirmationError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | "CORS_ORIGIN_DENIED"
      | "INTERNAL_ERROR"
      | "METHOD_NOT_ALLOWED"
      | "ORDER_NOT_FOUND",
  ) {
    super(code);
  }
}

function safeResponse(error: unknown, headers: Headers): Response {
  if (error instanceof ConfirmationError) {
    return jsonResponse({ error: { code: error.code } }, error.status, headers);
  }
  return jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500, headers);
}

async function readBearer(request: Request): Promise<string> {
  if (request.method !== "POST") {
    throw new ConfirmationError(405, "METHOD_NOT_ALLOWED");
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    contentType !== "application/json" ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength > MAX_REQUEST_BYTES
  ) {
    throw new ConfirmationError(404, "ORDER_NOT_FOUND");
  }

  const raw = await request.text();
  if (
    raw.length === 0 || new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES
  ) {
    throw new ConfirmationError(404, "ORDER_NOT_FOUND");
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) || Object.keys(parsed).length !== 1 ||
      Object.keys(parsed)[0] !== "confirmationToken" ||
      typeof parsed.confirmationToken !== "string"
    ) {
      throw new Error("invalid body");
    }
    return parsed.confirmationToken;
  } catch {
    throw new ConfirmationError(404, "ORDER_NOT_FOUND");
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    Number.isFinite(Date.parse(value));
}

export async function defaultFindConfirmation(
  tokenHash: string,
  client: SupabaseClient = getServiceClient(),
): Promise<OrderConfirmationProjection | null> {
  const { data, error } = await client.rpc("server_lookup_order_confirmation", {
    p_token_hash: tokenHash,
  });
  if (error !== null || !Array.isArray(data)) {
    throw new ConfirmationError(500, "INTERNAL_ERROR");
  }
  if (data.length === 0) return null;
  if (data.length !== 1 || !isRecord(data[0])) {
    throw new ConfirmationError(500, "INTERNAL_ERROR");
  }

  const row = data[0];
  if (
    typeof row.event_title !== "string" || row.event_title.length === 0 ||
    !isTimestamp(row.event_starts_at) || !isTimestamp(row.event_ends_at) ||
    typeof row.event_timezone !== "string" ||
    (row.event_venue_name !== null &&
      typeof row.event_venue_name !== "string") ||
    typeof row.tier_name !== "string" || row.tier_name.length === 0 ||
    typeof row.order_number !== "string" || row.order_number.length === 0 ||
    typeof row.confirmation_status !== "string" ||
    !SAFE_STATUSES.has(row.confirmation_status)
  ) {
    throw new ConfirmationError(500, "INTERNAL_ERROR");
  }

  return {
    event: {
      title: row.event_title,
      startsAt: row.event_starts_at,
      endsAt: row.event_ends_at,
      timezone: row.event_timezone,
      venueName: row.event_venue_name,
    },
    tier: { name: row.tier_name },
    orderNumber: row.order_number,
    status: row.confirmation_status as ConfirmationStatus,
  };
}

function defaultDependencies(): OrderConfirmationDependencies {
  return {
    appOrigin: getAppBaseUrl(),
    findConfirmation: defaultFindConfirmation,
  };
}

export function createOrderConfirmationHandler(
  dependencies: OrderConfirmationDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const preflight = handleCorsPreflight(request, dependencies.appOrigin);
    if (preflight !== null) return preflight;
    const headers = getCorsHeaders(request, dependencies.appOrigin);

    try {
      if (!headers.has("access-control-allow-origin")) {
        throw new ConfirmationError(403, "CORS_ORIGIN_DENIED");
      }
      const bearer = await readBearer(request);
      let tokenHash: string;
      try {
        tokenHash = await hashConfirmationBearer(bearer);
      } catch {
        throw new ConfirmationError(404, "ORDER_NOT_FOUND");
      }
      const confirmation = await dependencies.findConfirmation(tokenHash);
      if (confirmation === null) {
        throw new ConfirmationError(404, "ORDER_NOT_FOUND");
      }
      return jsonResponse(confirmation, 200, headers);
    } catch (error) {
      return safeResponse(error, headers);
    }
  };
}

export function handler(request: Request): Promise<Response> {
  return createOrderConfirmationHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
