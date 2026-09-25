import { z } from "zod";
import { supabase } from "../../lib/supabase/client";
import { publicEnv } from "../../lib/env";
import {
  type ImportAction,
  importBatchSchema,
  importDetailSchema,
} from "./eventImports.schemas";
export async function listImports() {
  const { data, error } = await supabase.rpc("list_event_import_batches");
  if (error) throw error;
  return z.array(importBatchSchema).parse(data);
}
export async function readImport(batchId: string, offset: number) {
  const { data, error } = await supabase.rpc("get_event_import_batch", {
    p_batch: batchId,
    p_offset: offset,
  });
  if (error) throw error;
  return importDetailSchema.parse(data);
}
export async function readImportDraft(eventId: string) {
  const { data, error } = await supabase.rpc("get_event_import_draft", {
    p_event: eventId,
  });
  if (error) throw error;
  return z.object({
    isOwner: z.boolean(),
    changedSinceImport: z.boolean(),
    event: z.object({
      id: z.string(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      status: z.string(),
      moderation_status: z.string(),
      venue_name: z.string().nullable(),
      address_line1: z.string().nullable(),
      starts_at: z.string().nullable(),
    }),
  }).parse(data);
}
async function send(
  path: string,
  body: BodyInit,
  contentType: string,
  isCurrent: () => boolean,
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !isCurrent()) throw Error("Sign in again to manage imports.");
  let r: Response;
  try {
    r = await fetch(`${publicEnv.supabaseUrl}/functions/v1/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: publicEnv.supabasePublishableKey,
        "content-type": contentType,
      },
      body,
    });
  } catch {
    throw Error(
      "Response unavailable. Refresh this batch before retrying; completed rows are preserved.",
    );
  }
  if (!isCurrent()) throw Error("Session changed. Reopen the import.");
  const data: unknown = await r.json();
  if (!r.ok) {
    const e = z.object({ error: z.string() }).safeParse(data);
    throw Error(
      e.success
        ? e.data.error.replaceAll("_", " ")
        : "Import unavailable. Refresh and retry.",
    );
  }
  return data;
}
export async function uploadImport(
  file: File,
  requestId: string,
  isCurrent: () => boolean,
) {
  if (file.size > 2097152 || !file.name.toLowerCase().endsWith(".csv")) {
    throw Error("Choose a CSV file of at most 2 MiB.");
  }
  return z.object({ batchId: z.string().uuid(), error: z.string().nullable() })
    .parse(
      await send(
        `event-import-upload?${new URLSearchParams({
          requestId,
          filename: file.name,
        })}`,
        file,
        "text/csv",
        isCurrent,
      ),
    );
}
export async function actOnImport(
  action: ImportAction,
  isCurrent: () => boolean,
) {
  return z.object({
    ok: z.literal(true),
    reviewChanged: z.boolean().optional(),
    providerState: z.string().nullable().optional(),
    processed: z.number().optional(),
    results: z.array(z.unknown()).optional(),
  }).parse(
    await send(
      "event-import-process",
      JSON.stringify(action),
      "application/json",
      isCurrent,
    ),
  );
}
