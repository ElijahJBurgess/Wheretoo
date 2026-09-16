// Test-only transport: production operation handler and financial helper, fake provider.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createOrganizerRefundHandler } from "../../../../supabase/functions/organizer-refund-order/index.ts";
import {
  createWholeOrderRefund,
  type WholeOrderRefundSnapshot,
} from "../../../../supabase/functions/_shared/refundOrder.ts";
import { HttpError } from "../../../../supabase/functions/_shared/http.ts";
import type { RefundOperationContext } from "../../../../supabase/functions/organizer-refund-order/refundOperation.ts";
export const refundProof = { creates: 0, parameters: [] as unknown[] };
export function localRefund(
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const ids = (owner: string, event: string, order: string) => ({
    p_organizer_id: owner,
    p_event_id: event,
    p_order_id: order,
  });
  return createOrganizerRefundHandler({
    appOrigin: "http://127.0.0.1:3029",
    async verifyOrganizer(request) {
      const parts =
        request.headers.get("authorization")?.replace(/^Bearer /, "").split(
          ".",
        ) ?? [];
      if (parts.length !== 3) throw new HttpError(401, "AUTH_REQUIRED");
      const expected = createHmac(
        "sha256",
        "spec10-local-only-jwt-secret-disposable-2026",
      ).update(parts[0] + "." + parts[1]).digest();
      const supplied = Buffer.from(parts[2], "base64url");
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) throw new HttpError(401, "AUTH_REQUIRED");
      const claim = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (
        claim.role !== "authenticated" || typeof claim.sub !== "string" ||
        claim.exp < Date.now() / 1000
      ) throw new HttpError(401, "AUTH_REQUIRED");
      return { userId: claim.sub, organizerId: claim.sub };
    },
    read: async (owner, event, order) =>
      await rpc(
        "server_read_owned_refund_operation",
        ids(owner, event, order),
      ) as RefundOperationContext,
    claim: async (owner, event, order) =>
      await rpc("server_claim_owned_refund", ids(owner, event, order)) as {
        dispatch: boolean;
        state: string;
      },
    async note(owner, event, order, state, refundId) {
      await rpc("server_note_refund_observation", {
        ...ids(owner, event, order),
        p_state: state,
        p_refund_id: refundId ?? null,
      });
    },
    async observe(snapshot) {
      const orderId = (snapshot as { orderId: string }).orderId;
      return {
        state: "processing",
        refundId: "re_spec09browser" + orderId.replaceAll("-", ""),
      };
    },
    async refund(orderId) {
      let saved: WholeOrderRefundSnapshot;
      await createWholeOrderRefund(orderId, "requested_by_customer", {
        async prepareWholeOrderRefund(id, reason) {
          const rows = await rpc("server_prepare_whole_order_refund", {
            p_order_id: id,
            p_reason: reason,
          }) as Record<string, unknown>[];
          const r = rows[0];
          saved = {
            orderId: r.order_id as string,
            paymentIntentId: r.payment_intent_id as string,
            chargeId: r.charge_id as string,
            transferId: r.transfer_id as string,
            applicationFeeId: r.application_fee_id as string,
            currency: r.currency as "usd",
            totalMinor: r.total_minor as number,
            applicationFeeAmountMinor: r.application_fee_amount_minor as number,
            reason: r.reason as string,
          };
          return saved;
        },
        async createRefund(params, options) {
          refundProof.creates++;
          refundProof.parameters.push({ params, options });
          return {
            object: "refund",
            id: "re_spec09browser" + orderId.replaceAll("-", ""),
            livemode: false,
            amount: saved.totalMinor,
            currency: saved.currency,
            payment_intent: saved.paymentIntentId,
            charge: saved.chargeId,
            status: "succeeded",
          };
        },
        async retrieveRefundEvidence() {
          return {
            transferReversalId: "trr_spec09browser" +
              orderId.replaceAll("-", ""),
            transferReversalAmountMinor: saved.totalMinor,
            applicationFeeRefundId: "fr_spec09browser" +
              orderId.replaceAll("-", ""),
            applicationFeeRefundAmountMinor: saved.applicationFeeAmountMinor,
          };
        },
        async updateRefundMetadata() {},
      });
    },
  });
}
