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
  let state = "eligible";
  const handler = createOrganizerRefundHandler({
    appOrigin: "https://app.invalid",
    verifyOrganizer: async () => ({ userId: owner, organizerId: owner }),
    read: async (...args) => {
      calls.push(args);
      return { state, hasOperation: false, canRecover: false, snapshot: null };
    },
    claim: async () => ({ dispatch: true, state: "submitting" }),
    refund: async (id) => {
      calls.push(id);
    },
    observe: async () => ({ state: "processing" }),
    note: async (_owner, _event, _order, next) => {
      state = next;
    },
    ...overrides,
  });
  return { handler, calls };
}
Deno.test("ownership failure cannot reach refund engine and errors are sanitized", async () => {
  const { handler, calls } = setup({
    read: async () => {
      throw new Error("private");
    },
  });
  const response = await handler(request());
  assertEquals(response.status, 503);
  assertEquals(calls, []);
  assertEquals(await response.json(), { outcome: "unknown" });
});
Deno.test("verified owner plus event and order bound before the existing engine", async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  assertEquals(calls, [[owner, eventId, orderId], orderId, [
    owner,
    eventId,
    orderId,
  ]]);
  assertEquals(await response.json(), { outcome: "processing" });
  assertEquals(response.headers.get("cache-control"), "private, no-store");
});
Deno.test("canonical pending/refunded retries never request another provider refund", async () => {
  for (const refundState of ["processing", "completed"]) {
    const { handler, calls } = setup({
      read: async () => ({
        state: refundState,
        hasOperation: true,
        canRecover: false,
        snapshot: null,
      }),
    });
    const response = await handler(request());
    assertEquals(calls, []);
    assertEquals(await response.json(), {
      outcome: refundState === "completed" ? "already_refunded" : refundState,
    });
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
    outcome: "unknown",
  });
  const refused = setup({
    read: async () => ({
      state: "ineligible",
      hasOperation: false,
      canRecover: false,
      snapshot: null,
    }),
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
    read: async () => ({
      state: "review",
      hasOperation: false,
      canRecover: true,
      snapshot: recovery,
    }),
    observe: async (snapshot) => {
      recovered = snapshot;
      return { state: "processing" };
    },
  });
  const response = await handler(
    request({ eventId, orderId, action: "reconcile" }),
  );
  assertEquals(await response.json(), { outcome: "review" });
  assertEquals(recovered, recovery);
  assertEquals(calls, []);
});
