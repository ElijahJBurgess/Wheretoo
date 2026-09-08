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
  "payment_failed",
  "cancelled",
  "expired",
  "refunded",
  "requires_review",
]);

type ConfirmationStatus =
  | "processing"
  | "paid"
  | "payment_failed"
  | "cancelled"
  | "expired"
  | "refunded"
  | "requires_review";

type ConfirmationItem = {
  tierName: string;
  quantity: number;
  unitAmountMinor: number;
  subtotalMinor: number;
  currency: "usd";
};

export interface OrderConfirmationProjection {
  event: {
    title: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    venueName: string | null;
  };
  items: ConfirmationItem[];
  orderNumber: string;
  status: ConfirmationStatus;
  quantity: number;
  currency: "usd";
  subtotalMinor: number;
  taxAmountMinor: 0;
  totalMinor: number;
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

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    expected.every((key) => keys.includes(key));
}

function isSafeInteger(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= minimum;
}

export async function defaultFindConfirmation(
  tokenHash: string,
  client: SupabaseClient = getServiceClient(),
): Promise<OrderConfirmationProjection | null> {
  const { data, error } = await client.rpc(
    "server_lookup_checkout_integrity_confirmation",
    { p_token_hash: tokenHash },
  );
  if (error !== null || !Array.isArray(data)) {
    throw new ConfirmationError(500, "INTERNAL_ERROR");
  }
  if (data.length === 0) return null;
  if (data.length !== 1 || !isRecord(data[0])) {
    throw new ConfirmationError(500, "INTERNAL_ERROR");
  }

  const row = data[0];
  const rowKeys = [
    "event_title",
    "event_starts_at",
    "event_ends_at",
    "event_timezone",
    "event_venue_name",
    "items",
    "order_number",
    "confirmation_status",
    "quantity",
    "currency",
    "subtotal_minor",
    "tax_amount_minor",
    "total_minor",
  ];
  if (
    !hasExactKeys(row, rowKeys) ||
    typeof row.event_title !== "string" || row.event_title.length === 0 ||
    !isTimestamp(row.event_starts_at) || !isTimestamp(row.event_ends_at) ||
    typeof row.event_timezone !== "string" ||
    (row.event_venue_name !== null &&
      typeof row.event_venue_name !== "string") ||
    !Array.isArray(row.items) || row.items.length === 0 ||
    row.items.length > 10 ||
    typeof row.order_number !== "string" || row.order_number.length === 0 ||
    typeof row.confirmation_status !== "string" ||
    !SAFE_STATUSES.has(row.confirmation_status) ||
    !isSafeInteger(row.quantity, 1) || row.quantity > 10 ||
    row.currency !== "usd" ||
    !isSafeInteger(row.subtotal_minor, 1) ||
    row.tax_amount_minor !== 0 ||
    !isSafeInteger(row.total_minor, 1) ||
    row.total_minor !== row.subtotal_minor
  ) {
    throw new ConfirmationError(500, "INTERNAL_ERROR");
  }

  const itemKeys = [
    "tier_name",
    "quantity",
    "unit_amount_minor",
    "subtotal_minor",
    "currency",
  ];
  const items: ConfirmationItem[] = [];
  let quantity = 0;
  let subtotalMinor = 0;
  for (const item of row.items) {
    if (
      !isRecord(item) || !hasExactKeys(item, itemKeys) ||
      typeof item.tier_name !== "string" || item.tier_name.length === 0 ||
      !isSafeInteger(item.quantity, 1) || item.quantity > 10 ||
      !isSafeInteger(item.unit_amount_minor, 1) ||
      !isSafeInteger(item.subtotal_minor, 1) ||
      item.currency !== "usd" ||
      item.unit_amount_minor * item.quantity !== item.subtotal_minor
    ) {
      throw new ConfirmationError(500, "INTERNAL_ERROR");
    }
    quantity += item.quantity;
    subtotalMinor += item.subtotal_minor;
    if (
      !Number.isSafeInteger(quantity) || !Number.isSafeInteger(subtotalMinor)
    ) {
      throw new ConfirmationError(500, "INTERNAL_ERROR");
    }
    items.push({
      tierName: item.tier_name,
      quantity: item.quantity,
      unitAmountMinor: item.unit_amount_minor,
      subtotalMinor: item.subtotal_minor,
      currency: "usd",
    });
  }
  if (quantity !== row.quantity || subtotalMinor !== row.subtotal_minor) {
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
    items,
    orderNumber: row.order_number,
    status: row.confirmation_status as ConfirmationStatus,
    quantity: row.quantity,
    currency: "usd",
    subtotalMinor: row.subtotal_minor,
    taxAmountMinor: 0,
    totalMinor: row.total_minor,
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
