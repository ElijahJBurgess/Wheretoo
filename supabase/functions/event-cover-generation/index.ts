import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl, getSupabaseServiceConfig } from "../_shared/env.ts";
import {
  boundedJson,
  buildCoverPrompt,
  type CoverContext,
  type CoverInput,
  generateCover,
  MOODS,
  ProviderError,
  validCoverImage,
} from "./provider.ts";
import { existingCandidate } from "./candidateStorage.ts";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Generator = (prompt: string) => Promise<Uint8Array>;
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function databaseError(message: string): never {
  const code = message.match(/COVER_[A-Z_]+/)?.[0] ?? "GENERATION_UNAVAILABLE";
  throw new ApiError(
    code.includes("NOT_OWNED")
      ? 403
      : code.endsWith("_LIMIT") || code === "COVER_ACTIVE"
      ? 429
      : 409,
    code,
  );
}
/** Injection is for local tests; production always uses the pinned OpenAI adapter. */
export function createHandler(generator?: Generator) {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({
      "cache-control": "no-store",
      vary: "Origin",
      "x-content-type-options": "nosniff",
    });
    const fail = (status: number, error: string) =>
      Response.json({ error }, { status, headers });
    try {
      const origin = getAppBaseUrl();
      if (request.headers.get("origin") !== origin) {
        return fail(403, "ORIGIN_DENIED");
      }
      headers.set("access-control-allow-origin", origin);
      headers.set("access-control-allow-methods", "POST, OPTIONS");
      headers.set(
        "access-control-allow-headers",
        "authorization, apikey, content-type, x-client-info",
      );
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
      const service = getServiceClient();
      const bearer = request.headers.get("authorization") ?? "";
      if (!bearer.startsWith("Bearer ")) return fail(401, "SIGN_IN_REQUIRED");
      const auth = await service.auth.getUser(bearer.slice(7));
      if (auth.error || !auth.data.user) return fail(401, "SIGN_IN_REQUIRED");
      const actor = auth.data.user.id;
      let body: Record<string, unknown>;
      try {
        body = await boundedJson(new Response(request.body), 2048) as Record<
          string,
          unknown
        >;
      } catch {
        return fail(400, "INVALID_REQUEST");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return fail(400, "INVALID_REQUEST");
      }
      const { url, serviceRoleKey } = getSupabaseServiceConfig();
      const user = createClient(url, serviceRoleKey, {
        global: { headers: { Authorization: bearer } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const rpc = async (
        name: string,
        args: Record<string, unknown>,
        owned = false,
      ) => {
        const result = await (owned ? user : service).rpc(name, args);
        if (result.error) databaseError(result.error.message);
        return result.data;
      };
      const read = (id: string) =>
        rpc("get_event_cover_generation", { p_generation_id: id }, true);
      // Owner-scoped bounded cleanup uses Storage API; never SQL-deletes Storage records.
      const cleanup = async () => {
        const result = await service.rpc("server_expire_cover_candidates", {
          p_organizer_id: actor,
        });
        if (result.error || !Array.isArray(result.data)) return;
        for (const row of result.data as { id: string; paths: string[] }[]) {
          const removed = await service.storage.from("event-cover-candidates")
            .remove(row.paths);
          if (!removed.error) {
            await service.rpc("server_ack_cover_cleanup", {
              p_generation_id: row.id,
            });
          }
        }
      };
      if (body.action === "state") {
        if (
          typeof body.generationId !== "string" || !uuid.test(body.generationId)
        ) return fail(400, "INVALID_REQUEST");
        await rpc("server_recover_cover_generation", {
          p_generation_id: body.generationId,
          p_organizer_id: actor,
        });
        const recoverable = await rpc("server_cover_recovery_objects", {
          p_generation_id: body.generationId,
          p_organizer_id: actor,
        }) as { slot: number; path: string }[];
        for (const item of recoverable) {
          try {
            const bytes = await existingCandidate(() =>
              service.storage.from("event-cover-candidates").download(item.path)
            );
            if (bytes) {
              await rpc("server_reconcile_cover_object", {
                p_generation_id: body.generationId,
                p_organizer_id: actor,
                p_slot: item.slot,
                p_path: item.path,
              });
            }
          } catch {
            /* Read-only recovery may retry later; never invokes the provider. */
          }
        }
        await cleanup();
        return Response.json(await read(body.generationId), { headers });
      }
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!generator && (Deno.env.get("AI_COVER_ENABLED") !== "true" || !key)) {
        return fail(503, "GENERATION_DISABLED");
      }
      if (body.action === "start") {
        if (
          typeof body.eventId !== "string" || !uuid.test(body.eventId) ||
          typeof body.requestId !== "string" || !uuid.test(body.requestId) ||
          !Number.isSafeInteger(body.revision) || Number(body.revision) < 0 ||
          typeof body.mood !== "string" || !MOODS.includes(body.mood) ||
          typeof body.direction !== "string" || body.direction.length > 300
        ) return fail(400, "INVALID_REQUEST");
        const data = await rpc("create_event_cover_generation", {
          p_event_id: body.eventId,
          p_request_id: body.requestId,
          p_expected_revision: body.revision,
          p_input: { mood: body.mood, direction: body.direction },
        }, true);
        await cleanup();
        return Response.json(data, { headers });
      }
      if (
        body.action !== "step" || typeof body.generationId !== "string" ||
        !uuid.test(body.generationId) ||
        ![1, 2, 3].includes(Number(body.slot)) ||
        typeof body.slot !== "number" ||
        !Number.isInteger(body.attempt) || Number(body.attempt) < 0 ||
        Number(body.attempt) > 1
      ) return fail(400, "INVALID_REQUEST");
      const id = body.generationId, slot = body.slot;
      const claim = await rpc("server_claim_cover_candidate", {
        p_generation_id: id,
        p_slot: slot,
        p_organizer_id: actor,
        p_attempt: body.attempt,
      }) as {
        claimed: boolean;
        claimToken: string;
        eventId: string;
        candidateId: string;
        context: CoverContext;
        input: Partial<CoverInput>;
      };
      if (!claim.claimed) return Response.json(await read(id), { headers });
      const path = `${claim.eventId}/${id}/${claim.candidateId}.png`;
      const bucket = service.storage.from("event-cover-candidates");
      let failure: string | null = null;
      try {
        // Recover a successful upload whose completion response was lost without rebilling.
        const existing = await existingCandidate(() => bucket.download(path));
        if (!existing) {
          const prompt = buildCoverPrompt(claim.context, {
            mood: claim.input.mood ?? "Editorial",
            direction: claim.input.direction ?? "",
          }, slot);
          const bytes =
            await (generator ? generator(prompt) : generateCover(prompt, key!));
          if (!validCoverImage(bytes)) {
            throw new ProviderError("INVALID_PROVIDER_IMAGE");
          }
          const uploaded = await bucket.upload(path, bytes, {
            contentType: "image/png",
            upsert: false,
          });
          if (uploaded.error) throw new ProviderError("STORAGE_FAILED");
        }
      } catch (error) {
        failure = error instanceof ProviderError
          ? error.message
          : "PROVIDER_FAILED";
      }
      await rpc("server_finish_cover_candidate", {
        p_generation_id: id,
        p_slot: slot,
        p_claim_token: claim.claimToken,
        p_path: failure ? null : path,
        p_failure_code: failure,
      });
      return Response.json(await read(id), { headers });
    } catch (error) {
      return error instanceof ApiError
        ? fail(error.status, error.message)
        : fail(503, "GENERATION_UNAVAILABLE");
    }
  };
}
export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
