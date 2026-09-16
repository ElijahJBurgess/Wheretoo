import { eventStatusAccessSchema } from "./eventNotice.ts";
import { refundDetailSchema } from "./refundNotice.ts";
import { isIP } from "node:net";
import { getCorsHeaders } from "./cors.ts";
import { getServiceClient } from "./database.ts";
import { getAppBaseUrl } from "./env.ts";
import { hashFreeLocator, isRecord, UUID_PATTERN } from "./freeRegistration.ts";
import { hashConfirmationBearer } from "../stripe-create-checkout/index.ts";
import { collectionFromProjection } from "../ticket-collection/index.ts";
import { freeCollectionFromProjection } from "../ticket-collection/freeCollection.ts";
import { getTicketCredentialSecret } from "./ticketCredentials.ts";
import {
  canonicalEmail,
  emailRateFingerprint,
  encryptEmailPayload,
  hashEmailGrant,
} from "./ticketEmailAccess.ts";
import { readTicketEmailPayloadKeys } from "./ticketEmailWorker.ts";

type Operation =
  | "recovery"
  | "access"
  | "status"
  | "refund_access"
  | "event_status";
export interface TicketEmailHttpDependencies {
  appOrigin: string;
  recoveryEnabled: boolean;
  keyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
  fingerprintSecret: Uint8Array;
  getTrustedIp(request: Request): string | null;
  getCredentialSecret(): Uint8Array;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
}
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((k) => k in value);
const canonicalBearer = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const canonicalGrant = /^em1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
async function body(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json" || !request.body
  ) throw new Error("Invalid request");
  const reader = request.body.getReader();
  let bytes = new Uint8Array(0);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (bytes.length + value.length > 2048) {
        await reader.cancel();
        throw new Error("Invalid request");
      }
      const next = new Uint8Array(bytes.length + value.length);
      next.set(bytes);
      next.set(value, bytes.length);
      bytes = next;
    }
  } finally {
    reader.releaseLock();
  }
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!isRecord(value)) throw new Error("Invalid request");
  return value;
}
function validIndex(value: Record<string, unknown>): boolean {
  if (
    !exact(value, [
      "kind",
      "expiresAt",
      "total",
      "page",
      "nextPage",
      "collections",
    ]) || value.kind !== "index" || !date(value.expiresAt) ||
    !Number.isInteger(value.total) || Number(value.total) < 1 ||
    Number(value.total) > 200 || !Number.isInteger(value.page) ||
    Number(value.page) < 0 || Number(value.page) > 9 ||
    !Array.isArray(value.collections) ||
    value.collections.length !==
      Math.max(
        0,
        Math.min(20, Number(value.total) - Number(value.page) * 20),
      ) ||
    value.nextPage !==
      ((Number(value.page) + 1) * 20 < Number(value.total)
        ? Number(value.page) + 1
        : null)
  ) return false;
  return value.collections.every((row, index) =>
    isRecord(row) &&
    exact(row, [
      "selector",
      "sourceKind",
      "eventName",
      "startsAt",
      "quantity",
      "createdAt",
      ...(Object.hasOwn(row,"eventFactsAvailable") ? ["eventFactsAvailable"] : []),
    ]) &&
    row.selector === Number(value.page) * 20 + index + 1 &&
    ["paid_order", "free_registration"].includes(String(row.sourceKind)) &&
    typeof row.eventName === "string" && row.eventName.trim().length > 0 &&
    row.eventName.length <= 120 &&
(row.eventFactsAvailable === false ? row.startsAt === null && row.eventName === "Event details unavailable" : date(row.startsAt)) && (row.eventFactsAvailable === undefined || typeof row.eventFactsAvailable === "boolean") && date(row.createdAt) &&
    Number.isInteger(row.quantity) && Number(row.quantity) >= 1 &&
    Number(row.quantity) <= 10
  );
}
const deliveryStates = [
  "queued",
  "sending",
  "accepted",
  "failed",
  "unknown",
  "suppressed",
  "not_requested",
];
const observations = [
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "failed",
];
export function createTicketEmailHttpHandler(
  operation: Operation,
  dependencies: TicketEmailHttpDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const headers = getCorsHeaders(request, dependencies.appOrigin);
    headers.set("cache-control", "private, no-store");
    headers.set("pragma", "no-cache");
    headers.set("referrer-policy", "no-referrer");
    headers.set("content-type", "application/json");
    const reply = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    if (!headers.has("access-control-allow-origin")) {
      return reply({ kind: "unavailable" }, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return reply({ kind: "unavailable" }, 405);
    let input: Record<string, unknown>;
    try {
      input = await body(request);
    } catch {
      return reply({ kind: "invalid_input" }, 400);
    }
    try {
      const ip = dependencies.getTrustedIp(request);
      if (!ip || !isIP(ip)) return reply({ kind: "unavailable" }, 503);
      const ipHash = await emailRateFingerprint(
        dependencies.fingerprintSecret,
        "ip",
        ip,
      );
      if (operation === "recovery") {
        if (
          !exact(input, ["email", "requestId"]) ||
          typeof input.email !== "string" ||
          typeof input.requestId !== "string" ||
          !UUID_PATTERN.test(input.requestId)
        ) return reply({ kind: "invalid_input" }, 400);
        const email = input.email.trim().toLowerCase();
        if (!canonicalEmail(email)) {
          return reply({ kind: "invalid_input" }, 400);
        }
        if (!dependencies.recoveryEnabled) {
          return reply({ kind: "unavailable" }, 503);
        }
        const key = dependencies.keys.get(dependencies.keyId);
        if (!key) return reply({ kind: "unavailable" }, 503);
        const payload = await encryptEmailPayload(
          { kind: "recovery_request", email },
          { kind: "recovery_request", requestId: input.requestId },
          dependencies.keyId,
          key,
        );
        const result = await dependencies.rpc(
          "server_request_ticket_recovery",
          {
            p_request_id: input.requestId,
            p_recipient_hash: await emailRateFingerprint(
              dependencies.fingerprintSecret,
              "recipient",
              email,
            ),
            p_ip_hash: ipHash,
            p_payload: payload,
          },
        );
        if (isRecord(result) && result.kind === "not_enabled") {
          return reply({ kind: "unavailable" }, 503);
        }
        return reply({ kind: "requested" }, 202);
      }
      if (operation === "event_status") {
        if (!exact(input, ["token"]) || typeof input.token !== "string") {
          return reply({ kind: "invalid_input" }, 400);
        }
        const result = await dependencies.rpc(
          "server_read_event_status_access",
          {
            p_token_hash: canonicalGrant.test(input.token)
              ? await hashEmailGrant(input.token)
              : null,
            p_ip_hash: ipHash,
          },
        );
        if (
          isRecord(result) && exact(result, ["kind"]) &&
          result.kind === "rate_limited"
        ) return reply({ kind: "rate_limited" }, 429);
        const parsed = eventStatusAccessSchema.safeParse(result);
        return parsed.success && Date.parse(parsed.data.expiresAt) > Date.now()
          ? reply(parsed.data)
          : reply({ kind: "unavailable" }, 404);
      }
      if (operation === "refund_access") {
        if (!exact(input, ["token"]) || typeof input.token !== "string") {
          return reply({ kind: "invalid_input" }, 400);
        }
        const result = await dependencies.rpc(
          "server_read_refund_detail_access",
          {
            p_token_hash: canonicalGrant.test(input.token)
              ? await hashEmailGrant(input.token)
              : null,
            p_ip_hash: ipHash,
          },
        );
        if (
          isRecord(result) && exact(result, ["kind"]) &&
          result.kind === "rate_limited"
        ) return reply({ kind: "rate_limited" }, 429);
        if (
          !isRecord(result) || !exact(result, ["kind", "expiresAt", "order"]) ||
          result.kind !== "ready" || !date(result.expiresAt) ||
          Date.parse(String(result.expiresAt)) <= Date.now()
        ) return reply({ kind: "unavailable" }, 404);
        const order = refundDetailSchema.safeParse(result.order);
        return order.success
          ? reply({
            kind: "ready",
            expiresAt: result.expiresAt,
            order: order.data,
          })
          : reply({ kind: "unavailable" }, 404);
      }
      if (operation === "status") {
        if (
          !exact(input, ["collectionBearer"]) ||
          typeof input.collectionBearer !== "string"
        ) return reply({ kind: "unavailable" }, 404);
        const free = input.collectionBearer.length === 48 &&
          input.collectionBearer.startsWith("rsvp_");
        // Syntax failures share the invalid-input budget. A digest infrastructure
        // failure for a canonical bearer must instead reach the temporary catch.
        const canonical = canonicalBearer.test(
          free ? input.collectionBearer.slice(5) : input.collectionBearer,
        );
        const hash = canonical
          ? free
            ? await hashFreeLocator(input.collectionBearer)
            : await hashConfirmationBearer(input.collectionBearer)
          : null;
        const result = await dependencies.rpc(
          "server_ticket_email_confirmation_status",
          {
            p_kind: free ? "free_registration" : "paid_order",
            p_access_hash: hash,
            p_ip_hash: ipHash,
          },
        );
        if (isRecord(result) && result.kind === "rate_limited") {
          return reply({ kind: "rate_limited" }, 429);
        }
        if (
          !isRecord(result) || !exact(result, ["state", "observation"]) ||
          !deliveryStates.includes(String(result.state)) ||
          (result.observation !== null &&
            !observations.includes(String(result.observation)))
        ) {
          return reply({ kind: "unavailable" }, 404);
        }
        return reply(result);
      }
      if (
        (!exact(input, ["token", "page"]) &&
          !exact(input, ["token", "member"])) ||
        typeof input.token !== "string" ||
        ("page" in input
          ? !Number.isInteger(input.page) || Number(input.page) < 0 ||
            Number(input.page) > 9
          : !Number.isInteger(input.member) || Number(input.member) < 1 ||
            Number(input.member) > 200)
      ) return reply({ kind: "unavailable" }, 404);
      const hash = canonicalGrant.test(input.token)
        ? await hashEmailGrant(input.token)
        : null;
      const result = await dependencies.rpc("server_read_ticket_email_access", {
        p_token_hash: hash,
        p_ip_hash: ipHash,
        p_page: input.page ?? 0,
        p_member: input.member ?? null,
      });
      if (!isRecord(result)) return reply({ kind: "unavailable" }, 404);
      if (result.kind === "rate_limited") {
        return reply({ kind: "rate_limited" }, 429);
      }
      if (
        !date(result.expiresAt) ||
        Date.parse(String(result.expiresAt)) <= Date.now()
      ) {
        return reply({ kind: "unavailable" }, 404);
      }
      if (
        result.kind === "index" && result.page === input.page &&
        validIndex(result)
      ) return reply(result);
      if (result.kind !== "member" || !date(result.expiresAt)) {
        return reply({ kind: "unavailable" }, 404);
      }
      const collection = result.sourceKind === "paid_order"
        ? await collectionFromProjection(
          result.projection,
          dependencies.getCredentialSecret,
        )
        : result.sourceKind === "free_registration"
        ? await freeCollectionFromProjection(
          result.projection,
          dependencies.getCredentialSecret,
        )
        : null;
      return collection
        ? reply({ kind: "ready", collection, expiresAt: result.expiresAt })
        : reply({ kind: "unavailable" }, 404);
    } catch {
      // Dependencies can contain private addresses, ciphertext, tokens or provider errors.
      // Invalid grants/projections return explicitly above. Dependency and
      // credential infrastructure exceptions must preserve same-link retry.
      return reply({ kind: "unavailable" }, 503);
    }
  };
}
export async function ticketEmailHttpHandler(
  operation: Operation,
  request: Request,
): Promise<Response> {
  try {
    const keyring = operation === "recovery"
      ? readTicketEmailPayloadKeys((name) => Deno.env.get(name))
      : { keyId: "", keys: new Map<string, Uint8Array>() };
    const secretText = Deno.env.get("TICKET_EMAIL_RATE_SECRET") ?? "";
    const secret = Uint8Array.from(
      atob(secretText),
      (character) => character.charCodeAt(0),
    );
    const ipHeader = Deno.env.get("TICKET_EMAIL_TRUSTED_IP_HEADER") ?? "";
    if (secret.length !== 32 || !/^[a-z][a-z0-9-]{0,63}$/.test(ipHeader)) {
      throw new Error("Unavailable");
    }
    return await createTicketEmailHttpHandler(operation, {
      appOrigin: getAppBaseUrl(),
      recoveryEnabled: Deno.env.get("TICKET_EMAIL_PUBLIC_ENABLED") === "true",
      ...keyring,
      fingerprintSecret: secret,
      // Only use an explicitly configured gateway-overwritten header. Never guess from forwarded headers.
      getTrustedIp: (req) => req.headers.get(ipHeader),
      getCredentialSecret: getTicketCredentialSecret,
      rpc: async (name, args) => {
        const { data, error } = await getServiceClient().rpc(name, args);
        if (error) throw new Error("Unavailable");
        return data;
      },
    })(request);
  } catch {
    const headers = new Headers();
    headers.set("cache-control", "private, no-store");
    headers.set("referrer-policy", "no-referrer");
    return new Response(JSON.stringify({ kind: "unavailable" }), {
      status: 503,
      headers,
    });
  }
}
