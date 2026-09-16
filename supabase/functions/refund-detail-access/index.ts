import { ticketEmailHttpHandler } from "../_shared/ticketEmailHttp.ts";
export const handler = (request: Request): Promise<Response> =>
  ticketEmailHttpHandler("refund_access", request);
if (import.meta.main) Deno.serve(handler);
