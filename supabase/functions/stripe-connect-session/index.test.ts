// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import type Stripe from "stripe";
import {
  createStripeConnectSessionHandler,
  handler,
  type StripeConnectSessionDependencies,
} from "./index.ts";

const ORGANIZER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "acct_Task8Recipient";
const NOW = "2026-08-25T20:00:00.000Z";

function accountFixture(): Stripe.V2.Core.Account {
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
    created: NOW,
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
  };
}

function request(): Request {
  return new Request("https://functions.example/stripe-connect-session", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      origin: "https://whereto.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
}

Deno.test("connect session creates the approved recipient-only account and returns only its ephemeral secret and safe status", async () => {
  const calls: string[] = [];
  const dependencies: StripeConnectSessionDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "22222222-2222-4222-8222-222222222222",
      organizerId: ORGANIZER_ID,
    }),
    getContactEmail: async (userId) => {
      assertEquals(userId, "22222222-2222-4222-8222-222222222222");
      return "verified-owner@example.test";
    },
    findAccount: async () => null,
    insertAccount: async (record) => {
      calls.push("insert");
      assertEquals(record, {
        organizerId: ORGANIZER_ID,
        stripeAccountId: ACCOUNT_ID,
      });
      return ACCOUNT_ID;
    },
    beginRefresh: async (accountId) => {
      calls.push("begin");
      assertEquals(accountId, ACCOUNT_ID);
      return 201;
    },
    createAccount: async (params, options) => {
      calls.push("create");
      assertEquals(params, {
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } },
            },
          },
        },
        contact_email: "verified-owner@example.test",
        dashboard: "express",
        defaults: {
          currency: "usd",
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
        },
        identity: { country: "US" },
        include: ["configuration.recipient", "defaults", "requirements"],
        metadata: { whereto_organizer_id: ORGANIZER_ID },
      });
      assertEquals(options, {
        idempotencyKey: `whereto-connect-account-v1:${ORGANIZER_ID}`,
      });
      return accountFixture();
    },
    retrieveAccount: async (id, params) => {
      calls.push("retrieve");
      assertEquals(id, ACCOUNT_ID);
      assertEquals(params, {
        include: ["configuration.recipient", "defaults", "requirements"],
      });
      return accountFixture();
    },
    persistStatus: async (
      accountId,
      refreshSequence,
      projection,
    ) => {
      calls.push("persist");
      assertEquals({ accountId, refreshSequence, projection }, {
        accountId: ACCOUNT_ID,
        refreshSequence: 201,
        projection: {
          transfersStatus: "pending",
          payoutsStatus: "pending",
          requirementsStatus: "pending",
          requirementsCurrentlyDueCount: 0,
          requirementsPastDueCount: 0,
          lastStatusCode: null,
        },
      });
      return { outcome: "updated", syncedAt: NOW };
    },
    createAccountSession: async (params) => {
      calls.push("session");
      assertEquals(params, {
        account: ACCOUNT_ID,
        components: {
          account_management: { enabled: true },
          account_onboarding: { enabled: true },
          notification_banner: { enabled: true },
        },
      });
      return {
        account: ACCOUNT_ID,
        client_secret: "account-session-secret",
        components: {},
        expires_at: 1_800_000_000,
        livemode: false,
        object: "account_session",
      };
    },
  };

  const response = await createStripeConnectSessionHandler(dependencies)(
    request(),
  );

  assertEquals(response.status, 200);
  assertEquals(calls, [
    "create",
    "insert",
    "begin",
    "retrieve",
    "persist",
    "session",
  ]);
  assertEquals(await response.json(), {
    client_secret: "account-session-secret",
    connect_status: {
      status: "pending",
      requirements_currently_due_count: 0,
      requirements_past_due_count: 0,
      last_status_code: null,
      last_synced_at: NOW,
    },
  });
});

Deno.test("connect session reuses the caller's persisted account without creating another", async () => {
  let created = false;
  const dependencies: StripeConnectSessionDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    getContactEmail: async () => {
      throw new Error("must not read contact email for an existing account");
    },
    findAccount: async () => ACCOUNT_ID,
    beginRefresh: async () => 202,
    insertAccount: async () => {
      throw new Error("must not insert");
    },
    createAccount: async () => {
      created = true;
      return accountFixture();
    },
    retrieveAccount: async () => accountFixture(),
    persistStatus: async () => ({ outcome: "updated", syncedAt: NOW }),
    createAccountSession: async () => ({
      account: ACCOUNT_ID,
      client_secret: "reused-session-secret",
      components: {},
      expires_at: 1_800_000_000,
      livemode: false,
      object: "account_session",
    }),
  };

  const response = await createStripeConnectSessionHandler(dependencies)(
    request(),
  );

  assertEquals(response.status, 200);
  assertEquals(created, false);
});

Deno.test("connect session never creates a session from stale ready retrieval", async () => {
  let createdSession = false;
  const dependencies: StripeConnectSessionDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    getContactEmail: async () => {
      throw new Error("must not read contact email for an existing account");
    },
    findAccount: async () => ACCOUNT_ID,
    beginRefresh: async () => 203,
    insertAccount: async () => {
      throw new Error("must not insert");
    },
    createAccount: async () => accountFixture(),
    retrieveAccount: async () => accountFixture(),
    persistStatus: async () => ({ outcome: "stale", syncedAt: NOW }),
    createAccountSession: async () => {
      createdSession = true;
      throw new Error("must not create a session from stale truth");
    },
  };

  const response = await createStripeConnectSessionHandler(dependencies)(
    request(),
  );

  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: { code: "STRIPE_REQUEST_FAILED" },
  });
  assertEquals(createdSession, false);
});

Deno.test("connect session rejects unknown request fields before Stripe is called", async () => {
  let stripeCalled = false;
  const dependencies: StripeConnectSessionDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    getContactEmail: async () => "verified-owner@example.test",
    findAccount: async () => null,
    beginRefresh: async () => {
      throw new Error("must not begin an invalid request");
    },
    insertAccount: async () => ACCOUNT_ID,
    createAccount: async () => {
      stripeCalled = true;
      return accountFixture();
    },
    retrieveAccount: async () => accountFixture(),
    persistStatus: async () => ({ outcome: "updated", syncedAt: NOW }),
    createAccountSession: async () => {
      throw new Error("must not create session");
    },
  };
  const invalid = new Request(
    "https://functions.example/stripe-connect-session",
    {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        origin: "https://whereto.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ organizerId: "attacker-controlled" }),
    },
  );

  const response = await createStripeConnectSessionHandler(dependencies)(
    invalid,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: { code: "INVALID_REQUEST" } });
  assertEquals(stripeCalled, false);
});

Deno.test("connect session returns safe missing-auth JSON before Stripe configuration is read", async () => {
  Deno.env.set("APP_BASE_URL", "https://whereto.example");
  Deno.env.set("SUPABASE_URL", "https://project.supabase.example");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-value");
  Deno.env.set("STRIPE_RESTRICTED_KEY", "invalid-server-key");

  const response = await handler(
    new Request("https://functions.example/stripe-connect-session", {
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
