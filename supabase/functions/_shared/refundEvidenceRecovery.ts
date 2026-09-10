type RecoveryRecord = Record<string, unknown>;
type RecoveryList = { has_more: boolean; data: RecoveryRecord[] };
function record(value: unknown): value is RecoveryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export type ExistingRefundSnapshot = {
  totalMinor: number;
  applicationFeeAmountMinor: number;
  orderId: string;
  paymentIntentId: string;
  chargeId: string;
  transferId: string;
  applicationFeeId: string;
  connectedAccountId: string;
  refundId: string | null;
  reversalId: string | null;
  feeRefundId: string | null;
};

export class RefundEvidenceConflict extends Error {
  constructor(readonly evidence: Record<string, boolean>) {
    super("TASK14_REFUND_EVIDENCE_CONFLICT");
  }
}

// Refund omits livemode in the provider contract; surrounding objects must prove TEST.
export function refundModeIsTestCompatible(value: unknown): boolean {
  return record(value) &&
    (value.livemode === undefined || value.livemode === false);
}

// Observation only; mirror the canonical recovery checks below.
function refundEvidenceBitmap(
  snapshot: ExistingRefundSnapshot,
  refunds: RecoveryList,
  transfer: RecoveryRecord,
  fee: RecoveryRecord,
  feeRefunds: RecoveryList,
) {
  const reversals = transfer.reversals as RecoveryList | undefined;
  const refund = refunds.data?.[0] ?? {};
  const reversal = reversals?.data?.[0] ?? {};
  const feeRefund = feeRefunds.data?.[0] ?? {};
  const metadata = record(refund.metadata) ? refund.metadata : {};
  const id = (value: unknown) =>
    typeof value === "string" ? value : record(value) ? value.id : undefined;
  const validId = (value: unknown, prefix: string) =>
    typeof value === "string" &&
    new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
  const bounded = (list: RecoveryList | undefined) =>
    Array.isArray(list?.data) && list.data.length <= 1;
  const optionalMetadata = (key: string, expected: unknown) =>
    metadata[key] === undefined || metadata[key] === expected;
  return {
    refund_list_complete: refunds.has_more === false,
    refund_list_bounded: bounded(refunds),
    reversal_list_complete: reversals?.has_more === false,
    reversal_list_bounded: bounded(reversals),
    fee_refund_list_complete: feeRefunds.has_more === false,
    fee_refund_list_bounded: bounded(feeRefunds),
    transfer_object_matches: transfer.object === "transfer",
    transfer_identity_matches: transfer.id === snapshot.transferId,
    transfer_test_mode: transfer.livemode === false,
    transfer_amount_matches: transfer.amount === snapshot.totalMinor,
    transfer_reversed_amount_matches:
      Number.isSafeInteger(transfer.amount_reversed) &&
      (transfer.amount_reversed as number) >= snapshot.totalMinor,
    transfer_currency_matches: transfer.currency === "usd",
    transfer_charge_matches:
      id(transfer.source_transaction) === snapshot.chargeId,
    transfer_destination_matches:
      id(transfer.destination) === snapshot.connectedAccountId,
    fee_object_matches: fee.object === "application_fee",
    fee_identity_matches: fee.id === snapshot.applicationFeeId,
    fee_test_mode: fee.livemode === false,
    fee_amount_matches: fee.amount === snapshot.applicationFeeAmountMinor,
    fee_refunded_amount_matches: Number.isSafeInteger(fee.amount_refunded) &&
      (fee.amount_refunded as number) >= snapshot.applicationFeeAmountMinor,
    fee_currency_matches: fee.currency === "usd",
    fee_charge_matches:
      id(fee.originating_transaction ?? fee.charge) === snapshot.chargeId,
    fee_account_matches: id(fee.account) === snapshot.connectedAccountId,
    refund_present: refunds.data?.length === 1,
    refund_object_matches: refund.object === "refund",
    refund_identity_valid: validId(refund.id, "re"),
    refund_identity_matches: snapshot.refundId === null ||
      refund.id === snapshot.refundId,
    refund_test_mode: refundModeIsTestCompatible(refund),
    refund_succeeded: refund.status === "succeeded",
    refund_amount_matches: refund.amount === snapshot.totalMinor,
    refund_currency_matches: refund.currency === "usd",
    refund_payment_matches:
      id(refund.payment_intent) === snapshot.paymentIntentId,
    refund_charge_matches: id(refund.charge) === snapshot.chargeId,
    metadata_order_matches: metadata.order_id === snapshot.orderId,
    metadata_policy_matches:
      metadata.whereto_refund_policy === "destination_v1",
    metadata_reverse_transfer_matches:
      metadata.whereto_reverse_transfer === "true",
    metadata_refund_application_fee_matches:
      metadata.whereto_refund_application_fee === "true",
    reversal_present: reversals?.data?.length === 1,
    reversal_object_matches: reversal.object === "transfer_reversal",
    reversal_identity_valid: validId(reversal.id, "trr"),
    reversal_identity_matches: snapshot.reversalId === null ||
      reversal.id === snapshot.reversalId,
    reversal_amount_matches: reversal.amount === snapshot.totalMinor,
    reversal_currency_matches: reversal.currency === "usd",
    reversal_transfer_matches: id(reversal.transfer) === snapshot.transferId,
    reversal_source_refund_matches:
      id(reversal.source_refund) === (refund.id ?? snapshot.refundId),
    refund_transfer_reversal_matches: typeof reversal.id === "string" &&
      id(refund.transfer_reversal) === reversal.id,
    refund_source_transfer_reversal_matches: typeof reversal.id === "string" &&
      id(refund.source_transfer_reversal) === reversal.id,
    refund_canonical_reversal_matches: typeof reversal.id === "string" &&
      id(refund.transfer_reversal ?? refund.source_transfer_reversal) ===
        reversal.id,
    fee_refund_present: feeRefunds.data?.length === 1,
    fee_refund_object_matches: feeRefund.object === "fee_refund",
    fee_refund_identity_valid: validId(feeRefund.id, "fr"),
    fee_refund_identity_matches: snapshot.feeRefundId === null ||
      feeRefund.id === snapshot.feeRefundId,
    fee_refund_amount_matches:
      feeRefund.amount === snapshot.applicationFeeAmountMinor,
    fee_refund_currency_matches: feeRefund.currency === "usd",
    fee_refund_fee_matches: id(feeRefund.fee) === snapshot.applicationFeeId,
    metadata_reversal_amount_matches: optionalMetadata(
      "whereto_transfer_reversal_amount",
      String(reversal.amount),
    ),
    metadata_fee_refund_identity_matches: optionalMetadata(
      "whereto_application_fee_refund_id",
      feeRefund.id,
    ),
    metadata_fee_refund_amount_matches: optionalMetadata(
      "whereto_application_fee_refund_amount",
      String(feeRefund.amount),
    ),
  };
}

// Existing refund evidence recovery only: no create capability or admission writes.
export async function recoverExistingRefundEvidence(
  snapshot: ExistingRefundSnapshot,
  dependencies: {
    read(): Promise<
      {
        refunds: RecoveryList;
        transfer: RecoveryRecord;
        fee: RecoveryRecord;
        feeRefunds: RecoveryList;
      }
    >;
    update(id: string, metadata: Record<string, string>): Promise<void>;
    pause(): Promise<void>;
  },
) {
  const id = (value: unknown) =>
    typeof value === "string" ? value : (value as RecoveryRecord | null)?.id;
  let refundId = snapshot.refundId;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { refunds, transfer, fee, feeRefunds } = await dependencies.read();
    const conflict = () => {
      throw new RefundEvidenceConflict(
        refundEvidenceBitmap(
          { ...snapshot, refundId },
          refunds,
          transfer,
          fee,
          feeRefunds,
        ),
      );
    };
    const reversals = transfer.reversals as RecoveryList;
    if (
      !reversals ||
      [refunds, reversals, feeRefunds].some((list) =>
        list.has_more !== false || !Array.isArray(list.data) ||
        list.data.length > 1
      )
    ) conflict();
    if (
      transfer.object !== "transfer" || transfer.id !== snapshot.transferId ||
      transfer.livemode !== false || transfer.amount !== snapshot.totalMinor ||
      !Number.isSafeInteger(transfer.amount_reversed) ||
      (transfer.amount_reversed as number) < snapshot.totalMinor ||
      transfer.currency !== "usd" ||
      id(transfer.source_transaction) !== snapshot.chargeId ||
      id(transfer.destination) !== snapshot.connectedAccountId ||
      fee.object !== "application_fee" ||
      fee.id !== snapshot.applicationFeeId ||
      fee.livemode !== false ||
      fee.amount !== snapshot.applicationFeeAmountMinor ||
      fee.currency !== "usd" ||
      !Number.isSafeInteger(fee.amount_refunded) ||
      (fee.amount_refunded as number) < snapshot.applicationFeeAmountMinor ||
      id(fee.originating_transaction ?? fee.charge) !== snapshot.chargeId ||
      id(fee.account) !== snapshot.connectedAccountId
    ) conflict();
    const refund = refunds.data[0];
    const reversal = reversals.data[0];
    const feeRefund = feeRefunds.data[0];
    const metadata = refund?.metadata as RecoveryRecord | undefined;
    if (
      refund &&
      (refund.object !== "refund" || typeof refund.id !== "string" ||
        !/^re_[A-Za-z0-9]+$/.test(refund.id) ||
        (refundId !== null && refund.id !== refundId) ||
        !refundModeIsTestCompatible(refund) || refund.status !== "succeeded" ||
        refund.amount !== snapshot.totalMinor || refund.currency !== "usd" ||
        id(refund.payment_intent) !== snapshot.paymentIntentId ||
        id(refund.charge) !== snapshot.chargeId ||
        metadata?.order_id !== snapshot.orderId ||
        metadata?.whereto_refund_policy !== "destination_v1" ||
        metadata?.whereto_reverse_transfer !== "true" ||
        metadata?.whereto_refund_application_fee !== "true")
    ) conflict();
    if (refund) refundId = refund.id as string;
    if (
      reversal &&
      (reversal.object !== "transfer_reversal" ||
        typeof reversal.id !== "string" ||
        !/^trr_[A-Za-z0-9]+$/.test(reversal.id) ||
        reversal.amount !== snapshot.totalMinor ||
        reversal.currency !== "usd" ||
        id(reversal.transfer) !== snapshot.transferId ||
        (refundId !== null && id(reversal.source_refund) !== refundId) ||
        (snapshot.reversalId !== null && reversal.id !== snapshot.reversalId) ||
        (refund &&
          id(refund.transfer_reversal ?? refund.source_transfer_reversal) !==
            reversal.id))
    ) conflict();
    if (
      feeRefund &&
      (feeRefund.object !== "fee_refund" || typeof feeRefund.id !== "string" ||
        !/^fr_[A-Za-z0-9]+$/.test(feeRefund.id) ||
        feeRefund.amount !== snapshot.applicationFeeAmountMinor ||
        feeRefund.currency !== "usd" ||
        id(feeRefund.fee) !== snapshot.applicationFeeId ||
        (snapshot.feeRefundId !== null &&
          feeRefund.id !== snapshot.feeRefundId))
    ) conflict();
    if (refund && reversal && feeRefund) {
      // Existing nonempty metadata must agree; absence alone is recoverable.
      const enriched = {
        order_id: snapshot.orderId,
        whereto_refund_policy: "destination_v1",
        whereto_reverse_transfer: "true",
        whereto_refund_application_fee: "true",
        whereto_transfer_reversal_amount: String(reversal.amount),
        whereto_application_fee_refund_id: feeRefund.id as string,
        whereto_application_fee_refund_amount: String(feeRefund.amount),
      };
      for (const [key, value] of Object.entries(enriched)) {
        if (metadata?.[key] !== undefined && metadata[key] !== value) {
          conflict();
        }
      }
      await dependencies.update(refund.id as string, enriched);
      return {
        ok: true,
        livemode: false,
        amount: snapshot.totalMinor,
        reversal_amount: snapshot.totalMinor,
        application_fee_refund_amount: snapshot.applicationFeeAmountMinor,
      };
    }
    if (attempt < 4) await dependencies.pause();
  }
  throw new Error("TASK14_REFUND_EVIDENCE_RETRYABLE");
}
