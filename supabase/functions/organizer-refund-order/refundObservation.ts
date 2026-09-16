import {
  type ExistingRefundSnapshot,
  RefundEvidenceConflict,
} from "../_shared/refundEvidenceRecovery.ts";
import { adaptTestRefund } from "./providerContract.ts";
import type { RefundObservation } from "./refundOperation.ts";
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export async function observeRefund(snapshot: ExistingRefundSnapshot, deps: {
  read(): Promise<
    { charge: unknown; refunds: { data: unknown[]; has_more: boolean } }
  >;
  recover(snapshot: ExistingRefundSnapshot): Promise<void>;
}): Promise<RefundObservation> {
  try {
    const { charge, refunds } = await deps.read();
    if (
      refunds.has_more || !Array.isArray(refunds.data) ||
      refunds.data.length > 1
    ) return { state: "review" };
    if (!refunds.data.length) return { state: "unknown" };
    const raw = refunds.data[0];
    if (
      !record(raw) || typeof raw.id !== "string" ||
      !/^re_[A-Za-z0-9]+$/.test(raw.id) ||
      (snapshot.refundId !== null && snapshot.refundId !== raw.id)
    ) return { state: "review" };
    try {
      adaptTestRefund(raw, charge, {
        ...snapshot,
        currency: "usd",
        reason: "requested_by_customer",
      });
    } catch {
      return { state: "review" };
    }
    const metadata = raw.metadata;
    if (
      !record(metadata) || metadata.order_id !== snapshot.orderId ||
      metadata.whereto_refund_policy !== "destination_v1" ||
      metadata.whereto_reverse_transfer !== "true" ||
      metadata.whereto_refund_application_fee !== "true"
    ) return { state: "review" };
    const refundId = raw.id;
    switch (raw.status) {
      case "pending":
        return { state: "processing", refundId };
      case "requires_action":
        return { state: "review", refundId };
      case "failed":
      case "canceled":
        return { state: "failed", refundId };
      case "succeeded":
        await deps.recover({ ...snapshot, refundId });
        return { state: "processing", refundId };
      default:
        return { state: "review", refundId };
    }
  } catch (error) {
    return {
      state: error instanceof RefundEvidenceConflict ? "review" : "unknown",
    };
  }
}
