// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import type Stripe from "stripe";
import {
  createStripeConnectStatusHandler,
  handler,
  type StripeConnectStatusDependencies,
} from "./index.ts";
import { createAccountRepository } from "../stripe-connect-session/connect.ts";

const ORGANIZER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "acct_Task8Recipient";
const NOW = "2026-08-25T20:00:00.000Z";

function readyAccount(): Stripe.V2.Core.Account {
  return {
    id: ACCOUNT_ID,
    object: "v2.core.account",
    applied_configurations: ["recipient"],
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "active", status_details: [] },
            payouts: { status: "active", status_details: [] },
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
  return new Request("https://functions.example/stripe-connect-status", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      origin: "https://whereto.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
}

Deno.test("connect status retrieves the caller's current Stripe account before persisting or reporting readiness", async () => {
  const calls: string[] = [];
  const dependencies: StripeConnectStatusDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async (organizerId) => {
      assertEquals(organizerId, ORGANIZER_ID);
      return ACCOUNT_ID;
    },
    beginRefresh: async (accountId) => {
      calls.push("begin");
      assertEquals(accountId, ACCOUNT_ID);
      return 101;
    },
    retrieveAccount: async (accountId, params) => {
      calls.push("retrieve");
      assertEquals(accountId, ACCOUNT_ID);
      assertEquals(params, {
        include: ["configuration.recipient", "defaults", "requirements"],
      });
      return readyAccount();
    },
    persistStatus: async (
      accountId,
      refreshSequence,
      projection,
    ) => {
      calls.push("persist");
      assertEquals(accountId, ACCOUNT_ID);
      assertEquals(refreshSequence, 101);
      assertEquals(projection.requirementsStatus, "clear");
      return { outcome: "updated", syncedAt: NOW };
    },
  };

  const response = await createStripeConnectStatusHandler(dependencies)(
    request(),
  );

  assertEquals(calls, ["begin", "retrieve", "persist"]);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ready",
    requirements_currently_due_count: 0,
    requirements_past_due_count: 0,
    last_status_code: null,
    last_synced_at: NOW,
  });
});

Deno.test("the shared Connect repository persists status only through the DB-sequence CAS RPC", async () => {
  const calls: unknown[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return name === "server_begin_connect_refresh"
        ? { data: 701, error: null }
        : {
          data: [{ persistence_result: "updated", last_synced_at: NOW }],
          error: null,
        };
    },
  } as unknown as Parameters<typeof createAccountRepository>[0];
  const repository = createAccountRepository(client);
  const refreshSequence = await repository.beginRefresh(ACCOUNT_ID);
  const result = await repository.persistStatus(
    ACCOUNT_ID,
    refreshSequence,
    {
      transfersStatus: "active",
      payoutsStatus: "active",
      requirementsStatus: "clear",
      requirementsCurrentlyDueCount: 0,
      requirementsPastDueCount: 0,
      lastStatusCode: null,
    },
  );

  assertEquals(result, { outcome: "updated", syncedAt: NOW });
  assertEquals(calls, [
    {
      name: "server_begin_connect_refresh",
      args: { p_stripe_account_id: ACCOUNT_ID },
    },
    {
      name: "server_persist_connect_status_if_current",
      args: {
        p_stripe_account_id: ACCOUNT_ID,
        p_refresh_sequence: 701,
        p_transfers_status: "active",
        p_payouts_status: "active",
        p_requirements_status: "clear",
        p_currently_due_count: 0,
        p_past_due_count: 0,
        p_last_status_code: null,
      },
    },
  ]);
});

Deno.test("connect status never reports a stale ready retrieval after newer restricted truth", async () => {
  const dependencies: StripeConnectStatusDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async () => ACCOUNT_ID,
    beginRefresh: async () => 102,
    retrieveAccount: async () => readyAccount(),
    persistStatus: async () => ({ outcome: "stale", syncedAt: NOW }),
  };

  const response = await createStripeConnectStatusHandler(dependencies)(
    request(),
  );

  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: { code: "STRIPE_REQUEST_FAILED" },
  });
});

Deno.test("connect status reports not started without contacting Stripe when the caller has no account", async () => {
  let retrieved = false;
  const dependencies: StripeConnectStatusDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async () => null,
    beginRefresh: async () => {
      throw new Error("must not begin without an account");
    },
    retrieveAccount: async () => {
      retrieved = true;
      return readyAccount();
    },
    persistStatus: async () => ({ outcome: "updated", syncedAt: NOW }),
  };

  const response = await createStripeConnectStatusHandler(dependencies)(
    request(),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "not_started" });
  assertEquals(retrieved, false);
});

Deno.test("connect status fails closed when the current account configuration is not the approved recipient-only setup", async () => {
  const malformed = readyAccount();
  malformed.applied_configurations = ["recipient", "merchant"];
  const dependencies: StripeConnectStatusDependencies = {
    appOrigin: "https://whereto.example",
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async () => ACCOUNT_ID,
    beginRefresh: async () => 103,
    retrieveAccount: async () => malformed,
    persistStatus: async () => {
      throw new Error("must not persist unsafe readiness");
    },
  };

  const response = await createStripeConnectStatusHandler(dependencies)(
    request(),
  );

  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: { code: "INVALID_STRIPE_ACCOUNT" },
  });
});

Deno.test("connect status returns safe missing-auth JSON before Stripe configuration is read", async () => {
  Deno.env.set("APP_BASE_URL", "https://whereto.example");
  Deno.env.set("SUPABASE_URL", "https://project.supabase.example");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-value");
  Deno.env.set("STRIPE_RESTRICTED_KEY", "invalid-server-key");

  const response = await handler(
    new Request("https://functions.example/stripe-connect-status", {
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
