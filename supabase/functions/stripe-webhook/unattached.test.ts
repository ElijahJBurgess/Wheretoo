// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import {
  createDefaultStripeWebhookDependencies,
  createStripeWebhookHandler,
} from "./index.ts";
import {
  ACCOUNT_ID,
  checkoutSessionFixture,
  EVENT_ID,
  ORDER_ID,
  ORDER_ITEMS,
  SESSION_ID,
  snapshotEvent,
  TICKET_MANIFEST,
} from "./webhookFixtures.ts";

const EXPIRY = 1_788_002_340;
const DIGEST = "a".repeat(64);
const EVENT = "evt_UnattachedForward";
function candidate() {
  return {
    order_id: ORDER_ID,
    checkout_session_id: SESSION_ID,
    event_id: EVENT_ID,
    currency: "usd",
    subtotal_minor: 5500,
    total_minor: 5500,
    application_fee_amount_minor: 450,
    destination_account_id: ACCOUNT_ID,
    checkout_request_id: "aaaaaaaa-1111-4111-8111-111111111111",
    checkout_expires_at: new Date(EXPIRY * 1000).toISOString(),
    create_digest: "b".repeat(64),
    snapshot_digest: DIGEST,
    order_items: ORDER_ITEMS.map((i) => ({
      order_item_id: i.orderItemId,
      ticket_tier_id: i.tierId,
      tier_name: i.tierName,
      currency: i.currency,
      unit_amount_minor: i.unitAmountMinor,
      quantity: i.quantity,
      subtotal_minor: i.subtotalMinor,
    })),
  };
}
async function run(
  options: {
    session?: Record<string, unknown>;
    rows?: unknown;
    disposition?: string;
    writerError?: boolean;
    resultRow?: Record<string, unknown>;
    duplicate?: boolean;
    envelope?: Record<string, unknown>;
  } = {},
) {
  const names = [
    "STRIPE_RESTRICTED_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const old = names.map((n) => Deno.env.get(n));
  Deno.env.set(names[0], ["rk", "test", "unattachedfixture"].join("_"));
  Deno.env.set(names[1], "https://unattached.example.invalid");
  Deno.env.set(names[2], "unattached-test-service-role");
  const fetch = globalThis.fetch;
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const finalized: unknown[] = [];
  let retrieved = 0;
  globalThis.fetch = async (input, init) => {
    const name = String(input).split("/").at(-1)!;
    const body = JSON.parse(String(init?.body));
    calls.push({ name, body });
    let result: unknown;
    if (name === "server_get_checkout_integrity_order_snapshot") result = [];
    else if (name === "server_get_unattached_checkout_review_snapshot") {
      result = options.rows ?? [candidate()];
    } else if (name === "server_reconcile_unattached_paid_checkout") {
      if (options.writerError) {
        return new Response(
          JSON.stringify({ message: "ORDER_CHANGED_RETRY" }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      result = [
        options.resultRow ?? {
          order_id: ORDER_ID,
          order_status: options.disposition === "review" ? "expired" : "paid",
          ticket_count: options.disposition === "review" ? 0 : 3,
          disposition: options.disposition ?? "fulfilled",
        },
      ];
    } else throw new Error("unexpected RPC " + name);
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const deps = createDefaultStripeWebhookDependencies();
    const response = await createStripeWebhookHandler({
      ...deps,
      verifyEvent: async (raw) => JSON.parse(raw),
      recordReceipt: async () => ({ shouldProcess: !options.duplicate }),
      finalizeReceipt: async (...args) => {
        finalized.push(args);
      },
      getTicketCredentialSecret: () => new Uint8Array(32).fill(7),
      retrieveSession: async () => {
        retrieved++;
        return options.session ??
          checkoutSessionFixture({ expires_at: EXPIRY });
      },
      operationalSink: () => undefined,
    })(
      new Request("https://functions.example/stripe-webhook", {
        method: "POST",
        headers: {
          "stripe-signature": "fixture",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          options.envelope ??
            snapshotEvent("checkout.session.completed", { id: SESSION_ID }, {
              id: EVENT,
            }),
        ),
      }),
    );
    return { status: response.status, calls, finalized, retrieved };
  } finally {
    globalThis.fetch = fetch;
    names.forEach((n, i) =>
      old[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, old[i]!)
    );
  }
}
Deno.test("unattached forward: actual RPC adapter binds original snapshot and atomically fulfills its three units", async () => {
  const r = await run();
  assertEquals(r.status, 200);
  assertEquals(r.calls.map((c) => c.name), [
    "server_get_checkout_integrity_order_snapshot",
    "server_get_unattached_checkout_review_snapshot",
    "server_reconcile_unattached_paid_checkout",
  ]);
  assertEquals(r.calls[1].body, {
    p_order_id: ORDER_ID,
    p_session_id: SESSION_ID,
    p_stripe_event_id: EVENT,
  });
  assertEquals(r.calls[2].body.p_expected_snapshot_digest, DIGEST);
  assertEquals(r.calls[2].body.p_ticket_manifest, TICKET_MANIFEST);
  assertEquals(r.finalized, []);
});
Deno.test("unattached forward: terminal quarantine is acknowledged without claiming ticket fulfillment", async () => {
  const r = await run({ disposition: "review" });
  assertEquals(r.status, 200);
  assertEquals(
    r.calls.at(-1)?.name,
    "server_reconcile_unattached_paid_checkout",
  );
  assertEquals(r.finalized, []);
});
Deno.test("unattached forward: writer conflict retries without any alternate domain writer", async () => {
  const r = await run({ writerError: true });
  assertEquals(r.status, 503);
  assertEquals(r.finalized, [[
    EVENT,
    "failed",
    "TRANSIENT_PROCESSING_FAILURE",
  ]]);
  assertEquals(
    r.calls.at(-1)?.name,
    "server_reconcile_unattached_paid_checkout",
  );
});
Deno.test("unattached forward: paid evidence validation rejects expiry, identity, cart and charge mismatches before atomic writer", async () => {
  const normal = checkoutSessionFixture({ expires_at: EXPIRY });
  for (
    const patch of [
      { expires_at: EXPIRY + 1 },
      { client_reference_id: EVENT_ID },
      { livemode: true },
      { mode: "subscription" },
      { status: "open" },
      { amount_total: 5501 },
      {
        metadata: {
          contract_version: "checkout_integrity_v1",
          event_id: ORDER_ID,
          order_id: ORDER_ID,
        },
      },
      {
        payment_intent: {
          ...(normal.payment_intent as object),
          application_fee_amount: 451,
        },
      },
      { line_items: { ...(normal.line_items as object), has_more: true } },
    ]
  ) {
    const r = await run({ session: { ...normal, ...patch } });
    assertEquals(
      r.calls.some((c) =>
        c.name === "server_reconcile_unattached_paid_checkout"
      ),
      false,
    );
    assertEquals(r.calls.some((c) => c.name.startsWith("server_mark_")), false);
    assertEquals(r.finalized.length, 1);
  }
});
Deno.test("unattached forward: absent/malformed immutable request binding never writes", async () => {
  for (
    const rows of [[], [{ ...candidate(), checkout_request_id: null }], [{
      ...candidate(),
      create_digest: null,
    }], [{ ...candidate(), snapshot_digest: "wrong" }]]
  ) {
    const r = await run({ rows });
    assertEquals(
      r.calls.some((c) =>
        c.name === "server_reconcile_unattached_paid_checkout"
      ),
      false,
    );
  }
});
Deno.test("unattached forward: unpaid events and immutable processed receipt never enter recovery", async () => {
  const unpaid = await run({
    session: checkoutSessionFixture({
      payment_status: "unpaid",
      expires_at: EXPIRY,
    }),
  });
  assertEquals(unpaid.calls.map((c) => c.name), [
    "server_get_checkout_integrity_order_snapshot",
  ]);
  const duplicate = await run({ duplicate: true });
  assertEquals(
    [duplicate.status, duplicate.retrieved, duplicate.calls.length],
    [200, 0, 0],
  );
});

Deno.test("unattached forward: signed connected-account context cannot acquire platform recovery authority", async () => {
  for (
    const context of [{ account: ACCOUNT_ID }, { context: ACCOUNT_ID }, {
      livemode: true,
    }]
  ) {
    const r = await run({
      envelope: snapshotEvent(
        "checkout.session.completed",
        { id: SESSION_ID },
        { id: EVENT, ...context },
      ),
    });
    assertEquals(
      r.calls.some((c) =>
        c.name === "server_reconcile_unattached_paid_checkout"
      ),
      false,
    );
  }
});

Deno.test("unattached forward: contradictory review result never becomes successful proof", async () => {
  for (
    const row of [
      {
        order_id: ORDER_ID,
        order_status: "paid",
        ticket_count: 3,
        disposition: "review",
      },
      {
        order_id: ORDER_ID,
        order_status: "expired",
        ticket_count: 3,
        disposition: "review",
      },
    ]
  ) {
    const r = await run({ resultRow: row });
    assertEquals(r.status, 503);
    assertEquals(r.finalized, [[
      EVENT,
      "failed",
      "TRANSIENT_PROCESSING_FAILURE",
    ]]);
  }
});

Deno.test("unattached forward: replay must preserve a complete paid or refunded original source set", async () => {
  for (
    const [order_status, ticket_count] of [
      ["expired", 0],
      ["paid", 0],
      ["refunded", 0],
      ["paid", 2],
      ["requires_review", 3],
    ] as const
  ) {
    const r = await run({
      resultRow: {
        order_id: ORDER_ID,
        order_status,
        ticket_count,
        disposition: "replay",
      },
    });
    assertEquals(r.status, 503);
  }
  for (const order_status of ["paid", "partially_refunded", "refunded"]) {
    const r = await run({
      resultRow: {
        order_id: ORDER_ID,
        order_status,
        ticket_count: 3,
        disposition: "replay",
      },
    });
    assertEquals(r.status, 200);
    assertEquals(r.finalized, []);
  }
});
Deno.test("unattached forward: canonical attached review is explicit and preserves full ticket history", async () => {
  for (const ticket_count of [0, 3]) {
    const r = await run({
      resultRow: {
        order_id: ORDER_ID,
        order_status: "requires_review",
        ticket_count,
        disposition: "review",
      },
    });
    assertEquals(r.status, 200);
    assertEquals(r.finalized, []);
  }
  const r = await run({
    resultRow: {
      order_id: ORDER_ID,
      order_status: "requires_review",
      ticket_count: 2,
      disposition: "review",
    },
  });
  assertEquals(r.status, 503);
});
