import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { validImageBytes } from "../event-images/imageBytes.ts";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function readImage(request: Request): Promise<Uint8Array> {
  if (!request.body) throw new Error("EMPTY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 5242880) {
        await reader.cancel();
        throw new Error("SIZE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
export async function handler(request: Request): Promise<Response> {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  const fail = (status: number, code: string) =>
    Response.json({ error: code }, { status, headers });
  try {
    const origin = request.headers.get("origin");
    const appOrigin = getAppBaseUrl();
    if (origin === appOrigin) {
      headers.set("Access-Control-Allow-Origin", appOrigin);
      headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      headers.set(
        "Access-Control-Allow-Headers",
        "authorization, apikey, content-type, x-client-info",
      );
    }
    if (request.method === "OPTIONS") {
      return origin === appOrigin
        ? new Response(null, { status: 204, headers })
        : fail(403, "ORIGIN_DENIED");
    }
    const client = getServiceClient();
    if (request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id");
      if (!id || !uuid.test(id)) return fail(404, "IMAGE_NOT_FOUND");
      let owner: string | null = null;
      const authorization = request.headers.get("authorization");
      if (authorization?.startsWith("Bearer ")) {
        const result = await client.auth.getUser(authorization.slice(7));
        if (!result.error) owner = result.data.user?.id ?? null;
      }
      const { data: path, error } = await client.rpc(
        "server_get_organizer_media",
        { p_id: id, p_owner: owner },
      );
      if (error) return fail(503, "IMAGE_UNAVAILABLE");
      if (typeof path !== "string") return fail(404, "IMAGE_NOT_FOUND");
      const file = await client.storage.from("organizer-media").download(path);
      if (file.error || !file.data) return fail(404, "IMAGE_NOT_FOUND");
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      if (!validImageBytes(bytes, file.data.type)) {
        return fail(404, "IMAGE_NOT_FOUND");
      }
      headers.set("Content-Type", file.data.type);
      return new Response(bytes, { headers });
    }
    if (!["POST","DELETE"].includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED");
    if (origin !== appOrigin) return fail(403, "ORIGIN_DENIED");
    const bearer = request.headers.get("authorization") ?? "";
    if (!bearer.startsWith("Bearer ")) return fail(401, "SIGN_IN_REQUIRED");
    const { data: auth, error: authError } = await client.auth.getUser(
      bearer.slice(7),
    );
    if (authError || !auth.user) return fail(401, "SIGN_IN_REQUIRED");
    if (request.method === "DELETE") {
      const unused = await client.rpc("server_unused_organizer_media", {p_owner:auth.user.id});
      if (unused.error || !Array.isArray(unused.data) || unused.data.some((path:unknown)=>typeof path!=="string")) return fail(503,"CLEANUP_UNAVAILABLE");
      if (unused.data.length) {
        const removed=await client.storage.from("organizer-media").remove(unused.data);
        if (removed.error) return fail(409,"IMAGES_CHANGED");
      }
      return Response.json({removed:unused.data.length},{headers});
    }
    const mime = request.headers.get("content-type") ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      return fail(415, "UNSUPPORTED_IMAGE");
    }
    let bytes: Uint8Array;
    try {
      bytes = await readImage(request);
    } catch {
      return fail(413, "IMAGE_TOO_LARGE");
    }
    if (!validImageBytes(bytes, mime)) return fail(415, "INVALID_IMAGE_BYTES");
    const extension = mime === "image/jpeg"
      ? "jpg"
      : mime === "image/png"
      ? "png"
      : "webp";
    const path = `${auth.user.id}/${crypto.randomUUID()}.${extension}`;
    const result = await client.storage.from("organizer-media").upload(
      path,
      bytes,
      {
        contentType: mime,
        cacheControl: "0",
        upsert: false,
        metadata: { organizer_id: auth.user.id },
      },
    );
    if (result.error) return fail(409, "UPLOAD_NOT_CONFIRMED");
    const { data: objects, error: objectError } = await client.rpc("server_find_organizer_media", {p_owner:auth.user.id,p_path:path});
    if (objectError || !objects) return fail(503,"UPLOAD_NOT_CONFIRMED");
    return Response.json({ id: objects }, { status: 201, headers });
  } catch {
    return fail(503, "IMAGE_UNAVAILABLE");
  }
}
if (import.meta.main) Deno.serve(handler);
