import { adaptTestRefund } from "./providerContract.ts";
import {
  type ExistingRefundSnapshot,
  recoverExistingRefundEvidence,
  refundModeIsTestCompatible,
} from "../_shared/refundEvidenceRecovery.ts";
import type Stripe from "stripe";
import { getServiceClient } from "../_shared/database.ts";
import {
  createWholeOrderRefund,
  type WholeOrderRefundSnapshot,
} from "../_shared/refundOrder.ts";
import { getStripe, rejectLiveStripeObject } from "../_shared/stripeClient.ts";

// Provider plumbing for the existing engine. Its snapshot, idempotency key,
// amount and transfer/fee policy remain the sole refund authority.
export async function refundOwnedOrder(orderId: string): Promise<void> {
  const stripe = getStripe();
  let prepared: WholeOrderRefundSnapshot | undefined;
  let testCharge: unknown;
  await createWholeOrderRefund(orderId, "requested_by_customer", {
    async prepareWholeOrderRefund(id, reason) {
      const { data, error } = await getServiceClient().rpc(
        "server_prepare_whole_order_refund",
        { p_order_id: id, p_reason: reason },
      );
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new Error("Refund unavailable");
      }
      const row = data[0];
      const snapshot: WholeOrderRefundSnapshot = {
        orderId: row.order_id,
        paymentIntentId: row.payment_intent_id,
        chargeId: row.charge_id,
        transferId: row.transfer_id,
        applicationFeeId: row.application_fee_id,
        currency: row.currency,
        totalMinor: row.total_minor,
        applicationFeeAmountMinor: row.application_fee_amount_minor,
        reason: row.reason,
      };
      const charge = rejectLiveStripeObject(
        await stripe.charges.retrieve(snapshot.chargeId),
      );
      if (
        charge.id !== snapshot.chargeId ||
        charge.amount !== snapshot.totalMinor ||
        charge.currency !== snapshot.currency ||
        (typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id) !== snapshot.paymentIntentId
      ) throw new Error("Payment context mismatch");
      testCharge = charge;
      prepared = snapshot;
      return snapshot;
    },
    async createRefund(params, options) {
      if (!prepared) throw new Error("Refund context unavailable");
      return adaptTestRefund(
        await stripe.refunds.create(
          params as Stripe.RefundCreateParams,
          options,
        ),
        testCharge,
        prepared,
      );
    },
    async retrieveRefundEvidence(refundId, snapshot) {
      const transfer = rejectLiveStripeObject(
        await stripe.transfers.retrieve(snapshot.transferId, {
          expand: ["reversals"],
        }),
      );
      const reversal = transfer.reversals.data.find((value) =>
        (typeof value.source_refund === "string"
          ? value.source_refund
          : value.source_refund?.id) === refundId
      );
      rejectLiveStripeObject(
        await stripe.applicationFees.retrieve(snapshot.applicationFeeId),
      );
      const refunds = await stripe.applicationFees.listRefunds(
        snapshot.applicationFeeId,
        { limit: 10 },
      );
      const fee = refunds.data.length === 1 && !refunds.has_more
        ? refunds.data[0]
        : undefined;
      if (
        !reversal || reversal.object !== "transfer_reversal" || !fee ||
        fee.object !== "fee_refund" || fee.currency !== snapshot.currency ||
        (typeof fee.fee === "string" ? fee.fee : fee.fee.id) !==
          snapshot.applicationFeeId
      ) throw new Error("Refund evidence unavailable");
      return {
        transferReversalId: reversal.id,
        transferReversalAmountMinor: reversal.amount,
        applicationFeeRefundId: fee.id,
        applicationFeeRefundAmountMinor: fee.amount,
      };
    },
    async updateRefundMetadata(id, metadata) {
      if (!prepared) throw new Error("Refund context unavailable");
      const updated = await stripe.refunds.update(id, { metadata });
      if (updated.id !== id) throw new Error("Refund identity mismatch");
      adaptTestRefund(updated, testCharge, prepared);
    },
  });
}

// Reuse the evidence recovery validator previously exercised by the transaction
// driver. Updating verified metadata triggers Stripe's signed refund.updated
// webhook; only that existing canonical path changes order/admission truth.
export async function recoverOwnedRefund(
  snapshot: ExistingRefundSnapshot,
): Promise<void> {
  const stripe = getStripe();
  await recoverExistingRefundEvidence(snapshot, {
    async read() {
      const [refunds, transfer, fee, feeRefunds] = await Promise.all([
        stripe.refunds.list({ charge: snapshot.chargeId, limit: 10 }),
        stripe.transfers.retrieve(snapshot.transferId, {
          expand: ["reversals"],
        }),
        stripe.applicationFees.retrieve(snapshot.applicationFeeId),
        stripe.applicationFees.listRefunds(snapshot.applicationFeeId, {
          limit: 10,
        }),
      ]);
      return { refunds, transfer, fee, feeRefunds } as unknown as Awaited<
        ReturnType<Parameters<typeof recoverExistingRefundEvidence>[1]["read"]>
      >;
    },
    async update(id, metadata) {
      const updated = await stripe.refunds.update(id, { metadata });
      if (updated.id !== id || !refundModeIsTestCompatible(updated)) {
        throw new Error("Refund context mismatch");
      }
    },
    pause: () => new Promise((resolve) => setTimeout(resolve, 500)),
  });
}
