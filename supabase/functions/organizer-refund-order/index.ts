import { z } from "zod";
import { requireOrganizer } from "../_shared/auth.ts";
import type { OrganizerContext } from "../_shared/contracts.ts";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { HttpError } from "../_shared/http.ts";
import { getStripe } from "../_shared/stripeClient.ts";
import { recoverOwnedRefund, refundOwnedOrder } from "./refundAdapter.ts";
import {
  executeOwnedRefund,
  type RefundObservation,
  type RefundOperationContext,
} from "./refundOperation.ts";
import { observeRefund } from "./refundObservation.ts";
const states = z.enum([
  "eligible",
  "submitting",
  "processing",
  "unknown",
  "failed",
  "review",
  "completed",
  "ineligible",
]);
const inputSchema = z.strictObject({
  eventId: z.uuid(),
  orderId: z.uuid(),
  action: z.enum(["submit", "reconcile"]).default("submit"),
});
const snapshotSchema = z.strictObject({
  orderId: z.uuid(),
  paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  chargeId: z.string().regex(/^ch_[A-Za-z0-9]+$/),
  transferId: z.string().regex(/^tr_[A-Za-z0-9]+$/),
  applicationFeeId: z.string().regex(/^fee_[A-Za-z0-9]+$/),
  connectedAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  totalMinor: z.number().int().positive().safe(),
  applicationFeeAmountMinor: z.number().int().nonnegative().safe(),
  currency: z.literal("usd"),
  reason: z.literal("requested_by_customer"),
  refundId: z.string().regex(/^re_[A-Za-z0-9]+$/).nullable(),
  reversalId: z.string().nullable(),
  feeRefundId: z.string().nullable(),
});
const contextSchema = z.strictObject({
  state: states,
  hasOperation: z.boolean(),
  canRecover: z.boolean(),
  snapshot: z.unknown(),
});
const claimSchema = z.strictObject({ dispatch: z.boolean(), state: states });
export interface OrganizerRefundDependencies {
  appOrigin: string;
  verifyOrganizer(request: Request): Promise<OrganizerContext>;
  read(
    owner: string,
    event: string,
    order: string,
  ): Promise<RefundOperationContext>;
  claim(
    owner: string,
    event: string,
    order: string,
  ): Promise<{ dispatch: boolean; state: string }>;
  refund(order: string): Promise<void>;
  observe(snapshot: unknown): Promise<RefundObservation>;
  note(
    owner: string,
    event: string,
    order: string,
    state: string,
    refundId?: string,
  ): Promise<void>;
}
async function readInput(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json" || !request.body
  ) throw new Error();
  const reader = request.body.getReader();
  let size = 0;
  const chunks: number[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 256) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(...value);
    }
  } finally {
    reader.releaseLock();
  }
  return inputSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(chunks)),
    ),
  );
}
export function createOrganizerRefundHandler(
  deps: OrganizerRefundDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const headers = getCorsHeaders(request, deps.appOrigin);
    headers.set("content-type", "application/json");
    headers.set("cache-control", "private, no-store");
    headers.set("pragma", "no-cache");
    const respond = (outcome: string, status = 200) =>
      new Response(JSON.stringify({ outcome }), { status, headers });
    if (!headers.has("access-control-allow-origin")) {
      return respond("unauthorized", 403);
    }
    const preflight = handleCorsPreflight(request, deps.appOrigin);
    if (preflight) return preflight;
    if (request.method !== "POST") return respond("unknown", 405);
    let owner: OrganizerContext;
    try {
      owner = await deps.verifyOrganizer(request);
    } catch (error) {
      return respond(
        "unauthorized",
        error instanceof HttpError ? error.status : 503,
      );
    }
    let input: z.infer<typeof inputSchema>;
    try {
      input = await readInput(request);
    } catch {
      return respond("unknown", 400);
    }
    const args = [owner.organizerId, input.eventId, input.orderId] as const;
    try {
      const outcome = await executeOwnedRefund(input, {
        read: () => deps.read(...args),
        claim: () => deps.claim(...args),
        refund: () => deps.refund(input.orderId),
        observe: deps.observe,
        note: (state, id) => deps.note(...args, state, id),
      });
      return respond(outcome, outcome === "ineligible" ? 409 : 200);
    } catch {
      return respond("unknown", 503);
    }
  };
}
export function handler(request: Request) {
  const ids = (owner: string, event: string, order: string) => ({
    p_organizer_id: owner,
    p_event_id: event,
    p_order_id: order,
  });
  return createOrganizerRefundHandler({
    appOrigin: getAppBaseUrl(),
    verifyOrganizer: requireOrganizer,
    refund: refundOwnedOrder,
    async read(owner, event, order) {
      const { data, error } = await getServiceClient().rpc(
        "server_read_owned_refund_operation",
        ids(owner, event, order),
      );
      if (error) throw new Error("Order unavailable");
      const context = contextSchema.parse(data);
      if (context.canRecover) {
        const snapshot = snapshotSchema.parse(context.snapshot);
        if (snapshot.orderId !== order) throw new Error("Order unavailable");
      }
      return context;
    },
    async claim(owner, event, order) {
      const { data, error } = await getServiceClient().rpc(
        "server_claim_owned_refund",
        ids(owner, event, order),
      );
      if (error) throw new Error("Order unavailable");
      return claimSchema.parse(data);
    },
    async note(owner, event, order, state, refundId) {
      const { error } = await getServiceClient().rpc(
        "server_note_refund_observation",
        {
          ...ids(owner, event, order),
          p_state: state,
          p_refund_id: refundId ?? null,
        },
      );
      if (error) throw new Error("Observation unavailable");
    },
    async observe(value) {
      const snapshot = snapshotSchema.parse(value);
      const stripe = getStripe();
      return observeRefund(snapshot, {
        async read() {
          const [charge, refunds] = await Promise.all([
            stripe.charges.retrieve(snapshot.chargeId),
            stripe.refunds.list({ charge: snapshot.chargeId, limit: 10 }),
          ]);
          return { charge, refunds };
        },
        recover: recoverOwnedRefund,
      });
    },
  })(request);
}
if (import.meta.main) Deno.serve(handler);
