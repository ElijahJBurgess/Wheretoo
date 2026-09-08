import type { SupabaseClient } from "@supabase/supabase-js";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import {
  derivePaidAdmissionCredential,
  getTicketCredentialSecret,
  hashAdmissionCredential,
} from "../_shared/ticketCredentials.ts";
import {
  hashConfirmationBearer,
  isRecord,
} from "../stripe-create-checkout/index.ts";

type TicketStatus = "valid" | "used" | "refunded" | "cancelled";
type TicketDisplay =
  & {
    selector: string;
    eventId: string;
    eventName: string;
    startsAt: string;
    endsAt: string;
    venueName: string;
    admissionLabel: string;
    position: number;
    totalInCollection: number;
    attendeeLabel?: string;
    directionsUrl?: string;
  }
  & (
    | { status: "valid"; admissionCredential: string }
    | { status: Exclude<TicketStatus, "valid">; admissionCredential: null }
  );
type TicketCollection = {
  collectionLabel: string;
  eventId: string;
  tickets: readonly TicketDisplay[];
};
type TicketCollectionResult =
  | { kind: "ready"; collection: TicketCollection }
  | { kind: "empty"; eventId: string }
  | { kind: "unavailable" }
  | { kind: "not_enabled" };

export interface TicketCollectionDependencies {
  appOrigin: string;
  findCollection(tokenHash: string): Promise<unknown>;
  getCredentialSecret(): Uint8Array;
}

const MAX_REQUEST_BYTES = 512;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => key in value);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 &&
    value <= 10;
}
function label(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value &&
    [...value].length >= 1 && [...value].length <= 80;
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function response(
  body: TicketCollectionResult,
  status: number,
  headers: Headers,
): Response {
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}
function privateHeaders(headers: Headers): Headers {
  headers.set("cache-control", "private, no-store");
  headers.set("pragma", "no-cache");
  return headers;
}

async function readBearer(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim()
        .toLowerCase() !== "application/json" ||
    !Number.isSafeInteger(declared) || declared < 0 ||
    declared > MAX_REQUEST_BYTES || !request.body
  ) throw new Error("unavailable");
  // Bound the stream before decoding so a missing/false Content-Length cannot
  // force the function to buffer an unbounded request.
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_REQUEST_BYTES);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("unavailable");
      }
      bytes.set(value, length);
      length += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  const body: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
  );
  if (
    !isRecord(body) || !exact(body, ["collectionBearer"]) ||
    typeof body.collectionBearer !== "string"
  ) throw new Error("unavailable");
  return body.collectionBearer;
}

export async function defaultFindCollection(
  tokenHash: string,
  client: SupabaseClient = getServiceClient(),
): Promise<unknown> {
  const { data, error } = await client.rpc(
    "server_lookup_lite_ticket_collection",
    { p_token_hash: tokenHash },
  );
  if (error !== null || !Array.isArray(data) || data.length !== 1) return null;
  return data[0];
}

// Both hashes have fixed 32-byte length. Accumulate all byte differences;
// never short-circuit based on a matching hash prefix.
function hashesEqual(derived: Uint8Array, storedHex: string): boolean {
  const stored = Uint8Array.from(
    storedHex.match(/../g)!,
    (byte) => parseInt(byte, 16),
  );
  let difference = derived.length ^ stored.length;
  for (let i = 0; i < 32; i++) difference |= derived[i] ^ stored[i];
  return difference === 0;
}

async function collectionFromProjection(
  value: unknown,
  getSecret: () => Uint8Array,
): Promise<TicketCollection | null> {
  if (
    !isRecord(value) ||
    !exact(value, [
      "event_id",
      "event_title",
      "event_starts_at",
      "event_ends_at",
      "event_venue_name",
      "event_status",
      "order_status",
      "quantity",
      "items",
      "tickets",
    ]) ||
    typeof value.event_id !== "string" || !uuid.test(value.event_id) ||
    typeof value.event_title !== "string" ||
    value.event_title.trim().length === 0 ||
    !timestamp(value.event_starts_at) || !timestamp(value.event_ends_at) ||
    Date.parse(value.event_ends_at) <= Date.parse(value.event_starts_at) ||
    (value.event_venue_name !== null &&
      typeof value.event_venue_name !== "string") ||
    (value.order_status !== "paid" && value.order_status !== "refunded") ||
    (value.event_status !== "published" &&
      value.event_status !== "cancelled") ||
    !count(value.quantity) || !Array.isArray(value.items) ||
    value.items.length < 1 || value.items.length > 10 ||
    !Array.isArray(value.tickets) || value.tickets.length !== value.quantity
  ) return null;

  const expected: {
    orderItemId: string;
    unitSequence: number;
    label: string;
  }[] = [];
  let previousItem = "";
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      !exact(item, ["order_item_id", "quantity", "admission_label"]) ||
      typeof item.order_item_id !== "string" ||
      !uuid.test(item.order_item_id) || item.order_item_id <= previousItem ||
      !count(item.quantity) || !label(item.admission_label)
    ) return null;
    previousItem = item.order_item_id;
    for (let unit = 1; unit <= item.quantity; unit++) {
      expected.push({
        orderItemId: item.order_item_id,
        unitSequence: unit,
        label: item.admission_label,
      });
    }
  }
  if (expected.length !== value.quantity) return null;
  const allowedUnusedStatus = value.order_status === "refunded"
    ? "refunded"
    : value.event_status === "cancelled"
    ? "cancelled"
    : "valid";
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const verifiedSources: { id: string; status: TicketStatus; hash: string }[] =
    [];
  for (const [index, ticket] of value.tickets.entries()) {
    const source = expected[index];
    if (
      !isRecord(ticket) ||
      !exact(ticket, [
        "id",
        "order_item_id",
        "unit_sequence",
        "admission_label",
        "status",
        "credential_hash",
      ]) ||
      typeof ticket.id !== "string" || !uuid.test(ticket.id) ||
      ids.has(ticket.id) ||
      ticket.order_item_id !== source.orderItemId ||
      ticket.unit_sequence !== source.unitSequence ||
      ticket.admission_label !== source.label ||
      (ticket.status !== "used" && ticket.status !== allowedUnusedStatus) ||
      typeof ticket.credential_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(ticket.credential_hash) ||
      hashes.has(ticket.credential_hash)
    ) return null;
    ids.add(ticket.id);
    hashes.add(ticket.credential_hash);
    verifiedSources.push({
      id: ticket.id,
      status: ticket.status === "used" ? "used" : allowedUnusedStatus,
      hash: ticket.credential_hash,
    });
  }

  const secret = getSecret();
  const tickets: TicketDisplay[] = [];
  let allHashesMatch = true;
  for (const [index, ticket] of verifiedSources.entries()) {
    const raw = await derivePaidAdmissionCredential(secret, expected[index]);
    const hash = await hashAdmissionCredential(raw);
    // Verify inactive records too, and complete verification before exposing any row.
    if (!hashesEqual(hash, ticket.hash)) allHashesMatch = false;
    const status = ticket.status;
    tickets.push({
      selector: ticket.id,
      eventId: value.event_id,
      eventName: value.event_title,
      startsAt: value.event_starts_at,
      endsAt: value.event_ends_at,
      venueName: value.event_venue_name ?? "Venue to be announced",
      admissionLabel: expected[index].label,
      position: index + 1,
      totalInCollection: value.quantity,
      ...(status === "valid"
        ? { status, admissionCredential: raw }
        : { status, admissionCredential: null }),
    });
  }
  return allHashesMatch
    ? {
      collectionLabel: `${value.event_title} tickets`,
      eventId: value.event_id,
      tickets,
    }
    : null;
}

export function createTicketCollectionHandler(
  dependencies: TicketCollectionDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const headers = privateHeaders(
      getCorsHeaders(request, dependencies.appOrigin),
    );
    if (!headers.has("access-control-allow-origin")) {
      return response({ kind: "unavailable" }, 403, headers);
    }
    const preflight = handleCorsPreflight(request, dependencies.appOrigin);
    if (preflight) {
      privateHeaders(preflight.headers);
      return preflight;
    }
    if (request.method !== "POST") {
      return response({ kind: "unavailable" }, 405, headers);
    }
    try {
      const tokenHash = await hashConfirmationBearer(await readBearer(request));
      const collection = await collectionFromProjection(
        await dependencies.findCollection(tokenHash),
        dependencies.getCredentialSecret,
      );
      return collection
        ? response({ kind: "ready", collection }, 200, headers)
        : response({ kind: "unavailable" }, 404, headers);
    } catch {
      // Dependency errors may contain tokens or internal records. Never log or echo them.
      return response({ kind: "unavailable" }, 404, headers);
    }
  };
}

export function handler(request: Request): Promise<Response> {
  return createTicketCollectionHandler({
    appOrigin: getAppBaseUrl(),
    findCollection: defaultFindCollection,
    getCredentialSecret: getTicketCredentialSecret,
  })(request);
}
if (import.meta.main) Deno.serve(handler);
