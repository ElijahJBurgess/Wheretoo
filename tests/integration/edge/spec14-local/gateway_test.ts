import { assertEquals, assertThrows } from "@std/assert";
import {
  createGatewayHandler,
  FUNCTION_MODULES,
  loadProductionHandlers,
  validateHarnessIdentity,
} from "./gateway.ts";
import { MemoryProviderStore } from "./state.ts";
import { createProviderBoundary } from "./providers.ts";

const expectedFunctions = [
  "event-status-access",
  "free-rsvp",
  "free-rsvp-status",
  "moderate-event-queue",
  "order-confirmation",
  "organizer-refund-order",
  "public-discovery",
  "refund-detail-access",
  "report-event",
  "stripe-cancel-checkout",
  "stripe-connect-session",
  "stripe-connect-status",
  "stripe-create-checkout",
  "stripe-express-login",
  "stripe-webhook",
  "ticket-admission",
  "ticket-collection",
  "ticket-email-access",
  "ticket-email-status",
  "ticket-email-webhook",
  "ticket-email-worker",
  "ticket-recovery-request",
];

Deno.test("gateway inventory imports every production function exactly once", () => {
  assertEquals(Object.keys(FUNCTION_MODULES).sort(), expectedFunctions.sort());
  assertEquals(new Set(Object.values(FUNCTION_MODULES)).size, 22);
});

Deno.test("installed boundary precedes loading all 22 real production handlers", async () => {
  const boundary = createProviderBoundary(
    {
      gatewayOrigin: "http://127.0.0.1:55647",
      restOrigin: "http://127.0.0.1:55646",
      authOrigin: "http://127.0.0.1:55648",
      stripeWebhookSecret: "whsec_spec14synthetic",
      resendEndpoint: "https://api.resend.com/emails",
    },
    new MemoryProviderStore(),
    () => Promise.reject(new Error("no transport during import")),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = boundary.fetch;
  try {
    const handlers = await loadProductionHandlers();
    assertEquals(Object.keys(handlers).sort(), expectedFunctions.sort());
    assertEquals(
      Object.values(handlers).every((handler) => typeof handler === "function"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("startup identity validation is fail closed", () => {
  const valid = {
    task: "spec14-final-assembly",
    root: "/repo",
    instanceId: "instance-identity",
    containers: { rest: { port: 55646 }, auth: { port: 55648 } },
  };
  assertEquals(
    validateHarnessIdentity(valid, "/repo").instanceId,
    "instance-identity",
  );
  assertThrows(
    () => validateHarnessIdentity({ ...valid, root: "/other" }, "/repo"),
    Error,
    "identity root mismatch",
  );
  assertThrows(
    () =>
      validateHarnessIdentity({
        ...valid,
        containers: { rest: { port: 9 }, auth: { port: 55648 } },
      }, "/repo"),
    Error,
    "fixed bridge ports",
  );
});

Deno.test("gateway strips Supabase prefixes and protects simulator controls with the worker secret", async () => {
  const forwarded: string[] = [];
  const nativeFetch = (input: RequestInfo | URL) => {
    forwarded.push(String(input));
    return Promise.resolve(Response.json({ forwarded: String(input) }));
  };
  const provider = createProviderBoundary(
    {
      gatewayOrigin: "http://127.0.0.1:55647",
      restOrigin: "http://127.0.0.1:55646",
      authOrigin: "http://127.0.0.1:55648",
      stripeWebhookSecret: "whsec_spec14synthetic",
      resendEndpoint: "https://api.resend.com/emails",
    },
    new MemoryProviderStore(),
    nativeFetch,
  );
  const handler = createGatewayHandler({
    appOrigin: "http://127.0.0.1:3033",
    workerSecret: "worker-secret-for-tests",
    handlers: {
      "free-rsvp": () => Promise.resolve(new Response("real-handler")),
    },
    provider,
    nativeFetch,
  });

  assertEquals(
    (await handler(
      new Request("http://127.0.0.1:55647/functions/v1/free-rsvp"),
    )).status,
    200,
  );
  await handler(
    new Request("http://127.0.0.1:55647/rest/v1/rpc/example", {
      method: "POST",
      body: "{}",
    }),
  );
  await handler(new Request("http://127.0.0.1:55647/auth/v1/user"));
  assertEquals(forwarded, [
    "http://127.0.0.1:55646/rpc/example",
    "http://127.0.0.1:55648/user",
  ]);

  assertEquals(
    (await handler(
      new Request("http://127.0.0.1:55647/__spec14/control", {
        method: "POST",
        body: JSON.stringify({ action: "state" }),
      }),
    )).status,
    404,
  );
  const authorized = await handler(
    new Request("http://127.0.0.1:55647/__spec14/control", {
      method: "POST",
      headers: { "x-spec14-control": "worker-secret-for-tests" },
      body: JSON.stringify({ action: "state" }),
    }),
  );
  assertEquals(authorized.status, 200);
  assertEquals(authorized.headers.get("access-control-allow-origin"), null);
  const control = (body: unknown) =>
    handler(
      new Request("http://127.0.0.1:55647/__spec14/control", {
        method: "POST",
        headers: { "x-spec14-control": "worker-secret-for-tests" },
        body: JSON.stringify(body),
      }),
    );
  assertEquals(
    (await control({ action: "checkout-mode", mode: "commit_then_unknown" }))
      .status,
    200,
  );
  assertEquals(
    (await control({ action: "refund-mode", mode: "processing" })).status,
    200,
  );
  const state = await provider.control.snapshot();
  assertEquals(state.stripe.checkoutCreateMode, "commit_then_unknown");
  assertEquals(state.stripe.refundMode, "processing");
  assertEquals(
    (await control({ action: "refund-mode", mode: "unsafe" })).status,
    400,
  );
});

Deno.test("function ingress overwrites spoofable client identity headers before a real handler sees them", async () => {
  let seen: Headers | undefined;
  const provider = createProviderBoundary(
    {
      gatewayOrigin: "http://127.0.0.1:55647",
      restOrigin: "http://127.0.0.1:55646",
      authOrigin: "http://127.0.0.1:55648",
      stripeWebhookSecret: "whsec_spec14synthetic",
      resendEndpoint: "https://api.resend.com/emails",
    },
    new MemoryProviderStore(),
    () => Promise.reject(new Error("unexpected native fetch")),
  );
  const handler = createGatewayHandler({
    appOrigin: "http://127.0.0.1:3040",
    workerSecret: "worker-secret-for-tests",
    provider,
    nativeFetch: globalThis.fetch,
    handlers: {
      "free-rsvp": (request) => {
        seen = request.headers;
        return Response.json({ ok: true });
      },
    },
  });
  await handler(
    new Request("http://127.0.0.1:55647/functions/v1/free-rsvp", {
      headers: {
        "x-spec14-client-ip": "203.0.113.1",
        "cf-connecting-ip": "203.0.113.2",
        "x-forwarded-for": "203.0.113.3",
        forwarded: "for=203.0.113.4",
      },
    }),
  );
  assertEquals(seen?.get("x-spec14-client-ip"), "127.0.0.1");
  assertEquals(seen?.get("cf-connecting-ip"), "127.0.0.1");
  assertEquals(seen?.get("x-forwarded-for"), "127.0.0.1");
  assertEquals(seen?.has("forwarded"), false);
});

Deno.test("privileged controls invoke real worker and signed Stripe webhook handlers", async () => {
  const store = new MemoryProviderStore();
  const provider = createProviderBoundary(
    {
      gatewayOrigin: "http://127.0.0.1:55647",
      restOrigin: "http://127.0.0.1:55646",
      authOrigin: "http://127.0.0.1:55648",
      stripeWebhookSecret: "whsec_spec14synthetic",
      resendEndpoint: "https://api.resend.com/emails",
    },
    store,
    () => Promise.reject(new Error("unexpected native fetch")),
  );
  const completed = await provider.control.createStripeEvent(
    "refund.updated",
    "re_spec14_00000001",
  );
  const observed: Array<
    {
      name: string;
      authorization: string | null;
      signature: string | null;
      body: string;
    }
  > = [];
  Deno.env.set("TICKET_EMAIL_WORKER_SECRET", "derived-email-worker-secret");
  const handler = createGatewayHandler({
    appOrigin: "http://127.0.0.1:3040",
    workerSecret: "control-secret",
    provider,
    nativeFetch: globalThis.fetch,
    handlers: {
      "ticket-email-worker": async (request) => {
        observed.push({
          name: "worker",
          authorization: request.headers.get("authorization"),
          signature: null,
          body: await request.text(),
        });
        return Response.json({ ok: true });
      },
      "stripe-webhook": async (request) => {
        observed.push({
          name: "webhook",
          authorization: null,
          signature: request.headers.get("stripe-signature"),
          body: await request.text(),
        });
        return Response.json({ received: true });
      },
    },
  });
  const call = (body: unknown) =>
    handler(
      new Request("http://127.0.0.1:55647/__spec14/control", {
        method: "POST",
        headers: { "x-spec14-control": "control-secret" },
        body: JSON.stringify(body),
      }),
    );
  assertEquals(
    (await call({ action: "run-worker", name: "ticket-email-worker" })).status,
    200,
  );
  assertEquals(
    (await call({
      action: "stripe-event",
      type: "refund.updated",
      objectId: "re_spec14_00000001",
    })).status,
    200,
  );
  assertEquals(observed[0].authorization, "Bearer derived-email-worker-secret");
  assertEquals(observed[1].signature?.startsWith("t="), true);
  assertEquals(JSON.parse(observed[1].body).type, "refund.updated");
  assertEquals(completed.event.type, "refund.updated");
});
