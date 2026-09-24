import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { duplicateEvent, DuplicateError, type DuplicateContext } from "./duplicateEvent.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const known = new Set(["EVENT_NOT_FOUND", "DUPLICATE_MODERATION_BLOCKED", "DUPLICATE_SOURCE_CHANGED", "DUPLICATE_SOURCE_UNSUPPORTED", "DUPLICATE_STAGE_INVALID", "DUPLICATE_TARGET_EXISTS"]);
export async function handler(request: Request): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" });
  const fail = (status: number, code: string) => Response.json({ error: code }, { status, headers });
  try {
    const origin = getAppBaseUrl();
    if (request.headers.get("origin") !== origin) return fail(403, "ORIGIN_DENIED");
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
    const bearer = request.headers.get("authorization") ?? "";
    if (!bearer.startsWith("Bearer ")) return fail(401, "SIGN_IN_REQUIRED");
    const service = getServiceClient();
    const auth = await service.auth.getUser(bearer.slice(7));
    if (auth.error || !auth.data.user) return fail(401, "SIGN_IN_REQUIRED");
    const reader = request.body?.getReader();
    if (!reader) return fail(400, "INVALID_REQUEST");
    let text = ""; let size = 0; const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 256) { await reader.cancel(); return fail(413, "INVALID_REQUEST"); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let body;
    try { body = JSON.parse(text); } catch { return fail(400, "INVALID_REQUEST"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "sourceEventId" || !uuid.test(body.sourceEventId)) return fail(400, "INVALID_REQUEST");
    // Never set bearer state on the singleton privileged client.
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: bearer } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const bucket = service.storage.from("event-images");
    const eventId = await duplicateEvent({
      context: async () => {
        const { data, error } = await user.rpc("get_owned_event_duplicate_context", { p_source_event_id: body.sourceEventId });
        if (error) throw new DuplicateError(known.has(error.message) ? error.message : "DUPLICATE_UNAVAILABLE", error.message === "EVENT_NOT_FOUND" ? 404 : 409);
        if (!data || !/^[0-9a-f]{64}$/.test(data.fingerprint) || !(data.image === null || (uuid.test(data.image?.id) && typeof data.image?.path === "string"))) throw new DuplicateError("DUPLICATE_UNAVAILABLE", 503);
        return data as DuplicateContext;
      },
      read: async path => { const file = await bucket.download(path); if (file.error || !file.data) throw new Error("unavailable"); return file.data; },
      stage: async (path, bytes, mime, metadata) => {
        const result = await bucket.upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "0", metadata });
        if (result.error) {
          if (known.has(result.error.message)) throw new DuplicateError(result.error.message, result.error.message === "EVENT_NOT_FOUND" ? 404 : 409);
          throw new Error("stage failed");
        }
      },
      finalize: async args => {
        const { data, error } = await user.rpc("duplicate_owned_event", args);
        if (error) {
          // Only a structured SQL failure proves rollback. Fetch/ambiguous gateway errors do not.
          if (error.code === "P0001" || /^(22|23|42)[0-9A-Z]{3}$/.test(error.code ?? ""))
            throw new DuplicateError(known.has(error.message) ? error.message : "DUPLICATE_FAILED", error.message === "EVENT_NOT_FOUND" ? 404 : 409);
          throw new DuplicateError("DUPLICATE_OUTCOME_UNKNOWN", 503);
        }
        return data;
      },
      remove: async path => { const result = await bucket.remove([path]); if (result.error) throw new Error("cleanup deferred"); },
    }, body.sourceEventId, auth.data.user.id);
    return Response.json({ eventId }, { status: 201, headers });
  } catch (error) {
    if (error instanceof DuplicateError) return fail(error.status, error.message);
    return fail(503, "DUPLICATE_UNAVAILABLE");
  }
}
if (import.meta.main) Deno.serve(handler);
