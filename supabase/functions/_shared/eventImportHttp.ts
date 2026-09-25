import { z } from "zod";
import { parseImportCsv } from "./eventImportCsv.ts";
import { createImportRowValidator } from "./eventImportValidation.ts";
import { geocodeImportAddress } from "./eventImportGeocode.ts";
export type ImportDependencies = {
  origin: string;
  auth: (bearer: string) => Promise<string | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  token: () => string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
};
const id = z.string().uuid();
const selection = z.strictObject({
  rowId: id,
  expectedRevision: z.number().int().positive(),
  expectedDuplicateDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const action = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("continue"), batchId: id }),
  z.strictObject({ operation: z.literal("cancel"), batchId: id }),
  z.strictObject({
    operation: z.literal("select_import"),
    batchId: id,
    rows: z.array(selection).min(1).max(50),
  }),
  z.strictObject({ operation: z.literal("skip"), batchId: id, rowId: id }),
  z.strictObject({ operation: z.literal("retry"), batchId: id, rowId: id }),
  z.strictObject({
    operation: z.literal("override_duplicate"),
    batchId: id,
    rowId: id,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
async function readBytes(req: Request, limit: number): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) throw Error("IMPORT_EMPTY_BODY");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) {
        await reader.cancel();
        throw Error("IMPORT_BODY_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let n = 0;
  for (const c of chunks) {
    bytes.set(c, n);
    n += c.length;
  }
  return bytes;
}
export function createImportHandler(
  mode: "upload" | "process",
  deps: ImportDependencies,
) {
  return async (req: Request): Promise<Response> => {
    const h = new Headers({
      "Cache-Control": "private, no-store",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff",
    });
    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: h });
    if (req.headers.get("origin") !== deps.origin) {
      return reply({ error: "ORIGIN_DENIED" }, 403);
    }
    h.set("Access-Control-Allow-Origin", deps.origin);
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    h.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: h });
    }
    if (req.method !== "POST") {
      return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
    }
    try {
      const bearer = req.headers.get("authorization") ?? "";
      if (!/^Bearer \S+$/.test(bearer)) {
        return reply({ error: "AUTH_REQUIRED" }, 401);
      }
      const actor = await deps.auth(bearer.slice(7));
      if (!actor) return reply({ error: "AUTH_REQUIRED" }, 401);
      await deps.rpc("server_authorize_event_import", { p_actor: actor });
      const now = deps.now ?? Date.now;
      if (mode === "upload") {
        const query = new URL(req.url).searchParams;
        if (
          [...query.keys()].length !== 2 || !query.has("requestId") ||
          !query.has("filename")
        ) throw Error("IMPORT_INVALID_UPLOAD");
        const request = id.parse(query.get("requestId")),
          filename = z.string().min(1).max(255).regex(/\.csv$/i).refine((x) =>
            ![...x].some((char) =>
              char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
            )
          ).parse(query.get("filename"));
        if (
          req.headers.get("content-type")?.split(";")[0].trim() !== "text/csv"
        ) throw Error("IMPORT_INVALID_UPLOAD");
        const bytes = await readBytes(req, 2097152);
        const digest = [
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              bytes as Uint8Array<ArrayBuffer>,
            ),
          ),
        ].map((b) => b.toString(16).padStart(2, "0")).join("");
        let rows: unknown[] = [];
        let error: string | null = null;
        try {
          const validate = createImportRowValidator(now());
          rows = parseImportCsv(bytes).rows.map((r) => ({
            ...r,
            cells: undefined,
            ...validate(r.cells),
          }));
        } catch {
          error = "CSV_STRUCTURE_INVALID";
        }
        const batchId = await deps.rpc("server_create_event_import_batch", {
          p_actor: actor,
          p_request: request,
          p_digest: digest,
          p_filename: filename,
          p_rows: rows,
          p_error: error,
        });
        return reply({ batchId, error }, 201);
      }
      if (
        req.headers.get("content-type")?.split(";")[0].trim() !==
          "application/json"
      ) throw Error("IMPORT_INVALID_REQUEST");
      const body = action.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readBytes(req, 16384),
          ),
        ),
      );
      const args = { p_actor: actor, p_batch: body.batchId };
      if (body.operation === "cancel") {
        await deps.rpc("server_cancel_event_import_batch", args);
      } else if (body.operation === "select_import") {
        await deps.rpc("server_request_event_import_rows", {
          ...args,
          p_rows: body.rows,
        });
      } else if (body.operation !== "continue") {
        const accepted = await deps.rpc("server_resolve_event_import_row", {
          ...args,
          p_row: body.rowId,
          p_action: body.operation,
          p_digest: "digest" in body ? body.digest : null,
        });
        if (accepted === false) return reply({ ok: true, reviewChanged: true });
      }
      if (body.operation === "continue" || body.operation === "select_import") {
        const start = now();
        let processed = 0;
        let providerState: unknown = null;
        if (body.operation === "continue") {
          for (let n = 0; n < 10 && now() - start < 12000; n++) {
            const claim = await deps.rpc(
              "server_claim_event_import_work",
              args,
            );
            const c = z.object({
              kind: z.string(),
              rowId: id.optional(),
              token: id.optional(),
              revision: z.number().optional(),
              input: z.object({
                address: z.string(),
                city: z.string(),
                postal_code: z.string(),
              }).optional(),
            }).parse(claim);
            if (c.kind !== "claimed") {
              providerState = c.kind;
              break;
            }
            if (!c.rowId || !c.token || !c.revision || !c.input) {
              throw Error("IMPORT_INVALID_RESPONSE");
            }
            const result = await geocodeImportAddress(c.input, {
              token: deps.token(),
              fetch: deps.fetch,
            });
            await deps.rpc("server_complete_event_import_geocode", {
              ...args,
              p_row: c.rowId,
              p_token: c.token,
              p_revision: c.revision,
              p_result: result,
            });
            processed++;
            if (result.kind === "configuration_error") {
              providerState = "paused";
              break;
            }
          }
        }
        const pending = z.object({ selected: z.array(id).max(10) }).parse(
          await deps.rpc("server_get_event_import_progress", args),
        );
        const results = [];
        for (const rowId of pending.selected) {
          if (now() - start >= 20000) break;
          results.push(
            await deps.rpc("server_import_event_row", {
              ...args,
              p_row: rowId,
            }),
          );
        }
        return reply({ ok: true, processed, providerState, results });
      }
      return reply({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = /^(IMPORT_[A-Z_]+)$/.test(msg)
        ? msg
        : "IMPORT_INVALID_REQUEST";
      return reply(
        { error: code },
        code === "IMPORT_ADMIN_REQUIRED"
          ? 403
          : code === "IMPORT_BODY_TOO_LARGE"
          ? 413
          : 400,
      );
    }
  };
}
