import { validImageBytes } from "../event-images/imageBytes.ts";

export class DuplicateError extends Error {
  constructor(code: string, readonly status = 409) { super(code); }
}
export type DuplicateContext = { fingerprint: string; image: { id: string; path: string } | null };
export type FinalizeArgs = {
  p_source_event_id: string; p_new_event_id: string;
  p_expected_fingerprint: string; p_staged_path: string | null;
};
export type DuplicatePorts = {
  context: () => Promise<DuplicateContext>;
  read: (path: string) => Promise<Blob>;
  stage: (path: string, bytes: Uint8Array, mime: string, metadata: Record<string, unknown>) => Promise<void>;
  finalize: (args: FinalizeArgs) => Promise<string>;
  remove: (path: string) => Promise<void>;
};
/** SQL is the commit boundary. A transport error after dispatch is never rollback evidence. */
export async function duplicateEvent(ports: DuplicatePorts, sourceId: string, ownerId: string): Promise<string> {
  const context = await ports.context();
  const eventId = crypto.randomUUID();
  let path: string | null = null;
  const cleanup = async () => {
    if (path) {
      try { await ports.remove(path); } catch { console.warn("Duplicate staging cleanup deferred"); }
    }
  };
  if (context.image) {
    let file: Blob;
    try { file = await ports.read(context.image.path); }
    catch { throw new DuplicateError("DUPLICATE_FLYER_UNAVAILABLE"); }
    if (file.size < 1 || file.size > 5242880) throw new DuplicateError("DUPLICATE_FLYER_UNAVAILABLE");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validImageBytes(bytes, file.type)) throw new DuplicateError("DUPLICATE_FLYER_UNAVAILABLE");
    const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    path = `${eventId}/${crypto.randomUUID()}.${ext}`;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    try {
      await ports.stage(path, bytes, file.type, {
        organizer_id: ownerId, cover_staged: true, cover_revision: 0,
        duplicate_source: sourceId, duplicate_fingerprint: context.fingerprint,
        duplicate_image: context.image.id, digest,
      });
    } catch (error) {
      // Finalization has not been attempted: this UUID/path cannot be a committed cover.
      await cleanup();
      if (error instanceof DuplicateError) throw error;
      throw new DuplicateError("DUPLICATE_FLYER_UNAVAILABLE");
    }
  }
  let returned: string;
  try {
    returned = await ports.finalize({ p_source_event_id: sourceId, p_new_event_id: eventId,
      p_expected_fingerprint: context.fingerprint, p_staged_path: path });
  } catch (error) {
    if (error instanceof DuplicateError && error.message !== "DUPLICATE_OUTCOME_UNKNOWN") {
      await cleanup();
      throw error;
    }
    throw new DuplicateError("DUPLICATE_OUTCOME_UNKNOWN", 503);
  }
  if (returned !== eventId) throw new DuplicateError("DUPLICATE_OUTCOME_UNKNOWN", 503);
  return eventId;
}
