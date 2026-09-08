// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import {
  createWholeOrderRefund,
  type RefundOrderDependencies,
} from "./refundOrder.ts";

const ORDER_ID = "11111111-2222-4333-8444-555555555555";

function dependencies(
  calls: Array<Record<string, unknown>>,
): RefundOrderDependencies {
  return {
    prepareWholeOrderRefund: async (orderId, reason) => {
      calls.push({ operation: "prepare", orderId, reason });
      return {
        orderId: ORDER_ID,
        paymentIntentId: "pi_Task8Payment",
        chargeId: "ch_Task8Charge",
        transferId: "tr_Task8Transfer",
        applicationFeeId: "fee_Task8ApplicationFee",
        currency: "usd",
        totalMinor: 5_500,
        applicationFeeAmountMinor: 450,
        reason: "requested_by_customer",
      };
    },
    createRefund: async (params, options) => {
      calls.push({ operation: "create", params, options });
      return {
        id: "re_Task8WholeOrder",
        object: "refund",
        livemode: false,
        amount: 5_500,
        currency: "usd",
        charge: "ch_Task8Charge",
        payment_intent: "pi_Task8Payment",
        transfer_reversal: "trr_Task8WholeOrder",
        status: "succeeded",
        metadata: {
          order_id: ORDER_ID,
          whereto_refund_policy: "destination_v1",
          whereto_reverse_transfer: "true",
          whereto_refund_application_fee: "true",
        },
      };
    },
    retrieveRefundEvidence: async (refundId, snapshot) => {
      calls.push({ operation: "evidence", refundId, snapshot });
      return {
        transferReversalId: "trr_Task8WholeOrder",
        transferReversalAmountMinor: 5_500,
        applicationFeeRefundId: "fr_Task8WholeOrder",
        applicationFeeRefundAmountMinor: 450,
      };
    },
    updateRefundMetadata: async (refundId, metadata) => {
      calls.push({ operation: "metadata", refundId, metadata });
    },
  };
}

// Mutations caught: caller-controlled amounts, partial flags, non-canonical
// metadata, or an unstable retry key would change the literal boundary call.
Deno.test("whole-order refund derives the persisted total and fixed economic policy from an order ID", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await createWholeOrderRefund(
    ORDER_ID,
    "requested_by_customer",
    dependencies(calls),
  );

  assertEquals(calls[1], {
    operation: "create",
    params: {
      payment_intent: "pi_Task8Payment",
      amount: 5_500,
      reverse_transfer: true,
      refund_application_fee: true,
      reason: "requested_by_customer",
      metadata: {
        order_id: ORDER_ID,
        whereto_refund_policy: "destination_v1",
        whereto_reverse_transfer: "true",
        whereto_refund_application_fee: "true",
      },
    },
    options: {
      idempotencyKey: `whereto-refund-integrity-v1:${ORDER_ID}`,
    },
  });
  assertEquals(calls[3], {
    operation: "metadata",
    refundId: "re_Task8WholeOrder",
    metadata: {
      order_id: ORDER_ID,
      whereto_refund_policy: "destination_v1",
      whereto_reverse_transfer: "true",
      whereto_refund_application_fee: "true",
      whereto_transfer_reversal_amount: "5500",
      whereto_application_fee_refund_id: "fr_Task8WholeOrder",
      whereto_application_fee_refund_amount: "450",
    },
  });
  assertEquals(result, {
    orderId: ORDER_ID,
    stripeRefundId: "re_Task8WholeOrder",
    status: "succeeded",
  });
});

Deno.test("whole-order refund retry uses the same provider operation and never accepts tier, ticket, or amount input", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const deps = dependencies(calls);
  const first = await createWholeOrderRefund(
    ORDER_ID,
    "requested_by_customer",
    deps,
  );
  const second = await createWholeOrderRefund(
    ORDER_ID,
    "requested_by_customer",
    deps,
  );

  assertEquals(first, second);
  assertEquals(
    calls.filter((call) => call.operation === "create").map((call) =>
      call.options
    ),
    [
      { idempotencyKey: `whereto-refund-integrity-v1:${ORDER_ID}` },
      { idempotencyKey: `whereto-refund-integrity-v1:${ORDER_ID}` },
    ],
  );
  assertEquals(createWholeOrderRefund.length, 3);
});
