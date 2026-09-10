import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOrganizer } from "../_shared/auth.ts";
import type { OrganizerContext } from "../_shared/contracts.ts";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { HttpError } from "../_shared/http.ts";
import { hashAdmissionCredential } from "../_shared/ticketCredentials.ts";

type RedeemInput = {
  organizerId: string;
  eventId: string;
  credentialHash: string;
};
export interface TicketAdmissionDependencies {
  appOrigin: string;
  verifyOrganizer(request: Request): Promise<OrganizerContext>;
  redeem(input: RedeemInput): Promise<unknown>;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REQUEST_BYTES = 512;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => key in value);
}
async function readInput(
  request: Request,
): Promise<{ eventId: string; credential: string }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim()
        .toLowerCase() !== "application/json" ||
    !Number.isSafeInteger(declared) || declared < 0 ||
    declared > MAX_REQUEST_BYTES || !request.body
  ) throw new Error("Invalid input");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_REQUEST_BYTES);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("Invalid input");
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
  // 32 bytes encode as 43 unpadded base64url characters. The final character
  // must have zero padding bits; accepting aliases would change the hash.
  if (
    !record(body) || !exact(body, ["eventId", "credential"]) ||
    typeof body.eventId !== "string" || body.eventId.length !== 36 ||
    !uuid.test(body.eventId) || typeof body.credential !== "string" ||
    body.credential.length !== 48 ||
    !/^wta1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(body.credential)
  ) throw new Error("Invalid input");
  return { eventId: body.eventId, credential: body.credential };
}
export async function defaultRedeem(
  input: RedeemInput,
  client: SupabaseClient = getServiceClient(),
): Promise<unknown> {
  const { data, error } = await client.rpc("server_redeem_organizer_ticket", {
    p_organizer_id: input.organizerId,
    p_event_id: input.eventId,
    p_credential_hash: input.credentialHash,
  });
  if (error !== null || !Array.isArray(data) || data.length !== 1) {
    throw new Error("Admission unavailable");
  }
  return data[0];
}
function safeResult(value: unknown) {
  if (!record(value) || (!exact(value, ["outcome", "admission_label"]) && !exact(value, ["outcome", "admission_label", "buyer_name", "used_at"]))) {
    return null;
  }
  if (value.outcome === "invalid" || value.outcome === "wrong_event") {
    return value.admission_label === null && (value.buyer_name == null) && (value.used_at == null) ? { outcome: value.outcome } : null;
  }
  if (
    typeof value.outcome !== "string" ||
    !["admitted", "already_used", "refunded", "cancelled"].includes(
      value.outcome,
    ) || typeof value.admission_label !== "string" ||
    value.admission_label.trim() !== value.admission_label ||
    [...value.admission_label].length < 1 ||
    [...value.admission_label].length > 80
  ) return null;
  if ("buyer_name" in value) {
    if (typeof value.buyer_name !== "string" || value.buyer_name.length > 200) return null;
    if (value.outcome === "admitted" || value.outcome === "already_used") {
      if (typeof value.used_at !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value.used_at) || !Number.isFinite(Date.parse(value.used_at))) return null;
    } else if (value.used_at !== null) return null;
    return { outcome: value.outcome, admissionLabel: value.admission_label, attendeeLabel: value.buyer_name, ...(value.used_at ? { usedAt: value.used_at } : {}) };
  }
  return { outcome: value.outcome, admissionLabel: value.admission_label };
}
export function createTicketAdmissionHandler(
  dependencies: TicketAdmissionDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const headers = getCorsHeaders(request, dependencies.appOrigin);
    headers.set("cache-control", "private, no-store");
    headers.set("pragma", "no-cache");
    headers.set("content-type", "application/json; charset=utf-8");
    const unavailable = (status: number) =>
      new Response(JSON.stringify({ outcome: "network_error" }), {
        status,
        headers,
      });
    if (!headers.has("access-control-allow-origin")) return unavailable(403);
    const preflight = handleCorsPreflight(request, dependencies.appOrigin);
    if (preflight) return preflight;
    if (request.method !== "POST") return unavailable(405);
    let organizer: OrganizerContext;
    try {
      organizer = await dependencies.verifyOrganizer(request);
    } catch (error) {
      return unavailable(error instanceof HttpError ? error.status : 503);
    }
    let input: Awaited<ReturnType<typeof readInput>>;
    try {
      input = await readInput(request);
    } catch {
      return unavailable(400);
    }
    try {
      const hash = await hashAdmissionCredential(input.credential);
      const result = safeResult(
        await dependencies.redeem({
          organizerId: organizer.organizerId,
          eventId: input.eventId,
          credentialHash: "\\x" +
            Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
              "",
            ),
        }),
      );
      return result
        ? new Response(JSON.stringify(result), { status: 200, headers })
        : unavailable(503);
    } catch {
      // Dependency errors can include bearer material; never log or echo them.
      return unavailable(503);
    }
  };
}
export function handler(request: Request): Promise<Response> {
  return createTicketAdmissionHandler({
    appOrigin: getAppBaseUrl(),
    verifyOrganizer: requireOrganizer,
    redeem: defaultRedeem,
  })(request);
}
if (import.meta.main) Deno.serve(handler);
