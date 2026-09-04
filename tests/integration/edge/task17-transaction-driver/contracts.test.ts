import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type Stripe from "stripe";
import { validateApprovedConnectAccount } from "../../../../supabase/functions/stripe-connect-session/connect.ts";
import * as contracts from "./contracts.ts";

const approvedAccountContract: Stripe.V2.Core.Account = {
  id: "acct_ApprovedDiagnosticFixture",
  object: "v2.core.account",
  dashboard: "express",
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
  created: "2026-09-04T00:00:00.000Z",
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

Deno.test("account diagnostic classifies retrieval failure without exposing the provider error", async () => {
  const retrieve = Reflect.get(contracts, "retrieveAccountForDiagnostic");
  assertEquals(typeof retrieve, "function");
  if (typeof retrieve !== "function") return;

  const result = await retrieve(async () => {
    throw new Error("provider body must not escape");
  });

  assertEquals(result, { ok: false, kind: "ACCOUNT_RETRIEVE_FAILED" });
  assertEquals(JSON.stringify(result).includes("provider body"), false);
});

Deno.test("account diagnostic reports only the fixed approved-contract bitmap on mismatch", () => {
  const validate = Reflect.get(contracts, "validateAccountForDiagnostic");
  assertEquals(typeof validate, "function");
  if (typeof validate !== "function") return;

  const result = validate(
    {
      id: "acct_must_not_escape",
      dashboard: "full",
      applied_configurations: ["merchant"],
      defaults: {
        currency: "eur",
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe",
          requirements_collector: "application",
          arbitrary_provider_field: "must not escape",
        },
      },
    },
    () => {
      throw new Error("INVALID_STRIPE_ACCOUNT");
    },
  );

  assertEquals(result, {
    ok: false,
    kind: "ACCOUNT_CONTRACT_MISMATCH",
    account_contract: {
      dashboard_is_express: false,
      recipient_configuration_only: false,
      default_currency_is_usd: false,
      fees_collector_is_application: false,
      losses_collector_is_application: false,
      requirements_collector_is_stripe: false,
    },
  });
  const serialized = JSON.stringify(result);
  assertEquals(serialized.includes("acct_"), false);
  assertEquals(serialized.includes("arbitrary_provider_field"), false);
  assertEquals(serialized.includes("must not escape"), false);
});

Deno.test("account diagnostic requires the authoritative validator before reporting success", () => {
  const validate = Reflect.get(contracts, "validateAccountForDiagnostic");
  assertEquals(typeof validate, "function");
  if (typeof validate !== "function") return;

  let validationCount = 0;
  const projection: ReturnType<typeof validateApprovedConnectAccount> = {
    transfersStatus: "active",
    payoutsStatus: "active",
    requirementsStatus: "clear",
    requirementsCurrentlyDueCount: 0,
    requirementsPastDueCount: 0,
    lastStatusCode: null,
  };
  assertEquals(
    validate(approvedAccountContract, (account: Stripe.V2.Core.Account) => {
      validationCount += 1;
      return validateApprovedConnectAccount(account);
    }),
    { ok: true, projection },
  );
  assertEquals(validationCount, 1);

  assertEquals(
    validate(approvedAccountContract, () => {
      throw new Error("INVALID_STRIPE_ACCOUNT");
    }),
    {
      ok: false,
      kind: "ACCOUNT_CONTRACT_MISMATCH",
      account_contract: {
        dashboard_is_express: true,
        recipient_configuration_only: true,
        default_currency_is_usd: true,
        fees_collector_is_application: true,
        losses_collector_is_application: true,
        requirements_collector_is_stripe: true,
      },
    },
  );
});

Deno.test("diagnostic cleanup preserves before ownership and closes exactly after acceptance", async () => {
  const cleanupAccount = Reflect.get(
    contracts,
    "applyDiagnosticAccountCleanup",
  );
  assertEquals(typeof cleanupAccount, "function");
  if (typeof cleanupAccount !== "function") return;

  let retrieveCount = 0;
  let closeCount = 0;
  const retrieve = async () => {
    retrieveCount += 1;
    return { closed: false, livemode: false };
  };
  const close = async () => {
    closeCount += 1;
    return { closed: true, livemode: false };
  };
  const assertTestMode = (account: { livemode: boolean }) => {
    if (account.livemode !== false) throw new Error("LIVE_MODE_FORBIDDEN");
  };

  assertEquals(
    await cleanupAccount(false, retrieve, close, assertTestMode),
    { connectedAccountClosed: false, connectedAccountPreserved: true },
  );
  assertEquals({ retrieveCount, closeCount }, {
    retrieveCount: 0,
    closeCount: 0,
  });

  assertEquals(
    await cleanupAccount(true, retrieve, close, assertTestMode),
    { connectedAccountClosed: true, connectedAccountPreserved: false },
  );
  assertEquals({ retrieveCount, closeCount }, {
    retrieveCount: 1,
    closeCount: 1,
  });
});

Deno.test("fixture Auth lookup follows every page and returns only the exact identity", async () => {
  const findUser = Reflect.get(contracts, "findExactFixtureAuthUser");
  assertEquals(typeof findUser, "function");
  if (typeof findUser !== "function") return;

  const pages: number[] = [];
  const result = await findUser(
    "fixture@example.invalid",
    async (page: number) => {
      pages.push(page);
      return page === 1
        ? {
          users: [{
            id: "11111111-1111-4111-8111-111111111111",
            email: "other@example.invalid",
          }],
          nextPage: 2,
        }
        : {
          users: [{
            id: "22222222-2222-4222-8222-222222222222",
            email: "fixture@example.invalid",
          }],
          nextPage: null,
        };
    },
  );

  assertEquals(pages, [1, 2]);
  assertEquals(result, { id: "22222222-2222-4222-8222-222222222222" });
});

Deno.test("fixture Auth lookup proves absence and rejects ambiguous identities", async () => {
  const findUser = Reflect.get(contracts, "findExactFixtureAuthUser");
  assertEquals(typeof findUser, "function");
  if (typeof findUser !== "function") return;

  assertEquals(
    await findUser(
      "fixture@example.invalid",
      async () => ({ users: [], nextPage: null }),
    ),
    null,
  );
  await assertRejects(
    () =>
      findUser("fixture@example.invalid", async () => ({
        users: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            email: "fixture@example.invalid",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            email: "fixture@example.invalid",
          },
        ],
        nextPage: null,
      })),
    Error,
    "DATABASE",
  );
});

Deno.test("Auth cleanup deletes the exact fixture identity and proves ID and email absence", async () => {
  const deleteAndVerify = Reflect.get(
    contracts,
    "deleteAndVerifyFixtureAuthUser",
  );
  assertEquals(typeof deleteAndVerify, "function");
  if (typeof deleteAndVerify !== "function") return;

  const deleted: string[] = [];
  await deleteAndVerify(
    {
      id: "22222222-2222-4222-8222-222222222222",
      email: "fixture@example.invalid",
    },
    async (id: string) => deleted.push(id),
    async () => null,
    async () => ({ users: [], nextPage: null }),
  );
  assertEquals(deleted, ["22222222-2222-4222-8222-222222222222"]);

  await assertRejects(
    () =>
      deleteAndVerify(
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "fixture@example.invalid",
        },
        async () => undefined,
        async () => ({
          id: "22222222-2222-4222-8222-222222222222",
          email: "fixture@example.invalid",
        }),
        async () => ({ users: [], nextPage: null }),
      ),
    Error,
    "DATABASE_DELETE_AUTH",
  );
  await assertRejects(
    () =>
      deleteAndVerify(
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "fixture@example.invalid",
        },
        async () => undefined,
        async () => null,
        async () => ({
          users: [{
            id: "33333333-3333-4333-8333-333333333333",
            email: "fixture@example.invalid",
          }],
          nextPage: null,
        }),
      ),
    Error,
    "DATABASE_DELETE_AUTH",
  );
});

Deno.test("destination-charge relations fail closed on every cross-wire", () => {
  const relationsMatch = Reflect.get(
    contracts,
    "destinationChargeRelationsMatch",
  );
  assertEquals(typeof relationsMatch, "function");
  if (typeof relationsMatch !== "function") return;

  const valid = {
    paymentIntentId: "pi_expected",
    chargeId: "ch_expected",
    transferId: "tr_expected",
    connectedAccountId: "acct_expected",
    charge: { payment_intent: "pi_expected", transfer: "tr_expected" },
    transfer: { source_transaction: "ch_expected" },
    applicationFee: { charge: "ch_expected", account: "acct_expected" },
  };
  assertEquals(relationsMatch(valid), true);

  const mutations = [
    { ...valid, charge: { ...valid.charge, payment_intent: "pi_crossed" } },
    { ...valid, charge: { ...valid.charge, transfer: "tr_crossed" } },
    { ...valid, transfer: { source_transaction: "ch_crossed" } },
    {
      ...valid,
      applicationFee: { ...valid.applicationFee, charge: "ch_crossed" },
    },
    {
      ...valid,
      applicationFee: { ...valid.applicationFee, account: "acct_crossed" },
    },
  ];
  for (const mutation of mutations) {
    assertEquals(relationsMatch(mutation), false);
  }
});

Deno.test("driver response guard allows summaries and rejects prohibited identifiers", () => {
  const assertSafe = Reflect.get(contracts, "assertSafeProofResponse");
  assertEquals(typeof assertSafe, "function");
  if (typeof assertSafe !== "function") return;

  const safe = {
    ok: true,
    event_id: "11111111-1111-4111-8111-111111111111",
    tier_id: "22222222-2222-4222-8222-222222222222",
    orders: [{ order_handle: "paid", status: "paid" }],
    tickets: [{ order_handle: "paid", ticket_count: 3, bindings_valid: true }],
  };
  assertEquals(assertSafe(safe), safe);

  for (
    const unsafe of [
      { provider: "pi_forbidden" },
      { ticket_id: "11111111-1111-4111-8111-111111111111" },
      { order_item_id: "22222222-2222-4222-8222-222222222222" },
      { stripe_event_id: "evt_forbidden" },
      { refund_id: "re_forbidden" },
    ]
  ) {
    assertThrows(() => assertSafe(unsafe), Error, "UNSAFE_PROOF_RESPONSE");
  }
});
