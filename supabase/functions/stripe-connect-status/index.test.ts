// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import type Stripe from "stripe";
import {
  createStripeConnectStatusHandler,
  handler,
  type StripeConnectStatusDependencies,
} from "./index.ts";

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
    now: () => NOW,
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async (organizerId) => {
      assertEquals(organizerId, ORGANIZER_ID);
      return ACCOUNT_ID;
    },
    retrieveAccount: async (accountId, params) => {
      calls.push("retrieve");
      assertEquals(accountId, ACCOUNT_ID);
      assertEquals(params, {
        include: ["configuration.recipient", "defaults", "requirements"],
      });
      return readyAccount();
    },
    persistStatus: async (_organizerId, _accountId, projection, syncedAt) => {
      calls.push("persist");
      assertEquals(projection.requirementsStatus, "clear");
      assertEquals(syncedAt, NOW);
    },
  };

  const response = await createStripeConnectStatusHandler(dependencies)(
    request(),
  );

  assertEquals(calls, ["retrieve", "persist"]);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ready",
    requirements_currently_due_count: 0,
    requirements_past_due_count: 0,
    last_status_code: null,
    last_synced_at: NOW,
  });
});

Deno.test("connect status reports not started without contacting Stripe when the caller has no account", async () => {
  let retrieved = false;
  const dependencies: StripeConnectStatusDependencies = {
    appOrigin: "https://whereto.example",
    now: () => NOW,
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async () => null,
    retrieveAccount: async () => {
      retrieved = true;
      return readyAccount();
    },
    persistStatus: async () => undefined,
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
    now: () => NOW,
    requireOrganizer: async () => ({
      userId: "user",
      organizerId: ORGANIZER_ID,
    }),
    findAccount: async () => ACCOUNT_ID,
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
