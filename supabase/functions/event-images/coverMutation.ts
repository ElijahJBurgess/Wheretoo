import type { SupabaseClient } from "@supabase/supabase-js";
import { validImageBytes } from "./imageBytes.ts";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class CoverError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export function coverRevision(value: string | null): number {
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new CoverError(409, "COVER_REVISION_REQUIRED");
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new CoverError(400, "INVALID_REVISION");
  }
  return revision;
}
async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    throw new CoverError(
      error.message === "COVER_NOT_OWNED"
        ? 403
        : error.code === "P0001"
        ? 409
        : 503,
      "COVER_NOT_CONFIRMED",
    );
  }
  return data;
}
async function stage(
  client: SupabaseClient,
  eventId: string,
  ownerId: string,
  objectId: string,
  bytes: Uint8Array,
  mime: string,
  revision: number,
  candidateId?: string,
) {
  if (!validImageBytes(bytes, mime)) {
    throw new CoverError(415, "INVALID_IMAGE_BYTES");
  }
  const extension = mime === "image/jpeg"
    ? "jpg"
    : mime === "image/png"
    ? "png"
    : "webp";
  const path = `${eventId}/${objectId}.${extension}`;
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const bucket = client.storage.from("event-images");
  const { error } = await bucket.upload(path, bytes, {
    contentType: mime,
    upsert: false,
    cacheControl: "0",
    metadata: {
      organizer_id: ownerId,
      cover_staged: true,
      cover_revision: revision,
      digest,
      ...(candidateId ? { candidate_id: candidateId } : {}),
    },
  });
  if (error) {
    // Only reconcile an immutable object whose bytes actually match this request.
    // A generic upload failure is never treated as successful attachment.
    const existing = await bucket.download(path);
    if (existing.error || !existing.data || existing.data.type !== mime) {
      throw new CoverError(409, "COVER_UPLOAD_NOT_CONFIRMED");
    }
    const stored = new Uint8Array(await existing.data.arrayBuffer());
    if (
      stored.length !== bytes.length || stored.some((b, i) => b !== bytes[i])
    ) throw new CoverError(409, "COVER_REQUEST_CONFLICT");
  }
  return path;
}
export async function mutateEventCover(
  client: SupabaseClient,
  request: Request,
  eventId: string,
  ownerId: string,
  bytes?: Uint8Array,
): Promise<Record<string, unknown>> {
  const revision = coverRevision(request.headers.get("x-cover-revision"));
  const base = {
    p_event_id: eventId,
    p_organizer_id: ownerId,
    p_expected_revision: revision,
  };
  let result;
  if (request.method === "POST") {
    const requestId = request.headers.get("x-request-id") ?? "";
    if (!uuid.test(requestId)) throw new CoverError(400, "INVALID_REQUEST_ID");
    const path = await stage(
      client,
      eventId,
      ownerId,
      requestId,
      bytes!,
      request.headers.get("content-type") ?? "",
      revision,
    );
    result = await rpc(client, "server_commit_event_cover", {
      ...base,
      p_path: path,
    });
  } else {
    // Small JSON operations only. Read incrementally so chunked bodies are bounded too.
    const reader = request.body?.getReader();
    if (!reader) throw new CoverError(400, "INVALID_OPERATION");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 1024) {
          await reader.cancel();
          throw new CoverError(413, "BODY_TOO_LARGE");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      throw new CoverError(400, "INVALID_OPERATION");
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new CoverError(400, "INVALID_OPERATION");
    }
    if (body.remove === true && Object.keys(body).length === 1) {
      result = await rpc(client, "server_remove_event_cover", base);
    } else {
      if (
        !uuid.test(body.generationId ?? "") || !Number.isInteger(body.slot) ||
        body.slot < 1 || body.slot > 3 || Object.keys(body).length !== 2
      ) throw new CoverError(400, "INVALID_OPERATION");
      const selection = {
        p_generation_id: body.generationId,
        p_slot: body.slot,
        p_organizer_id: ownerId,
        p_expected_revision: revision,
      };
      const candidate = await rpc(
        client,
        "server_get_event_cover_candidate",
        selection,
      );
      if (candidate.eventId !== eventId) {
        throw new CoverError(409, "COVER_CANDIDATE_INVALID");
      }
      if (candidate.selected) return candidate;
      const file = await client.storage.from("event-cover-candidates").download(
        candidate.path,
      );
      if (file.error || !file.data || file.data.size > 5242880) {
        throw new CoverError(409, "COVER_CANDIDATE_UNAVAILABLE");
      }
      const path = await stage(
        client,
        eventId,
        ownerId,
        candidate.candidateId,
        new Uint8Array(await file.data.arrayBuffer()),
        file.data.type,
        revision,
        candidate.candidateId,
      );
      result = await rpc(client, "server_commit_event_cover", {
        ...base,
        p_path: path,
        p_generation_id: body.generationId,
        p_slot: body.slot,
      });
    }
  }
  // Cleanup is post-commit and best effort. Its failure cannot undo a saved cover.
  // Paths are immutable and retired attachments can never be restored with stale revisions.
  if (Array.isArray(result.retired) && result.retired.length) {
    try {
      const { error } = await client.storage.from("event-images").remove(
        result.retired,
      );
      if (error) console.warn("Retired cover cleanup deferred");
    } catch {
      console.warn("Retired cover cleanup deferred");
    }
  }
  return { revision: result.revision, imageId: result.imageId ?? null };
}
