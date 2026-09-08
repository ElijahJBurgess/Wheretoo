const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9]+$/;
const CHARGE_PATTERN = /^ch_[A-Za-z0-9]+$/;
const TRANSFER_PATTERN = /^tr_[A-Za-z0-9]+$/;
const APPLICATION_FEE_PATTERN = /^fee_[A-Za-z0-9]+$/;
const REFUND_PATTERN = /^re_[A-Za-z0-9]+$/;
const TRANSFER_REVERSAL_PATTERN = /^trr_[A-Za-z0-9]+$/;
const FEE_REFUND_PATTERN = /^fr_[A-Za-z0-9]+$/;

export interface WholeOrderRefundSnapshot {
  orderId: string;
  paymentIntentId: string;
  chargeId: string;
  transferId: string;
  applicationFeeId: string;
  currency: "usd";
  totalMinor: number;
  applicationFeeAmountMinor: number;
  reason: string;
}

export interface WholeOrderRefundEvidence {
  transferReversalId: string;
  transferReversalAmountMinor: number;
  applicationFeeRefundId: string;
  applicationFeeRefundAmountMinor: number;
}

export interface RefundOrderDependencies {
  prepareWholeOrderRefund(
    orderId: string,
    reason: string,
  ): Promise<WholeOrderRefundSnapshot>;
  createRefund(
    params: Record<string, unknown>,
    options: { idempotencyKey: string },
  ): Promise<unknown>;
  retrieveRefundEvidence(
    refundId: string,
    snapshot: WholeOrderRefundSnapshot,
  ): Promise<WholeOrderRefundEvidence>;
  updateRefundMetadata(
    refundId: string,
    metadata: Record<string, string>,
  ): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSnapshot(value: WholeOrderRefundSnapshot, orderId: string) {
  return value.orderId === orderId && UUID_PATTERN.test(value.orderId) &&
    PAYMENT_INTENT_PATTERN.test(value.paymentIntentId) &&
    CHARGE_PATTERN.test(value.chargeId) &&
    TRANSFER_PATTERN.test(value.transferId) &&
    APPLICATION_FEE_PATTERN.test(value.applicationFeeId) &&
    value.currency === "usd" && Number.isSafeInteger(value.totalMinor) &&
    value.totalMinor > 0 &&
    Number.isSafeInteger(value.applicationFeeAmountMinor) &&
    value.applicationFeeAmountMinor >= 0 &&
    value.applicationFeeAmountMinor < value.totalMinor &&
    value.reason.length > 0 && value.reason.length <= 255;
}

export async function createWholeOrderRefund(
  orderId: string,
  reason: string,
  dependencies: RefundOrderDependencies,
): Promise<{ orderId: string; stripeRefundId: string; status: string }> {
  if (!UUID_PATTERN.test(orderId) || reason.trim() !== reason) {
    throw new Error("REFUND_INPUT_INVALID");
  }
  const snapshot = await dependencies.prepareWholeOrderRefund(orderId, reason);
  if (!validSnapshot(snapshot, orderId)) {
    throw new Error("REFUND_SNAPSHOT_INVALID");
  }
  const baseMetadata = {
    order_id: snapshot.orderId,
    whereto_refund_policy: "destination_v1",
    whereto_reverse_transfer: "true",
    whereto_refund_application_fee: "true",
  };
  const created = await dependencies.createRefund({
    payment_intent: snapshot.paymentIntentId,
    amount: snapshot.totalMinor,
    reverse_transfer: true,
    refund_application_fee: true,
    reason: snapshot.reason,
    metadata: baseMetadata,
  }, {
    idempotencyKey: `whereto-refund-integrity-v1:${snapshot.orderId}`,
  });
  if (
    !isRecord(created) || created.object !== "refund" ||
    typeof created.id !== "string" || !REFUND_PATTERN.test(created.id) ||
    created.livemode !== false || created.amount !== snapshot.totalMinor ||
    created.currency !== snapshot.currency ||
    created.payment_intent !== snapshot.paymentIntentId ||
    created.charge !== snapshot.chargeId || typeof created.status !== "string"
  ) throw new Error("REFUND_SNAPSHOT_INVALID");

  const evidence = await dependencies.retrieveRefundEvidence(
    created.id,
    snapshot,
  );
  if (
    !TRANSFER_REVERSAL_PATTERN.test(evidence.transferReversalId) ||
    !FEE_REFUND_PATTERN.test(evidence.applicationFeeRefundId) ||
    evidence.transferReversalAmountMinor !== snapshot.totalMinor ||
    evidence.applicationFeeRefundAmountMinor !==
      snapshot.applicationFeeAmountMinor
  ) throw new Error("REFUND_POLICY_MISMATCH");
  await dependencies.updateRefundMetadata(created.id, {
    ...baseMetadata,
    whereto_transfer_reversal_amount: String(
      evidence.transferReversalAmountMinor,
    ),
    whereto_application_fee_refund_id: evidence.applicationFeeRefundId,
    whereto_application_fee_refund_amount: String(
      evidence.applicationFeeRefundAmountMinor,
    ),
  });
  return {
    orderId: snapshot.orderId,
    stripeRefundId: created.id,
    status: created.status,
  };
}
