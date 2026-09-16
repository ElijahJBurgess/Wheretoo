// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import { executeOwnedRefund } from "./refundOperation.ts";
const input = {
  organizerId: "owner",
  eventId: "event",
  orderId: "order",
  action: "submit" as const,
};
function setup(state = "eligible") {
  const events: string[] = [];
  let durable = state;
  const deps = {
    read: async () => ({
      state: durable,
      hasOperation: durable !== "eligible",
      canRecover: true,
      snapshot: { orderId: "order" },
    }),
    claim: async () => {
      events.push("claim");
      durable = "submitting";
      return { dispatch: true, state: durable };
    },
    refund: async () => {
      events.push("create");
    },
    observe: async () => {
      events.push("observe");
      return { state: "processing", refundId: "re_test" };
    },
    note: async (s: string) => {
      events.push("note:" + s);
      durable = s;
    },
  };
  return { deps, events };
}
Deno.test("a durable claim precedes sole refund writer and acknowledgement cannot complete", async () => {
  const { deps, events } = setup();
  assertEquals(await executeOwnedRefund(input, deps), "processing");
  assertEquals(events, ["claim", "create", "note:processing"]);
});
Deno.test("duplicate and already complete requests never invoke financial writer", async () => {
  for (
    const state of [
      "submitting",
      "processing",
      "unknown",
      "review",
      "failed",
      "completed",
    ]
  ) {
    const { deps, events } = setup(state);
    const result = await executeOwnedRefund(input, deps);
    assertEquals(events, []);
    assertEquals(
      result,
      state === "completed"
        ? "already_refunded"
        : state === "submitting"
        ? "processing"
        : state,
    );
  }
});
Deno.test("losing simultaneous claim never dispatches", async () => {
  const { deps, events } = setup();
  deps.claim = async () => ({ dispatch: false, state: "submitting" });
  assertEquals(await executeOwnedRefund(input, deps), "processing");
  assertEquals(events, []);
});
Deno.test("provider timeout persists unknown and recovery observes existing request only", async () => {
  const { deps, events } = setup();
  deps.refund = async () => {
    events.push("create");
    throw Error("private provider data");
  };
  assertEquals(await executeOwnedRefund(input, deps), "unknown");
  assertEquals(events, ["claim", "create", "note:unknown"]);
  assertEquals(
    await executeOwnedRefund({ ...input, action: "reconcile" }, deps),
    "processing",
  );
  assertEquals(events.filter((x) => x === "create").length, 1);
  assertEquals(events.at(-2), "observe");
});
Deno.test("unrelated review and a never-submitted order cannot perform provider recovery", async () => {
  for (const state of ["eligible", "review", "ineligible"]) {
    const { deps, events } = setup(state);
    deps.read = async () => ({
      state,
      hasOperation: false,
      canRecover: false,
      snapshot: { orderId: "order" },
    });
    assertEquals(
      await executeOwnedRefund({ ...input, action: "reconcile" }, deps),
      state === "eligible" ? "ineligible" : state,
    );
    assertEquals(events, []);
  }
});
Deno.test("lost bookkeeping response never invites create retry", async () => {
  const { deps, events } = setup();
  deps.note = async () => {
    throw Error("db timeout");
  };
  assertEquals(await executeOwnedRefund(input, deps), "unknown");
  assertEquals(events.filter((x) => x === "create").length, 1);
});
Deno.test("canonical completion wins after earlier transport uncertainty", async () => {
  const { deps } = setup();
  let reads = 0;
  deps.read = async () => ({
    state: reads++ === 0 ? "eligible" : "completed",
    hasOperation: true,
    canRecover: false,
    snapshot: { orderId: "order" },
  });
  deps.refund = async () => {
    throw Error("timeout");
  };
  assertEquals(await executeOwnedRefund(input, deps), "completed");
});
