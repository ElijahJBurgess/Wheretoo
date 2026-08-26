// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import type Stripe from "stripe";
import {
  createStripeExpressLoginHandler,
  handler,
  type StripeExpressLoginDependencies,
} from "./index.ts";

const ORGANIZER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "acct_Task8Recipient";

function request(): Request {
  return new Request("https://functions.example/stripe-express-login", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      origin: "https://whereto.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
}

Deno.test("express login uses only the authenticated organizer's persisted account and returns only its short-lived URL", async () => {
  const dependencies: StripeExpressLoginDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async (organizerId) => {
      assertEquals(organizerId, ORGANIZER_ID);
      return ACCOUNT_ID;
    },
    retrieveAccount: async (accountId) => {
      assertEquals(accountId, ACCOUNT_ID);
      return {
        id: ACCOUNT_ID,
        object: "v2.core.account",
        applied_configurations: ["recipient"],
        configuration: {
          recipient: {
            applied: true,
            capabilities: {
              stripe_balance: {
                stripe_transfers: { status: "pending", status_details: [] },
                payouts: { status: "pending", status_details: [] },
              },
            },
          },
        },
        created: "2026-08-25T20:00:00.000Z",
        dashboard: "express",
        defaults: {
          currency: "usd",
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
            requirements_collector: "stripe",
          },
        },
        livemode: false,
        requirements: { entries: [] },
      } satisfies Stripe.V2.Core.Account;
    },
    createLoginLink: async (accountId) => {
      assertEquals(accountId, ACCOUNT_ID);
      return {
        object: "login_link",
        created: 1_777_777_777,
        url: "https://connect.stripe.test/express/session-token",
      };
    },
  };

  const response = await createStripeExpressLoginHandler(dependencies)(
    request(),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    url: "https://connect.stripe.test/express/session-token",
  });
});

Deno.test("express login does not accept an account ID from the request body", async () => {
  let stripeCalled = false;
  const dependencies: StripeExpressLoginDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async () => ACCOUNT_ID,
    retrieveAccount: async () => {
      stripeCalled = true;
      throw new Error("must not retrieve");
    },
    createLoginLink: async () => {
      stripeCalled = true;
      throw new Error("must not create link");
    },
  };
  const invalid = new Request(
    "https://functions.example/stripe-express-login",
    {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        origin: "https://whereto.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ accountId: "acct_attacker" }),
    },
  );

  const response = await createStripeExpressLoginHandler(dependencies)(invalid);

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: { code: "INVALID_REQUEST" } });
  assertEquals(stripeCalled, false);
});

Deno.test("express login gives a safe not-started response when the caller owns no connected account", async () => {
  const dependencies: StripeExpressLoginDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async () => null,
    retrieveAccount: async () => {
      throw new Error("must not retrieve");
    },
    createLoginLink: async () => {
      throw new Error("must not create link");
    },
  };

  const response = await createStripeExpressLoginHandler(dependencies)(
    request(),
  );

  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: { code: "INVALID_REQUEST" } });
});

Deno.test("express login returns safe missing-auth JSON before Stripe configuration is read", async () => {
  Deno.env.set("APP_BASE_URL", "https://whereto.example");
  Deno.env.set("SUPABASE_URL", "https://project.supabase.example");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-value");
  Deno.env.set("STRIPE_RESTRICTED_KEY", "invalid-server-key");

  const response = await handler(
    new Request("https://functions.example/stripe-express-login", {
      method: "POST",
      headers: {
        origin: "https://whereto.example",
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: { code: "AUTH_REQUIRED" } });
});
