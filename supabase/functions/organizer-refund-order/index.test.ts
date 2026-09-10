// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import { HttpError } from "../_shared/http.ts";
import {
  createOrganizerRefundHandler,
  type OrganizerRefundDependencies,
} from "./index.ts";
const eventId = "a6200000-0000-4000-8000-000000000001",
  orderId = "a6400000-0000-4000-8000-000000000001";
const owner = "a6100000-0000-4000-8000-000000000001";
function request(body: unknown = { eventId, orderId }) {
  return new Request("https://functions.invalid/organizer-refund-order", {
    method: "POST",
    headers: {
      origin: "https://app.invalid",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
function setup(overrides: Partial<OrganizerRefundDependencies> = {}) {
  const calls: unknown[] = [];
  const handler = createOrganizerRefundHandler({
    appOrigin: "https://app.invalid",
    verifyOrganizer: async () => ({ userId: owner, organizerId: owner }),
    context: async (...args) => {
      calls.push(args);
      return { refundState: "available" };
    },
    refund: async (id) => {
      calls.push(id);
    },
    recover: async () => {},
    ...overrides,
  });
  return { handler, calls };
}
Deno.test("ownership failure cannot reach refund engine and errors are sanitized", async () => {
  const { handler, calls } = setup({
    context: async () => {
      throw new Error("private");
    },
  });
  const response = await handler(request());
  assertEquals(response.status, 503);
  assertEquals(calls, []);
  assertEquals(await response.json(), { outcome: "unconfirmed" });
});
Deno.test("verified owner plus event and order bound before the existing engine", async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  assertEquals(calls, [[owner, eventId, orderId], orderId]);
  assertEquals(await response.json(), { outcome: "pending" });
  assertEquals(response.headers.get("cache-control"), "private, no-store");
});
Deno.test("canonical pending/refunded retries never request another provider refund", async () => {
  for (const refundState of ["pending", "refunded"]) {
    const { handler, calls } = setup({
      context: async () => ({ refundState }),
    });
    const response = await handler(request());
    assertEquals(calls, []);
    assertEquals(await response.json(), { outcome: refundState });
  }
});
Deno.test("client financial inputs, huge bodies, and missing auth cannot invoke refund", async () => {
  for (
    const body of [
      { eventId, orderId, amount: 1 },
      { eventId, orderId, ticketId: orderId },
      { eventId, orderId: "x".repeat(500) },
      {},
    ]
  ) {
    const { handler, calls } = setup();
    assertEquals((await handler(request(body))).status, 400);
    assertEquals(calls, []);
  }
  const { handler, calls } = setup({
    verifyOrganizer: async () => {
      throw new HttpError(401, "AUTH_REQUIRED");
    },
  });
  assertEquals((await handler(request())).status, 401);
  assertEquals(calls, []);
});
Deno.test("timeout and canonical ineligible remain unconfirmed without claiming refund", async () => {
  const { handler } = setup({
    refund: async () => {
      throw new Error("stripe secret");
    },
  });
  assertEquals(await (await handler(request())).json(), {
    outcome: "unconfirmed",
  });
  const refused = setup({
    context: async () => ({ refundState: "unavailable" }),
  });
  assertEquals((await refused.handler(request())).status, 409);
  assertEquals(refused.calls, []);
});
Deno.test("owned evidence recovery never calls create and remains pending", async () => {
  const recovery = {
    orderId,
    paymentIntentId: "pi_Test",
    chargeId: "ch_Test",
    transferId: "tr_Test",
    applicationFeeId: "fee_Test",
    connectedAccountId: "acct_Test",
    totalMinor: 3001,
    applicationFeeAmountMinor: 300,
    refundId: "re_Test",
    reversalId: null,
    feeRefundId: null,
  };
  let recovered: unknown;
  const { handler, calls } = setup({
    context: async () => ({ refundState: "recoverable", recovery }),
    recover: async (snapshot) => {
      recovered = snapshot;
    },
  });
  const response = await handler(request());
  assertEquals(await response.json(), { outcome: "pending" });
  assertEquals(recovered, recovery);
  assertEquals(calls, []);
});
