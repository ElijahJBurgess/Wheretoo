import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  createProviderBoundary,
  createStripeSignature,
  type ProviderControl,
} from "./providers.ts";
import {
  emptyProviderState,
  FileProviderStore,
  MemoryProviderStore,
} from "./state.ts";

const config = {
  gatewayOrigin: "http://127.0.0.1:55647",
  restOrigin: "http://127.0.0.1:55646",
  authOrigin: "http://127.0.0.1:55648",
  stripeWebhookSecret: "whsec_spec14synthetic",
  resendEndpoint: "https://api.resend.com/emails",
  moderationEndpoint: "https://moderation.spec14.invalid/evaluate",
};

Deno.test("persistent provider state is atomically replaced with private permissions", async () => {
  const directory = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "spec14-provider-state-",
  });
  const path = `${directory}/provider-state.json`;
  try {
    await Deno.writeTextFile(path, JSON.stringify(emptyProviderState()), {
      mode: 0o644,
    });
    const store = new FileProviderStore(path);
    await store.update((state) => {
      state.email.messages.push({
        attemptKey: "attempt-private",
        providerId: "remsg_spec1400000001",
        mode: "accepted",
        payload: { privateAccessUrl: "http://127.0.0.1/ticket-access#private" },
        createdAt: "2026-09-14T00:00:00.000Z",
      });
    });

    assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
    assertEquals((await store.read()).email.messages.length, 1);
    const entries = [...Deno.readDirSync(directory)].map((entry) => entry.name);
    assertEquals(entries, ["provider-state.json"]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

Deno.test("outbound boundary denies unknown hosts and only forwards fixed loopback targets", async () => {
  const forwarded: string[] = [];
  const { fetch } = createProviderBoundary(
    config,
    new MemoryProviderStore(),
    (input) => {
      forwarded.push(String(input));
      return Promise.resolve(Response.json({ ok: true }));
    },
  );

  await assertRejects(
    () => fetch("https://example.com/leak"),
    Error,
    "Outbound request denied",
  );
  assertEquals(forwarded, []);
  assertEquals(
    (await json(await fetch("http://127.0.0.1:55646/rpc/read"))).ok,
    true,
  );
  assertEquals(
    (await json(await fetch("http://127.0.0.1:55648/user"))).ok,
    true,
  );
  assertEquals(forwarded, [
    "http://127.0.0.1:55646/rpc/read",
    "http://127.0.0.1:55648/user",
  ]);
});

Deno.test("Stripe simulation keeps idempotent account and checkout identities and canonical payment objects", async () => {
  const store = new MemoryProviderStore();
  const boundary = createProviderBoundary(
    config,
    store,
    () => Promise.reject(new Error("unexpected native fetch")),
  );
  const headers = {
    authorization: "Bearer rk_test_spec14",
    "idempotency-key": "organizer-1",
  };
  const accountA = await json(
    await boundary.fetch("https://api.stripe.com/v2/core/accounts", {
      method: "POST",
      headers,
      body: "contact_email=owner%40example.invalid",
    }),
  );
  const accountB = await json(
    await boundary.fetch("https://api.stripe.com/v2/core/accounts", {
      method: "POST",
      headers,
      body: "contact_email=other%40example.invalid",
    }),
  );
  assertEquals(accountA.id, accountB.id);
  assertEquals(accountA.livemode, false);

  const checkoutRequest = () =>
    boundary.fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer rk_test_spec14",
        "idempotency-key": "checkout-1",
        "content-type": "application/x-www-form-urlencoded",
      },
      body:
        "client_reference_id=00000000-0000-4000-8000-000000000001&customer_email=buyer%40example.invalid&expires_at=1893456000&success_url=http%3A%2F%2F127.0.0.1%3A3033%2Fconfirmation&cancel_url=http%3A%2F%2F127.0.0.1%3A3033%2Fcancel&currency=usd&line_items[0][price_data][product_data][name]=General%20Admission&line_items[0][price_data][unit_amount]=2500&line_items[0][quantity]=2&payment_intent_data[application_fee_amount]=500&payment_intent_data[transfer_data][destination]=" +
        accountA.id,
    });
  const checkout = await json(await checkoutRequest());
  assert(/^cs_test_[A-Za-z0-9]+$/.test(String(checkout.id)));
  assertEquals(new URL(String(checkout.url)).hostname, "checkout.stripe.com");
  const lineItem = (checkout.line_items as {
    data: Array<Record<string, unknown>>;
  }).data[0];
  assertEquals(lineItem.description, "General Admission");
  assertEquals(lineItem.amount_tax, 0);
  assertEquals(lineItem.amount_discount, 0);
  const checkoutAgain = await json(await checkoutRequest());
  assertEquals(checkoutAgain.id, checkout.id);
  assertEquals(
    Object.keys((await store.read()).stripe.checkoutSessions).length,
    1,
  );

  const completed = await boundary.control.completeCheckout(
    String(checkout.id),
  );
  const completedAgain = await boundary.control.completeCheckout(
    String(checkout.id),
  );
  assertEquals(completedAgain.event.id, completed.event.id);
  assertEquals(completedAgain.paymentIntentId, completed.paymentIntentId);
  assertEquals(completedAgain.chargeId, completed.chargeId);
  assert(/^evt_[A-Za-z0-9]+$/.test(String(completed.event.id)));
  const paymentIntent = await json(
    await boundary.fetch(
      `https://api.stripe.com/v1/payment_intents/${completed.paymentIntentId}`,
      { headers },
    ),
  );
  const charge = await json(
    await boundary.fetch(
      `https://api.stripe.com/v1/charges/${completed.chargeId}`,
      { headers },
    ),
  );
  const fee = await json(
    await boundary.fetch(
      `https://api.stripe.com/v1/application_fees/${completed.applicationFeeId}`,
      { headers },
    ),
  );
  const transfer = await json(
    await boundary.fetch(
      `https://api.stripe.com/v1/transfers/${completed.transferId}`,
      { headers },
    ),
  );
  assertEquals(
    (paymentIntent.latest_charge as Record<string, unknown>).id,
    charge.id,
  );
  assertEquals(paymentIntent.amount_capturable, 0);
  assertEquals(charge.application_fee, fee.id);
  assertEquals(charge.transfer, transfer.id);
  assertEquals(charge.captured, true);
  assertEquals(charge.refunded, false);
  assertEquals(charge.disputed, false);
  assertEquals(transfer.source_transaction, charge.id);
  assertEquals(fee.originating_transaction, charge.id);

  const refund = await json(
    await boundary.fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "refund-1" },
      body:
        `payment_intent=${completed.paymentIntentId}&amount=5000&reverse_transfer=true&refund_application_fee=true`,
    }),
  );
  assert(/^re_[A-Za-z0-9]+$/.test(String(refund.id)));
  const refundedTransfer = await json(
    await boundary.fetch(
      `https://api.stripe.com/v1/transfers/${completed.transferId}`,
      { headers },
    ),
  );
  const refundedFee = await json(
    await boundary.fetch(
      `https://api.stripe.com/v1/application_fees/${completed.applicationFeeId}`,
      { headers },
    ),
  );
  assertEquals(
    (refundedTransfer.reversals as { data: Array<{ amount: number }> }).data[0]
      .amount,
    5000,
  );
  assertEquals(refundedTransfer.amount_reversed, 5000);
  assertEquals(
    (refundedFee.refunds as { data: Array<{ amount: number }> }).data[0].amount,
    500,
  );
  assertEquals(refundedFee.amount_refunded, 500);
});

Deno.test("checkout create ambiguity commits one provider session and retry preserves its identity", async () => {
  const store = new MemoryProviderStore();
  const boundary = createProviderBoundary(
    config,
    store,
    () => Promise.reject(new Error("unexpected native fetch")),
  );
  const request = () =>
    boundary.fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer rk_test_spec14",
        "idempotency-key": "checkout-ambiguous",
      },
      body:
        "currency=usd&success_url=http%3A%2F%2F127.0.0.1%2Fsuccess&cancel_url=http%3A%2F%2F127.0.0.1%2Fcancel",
    });
  await boundary.control.setCheckoutCreateMode("commit_then_unknown");
  await assertRejects(
    request,
    Error,
    "Simulated unknown checkout create outcome",
  );
  const committed = Object.keys((await store.read()).stripe.checkoutSessions);
  assertEquals(committed.length, 1);
  await boundary.control.setCheckoutCreateMode("normal");
  assertEquals((await json(await request())).id, committed[0]);
});

Deno.test("refund modes preserve one provider identity through unknown processing failure anomaly and recovery", async () => {
  const store = new MemoryProviderStore();
  const boundary = createProviderBoundary(
    config,
    store,
    () => Promise.reject(new Error("unexpected native fetch")),
  );
  const checkout = await json(
    await boundary.fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer rk_test_spec14",
        "idempotency-key": "refund-mode-checkout",
      },
      body:
        "currency=usd&line_items[0][price_data][unit_amount]=5000&line_items[0][quantity]=1",
    }),
  );
  const completed = await boundary.control.completeCheckout(
    String(checkout.id),
  );
  const refundRequest = () =>
    boundary.fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        authorization: "Bearer rk_test_spec14",
        "idempotency-key": "refund-ambiguous",
      },
      body:
        `payment_intent=${completed.paymentIntentId}&amount=5000&reverse_transfer=true&refund_application_fee=true`,
    });
  await boundary.control.setRefundMode("commit_then_unknown");
  await assertRejects(refundRequest, Error, "Simulated unknown refund outcome");
  const refundId = Object.keys((await store.read()).stripe.refunds)[0];
  assert(/^re_[A-Za-z0-9]+$/.test(refundId));
  for (
    const [mode, status] of [
      ["processing", "pending"],
      ["failed", "failed"],
    ] as const
  ) {
    await boundary.control.setRefundMode(mode, refundId);
    assertEquals(
      (await json(
        await boundary.fetch(`https://api.stripe.com/v1/refunds/${refundId}`, {
          headers: { authorization: "Bearer rk_test_spec14" },
        }),
      )).status,
      status,
    );
  }
  await boundary.control.setRefundMode("anomaly", refundId);
  assertEquals(
    (await json(
      await boundary.fetch(`https://api.stripe.com/v1/refunds/${refundId}`, {
        headers: { authorization: "Bearer rk_test_spec14" },
      }),
    )).amount,
    5001,
  );
  await boundary.control.setRefundMode("succeeded", refundId);
  const recovered = await store.read();
  assertEquals(recovered.stripe.refunds[refundId].id, refundId);
  assertEquals(recovered.stripe.refunds[refundId].status, "succeeded");
  assertEquals(recovered.stripe.refunds[refundId].amount, 5000);
  assertEquals(
    (recovered.stripe.transfers[completed.transferId].reversals as {
      data: unknown[];
    }).data.length,
    1,
  );
});

Deno.test("Stripe 22.5 Deno transport reaches the installed global fetch boundary", async () => {
  const boundary = createProviderBoundary(
    config,
    new MemoryProviderStore(),
    () => Promise.reject(new Error("unexpected native fetch")),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = boundary.fetch;
  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe("rk_test_spec14", {
      apiVersion: "2026-07-29.dahlia",
      maxNetworkRetries: 0,
    });
    const account = await stripe.v2.core.accounts.create({
      contact_email: "owner@example.invalid",
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
    }, { idempotencyKey: "transport-proof" });
    assert(/^acct_[A-Za-z0-9]+$/.test(String(account.id)));
    assertEquals(account.livemode, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("email simulation keeps stable provider ids separate from attempts for accepted failed and unknown modes", async () => {
  const store = new MemoryProviderStore();
  const boundary = createProviderBoundary(
    config,
    store,
    () => Promise.reject(new Error("unexpected native fetch")),
  );
  const control: ProviderControl = boundary.control;
  await control.setEmailMode("accepted");
  const acceptedA = await json(
    await boundary.fetch(config.resendEndpoint, {
      method: "POST",
      headers: { "idempotency-key": "attempt-a" },
      body: JSON.stringify({ to: ["buyer@example.invalid"] }),
    }),
  );
  const acceptedB = await json(
    await boundary.fetch(config.resendEndpoint, {
      method: "POST",
      headers: { "idempotency-key": "attempt-a" },
      body: "{}",
    }),
  );
  assertEquals(acceptedA.id, acceptedB.id);
  assert(String(acceptedA.id).startsWith("remsg_"));

  await control.setEmailMode("failed");
  const failed = await boundary.fetch(config.resendEndpoint, {
    method: "POST",
    headers: { "idempotency-key": "attempt-b" },
    body: "{}",
  });
  assertEquals(failed.status, 422);
  await control.setEmailMode("unknown");
  await assertRejects(
    () =>
      boundary.fetch(config.resendEndpoint, {
        method: "POST",
        headers: { "idempotency-key": "attempt-c" },
        body: "{}",
      }),
    Error,
    "Simulated unknown email outcome",
  );

  const snapshot = await control.snapshot();
  assertEquals(snapshot.email.messages.length, 3);
  assertEquals(
    new Set(snapshot.email.messages.map((message) => message.providerId)).size,
    3,
  );
});

Deno.test("signed Stripe event helper covers the exact raw body", async () => {
  const body = JSON.stringify({
    id: "evt_spec14",
    object: "event",
    livemode: false,
  });
  const signature = await createStripeSignature(
    body,
    config.stripeWebhookSecret,
    1_800_000_000,
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.stripeWebhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const hex = signature.split("v1=")[1];
  const bytes = Uint8Array.from(
    hex.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
  );
  assert(
    await crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      new TextEncoder().encode(`1800000000.${body}`),
    ),
  );
});
