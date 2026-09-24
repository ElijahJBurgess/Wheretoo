import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getAppBaseUrl, requireEnv } from "../_shared/env.ts";
import {
  organizerMessageErrorCodes,
  organizerMessageOptionsSchema,
  organizerMessagePreviewSchema,
  organizerMessageReceiptSchema,
  organizerMessageRequestSchema,
  renderOrganizerMessage,
} from "../_shared/organizerMessage.ts";

export type OrganizerMessageDependencies = {
  appOrigin: string;
  rpc: (
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<
    { data: unknown; error: { code: string; message: string } | null }
  >;
};
async function boundedJson(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) throw Error();
  const reader = request.body?.getReader();
  if (!reader) throw Error();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32768) {
      await reader.cancel();
      throw Error();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function createOrganizerMessageHandler(
  deps: OrganizerMessageDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const preflight = handleCorsPreflight(request, deps.appOrigin);
    if (preflight) return preflight;
    const headers = getCorsHeaders(request, deps.appOrigin);
    headers.set("Cache-Control", "no-store");
    const respond = (body: unknown, status = 200) =>
      Response.json(body, { status, headers });
    const fail = (
      code: string,
      status: number,
      outcome?: "not_queued" | "unknown",
    ) =>
      respond({
        error: { code, ...(outcome ? { submissionOutcome: outcome } : {}) },
      }, status);
    if (request.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== deps.appOrigin
    ) return fail("CORS_ORIGIN_DENIED", 403);
    const token = request.headers.get("authorization")?.match(
      /^Bearer ([^\s]+)$/i,
    )?.[1];
    if (!token || token.length > 8192) return fail("UNAUTHORIZED", 401);
    let raw: unknown;
    try {
      raw = await boundedJson(request);
    } catch {
      return fail("INVALID_REQUEST", 400);
    }
    const isSubmit = typeof raw === "object" && raw !== null &&
      "action" in raw && raw.action === "submit";
    const parsed = organizerMessageRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return fail("INVALID_REQUEST", 400, isSubmit ? "not_queued" : undefined);
    }
    const input = parsed.data;
    let rpcName: string;
    const args: Record<string, unknown> = { p_event_id: input.eventId };
    switch (input.action) {
      case "options":
        rpcName = "get_owned_organizer_message_options";
        break;
      case "receipt":
        rpcName = "get_owned_organizer_message_receipt";
        args.p_request_id = input.requestId;
        break;
      case "preview":
      case "submit":
        rpcName = input.action === "preview"
          ? "preview_owned_organizer_message"
          : "submit_owned_organizer_message";
        Object.assign(args, {
          p_selector: input.selector,
          p_subject: input.subject,
          p_body: input.body,
        });
        if (input.action === "submit") {
          Object.assign(args, {
            p_fingerprint: input.fingerprint,
            p_request_id: input.requestId,
          });
        }
        break;
    }
    try {
      const { data, error } = await deps.rpc(token, rpcName, args);
      if (error) {
        if (["PGRST301", "PGRST302", "PGRST303"].includes(error.code)) {
          return fail(
            "UNAUTHORIZED",
            401,
            input.action === "submit" ? "unknown" : undefined,
          );
        }
        const known = error.code === "P0001" &&
          organizerMessageErrorCodes.has(error.message);
        if (known) {
          return fail(
            error.message,
            error.message === "UNAUTHORIZED" ? 401 : 409,
            input.action === "submit" ? "not_queued" : undefined,
          );
        }
        return fail(
          input.action === "submit" ? "SUBMISSION_UNKNOWN" : "UNAVAILABLE",
          503,
          input.action === "submit" ? "unknown" : undefined,
        );
      }
      if (input.action === "options") {
        const o = organizerMessageOptionsSchema.parse(data);
        if (o.eventId !== input.eventId) throw Error();
        return respond({
          options: {
            eventId: o.eventId,
            admissionType: o.admissionType,
            deadline: o.deadline,
            canSend: o.canSend,
            reason: o.reason,
            replyTo: o.replyTo,
            tiers: o.tiers.map((t) => ({
              id: t.id,
              name: t.name,
              archived: t.archived,
            })),
          },
        });
      }
      if (input.action === "preview") {
        if (typeof data === "object" && data !== null && "error" in data) {
          const rejection = data.error;
          if (
            typeof rejection === "object" && rejection !== null &&
            "code" in rejection && typeof rejection.code === "string" &&
            organizerMessageErrorCodes.has(rejection.code)
          ) return fail(rejection.code, 409);
          throw Error();
        }
        const p = organizerMessagePreviewSchema.parse(data);
        if (
          p.facts.eventId !== input.eventId || p.subject !== input.subject ||
          p.body !== input.body
        ) throw Error();
        const rendered = await renderOrganizerMessage(
          p.facts,
          p.subject,
          p.body,
        );
        return respond({
          preview: {
            recipientCount: p.recipientCount,
            canSend: p.canSend,
            reason: p.reason,
            audienceLabel: p.audienceLabel,
            deadline: p.deadline,
            fingerprint: p.fingerprint,
            subject: p.subject,
            body: p.body,
            ...rendered,
          },
        });
      }
      if (input.action === "receipt" && data === null) {
        return respond({ receipt: null });
      }
      const receipt = organizerMessageReceiptSchema.parse(data);
      if (receipt.requestId !== input.requestId) throw Error();
      return respond({
        receipt: {
          messageId: receipt.messageId,
          requestId: receipt.requestId,
          queuedRecipients: receipt.queuedRecipients,
          confirmedAt: receipt.confirmedAt,
        },
      });
    } catch {
      return fail(
        input.action === "submit" ? "SUBMISSION_UNKNOWN" : "UNAVAILABLE",
        503,
        input.action === "submit" ? "unknown" : undefined,
      );
    }
  };
}

// An anonymous API key plus the caller's JWT preserves SQL ownership/RLS authorization.
export async function handler(request: Request): Promise<Response> {
  try {
    return await createOrganizerMessageHandler({
      appOrigin: getAppBaseUrl(),
      rpc: async (token, name, args) => {
        const client = createClient(
          requireEnv("SUPABASE_URL"),
          requireEnv("SUPABASE_ANON_KEY"),
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
          },
        );
        const { data, error } = await client.rpc(name, args);
        return { data, error };
      },
    })(request);
  } catch {
    return Response.json({ error: { code: "UNAVAILABLE" } }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
if (import.meta.main) Deno.serve(handler);
