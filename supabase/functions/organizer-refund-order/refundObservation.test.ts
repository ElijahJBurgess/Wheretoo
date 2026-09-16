// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import { observeRefund } from "./refundObservation.ts";
const snapshot = {
  orderId: "order",
  paymentIntentId: "pi_Test",
  chargeId: "ch_Test",
  transferId: "tr_Test",
  applicationFeeId: "fee_Test",
  connectedAccountId: "acct_Test",
  totalMinor: 7000,
  applicationFeeAmountMinor: 700,
  refundId: null,
  reversalId: null,
  feeRefundId: null,
};
const charge = {
  object: "charge",
  id: "ch_Test",
  livemode: false,
  amount: 7000,
  currency: "usd",
  payment_intent: "pi_Test",
};
const refund = {
  object: "refund",
  id: "re_Test",
  amount: 7000,
  currency: "usd",
  payment_intent: "pi_Test",
  charge: "ch_Test",
  status: "pending",
  metadata: {
    order_id: "order",
    whereto_refund_policy: "destination_v1",
    whereto_reverse_transfer: "true",
    whereto_refund_application_fee: "true",
  },
};
function deps(rows: unknown[] = [refund]) {
  let recovered = 0;
  return {
    read: async () => ({ charge, refunds: { data: rows, has_more: false } }),
    recover: async () => {
      recovered++;
    },
    count: () => recovered,
  };
}
Deno.test("pending, action, failed and cancelled are observations only", async () => {
  for (
    const [status, state] of [
      ["pending", "processing"],
      ["requires_action", "review"],
      ["failed", "failed"],
      ["canceled", "failed"],
    ]
  ) {
    const d = deps([{ ...refund, status }]);
    assertEquals(await observeRefund(snapshot, d), {
      state,
      refundId: "re_Test",
    });
    assertEquals(d.count(), 0);
  }
});
Deno.test("successful exact refund requests existing evidence repair, never claims canonical completion", async () => {
  const d = deps([{ ...refund, status: "succeeded" }]);
  assertEquals(await observeRefund(snapshot, d), {
    state: "processing",
    refundId: "re_Test",
  });
  assertEquals(d.count(), 1);
});
Deno.test("missing, multiple, partial, wrong policy and wrong identity never authorize another refund", async () => {
  assertEquals(await observeRefund(snapshot, deps([])), { state: "unknown" });
  for (
    const rows of [[refund, refund], [{ ...refund, amount: 1 }], [{
      ...refund,
      metadata: {},
    }], [{ ...refund, charge: "ch_Other" }]]
  ) {
    const d = deps(rows);
    assertEquals(await observeRefund(snapshot, d), { state: "review" });
    assertEquals(d.count(), 0);
  }
});
Deno.test("test mode must be proven by bound charge and saved refund binding cannot change", async () => {
  const d = deps();
  d.read = async () => ({
    charge: { ...charge, livemode: true },
    refunds: { data: [refund], has_more: false },
  });
  assertEquals(await observeRefund(snapshot, d), { state: "review" });
  assertEquals(
    await observeRefund({ ...snapshot, refundId: "re_Other" }, deps()),
    { state: "review" },
  );
});
Deno.test("transport uncertainty stays unknown without leaking provider errors", async () => {
  const d = deps();
  d.read = async () => {
    throw Error("secret");
  };
  assertEquals(await observeRefund(snapshot, d), { state: "unknown" });
});
