import { assertEquals, assertThrows } from "@std/assert";
import { adaptTestRefund } from "./providerContract.ts";
const snapshot = {
  orderId: "order",
  paymentIntentId: "pi_Test",
  chargeId: "ch_Test",
  transferId: "tr_Test",
  applicationFeeId: "fee_Test",
  currency: "usd" as const,
  totalMinor: 3001,
  applicationFeeAmountMinor: 300,
  reason: "requested_by_customer",
};
const charge = {
  object: "charge",
  id: "ch_Test",
  payment_intent: "pi_Test",
  livemode: false,
  amount: 3001,
  currency: "usd",
};
const refund = {
  object: "refund",
  id: "re_Test",
  payment_intent: "pi_Test",
  charge: "ch_Test",
  amount: 3001,
  currency: "usd",
};
Deno.test("actual Refund without livemode is adapted only with a matching TEST charge", () => {
  assertEquals(adaptTestRefund(refund, charge, snapshot).livemode, false);
});
Deno.test("live, unproven mode, wrong payment and wrong amount fail closed", () => {
  for (
    const bad of [
      { ...charge, livemode: true },
      { ...charge, livemode: undefined },
      { ...charge, payment_intent: "pi_Other" },
      { ...charge, amount: 1 },
    ]
  ) assertThrows(() => adaptTestRefund(refund, bad, snapshot));
  assertThrows(() =>
    adaptTestRefund({ ...refund, livemode: true }, charge, snapshot)
  );
});
