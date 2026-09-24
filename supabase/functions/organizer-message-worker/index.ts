import { getServiceClient } from "../_shared/database.ts";
import type { WorkerHandlerDependencies } from "../ticket-email-worker/index.ts";
import { readTicketEmailPayloadKeys } from "../_shared/ticketEmailWorker.ts";
import {
  type OrganizerMessageWorkerConfig,
  processOrganizerMessage,
} from "../_shared/organizerMessageWorker.ts";
import { sendProviderEmail } from "../_shared/ticketEmailProvider.ts";
const response = (status: number, state: string) =>
  Response.json({ state }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
async function authorized(
  supplied: string,
  expected: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(supplied)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
export function createOrganizerMessageWorkerHandler(
  deps: WorkerHandlerDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response(405, "method_not_allowed");
    const secret = deps.readEnv("ORGANIZER_MESSAGE_WORKER_SECRET");
    if (
      deps.readEnv("ORGANIZER_MESSAGE_WORKER_ENABLED") !== "true" || !secret ||
      secret.length < 32 || secret.length > 256 || secret.trim() !== secret
    ) return response(503, "unavailable");
    const supplied = request.headers.get("authorization") ?? "";
    if (
      supplied.length > 300 || !await authorized(supplied, `Bearer ${secret}`)
    ) return response(401, "unauthorized");
    let config: OrganizerMessageWorkerConfig, apiKey: string;
    try {
      const key = deps.readEnv("RESEND_API_KEY");
      if (!key || !/^re_[A-Za-z0-9_-]+$/.test(key)) throw Error();
      apiKey = key;
      config = readTicketEmailPayloadKeys(deps.readEnv);
    } catch {
      return response(503, "unavailable");
    }
    try {
      // Health is evidence that this independently gated lane can actually prepare and send.
      if (
        await deps.rpc("server_acknowledge_organizer_message_worker") !== true
      ) return response(503, "unavailable");
      // One per invocation; SQL also serializes leases and reserves the organizer quota.
      const state = await processOrganizerMessage({
        config,
        rpc: deps.rpc,
        now: deps.now,
        send: (payload, key) =>
          sendProviderEmail(payload, key, { apiKey, fetch: deps.fetch }),
      });
      return response(
        state === "unavailable" ? 503 : 200,
        state === "empty" ? "idle" : state,
      );
    } catch {
      return response(503, "unavailable");
    }
  };
}
export const handler = createOrganizerMessageWorkerHandler({
  readEnv: (name) => Deno.env.get(name),
  now: Date.now,
  fetch: (...args) => fetch(...args),
  rpc: async (name, args = {}) => {
    const { data, error } = await getServiceClient().rpc(name, args);
    if (error) throw Error("Message storage unavailable");
    return data;
  },
});
if (import.meta.main) Deno.serve(handler);
