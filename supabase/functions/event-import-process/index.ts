import { importRuntime } from "../_shared/eventImportRuntime.ts";
export const handler = importRuntime("process");
if (import.meta.main) Deno.serve(handler);
