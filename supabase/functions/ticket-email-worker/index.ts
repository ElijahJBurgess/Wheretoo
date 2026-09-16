import { getServiceClient } from "../_shared/database.ts";
import { type EnvReader, getAppBaseUrl } from "../_shared/env.ts";
import {
  type EmailRpc,
  processTicketEmail,
  readTicketEmailPayloadKeys,
  type TicketEmailWorkerConfig,
} from "../_shared/ticketEmailWorker.ts";
import { sendProviderEmail } from "../_shared/ticketEmailProvider.ts";

export type WorkerHandlerDependencies = {
  readEnv: EnvReader;
  rpc: EmailRpc;
  fetch: typeof fetch;
  now: () => number;
};
const response = (status: number, state: string) =>
  Response.json({ state }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

async function authorized(
  supplied: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function createTicketEmailWorkerHandler(
  deps: WorkerHandlerDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response(405, "method_not_allowed");
    const secret = deps.readEnv("TICKET_EMAIL_WORKER_SECRET");
    if (
      deps.readEnv("TICKET_EMAIL_WORKER_ENABLED") !== "true" || !secret ||
      secret.length < 32 || secret.length > 256 || secret.trim() !== secret
    ) return response(503, "unavailable");
    const supplied = request.headers.get("authorization") ?? "";
    if (
      supplied.length > 300 || !await authorized(supplied, `Bearer ${secret}`)
    ) return response(401, "unauthorized");
    let config: TicketEmailWorkerConfig;
    let apiKey: string;
    try {
      const from = deps.readEnv("TICKET_EMAIL_FROM");
      const key = deps.readEnv("RESEND_API_KEY");
      if (
        !from || from.length > 320 || /[\r\n]/.test(from) ||
        !/^[^<>\r\n]*<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from) || !key ||
        !/^re_[A-Za-z0-9_-]+$/.test(key)
      ) throw new Error();
      apiKey = key;
      config = {
        from,
        supportEmail: deps.readEnv("TICKET_EMAIL_SUPPORT_EMAIL") ?? "",
        appOrigin: getAppBaseUrl(deps.readEnv),
        ...readTicketEmailPayloadKeys(deps.readEnv),
      };
    } catch {
      return response(503, "unavailable");
    }
    try {
      await deps.rpc("server_enqueue_refund_notices", { p_limit: 25 });
      // Deliberately unscheduled and bounded; database authorization remains independently required.
      for (let processed = 0; processed < 3; processed++) {
        const state = await processTicketEmail({
          config,
          rpc: deps.rpc,
          now: deps.now,
          send: (payload, key) =>
            sendProviderEmail(payload, key, { apiKey, fetch: deps.fetch }),
        });
        if (state === "empty") return response(200, "idle");
        if (state === "unavailable") return response(503, "unavailable");
      }
      return response(200, "processed");
    } catch {
      return response(503, "unavailable");
    }
  };
}

export const handler = createTicketEmailWorkerHandler({
  readEnv: (name) => Deno.env.get(name),
  now: Date.now,
  fetch: (...args) => fetch(...args),
  rpc: async (name, args = {}) => {
    const { data, error } = await getServiceClient().rpc(name, args);
    if (error) throw new Error("Email storage unavailable");
    return data;
  },
});
if (import.meta.main) Deno.serve(handler);
