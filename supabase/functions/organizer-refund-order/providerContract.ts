import { type WholeOrderRefundSnapshot } from "../_shared/refundOrder.ts";
import { refundModeIsTestCompatible } from "../_shared/refundEvidenceRecovery.ts";
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const id = (value: unknown) =>
  typeof value === "string" ? value : record(value) ? value.id : undefined;
// Stripe Refund has no livemode. Prove TEST from its bound Charge before adapting
// to the existing engine's internal evidence contract. Never infer mode from an ID.
export function adaptTestRefund(
  refund: unknown,
  charge: unknown,
  snapshot: WholeOrderRefundSnapshot,
) {
  if (
    !record(refund) || !record(charge) || !refundModeIsTestCompatible(refund) ||
    charge.object !== "charge" || charge.livemode !== false ||
    charge.id !== snapshot.chargeId ||
    id(charge.payment_intent) !== snapshot.paymentIntentId ||
    charge.amount !== snapshot.totalMinor ||
    charge.currency !== snapshot.currency || refund.object !== "refund" ||
    id(refund.charge) !== snapshot.chargeId ||
    id(refund.payment_intent) !== snapshot.paymentIntentId ||
    refund.amount !== snapshot.totalMinor ||
    refund.currency !== snapshot.currency
  ) throw new Error("Refund provider context mismatch");
  return { ...refund, livemode: false };
}
