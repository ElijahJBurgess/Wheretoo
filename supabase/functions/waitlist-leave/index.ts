import { waitlistHttpHandler } from "../_shared/waitlistHttp.ts";
export const handler = (request: Request) =>
  waitlistHttpHandler("leave", request);
if (import.meta.main) Deno.serve(handler);
