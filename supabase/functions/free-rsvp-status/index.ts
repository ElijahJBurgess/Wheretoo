import { defaultFreeRsvpHandler } from '../_shared/freeRsvpHandler.ts'
export function handler(request: Request): Promise<Response> {
  return defaultFreeRsvpHandler('status')(request)
}
if (import.meta.main) Deno.serve(handler)
