import { importRuntime } from "../_shared/eventImportRuntime.ts";
export const handler = importRuntime("upload");
if (import.meta.main) Deno.serve(handler);
