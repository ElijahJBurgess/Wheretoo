import { getServiceClient } from "../_shared/database.ts";
import type { EmailRpc } from "../_shared/ticketEmailWorker.ts";
import type { EnvReader } from "../_shared/env.ts";
import {
  type ProviderObservation,
  verifyProviderObservation,
} from "../_shared/ticketEmailProvider.ts";

type WebhookDependencies = {
  readEnv: EnvReader;
  rpc: EmailRpc;
  verify: (
    raw: string,
    headers: Headers,
    secret: string,
  ) => Promise<ProviderObservation>;
};
const response = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

async function boundedRawBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function createTicketEmailWebhookHandler(deps: WebhookDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response(405);
    const secret = deps.readEnv("RESEND_WEBHOOK_SECRET");
    if (!secret) return response(503);
    let observation: ProviderObservation;
    try {
      const raw = await boundedRawBody(request);
      if (raw === null) return response(413);
      observation = await deps.verify(raw, request.headers, secret);
    } catch {
      return response(400);
    }
    try {
      const saved = await deps.rpc("server_observe_ticket_email", observation);
      return response(saved === true ? 200 : 400);
    } catch {
      return response(503);
    }
  };
}

export const handler = createTicketEmailWebhookHandler({
  readEnv: (name) => Deno.env.get(name),
  verify: verifyProviderObservation,
  rpc: async (name, args = {}) => {
    const { data, error } = await getServiceClient().rpc(name, args);
    if (error) throw new Error("Email storage unavailable");
    return data;
  },
});
if (import.meta.main) Deno.serve(handler);
