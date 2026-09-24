import type { WorkerHandlerDependencies } from "../ticket-email-worker/index.ts";
import { readTicketEmailPayloadKeys } from "./ticketEmailWorker.ts";
import { processWaitlistDelivery } from "./waitlistWorker.ts";
import { sendProviderEmail } from "./ticketEmailProvider.ts";
import { z } from "zod";
export function createWaitlistWorkerHandler(
  operation: "observer" | "delivery",
  deps: WorkerHandlerDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, state: string) =>
      Response.json({ state }, {
        status,
        headers: { "cache-control": "no-store" },
      });
    if (request.method !== "POST") return reply(405, "method_not_allowed");
    const lane = operation === "observer"
      ? "WAITLIST_OBSERVER"
      : "WAITLIST_DELIVERY";
    const secret = deps.readEnv(lane + "_SECRET");
    if (
      deps.readEnv(lane + "_ENABLED") !== "true" || !secret ||
      secret.length < 32 || secret.length > 256 || secret.trim() !== secret
    ) return reply(503, "unavailable");
    const supplied = request.headers.get("authorization") ?? "";
    if (supplied.length > 300) return reply(401, "unauthorized");
    const enc = new TextEncoder();
    const a = new Uint8Array(
        await crypto.subtle.digest("SHA-256", enc.encode(supplied)),
      ),
      b = new Uint8Array(
        await crypto.subtle.digest("SHA-256", enc.encode("Bearer " + secret)),
      );
    let delta = 0;
    for (let i = 0; i < a.length; i++) delta |= a[i] ^ b[i];
    if (delta) return reply(401, "unauthorized");
    try {
      if (operation === "observer") {
        const tiers = z.array(z.uuid()).max(25).parse(
          await deps.rpc("server_next_waitlist_tiers", { p_limit: 25 }),
        );
        // Round-robin continuation, with at most 25 short transactions per invocation.
        // A durable cursor survives interruption; an unfinished tier remains due.
        const pending = [...tiers];
        for (let calls = 0; pending.length && calls < 25; calls++) {
          const tier = pending.shift()!;
          const result = await deps.rpc("server_observe_waitlist", {
            p_tier_id: tier,
          });
          if (
            result && typeof result === "object" && "more" in result &&
            result.more === true
          ) pending.push(tier);
        }
        return reply(200, tiers.length ? "observed" : "idle");
      }
      const key = deps.readEnv("RESEND_API_KEY");
      if (!key || !/^re_[A-Za-z0-9_-]+$/.test(key)) {
        return reply(503, "unavailable");
      }
      const config = readTicketEmailPayloadKeys(deps.readEnv);
      if (await deps.rpc("server_acknowledge_waitlist_worker") !== true) {
        return reply(503, "unavailable");
      }
      // Small bounded batch; SQL reserves independent capacity per possible dispatch.
      const started = deps.now();
      for (let i = 0; i < 10 && deps.now() - started < 30000; i++) {
        const state = await processWaitlistDelivery({
          config,
          rpc: deps.rpc,
          now: deps.now,
          send: (payload, id) =>
            sendProviderEmail(payload, id, { apiKey: key, fetch: deps.fetch }),
        });
        if (state === "empty") return reply(200, i ? "processed" : "idle");
        if (state === "unavailable") return reply(503, state);
      }
      return reply(200, "processed");
    } catch {
      return reply(503, "unavailable");
    }
  };
}
